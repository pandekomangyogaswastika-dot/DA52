import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Hammer, RefreshCw, AlertTriangle, Clock, TrendingUp,
  Factory, Package, ShieldAlert, Settings2, CheckCircle2, Timer,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { GlassCard, GlassPanel } from '@/components/ui/glass';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

/* ─── ReworkAnalyticsModule — Phase 20B ─────────────────────────────────
   Closed-loop rework enforcement analytics:
   - Open rework KPIs (count, SLA breach, total fail pcs)
   - Fail rate + avg cycle time
   - Top offenders by line & model
   - Manual close dialog with writeoff qty + reason
   - SLA settings editor
──────────────────────────────────────────────────────────────────────── */

const toISO = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const fmtPct = (v) => v == null ? '—' : `${Number(v).toFixed(1)}%`;
const fmtMin = (v) => v == null ? '—' : v < 60 ? `${v} m` : `${Math.floor(v/60)}j ${Math.round(v%60)}m`;

function KpiTile({ icon: Icon, label, value, sub, accent = 'sky', testId }) {
  const accentMap = {
    sky:     'text-sky-300 bg-sky-400/15 border-sky-400/25',
    emerald: 'text-emerald-300 bg-emerald-400/15 border-emerald-400/25',
    amber:   'text-amber-300 bg-amber-400/15 border-amber-400/25',
    red:     'text-red-300 bg-red-400/15 border-red-400/25',
    muted:   'text-muted-foreground bg-foreground/5 border-foreground/15',
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
          {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
        </div>
      </div>
    </GlassCard>
  );
}

export default function ReworkAnalyticsModule({ token }) {
  const today = useMemo(() => { const t = new Date(); t.setHours(0,0,0,0); return t; }, []);
  const [fromDate, setFromDate] = useState(() => toISO(addDays(today, -6)));
  const [toDate, setToDate] = useState(() => toISO(today));

  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [openItems, setOpenItems] = useState([]);
  const [openMeta, setOpenMeta] = useState({ total_open: 0, breach_count: 0, sla_minutes: 120 });
  const [settings, setSettings] = useState({ sla_minutes: 120, enabled: true });

  // Dialogs
  const [closeOpen, setCloseOpen] = useState(false);
  const [activeBundle, setActiveBundle] = useState(null);
  const [closeReason, setCloseReason] = useState('');
  const [closeNotes, setCloseNotes] = useState('');
  const [closeWriteoff, setCloseWriteoff] = useState(0);
  const [closing, setClosing] = useState(false);

  const [slaOpen, setSlaOpen] = useState(false);
  const [slaDraft, setSlaDraft] = useState(120);
  const [slaSaving, setSlaSaving] = useState(false);

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }), [token]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, o, st] = await Promise.all([
        fetch(`/api/rahaza/rework/summary?from=${fromDate}&to=${toDate}`, { headers }).then(r => r.json()),
        fetch(`/api/rahaza/rework/open`, { headers }).then(r => r.json()),
        fetch(`/api/rahaza/rework/settings`, { headers }).then(r => r.json()),
      ]);
      if (s && !s.detail) setSummary(s);
      if (o && !o.detail) {
        setOpenItems(o.items || []);
        setOpenMeta({ total_open: o.total_open || 0, breach_count: o.breach_count || 0, sla_minutes: o.sla_minutes || 120 });
      }
      if (st && !st.detail) {
        setSettings(st);
        setSlaDraft(st.sla_minutes || 120);
      }
    } catch (e) {
      toast.error(`Gagal memuat: ${e.message}`);
    } finally { setLoading(false); }
  }, [headers, fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  const openCloseDialog = (b) => {
    setActiveBundle(b);
    setCloseReason('');
    setCloseNotes('');
    setCloseWriteoff(0);
    setCloseOpen(true);
  };

  const submitClose = async () => {
    if (!activeBundle) return;
    if (!closeReason.trim()) { toast.error('Alasan wajib diisi'); return; }
    setClosing(true);
    try {
      const r = await fetch(`/api/rahaza/rework/bundle/${activeBundle.bundle_id}/close-manual`, {
        method: 'POST', headers,
        body: JSON.stringify({ reason: closeReason, notes: closeNotes, writeoff_qty: Number(closeWriteoff) || 0 }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      toast.success(`Rework ditutup: ${j.writeoff_qty} pcs writeoff`);
      setCloseOpen(false);
      load();
    } catch (e) {
      toast.error(`Gagal: ${e.message}`);
    } finally { setClosing(false); }
  };

  const saveSla = async () => {
    setSlaSaving(true);
    try {
      const r = await fetch(`/api/rahaza/rework/settings`, {
        method: 'PUT', headers,
        body: JSON.stringify({ sla_minutes: Number(slaDraft) }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      toast.success('SLA tersimpan');
      setSettings(j);
      setSlaOpen(false);
      load();
    } catch (e) {
      toast.error(`Gagal: ${e.message}`);
    } finally { setSlaSaving(false); }
  };

  const kpis = summary?.kpis || {};
  const topLines = summary?.top_offenders?.by_line || [];
  const topModels = summary?.top_offenders?.by_model || [];

  return (
    <div className="space-y-4" data-testid="rework-analytics-page">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-1">
        <div>
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-amber-300" />
            <h1 className="text-2xl font-bold text-foreground">Rework Analytics & Enforcement</h1>
            <Badge variant="outline" className="text-[10px] tracking-wide">Phase 20B</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            SLA rework, KPI fail-rate, cycle time, & top offenders. WO tidak bisa diselesaikan jika masih ada bundle rework.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
            className="bg-[var(--card-surface)] border border-[var(--glass-border)] rounded-md px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-sky-400/40"
            data-testid="rework-from-input"
          />
          <span className="text-xs text-muted-foreground">→</span>
          <input
            type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
            className="bg-[var(--card-surface)] border border-[var(--glass-border)] rounded-md px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-sky-400/40"
            data-testid="rework-to-input"
          />
          <Button variant="outline" size="sm" onClick={() => setSlaOpen(true)} data-testid="rework-sla-settings-button">
            <Settings2 className="w-4 h-4 mr-1" /> SLA
          </Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} data-testid="rework-refresh-button">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="ml-1.5">Muat Ulang</span>
          </Button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiTile icon={Hammer} label="Open Rework"
          value={openMeta.total_open}
          sub={`SLA ${openMeta.sla_minutes}m`}
          accent={openMeta.total_open > 0 ? 'amber' : 'emerald'}
          testId="rework-kpi-open"
        />
        <KpiTile icon={AlertTriangle} label="SLA Breach"
          value={openMeta.breach_count}
          sub="bundle melewati SLA"
          accent={openMeta.breach_count > 0 ? 'red' : 'emerald'}
          testId="rework-kpi-breach"
        />
        <KpiTile icon={TrendingUp} label="Fail Rate"
          value={fmtPct(kpis.fail_rate_pct)}
          sub={`${kpis.qc_fail ?? 0} fail / ${(kpis.qc_pass ?? 0) + (kpis.qc_fail ?? 0)} inspect`}
          accent={(kpis.fail_rate_pct ?? 0) > 15 ? 'red' : (kpis.fail_rate_pct ?? 0) > 8 ? 'amber' : 'emerald'}
          testId="rework-kpi-fail-rate"
        />
        <KpiTile icon={Timer} label="Avg Cycle"
          value={fmtMin(kpis.avg_cycle_minutes)}
          sub={`n=${kpis.cycle_sample_size ?? 0}`}
          accent="sky"
          testId="rework-kpi-cycle"
        />
        <KpiTile icon={Package} label="Fail Pcs (open)"
          value={openMeta.total_open > 0 ? (kpis.open_total_fail_pcs ?? 0) : 0}
          sub="pcs menunggu rework"
          accent={(kpis.open_total_fail_pcs ?? 0) > 0 ? 'amber' : 'emerald'}
          testId="rework-kpi-fail-pcs"
        />
      </div>

      {/* Open list */}
      <GlassPanel className="p-0 overflow-hidden" data-testid="rework-open-panel">
        <div className="p-3 border-b border-[var(--glass-border)] flex items-center gap-2">
          <Hammer className="w-4 h-4 text-amber-300" />
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Rework Terbuka ({openItems.length}) · sort: umur terlama
          </span>
        </div>
        {loading && openItems.length === 0 ? (
          <div className="p-4 space-y-2">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-md" />)}
          </div>
        ) : openItems.length === 0 ? (
          <div className="p-8 text-center">
            <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-300 mb-2" />
            <div className="text-sm text-muted-foreground">Tidak ada rework aktif. Selamat!</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-foreground/5 text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">Bundle</th>
                  <th className="text-left px-3 py-2">WO</th>
                  <th className="text-left px-3 py-2">Proses</th>
                  <th className="text-left px-3 py-2">Fail / Sisa</th>
                  <th className="text-left px-3 py-2">Umur</th>
                  <th className="text-left px-3 py-2">SLA</th>
                  <th className="text-left px-3 py-2">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {openItems.map((b) => (
                  <tr
                    key={b.bundle_id}
                    className={`border-t border-[var(--glass-border)]/50 hover:bg-foreground/5 ${b.is_breach ? 'bg-red-500/5' : ''}`}
                    data-testid={`rework-open-row-${b.bundle_id}`}
                  >
                    <td className="px-3 py-2 font-mono font-semibold">{b.bundle_number || b.bundle_id?.slice(0,8)}</td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">{b.work_order_number || '—'}</td>
                    <td className="px-3 py-2 font-mono text-foreground/80">{b.current_process_code || '—'}</td>
                    <td className="px-3 py-2 font-mono">
                      <span className="text-red-300">{b.qty_fail}</span>
                      <span className="text-muted-foreground mx-0.5">/</span>
                      <span>{b.qty_remaining}</span>
                    </td>
                    <td className={`px-3 py-2 font-mono ${b.is_breach ? 'text-red-300 font-semibold' : 'text-foreground/80'}`}>
                      {fmtMin(b.age_minutes)}
                    </td>
                    <td className="px-3 py-2">
                      {b.is_breach ? (
                        <Badge variant="outline" className="text-[9px] bg-red-500/15 text-red-300 border-red-400/25">Breach</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[9px] bg-emerald-500/15 text-emerald-300 border-emerald-400/25">OK</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]"
                        onClick={() => openCloseDialog(b)}
                        data-testid={`rework-close-manual-button-${b.bundle_id}`}
                      >
                        Close Manual
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassPanel>

      {/* Top offenders */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <GlassPanel className="p-3" data-testid="rework-top-lines-panel">
          <div className="flex items-center gap-2 mb-2">
            <Factory className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Top Line (fail pcs)
            </span>
          </div>
          {topLines.length === 0 ? (
            <div className="text-xs text-muted-foreground py-4 text-center">—</div>
          ) : (
            <div className="space-y-1">
              {topLines.map((r) => (
                <div key={r.line_id} className="flex items-center justify-between text-xs" data-testid={`rework-top-line-${r.line_id}`}>
                  <span className="font-mono">{r.line_code || '—'}</span>
                  <span className="font-mono font-semibold text-red-300">{r.fail_pcs}</span>
                </div>
              ))}
            </div>
          )}
        </GlassPanel>
        <GlassPanel className="p-3" data-testid="rework-top-models-panel">
          <div className="flex items-center gap-2 mb-2">
            <Package className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Top Model (fail pcs)
            </span>
          </div>
          {topModels.length === 0 ? (
            <div className="text-xs text-muted-foreground py-4 text-center">—</div>
          ) : (
            <div className="space-y-1">
              {topModels.map((r) => (
                <div key={r.model_id} className="flex items-center justify-between text-xs" data-testid={`rework-top-model-${r.model_id}`}>
                  <span className="font-mono truncate pr-2">{r.model_code || '—'}</span>
                  <span className="font-mono font-semibold text-red-300">{r.fail_pcs}</span>
                </div>
              ))}
            </div>
          )}
        </GlassPanel>
      </div>

      {/* Manual close dialog */}
      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent
          className="sm:max-w-md bg-[var(--card-surface)]/95 backdrop-blur-[var(--glass-blur)] border border-[var(--glass-border)]"
          data-testid="rework-close-dialog"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-300" />
              Close Rework Manual
            </DialogTitle>
            <DialogDescription>
              {activeBundle?.bundle_number} — tulis off pcs yang tidak bisa di-rework dengan alasan.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                Alasan <span className="text-red-300">*</span>
              </label>
              <input
                type="text" value={closeReason}
                onChange={(e) => setCloseReason(e.target.value)}
                placeholder="Contoh: Material cacat permanen"
                className="mt-1 w-full bg-[var(--card-surface)] border border-[var(--glass-border)] rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400/40"
                data-testid="rework-close-reason-input"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                Qty Write-Off
              </label>
              <input
                type="number" min="0" max={activeBundle?.qty_fail || 0}
                value={closeWriteoff}
                onChange={(e) => setCloseWriteoff(e.target.value)}
                className="mt-1 w-full bg-[var(--card-surface)] border border-[var(--glass-border)] rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-400/40"
                data-testid="rework-close-writeoff-input"
              />
              <div className="text-[10px] text-muted-foreground mt-0.5">
                Max {activeBundle?.qty_fail || 0} pcs. Jika = total fail, bundle diadvance ke proses berikutnya.
              </div>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                Catatan
              </label>
              <textarea
                value={closeNotes}
                onChange={(e) => setCloseNotes(e.target.value)}
                rows={2}
                className="mt-1 w-full bg-[var(--card-surface)] border border-[var(--glass-border)] rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400/40"
                data-testid="rework-close-notes-input"
              />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setCloseOpen(false)} disabled={closing}>Batal</Button>
            <Button onClick={submitClose} disabled={closing || !closeReason.trim()} data-testid="rework-close-confirm-button">
              {closing ? <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1.5" />}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* SLA settings dialog */}
      <Dialog open={slaOpen} onOpenChange={setSlaOpen}>
        <DialogContent className="sm:max-w-sm" data-testid="rework-sla-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="w-4 h-4" /> SLA Rework
            </DialogTitle>
            <DialogDescription>
              Bundle yang masih reworking melewati batas ini akan ditandai <b>Breach</b>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                Menit
              </label>
              <input
                type="number" min="5" max="1440" value={slaDraft}
                onChange={(e) => setSlaDraft(e.target.value)}
                className="mt-1 w-full bg-[var(--card-surface)] border border-[var(--glass-border)] rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-400/40"
                data-testid="rework-sla-minutes-input"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSlaOpen(false)} disabled={slaSaving}>Batal</Button>
            <Button onClick={saveSla} disabled={slaSaving} data-testid="rework-sla-save-button">
              {slaSaving ? <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1.5" />}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
