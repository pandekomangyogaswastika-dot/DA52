import { useState, useEffect, useCallback } from 'react';
import { Plus, Edit2, Trash2, Package, Scale, Gem, Archive, AlertTriangle, Search } from 'lucide-react';
import { GlassCard, GlassInput } from '@/components/ui/glass';
import { Button } from '@/components/ui/button';
import Modal from './Modal';
import PaginationBar from './PaginationBar';

const TYPE_META = {
  yarn:      { label: 'Benang',    icon: Scale,  color: 'text-amber-300',    bg: 'bg-amber-400/10',    border: 'border-amber-300/20' },
  accessory: { label: 'Aksesoris', icon: Gem,    color: 'text-primary',      bg: 'bg-primary/10',      border: 'border-primary/25' },
  fg:        { label: 'Barang Jadi', icon: Archive, color: 'text-emerald-300', bg: 'bg-emerald-400/10', border: 'border-emerald-300/20' },
};

export default function RahazaMaterialsModule({ token }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filterType, setFilterType] = useState('');
  const [filterLowStock, setFilterLowStock] = useState(false);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({
    code: '', name: '', type: 'yarn', unit: 'kg', yarn_type: '', color: '', notes: '',
    min_stock: 0, min_stock_qty: '', min_stock_percentage: '', active: true,
    pack_unit: 'pack', pack_size: 1, display_in_packs: false,
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Pagination
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const fetchRows = useCallback(async (targetPage = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: targetPage, limit: 50 });
      if (filterType) params.set('type', filterType);
      if (filterLowStock) params.set('low_stock', 'true');
      if (search) params.set('search', search);
      const r = await fetch(`/api/rahaza/materials?${params}`, { headers });
      if (r.ok) {
        const data = await r.json();
        if (data && data.items && data.pagination) {
          setRows(data.items);
          setPagination(data.pagination);
        } else {
          setRows(Array.isArray(data) ? data : []);
          setPagination(null);
        }
      }
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, filterType, filterLowStock, search]);

  useEffect(() => { setPage(1); fetchRows(1); }, [filterType, filterLowStock, search]); // eslint-disable-line
  useEffect(() => { fetchRows(page); }, [page]); // eslint-disable-line

  const openCreate = () => {
    setEditing(null);
    setForm({ code: '', name: '', type: 'yarn', unit: 'kg', yarn_type: '', color: '', notes: '', min_stock: 0, min_stock_qty: '', min_stock_percentage: '', active: true, pack_unit: 'pack', pack_size: 1, display_in_packs: false });
    setFormError(''); setModalOpen(true);
  };
  const openEdit = (r) => {
    setEditing(r);
    setForm({ ...r, min_stock_qty: r.min_stock_qty || '', min_stock_percentage: r.min_stock_percentage || '', pack_unit: r.pack_unit || 'pack', pack_size: r.pack_size || 1, display_in_packs: r.display_in_packs || false });
    setFormError(''); setModalOpen(true);
  };
  const save = async () => {
    setSaving(true); setFormError('');
    try {
      if (!form.code || !form.name) throw new Error('Kode & nama wajib diisi.');
      const url = editing ? `/api/rahaza/materials/${editing.id}` : '/api/rahaza/materials';
      const method = editing ? 'PUT' : 'POST';
      const payload = {
        ...form,
        min_stock: Number(form.min_stock) || 0,
        min_stock_qty: form.min_stock_qty !== '' ? Number(form.min_stock_qty) : null,
        min_stock_percentage: form.min_stock_percentage !== '' ? Number(form.min_stock_percentage) : null,
        pack_size: Number(form.pack_size) || 1,
        display_in_packs: Boolean(form.display_in_packs),
      };
      const res = await fetch(url, { method, headers, body: JSON.stringify(payload) });
      if (!res.ok) {
        const STATUS_MSG = { 400: 'Data tidak valid.', 403: 'Tidak ada akses.', 409: 'Kode sudah terpakai.' };
        throw new Error(STATUS_MSG[res.status] || `Gagal simpan (HTTP ${res.status})`);
      }
      setModalOpen(false); fetchRows();
    } catch (e) { setFormError(e.message); }
    finally { setSaving(false); }
  };
  const remove = async (r) => {
    if (!window.confirm(`Nonaktifkan material ${r.code}?`)) return;
    await fetch(`/api/rahaza/materials/${r.id}`, { method: 'DELETE', headers });
    fetchRows();
  };

  const lowStockCount = rows.filter(r => r.is_low_stock || r.below_min).length;

  if (loading) return (<div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" /></div>);

  return (
    <div className="space-y-5" data-testid="rahaza-materials-page">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Master Material</h1>
          <p className="text-muted-foreground text-sm mt-1">Benang, aksesoris, dan barang jadi. Dipakai di Stock, Material Issue, dan WO.</p>
        </div>
        <Button onClick={openCreate} data-testid="mat-add-btn"><Plus className="w-4 h-4 mr-1.5" /> Material Baru</Button>
      </div>

      {/* Sprint 3.4: Low Stock Alert Banner */}
      {lowStockCount > 0 && (
        <div className="flex items-center gap-2 bg-amber-400/10 border border-amber-300/20 rounded-lg px-4 py-2.5" data-testid="mat-low-stock-banner">
          <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0" />
          <span className="text-sm text-amber-300 font-medium">{lowStockCount} material di bawah ambang minimum stok.</span>
          <button onClick={() => setFilterLowStock(true)} className="text-xs text-amber-300 underline ml-auto">Lihat semua</button>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <GlassInput value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari kode/nama..." className="pl-8 h-9 text-sm" data-testid="mat-search" />
        </div>
        <select value={filterType} onChange={e => setFilterType(e.target.value)} className="h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm text-foreground" data-testid="mat-filter-type">
          <option value="">Semua Type</option>
          <option value="yarn">Benang</option>
          <option value="accessory">Aksesoris</option>
          <option value="fg">Barang Jadi</option>
        </select>
        <button
          onClick={() => setFilterLowStock(!filterLowStock)}
          className={`h-9 px-3 rounded-lg border text-sm flex items-center gap-1.5 transition-colors ${filterLowStock ? 'bg-amber-400/15 border-amber-300/30 text-amber-300' : 'border-[var(--glass-border)] text-muted-foreground hover:text-foreground'}`}
          data-testid="mat-filter-low-stock">
          <AlertTriangle className="w-3.5 h-3.5" /> Low Stock {filterLowStock && `(aktif)`}
        </button>
      </div>

      <GlassCard className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--glass-bg)]">
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-4 py-3">Kode</th>
                <th className="px-4 py-3">Nama</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Unit</th>
                <th className="px-4 py-3">Min Stok</th>
                <th className="px-4 py-3">Warna/Jenis</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-muted-foreground">
                  {filterLowStock ? 'Tidak ada material low stock.' : 'Belum ada material. Klik "Material Baru" untuk menambah.'}
                </td></tr>
              ) : rows.map(r => {
                const meta = TYPE_META[r.type] || {};
                const Icon = meta.icon || Package;
                const isLow = r.is_low_stock || r.below_min;
                return (
                  <tr key={r.id} className={`border-t border-[var(--glass-border)] hover:bg-[var(--glass-bg-hover)] ${!r.active ? 'opacity-50' : ''} ${isLow ? 'bg-amber-400/4' : ''}`} data-testid={`mat-row-${r.code}`}>
                    <td className="px-4 py-3 font-mono text-xs text-foreground">
                      {r.code}
                      {isLow && <AlertTriangle className="w-3 h-3 text-amber-300 inline ml-1.5" title={r.low_stock_reason || 'Low Stock'} data-testid={`mat-low-badge-${r.code}`} />}
                    </td>
                    <td className="px-4 py-3 text-foreground">{r.name}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${meta.bg} ${meta.border} border ${meta.color}`}>
                        <Icon className="w-3 h-3" /> {meta.label || r.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{r.unit}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {r.min_stock_qty ? <span className="font-mono">{r.min_stock_qty} {r.unit}</span> : (r.min_stock ? r.min_stock : '—')}
                      {r.min_stock_percentage ? <span className="ml-1 text-[10px] text-primary/70">({r.min_stock_percentage}%)</span> : null}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{r.color || r.yarn_type || '—'}</td>
                    <td className="px-4 py-3">{r.active ? <span className="text-emerald-300 text-xs">Aktif</span> : <span className="text-muted-foreground text-xs">Non-aktif</span>}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--glass-bg-hover)] text-muted-foreground hover:text-foreground" title="Edit" data-testid={`mat-edit-${r.code}`}><Edit2 className="w-3.5 h-3.5" /></button>
                        {r.active && <button onClick={() => remove(r)} className="p-1.5 rounded hover:bg-red-400/10 text-muted-foreground hover:text-red-400" title="Nonaktifkan"><Trash2 className="w-3.5 h-3.5" /></button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        {pagination && pagination.total_pages > 1 && (
          <div className="px-4 py-3 border-t border-border">
            <PaginationBar pagination={pagination} onPageChange={setPage} />
          </div>
        )}
      </GlassCard>

      {modalOpen && (
        <Modal onClose={() => setModalOpen(false)} title={editing ? `Edit ${editing.code}` : 'Material Baru'} size="md">
          <div className="space-y-3" data-testid="mat-form">
            {formError && <div className="bg-red-400/10 border border-red-300/20 rounded-lg p-3 text-sm text-red-300">{formError}</div>}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-foreground/70 mb-1">Kode <span className="text-red-400">*</span></label>
                <GlassInput value={form.code} onChange={e => setForm({...form, code: e.target.value.toUpperCase()})} placeholder="YRN-ACR28" data-testid="mat-field-code" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground/70 mb-1">Type <span className="text-red-400">*</span></label>
                <select value={form.type} onChange={e => setForm({...form, type: e.target.value, unit: e.target.value === 'yarn' ? 'kg' : 'pcs'})} className="w-full h-10 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm text-foreground" data-testid="mat-field-type">
                  <option value="yarn">Benang</option>
                  <option value="accessory">Aksesoris</option>
                  <option value="fg">Barang Jadi</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground/70 mb-1">Nama <span className="text-red-400">*</span></label>
              <GlassInput value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Benang Acrylic 2/28" data-testid="mat-field-name" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-foreground/70 mb-1">Unit</label>
                <select value={form.unit} onChange={e => setForm({...form, unit: e.target.value})} className="w-full h-10 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm text-foreground">
                  {['kg','pcs','m','set','pair','gram'].map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground/70 mb-1">Min Stok (Legacy)</label>
                <GlassInput type="number" step="0.1" value={form.min_stock} onChange={e => setForm({...form, min_stock: e.target.value})} />
              </div>
            </div>

            {/* NEW: Pack/Packaging Fields */}
            <div className="border-t border-border pt-3 mt-3">
              <div className="flex items-center gap-2 mb-3">
                <input type="checkbox" id="display_in_packs_mat" checked={form.display_in_packs} 
                  onChange={e => setForm({...form, display_in_packs: e.target.checked})}
                  className="w-4 h-4" />
                <label htmlFor="display_in_packs_mat" className="text-sm text-foreground">Item ini dijual/disimpan per kemasan</label>
              </div>
              
              {form.display_in_packs && (
                <div className="grid grid-cols-2 gap-3 pl-6">
                  <div>
                    <label className="block text-xs font-medium text-foreground/70 mb-1">Satuan Kemasan</label>
                    <select value={form.pack_unit} onChange={e=>setForm({...form,pack_unit:e.target.value})} 
                      className="w-full h-10 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm text-foreground">
                      <option value="pack">Pack</option>
                      <option value="box">Box</option>
                      <option value="karton">Karton</option>
                      <option value="bundle">Bundle</option>
                      <option value="rol">Rol/Gulungan</option>
                      <option value="bal">Bal</option>
                      <option value="cone">Cone</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground/70 mb-1">Isi per {form.pack_unit}</label>
                    <GlassInput type="number" min="1" step="0.01" value={form.pack_size} 
                      onChange={e=>setForm({...form,pack_size:parseFloat(e.target.value)||1})}
                      placeholder="50" />
                  </div>
                  <div className="col-span-2">
                    <small className="text-xs text-muted-foreground">
                      1 {form.pack_unit} = {form.pack_size} {form.unit}
                    </small>
                  </div>
                </div>
              )}
            </div>

            {/* Sprint 3.4: Configurable Low Stock Threshold */}
            <div className="border border-amber-300/20 bg-amber-400/5 rounded-lg p-3 space-y-2">
              <p className="text-xs font-semibold text-amber-300 uppercase">Konfigurasi Ambang Low Stock</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-foreground/70 mb-1">Min Qty Tetap ({form.unit})</label>
                  <GlassInput type="number" step="0.01" min="0" value={form.min_stock_qty} onChange={e => setForm({...form, min_stock_qty: e.target.value})} placeholder="Cth: 50" data-testid="mat-field-min-qty" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground/70 mb-1">Min % dari Max Hist</label>
                  <GlassInput type="number" step="1" min="0" max="100" value={form.min_stock_percentage} onChange={e => setForm({...form, min_stock_percentage: e.target.value})} placeholder="Cth: 20" data-testid="mat-field-min-pct" />
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">Isi salah satu atau keduanya. Sistem akan memberi peringatan low stock jika stok di bawah threshold.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-foreground/70 mb-1">Jenis/Komposisi</label>
                <GlassInput value={form.yarn_type} onChange={e => setForm({...form, yarn_type: e.target.value})} placeholder="Acrylic 100%" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground/70 mb-1">Warna</label>
                <GlassInput value={form.color} onChange={e => setForm({...form, color: e.target.value})} placeholder="Navy" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground/70 mb-1">Catatan</label>
              <GlassInput value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} placeholder="Opsional" />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setModalOpen(false)} disabled={saving}>Batal</Button>
              <Button onClick={save} disabled={saving} data-testid="mat-save-btn">{saving ? 'Menyimpan...' : 'Simpan'}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
