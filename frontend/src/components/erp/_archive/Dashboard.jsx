import { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, LineChart, Line, Area, AreaChart } from 'recharts';
import { Package, Factory, FileText, DollarSign, AlertTriangle, TrendingUp, TrendingDown, Clock, Bell, ChevronDown, ChevronUp, X, Send, MessageSquare, ExternalLink, Calendar, Filter, RefreshCw, CheckCircle, XCircle, Truck, RotateCcw, Shield, Zap, Target, BarChart3 } from 'lucide-react';
import { GlassCard, GlassPanel, GlassInput } from '@/components/ui/glass';
import { IconButton } from './IconButton';

const COLORS = ['#2dd4bf', '#38bdf8', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6'];
const fmt = (v) => 'Rp ' + (v || 0).toLocaleString('id-ID');
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
const fmtNum = (v) => (v || 0).toLocaleString('id-ID');

function ClipboardList({ className }) {
  return <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>;
}

function KPICard({ title, value, subtitle, icon: Icon, color, onClick, detail, badge }) {
  return (
    <button onClick={onClick} className="group text-left w-full" data-testid={`kpi-${title.replace(/\s+/g, '-').toLowerCase()}`}>
      <GlassCard className="p-4 h-full">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{title}</p>
            <p className="text-xl font-bold text-foreground mt-0.5">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5 truncate">{subtitle}</p>}
          </div>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${color} group-hover:scale-110 transition-transform duration-200`}>
            <Icon className="w-5 h-5 text-white" />
          </div>
        </div>
        {badge && <div className="mt-2"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.color}`}>{badge.text}</span></div>}
        <div className="mt-2 flex items-center gap-1 text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <ExternalLink className="w-3 h-3" /> Klik untuk detail
        </div>
      </GlassCard>
    </button>
  );
}

function DrilldownModal({ title, children, onClose, onNavigate, navLabel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-bg)] backdrop-blur-sm" onClick={onClose}>
      <GlassCard hover={false} className="w-full max-w-lg mx-4 max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[var(--glass-border)] flex items-center justify-between">
          <h3 className="text-lg font-bold text-foreground">{title}</h3>
          <div className="flex items-center gap-2">
            {onNavigate && navLabel && (
              <button onClick={onNavigate} className="text-xs text-primary hover:brightness-110 bg-primary/10 px-3 py-1.5 rounded-lg font-medium flex items-center gap-1">
                <ExternalLink className="w-3 h-3" /> {navLabel}
              </button>
            )}
            <IconButton label="Tutup detail" onClick={onClose} className="p-1.5 hover:bg-[var(--glass-bg-hover)] rounded-lg" data-testid="drilldown-close"><X className="w-5 h-5 text-muted-foreground" /></IconButton>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </GlassCard>
    </div>
  );
}

const GlassTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--card-surface)] backdrop-blur-xl p-3 text-sm shadow-lg">
        <p className="font-semibold text-foreground mb-1">{label}</p>
        {payload.map((p, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.color }}></div>
            <span className="text-muted-foreground">{p.name}:</span>
            <span className="font-bold text-foreground">{fmtNum(p.value)}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

export default function Dashboard({ token, onNavigate }) {
  const [metrics, setMetrics] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [drilldown, setDrilldown] = useState(null);
  const [showReminder, setShowReminder] = useState(false);
  const [reminders, setReminders] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [reminderForm, setReminderForm] = useState({ vendor_id: '', subject: '', message: '', po_number: '', priority: 'normal' });
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showAnalytics, setShowAnalytics] = useState(true);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard', { headers });
      if (res.ok) setMetrics(await res.json());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [token]);

  const fetchAnalytics = useCallback(async () => {
    try {
      let url = '/api/dashboard/analytics';
      const params = [];
      if (dateFrom) params.push(`from=${dateFrom}`);
      if (dateTo) params.push(`to=${dateTo}`);
      if (params.length) url += '?' + params.join('&');
      const res = await fetch(url, { headers });
      if (res.ok) setAnalytics(await res.json());
    } catch (e) { console.error(e); }
  }, [token, dateFrom, dateTo]);

  const fetchReminders = useCallback(async () => {
    try {
      const res = await fetch('/api/reminders', { headers });
      if (res.ok) setReminders(await res.json());
    } catch (e) {}
  }, [token]);

  const fetchVendors = useCallback(async () => {
    try {
      const res = await fetch('/api/garments', { headers });
      if (res.ok) setVendors(await res.json());
    } catch (e) {}
  }, [token]);

  useEffect(() => { fetchMetrics(); fetchReminders(); fetchVendors(); fetchAnalytics(); }, []);
  useEffect(() => { fetchAnalytics(); }, [dateFrom, dateTo]);

  const nav = (module) => { if (onNavigate) onNavigate(module); };

  const sendReminder = async () => {
    if (!reminderForm.vendor_id || !reminderForm.subject) { alert('Vendor dan subject harus diisi'); return; }
    try {
      const res = await fetch('/api/reminders', { method: 'POST', headers, body: JSON.stringify(reminderForm) });
      if (res.ok) { setShowReminder(false); setReminderForm({ vendor_id: '', subject: '', message: '', po_number: '', priority: 'normal' }); fetchReminders(); alert('Reminder terkirim!'); }
    } catch (e) { alert('Error: ' + e.message); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div></div>;

  const woStatusData = (metrics?.woStatus || []).map(s => ({ name: s._id || 'Unknown', value: s.count }));
  const topGarments = metrics?.topGarments || [];
  const totalAlerts = (metrics?.alerts?.overduePos?.length || 0) + (metrics?.alerts?.nearDeadlinePos?.length || 0) + (metrics?.alerts?.unpaidInvoices?.length || 0);
  const pendingReminders = reminders.filter(r => r.status === 'pending');
  const respondedReminders = reminders.filter(r => r.status === 'responded');
  const deadlineDist = analytics?.deadlineDistribution || {};
  const shipStatus = analytics?.shipmentStatus || [];
  const weeklyTP = analytics?.weeklyThroughput || [];
  const prodComp = analytics?.productCompletion || [];
  const vendorLT = analytics?.vendorLeadTimes || [];
  const defectR = analytics?.defectRates || [];

  // Chart axis/grid colors based on theme
  const gridColor = 'var(--chart-grid)';
  const tickColor = 'hsl(var(--muted-foreground))';

  return (
    <div className="space-y-5" data-testid="dashboard">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground text-sm">Ikhtisar operasional & analitik produksi garmen</p>
        </div>
        <div className="flex items-center gap-2">
          {totalAlerts > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-400/10 border border-red-300/20 rounded-lg">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
              <span className="text-xs font-medium text-red-300 dark:text-red-300 light:text-red-700">{totalAlerts} peringatan</span>
            </div>
          )}
          <button onClick={() => setShowReminder(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 border border-primary/20 rounded-lg text-xs font-medium text-primary hover:bg-primary/15 transition-colors" data-testid="send-reminder-btn">
            <Bell className="w-3.5 h-3.5" /> Kirim Reminder
          </button>
          <IconButton label="Refresh dashboard" onClick={() => { fetchMetrics(); fetchAnalytics(); }} className="p-1.5 hover:bg-[var(--glass-bg-hover)] rounded-lg transition-colors" data-testid="dashboard-refresh">
            <RefreshCw className="w-4 h-4 text-muted-foreground" />
          </IconButton>
        </div>
      </div>

      {/* Compact Alert Bar */}
      {totalAlerts > 0 && (
        <div className="flex flex-wrap gap-2">
          {(metrics?.alerts?.overduePos || []).map(po => (
            <div key={po.id} className="flex items-center gap-2 px-3 py-1.5 bg-red-400/10 border border-red-300/20 rounded-lg text-xs">
              <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
              <span className="text-red-300 dark:text-red-300"><strong>{po.po_number}</strong> terlambat</span>
            </div>
          ))}
          {(metrics?.alerts?.nearDeadlinePos || []).map(po => (
            <div key={po.id} className="flex items-center gap-2 px-3 py-1.5 bg-amber-400/10 border border-amber-300/20 rounded-lg text-xs">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-amber-300 dark:text-amber-300"><strong>{po.po_number}</strong> deadline segera</span>
            </div>
          ))}
          {(metrics?.alerts?.unpaidInvoices || []).slice(0, 3).map(inv => (
            <div key={inv.id} className="flex items-center gap-2 px-3 py-1.5 bg-orange-400/10 border border-orange-300/20 rounded-lg text-xs">
              <FileText className="w-3.5 h-3.5 text-orange-400" />
              <span className="text-orange-300 dark:text-orange-300"><strong>{inv.invoice_number}</strong> {inv.status}</span>
            </div>
          ))}
        </div>
      )}

      {/* KPI Cards - Row 1 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard title="Total PO" value={metrics?.totalPOs || 0} subtitle={`${metrics?.activePOs || 0} aktif`} icon={ClipboardList} color="bg-blue-500" onClick={() => setDrilldown('po')} badge={metrics?.delayedPOs > 0 ? { text: `${metrics.delayedPOs} terlambat`, color: 'bg-red-400/15 text-red-300' } : null} />
        <KPICard title="Active Jobs" value={metrics?.activeJobs || 0} subtitle="Production jobs berjalan" icon={Factory} color="bg-emerald-500" onClick={() => setDrilldown('jobs')} />
        <KPICard title="Progress Produksi" value={`${metrics?.globalProgressPct || 0}%`} subtitle={`${fmtNum(metrics?.totalProducedGlobal)} / ${fmtNum(metrics?.totalAvailableGlobal)} pcs`} icon={TrendingUp} color="bg-teal-500" onClick={() => setDrilldown('progress')} />
        <KPICard title="On-Time Rate" value={`${metrics?.onTimeRate || 0}%`} subtitle="PO selesai tepat waktu" icon={Target} color="bg-indigo-500" onClick={() => setDrilldown('ontime')} />
      </div>

      {/* KPI Cards - Row 2 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard title="Pending Shipment" value={metrics?.pendingShipments || 0} subtitle="Material belum diterima" icon={Truck} color="bg-amber-500" onClick={() => nav('vendor-shipments')} />
        <KPICard title="Req. Tambahan" value={metrics?.pendingAdditionalRequests || 0} subtitle="Menunggu persetujuan" icon={AlertTriangle} color="bg-orange-500" onClick={() => nav('vendor-shipments')} />
        <KPICard title="Retur Produksi" value={metrics?.pendingReturns || 0} subtitle="Dalam proses" icon={RotateCcw} color="bg-purple-500" onClick={() => nav('production-returns')} />
        <KPICard title="Reminders" value={pendingReminders.length} subtitle={`${respondedReminders.length} dibalas`} icon={Bell} color="bg-cyan-500" onClick={() => setDrilldown('reminders')} badge={respondedReminders.length > 0 ? { text: `${respondedReminders.length} respon baru`, color: 'bg-emerald-400/15 text-emerald-300' } : null} />
      </div>

      {/* KPI Cards - Row 3: Financial */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard title="Invoice AR" value={fmt(metrics?.totalInvoicedAR)} subtitle={`Outstanding: ${fmt(metrics?.outstandingAR)}`} icon={FileText} color="bg-blue-400" onClick={() => nav('accounts-receivable')} />
        <KPICard title="Invoice AP" value={fmt(metrics?.totalInvoicedAP)} subtitle={`Outstanding: ${fmt(metrics?.outstandingAP)}`} icon={FileText} color="bg-purple-500" onClick={() => nav('accounts-payable')} />
        <KPICard title="Outstanding" value={fmt(metrics?.outstanding)} subtitle={`AR: ${fmt(metrics?.outstandingAR)} | AP: ${fmt(metrics?.outstandingAP)}`} icon={DollarSign} color="bg-orange-500" onClick={() => nav('invoices')} />
        <KPICard title="Gross Margin" value={fmt(metrics?.grossMargin)} subtitle={`Revenue: ${fmt(metrics?.totalRevenue)}`} icon={Zap} color="bg-emerald-600" onClick={() => nav('financial-recap')} />
      </div>

      {/* Analytics Section */}
      <GlassCard hover={false} className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" />
            <h3 className="font-bold text-foreground">Analitik Lanjutan</h3>
            <button onClick={() => setShowAnalytics(!showAnalytics)} className="text-xs text-muted-foreground hover:text-foreground">
              {showAnalytics ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
          <div className="flex items-center gap-2" data-testid="date-filter">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border border-[var(--glass-border)] bg-[var(--input-surface)] rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:ring-2 focus:ring-ring focus:outline-none" />
            <span className="text-xs text-muted-foreground">s/d</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="border border-[var(--glass-border)] bg-[var(--input-surface)] rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:ring-2 focus:ring-ring focus:outline-none" />
            {(dateFrom || dateTo) && <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-xs text-red-400 hover:text-red-300"><X className="w-3.5 h-3.5" /></button>}
          </div>
        </div>

        {showAnalytics && (
          <div className="space-y-4">
            {/* Row 1 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2 rounded-xl p-4 border border-[var(--glass-border)] bg-[var(--card-surface)]">
                <h4 className="font-semibold text-foreground text-sm mb-3">Throughput Produksi Mingguan</h4>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={weeklyTP}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: tickColor }} />
                    <YAxis tick={{ fontSize: 10, fill: tickColor }} />
                    <Tooltip content={<GlassTooltip />} />
                    <Bar dataKey="qty" name="Produksi (pcs)" fill="hsl(174, 70%, 55%)" radius={[6,6,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="rounded-xl p-4 border border-[var(--glass-border)] bg-[var(--card-surface)]">
                <h4 className="font-semibold text-foreground text-sm mb-3">Distribusi Deadline PO</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-red-400/10 rounded-lg p-3 text-center border border-red-300/15">
                    <p className="text-2xl font-bold text-red-400">{deadlineDist.overdue || 0}</p>
                    <p className="text-[10px] text-red-300 font-medium mt-0.5">Overdue</p>
                  </div>
                  <div className="bg-amber-400/10 rounded-lg p-3 text-center border border-amber-300/15">
                    <p className="text-2xl font-bold text-amber-400">{deadlineDist.thisWeek || 0}</p>
                    <p className="text-[10px] text-amber-300 font-medium mt-0.5">Minggu Ini</p>
                  </div>
                  <div className="bg-sky-400/10 rounded-lg p-3 text-center border border-sky-300/15">
                    <p className="text-2xl font-bold text-sky-400">{deadlineDist.nextWeek || 0}</p>
                    <p className="text-[10px] text-sky-300 font-medium mt-0.5">Minggu Depan</p>
                  </div>
                  <div className="bg-emerald-400/10 rounded-lg p-3 text-center border border-emerald-300/15">
                    <p className="text-2xl font-bold text-emerald-400">{deadlineDist.later || 0}</p>
                    <p className="text-[10px] text-emerald-300 font-medium mt-0.5">Nanti</p>
                  </div>
                </div>
                {shipStatus.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-[var(--glass-border)]">
                    <p className="text-xs font-semibold text-foreground/80 mb-1.5">Status Pengiriman</p>
                    {shipStatus.map((s, i) => (
                      <div key={s.status} className="flex items-center justify-between text-xs py-0.5">
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }}></div>
                          <span className="text-muted-foreground">{s.status}</span>
                        </div>
                        <span className="font-bold text-foreground">{s.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Row 2 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="rounded-xl p-4 border border-[var(--glass-border)] bg-[var(--card-surface)]">
                <h4 className="font-semibold text-foreground text-sm mb-3">Tingkat Penyelesaian Produk</h4>
                {prodComp.length > 0 ? (
                  <div className="space-y-2.5">
                    {prodComp.slice(0, 6).map((p, i) => (
                      <div key={i}>
                        <div className="flex justify-between text-xs mb-0.5">
                          <span className="text-muted-foreground truncate max-w-[140px]">{p.product}</span>
                          <span className="font-bold text-foreground">{p.rate}%</span>
                        </div>
                        <div className="w-full bg-secondary rounded-full h-2">
                          <div className="h-2 rounded-full transition-all" style={{ width: `${Math.min(100, p.rate)}%`, backgroundColor: p.rate >= 80 ? '#10b981' : p.rate >= 50 ? '#f59e0b' : '#ef4444' }} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-xs text-muted-foreground text-center py-6">Belum ada data</p>}
              </div>
              <div className="rounded-xl p-4 border border-[var(--glass-border)] bg-[var(--card-surface)]">
                <h4 className="font-semibold text-foreground text-sm mb-3">Lead Time Vendor (hari)</h4>
                {vendorLT.length > 0 ? (
                  <div className="space-y-2">
                    {vendorLT.slice(0, 6).map((v, i) => (
                      <div key={i} className="flex items-center justify-between p-2 bg-[var(--glass-bg)] rounded-lg border border-[var(--glass-border)]">
                        <div>
                          <span className="text-xs font-medium text-foreground">{v.vendor}</span>
                          <span className="text-[10px] text-muted-foreground ml-1.5">({v.shipment_count} shipment)</span>
                        </div>
                        <span className={`text-sm font-bold ${v.avg_days <= 3 ? 'text-emerald-400' : v.avg_days <= 7 ? 'text-amber-400' : 'text-red-400'}`}>{v.avg_days}d</span>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-xs text-muted-foreground text-center py-6">Belum ada data</p>}
              </div>
              <div className="rounded-xl p-4 border border-[var(--glass-border)] bg-[var(--card-surface)]">
                <h4 className="font-semibold text-foreground text-sm mb-3">Tingkat Material Missing</h4>
                {defectR.length > 0 ? (
                  <div className="space-y-2">
                    {defectR.slice(0, 6).map((d, i) => (
                      <div key={i} className="flex items-center justify-between p-2 bg-[var(--glass-bg)] rounded-lg border border-[var(--glass-border)]">
                        <div>
                          <span className="text-xs font-medium text-foreground">{d.vendor}</span>
                          <div className="text-[10px] text-muted-foreground">Diterima: {fmtNum(d.total_received)} | Missing: {fmtNum(d.total_missing)}</div>
                        </div>
                        <span className={`text-sm font-bold ${d.missing_rate <= 2 ? 'text-emerald-400' : d.missing_rate <= 5 ? 'text-amber-400' : 'text-red-400'}`}>{d.missing_rate}%</span>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-xs text-muted-foreground text-center py-6">Belum ada data inspeksi</p>}
              </div>
            </div>
          </div>
        )}
      </GlassCard>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <GlassCard hover={false} className="lg:col-span-2 p-4">
          <h3 className="font-semibold text-foreground text-sm mb-3">Tren Produksi 6 Bulan</h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={metrics?.monthlyData || []}>
              <defs>
                <linearGradient id="colorProd" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2dd4bf" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#2dd4bf" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: tickColor }} />
              <YAxis tick={{ fontSize: 11, fill: tickColor }} />
              <Tooltip content={<GlassTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="pos" name="PO" fill="#38bdf8" radius={[3,3,0,0]} />
              <Area type="monotone" dataKey="production" name="Produksi" stroke="#2dd4bf" fill="url(#colorProd)" />
            </AreaChart>
          </ResponsiveContainer>
        </GlassCard>
        <GlassCard hover={false} className="p-4">
          <h3 className="font-semibold text-foreground text-sm mb-3">Status Job Produksi</h3>
          {woStatusData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={140}>
                <PieChart>
                  <Pie data={woStatusData} cx="50%" cy="50%" innerRadius={35} outerRadius={60} paddingAngle={5} dataKey="value">
                    {woStatusData.map((e, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip content={<GlassTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5 mt-2">
                {woStatusData.map((e, i) => (
                  <div key={e.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }}></div>
                      <span className="text-muted-foreground">{e.name}</span>
                    </div>
                    <span className="font-bold text-foreground">{e.value}</span>
                  </div>
                ))}
              </div>
            </>
          ) : <div className="flex items-center justify-center h-32 text-muted-foreground text-xs">Belum ada data job produksi</div>}
        </GlassCard>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <GlassCard hover={false} className="p-4">
          <h3 className="font-semibold text-foreground text-sm mb-3">Top Vendor by Produksi</h3>
          {topGarments.length > 0 ? (
            <div className="space-y-2.5">
              {topGarments.map((g, i) => (
                <div key={i} className="flex items-center gap-2.5">
                  <div className="w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold flex-shrink-0">{i + 1}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between text-xs mb-0.5">
                      <span className="text-foreground font-medium truncate">{g._id || 'Unknown'}</span>
                      <span className="text-muted-foreground font-semibold">{fmtNum(g.total_qty)} pcs</span>
                    </div>
                    <div className="w-full bg-secondary rounded-full h-1.5">
                      <div className="bg-primary h-1.5 rounded-full transition-all" style={{ width: `${Math.min(100, (g.total_qty / (topGarments[0]?.total_qty || 1)) * 100)}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : <div className="flex items-center justify-center h-24 text-muted-foreground text-xs">Belum ada data produksi vendor</div>}
        </GlassCard>

        <GlassCard hover={false} className="p-4">
          <h3 className="font-semibold text-foreground text-sm mb-3">Status PO</h3>
          <div className="space-y-1.5">
            {Object.entries(metrics?.poStatusCounts || {}).filter(([, v]) => v > 0).map(([status, count]) => {
              const statusColors = { Draft: 'bg-secondary text-muted-foreground', Confirmed: 'bg-sky-400/15 text-sky-300', Distributed: 'bg-indigo-400/15 text-indigo-300', 'In Production': 'bg-emerald-400/15 text-emerald-300', 'Production Complete': 'bg-teal-400/15 text-teal-300', Closed: 'bg-secondary text-muted-foreground' };
              return (
                <div key={status} className="flex items-center justify-between p-2 rounded-lg hover:bg-[var(--glass-bg-hover)] cursor-pointer transition-colors" onClick={() => nav('production-po')}>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[status] || 'bg-secondary text-muted-foreground'}`}>{status}</span>
                  <span className="text-sm font-bold text-foreground">{count}</span>
                </div>
              );
            })}
          </div>
        </GlassCard>

        <GlassCard hover={false} className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-foreground text-sm">Reminder Vendor</h3>
            <button onClick={() => setShowReminder(true)} className="text-xs text-primary hover:brightness-110 font-medium">+ Kirim</button>
          </div>
          {reminders.length > 0 ? (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {reminders.slice(0, 5).map(r => (
                <div key={r.id} className={`p-2.5 rounded-lg border text-xs ${r.status === 'responded' ? 'border-emerald-300/20 bg-emerald-400/10' : r.status === 'pending' ? 'border-amber-300/20 bg-amber-400/10' : 'border-[var(--glass-border)] bg-[var(--glass-bg)]'}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground truncate">{r.vendor_name}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${r.status === 'responded' ? 'bg-emerald-400/20 text-emerald-300' : 'bg-amber-400/20 text-amber-300'}`}>{r.status === 'responded' ? 'Dibalas' : 'Menunggu'}</span>
                  </div>
                  <p className="text-muted-foreground mt-0.5 truncate">{r.subject}</p>
                  {r.response && <p className="text-emerald-300 mt-1 italic">Respon: {r.response}</p>}
                </div>
              ))}
            </div>
          ) : <div className="flex items-center justify-center h-24 text-muted-foreground text-xs">Belum ada reminder</div>}
        </GlassCard>
      </div>

      {/* Drilldown Modals */}
      {drilldown === 'po' && (
        <DrilldownModal title="Detail PO" onClose={() => setDrilldown(null)} onNavigate={() => { setDrilldown(null); nav('production-po'); }} navLabel="Buka Production PO">
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-sky-400/10 rounded-lg p-3 border border-sky-300/15"><p className="text-xl font-bold text-sky-400">{metrics?.totalPOs || 0}</p><p className="text-xs text-sky-300">Total PO</p></div>
              <div className="bg-emerald-400/10 rounded-lg p-3 border border-emerald-300/15"><p className="text-xl font-bold text-emerald-400">{metrics?.activePOs || 0}</p><p className="text-xs text-emerald-300">Aktif</p></div>
              <div className="bg-red-400/10 rounded-lg p-3 border border-red-300/15"><p className="text-xl font-bold text-red-400">{metrics?.delayedPOs || 0}</p><p className="text-xs text-red-300">Terlambat</p></div>
            </div>
            <h4 className="text-sm font-semibold text-foreground mt-3">Status Breakdown:</h4>
            {(metrics?.poStatusList || []).map(s => (
              <div key={s.status} className="border border-[var(--glass-border)] rounded-lg p-3 bg-[var(--glass-bg)]">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">{s.status}</span>
                  <span className="text-sm font-bold text-foreground">{s.count}</span>
                </div>
                {s.samples?.slice(0, 3).map(po => (
                  <div key={po.id} className="text-xs text-muted-foreground mt-1">{po.po_number} — {po.customer_name || 'N/A'}</div>
                ))}
              </div>
            ))}
          </div>
        </DrilldownModal>
      )}

      {drilldown === 'progress' && (
        <DrilldownModal title="Progress Produksi" onClose={() => setDrilldown(null)} onNavigate={() => { setDrilldown(null); nav('production-monitoring'); }} navLabel="Monitoring Produksi">
          <div className="space-y-3">
            <div className="bg-teal-400/10 rounded-xl p-4 text-center border border-teal-300/15">
              <p className="text-3xl font-bold text-teal-400">{metrics?.globalProgressPct || 0}%</p>
              <p className="text-sm text-teal-300 mt-1">{fmtNum(metrics?.totalProducedGlobal)} dari {fmtNum(metrics?.totalAvailableGlobal)} pcs</p>
              <div className="w-full bg-secondary rounded-full h-3 mt-3">
                <div className="bg-teal-400 h-3 rounded-full transition-all" style={{ width: `${metrics?.globalProgressPct || 0}%` }} />
              </div>
            </div>
          </div>
        </DrilldownModal>
      )}

      {drilldown === 'reminders' && (
        <DrilldownModal title="Semua Reminder" onClose={() => setDrilldown(null)}>
          <div className="space-y-2">
            {reminders.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada reminder</p> : reminders.map(r => (
              <div key={r.id} className={`p-3 rounded-lg border ${r.status === 'responded' ? 'border-emerald-300/20 bg-emerald-400/10' : 'border-amber-300/20 bg-amber-400/10'}`}>
                <div className="flex justify-between"><span className="text-sm font-semibold text-foreground">{r.vendor_name}</span><span className="text-xs text-muted-foreground">{fmtDate(r.created_at)}</span></div>
                <p className="text-sm text-muted-foreground mt-0.5">{r.subject}</p>
                {r.response && <div className="mt-2 p-2 bg-[var(--glass-bg)] rounded border border-emerald-300/15"><p className="text-xs text-emerald-300"><strong>Respon vendor:</strong> {r.response}</p></div>}
              </div>
            ))}
          </div>
        </DrilldownModal>
      )}

      {drilldown === 'jobs' && (
        <DrilldownModal title="Production Jobs" onClose={() => setDrilldown(null)} onNavigate={() => { setDrilldown(null); nav('work-orders'); }} navLabel="Distribusi Kerja">
          <div className="space-y-3">
            <div className="bg-emerald-400/10 rounded-xl p-4 text-center border border-emerald-300/15">
              <p className="text-3xl font-bold text-emerald-400">{metrics?.activeJobs || 0}</p>
              <p className="text-sm text-emerald-300">Jobs aktif sedang berjalan</p>
            </div>
            {woStatusData.length > 0 && woStatusData.map((s, i) => (
              <div key={s.name} className="flex items-center justify-between p-2 bg-[var(--glass-bg)] rounded-lg border border-[var(--glass-border)]">
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }}></div><span className="text-sm text-muted-foreground">{s.name}</span></div>
                <span className="font-bold text-foreground">{s.value}</span>
              </div>
            ))}
          </div>
        </DrilldownModal>
      )}

      {drilldown === 'ontime' && (
        <DrilldownModal title="On-Time Delivery Rate" onClose={() => setDrilldown(null)}>
          <div className="bg-indigo-400/10 rounded-xl p-6 text-center border border-indigo-300/15">
            <p className="text-4xl font-bold text-indigo-400">{metrics?.onTimeRate || 0}%</p>
            <p className="text-sm text-indigo-300 mt-1">PO diselesaikan sebelum atau tepat deadline</p>
          </div>
        </DrilldownModal>
      )}

      {/* Send Reminder Modal */}
      {showReminder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-bg)] backdrop-blur-sm" onClick={() => setShowReminder(false)}>
          <GlassCard hover={false} className="w-full max-w-md mx-4 overflow-hidden" onClick={e => e.stopPropagation()} data-testid="reminder-modal">
            <div className="px-5 py-4 border-b border-[var(--glass-border)]">
              <h3 className="font-bold text-foreground flex items-center gap-2"><Send className="w-4 h-4 text-primary" /> Kirim Reminder ke Vendor</h3>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Vendor</label>
                <select value={reminderForm.vendor_id} onChange={e => setReminderForm(f => ({ ...f, vendor_id: e.target.value }))} className="w-full border border-[var(--glass-border)] bg-[var(--input-surface)] rounded-lg px-3 py-2 text-sm text-foreground" data-testid="reminder-vendor">
                  <option value="">Pilih vendor...</option>
                  {vendors.map(v => <option key={v.id} value={v.id}>{v.garment_name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Subject</label>
                <GlassInput value={reminderForm.subject} onChange={e => setReminderForm(f => ({ ...f, subject: e.target.value }))} placeholder="e.g., Update progres produksi" data-testid="reminder-subject" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">No PO (opsional)</label>
                <GlassInput value={reminderForm.po_number} onChange={e => setReminderForm(f => ({ ...f, po_number: e.target.value }))} placeholder="PO-001" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Pesan</label>
                <textarea value={reminderForm.message} onChange={e => setReminderForm(f => ({ ...f, message: e.target.value }))} className="w-full border border-[var(--glass-border)] bg-[var(--input-surface)] rounded-lg px-3 py-2 text-sm text-foreground h-20 resize-none placeholder:text-muted-foreground" placeholder="Detail reminder..." data-testid="reminder-message" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Prioritas</label>
                <div className="flex gap-2">
                  {['normal', 'high', 'urgent'].map(p => (
                    <button key={p} onClick={() => setReminderForm(f => ({ ...f, priority: p }))} className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${reminderForm.priority === p ? (p === 'urgent' ? 'bg-red-400/15 border-red-300/20 text-red-300' : p === 'high' ? 'bg-amber-400/15 border-amber-300/20 text-amber-300' : 'bg-primary/15 border-primary/20 text-primary') : 'bg-[var(--glass-bg)] border-[var(--glass-border)] text-muted-foreground'}`}>
                      {p === 'urgent' ? 'Urgent' : p === 'high' ? 'High' : 'Normal'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-[var(--glass-border)] flex justify-end gap-2">
              <button onClick={() => setShowReminder(false)} className="px-4 py-2 text-sm text-muted-foreground rounded-lg hover:bg-[var(--glass-bg-hover)] transition-colors">Batal</button>
              <button onClick={sendReminder} className="px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg font-medium hover:brightness-110 flex items-center gap-1.5 transition-all" data-testid="send-reminder-submit"><Send className="w-3.5 h-3.5" /> Kirim</button>
            </div>
          </GlassCard>
        </div>
      )}
    </div>
  );
}
