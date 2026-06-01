import { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp, RefreshCw, CheckCircle2, Undo2, AlertTriangle,
  Sparkles, Layers, Clock, Package, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { GlassPanel } from '@/components/ui/glass';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';

/* ─── APSAutoScheduleDialog — Phase 19B ──────────────────────────────────
   Preview → Commit → Rollback flow for auto-scheduling.

   Props:
     open: boolean
     onOpenChange(boolean)
     token: bearer token
     defaultFrom / defaultTo: ISO date strings
     onCommitted(): callback after successful commit (to refresh gantt)
     onRolledBack(): callback after rollback
──────────────────────────────────────────────────────────────────────── */

const PRIORITY_CHIP = {
  urgent: 'bg-red-500/15 text-red-300 border-red-400/25',
  high:   'bg-amber-500/15 text-amber-300 border-amber-400/25',
  normal: 'bg-foreground/10 text-muted-foreground border-foreground/15',
};

export default function APSAutoScheduleDialog({
  open, onOpenChange, token,
  defaultFrom, defaultTo,
  onCommitted, onRolledBack,
}) {
  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(defaultTo);
  const [includeInProduction, setIncludeInProduction] = useState(false);

  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [run, setRun] = useState(null);
  const [runs, setRuns] = useState([]);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  useEffect(() => {
    if (open) {
      setFromDate(defaultFrom);
      setToDate(defaultTo);
      setRun(null);
      loadRuns();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultFrom, defaultTo]);

  const loadRuns = useCallback(async () => {
    try {
      const r = await fetch('/api/rahaza/aps/auto-schedule/runs?limit=10', { headers });
      const j = await r.json();
      if (r.ok && Array.isArray(j)) setRuns(j);
    } catch (e) {
      // non-fatal
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const doPreview = async () => {
    if (!fromDate || !toDate) {
      toast.error('Rentang tanggal wajib diisi');
      return;
    }
    if (toDate < fromDate) {
      toast.error('Tanggal selesai harus ≥ mulai');
      return;
    }
    setPreviewing(true); setRun(null);
    try {
      const r = await fetch('/api/rahaza/aps/auto-schedule/preview', {
        method: 'POST', headers,
        body: JSON.stringify({
          from: fromDate, to: toDate,
          include_in_production: includeInProduction,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      setRun(j);
      toast.success('Preview jadwal siap');
      loadRuns();
    } catch (e) {
      toast.error(`Preview gagal: ${e.message}`);
    } finally { setPreviewing(false); }
  };

  const doCommit = async () => {
    if (!run?.id) return;
    setCommitting(true);
    try {
      const r = await fetch('/api/rahaza/aps/auto-schedule/commit', {
        method: 'POST', headers,
        body: JSON.stringify({ run_id: run.id }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      toast.success(`Jadwal tersimpan: ${j.applied_wo_count} WO, ${j.created_assignment_count} slot assignment`);
      setRun({ ...run, status: 'committed' });
      loadRuns();
      onCommitted?.();
    } catch (e) {
      toast.error(`Commit gagal: ${e.message}`);
    } finally { setCommitting(false); }
  };

  const doRollback = async (runId) => {
    setRollingBack(true);
    try {
      const r = await fetch('/api/rahaza/aps/auto-schedule/rollback', {
        method: 'POST', headers,
        body: JSON.stringify({ run_id: runId }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      toast.success(`Rollback ok: ${j.restored_wo_count} WO dikembalikan`);
      if (run?.id === runId) setRun({ ...run, status: 'rolled_back' });
      loadRuns();
      onRolledBack?.();
    } catch (e) {
      toast.error(`Rollback gagal: ${e.message}`);
    } finally { setRollingBack(false); }
  };

  const proposal = run?.proposal || {};
  const kpis = proposal.kpis || {};
  const proposals = proposal.proposals || [];
  const unassigned = proposal.unassigned || [];

  const statusBadge = (s) => {
    const map = {
      preview:    'bg-sky-500/15 text-sky-300 border-sky-400/25',
      committed:  'bg-emerald-500/15 text-emerald-300 border-emerald-400/25',
      rolled_back:'bg-foreground/10 text-muted-foreground border-foreground/15',
    };
    const label = s === 'preview' ? 'Preview' : s === 'committed' ? 'Committed' : 'Rolled Back';
    return <Badge variant="outline" className={map[s] || map.preview}>{label}</Badge>;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-3xl max-h-[90vh] overflow-y-auto bg-[var(--card-surface)]/95 backdrop-blur-[var(--glass-blur)] border border-[var(--glass-border)]"
        data-testid="aps-auto-schedule-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-sky-300" />
            Auto-Schedule (Phase 19B)
          </DialogTitle>
          <DialogDescription>
            Preview usulan jadwal dari kapasitas, prioritas, dan SMV historis. Commit → tersimpan dengan audit; bisa di-rollback.
          </DialogDescription>
        </DialogHeader>

        {/* ── Configuration ── */}
        <GlassPanel className="p-3" data-testid="aps-auto-schedule-config">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                Dari Tanggal
              </label>
              <input
                type="date" value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="mt-1 w-full bg-[var(--card-surface)] border border-[var(--glass-border)] rounded-md px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-sky-400/40"
                data-testid="aps-auto-schedule-from-input"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                Sampai Tanggal
              </label>
              <input
                type="date" value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="mt-1 w-full bg-[var(--card-surface)] border border-[var(--glass-border)] rounded-md px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-sky-400/40"
                data-testid="aps-auto-schedule-to-input"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-xs cursor-pointer select-none" data-testid="aps-auto-schedule-include-in-production-label">
                <Checkbox
                  checked={includeInProduction}
                  onCheckedChange={(v) => setIncludeInProduction(!!v)}
                  data-testid="aps-auto-schedule-include-in-production-checkbox"
                />
                <span>Termasuk WO <b>In-Production</b></span>
              </label>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 mt-3">
            <Button
              variant="outline" size="sm"
              onClick={() => { setRun(null); }}
              disabled={!run || previewing || committing}
              data-testid="aps-auto-schedule-clear-preview-button"
            >
              <X className="w-3.5 h-3.5 mr-1" /> Reset
            </Button>
            <Button
              size="sm"
              onClick={doPreview}
              disabled={previewing || committing}
              data-testid="aps-auto-schedule-preview-button"
            >
              {previewing ? <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" /> : <TrendingUp className="w-3.5 h-3.5 mr-1" />}
              Jalankan Preview
            </Button>
          </div>
        </GlassPanel>

        {/* ── Preview Result ── */}
        {previewing ? (
          <div className="space-y-2 mt-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : run ? (
          <div className="space-y-3 mt-3" data-testid="aps-auto-schedule-preview-result">
            {/* Run header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {statusBadge(run.status)}
                <span className="text-[11px] text-muted-foreground font-mono">
                  Run ID: {run.id?.slice(0, 8)}…
                </span>
                <span className="text-[11px] text-muted-foreground">·</span>
                <span className="text-[11px] text-muted-foreground font-mono">
                  {run.from} → {run.to}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {run.status === 'preview' && (
                  <Button
                    size="sm"
                    onClick={doCommit}
                    disabled={committing || proposals.length === 0}
                    data-testid="aps-auto-schedule-commit-button"
                  >
                    {committing ? <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
                    Commit Jadwal
                  </Button>
                )}
                {run.status === 'committed' && (
                  <Button
                    size="sm" variant="outline"
                    onClick={() => doRollback(run.id)}
                    disabled={rollingBack}
                    data-testid="aps-auto-schedule-rollback-button"
                  >
                    {rollingBack ? <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Undo2 className="w-3.5 h-3.5 mr-1" />}
                    Rollback
                  </Button>
                )}
              </div>
            </div>

            {/* KPI strip */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <KpiSmall icon={Package}    label="WO Dipertimbangkan" value={kpis.total_wo_considered ?? 0} />
              <KpiSmall icon={CheckCircle2} label="Dijadwalkan"       value={kpis.scheduled ?? 0} accent="emerald" />
              <KpiSmall icon={AlertTriangle} label="Belum Muat"        value={kpis.unassigned ?? 0} accent={kpis.unassigned ? 'amber' : 'muted'} />
              <KpiSmall icon={Clock}       label="Hari Overload"      value={kpis.overload_days ?? 0} accent={kpis.overload_days ? 'red' : 'muted'} />
              <KpiSmall icon={Layers}      label="Utilisasi"          value={`${kpis.utilization_pct ?? 0}%`} accent="sky" />
            </div>

            {/* Proposals list */}
            {proposals.length > 0 && (
              <GlassPanel className="p-0 overflow-hidden" data-testid="aps-auto-schedule-proposals">
                <div className="p-3 border-b border-[var(--glass-border)] text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Usulan Jadwal ({proposals.length})
                </div>
                <div className="max-h-56 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-foreground/5 text-muted-foreground">
                      <tr>
                        <th className="text-left px-3 py-1.5">WO</th>
                        <th className="text-left px-3 py-1.5">Prioritas</th>
                        <th className="text-left px-3 py-1.5">Qty</th>
                        <th className="text-left px-3 py-1.5">Line</th>
                        <th className="text-left px-3 py-1.5">Mulai</th>
                        <th className="text-left px-3 py-1.5">Selesai</th>
                        <th className="text-left px-3 py-1.5">SMV</th>
                      </tr>
                    </thead>
                    <tbody>
                      {proposals.map((p) => (
                        <tr
                          key={p.wo_id}
                          className="border-t border-[var(--glass-border)]/50 hover:bg-foreground/5"
                          data-testid={`aps-auto-schedule-proposal-row-${p.wo_id}`}
                        >
                          <td className="px-3 py-1.5 font-mono">{p.wo_number}</td>
                          <td className="px-3 py-1.5">
                            <Badge variant="outline" className={`text-[9px] ${PRIORITY_CHIP[p.priority] || PRIORITY_CHIP.normal}`}>
                              {p.priority}
                            </Badge>
                          </td>
                          <td className="px-3 py-1.5 font-mono tabular-nums">{p.qty_remaining}/{p.qty}</td>
                          <td className="px-3 py-1.5 font-mono">{p.line_code || '—'}</td>
                          <td className="px-3 py-1.5 font-mono">{p.start_date}</td>
                          <td className="px-3 py-1.5 font-mono">{p.end_date}</td>
                          <td className="px-3 py-1.5 font-mono text-muted-foreground">
                            {p.smv_minutes_per_unit?.toFixed?.(2) ?? p.smv_minutes_per_unit}m
                            <span className="text-[9px] ml-1 text-muted-foreground">({p.smv_source})</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </GlassPanel>
            )}

            {/* Unassigned list */}
            {unassigned.length > 0 && (
              <GlassPanel className="p-3 border-amber-400/30" data-testid="aps-auto-schedule-unassigned">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-300" />
                  <span className="text-xs font-semibold text-amber-300">
                    Tidak Muat ({unassigned.length})
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {unassigned.map((u) => (
                    <Badge key={u.wo_id} variant="outline" className="text-[10px] bg-amber-500/10 border-amber-400/30">
                      {u.wo_number} ({u.qty_remaining})
                    </Badge>
                  ))}
                </div>
              </GlassPanel>
            )}

            {proposals.length === 0 && unassigned.length === 0 && (
              <div className="text-center text-xs text-muted-foreground py-6">
                Tidak ada WO pada rentang ini.
              </div>
            )}
          </div>
        ) : null}

        {/* ── Recent Runs ── */}
        {runs.length > 0 && (
          <GlassPanel className="p-0 overflow-hidden mt-3" data-testid="aps-auto-schedule-runs-list">
            <div className="p-3 border-b border-[var(--glass-border)] text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Riwayat Run Terakhir
            </div>
            <div className="max-h-48 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-foreground/5 text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-1.5">Status</th>
                    <th className="text-left px-3 py-1.5">Rentang</th>
                    <th className="text-left px-3 py-1.5">Oleh</th>
                    <th className="text-left px-3 py-1.5">Dibuat</th>
                    <th className="text-left px-3 py-1.5">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr
                      key={r.id}
                      className="border-t border-[var(--glass-border)]/50 hover:bg-foreground/5"
                      data-testid={`aps-auto-schedule-runs-row-${r.id}`}
                    >
                      <td className="px-3 py-1.5">{statusBadge(r.status)}</td>
                      <td className="px-3 py-1.5 font-mono">{r.from} → {r.to}</td>
                      <td className="px-3 py-1.5 text-muted-foreground truncate max-w-[120px]">
                        {r.created_by_name || '—'}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-muted-foreground">
                        {r.created_at ? new Date(r.created_at).toLocaleString('id-ID') : '—'}
                      </td>
                      <td className="px-3 py-1.5">
                        {r.status === 'committed' && (
                          <Button
                            size="sm" variant="outline" className="h-6 px-2 text-[10px]"
                            onClick={() => doRollback(r.id)}
                            disabled={rollingBack}
                            data-testid={`aps-auto-schedule-runs-rollback-${r.id}`}
                          >
                            <Undo2 className="w-3 h-3 mr-0.5" /> Rollback
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </GlassPanel>
        )}

        <DialogFooter className="mt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="aps-auto-schedule-close-button">
            Tutup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KpiSmall({ icon: Icon, label, value, accent = 'muted' }) {
  const accentMap = {
    sky:     'text-sky-300 bg-sky-400/10 border-sky-400/20',
    emerald: 'text-emerald-300 bg-emerald-400/10 border-emerald-400/20',
    amber:   'text-amber-300 bg-amber-400/10 border-amber-400/20',
    red:     'text-red-300 bg-red-400/10 border-red-400/20',
    muted:   'text-muted-foreground bg-foreground/5 border-foreground/10',
  };
  return (
    <div className={`rounded-md border px-2 py-1.5 ${accentMap[accent]}`}>
      <div className="flex items-center gap-1.5">
        <Icon className="w-3 h-3" />
        <span className="text-[9px] uppercase tracking-wider font-semibold">{label}</span>
      </div>
      <div className="text-sm font-bold font-mono tabular-nums mt-0.5">{value}</div>
    </div>
  );
}
