import { useState, useEffect } from 'react';
import { GlassCard } from '@/components/ui/glass';
import { Plus, Search, Pencil, Trash2, X, Check } from 'lucide-react';
import { toast } from '../ui/sonner';
import { apiFetch, ApiError } from '@/lib/apiFetch';

export default function RnDMaterialsTab({ token }) {
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    material_code: '',
    material_name: '',
    category: '',
    vendor: '',
    composition: '',
    weight: 0,
    price_per_meter: 0,
    min_order_qty: 0,
    test_results: '',
    notes: '',
    status: 'active',
  });

  useEffect(() => {
    fetchMaterials();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const fetchMaterials = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      const qs = params.toString();
      const data = await apiFetch(`/dewi/rnd/materials${qs ? '?' + qs : ''}`);
      setMaterials(Array.isArray(data) ? data : []);
    } catch (e) {
      if (e instanceof ApiError && !e.isUnauthorized) {
        toast.error(e.userMessage || 'Gagal memuat data material');
      }
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setForm({
      material_code: '',
      material_name: '',
      category: '',
      vendor: '',
      composition: '',
      weight: 0,
      price_per_meter: 0,
      min_order_qty: 0,
      test_results: '',
      notes: '',
      status: 'active',
    });
    setShowForm(true);
  };

  const openEdit = (material) => {
    setEditing(material);
    setForm(material);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.material_code.trim() || !form.material_name.trim()) {
      toast.error('Kode material dan nama material wajib diisi');
      return;
    }

    try {
      const path = editing
        ? `/dewi/rnd/materials/${editing.id}`
        : '/dewi/rnd/materials';
      const method = editing ? 'PUT' : 'POST';
      await apiFetch(path, { method, body: form });
      toast.success(editing ? 'Material berhasil diupdate' : 'Material berhasil dibuat');
      setShowForm(false);
      fetchMaterials();
    } catch (e) {
      if (e instanceof ApiError && !e.isUnauthorized) {
        toast.error(e.userMessage || 'Gagal menyimpan material');
      }
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Yakin ingin menghapus material ini?')) return;
    try {
      await apiFetch(`/dewi/rnd/materials/${id}`, { method: 'DELETE' });
      toast.success('Material berhasil dihapus');
      fetchMaterials();
    } catch (e) {
      if (e instanceof ApiError && !e.isUnauthorized) {
        toast.error(e.userMessage || 'Gagal menghapus material');
      }
    }
  };

  return (
    <div className="space-y-4" data-testid="rnd-materials-tab">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Cari material..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-background border rounded-lg text-sm"
          />
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90"
          data-testid="create-material-btn"
        >
          <Plus className="w-4 h-4" />
          Tambah Material
        </button>
      </div>

      <GlassCard>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left p-3 text-sm font-semibold">Kode</th>
                <th className="text-left p-3 text-sm font-semibold">Nama Material</th>
                <th className="text-left p-3 text-sm font-semibold">Kategori</th>
                <th className="text-left p-3 text-sm font-semibold">Vendor</th>
                <th className="text-right p-3 text-sm font-semibold">Harga/M</th>
                <th className="text-right p-3 text-sm font-semibold">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="6" className="text-center p-8 text-muted-foreground">Memuat...</td>
                </tr>
              ) : materials.length === 0 ? (
                <tr>
                  <td colSpan="6" className="text-center p-8 text-muted-foreground">Belum ada data material</td>
                </tr>
              ) : (
                materials.map((material) => (
                  <tr key={material.id} className="border-b hover:bg-accent/50">
                    <td className="p-3">
                      <span className="font-mono text-sm font-semibold">{material.material_code}</span>
                    </td>
                    <td className="p-3">{material.material_name}</td>
                    <td className="p-3 text-sm text-muted-foreground">{material.category || '-'}</td>
                    <td className="p-3 text-sm text-muted-foreground">{material.vendor || '-'}</td>
                    <td className="p-3 text-right text-sm">Rp {material.price_per_meter?.toLocaleString('id-ID')}</td>
                    <td className="p-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEdit(material)}
                          className="p-1.5 hover:bg-accent rounded"
                          data-testid={`edit-material-${material.id}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(material.id)}
                          className="p-1.5 hover:bg-destructive/10 text-destructive rounded"
                          data-testid={`delete-material-${material.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <GlassCard className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold">
                  {editing ? 'Edit Material' : 'Tambah Material Baru'}
                </h2>
                <button onClick={() => setShowForm(false)} className="p-1 hover:bg-accent rounded">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">Kode Material <span className="text-destructive">*</span></label>
                  <input
                    type="text"
                    value={form.material_code}
                    onChange={(e) => setForm({ ...form, material_code: e.target.value.toUpperCase() })}
                    className="w-full px-3 py-2 bg-background border rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">Nama Material <span className="text-destructive">*</span></label>
                  <input
                    type="text"
                    value={form.material_name}
                    onChange={(e) => setForm({ ...form, material_name: e.target.value })}
                    className="w-full px-3 py-2 bg-background border rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">Kategori</label>
                  <input
                    type="text"
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="w-full px-3 py-2 bg-background border rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">Vendor</label>
                  <input
                    type="text"
                    value={form.vendor}
                    onChange={(e) => setForm({ ...form, vendor: e.target.value })}
                    className="w-full px-3 py-2 bg-background border rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">Harga per Meter (Rp)</label>
                  <input
                    type="number"
                    value={form.price_per_meter}
                    onChange={(e) => setForm({ ...form, price_per_meter: parseFloat(e.target.value) })}
                    className="w-full px-3 py-2 bg-background border rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">Min Order Qty</label>
                  <input
                    type="number"
                    value={form.min_order_qty}
                    onChange={(e) => setForm({ ...form, min_order_qty: parseFloat(e.target.value) })}
                    className="w-full px-3 py-2 bg-background border rounded-lg text-sm"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t">
                <button
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 border rounded-lg font-medium hover:bg-accent"
                >
                  Batal
                </button>
                <button
                  onClick={handleSave}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90"
                  data-testid="save-material-btn"
                >
                  <Check className="w-4 h-4" />
                  Simpan
                </button>
              </div>
            </div>
          </GlassCard>
        </div>
      )}
    </div>
  );
}
