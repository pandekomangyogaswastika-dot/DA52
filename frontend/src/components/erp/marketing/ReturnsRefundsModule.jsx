import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  RotateCcw, Plus, Pencil, Trash2, RefreshCw, CheckCircle2, Clock, XCircle,
  AlertCircle, Filter, X, Loader2, ThumbsUp, ThumbsDown
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useMarketingAccounts, getPlatformIcon } from '@/hooks/useMarketingAccounts';
import { useActiveMarketingAccount } from '@/hooks/useActiveMarketingAccount';
import { ActiveAccountBar } from './ActiveAccountBar';
import axios from 'axios';

const API = process.env.REACT_APP_BACKEND_URL;

const PLATFORM_ICONS = { shopee: '🛍️', tiktok: '🎵', tokopedia: '🟢', instagram: '📷' };
const STATUS_CONFIG = {
  pending:   { label: 'Menunggu', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300', icon: Clock },
  approved:  { label: 'Disetujui', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300', icon: ThumbsUp },
  completed: { label: 'Selesai', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300', icon: CheckCircle2 },
  rejected:  { label: 'Ditolak', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300', icon: ThumbsDown },
};

function KPICard({ label, value, sub, color, bg, icon: Icon }) {
  return (
    <Card className={`${bg} border-0`}>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`p-2 rounded-lg bg-white/60 dark:bg-black/20`}>
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

const EMPTY_FORM = {
  account_id: '', account_name: '',
  date: '', order_id: '', platform: 'shopee', product: '', price: 0,
  reason: 'ukuran_salah', reason_detail: '', courier: 'jnt', refund_type: 'full_refund', notes: ''
};

export default function ReturnsRefundsModule({ token }) {
  const { toast } = useToast();
  const authH = useMemo(() => ({ Authorization: `Bearer ${token || localStorage.getItem('auth_token')}` }), [token]);
  const { accounts: masterAccounts, byId: accountById } = useMarketingAccounts(token);
  const { activeAccount, setActiveAccount } = useActiveMarketingAccount();
  const [summary, setSummary] = useState(null);
  const [returns, setReturns] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [reasons, setReasons] = useState([]);

  const [loading, setLoading] = useState(true);

  const [filterStatus, setFilterStatus] = useState('');
  const [filterPlatform, setFilterPlatform] = useState('');
  const [filterReason, setFilterReason] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formLoading, setFormLoading] = useState(false);

  const [showDetail, setShowDetail] = useState(null);
  const [actionLoading, setActionLoading] = useState('');

  const fetchReasons = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/api/marketing/returns/reasons`, { headers: authH });
      setReasons(res.data.reasons || []);
    } catch (e) {
      console.error('Reasons fetch error:', e);
    }
  }, [authH]);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/api/marketing/returns/summary`, { headers: authH });
      setSummary(res.data.data || {});
    } catch (e) {
      console.error('Summary fetch error:', e);
    }
  }, [authH]);

  const fetchReturns = useCallback(async (page = 1) => {
    try {
      setLoading(true);
      const params = { page, page_size: 20 };
      if (filterStatus) params.status = filterStatus;
      if (filterPlatform) params.platform = filterPlatform;
      if (filterReason) params.reason = filterReason;
      if (searchQuery) params.search = searchQuery;
      if (activeAccount?.id) params.account_id = activeAccount.id;

      const res = await axios.get(`${API}/api/marketing/returns`, { headers: authH, params });
      setReturns(res.data.data || []);
      setPagination(res.data.pagination || {});
    } catch (e) {
      console.error('Returns fetch error:', e);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authH, filterStatus, filterPlatform, filterReason, searchQuery, activeAccount]);

  useEffect(() => {
    fetchReasons();
    fetchSummary();
  }, [fetchReasons, fetchSummary]);

  useEffect(() => {
    fetchReturns(currentPage);
  }, [fetchReturns, currentPage]);

  const openForm = (ret = null) => {
    if (ret) {
      setEditTarget(ret);
      setForm({
        account_id: ret.account_id || '',
        account_name: ret.account_name || '',
        date: ret.date,
        order_id: ret.order_id,
        platform: ret.platform,
        product: ret.product,
        price: ret.price,
        reason: ret.reason,
        reason_detail: ret.reason_detail,
        courier: ret.courier,
        refund_type: ret.refund_type,
        notes: ret.notes || ''
      });
    } else {
      setEditTarget(null);
      setForm({ ...EMPTY_FORM, date: new Date().toISOString().split('T')[0] });
    }
    setShowForm(true);
  };

  // When account_id changes, auto-fill account_name & platform from master
  const handleAccountChange = (accountId) => {
    const acc = accountById[accountId];
    setForm(f => ({
      ...f,
      account_id: accountId,
      account_name: acc?.account_name || acc?.name || '',
      platform: acc?.platform || f.platform,
    }));
  };

  const closeForm = () => {
    setShowForm(false);
    setEditTarget(null);
    setForm(EMPTY_FORM);
  };

  const handleSave = async () => {
    if (!form.account_id) {
      toast({ title: 'Error', description: 'Wajib pilih Akun / Toko', variant: 'destructive' });
      return;
    }
    if (!form.order_id || !form.product || !form.reason_detail) {
      toast({ title: 'Error', description: 'Order ID, Produk, dan Alasan Detail wajib diisi', variant: 'destructive' });
      return;
    }
    try {
      setFormLoading(true);
      if (editTarget) {
        await axios.put(`${API}/api/marketing/returns/${editTarget.id}`, form, { headers: authH });
        toast({ title: 'Berhasil', description: 'Return diperbarui' });
      } else {
        await axios.post(`${API}/api/marketing/returns`, form, { headers: authH });
        toast({ title: 'Berhasil', description: 'Return ditambahkan' });
      }
      closeForm();
      fetchReturns(currentPage);
      fetchSummary();
    } catch (e) {
      toast({ title: 'Error', description: e.response?.data?.detail || e.message, variant: 'destructive' });
    } finally {
      setFormLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Hapus return ini?')) return;
    try {
      await axios.delete(`${API}/api/marketing/returns/${id}`, { headers: authH });
      toast({ title: 'Berhasil', description: 'Return dihapus' });
      fetchReturns(currentPage);
      fetchSummary();
    } catch (e) {
      toast({ title: 'Error', description: e.response?.data?.detail || e.message, variant: 'destructive' });
    }
  };

  const handleApprove = async (id) => {
    try {
      setActionLoading(id);
      await axios.post(`${API}/api/marketing/returns/${id}/approve`, {}, { headers: authH });
      toast({ title: 'Berhasil', description: 'Return disetujui' });
      fetchReturns(currentPage);
      fetchSummary();
      setShowDetail(null);
    } catch (e) {
      toast({ title: 'Error', description: e.response?.data?.detail || e.message, variant: 'destructive' });
    } finally {
      setActionLoading('');
    }
  };

  const handleReject = async (id, notes) => {
    try {
      setActionLoading(id);
      await axios.post(`${API}/api/marketing/returns/${id}/reject`, { notes }, { headers: authH });
      toast({ title: 'Berhasil', description: 'Return ditolak' });
      fetchReturns(currentPage);
      fetchSummary();
      setShowDetail(null);
    } catch (e) {
      toast({ title: 'Error', description: e.response?.data?.detail || e.message, variant: 'destructive' });
    } finally {
      setActionLoading('');
    }
  };

  const handleComplete = async (id) => {
    try {
      setActionLoading(id);
      await axios.post(`${API}/api/marketing/returns/${id}/complete`, {}, { headers: authH });
      toast({ title: 'Berhasil', description: 'Return diselesaikan' });
      fetchReturns(currentPage);
      fetchSummary();
      setShowDetail(null);
    } catch (e) {
      toast({ title: 'Error', description: e.response?.data?.detail || e.message, variant: 'destructive' });
    } finally {
      setActionLoading('');
    }
  };

  const clearFilters = () => {
    setFilterStatus('');
    setFilterPlatform('');
    setFilterReason('');
    setSearchQuery('');
    setCurrentPage(1);
  };

  const s = summary || {};
  const activeFilters = [filterStatus, filterPlatform, filterReason, searchQuery].filter(Boolean).length;

  return (
    <div className="space-y-6" data-testid="returns-refunds-module">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Returns & Refunds Tracking</h1>
          <p className="text-sm text-muted-foreground mt-1">Kelola retur dan refund produk</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => fetchReturns(currentPage)} variant="outline" size="sm">
            <RefreshCw size={14} className="mr-1" />Refresh
          </Button>
          <Button onClick={() => openForm()} size="sm">
            <Plus size={14} className="mr-1" />Tambah Return
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <ActiveAccountBar accounts={masterAccounts} activeAccount={activeAccount} onAccountChange={acc => { setActiveAccount(acc); setCurrentPage(1); }} hint="Filter returns by akun:" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <KPICard label="Total Return" value={s.total || 0} color="text-blue-600" bg="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/30 dark:to-blue-900/30" icon={RotateCcw} />
        <KPICard label="Menunggu" value={s.pending || 0} color="text-orange-600" bg="bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-950/30 dark:to-orange-900/30" icon={Clock} />
        <KPICard label="Disetujui" value={s.approved || 0} color="text-blue-600" bg="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/30 dark:to-blue-900/30" icon={ThumbsUp} />
        <KPICard label="Selesai" value={s.completed || 0} color="text-emerald-600" bg="bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-950/30 dark:to-emerald-900/30" icon={CheckCircle2} />
        <KPICard label="Total Refund" value={`Rp ${(s.total_refund || 0).toLocaleString('id-ID')}`} color="text-purple-600" bg="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950/30 dark:to-purple-900/30" icon={RotateCcw} />
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Filter size={16} />Filter
              {activeFilters > 0 && (
                <Badge variant="secondary" className="ml-1">{activeFilters}</Badge>
              )}
            </CardTitle>
            {activeFilters > 0 && (
              <Button onClick={clearFilters} variant="ghost" size="sm">
                <X size={14} className="mr-1" />Clear
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value=" ">Semua Status</SelectItem>
                <SelectItem value="pending">Menunggu</SelectItem>
                <SelectItem value="approved">Disetujui</SelectItem>
                <SelectItem value="completed">Selesai</SelectItem>
                <SelectItem value="rejected">Ditolak</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterPlatform} onValueChange={setFilterPlatform}>
              <SelectTrigger>
                <SelectValue placeholder="Platform" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value=" ">Semua Platform</SelectItem>
                <SelectItem value="shopee">Shopee</SelectItem>
                <SelectItem value="tiktok">TikTok</SelectItem>
                <SelectItem value="tokopedia">Tokopedia</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterReason} onValueChange={setFilterReason}>
              <SelectTrigger>
                <SelectValue placeholder="Alasan" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value=" ">Semua Alasan</SelectItem>
                {reasons.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input
              placeholder="Cari order/produk..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>Daftar Return ({pagination?.total || 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="animate-spin" size={24} /></div>
          ) : returns.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">Tidak ada return</div>
          ) : (
            <div className="space-y-3">
              {returns.map(r => (
                <div key={r.id} className="border rounded-lg p-4 space-y-2 hover:bg-muted/30 transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-muted-foreground">{PLATFORM_ICONS[r.platform]} {r.platform}</span>
                        <Badge variant="outline" className="text-xs">{r.order_id}</Badge>
                        <span className="text-xs font-medium">{r.product}</span>
                        <span className="text-xs text-muted-foreground">Rp {(r.price || 0).toLocaleString('id-ID')}</span>
                        {r.status && <Badge className={STATUS_CONFIG[r.status]?.color}>{STATUS_CONFIG[r.status]?.label}</Badge>}
                      </div>
                      <p className="text-sm"><strong>Alasan:</strong> {r.reason_label} - {r.reason_detail}</p>
                      {r.notes && <p className="text-xs text-muted-foreground">Catatan: {r.notes}</p>}
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>Refund: Rp {(r.refund_amount || 0).toLocaleString('id-ID')}</span>
                        <span>•</span>
                        <span>{r.appeal_result}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      <Button onClick={() => setShowDetail(r)} variant="ghost" size="sm">
                        Detail
                      </Button>
                      <Button onClick={() => openForm(r)} variant="ghost" size="sm">
                        <Pencil size={14} />
                      </Button>
                      <Button onClick={() => handleDelete(r.id)} variant="ghost" size="sm">
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {pagination && pagination.total_pages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-muted-foreground">
                Halaman {pagination.page} dari {pagination.total_pages}
              </p>
              <div className="flex gap-1">
                <Button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  variant="outline"
                  size="sm"
                >
                  Prev
                </Button>
                <Button
                  onClick={() => setCurrentPage(p => Math.min(pagination.total_pages, p + 1))}
                  disabled={currentPage === pagination.total_pages}
                  variant="outline"
                  size="sm"
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Form Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editTarget ? 'Edit Return' : 'Tambah Return'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Akun / Toko Marketplace *</Label>
              <Select value={form.account_id || ''} onValueChange={handleAccountChange}>
                <SelectTrigger data-testid="return-account-select">
                  <SelectValue placeholder={masterAccounts.length === 0 ? 'Belum ada akun — buat di Manage Accounts' : 'Pilih akun...'} />
                </SelectTrigger>
                <SelectContent>
                  {masterAccounts.length === 0 && (
                    <SelectItem value="empty" disabled>Belum ada akun aktif</SelectItem>
                  )}
                  {masterAccounts.map(acc => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {getPlatformIcon(acc.platform)} {acc.account_name} <span className="text-xs text-muted-foreground ml-1">({acc.platform})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.account_id && (
                <p className="text-xs text-muted-foreground">
                  Platform: <strong>{form.platform}</strong> (otomatis dari akun)
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tanggal</Label>
                <Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Order ID *</Label>
                <Input value={form.order_id} onChange={e => setForm({ ...form, order_id: e.target.value })} placeholder="ORD-123456" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Harga</Label>
                <Input type="number" value={form.price} onChange={e => setForm({ ...form, price: parseFloat(e.target.value) })} />
              </div>
              <div className="space-y-2">
                <Label>Tipe Refund</Label>
                <Select value={form.refund_type} onValueChange={v => setForm({ ...form, refund_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full_refund">Full Refund</SelectItem>
                    <SelectItem value="partial_refund">Partial Refund</SelectItem>
                    <SelectItem value="exchange">Exchange</SelectItem>
                    <SelectItem value="no_refund">No Refund</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Produk *</Label>
              <Input value={form.product} onChange={e => setForm({ ...form, product: e.target.value })} placeholder="Nama produk" />
            </div>
            <div className="space-y-2">
              <Label>Alasan</Label>
              <Select value={form.reason} onValueChange={v => setForm({ ...form, reason: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {reasons.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Alasan Detail *</Label>
              <Textarea value={form.reason_detail} onChange={e => setForm({ ...form, reason_detail: e.target.value })} rows={2} placeholder="Detail alasan return..." />
            </div>
            <div className="space-y-2">
              <Label>Catatan</Label>
              <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Catatan..." />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={closeForm} variant="outline" disabled={formLoading}>Batal</Button>
            <Button onClick={handleSave} disabled={formLoading}>
              {formLoading && <Loader2 className="animate-spin mr-1" size={14} />}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={!!showDetail} onOpenChange={() => setShowDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Detail Return</DialogTitle>
          </DialogHeader>
          {showDetail && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <p className="text-sm"><strong>Order:</strong> {showDetail.order_id}</p>
                <p className="text-sm"><strong>Produk:</strong> {showDetail.product}</p>
                <p className="text-sm"><strong>Harga:</strong> Rp {(showDetail.price || 0).toLocaleString('id-ID')}</p>
                <p className="text-sm"><strong>Alasan:</strong> {showDetail.reason_label}</p>
                <p className="text-sm"><strong>Detail:</strong> {showDetail.reason_detail}</p>
                <p className="text-sm"><strong>Refund:</strong> Rp {(showDetail.refund_amount || 0).toLocaleString('id-ID')}</p>
                <p className="text-sm"><strong>Status:</strong> <Badge className={STATUS_CONFIG[showDetail.status]?.color}>{STATUS_CONFIG[showDetail.status]?.label}</Badge></p>
              </div>
              {showDetail.status === 'pending' && (
                <div className="flex gap-2">
                  <Button onClick={() => handleApprove(showDetail.id)} disabled={actionLoading === showDetail.id} className="flex-1">
                    {actionLoading === showDetail.id && <Loader2 className="animate-spin mr-1" size={14} />}
                    <ThumbsUp size={14} className="mr-1" />Setujui
                  </Button>
                  <Button onClick={() => handleReject(showDetail.id, 'Tidak memenuhi syarat')} disabled={actionLoading === showDetail.id} variant="destructive" className="flex-1">
                    {actionLoading === showDetail.id && <Loader2 className="animate-spin mr-1" size={14} />}
                    <ThumbsDown size={14} className="mr-1" />Tolak
                  </Button>
                </div>
              )}
              {showDetail.status === 'approved' && (
                <Button onClick={() => handleComplete(showDetail.id)} disabled={actionLoading === showDetail.id} className="w-full">
                  {actionLoading === showDetail.id && <Loader2 className="animate-spin mr-1" size={14} />}
                  <CheckCircle2 size={14} className="mr-1" />Selesaikan
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
