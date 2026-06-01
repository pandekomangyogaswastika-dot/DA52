import { useState, useEffect, useCallback, useMemo } from 'react';
import { GlassCard, GlassPanel, GlassInput } from '@/components/ui/glass';
import Modal from '@/components/erp/Modal';
import ConfirmDialog from '@/components/erp/ConfirmDialog';
import { Button } from '@/components/ui/button';
import {
  ArrowDownToLine, Plus, Eye, CheckCircle, XCircle, Trash2,
  Package, Truck, Search, RefreshCw, FileText, Link2, AlertCircle
} from 'lucide-react';
import { IconButton } from './IconButton';
import { Combobox } from './Combobox';
// Sprint A.1: UniversalScanner SSOT
import UniversalScanner from './scanner/UniversalScanner';

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';

const STATUS_STYLES = {
  draft:      'bg-secondary text-muted-foreground border border-border',
  inspecting: 'bg-amber-400/15 text-amber-400 border border-amber-300/20',
  received:   'bg-emerald-400/15 text-emerald-300 border border-emerald-300/20',
  failed:     'bg-red-400/15 text-red-400 border border-red-300/20',
};

const EMPTY_ITEM = () => ({
  product_name: '', sku: '',
  material_id: '', material_name: '',
  expected_qty: 0, received_qty: 0, rejected_qty: 0, unit: 'pcs',
  lot_number: '',   // U7: lot tracking
  expiry_date: '',  // U7: expiry date
});

export default function ReceivingModule({ token, deepLinkParams }) {
  const [receipts, setReceipts]   = useState([]);
  const [locations, setLocations] = useState([]);
  const [materials, setMaterials] = useState([]);
  // Sprint 2.1: PO integration
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [search, setSearch] = useState('');

  // M12: memoized headers
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }), [token]);

  const [form, setForm] = useState({
    source_type: 'supplier', source_ref: '', supplier_name: '',
    location_id: '', location_name: '', notes: '',
    // Sprint 2.1: PO fields
    po_id: '', po_number: '',
    items: [EMPTY_ITEM()]
  });

  const fetchData = useCallback(async () => {
    try {
      const [rRes, lRes, mRes, poRes] = await Promise.all([
        fetch('/api/wms/legacy/receiving',    { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/wms/legacy/locations',    { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/rahaza/materials?limit=500', { headers: { Authorization: `Bearer ${token}` } }),
        // Sprint 2.1: Fetch approved POs (also include partially_received for resume)
        fetch('/api/rahaza/purchase-orders?status=approved', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (rRes.ok) setReceipts(await rRes.json());
      if (lRes.ok) setLocations(await lRes.json());
      if (mRes.ok) {
        const data = await mRes.json();
        setMaterials(Array.isArray(data) ? data : (data.items || []));
      }
      if (poRes.ok) setPurchaseOrders(await poRes.json());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // P1.C: Open the just-created GR from PO (deep-link from PurchaseOrderModule)
  useEffect(() => {
    if (deepLinkParams?.receipt_id && receipts.length > 0) {
      const gr = receipts.find(r => r.id === deepLinkParams.receipt_id);
      if (gr) {
        setShowDetail(gr);
      }
    }
  }, [deepLinkParams, receipts]);

  // Sprint 1.1: When user picks a material from dropdown, auto-fill name + unit
  const handleMaterialPick = (idx, materialId) => {
    const mat = materials.find(m => m.id === materialId);
    setForm(f => ({
      ...f,
      items: f.items.map((it, i) => i === idx ? {
        ...it,
        material_id:   mat?.id   || '',
        material_name: mat?.name || '',
        product_name:  mat?.name || it.product_name,
        sku:           mat?.code || it.sku,
        unit:          mat?.unit || it.unit,
      } : it)
    }));
  };

  // Sprint 2.1: When user picks a PO, auto-fill vendor and items
  const handlePOPick = (poId) => {
    const po = purchaseOrders.find(p => p.id === poId);
    if (!po) {
      setForm(f => ({ ...f, po_id: '', po_number: '' }));
      return;
    }
    
    // Pre-fill items from PO
    const poItems = (po.items || []).map(item => ({
      product_name:  item.material_name || '',
      sku:           item.material_code || '',
      material_id:   item.material_id,
      material_name: item.material_name || '',
      expected_qty:  item.qty_ordered || 0,
      received_qty:  item.qty_ordered || 0,
      rejected_qty:  0,
      unit:          item.unit || 'pcs',
    }));

    setForm(f => ({
      ...f,
      po_id: po.id,
      po_number: po.po_number,
      supplier_name: po.vendor_name,
      items: poItems.length > 0 ? poItems : [EMPTY_ITEM()],
    }));
  };

  const handleCreate = async () => {
    try {
      const loc = locations.find(l => l.id === form.location_id);
      const payload = { ...form, location_name: loc?.name || form.location_name };
      const res = await fetch('/api/wms/legacy/receiving', { method: 'POST', headers, body: JSON.stringify(payload) });
      if (res.ok) { setShowCreate(false); resetForm(); fetchData(); }
      else {
        const err = await res.json().catch(() => ({}));
        alert('Error: ' + (err.detail || res.status));
      }
    } catch (e) { alert('Error: ' + e.message); }
  };

  const handleStatusChange = async (receipt, newStatus) => {
    try {
      const res = await fetch(`/api/wms/legacy/receiving/${receipt.id}`, {
        method: 'PUT', headers, body: JSON.stringify({ status: newStatus, items: receipt.items })
      });
      if (res.ok) { setShowDetail(null); fetchData(); }
      else {
        const err = await res.json().catch(() => ({}));
        alert('Error: ' + (err.detail || res.status));
      }
    } catch (e) { alert('Error: ' + e.message); }
  };

  const handleDelete = async (id) => {
    try {
      await fetch(`/api/wms/legacy/receiving/${id}`, { method: 'DELETE', headers });
      setConfirmDelete(null); fetchData();
    } catch (e) { alert('Error: ' + e.message); }
  };

  const resetForm = () => setForm({
    source_type: 'supplier', source_ref: '', supplier_name: '',
    location_id: '', location_name: '', notes: '',
    items: [EMPTY_ITEM()]
  });

  const addItem    = () => setForm(f => ({ ...f, items: [...f.items, EMPTY_ITEM()] }));
  const removeItem = (idx) => setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
  const updateItem = (idx, field, val) => setForm(f => ({
    ...f, items: f.items.map((it, i) => i === idx ? { ...it, [field]: val } : it)
  }));

  const filtered = search ? receipts.filter(r =>
    r.receipt_number?.toLowerCase().includes(search.toLowerCase()) ||
    r.supplier_name?.toLowerCase().includes(search.toLowerCase())
  ) : receipts;

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" /></div>;

  return (
    <div className="space-y-5" data-testid="wh-receiving-module">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Goods Receiving</h1>
          <p className="text-muted-foreground text-sm">Terima barang dari supplier, produksi, atau transfer</p>
        </div>
        <div className="flex items-center gap-2">
          <IconButton label="Muat ulang penerimaan" onClick={fetchData} data-testid="receiving-refresh">
            <RefreshCw className="w-4 h-4 text-muted-foreground" />
          </IconButton>
          <Button onClick={() => setShowCreate(true)} className="bg-primary text-primary-foreground hover:brightness-110 gap-1.5" data-testid="create-receipt-btn">
            <Plus className="w-4 h-4" /> New Receipt
          </Button>
        </div>
      </div>

      {/* Sprint 1.1 info banner */}
      <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-blue-500/10 border border-blue-400/20">
        <Link2 className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
        <p className="text-xs text-blue-300">
          <strong>Sync Otomatis:</strong> Jika item dipilih dari master material, stok akan otomatis tercatat di modul Inventory (Material Issue / BOM) saat GR di-<em>Confirm Received</em>.
        </p>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <GlassInput placeholder="Search receipt..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      {/* Receipts List */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <GlassCard hover={false} className="p-8 text-center">
            <ArrowDownToLine className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Belum ada goods receipt</p>
          </GlassCard>
        ) : filtered.map(r => (
          <GlassCard key={r.id} className="p-4 cursor-pointer" onClick={() => setShowDetail(r)} data-testid={`receipt-${r.receipt_number}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground font-mono">{r.receipt_number}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.supplier_name || r.source_type} &bull; {r.items?.length || 0} items
                    {r.items?.some(i => i.material_id) && (
                      <span className="ml-1.5 text-blue-400 font-medium">
                        <Link2 className="w-3 h-3 inline" /> synced
                      </span>
                    )}
                    {/* P1.C: Show "From PO" badge if linked */}
                    {r.po_number && (
                      <span className="ml-1.5 text-emerald-400 font-medium">
                        &bull; <Truck className="w-3 h-3 inline" /> Dari PO {r.po_number}
                        {r.enforce_po_qty && <span className="ml-1 text-[10px] opacity-70">(qty terbatas)</span>}
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${STATUS_STYLES[r.status] || STATUS_STYLES.draft}`}>{r.status}</span>
                <p className="text-xs text-muted-foreground">{fmtDate(r.created_at)}</p>
              </div>
            </div>
          </GlassCard>
        ))}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <Modal title="New Goods Receipt" onClose={() => setShowCreate(false)} size="xl">
          <div className="space-y-4">
            {/* Sprint 2.1: PO Selection */}
            <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-400/20">
              <div className="flex items-start gap-2 mb-2">
                <FileText className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <label className="text-xs font-semibold text-blue-300 mb-1 block">Link ke Purchase Order (Optional)</label>
                  <Combobox
                    value={form.po_id}
                    onChange={(v) => handlePOPick(v)}
                    options={[
                      { value: '', label: 'Manual (tanpa PO)' },
                      ...purchaseOrders.map(po => ({
                        value: po.id,
                        label: `${po.po_number} - ${po.vendor_name}`,
                        description: `${po.item_count} items`,
                      }))
                    ]}
                    placeholder="Manual (tanpa PO)"
                    searchPlaceholder="Cari PO atau vendor..."
                    emptyMessage="PO tidak ditemukan"
                    className="border-blue-400/30"
                    data-testid="gr-po-select"
                  />
                  {form.po_number && (
                    <p className="text-xs text-blue-300 mt-1">✓ Items akan di-pre-fill dari PO {form.po_number}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Source Type</label>
                <select value={form.source_type} onChange={e => setForm(f => ({ ...f, source_type: e.target.value }))} className="w-full border border-[var(--glass-border)] bg-[var(--input-surface)] rounded-lg px-3 py-2 text-sm text-foreground">
                  <option value="supplier">Supplier</option>
                  <option value="production">Production</option>
                  <option value="transfer">Transfer</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Reference (PO/SO)</label>
                <GlassInput value={form.source_ref} onChange={e => setForm(f => ({ ...f, source_ref: e.target.value }))} placeholder="PO-001" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Supplier / Source</label>
                <GlassInput value={form.supplier_name} onChange={e => setForm(f => ({ ...f, supplier_name: e.target.value }))} placeholder="Nama supplier" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Location Tujuan</label>
                <Combobox
                  value={form.location_id}
                  onChange={(v) => setForm(f => ({ ...f, location_id: v }))}
                  options={locations.map(l => ({
                    value: l.id,
                    label: `${l.code} - ${l.name}`,
                  }))}
                  placeholder="Pilih lokasi..."
                  searchPlaceholder="Cari lokasi..."
                  emptyMessage="Lokasi tidak ditemukan"
                  data-testid="gr-location-select"
                />
              </div>
            </div>

            {/* Items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-muted-foreground">Items</label>
                <button onClick={addItem} className="text-xs text-primary hover:brightness-110 font-medium">+ Add Item</button>
              </div>
              <div className="space-y-3">
                {form.items.map((item, idx) => (
                  <div key={idx} className="p-3 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)] space-y-2">
                    {/* Row 1: Material picker */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-blue-400 font-medium flex items-center gap-1">
                          <Link2 className="w-3 h-3" /> Pilih dari Master Material (opsional)
                        </label>
                        <Combobox
                          value={item.material_id || ''}
                          onChange={(v) => handleMaterialPick(idx, v)}
                          options={[
                            { value: '', label: '-- Tanpa link material --' },
                            ...materials.map(m => ({
                              value: m.id,
                              label: `${m.code} — ${m.name}`,
                              description: m.unit,
                            }))
                          ]}
                          placeholder="-- Tanpa link material --"
                          searchPlaceholder="Cari material..."
                          emptyMessage="Material tidak ditemukan"
                          size="sm"
                          className="border-blue-400/25"
                          data-testid={`item-material-select-${idx}`}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground">Product Name</label>
                        <GlassInput
                          value={item.product_name}
                          onChange={e => updateItem(idx, 'product_name', e.target.value)}
                          placeholder="Nama produk"
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                    {/* Row 2: Qty fields */}
                    <div className="grid grid-cols-5 gap-2 items-end">
                      <div>
                        <label className="text-[10px] text-muted-foreground">SKU</label>
                        {/* Sprint A.1: scan button next to SKU */}
                        <div className="flex gap-1">
                          <GlassInput value={item.sku} onChange={e => updateItem(idx, 'sku', e.target.value)} placeholder="SKU" className="h-8 text-xs flex-1" />
                          <UniversalScanner
                            variant="button"
                            onScan={(code) => updateItem(idx, 'sku', code)}
                            title="Scan SKU"
                            size="icon"
                            btnVariant="outline"
                            className="h-8 w-8 shrink-0 p-0"
                            data-testid={`scan-sku-${idx}`}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground">Unit</label>
                        <select
                          value={item.unit}
                          onChange={e => updateItem(idx, 'unit', e.target.value)}
                          className="w-full border border-[var(--glass-border)] bg-[var(--input-surface)] rounded-lg px-2 h-8 text-xs text-foreground"
                        >
                          {['pcs','kg','gram','m','set','pair','roll','lbr'].map(u => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground">Expected</label>
                        <GlassInput type="number" value={item.expected_qty} onChange={e => updateItem(idx, 'expected_qty', parseFloat(e.target.value) || 0)} className="h-8 text-xs" />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground">Received</label>
                        <GlassInput type="number" value={item.received_qty} onChange={e => updateItem(idx, 'received_qty', parseFloat(e.target.value) || 0)} className="h-8 text-xs" />
                      </div>
                      <div className="flex gap-1">
                        <div className="flex-1">
                          <label className="text-[10px] text-muted-foreground">Rejected</label>
                          <GlassInput type="number" value={item.rejected_qty} onChange={e => updateItem(idx, 'rejected_qty', parseFloat(e.target.value) || 0)} className="h-8 text-xs" />
                        </div>
                        {form.items.length > 1 && (
                          <button onClick={() => removeItem(idx)} className="text-red-400 hover:text-red-300 mt-3.5">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      {/* U7 — Lot & Expiry */}
                      <div>
                        <label className="text-[10px] text-muted-foreground">No. Lot / Batch</label>
                        <GlassInput
                          value={item.lot_number}
                          onChange={e => updateItem(idx, 'lot_number', e.target.value)}
                          placeholder="LOT-001"
                          className="h-8 text-xs"
                          data-testid={`receiving-lot-${idx}`}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground">Tgl Kedaluwarsa</label>
                        <GlassInput
                          type="date"
                          value={item.expiry_date}
                          onChange={e => updateItem(idx, 'expiry_date', e.target.value)}
                          className="h-8 text-xs"
                          data-testid={`receiving-expiry-${idx}`}
                        />
                      </div>
                    </div>
                    {item.material_id && (
                      <p className="text-[10px] text-blue-400 flex items-center gap-1">
                        <Link2 className="w-3 h-3" /> Stok akan disinkronkan ke modul Inventory saat GR confirmed
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Notes</label>
              <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="w-full border border-[var(--glass-border)] bg-[var(--input-surface)] rounded-lg px-3 py-2 text-sm text-foreground h-16 resize-none placeholder:text-muted-foreground" placeholder="Optional notes..." />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowCreate(false)} className="border-[var(--glass-border)] text-muted-foreground hover:bg-[var(--glass-bg-hover)]">Batal</Button>
              <Button onClick={handleCreate} className="bg-primary text-primary-foreground hover:brightness-110" data-testid="submit-receipt-btn">Create Receipt</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Detail Modal */}
      {showDetail && (
        <Modal title={`Receipt ${showDetail.receipt_number}`} onClose={() => setShowDetail(null)} size="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-xs text-muted-foreground">Source</p><p className="text-sm font-medium text-foreground">{showDetail.supplier_name || showDetail.source_type}</p></div>
              <div><p className="text-xs text-muted-foreground">Reference</p><p className="text-sm font-medium text-foreground">{showDetail.source_ref || '-'}</p></div>
              <div><p className="text-xs text-muted-foreground">Location</p><p className="text-sm font-medium text-foreground">{showDetail.location_name || '-'}</p></div>
              <div><p className="text-xs text-muted-foreground">Status</p><span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${STATUS_STYLES[showDetail.status]}`}>{showDetail.status}</span></div>
            </div>

            <div className="border-t border-[var(--glass-border)] pt-3">
              <p className="text-xs font-medium text-muted-foreground mb-2">Items ({showDetail.items?.length || 0})</p>
              <div className="space-y-2">
                {(showDetail.items || []).map((item, idx) => (
                  <div key={idx} className="p-3 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)]">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-medium text-foreground">{item.product_name}</p>
                          {item.material_id && (
                            <span className="text-[10px] text-blue-400 flex items-center gap-0.5 bg-blue-400/10 px-1.5 py-0.5 rounded-full border border-blue-400/20">
                              <Link2 className="w-2.5 h-2.5" /> linked
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground font-mono">{item.sku}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-foreground">Received: <strong>{item.received_qty}</strong> / {item.expected_qty} {item.unit}</p>
                        {item.rejected_qty > 0 && <p className="text-xs text-red-400">Rejected: {item.rejected_qty}</p>}
                        {item.material_id && showDetail.status === 'received' && (
                          <p className="text-xs text-emerald-400 flex items-center justify-end gap-1">
                            <CheckCircle className="w-3 h-3" /> stok ter-sync
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {showDetail.status === 'draft' && (
              <div className="flex justify-end gap-2 pt-2 border-t border-[var(--glass-border)]">
                <Button variant="outline" onClick={() => { setConfirmDelete(showDetail.id); setShowDetail(null); }} className="border-red-300/20 text-red-400 hover:bg-red-400/10">
                  <Trash2 className="w-4 h-4 mr-1" /> Delete
                </Button>
                <Button onClick={() => handleStatusChange(showDetail, 'received')} className="bg-emerald-500 text-white hover:brightness-110" data-testid="confirm-receive-btn">
                  <CheckCircle className="w-4 h-4 mr-1" /> Confirm Received
                </Button>
              </div>
            )}
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <ConfirmDialog title="Delete Receipt?" message="GR draft ini akan dihapus permanen." onConfirm={() => handleDelete(confirmDelete)} onCancel={() => setConfirmDelete(null)} />
      )}
    </div>
  );
}
