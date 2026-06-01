import { useState, useEffect } from 'react';
import { GlassCard } from '@/components/ui/glass';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  FileText, Plus, Trash2, Pencil, Search, CheckCircle2,
  ExternalLink, X, BookOpen
} from 'lucide-react';
import { toast } from '../ui/sonner';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';

const API = process.env.REACT_APP_BACKEND_URL || '';

const STATUS_CONF = {
  draft:      { label: 'Draft',       cls: 'bg-amber-500/20 text-amber-500 border-amber-500/30' },
  approved:   { label: 'Disetujui',   cls: 'bg-emerald-500/20 text-emerald-500 border-emerald-500/30' },
  superseded: { label: 'Digantikan',  cls: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30' },
};

const emptyBOM = { material: '', spec: '', qty: 0, unit: 'meter', supplier: '' };
const emptyMeas = { point: '', S: '', M: '', L: '', XL: '', XXL: '' };

const emptyForm = {
  style_id: '', style_code: '', style_name: '',
  version: 'v1', title: '', description: '',
  doc_url: '', doc_type: 'pdf',
  bom_items: [{ ...emptyBOM }],
  construction_notes: '', stitch_type: '', seam_allowance_mm: 10,
  size_grading_notes: '', base_size: 'M', size_range: 'S-XL',
  measurements: [],
  status: 'draft',
};

export default function RnDTechPackModule({ token }) {
  const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const [techPacks, setTechPacks] = useState([]);
  const [styles,    setStyles]    = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [search,    setSearch]    = useState('');
  const [filterStyle, setFilterStyle] = useState('');
  const [showForm,  setShowForm]  = useState(false);
  const [editing,   setEditing]   = useState(null);
  const [form,      setForm]      = useState({ ...emptyForm });
  const [delId,     setDelId]     = useState(null);
  const [expanded,  setExpanded]  = useState(null);
  const [tab,       setTab]       = useState('info'); // info | bom | measurements

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const loadTechPacks = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (filterStyle) qs.set('style_id', filterStyle);
      if (search) qs.set('search', search);
      const res = await fetch(`${API}/api/dewi/rnd/tech-packs?${qs}`, { headers: h });
      setTechPacks(await res.json());
    } catch { toast.error('Gagal memuat tech pack'); }
    finally { setLoading(false); }
  };

  const loadStyles = async () => {
    try {
      const res = await fetch(`${API}/api/dewi/rnd/styles`, { headers: h });
      if (res.ok) setStyles(await res.json());
    } catch { /* ignore */ }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadTechPacks(); }, [filterStyle]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadStyles(); }, []);

  const setStyleField = sid => {
    const sel = styles.find(s => s.id === sid);
    setForm(p => ({ ...p, style_id: sid, style_code: sel?.style_code || '', style_name: sel?.style_name || '' }));
  };

  const setBOM = (i, k, v) => {
    const items = [...form.bom_items];
    items[i] = { ...items[i], [k]: k === 'qty' ? Number(v) : v };
    f('bom_items', items);
  };
  const addBOM = () => f('bom_items', [...form.bom_items, { ...emptyBOM }]);
  const removeBOM = i => f('bom_items', form.bom_items.filter((_, j) => j !== i));

  const setMeas = (i, k, v) => {
    const items = [...(form.measurements || [])];
    items[i] = { ...items[i], [k]: v };
    f('measurements', items);
  };
  const addMeas = () => f('measurements', [...(form.measurements || []), { ...emptyMeas }]);
  const removeMeas = i => f('measurements', form.measurements.filter((_, j) => j !== i));

  const openNew = () => {
    const sel = styles.find(s => s.id === filterStyle);
    setForm({ ...emptyForm, style_id: sel?.id || '', style_code: sel?.style_code || '', style_name: sel?.style_name || '' });
    setEditing(null); setTab('info'); setShowForm(true);
  };

  const openEdit = tp => {
    setForm({
      style_id: tp.style_id || '', style_code: tp.style_code || '', style_name: tp.style_name || '',
      version: tp.version || 'v1', title: tp.title || '', description: tp.description || '',
      doc_url: tp.doc_url || '', doc_type: tp.doc_type || 'pdf',
      bom_items: tp.bom_items?.length ? tp.bom_items : [{ ...emptyBOM }],
      construction_notes: tp.construction_notes || '',
      stitch_type: tp.stitch_type || '',
      seam_allowance_mm: tp.seam_allowance_mm ?? 10,
      size_grading_notes: tp.size_grading_notes || '',
      base_size: tp.base_size || 'M',
      size_range: tp.size_range || 'S-XL',
      measurements: tp.measurements || [],
      status: tp.status || 'draft',
    });
    setEditing(tp.id); setTab('info'); setShowForm(true);
  };

  const handleApprove = async id => {
    try {
      await fetch(`${API}/api/dewi/rnd/tech-packs/${id}/approve`, { method: 'POST', headers: h });
      toast.success('Tech pack disetujui');
      loadTechPacks();
    } catch { toast.error('Gagal approve'); }
  };

  const handleSave = async () => {
    if (!form.style_id) return toast.error('Pilih style terlebih dahulu');
    if (!form.version.trim()) return toast.error('Versi wajib diisi');
    try {
      const method = editing ? 'PUT' : 'POST';
      const url = editing
        ? `${API}/api/dewi/rnd/tech-packs/${editing}`
        : `${API}/api/dewi/rnd/tech-packs`;
      await fetch(url, { method, headers: h, body: JSON.stringify(form) });
      toast.success(editing ? 'Tech pack diperbarui' : 'Tech pack ditambahkan');
      setShowForm(false);
      loadTechPacks();
    } catch { toast.error('Gagal menyimpan tech pack'); }
  };

  const handleDelete = async () => {
    try {
      await fetch(`${API}/api/dewi/rnd/tech-packs/${delId}`, { method: 'DELETE', headers: h });
      toast.success('Tech pack dihapus');
      setDelId(null); loadTechPacks();
    } catch { toast.error('Gagal menghapus'); }
  };

  const filtered = techPacks.filter(tp => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (tp.title || '').toLowerCase().includes(q)
      || (tp.style_code || '').toLowerCase().includes(q)
      || (tp.version || '').toLowerCase().includes(q);
  });

  return (
    <div className="p-6 space-y-5" data-testid="rnd-techpack-module">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <FileText className="w-5 h-5 text-violet-500" /> Tech Pack
          </h1>
          <p className="text-sm text-foreground/50 mt-0.5">Dokumen teknis: BOM, konstruksi, size grading per style</p>
        </div>
        <Button onClick={openNew} className="gap-2" data-testid="techpack-add-btn">
          <Plus className="w-4 h-4" /> Buat Tech Pack
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/40" />
          <Input value={search} onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && loadTechPacks()}
            placeholder="Cari style / judul..." className="pl-9" />
        </div>
        <select value={filterStyle} onChange={e => setFilterStyle(e.target.value)}
          className="border border-input bg-background rounded-md px-3 py-2 text-sm text-foreground min-w-[200px]">
          <option value="">Semua Style</option>
          {styles.map(s => <option key={s.id} value={s.id}>{s.style_code} — {s.style_name}</option>)}
        </select>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center h-32 items-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-violet-500" />
        </div>
      ) : filtered.length === 0 ? (
        <GlassCard className="p-10 text-center">
          <FileText className="w-10 h-10 text-foreground/20 mx-auto mb-3" />
          <p className="text-foreground/50 text-sm">Belum ada tech pack.</p>
          <Button variant="outline" className="mt-3" onClick={openNew}>+ Buat Tech Pack Pertama</Button>
        </GlassCard>
      ) : (
        <div className="space-y-3">
          {filtered.map(tp => {
            const sc = STATUS_CONF[tp.status] || STATUS_CONF.draft;
            return (
              <GlassCard key={tp.id} className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-foreground">{tp.title || `Tech Pack ${tp.version}`}</span>
                      <span className="text-xs font-mono text-foreground/40">{tp.version}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${sc.cls}`}>{sc.label}</span>
                      {tp.is_latest && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-400 border border-violet-500/30">Latest</span>
                      )}
                    </div>
                    <div className="text-xs text-foreground/50 mt-1">
                      {tp.style_code} — {tp.style_name} · Base: {tp.base_size} · Range: {tp.size_range}
                    </div>
                    {tp.description && <p className="text-xs text-foreground/40 mt-1">{tp.description}</p>}
                  </div>
                  <div className="flex gap-1 ml-3 flex-shrink-0">
                    {tp.doc_url && (
                      <a href={tp.doc_url} target="_blank" rel="noreferrer"
                        className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-white/8 text-foreground/50 hover:text-foreground">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                    <Button variant="ghost" size="sm"
                      onClick={() => setExpanded(expanded === tp.id ? null : tp.id)}
                      className="h-8 px-2 text-xs text-foreground/50">
                      <BookOpen className="w-3.5 h-3.5 mr-1" /> {expanded === tp.id ? 'Tutup' : 'Detail'}
                    </Button>
                    {tp.status !== 'approved' && (
                      <Button variant="ghost" size="sm" onClick={() => handleApprove(tp.id)}
                        className="h-8 px-2 text-xs text-emerald-400 hover:bg-emerald-500/10"
                        data-testid={`techpack-approve-${tp.id}`}>
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Setujui
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => openEdit(tp)}
                      className="h-8 w-8 p-0"><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => setDelId(tp.id)}
                      className="h-8 w-8 p-0 text-red-500 hover:bg-red-500/10">
                      <Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                </div>

                {/* Expanded detail */}
                {expanded === tp.id && (
                  <div className="mt-4 pt-4 border-t border-white/10 space-y-4">
                    {tp.construction_notes && (
                      <div>
                        <div className="text-xs font-semibold text-foreground/40 uppercase tracking-wider mb-1">Konstruksi</div>
                        <p className="text-sm text-foreground/70">{tp.construction_notes}</p>
                        {tp.stitch_type && <p className="text-xs text-foreground/40 mt-1">Stitch: {tp.stitch_type} · Seam allowance: {tp.seam_allowance_mm}mm</p>}
                      </div>
                    )}
                    {tp.bom_items?.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-foreground/40 uppercase tracking-wider mb-2">Bill of Materials</div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead><tr className="border-b border-white/10">
                              {['Material', 'Spec', 'Qty', 'Satuan', 'Supplier'].map(c => (
                                <th key={c} className="text-left px-2 py-1.5 text-foreground/40 font-medium">{c}</th>
                              ))}
                            </tr></thead>
                            <tbody>
                              {tp.bom_items.map((b, i) => (
                                <tr key={i} className="border-b border-white/5">
                                  <td className="px-2 py-1.5 font-medium text-foreground">{b.material}</td>
                                  <td className="px-2 py-1.5 text-foreground/60">{b.spec}</td>
                                  <td className="px-2 py-1.5 text-foreground/70">{b.qty}</td>
                                  <td className="px-2 py-1.5 text-foreground/60">{b.unit}</td>
                                  <td className="px-2 py-1.5 text-foreground/50">{b.supplier || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                    {tp.measurements?.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-foreground/40 uppercase tracking-wider mb-2">Size Measurements (cm)</div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead><tr className="border-b border-white/10">
                              {['Measurement Point', 'S', 'M', 'L', 'XL', 'XXL'].map(c => (
                                <th key={c} className="text-left px-2 py-1.5 text-foreground/40 font-medium">{c}</th>
                              ))}
                            </tr></thead>
                            <tbody>
                              {tp.measurements.map((m, i) => (
                                <tr key={i} className="border-b border-white/5">
                                  <td className="px-2 py-1.5 font-medium text-foreground">{m.point}</td>
                                  {['S','M','L','XL','XXL'].map(sz => (
                                    <td key={sz} className="px-2 py-1.5 text-foreground/70">{m[sz] || '—'}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </GlassCard>
            );
          })}
        </div>
      )}

      {/* Form Modal */}
      <Modal open={showForm} onClose={() => setShowForm(false)}
        title={editing ? 'Edit Tech Pack' : 'Buat Tech Pack'} size="xl">
        {/* Sub-tabs */}
        <div className="flex gap-1 border-b border-white/10 mb-5">
          {[['info', 'Informasi'], ['bom', 'BOM'], ['measurements', 'Ukuran']].map(([id, lbl]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-4 pb-3 text-sm font-medium border-b-2 transition-all ${
                tab === id ? 'border-violet-500 text-violet-400' : 'border-transparent text-foreground/50 hover:text-foreground'
              }`}>{lbl}</button>
          ))}
        </div>

        {tab === 'info' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Style <span className="text-red-400">*</span></Label>
                <select value={form.style_id} onChange={e => setStyleField(e.target.value)}
                  className="w-full mt-1 border border-input bg-background rounded-md px-3 py-2 text-sm text-foreground">
                  <option value="">-- Pilih Style --</option>
                  {styles.map(s => <option key={s.id} value={s.id}>{s.style_code} — {s.style_name}</option>)}
                </select>
              </div>
              <div>
                <Label>Versi <span className="text-red-400">*</span></Label>
                <Input className="mt-1 font-mono" value={form.version}
                  onChange={e => f('version', e.target.value)} placeholder="v1" />
              </div>
            </div>
            <div>
              <Label>Judul Tech Pack</Label>
              <Input className="mt-1" value={form.title}
                onChange={e => f('title', e.target.value)} placeholder="Contoh: Basic Tee Premium TP v1" />
            </div>
            <div>
              <Label>Deskripsi</Label>
              <textarea value={form.description} onChange={e => f('description', e.target.value)}
                className="w-full mt-1 border border-input bg-background rounded-md px-3 py-2 text-sm text-foreground h-16 resize-none" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>URL Dokumen (PDF/Gambar)</Label>
                <Input className="mt-1" value={form.doc_url}
                  onChange={e => f('doc_url', e.target.value)} placeholder="https://..." />
              </div>
              <div>
                <Label>Tipe Dokumen</Label>
                <select value={form.doc_type} onChange={e => f('doc_type', e.target.value)}
                  className="w-full mt-1 border border-input bg-background rounded-md px-3 py-2 text-sm text-foreground">
                  <option value="pdf">PDF</option>
                  <option value="image">Gambar</option>
                  <option value="link">Link Eksternal</option>
                </select>
              </div>
            </div>
            <GlassCard className="p-4">
              <h3 className="text-sm font-semibold text-foreground mb-3">Konstruksi & Jahitan</h3>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Catatan Konstruksi</Label>
                  <textarea value={form.construction_notes} onChange={e => f('construction_notes', e.target.value)}
                    className="w-full mt-1 border border-input bg-background rounded-md px-3 py-2 text-sm text-foreground h-16 resize-none"
                    placeholder="Deskripsi konstruksi jahitan..." />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <Label className="text-xs">Tipe Stitch</Label>
                    <Input className="mt-1" value={form.stitch_type} onChange={e => f('stitch_type', e.target.value)} placeholder="Single needle lockstitch" />
                  </div>
                  <div>
                    <Label className="text-xs">Seam Allowance (mm)</Label>
                    <Input className="mt-1" type="number" value={form.seam_allowance_mm} onChange={e => f('seam_allowance_mm', Number(e.target.value))} />
                  </div>
                </div>
              </div>
            </GlassCard>
            <GlassCard className="p-4">
              <h3 className="text-sm font-semibold text-foreground mb-3">Size Grading</h3>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">Base Size</Label>
                  <Input className="mt-1" value={form.base_size} onChange={e => f('base_size', e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Size Range</Label>
                  <Input className="mt-1" value={form.size_range} onChange={e => f('size_range', e.target.value)} placeholder="S-XL" />
                </div>
                <div className="col-span-3">
                  <Label className="text-xs">Catatan Grading</Label>
                  <Input className="mt-1" value={form.size_grading_notes} onChange={e => f('size_grading_notes', e.target.value)} />
                </div>
              </div>
            </GlassCard>
          </div>
        )}

        {tab === 'bom' && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <Label>Bill of Materials</Label>
              <Button type="button" variant="outline" size="sm" onClick={addBOM} className="h-7 text-xs gap-1">
                <Plus className="w-3 h-3" /> Tambah Item
              </Button>
            </div>
            {form.bom_items.map((b, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_70px_80px_1fr_28px] gap-2 mb-2">
                <Input value={b.material} onChange={e => setBOM(i, 'material', e.target.value)} placeholder="Material" className="text-sm" />
                <Input value={b.spec} onChange={e => setBOM(i, 'spec', e.target.value)} placeholder="Spec" className="text-sm" />
                <Input type="number" value={b.qty} onChange={e => setBOM(i, 'qty', e.target.value)} placeholder="Qty" className="text-sm" />
                <Input value={b.unit} onChange={e => setBOM(i, 'unit', e.target.value)} placeholder="Satuan" className="text-sm" />
                <Input value={b.supplier} onChange={e => setBOM(i, 'supplier', e.target.value)} placeholder="Supplier" className="text-sm" />
                <Button variant="ghost" size="sm" onClick={() => removeBOM(i)}
                  className="h-9 w-7 p-0 text-red-500 hover:bg-red-500/10">
                  <X className="w-3.5 h-3.5" /></Button>
              </div>
            ))}
          </div>
        )}

        {tab === 'measurements' && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <Label>Size Measurements (dalam cm)</Label>
              <Button type="button" variant="outline" size="sm" onClick={addMeas} className="h-7 text-xs gap-1">
                <Plus className="w-3 h-3" /> Tambah Titik Ukur
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-white/5">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs text-foreground/50">Titik Ukur</th>
                    {['S','M','L','XL','XXL'].map(s => <th key={s} className="text-center px-2 py-2 text-xs text-foreground/50 w-16">{s}</th>)}
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {(form.measurements || []).map((m, i) => (
                    <tr key={i} className="border-t border-white/5">
                      <td className="px-3 py-1.5">
                        <Input value={m.point} onChange={e => setMeas(i, 'point', e.target.value)}
                          placeholder="Contoh: Chest" className="h-7 text-xs" />
                      </td>
                      {['S','M','L','XL','XXL'].map(sz => (
                        <td key={sz} className="px-2 py-1.5">
                          <Input value={m[sz] || ''} onChange={e => setMeas(i, sz, e.target.value)}
                            className="h-7 text-xs text-center" placeholder="0" />
                        </td>
                      ))}
                      <td className="py-1.5 px-1">
                        <Button variant="ghost" size="sm" onClick={() => removeMeas(i)}
                          className="h-7 w-7 p-0 text-red-500 hover:bg-red-500/10">
                          <X className="w-3 h-3" /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(form.measurements || []).length === 0 && (
              <div className="text-center py-8 text-foreground/40 text-sm">
                Belum ada titik ukur. Klik "Tambah Titik Ukur" untuk mulai.
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-3 mt-6">
          <Button variant="outline" onClick={() => setShowForm(false)}>Batal</Button>
          <Button onClick={handleSave} data-testid="techpack-save-btn">Simpan</Button>
        </div>
      </Modal>

      <ConfirmDialog open={!!delId} onClose={() => setDelId(null)}
        onConfirm={handleDelete} title="Hapus Tech Pack?"
        description="Tech pack ini akan dihapus permanen." />
    </div>
  );
}
