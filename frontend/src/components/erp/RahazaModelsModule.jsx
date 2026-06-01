import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Edit2, Trash2, X, Upload, Camera } from 'lucide-react';
import { GlassCard, GlassInput } from '@/components/ui/glass';
import { Button } from '@/components/ui/button';
import Modal from './Modal';
import { DataTable } from './DataTableV2';
import { PageHeader } from './moduleAtoms';
import { toast } from 'sonner';

const CATEGORIES = ['Sweater', 'Cardigan', 'Vest', 'Polo', 'Other'];
const DEFAULT_FORM = { code: '', name: '', category: 'Sweater', yarn_kg_per_pcs: 0, bundle_size: 30, description: '' };

// M7: fallback placeholder for broken images
const IMAGE_FALLBACK = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48' viewBox='0 0 24 24' fill='none' stroke='%23cbd5e1' stroke-width='1.5'%3E%3Crect x='3' y='3' width='18' height='18' rx='2'/%3E%3Ccircle cx='8.5' cy='8.5' r='1.5'/%3E%3Cpath d='M21 15l-5-5L5 21'/%3E%3C/svg%3E`;

function ImageThumb({ path, token, onDelete, large = false }) {
  const url = useMemo(() => `/api/files/${path}?auth=${encodeURIComponent(token)}`, [path, token]);
  const sz = large ? 'w-24 h-24' : 'w-12 h-12';
  return (
    <div className={`relative group ${sz} rounded-lg overflow-hidden border border-[var(--glass-border)] bg-[var(--glass-bg)]`}>
      <img
        src={url}
        alt="model"
        className="w-full h-full object-cover"
        onError={(e) => { e.target.src = IMAGE_FALLBACK; e.target.style.objectFit = 'contain'; e.target.style.padding = '6px'; }}
      />
      {onDelete && (
        <button
          onClick={onDelete}
          className="absolute top-0.5 right-0.5 p-1 rounded-full bg-red-500/90 text-white opacity-0 group-hover:opacity-100 transition-opacity"
          data-testid="model-image-delete"
          title="Hapus foto"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

function ImageManagerDialog({ model, token, onClose, onUpdated }) {
  const [paths, setPaths] = useState(model.image_paths || []);
  const [uploading, setUploading] = useState(false);
  // M12: Memoize headers to avoid re-render loops
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (paths.length >= 3) {
      toast.error('Maksimal 3 foto per model');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch(`/api/rahaza/models/${model.id}/images`, {
        method: 'POST', headers, body: fd
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        toast.error(err.detail || 'Upload gagal');
        return;
      }
      const data = await r.json();
      setPaths(data.image_paths || []);
      toast.success('Foto berhasil diupload');
      onUpdated && onUpdated();
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleDelete = async (path) => {
    if (!window.confirm('Hapus foto ini?')) return;
    const r = await fetch(`/api/rahaza/models/${model.id}/images`, {
      method: 'DELETE',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ storage_path: path })
    });
    if (r.ok) {
      const data = await r.json();
      setPaths(data.image_paths || []);
      toast.success('Foto dihapus');
      onUpdated && onUpdated();
    } else {
      toast.error('Gagal menghapus foto');
    }
  };

  return (
    <Modal onClose={onClose} title={`Foto Referensi · ${model.code} — ${model.name}`} size="md">
      <div className="space-y-4" data-testid="model-image-manager">
        <p className="text-sm text-muted-foreground">
          Upload sampai <b>3 foto</b> referensi produk (max 5MB per foto). Foto ini akan tampil di Lembar Kerja Produksi (LKP)
          untuk memudahkan operator memahami target visual produk.
        </p>

        <div className="grid grid-cols-3 gap-3">
          {paths.map(p => (
            <ImageThumb key={p} path={p} token={token} large
              onDelete={() => handleDelete(p)} />
          ))}
          {paths.length < 3 && (
            <label className="w-24 h-24 rounded-lg border-2 border-dashed border-[var(--glass-border)] flex flex-col items-center justify-center gap-1 cursor-pointer hover:border-primary hover:bg-[var(--glass-bg-hover)] transition-colors"
              data-testid="model-image-upload-label">
              {uploading ? (
                <span className="text-xs text-muted-foreground">Uploading...</span>
              ) : (
                <>
                  <Upload className="w-5 h-5 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground">Tambah foto</span>
                </>
              )}
              <input type="file" accept="image/*" className="hidden"
                disabled={uploading} onChange={handleUpload}
                data-testid="model-image-upload-input" />
            </label>
          )}
        </div>

        <div className="text-xs text-muted-foreground">
          {paths.length}/3 foto. Format yang didukung: JPG, PNG, WebP.
        </div>

        <div className="flex justify-end pt-2 border-t border-[var(--glass-border)]">
          <Button variant="outline" onClick={onClose} data-testid="model-image-close">Selesai</Button>
        </div>
      </div>
    </Modal>
  );
}

export default function RahazaModelsModule({ token }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [imageModel, setImageModel] = useState(null);

  // M12: Memoize headers to prevent re-render loops in useCallback deps
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }), [token]);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/rahaza/models', { headers });
      if (r.ok) setRows(await r.json());
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const openCreate = () => { setEditing(null); setForm(DEFAULT_FORM); setModalOpen(true); };
  const openEdit = (row) => {
    setEditing(row);
    setForm({
      code: row.code || '', name: row.name || '',
      category: row.category || 'Sweater',
      yarn_kg_per_pcs: row.yarn_kg_per_pcs || 0,
      bundle_size: row.bundle_size || 30,
      description: row.description || '',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.code || !form.name) { toast.error('Kode & nama wajib diisi'); return; }
    setSaving(true);
    try {
      const url = editing ? `/api/rahaza/models/${editing.id}` : '/api/rahaza/models';
      const method = editing ? 'PUT' : 'POST';
      const r = await fetch(url, { method, headers, body: JSON.stringify(form) });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        toast.error(err.detail || `HTTP ${r.status}`);
        return;
      }
      toast.success(editing ? 'Model diperbarui' : 'Model dibuat');
      setModalOpen(false);
      fetchRows();
    } finally { setSaving(false); }
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Nonaktifkan model ${row.code}?`)) return;
    const r = await fetch(`/api/rahaza/models/${row.id}`, { method: 'DELETE', headers });
    if (r.ok) { toast.success('Model dinonaktifkan'); fetchRows(); }
    else toast.error('Gagal menonaktifkan');
  };

  const columns = [
    { key: 'code', label: 'Kode', sortable: true },
    { key: 'name', label: 'Nama Model', sortable: true },
    { key: 'category', label: 'Kategori' },
    {
      key: 'image_paths', label: 'Foto',
      render: (row) => {
        const arr = Array.isArray(row?.image_paths) ? row.image_paths : [];
        return (
          <div className="flex items-center gap-1.5" data-testid={`model-images-${row.code}`}>
            {arr.slice(0, 3).map(p => <ImageThumb key={p} path={p} token={token} />)}
            <button
              onClick={(e) => { e.stopPropagation(); setImageModel(row); }}
              className="px-2 py-1 rounded text-xs border border-[var(--glass-border)] hover:bg-[var(--glass-bg-hover)] flex items-center gap-1 text-muted-foreground hover:text-foreground"
              data-testid={`model-manage-images-${row.code}`}
              title="Kelola Foto"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>{arr.length}/3</span>
            </button>
          </div>
        );
      }
    },
    { key: 'yarn_kg_per_pcs', label: 'Benang/pcs (kg)', render: (row, v) => v ? Number(v).toFixed(3) : '-' },
    { key: 'bundle_size', label: 'Bundle', render: (row, v) => `${v || 30} pcs` },
    {
      key: 'actions', label: 'Aksi',
      render: (row) => (
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); openEdit(row); }}
            className="p-1.5 rounded hover:bg-[var(--glass-bg-hover)] text-muted-foreground hover:text-foreground"
            title="Edit"
            data-testid={`model-edit-${row.code}`}
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleDelete(row); }}
            className="p-1.5 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400"
            title="Nonaktifkan"
            data-testid={`model-deactivate-${row.code}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )
    },
  ];

  return (
    <div className="space-y-4" data-testid="rahaza-models-module">
      <PageHeader
        title="Model Produk"
        subtitle="Master model produk knit garment + upload foto referensi (max 3 per model untuk tampil di LKP)."
        actions={
          <Button onClick={openCreate} className="gap-1.5" data-testid="model-create-btn">
            <Plus className="w-4 h-4" /> Tambah Model
          </Button>
        }
      />

      <GlassCard>
        <DataTable
          tableId="rahaza-models"
          columns={columns}
          rows={rows}
          loading={loading}
          emptyTitle="Belum ada model"
          emptyDescription="Klik Tambah Model untuk memulai."
          rowKey="id"
        />
      </GlassCard>

      {modalOpen && (
        <Modal onClose={() => setModalOpen(false)} title={editing ? 'Edit Model' : 'Tambah Model Baru'} size="md">
          <div className="space-y-3" data-testid="model-form">
            <div>
              <label className="text-xs text-muted-foreground">Kode <span className="text-red-400">*</span></label>
              <GlassInput value={form.code} onChange={e => setForm({ ...form, code: e.target.value })}
                placeholder="Contoh: SW-VN-A" data-testid="model-form-code" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Nama Model <span className="text-red-400">*</span></label>
              <GlassInput value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="Contoh: Sweater V-Neck Classic" data-testid="model-form-name" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Kategori</label>
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] text-sm text-foreground"
                data-testid="model-form-category">
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Ukuran Bundle (pcs)</label>
                <GlassInput type="number" value={form.bundle_size}
                  onChange={e => setForm({ ...form, bundle_size: parseInt(e.target.value) || 30 })}
                  data-testid="model-form-bundle-size" />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Deskripsi</label>
              <GlassInput value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                placeholder="Opsional" data-testid="model-form-description" />
            </div>
            {editing && (
              <p className="text-[11px] text-muted-foreground bg-[var(--glass-bg)] p-2 rounded border border-[var(--glass-border)]">
                💡 <b>Foto referensi</b> dikelola lewat tombol <Camera className="inline w-3 h-3" /> di kolom Foto pada tabel.
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--glass-border)]">
              <Button variant="ghost" onClick={() => setModalOpen(false)} data-testid="model-form-cancel">Batal</Button>
              <Button onClick={handleSave} disabled={saving} data-testid="model-form-save">
                {saving ? 'Menyimpan...' : 'Simpan'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {imageModel && (
        <ImageManagerDialog
          model={imageModel}
          token={token}
          onClose={() => setImageModel(null)}
          onUpdated={fetchRows}
        />
      )}
    </div>
  );
}
