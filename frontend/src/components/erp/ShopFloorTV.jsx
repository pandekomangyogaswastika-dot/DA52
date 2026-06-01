import { useState, useEffect, useRef } from 'react';
import { Factory, AlertTriangle, Clock, Tv, RefreshCw, Bell, CheckCircle2, TrendingDown } from 'lucide-react';

/* ─── ShopFloorTV — Full-screen TV Mode (Phase 18C) ────────────────────────────
   Public full-screen display for shop-floor monitors.
   No login required. 5-second auto-refresh.
   Route: /tv (floor view) or /tv/line/:lineId
 ─────────────────────────────────────────────────────────────────────────── */

const REFRESH_INTERVAL = 5000; // 5 seconds

function Clock12() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="text-right">
      <div className="text-2xl font-mono font-bold text-white">
        {time.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </div>
      <div className="text-xs text-white/50">
        {time.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
      </div>
    </div>
  );
}

function ProgressBar({ pct, behind }) {
  const color = behind ? 'bg-red-500' : pct >= 90 ? 'bg-emerald-400' : pct >= 70 ? 'bg-amber-400' : 'bg-sky-400';
  return (
    <div className="h-3 bg-white/10 rounded-full overflow-hidden">
      <div
        className={`h-full ${color} transition-all duration-1000 ease-out rounded-full`}
        style={{ width: `${Math.min(100, pct)}%` }}
      />
    </div>
  );
}

function LineCard({ card }) {
  const pct = card.pct_target;
  const hasBehind = card.behind_target;
  const hasAndon = card.active_andons > 0;
  const hasQCSpike = card.qc_spike;

  return (
    <div
      className={`rounded-2xl border-2 p-4 transition-all duration-500 ${
        hasAndon
          ? 'bg-red-900/40 border-red-500/60 shadow-lg shadow-red-500/20'
          : hasBehind
          ? 'bg-amber-900/30 border-amber-500/40'
          : 'bg-white/5 border-white/15'
      }`}
      data-testid={`tv-line-card-${card.line_code}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-base font-bold text-white">{card.line_code}</div>
          <div className="text-xs text-white/50 truncate max-w-[140px]">{card.line_name}</div>
        </div>
        <div className="flex items-center gap-1.5">
          {hasAndon && (
            <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-500/30 border border-red-400/50 text-red-300 font-semibold animate-pulse">
              <Bell className="w-3 h-3" /> ANDON
            </span>
          )}
          {hasQCSpike && (
            <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-orange-500/25 border border-orange-400/40 text-orange-300 font-semibold">
              ⚠️ QC
            </span>
          )}
          {hasBehind && (
            <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-400/35 text-amber-300 font-semibold">
              <TrendingDown className="w-3 h-3" /> Behind
            </span>
          )}
          {!hasBehind && !hasAndon && card.has_assignments && (
            <span className="text-xs text-emerald-400/70">OK</span>
          )}
        </div>
      </div>

      {/* Big numbers */}
      <div className="flex items-end justify-between gap-2 mb-2">
        <div>
          <div className={`text-4xl font-black leading-none ${
            hasBehind ? 'text-amber-300' : 'text-white'
          }`}>
            {card.output_today.toLocaleString()}
          </div>
          <div className="text-xs text-white/50 mt-0.5">
            target {card.target_today > 0 ? card.target_today.toLocaleString() : '—'} pcs
          </div>
        </div>
        <div className="text-right">
          <div className={`text-2xl font-bold ${
            pct >= 90 ? 'text-emerald-400' : pct >= 70 ? 'text-amber-400' : 'text-red-400'
          }`}>
            {card.target_today > 0 ? `${pct}%` : '—'}
          </div>
        </div>
      </div>

      <ProgressBar pct={pct} behind={hasBehind} />

      {/* QC strip */}
      {(card.qc_pass > 0 || card.qc_fail > 0) && (
        <div className="flex items-center gap-3 mt-2 text-xs text-white/60">
          <span className="text-emerald-400/80">✓ {card.qc_pass}</span>
          <span className="text-red-400/80">✕ {card.qc_fail}</span>
          {card.qc_fail_rate_pct > 0 && <span>({card.qc_fail_rate_pct}% fail)</span>}
        </div>
      )}

      {/* Andon types */}
      {hasAndon && card.andon_types && card.andon_types.length > 0 && (
        <div className="mt-2 text-xs text-red-300 font-medium">
          {card.andon_types.join(' · ')}
        </div>
      )}
    </div>
  );
}

function AlertTicker({ alerts }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (!alerts.length) return;
    const id = setInterval(() => setIdx(i => (i + 1) % alerts.length), 3000);
    return () => clearInterval(id);
  }, [alerts.length]);
  if (!alerts.length) return null;
  const alert = alerts[idx];
  const isUrgent = alert?.severity === 'urgent';
  return (
    <div className={`flex items-center gap-2 px-4 py-2 text-sm font-medium ${
      isUrgent ? 'bg-red-600/30 text-red-200' : 'bg-amber-600/20 text-amber-200'
    }`}>
      <Bell className="w-4 h-4 flex-shrink-0" />
      <span className="truncate">
        {alert?.title} — {alert?.message}
      </span>
      <span className="ml-auto text-xs opacity-60 flex-shrink-0">{idx + 1}/{alerts.length}</span>
    </div>
  );
}

export default function ShopFloorTV() {
  const [floorData, setFloorData] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [error, setError] = useState(null);
  const refreshRef = useRef(null);

  const loadData = async () => {
    try {
      const [floorRes, alertRes] = await Promise.all([
        fetch('/api/tv/floor'),
        fetch('/api/tv/alerts?limit=8'),
      ]);
      if (!floorRes.ok) throw new Error(`Floor data error: ${floorRes.status}`);
      const floor = await floorRes.json();
      const alertData = alertRes.ok ? await alertRes.json() : { alerts: [] };
      setFloorData(floor);
      setAlerts(alertData.alerts || []);
      setLastUpdate(new Date());
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    refreshRef.current = setInterval(loadData, REFRESH_INTERVAL);
    return () => clearInterval(refreshRef.current);
  }, []);

  const kpi = floorData?.kpi || {};
  const lines = floorData?.lines || [];

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4" />
          <p className="text-white/50">Memuat data lantai produksi...</p>
        </div>
      </div>
    );
  }

  if (error && !floorData) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center text-red-400">
          <AlertTriangle className="w-12 h-12 mx-auto mb-3" />
          <p className="text-xl font-bold">Gagal memuat data</p>
          <p className="text-sm mt-2 text-red-300">{error}</p>
          <button
            onClick={loadData}
            className="mt-4 px-6 py-2 rounded-lg bg-red-500/20 border border-red-500/40 text-red-300 hover:bg-red-500/30"
          >
            Coba Lagi
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col overflow-hidden font-sans" data-testid="shop-floor-tv">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-3 bg-gray-900/80 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center">
            <Tv className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <div className="text-sm font-bold text-white">PT Rahaza Global Indonesia</div>
            <div className="text-xs text-white/40">TV Mode · Lantai Produksi</div>
          </div>
        </div>

        {/* KPI summary */}
        <div className="hidden md:flex items-center gap-6">
          <div className="text-center">
            <div className="text-xl font-bold text-white">{kpi.total_output?.toLocaleString() || 0}</div>
            <div className="text-[10px] text-white/40">Total Output</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold text-white">
              {kpi.total_target > 0 ? `${kpi.pct_target}%` : '—'}
            </div>
            <div className="text-[10px] text-white/40">% Target</div>
          </div>
          <div className="text-center">
            <div className={`text-xl font-bold ${kpi.total_behind > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {kpi.total_behind || 0}
            </div>
            <div className="text-[10px] text-white/40">Behind</div>
          </div>
          <div className="text-center">
            <div className={`text-xl font-bold ${kpi.total_andon > 0 ? 'text-red-400 animate-pulse' : 'text-white/60'}`}>
              {kpi.total_andon || 0}
            </div>
            <div className="text-[10px] text-white/40">Andon</div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {lastUpdate && (
            <div className="flex items-center gap-1 text-xs text-white/30">
              <RefreshCw className="w-3 h-3" />
              {lastUpdate.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
          )}
          <Clock12 />
        </div>
      </div>

      {/* Alert ticker */}
      <AlertTicker alerts={alerts} />

      {/* Main content */}
      <div className="flex-1 p-4 overflow-auto">
        {lines.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-white/40">
            <Factory className="w-16 h-16 mb-4" />
            <p className="text-xl">Belum ada data line hari ini</p>
          </div>
        ) : (
          <div className="grid gap-4 auto-rows-[minmax(0,1fr)]" style={{
            gridTemplateColumns: `repeat(${Math.min(lines.length, 4)}, minmax(0, 1fr))`
          }}>
            {lines.map(card => (
              <LineCard key={card.line_id} card={card} />
            ))}
          </div>
        )}
      </div>

      {/* Bottom status */}
      <div className="flex items-center justify-between px-6 py-2 bg-gray-900/50 border-t border-white/10 text-[11px] text-white/30">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Live · Refresh 5 detik
        </div>
        <div>{floorData?.today || '—'}</div>
        <div>{kpi.active_lines || 0} line aktif</div>
      </div>
    </div>
  );
}
