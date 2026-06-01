import React, { useState, useEffect, useCallback } from 'react';
import {
  Video, Users, TrendingUp, Heart, MessageCircle, Share2, ShoppingBag,
  RefreshCw, Loader2, Play
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useActiveMarketingAccount } from '@/hooks/useActiveMarketingAccount';
import { ActiveAccountBar } from './ActiveAccountBar';
import { useMarketingAccounts } from '@/hooks/useMarketingAccounts';
import axios from 'axios';

const API = process.env.REACT_APP_BACKEND_URL;

function fmt(n) { return new Intl.NumberFormat('id-ID').format(n || 0); }
function fmtRp(n) { return `Rp ${fmt(n)}`; }

const PLATFORM_ICONS = { shopee: '🛒', tiktok: '🎵', instagram: '📷' };

export default function LiveSessionModule({ token }) {
  const { toast } = useToast();
  const { activeAccount, setActiveAccount } = useActiveMarketingAccount();
  const { accounts: masterAccounts } = useMarketingAccounts(token);
  const [summary, setSummary] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  
  const [platformFilter, setPlatformFilter] = useState('');
  const [page, setPage] = useState(1);
  
  const authH = { Authorization: `Bearer ${token || localStorage.getItem('auth_token')}` };
  
  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const res = await axios.get(`${API}/api/marketing/live/summary`, { headers: authH });
      if (res.data.success) {
        setSummary(res.data.data);
      }
    } catch (e) {
      toast({ title: 'Gagal load live summary', variant: 'destructive' });
    } finally {
      setSummaryLoading(false);
    }
  }, [token]); // eslint-disable-line
  
  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, page_size: 20 };
      if (platformFilter) params.platform = platformFilter;
      const res = await axios.get(`${API}/api/marketing/live/sessions`, { params, headers: authH });
      if (res.data.success) {
        setSessions(res.data.data.sessions || []);
        setPagination(res.data.pagination);
      }
    } catch (e) {
      toast({ title: 'Gagal load sessions', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [page, platformFilter, token]); // eslint-disable-line
  
  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  useEffect(() => { fetchSessions(); }, [fetchSessions]);
  
  const kpis = [
    { label: 'Total Sessions', value: fmt(summary?.total_sessions), sub: `${fmt(summary?.total_viewers || 0)} viewers`, color: 'text-indigo-600', bg: 'bg-indigo-50 dark:bg-indigo-900/20', icon: Video },
    { label: 'Total Revenue', value: fmtRp(summary?.total_revenue), sub: `${fmt(summary?.total_orders || 0)} orders`, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20', icon: ShoppingBag },
    { label: 'Engagement Rate', value: `${summary?.avg_engagement_rate || 0}%`, sub: 'Rata-rata', color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20', icon: Heart },
    { label: 'Conversion Rate', value: `${summary?.avg_conversion_rate || 0}%`, sub: 'Rata-rata', color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20', icon: TrendingUp },
  ];
  
  return (
    <div className="min-h-screen bg-background p-4 md:p-6" data-testid="live-dashboard">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Live Session Performance</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Monitor performa live shopping di semua platform</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { fetchSummary(); fetchSessions(); }}>
          <RefreshCw size={13} className="mr-1" /> Refresh
        </Button>
      </div>
      
      <div className="mb-4">
        <ActiveAccountBar accounts={masterAccounts} activeAccount={activeAccount} onAccountChange={setActiveAccount} hint="Context akun live session:" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {kpis.map(k => (
          <div key={k.label} className={`rounded-xl border p-4 ${k.bg}`}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground font-medium">{k.label}</span>
              <k.icon size={15} className={k.color} />
            </div>
            <p className={`text-2xl font-bold tabular-nums ${k.color}`}>{summaryLoading ? '...' : (k.value || '0')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{summaryLoading ? '' : k.sub}</p>
          </div>
        ))}
      </div>
      
      {summary?.top_hosts && summary.top_hosts.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Top Hosts (by Revenue)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              {summary.top_hosts.map((host, i) => (
                <div key={i} className="border rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-primary mb-1">#{i + 1}</div>
                  <p className="font-semibold text-sm mb-1">{host.host}</p>
                  <p className="text-xs text-muted-foreground">{fmt(host.sessions)} sessions</p>
                  <p className="text-sm font-bold text-emerald-600 mt-1">{fmtRp(host.revenue)}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <CardTitle className="flex-1">Live Sessions</CardTitle>
            <Select value={platformFilter || 'all'} onValueChange={v => { setPlatformFilter(v === 'all' ? '' : v); setPage(1); }}>
              <SelectTrigger className="w-[140px] h-9 text-xs">
                <SelectValue placeholder="Platform" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Platform</SelectItem>
                <SelectItem value="shopee">🛒 Shopee</SelectItem>
                <SelectItem value="tiktok">🎵 TikTok</SelectItem>
                <SelectItem value="instagram">📷 Instagram</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="animate-spin text-muted-foreground" size={24} />
            </div>
          ) : sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
              <Play size={32} className="opacity-30 mb-2" />
              <p className="text-sm">Tidak ada live session</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    {['Title', 'Platform', 'Host', 'Date', 'Duration', 'Viewers', 'Engagement', 'Orders', 'Revenue', 'CVR'].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {sessions.map(s => (
                    <tr key={s.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-2 font-medium max-w-[180px] truncate" title={s.title}>{s.title}</td>
                      <td className="px-3 py-2 text-xs">
                        {PLATFORM_ICONS[s.platform]} <span className="capitalize">{s.platform}</span>
                      </td>
                      <td className="px-3 py-2 text-xs">{s.host_name}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {new Date(s.session_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: '2-digit' })}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-xs">{s.duration_minutes} min</td>
                      <td className="px-3 py-2">
                        <div className="text-xs">
                          <div className="font-bold">{fmt(s.peak_viewers)} peak</div>
                          <div className="text-muted-foreground">{fmt(s.total_viewers)} total</div>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-xs space-y-0.5">
                          <div className="flex items-center gap-1"><Heart size={10} />{fmt(s.likes)}</div>
                          <div className="flex items-center gap-1"><MessageCircle size={10} />{fmt(s.comments)}</div>
                          <div className="flex items-center gap-1"><Share2 size={10} />{fmt(s.shares)}</div>
                        </div>
                      </td>
                      <td className="px-3 py-2 tabular-nums font-semibold">{fmt(s.orders)}</td>
                      <td className="px-3 py-2 tabular-nums text-xs text-emerald-600 font-bold">{fmtRp(s.revenue)}</td>
                      <td className="px-3 py-2 tabular-nums font-bold text-primary">{s.conversion_rate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pagination && pagination.total_pages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <span className="text-xs text-muted-foreground">{pagination.total} sessions</span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-7" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Sebelumnya</Button>
                <span className="text-xs">{page} / {pagination.total_pages}</span>
                <Button size="sm" variant="outline" className="h-7" disabled={page >= pagination.total_pages} onClick={() => setPage(p => p + 1)}>Berikutnya</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
