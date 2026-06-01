/**
 * LiveSessionAnalyticsDashboard — Phase 3 P1
 *
 * Advanced analytics untuk Live Session (Shopee/TikTok/Instagram).
 * Fitur: KPI overview, platform share, session comparison, host leaderboard,
 *        revenue trend chart, account health.
 */
import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  TrendingUp, Users, ShoppingCart, DollarSign,
  RefreshCw, Star, BarChart3, Award, Activity,
  ChevronUp, ChevronDown, Eye, Zap,
} from 'lucide-react';
import { Button } from '../../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../ui/select';
import { useToast } from '../../../hooks/use-toast';

const API = process.env.REACT_APP_BACKEND_URL || '';

const FMT_IDR = v => `Rp ${(+v || 0).toLocaleString('id-ID')}`;
const FMT_NUM = v => (+v || 0).toLocaleString('id-ID');
const FMT_PCT = v => `${(+v || 0).toFixed(1)}%`;

const PLATFORM_COLORS = {
  shopee:    { bg: 'bg-orange-500/15', text: 'text-orange-400', border: 'border-orange-500/30', bar: 'bg-orange-500' },
  tiktok:    { bg: 'bg-zinc-500/15',   text: 'text-zinc-300',   border: 'border-zinc-500/30',   bar: 'bg-zinc-400' },
  instagram: { bg: 'bg-pink-500/15',   text: 'text-pink-400',   border: 'border-pink-500/30',   bar: 'bg-pink-500' },
  tokopedia: { bg: 'bg-green-500/15',  text: 'text-green-400',  border: 'border-green-500/30',  bar: 'bg-green-500' },
};

const PLATFORMS_LIST = ['shopee', 'tiktok', 'instagram', 'tokopedia'];

function DeltaBadge({ pct }) {
  if (pct == null) return null;
  const pos = pct >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${
      pos ? 'text-emerald-400' : 'text-red-400'
    }`}>
      {pos ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      {Math.abs(pct)}%
    </span>
  );
}

function MiniBarChart({ data, valueKey = 'revenue', labelKey = 'date' }) {
  if (!data || data.length === 0) return (
    <div className="flex items-center justify-center h-24 text-zinc-500 text-xs">Belum ada data</div>
  );
  const max = Math.max(...data.map(d => d[valueKey] || 0), 1);
  return (
    <div className="flex items-end gap-1 h-24 px-1">
      {data.slice(-14).map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center group relative">
          <div
            className="w-full bg-blue-500 rounded-sm opacity-70 hover:opacity-100 transition-all"
            style={{ height: `${((d[valueKey] || 0) / max) * 100}%` }}
          />
          <div className="absolute bottom-full mb-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 z-10">
            {d[labelKey]}: {FMT_IDR(d[valueKey])}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function LiveSessionAnalyticsDashboard({ user, headers }) {
  const [overview, setOverview] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [trend, setTrend] = useState([]);
  const [accountHealth, setAccountHealth] = useState([]);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState('30');
  const [platform, setPlatform] = useState('');
  const [activeTab, setActiveTab] = useState('overview');
  const { toast } = useToast();
  const authH = headers || {};

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const params = { days: parseInt(days) };
      if (platform) params.platform = platform;

      const [ovRes, sessRes, lbRes, trendRes, healthRes] = await Promise.all([
        axios.get(`${API}/api/marketing/live/analytics/overview`, { headers: authH, params }),
        axios.get(`${API}/api/marketing/live/analytics/sessions-comparison`, { headers: authH, params: { ...params, limit: 10 } }),
        axios.get(`${API}/api/marketing/live/analytics/host-leaderboard`, { headers: authH, params }),
        axios.get(`${API}/api/marketing/live/analytics/revenue-trend`, { headers: authH, params: { ...params, granularity: 'weekly' } }),
        axios.get(`${API}/api/marketing/live/analytics/account-health`, { headers: authH, params: { days: parseInt(days) } }),
      ]);

      setOverview(ovRes.data);
      setSessions(sessRes.data?.data || []);
      setLeaderboard(lbRes.data?.data || []);
      setTrend(trendRes.data?.data || []);
      setAccountHealth(healthRes.data?.data || []);
    } catch (e) {
      toast({ title: 'Error', description: e.response?.data?.detail || 'Gagal load analytics', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [days, platform, authH, toast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const kpi = overview?.kpi || {};
  const platformShare = overview?.platform_share || [];
  const dailyTrend = overview?.daily_trend || [];

  const TABS = [
    { id: 'overview',  label: 'Overview' },
    { id: 'sessions',  label: 'Top Sessions' },
    { id: 'leaderboard', label: 'Host Ranking' },
    { id: 'trend',     label: 'Revenue Trend' },
    { id: 'health',    label: 'Account Health' },
  ];

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Zap className="text-amber-400" /> Live Session Analytics
          </h2>
          <p className="text-sm text-zinc-400 mt-1">Analisis performa live session multi-platform</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Select value={platform} onValueChange={setPlatform}>
            <SelectTrigger className="w-36 bg-zinc-900 border-zinc-700 text-sm" data-testid="sel-platform">
              <SelectValue placeholder="Semua Platform" />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-800">
              <SelectItem value="">Semua Platform</SelectItem>
              {PLATFORMS_LIST.map(p => (
                <SelectItem key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-28 bg-zinc-900 border-zinc-700 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-800">
              <SelectItem value="7">7 Hari</SelectItem>
              <SelectItem value="30">30 Hari</SelectItem>
              <SelectItem value="90">90 Hari</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={fetchAll} disabled={loading}
            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800" data-testid="btn-refresh-analytics">
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: Zap,          label: 'Total Sesi',       value: FMT_NUM(kpi.total_sessions),       sub: `${days} hari` },
          { icon: DollarSign,   label: 'Total Revenue',    value: FMT_IDR(kpi.total_revenue_rp),     sub: <DeltaBadge pct={kpi.revenue_delta_vs_prev_period_pct} /> },
          { icon: ShoppingCart, label: 'Total Order',      value: FMT_NUM(kpi.total_orders),          sub: `${FMT_IDR(kpi.avg_revenue_per_session)}/sesi` },
          { icon: Eye,          label: 'Avg Peak Viewers', value: FMT_NUM(kpi.avg_viewers),           sub: `Conv ${FMT_PCT(kpi.avg_conversion_rate)}` },
        ].map(({ icon: Icon, label, value, sub }) => (
          <Card key={label} className="bg-zinc-900 border-zinc-800">
            <CardContent className="pt-4 pb-3">
              <div className="flex justify-between items-start mb-1">
                <span className="text-xs text-zinc-400">{label}</span>
                <Icon className="w-4 h-4 text-zinc-600" />
              </div>
              <div className="text-xl font-bold text-white">{loading ? '…' : value}</div>
              <div className="text-xs text-zinc-500 mt-0.5">{sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-zinc-800 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
              activeTab === t.id
                ? 'text-white border-b-2 border-blue-500'
                : 'text-zinc-400 hover:text-white'
            }`}
            data-testid={`tab-${t.id}`}
          >{t.label}</button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Platform Share */}
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-zinc-300">Share per Platform</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {platformShare.length === 0 ? (
                <p className="text-zinc-500 text-sm">Belum ada data</p>
              ) : platformShare.map(p => {
                const pc = PLATFORM_COLORS[p.platform] || { bg: 'bg-zinc-700', text: 'text-zinc-300', bar: 'bg-zinc-500' };
                return (
                  <div key={p.platform}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className={`font-medium ${pc.text}`}>{p.platform}</span>
                      <span className="text-zinc-400">{FMT_IDR(p.revenue)} ({p.revenue_share_pct}%)</span>
                    </div>
                    <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <div className={`h-full ${pc.bar} rounded-full`} style={{ width: `${p.revenue_share_pct}%` }} />
                    </div>
                    <div className="text-xs text-zinc-600 mt-0.5">{p.sessions} sesi &bull; {p.orders} order</div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Daily Trend Mini */}
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-zinc-300">Revenue Harian</CardTitle>
            </CardHeader>
            <CardContent>
              <MiniBarChart data={dailyTrend} valueKey="revenue" labelKey="date" />
              <div className="text-xs text-zinc-500 mt-2 text-center">
                Top platform: <span className="text-white">{kpi.top_platform || '—'}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'sessions' && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-zinc-300">Top {sessions.length} Sesi ({days} hari)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {sessions.length === 0 ? (
              <div className="text-center py-10 text-zinc-500">Belum ada data sesi</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 text-xs text-zinc-400">
                      <th className="text-left px-4 py-2">#</th>
                      <th className="text-left px-4 py-2">Tanggal</th>
                      <th className="text-left px-4 py-2">Platform</th>
                      <th className="text-left px-4 py-2">Host</th>
                      <th className="text-right px-4 py-2">Revenue</th>
                      <th className="text-right px-4 py-2">Orders</th>
                      <th className="text-right px-4 py-2">Viewers</th>
                      <th className="text-right px-4 py-2">Conv%</th>
                      <th className="text-right px-4 py-2">vs Rata</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map(s => (
                      <tr key={s.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                        <td className="px-4 py-2 text-zinc-500">{s.rank}</td>
                        <td className="px-4 py-2 text-zinc-300">{s.session_date}</td>
                        <td className="px-4 py-2">
                          <span className={`text-xs px-2 py-0.5 rounded border ${
                            PLATFORM_COLORS[s.platform]?.bg || 'bg-zinc-700'
                          } ${PLATFORM_COLORS[s.platform]?.text || 'text-zinc-300'} ${
                            PLATFORM_COLORS[s.platform]?.border || 'border-zinc-600'
                          }`}>{s.platform}</span>
                        </td>
                        <td className="px-4 py-2 text-zinc-300">{s.host_name || '—'}</td>
                        <td className="px-4 py-2 text-right text-emerald-400 font-medium">{FMT_IDR(s.total_revenue)}</td>
                        <td className="px-4 py-2 text-right text-zinc-300">{s.orders_count}</td>
                        <td className="px-4 py-2 text-right text-zinc-400">{FMT_NUM(s.peak_viewers)}</td>
                        <td className="px-4 py-2 text-right text-zinc-400">{s.conversion_rate}%</td>
                        <td className="px-4 py-2 text-right">
                          <DeltaBadge pct={s.vs_avg_pct} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === 'leaderboard' && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-zinc-300 flex items-center gap-2">
              <Award className="w-4 h-4 text-amber-400" /> Host Leaderboard ({days} hari)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {leaderboard.length === 0 ? (
              <div className="text-center py-10 text-zinc-500">Belum ada data host</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 text-xs text-zinc-400">
                      <th className="text-left px-4 py-2">Rank</th>
                      <th className="text-left px-4 py-2">Host</th>
                      <th className="text-right px-4 py-2">Sesi</th>
                      <th className="text-right px-4 py-2">Total Revenue</th>
                      <th className="text-right px-4 py-2">Avg/Sesi</th>
                      <th className="text-right px-4 py-2">Avg Viewers</th>
                      <th className="text-right px-4 py-2">Conv%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.map((h, i) => (
                      <tr key={h.host_name} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                        <td className="px-4 py-2">
                          <span className={`font-bold ${
                            i === 0 ? 'text-amber-400' : i === 1 ? 'text-zinc-300' : i === 2 ? 'text-orange-400' : 'text-zinc-500'
                          }`}>#{h.rank}</span>
                        </td>
                        <td className="px-4 py-2 font-medium text-zinc-200">{h.host_name}</td>
                        <td className="px-4 py-2 text-right text-zinc-400">{h.total_sessions}</td>
                        <td className="px-4 py-2 text-right text-emerald-400 font-medium">{FMT_IDR(h.total_revenue)}</td>
                        <td className="px-4 py-2 text-right text-zinc-300">{FMT_IDR(h.avg_revenue_per_session)}</td>
                        <td className="px-4 py-2 text-right text-zinc-400">{FMT_NUM(h.avg_viewers)}</td>
                        <td className="px-4 py-2 text-right text-zinc-400">{h.avg_conversion_rate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === 'trend' && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-zinc-300 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-400" /> Revenue Trend (Weekly)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {trend.length === 0 ? (
              <div className="text-center py-10 text-zinc-500">Belum ada data trend</div>
            ) : (
              <>
                <MiniBarChart data={trend} valueKey="revenue" labelKey="period" />
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-zinc-800 text-zinc-500">
                        <th className="text-left py-1 px-2">Periode</th>
                        <th className="text-right py-1 px-2">Revenue</th>
                        <th className="text-right py-1 px-2">Sesi</th>
                        <th className="text-right py-1 px-2">Orders</th>
                        <th className="text-right py-1 px-2">Avg/Sesi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trend.map(t => (
                        <tr key={t.period} className="border-b border-zinc-800/30">
                          <td className="py-1 px-2 text-zinc-300">{t.period}</td>
                          <td className="py-1 px-2 text-right text-emerald-400">{FMT_IDR(t.revenue)}</td>
                          <td className="py-1 px-2 text-right text-zinc-400">{t.sessions}</td>
                          <td className="py-1 px-2 text-right text-zinc-400">{t.orders}</td>
                          <td className="py-1 px-2 text-right text-zinc-400">{FMT_IDR(t.avg_revenue_per_session)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === 'health' && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-zinc-300">Account Health Score</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {accountHealth.length === 0 ? (
              <div className="text-center py-10 text-zinc-500">Belum ada data akun</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 text-xs text-zinc-400">
                      <th className="text-left px-4 py-2">Akun</th>
                      <th className="text-left px-4 py-2">Platform</th>
                      <th className="text-right px-4 py-2">Sesi</th>
                      <th className="text-right px-4 py-2">Revenue</th>
                      <th className="text-right px-4 py-2">Conv%</th>
                      <th className="text-right px-4 py-2">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accountHealth.map(a => (
                      <tr key={`${a.account_name}-${a.platform}`} className="border-b border-zinc-800/50">
                        <td className="px-4 py-2 font-medium text-zinc-200">{a.account_name}</td>
                        <td className="px-4 py-2">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            PLATFORM_COLORS[a.platform]?.bg || 'bg-zinc-700'
                          } ${PLATFORM_COLORS[a.platform]?.text || 'text-zinc-300'}`}>{a.platform}</span>
                        </td>
                        <td className="px-4 py-2 text-right text-zinc-400">{a.sessions}</td>
                        <td className="px-4 py-2 text-right text-emerald-400">{FMT_IDR(a.total_revenue)}</td>
                        <td className="px-4 py-2 text-right text-zinc-400">{a.avg_conversion_rate}%</td>
                        <td className="px-4 py-2 text-right">
                          <span className={`font-bold ${
                            a.health_score >= 80 ? 'text-emerald-400' :
                            a.health_score >= 60 ? 'text-blue-400' :
                            a.health_score >= 40 ? 'text-amber-400' : 'text-red-400'
                          }`}>{a.health_score}</span>
                          <span className="text-zinc-600 text-xs ml-1">({a.health_status})</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
