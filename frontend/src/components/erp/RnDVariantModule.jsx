import { useState, useEffect } from 'react';
import { GlassCard } from '@/components/ui/glass';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Layers, Plus, Trash2, Pencil, Search, X, ChevronDown, Palette
} from 'lucide-react';
import { toast } from '../ui/sonner';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';

const API = process.env.REACT_APP_BACKEND_URL || '';

const STATUS_OPTS = [
  { value: 'active',   label: 'Aktif' },
  { value: 'draft',    label: 'Draft' },
  { value: 'archived', label: 'Arsip' },
];

const DEFAULT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL'];

const STATUS_COLOR = {
  active:   'bg-emerald-500/20 text-emerald-600 border-emerald-500/30',
  draft:    'bg-amber-500/20 text-amber-600 border-amber-500/30',
  archived: 'bg-zinc-500/20 text-zinc-500 border-zinc-500/30',
};

const emptyForm = {
  style_id: '', style_code: '', style_name: '',
  color: '', color_code: '#ffffff',
  sizes: DEFAULT_SIZES.map(s => ({ size: s, sku: '', qty_plan: 0 })),
  status: 'active', notes: '',
};

export default function RnDVariantModule({ token }) {
  const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const [variants, setVariants] = useState([]);
  const [styles, setStyles]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [search,  setSearch]  = useState('');
  const [filterStyle, setFilterStyle] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing,  setEditing]  = useState(null);
  const [form,     setForm]     = useState({ ...emptyForm });
  const [delId,    setDelId]    = useState(null);

  const loadVariants = async () => {
    setLoading(true);
    try {
      const url = filterStyle
        ? `${API}/api/dewi/rnd/variants?style_id=${filterStyle}`
        : `${API}/api/dewi/rnd/variants`;
      const res = await fetch(url, { headers: h });
      setVariants(await res.json());
    } catch { toast.error('Gagal memuat varian'); }
    finally { setLoading(false); }
  };

  const loadStyles = async () => {
    try {
      const res = await fetch(`${API}/api/dewi/rnd/styles`, { headers: h });
      const data = await res.json();
      setStyles(Array.isArray(data) ? data : (data.items || []));
    } catch { /* ignore */ }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadVariants(); }, [filterStyle]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadStyles(); }, []);

  const openNew = () => {
    const sel = styles.find(s => s.id === filterStyle);
    setForm({
      ...emptyForm,
      style_id: sel?.id || '',
      style_code: sel?.style_code || '',
      style_name: sel?.style_name || '',
    });
    setEditing(null);
    setShowForm(true);
  };

  const openEdit = (v) => {
    setForm({
      style_id: v.style_id || '',
      style_code: v.style_code || '',
      style_name: v.style_name || '',
      color: v.color || '',
      color_code: v.color_code || '#ffffff',
      sizes: v.sizes?.length ? v.sizes : DEFAULT_SIZES.map(s => ({ size: s, sku: '', qty_plan: 0 })),
      status: v.status || 'active',
      notes: v.notes || '',
    });
    setEditing(v.id);
    setShowForm(true);
  };

  const setStyleField = (styleId) => {
    const sel = styles.find(s => s.id === styleId);
    setForm(f => ({ ...f, style_id: styleId, style_code: sel?.style_code || '', style_name: sel?.style_name || '' }));
  };

  const setSizeField = (idx, field, val) => {
    const sizes = [...form.sizes];
    sizes[idx] = { ...sizes[idx], [field]: field === 'qty_plan' ? Number(val) : val };
    setForm(f => ({ ...f, sizes }));
  };

  const autoGenSKU = () => {
    const code = form.style_code || 'STY';
    const col  = (form.color || 'CLR').replace(/\s+/g, '').substring(0, 3).toUpperCase();
    const sizes = form.sizes.map(s => ({
      ...s,
      sku: s.sku || `${code}-${s.size}-${col}`,
    }));
    setForm(f => ({ ...f, sizes }));
    toast.success('SKU di-generate otomatis');
  };

  const handleSave = async () => {
    if (!form.style_id) return toast.error('Pilih style terlebih dahulu');
    if (!form.color)     return toast.error('Isi nama warna');
    try {
      const method = editing ? 'PUT' : 'POST';
      const url = editing
        ? `${API}/api/dewi/rnd/variants/${editing}`
        : `${API}/api/dewi/rnd/variants`;
      await fetch(url, { method, headers: h, body: JSON.stringify(form) });
      toast.success(editing ? 'Varian diperbarui' : 'Varian ditambahkan');
      setShowForm(false);
      loadVariants();
    } catch { toast.error('Gagal menyimpan varian'); }
  };

  const handleDelete = async () => {
    try {
      await fetch(`${API}/api/dewi/rnd/variants/${delId}`, { method: 'DELETE', headers: h });
      toast.success('Varian dihapus');
      setDelId(null);
      loadVariants();
    } catch { toast.error('Gagal menghapus'); }
  };

  const filtered = variants.filter(v => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (v.color || '').toLowerCase().includes(q)
      || (v.style_code || '').toLowerCase().includes(q)
      || (v.style_name || '').toLowerCase().includes(q);
  });

  return (
    <div className="p-6" data-testid="rnd-variant-module">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Layers className="w-5 h-5 text-violet-500" /> Varian Produk
          </h1>
          <p className="text-sm text-foreground/50 mt-0.5">Manajemen warna & ukuran per style produk</p>
        </div>
        <Button onClick={openNew} className="gap-2" data-testid="rnd-variant-add-btn">
          <Plus className="w-4 h-4" /> Tambah Varian
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/40" />
          <Input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Cari warna / style..." className="pl-9" />
        </div>
        <select value={filterStyle} onChange={e => setFilterStyle(e.target.value)}
          className="border border-input bg-background rounded-md px-3 py-2 text-sm text-foreground min-w-[200px]">
          <option value="">Semua Style</option>
          {styles.map(s => <option key={s.id} value={s.id}>{s.style_code} — {s.style_name}</option>)}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center h-32 items-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-violet-500" />
        </div>
      ) : filtered.length === 0 ? (
        <GlassCard className="p-10 text-center">
          <Layers className="w-10 h-10 text-foreground/20 mx-auto mb-3" />
          <p className="text-foreground/50 text-sm">Belum ada varian produk.</p>
          <Button variant="outline" className="mt-3" onClick={openNew}>+ Tambah Varian Pertama</Button>
        </GlassCard>
      ) : (
        <div className="space-y-4">
          {filtered.map(v => (
            <GlassCard key={v.id} className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg border border-white/20 shadow-sm flex-shrink-0"
                    style={{ backgroundColor: v.color_code || '#888' }} />
                  <div>
                    <div className="font-semibold text-foreground">{v.color}</div>
                    <div className="text-xs text-foreground/50">{v.style_code} — {v.style_name}</div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_COLOR[v.status] || ''}`}>
                    {STATUS_OPTS.find(s => s.value === v.status)?.label || v.status}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(v)}
                    className="h-8 w-8 p-0" data-testid={`rnd-variant-edit-${v.id}`}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setDelId(v.id)}
                    className="h-8 w-8 p-0 text-red-500 hover:text-red-500 hover:bg-red-500/10"
                    data-testid={`rnd-variant-del-${v.id}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
              {v.sizes?.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {v.sizes.filter(s => s.qty_plan > 0 || s.sku).map((s, i) => (
                    <div key={i} className="text-xs bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5">
                      <span className="font-bold text-foreground">{s.size}</span>
                      {s.qty_plan > 0 && <span className="text-foreground/50 ml-1">× {s.qty_plan} pcs</span>}
                      {s.sku && <div className="text-foreground/30 font-mono mt-0.5">{s.sku}</div>}
                    </div>
                  ))}
                </div>
              )}
              {v.notes && <p className="text-xs text-foreground/40 mt-2">{v.notes}</p>}
            </GlassCard>
          ))}
        </div>
      )}

      {/* Form Modal */}
      <Modal open={showForm} onClose={() => setShowForm(false)}
        title={editing ? 'Edit Varian' : 'Tambah Varian'} size="lg">
        <div className="space-y-4">
          <div>
            <Label>Style Produk <span className="text-red-400">*</span></Label>
            <select value={form.style_id} onChange={e => setStyleField(e.target.value)}
              className="w-full mt-1 border border-input bg-background rounded-md px-3 py-2 text-sm text-foreground">
              <option value="">-- Pilih Style --</option>
              {styles.map(s => <option key={s.id} value={s.id}>{s.style_code} — {s.style_name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Nama Warna <span className="text-red-400">*</span></Label>
              <Input className="mt-1" value={form.color}
                onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                placeholder="Contoh: Navy Blue" />
            </div>
            <div>
              <Label>Kode Warna</Label>
              <div className="flex gap-2 mt-1">
                <input type="color" value={form.color_code}
                  onChange={e => setForm(f => ({ ...f, color_code: e.target.value }))}
                  className="w-10 h-9 rounded border border-input cursor-pointer bg-background" />
                <Input value={form.color_code}
                  onChange={e => setForm(f => ({ ...f, color_code: e.target.value }))}
                  placeholder="#ffffff" className="font-mono" />
              </div>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Ukuran & SKU</Label>
              <Button type="button" variant="outline" size="sm" onClick={autoGenSKU} className="text-xs h-7">
                Auto-generate SKU
              </Button>
            </div>
            <div className="overflow-x-auto rounded-lg border border-white/10">
              <table className="w-full text-sm">
                <thead className="bg-white/5">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs text-foreground/50 w-16">Ukuran</th>
                    <th className="text-left px-3 py-2 text-xs text-foreground/50">SKU</th>
                    <th className="text-right px-3 py-2 text-xs text-foreground/50 w-28">Qty Plan</th>
                  </tr>
                </thead>
                <tbody>
                  {form.sizes.map((s, i) => (
                    <tr key={i} className="border-t border-white/5">
                      <td className="px-3 py-1.5 font-bold text-foreground">{s.size}</td>
                      <td className="px-3 py-1.5">
                        <Input value={s.sku} onChange={e => setSizeField(i, 'sku', e.target.value)}
                          placeholder={`SKU-${s.size}`} className="h-7 text-xs font-mono" />
                      </td>
                      <td className="px-3 py-1.5">
                        <Input type="number" min="0" value={s.qty_plan}
                          onChange={e => setSizeField(i, 'qty_plan', e.target.value)}
                          className="h-7 text-xs text-right" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Status</Label>
              <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                className="w-full mt-1 border border-input bg-background rounded-md px-3 py-2 text-sm text-foreground">
                {STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <Label>Catatan</Label>
              <Input className="mt-1" value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <Button variant="outline" onClick={() => setShowForm(false)}>Batal</Button>
          <Button onClick={handleSave} data-testid="rnd-variant-save-btn">Simpan</Button>
        </div>
      </Modal>

      <ConfirmDialog open={!!delId} onClose={() => setDelId(null)}
        onConfirm={handleDelete} title="Hapus Varian?"
        description="Data varian akan dihapus permanen." />
    </div>
  );
}
