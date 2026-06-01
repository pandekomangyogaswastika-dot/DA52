import { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { AlertTriangle, Package, MapPin, TrendingDown, RefreshCw, ArrowRight, Thermometer, Building2, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { toast } from '../ui/sonner';

const API = process.env.REACT_APP_BACKEND_URL;

const KPI = ({ label, value, sub, icon: Icon, color }) => (
  <div className="bg-white dark:bg-[var(--card-surface)] border border-border rounded-xl p-4 flex items-start gap-4 shadow-sm">
    <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}>
      <Icon size={18} className="text-white" />
    </div>
    <div>
      <p className="text-2xl font-bold text-gray-900 dark:text-foreground">{value}</p>
      <p className="text-xs font-medium text-gray-600 dark:text-foreground/75 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">{sub}</p>}
    </div>
  </div>
);

const ZONE_COLORS = [
  'bg-emerald-500', 'bg-teal-500', 'bg-cyan-500', 'bg-sky-500',
  'bg-violet-500', 'bg-purple-500', 'bg-rose-500', 'bg-orange-500',
];

function utilColor(pct) {
  if (pct >= 85) return 'bg-red-500/80 border-red-400';
  if (pct >= 55) return 'bg-amber-500/80 border-amber-400';
  return 'bg-emerald-500/80 border-emerald-400';
}

export default function WarehouseDashboard({ token }) {
  const [kpi, setKpi] = useState({ total_items: 0, total_locations: 0, pending_gr: 0, pending_putaway: 0 });
  const [lowStock, setLowStock] = useState([]);
  const [reorderAlerts, setReorderAlerts] = useState([]);
  const [stockByLoc, setStockByLoc] = useState([]);
  const [loading, setLoading] = useState(true);
  // ── WMS multi-warehouse extension ──────────────────────────────────────────
  const [wmsBuildings, setWmsBuildings] = useState([]);
  const [selectedBldg, setSelectedBldg] = useState('');
  const [wmsPending, setWmsPending] = useState({ pending_inbound: 0, pending_outbound_rm: 0, pending_outbound_fg: 0, total_pending: 0 });
  const [occupancyAlerts, setOccupancyAlerts] = useState({ critical: [], warning: [], total_alerts: 0, critical_count: 0, warning_count: 0 });
  const hdrs = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const loadWMS = useCallback(async () => {
    try {
      const buildingFilter = selectedBldg ? `?building_id=${selectedBldg}` : '';
      const [bRes, pRes, aRes] = await Promise.all([
        fetch(`${API}/api/wms/buildings`, { headers: hdrs }).then(r => r.json()),
        fetch(`${API}/api/wms/pending/summary${buildingFilter}`, { headers: hdrs }).then(r => r.json()),
        fetch(`${API}/api/wms/alerts/occupancy?threshold=90${selectedBldg ? `&building_id=${selectedBldg}` : ''}`, { headers: hdrs }).then(r => r.json()),
      ]);
      setWmsBuildings(Array.isArray(bRes) ? bRes : []);
      setWmsPending(pRes || {});
      setOccupancyAlerts(aRes || { critical: [], warning: [], total_alerts: 0 });
    } catch { /* silent */ }
  }, [hdrs, selectedBldg]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [kpiRes, stockRes, lowRes, reorderRes, locRes] = await Promise.allSettled([
        axios.get(`${API}/api/wms/legacy/dashboard-kpi`, { headers: hdrs }),
        axios.get(`${API}/api/wms/legacy/stock`, { headers: hdrs }),
        axios.get(`${API}/api/rahaza/materials?low_stock=true`, { headers: hdrs }),
        axios.get(`${API}/api/rahaza/materials/reorder-alerts`, { headers: hdrs }),
        axios.get(`${API}/api/wms/legacy/locations`, { headers: hdrs }),
      ]);
      if (kpiRes.status === 'fulfilled') setKpi(kpiRes.value.data || {});
      if (lowRes.status === 'fulfilled') setLowStock(lowRes.value.data || []);
      if (reorderRes.status === 'fulfilled') setReorderAlerts(reorderRes.value.data || []);

      // Build heatmap: sum qty per location
      const stocks = stockRes.status === 'fulfilled' ? (stockRes.value.data || []) : [];
      const locs = locRes.status === 'fulfilled' ? (locRes.value.data || []) : [];
      const locMap = {};
      for (const s of stocks) {
        const lid = s.location_id || 'unknown';
        if (!locMap[lid]) locMap[lid] = { location_id: lid, total_qty: 0, item_count: 0 };
        locMap[lid].total_qty += parseFloat(s.quantity || 0);
        locMap[lid].item_count += 1;
      }
      const locNameMap = Object.fromEntries(locs.map(l => [l.id, l.code || l.name]));
      const byLoc = Object.values(locMap).map(l => ({
        ...l,
        name: locNameMap[l.location_id] || l.location_id?.slice(0, 8) || 'Unknown',
      })).sort((a, b) => b.total_qty - a.total_qty);
      setStockByLoc(byLoc);
    } catch (err) {
      toast.error('Gagal memuat data dashboard');
    } finally {
      setLoading(false);
    }
  }, [hdrs]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadWMS(); }, [loadWMS]);

  const maxQty = stockByLoc.reduce((m, l) => Math.max(m, l.total_qty), 1);
  const criticalCount = lowStock.length + reorderAlerts.length;

  return (
    <div className="space-y-6 p-1" data-testid="warehouse-dashboard">
      {/* Header with Multi-Warehouse Selector */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-foreground">Dashboard Gudang</h2>
          <p className="text-sm text-foreground/55 mt-0.5">Ringkasan real-time Portal Gudang</p>
        </div>
        <div className="flex items-center gap-2">
          {wmsBuildings.length > 0 && (
            <select
              data-testid="warehouse-building-selector"
              value={selectedBldg}
              onChange={e => setSelectedBldg(e.target.value)}
              className="bg-[var(--card-surface)] border border-border rounded-lg px-3 py-1.5 text-xs text-foreground"
              title="Filter berdasarkan gedung WMS"
            >
              <option value="">📦 Semua Gedung</option>
              {wmsBuildings.map(b => <option key={b.id} value={b.id}>🏢 {b.name}</option>)}
            </select>
          )}
          <button
            onClick={() => { load(); loadWMS(); }}
            className="flex items-center gap-2 text-xs text-foreground/65 hover:text-foreground px-3 py-1.5 bg-[var(--card-surface)] hover:bg-[var(--card-surface-hover)] rounded-lg border border-border transition-colors"
            data-testid="dashboard-refresh-btn"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* WMS Occupancy Alert Banner */}
      {occupancyAlerts.total_alerts > 0 && (
        <div data-testid="dashboard-occupancy-alert" className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-red-500" />
            <span className="text-sm font-semibold text-red-600 dark:text-red-300">
              Peringatan Kapasitas Rak — {occupancyAlerts.total_alerts} rak ≥ 90% terisi
            </span>
            {occupancyAlerts.critical_count > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-500/20 text-red-600 dark:text-red-300 ml-2">
                ⚠ {occupancyAlerts.critical_count} kritis (≥95%)
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {[...(occupancyAlerts.critical || []), ...(occupancyAlerts.warning || [])].slice(0, 6).map(r => (
              <div key={r.rack_id} className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border ${r.severity === 'critical' ? 'bg-red-500/15 border-red-500/40' : 'bg-amber-500/10 border-amber-500/30'}`}>
                <div className="min-w-0">
                  <div className="text-xs font-mono font-bold truncate text-foreground">{r.building_code}-{r.zone_code}-{r.rack_code}</div>
                  <div className="text-[10px] text-foreground/55 truncate">{r.rack_name}</div>
                </div>
                <div className="text-right">
                  <div className={`text-sm font-bold ${r.severity === 'critical' ? 'text-red-500' : 'text-amber-500'}`}>{r.occupancy_pct}%</div>
                  <div className="text-[10px] text-foreground/55">{r.free_slots} kosong</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* WMS Pending Movements Strip */}
      {wmsBuildings.length > 0 && (
        <div className="bg-[var(--card-surface)] border border-border rounded-xl p-4" data-testid="wms-pending-strip">
          <div className="flex items-center gap-2 mb-3">
            <Building2 size={14} className="text-violet-500" />
            <span className="text-sm font-semibold text-foreground">WMS — Pending Movements{selectedBldg ? ` (${wmsBuildings.find(b => b.id === selectedBldg)?.name})` : ' (Semua Gedung)'}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
              <ArrowDownToLine size={14} className="text-emerald-500 mb-1" />
              <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{wmsPending.pending_inbound ?? 0}</div>
              <div className="text-[10px] text-foreground/55">Pending Inbound</div>
            </div>
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
              <ArrowUpFromLine size={14} className="text-amber-500 mb-1" />
              <div className="text-lg font-bold text-amber-600 dark:text-amber-400">{wmsPending.pending_outbound_rm ?? 0}</div>
              <div className="text-[10px] text-foreground/55">Outbound RM (Issue)</div>
            </div>
            <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3">
              <ArrowUpFromLine size={14} className="text-orange-500 mb-1" />
              <div className="text-lg font-bold text-orange-600 dark:text-orange-400">{wmsPending.pending_outbound_fg ?? 0}</div>
              <div className="text-[10px] text-foreground/55">Outbound FG (Ship)</div>
            </div>
            <div className="bg-violet-500/10 border border-violet-500/20 rounded-lg p-3">
              <Package size={14} className="text-violet-500 mb-1" />
              <div className="text-lg font-bold text-violet-600 dark:text-violet-400">{wmsPending.total_pending ?? 0}</div>
              <div className="text-[10px] text-foreground/55">Total Pending</div>
            </div>
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="Total SKU" value={kpi.total_items ?? stockByLoc.reduce((s,l)=>s+l.item_count,0)} icon={Package} color="bg-blue-500/80" />
        <KPI label="Lokasi Aktif" value={kpi.total_locations ?? stockByLoc.length} icon={MapPin} color="bg-teal-500/80" />
        <KPI label="GR Pending" value={kpi.pending_gr ?? '–'} icon={RefreshCw} color="bg-violet-500/80" />
        <KPI
          label="Stok Kritis"
          value={criticalCount}
          sub={criticalCount > 0 ? `${criticalCount} material perlu perhatian` : 'Semua aman'}
          icon={AlertTriangle}
          color={criticalCount > 0 ? 'bg-red-500/80' : 'bg-emerald-500/80'}
        />
      </div>

      {/* U1 — Low-stock & Reorder Alert Panel */}
      {criticalCount > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4" data-testid="low-stock-panel">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={16} className="text-red-500" />
            <span className="text-sm font-semibold text-red-600 dark:text-red-300">Stok Kritis & Reorder Alert ({criticalCount})</span>
          </div>
          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {[...lowStock.map(m => ({ ...m, _type: 'low' })), ...reorderAlerts.map(m => ({ ...m, _type: 'reorder' }))]
              .slice(0, 12)
              .map((m, i) => (
              <div key={`${m._type}-${m.code || m.id || i}`} className="flex items-center justify-between bg-[var(--card-surface)] border border-border rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${m._type === 'low' ? 'bg-red-500/20 text-red-600 dark:text-red-300' : 'bg-amber-500/20 text-amber-600 dark:text-amber-300'}`}>
                    {m._type === 'low' ? 'LOW' : 'REORDER'}
                  </span>
                  <span className="text-xs text-foreground truncate font-medium">{m.code}</span>
                  <span className="text-xs text-foreground/55 truncate hidden sm:block">{m.name}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs font-mono text-red-600 dark:text-red-300">
                    {m.current_qty ?? 0} {m.unit}
                  </span>
                  <TrendingDown size={13} className="text-red-500" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* U6 — Stock Heatmap by Location */}
      <div className="bg-[var(--card-surface)] border border-border rounded-xl p-4" data-testid="stock-heatmap">
        <div className="flex items-center gap-2 mb-4">
          <Thermometer size={16} className="text-cyan-500" />
          <span className="text-sm font-semibold text-foreground">Heatmap Stok per Lokasi</span>
          <span className="ml-auto text-xs text-foreground/45">{stockByLoc.length} lokasi</span>
        </div>
        {stockByLoc.length === 0 ? (
          <div className="text-center py-8 text-foreground/40 text-sm">Belum ada data stok per lokasi</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {stockByLoc.map((loc, i) => {
              const pct = maxQty > 0 ? Math.round((loc.total_qty / maxQty) * 100) : 0;
              return (
                <div
                  key={loc.location_id}
                  className={`border rounded-xl p-3 transition-all hover:scale-105 cursor-default ${utilColor(pct)}`}
                  title={`${loc.name}: ${loc.total_qty} unit, ${loc.item_count} SKU`}
                  data-testid={`heatmap-loc-${i}`}
                >
                  <div className="text-xs font-bold text-white truncate">{loc.name}</div>
                  <div className="text-lg font-bold text-white mt-1">{loc.total_qty.toLocaleString()}</div>
                  <div className="text-[10px] text-white/85">{loc.item_count} SKU · {pct}%</div>
                  <div className="mt-2 h-1.5 rounded-full bg-white/20">
                    <div className="h-full rounded-full bg-white/80" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {/* Legend */}
        <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border">
          <span className="text-[10px] font-medium text-gray-700 dark:text-foreground/75">Utilisasi:</span>
          {[['bg-emerald-500/80', '< 55%'], ['bg-amber-500/80', '55–85%'], ['bg-red-500/80', '> 85%']].map(([c, l]) => (
            <div key={l} className="flex items-center gap-1">
              <div className={`w-2.5 h-2.5 rounded-sm ${c}`} />
              <span className="text-[10px] font-medium text-gray-700 dark:text-foreground/80">{l}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
