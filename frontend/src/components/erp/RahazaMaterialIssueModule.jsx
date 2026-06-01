import { useState, useEffect, useCallback } from 'react';
import { Plus, Eye, Trash2, CheckCircle2, XCircle, AlertTriangle, Package, Sparkles, FileText, Send } from 'lucide-react';
import { GlassCard, GlassPanel, GlassInput } from '@/components/ui/glass';
import { Button } from '@/components/ui/button';
import Modal from './Modal';
// Sprint A.1: UniversalScanner SSOT replaces inline BarcodeScanner
import UniversalScanner from './scanner/UniversalScanner';

const STATUS_META = {
  draft:             { label: 'Draft',             bg: 'bg-slate-400/15',   border: 'border-slate-300/25',   text: 'text-slate-300' },
  pending_approval:  { label: 'Menunggu Approval', bg: 'bg-amber-400/15',   border: 'border-amber-300/25',   text: 'text-amber-300' },
  rejected:          { label: 'Ditolak',           bg: 'bg-red-400/15',     border: 'border-red-300/25',     text: 'text-red-300' },
  issued:            { label: 'Issued',            bg: 'bg-emerald-400/15', border: 'border-emerald-300/25', text: 'text-emerald-300' },
  cancelled:         { label: 'Cancelled',         bg: 'bg-gray-400/15',    border: 'border-gray-300/25',    text: 'text-gray-300' },
};

function StatusBadge({ status }) {
  const s = STATUS_META[status] || STATUS_META.draft;
  return <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full ${s.bg} ${s.border} border ${s.text}`}>{s.label}</span>;
}

export default function RahazaMaterialIssueModule({ token, onNavigate }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [workOrders, setWorkOrders] = useState([]);
  const [locations, setLocations] = useState([]);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterBuilding, setFilterBuilding] = useState('');
  const [buildings, setBuildings] = useState([]);
  const [draftModal, setDraftModal] = useState(false);
  const [draftForm, setDraftForm] = useState({ work_order_id: '', default_location_id: '' });
  const [detail, setDetail] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [scanTarget, setScanTarget] = useState(null); // { miId, itemIdx }
  const [materials, setMaterials] = useState([]);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      if (filterBuilding) params.set('building_id', filterBuilding);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const r = await fetch(`/api/rahaza/material-issues${qs}`, { headers });
      if (r.ok) setList(await r.json());
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, filterStatus, filterBuilding]);

  useEffect(() => { fetchList(); }, [fetchList]);
  useEffect(() => {
    const h = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch('/api/rahaza/work-orders', { headers: h }).then(r => r.ok ? r.json() : []),
      fetch('/api/rahaza/locations', { headers: h }).then(r => r.ok ? r.json() : []),
      fetch('/api/rahaza/materials', { headers: h }).then(r => r.ok ? r.json() : []),
      fetch(`${process.env.REACT_APP_BACKEND_URL}/api/wms/buildings`, { headers: h }).then(r => r.ok ? r.json() : []),
    ]).then(([w, l, m, b]) => {
      setWorkOrders(w);
      setLocations((l || []).filter(x => x.active));
      setMaterials(m || []);
      setBuildings(Array.isArray(b) ? b : []);
    });
  }, [token]);

  // U3 — Barcode scan handler: match scanned code to material
  const handleBarcodeScan = useCallback((code) => {
    setShowScanner(false);
    const mat = materials.find(m => m.code === code || m.id === code);
    if (!mat) { alert(`Material dengan kode '${code}' tidak ditemukan.`); return; }
    // If scanTarget has miId+itemIdx, update that specific MI item
    if (scanTarget && detail) {
      const updItems = [...(detail.items || [])];
      if (scanTarget.itemIdx !== undefined) {
        updItems[scanTarget.itemIdx] = { ...updItems[scanTarget.itemIdx], material_id: mat.id, material_code: mat.code, material_name: mat.name };
      }
      setDetail(prev => ({ ...prev, items: updItems }));
    }
    setScanTarget(null);
  }, [materials, detail, scanTarget]);

  const openDraft = () => { setDraftForm({ work_order_id: '', default_location_id: '' }); setFormError(''); setDraftModal(true); };

  const createDraft = async () => {
    setSaving(true); setFormError('');
    try {
      if (!draftForm.work_order_id) throw new Error('Pilih Work Order.');
      const r = await fetch('/api/rahaza/material-issues/draft-from-wo', { method: 'POST', headers, body: JSON.stringify(draftForm) });
      if (!r.ok) {
        const STATUS_MSG = { 400: 'WO tidak punya BOM snapshot atau BOM kosong.', 403: 'Tidak ada akses.', 404: 'WO tidak ditemukan.' };
        throw new Error(STATUS_MSG[r.status] || `Gagal buat draft MI (HTTP ${r.status})`);
      }
      const data = await r.json();
      setDraftModal(false);
      fetchList();
      openDetail({ id: data.id });
    } catch (e) { setFormError(e.message); }
    finally { setSaving(false); }
  };

  const openDetail = async (mi) => {
    const r = await fetch(`/api/rahaza/material-issues/${mi.id}`, { headers });
    if (r.ok) setDetail(await r.json());
  };

  const confirmMI = async (mi) => {
    // DEPRECATED: Legacy direct confirm (kept for old draft MIs)
    // New flow: submit → approve
    const missing = (mi.items || []).filter(it => !it.location_id);
    if (missing.length > 0) {
      alert(`${missing.length} item belum punya lokasi. Edit MI untuk set lokasi per item.`);
      return;
    }
    if (!window.confirm(`[LEGACY] Konfirmasi issue MI ${mi.mi_number}? Stok akan dikurangi langsung tanpa approval.`)) return;
    const r = await fetch(`/api/rahaza/material-issues/${mi.id}/confirm`, { method: 'POST', headers, body: JSON.stringify({}) });
    if (!r.ok) {
      let msg = `Gagal confirm (HTTP ${r.status})`;
      try {
        const err = await r.json();
        if (err.detail?.message) msg = err.detail.message + (err.detail.shortages ? `\nKurang di: ${JSON.stringify(err.detail.shortages)}` : '');
        else if (typeof err.detail === 'string') msg = err.detail;
      } catch { /* ignore */ }
      alert(msg);
      return;
    }
    fetchList();
    openDetail(mi);
  };

  // Sprint 2.2: Submit MI for approval
  const submitMI = async (mi) => {
    const missing = (mi.items || []).filter(it => !it.location_id);
    if (missing.length > 0) {
      alert(`${missing.length} item belum punya lokasi. Set lokasi dulu sebelum submit.`);
      return;
    }
    if (!window.confirm(`Ajukan MI ${mi.mi_number} untuk approval?`)) return;
    const r = await fetch(`/api/rahaza/material-issues/${mi.id}/submit`, { method: 'POST', headers });
    if (!r.ok) {
      let msg = `Gagal submit (HTTP ${r.status})`;
      try {
        const err = await r.json();
        if (typeof err.detail === 'string') msg = err.detail;
      } catch { /* ignore */ }
      alert(msg);
      return;
    }
    fetchList();
    openDetail(mi);
  };

  // Sprint 2.2: Approve MI (and execute issue)
  const approveMI = async (mi) => {
    if (!window.confirm(`Setujui dan issue MI ${mi.mi_number}? Stok akan dikurangi.`)) return;
    const r = await fetch(`/api/rahaza/material-issues/${mi.id}/approve`, { method: 'POST', headers, body: JSON.stringify({}) });
    if (!r.ok) {
      let msg = `Gagal approve (HTTP ${r.status})`;
      try {
        const err = await r.json();
        if (err.detail?.message) msg = err.detail.message + (err.detail.shortages ? `\nKurang di: ${JSON.stringify(err.detail.shortages)}` : '');
        else if (typeof err.detail === 'string') msg = err.detail;
      } catch { /* ignore */ }
      alert(msg);
      return;
    }
    fetchList();
    openDetail(mi);
  };

  // Sprint 2.2: Reject MI
  const rejectMI = async (mi) => {
    const reason = prompt(`Alasan menolak MI ${mi.mi_number}:`);
    if (!reason) return;
    const r = await fetch(`/api/rahaza/material-issues/${mi.id}/reject`, { method: 'POST', headers, body: JSON.stringify({ reason }) });
    if (!r.ok) {
      alert(`Gagal reject (HTTP ${r.status})`);
      return;
    }
    fetchList();
    openDetail(mi);
  };

  const cancelMI = async (mi) => {
    if (!window.confirm(`Cancel MI ${mi.mi_number}?`)) return;
    await fetch(`/api/rahaza/material-issues/${mi.id}/cancel`, { method: 'POST', headers });
    fetchList();
    if (detail?.id === mi.id) openDetail(mi);
  };

  const deleteMI = async (mi) => {
    if (!window.confirm(`Hapus MI ${mi.mi_number}?`)) return;
    await fetch(`/api/rahaza/material-issues/${mi.id}`, { method: 'DELETE', headers });
    fetchList();
    setDetail(null);
  };

  const updateDetailItemLocation = (itemId, locId) => {
    setDetail(d => ({
      ...d,
      items: d.items.map(it => it.id === itemId ? { ...it, location_id: locId } : it),
    }));
  };

  const saveDetailItems = async () => {
    if (!detail || detail.status !== 'draft') return;
    setSaving(true);
    try {
      const r = await fetch(`/api/rahaza/material-issues/${detail.id}`, {
        method: 'PUT', headers,
        body: JSON.stringify({ items: detail.items.map(it => ({ id: it.id, material_id: it.material_id, qty_required: it.qty_required, location_id: it.location_id, notes: it.notes })) }),
      });
      if (r.ok) {
        const updated = await r.json();
        setDetail(updated);
      }
    } finally { setSaving(false); }
  };

  if (loading) return (<div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" /></div>);

  return (
    <div className="space-y-5" data-testid="rahaza-mi-page">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Material Issue (MI)</h1>
          <p className="text-muted-foreground text-sm mt-1">Keluarkan benang/aksesoris ke produksi berdasarkan BOM Work Order. Konfirmasi akan mengurangi stok.</p>
        </div>
        <div className="flex items-center gap-2">
          {buildings.length > 0 && (
            <select
              value={filterBuilding}
              onChange={e => setFilterBuilding(e.target.value)}
              className="h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm text-foreground"
              data-testid="mi-filter-building"
              title="Filter berdasarkan gedung WMS"
            >
              <option value="">🏢 Semua Gedung</option>
              {buildings.map(b => <option key={b.id} value={b.id}>🏢 {b.name}</option>)}
            </select>
          )}
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm text-foreground" data-testid="mi-filter-status">
            <option value="">Semua Status</option>
            <option value="draft">Draft</option>
            <option value="pending_approval">Menunggu Approval</option>
            <option value="rejected">Ditolak</option>
            <option value="issued">Issued</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <Button onClick={openDraft} data-testid="mi-draft-btn"><Sparkles className="w-4 h-4 mr-1.5" /> Draft dari WO</Button>
        </div>
      </div>

      <GlassCard className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--glass-bg)]">
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-4 py-3">No. MI</th>
                <th className="px-4 py-3">Work Order</th>
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3 text-right">Total Qty</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Tanggal</th>
                <th className="px-4 py-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12">
                  <div className="flex flex-col items-center gap-3">
                    <Package className="w-10 h-10 text-foreground/20" strokeWidth={1.5} />
                    <div>
                      <div className="text-sm font-medium text-foreground/70">Belum ada Material Issue</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">Gunakan WO sebagai sumber — sistem akan menghitung kebutuhan material otomatis dari BOM snapshot.</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={() => setDraftModal(true)}
                        className="h-8"
                        data-testid="mi-empty-cta-draft"
                      >
                        <FileText className="w-3.5 h-3.5 mr-1.5" /> Draft dari WO
                      </Button>
                      {onNavigate && (
                        <Button
                          variant="outline"
                          onClick={() => onNavigate('prod-work-orders')}
                          className="h-8"
                          data-testid="mi-empty-cta-wo"
                        >
                          Buka Work Order
                        </Button>
                      )}
                    </div>
                    <p className="text-[10px] text-foreground/40 max-w-md mt-1">
                      Tanpa Material Issue, material belum resmi keluar dari gudang — stok tidak berkurang dan proses produksi tidak bisa di-track akurat.
                    </p>
                  </div>
                </td></tr>
              ) : list.map(mi => (
                <tr key={mi.id} className="border-t border-[var(--glass-border)] hover:bg-[var(--glass-bg-hover)]" data-testid={`mi-row-${mi.mi_number}`}>
                  <td className="px-4 py-3 font-mono text-xs text-foreground">{mi.mi_number}</td>
                  <td className="px-4 py-3">
                    {mi.wo_number_snapshot ? <span className="text-foreground">{mi.wo_number_snapshot}</span> : <span className="text-muted-foreground italic">Manual</span>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{mi.item_count} item</td>
                  <td className="px-4 py-3 text-right font-semibold text-foreground">{Number(mi.total_required || 0).toFixed(2)}</td>
                  <td className="px-4 py-3"><StatusBadge status={mi.status} /></td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{new Date(mi.created_at).toLocaleDateString('id-ID')}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button onClick={() => openDetail(mi)} className="p-1.5 rounded hover:bg-[var(--glass-bg-hover)] text-muted-foreground hover:text-foreground" title="Detail" data-testid={`mi-detail-${mi.mi_number}`}><Eye className="w-3.5 h-3.5" /></button>
                      {mi.status === 'draft' && (
                        <>
                          <button onClick={() => submitMI(mi)} className="p-1.5 rounded hover:bg-blue-400/10 text-muted-foreground hover:text-blue-400" title="Ajukan Approval" data-testid={`mi-submit-${mi.mi_number}`}><Send className="w-3.5 h-3.5" /></button>
                          <button onClick={() => deleteMI(mi)} className="p-1.5 rounded hover:bg-red-400/10 text-muted-foreground hover:text-red-400" title="Hapus"><Trash2 className="w-3.5 h-3.5" /></button>
                        </>
                      )}
                      {mi.status === 'pending_approval' && (
                        <>
                          <button onClick={() => approveMI(mi)} className="p-1.5 rounded hover:bg-emerald-400/10 text-muted-foreground hover:text-emerald-400" title="Setujui" data-testid={`mi-approve-${mi.mi_number}`}><CheckCircle2 className="w-3.5 h-3.5" /></button>
                          <button onClick={() => rejectMI(mi)} className="p-1.5 rounded hover:bg-red-400/10 text-muted-foreground hover:text-red-400" title="Tolak" data-testid={`mi-reject-${mi.mi_number}`}><XCircle className="w-3.5 h-3.5" /></button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {/* Draft modal */}
      {draftModal && (
        <Modal onClose={() => setDraftModal(false)} title="Generate Draft MI dari Work Order" size="md">
          <div className="space-y-3" data-testid="mi-draft-form">
            {formError && <div className="bg-red-400/10 border border-red-300/20 rounded-lg p-3 text-sm text-red-300">{formError}</div>}
            <div>
              <label className="block text-xs font-medium text-foreground/70 mb-1">Work Order <span className="text-red-400">*</span></label>
              <select value={draftForm.work_order_id} onChange={e => setDraftForm({...draftForm, work_order_id: e.target.value})} className="w-full h-10 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm text-foreground" data-testid="mi-draft-wo">
                <option value="">— Pilih WO —</option>
                {workOrders.filter(w => w.status !== 'cancelled').map(w => (
                  <option key={w.id} value={w.id}>{`${w.wo_number} · ${w.model_code} · ${w.size_code} · ${w.qty} pcs ${w.bom_snapshot ? '' : '(No BOM)'}`}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground/70 mb-1">Lokasi Default (opsional)</label>
              <select value={draftForm.default_location_id} onChange={e => setDraftForm({...draftForm, default_location_id: e.target.value})} className="w-full h-10 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm text-foreground">
                <option value="">— Set manual per item —</option>
                {locations.map(l => <option key={l.id} value={l.id}>{`${l.code} · ${l.name}`}</option>)}
              </select>
              <p className="text-[11px] text-muted-foreground mt-1">Jika dipilih, semua item akan default ke lokasi ini.</p>
            </div>
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-2.5 text-xs text-foreground/80">
              Draft MI akan diisi otomatis dari BOM snapshot WO: <b>qty_required = bom_qty × wo.qty</b>. Material yang belum ada di master akan dibuat otomatis (auto-register).
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setDraftModal(false)} disabled={saving}>Batal</Button>
              <Button onClick={createDraft} disabled={saving} data-testid="mi-draft-submit">{saving ? 'Generating...' : 'Generate Draft MI'}</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Detail modal */}
      {detail && (
        <Modal onClose={() => setDetail(null)} title={`Detail ${detail.mi_number}`} size="xl">
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 text-sm">
              <div><span className="text-muted-foreground">Status:</span> <StatusBadge status={detail.status} /></div>
              <div><span className="text-muted-foreground">WO:</span> <b>{detail.wo_number_snapshot || 'Manual'}</b></div>
              <div><span className="text-muted-foreground">Qty WO:</span> <b>{detail.qty_wo_pcs || 0} pcs</b></div>
              <div><span className="text-muted-foreground">Tanggal:</span> <b>{new Date(detail.created_at).toLocaleDateString('id-ID')}</b></div>
            </div>

            {detail.missing_codes?.length > 0 && (
              <div className="bg-amber-400/10 border border-amber-300/20 rounded-lg p-3 text-sm text-amber-200 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold">Kode material kosong pada BOM</div>
                  <div className="text-xs">{detail.missing_codes.join(', ')} — item ini tidak ikut di MI. Lengkapi kode di BOM lalu regenerate.</div>
                </div>
              </div>
            )}

            {/* U3 — Scan button for draft MI */}
            {detail.status === 'draft' && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setScanTarget({ miId: detail.id }); setShowScanner(true); }}
                  className="flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300 px-3 py-1.5 bg-cyan-500/10 rounded-lg border border-cyan-500/20 transition-colors"
                  data-testid="mi-scan-barcode-btn"
                >
                  <ScanLine size={13} /> Scan Barcode Material
                </button>
                <span className="text-xs text-white/40">Scan untuk auto-fill material dari barcode</span>
              </div>
            )}

            <GlassPanel className="p-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-[var(--glass-bg)]">
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2">Material</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2 text-right">Qty Required</th>
                    <th className="px-3 py-2 text-right">Qty Issued</th>
                    <th className="px-3 py-2">Lokasi Ambil</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail.items || []).map((it, idx) => (
                    <tr key={it.id} className="border-t border-[var(--glass-border)]">
                      <td className="px-3 py-2">
                        <div className="font-mono text-xs text-foreground flex items-center gap-1">
                          {it.material_code}
                          {detail.status === 'draft' && (
                            <button
                              onClick={() => { setScanTarget({ miId: detail.id, itemIdx: idx }); setShowScanner(true); }}
                              className="text-cyan-400/60 hover:text-cyan-400 ml-1"
                              title="Scan barcode untuk material ini"
                              data-testid={`mi-item-scan-${it.material_code}`}
                            >
                              <ScanLine size={11} />
                            </button>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">{it.material_name}</div>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{it.material_type}</td>
                      <td className="px-3 py-2 text-right font-mono text-foreground">{Number(it.qty_required).toFixed(3)} {it.unit}</td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground">{Number(it.qty_issued || 0).toFixed(3)} {it.unit}</td>
                      <td className="px-3 py-2">
                        {detail.status === 'draft' ? (
                          <select value={it.location_id || ''} onChange={e => updateDetailItemLocation(it.id, e.target.value)} className="h-8 px-2 rounded border border-[var(--glass-border)] bg-[var(--input-surface)] text-xs text-foreground" data-testid={`mi-item-location-${it.material_code}`}>
                            <option value="">— Pilih —</option>
                            {locations.map(l => <option key={l.id} value={l.id}>{l.code}</option>)}
                          </select>
                        ) : (
                          <span className="text-xs text-muted-foreground">{it.location_code || '—'}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </GlassPanel>

            <div className="flex items-center justify-between gap-2 pt-2 flex-wrap">
              {detail.status === 'draft' && (
                <Button variant="ghost" onClick={saveDetailItems} disabled={saving} className="border border-[var(--glass-border)]">
                  Simpan Lokasi
                </Button>
              )}
              <div className="flex items-center gap-2 ml-auto">
                {detail.status === 'draft' && (
                  <>
                    <Button variant="ghost" onClick={() => cancelMI(detail)} className="text-red-300 hover:bg-red-400/10"><XCircle className="w-4 h-4 mr-1.5" /> Cancel</Button>
                    <Button onClick={() => confirmMI(detail)} data-testid="mi-confirm-btn"><CheckCircle2 className="w-4 h-4 mr-1.5" /> Konfirmasi & Kurangi Stok</Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* U3 — Barcode Scanner Modal (Sprint A.1: UniversalScanner SSOT) */}
      <UniversalScanner
        variant="modal"
        open={showScanner}
        onClose={() => { setShowScanner(false); setScanTarget(null); }}
        onScan={handleBarcodeScan}
        title="Scan Barcode Material"
      />
    </div>
  );
}
