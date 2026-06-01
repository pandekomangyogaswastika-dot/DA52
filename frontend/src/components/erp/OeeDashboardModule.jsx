/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  RefreshCw, TrendingUp, Activity, Zap, ShieldCheck,
  Gauge, AlertTriangle, Factory, Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { GlassCard, GlassPanel } from '@/components/ui/glass';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { toast } from 'sonner';

/* ─── OeeDashboardModule — Phase 20A ──────────────────────────────────────
   OEE = Availability × Performance × Quality.
   - KPI strip: avg OEE / A / P / Q
   - Per-line table (sortable by OEE asc)
   - Day-range selector + drill-down Sheet per (line,day)
────────────────────────────────────────────────────────────────────────── */

const toISO = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const pct = (v) => v == null ? '—' : `${(v * 100).toFixed(1)}%`;
const fmtMin = (m) => m == null ? '—' : `${Math.round(m)} m`;

function oeeColor(v) {
  if (v == null) return 'muted';
  if (v >= 0.85) return 'emerald';
  if (v >= 0.65) return 'sky';
  if (v >= 0.4) return 'amber';
  return 'red';
}

function KpiTile({ icon: Icon, label, value, sub, accent = 'sky', testId }) {
  const accentMap = {
    sky:     'text-sky-300 bg-sky-400/15 border-sky-400/25',
    emerald: 'text-emerald-300 bg-emerald-400/15 border-emerald-400/25',
    amber:   'text-amber-300 bg-amber-400/15 border-amber-400/25',
    red:     'text-red-300 bg-red-400/15 border-red-400/25',
    muted:   'text-muted-foreground bg-foreground/5 border-foreground/15',
  };
  return (
    <GlassCard className="p-4" hover={false} data-testid={testId}>
      <div className="flex items-center gap-3">
        <div className={`rounded-lg border p-2 ${accentMap[accent]}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
            {label}
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums leading-tight text-foreground">
            {value}
          </div>
          {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
        </div>
      </div>
    </GlassCard>
  );
}

function OeePill({ value }) {
  const acc = oeeColor(value);
  const map = {
    emerald: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/25',
    sky:     'bg-sky-500/15 text-sky-300 border-sky-400/25',
    amber:   'bg-amber-500/15 text-amber-300 border-amber-400/25',
    red:     'bg-red-500/15 text-red-300 border-red-400/25',
    muted:   'bg-foreground/10 text-muted-foreground border-foreground/15',
  };
  return (
    <Badge variant="outline" className={`font-mono tabular-nums ${map[acc]}`}>
      {pct(value)}
    </Badge>
  );
}

export default function OeeDashboardModule({ token }) {
  const today = useMemo(() => { const t = new Date(); t.setHours(0,0,0,0); return t; }, []);
  const [fromDate, setFromDate] = useState(() => toISO(addDays(today, -6)));
  const [toDate, setToDate] = useState(() => toISO(today));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  // Drill
  const [drillOpen, setDrillOpen] = useState(false);
  const [drillData, setDrillData] = useState(null);
  const [drillLoading, setDrillLoading] = useState(false);

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/rahaza/oee/daily?from=${fromDate}&to=${toDate}`, { headers });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      setData(j);
    } catch (e) {
      setError(e.message);
      toast.error(`Gagal memuat OEE: ${e.message}`);
    } finally { setLoading(false); }
  }, [headers, fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  const openDrill = useCallback(async (lineId, dayIso) => {
    setDrillOpen(true);
    setDrillLoading(true); setDrillData(null);
    try {
      const r = await fetch(`/api/rahaza/oee/line/${lineId}?date=${dayIso}`, { headers });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      setDrillData(j);
    } catch (e) {
      toast.error(`Gagal memuat detail: ${e.message}`);
    } finally { setDrillLoading(false); }
  }, [headers]);

  const kpis = data?.kpis || {};
  const byLine = data?.by_line || [];
  const rows = data?.rows || [];
  const days = data?.days || [];

  // Sort by-line ascending by avg_oee (lowest first → most attention)
  const byLineSorted = useMemo(() => {
    const withMetric = byLine.filter((r) => r.avg_oee != null);
    const without    = byLine.filter((r) => r.avg_oee == null);
    withMetric.sort((a, b) => (a.avg_oee ?? 0) - (b.avg_oee ?? 0));
    return [...withMetric, ...without];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byLine]);

  // Rows grouped by line id -> day -> row (for calendar view)
  const matrix = useMemo(() => {
    const m = new Map();
    rows.forEach((r) => {
      if (!m.has(r.line_id)) m.set(r.line_id, new Map());
      m.get(r.line_id).set(r.date, r);
    });
    return m;
  }, [rows]);

  return (
    <div className="space-y-4" data-testid="oee-page">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-1">
        <div>
          <div className="flex items-center gap-2">
            <Gauge className="w-5 h-5 text-sky-300" />
            <h1 className="text-2xl font-bold text-foreground">OEE Dashboard</h1>
            <Badge variant="outline" className="text-[10px] tracking-wide">Phase 20A</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Availability × Performance × Quality — per line per hari. Klik sel untuk detail downtime & output.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date" value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="bg-[var(--card-surface)] border border-[var(--glass-border)] rounded-md px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-sky-400/40"
            data-testid="oee-from-input"
          />
          <span className="text-xs text-muted-foreground">→</span>
          <input
            type="date" value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="bg-[var(--card-surface)] border border-[var(--glass-border)] rounded-md px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-sky-400/40"
            data-testid="oee-to-input"
          />
          <Button
            variant="outline" size="sm"
            onClick={load} disabled={loading}
            data-testid="oee-refresh-button"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="ml-1.5">Muat Ulang</span>
          </Button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile
          icon={Gauge} label="OEE Rata-Rata"
          value={pct(kpis.avg_oee)}
          sub={`Target ≥ 85%`}
          accent={oeeColor(kpis.avg_oee)}
          testId="oee-kpi-overall"
        />
        <KpiTile
          icon={Clock} label="Availability"
          value={pct(kpis.avg_availability)}
          sub={`${fmtMin(kpis.total_downtime_min)} downtime / ${fmtMin(kpis.total_planned_min)}`}
          accent={oeeColor(kpis.avg_availability)}
          testId="oee-kpi-availability"
        />
        <KpiTile
          icon={Activity} label="Performance"
          value={pct(kpis.avg_performance)}
          sub={`${kpis.total_output} / ${kpis.total_target} pcs`}
          accent={oeeColor(kpis.avg_performance)}
          testId="oee-kpi-performance"
        />
        <KpiTile
          icon={ShieldCheck} label="Quality"
          value={pct(kpis.avg_quality)}
          sub={`${kpis.total_qc_pass} pass / ${kpis.total_qc_fail} fail`}
          accent={oeeColor(kpis.avg_quality)}
          testId="oee-kpi-quality"
        />
      </div>

      {/* Per-line summary table */}
      <GlassPanel className="p-0 overflow-hidden" data-testid="oee-by-line-panel">
        <div className="p-3 border-b border-[var(--glass-border)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Factory className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Ringkasan Per Line ({byLineSorted.length}) · sort: OEE terendah
            </span>
          </div>
        </div>
        {loading && !data ? (
          <div className="p-4 space-y-2">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-md" />)}
          </div>
        ) : error ? (
          <div className="p-4 text-sm text-red-300">{error}</div>
        ) : byLineSorted.length === 0 ? (
          <div className="p-10 text-center">
            <Factory className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
            <div className="text-sm text-muted-foreground">Belum ada line untuk dihitung.</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-foreground/5 text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">Line</th>
                  <th className="text-left px-3 py-2">OEE</th>
                  <th className="text-left px-3 py-2">Avail</th>
                  <th className="text-left px-3 py-2">Perf</th>
                  <th className="text-left px-3 py-2">Qlty</th>
                  <th className="text-left px-3 py-2">Planned</th>
                  <th className="text-left px-3 py-2">Downtime</th>
                  <th className="text-left px-3 py-2">Output / Target</th>
                  <th className="text-left px-3 py-2">QC</th>
                </tr>
              </thead>
              <tbody>
                {byLineSorted.map((r) => (
                  <tr
                    key={r.line_id}
                    className="border-t border-[var(--glass-border)]/50 hover:bg-foreground/5"
                    data-testid={`oee-by-line-row-${r.line_id}`}
                  >
                    <td className="px-3 py-2">
                      <div className="font-mono font-semibold text-foreground">{r.line_code}</div>
                      <div className="text-muted-foreground truncate max-w-[200px]">{r.line_name}</div>
                    </td>
                    <td className="px-3 py-2"><OeePill value={r.avg_oee} /></td>
                    <td className="px-3 py-2 font-mono text-foreground/80">{pct(r.avg_availability)}</td>
                    <td className="px-3 py-2 font-mono text-foreground/80">{pct(r.avg_performance)}</td>
                    <td className="px-3 py-2 font-mono text-foreground/80">{pct(r.avg_quality)}</td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">{fmtMin(r.planned_min)}</td>
                    <td className={`px-3 py-2 font-mono ${r.downtime_min > 0 ? 'text-red-300' : 'text-muted-foreground'}`}>
                      {fmtMin(r.downtime_min)}
                    </td>
                    <td className="px-3 py-2 font-mono text-foreground/80">
                      {r.output_qty} / {r.target_qty}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      <span className="text-emerald-300">{r.qc_pass}</span>
                      <span className="text-muted-foreground mx-0.5">/</span>
                      <span className="text-red-300">{r.qc_fail}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassPanel>

      {/* Calendar heatmap: rows = lines, columns = days */}
      {byLineSorted.length > 0 && days.length > 0 && (
        <GlassPanel className="p-0 overflow-hidden" data-testid="oee-heatmap-panel">
          <div className="p-3 border-b border-[var(--glass-border)] flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Heatmap OEE Harian — klik sel untuk detail
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px] font-mono">
              <thead className="bg-foreground/5 text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-1.5 sticky left-0 bg-[var(--card-surface)]">Line</th>
                  {days.map((d) => (
                    <th key={d} className="text-center px-2 py-1.5 min-w-[70px]">{d.slice(5)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byLineSorted.map((ln) => (
                  <tr key={ln.line_id} className="border-t border-[var(--glass-border)]/50">
                    <td className="px-3 py-1 sticky left-0 bg-[var(--card-surface)] text-foreground font-semibold">
                      {ln.line_code}
                    </td>
                    {days.map((d) => {
                      const r = matrix.get(ln.line_id)?.get(d);
                      const v = r?.oee;
                      const acc = oeeColor(v);
                      const bg = {
                        emerald: 'bg-emerald-500/25 hover:bg-emerald-500/40',
                        sky:     'bg-sky-500/20 hover:bg-sky-500/35',
                        amber:   'bg-amber-500/25 hover:bg-amber-500/40',
                        red:     'bg-red-500/25 hover:bg-red-500/40',
                        muted:   'bg-foreground/5 hover:bg-foreground/10',
                      }[acc];
                      return (
                        <td key={d} className="p-1 text-center">
                          <button
                            type="button"
                            onClick={() => openDrill(ln.line_id, d)}
                            className={`w-full rounded-md border border-[var(--glass-border)]/50 px-1 py-1.5 text-[10px] transition-colors ${bg}`}
                            title={r?.has_data ? `${ln.line_code} · ${d} · OEE ${pct(v)} (A ${pct(r.availability)} · P ${pct(r.performance)} · Q ${pct(r.quality)})` : `${ln.line_code} · ${d} · no data`}
                            data-testid={`oee-cell-${ln.line_id}-${d}`}
                          >
                            <div className="font-mono font-semibold">{pct(v)}</div>
                            {r?.has_data && (
                              <div className="text-[8px] text-muted-foreground mt-0.5">
                                {r.output_qty}/{r.target_qty}
                              </div>
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassPanel>
      )}

      {/* Drill-down Sheet */}
      <Sheet open={drillOpen} onOpenChange={setDrillOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-lg overflow-y-auto bg-[var(--card-surface)]/95 backdrop-blur-[var(--glass-blur)] border-l border-[var(--glass-border)]"
          data-testid="oee-drill-sheet"
        >
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Gauge className="w-4 h-4" />
              {drillData?.line?.code ? `${drillData.line.code} · ${drillData.date}` : 'Detail OEE'}
            </SheetTitle>
            <SheetDescription>
              Breakdown harian: Availability, Performance, Quality + event.
            </SheetDescription>
          </SheetHeader>

          {drillLoading ? (
            <div className="space-y-3 mt-4">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : drillData?.metrics ? (
            <div className="space-y-3 mt-4">
              <GlassPanel className="p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">OEE</span>
                  <OeePill value={drillData.metrics.oee} />
                </div>
                <Progress value={(drillData.metrics.oee ?? 0) * 100} className="h-2" data-testid="oee-drill-oee-bar" />
                <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                  <div>
                    <div className="text-[9px] uppercase tracking-wide text-muted-foreground">Availability</div>
                    <div className="font-mono font-semibold">{pct(drillData.metrics.availability)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase tracking-wide text-muted-foreground">Performance</div>
                    <div className="font-mono font-semibold">{pct(drillData.metrics.performance)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase tracking-wide text-muted-foreground">Quality</div>
                    <div className="font-mono font-semibold">{pct(drillData.metrics.quality)}</div>
                  </div>
                </div>
              </GlassPanel>

              <GlassPanel className="p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">Numerik</div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs font-mono">
                  <div><span className="text-muted-foreground">Planned:</span> {fmtMin(drillData.metrics.planned_min)}</div>
                  <div><span className="text-muted-foreground">Downtime:</span> {fmtMin(drillData.metrics.downtime_min)}</div>
                  <div><span className="text-muted-foreground">Output:</span> {drillData.metrics.output_qty}</div>
                  <div><span className="text-muted-foreground">Target:</span> {drillData.metrics.target_qty}</div>
                  <div><span className="text-muted-foreground">QC Pass:</span> {drillData.metrics.qc_pass}</div>
                  <div><span className="text-muted-foreground">QC Fail:</span> {drillData.metrics.qc_fail}</div>
                </div>
              </GlassPanel>

              {(drillData.downtime_events?.length > 0) && (
                <GlassPanel className="p-3">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 text-red-300" />
                    Downtime ({drillData.downtime_events.length})
                  </div>
                  <div className="space-y-1.5">
                    {drillData.downtime_events.map((e) => (
                      <div key={e.id} className="text-[11px] text-foreground/80 border-l-2 border-red-400/40 pl-2">
                        <div className="font-mono">
                          {e.created_at?.slice(11, 16)} → {e.resolved_at?.slice(11, 16) || '—'}
                        </div>
                        <div className="text-muted-foreground truncate">{e.message || 'Mesin Rusak'}</div>
                      </div>
                    ))}
                  </div>
                </GlassPanel>
              )}

              {(drillData.events?.length > 0) && (
                <GlassPanel className="p-3">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2 flex items-center gap-1">
                    <Zap className="w-3 h-3 text-sky-300" />
                    Event Produksi ({drillData.events.length})
                  </div>
                  <div className="max-h-60 overflow-y-auto space-y-1">
                    {drillData.events.slice(0, 40).map((e) => (
                      <div key={e.id} className="flex items-center justify-between text-[11px] font-mono">
                        <span className="text-muted-foreground">{e.timestamp?.slice(11, 16)}</span>
                        <span className={
                          e.event_type === 'qc_fail' ? 'text-red-300' :
                          e.event_type === 'qc_pass' ? 'text-emerald-300' :
                          'text-foreground/80'
                        }>
                          {e.event_type}
                        </span>
                        <span className="font-semibold">{e.qty}</span>
                      </div>
                    ))}
                  </div>
                </GlassPanel>
              )}
            </div>
          ) : (
            <div className="mt-4 text-sm text-muted-foreground">Tidak ada data detail.</div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
