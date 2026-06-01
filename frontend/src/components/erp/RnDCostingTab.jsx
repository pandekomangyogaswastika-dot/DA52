import { useState, useEffect } from 'react';
import { GlassCard } from '@/components/ui/glass';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calculator, Plus, Trash2, Pencil, X } from 'lucide-react';
import { toast } from '../ui/sonner';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';

const API = process.env.REACT_APP_BACKEND_URL || '';
const fmt = n => n != null ? `Rp ${Number(n).toLocaleString('id-ID')}` : '—';

const emptyAcc = { name: '', qty: 0, unit: 'meter', unit_cost: 0 };

const emptyForm = {
  sample_code: '', style_id: '', style_name: '',
  fabric_items: [{ name: 'Main Fabric', qty: 1, unit: 'meter', unit_cost: 0 }],
  trim_items: [],
  labor_cost: 0,
  overhead_cost: 0,
  notes: '',
};

export default function RnDCostingTab({ token }) {
  const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const [costings, setCostings] = useState([]);
  const [styles,   setStyles]   = useState([]);
  const [samples,  setSamples]  = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing,  setEditing]  = useState(null);
  const [form,     setForm]     = useState({ ...emptyForm });
  const [delId,    setDelId]    = useState(null);
  const [expanded, setExpanded] = useState(null);

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const fetchCostings = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/dewi/rnd/sample-costing`, { headers: h });
      if (res.ok) setCostings(await res.json());
    } catch { toast.error('Gagal memuat costing'); }
    finally { setLoading(false); }
  };

  const fetchStyles = async () => {
    try {
      const res = await fetch(`${API}/api/dewi/rnd/styles`, { headers: h });
      if (res.ok) setStyles(await res.json());
    } catch { /* ignore */ }
  };

  const fetchSamples = async () => {
    try {
      const res = await fetch(`${API}/api/dewi/rnd/sample-requests`, { headers: h });
      if (res.ok) setSamples(await res.json());
    } catch { /* ignore */ }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchCostings(); fetchStyles(); fetchSamples(); }, []);

  const setFabric = (i, k, v) => {
    const items = [...form.fabric_items];
    items[i] = { ...items[i], [k]: ['qty', 'unit_cost'].includes(k) ? Number(v) : v };
    f('fabric_items', items);
  };
  const addFabric = () => f('fabric_items', [...form.fabric_items, { ...emptyAcc }]);
  const removeFabric = i => f('fabric_items', form.fabric_items.filter((_, j) => j !== i));

  const setTrim = (i, k, v) => {
    const items = [...form.trim_items];
    items[i] = { ...items[i], [k]: ['qty', 'unit_cost'].includes(k) ? Number(v) : v };
    f('trim_items', items);
  };
  const addTrim = () => f('trim_items', [...(form.trim_items || []), { ...emptyAcc, name: 'Label', unit: 'pcs' }]);
  const removeTrim = i => f('trim_items', form.trim_items.filter((_, j) => j !== i));

  const calcMaterialCost = () => {
    const fab = (form.fabric_items || []).reduce((s, r) => s + (r.qty || 0) * (r.unit_cost || 0), 0);
    const tri = (form.trim_items || []).reduce((s, r) => s + (r.qty || 0) * (r.unit_cost || 0), 0);
    return fab + tri;
  };

  const setStyleField = sid => {
    const sel = styles.find(s => s.id === sid);
    setForm(p => ({ ...p, style_id: sid, style_name: sel?.style_name || '' }));
  };

  const setSampleField = sc => {
    const sel = samples.find(s => s.sample_code === sc);
    if (sel) setForm(p => ({ ...p, sample_code: sc, style_id: sel.style_id || p.style_id, style_name: sel.style_name || p.style_name }));
    else f('sample_code', sc);
  };

  const openEdit = rec => {
    setForm({
      sample_code: rec.sample_code || '',
      style_id: rec.style_id || '',
      style_name: rec.style_name || '',
      fabric_items: rec.fabric_items?.length ? rec.fabric_items : [{ ...emptyAcc }],
      trim_items: rec.trim_items || [],
      labor_cost: rec.labor_cost || 0,
      overhead_cost: rec.overhead_cost || 0,
      notes: rec.notes || '',
    });
    setEditing(rec.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    const matCost = calcMaterialCost();
    const total = matCost + Number(form.labor_cost) + Number(form.overhead_cost);
    const payload = { ...form, total_material_cost: matCost, total_cost: total };
    try {
      const method = editing ? 'PUT' : 'POST';
      const url = editing
        ? `${API}/api/dewi/rnd/sample-costing/${editing}`
        : `${API}/api/dewi/rnd/sample-costing`;
      await fetch(url, { method, headers: h, body: JSON.stringify(payload) });
      toast.success(editing ? 'Costing diperbarui' : 'Costing ditambahkan');
      setShowForm(false);
      setEditing(null);
      setForm({ ...emptyForm });
      fetchCostings();
    } catch { toast.error('Gagal menyimpan costing'); }
  };

  const handleDelete = async () => {
    try {
      await fetch(`${API}/api/dewi/rnd/sample-costing/${delId}`, { method: 'DELETE', headers: h });
      toast.success('Costing dihapus');
      setDelId(null);
      fetchCostings();
    } catch { toast.error('Gagal menghapus'); }
  };

  return (
    <div className="p-6 space-y-5" data-testid="rnd-costing-tab">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Calculator className="w-5 h-5 text-violet-500" /> Sample Costing
          </h1>
          <p className="text-sm text-foreground/50 mt-0.5">Rincian biaya per sample produk</p>
        </div>
        <Button onClick={() => { setEditing(null); setForm({ ...emptyForm }); setShowForm(true); }}
          className="gap-2" data-testid="create-costing-btn">
          <Plus className="w-4 h-4" /> Tambah Costing
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center h-32 items-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-violet-500" />
        </div>
      ) : costings.length === 0 ? (
        <GlassCard className="p-10 text-center">
          <Calculator className="w-10 h-10 text-foreground/20 mx-auto mb-3" />
          <p className="text-foreground/50 text-sm">Belum ada data costing.</p>
          <Button variant="outline" className="mt-3" onClick={() => setShowForm(true)}>+ Tambah Costing Pertama</Button>
        </GlassCard>
      ) : (
        <div className="space-y-3">
          {costings.map(c => (
            <GlassCard key={c.id} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm font-semibold text-foreground">{c.sample_code || '—'}</span>
                    {c.style_name && <span className="text-xs text-foreground/50">{c.style_name}</span>}
                  </div>
                  <div className="flex gap-6 mt-2 text-sm">
                    <span className="text-foreground/60">Material: <strong className="text-foreground">{fmt(c.total_material_cost)}</strong></span>
                    <span className="text-foreground/60">Tenaga: <strong className="text-foreground">{fmt(c.labor_cost)}</strong></span>
                    <span className="text-foreground/60">Overhead: <strong className="text-foreground">{fmt(c.overhead_cost)}</strong></span>
                    <span className="text-violet-400">Total: <strong>{fmt(c.total_cost)}</strong></span>
                  </div>
                </div>
                <div className="flex gap-1 ml-4">
                  <Button variant="ghost" size="sm" onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                    className="h-7 px-2 text-xs text-foreground/50">
                    {expanded === c.id ? 'Tutup' : 'Rincian'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(c)}
                    className="h-7 w-7 p-0"><Pencil className="w-3.5 h-3.5" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => setDelId(c.id)}
                    className="h-7 w-7 p-0 text-red-500 hover:bg-red-500/10">
                    <Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              </div>
              {expanded === c.id && (
                <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
                  {c.fabric_items?.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-foreground/50 uppercase tracking-wider mb-2">Bahan Kain</div>
                      {c.fabric_items.map((it, i) => (
                        <div key={i} className="flex justify-between text-xs text-foreground/70 py-1">
                          <span>{it.name}</span>
                          <span>{it.qty} {it.unit} × {fmt(it.unit_cost)} = <strong>{fmt(it.qty * it.unit_cost)}</strong></span>
                        </div>
                      ))}
                    </div>
                  )}
                  {c.trim_items?.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-foreground/50 uppercase tracking-wider mb-2">Aksesoris / Trim</div>
                      {c.trim_items.map((it, i) => (
                        <div key={i} className="flex justify-between text-xs text-foreground/70 py-1">
                          <span>{it.name}</span>
                          <span>{it.qty} {it.unit} × {fmt(it.unit_cost)} = <strong>{fmt(it.qty * it.unit_cost)}</strong></span>
                        </div>
                      ))}
                    </div>
                  )}
                  {c.notes && <p className="text-xs text-foreground/40 italic">{c.notes}</p>}
                </div>
              )}
            </GlassCard>
          ))}
        </div>
      )}

      {/* Form Modal */}
      <Modal open={showForm} onClose={() => setShowForm(false)}
        title={editing ? 'Edit Sample Costing' : 'Tambah Sample Costing'} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Kode Sample</Label>
              <select value={form.sample_code}
                onChange={e => setSampleField(e.target.value)}
                className="w-full mt-1 border border-input bg-background rounded-md px-3 py-2 text-sm text-foreground">
                <option value="">-- Pilih / Ketik Kode Sample --</option>
                {samples.map(s => <option key={s.id} value={s.sample_code}>{s.sample_code} — {s.style_name}</option>)}
              </select>
            </div>
            <div>
              <Label>Style</Label>
              <select value={form.style_id} onChange={e => setStyleField(e.target.value)}
                className="w-full mt-1 border border-input bg-background rounded-md px-3 py-2 text-sm text-foreground">
                <option value="">-- Pilih Style --</option>
                {styles.map(s => <option key={s.id} value={s.id}>{s.style_code} — {s.style_name}</option>)}
              </select>
            </div>
          </div>

          {/* Fabric items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Bahan Kain</Label>
              <Button type="button" variant="outline" size="sm" onClick={addFabric} className="h-7 text-xs gap-1">
                <Plus className="w-3 h-3" /> Tambah Bahan
              </Button>
            </div>
            {form.fabric_items.map((it, i) => (
              <div key={i} className="grid grid-cols-[1fr_80px_80px_90px_28px] gap-2 mb-2">
                <Input value={it.name} onChange={e => setFabric(i, 'name', e.target.value)} placeholder="Nama bahan" className="text-sm" />
                <Input type="number" value={it.qty} onChange={e => setFabric(i, 'qty', e.target.value)} placeholder="Qty" className="text-sm" />
                <Input value={it.unit} onChange={e => setFabric(i, 'unit', e.target.value)} placeholder="Satuan" className="text-sm" />
                <Input type="number" value={it.unit_cost} onChange={e => setFabric(i, 'unit_cost', e.target.value)} placeholder="Harga" className="text-sm" />
                <Button variant="ghost" size="sm" onClick={() => removeFabric(i)}
                  className="h-9 w-7 p-0 text-red-500 hover:bg-red-500/10">
                  <X className="w-3.5 h-3.5" /></Button>
              </div>
            ))}
          </div>

          {/* Trim items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Aksesoris / Trim</Label>
              <Button type="button" variant="outline" size="sm" onClick={addTrim} className="h-7 text-xs gap-1">
                <Plus className="w-3 h-3" /> Tambah Aksesoris
              </Button>
            </div>
            {(form.trim_items || []).map((it, i) => (
              <div key={i} className="grid grid-cols-[1fr_80px_80px_90px_28px] gap-2 mb-2">
                <Input value={it.name} onChange={e => setTrim(i, 'name', e.target.value)} placeholder="Nama" className="text-sm" />
                <Input type="number" value={it.qty} onChange={e => setTrim(i, 'qty', e.target.value)} placeholder="Qty" className="text-sm" />
                <Input value={it.unit} onChange={e => setTrim(i, 'unit', e.target.value)} placeholder="Satuan" className="text-sm" />
                <Input type="number" value={it.unit_cost} onChange={e => setTrim(i, 'unit_cost', e.target.value)} placeholder="Harga" className="text-sm" />
                <Button variant="ghost" size="sm" onClick={() => removeTrim(i)}
                  className="h-9 w-7 p-0 text-red-500 hover:bg-red-500/10">
                  <X className="w-3.5 h-3.5" /></Button>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Ongkos Jahit (Rp)</Label>
              <Input className="mt-1" type="number" value={form.labor_cost}
                onChange={e => f('labor_cost', Number(e.target.value))} />
            </div>
            <div>
              <Label>Overhead (Rp)</Label>
              <Input className="mt-1" type="number" value={form.overhead_cost}
                onChange={e => f('overhead_cost', Number(e.target.value))} />
            </div>
          </div>

          {/* Live total preview */}
          <div className="bg-violet-500/8 border border-violet-500/20 rounded-lg p-3 flex items-center justify-between">
            <span className="text-sm text-foreground/70">Total Estimasi</span>
            <span className="text-lg font-bold text-violet-400">
              {fmt(calcMaterialCost() + Number(form.labor_cost) + Number(form.overhead_cost))}
            </span>
          </div>

          <div>
            <Label>Catatan</Label>
            <textarea value={form.notes} onChange={e => f('notes', e.target.value)}
              className="w-full mt-1 border border-input bg-background rounded-md px-3 py-2 text-sm text-foreground h-16 resize-none" />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <Button variant="outline" onClick={() => setShowForm(false)}>Batal</Button>
          <Button onClick={handleSave} data-testid="save-costing-btn">Simpan</Button>
        </div>
      </Modal>

      <ConfirmDialog open={!!delId} onClose={() => setDelId(null)}
        onConfirm={handleDelete} title="Hapus Costing?"
        description="Data costing akan dihapus permanen." />
    </div>
  );
}
