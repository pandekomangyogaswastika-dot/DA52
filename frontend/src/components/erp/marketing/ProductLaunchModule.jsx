import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Rocket, Plus, Pencil, Trash2, RefreshCw, Loader2,
  CheckCircle2, Clock, XCircle, AlertTriangle, Package,
  ChevronDown, ChevronUp, X, TrendingUp
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import axios from 'axios';

const API = process.env.REACT_APP_BACKEND_URL;

const PLATFORM_ICONS = { shopee: '🛒', tiktok: '🎵', tokopedia: '🟢', instagram: '📷', website: '🌐' };
const STATUS_CONFIG = {
  planning:  { label: 'Perencanaan', color: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',         icon: AlertTriangle },
  ready:     { label: 'Siap Launch', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',      icon: Clock },
  launched:  { label: 'Launched',    color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300', icon: CheckCircle2 },
  postponed: { label: 'Ditunda',     color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300', icon: AlertTriangle },
  cancelled: { label: 'Dibatalkan',  color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',         icon: XCircle },
};

function StatusBadge({ status }) {
  const c = STATUS_CONFIG[status] || STATUS_CONFIG.planning;
  const Icon = c.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${c.color}`}>
      <Icon size={10} />{c.label}
    </span>
  );
}

function fmtRp(n) { return n ? `Rp ${new Intl.NumberFormat('id-ID').format(n)}` : '—'; }
function fmt(n)   { return new Intl.NumberFormat('id-ID').format(n || 0); }

function KPICard({ label, value, sub, color, bg, icon: Icon }) {
  return (
    <Card className={`${bg} border-0`}>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="p-2 rounded-lg bg-white/60 dark:bg-black/20">
          <Icon size={20} className={color} />
        </div>
        <div>
          <p className="text-xl font-bold leading-tight">{value}</p>
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

const PLATFORMS = ['shopee', 'tiktok', 'tokopedia', 'instagram', 'website'];

const EMPTY_FORM = {
  product_name: '', launch_date: '', material: '', model: '',
  original_price: '', flash_sale_price: '', cross_price: '', listing_price: '',
  platforms: [], description: '', status: 'planning', launch_notes: ''
};

export default function ProductLaunchModule({ token }) {
  const { toast } = useToast();
  const authH = useMemo(() => ({ Authorization: `Bearer ${token || localStorage.getItem('auth_token')}` }), [token]);

  const [summary,    setSummary]    = useState(null);
  const [items,      setItems]      = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading,    setLoading]    = useState(true);

  const [filterStatus,  setFilterStatus]  = useState('');
  const [filterPlatform,setFilterPlatform]= useState('');
  const [search,        setSearch]        = useState('');
  const [page,          setPage]          = useState(1);
  const [viewMode,      setViewMode]      = useState('table'); // 'table' | 'timeline'

  const [showForm,    setShowForm]    = useState(false);
  const [editTarget,  setEditTarget]  = useState(null);
  const [form,        setForm]        = useState(EMPTY_FORM);
  const [formLoading, setFormLoading] = useState(false);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/api/marketing/product-launches/summary`, { headers: authH });
      if (res.data.success) setSummary(res.data.data);
    } catch {}
  }, [authH]);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, page_size: 20 };
      if (filterStatus)   params.status   = filterStatus;
      if (filterPlatform) params.platform = filterPlatform;
      if (search)         params.search   = search;
      const res = await axios.get(`${API}/api/marketing/product-launches`, { params, headers: authH });
      if (res.data.success) {
        setItems(res.data.data || []);
        setPagination(res.data.pagination);
      }
    } catch { toast({ title: 'Gagal load produk', variant: 'destructive' }); }
    finally { setLoading(false); }
  }, [page, filterStatus, filterPlatform, search, authH, toast]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  useEffect(() => { fetchItems();   }, [fetchItems]);

  const openCreate = () => { setEditTarget(null); setForm(EMPTY_FORM); setShowForm(true); };
  const openEdit   = (item) => {
    setEditTarget(item);
    setForm({
      product_name: item.product_name || '', launch_date: item.launch_date || '',
      material: item.material || '', model: item.model || '',
      original_price: item.original_price ?? '', flash_sale_price: item.flash_sale_price ?? '',
      cross_price: item.cross_price ?? '', listing_price: item.listing_price ?? '',
      platforms: item.platforms || [], description: item.description || '',
      status: item.status || 'planning', launch_notes: item.launch_notes || ''
    });
    setShowForm(true);
  };

  const togglePlatform = (p) => {
    setForm(f => ({
      ...f, platforms: f.platforms.includes(p)
        ? f.platforms.filter(x => x !== p)
        : [...f.platforms, p]
    }));
  };

  const handleSave = async () => {
    if (!form.product_name || !form.launch_date) {
      toast({ title: 'Isi Nama Produk dan Tanggal Launch', variant: 'destructive' }); return;
    }
    setFormLoading(true);
    try {
      const payload = {
        ...form,
        original_price:    parseFloat(form.original_price)    || 0,
        flash_sale_price:  parseFloat(form.flash_sale_price)  || 0,
        cross_price:       parseFloat(form.cross_price)       || 0,
        listing_price:     parseFloat(form.listing_price)     || 0,
      };
      if (editTarget) {
        await axios.put(`${API}/api/marketing/product-launches/${editTarget.id}`, payload, { headers: authH });
        toast({ title: 'Produk diperbarui' });
      } else {
        await axios.post(`${API}/api/marketing/product-launches`, payload, { headers: authH });
        toast({ title: '🚀 Produk berhasil ditambahkan' });
      }
      setShowForm(false);
      fetchSummary();
      fetchItems();
    } catch { toast({ title: 'Gagal menyimpan', variant: 'destructive' }); }
    finally { setFormLoading(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Hapus entri ini?')) return;
    try {
      await axios.delete(`${API}/api/marketing/product-launches/${id}`, { headers: authH });
      toast({ title: 'Dihapus' });
      fetchSummary();
      fetchItems();
    } catch { toast({ title: 'Gagal hapus', variant: 'destructive' }); }
  };

  const handleStatusChange = async (id, newStatus) => {
    try {
      await axios.post(`${API}/api/marketing/product-launches/${id}/status`, { status: newStatus }, { headers: authH });
      toast({ title: `Status → ${STATUS_CONFIG[newStatus]?.label}` });
      fetchSummary();
      fetchItems();
    } catch { toast({ title: 'Gagal update status', variant: 'destructive' }); }
  };

  const kpis = [
    { label: 'Total Produk',  value: fmt(summary?.total),      sub: 'Semua kategori',        color: 'text-indigo-600',  bg: 'bg-indigo-50 dark:bg-indigo-900/20', icon: Package },
    { label: 'Siap Launch',   value: fmt(summary?.ready),       sub: 'Sudah siap',            color: 'text-blue-600',    bg: 'bg-blue-50 dark:bg-blue-900/20',   icon: Clock },
    { label: 'Sudah Launch',  value: fmt(summary?.launched),    sub: 'Di pasar',              color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20', icon: CheckCircle2 },
    { label: 'Dalam 30 Hari', value: fmt(summary?.upcoming_30), sub: 'Jadwal upcoming',       color: 'text-amber-600',   bg: 'bg-amber-50 dark:bg-amber-900/20', icon: Rocket },
  ];

  // Sort items by launch_date for timeline view
  const sortedItems = [...items].sort((a, b) => a.launch_date?.localeCompare(b.launch_date) || 0);

  return (
    <div className="min-h-screen bg-background p-4 md:p-6" data-testid="product-launch-dashboard">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Product Launch Manager</h1>
          <p className="text-sm text-muted-foreground">Manajemen peluncuran produk multi-platform</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { fetchSummary(); fetchItems(); }}>
            <RefreshCw size={14} className="mr-1" />Refresh
          </Button>
          <Button size="sm" onClick={openCreate} data-testid="btn-add-launch">
            <Plus size={14} className="mr-1" />Tambah Produk
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {kpis.map(k => <KPICard key={k.label} {...k} />)}
      </div>

      {/* Filters */}
      <Card className="mb-4">
        <CardContent className="p-3 flex flex-wrap gap-2 items-center">
          <div className="flex rounded-md border overflow-hidden">
            <button onClick={() => setViewMode('table')}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${viewMode==='table' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
              📋 Tabel
            </button>
            <button onClick={() => setViewMode('timeline')}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${viewMode==='timeline' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
              📅 Timeline
            </button>
          </div>
          <Input className="h-8 text-xs w-48" placeholder="🔍 Cari produk..."
            value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          <Select value={filterStatus || 'all'} onValueChange={v => { setFilterStatus(v === 'all' ? '' : v); setPage(1); }}>
            <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Status</SelectItem>
              {Object.entries(STATUS_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterPlatform || 'all'} onValueChange={v => { setFilterPlatform(v === 'all' ? '' : v); setPage(1); }}>
            <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="Platform" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Platform</SelectItem>
              {PLATFORMS.map(p => <SelectItem key={p} value={p}>{PLATFORM_ICONS[p]} {p}</SelectItem>)}
            </SelectContent>
          </Select>
          {(filterStatus || filterPlatform || search) && (
            <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => { setFilterStatus(''); setFilterPlatform(''); setSearch(''); setPage(1); }}>
              <X size={12} className="mr-1" />Reset
            </Button>
          )}
        </CardContent>
      </Card>

      {/* TABLE VIEW */}
      {viewMode === 'table' && (
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex justify-center py-16"><Loader2 size={28} className="animate-spin text-muted-foreground" /></div>
            ) : items.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Rocket size={40} className="mx-auto mb-3 opacity-30" />
                <p className="font-medium">Belum ada produk launch</p>
                <Button size="sm" className="mt-3" onClick={openCreate}><Plus size={12} className="mr-1" />Tambah</Button>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Produk</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Bahan / Model</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Tanggal Launch</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Harga</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Platform</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Status</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, i) => (
                        <tr key={item.id} className={`border-b last:border-0 hover:bg-muted/30 transition-colors ${i%2===0?'':'bg-muted/10'}`}>
                          <td className="px-4 py-3">
                            <div className="font-medium max-w-[200px] truncate" title={item.product_name}>{item.product_name}</div>
                          </td>
                          <td className="px-4 py-3 text-xs">
                            <div>{item.material || '—'}</div>
                            <div className="text-muted-foreground">{item.model || ''}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-mono text-xs">{item.launch_date}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-xs space-y-0.5">
                              {item.listing_price > 0 && <div className="font-semibold text-emerald-600">{fmtRp(item.listing_price)}</div>}
                              {item.flash_sale_price > 0 && item.flash_sale_price !== item.listing_price && (
                                <div className="text-blue-600">Flash: {fmtRp(item.flash_sale_price)}</div>
                              )}
                              {item.cross_price > 0 && <div className="line-through text-muted-foreground">{fmtRp(item.cross_price)}</div>}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-0.5">
                              {(item.platforms || []).map(p => (
                                <span key={p} className="text-sm" title={p}>{PLATFORM_ICONS[p] || '📌'}</span>
                              ))}
                              {(!item.platforms || item.platforms.length === 0) && <span className="text-muted-foreground">—</span>}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge status={item.status} />
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1">
                              <Select value={item.status} onValueChange={v => handleStatusChange(item.id, v)}>
                                <SelectTrigger className="h-7 w-28 text-xs px-2">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                                    <SelectItem key={k} value={k} className="text-xs">{v.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(item)}>
                                <Pencil size={12} />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-600" onClick={() => handleDelete(item.id)}>
                                <Trash2 size={12} />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {pagination && pagination.total_pages > 1 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t">
                    <p className="text-xs text-muted-foreground">{pagination.total} produk</p>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>‹ Prev</Button>
                      <span className="px-3 py-1.5 text-xs">{page} / {pagination.total_pages}</span>
                      <Button size="sm" variant="outline" disabled={page >= pagination.total_pages} onClick={() => setPage(p => p + 1)}>Next ›</Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* TIMELINE VIEW */}
      {viewMode === 'timeline' && (
        <Card>
          <CardContent className="p-4">
            {loading ? (
              <div className="flex justify-center py-16"><Loader2 size={28} className="animate-spin text-muted-foreground" /></div>
            ) : sortedItems.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Rocket size={40} className="mx-auto mb-3 opacity-30" />
                <p>Belum ada produk launch</p>
              </div>
            ) : (
              <div className="relative">
                {/* Timeline line */}
                <div className="absolute left-[19px] top-2 bottom-2 w-0.5 bg-border" />
                <div className="space-y-4">
                  {sortedItems.map(item => {
                    const sc = STATUS_CONFIG[item.status] || STATUS_CONFIG.planning;
                    const Icon = sc.icon;
                    const today = new Date().toISOString().split('T')[0];
                    const isPast = item.launch_date < today;
                    const isToday = item.launch_date === today;
                    return (
                      <div key={item.id} className="flex gap-4">
                        {/* Dot */}
                        <div className={`relative z-10 flex-shrink-0 w-10 h-10 rounded-full border-2 flex items-center justify-center ${
                          item.status === 'launched' ? 'bg-emerald-500 border-emerald-500 text-white' :
                          item.status === 'ready'    ? 'bg-blue-500 border-blue-500 text-white' :
                          item.status === 'cancelled'? 'bg-red-400 border-red-400 text-white' :
                          isToday                    ? 'bg-primary border-primary text-primary-foreground' :
                          'bg-background border-border text-muted-foreground'
                        }`}>
                          <Icon size={16} />
                        </div>
                        {/* Content */}
                        <Card className="flex-1 p-3 hover:shadow-md transition-shadow">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-sm">{item.product_name}</span>
                                <StatusBadge status={item.status} />
                              </div>
                              <div className="text-xs text-muted-foreground mt-1">
                                📅 {item.launch_date}
                                {item.material && ` · ${item.material}`}
                                {item.model && ` · ${item.model}`}
                              </div>
                              <div className="flex items-center gap-2 mt-1.5">
                                {item.listing_price > 0 && (
                                  <span className="text-xs font-medium text-emerald-600">{fmtRp(item.listing_price)}</span>
                                )}
                                {(item.platforms || []).map(p => (
                                  <span key={p} className="text-sm" title={p}>{PLATFORM_ICONS[p] || '📌'}</span>
                                ))}
                              </div>
                            </div>
                            <div className="flex gap-1">
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(item)}>
                                <Pencil size={12} />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-600" onClick={() => handleDelete(item.id)}>
                                <Trash2 size={12} />
                              </Button>
                            </div>
                          </div>
                        </Card>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* FORM DIALOG */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Rocket size={18} className="text-primary" />
              {editTarget ? 'Edit Produk Launch' : 'Tambah Produk Launch'}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 max-h-[65vh] overflow-y-auto pr-1">
            <div className="col-span-2">
              <Label>Nama Produk *</Label>
              <Input value={form.product_name} onChange={e => setForm(f => ({...f, product_name: e.target.value}))}
                placeholder="Gamis Busui Friendly DA-2026" className="mt-1" />
            </div>
            <div>
              <Label>Tanggal Launch *</Label>
              <Input type="date" value={form.launch_date} onChange={e => setForm(f => ({...f, launch_date: e.target.value}))} className="mt-1" />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({...f, status: v}))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Bahan</Label>
              <Input value={form.material} onChange={e => setForm(f => ({...f, material: e.target.value}))}
                placeholder="Katun Linen Premium" className="mt-1" />
            </div>
            <div>
              <Label>Model</Label>
              <Input value={form.model} onChange={e => setForm(f => ({...f, model: e.target.value}))}
                placeholder="Gamis, Tunik, dst" className="mt-1" />
            </div>
            <div>
              <Label>Harga Asli (Rp)</Label>
              <Input type="number" min="0" value={form.original_price} onChange={e => setForm(f => ({...f, original_price: e.target.value}))}
                placeholder="0" className="mt-1" />
            </div>
            <div>
              <Label>Harga Pasang / Listing (Rp)</Label>
              <Input type="number" min="0" value={form.listing_price} onChange={e => setForm(f => ({...f, listing_price: e.target.value}))}
                placeholder="0" className="mt-1" />
            </div>
            <div>
              <Label>Harga Flash Sale (Rp)</Label>
              <Input type="number" min="0" value={form.flash_sale_price} onChange={e => setForm(f => ({...f, flash_sale_price: e.target.value}))}
                placeholder="0" className="mt-1" />
            </div>
            <div>
              <Label>Harga Coret (Rp)</Label>
              <Input type="number" min="0" value={form.cross_price} onChange={e => setForm(f => ({...f, cross_price: e.target.value}))}
                placeholder="0" className="mt-1" />
            </div>
            <div className="col-span-2">
              <Label>Platform Target</Label>
              <div className="mt-1 flex flex-wrap gap-2">
                {PLATFORMS.map(p => (
                  <button key={p} type="button"
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                      form.platforms.includes(p)
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background border-border hover:border-primary/50'
                    }`}
                    onClick={() => togglePlatform(p)}
                  >
                    {PLATFORM_ICONS[p]} {p.charAt(0).toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="col-span-2">
              <Label>Deskripsi</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))}
                placeholder="Detail produk..." rows={2} className="mt-1" />
            </div>
            <div className="col-span-2">
              <Label>Catatan Launch</Label>
              <Textarea value={form.launch_notes} onChange={e => setForm(f => ({...f, launch_notes: e.target.value}))}
                placeholder="Persiapan, checklist, dll..." rows={2} className="mt-1" />
            </div>
          </div>
          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => setShowForm(false)}>Batal</Button>
            <Button onClick={handleSave} disabled={formLoading}>
              {formLoading && <Loader2 size={14} className="mr-2 animate-spin" />}
              {editTarget ? 'Simpan Perubahan' : '🚀 Tambah Produk'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
