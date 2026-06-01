import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ArrowLeft, RefreshCw, Printer, Package, Clock, CheckCircle2, XCircle,
  ArrowRight, Sparkles, Factory, ShieldCheck, AlertTriangle, Boxes, Tag,
  Hammer, ScanLine, User, MapPin, Hash, ChevronRight, Info,
} from 'lucide-react';
import { GlassCard, GlassPanel } from '@/components/ui/glass';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from './moduleAtoms';
import { toast } from 'sonner';
import { openBundleTicket } from './bundleTickets';

/* ─── PT Rahaza ERP · BundleDetailPage (Phase 17D) ───────────────────────────
   Full-page drill-down: hero + current/next step + process flow + vertical
   timeline stepper. Bundle.history is the primary source of truth (pre-joined
   with line_code, process_code, by, by_id, qty, notes, timestamps).
─────────────────────────────────────────────────────────────────────────── */

const STATUS_META = {
  created:    { label: 'Dibuat',       color: 'bg-slate-400/15 text-slate-300 border-slate-300/25', dot: 'bg-slate-300' },
  in_process: { label: 'Dalam Proses', color: 'bg-[hsl(var(--primary)/0.15)] text-[hsl(var(--primary))] border-[hsl(var(--primary)/0.25)]', dot: 'bg-[hsl(var(--primary))]' },
  qc:         { label: 'Menunggu QC',  color: 'bg-amber-400/15 text-amber-300 border-amber-300/25', dot: 'bg-amber-300' },
  reworking:  { label: 'Rework',       color: 'bg-orange-400/15 text-orange-300 border-orange-300/25', dot: 'bg-orange-300' },
  packed:     { label: 'Selesai Pack', color: 'bg-emerald-400/15 text-emerald-300 border-emerald-300/25', dot: 'bg-emerald-300' },
  shipped:    { label: 'Terkirim',     color: 'bg-emerald-500/15 text-emerald-400 border-emerald-400/25', dot: 'bg-emerald-400' },
  closed:     { label: 'Ditutup',      color: 'bg-foreground/10 text-foreground/60 border-foreground/20', dot: 'bg-foreground/40' },
};

const EVENT_META = {
  created:  { label: 'Bundle dibuat',     icon: Sparkles,     tone: 'slate',   bg: 'bg-slate-400/10',   border: 'border-slate-300/25',   fg: 'text-slate-300' },
  output:   { label: 'Output submit',     icon: Factory,      tone: 'primary', bg: 'bg-[hsl(var(--primary)/0.12)]', border: 'border-[hsl(var(--primary)/0.28)]', fg: 'text-[hsl(var(--primary))]' },
  qc_pass:  { label: 'QC Pass',           icon: ShieldCheck,  tone: 'emerald', bg: 'bg-emerald-400/12',  border: 'border-emerald-300/30', fg: 'text-emerald-300' },
  qc_fail:  { label: 'QC Fail',           icon: AlertTriangle, tone: 'red',    bg: 'bg-red-400/12',      border: 'border-red-300/30',     fg: 'text-red-300' },
  advance:  { label: 'Lanjut ke proses',  icon: ArrowRight,   tone: 'primary', bg: 'bg-[hsl(var(--primary)/0.1)]',  border: 'border-[hsl(var(--primary)/0.25)]', fg: 'text-[hsl(var(--primary))]' },
  packed:   { label: 'Selesai / Packed',  icon: Boxes,        tone: 'emerald', bg: 'bg-emerald-400/12',  border: 'border-emerald-300/30', fg: 'text-emerald-300' },
  rework:   { label: 'Masuk rework',      icon: Hammer,       tone: 'orange',  bg: 'bg-orange-400/12',   border: 'border-orange-300/30',  fg: 'text-orange-300' },
};

function getEventMeta(event) {
  const key = (event || '').toLowerCase();
  return EVENT_META[key] || { label: event || 'Event', icon: ScanLine, tone: 'slate', bg: 'bg-slate-400/10', border: 'border-slate-300/25', fg: 'text-slate-300' };
}

function StatusBadge({ status, size = 'sm' }) {
  const m = STATUS_META[status] || STATUS_META.created;
  const padding = size === 'lg' ? 'text-[11px] px-2.5 py-1' : 'text-[10px] px-2 py-0.5';
  return (
    <span className={`inline-flex items-center gap-1.5 font-semibold rounded-full border ${padding} ${m.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function formatTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function formatRelative(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'baru saja';
    if (mins < 60) return `${mins} menit lalu`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} jam lalu`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days} hari lalu`;
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
  } catch {
    return '';
  }
}

export default function BundleDetailPage({ token, bundleId, bundleNumber: initialNumber, onBack, onNavigate }) {
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchBundle = useCallback(async () => {
    if (!bundleId && !initialNumber) return;
    setLoading(true);
    setError(null);
    try {
      const url = bundleId
        ? `/api/rahaza/bundles/${bundleId}`
        : `/api/rahaza/bundles/by-number/${encodeURIComponent(initialNumber)}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setBundle(data);
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.detail || 'Bundle tidak ditemukan');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token, bundleId, initialNumber]);

  useEffect(() => { fetchBundle(); }, [fetchBundle]);

  // Derived state
  const {
    currentStep,
    nextStep,
    currentIdx,
    totalSteps,
    lastEvent,
    sortedHistory,
    processProgressPct,
  } = useMemo(() => {
    if (!bundle) return { currentStep: null, nextStep: null, currentIdx: -1, totalSteps: 0, lastEvent: null, sortedHistory: [], processProgressPct: 0 };
    const seq = bundle.process_sequence || [];
    const idx = seq.findIndex((p) => p.id === bundle.current_process_id);
    const cur = idx >= 0 ? seq[idx] : null;
    const nxt = idx >= 0 && idx + 1 < seq.length ? seq[idx + 1] : null;
    const history = (bundle.history || []).slice().sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
    const last = history[0] || null;
    let pct = 0;
    if (seq.length > 0) {
      if ((bundle.status || '') === 'packed' || (bundle.status || '') === 'shipped') pct = 100;
      else if (idx >= 0) pct = Math.round((idx / seq.length) * 100);
    }
    return {
      currentStep: cur,
      nextStep: nxt,
      currentIdx: idx,
      totalSteps: seq.length,
      lastEvent: last,
      sortedHistory: history,
      processProgressPct: pct,
    };
  }, [bundle]);

  const handlePrint = async () => {
    if (!bundle) return;
    try {
      await openBundleTicket(bundle, token);
    } catch (e) {
      toast.error('Gagal mencetak ticket: ' + e.message);
    }
  };

  // ─── Loading ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-4" data-testid="bundle-detail-loading">
        <PageHeader
          eyebrow="Produksi · Traceability"
          title="Memuat bundle..."
          actions={
            <Button variant="ghost" onClick={onBack} className="h-9 border border-[var(--glass-border)]">
              <ArrowLeft className="w-4 h-4 mr-1.5" /> Kembali
            </Button>
          }
        />
        <Skeleton className="h-32 w-full" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // ─── Error ──────────────────────────────────────────────────────────
  if (error || !bundle) {
    return (
      <div className="space-y-4" data-testid="bundle-detail-error">
        <PageHeader
          eyebrow="Produksi · Traceability"
          title="Bundle tidak ditemukan"
          actions={
            <Button variant="ghost" onClick={onBack} className="h-9 border border-[var(--glass-border)]" data-testid="bundle-detail-back">
              <ArrowLeft className="w-4 h-4 mr-1.5" /> Kembali ke daftar
            </Button>
          }
        />
        <GlassCard className="p-6 text-center">
          <XCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <p className="text-sm text-foreground/80">{error || 'Bundle tidak ditemukan atau sudah dihapus.'}</p>
          <Button onClick={fetchBundle} variant="outline" className="mt-4 h-9">
            <RefreshCw className="w-4 h-4 mr-1.5" /> Coba lagi
          </Button>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="bundle-detail-page">
      {/* Header */}
      <PageHeader
        eyebrow={`Produksi · Traceability · WO ${bundle.wo_number_snapshot || '—'}`}
        title={
          <span className="inline-flex items-center gap-2">
            <span className="font-mono">{bundle.bundle_number}</span>
            <StatusBadge status={bundle.status} size="lg" />
          </span>
        }
        subtitle={`${bundle.model_code || '—'} · ${bundle.size_code || '—'} · ${bundle.qty || 0} pcs`}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={onBack}
              className="h-9 border border-[var(--glass-border)]"
              data-testid="bundle-detail-back"
            >
              <ArrowLeft className="w-4 h-4 mr-1.5" /> Kembali
            </Button>
            <Button
              variant="ghost"
              onClick={fetchBundle}
              className="h-9 border border-[var(--glass-border)]"
              data-testid="bundle-detail-refresh"
            >
              <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button onClick={handlePrint} className="h-9" data-testid="bundle-detail-print">
              <Printer className="w-4 h-4 mr-1.5" /> Cetak Ticket
            </Button>
          </div>
        }
      />

      {/* Hero info grid */}
      <GlassPanel className="p-4 border border-[hsl(var(--primary)/0.15)] bg-[hsl(var(--primary)/0.04)]">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <HeroField icon={Hash} label="Bundle" mono value={bundle.bundle_number} />
          <HeroField icon={Package} label="Work Order" value={bundle.wo_number_snapshot || '—'} />
          <HeroField icon={Tag} label="Model · Size" value={`${bundle.model_code || '—'} · ${bundle.size_code || '—'}`} />
          <HeroField icon={Boxes} label="Qty Bundle" value={`${bundle.qty || 0} pcs`} />
          <HeroField icon={Clock} label="Dibuat" value={formatDateTime(bundle.created_at)} hint={formatRelative(bundle.created_at)} />
        </div>
      </GlassPanel>

      {/* Current / Next / Counters */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Current step */}
        <GlassCard className="p-4 border-[hsl(var(--primary)/0.25)] bg-[hsl(var(--primary)/0.04)]" hover={false} data-testid="bundle-detail-current-step">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-[hsl(var(--primary)/0.15)] border border-[hsl(var(--primary)/0.3)] grid place-items-center">
              <Factory className="w-4 h-4 text-[hsl(var(--primary))]" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-foreground/50 font-semibold">Proses Sekarang</div>
              <div className="text-sm font-bold text-foreground">
                {currentStep ? `${currentStep.code} · ${currentStep.name}` : '—'}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <div className="text-foreground/50">Pass</div>
              <div className="text-emerald-400 font-bold text-base">{bundle.qty_pass || 0}</div>
            </div>
            <div>
              <div className="text-foreground/50">Fail</div>
              <div className="text-red-400 font-bold text-base">{bundle.qty_fail || 0}</div>
            </div>
            <div>
              <div className="text-foreground/50">Sisa</div>
              <div className="text-amber-400 font-bold text-base">{bundle.qty_remaining ?? bundle.qty}</div>
            </div>
          </div>
          {lastEvent && (
            <div className="mt-3 pt-3 border-t border-[var(--glass-border)] space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-foreground/50 font-semibold">Terakhir disentuh</div>
              <div className="flex items-center gap-1.5 text-xs text-foreground/80">
                <User className="w-3 h-3 text-foreground/50" />
                <span className="font-medium truncate">{lastEvent.by || '—'}</span>
              </div>
              {lastEvent.line_code && (
                <div className="flex items-center gap-1.5 text-xs text-foreground/60">
                  <MapPin className="w-3 h-3 text-foreground/50" />
                  <span>{lastEvent.line_code}</span>
                </div>
              )}
              <div className="flex items-center gap-1.5 text-xs text-foreground/60">
                <Clock className="w-3 h-3 text-foreground/50" />
                <span>{formatRelative(lastEvent.at)} · {formatDateTime(lastEvent.at)}</span>
              </div>
            </div>
          )}
        </GlassCard>

        {/* Next step */}
        <GlassCard className="p-4" hover={false} data-testid="bundle-detail-next-step">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-amber-400/12 border border-amber-300/30 grid place-items-center">
              <ChevronRight className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-foreground/50 font-semibold">Next Action</div>
              <div className="text-sm font-bold text-foreground">
                {bundle.status === 'packed' ? 'Siap Kirim (Shipment)'
                  : bundle.status === 'shipped' ? 'Terkirim'
                  : bundle.status === 'closed' ? 'Ditutup'
                  : bundle.status === 'reworking' ? 'Rework di Sewing'
                  : nextStep ? `${nextStep.code} · ${nextStep.name}` : (currentStep ? `Selesaikan ${currentStep.code}` : '—')}
              </div>
            </div>
          </div>
          <div className="text-xs text-foreground/70 leading-relaxed">
            {bundle.status === 'reworking' ? (
              <span>Qty fail = <b className="text-red-300">{bundle.qty_fail || 0}</b> harus diselesaikan di proses Sewing sebelum lanjut.</span>
            ) : bundle.status === 'packed' ? (
              <span>Semua proses selesai. Bundle siap dimasukkan shipment.</span>
            ) : bundle.status === 'qc' ? (
              <span>Menunggu hasil QC. Submit <b>pass/fail</b> untuk melanjutkan.</span>
            ) : nextStep ? (
              <span>Setelah qty sisa = 0, bundle akan otomatis pindah ke <b className="text-foreground">{nextStep.code}</b>.</span>
            ) : (
              <span>Tidak ada proses lanjutan dalam urutan.</span>
            )}
          </div>
          {bundle.must_return_process && (
            <div className="mt-3 flex items-start gap-2 p-2 rounded-lg bg-orange-400/8 border border-orange-300/25 text-[11px] text-orange-200">
              <AlertTriangle className="w-3.5 h-3.5 text-orange-400 mt-0.5 flex-shrink-0" />
              <span>Harus kembali ke proses rework (id: <span className="font-mono">{bundle.must_return_process.slice(0, 8)}…</span>)</span>
            </div>
          )}
        </GlassCard>

        {/* Progress pct */}
        <GlassCard className="p-4" hover={false} data-testid="bundle-detail-progress">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-400/12 border border-emerald-300/30 grid place-items-center">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-foreground/50 font-semibold">Progress Alur</div>
              <div className="text-sm font-bold text-foreground">
                Step {currentIdx >= 0 ? currentIdx + 1 : 0} / {totalSteps}
              </div>
            </div>
          </div>
          {/* Progress bar */}
          <div className="h-2 rounded-full bg-[var(--glass-bg)] border border-[var(--glass-border)] overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[hsl(var(--primary))] to-emerald-400 transition-[width] duration-300"
              style={{ width: `${processProgressPct}%` }}
            />
          </div>
          <div className="mt-2 text-[11px] text-foreground/60">
            {processProgressPct}% selesai · {(bundle.history || []).length} event tercatat
          </div>
        </GlassCard>
      </div>

      {/* Process flow visual */}
      <GlassCard className="p-4" hover={false} data-testid="bundle-detail-flow">
        <div className="flex items-center gap-2 mb-3">
          <div className="text-[10px] uppercase tracking-wider text-foreground/50 font-semibold">Alur Proses</div>
          <div className="text-[10px] text-foreground/40">— urutan dipotret saat bundle dibuat</div>
        </div>
        <div className="flex items-center flex-wrap gap-1.5">
          {(bundle.process_sequence || []).map((p, idx) => {
            const isCurrent = p.id === bundle.current_process_id;
            const isPast = currentIdx >= 0 && idx < currentIdx;
            const isFuture = currentIdx >= 0 && idx > currentIdx;
            return (
              <div key={p.id} className="flex items-center gap-1.5">
                <div
                  className={`flex items-center gap-1.5 px-2.5 h-7 rounded-full border text-[11px] font-semibold
                    ${isCurrent ? 'bg-[hsl(var(--primary)/0.15)] text-[hsl(var(--primary))] border-[hsl(var(--primary)/0.4)] shadow-[0_0_0_3px_hsl(var(--primary)/0.08)]'
                      : isPast ? 'bg-emerald-400/10 text-emerald-300 border-emerald-300/25'
                      : isFuture ? 'bg-[var(--glass-bg)] text-foreground/45 border-[var(--glass-border)]'
                      : 'bg-[var(--glass-bg)] text-foreground/60 border-[var(--glass-border)]'}`}
                >
                  {isPast && <CheckCircle2 className="w-3 h-3" />}
                  {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--primary))] animate-pulse" />}
                  {p.code}
                </div>
                {idx < (bundle.process_sequence || []).length - 1 && (
                  <ChevronRight className={`w-3.5 h-3.5 ${isPast ? 'text-emerald-400/60' : 'text-foreground/30'}`} />
                )}
              </div>
            );
          })}
        </div>
      </GlassCard>

      {/* Timeline stepper + Parent bundle info */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <GlassCard className="p-4 lg:col-span-2" hover={false} data-testid="bundle-detail-timeline">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-foreground/50 font-semibold">Timeline Event</div>
              <div className="text-sm font-bold text-foreground">
                Histori lengkap bundle ini ({sortedHistory.length} event)
              </div>
            </div>
            <div className="text-[10px] text-foreground/40">terbaru → lama</div>
          </div>

          {sortedHistory.length === 0 ? (
            <div className="text-center py-8 text-sm text-foreground/50">
              <Clock className="w-8 h-8 mx-auto mb-2 opacity-40" />
              Belum ada event tercatat.
            </div>
          ) : (
            <ol className="relative border-l border-[var(--glass-border)] ml-4 space-y-4">
              {sortedHistory.map((h, i) => {
                const meta = getEventMeta(h.event);
                const Icon = meta.icon;
                return (
                  <li key={i} className="ml-6 relative" data-testid={`bundle-timeline-event-${i}`}>
                    {/* Marker */}
                    <span
                      className={`absolute -left-[34px] top-0 w-8 h-8 rounded-full grid place-items-center border-2 border-[var(--card-surface)] ${meta.bg} ${meta.border} shadow-[0_0_0_1px_var(--glass-border)]`}
                    >
                      <Icon className={`w-4 h-4 ${meta.fg}`} />
                    </span>

                    <GlassPanel className="p-3">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${meta.bg} ${meta.border} ${meta.fg}`}>
                              {meta.label}
                            </span>
                            {h.process_code && (
                              <span className="text-[10px] font-semibold text-foreground/70 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-full px-2 py-0.5">
                                {h.process_code}
                              </span>
                            )}
                            {h.from_process_code && h.to_process_code && (
                              <span className="text-[10px] font-semibold text-foreground/70 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-full px-2 py-0.5">
                                {h.from_process_code} → {h.to_process_code}
                              </span>
                            )}
                            {h.qty != null && (
                              <span className="text-[10px] font-semibold text-foreground bg-[hsl(var(--primary)/0.1)] border border-[hsl(var(--primary)/0.25)] rounded-full px-2 py-0.5">
                                {h.qty} pcs
                              </span>
                            )}
                          </div>
                          <div className="mt-1.5 flex items-center gap-3 flex-wrap text-[11px] text-foreground/70">
                            {h.by && (
                              <span className="inline-flex items-center gap-1">
                                <User className="w-3 h-3 text-foreground/50" />
                                <b className="text-foreground/85">{h.by}</b>
                              </span>
                            )}
                            {h.line_code && (
                              <span className="inline-flex items-center gap-1">
                                <MapPin className="w-3 h-3 text-foreground/50" />
                                <span>{h.line_code}</span>
                              </span>
                            )}
                          </div>
                          {h.notes && (
                            <div className="mt-1.5 text-[11px] text-foreground/60 leading-relaxed">
                              {h.notes}
                            </div>
                          )}
                        </div>
                        <div className="text-right text-[10px] text-foreground/55 flex-shrink-0">
                          <div className="font-semibold text-foreground/75">{formatTime(h.at)}</div>
                          <div>{formatDateTime(h.at)}</div>
                          <div className="italic">{formatRelative(h.at)}</div>
                        </div>
                      </div>
                    </GlassPanel>
                  </li>
                );
              })}
            </ol>
          )}
        </GlassCard>

        {/* Sidebar: extra meta */}
        <div className="space-y-3">
          <GlassCard className="p-4" hover={false} data-testid="bundle-detail-meta">
            <div className="text-[10px] uppercase tracking-wider text-foreground/50 font-semibold mb-2">Metadata</div>
            <dl className="space-y-2 text-xs">
              <MetaRow label="Bundle ID" value={bundle.id} mono />
              <MetaRow label="Created by" value={bundle.created_by || '—'} />
              <MetaRow label="Updated" value={formatDateTime(bundle.updated_at)} />
              <MetaRow label="WO Qty snapshot" value={`${bundle.qty} pcs`} />
              {bundle.parent_bundle_id && <MetaRow label="Parent Bundle" value={bundle.parent_bundle_id} mono />}
            </dl>
          </GlassCard>

          {bundle.parent_bundle_id && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-400/5 border border-amber-300/25 text-xs">
              <Info className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <span className="text-foreground/80">
                Bundle ini adalah hasil <b>split</b> dari bundle parent.
                <span className="block font-mono text-foreground/50 mt-1 text-[10px]">{bundle.parent_bundle_id}</span>
              </span>
            </div>
          )}

          {onNavigate && bundle.work_order_id && (
            <Button
              variant="outline"
              className="w-full h-9"
              onClick={() => onNavigate('prod-work-orders')}
              data-testid="bundle-detail-open-wo"
            >
              <Package className="w-4 h-4 mr-1.5" /> Buka Work Order
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function HeroField({ icon: Icon, label, value, mono, hint }) {
  return (
    <div>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-foreground/50 font-semibold">
        {Icon && <Icon className="w-3 h-3" />} {label}
      </div>
      <div className={`text-sm font-semibold text-foreground mt-0.5 truncate ${mono ? 'font-mono' : ''}`} title={typeof value === 'string' ? value : undefined}>
        {value}
      </div>
      {hint && <div className="text-[10px] text-foreground/45 mt-0.5 italic">{hint}</div>}
    </div>
  );
}

function MetaRow({ label, value, mono }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-foreground/55 text-[11px]">{label}</dt>
      <dd className={`text-foreground/90 text-[11px] text-right break-all ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}
