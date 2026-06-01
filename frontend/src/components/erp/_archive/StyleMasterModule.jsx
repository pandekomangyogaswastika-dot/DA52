import { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, Pencil, Trash2, Search, Image as ImageIcon, FileText, X, Upload, Tag, Eye, Download } from 'lucide-react';
import { toast } from '../ui/sonner';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';

const API = process.env.REACT_APP_BACKEND_URL || '';

const STATUS_COLOR = {
  active:    'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border-emerald-500/30',
  draft:     'bg-amber-500/20 text-amber-600 dark:text-amber-300 border-amber-500/30',
  archived:  'bg-zinc-500/20 text-zinc-600 dark:text-zinc-300 border-zinc-500/30',
};

const emptyForm = {
  style_code: '', style_name: '', category: '', buyer: '',
  fabric_type: '', season: '', description: '', status: 'active',
};

export default function StyleMasterModule({ token, userRole = '', hasPerm = () => false }) {
  const canEdit = ['superadmin', 'admin', 'manager'].includes(userRole) || hasPerm('styles.edit');

  const [styles, setStyles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterBuyer, setFilterBuyer] = useState('');
  const [selected, setSelected] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);

  const imgInputRef = useRef(null);
  const tpInputRef = useRef(null);

  const headers = { Authorization: `Bearer ${token}` };
  const jsonHeaders = { ...headers, 'Content-Type': 'application/json' };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (filterCategory) params.set('category', filterCategory);
      if (filterBuyer) params.set('buyer', filterBuyer);
      const res = await fetch(`${API}/api/rahaza/styles?${params.toString()}`, { headers });
      const data = await res.ok ? await res.json() : [];
      setStyles(Array.isArray(data) ? data : []);
      // Refresh selected with latest from server
      if (selected) {
        const fresh = (Array.isArray(data) ? data : []).find(s => s.id === selected.id);
        if (fresh) setSelected(fresh);
      }
    } catch (e) {
      toast.error('Gagal memuat data style');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filterCategory, filterBuyer, token]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const refreshSelected = async (id) => {
    try {
      const res = await fetch(`${API}/api/rahaza/styles/${id}`, { headers });
      if (res.ok) {
        const fresh = await res.json();
        setSelected(fresh);
        setStyles((prev) => prev.map(s => s.id === id ? fresh : s));
      }
    } catch (_) { /* noop */ }
  };

  // ── CRUD ────────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEdit = (s) => {
    setEditing(s);
    setForm({
      style_code: s.style_code, style_name: s.style_name,
      category: s.category || '', buyer: s.buyer || '',
      fabric_type: s.fabric_type || '', season: s.season || '',
      description: s.description || '', status: s.status || 'active',
    });
    setShowForm(true);
  };

  const submitStyle = async (e) => {
    e.preventDefault();
    if (!form.style_code.trim() || !form.style_name.trim()) {
      toast.error('Kode & Nama Style wajib diisi.');
      return;
    }
    setSaving(true);
    try {
      const url = editing
        ? `${API}/api/rahaza/styles/${editing.id}`
        : `${API}/api/rahaza/styles`;
      const method = editing ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: jsonHeaders, body: JSON.stringify(form) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Gagal menyimpan style (${res.status})`);
      }
      const saved = await res.json();
      toast.success(editing ? 'Style diperbarui' : 'Style dibuat');
      setShowForm(false);
      await fetchAll();
      setSelected(saved);
    } catch (err) {
      toast.error(err.message || 'Gagal menyimpan style');
    } finally {
      setSaving(false);
    }
  };

  const deleteStyle = async (s) => {
    try {
      const res = await fetch(`${API}/api/rahaza/styles/${s.id}`, { method: 'DELETE', headers });
      if (!res.ok) throw new Error('Gagal menghapus');
      toast.success('Style dihapus');
      setSelected(null);
      setConfirmDel(null);
      await fetchAll();
    } catch (e) {
      toast.error(e.message || 'Gagal menghapus style');
    }
  };

  // ── IMAGES ──────────────────────────────────────────────────────────────────
  const uploadImage = async (file) => {
    if (!selected || !file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch(`${API}/api/rahaza/styles/${selected.id}/images`, {
        method: 'POST', headers, body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Upload gambar gagal');
      }
      toast.success('Gambar diunggah');
      await refreshSelected(selected.id);
    } catch (e) {
      toast.error(e.message);
    }
  };

  const deleteImage = async (img) => {
    if (!selected) return;
    try {
      const res = await fetch(`${API}/api/rahaza/styles/${selected.id}/images/${img.id}`, {
        method: 'DELETE', headers,
      });
      if (!res.ok) throw new Error('Gagal menghapus gambar');
      toast.success('Gambar dihapus');
      await refreshSelected(selected.id);
    } catch (e) {
      toast.error(e.message);
    }
  };

  // ── TECH-PACK ───────────────────────────────────────────────────────────────
  const uploadTechpack = async (file) => {
    if (!selected || !file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch(`${API}/api/rahaza/styles/${selected.id}/techpack`, {
        method: 'POST', headers, body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Upload tech-pack gagal');
      }
      toast.success('Tech-pack diunggah');
      await refreshSelected(selected.id);
    } catch (e) {
      toast.error(e.message);
    }
  };

  const deleteTechpack = async () => {
    if (!selected) return;
    try {
      const res = await fetch(`${API}/api/rahaza/styles/${selected.id}/techpack`, {
        method: 'DELETE', headers,
      });
      if (!res.ok) throw new Error('Gagal menghapus tech-pack');
      toast.success('Tech-pack dihapus');
      await refreshSelected(selected.id);
    } catch (e) {
      toast.error(e.message);
    }
  };

  // ── VARIANTS ────────────────────────────────────────────────────────────────
  const [variantForm, setVariantForm] = useState({ color: '', size: '', sku: '', notes: '' });

  const addVariant = async (e) => {
    e.preventDefault();
    if (!selected) return;
    if (!variantForm.color && !variantForm.size) {
      toast.error('Isi minimal warna atau ukuran');
      return;
    }
    try {
      const res = await fetch(`${API}/api/rahaza/styles/${selected.id}/variants`, {
        method: 'POST', headers: jsonHeaders, body: JSON.stringify(variantForm),
      });
      if (!res.ok) throw new Error('Gagal tambah varian');
      toast.success('Varian ditambahkan');
      setVariantForm({ color: '', size: '', sku: '', notes: '' });
      await refreshSelected(selected.id);
    } catch (e) {
      toast.error(e.message);
    }
  };

  const deleteVariant = async (v) => {
    if (!selected) return;
    try {
      const res = await fetch(`${API}/api/rahaza/styles/${selected.id}/variants/${v.id}`, {
        method: 'DELETE', headers,
      });
      if (!res.ok) throw new Error('Gagal hapus varian');
      toast.success('Varian dihapus');
      await refreshSelected(selected.id);
    } catch (e) {
      toast.error(e.message);
    }
  };

  // ── HELPERS ─────────────────────────────────────────────────────────────────
  const fileUrl = (url) => {
    if (!url) return '#';
    // Append auth token so <img> can load secured /api/files endpoint
    if (url.startsWith('/api/files/')) {
      const sep = url.includes('?') ? '&' : '?';
      return `${API}${url}${sep}auth=${encodeURIComponent(token)}`;
    }
    return url.startsWith('http') ? url : `${API}${url}`;
  };

  const distinctCategories = Array.from(new Set(styles.map(s => s.category).filter(Boolean)));
  const distinctBuyers     = Array.from(new Set(styles.map(s => s.buyer).filter(Boolean)));

  // ── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4" data-testid="style-master-module">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Tag size={18} className="text-violet-500" />
            Style Master 2.0
          </h2>
          <p className="text-sm text-foreground/55 mt-0.5">
            Manajemen style produk: design images, tech-pack, dan varian (warna · ukuran).
          </p>
        </div>
        {canEdit && (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
            data-testid="style-create-btn"
          >
            <Plus size={14} /> Tambah Style
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 bg-[var(--card-surface)] border border-border rounded-xl p-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground/40" />
          <input
            type="text"
            placeholder="Cari kode / nama / buyer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-foreground/40 focus:border-violet-500 outline-none"
            data-testid="style-search-input"
          />
        </div>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="px-3 py-1.5 bg-background border border-border rounded-lg text-sm text-foreground"
          data-testid="style-category-filter"
        >
          <option value="">Semua Kategori</option>
          {distinctCategories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={filterBuyer}
          onChange={(e) => setFilterBuyer(e.target.value)}
          className="px-3 py-1.5 bg-background border border-border rounded-lg text-sm text-foreground"
          data-testid="style-buyer-filter"
        >
          <option value="">Semua Buyer</option>
          {distinctBuyers.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>

      {/* Two-pane: list + detail */}
      <div className="grid lg:grid-cols-[1fr_1.4fr] gap-4">
        {/* List */}
        <div className="bg-[var(--card-surface)] border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-2 border-b border-border bg-[var(--glass-bg)] flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground">Daftar Style</span>
            <span className="text-xs text-foreground/50">{styles.length}</span>
          </div>
          <div className="max-h-[60vh] overflow-y-auto divide-y divide-border">
            {loading ? (
              <div className="p-6 text-center text-foreground/50 text-sm">Memuat...</div>
            ) : styles.length === 0 ? (
              <div className="p-6 text-center text-foreground/50 text-sm">
                Belum ada style. {canEdit && 'Klik "Tambah Style" untuk membuat.'}
              </div>
            ) : styles.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelected(s)}
                className={`w-full text-left px-4 py-3 hover:bg-[var(--glass-bg-hover)] transition-colors ${
                  selected?.id === s.id ? 'bg-violet-500/10 border-l-2 border-violet-500' : ''
                }`}
                data-testid={`style-row-${s.style_code}`}
              >
                <div className="flex items-center gap-2">
                  {s.design_images?.length > 0 ? (
                    <img
                      src={fileUrl(s.design_images[0].url)}
                      alt={s.style_code}
                      className="w-10 h-10 rounded object-cover bg-foreground/5"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded bg-foreground/5 grid place-items-center">
                      <ImageIcon size={14} className="text-foreground/30" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-foreground">{s.style_code}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${STATUS_COLOR[s.status] || STATUS_COLOR.draft}`}>
                        {s.status || 'draft'}
                      </span>
                    </div>
                    <div className="text-xs text-foreground/70 truncate">{s.style_name}</div>
                    <div className="text-[10px] text-foreground/45 mt-0.5">
                      {s.buyer ? `${s.buyer} · ` : ''}{s.category || '—'}
                      {s.season ? ` · ${s.season}` : ''}
                    </div>
                  </div>
                  <div className="text-right text-[10px] text-foreground/45 flex-shrink-0 space-y-0.5">
                    <div className="flex items-center gap-1 justify-end"><ImageIcon size={10} /> {s.design_images?.length || 0}</div>
                    <div className="flex items-center gap-1 justify-end"><Tag size={10} /> {s.variants?.length || 0}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Detail */}
        <div className="bg-[var(--card-surface)] border border-border rounded-xl">
          {!selected ? (
            <div className="h-full min-h-[300px] grid place-items-center p-6 text-center text-sm text-foreground/55">
              <div>
                <Eye size={28} className="mx-auto mb-2 text-foreground/30" />
                Pilih style dari daftar untuk melihat detail, design images, tech-pack, dan varian.
              </div>
            </div>
          ) : (
            <div className="p-4 space-y-4" data-testid="style-detail">
              {/* Detail header */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-foreground">{selected.style_code}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${STATUS_COLOR[selected.status] || STATUS_COLOR.draft}`}>
                      {selected.status || 'draft'}
                    </span>
                  </div>
                  <h3 className="text-base font-semibold text-foreground">{selected.style_name}</h3>
                  <div className="text-xs text-foreground/60 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    {selected.buyer && <span><span className="text-foreground/40">Buyer:</span> {selected.buyer}</span>}
                    {selected.category && <span><span className="text-foreground/40">Kategori:</span> {selected.category}</span>}
                    {selected.fabric_type && <span><span className="text-foreground/40">Fabric:</span> {selected.fabric_type}</span>}
                    {selected.season && <span><span className="text-foreground/40">Musim:</span> {selected.season}</span>}
                  </div>
                  {selected.description && (
                    <p className="text-xs text-foreground/65 mt-2 leading-relaxed">{selected.description}</p>
                  )}
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => openEdit(selected)}
                      className="p-1.5 rounded hover:bg-foreground/10 text-foreground/70 hover:text-foreground"
                      title="Edit"
                      data-testid="style-edit-btn"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => setConfirmDel(selected)}
                      className="p-1.5 rounded hover:bg-red-500/10 text-foreground/70 hover:text-red-500"
                      title="Hapus"
                      data-testid="style-delete-btn"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>

              {/* Design images */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <ImageIcon size={13} className="text-violet-500" /> Design Images ({selected.design_images?.length || 0})
                  </span>
                  {canEdit && (
                    <>
                      <input
                        ref={imgInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) uploadImage(f);
                          e.target.value = '';
                        }}
                        data-testid="style-image-input"
                      />
                      <button
                        onClick={() => imgInputRef.current?.click()}
                        className="text-[11px] flex items-center gap-1 bg-violet-500/15 text-violet-600 dark:text-violet-300 px-2 py-1 rounded hover:bg-violet-500/25 transition-colors"
                        data-testid="style-image-upload-btn"
                      >
                        <Upload size={11} /> Upload
                      </button>
                    </>
                  )}
                </div>
                {(selected.design_images?.length || 0) === 0 ? (
                  <div className="text-xs text-foreground/45 bg-foreground/5 rounded-lg p-4 text-center">
                    Belum ada gambar.
                  </div>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                    {selected.design_images.map(img => (
                      <div key={img.id} className="relative group aspect-square rounded-lg overflow-hidden border border-border bg-foreground/5">
                        <img
                          src={fileUrl(img.url)}
                          alt={img.caption}
                          className="w-full h-full object-cover"
                          data-testid={`style-image-${img.id}`}
                        />
                        {canEdit && (
                          <button
                            onClick={() => deleteImage(img)}
                            className="absolute top-1 right-1 p-1 rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 hover:bg-red-500 transition-opacity"
                            title="Hapus gambar"
                          >
                            <X size={11} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Tech-pack */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <FileText size={13} className="text-cyan-500" /> Tech-Pack
                  </span>
                  {canEdit && (
                    <>
                      <input
                        ref={tpInputRef}
                        type="file"
                        accept=".pdf,application/pdf"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) uploadTechpack(f);
                          e.target.value = '';
                        }}
                        data-testid="style-techpack-input"
                      />
                      <button
                        onClick={() => tpInputRef.current?.click()}
                        className="text-[11px] flex items-center gap-1 bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 px-2 py-1 rounded hover:bg-cyan-500/25 transition-colors"
                        data-testid="style-techpack-upload-btn"
                      >
                        <Upload size={11} /> {selected.techpack_url ? 'Ganti PDF' : 'Upload PDF'}
                      </button>
                    </>
                  )}
                </div>
                {!selected.techpack_url ? (
                  <div className="text-xs text-foreground/45 bg-foreground/5 rounded-lg p-4 text-center">
                    Belum ada tech-pack.
                  </div>
                ) : (
                  <div className="flex items-center justify-between bg-cyan-500/10 border border-cyan-500/25 rounded-lg p-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText size={14} className="text-cyan-500 flex-shrink-0" />
                      <span className="text-xs text-foreground truncate">{selected.techpack_name || 'tech-pack.pdf'}</span>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <a
                        href={fileUrl(selected.techpack_url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 rounded hover:bg-cyan-500/20 text-cyan-600 dark:text-cyan-300"
                        title="Buka PDF"
                        data-testid="style-techpack-view-btn"
                      >
                        <Download size={13} />
                      </a>
                      {canEdit && (
                        <button
                          onClick={deleteTechpack}
                          className="p-1.5 rounded hover:bg-red-500/15 text-foreground/60 hover:text-red-500"
                          title="Hapus PDF"
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Variants */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Tag size={13} className="text-emerald-500" />
                  <span className="text-xs font-semibold text-foreground">
                    Varian ({selected.variants?.length || 0})
                  </span>
                </div>

                {(selected.variants?.length || 0) > 0 && (
                  <div className="border border-border rounded-lg overflow-hidden mb-2">
                    <table className="w-full text-xs">
                      <thead className="bg-[var(--glass-bg)] text-foreground/55">
                        <tr>
                          <th className="text-left px-3 py-1.5 font-medium">Warna</th>
                          <th className="text-left px-3 py-1.5 font-medium">Ukuran</th>
                          <th className="text-left px-3 py-1.5 font-medium">SKU</th>
                          <th className="text-left px-3 py-1.5 font-medium">Catatan</th>
                          {canEdit && <th className="w-8"></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {selected.variants.map(v => (
                          <tr key={v.id} className="border-t border-border" data-testid={`style-variant-${v.id}`}>
                            <td className="px-3 py-1.5 text-foreground">{v.color || '—'}</td>
                            <td className="px-3 py-1.5 text-foreground">{v.size || '—'}</td>
                            <td className="px-3 py-1.5 font-mono text-foreground/75">{v.sku || '—'}</td>
                            <td className="px-3 py-1.5 text-foreground/65">{v.notes || '—'}</td>
                            {canEdit && (
                              <td className="px-2 py-1.5">
                                <button
                                  onClick={() => deleteVariant(v)}
                                  className="p-1 rounded hover:bg-red-500/10 text-foreground/55 hover:text-red-500"
                                  title="Hapus varian"
                                >
                                  <Trash2 size={11} />
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {canEdit && (
                  <form onSubmit={addVariant} className="grid grid-cols-2 md:grid-cols-5 gap-2" data-testid="style-variant-form">
                    <input
                      placeholder="Warna"
                      value={variantForm.color}
                      onChange={(e) => setVariantForm({ ...variantForm, color: e.target.value })}
                      className="px-2 py-1.5 bg-background border border-border rounded text-xs text-foreground"
                      data-testid="style-variant-color"
                    />
                    <input
                      placeholder="Ukuran"
                      value={variantForm.size}
                      onChange={(e) => setVariantForm({ ...variantForm, size: e.target.value })}
                      className="px-2 py-1.5 bg-background border border-border rounded text-xs text-foreground"
                      data-testid="style-variant-size"
                    />
                    <input
                      placeholder="SKU (opsional)"
                      value={variantForm.sku}
                      onChange={(e) => setVariantForm({ ...variantForm, sku: e.target.value })}
                      className="px-2 py-1.5 bg-background border border-border rounded text-xs font-mono text-foreground"
                      data-testid="style-variant-sku"
                    />
                    <input
                      placeholder="Catatan"
                      value={variantForm.notes}
                      onChange={(e) => setVariantForm({ ...variantForm, notes: e.target.value })}
                      className="px-2 py-1.5 bg-background border border-border rounded text-xs text-foreground"
                      data-testid="style-variant-notes"
                    />
                    <button
                      type="submit"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded flex items-center justify-center gap-1"
                      data-testid="style-variant-add-btn"
                    >
                      <Plus size={12} /> Tambah
                    </button>
                  </form>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create / Edit Modal */}
      {showForm && (
        <Modal title={editing ? 'Edit Style' : 'Tambah Style'} onClose={() => setShowForm(false)}>
          <form onSubmit={submitStyle} className="space-y-3" data-testid="style-form">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-foreground/65">Kode Style *</label>
                <input
                  required
                  disabled={!!editing}
                  value={form.style_code}
                  onChange={(e) => setForm({ ...form, style_code: e.target.value })}
                  className="w-full mt-1 px-3 py-1.5 bg-background border border-border rounded-lg text-sm text-foreground font-mono uppercase"
                  data-testid="style-form-code"
                />
              </div>
              <div>
                <label className="text-xs text-foreground/65">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="w-full mt-1 px-3 py-1.5 bg-background border border-border rounded-lg text-sm text-foreground"
                  data-testid="style-form-status"
                >
                  <option value="active">Active</option>
                  <option value="draft">Draft</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-foreground/65">Nama Style *</label>
              <input
                required
                value={form.style_name}
                onChange={(e) => setForm({ ...form, style_name: e.target.value })}
                className="w-full mt-1 px-3 py-1.5 bg-background border border-border rounded-lg text-sm text-foreground"
                data-testid="style-form-name"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-foreground/65">Kategori</label>
                <input
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder="cardigan, sweater, vest..."
                  className="w-full mt-1 px-3 py-1.5 bg-background border border-border rounded-lg text-sm text-foreground"
                  data-testid="style-form-category"
                />
              </div>
              <div>
                <label className="text-xs text-foreground/65">Buyer</label>
                <input
                  value={form.buyer}
                  onChange={(e) => setForm({ ...form, buyer: e.target.value })}
                  className="w-full mt-1 px-3 py-1.5 bg-background border border-border rounded-lg text-sm text-foreground"
                  data-testid="style-form-buyer"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-foreground/65">Jenis Bahan</label>
                <input
                  value={form.fabric_type}
                  onChange={(e) => setForm({ ...form, fabric_type: e.target.value })}
                  placeholder="100% wool, acrylic, blend..."
                  className="w-full mt-1 px-3 py-1.5 bg-background border border-border rounded-lg text-sm text-foreground"
                  data-testid="style-form-fabric"
                />
              </div>
              <div>
                <label className="text-xs text-foreground/65">Musim</label>
                <input
                  value={form.season}
                  onChange={(e) => setForm({ ...form, season: e.target.value })}
                  placeholder="FW26, SS27..."
                  className="w-full mt-1 px-3 py-1.5 bg-background border border-border rounded-lg text-sm text-foreground"
                  data-testid="style-form-season"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-foreground/65">Deskripsi</label>
              <textarea
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full mt-1 px-3 py-1.5 bg-background border border-border rounded-lg text-sm text-foreground resize-none"
                data-testid="style-form-description"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-3 py-1.5 text-sm text-foreground/70 hover:text-foreground border border-border rounded-lg"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
                data-testid="style-form-submit-btn"
              >
                {saving ? 'Menyimpan...' : editing ? 'Simpan Perubahan' : 'Buat Style'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {confirmDel && (
        <ConfirmDialog
          title="Hapus Style"
          message={`Yakin hapus style "${confirmDel.style_code}"? Tindakan ini tidak dapat dibatalkan.`}
          onConfirm={() => deleteStyle(confirmDel)}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </div>
  );
}
