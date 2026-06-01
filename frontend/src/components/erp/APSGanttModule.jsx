/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Calendar, RefreshCw, AlertTriangle, Clock, TrendingUp,
  Filter, Search, X, Layers, Package, Factory, CalendarRange, ChevronRight,
  Maximize2, ZoomIn, ZoomOut, CheckCircle2, Activity, ChevronDown, ChevronUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { GlassCard, GlassPanel } from '@/components/ui/glass';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { toast } from 'sonner';
import APSAutoScheduleDialog from './APSAutoScheduleDialog';

/* ─── APSGanttModule — Advanced Planning & Scheduling (Phase 19A) ──────────
   Custom Gantt chart:
   - Sticky left column (line list)
   - Sticky top header (date axis)
   - Absolute-positioned WO bars per row
   - Capacity heatmap strip under each line row
   - Side panel detail + reschedule dialog
 ──────────────────────────────────────────────────────────────────────────── */

// ── Status & Risk semantics (per design_guidelines.md) ──────────────────────
const STATUS_META = {
  draft:         { label: 'Draft',     bar: 'bg-foreground/10 border-foreground/15', text: 'text-muted-foreground' },
  released:      { label: 'Released',  bar: 'bg-sky-400/20 border-sky-400/30',       text: 'text-sky-300' },
  in_production: { label: 'Produksi',  bar: 'bg-emerald-400/25 border-emerald-400/40', text: 'text-emerald-300' },
  completed:     { label: 'Selesai',   bar: 'bg-emerald-500/15 border-emerald-400/25', text: 'text-emerald-200' },
  cancelled:     { label: 'Batal',     bar: 'bg-foreground/10 border-foreground/15', text: 'text-muted-foreground' },
};

const RISK_META = {
  on_track: { label: 'On-Track',   chip: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/25' },
  at_risk:  { label: 'Berisiko',   chip: 'bg-amber-500/15 text-amber-300 border-amber-400/25' },
  overdue:  { label: 'Terlambat',  chip: 'bg-red-500/15 text-red-300 border-red-400/25' },
};

const PRIORITY_META = {
  normal: { label: 'Normal', chip: 'bg-foreground/10 text-muted-foreground border-foreground/15' },
  high:   { label: 'High',   chip: 'bg-amber-500/15 text-amber-300 border-amber-400/25' },
  urgent: { label: 'Urgent', chip: 'bg-red-500/15 text-red-300 border-red-400/25' },
};

const ZOOM = {
  day:   { pxPerDay: 56, label: 'Hari'    },
  week:  { pxPerDay: 22, label: 'Minggu'  },
  month: { pxPerDay: 10, label: 'Bulan'   },
};

// ── Utilities ───────────────────────────────────────────────────────────────
const toISO = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};
const parseISO = (s) => {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const diffDays = (a, b) => Math.round((b - a) / 86400000);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const fmtShort = (d) => d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
const fmtWeekday = (d) => d.toLocaleDateString('id-ID', { weekday: 'short' });

const LINE_HEIGHT = 56;        // h-14
const HEATMAP_HEIGHT = 20;     // smaller heatmap strip
const ROW_HEIGHT = LINE_HEIGHT + HEATMAP_HEIGHT;
const HEADER_HEIGHT = 56;
const LEFT_COL_WIDTH = 272;

// ── KPI Tile ────────────────────────────────────────────────────────────────
function KpiTile({ icon: Icon, label, value, accent = 'sky', testId }) {
  const accentMap = {
    sky:     'text-sky-300 bg-sky-400/15 border-sky-400/25',
    emerald: 'text-emerald-300 bg-emerald-400/15 border-emerald-400/25',
    amber:   'text-amber-300 bg-amber-400/15 border-amber-400/25',
    red:     'text-red-300 bg-red-400/15 border-red-400/25',
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
        </div>
      </div>
    </GlassCard>
  );
}

// ── Heatmap cell helper ─────────────────────────────────────────────────────
function heatmapColor(pct) {
  if (pct == null) return 'bg-foreground/5';
  if (pct > 110) return 'bg-red-400/35';
  if (pct > 90)  return 'bg-amber-400/35';
  if (pct > 70)  return 'bg-sky-400/30';
  if (pct > 0)   return 'bg-emerald-400/25';
  return 'bg-foreground/5';
}

// ── Main Module ─────────────────────────────────────────────────────────────
export default function APSGanttModule({ token }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  // Filters
  const today = useMemo(() => { const t = new Date(); t.setHours(0,0,0,0); return t; }, []);
  const [fromDate, setFromDate] = useState(() => toISO(addDays(today, -3)));
  const [toDate,   setToDate]   = useState(() => toISO(addDays(today,  21)));
  const [search,   setSearch]   = useState('');
  const [statusF,  setStatusF]  = useState('all');
  const [priorityF,setPriorityF]= useState('all');
  const [zoom,     setZoom]     = useState('day');

  // Selection
  const [selectedWoId, setSelectedWoId] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Reschedule dialog
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleStart, setRescheduleStart] = useState('');
  const [rescheduleEnd,   setRescheduleEnd]   = useState('');
  const [rescheduling, setRescheduling] = useState(false);

  // Sprint 22: Line Balance integration
  const [balanceData, setBalanceData] = useState(null);
  const [balancePanelOpen, setBalancePanelOpen] = useState(false);
  const [balanceLoading, setBalanceLoading] = useState(false);

  const fetchLineBalance = useCallback(async (dateForBalance) => {
    setBalanceLoading(true);
    try {
      const r = await fetch(`/api/rahaza/supervisor/line-balance?assign_date=${dateForBalance}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (r.ok) { const d = await r.json(); setBalanceData(d); setBalancePanelOpen(true); }
    } finally { setBalanceLoading(false); }
  }, [token]);

  // Auto-schedule (Phase 19B) dialog
  const [autoScheduleOpen, setAutoScheduleOpen] = useState(false);

  const scrollRef = useRef(null);
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }), [token]);

  // Fetch gantt data
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ from: fromDate, to: toDate });
      if (statusF && statusF !== 'all') params.set('status', statusF);
      if (priorityF && priorityF !== 'all') params.set('priority', priorityF);
      const r = await fetch(`/api/rahaza/aps/gantt?${params.toString()}`, { headers });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      setData(j);
    } catch (e) {
      setError(e.message); toast.error(`Gagal memuat data APS: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [headers, fromDate, toDate, statusF, priorityF]);

  useEffect(() => { load(); }, [load]);

  // Fetch WO detail
  const openDetail = useCallback(async (woId) => {
    setSelectedWoId(woId);
    setSheetOpen(true);
    setDetailLoading(true);
    setDetailData(null);
    try {
      const r = await fetch(`/api/rahaza/aps/wo/${woId}`, { headers });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      setDetailData(j);
    } catch (e) {
      toast.error(`Gagal memuat detail: ${e.message}`);
    } finally { setDetailLoading(false); }
  }, [headers]);

  const submitReschedule = async () => {
    if (!selectedWoId) return;
    if (!rescheduleStart || !rescheduleEnd) {
      toast.error('Tanggal mulai & selesai wajib diisi');
      return;
    }
    if (rescheduleEnd < rescheduleStart) {
      toast.error('Tanggal selesai harus ≥ mulai');
      return;
    }
    setRescheduling(true);
    try {
      const r = await fetch(`/api/rahaza/aps/wo/${selectedWoId}/reschedule`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ target_start_date: rescheduleStart, target_end_date: rescheduleEnd }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      toast.success('Jadwal berhasil diperbarui');
      setRescheduleOpen(false);
      await Promise.all([load(), openDetail(selectedWoId)]);
      // Sprint 22: auto-fetch line balance for the rescheduled start date
      fetchLineBalance(rescheduleStart);
    } catch (e) {
      toast.error(`Gagal: ${e.message}`);
    } finally { setRescheduling(false); }
  };

  // Derived data
  const days = data?.days || [];
  const pxPerDay = ZOOM[zoom].pxPerDay;
  const timelineWidth = days.length * pxPerDay;

  const lines = data?.lines || [];
  const bars  = data?.bars  || [];
  const capacity = data?.capacity || [];
  const kpis = data?.kpis || { total_wo: 0, overdue_count: 0, at_risk_count: 0, load_avg_pct: 0 };

  // Apply client-side search filter on bars
  const filteredBars = useMemo(() => {
    if (!search.trim()) return bars;
    const q = search.toLowerCase();
    return bars.filter((b) =>
      (b.wo_number || '').toLowerCase().includes(q) ||
      (b.model_code || '').toLowerCase().includes(q) ||
      (b.model_name || '').toLowerCase().includes(q)
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, search]);

  // Group bars by line
  const barsByLine = useMemo(() => {
    const m = new Map();
    const unassigned = [];
    filteredBars.forEach((b) => {
      if (b.line_id) {
        const arr = m.get(b.line_id) || [];
        arr.push(b); m.set(b.line_id, arr);
      } else {
        unassigned.push(b);
      }
    });
    // Greedy lane assignment per line: bars that don't overlap can share a lane.
    const assignLanes = (bars) => {
      const sorted = [...bars].sort((a, b) =>
        (a.visible_start || a.start_date).localeCompare(b.visible_start || b.start_date)
      );
      const laneEndISO = []; // per lane, last end date consumed
      sorted.forEach((b) => {
        const s = b.visible_start || b.start_date;
        const e = b.visible_end || b.end_date;
        let placed = false;
        for (let li = 0; li < laneEndISO.length; li += 1) {
          if (s > laneEndISO[li]) {
            laneEndISO[li] = e;
            b.__lane = li;
            placed = true;
            break;
          }
        }
        if (!placed) {
          b.__lane = laneEndISO.length;
          laneEndISO.push(e);
        }
      });
      return { bars: sorted, laneCount: Math.max(1, laneEndISO.length) };
    };
    const lineBars = new Map();
    for (const [lid, arr] of m.entries()) {
      lineBars.set(lid, assignLanes(arr));
    }
    const unassignedObj = assignLanes(unassigned);
    return { lineBars, unassigned: unassignedObj };
  }, [filteredBars]);

  // Group capacity by line+date
  const capMap = useMemo(() => {
    const m = new Map();
    capacity.forEach((c) => { m.set(`${c.line_id}|${c.date}`, c); });
    return m;
  }, [capacity]);

  // Compute bar offset/width in px
  const barGeometry = (b) => {
    const vs = parseISO(b.visible_start || b.start_date);
    const ve = parseISO(b.visible_end   || b.end_date);
    const from = parseISO(data.meta.from);
    if (!vs || !ve || !from) return { left: 0, width: 0 };
    const offset = diffDays(from, vs);
    const span = Math.max(1, diffDays(vs, ve) + 1);
    return { left: offset * pxPerDay, width: span * pxPerDay };
  };

  // Weekend indexes
  const dayObjs = useMemo(() => days.map((d) => parseISO(d)), [days]);
  const todayIdx = useMemo(() => {
    if (!data?.meta?.today) return -1;
    const t = parseISO(data.meta.today);
    if (!t || !days.length) return -1;
    return diffDays(parseISO(days[0]), t);
  }, [data, days]);

  // Production Calendar holidays — Set of YYYY-MM-DD strings for fast lookup
  const holidaySet = useMemo(() => {
    const holidays = data?.holidays || [];
    return new Set(holidays.map(h => h.date));
  }, [data]);
  const holidayMap = useMemo(() => {
    const m = {};
    (data?.holidays || []).forEach(h => { m[h.date] = h.name; });
    return m;
  }, [data]);

  // Line-level aggregated KPI (today WIP count, active WO count)
  const lineKpi = useMemo(() => {
    const m = new Map();
    lines.forEach((l) => m.set(l.id, { activeWo: 0, qtyTotal: 0 }));
    filteredBars.forEach((b) => {
      if (!b.line_id) return;
      const k = m.get(b.line_id);
      if (!k) return;
      if (['released','in_production'].includes(b.status)) k.activeWo += 1;
      k.qtyTotal += (b.qty || 0);
    });
    return m;
  }, [lines, filteredBars]);

  // Lane height — bars stack vertically with 4px gap
  const LANE_BAR_HEIGHT = 20;
  const LANE_GAP = 4;
  const laneTop = (lane) => 6 + lane * (LANE_BAR_HEIGHT + LANE_GAP);

  const refresh = () => load();

  return (
    <div
      className="relative noise-overlay flex flex-col min-h-[calc(100vh-80px)] aps-root"
      data-testid="aps-page"
      style={{
        // Scoped APS local tokens per design guidelines
        '--aps-grid-line': 'rgba(255,255,255,0.07)',
        '--aps-grid-line-strong': 'rgba(255,255,255,0.12)',
        '--aps-now-line': 'rgba(47,183,255,0.65)',
      }}
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 mb-4 px-1">
        <div>
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-foreground/80" />
            <h1 className="text-2xl font-bold text-foreground">APS — Jadwal Produksi (Gantt)</h1>
            <Badge variant="outline" className="text-[10px] tracking-wide">Phase 19A</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Pantau beban line, deteksi risiko overdue/at-risk, dan jadwal ulang WO dengan cepat.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline" size="sm"
            onClick={refresh} disabled={loading}
            data-testid="aps-refresh-button"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="ml-1.5">Muat Ulang</span>
          </Button>
          {/* Auto-schedule (Phase 19B) */}
          <Button
            size="sm"
            onClick={() => setAutoScheduleOpen(true)}
            data-testid="aps-auto-schedule-button"
          >
            <TrendingUp className="w-4 h-4" />
            <span className="ml-1.5">Auto-Schedule</span>
          </Button>

          {/* Sprint 22: Line Balance Toggle */}
          <Button
            size="sm"
            variant={balancePanelOpen ? 'default' : 'outline'}
            onClick={() => {
              if (!balancePanelOpen && !balanceData) {
                fetchLineBalance(fromDate);
              } else {
                setBalancePanelOpen(v => !v);
              }
            }}
            data-testid="aps-line-balance-btn"
            className="border border-[var(--glass-border)]"
          >
            <Activity className={`w-4 h-4 ${balanceLoading ? 'animate-pulse' : ''}`} />
            <span className="ml-1.5">Line Balance</span>
          </Button>
        </div>
      </div>

      {/* ── KPI Strip ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <KpiTile
          icon={Package} label="Total WO" value={kpis.total_wo}
          accent="sky" testId="aps-kpi-total-wo"
        />
        <KpiTile
          icon={AlertTriangle} label="Terlambat" value={kpis.overdue_count}
          accent={kpis.overdue_count > 0 ? 'red' : 'emerald'}
          testId="aps-kpi-overdue"
        />
        <KpiTile
          icon={Clock} label="Berisiko" value={kpis.at_risk_count}
          accent={kpis.at_risk_count > 0 ? 'amber' : 'emerald'}
          testId="aps-kpi-at-risk"
        />
        <KpiTile
          icon={TrendingUp} label="Load Rata-Rata" value={`${kpis.load_avg_pct?.toFixed?.(1) ?? kpis.load_avg_pct}%`}
          accent={kpis.load_avg_pct > 110 ? 'red' : kpis.load_avg_pct > 90 ? 'amber' : 'emerald'}
          testId="aps-kpi-load-avg"
        />
      </div>

      {/* ── Line Balance Panel (Sprint 22) ─────────────────────────────── */}
      {balancePanelOpen && balanceData && (
        <div className="mb-4 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl p-4" data-testid="aps-balance-panel">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              <span className="font-semibold text-foreground text-sm">Line Balance — {balanceData.assign_date}</span>
              <span className="text-xs text-muted-foreground">Factory: <span className={
                balanceData.summary.factory_balance_pct > 110 ? 'text-red-300 font-bold' :
                balanceData.summary.factory_balance_pct < 70 ? 'text-amber-300 font-bold' : 'text-emerald-300 font-bold'
              }>{balanceData.summary.factory_balance_pct ?? '—'}%</span></span>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-red-300">{balanceData.summary.overloaded_lines} overloaded</span>
              <span className="text-amber-300">{balanceData.summary.underutilized_lines} under-utilized</span>
              <button onClick={() => setBalancePanelOpen(false)} className="text-muted-foreground hover:text-foreground ml-2">✕</button>
            </div>
          </div>
          {balanceData.lines.length === 0 ? (
            <p className="text-xs text-muted-foreground">Belum ada assignment untuk tanggal {balanceData.assign_date}. Tambahkan di menu Assign Lini terlebih dahulu.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
              {balanceData.lines.map(line => {
                const ratio = line.balance_ratio_pct;
                const barColor = ratio > 110 ? '#f87171' : ratio < 70 ? '#fbbf24' : '#34d399';
                const textColor = ratio > 110 ? 'text-red-300' : ratio < 70 ? 'text-amber-300' : 'text-emerald-300';
                return (
                  <div key={line.line_id} className={`p-2.5 rounded-lg border ${
                    line.imbalance_type === 'overloaded' ? 'border-red-300/20 bg-red-400/5' :
                    line.imbalance_type === 'underutilized' ? 'border-amber-300/20 bg-amber-400/5' :
                    'border-emerald-300/20 bg-emerald-400/5'
                  }`} data-testid={`aps-balance-line-${line.line_code}`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-semibold text-foreground truncate">{line.line_name}</span>
                      <span className={`text-xs font-bold font-mono ${textColor}`}>{ratio ?? '?'}%</span>
                    </div>
                    <div className="h-1.5 bg-[var(--glass-bg)] rounded-full overflow-hidden mb-1">
                      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(ratio || 0, 150)}%`, backgroundColor: barColor, maxWidth: '100%' }} />
                    </div>
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>{line.operator_count} op · {line.total_target_pcs?.toLocaleString()} pcs target</span>
                      <span>{line.estimated_capacity?.toLocaleString()} est</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-[10px] text-muted-foreground mt-2">
            Panel ini otomatis muncul setelah reschedule WO. Klik "Line Balance" di atas untuk refresh manual.
          </p>
        </div>
      )}

      {/* ── Toolbar ────────────────────────────────────────────────────── */}
      <GlassPanel className="p-3 mb-4" data-testid="aps-toolbar">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <CalendarRange className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Rentang:</span>
            <input
              type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
              className="bg-[var(--card-surface)] border border-[var(--glass-border)] rounded-md px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-sky-400/40"
              data-testid="aps-toolbar-from-input"
            />
            <span className="text-xs text-muted-foreground">→</span>
            <input
              type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
              className="bg-[var(--card-surface)] border border-[var(--glass-border)] rounded-md px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-sky-400/40"
              data-testid="aps-toolbar-to-input"
            />
          </div>

          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 absolute left-2 text-muted-foreground pointer-events-none" />
            <Input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari WO / Model…"
              className="h-8 pl-7 text-xs w-48"
              data-testid="aps-toolbar-search-input"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 text-muted-foreground hover:text-foreground"
                aria-label="Hapus pencarian"
                type="button"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <Select value={statusF} onValueChange={setStatusF}>
            <SelectTrigger className="h-8 w-[140px] text-xs" data-testid="aps-toolbar-status-select">
              <Filter className="w-3 h-3 mr-1" />
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Status</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="released">Released</SelectItem>
              <SelectItem value="in_production">Produksi</SelectItem>
              <SelectItem value="completed">Selesai</SelectItem>
              <SelectItem value="cancelled">Batal</SelectItem>
            </SelectContent>
          </Select>

          <Select value={priorityF} onValueChange={setPriorityF}>
            <SelectTrigger className="h-8 w-[140px] text-xs" data-testid="aps-toolbar-priority-select">
              <SelectValue placeholder="Prioritas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Prioritas</SelectItem>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="urgent">Urgent</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex-1" />

          <ToggleGroup
            type="single" value={zoom}
            onValueChange={(v) => v && setZoom(v)}
            size="sm"
          >
            <ToggleGroupItem value="day" className="h-8 px-2 text-xs" data-testid="aps-toolbar-zoom-toggle-day">
              <ZoomIn className="w-3 h-3 mr-1" /> Hari
            </ToggleGroupItem>
            <ToggleGroupItem value="week" className="h-8 px-2 text-xs" data-testid="aps-toolbar-zoom-toggle-week">
              <Maximize2 className="w-3 h-3 mr-1" /> Mgg
            </ToggleGroupItem>
            <ToggleGroupItem value="month" className="h-8 px-2 text-xs" data-testid="aps-toolbar-zoom-toggle-month">
              <ZoomOut className="w-3 h-3 mr-1" /> Bln
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t border-[var(--glass-border)]" data-testid="aps-legend">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Legenda:</span>
          {Object.entries(STATUS_META).filter(([k]) => k !== 'cancelled').map(([k, m]) => (
            <div key={k} className="flex items-center gap-1.5 text-xs">
              <span className={`inline-block w-3 h-3 rounded-sm border ${m.bar}`} />
              <span className="text-muted-foreground">{m.label}</span>
            </div>
          ))}
          <span className="text-muted-foreground/50">|</span>
          {Object.entries(RISK_META).map(([k, m]) => (
            <Badge key={k} variant="outline" className={`text-[10px] ${m.chip}`}>
              {m.label}
            </Badge>
          ))}
          <span className="text-muted-foreground/50">|</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Heatmap:</span>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className="inline-block w-3 h-3 rounded-sm bg-emerald-400/25" /> &lt;70%
            <span className="inline-block w-3 h-3 rounded-sm bg-sky-400/30 ml-1" /> 70–90%
            <span className="inline-block w-3 h-3 rounded-sm bg-amber-400/35 ml-1" /> 90–110%
            <span className="inline-block w-3 h-3 rounded-sm bg-red-400/35 ml-1" /> &gt;110%
          </div>
        </div>
      </GlassPanel>

      {/* ── Gantt Viewport ──────────────────────────────────────────────── */}
      <GlassPanel className="flex-1 p-0 overflow-hidden">
        {loading && !data ? (
          <div className="p-6 space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-md" />
            ))}
          </div>
        ) : error ? (
          <div className="p-6 text-sm text-red-300">{error}</div>
        ) : lines.length === 0 ? (
          <div className="p-10 text-center">
            <Factory className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
            <div className="text-sm text-muted-foreground">
              Belum ada line produksi. Tambahkan di menu Master Data → Line Produksi.
            </div>
          </div>
        ) : (
          <div
            ref={scrollRef}
            className="relative overflow-auto"
            style={{ maxHeight: '70vh' }}
            data-testid="aps-gantt-scroll-container"
          >
            <div
              className="relative"
              style={{ width: LEFT_COL_WIDTH + timelineWidth, minWidth: '100%' }}
            >
              {/* Sticky Header row */}
              <div
                className="sticky top-0 z-30 flex bg-[var(--card-surface)]/95 backdrop-blur border-b border-[var(--glass-border)]"
                style={{ height: HEADER_HEIGHT }}
                data-testid="aps-gantt-timeline-header"
              >
                {/* Sticky top-left corner (line header) */}
                <div
                  className="sticky left-0 z-40 flex items-center px-3 bg-[var(--card-surface)]/95 backdrop-blur border-r border-[var(--glass-border)] font-semibold text-xs uppercase tracking-wide text-muted-foreground"
                  style={{ width: LEFT_COL_WIDTH, minWidth: LEFT_COL_WIDTH }}
                  data-testid="aps-gantt-sticky-line-column-header"
                >
                  <Factory className="w-3.5 h-3.5 mr-1.5" />
                  Line Produksi
                </div>
                {/* Day cells */}
                <div className="relative flex" style={{ width: timelineWidth }}>
                  {dayObjs.map((d, i) => {
                    const weekend = d.getDay() === 0 || d.getDay() === 6;
                    const isToday = i === todayIdx;
                    const isHoliday = holidaySet.has(days[i]);
                    const holidayName = holidayMap[days[i]];
                    return (
                      <div
                        key={days[i]}
                        className={`flex flex-col items-center justify-center border-r border-[color:var(--aps-grid-line)] relative
                          ${weekend ? 'bg-foreground/5' : ''}
                          ${isToday ? 'bg-sky-400/10' : ''}
                          ${isHoliday ? 'bg-red-500/15' : ''}`}
                        style={{ width: pxPerDay, minWidth: pxPerDay }}
                        title={isHoliday ? `Hari Libur: ${holidayName}` : undefined}
                      >
                        {isHoliday && (
                          <span className="absolute top-0.5 left-0 right-0 h-0.5 bg-red-500/60 rounded-full" />
                        )}
                        <span className="text-[9px] uppercase tracking-wider font-mono"
                          style={{ color: isHoliday ? 'rgb(248,113,113)' : 'var(--muted-foreground)' }}>
                          {zoom === 'day' ? fmtWeekday(d) : ''}
                        </span>
                        <span className={`text-[10px] font-mono tabular-nums
                          ${isToday ? 'text-sky-300 font-bold' : isHoliday ? 'text-red-400 font-semibold' : 'text-foreground'}`}>
                          {fmtShort(d)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Line rows */}
              {lines.map((ln) => {
                const laneData = barsByLine.lineBars.get(ln.id) || { bars: [], laneCount: 1 };
                const bs = laneData.bars;
                const laneCount = laneData.laneCount;
                const lineAreaHeight = Math.max(LINE_HEIGHT, 12 + laneCount * (LANE_BAR_HEIGHT + LANE_GAP));
                const rowHeight = lineAreaHeight + HEATMAP_HEIGHT;
                const lkpi = lineKpi.get(ln.id) || { activeWo: 0, qtyTotal: 0 };
                return (
                  <div
                    key={ln.id}
                    className="flex border-b border-[var(--glass-border)]/70 hover:bg-[var(--card-surface-hover)] group"
                    style={{ minHeight: rowHeight }}
                    data-testid={`aps-line-row-${ln.id}`}
                  >
                    {/* Sticky left col */}
                    <div
                      className="sticky left-0 z-20 flex flex-col justify-center px-3 bg-[var(--card-surface)]/92 backdrop-blur border-r border-[var(--glass-border)]"
                      style={{ width: LEFT_COL_WIDTH, minWidth: LEFT_COL_WIDTH }}
                      data-testid={`aps-gantt-sticky-line-column-${ln.id}`}
                    >
                      <div className="flex items-center gap-1.5">
                        <Factory className="w-3.5 h-3.5 text-sky-300 shrink-0" />
                        <span className="text-sm font-semibold truncate text-foreground">{ln.code}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                        {ln.name}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        {ln.process_code && (
                          <Badge variant="outline" className="text-[9px] py-0 px-1.5 bg-foreground/5">
                            {ln.process_code}
                          </Badge>
                        )}
                        <span className="text-[10px] text-muted-foreground font-mono">
                          cap {ln.capacity_per_hour}/jam
                        </span>
                        <span className="text-[10px] text-muted-foreground">·</span>
                        <span className="text-[10px] text-emerald-300 font-mono">
                          {lkpi.activeWo} aktif
                        </span>
                      </div>
                    </div>

                    {/* Timeline area */}
                    <div className="relative" style={{ width: timelineWidth }}>
                      {/* Grid lines (weekends + holidays + today) — background only, no click */}
                      <div className="absolute inset-0 flex pointer-events-none" aria-hidden="true">
                        {dayObjs.map((d, i) => {
                          const weekend = d.getDay() === 0 || d.getDay() === 6;
                          const isToday = i === todayIdx;
                          const isHoliday = holidaySet.has(days[i]);
                          return (
                            <div
                              key={i}
                              className={`border-r border-[color:var(--aps-grid-line)]
                                ${weekend ? 'bg-foreground/5' : ''}
                                ${isToday ? 'bg-sky-400/5' : ''}
                                ${isHoliday ? 'bg-red-500/10' : ''}`}
                              style={{ width: pxPerDay, minWidth: pxPerDay }}
                              title={isHoliday ? holidayMap[days[i]] : undefined}
                            />
                          );
                        })}
                      </div>

                      {/* Now indicator line */}
                      {todayIdx >= 0 && (
                        <div
                          className="absolute top-0 bottom-0 pointer-events-none z-10"
                          style={{
                            left: todayIdx * pxPerDay + pxPerDay / 2,
                            borderLeft: '1px dashed var(--aps-now-line)',
                          }}
                          data-testid="aps-now-indicator"
                        />
                      )}

                      {/* WO bars */}
                      <div className="relative" style={{ height: lineAreaHeight }}>
                        {bs.map((b) => {
                          const g = barGeometry(b);
                          if (g.width <= 0) return null;
                          const sm = STATUS_META[b.status] || STATUS_META.draft;
                          const rm = RISK_META[b.risk] || RISK_META.on_track;
                          const selected = selectedWoId === b.wo_id;
                          const top = laneTop(b.__lane ?? 0);
                          return (
                            <button
                              key={b.wo_id}
                              type="button"
                              onClick={() => openDetail(b.wo_id)}
                              className={`absolute rounded-md border ${sm.bar} ${b.risk === 'overdue' ? 'ring-2 ring-red-400/50' : b.risk === 'at_risk' ? 'ring-1 ring-amber-400/45' : ''} ${selected ? 'ring-2 ring-sky-400 z-[18]' : 'z-[15]'} px-2 py-1 flex items-center overflow-hidden hover:shadow-lg hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 transition-[box-shadow,background-color,filter] duration-200 cursor-pointer pointer-events-auto`}
                              style={{ left: g.left, width: g.width, top, height: LANE_BAR_HEIGHT }}
                              title={`${b.wo_number} · ${b.model_code || '-'} · ${b.qty} pcs · ${rm.label}`}
                              data-testid={`aps-wo-bar-${b.wo_id}`}
                              aria-label={`Work order ${b.wo_number}, ${sm.label}, risiko ${rm.label}`}
                            >
                              {/* Progress overlay */}
                              {b.progress_pct > 0 && (
                                <div
                                  className="absolute inset-y-0 left-0 bg-emerald-400/30 rounded-l-md pointer-events-none"
                                  style={{ width: `${Math.min(100, b.progress_pct)}%` }}
                                />
                              )}
                              <span className={`relative text-[10px] font-semibold truncate ${sm.text}`}>
                                {b.wo_number}
                              </span>
                              {g.width > 120 && (
                                <span className="relative text-[9px] text-muted-foreground ml-1.5 font-mono">
                                  · {b.qty}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>

                      {/* Capacity heatmap strip */}
                      <div className="relative flex border-t border-[color:var(--aps-grid-line)] bg-foreground/[0.02]" style={{ height: HEATMAP_HEIGHT }}>
                        {days.map((d) => {
                          const c = capMap.get(`${ln.id}|${d}`);
                          const pct = c?.load_pct;
                          const color = heatmapColor(pct);
                          return (
                            <div
                              key={d}
                              className={`border-r border-[color:var(--aps-grid-line)] ${color} flex items-center justify-center`}
                              style={{ width: pxPerDay, minWidth: pxPerDay }}
                              title={c ? `${fmtShort(parseISO(d))} · Load ${pct}% (${c.load_qty.toFixed(1)}/${c.capacity_qty})` : `${fmtShort(parseISO(d))} · Kosong`}
                              data-testid={`aps-capacity-cell-${ln.id}-${d}`}
                            >
                              {pxPerDay >= 40 && pct != null && pct > 0 && (
                                <span className={`text-[9px] font-mono ${pct > 110 ? 'text-red-200' : pct > 90 ? 'text-amber-200' : 'text-foreground/70'}`}>
                                  {Math.round(pct)}%
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Unassigned row */}
              {barsByLine.unassigned.bars.length > 0 && (() => {
                const unLaneCount = barsByLine.unassigned.laneCount;
                const unLineAreaHeight = Math.max(LINE_HEIGHT, 12 + unLaneCount * (LANE_BAR_HEIGHT + LANE_GAP));
                return (
                  <div
                    className="flex border-b border-[var(--glass-border)]/70 bg-amber-400/5"
                    style={{ minHeight: unLineAreaHeight + HEATMAP_HEIGHT }}
                    data-testid="aps-line-row-unassigned"
                  >
                    <div
                      className="sticky left-0 z-20 flex flex-col justify-center px-3 bg-[var(--card-surface)]/92 backdrop-blur border-r border-[var(--glass-border)]"
                      style={{ width: LEFT_COL_WIDTH, minWidth: LEFT_COL_WIDTH }}
                    >
                      <div className="flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                        <span className="text-sm font-semibold text-amber-300">Belum Dialokasikan</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {barsByLine.unassigned.bars.length} WO tanpa line match
                      </div>
                    </div>
                    <div className="relative" style={{ width: timelineWidth, height: unLineAreaHeight }}>
                      {barsByLine.unassigned.bars.map((b) => {
                        const g = barGeometry(b);
                        if (g.width <= 0) return null;
                        const sm = STATUS_META[b.status] || STATUS_META.draft;
                        const top = laneTop(b.__lane ?? 0);
                        return (
                          <button
                            key={b.wo_id} type="button"
                            onClick={() => openDetail(b.wo_id)}
                            className={`absolute rounded-md border ${sm.bar} ring-1 ring-amber-400/45 px-2 py-1 flex items-center overflow-hidden hover:shadow-lg hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 transition-[box-shadow,background-color,filter] duration-200 cursor-pointer pointer-events-auto z-[15]`}
                            style={{ left: g.left, width: g.width, top, height: LANE_BAR_HEIGHT }}
                            title={`${b.wo_number} · ${b.model_code || '-'} · Belum dialokasikan`}
                            data-testid={`aps-wo-bar-${b.wo_id}`}
                          >
                            <span className={`relative text-[10px] font-semibold truncate ${sm.text}`}>{b.wo_number}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </GlassPanel>

      {/* ── Detail Sheet ────────────────────────────────────────────────── */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md overflow-y-auto bg-[var(--card-surface)]/95 backdrop-blur-[var(--glass-blur)] border-l border-[var(--glass-border)]"
          data-testid="aps-detail-sheet"
        >
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Package className="w-4 h-4" />
              {detailData?.work_order?.wo_number || 'Detail Work Order'}
            </SheetTitle>
            <SheetDescription>
              Informasi Work Order + aksi jadwal ulang.
            </SheetDescription>
          </SheetHeader>

          {detailLoading ? (
            <div className="space-y-3 mt-4">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : detailData?.work_order ? (
            <div className="mt-4 space-y-4">
              {/* Status + risk chips */}
              <div className="flex items-center flex-wrap gap-1.5">
                {(() => {
                  const sm = STATUS_META[detailData.work_order.status] || STATUS_META.draft;
                  const rm = RISK_META[detailData.risk] || RISK_META.on_track;
                  const pm = PRIORITY_META[detailData.work_order.priority] || PRIORITY_META.normal;
                  return (
                    <>
                      <Badge variant="outline" className={`${sm.text} border ${sm.bar}`}>{sm.label}</Badge>
                      <Badge variant="outline" className={rm.chip}>{rm.label}</Badge>
                      <Badge variant="outline" className={pm.chip}>{pm.label}</Badge>
                    </>
                  );
                })()}
              </div>

              {/* Summary grid */}
              <GlassPanel className="p-3">
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                  <div>
                    <div className="text-muted-foreground uppercase tracking-wide text-[10px]">Model</div>
                    <div className="font-mono">{detailData.model?.code || '-'}</div>
                    <div className="text-muted-foreground truncate">{detailData.model?.name || ''}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground uppercase tracking-wide text-[10px]">Line</div>
                    <div className="font-mono">{detailData.line?.code || '—'}</div>
                    <div className="text-muted-foreground truncate">{detailData.line?.name || ''}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground uppercase tracking-wide text-[10px]">Qty</div>
                    <div className="font-mono font-semibold text-foreground">{detailData.work_order.qty}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground uppercase tracking-wide text-[10px]">Selesai</div>
                    <div className="font-mono text-emerald-300">{detailData.work_order.completed_qty} pcs</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground uppercase tracking-wide text-[10px]">Target Mulai</div>
                    <div className="font-mono">{detailData.work_order.target_start_date || '-'}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground uppercase tracking-wide text-[10px]">Target Selesai</div>
                    <div className="font-mono">{detailData.work_order.target_end_date || '-'}</div>
                  </div>
                </div>
              </GlassPanel>

              {/* Progress */}
              <GlassPanel className="p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Progress</span>
                  <span className="text-xs font-mono font-semibold">{detailData.work_order.progress_pct}%</span>
                </div>
                <Progress value={detailData.work_order.progress_pct} className="h-2" data-testid="aps-detail-progress" />
                {/* Breakdown per-process */}
                {detailData.progress_breakdown?.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {detailData.progress_breakdown.map((pr) => (
                      <div key={pr.process_id} className="flex items-center justify-between text-[11px]">
                        <span className={`truncate ${pr.is_rework ? 'text-amber-300' : 'text-muted-foreground'}`}>
                          {pr.process_code} {pr.is_rework ? '(rework)' : ''}
                        </span>
                        <span className="font-mono text-foreground/80">{pr.total_output}</span>
                      </div>
                    ))}
                  </div>
                )}
              </GlassPanel>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <Button
                  size="sm" className="flex-1"
                  onClick={() => {
                    setRescheduleStart(detailData.work_order.target_start_date || '');
                    setRescheduleEnd(detailData.work_order.target_end_date || '');
                    setRescheduleOpen(true);
                  }}
                  disabled={['completed','cancelled'].includes(detailData.work_order.status)}
                  data-testid="aps-detail-reschedule-button"
                >
                  <Calendar className="w-4 h-4 mr-1.5" />
                  Ubah Jadwal
                </Button>
                <Button
                  size="sm" variant="outline"
                  onClick={() => setSheetOpen(false)}
                  data-testid="aps-detail-close-button"
                >
                  Tutup
                </Button>
              </div>

              {detailData.work_order.notes && (
                <GlassPanel className="p-3">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Catatan</div>
                  <div className="text-xs whitespace-pre-wrap">{detailData.work_order.notes}</div>
                </GlassPanel>
              )}
            </div>
          ) : (
            <div className="mt-4 text-sm text-muted-foreground">Tidak ada detail.</div>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Reschedule Dialog ──────────────────────────────────────────── */}
      <Dialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
        <DialogContent
          className="sm:max-w-md bg-[var(--card-surface)]/95 backdrop-blur-[var(--glass-blur)] border border-[var(--glass-border)]"
          data-testid="aps-reschedule-dialog"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Ubah Jadwal Work Order
            </DialogTitle>
            <DialogDescription>
              {detailData?.work_order?.wo_number} — atur target mulai & selesai baru.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 mt-2">
            <div>
              <label className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
                Target Mulai
              </label>
              <input
                type="date"
                value={rescheduleStart}
                onChange={(e) => setRescheduleStart(e.target.value)}
                className="mt-1 w-full bg-[var(--card-surface)] border border-[var(--glass-border)] rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-400/40"
                data-testid="aps-reschedule-start-input"
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
                Target Selesai
              </label>
              <input
                type="date"
                value={rescheduleEnd}
                onChange={(e) => setRescheduleEnd(e.target.value)}
                className="mt-1 w-full bg-[var(--card-surface)] border border-[var(--glass-border)] rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-400/40"
                data-testid="aps-reschedule-end-input"
              />
            </div>
            {rescheduleStart && rescheduleEnd && rescheduleEnd < rescheduleStart && (
              <div className="text-xs text-red-300 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Tanggal selesai tidak boleh sebelum mulai.
              </div>
            )}
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setRescheduleOpen(false)} disabled={rescheduling}>
              Batal
            </Button>
            <Button
              onClick={submitReschedule}
              disabled={rescheduling || !rescheduleStart || !rescheduleEnd || rescheduleEnd < rescheduleStart}
              data-testid="aps-reschedule-confirm-button"
            >
              {rescheduling ? <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1.5" />}
              Simpan Jadwal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Auto-Schedule Dialog (Phase 19B) ───────────────────────────── */}
      <APSAutoScheduleDialog
        open={autoScheduleOpen}
        onOpenChange={setAutoScheduleOpen}
        token={token}
        defaultFrom={fromDate}
        defaultTo={toDate}
        onCommitted={() => { load(); }}
        onRolledBack={() => { load(); }}
      />
    </div>
  );
}
