/**
 * DailyReportModule — Laporan Harian PIC Portal Marketing
 * Ringkasan status operasional harian: sales input, task, health alert.
 * Termasuk shortcut "Eksekusi" inline untuk akun yang belum input sales.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  CalendarCheck, RefreshCw, CheckCircle2, XCircle, AlertTriangle,
  ChevronLeft, ChevronRight, Zap, Loader2, TrendingUp, ClipboardList,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { GlassCard, GlassPanel } from '@/components/ui/glass';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AccountBadge } from './AccountBadge';
import { toast } from 'sonner';

const API = process.env.REACT_APP_BACKEND_URL;
const fmtRp = (n) => `Rp ${new Intl.NumberFormat('id-ID').format(Math.round(n || 0))}`;
const fmtNum = (n) => new Intl.NumberFormat('id-ID').format(n || 0);

// ─── Quick Sales Dialog ────────────────────────────────────────────────────────
function QuickSalesDialog({ open, onClose, account, task, date, token, onSuccess }) {
  const [form, setForm] = useState({ revenue: '', orders: '' });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    const revenue = parseFloat(form.revenue);
    const orders  = parseInt(form.orders);
    if (!revenue || revenue <= 0) { toast.error('Revenue wajib diisi'); return; }
    setSaving(true);
    try {
      const res = await fetch(`${API}/api/marketing/tasks/${task.id}/complete-action`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action_data: { revenue, orders: orders || 0, date },
          completion_notes: `Input via Laporan Harian — ${date}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Gagal eksekusi');
      toast.success(`Sales ${account.account_name} berhasil diinput`);
      onSuccess();
      onClose();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-sm" data-testid="quick-sales-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Zap size={15} className="text-blue-500" /> Input Sales Cepat
          </DialogTitle>
          <div className="mt-1">
            <AccountBadge account={account} size="sm" />
            <p className="text-xs text-muted-foreground mt-1">Tanggal: {date}</p>
          </div>
        </DialogHeader>
        <div className="space-y-3 mt-1">
          <div>
            <Label className="text-xs">Revenue (Rp) <span className="text-red-400">*</span></Label>
            <Input
              type="number" min={0} step={1000}
              value={form.revenue}
              onChange={e => setForm(f => ({ ...f, revenue: e.target.value }))}
              placeholder="Contoh: 4500000"
              className="mt-1 h-9"
              data-testid="quick-revenue-input"
              autoFocus
            />
          </div>
          <div>
            <Label className="text-xs">Orders</Label>
            <Input
              type="number" min={0}
              value={form.orders}
              onChange={e => setForm(f => ({ ...f, orders: e.target.value }))}
              placeholder="Contoh: 42"
              className="mt-1 h-9"
              data-testid="quick-orders-input"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Batal</Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-700"
            data-testid="quick-submit-btn"
          >
            {saving ? <Loader2 size={13} className="mr-1 animate-spin" /> : <Zap size={13} className="mr-1" />}
            Simpan & Selesaikan Task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, icon: Icon, color = 'text-primary', highlight = false }) {
  return (
    <GlassPanel className={`p-4 ${highlight ? 'border-red-500/30 bg-red-500/5' : ''}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        {Icon && <Icon size={14} className={color} />}
      </div>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </GlassPanel>
  );
}

export default function DailyReportModule({ token }) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yestStr = yesterday.toISOString().slice(0, 10);

  const [date, setDate]         = useState(yestStr);
  const [report, setReport]     = useState(null);
  const [loading, setLoading]   = useState(true);
  const [eksekusiTarget, setEksekusiTarget] = useState(null); // { account, task }

  const authH = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/marketing/reports/daily?date=${date}`, { headers: authH });
      if (!res.ok) throw new Error('Gagal memuat laporan');
      setReport(await res.json());
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [date, token]); // eslint-disable-line

  useEffect(() => { load(); }, [load]);

  const prevDay = () => { const d = new Date(date); d.setDate(d.getDate() - 1); setDate(d.toISOString().slice(0, 10)); };
  const nextDay = () => { const d = new Date(date); d.setDate(d.getDate() + 1); setDate(d.toISOString().slice(0, 10)); };

  const s = report?.summary || {};
  const accounts = report?.accounts || [];
  const criticals = accounts.filter(a => a.health_score != null && a.health_score < 60);
  const allPendingTasks = accounts.flatMap(a =>
    (a.pending_action_tasks || []).map(t => ({ ...t, _account: a }))
  );

  return (
    <div className="space-y-5 p-4 lg:p-6" data-testid="daily-report-module">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarCheck size={22} className="text-primary" /> Laporan Harian
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Ringkasan operasional untuk PIC Portal Marketing
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={prevDay}><ChevronLeft size={14} /></Button>
          <input
            type="date" value={date} onChange={e => setDate(e.target.value)}
            className="h-9 text-sm border rounded-md px-3 bg-background"
            data-testid="daily-date-picker"
          />
          <Button variant="outline" size="sm" onClick={nextDay}><ChevronRight size={14} /></Button>
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 size={28} className="animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          {/* KPI Strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <KpiCard label="Sales Input Rate" value={`${s.sales_input_rate || 0}%`}
              sub={`${s.accounts_sales_entered}/${s.accounts_total} akun`}
              icon={TrendingUp} color={s.sales_input_rate >= 80 ? 'text-emerald-600' : 'text-amber-600'} />
            <KpiCard label="Akun Sudah Input" value={s.accounts_sales_entered || 0}
              icon={CheckCircle2} color="text-emerald-600" />
            <KpiCard label="Akun Belum Input" value={s.accounts_sales_missing || 0}
              icon={XCircle} color={s.accounts_sales_missing > 0 ? 'text-red-600' : 'text-muted-foreground'}
              highlight={s.accounts_sales_missing > 0} />
            <KpiCard label="Task Selesai Hari Ini" value={s.tasks_done_today || 0}
              icon={ClipboardList} color="text-blue-600" />
            <KpiCard label="Task Overdue" value={s.tasks_overdue || 0}
              icon={AlertTriangle} color={s.tasks_overdue > 0 ? 'text-red-600' : 'text-muted-foreground'}
              highlight={s.tasks_overdue > 0} />
            <KpiCard label="Menunggu Approval" value={s.tasks_pending_approval || 0}
              icon={ClipboardList} color="text-amber-600" />
          </div>

          {/* Health Alerts */}
          {criticals.length > 0 && (
            <Card className="border-red-500/30 bg-red-500/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-red-600">
                  <AlertTriangle size={14} /> Health Alert — {criticals.length} akun kritis
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2 pt-0">
                {criticals.map(a => (
                  <div key={a.account_id} className="flex items-center gap-1.5 text-xs">
                    <AccountBadge account={a} size="xs" />
                    <span className="text-red-600 font-bold">{a.health_score}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Status Input Sales per Akun */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                Status Input Sales — {date}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {accounts.map(acc => {
                  const entered = acc.sales_status.entered_total;
                  // Cari task input sales yang pending
                  const salesTask = (acc.pending_action_tasks || []).find(
                    t => t.action_type === 'submit_form' ||
                         t.action_type === 'input_sales' ||
                         t.related_entity === 'sales_data'
                  );
                  return (
                    <div key={acc.account_id} className="flex items-center gap-3 px-4 py-3"
                      data-testid={`daily-acc-${acc.account_code}`}>
                      <AccountBadge account={acc} size="sm" />
                      <div className="flex-1 min-w-0">
                        {entered ? (
                          <div className="flex items-center gap-2">
                            <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                            <span className="text-sm text-emerald-700 dark:text-emerald-400 font-medium">
                              {fmtRp(acc.sales_status.revenue)} · {fmtNum(acc.sales_status.orders)} orders
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <XCircle size={14} className="text-red-400 shrink-0" />
                            <span className="text-sm text-red-500">Belum diinput</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {/* Tombol Eksekusi cepat — muncul jika belum input dan ada task pending */}
                        {!entered && salesTask && (
                          <Button
                            size="sm"
                            className="h-7 text-xs bg-blue-600 hover:bg-blue-700"
                            onClick={() => setEksekusiTarget({ account: acc, task: salesTask })}
                            data-testid={`eksekusi-btn-${acc.account_code}`}
                          >
                            <Zap size={11} className="mr-1" /> Eksekusi
                          </Button>
                        )}
                        {acc.overdue_count > 0 && (
                          <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-500 border-red-500/30">
                            {acc.overdue_count} overdue
                          </Badge>
                        )}
                        {(acc.pending_action_tasks || []).length > 0 && (
                          <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-500 border-blue-500/30">
                            <Zap size={9} className="mr-0.5" />
                            {acc.pending_action_tasks.length} pending action
                          </Badge>
                        )}
                        {acc.health_score != null && (
                          <span className={`text-xs font-bold ${acc.health_score >= 80 ? 'text-emerald-600' : acc.health_score >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                            {acc.health_score}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Pending Action Tasks */}
          {allPendingTasks.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Zap size={14} className="text-blue-500" />
                  Task Menunggu Aksi ({allPendingTasks.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {allPendingTasks.map(t => (
                    <div key={t.id} className="flex items-center gap-3 px-4 py-2.5"
                      data-testid={`pending-task-${t.task_code}`}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{t.title}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs font-mono text-muted-foreground">{t.task_code}</span>
                          <AccountBadge account={t._account} size="xs" />
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="outline" className={`text-[10px] ${
                          t.priority === 'high' ? 'bg-red-500/10 text-red-500 border-red-500/30' :
                          t.priority === 'medium' ? 'bg-amber-500/10 text-amber-500 border-amber-500/30' :
                          'bg-gray-500/10 text-gray-500'
                        }`}>{t.priority}</Badge>
                        <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-500 border-blue-500/30">
                          <Zap size={9} className="mr-0.5" />{t.action_type}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Quick Sales Eksekusi Dialog */}
      {eksekusiTarget && (
        <QuickSalesDialog
          open={!!eksekusiTarget}
          onClose={() => setEksekusiTarget(null)}
          account={eksekusiTarget.account}
          task={eksekusiTarget.task}
          date={date}
          token={token}
          onSuccess={() => { setEksekusiTarget(null); load(); }}
        />
      )}
    </div>
  );
}
