import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Eye, Trash2, CheckCircle2, XCircle, AlertTriangle, Send, Package, FileText, TruckIcon, Upload, Download } from 'lucide-react';
import { GlassCard, GlassPanel, GlassInput } from '@/components/ui/glass';
import { Button } from '@/components/ui/button';
import Modal from './Modal';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';

const STATUS_META = {
  draft:               { label: 'Draft',               bg: 'bg-slate-400/15',   border: 'border-slate-300/25',   text: 'text-slate-300', icon: FileText },
  pending_approval:    { label: 'Menunggu Approval',   bg: 'bg-amber-400/15',   border: 'border-amber-300/25',   text: 'text-amber-300', icon: AlertTriangle },
  approved:            { label: 'Disetujui',           bg: 'bg-emerald-400/15', border: 'border-emerald-300/25', text: 'text-emerald-300', icon: CheckCircle2 },
  partially_received:  { label: 'Diterima Sebagian',   bg: 'bg-blue-400/15',    border: 'border-blue-300/25',    text: 'text-blue-300', icon: Package },
  fully_received:      { label: 'Diterima Penuh',      bg: 'bg-green-400/15',   border: 'border-green-300/25',   text: 'text-green-300', icon: CheckCircle2 },
  rejected:            { label: 'Ditolak',             bg: 'bg-red-400/15',     border: 'border-red-300/25',     text: 'text-red-300', icon: XCircle },
  cancelled:           { label: 'Dibatalkan',          bg: 'bg-gray-400/15',    border: 'border-gray-300/25',    text: 'text-gray-300', icon: XCircle },
};

function StatusBadge({ status }) {
  const s = STATUS_META[status] || STATUS_META.draft;
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${s.bg} ${s.border} border ${s.text}`}>
      <Icon className="w-3 h-3" />
      {s.label}
    </span>
  );
}

export default function PurchaseOrderModule({ token, onNavigate }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [materials, setMaterials] = useState([]);
  const [filterStatus, setFilterStatus] = useState('');
  const [createModal, setCreateModal] = useState(false);
  const [detailModal, setDetailModal] = useState(false);
  const [approveModal, setApproveModal] = useState(false);
  const [rejectModal, setRejectModal] = useState(false);
  const [cancelModal, setCancelModal] = useState(false);
  const [selectedPO, setSelectedPO] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [bulkModal, setBulkModal] = useState(false);
  const [bulkRows, setBulkRows] = useState([]);
  const [bulkVendor, setBulkVendor] = useState('');
  const [bulkErrors, setBulkErrors] = useState([]);
  const csvRef = useRef(null);

  const [poForm, setPOForm] = useState({
    vendor_name: '',
    vendor_contact: '',
    vendor_address: '',
    po_date: new Date().toISOString().split('T')[0],
    expected_delivery_date: '',
    notes: '',
    items: [],
  });

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const q = filterStatus ? `?status=${filterStatus}` : '';
      const r = await fetch(`/api/rahaza/purchase-orders${q}`, { headers });
      if (r.ok) setList(await r.json());
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, filterStatus]);

  useEffect(() => { fetchList(); }, [fetchList]);
  
  useEffect(() => {
    const h = { Authorization: `Bearer ${token}` };
    fetch('/api/rahaza/materials', { headers: h })
      .then(r => r.ok ? r.json() : [])
      .then(m => setMaterials((m || []).filter(x => x.active)));
  }, [token]);

  const resetForm = () => {
    setPOForm({
      vendor_name: '',
      vendor_contact: '',
      vendor_address: '',
      po_date: new Date().toISOString().split('T')[0],
      expected_delivery_date: '',
      notes: '',
      items: [],
    });
    setFormError('');
  };

  const openCreate = () => {
    resetForm();
    setCreateModal(true);
  };

  const addItem = () => {
    setPOForm(prev => ({
      ...prev,
      items: [...prev.items, { id: crypto.randomUUID(), material_id: '', qty_ordered: 0, unit_cost: 0, notes: '' }],
    }));
  };

  const updateItem = (itemId, field, value) => {
    setPOForm(prev => ({
      ...prev,
      items: prev.items.map(it => it.id === itemId ? { ...it, [field]: value } : it),
    }));
  };

  const removeItem = (itemId) => {
    setPOForm(prev => ({
      ...prev,
      items: prev.items.filter(it => it.id !== itemId),
    }));
  };

  const createPO = async () => {
    setSaving(true);
    setFormError('');
    try {
      if (!poForm.vendor_name.trim()) throw new Error('Nama vendor wajib diisi.');
      if (poForm.items.length === 0) throw new Error('Tambahkan minimal 1 item material.');
      
      const validItems = poForm.items.filter(it => it.material_id && parseFloat(it.qty_ordered) > 0);
      if (validItems.length === 0) throw new Error('Tidak ada item valid (material & qty > 0).');

      const r = await fetch('/api/rahaza/purchase-orders', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...poForm, items: validItems }),
      });
      
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.detail || `Gagal membuat PO (HTTP ${r.status})`);
      }
      
      toast.success('Purchase Order berhasil dibuat');
      setCreateModal(false);
      resetForm();
      fetchList();
    } catch (e) {
      setFormError(e.message);
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const openDetail = async (po) => {
    const r = await fetch(`/api/rahaza/purchase-orders/${po.id}`, { headers });
    if (r.ok) {
      const detail = await r.json();
      // P1.C: also fetch GR audit trail in parallel
      try {
        const gr_r = await fetch(`/api/rahaza/purchase-orders/${po.id}/grs`, { headers });
        if (gr_r.ok) {
          detail._grs = await gr_r.json();
        }
      } catch (e) {
        // non-fatal
      }
      setSelectedPO(detail);
      setDetailModal(true);
    }
  };

  const submitPO = async (po) => {
    if (!window.confirm(`Ajukan PO ${po.po_number} untuk approval?`)) return;
    const r = await fetch(`/api/rahaza/purchase-orders/${po.id}/submit`, { method: 'POST', headers });
    if (r.ok) {
      toast.success('PO berhasil diajukan untuk approval');
      fetchList();
      if (selectedPO?.id === po.id) openDetail(po);
    } else {
      toast.error('Gagal mengajukan PO');
    }
  };

  const openApproveModal = (po) => {
    setSelectedPO(po);
    setApproveModal(true);
  };

  const approvePO = async () => {
    setSaving(true);
    try {
      const r = await fetch(`/api/rahaza/purchase-orders/${selectedPO.id}/approve`, {
        method: 'POST',
        headers,
      });
      if (r.ok) {
        toast.success(`PO ${selectedPO.po_number} berhasil disetujui`);
        setApproveModal(false);
        fetchList();
        if (detailModal) openDetail(selectedPO);
      } else {
        throw new Error('Gagal menyetujui PO');
      }
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const openRejectModal = (po) => {
    setSelectedPO(po);
    setRejectReason('');
    setRejectModal(true);
  };

  const rejectPO = async () => {
    setSaving(true);
    try {
      const r = await fetch(`/api/rahaza/purchase-orders/${selectedPO.id}/reject`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ reason: rejectReason || 'Tidak ada alasan' }),
      });
      if (r.ok) {
        toast.success(`PO ${selectedPO.po_number} ditolak`);
        setRejectModal(false);
        fetchList();
        if (detailModal) openDetail(selectedPO);
      } else {
        throw new Error('Gagal menolak PO');
      }
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const openCancelModal = (po) => {
    setSelectedPO(po);
    setCancelReason('');
    setCancelModal(true);
  };

  const cancelPO = async () => {
    setSaving(true);
    try {
      const r = await fetch(`/api/rahaza/purchase-orders/${selectedPO.id}/cancel`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ reason: cancelReason || 'Tidak ada alasan' }),
      });
      if (r.ok) {
        toast.success(`PO ${selectedPO.po_number} dibatalkan`);
        setCancelModal(false);
        fetchList();
        if (detailModal) openDetail(selectedPO);
      } else {
        throw new Error('Gagal membatalkan PO');
      }
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const deletePO = async (po) => {
    if (!window.confirm(`Hapus PO ${po.po_number}?`)) return;
    const r = await fetch(`/api/rahaza/purchase-orders/${po.id}`, { method: 'DELETE', headers });
    if (r.ok) {
      toast.success('PO berhasil dihapus');
      fetchList();
      setDetailModal(false);
    } else {
      toast.error('Gagal menghapus PO');
    }
  };

  const createGRFromPO = async (po) => {
    // P1.C: Call backend create-gr endpoint then navigate to receiving
    try {
      const r = await fetch(`/api/rahaza/purchase-orders/${po.id}/create-gr`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: `Auto-created from PO ${po.po_number}` }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: 'Gagal membuat GR' }));
        toast.error(err.detail || 'Gagal membuat GR dari PO');
        return;
      }
      const gr = await r.json();
      toast.success(`GR ${gr.receipt_number} berhasil dibuat dari PO ${po.po_number}. ${gr.items.length} item siap diterima.`);
      // Navigate to ReceivingModule with the new GR id (let module handle the deep link)
      onNavigate?.('wh-receiving', { receipt_id: gr.id, po_id: po.id, po_number: po.po_number });
      fetchList();
      setDetailModal(false);
    } catch (e) {
      toast.error('Gagal membuat GR: ' + (e?.message || ''));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="purchase-order-page">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Purchase Order (PO)</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Kelola pembelian material dari vendor. PO harus disetujui sebelum bisa diterima di Gudang.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm text-foreground"
            data-testid="po-filter-status"
          >
            <option value="">Semua Status</option>
            <option value="draft">Draft</option>
            <option value="pending_approval">Menunggu Approval</option>
            <option value="approved">Disetujui</option>
            <option value="partially_received">Diterima Sebagian</option>
            <option value="fully_received">Diterima Penuh</option>
            <option value="rejected">Ditolak</option>
            <option value="cancelled">Dibatalkan</option>
          </select>
          <Button onClick={openCreate} data-testid="po-create-btn">
            <Plus className="w-4 h-4 mr-1.5" /> Buat PO
          </Button>
          {/* U2 — Bulk CSV Import */}
          <button
            onClick={() => setBulkModal(true)}
            className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 px-3 py-1.5 bg-emerald-500/10 rounded-lg border border-emerald-500/20 transition-colors"
            data-testid="po-bulk-import-btn"
          >
            <Upload size={13} /> Import CSV
          </button>
        </div>
      </div>

      {/* PO List */}
      <GlassCard>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--glass-border)]">
              <tr className="text-left text-muted-foreground">
                <th className="pb-3 pl-4 font-semibold">No. PO</th>
                <th className="pb-3 font-semibold">Tanggal</th>
                <th className="pb-3 font-semibold">Vendor</th>
                <th className="pb-3 font-semibold">Items</th>
                <th className="pb-3 font-semibold">Total Nilai</th>
                <th className="pb-3 font-semibold">Status</th>
                <th className="pb-3 pr-4 font-semibold text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="text-foreground">
              {list.length === 0 && (
                <tr>
                  <td colSpan="7" className="py-12 text-center text-muted-foreground">
                    <Package className="w-12 h-12 mx-auto mb-2 opacity-30" />
                    <p>Belum ada Purchase Order</p>
                  </td>
                </tr>
              )}
              {list.map((po, idx) => (
                <tr key={po.id} className={`border-b border-[var(--glass-border)] ${idx % 2 === 0 ? 'bg-[var(--glass-bg)]/30' : ''}`} data-testid={`po-row-${po.id}`}>
                  <td className="py-3 pl-4 font-mono text-xs">{po.po_number}</td>
                  <td className="py-3 text-xs">{new Date(po.po_date).toLocaleDateString('id-ID')}</td>
                  <td className="py-3">
                    <div className="font-medium">{po.vendor_name}</div>
                    {po.vendor_contact && <div className="text-xs text-muted-foreground">{po.vendor_contact}</div>}
                  </td>
                  <td className="py-3 text-xs">{po.item_count} item</td>
                  <td className="py-3 font-mono text-xs">Rp {(po.total_value || 0).toLocaleString('id-ID')}</td>
                  <td className="py-3">
                    <StatusBadge status={po.status} />
                  </td>
                  <td className="py-3 pr-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openDetail(po)} data-testid={`po-view-${po.id}`}>
                        <Eye className="w-4 h-4" />
                      </Button>
                      {po.status === 'draft' && (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => submitPO(po)} data-testid={`po-submit-${po.id}`}>
                            <Send className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => deletePO(po)} data-testid={`po-delete-${po.id}`}>
                            <Trash2 className="w-4 h-4 text-red-400" />
                          </Button>
                        </>
                      )}
                      {po.status === 'pending_approval' && (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => openApproveModal(po)} data-testid={`po-approve-${po.id}`}>
                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => openRejectModal(po)} data-testid={`po-reject-${po.id}`}>
                            <XCircle className="w-4 h-4 text-red-400" />
                          </Button>
                        </>
                      )}
                      {(po.status === 'approved' || po.status === 'partially_received') && (
                        <Button variant="ghost" size="sm" onClick={() => createGRFromPO(po)} data-testid={`po-create-gr-${po.id}`}>
                          <TruckIcon className="w-4 h-4 text-blue-400" />
                        </Button>
                      )}
                      {po.status !== 'fully_received' && po.status !== 'cancelled' && (
                        <Button variant="ghost" size="sm" onClick={() => openCancelModal(po)} data-testid={`po-cancel-${po.id}`}>
                          <XCircle className="w-4 h-4 text-gray-400" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {/* Create PO Modal */}
      {createModal && (
        <Modal onClose={() => setCreateModal(false)} title="Buat Purchase Order Baru">
          <div className="space-y-4">
            {formError && (
              <div className="p-3 rounded-lg bg-red-400/10 border border-red-400/30 text-red-300 text-sm">
                {formError}
              </div>
            )}
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Nama Vendor *</label>
                <GlassInput
                  value={poForm.vendor_name}
                  onChange={e => setPOForm({ ...poForm, vendor_name: e.target.value })}
                  placeholder="PT ABC Textile"
                  data-testid="po-form-vendor-name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Kontak Vendor</label>
                <GlassInput
                  value={poForm.vendor_contact}
                  onChange={e => setPOForm({ ...poForm, vendor_contact: e.target.value })}
                  placeholder="0812-3456-7890"
                  data-testid="po-form-vendor-contact"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">Alamat Vendor</label>
              <textarea
                value={poForm.vendor_address}
                onChange={e => setPOForm({ ...poForm, vendor_address: e.target.value })}
                placeholder="Jl. Raya Industri No. 123, Bandung"
                className="w-full px-3 py-2 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-foreground text-sm"
                rows="2"
                data-testid="po-form-vendor-address"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Tanggal PO</label>
                <GlassInput
                  type="date"
                  value={poForm.po_date}
                  onChange={e => setPOForm({ ...poForm, po_date: e.target.value })}
                  data-testid="po-form-date"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Estimasi Terima</label>
                <GlassInput
                  type="date"
                  value={poForm.expected_delivery_date}
                  onChange={e => setPOForm({ ...poForm, expected_delivery_date: e.target.value })}
                  data-testid="po-form-expected-delivery"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">Catatan</label>
              <textarea
                value={poForm.notes}
                onChange={e => setPOForm({ ...poForm, notes: e.target.value })}
                placeholder="Catatan tambahan..."
                className="w-full px-3 py-2 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-foreground text-sm"
                rows="2"
                data-testid="po-form-notes"
              />
            </div>

            <div className="border-t border-[var(--glass-border)] pt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Items</h3>
                <Button size="sm" onClick={addItem} data-testid="po-form-add-item">
                  <Plus className="w-3 h-3 mr-1" /> Tambah Item
                </Button>
              </div>
              
              {poForm.items.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">Belum ada item. Klik "Tambah Item" untuk menambahkan.</p>
              )}

              {poForm.items.map((item, idx) => (
                <div key={item.id} className="grid grid-cols-12 gap-2 mb-2 items-end">
                  <div className="col-span-5">
                    {idx === 0 && <label className="block text-xs font-medium mb-1">Material</label>}
                    <select
                      value={item.material_id}
                      onChange={e => {
                        const matId = e.target.value;
                        const mat = materials.find(m => m.id === matId);
                        updateItem(item.id, 'material_id', matId);
                        if (mat) updateItem(item.id, 'unit', mat.unit || 'pcs');
                      }}
                      className="w-full h-9 px-2 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm text-foreground"
                      data-testid={`po-form-item-material-${idx}`}
                    >
                      <option value="">Pilih Material</option>
                      {materials.map(m => (
                        <option key={m.id} value={m.id}>{`${m.code} - ${m.name}`}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2">
                    {idx === 0 && <label className="block text-xs font-medium mb-1">Qty</label>}
                    <div className="flex items-center gap-1">
                      <GlassInput
                        type="number"
                        step="0.01"
                        value={item.qty_ordered}
                        onChange={e => updateItem(item.id, 'qty_ordered', parseFloat(e.target.value) || 0)}
                        placeholder="0"
                        className="text-center"
                        data-testid={`po-form-item-qty-${idx}`}
                      />
                      {item.unit && (
                        <span className="text-xs text-muted-foreground whitespace-nowrap font-medium px-1 min-w-[28px]">
                          {item.unit}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="col-span-2">
                    {idx === 0 && <label className="block text-xs font-medium mb-1">Harga</label>}
                    <GlassInput
                      type="number"
                      step="0.01"
                      value={item.unit_cost}
                      onChange={e => updateItem(item.id, 'unit_cost', parseFloat(e.target.value) || 0)}
                      placeholder="0"
                      className="text-right"
                      data-testid={`po-form-item-cost-${idx}`}
                    />
                  </div>
                  <div className="col-span-2">
                    {idx === 0 && <label className="block text-xs font-medium mb-1">Total</label>}
                    <div className="h-9 flex items-center justify-end px-2 text-sm font-mono text-muted-foreground">
                      {((item.qty_ordered || 0) * (item.unit_cost || 0)).toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                    </div>
                  </div>
                  <div className="col-span-1">
                    {idx === 0 && <div className="h-4 mb-1" />}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeItem(item.id)}
                      data-testid={`po-form-item-remove-${idx}`}
                    >
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-[var(--glass-border)]">
              <Button variant="secondary" onClick={() => setCreateModal(false)}>Batal</Button>
              <Button onClick={createPO} disabled={saving} data-testid="po-form-submit">
                {saving ? 'Menyimpan...' : 'Simpan Draft PO'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Detail PO Modal */}
      {detailModal && selectedPO && (
        <Modal onClose={() => setDetailModal(false)} title={`Detail PO: ${selectedPO.po_number}`} size="large">
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--glass-border)]">
              <div>
                <StatusBadge status={selectedPO.status} />
                {selectedPO.rejected_reason && (
                  <p className="text-xs text-red-300 mt-1">Alasan ditolak: {selectedPO.rejected_reason}</p>
                )}
                {selectedPO.cancelled_reason && (
                  <p className="text-xs text-gray-300 mt-1">Alasan dibatalkan: {selectedPO.cancelled_reason}</p>
                )}
              </div>
              <div className="text-right text-sm text-muted-foreground">
                <div>Dibuat: {new Date(selectedPO.created_at).toLocaleString('id-ID')}</div>
                <div>Oleh: {selectedPO.created_by_name}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground mb-1">Vendor</div>
                <div className="font-medium">{selectedPO.vendor_name}</div>
                {selectedPO.vendor_contact && <div className="text-xs text-muted-foreground">{selectedPO.vendor_contact}</div>}
                {selectedPO.vendor_address && <div className="text-xs text-muted-foreground mt-1">{selectedPO.vendor_address}</div>}
              </div>
              <div>
                <div className="text-muted-foreground mb-1">Tanggal</div>
                <div>PO: {new Date(selectedPO.po_date).toLocaleDateString('id-ID')}</div>
                {selectedPO.expected_delivery_date && (
                  <div className="text-xs">Estimasi Terima: {new Date(selectedPO.expected_delivery_date).toLocaleDateString('id-ID')}</div>
                )}
              </div>
            </div>

            {selectedPO.notes && (
              <div className="p-3 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)]">
                <div className="text-xs text-muted-foreground mb-1">Catatan</div>
                <div className="text-sm">{selectedPO.notes}</div>
              </div>
            )}

            <div>
              <h3 className="font-semibold mb-2">Items ({selectedPO.items?.length || 0})</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-[var(--glass-border)]">
                    <tr className="text-left text-muted-foreground text-xs">
                      <th className="pb-2">Material</th>
                      <th className="pb-2 text-right">Qty Order</th>
                      <th className="pb-2 text-right">Qty Terima</th>
                      <th className="pb-2 text-right">Harga</th>
                      <th className="pb-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedPO.items?.map((it, idx) => (
                      <tr key={it.id} className={`border-b border-[var(--glass-border)] ${idx % 2 === 0 ? 'bg-[var(--glass-bg)]/30' : ''}`}>
                        <td className="py-2">
                          <div className="font-medium">{it.material_code}</div>
                          <div className="text-xs text-muted-foreground">{it.material_name}</div>
                        </td>
                        <td className="py-2 text-right font-mono">
                          {it.qty_ordered} {it.unit}
                        </td>
                        <td className="py-2 text-right font-mono">
                          <span className={it.qty_received >= it.qty_ordered ? 'text-emerald-400' : 'text-amber-400'}>
                            {it.qty_received} {it.unit}
                          </span>
                        </td>
                        <td className="py-2 text-right font-mono">
                          Rp {it.unit_cost.toLocaleString('id-ID')}
                        </td>
                        <td className="py-2 text-right font-mono">
                          Rp {(it.qty_ordered * it.unit_cost).toLocaleString('id-ID')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-[var(--glass-border)] font-semibold">
                    <tr>
                      <td colSpan="4" className="pt-2 text-right">Total Nilai PO:</td>
                      <td className="pt-2 text-right font-mono">
                        Rp {(selectedPO.items?.reduce((sum, it) => sum + (it.qty_ordered * it.unit_cost), 0) || 0).toLocaleString('id-ID')}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* P1.C: GR Audit Trail (Goods Receipts linked to this PO) */}
            {(selectedPO._grs?.length || 0) > 0 && (
              <div data-testid="po-detail-grs">
                <h3 className="font-semibold mb-2 flex items-center gap-2">
                  <TruckIcon className="w-4 h-4 text-blue-400" />
                  Goods Receipts ({selectedPO._grs.length})
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-[var(--glass-border)]">
                      <tr className="text-left text-muted-foreground text-xs">
                        <th className="pb-2">No. GR</th>
                        <th className="pb-2">Tanggal</th>
                        <th className="pb-2">Penerima</th>
                        <th className="pb-2 text-right">Total Items</th>
                        <th className="pb-2 text-right">Net Diterima</th>
                        <th className="pb-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedPO._grs.map((gr, idx) => (
                        <tr key={gr.id} className={`border-b border-[var(--glass-border)] ${idx % 2 === 0 ? 'bg-[var(--glass-bg)]/30' : ''}`} data-testid={`po-gr-row-${gr.id}`}>
                          <td className="py-2 font-mono text-xs">{gr.receipt_number}</td>
                          <td className="py-2 text-xs">{gr.created_at ? new Date(gr.created_at).toLocaleString('id-ID') : '-'}</td>
                          <td className="py-2 text-xs">{gr.received_by || '-'}</td>
                          <td className="py-2 text-right">{gr.items_count}</td>
                          <td className="py-2 text-right font-mono text-emerald-400">{gr.total_net}</td>
                          <td className="py-2">
                            <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                              gr.status === 'received' ? 'bg-green-400/15 border-green-300/25 text-green-300' :
                              gr.status === 'draft' ? 'bg-slate-400/15 border-slate-300/25 text-slate-300' :
                              'bg-amber-400/15 border-amber-300/25 text-amber-300'
                            } border`}>
                              {gr.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex justify-between gap-2 pt-4 border-t border-[var(--glass-border)]">
              <div>
                {selectedPO.status === 'draft' && (
                  <Button onClick={() => { setDetailModal(false); submitPO(selectedPO); }}>
                    <Send className="w-4 h-4 mr-1.5" /> Ajukan Approval
                  </Button>
                )}
                {selectedPO.status === 'pending_approval' && (
                  <>
                    <Button onClick={() => { setDetailModal(false); openApproveModal(selectedPO); }} className="mr-2">
                      <CheckCircle2 className="w-4 h-4 mr-1.5" /> Setujui
                    </Button>
                    <Button variant="secondary" onClick={() => { setDetailModal(false); openRejectModal(selectedPO); }}>
                      <XCircle className="w-4 h-4 mr-1.5" /> Tolak
                    </Button>
                  </>
                )}
                {(selectedPO.status === 'approved' || selectedPO.status === 'partially_received') && (
                  <Button onClick={() => createGRFromPO(selectedPO)}>
                    <TruckIcon className="w-4 h-4 mr-1.5" /> Buat Goods Receipt
                  </Button>
                )}
              </div>
              <Button variant="secondary" onClick={() => setDetailModal(false)}>Tutup</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Approve Modal */}
      {approveModal && selectedPO && (
        <Modal onClose={() => setApproveModal(false)} title="Konfirmasi Approval">
          <div className="space-y-4">
            <p>Apakah Anda yakin ingin menyetujui PO <strong>{selectedPO.po_number}</strong>?</p>
            <p className="text-sm text-muted-foreground">
              Setelah disetujui, PO dapat digunakan untuk membuat Goods Receipt di Warehouse.
            </p>
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="secondary" onClick={() => setApproveModal(false)}>Batal</Button>
              <Button onClick={approvePO} disabled={saving}>
                {saving ? 'Memproses...' : 'Ya, Setujui'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Reject Modal */}
      {rejectModal && selectedPO && (
        <Modal onClose={() => setRejectModal(false)} title="Tolak Purchase Order">
          <div className="space-y-4">
            <p>Anda akan menolak PO <strong>{selectedPO.po_number}</strong>.</p>
            <div>
              <label className="block text-sm font-medium mb-1.5">Alasan Penolakan *</label>
              <textarea
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                placeholder="Masukkan alasan penolakan..."
                className="w-full px-3 py-2 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-foreground text-sm"
                rows="3"
                data-testid="po-reject-reason"
              />
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="secondary" onClick={() => setRejectModal(false)}>Batal</Button>
              <Button variant="destructive" onClick={rejectPO} disabled={saving || !rejectReason.trim()}>
                {saving ? 'Memproses...' : 'Tolak PO'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Cancel Modal */}
      {cancelModal && selectedPO && (
        <Modal onClose={() => setCancelModal(false)} title="Batalkan Purchase Order">
          <div className="space-y-4">
            <p>Anda akan membatalkan PO <strong>{selectedPO.po_number}</strong>.</p>
            <div>
              <label className="block text-sm font-medium mb-1.5">Alasan Pembatalan *</label>
              <textarea
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                placeholder="Masukkan alasan pembatalan..."
                className="w-full px-3 py-2 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-foreground text-sm"
                rows="3"
                data-testid="po-cancel-reason"
              />
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="secondary" onClick={() => setCancelModal(false)}>Batal</Button>
              <Button variant="destructive" onClick={cancelPO} disabled={saving || !cancelReason.trim()}>
                {saving ? 'Memproses...' : 'Batalkan PO'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* U2 — Bulk PO CSV Import Modal */}
      {bulkModal && (
        <Modal onClose={() => { setBulkModal(false); setBulkRows([]); setBulkErrors([]); }} title="Import PO dari CSV" size="lg">
          <div className="space-y-4" data-testid="bulk-po-modal">
            {/* Template download */}
            <div className="flex items-center gap-2 p-3 bg-sky-500/10 rounded-lg border border-sky-500/20">
              <Download size={14} className="text-sky-400 flex-shrink-0" />
              <span className="text-xs text-sky-300 flex-1">Download template CSV untuk format yang benar</span>
              <button
                onClick={() => {
                  const ws = XLSX.utils.json_to_sheet([
                    { vendor_name: 'PT Supplier A', material_code: 'ACC-BTN-001', qty_ordered: 100, unit_cost: 500, unit: 'pcs' },
                    { vendor_name: 'PT Supplier A', material_code: 'YRN-W-001',   qty_ordered: 50,  unit_cost: 12000, unit: 'kg' },
                  ]);
                  const wb = XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(wb, ws, 'Template PO');
                  XLSX.writeFile(wb, 'template-bulk-po.xlsx');
                }}
                className="text-xs text-sky-400 hover:text-sky-300 px-2 py-1 bg-sky-500/20 rounded border border-sky-500/30"
                data-testid="po-template-download"
              >
                <Download size={12} className="inline mr-1" /> Template Excel
              </button>
            </div>

            {/* Default vendor */}
            <div>
              <label className="block text-xs font-medium text-foreground/70 mb-1">Vendor Default (opsional — bisa di-override per baris CSV)</label>
              <input
                value={bulkVendor}
                onChange={e => setBulkVendor(e.target.value)}
                placeholder="Nama vendor..."
                className="w-full h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm text-foreground"
                data-testid="bulk-vendor-input"
              />
            </div>

            {/* File picker */}
            <div>
              <label className="block text-xs font-medium text-foreground/70 mb-1">Upload File Excel/CSV</label>
              <input
                ref={csvRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const buf = await file.arrayBuffer();
                  const wb = XLSX.read(buf);
                  const ws = wb.Sheets[wb.SheetNames[0]];
                  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
                  setBulkRows(rows);
                  setBulkErrors([]);
                }}
              />
              <button
                onClick={() => csvRef.current?.click()}
                className="flex items-center gap-2 text-sm text-foreground/70 hover:text-foreground px-4 py-2 bg-white/5 rounded-lg border border-dashed border-white/20 hover:border-white/40 transition-colors w-full justify-center"
                data-testid="bulk-file-picker"
              >
                <Upload size={15} /> Pilih file Excel/CSV
              </button>
            </div>

            {/* Preview */}
            {bulkRows.length > 0 && (
              <div>
                <p className="text-xs text-white/60 mb-2">{bulkRows.length} baris terdeteksi:</p>
                <div className="overflow-x-auto max-h-40 rounded-lg border border-white/10">
                  <table className="w-full text-xs">
                    <thead className="bg-white/5 sticky top-0">
                      <tr>{Object.keys(bulkRows[0]).map(k => <th key={k} className="px-2 py-1.5 text-left text-white/50 font-medium">{k}</th>)}</tr>
                    </thead>
                    <tbody>
                      {bulkRows.slice(0, 8).map((r, i) => (
                        <tr key={i} className="border-t border-white/5">
                          {Object.values(r).map((v, j) => <td key={j} className="px-2 py-1 text-white/70">{String(v)}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {bulkErrors.length > 0 && (
                  <div className="mt-2 p-2 bg-red-500/10 rounded-lg border border-red-500/20 text-xs text-red-300 space-y-0.5">
                    {bulkErrors.map((e, i) => <div key={i}>{e}</div>)}
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => { setBulkModal(false); setBulkRows([]); setBulkErrors([]); }}>Batal</Button>
              <Button
                disabled={bulkRows.length === 0 || saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    const r = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/rahaza/purchase-orders/bulk-import`, {
                      method: 'POST',
                      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                      body: JSON.stringify({ vendor_name: bulkVendor, rows: bulkRows }),
                    });
                    const d = await r.json();
                    if (!r.ok) {
                      setBulkErrors(d.errors || [d.detail || 'Import gagal']);
                    } else {
                      toast.success(`${d.created} PO berhasil dibuat`);
                      if (d.row_errors?.length) setBulkErrors(d.row_errors);
                      else { setBulkModal(false); setBulkRows([]); setBulkErrors([]); }
                      loadList();
                    }
                  } catch {
                    toast.error('Gagal import PO');
                  } finally {
                    setSaving(false);
                  }
                }}
                data-testid="bulk-import-submit"
              >
                {saving ? 'Importing...' : `Import ${bulkRows.length} Baris`}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
