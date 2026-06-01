/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  RefreshCw, Pause, Play, Activity, AlertTriangle, AlertOctagon,
  Factory, Gauge, TrendingUp, TrendingDown, Clock, Target,
  CheckCircle2, XCircle, Layers, Users, Timer,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { GlassCard, GlassPanel } from '@/components/ui/glass';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { toast } from 'sonner';
import { EmptyState } from './EmptyState';

/* ─── LineMonitoringModule — Phase 2 Task 2.2 ─────────────────────────────
   Real-time production line monitoring. Refresh every 10 seconds with a
   pause/resume control. Displays:
     - KPI strip (lines running/idle/downtime/behind, output, FPY, achievement)
     - Active alerts panel (downtime>30m, FPY<90%, behind schedule)
     - Grid of line cards (status, hourly rate, progress, FPY, sparkline)
     - Drill-down Sheet per line (recent WIP events + downtime today)
─────────────────────────────────────────────────────────────────────────── */

const REFRESH_INTERVAL_MS = 10_000;

const STATUS_THEME = {
  running:  { color: 'emerald', label: 'Berjalan',  Icon: Activity },
  idle:     { color: 'amber',   label: 'Idle',      Icon: Clock },
  downtime: { color: 'red',     label: 'Downtime',  Icon: AlertOctagon },
  behind:   { color: 'sky',     label: 'Tertinggal', Icon: TrendingDown },
};

const ACCENT_MAP = {
  emerald: 'text-emerald-300 bg-emerald-400/15 border-emerald-400/30',
  sky:     'text-sky-300 bg-sky-400/15 border-sky-400/30',
  amber:   'text-amber-300 bg-amber-400/15 border-amber-400/30',
  red:     'text-red-300 bg-red-400/15 border-red-400/30',
  muted:   'text-muted-foreground bg-foreground/5 border-foreground/15',
};

const SEV_THEME = {
  critical: { color: 'red',   label: 'Kritis',   Icon: AlertOctagon },
  warning:  { color: 'amber', label: 'Peringatan', Icon: AlertTriangle },
  info:     { color: 'sky',   label: 'Info',     Icon: Activity },
};

function fmtNum(n) {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat('id-ID').format(n);
}

function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  return `${n.toFixed(1)}%`;
}

function fmtMin(n) {
  if (n == null || isNaN(n)) return '—';
  if (n < 60) return `${Math.round(n)} m`;
  return `${(n / 60).toFixed(1)} jam`;
}

function fmtElapsedSince(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const ms = Date.now() - d.getTime();
    const m = Math.floor(ms / 60000);
    if (m < 1) return 'baru saja';
    if (m < 60) return `${m} menit lalu`;
    const h = Math.floor(m / 60);
    return `${h} jam lalu`;
  } catch { return '—'; }
}

function KpiTile({ icon: Icon, label, value, sub, accent = 'sky', testId }) {
  return (
    <GlassCard className="p-3.5" hover={false} data-testid={testId}>
      <div className="flex items-center gap-3">
        <div className={`rounded-lg border p-2 ${ACCENT_MAP[accent]}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
            {label}
          </div>
          <div className="text-xl font-bold font-mono tabular-nums leading-tight text-foreground">
            {value}
          </div>
          {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
        </div>
      </div>
    </GlassCard>
  );
}

function Sparkline({ values, max }) {
  if (!values || values.length === 0) {
    return <div className="text-[10px] text-muted-foreground italic">no data</div>;
  }
  const mx = max || Math.max(...values, 1);
  const w = 80;
  const h = 22;
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  const points = values.map((v, i) => {
    const x = i * step;
    const y = h - ((v / mx) * (h - 2)) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-label="sparkline 8 jam">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* end-point dot */}
      {values.length > 0 && (() => {
        const last = values.length - 1;
        const x = last * step;
        const y = h - ((values[last] / mx) * (h - 2)) - 1;
        return <circle cx={x} cy={y} r="1.8" fill="currentColor" />;
      })()}
    </svg>
  );
}

function LineCard({ line, onClick, expectedProgressPct }) {
  const theme = STATUS_THEME[line.status] || STATUS_THEME.idle;
  const StatusIcon = theme.Icon;
  const accent = theme.color;
  const achievement = line.achievement_pct || 0;
  const ach_color = achievement >= 80 ? 'emerald' : achievement >= 50 ? 'sky' : 'amber';

  return (
    <GlassCard
      className={`p-3.5 cursor-pointer transition-transform hover:-translate-y-0.5 border-l-2 ${
        accent === 'emerald' ? 'border-l-emerald-400/60' :
        accent === 'red' ? 'border-l-red-400/60' :
        accent === 'sky' ? 'border-l-sky-400/60' :
        'border-l-amber-400/60'
      }`}
      data-testid={`line-monitor-card-${line.line_code}`}
      onClick={onClick}
    >
      {/* Header: code/name + status badge */}
      <div className="flex items-start justify-between gap-2 mb-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold text-foreground">{line.line_code}</span>
            <span className="text-[10px] text-muted-foreground truncate max-w-[150px]">{line.line_name}</span>
          </div>
          {line.location_name && (
            <div className="text-[10px] text-muted-foreground mt-0.5">▸ {line.location_name}</div>
          )}
        </div>
        <Badge variant="outline" className={`gap-1 ${ACCENT_MAP[accent]} text-[10px]`}>
          <StatusIcon className="w-3 h-3" />
          {theme.label}
        </Badge>
      </div>

      {/* Active downtime panel */}
      {line.active_downtime && (
        <div className="mb-2 rounded-md border border-red-400/30 bg-red-400/10 px-2 py-1.5 text-[10px] text-red-200">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1">
              <AlertOctagon className="w-3 h-3" />
              <b>{line.active_downtime.reason_name || 'Downtime'}</b>
            </span>
            <span className="font-mono">{fmtMin(line.active_downtime.elapsed_min)}</span>
          </div>
        </div>
      )}

      {/* Operator + Model */}
      <div className="space-y-1 mb-2">
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Users className="w-3 h-3" />
          <span className="truncate">{line.operator_name || '—'}</span>
          {line.shift_name && (
            <span className="ml-auto flex items-center gap-0.5"><Timer className="w-3 h-3" /> {line.shift_name}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Layers className="w-3 h-3" />
          <span className="truncate">{line.model_name || '—'}</span>
        </div>
      </div>

      {/* Progress (output/target) */}
      <div className="mb-2">
        <div className="flex items-center justify-between text-[10px] mb-0.5">
          <span className="text-muted-foreground flex items-center gap-1">
            <Target className="w-3 h-3" />
            {fmtNum(line.output_qty)} / {fmtNum(line.target_qty)} pcs
          </span>
          <span className={`font-mono font-semibold ${ACCENT_MAP[ach_color].split(' ')[0]}`}>
            {fmtPct(achievement)}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
          <div
            className={`h-full rounded-full ${
              ach_color === 'emerald' ? 'bg-emerald-400' :
              ach_color === 'sky' ? 'bg-sky-400' :
              'bg-amber-400'
            }`}
            style={{ width: `${Math.min(100, achievement)}%` }}
          />
        </div>
        {expectedProgressPct > 0 && (
          <div className="text-[9px] text-muted-foreground/70 mt-0.5">
            Ekspektasi {fmtPct(expectedProgressPct)} berdasarkan jam berjalan
          </div>
        )}
      </div>

      {/* Metrics row: hourly rate, FPY, sparkline */}
      <div className="grid grid-cols-3 gap-1.5 mt-2 pt-2 border-t border-[var(--glass-border)]">
        <div className="text-center">
          <div className="text-[9px] uppercase text-muted-foreground">Rate (1jam)</div>
          <div className="text-sm font-mono font-bold text-foreground" data-testid={`line-rate-${line.line_code}`}>
            {fmtNum(line.hourly_rate)}<span className="text-[9px] text-muted-foreground ml-0.5">/jam</span>
          </div>
        </div>
        <div className="text-center">
          <div className="text-[9px] uppercase text-muted-foreground">FPY</div>
          <div
            className={`text-sm font-mono font-bold ${
              line.fpy_pct >= 95 ? 'text-emerald-300' :
              line.fpy_pct >= 90 ? 'text-sky-300' :
              line.fpy_pct >= 80 ? 'text-amber-300' :
              'text-red-300'
            }`}
            data-testid={`line-fpy-${line.line_code}`}
          >
            {fmtPct(line.fpy_pct)}
          </div>
        </div>
        <div className="text-center">
          <div className="text-[9px] uppercase text-muted-foreground">Tren 8j</div>
          <div className={`flex items-center justify-center mt-0.5 ${
            accent === 'emerald' ? 'text-emerald-300' :
            accent === 'red' ? 'text-red-300' :
            accent === 'sky' ? 'text-sky-300' :
            'text-amber-300'
          }`}>
            <Sparkline values={line.sparkline_8h} />
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

function AlertRow({ alert, onLineClick }) {
  const theme = SEV_THEME[alert.severity] || SEV_THEME.info;
  const Icon = theme.Icon;
  return (
    <button
      type="button"
      onClick={() => onLineClick(alert.line_id)}
      className={`w-full flex items-center gap-2.5 rounded-md border px-3 py-2 text-left hover:bg-white/5 transition-colors ${ACCENT_MAP[theme.color]}`}
      data-testid={`monitor-alert-row-${alert.type}-${alert.line_code}`}
    >
      <Icon className="w-3.5 h-3.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-bold">{alert.line_code}</span>
          <span className="text-[10px] text-muted-foreground truncate">{alert.line_name}</span>
        </div>
        <div className="text-[10px] truncate">{alert.message}</div>
      </div>
      <Badge variant="outline" className={`text-[9px] ${ACCENT_MAP[theme.color]}`}>
        {theme.label}
      </Badge>
    </button>
  );
}

export default function LineMonitoringModule({ token }) {
  const [data, setData] = useState(null);
  const [alerts, setAlerts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [paused, setPaused] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [updatedAt, setUpdatedAt] = useState('');

  // Drill-down
  const [drillOpen, setDrillOpen] = useState(false);
  const [drillData, setDrillData] = useState(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillLineId, setDrillLineId] = useState(null);

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const isFirstLoad = useRef(true);

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    setError(null);
    try {
      const [s, a] = await Promise.all([
        fetch('/api/rahaza/monitoring/live-status', { headers }),
        fetch('/api/rahaza/monitoring/alerts', { headers }),
      ]);
      if (!s.ok) throw new Error(`live-status HTTP ${s.status}`);
      if (!a.ok) throw new Error(`alerts HTTP ${a.status}`);
      const sj = await s.json();
      const aj = await a.json();
      setData(sj);
      setAlerts(aj);
      setUpdatedAt(new Date().toLocaleTimeString('id-ID'));
    } catch (e) {
      setError(e.message);
      if (isFirstLoad.current) toast.error(`Gagal memuat: ${e.message}`);
    } finally {
      if (showSpinner) setLoading(false);
      isFirstLoad.current = false;
    }
  }, [headers]);

  // Initial load + interval
  useEffect(() => {
    load(true);
  }, [load]);

  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => load(false), REFRESH_INTERVAL_MS);
    return () => clearInterval(t);
  }, [load, paused]);

  const openDrill = useCallback(async (lineId) => {
    setDrillOpen(true);
    setDrillLineId(lineId);
    setDrillLoading(true);
    setDrillData(null);
    try {
      const r = await fetch(`/api/rahaza/monitoring/line/${lineId}/detail`, { headers });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setDrillData(j);
    } catch (e) {
      toast.error(`Gagal memuat detail line: ${e.message}`);
    } finally {
      setDrillLoading(false);
    }
  }, [headers]);

  const kpis = data?.kpis || {};
  const lines = data?.lines || [];
  const meta = data?.meta || {};
  const expected = meta.expected_progress_pct || 0;

  const filteredLines = useMemo(() => {
    if (statusFilter === 'all') return lines;
    return lines.filter((l) => l.status === statusFilter);
  }, [lines, statusFilter]);

  const statusBuckets = useMemo(() => ([
    { key: 'all',      label: 'Semua',     count: lines.length, color: 'muted' },
    { key: 'running',  label: 'Berjalan',  count: kpis.lines_running || 0, color: 'emerald' },
    { key: 'behind',   label: 'Tertinggal', count: kpis.lines_behind || 0,  color: 'sky' },
    { key: 'downtime', label: 'Downtime',  count: kpis.lines_downtime || 0, color: 'red' },
    { key: 'idle',     label: 'Idle',      count: kpis.lines_idle || 0, color: 'amber' },
  ]), [lines, kpis]);

  if (loading && !data) {
    return (
      <div className="space-y-4" data-testid="line-monitoring-loading">
        <Skeleton className="h-10 w-1/2" />
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {[1,2,3,4,5,6].map((i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {[1,2,3,4,5,6].map((i) => <Skeleton key={i} className="h-48" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="line-monitoring-page">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap px-1">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-emerald-300" />
            <h1 className="text-2xl font-bold text-foreground">Live Monitoring</h1>
            <Badge variant="outline" className="text-[10px] tracking-wide">Task 2.2</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Snapshot real-time status produksi semua line. Auto-refresh setiap {REFRESH_INTERVAL_MS/1000} detik.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={paused ? 'default' : 'outline'}
            size="sm"
            onClick={() => setPaused((p) => !p)}
            data-testid="monitor-pause-btn"
          >
            {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            <span className="ml-1.5">{paused ? 'Lanjutkan' : 'Jeda'}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => load(true)}
            disabled={loading}
            data-testid="monitor-refresh-btn"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="ml-1.5">Muat Ulang</span>
          </Button>
          {updatedAt && (
            <span className="text-xs text-muted-foreground" data-testid="monitor-updated-at">
              {paused ? '⏸ ' : '● '}{updatedAt}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-200" data-testid="monitor-error">
          <AlertOctagon className="inline w-3.5 h-3.5 mr-1.5" /> {error}
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <KpiTile
          icon={Factory} label="Total Line"
          value={fmtNum(kpis.lines_total || 0)}
          sub={`${kpis.lines_running || 0} aktif`}
          accent="muted" testId="monitor-kpi-total"
        />
        <KpiTile
          icon={Activity} label="Running"
          value={fmtNum(kpis.lines_running || 0)}
          accent="emerald" testId="monitor-kpi-running"
        />
        <KpiTile
          icon={AlertOctagon} label="Downtime"
          value={fmtNum(kpis.lines_downtime || 0)}
          sub={fmtMin(kpis.downtime_min_total)}
          accent="red" testId="monitor-kpi-downtime"
        />
        <KpiTile
          icon={Target} label="Output Hari Ini"
          value={fmtNum(kpis.output_total || 0)}
          sub={`Target ${fmtNum(kpis.target_total || 0)} pcs`}
          accent="sky" testId="monitor-kpi-output"
        />
        <KpiTile
          icon={Gauge} label="Achievement"
          value={fmtPct(kpis.achievement_avg_pct)}
          sub={`Ekspektasi ${fmtPct(expected)}`}
          accent={
            (kpis.achievement_avg_pct || 0) >= 80 ? 'emerald' :
            (kpis.achievement_avg_pct || 0) >= 50 ? 'sky' : 'amber'
          }
          testId="monitor-kpi-achievement"
        />
        <KpiTile
          icon={CheckCircle2} label="FPY Rata-rata"
          value={fmtPct(kpis.fpy_avg_pct)}
          sub={`${kpis.alerts_active || 0} alert aktif`}
          accent={
            (kpis.fpy_avg_pct || 0) >= 95 ? 'emerald' :
            (kpis.fpy_avg_pct || 0) >= 90 ? 'sky' :
            (kpis.fpy_avg_pct || 0) >= 80 ? 'amber' : 'red'
          }
          testId="monitor-kpi-fpy"
        />
      </div>

      {/* Alerts panel */}
      <GlassPanel className="p-4" data-testid="monitor-alerts-panel">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-300" />
            <h2 className="text-sm font-semibold text-foreground">Alert Aktif</h2>
            <Badge variant="outline" className="text-[10px]" data-testid="monitor-alerts-count">
              {alerts?.total_alerts || 0}
            </Badge>
            {(alerts?.critical_count || 0) > 0 && (
              <Badge variant="outline" className={`text-[10px] ${ACCENT_MAP.red}`}>
                {alerts.critical_count} kritis
              </Badge>
            )}
          </div>
        </div>
        {(!alerts || alerts.alerts.length === 0) ? (
          <div className="text-center py-4 text-xs text-muted-foreground" data-testid="monitor-alerts-empty">
            <CheckCircle2 className="w-5 h-5 mx-auto mb-1 text-emerald-300" />
            Tidak ada alert aktif. Semua line dalam kondisi normal.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {alerts.alerts.slice(0, 9).map((a, i) => (
              <AlertRow key={`${a.type}-${a.line_id}-${i}`} alert={a} onLineClick={openDrill} />
            ))}
          </div>
        )}
      </GlassPanel>

      {/* Status filter */}
      <div className="flex items-center gap-1.5 flex-wrap" data-testid="monitor-status-filter">
        {statusBuckets.map((b) => (
          <button
            key={b.key}
            type="button"
            onClick={() => setStatusFilter(b.key)}
            className={`px-2.5 py-1 rounded-full border text-[11px] font-medium transition-colors ${
              statusFilter === b.key
                ? ACCENT_MAP[b.color]
                : 'border-[var(--glass-border)] text-muted-foreground hover:text-foreground hover:bg-white/5'
            }`}
            data-testid={`monitor-filter-${b.key}`}
          >
            {b.label}
            <span className="ml-1.5 font-mono tabular-nums">{b.count}</span>
          </button>
        ))}
      </div>

      {/* Line cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="monitor-lines-grid">
        {filteredLines.length === 0 ? (
          <div className="col-span-full">
            <EmptyState
              icon={Factory}
              title={statusFilter === 'all' ? 'Belum ada line aktif yang dimonitor' : `Tidak ada line dengan status "${STATUS_THEME[statusFilter]?.label || statusFilter}"`}
              description={statusFilter === 'all' ? 'Line produksi akan muncul di sini saat ada data monitoring dari sistem.' : 'Coba ganti filter status untuk melihat line lain.'}
              data-testid="monitor-lines-empty"
            />
          </div>
        ) : filteredLines.map((line) => (
          <LineCard
            key={line.line_id}
            line={line}
            expectedProgressPct={expected}
            onClick={() => openDrill(line.line_id)}
          />
        ))}
      </div>

      {/* Drill-down Sheet */}
      <Sheet open={drillOpen} onOpenChange={setDrillOpen}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto" data-testid="monitor-drill-sheet">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Factory className="w-4 h-4 text-sky-300" />
              {drillData?.line?.code || 'Line Detail'}
            </SheetTitle>
            <SheetDescription>
              {drillData?.line?.name} {drillData?.line?.location_name && `· ${drillData.line.location_name}`}
            </SheetDescription>
          </SheetHeader>

          {drillLoading ? (
            <div className="mt-4 space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : !drillData ? (
            <div className="mt-4 text-sm text-muted-foreground" data-testid="drill-empty">
              Tidak ada data.
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              {/* Assignments today */}
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                  Penugasan Hari Ini ({drillData.assignments_today?.length || 0})
                </h3>
                {(!drillData.assignments_today || drillData.assignments_today.length === 0) ? (
                  <div className="text-xs text-muted-foreground italic">Belum ada penugasan.</div>
                ) : (
                  <div className="space-y-1.5">
                    {drillData.assignments_today.map((a, i) => (
                      <GlassCard key={i} className="p-2.5" data-testid={`drill-assignment-${i}`}>
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-1.5">
                            <Users className="w-3 h-3 text-muted-foreground" />
                            <span className="font-medium">{a.operator_name || '—'}</span>
                            {a.shift_name && <span className="text-muted-foreground">· {a.shift_name}</span>}
                          </div>
                          <Badge variant="outline" className="text-[10px]">
                            Target {fmtNum(a.target_qty || 0)}
                          </Badge>
                        </div>
                        {a.model_name && (
                          <div className="flex items-center gap-1.5 mt-1 text-[11px] text-muted-foreground">
                            <Layers className="w-3 h-3" />
                            {a.model_name} {a.size_code && `· ${a.size_code}`}
                          </div>
                        )}
                      </GlassCard>
                    ))}
                  </div>
                )}
              </section>

              {/* Recent downtime today */}
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                  Downtime Hari Ini ({drillData.downtime_events_today?.length || 0})
                </h3>
                {(!drillData.downtime_events_today || drillData.downtime_events_today.length === 0) ? (
                  <div className="text-xs text-muted-foreground italic">Tidak ada downtime hari ini.</div>
                ) : (
                  <div className="space-y-1.5">
                    {drillData.downtime_events_today.map((d, i) => {
                      const isOpen = d.status === 'open';
                      return (
                        <GlassCard
                          key={i}
                          className={`p-2.5 border-l-2 ${isOpen ? 'border-l-red-400/60' : 'border-l-muted-foreground/30'}`}
                          data-testid={`drill-downtime-${i}`}
                        >
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <div className="flex items-center gap-1.5">
                              {isOpen ? <AlertOctagon className="w-3 h-3 text-red-300" /> : <CheckCircle2 className="w-3 h-3 text-muted-foreground" />}
                              <span className="font-medium">{d.reason_name || d.reason_code || 'Downtime'}</span>
                            </div>
                            <Badge variant="outline" className={`text-[10px] ${isOpen ? ACCENT_MAP.red : ''}`}>
                              {isOpen ? `${fmtMin(d.elapsed_min)} aktif` : 'Selesai'}
                            </Badge>
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-1">
                            Mulai: {fmtElapsedSince(d.start_at)}
                            {d.notes && ` · ${d.notes}`}
                          </div>
                        </GlassCard>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Recent WIP events */}
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                  Event Terbaru (2 jam terakhir, {drillData.wip_events_recent?.length || 0})
                </h3>
                {(!drillData.wip_events_recent || drillData.wip_events_recent.length === 0) ? (
                  <div className="text-xs text-muted-foreground italic">Belum ada event.</div>
                ) : (
                  <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                    {drillData.wip_events_recent.map((e, i) => {
                      const isFail = e.event_type === 'qc_fail';
                      const isPass = e.event_type === 'qc_pass';
                      const Icon = isFail ? XCircle : isPass ? CheckCircle2 : TrendingUp;
                      const color = isFail ? 'text-red-300' : isPass ? 'text-emerald-300' : 'text-sky-300';
                      return (
                        <div
                          key={i}
                          className="flex items-center justify-between gap-2 px-2 py-1 text-[11px] border-b border-[var(--glass-border)]/40 last:border-b-0"
                          data-testid={`drill-event-${i}`}
                        >
                          <div className="flex items-center gap-1.5">
                            <Icon className={`w-3 h-3 ${color}`} />
                            <span className={color}>{e.event_type}</span>
                            <span className="text-muted-foreground">· {fmtNum(e.qty || 0)} pcs</span>
                          </div>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {fmtElapsedSince(e.timestamp)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
