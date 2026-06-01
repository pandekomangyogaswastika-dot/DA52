/**
 * Management Overview Dashboard — Tahap 2 Modernized
 *
 * KPI eksekutif lintas domain (Produksi / HR / Finance / Warehouse).
 * Auto-refresh 30 detik. Dual-theme aware.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  RefreshCw, TrendingUp, Users, Factory, DollarSign, AlertTriangle,
  Trophy, Clock as ClockIcon, Package, Activity,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  StatCard, ChartCard, GlassTooltip, HeroCrystalCard, DonutProgress, CHART_PALETTE,
} from './dashboardAtoms';
import { PeriodPicker } from './PeriodPicker';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area,
} from 'recharts';

const fmt = (n) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;
const fmtNum = (n) => Number(n || 0).toLocaleString('id-ID');
const fmtShortIDR = (n) => {
  const v = Number(n || 0);
  if (v >= 1e9) return `Rp ${(v / 1e9).toFixed(1)}M`;
  if (v >= 1e6) return `Rp ${(v / 1e6).toFixed(1)}jt`;
  if (v >= 1e3) return `Rp ${(v / 1e3).toFixed(0)}rb`;
  return `Rp ${v.toLocaleString('id-ID')}`;
};

export default function ManagementOverviewModule({ token }) {
  const [data, setData] = useState(null);
  const [daily, setDaily] = useState([]);
  const [topModels, setTopModels] = useState([]);
  const [topCustomers, setTopCustomers] = useState([]);
  const [onTime, setOnTime] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [period, setPeriod] = useState({ preset: '7d', from: null, to: null });
  const headers = { Authorization: `Bearer ${token}` };

  // Resolve from/to from preset bila belum di-compute pada pertama kali
  const dateRange = useMemo(() => {
    let { from, to } = period || {};
    if (!from || !to) {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const iso = (d) => d.toISOString().slice(0, 10);
      const add = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
      const preset = period?.preset || '7d';
      if (preset === 'today')      { from = iso(today); to = iso(today); }
      else if (preset === '7d')    { from = iso(add(today, -6)); to = iso(today); }
      else if (preset === '30d')   { from = iso(add(today, -29)); to = iso(today); }
      else if (preset === '90d')   { from = iso(add(today, -89)); to = iso(today); }
      else if (preset === 'month') { from = iso(new Date(today.getFullYear(), today.getMonth(), 1)); to = iso(today); }
      else if (preset === 'ytd')   { from = `${today.getFullYear()}-01-01`; to = iso(today); }
    }
    return { from, to };
  }, [period]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const qs = dateRange.from && dateRange.to
        ? `?date_from=${dateRange.from}&date_to=${dateRange.to}`
        : '';
      const [ov, dl, tm, tc, ot] = await Promise.all([
        fetch(`/api/rahaza/management/overview${qs}`, { headers }).then(r => r.json()),
        fetch(`/api/rahaza/management/daily-output${qs || '?days=7'}`, { headers }).then(r => r.json()),
        fetch('/api/rahaza/management/top-models?days=30&limit=5', { headers }).then(r => r.json()),
        fetch('/api/rahaza/management/top-customers?limit=5', { headers }).then(r => r.json()),
        fetch('/api/rahaza/management/on-time-delivery?days=30', { headers }).then(r => r.json()),
      ]);
      setData(ov); setDaily(dl.timeline || []); setTopModels(tm.items || []); setTopCustomers(tc.items || []); setOnTime(ot);
      setLastUpdate(new Date());
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, dateRange.from, dateRange.to]);

  useEffect(() => {
    fetchAll();
    const t = setInterval(fetchAll, 30000);
    return () => clearInterval(t);
  }, [fetchAll]);

  if (loading && !data) {
    return (
      <div className="space-y-5">
        <div className="h-32 rounded-[var(--radius-xl)] bg-[var(--card-surface)] border border-[var(--glass-border)] animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <div key={i} className="h-28 rounded-[var(--radius-lg)] bg-[var(--card-surface)] border border-[var(--glass-border)] animate-pulse" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="management-overview-page">
      {/* ── Hero Card ──────────────────────────────────────────────────── */}
      <HeroCrystalCard
        testId="mgmt-hero"
        eyebrow="Dashboard Management"
        title="Overview Bisnis Real-time"
        description="Monitoring produksi, HR, finance, dan warehouse dalam satu layar. Data auto-refresh setiap 30 detik."
        actions={
          <PeriodPicker
            value={period}
            onChange={setPeriod}
            compareEnabled={false}
            testId="mgmt-overview-period"
          />
        }
      >
        <div className="flex items-center gap-3">
          <Button onClick={fetchAll} className="h-9 bg-[hsl(var(--primary))] hover:brightness-110">
            <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Memuat...' : 'Refresh'}
          </Button>
          {lastUpdate && (
            <span className="text-xs text-foreground/50">
              Diperbarui: {lastUpdate.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} · Periode {dateRange.from}→{dateRange.to}
            </span>
          )}
        </div>
      </HeroCrystalCard>

      {/* ── KPI Grid ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          testId="kpi-production"
          icon={Factory}
          label="Output 7 Hari"
          value={fmtNum(data?.production?.output_7d)}
          sub={`pcs · ${data?.production?.wo_active || 0} WO aktif`}
          accent="primary"
        />
        <StatCard
          testId="kpi-qc"
          icon={Activity}
          label="QC Pass Rate"
          value={`${data?.production?.qc_rate_pct || 0}%`}
          sub={`${data?.production?.qc_pass_7d || 0} pass · ${data?.production?.qc_fail_7d || 0} fail`}
          accent="success"
        />
        <StatCard
          testId="kpi-hr"
          icon={Users}
          label="Karyawan Aktif"
          value={fmtNum(data?.hr?.employees_active)}
          sub={`Hadir hari ini: ${data?.hr?.attendance_today?.hadir || 0}`}
          accent="info"
        />
        <StatCard
          testId="kpi-cash"
          icon={DollarSign}
          label="Saldo Kas/Bank"
          value={fmtShortIDR(data?.finance?.cash_balance)}
          sub={`AR: ${fmtShortIDR(data?.finance?.ar_outstanding)} · AP: ${fmtShortIDR(data?.finance?.ap_outstanding)}`}
          accent="mint"
        />
      </div>

      {/* ── Row 1: Daily output chart + On-time donut ──────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard
          testId="chart-daily-output"
          title="Output Produksi 7 Hari Terakhir"
          subtitle="Total pcs yang dikerjakan per hari di seluruh proses"
          className="lg:col-span-2"
        >
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <AreaChart data={daily} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="outputGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_PALETTE[0]} stopOpacity={0.55} />
                    <stop offset="100%" stopColor={CHART_PALETTE[0]} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 4" stroke="var(--chart-grid)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                  tickFormatter={(v) => v ? v.slice(5).replace('-','/') : ''}
                  stroke="var(--chart-grid)"
                />
                <YAxis
                  tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                  stroke="var(--chart-grid)"
                  width={40}
                />
                <Tooltip content={<GlassTooltip formatter={(v) => `${fmtNum(v)} pcs`} />} cursor={{ fill: 'var(--glass-bg-hover)' }} />
                <Area
                  type="monotone"
                  dataKey="total"
                  name="Output"
                  stroke={CHART_PALETTE[0]}
                  strokeWidth={2.5}
                  fill="url(#outputGrad)"
                  dot={{ r: 3, strokeWidth: 2, fill: 'hsl(var(--background))' }}
                  activeDot={{ r: 5 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard
          testId="card-on-time"
          title="On-Time Delivery"
          subtitle="Persentase WO selesai tepat waktu (30 hari)"
        >
          <div className="flex flex-col items-center justify-center py-4">
            <DonutProgress
              value={onTime?.rate_pct || 0}
              size={160}
              stroke={14}
              label="On-Time"
              sub={`${onTime?.on_time || 0} / ${onTime?.total_wo || 0} WO`}
              accent={
                (onTime?.rate_pct || 0) >= 85 ? 'success'
                  : (onTime?.rate_pct || 0) >= 60 ? 'primary'
                  : 'warning'
              }
            />
            <div className="mt-3 flex items-center gap-2 text-xs">
              <span className={`px-2 py-0.5 rounded-full font-semibold ${
                (onTime?.rate_pct || 0) >= 85 ? 'bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]' :
                (onTime?.rate_pct || 0) >= 60 ? 'bg-[hsl(var(--primary)/0.15)] text-[hsl(var(--primary))]' :
                'bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))]'
              }`}>
                {(onTime?.rate_pct || 0) >= 85 ? 'Excellent' : (onTime?.rate_pct || 0) >= 60 ? 'Good' : 'Perhatian'}
              </span>
            </div>
          </div>
        </ChartCard>
      </div>

      {/* ── Row 2: Warehouse alerts + Top models/customers ─────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard testId="card-low-stock" title="Warehouse Alerts" subtitle="Material di bawah min stock">
          <div className="flex items-center justify-between gap-4 py-2">
            <div>
              <p className="text-5xl font-bold text-[hsl(var(--warning))] leading-none tracking-tight">{data?.warehouse?.low_stock_materials || 0}</p>
              <p className="text-xs text-foreground/50 mt-2">material perlu restock</p>
            </div>
            {(data?.warehouse?.low_stock_materials || 0) > 0 ? (
              <div className="w-14 h-14 rounded-2xl bg-[hsl(var(--warning)/0.15)] border border-[hsl(var(--warning)/0.25)] grid place-items-center">
                <AlertTriangle className="w-6 h-6 text-[hsl(var(--warning))]" />
              </div>
            ) : (
              <div className="w-14 h-14 rounded-2xl bg-[hsl(var(--success)/0.15)] border border-[hsl(var(--success)/0.25)] grid place-items-center">
                <Package className="w-6 h-6 text-[hsl(var(--success))]" />
              </div>
            )}
          </div>
        </ChartCard>

        <ChartCard testId="card-top-models" title="Top 5 Model (30 hari)" subtitle="Berdasarkan output produksi">
          {topModels.length === 0 ? (
            <div className="text-xs text-foreground/40 text-center py-8">Belum ada data output.</div>
          ) : (
            <div className="space-y-2.5">
              {topModels.map((m, i) => {
                const maxQty = topModels[0]?.qty || 1;
                const pct = (m.qty / maxQty) * 100;
                return (
                  <div key={m.model_id || i} className="flex items-center gap-3">
                    <div className="text-xs font-bold w-6 text-center text-foreground/40">#{i + 1}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <p className="text-xs text-foreground truncate">{m.code || '(no code)'} · {m.name || '-'}</p>
                        <span className="font-mono text-xs text-foreground tabular-nums shrink-0">{fmtNum(m.qty)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-[var(--glass-bg)] overflow-hidden">
                        <div className="h-full rounded-full bg-[hsl(var(--primary))] transition-[width] duration-500" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ChartCard>

        <ChartCard testId="card-top-customers" title="Top 5 Customer" subtitle="Berdasarkan volume order">
          {topCustomers.length === 0 ? (
            <div className="text-xs text-foreground/40 text-center py-8">Belum ada order.</div>
          ) : (
            <div className="space-y-2.5">
              {topCustomers.map((c, i) => (
                <div key={c.customer_id || i} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-[hsl(var(--primary)/0.12)] border border-[hsl(var(--primary)/0.20)] grid place-items-center text-[hsl(var(--primary))] text-xs font-bold shrink-0">
                    {(c.name || '?')[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground truncate font-medium">{c.name || '-'}</p>
                    <p className="text-[10px] text-foreground/50">{c.orders || 0} order</p>
                  </div>
                  <span className="font-mono text-xs text-foreground tabular-nums">{fmtNum(c.total_qty)} pcs</span>
                </div>
              ))}
            </div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
