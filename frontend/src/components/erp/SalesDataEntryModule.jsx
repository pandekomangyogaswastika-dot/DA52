import { useState, useEffect, useCallback, useMemo } from 'react';
import { TrendingUp, Plus, RefreshCw, Loader2, Calendar } from 'lucide-react';
import { useActiveMarketingAccount } from '@/hooks/useActiveMarketingAccount';
import { ActiveAccountBar } from './marketing/ActiveAccountBar';
import { AccountBadge, getPlatformConfig } from './marketing/AccountBadge';
import { GlassCard, GlassPanel, GlassInput } from '@/components/ui/glass';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageHeader } from './moduleAtoms';
import { toast } from 'sonner';

const fmt = (n) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;
const fmtNum = (n) => Number(n || 0).toLocaleString('id-ID');

function SalesDataEntryDialog({ open, onOpenChange, onSaved, token, accounts, preSelectedAccountId }) {
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState('total');
  const [form, setForm] = useState({
    account_id: '',
    date: new Date().toISOString().slice(0, 10),
    revenue: '',
    orders: '',
    aov: '',
    gmv: '',
    conversion_rate: '',
    fulfillment_rate: '',
    cancellation_rate: '',
    return_rate: '',
    late_shipment_rate: '',
    rating: '',
    review_count: '',
    response_rate: '',
    response_time_hours: '',
    // live-only
    viewers: '',
    avg_viewers: '',
    likes: '',
    shares: '',
    comments: '',
    new_followers: '',
    live_sessions: '',
  });

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  useEffect(() => {
    if (!open) {
      // reset form on close
      setActiveTab('total');
      setForm({
        account_id: preSelectedAccountId || '',
        date: new Date().toISOString().slice(0, 10),
        revenue: '',
        orders: '',
        aov: '',
        gmv: '',
        conversion_rate: '',
        fulfillment_rate: '',
        cancellation_rate: '',
        return_rate: '',
        late_shipment_rate: '',
        rating: '',
        review_count: '',
        response_rate: '',
        response_time_hours: '',
        viewers: '',
        avg_viewers: '',
        likes: '',
        shares: '',
        comments: '',
        new_followers: '',
        live_sessions: '',
      });
    } else if (open && preSelectedAccountId) {
      setForm(f => ({ ...f, account_id: preSelectedAccountId }));
    }
  }, [open, preSelectedAccountId]);

  const num = (v) => v === '' || v === null ? null : parseFloat(v);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.account_id) {
      toast.error('Pilih akun terlebih dahulu');
      return;
    }
    if (!form.date) {
      toast.error('Tanggal wajib diisi');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        account_id: form.account_id,
        date: form.date,
        revenue_type: activeTab,
        revenue: num(form.revenue) || 0,
        orders: num(form.orders) || 0,
        aov: num(form.aov),
        gmv: num(form.gmv),
        conversion_rate: num(form.conversion_rate),
        fulfillment_rate: num(form.fulfillment_rate),
        cancellation_rate: num(form.cancellation_rate),
        return_rate: num(form.return_rate),
        late_shipment_rate: num(form.late_shipment_rate),
        rating: num(form.rating),
        review_count: num(form.review_count),
        response_rate: num(form.response_rate),
        response_time_hours: num(form.response_time_hours),
      };

      if (activeTab === 'live') {
        payload.viewers = num(form.viewers);
        payload.avg_viewers = num(form.avg_viewers);
        payload.likes = num(form.likes);
        payload.shares = num(form.shares);
        payload.comments = num(form.comments);
        payload.new_followers = num(form.new_followers);
        payload.live_sessions = num(form.live_sessions);
      }

      const res = await fetch('/api/marketing/sales-data', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Gagal menyimpan data');
      }

      toast.success(`Data ${activeTab === 'total' ? 'Total Revenue' : 'Live Revenue'} berhasil disimpan`);
      onOpenChange(false);
      if (onSaved) onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="sales-data-dialog">
        <DialogHeader>
          <DialogTitle>Input Sales Harian</DialogTitle>
          <DialogDescription>
            Pilih akun dan tab Total/Live, lalu masukkan metrics. Health score akan otomatis di-recalculate.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Akun <span className="text-red-400">*</span></Label>
              <Select value={form.account_id} onValueChange={v => setForm(f => ({ ...f, account_id: v }))}>
                <SelectTrigger data-testid="sd-account-select"><SelectValue placeholder="Pilih akun" /></SelectTrigger>
                <SelectContent>
                  {accounts?.map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.account_name} ({a.platform})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* Visual confirmation: akun yang dipilih */}
              {form.account_id && (() => {
                const acc = accounts?.find(a => a.id === form.account_id);
                const cfg = acc ? getPlatformConfig(acc.platform) : null;
                return acc ? (
                  <div className={`mt-1.5 flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs ${cfg.bg} ${cfg.border} ${cfg.text}`}>
                    <span>{cfg.icon}</span>
                    <span className="font-medium">Input ke: {acc.account_name}</span>
                  </div>
                ) : null;
              })()}
            </div>
            <div>
              <Label htmlFor="sd-date">Tanggal <span className="text-red-400">*</span></Label>
              <GlassInput
                id="sd-date"
                type="date"
                value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                data-testid="sd-date-input"
                required
              />
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="total" data-testid="tab-total">📊 Total Revenue</TabsTrigger>
              <TabsTrigger value="live" data-testid="tab-live">🎥 Live Revenue</TabsTrigger>
            </TabsList>

            <TabsContent value="total" className="space-y-3 mt-4">
              <div className="text-xs text-muted-foreground">Total penjualan dari semua channel (regular + live).</div>
              <CommonMetricsForm form={form} setForm={setForm} />
            </TabsContent>

            <TabsContent value="live" className="space-y-3 mt-4">
              <div className="text-xs text-muted-foreground">Khusus penjualan dari live streaming.</div>
              <CommonMetricsForm form={form} setForm={setForm} />
              <div className="pt-3 border-t border-[var(--glass-border)]">
                <div className="text-sm font-semibold mb-2">Engagement Metrics (Live Only)</div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <NumField label="Viewers" testId="sd-viewers" value={form.viewers} onChange={v => setForm(f => ({ ...f, viewers: v }))} />
                  <NumField label="Avg Viewers" testId="sd-avg-viewers" value={form.avg_viewers} onChange={v => setForm(f => ({ ...f, avg_viewers: v }))} />
                  <NumField label="Likes" testId="sd-likes" value={form.likes} onChange={v => setForm(f => ({ ...f, likes: v }))} />
                  <NumField label="Shares" testId="sd-shares" value={form.shares} onChange={v => setForm(f => ({ ...f, shares: v }))} />
                  <NumField label="Comments" testId="sd-comments" value={form.comments} onChange={v => setForm(f => ({ ...f, comments: v }))} />
                  <NumField label="New Followers" testId="sd-followers" value={form.new_followers} onChange={v => setForm(f => ({ ...f, new_followers: v }))} />
                  <NumField label="Live Sessions" testId="sd-sessions" value={form.live_sessions} onChange={v => setForm(f => ({ ...f, live_sessions: v }))} />
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Batal
            </Button>
            <Button type="submit" disabled={submitting} data-testid="sd-submit-btn">
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Simpan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NumField({ label, value, onChange, testId, step = '0.01' }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <GlassInput
        type="number"
        step={step}
        value={value}
        onChange={e => onChange(e.target.value)}
        data-testid={testId}
      />
    </div>
  );
}

function CommonMetricsForm({ form, setForm }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <NumField label="Revenue (Rp)" testId="sd-revenue" value={form.revenue} onChange={v => setForm(f => ({ ...f, revenue: v }))} />
        <NumField label="Orders" testId="sd-orders" value={form.orders} onChange={v => setForm(f => ({ ...f, orders: v }))} />
        <NumField label="AOV" testId="sd-aov" value={form.aov} onChange={v => setForm(f => ({ ...f, aov: v }))} />
        <NumField label="GMV" testId="sd-gmv" value={form.gmv} onChange={v => setForm(f => ({ ...f, gmv: v }))} />
        <NumField label="Conversion Rate (0-1)" testId="sd-cr" value={form.conversion_rate} onChange={v => setForm(f => ({ ...f, conversion_rate: v }))} />
      </div>
      <details className="rounded-md bg-[var(--glass-bg)] border border-[var(--glass-border)] px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium">Fulfillment & Customer Satisfaction (opsional)</summary>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
          <NumField label="Fulfillment Rate (0-1)" testId="sd-fr" value={form.fulfillment_rate} onChange={v => setForm(f => ({ ...f, fulfillment_rate: v }))} />
          <NumField label="Cancellation Rate (0-1)" testId="sd-canc" value={form.cancellation_rate} onChange={v => setForm(f => ({ ...f, cancellation_rate: v }))} />
          <NumField label="Return Rate (0-1)" testId="sd-ret" value={form.return_rate} onChange={v => setForm(f => ({ ...f, return_rate: v }))} />
          <NumField label="Late Shipment Rate (0-1)" testId="sd-late" value={form.late_shipment_rate} onChange={v => setForm(f => ({ ...f, late_shipment_rate: v }))} />
          <NumField label="Rating (0-5)" testId="sd-rating" value={form.rating} onChange={v => setForm(f => ({ ...f, rating: v }))} />
          <NumField label="Review Count" testId="sd-review-count" value={form.review_count} onChange={v => setForm(f => ({ ...f, review_count: v }))} />
          <NumField label="Response Rate (0-1)" testId="sd-resp-rate" value={form.response_rate} onChange={v => setForm(f => ({ ...f, response_rate: v }))} />
          <NumField label="Response Time (hours)" testId="sd-resp-time" value={form.response_time_hours} onChange={v => setForm(f => ({ ...f, response_time_hours: v }))} />
        </div>
      </details>
    </div>
  );
}

export default function SalesDataEntryModule({ token }) {
  const { activeAccount, setActiveAccount } = useActiveMarketingAccount();
  const [accounts, setAccounts] = useState([]);
  const [salesData, setSalesData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ account_id: 'all', revenue_type: 'all' });
  const [dialogOpen, setDialogOpen] = useState(false);

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }), [token]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const accRes = await fetch('/api/marketing/accounts', { headers });
      const accs = accRes.ok ? await accRes.json() : [];
      setAccounts(accs);

      // Fetch sales data per account or for chosen account
      const targetAccs = filter.account_id === 'all' ? accs : accs.filter(a => a.id === filter.account_id);
      const allSales = [];
      for (const acc of targetAccs.slice(0, 10)) {
        const params = new URLSearchParams();
        if (filter.revenue_type !== 'all') params.append('revenue_type', filter.revenue_type);
        const r = await fetch(`/api/marketing/accounts/${acc.id}/sales?${params.toString()}`, { headers });
        if (r.ok) {
          const list = await r.json();
          list.forEach(item => {
            allSales.push({ ...item, _account_name: acc.account_name, _platform: acc.platform });
          });
        }
      }
      // sort by date desc
      allSales.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      setSalesData(allSales);
    } catch (e) {
      toast.error('Gagal memuat data sales');
    } finally {
      setLoading(false);
    }
  }, [filter, headers]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="space-y-5" data-testid="sales-data-entry-module">
      <PageHeader
        icon={TrendingUp}
        eyebrow="Portal Marketing · Sales Data"
        title="Input Sales Harian"
        subtitle="Catat penjualan harian (regular vs live) per akun marketplace"
        actions={
          <div className="flex items-center gap-2">
            <Button onClick={fetchData} variant="outline" size="sm" data-testid="refresh-sales-btn">
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
            </Button>
            <Button onClick={() => setDialogOpen(true)} size="sm" data-testid="input-sales-btn">
              <Plus className="w-3.5 h-3.5 mr-1.5" /> Input Sales
            </Button>
          </div>
        }
      />

      {/* Active Account Bar */}
      <ActiveAccountBar
        accounts={accounts}
        activeAccount={activeAccount}
        onAccountChange={(acc) => {
          setActiveAccount(acc);
          setFilter(f => ({ ...f, account_id: acc ? acc.id : 'all' }));
        }}
        hint="Filter & input otomatis ke akun:"
      />

      <GlassPanel className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]">
            <Label className="text-xs">Filter Akun</Label>
            <Select value={filter.account_id} onValueChange={v => setFilter(f => ({ ...f, account_id: v }))}>
              <SelectTrigger data-testid="sd-filter-account"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Akun</SelectItem>
                {accounts.map(a => (
                  <SelectItem key={a.id} value={a.id}>{a.account_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[180px]">
            <Label className="text-xs">Filter Type</Label>
            <Select value={filter.revenue_type} onValueChange={v => setFilter(f => ({ ...f, revenue_type: v }))}>
              <SelectTrigger data-testid="sd-filter-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua</SelectItem>
                <SelectItem value="total">Total Revenue</SelectItem>
                <SelectItem value="live">Live Revenue</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="text-sm text-muted-foreground">
            Total entries: <span className="text-foreground font-semibold">{salesData.length}</span>
          </div>
        </div>
      </GlassPanel>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-16" />)}
        </div>
      ) : salesData.length === 0 ? (
        <GlassCard className="p-12 text-center">
          <Calendar className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-50" />
          <p className="text-muted-foreground mb-4">Belum ada data sales</p>
          <Button size="sm" onClick={() => setDialogOpen(true)} data-testid="input-first-sales-btn">
            <Plus className="w-4 h-4 mr-2" /> Input Sales Pertama
          </Button>
        </GlassCard>
      ) : (
        <GlassCard className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--glass-bg)] border-b border-[var(--glass-border)]">
                <tr>
                  <th className="text-left px-4 py-2.5 font-semibold">Tanggal</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Akun</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Type</th>
                  <th className="text-right px-4 py-2.5 font-semibold">Revenue</th>
                  <th className="text-right px-4 py-2.5 font-semibold">Orders</th>
                  <th className="text-right px-4 py-2.5 font-semibold">AOV</th>
                  <th className="text-right px-4 py-2.5 font-semibold">CR</th>
                </tr>
              </thead>
              <tbody>
                {salesData.map((row, i) => (
                  <tr key={row.id || i} className="border-b border-[var(--glass-border)] hover:bg-[var(--glass-bg)]" data-testid={`sd-row-${i}`}>
                    <td className="px-4 py-2.5 font-mono text-xs">{row.date}</td>
                    <td className="px-4 py-2.5">
                      <AccountBadge
                        account={{ account_name: row._account_name, platform: row._platform }}
                        size="xs"
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className={row.revenue_type === 'live' ? 'bg-pink-500/10 text-pink-400 border-pink-500/30' : 'bg-blue-500/10 text-blue-400 border-blue-500/30'}>
                        {row.revenue_type}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{fmt(row.metrics?.revenue)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{fmtNum(row.metrics?.orders)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{fmt(row.metrics?.aov)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-xs">
                      {row.metrics?.conversion_rate ? `${(row.metrics.conversion_rate * 100).toFixed(2)}%` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}

      <SalesDataEntryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        accounts={accounts}
        onSaved={fetchData}
        token={token}
        preSelectedAccountId={activeAccount?.id || ''}
      />
    </div>
  );
}
