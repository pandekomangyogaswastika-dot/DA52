import { useState, useEffect, useCallback, useMemo } from 'react';
import { GlassCard } from '@/components/ui/glass';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { toast } from 'sonner';
import {
  DollarSign, Activity, AlertTriangle, CheckCircle2, RefreshCw, Loader2,
  TrendingUp, Zap, Clock, Brain, BarChart3, List, Sparkles
} from 'lucide-react';

const HEALTH_COLOR = {
  healthy: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  monitor: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30',
  warning: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
  critical: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30',
};

const HEALTH_LABEL = {
  healthy: 'Sehat',
  monitor: 'Pantau',
  warning: 'Peringatan',
  critical: 'Kritis',
};

function fmtUSD(v) {
  if (v == null) return '$0.0000';
  return `$${Number(v).toFixed(4)}`;
}

function fmtNum(v) {
  if (v == null) return '0';
  return Number(v).toLocaleString('id-ID');
}

export default function AIUsageMonitorModule({ token }) {
  const [activeTab, setActiveTab] = useState('today');
  const [today, setToday] = useState(null);
  const [summary, setSummary] = useState(null);
  const [logs, setLogs] = useState([]);
  const [budgets, setBudgets] = useState(null);
  const [period, setPeriod] = useState(7);
  const [loading, setLoading] = useState(false);
  const [logFilter, setLogFilter] = useState('');

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const BASE = process.env.REACT_APP_BACKEND_URL;

  const fetchToday = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}/api/ai/usage/today`, { headers });
      const data = await r.json();
      setToday(data?.data || null);
    } catch (e) { console.error(e); }
  }, [BASE, headers]);

  const fetchSummary = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}/api/ai/usage/summary?days=${period}`, { headers });
      const data = await r.json();
      setSummary(data?.data || null);
    } catch (e) { console.error(e); }
  }, [BASE, headers, period]);

  const fetchLogs = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ limit: '100' });
      if (logFilter) qs.append('feature', logFilter);
      const r = await fetch(`${BASE}/api/ai/usage/logs?${qs}`, { headers });
      const data = await r.json();
      setLogs(data?.data || []);
    } catch (e) { console.error(e); }
  }, [BASE, headers, logFilter]);

  const fetchBudgets = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}/api/ai/usage/budgets`, { headers });
      const data = await r.json();
      setBudgets(data?.data || null);
    } catch (e) { console.error(e); }
  }, [BASE, headers]);

  const refreshAll = useCallback(() => {
    setLoading(true);
    Promise.all([fetchToday(), fetchSummary(), fetchLogs(), fetchBudgets()])
      .finally(() => setLoading(false));
  }, [fetchToday, fetchSummary, fetchLogs, fetchBudgets]);

  useEffect(() => { refreshAll(); }, [refreshAll]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Brain className="w-6 h-6 text-violet-500" /> AI Usage Monitor
          </h1>
          <p className="text-sm text-muted-foreground">
            Monitor cost & usage Emergent LLM per fitur. Real-time budget alert & cost analytics.
          </p>
        </div>
        <Button onClick={refreshAll} disabled={loading} size="sm" data-testid="ai-usage-refresh">
          {loading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />} Refresh
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-3 w-full md:w-[480px]">
          <TabsTrigger value="today" data-testid="ai-usage-tab-today"><Zap className="w-4 h-4 mr-1.5" /> Hari Ini</TabsTrigger>
          <TabsTrigger value="summary" data-testid="ai-usage-tab-summary"><BarChart3 className="w-4 h-4 mr-1.5" /> Summary</TabsTrigger>
          <TabsTrigger value="logs" data-testid="ai-usage-tab-logs"><List className="w-4 h-4 mr-1.5" /> Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="today" className="mt-4 space-y-4">
          {!today ? (
            <GlassCard className="p-6 text-center text-sm text-muted-foreground"><Loader2 className="w-4 h-4 inline animate-spin mr-2" /> Memuat...</GlassCard>
          ) : (
            <>
              <GlassCard className={`p-6 border ${HEALTH_COLOR[today.health]}`}>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-base font-semibold flex items-center gap-2">
                      <Activity className="w-4 h-4" /> Status Hari Ini ({today.date})
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {today.total_calls} calls · {fmtNum(today.total_tokens)} tokens · {fmtUSD(today.total_cost_usd)}
                    </p>
                  </div>
                  <Badge className={HEALTH_COLOR[today.health]} variant="outline">
                    {HEALTH_LABEL[today.health] || today.health}
                  </Badge>
                </div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span>Budget Harian: {fmtUSD(today.daily_budget_usd)}</span>
                  <span className="font-semibold">{today.budget_used_pct}% terpakai</span>
                </div>
                <Progress value={Math.min(today.budget_used_pct, 100)} className="h-2" />
                {today.health === 'critical' && (
                  <div className="mt-3 p-2 rounded bg-red-500/10 border border-red-500/30 text-xs text-red-600 dark:text-red-400 flex items-start gap-1.5">
                    <AlertTriangle className="w-4 h-4 mt-0.5" />
                    <span>Budget harian terlampaui. Fitur AI akan fallback ke heuristic mode. Set env var <code>LLM_DAILY_BUDGET_USD</code> untuk naikkan limit.</span>
                  </div>
                )}
              </GlassCard>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="Total Calls" value={fmtNum(today.total_calls)} icon={Activity} color="blue" />
                <StatCard label="Success" value={fmtNum(today.successful_calls)} icon={CheckCircle2} color="emerald" />
                <StatCard label="Failed" value={fmtNum(today.failed_calls)} icon={AlertTriangle} color="amber" />
                <StatCard label="Tokens" value={fmtNum(today.total_tokens)} icon={Zap} color="indigo" />
              </div>

              {today.top_features?.length > 0 ? (
                <GlassCard className="p-6">
                  <h3 className="text-base font-semibold mb-3 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-violet-500" /> Top Features (Hari Ini)</h3>
                  <div className="space-y-2">
                    {today.top_features.map((f, i) => {
                      const pct = today.total_cost_usd > 0 ? (f.cost_usd / today.total_cost_usd * 100) : 0;
                      return (
                        <div key={i} className="p-3 rounded-lg bg-[var(--glass)] border border-[var(--glass-border)]">
                          <div className="flex items-center justify-between mb-1">
                            <div>
                              <span className="font-medium text-sm">{f.feature}</span>
                              <span className="text-xs text-muted-foreground ml-2">{f.calls} call{f.calls > 1 ? 's' : ''}</span>
                            </div>
                            <span className="text-sm font-semibold text-violet-600 dark:text-violet-400">{fmtUSD(f.cost_usd)}</span>
                          </div>
                          <Progress value={pct} className="h-1" />
                        </div>
                      );
                    })}
                  </div>
                </GlassCard>
              ) : (
                <GlassCard className="p-8 text-center text-sm text-muted-foreground">
                  <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  Belum ada AI call hari ini. Gunakan fitur AI (Daily Summary, AI Quote, dll) untuk melihat statistik.
                </GlassCard>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="summary" className="mt-4 space-y-4">
          <GlassCard className="p-4 flex items-center gap-3">
            <span className="text-sm font-medium">Periode:</span>
            <Select value={String(period)} onValueChange={(v) => setPeriod(Number(v))}>
              <SelectTrigger className="w-32" data-testid="ai-usage-period"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 hari</SelectItem>
                <SelectItem value="7">7 hari</SelectItem>
                <SelectItem value="14">14 hari</SelectItem>
                <SelectItem value="30">30 hari</SelectItem>
                <SelectItem value="90">90 hari</SelectItem>
              </SelectContent>
            </Select>
            {budgets && (
              <div className="ml-auto flex gap-2 text-xs text-muted-foreground">
                <span>Daily: {fmtUSD(budgets.daily_usd)}</span>
                <span>·</span>
                <span>Monthly: {fmtUSD(budgets.monthly_usd)}</span>
              </div>
            )}
          </GlassCard>

          {!summary ? (
            <GlassCard className="p-6 text-center text-sm text-muted-foreground"><Loader2 className="w-4 h-4 inline animate-spin mr-2" /> Memuat...</GlassCard>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <StatCard label="Total Cost" value={fmtUSD(summary.overall.total_cost_usd)} icon={DollarSign} color="emerald" />
                <StatCard label="Total Calls" value={fmtNum(summary.overall.total_calls)} icon={Activity} color="blue" />
                <StatCard label="Success" value={fmtNum(summary.overall.successful_calls)} icon={CheckCircle2} color="emerald" small />
                <StatCard label="Failed" value={fmtNum(summary.overall.failed_calls)} icon={AlertTriangle} color="amber" small />
                <StatCard label="Avg Latency" value={`${fmtNum(summary.overall.avg_latency_ms)}ms`} icon={Clock} color="indigo" small />
              </div>

              {summary.by_feature?.length > 0 && (
                <GlassCard className="p-6">
                  <h3 className="text-base font-semibold mb-3 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-violet-500" /> Cost per Feature</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs text-muted-foreground border-b border-[var(--glass-border)]">
                        <tr>
                          <th className="text-left py-2 px-2">Feature</th>
                          <th className="text-right py-2 px-2">Calls</th>
                          <th className="text-right py-2 px-2">Success</th>
                          <th className="text-right py-2 px-2">Failed</th>
                          <th className="text-right py-2 px-2">Tokens</th>
                          <th className="text-right py-2 px-2">Avg Latency</th>
                          <th className="text-right py-2 px-2">Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.by_feature.map((f, i) => (
                          <tr key={i} className="border-b border-[var(--glass-border)] hover:bg-[var(--glass)]">
                            <td className="py-2 px-2 font-medium">{f.feature}</td>
                            <td className="py-2 px-2 text-right">{fmtNum(f.calls)}</td>
                            <td className="py-2 px-2 text-right text-emerald-500">{fmtNum(f.successful)}</td>
                            <td className="py-2 px-2 text-right text-red-500">{fmtNum(f.failed)}</td>
                            <td className="py-2 px-2 text-right text-muted-foreground">{fmtNum(f.tokens)}</td>
                            <td className="py-2 px-2 text-right text-muted-foreground">{fmtNum(f.avg_latency_ms)}ms</td>
                            <td className="py-2 px-2 text-right font-semibold text-violet-600 dark:text-violet-400">{fmtUSD(f.cost_usd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </GlassCard>
              )}

              {summary.by_day?.length > 0 && (
                <GlassCard className="p-6">
                  <h3 className="text-base font-semibold mb-3 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-indigo-500" /> Daily Cost Trend</h3>
                  <div className="space-y-1.5">
                    {summary.by_day.map((d, i) => {
                      const maxCost = Math.max(...summary.by_day.map((x) => x.cost_usd), 0.0001);
                      const pct = (d.cost_usd / maxCost) * 100;
                      return (
                        <div key={i} className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground w-24 shrink-0">{d.date}</span>
                          <div className="flex-1 h-5 bg-[var(--glass)] rounded relative">
                            <div className="h-full rounded bg-gradient-to-r from-violet-500 to-indigo-500" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs font-medium w-20 text-right">{fmtUSD(d.cost_usd)}</span>
                          <span className="text-xs text-muted-foreground w-12 text-right">{d.calls}c</span>
                        </div>
                      );
                    })}
                  </div>
                </GlassCard>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="logs" className="mt-4">
          <GlassCard className="p-4 mb-3 flex items-center gap-3">
            <span className="text-sm font-medium">Filter Feature:</span>
            <Select value={logFilter || '__all__'} onValueChange={(v) => setLogFilter(v === '__all__' ? '' : v)}>
              <SelectTrigger className="w-64" data-testid="ai-usage-log-filter"><SelectValue placeholder="Semua feature" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Semua feature</SelectItem>
                {Array.from(new Set(logs.map((l) => l.feature).concat(summary?.by_feature?.map((f) => f.feature) || []))).filter(Boolean).map((f) => (
                  <SelectItem key={f} value={f}>{f}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={fetchLogs}><RefreshCw className="w-3.5 h-3.5 mr-1" /> Refresh</Button>
            <span className="ml-auto text-xs text-muted-foreground">{logs.length} log entries</span>
          </GlassCard>

          {logs.length === 0 ? (
            <GlassCard className="p-10 text-center text-sm text-muted-foreground">Belum ada log</GlassCard>
          ) : (
            <GlassCard className="p-3">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground border-b border-[var(--glass-border)]">
                    <tr>
                      <th className="text-left py-2 px-2">Waktu</th>
                      <th className="text-left py-2 px-2">Feature</th>
                      <th className="text-left py-2 px-2">Model</th>
                      <th className="text-right py-2 px-2">Tokens</th>
                      <th className="text-right py-2 px-2">Latency</th>
                      <th className="text-right py-2 px-2">Cost</th>
                      <th className="text-center py-2 px-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((l) => (
                      <tr key={l.id} className="border-b border-[var(--glass-border)] hover:bg-[var(--glass)]">
                        <td className="py-1.5 px-2 text-muted-foreground">{l.created_at ? new Date(l.created_at).toLocaleString('id-ID') : '—'}</td>
                        <td className="py-1.5 px-2 font-medium">{l.feature}</td>
                        <td className="py-1.5 px-2 text-muted-foreground">{l.model_provider}/{l.model_name}</td>
                        <td className="py-1.5 px-2 text-right">{fmtNum(l.tokens_total)}</td>
                        <td className="py-1.5 px-2 text-right">{fmtNum(l.latency_ms)}ms</td>
                        <td className="py-1.5 px-2 text-right font-medium">{fmtUSD(l.cost_usd)}</td>
                        <td className="py-1.5 px-2 text-center">
                          {l.success ? (
                            <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30" variant="outline">OK</Badge>
                          ) : (
                            <Badge className="bg-red-500/15 text-red-600 border-red-500/30" variant="outline" title={l.error || ''}>FAIL</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </GlassCard>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color, small = false }) {
  const map = {
    blue: 'from-blue-500/10 to-cyan-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400',
    emerald: 'from-emerald-500/10 to-teal-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400',
    amber: 'from-amber-500/10 to-orange-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400',
    red: 'from-red-500/10 to-rose-500/10 border-red-500/20 text-red-600 dark:text-red-400',
    indigo: 'from-indigo-500/10 to-violet-500/10 border-indigo-500/20 text-indigo-600 dark:text-indigo-400',
  };
  return (
    <div className={`p-3 rounded-xl bg-gradient-to-br border ${map[color] || map.blue}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        {Icon && <Icon className="w-4 h-4 opacity-70" />}
      </div>
      <div className={`font-bold text-foreground ${small ? 'text-base' : 'text-2xl'}`}>{value}</div>
    </div>
  );
}
