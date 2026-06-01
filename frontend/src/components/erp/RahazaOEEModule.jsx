/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell
} from 'recharts';
import {
  Activity, TrendingUp, Zap, Shield, RefreshCw, ChevronDown, ChevronUp,
  Calendar, AlertTriangle, CheckCircle2, Clock, BarChart3
} from 'lucide-react';

const OEE_TARGET = 0.65; // 65% adalah target OEE industri garment

function pct(v) {
  if (v === null || v === undefined) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

function oeeColor(v) {
  if (v === null || v === undefined) return 'text-foreground/40';
  if (v >= 0.65) return 'text-emerald-400';
  if (v >= 0.45) return 'text-amber-400';
  return 'text-red-400';
}

function oeeBarColor(v) {
  if (v === null || v === undefined) return '#6b7280';
  if (v >= 0.65) return '#34d399';
  if (v >= 0.45) return '#fbbf24';
  return '#f87171';
}

const KPI_CARD = ({ icon: Icon, label, value, sub, color }) => (
  <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-2xl p-5 flex items-start gap-4">
    <div className={`w-10 h-10 rounded-xl grid place-items-center shrink-0 ${color}`}>
      <Icon className="w-5 h-5" />
    </div>
    <div>
      <p className="text-xs text-foreground/50 font-medium">{label}</p>
      <p className="text-2xl font-bold text-foreground mt-0.5">{value}</p>
      {sub && <p className="text-xs text-foreground/40 mt-0.5">{sub}</p>}
    </div>
  </div>
);

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#1e293b] border border-white/10 rounded-xl px-3 py-2 text-xs shadow-xl">
      <p className="font-medium text-foreground mb-1">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.fill || p.stroke }} />
          <span className="text-foreground/60">{p.name}:</span>
          <span className="font-mono text-foreground">{typeof p.value === 'number' ? `${(p.value * 100).toFixed(1)}%` : p.value}</span>
        </div>
      ))}
    </div>
  );
};

export default function RahazaOEEModule({ token }) {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);

  const [fromDate, setFromDate] = useState(weekAgo);
  const [toDate, setToDate] = useState(today);
  const [selectedLineId, setSelectedLineId] = useState('');
  const [lines, setLines] = useState([]);
  const [summary, setSummary] = useState(null);
  const [daily, setDaily] = useState([]);
  const [drilldown, setDrilldown] = useState(null);
  const [drillDate, setDrillDate] = useState(today);
  const [drillLoading, setDrillLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [expandLine, setExpandLine] = useState(null);
  const [msg, setMsg] = useState(null);

  const hdrs = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const loadLines = useCallback(async () => {
    const r = await fetch('/api/rahaza/lines', { headers: hdrs });
    if (r.ok) setLines(await r.json());
  }, [hdrs]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ from: fromDate, to: toDate });
      if (selectedLineId) params.set('line_id', selectedLineId);

      const [sumRes, dailyRes] = await Promise.all([
        fetch(`/api/rahaza/oee/summary?date=${toDate}`, { headers: hdrs }),
        fetch(`/api/rahaza/oee/daily?${params.toString()}`, { headers: hdrs }),
      ]);

      if (sumRes.ok) setSummary(await sumRes.json());
      if (dailyRes.ok) setDaily(await dailyRes.json());
    } finally {
      setLoading(false);
    }
  }, [hdrs, fromDate, toDate, selectedLineId]);

  useEffect(() => { loadLines(); }, [loadLines]);
  useEffect(() => { loadData(); }, [loadData]);

  const loadDrilldown = async (lineId, dateStr) => {
    setDrillLoading(true);
    try {
      const r = await fetch(`/api/rahaza/oee/line/${lineId}?date=${dateStr}`, { headers: hdrs });
      if (r.ok) setDrilldown(await r.json());
    } finally {
      setDrillLoading(false);
    }
  };

  const openDrilldown = (line) => {
    if (expandLine === line.id) { setExpandLine(null); setDrilldown(null); return; }
    setExpandLine(line.id);
    loadDrilldown(line.id, drillDate);
  };

  // KPI summary for top cards
  const kpis = summary?.kpis || {};
  const byLine = summary?.by_line || [];
  const topLosses = summary?.top_losses || [];

  // Trend chart: rows from daily endpoint aggregated by date
  const trendData = useMemo(() => {
    if (!daily?.rows) return [];
    const byDate = {};
    daily.rows.forEach(r => {
      if (!byDate[r.date]) byDate[r.date] = { date: r.date, oee: [], avail: [], perf: [], qual: [] };
      if (r.avg_oee !== null) byDate[r.date].oee.push(r.avg_oee);
      if (r.avg_availability !== null) byDate[r.date].avail.push(r.avg_availability);
      if (r.avg_performance !== null) byDate[r.date].perf.push(r.avg_performance);
      if (r.avg_quality !== null) byDate[r.date].qual.push(r.avg_quality);
    });
    return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date)).map(d => ({
      date: d.date.slice(5), // MM-DD
      oee: d.oee.length ? d.oee.reduce((a, b) => a + b, 0) / d.oee.length : null,
      availability: d.avail.length ? d.avail.reduce((a, b) => a + b, 0) / d.avail.length : null,
      performance: d.perf.length ? d.perf.reduce((a, b) => a + b, 0) / d.perf.length : null,
      quality: d.qual.length ? d.qual.reduce((a, b) => a + b, 0) / d.qual.length : null,
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daily]);

  // Bar chart: OEE per line (today)
  const lineBarData = useMemo(() =>
    byLine.map(l => ({ name: l.line_code || l.line_id?.slice(0, 8), oee: l.avg_oee }))
  , [byLine]);

  const noData = !loading && byLine.length === 0 && trendData.length === 0;

  return (
    <div className="space-y-6" data-testid="oee-dashboard-page">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground">OEE Dashboard</h2>
          <p className="text-sm text-foreground/50 mt-0.5">Overall Equipment Effectiveness — efisiensi lini produksi</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={selectedLineId} onChange={e => setSelectedLineId(e.target.value)}
            className="h-9 px-3 rounded-xl border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm text-foreground"
            data-testid="oee-line-filter">
            <option value="">Semua Line</option>
            {lines.map(l => <option key={l.id} value={l.id}>{`${l.code} – ${l.name}`}</option>)}
          </select>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
            className="h-9 px-3 rounded-xl border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm text-foreground"
            data-testid="oee-from-date" />
          <span className="text-foreground/40 text-sm">–</span>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
            className="h-9 px-3 rounded-xl border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm text-foreground"
            data-testid="oee-to-date" />
          <button onClick={loadData} disabled={loading}
            className="h-9 px-4 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] text-sm text-foreground hover:bg-[var(--glass-bg-hover)] flex items-center gap-2"
            data-testid="oee-refresh-btn">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Muat Ulang
          </button>
        </div>
      </div>

      {noData ? (
        <div className="flex flex-col items-center justify-center py-20 text-foreground/30">
          <BarChart3 className="w-12 h-12 mb-4 opacity-30" />
          <p className="text-sm">Belum ada data OEE</p>
          <p className="text-xs mt-1 opacity-60">Data akan muncul saat ada event WIP, downtime, dan penugasan lini</p>
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPI_CARD icon={Activity} label="OEE Rata-Rata" value={pct(kpis.avg_oee)}
              sub={`Target: ${pct(OEE_TARGET)}`}
              color={kpis.avg_oee >= OEE_TARGET ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'} />
            <KPI_CARD icon={Shield} label="Availability" value={pct(kpis.avg_availability)}
              sub="Waktu operasi / waktu rencana"
              color="bg-blue-500/15 text-blue-400" />
            <KPI_CARD icon={Zap} label="Performance" value={pct(kpis.avg_performance)}
              sub="Output aktual / target"
              color="bg-purple-500/15 text-purple-400" />
            <KPI_CARD icon={CheckCircle2} label="Quality Rate" value={pct(kpis.avg_quality)}
              sub="QC Pass / Total output"
              color="bg-teal-500/15 text-teal-400" />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Trend Chart */}
            <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-2xl p-5">
              <h3 className="font-semibold text-foreground text-sm mb-4">Tren OEE per Hari</h3>
              {trendData.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-foreground/30 text-sm">Tidak ada data tren</div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={trendData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="date" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} />
                    <YAxis tickFormatter={v => `${(v * 100).toFixed(0)}%`} tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} domain={[0, 1]} />
                    <Tooltip content={<CustomTooltip />} />
                    <ReferenceLine y={OEE_TARGET} stroke="#fbbf24" strokeDasharray="4 2" label={{ value: 'Target', fill: '#fbbf24', fontSize: 10 }} />
                    <Line type="monotone" dataKey="oee" name="OEE" stroke="#34d399" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="availability" name="Availability" stroke="#60a5fa" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                    <Line type="monotone" dataKey="performance" name="Performance" stroke="#a78bfa" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* OEE per Line Bar Chart */}
            <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-2xl p-5">
              <h3 className="font-semibold text-foreground text-sm mb-4">OEE per Lini — {toDate}</h3>
              {lineBarData.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-foreground/30 text-sm">Tidak ada data per lini</div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={lineBarData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="name" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} />
                    <YAxis tickFormatter={v => `${(v * 100).toFixed(0)}%`} tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} domain={[0, 1]} />
                    <Tooltip content={<CustomTooltip />} />
                    <ReferenceLine y={OEE_TARGET} stroke="#fbbf24" strokeDasharray="4 2" />
                    <Bar dataKey="oee" name="OEE" radius={[4, 4, 0, 0]}>
                      {lineBarData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={oeeBarColor(entry.oee)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Top Losses */}
          {topLosses.length > 0 && (
            <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-2xl p-5">
              <h3 className="font-semibold text-foreground text-sm mb-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" /> Top Losses (Lini OEE Terendah)
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {topLosses.map(l => (
                  <div key={l.line_id} className="p-3 rounded-xl border border-[var(--glass-border)] bg-[var(--card-surface)]">
                    <div className="flex justify-between items-center">
                      <p className="text-sm font-medium text-foreground">{l.line_code || l.line_id?.slice(0, 8)}</p>
                      <span className={`text-lg font-bold ${oeeColor(l.avg_oee)}`}>{pct(l.avg_oee)}</span>
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-foreground/10">
                      <div className="h-full rounded-full bg-red-500" style={{ width: `${Math.round((l.avg_oee || 0) * 100)}%` }} />
                    </div>
                    <div className="flex gap-3 mt-2 text-xs text-foreground/50">
                      <span>A: {pct(l.avg_availability)}</span>
                      <span>P: {pct(l.avg_performance)}</span>
                      <span>Q: {pct(l.avg_quality)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Per-Line Drilldown Table */}
          <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--glass-border)] flex items-center justify-between">
              <h3 className="font-semibold text-foreground text-sm">Detail per Lini</h3>
              <div className="flex items-center gap-2">
                <span className="text-xs text-foreground/50">Drilldown tanggal:</span>
                <input type="date" value={drillDate} onChange={e => setDrillDate(e.target.value)}
                  className="h-8 px-2 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-xs text-foreground"
                  data-testid="oee-drill-date" />
              </div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--glass-border)] bg-[var(--card-surface)]">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-foreground/50">Lini</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-foreground/50">OEE</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-foreground/50">Availability</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-foreground/50">Performance</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-foreground/50">Quality</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-foreground/50">Output</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-foreground/50">Detail</th>
                </tr>
              </thead>
              <tbody>
                {byLine.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-10 text-foreground/40 text-sm">Tidak ada data untuk tanggal ini</td></tr>
                ) : byLine.map((l, i) => (
                  <>
                    <tr key={l.line_id} className={`border-b border-[var(--glass-border)] ${i % 2 === 0 ? '' : 'bg-foreground/[0.02]'} hover:bg-[var(--glass-bg-hover)] transition-colors`}
                      data-testid={`oee-line-row-${l.line_id}`}>
                      <td className="px-5 py-3 font-medium text-foreground">{l.line_code || l.line_name || l.line_id?.slice(0, 8)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`text-base font-bold ${oeeColor(l.avg_oee)}`}>{pct(l.avg_oee)}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-foreground/70">{pct(l.avg_availability)}</td>
                      <td className="px-4 py-3 text-right text-foreground/70">{pct(l.avg_performance)}</td>
                      <td className="px-4 py-3 text-right text-foreground/70">{pct(l.avg_quality)}</td>
                      <td className="px-4 py-3 text-right font-mono text-foreground/70">{l.total_output ?? '—'}</td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => openDrilldown(l)}
                          className="p-1.5 rounded-lg border border-[var(--glass-border)] text-foreground/40 hover:text-[hsl(var(--primary))] hover:border-[hsl(var(--primary)/0.3)] hover:bg-[hsl(var(--primary)/0.05)] transition-colors"
                          data-testid={`oee-drill-btn-${l.line_id}`}>
                          {expandLine === l.line_id ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                      </td>
                    </tr>
                    {expandLine === l.line_id && (
                      <tr key={`drill-${l.line_id}`} className="border-b border-[var(--glass-border)] bg-[hsl(var(--primary)/0.03)]">
                        <td colSpan={7} className="px-5 py-4">
                          {drillLoading ? (
                            <p className="text-xs text-foreground/40">Memuat drilldown...</p>
                          ) : !drilldown ? (
                            <p className="text-xs text-foreground/40">Tidak ada data detail</p>
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {/* Downtime Events */}
                              <div>
                                <p className="text-xs font-semibold text-foreground/50 mb-2">Downtime Events ({drilldown.downtime_events?.length ?? 0})</p>
                                {drilldown.downtime_events?.length === 0 ? (
                                  <p className="text-xs text-foreground/30">Tidak ada downtime</p>
                                ) : drilldown.downtime_events?.slice(0, 5).map(ev => (
                                  <div key={ev.id} className="flex items-center gap-2 mb-1.5 text-xs">
                                    <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />
                                    <span className="text-foreground/70">{ev.machine_code || '–'}</span>
                                    <span className="text-foreground/50">{ev.description?.slice(0, 40) || 'Machine breakdown'}</span>
                                    <span className="ml-auto text-amber-400 font-mono">{ev.duration_min ?? '?'} min</span>
                                  </div>
                                ))}
                              </div>
                              {/* Output Events */}
                              <div>
                                <p className="text-xs font-semibold text-foreground/50 mb-2">Output Events ({drilldown.events?.length ?? 0})</p>
                                {drilldown.events?.length === 0 ? (
                                  <p className="text-xs text-foreground/30">Tidak ada event output</p>
                                ) : drilldown.events?.slice(0, 5).map((ev, idx) => (
                                  <div key={idx} className="flex items-center gap-2 mb-1.5 text-xs">
                                    <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                                    <span className="text-foreground/70 capitalize">{ev.event_type}</span>
                                    <span className="ml-auto font-mono text-foreground">{ev.qty} pcs</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
