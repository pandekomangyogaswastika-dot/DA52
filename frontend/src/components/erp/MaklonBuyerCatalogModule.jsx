/**
 * MaklonBuyerCatalogModule — Phase M1
 * Master Artikel Buyer untuk Portal Maklon.
 *
 * Fitur:
 *  - List + filter by client, status, search
 *  - Create/Edit dialog (artikel_code, buyer_ref_code, product_name, price defaults, color/size options)
 *  - Toggle active/inactive
 *  - Soft-delete (discontinue)
 *
 * Catatan: pakai pattern style yang sama dengan MaklonClientManagement (Glass UI + Shadcn).
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  BookOpen,
  Plus,
  Edit2,
  RefreshCw,
  Search,
  Tag,
  Layers,
  Ban,
  CheckCircle2,
  X,
  AlertCircle,
} from 'lucide-react';
import { GlassCard } from '@/components/ui/glass';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { PageHeader } from './moduleAtoms';
import { EmptyState } from './EmptyState';

const CATEGORIES = [
  'Dress',
  'Blouse',
  'Rok',
  'Celana',
  'Set/Setelan',
  'Baju Anak',
  'Hijab',
  'Aksesoris',
  'Lainnya',
];

const fmtRp = (v) => `Rp ${Number(v || 0).toLocaleString('id-ID')}`;

export default function MaklonBuyerCatalogModule({ token }) {
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
    [token]
  );

  const [items, setItems] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterClient, setFilterClient] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState(null); // null | { data?: row }

  const fetchClients = useCallback(async () => {
    try {
      const r = await fetch('/api/dewi/maklon/clients', { headers });
      if (r.ok) setClients(await r.json());
    } catch (_e) {
      // silent
    }
  }, [headers]);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (filterClient !== 'all') qs.append('client_id', filterClient);
      if (filterStatus !== 'all') qs.append('status', filterStatus);
      if (search.trim()) qs.append('search', search.trim());
      const r = await fetch(`/api/dewi/maklon/buyer-catalog?${qs.toString()}`, { headers });
      if (r.ok) setItems(await r.json());
      else toast.error('Gagal memuat Buyer Catalog');
    } catch (_e) {
      toast.error('Gagal memuat Buyer Catalog');
    } finally {
      setLoading(false);
    }
  }, [headers, filterClient, filterStatus, search]);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);
  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const toggleItem = async (row) => {
    const r = await fetch(`/api/dewi/maklon/buyer-catalog/${row.id}/toggle`, {
      method: 'PUT',
      headers,
    });
    if (r.ok) {
      const d = await r.json();
      toast.success(`Status diubah → ${d.status}`);
      fetchItems();
    } else toast.error('Gagal mengubah status');
  };

  const discontinueItem = async (row) => {
    if (!window.confirm(`Set artikel "${row.artikel_code}" sebagai discontinued?`)) return;
    const r = await fetch(`/api/dewi/maklon/buyer-catalog/${row.id}`, {
      method: 'DELETE',
      headers,
    });
    if (r.ok) {
      toast.success('Artikel di-discontinue');
      fetchItems();
    } else toast.error('Gagal melakukan discontinue');
  };

  const stats = useMemo(
    () => ({
      total: items.length,
      active: items.filter((x) => x.status === 'active').length,
      inactive: items.filter((x) => x.status === 'inactive').length,
      discontinued: items.filter((x) => x.status === 'discontinued').length,
    }),
    [items]
  );

  return (
    <div className="p-6 space-y-6" data-testid="maklon-buyer-catalog-module">
      <PageHeader
        title="Buyer Catalog"
        description="Master artikel buyer Maklon — spesifikasi & harga default langsung dari klien"
        icon={BookOpen}
        actions={
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={fetchItems}
              variant="outline"
              className="gap-2"
              data-testid="buyer-catalog-refresh-btn"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => setDialog({})}
              className="gap-1.5"
              data-testid="buyer-catalog-add-btn"
            >
              <Plus className="w-3.5 h-3.5" /> Tambah Artikel
            </Button>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total', value: stats.total, icon: Layers, color: 'text-blue-400 bg-blue-500/10 border-blue-400/20' },
          { label: 'Aktif', value: stats.active, icon: CheckCircle2, color: 'text-green-400 bg-green-500/10 border-green-400/20' },
          { label: 'Non-Aktif', value: stats.inactive, icon: Ban, color: 'text-orange-400 bg-orange-500/10 border-orange-400/20' },
          { label: 'Discontinued', value: stats.discontinued, icon: AlertCircle, color: 'text-red-400 bg-red-500/10 border-red-400/20' },
        ].map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.04 * i }}
          >
            <GlassCard className={`p-4 border ${s.color.split(' ')[2]}`}>
              <div className={`w-8 h-8 rounded-lg border ${s.color} flex items-center justify-center mb-2`}>
                <s.icon className={`w-4 h-4 ${s.color.split(' ')[0]}`} />
              </div>
              <div className="text-2xl font-bold text-foreground" data-testid={`stat-${s.label.toLowerCase()}`}>
                {s.value}
              </div>
              <div className="text-xs text-foreground/50">{s.label}</div>
            </GlassCard>
          </motion.div>
        ))}
      </div>

      {/* Filters */}
      <GlassCard className="p-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <Label className="text-xs mb-1 block">Cari Artikel / Ref / Nama</Label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/40" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Misal: ZARA-W24, Dress Linen, BT-..."
                className="pl-8 h-9"
                data-testid="buyer-catalog-search-input"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs mb-1 block">Buyer</Label>
            <Select value={filterClient} onValueChange={setFilterClient}>
              <SelectTrigger className="h-9" data-testid="buyer-catalog-filter-client">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Buyer</SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs mb-1 block">Status</Label>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-9" data-testid="buyer-catalog-filter-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua</SelectItem>
                <SelectItem value="active">Aktif</SelectItem>
                <SelectItem value="inactive">Non-Aktif</SelectItem>
                <SelectItem value="discontinued">Discontinued</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </GlassCard>

      {/* Items List */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {loading ? (
          <div className="col-span-2 text-center py-10 text-foreground/40 text-sm">Memuat...</div>
        ) : items.length === 0 ? (
          <div className="col-span-2">
            <EmptyState
              icon={BookOpen}
              title="Belum ada artikel buyer"
              description="Buat entry pertama untuk menyimpan spesifikasi & harga default dari klien Maklon."
              action={
                <Button onClick={() => setDialog({})} className="gap-1.5">
                  <Plus className="w-3.5 h-3.5" /> Tambah Artikel
                </Button>
              }
            />
          </div>
        ) : (
          items.map((it) => (
            <GlassCard
              key={it.id}
              className={`p-4 border transition-all ${
                it.status === 'active'
                  ? 'border-white/8 hover:border-white/15'
                  : 'border-white/5 opacity-60'
              }`}
              data-testid={`buyer-catalog-row-${it.id}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-semibold text-foreground truncate">{it.product_name}</span>
                    {it.status === 'inactive' && (
                      <span className="text-[10px] bg-orange-500/15 text-orange-400 px-1.5 py-0.5 rounded border border-orange-400/25">
                        Non-Aktif
                      </span>
                    )}
                    {it.status === 'discontinued' && (
                      <span className="text-[10px] bg-red-500/15 text-red-400 px-1.5 py-0.5 rounded border border-red-400/25">
                        Discontinued
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mb-1 text-xs flex-wrap">
                    <span className="bg-violet-500/15 text-violet-300 px-1.5 py-0.5 rounded font-mono border border-violet-400/25">
                      {it.artikel_code}
                    </span>
                    {it.buyer_ref_code && (
                      <span className="bg-white/5 text-foreground/60 px-1.5 py-0.5 rounded font-mono">
                        ↳ {it.buyer_ref_code}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-foreground/55 mb-2">
                    <Tag className="w-3 h-3 inline mr-1" /> {it.client_name} · {it.category || 'Uncategorized'}
                  </div>
                  <div className="flex items-center gap-2 text-xs flex-wrap">
                    <span className="text-foreground/60">
                      CMT: <strong className="text-amber-400">{fmtRp(it.default_cmt_price)}</strong>
                    </span>
                    {it.default_selling_price > 0 && (
                      <>
                        <span className="text-foreground/30">•</span>
                        <span className="text-foreground/60">
                          Jual: <strong className="text-emerald-400">{fmtRp(it.default_selling_price)}</strong>
                        </span>
                      </>
                    )}
                  </div>
                  {(it.color_options?.length > 0 || it.size_options?.length > 0) && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {(it.color_options || []).slice(0, 4).map((c) => (
                        <span
                          key={c}
                          className="text-[10px] bg-blue-500/10 text-blue-300 px-1.5 py-0.5 rounded border border-blue-400/20"
                        >
                          {c}
                        </span>
                      ))}
                      {(it.size_options || []).slice(0, 6).map((s) => (
                        <span
                          key={s}
                          className="text-[10px] bg-slate-500/10 text-slate-300 px-1.5 py-0.5 rounded border border-slate-400/20"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="w-7 h-7"
                      onClick={() => setDialog({ data: it })}
                      data-testid={`buyer-catalog-edit-${it.id}`}
                      title="Edit"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-7"
                      onClick={() => toggleItem(it)}
                      data-testid={`buyer-catalog-toggle-${it.id}`}
                      disabled={it.status === 'discontinued'}
                    >
                      {it.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'}
                    </Button>
                  </div>
                  {it.status !== 'discontinued' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs h-7 text-red-400 hover:bg-red-500/10"
                      onClick={() => discontinueItem(it)}
                      data-testid={`buyer-catalog-discontinue-${it.id}`}
                    >
                      Discontinue
                    </Button>
                  )}
                  {it.total_qty_produced > 0 && (
                    <div className="text-[10px] text-foreground/40 mt-1">
                      {it.total_qty_produced.toLocaleString('id-ID')} pcs prod.
                    </div>
                  )}
                </div>
              </div>
            </GlassCard>
          ))
        )}
      </div>

      {/* Dialog */}
      {dialog !== null && (
        <BuyerCatalogDialog
          data={dialog?.data || null}
          clients={clients}
          headers={headers}
          onClose={() => setDialog(null)}
          onSuccess={() => {
            setDialog(null);
            fetchItems();
          }}
        />
      )}
    </div>
  );
}

// ─── Dialog Create/Edit ──────────────────────────────────────────────────────
function BuyerCatalogDialog({ data, clients, headers, onClose, onSuccess }) {
  const isEdit = !!data;
  const [form, setForm] = useState({
    client_id: data?.client_id || '',
    artikel_code: data?.artikel_code || '',
    buyer_ref_code: data?.buyer_ref_code || '',
    product_name: data?.product_name || '',
    category: data?.category || '',
    season: data?.season || '',
    gender: data?.gender || '',
    default_cmt_price: data?.default_cmt_price ?? 0,
    default_selling_price: data?.default_selling_price ?? 0,
    color_options: (data?.color_options || []).join(', '),
    size_options: (data?.size_options || []).join(', '),
    description: data?.description || '',
    hero_image_url: data?.hero_image_url || '',
    status: data?.status || 'active',
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.client_id) {
      toast.error('Pilih buyer terlebih dahulu');
      return;
    }
    if (!form.artikel_code.trim()) {
      toast.error('Kode artikel wajib diisi');
      return;
    }
    if (!form.product_name.trim()) {
      toast.error('Nama produk wajib diisi');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        artikel_code: form.artikel_code.trim(),
        buyer_ref_code: form.buyer_ref_code.trim(),
        product_name: form.product_name.trim(),
        default_cmt_price: Number(form.default_cmt_price) || 0,
        default_selling_price: Number(form.default_selling_price) || 0,
        color_options: form.color_options
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        size_options: form.size_options
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      };
      // On edit, client_id can't change (avoid composite-unique collision); strip it.
      if (isEdit) delete payload.client_id;

      const url = isEdit
        ? `/api/dewi/maklon/buyer-catalog/${data.id}`
        : '/api/dewi/maklon/buyer-catalog';
      const r = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.detail || 'Gagal menyimpan');
      }
      toast.success(isEdit ? 'Artikel berhasil diperbarui' : 'Artikel berhasil dibuat');
      onSuccess();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto" data-testid="buyer-catalog-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-violet-400" />
            {isEdit ? 'Edit Buyer Catalog' : 'Tambah Artikel Buyer'}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
          <div>
            <Label className="text-xs">Buyer (Klien) *</Label>
            <Select
              value={form.client_id}
              onValueChange={(v) => setForm({ ...form, client_id: v })}
              disabled={isEdit}
            >
              <SelectTrigger className="h-9" data-testid="bc-form-client">
                <SelectValue placeholder="Pilih buyer" />
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} ({c.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isEdit && (
              <p className="text-[10px] text-foreground/40 mt-1">
                Buyer tidak bisa diubah setelah artikel dibuat.
              </p>
            )}
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger className="h-9" data-testid="bc-form-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Aktif</SelectItem>
                <SelectItem value="inactive">Non-Aktif</SelectItem>
                <SelectItem value="discontinued">Discontinued</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Kode Artikel (Internal) *</Label>
            <Input
              value={form.artikel_code}
              onChange={(e) => setForm({ ...form, artikel_code: e.target.value })}
              placeholder="MAK-ZARA-001"
              className="h-9 font-mono"
              data-testid="bc-form-artikel-code"
            />
          </div>
          <div>
            <Label className="text-xs">Kode Buyer (Referensi)</Label>
            <Input
              value={form.buyer_ref_code}
              onChange={(e) => setForm({ ...form, buyer_ref_code: e.target.value })}
              placeholder="Z-W24-001"
              className="h-9 font-mono"
              data-testid="bc-form-buyer-ref"
            />
          </div>

          <div className="md:col-span-2">
            <Label className="text-xs">Nama Produk *</Label>
            <Input
              value={form.product_name}
              onChange={(e) => setForm({ ...form, product_name: e.target.value })}
              placeholder="Dress Linen Premium"
              className="h-9"
              data-testid="bc-form-product-name"
            />
          </div>

          <div>
            <Label className="text-xs">Kategori</Label>
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
              <SelectTrigger className="h-9" data-testid="bc-form-category">
                <SelectValue placeholder="Pilih kategori" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Season</Label>
              <Input
                value={form.season}
                onChange={(e) => setForm({ ...form, season: e.target.value })}
                placeholder="SS24, FW24..."
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs">Gender</Label>
              <Input
                value={form.gender}
                onChange={(e) => setForm({ ...form, gender: e.target.value })}
                placeholder="Women / Men / Unisex"
                className="h-9"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">Harga CMT Default (Rp) *</Label>
            <Input
              type="number"
              min={0}
              value={form.default_cmt_price}
              onChange={(e) => setForm({ ...form, default_cmt_price: e.target.value })}
              className="h-9"
              data-testid="bc-form-default-cmt-price"
            />
            <p className="text-[10px] text-foreground/40 mt-1">Bisa di-override saat buat PO.</p>
          </div>
          <div>
            <Label className="text-xs">Harga Jual Default (Rp)</Label>
            <Input
              type="number"
              min={0}
              value={form.default_selling_price}
              onChange={(e) => setForm({ ...form, default_selling_price: e.target.value })}
              className="h-9"
              data-testid="bc-form-default-selling-price"
            />
          </div>

          <div>
            <Label className="text-xs">Opsi Warna (pisahkan koma)</Label>
            <Input
              value={form.color_options}
              onChange={(e) => setForm({ ...form, color_options: e.target.value })}
              placeholder="Black, White, Red"
              className="h-9"
              data-testid="bc-form-colors"
            />
          </div>
          <div>
            <Label className="text-xs">Opsi Ukuran (pisahkan koma)</Label>
            <Input
              value={form.size_options}
              onChange={(e) => setForm({ ...form, size_options: e.target.value })}
              placeholder="S, M, L, XL"
              className="h-9"
              data-testid="bc-form-sizes"
            />
          </div>

          <div className="md:col-span-2">
            <Label className="text-xs">Foto Hero (URL)</Label>
            <Input
              value={form.hero_image_url}
              onChange={(e) => setForm({ ...form, hero_image_url: e.target.value })}
              placeholder="https://..."
              className="h-9"
            />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">Deskripsi / Spek dari Buyer</Label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Material, finishing, packaging, dll dari buyer"
              rows={3}
              data-testid="bc-form-description"
            />
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose} disabled={saving} data-testid="bc-form-cancel">
            <X className="w-3.5 h-3.5 mr-1" /> Batal
          </Button>
          <Button onClick={save} disabled={saving} data-testid="bc-form-save">
            {saving ? 'Menyimpan...' : isEdit ? 'Simpan Perubahan' : 'Buat Artikel'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
