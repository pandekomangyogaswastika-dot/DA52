import { useState, useEffect, useCallback, useMemo } from 'react';
import { ClipboardList, Plus, Search, Truck, RefreshCw, X, Check, Filter } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { PageHeader } from './moduleAtoms';

const fmtIDR = (n) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;
const fmtDate = (d) => (d ? new Date(d).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : '-');

// ── Marketing SSOT status (P1.D Phase B Cutover) ─────────────────────────────
const STATUS_COLORS = {
  new: 'bg-blue-500/15 text-blue-300 border-blue-400/25',
  packed: 'bg-amber-500/15 text-amber-300 border-amber-400/25',
  shipped: 'bg-purple-500/15 text-purple-300 border-purple-400/25',
  delivered: 'bg-green-500/15 text-green-300 border-green-400/25',
  returned: 'bg-rose-500/15 text-rose-300 border-rose-400/25',
  cancelled: 'bg-red-500/15 text-red-300 border-red-400/25',
};

const STATUS_LABELS = {
  new: 'Baru',
  packed: 'Dipacking',
  shipped: 'Dikirim',
  delivered: 'Terkirim',
  returned: 'Diretur',
  cancelled: 'Batal',
};

const PLATFORM_COLORS = {
  shopee: 'text-orange-300',
  tokopedia: 'text-emerald-300',
  tiktok: 'text-pink-300',
  tiktok_shop: 'text-pink-300',
  website: 'text-sky-300',
  manual: 'text-foreground/60',
  instagram: 'text-purple-300',
};

const PLATFORM_OPTIONS = ['manual', 'shopee', 'tiktok', 'tokopedia', 'instagram', 'website'];
const COURIERS = ['JNE', 'J&T', 'SiCepat', 'AnterAja', 'JNT', 'SPX', 'Ninja', 'Gosend', 'Grab', 'Lainnya'];
const SCHEDULE_TIMES = ['08:00', '13:00', '15:00'];

const emptyOrder = {
  platform: 'manual',
  order_id: '',
  customer_name: '',
  customer_address: '',
  city: '',
  customer_phone: '',
  items: [{ sku_code: '', product_name: '', qty: 1, price: 0, variant: '' }],
  total_payment: 0,
  fee_amount: 0,
  shipping_cost: 0,
  courier: '',
  note: '',
};

export default function TokoOrdersModule({ token, defaultTab = 'orders' }) {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }), [token]);
  const [activeTab, setActiveTab] = useState(defaultTab);

  // Orders state
  const [orders, setOrders] = useState([]);
  const [summary, setSummary] = useState(null);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [orderSearch, setOrderSearch] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState('all');
  const [orderPlatformFilter, setOrderPlatformFilter] = useState('all');
  const [newOrderDialog, setNewOrderDialog] = useState(false);
  const [orderForm, setOrderForm] = useState(emptyOrder);
  const [savingOrder, setSavingOrder] = useState(false);
  const [statusDialog, setStatusDialog] = useState(null); // {order, newStatus}
  const [trackingInput, setTrackingInput] = useState('');

  // Pack batches state (preserved at /api/dewi/toko/pack-batches)
  const [batches, setBatches] = useState([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [newOrders, setNewOrders] = useState([]);
  const [selectedOrderIds, setSelectedOrderIds] = useState([]);
  const [scheduleTime, setScheduleTime] = useState('13:00');
  const [creatingBatch, setCreatingBatch] = useState(false);

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const params = new URLSearchParams();
      if (orderStatusFilter !== 'all') params.set('status', orderStatusFilter);
      if (orderPlatformFilter !== 'all') params.set('platform', orderPlatformFilter);
      if (orderSearch) params.set('search', orderSearch);
      params.set('page_size', '100');
      const [rOrders, rSummary] = await Promise.all([
        fetch(`/api/marketing/orders?${params}`, { headers }),
        fetch('/api/marketing/orders/summary', { headers }),
      ]);
      if (rOrders.ok) {
        const j = await rOrders.json();
        setOrders(j.orders || []);
      }
      if (rSummary.ok) {
        setSummary(await rSummary.json());
      }
    } finally {
      setOrdersLoading(false);
    }
  }, [headers, orderStatusFilter, orderPlatformFilter, orderSearch]);

  const loadBatches = useCallback(async () => {
    setBatchLoading(true);
    try {
      // Pack-batches still uses legacy endpoint (preserved collection)
      const [rBatches, rNew] = await Promise.all([
        fetch('/api/dewi/toko/pack-batches', { headers }),
        fetch('/api/marketing/orders?status=new&page_size=200', { headers }),
      ]);
      if (rBatches.ok) setBatches(await rBatches.json());
      if (rNew.ok) {
        const j = await rNew.json();
        setNewOrders(j.orders || []);
      }
    } finally {
      setBatchLoading(false);
    }
  }, [headers]);

  useEffect(() => { loadOrders(); }, [loadOrders]);
  useEffect(() => { if (activeTab === 'packing') loadBatches(); }, [activeTab, loadBatches]);

  const saveOrder = async () => {
    if (!orderForm.customer_name.trim()) {
      toast.error('Nama customer wajib diisi');
      return;
    }
    const validItems = orderForm.items.filter((i) => i.sku_code && i.product_name);
    if (validItems.length === 0) {
      toast.error('Minimal 1 item dengan SKU dan nama produk wajib');
      return;
    }
    setSavingOrder(true);
    try {
      const body = {
        platform: orderForm.platform,
        order_id: orderForm.order_id || undefined,
        customer_name: orderForm.customer_name,
        customer_address: orderForm.customer_address,
        city: orderForm.city,
        customer_phone: orderForm.customer_phone,
        items: validItems.map((i) => ({
          sku_code: i.sku_code,
          product_name: i.product_name,
          qty: Number(i.qty),
          price: Number(i.price),
          variant: i.variant || '',
        })),
        total_payment: Number(orderForm.total_payment),
        fee_amount: Number(orderForm.fee_amount),
        shipping_cost: Number(orderForm.shipping_cost),
        courier: orderForm.courier,
        note: orderForm.note,
      };
      const r = await fetch('/api/marketing/orders', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || 'Gagal');
      toast.success(`Order ${d.order_id || d.id?.slice(0, 8)} dibuat`);
      setNewOrderDialog(false);
      setOrderForm(emptyOrder);
      loadOrders();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSavingOrder(false);
    }
  };

  const updateOrderStatus = async (orderId, newStatus, tracking) => {
    const body = { status: newStatus };
    if (tracking) body.tracking_number = tracking;
    const r = await fetch(`/api/marketing/orders/${orderId}/status`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const d = await r.json();
      toast.error(d.detail || 'Gagal');
      return;
    }
    toast.success(`Status: ${STATUS_LABELS[newStatus]}`);
    setStatusDialog(null);
    loadOrders();
  };

  const cancelOrder = async (orderId) => {
    if (!window.confirm('Batalkan order ini?')) return;
    // Use PATCH to cancelled (soft cancel, keeps record)
    const r = await fetch(`/api/marketing/orders/${orderId}/status`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'cancelled' }),
    });
    if (!r.ok) {
      const d = await r.json();
      toast.error(d.detail || 'Gagal');
      return;
    }
    toast.success('Order dibatalkan');
    loadOrders();
  };

  const deleteOrder = async (orderId) => {
    if (!window.confirm('Hapus permanent order ini? (Tidak bisa di-undo)')) return;
    const r = await fetch(`/api/marketing/orders/${orderId}`, { method: 'DELETE', headers });
    if (!r.ok) {
      const d = await r.json();
      toast.error(d.detail || 'Gagal');
      return;
    }
    toast.success('Order dihapus');
    loadOrders();
  };

  const createBatch = async () => {
    if (!selectedOrderIds.length) {
      toast.error('Pilih minimal 1 order');
      return;
    }
    setCreatingBatch(true);
    try {
      // pack-batches still uses legacy endpoint (preserved)
      const r = await fetch('/api/dewi/toko/pack-batches', {
        method: 'POST',
        headers,
        body: JSON.stringify({ schedule_time: scheduleTime, order_ids: selectedOrderIds }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || 'Gagal');
      toast.success(`${d.batch_code} dibuat`);
      setSelectedOrderIds([]);
      loadBatches();
      loadOrders();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setCreatingBatch(false);
    }
  };

  const closeBatch = async (batchId) => {
    const r = await fetch(`/api/dewi/toko/pack-batches/${batchId}/close`, { method: 'POST', headers });
    const d = await r.json();
    if (!r.ok) {
      toast.error(d.detail || 'Gagal');
      return;
    }
    toast.success('Batch ditutup');
    loadBatches();
  };

  const toggleOrderSelect = (id) => {
    setSelectedOrderIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const nextStatuses = {
    new: ['packed', 'cancelled'],
    packed: ['shipped', 'cancelled'],
    shipped: ['delivered'],
    delivered: ['returned'],
  };

  // Summary panel uses marketing summary shape
  const summaryCards = useMemo(() => {
    if (!summary) return [];
    const bs = summary.by_status || {};
    return [
      { k: 'new', l: 'Baru', val: bs.new || 0, color: 'text-blue-400' },
      { k: 'packed', l: 'Dipacking', val: bs.packed || 0, color: 'text-amber-400' },
      { k: 'shipped', l: 'Dikirim', val: bs.shipped || 0, color: 'text-purple-400' },
      { k: 'delivered', l: 'Terkirim', val: bs.delivered || 0, color: 'text-green-400' },
      { k: 'today', l: 'Order Hari Ini', val: summary.today?.orders || 0, color: 'text-foreground/70' },
    ];
  }, [summary]);

  return (
    <div className="p-6 space-y-6" data-testid="toko-orders-module">
      <PageHeader
        title="Manajemen Pesanan"
        description="Pesanan marketplace (marketing SSOT), packing batch harian, dan tracking pengiriman"
        icon={ClipboardList}
        actions={
          <Button
            size="sm"
            onClick={() => { setNewOrderDialog(true); setOrderForm(emptyOrder); }}
            className="gap-1.5"
            data-testid="btn-new-order"
          >
            <Plus className="w-3.5 h-3.5" /> Order Baru
          </Button>
        }
      />

      {/* Summary */}
      {summaryCards.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3" data-testid="orders-summary">
          {summaryCards.map(({ k, l, val, color }) => (
            <GlassCard key={k} className="p-3 text-center">
              <div className={`text-2xl font-bold tabular-nums ${color}`}>{val}</div>
              <div className="text-xs text-foreground/55 mt-0.5">{l}</div>
            </GlassCard>
          ))}
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="orders" data-testid="tab-orders">Pesanan</TabsTrigger>
          <TabsTrigger value="packing" data-testid="tab-packing">Packing Batch</TabsTrigger>
          <TabsTrigger value="shipping" data-testid="tab-shipping">Pengiriman</TabsTrigger>
        </TabsList>

        {/* ORDERS TAB */}
        <TabsContent value="orders" className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            <div className="relative flex-1 min-w-40">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-foreground/40" />
              <Input
                placeholder="Cari nama customer / nomor order / SKU..."
                value={orderSearch}
                onChange={(e) => setOrderSearch(e.target.value)}
                className="pl-8"
                data-testid="input-order-search"
              />
            </div>
            <Select value={orderStatusFilter} onValueChange={setOrderStatusFilter}>
              <SelectTrigger className="w-36" data-testid="order-status-filter">
                <Filter className="w-3.5 h-3.5 mr-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                {Object.entries(STATUS_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={orderPlatformFilter} onValueChange={setOrderPlatformFilter}>
              <SelectTrigger className="w-32" data-testid="order-platform-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Platform</SelectItem>
                {PLATFORM_OPTIONS.map((p) => (
                  <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={loadOrders} className="gap-1">
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          </div>

          {ordersLoading ? (
            <div className="text-center py-10 text-foreground/40">Memuat...</div>
          ) : orders.length === 0 ? (
            <GlassCard className="p-10 text-center">
              <ClipboardList className="w-10 h-10 mx-auto mb-3 text-foreground/25" />
              <p className="text-foreground/50 text-sm">Belum ada pesanan</p>
              <Button size="sm" className="mt-3" onClick={() => { setNewOrderDialog(true); setOrderForm(emptyOrder); }}>
                + Order Baru
              </Button>
            </GlassCard>
          ) : (
            <div className="space-y-2">
              {orders.map((o) => (
                <GlassCard key={o.id} className="p-4" data-testid={`order-row-${o.id}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-semibold">{o.order_id}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_COLORS[o.status] || ''}`}>
                          {STATUS_LABELS[o.status] || o.status}
                        </span>
                        <span className={`text-xs font-medium capitalize ${PLATFORM_COLORS[o.platform] || ''}`}>
                          {o.platform}
                        </span>
                        {o.account_name && o.account_name !== o.platform && (
                          <span className="text-xs text-foreground/45">({o.account_name})</span>
                        )}
                      </div>
                      <div className="text-sm font-medium mt-1">{o.customer_name}</div>
                      <div className="text-xs text-foreground/60 mt-0.5">
                        {o.product_name}{o.variation ? ` • ${o.variation}` : ''}
                      </div>
                      {o.city && <div className="text-xs text-foreground/50">{o.city}</div>}
                      <div className="flex gap-3 mt-1.5 text-xs text-foreground/50 flex-wrap">
                        <span>{o.quantity || 0}x</span>
                        <span className="font-semibold text-foreground/70">{fmtIDR(o.total_payment)}</span>
                        {o.tracking_number && <span className="font-mono text-primary">{o.tracking_number}</span>}
                        {o.courier && <span>{o.courier}</span>}
                        <span>{fmtDate(o.order_date || o.created_at)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {(nextStatuses[o.status] || []).map((ns) => (
                        <Button
                          key={ns}
                          size="sm"
                          variant={ns === 'cancelled' || ns === 'returned' ? 'destructive' : 'default'}
                          className="text-xs h-7 px-2"
                          onClick={() => {
                            if (ns === 'shipped') {
                              setStatusDialog({ order: o, newStatus: ns });
                              setTrackingInput(o.tracking_number || '');
                            } else if (ns === 'cancelled') {
                              cancelOrder(o.id);
                            } else {
                              updateOrderStatus(o.id, ns);
                            }
                          }}
                          data-testid={`btn-status-${o.id}-${ns}`}
                        >
                          {ns === 'packed' ? 'Pack' : ns === 'shipped' ? 'Kirim' : ns === 'delivered' ? 'Terima' : ns === 'returned' ? 'Retur' : 'Batal'}
                        </Button>
                      ))}
                      {['cancelled', 'returned'].includes(o.status) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-xs h-7 text-red-400"
                          onClick={() => deleteOrder(o.id)}
                          data-testid={`btn-delete-${o.id}`}
                          title="Hapus permanen"
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </GlassCard>
              ))}
            </div>
          )}
        </TabsContent>

        {/* PACKING TAB */}
        <TabsContent value="packing" className="space-y-4">
          <GlassCard className="p-4">
            <div className="font-semibold text-sm mb-3">Buat Batch Packing Baru</div>
            <div className="flex items-center gap-3 mb-3">
              <Label className="text-xs text-foreground/60">Jadwal:</Label>
              <Select value={scheduleTime} onValueChange={setScheduleTime}>
                <SelectTrigger className="w-28" data-testid="select-schedule-time"><SelectValue /></SelectTrigger>
                <SelectContent>{SCHEDULE_TIMES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
              <span className="text-xs text-foreground/45">{selectedOrderIds.length} order dipilih</span>
              <Button
                size="sm"
                onClick={createBatch}
                disabled={!selectedOrderIds.length || creatingBatch}
                data-testid="btn-create-batch"
              >
                {creatingBatch ? 'Membuat...' : 'Buat Batch'}
              </Button>
            </div>
            {newOrders.length === 0 ? (
              <p className="text-xs text-foreground/40">Tidak ada order berstatus Baru untuk dipacking</p>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {newOrders.map((o) => (
                  <div
                    key={o.id}
                    className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                      selectedOrderIds.includes(o.id) ? 'border-primary/40 bg-primary/5' : 'border-foreground/10 hover:bg-foreground/5'
                    }`}
                    onClick={() => toggleOrderSelect(o.id)}
                    data-testid={`pack-order-${o.id}`}
                  >
                    <div
                      className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                        selectedOrderIds.includes(o.id) ? 'bg-primary border-primary' : 'border-foreground/30'
                      }`}
                    >
                      {selectedOrderIds.includes(o.id) && <Check className="w-3 h-3 text-primary-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="font-mono text-xs">{o.order_id}</span>
                      <span className="text-xs text-foreground/60 ml-2">{o.customer_name}</span>
                      <span className="text-xs text-foreground/40 ml-2 capitalize">{o.platform}</span>
                    </div>
                    <span className="text-xs text-foreground/50">{fmtIDR(o.total_payment)}</span>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>

          <div className="font-semibold text-sm">Riwayat Batch</div>
          {batchLoading ? (
            <div className="text-center py-8 text-foreground/40">Memuat...</div>
          ) : batches.length === 0 ? (
            <GlassCard className="p-8 text-center text-foreground/40 text-sm">Belum ada batch packing</GlassCard>
          ) : (
            <div className="space-y-2">
              {batches.map((b) => (
                <GlassCard
                  key={b.id}
                  className="p-3 flex items-center justify-between"
                  data-testid={`batch-row-${b.id}`}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{b.batch_code}</span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full border ${
                          b.status === 'open'
                            ? 'bg-amber-500/15 text-amber-300 border-amber-400/25'
                            : 'bg-foreground/10 text-foreground/50 border-foreground/15'
                        }`}
                      >
                        {b.status === 'open' ? 'Terbuka' : 'Ditutup'}
                      </span>
                    </div>
                    <div className="text-xs text-foreground/50 mt-0.5">
                      {b.batch_name} &bull; {b.schedule_time} &bull; {b.total_orders} order
                    </div>
                  </div>
                  {b.status === 'open' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => closeBatch(b.id)}
                      className="text-xs h-7"
                      data-testid={`btn-close-batch-${b.id}`}
                    >
                      Tutup
                    </Button>
                  )}
                </GlassCard>
              ))}
            </div>
          )}
        </TabsContent>

        {/* SHIPPING TAB */}
        <TabsContent value="shipping" className="space-y-4">
          <div className="text-xs text-foreground/50 mb-2">Order yang sudah dipacking dan siap dikirim</div>
          {ordersLoading ? (
            <div className="text-center py-8 text-foreground/40">Memuat...</div>
          ) : (
            <div className="space-y-2">
              {orders.filter((o) => ['packed', 'shipped'].includes(o.status)).map((o) => (
                <GlassCard key={o.id} className="p-4" data-testid={`shipping-row-${o.id}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold">{o.order_id}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_COLORS[o.status]}`}>
                          {STATUS_LABELS[o.status]}
                        </span>
                      </div>
                      <div className="text-sm mt-1">{o.customer_name}</div>
                      <div className="text-xs text-foreground/50">{o.customer_address} {o.city}</div>
                      {o.courier && <div className="text-xs text-foreground/60 mt-0.5">Kurir: {o.courier}</div>}
                      {o.tracking_number && <div className="text-xs font-mono text-primary">{o.tracking_number}</div>}
                    </div>
                    <div className="flex gap-1.5">
                      {o.status === 'packed' && (
                        <Button
                          size="sm"
                          className="text-xs h-7"
                          onClick={() => { setStatusDialog({ order: o, newStatus: 'shipped' }); setTrackingInput(''); }}
                          data-testid={`btn-ship-${o.id}`}
                        >
                          <Truck className="w-3 h-3 mr-1" /> Input Resi
                        </Button>
                      )}
                      {o.status === 'shipped' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs h-7"
                          onClick={() => updateOrderStatus(o.id, 'delivered')}
                          data-testid={`btn-delivered-${o.id}`}
                        >
                          <Check className="w-3 h-3 mr-1" /> Konfirmasi Terima
                        </Button>
                      )}
                    </div>
                  </div>
                </GlassCard>
              ))}
              {orders.filter((o) => ['packed', 'shipped'].includes(o.status)).length === 0 && (
                <GlassCard className="p-8 text-center text-foreground/40 text-sm">
                  Tidak ada order menunggu pengiriman
                </GlassCard>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* New Order Dialog */}
      <Dialog open={newOrderDialog} onOpenChange={setNewOrderDialog}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="dialog-new-order">
          <DialogHeader><DialogTitle>Order Baru</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Platform</Label>
                <Select value={orderForm.platform} onValueChange={(v) => setOrderForm((f) => ({ ...f, platform: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PLATFORM_OPTIONS.map((c) => (
                      <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">No. Ref Marketplace</Label>
                <Input
                  className="mt-1"
                  placeholder="Auto-generate jika kosong"
                  value={orderForm.order_id}
                  onChange={(e) => setOrderForm((f) => ({ ...f, order_id: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Nama Customer *</Label>
              <Input
                className="mt-1"
                value={orderForm.customer_name}
                onChange={(e) => setOrderForm((f) => ({ ...f, customer_name: e.target.value }))}
                data-testid="input-customer-name"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Kota</Label>
                <Input
                  className="mt-1"
                  value={orderForm.city}
                  onChange={(e) => setOrderForm((f) => ({ ...f, city: e.target.value }))}
                />
              </div>
              <div>
                <Label className="text-xs">No. HP</Label>
                <Input
                  className="mt-1"
                  value={orderForm.customer_phone}
                  onChange={(e) => setOrderForm((f) => ({ ...f, customer_phone: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Alamat</Label>
              <Textarea
                className="mt-1"
                rows={2}
                value={orderForm.customer_address}
                onChange={(e) => setOrderForm((f) => ({ ...f, customer_address: e.target.value }))}
              />
            </div>
            {/* Items */}
            <div>
              <Label className="text-xs mb-1 block">Item Pesanan *</Label>
              {orderForm.items.map((item, idx) => (
                <div key={idx} className="flex gap-2 mb-1.5">
                  <Input
                    placeholder="SKU"
                    className="w-28"
                    value={item.sku_code}
                    onChange={(e) => {
                      const items = [...orderForm.items];
                      items[idx].sku_code = e.target.value.toUpperCase();
                      setOrderForm((f) => ({ ...f, items }));
                    }}
                    data-testid={`input-item-sku-${idx}`}
                  />
                  <Input
                    placeholder="Nama produk"
                    className="flex-1"
                    value={item.product_name}
                    onChange={(e) => {
                      const items = [...orderForm.items];
                      items[idx].product_name = e.target.value;
                      setOrderForm((f) => ({ ...f, items }));
                    }}
                    data-testid={`input-item-product-${idx}`}
                  />
                  <Input
                    placeholder="Qty"
                    type="number"
                    className="w-14"
                    min={1}
                    value={item.qty}
                    onChange={(e) => {
                      const items = [...orderForm.items];
                      items[idx].qty = Number(e.target.value);
                      setOrderForm((f) => ({ ...f, items }));
                    }}
                  />
                  <Input
                    placeholder="Harga"
                    type="number"
                    className="w-24"
                    min={0}
                    value={item.price}
                    onChange={(e) => {
                      const items = [...orderForm.items];
                      items[idx].price = Number(e.target.value);
                      setOrderForm((f) => ({ ...f, items }));
                    }}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-9 w-9"
                    onClick={() => setOrderForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }))}
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                className="text-xs mt-1"
                onClick={() => setOrderForm((f) => ({ ...f, items: [...f.items, { sku_code: '', product_name: '', qty: 1, price: 0, variant: '' }] }))}
              >
                + Item
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Total Pembayaran (Rp)</Label>
                <Input
                  type="number"
                  className="mt-1"
                  min={0}
                  value={orderForm.total_payment}
                  onChange={(e) => setOrderForm((f) => ({ ...f, total_payment: e.target.value }))}
                  data-testid="input-total-payment"
                />
              </div>
              <div>
                <Label className="text-xs">Fee Platform (Rp)</Label>
                <Input
                  type="number"
                  className="mt-1"
                  min={0}
                  value={orderForm.fee_amount}
                  onChange={(e) => setOrderForm((f) => ({ ...f, fee_amount: e.target.value }))}
                />
              </div>
              <div>
                <Label className="text-xs">Ongkir (Rp)</Label>
                <Input
                  type="number"
                  className="mt-1"
                  min={0}
                  value={orderForm.shipping_cost}
                  onChange={(e) => setOrderForm((f) => ({ ...f, shipping_cost: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Kurir</Label>
              <Select value={orderForm.courier} onValueChange={(v) => setOrderForm((f) => ({ ...f, courier: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Pilih kurir" /></SelectTrigger>
                <SelectContent>
                  {COURIERS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Catatan</Label>
              <Textarea
                className="mt-1"
                rows={2}
                value={orderForm.note}
                onChange={(e) => setOrderForm((f) => ({ ...f, note: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOrderDialog(false)}>Batal</Button>
            <Button onClick={saveOrder} disabled={savingOrder} data-testid="btn-save-order">
              {savingOrder ? 'Menyimpan...' : 'Simpan Order'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Status update dialog (for shipping — needs tracking) */}
      <Dialog open={!!statusDialog} onOpenChange={() => setStatusDialog(null)}>
        <DialogContent className="max-w-sm" data-testid="dialog-status-update">
          <DialogHeader><DialogTitle>Input Nomor Resi</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">Kurir</Label>
              <Select
                value={statusDialog?.order?.courier || ''}
                onValueChange={(v) => setStatusDialog((d) => ({ ...d, order: { ...d.order, courier: v } }))}
              >
                <SelectTrigger className="mt-1"><SelectValue placeholder="Pilih kurir" /></SelectTrigger>
                <SelectContent>
                  {COURIERS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Nomor Resi *</Label>
              <Input
                className="mt-1"
                placeholder="Masukkan nomor resi"
                value={trackingInput}
                onChange={(e) => setTrackingInput(e.target.value)}
                data-testid="input-tracking"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusDialog(null)}>Batal</Button>
            <Button
              onClick={() => updateOrderStatus(statusDialog.order.id, 'shipped', trackingInput)}
              disabled={!trackingInput.trim()}
              data-testid="btn-confirm-ship"
            >
              Konfirmasi Kirim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
