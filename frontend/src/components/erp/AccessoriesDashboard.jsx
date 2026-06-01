/**
 * AccessoriesDashboard — Portal Aksesoris MVP
 * Session #11.21 — Dedicated Accessories Portal
 *
 * KPI cards + quick view panels
 * Endpoint: GET /api/acc/dashboard
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Package, AlertTriangle, Clock, RotateCcw, ShoppingCart,
  TrendingDown, RefreshCw, ChevronRight, CheckCircle
} from 'lucide-react';

const API = process.env.REACT_APP_BACKEND_URL || '';

function fmtDate(iso) {
  if (!iso) return '-';
  try { return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return iso?.slice(0, 10) || '-'; }
}

function fmtNum(n) { return Number(n || 0).toLocaleString('id-ID'); }

function KPICard({ label, value, icon: Icon, color, subtext }) {
  return (
    <div
      className={`bg-${color}-500/5 border border-${color}-500/20 rounded-xl p-4 flex flex-col gap-2`}
      data-testid={`acc-kpi-${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <div className="flex items-center gap-2">
        <div className={`w-8 h-8 rounded-lg bg-${color}-500/15 border border-${color}-500/25 flex items-center justify-center`}>
          <Icon className={`w-4 h-4 text-${color}-400`} />
        </div>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className={`text-3xl font-bold text-${color}-400`}>{fmtNum(value)}</div>
      {subtext && <p className="text-xs text-muted-foreground">{subtext}</p>}
    </div>
  );
}

function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-white/5 rounded-lg ${className}`} />;
}

export default function AccessoriesDashboard({ token }) {
  const [dash, setDash]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  const loadDash = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const r = await fetch(`${API}/api/acc/dashboard`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setDash(data);
    } catch (e) {
      setError(e.message || 'Gagal memuat dashboard');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { loadDash(); }, [loadDash]);

  return (
    <div className="space-y-6" data-testid="accessories-dashboard">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Dashboard Aksesoris</h2>
          <p className="text-muted-foreground text-sm mt-1">Ringkasan stok, request, dan peminjaman aksesoris produksi</p>
        </div>
        <button
          onClick={loadDash}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 transition-colors"
          data-testid="acc-dash-refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* KPI Cards */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : dash ? (
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            label="Total Item"
            value={dash.total_items ?? 0}
            icon={Package}
            color="violet"
            subtext="Item aksesoris aktif"
          />
          <KPICard
            label="Stok Rendah"
            value={(dash.out_of_stock ?? 0) + (dash.low_stock ?? 0)}
            icon={AlertTriangle}
            color="amber"
            subtext={`${dash.out_of_stock ?? 0} habis · ${dash.low_stock ?? 0} hampir habis`}
          />
          <KPICard
            label="Request Pending"
            value={dash.pending_requests ?? 0}
            icon={Clock}
            color="sky"
            subtext="Menunggu persetujuan"
          />
          <KPICard
            label="Dipinjam Aktif"
            value={dash.active_loans ?? 0}
            icon={RotateCcw}
            color="teal"
            subtext={`PR pending: ${dash.pending_pr ?? 0}`}
          />
        </div>
      ) : null}

      {/* Active Opname Alert */}
      {dash?.active_opname && (
        <div className="bg-sky-500/10 border border-sky-500/20 rounded-xl p-4 flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-sky-400 shrink-0" />
          <div>
            <p className="text-sm font-medium text-sky-300">Sesi Opname Sedang Berjalan</p>
            <p className="text-xs text-muted-foreground">No. sesi: {dash.active_opname}</p>
          </div>
        </div>
      )}

      {/* Two-Column Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Low Stock Items */}
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-5" data-testid="acc-low-stock-panel">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-amber-400" />
              <span>Item Stok Rendah / Habis</span>
            </h3>
            {dash?.low_stock_items?.length > 0 && (
              <span className="text-xs text-amber-400">{dash.low_stock_items.length} item</span>
            )}
          </div>

          {loading ? (
            <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : (dash?.low_stock_items?.length ?? 0) === 0 ? (
            <div className="text-center py-8">
              <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Semua item stok aman</p>
            </div>
          ) : (
            <div className="space-y-2">
              {dash.low_stock_items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/15"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{item.code}</p>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <p className="text-sm text-amber-400 font-semibold">
                      {fmtNum(item.stock_qty)} {item.unit}
                    </p>
                    <p className="text-xs text-muted-foreground">min: {fmtNum(item.min_stock)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* PR Pending */}
        <div className="bg-sky-500/5 border border-sky-500/20 rounded-xl p-5" data-testid="acc-pr-panel">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-sky-400" />
              <span>Ringkasan Pengadaan</span>
            </h3>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center p-3 rounded-lg border border-white/10 bg-white/2">
              <span className="text-sm text-muted-foreground">PR Pending Persetujuan</span>
              <span className="text-sm font-semibold text-sky-400">{fmtNum(dash?.pending_pr ?? 0)}</span>
            </div>
            <div className="flex justify-between items-center p-3 rounded-lg border border-white/10 bg-white/2">
              <span className="text-sm text-muted-foreground">Peminjaman Aktif</span>
              <span className="text-sm font-semibold text-teal-400">{fmtNum(dash?.active_loans ?? 0)}</span>
            </div>
            <div className="flex justify-between items-center p-3 rounded-lg border border-white/10 bg-white/2">
              <span className="text-sm text-muted-foreground">Request Internal Pending</span>
              <span className="text-sm font-semibold text-amber-400">{fmtNum(dash?.pending_requests ?? 0)}</span>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-white/10">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ChevronRight className="w-3.5 h-3.5" />
              <span>Gunakan menu sidebar untuk aksi lanjutan</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
