import { useState, useEffect, useRef } from 'react';
import { GlassCard } from '@/components/ui/glass';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Ruler, Plus, Trash2, Pencil, Search, CheckCircle2, Clock,
  Calculator, FileImage, ChevronDown, Upload, X as XIcon, Image as ImageIcon, Video as VideoIcon
} from 'lucide-react';
import { toast } from '../ui/sonner';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';

const API = process.env.REACT_APP_BACKEND_URL || '';

const STATUS_COLOR = {
  approved: 'bg-emerald-500/20 text-emerald-600 border-emerald-500/30',
  draft:    'bg-amber-500/20 text-amber-600 border-amber-500/30',
};

const emptyForm = {
  pattern_code: '', style_id: '', style_code: '', style_name: '',
  size_range: 'S-XL',
  total_pieces: 0,
  fabric_width: 150,
  fabric_usage_per_pcs: 0,
  hpp_fabric_per_pcs: 0,
  efficiency_pct: 0,
  marking_photo_url: '',
  marking_media: [],
  notes: '',
  status: 'draft',
};

export default function RnDPatternModule({ token }) {
  const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const [patterns, setPatterns] = useState([]);
  const [styles,   setStyles]   = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [search,   setSearch]   = useState('');
  const [filterStyle, setFilterStyle] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing,  setEditing]  = useState(null);
  const [form,     setForm]     = useState({ ...emptyForm });
  const [delId,    setDelId]    = useState(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const fileInputRef = useRef(null);

  const f = (name, val) => setForm(prev => ({ ...prev, [name]: val }));

  // Auto-calc HPP fabric
  useEffect(() => {
    // calculate usage × material price if pattern_code typed
  }, [form.fabric_usage_per_pcs]);

  const loadPatterns = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (filterStyle) qs.set('style_id', filterStyle);
      if (search) qs.set('search', search);
      const res = await fetch(`${API}/api/dewi/rnd/patterns?${qs}`, { headers: h });
      setPatterns(await res.json());
    } catch { toast.error('Gagal memuat pola'); }
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
  useEffect(() => { loadPatterns(); }, [filterStyle]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadStyles(); }, []);

  const openNew = () => {
    const sel = styles.find(s => s.id === filterStyle);
    setForm({
      ...emptyForm,
      pattern_code: `POL-${Date.now().toString(36).toUpperCase()}`,
      style_id: sel?.id || '',
      style_code: sel?.style_code || '',
      style_name: sel?.style_name || '',
    });
    setEditing(null);
    setShowForm(true);
  };

  const openEdit = (p) => {
    setForm({
      pattern_code: p.pattern_code || '',
      style_id: p.style_id || '',
      style_code: p.style_code || '',
      style_name: p.style_name || '',
      size_range: p.size_range || 'S-XL',
      total_pieces: p.total_pieces || 0,
      fabric_width: p.fabric_width || 150,
      fabric_usage_per_pcs: p.fabric_usage_per_pcs || 0,
      hpp_fabric_per_pcs: p.hpp_fabric_per_pcs || 0,
      efficiency_pct: p.efficiency_pct || 0,
      marking_photo_url: p.marking_photo_url || '',
      marking_media: p.marking_media || [],
      notes: p.notes || '',
      status: p.status || 'draft',
    });
    setEditing(p.id);
    setShowForm(true);
  };

  const setStyleField = (styleId) => {
    const sel = styles.find(s => s.id === styleId);
    setForm(prev => ({ ...prev, style_id: styleId, style_code: sel?.style_code || '', style_name: sel?.style_name || '' }));
  };

  const handleSave = async () => {
    if (!form.pattern_code) return toast.error('Isi kode pola');
    if (!form.style_id) return toast.error('Pilih style terlebih dahulu');
    try {
      const method = editing ? 'PUT' : 'POST';
      const url = editing
        ? `${API}/api/dewi/rnd/patterns/${editing}`
        : `${API}/api/dewi/rnd/patterns`;
      await fetch(url, { method, headers: h, body: JSON.stringify(form) });
      toast.success(editing ? 'Pola diperbarui' : 'Pola ditambahkan');
      setShowForm(false);
      loadPatterns();
    } catch { toast.error('Gagal menyimpan pola'); }
  };

  const handleApprove = async (id) => {
    try {
      await fetch(`${API}/api/dewi/rnd/patterns/${id}/approve`, { method: 'POST', headers: h });
      toast.success('Pola disetujui');
      loadPatterns();
    } catch { toast.error('Gagal approve'); }
  };

  const handleDelete = async () => {
    try {
      await fetch(`${API}/api/dewi/rnd/patterns/${delId}`, { method: 'DELETE', headers: h });
      toast.success('Pola dihapus');
      setDelId(null);
      loadPatterns();
    } catch { toast.error('Gagal menghapus'); }
  };

  // ── Session 27: Marking Media Upload ──────────────────────────────────────
  const handleUploadMedia = async (files) => {
    if (!editing) {
      toast.error('Simpan pola terlebih dahulu sebelum mengunggah media');
      return;
    }
    if (!files || files.length === 0) return;

    setUploadingMedia(true);
    let successCount = 0;
    const newMedia = [];
    try {
      for (const file of Array.from(files)) {
        // Validate file type and size
        const isImage = file.type.startsWith('image/');
        const isVideo = file.type.startsWith('video/');
        if (!isImage && !isVideo) {
          toast.error(`${file.name}: hanya foto/video yang diizinkan`);
          continue;
        }
        if (file.size > 10 * 1024 * 1024) {
          toast.error(`${file.name}: ukuran melebihi 10MB`);
          continue;
        }

        // Step 1: Upload file via /api/upload
        const fd = new FormData();
        fd.append('file', file);
        const uploadUrl = `${API}/api/upload?entity_type=rnd_pattern_media&entity_id=${editing}`;
        const upRes = await fetch(uploadUrl, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        if (!upRes.ok) {
          toast.error(`${file.name}: upload gagal`);
          continue;
        }
        const upData = await upRes.json();

        // Step 2: Attach metadata to pattern
        const attachRes = await fetch(`${API}/api/dewi/rnd/patterns/${editing}/attach-media`, {
          method: 'POST', headers: h,
          body: JSON.stringify({
            attachment_id: upData.id,
            storage_path: upData.storage_path,
            url: upData.storage_path ? `${API}/api/files/${upData.storage_path}` : '',
            content_type: upData.content_type,
            original_filename: upData.original_filename,
            size: upData.size,
          }),
        });
        if (!attachRes.ok) {
          toast.error(`${file.name}: gagal melampirkan ke pola`);
          continue;
        }
        const attachData = await attachRes.json();
        newMedia.push(attachData.media);
        successCount++;
      }
      if (successCount > 0) {
        toast.success(`${successCount} file berhasil diunggah`);
        setForm(prev => ({ ...prev, marking_media: [...(prev.marking_media || []), ...newMedia] }));
        loadPatterns();
      }
    } finally {
      setUploadingMedia(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveMedia = async (attachmentId) => {
    if (!editing) return;
    if (!window.confirm('Hapus media ini?')) return;
    try {
      const res = await fetch(`${API}/api/dewi/rnd/patterns/${editing}/media/${attachmentId}`, {
        method: 'DELETE', headers: h,
      });
      if (!res.ok) throw new Error();
      setForm(prev => ({
        ...prev,
        marking_media: (prev.marking_media || []).filter(m => m.attachment_id !== attachmentId),
      }));
      toast.success('Media dihapus');
      loadPatterns();
    } catch { toast.error('Gagal menghapus media'); }
  };

  const filtered = patterns.filter(p => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (p.pattern_code || '').toLowerCase().includes(q)
      || (p.style_code || '').toLowerCase().includes(q)
      || (p.style_name || '').toLowerCase().includes(q);
  });

  return (
    <div className="p-6" data-testid="rnd-pattern-module">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Ruler className="w-5 h-5 text-violet-500" /> Pola & Marking
          </h1>
          <p className="text-sm text-foreground/50 mt-0.5">Dokumentasi pola, marking, dan kalkulasi HPP bahan</p>
        </div>
        <Button onClick={openNew} className="gap-2" data-testid="rnd-pattern-add-btn">
          <Plus className="w-4 h-4" /> Tambah Pola
        </Button>
      </div>

      <div className="flex flex-wrap gap-3 mb-5">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/40" />
          <Input value={search} onChange={e => { setSearch(e.target.value); }}
            placeholder="Cari kode pola / style..." className="pl-9"
            onKeyDown={e => e.key === 'Enter' && loadPatterns()} />
        </div>
        <select value={filterStyle} onChange={e => setFilterStyle(e.target.value)}
          className="border border-input bg-background rounded-md px-3 py-2 text-sm text-foreground min-w-[200px]">
          <option value="">Semua Style</option>
          {styles.map(s => <option key={s.id} value={s.id}>{s.style_code} — {s.style_name}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center h-32 items-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-violet-500" />
        </div>
      ) : filtered.length === 0 ? (
        <GlassCard className="p-10 text-center">
          <Ruler className="w-10 h-10 text-foreground/20 mx-auto mb-3" />
          <p className="text-foreground/50 text-sm">Belum ada dokumentasi pola.</p>
          <Button variant="outline" className="mt-3" onClick={openNew}>+ Tambah Pola Pertama</Button>
        </GlassCard>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border border-white/10 rounded-xl overflow-hidden">
            <thead className="bg-white/5 border-b border-white/10">
              <tr>
                {['Kode Pola', 'Style', 'Ukuran', 'Penggunaan Kain', 'HPP Bahan/pcs', 'Efisiensi', 'Media', 'Status', 'Aksi'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-foreground/50 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id} className="border-b border-white/5 hover:bg-white/3">
                  <td className="px-4 py-3 font-mono text-xs text-foreground/80">{p.pattern_code}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{p.style_code}</div>
                    <div className="text-xs text-foreground/50">{p.style_name}</div>
                  </td>
                  <td className="px-4 py-3 text-foreground/70">{p.size_range || '—'}</td>
                  <td className="px-4 py-3 text-foreground">{p.fabric_usage_per_pcs ? `${p.fabric_usage_per_pcs}m` : '—'}</td>
                  <td className="px-4 py-3 text-foreground">
                    {p.hpp_fabric_per_pcs ? `Rp ${Number(p.hpp_fabric_per_pcs).toLocaleString('id-ID')}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-foreground">{p.efficiency_pct ? `${p.efficiency_pct}%` : '—'}</td>
                  <td className="px-4 py-3">
                    {(p.marking_media && p.marking_media.length > 0) ? (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-500 border border-violet-500/30" data-testid={`rnd-pattern-media-count-${p.id}`}>
                        <FileImage className="w-3 h-3" />
                        {p.marking_media.length}
                      </span>
                    ) : (
                      <span className="text-xs text-foreground/30">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_COLOR[p.status] || 'bg-zinc-500/20 text-zinc-500 border-zinc-500/30'}`}>
                      {p.status === 'approved' ? 'Disetujui' : 'Draft'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {p.status !== 'approved' && (
                        <Button variant="ghost" size="sm" onClick={() => handleApprove(p.id)}
                          className="h-7 px-2 text-xs text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => openEdit(p)}
                        className="h-7 w-7 p-0">
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setDelId(p.id)}
                        className="h-7 w-7 p-0 text-red-500 hover:text-red-400 hover:bg-red-500/10">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
      <Modal open={showForm} onClose={() => setShowForm(false)}
        title={editing ? 'Edit Pola' : 'Tambah Pola'} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Kode Pola <span className="text-red-400">*</span></Label>
              <Input className="mt-1" value={form.pattern_code}
                onChange={e => f('pattern_code', e.target.value)} placeholder="POL-xxx" />
            </div>
            <div>
              <Label>Style <span className="text-red-400">*</span></Label>
              <select value={form.style_id} onChange={e => setStyleField(e.target.value)}
                className="w-full mt-1 border border-input bg-background rounded-md px-3 py-2 text-sm text-foreground">
                <option value="">-- Pilih Style --</option>
                {styles.map(s => <option key={s.id} value={s.id}>{s.style_code} — {s.style_name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Range Ukuran</Label>
              <Input className="mt-1" value={form.size_range} onChange={e => f('size_range', e.target.value)} placeholder="S-XL" />
            </div>
            <div>
              <Label>Jumlah Pieces</Label>
              <Input className="mt-1" type="number" value={form.total_pieces} onChange={e => f('total_pieces', Number(e.target.value))} />
            </div>
            <div>
              <Label>Lebar Kain (cm)</Label>
              <Input className="mt-1" type="number" value={form.fabric_width} onChange={e => f('fabric_width', Number(e.target.value))} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Penggunaan Kain/pcs (m)</Label>
              <Input className="mt-1" type="number" step="0.01" value={form.fabric_usage_per_pcs}
                onChange={e => f('fabric_usage_per_pcs', Number(e.target.value))} />
            </div>
            <div>
              <Label>HPP Bahan/pcs (Rp)</Label>
              <Input className="mt-1" type="number" value={form.hpp_fabric_per_pcs}
                onChange={e => f('hpp_fabric_per_pcs', Number(e.target.value))} />
            </div>
            <div>
              <Label>Efisiensi (%)</Label>
              <Input className="mt-1" type="number" step="0.1" max="100" value={form.efficiency_pct}
                onChange={e => f('efficiency_pct', Number(e.target.value))} />
            </div>
          </div>
          <div>
            <Label>URL Foto Marking (opsional, manual link)</Label>
            <Input className="mt-1" value={form.marking_photo_url}
              onChange={e => f('marking_photo_url', e.target.value)}
              placeholder="https://..." />
          </div>

          {/* ── Session 27 GAP-R4: Marking Media Upload ─────────────── */}
          <div className="border-t border-white/10 pt-4">
            <div className="flex items-center justify-between mb-2">
              <Label className="flex items-center gap-2">
                <FileImage className="w-4 h-4 text-violet-500" />
                Dokumentasi Marking (Foto/Video)
                {form.marking_media && form.marking_media.length > 0 && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-500 border border-violet-500/30">
                    {form.marking_media.length}
                  </span>
                )}
              </Label>
              {editing && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    className="hidden"
                    onChange={e => handleUploadMedia(e.target.files)}
                    data-testid="rnd-pattern-media-input"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={uploadingMedia}
                    onClick={() => fileInputRef.current?.click()}
                    className="gap-2"
                    data-testid="rnd-pattern-media-upload-btn"
                  >
                    {uploadingMedia ? (
                      <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-current" />
                    ) : (
                      <Upload className="w-3.5 h-3.5" />
                    )}
                    {uploadingMedia ? 'Mengunggah...' : 'Unggah Foto/Video'}
                  </Button>
                </>
              )}
            </div>
            {!editing ? (
              <p className="text-xs text-foreground/50 italic">
                Simpan pola terlebih dahulu untuk dapat mengunggah dokumentasi marking.
              </p>
            ) : (form.marking_media && form.marking_media.length > 0) ? (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2" data-testid="rnd-pattern-media-grid">
                {form.marking_media.map((m, idx) => (
                  <div key={m.attachment_id || idx}
                    className="relative group aspect-square rounded-lg border border-white/10 overflow-hidden bg-white/5">
                    {m.kind === 'video' ? (
                      <div className="flex flex-col items-center justify-center w-full h-full text-foreground/60">
                        <VideoIcon className="w-6 h-6 mb-1" />
                        <span className="text-[10px] truncate w-full text-center px-1">{m.original_filename || 'video'}</span>
                      </div>
                    ) : m.url ? (
                      <img
                        src={`${m.url}${m.url.includes('?') ? '&' : '?'}auth=${encodeURIComponent(token)}`}
                        alt={m.original_filename || 'marking'}
                        className="w-full h-full object-cover"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center w-full h-full text-foreground/60">
                        <ImageIcon className="w-6 h-6 mb-1" />
                        <span className="text-[10px] truncate w-full text-center px-1">{m.original_filename || 'foto'}</span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRemoveMedia(m.attachment_id)}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500/80 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                      title="Hapus"
                      data-testid={`rnd-pattern-media-remove-${idx}`}
                    >
                      <XIcon className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 rounded-lg border border-dashed border-white/15 bg-white/3">
                <FileImage className="w-7 h-7 mx-auto text-foreground/20 mb-2" />
                <p className="text-xs text-foreground/50">Belum ada dokumentasi marking. Klik tombol "Unggah Foto/Video" di atas.</p>
              </div>
            )}
          </div>

          <div>
            <Label>Catatan</Label>
            <textarea value={form.notes} onChange={e => f('notes', e.target.value)}
              className="w-full mt-1 border border-input bg-background rounded-md px-3 py-2 text-sm text-foreground h-20 resize-none"
              placeholder="Catatan tambahan pola..." />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <Button variant="outline" onClick={() => setShowForm(false)}>Batal</Button>
          <Button onClick={handleSave} data-testid="rnd-pattern-save-btn">Simpan</Button>
        </div>
      </Modal>
      )}

      {!!delId && (
      <ConfirmDialog
        title="Hapus Pola?"
        message="Data pola akan dihapus permanen."
        onConfirm={handleDelete}
        onCancel={() => setDelId(null)}
      />
      )}
    </div>
  );
}
