import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Hammer, RefreshCw, Eye, Printer, AlertTriangle, Clock, Factory,
  User, MapPin, Package, ArrowRight, ChevronRight, ShieldAlert,
  CheckCircle2, XCircle, Filter, Timer,
} from 'lucide-react';
import { GlassCard, GlassPanel } from '@/components/ui/glass';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from './moduleAtoms';
import { toast } from 'sonner';
import { openBundleTicket } from './bundleTickets';
import BundleDetailPage from './BundleDetailPage';

/* ─── PT Rahaza ERP · BundleReworkBoard (Phase 17E) ──────────────────────────
   Supervisor board for bundles currently in `reworking` status. Highlights
   the failed pcs, last QC fail event, required return process, and the
   rework age so teams can prioritize.
─────────────────────────────────────────────────────────────────────────── */

const AUTO_REFRESH_MS = 30000;

function formatAge(minutes) {
  if (!minutes || minutes <= 0) return 'baru';
  if (minutes < 60) return `${minutes} menit`;
  const hrs = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (hrs < 24) return `${hrs}j ${m}m`;
  const days = Math.floor(hrs / 24);
  return `${days}h ${hrs % 24}j`;
}

function ageTone(minutes) {
  if (!minutes || minutes < 30) return { bg: 'bg-emerald-400/10', border: 'border-emerald-300/25', fg: 'text-emerald-300' };
  if (minutes < 120) return { bg: 'bg-amber-400/12',  border: 'border-amber-300/30',  fg: 'text-amber-300' };
  return { bg: 'bg-red-400/12', border: 'border-red-300/30', fg: 'text-red-300' };
}

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

export default function BundleReworkBoard({ token, onNavigate }) {
  const [items, setItems] = useState([]);
  const [agg, setAgg] = useState({ total: 0, total_fail_pcs: 0, oldest_rework_minutes: 0 });
  const [loading, setLoading] = useState(true);
  const [filterWo, setFilterWo] = useState('');
  const [filterLineCode, setFilterLineCode] = useState('');
  const [activeBundleId, setActiveBundleId] = useState(null);
  const timerRef = useRef(null);

  const fetchBoard = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch('/api/rahaza/bundles-rework', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        setAgg({
          total: data.total || 0,
          total_fail_pcs: data.total_fail_pcs || 0,
          oldest_rework_minutes: data.oldest_rework_minutes || 0,
        });
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.detail || 'Gagal memuat rework board');
      }
    } catch (e) {
      toast.error('Error: ' + e.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [token]);

  // Initial + polling
  useEffect(() => { fetchBoard(); }, [fetchBoard]);
  useEffect(() => {
    if (activeBundleId) return; // pause polling when viewing detail
    timerRef.current = setInterval(() => fetchBoard(true), AUTO_REFRESH_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetchBoard, activeBundleId]);

  // Filter client-side
  const filteredItems = useMemo(() => {
    return items.filter((b) => {
      if (filterWo && !(b.wo_number_snapshot || '').toLowerCase().includes(filterWo.toLowerCase())) return false;
      if (filterLineCode) {
        // Match against last QC fail line_code or current line
        const lc = (b.last_qc_fail_event?.line_code || '').toUpperCase();
        if (!lc.includes(filterLineCode.toUpperCase())) return false;
      }
      return true;
    });
  }, [items, filterWo, filterLineCode]);

  // ─── Detail page routing (reuse BundleDetailPage) ────────────────────
  if (activeBundleId) {
    return (
      <BundleDetailPage
        token={token}
        bundleId={activeBundleId}
        onBack={() => { setActiveBundleId(null); fetchBoard(); }}
        onNavigate={onNavigate}
      />
    );
  }

  const activeWos = [...new Set(items.map((b) => b.wo_number_snapshot).filter(Boolean))];

  return (
    <div className="space-y-4" data-testid="rework-board-module">
      <PageHeader
        icon={Hammer}
        eyebrow="Produksi · Traceability"
        title="Papan Rework Bundle"
        subtitle="Bundle yang sedang dalam rework (QC fail) — harus kembali ke proses rework sebelum lanjut."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => fetchBoard()}
              className="h-9 border border-[var(--glass-border)]"
              data-testid="rework-refresh"
            >
              <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            {onNavigate && (
              <Button
                onClick={() => onNavigate('prod-bundles')}
                className="h-9"
                data-testid="rework-to-bundles"
              >
                <Package className="w-4 h-4 mr-1.5" /> Ke Daftar Bundle
              </Button>
            )}
          </div>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <GlassPanel className="p-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-400/12 border border-orange-300/25 grid place-items-center">
            <Hammer className="w-5 h-5 text-orange-400" />
          </div>
          <div>
            <div className="text-lg font-bold text-foreground">{agg.total}</div>
            <div className="text-[11px] text-muted-foreground">Total bundle rework</div>
          </div>
        </GlassPanel>
        <GlassPanel className="p-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-400/12 border border-red-300/25 grid place-items-center">
            <ShieldAlert className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <div className="text-lg font-bold text-foreground">{agg.total_fail_pcs}</div>
            <div className="text-[11px] text-muted-foreground">Total pcs gagal QC</div>
          </div>
        </GlassPanel>
        <GlassPanel className="p-3 flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl grid place-items-center ${ageTone(agg.oldest_rework_minutes).bg} ${ageTone(agg.oldest_rework_minutes).border} border`}>
            <Timer className={`w-5 h-5 ${ageTone(agg.oldest_rework_minutes).fg}`} />
          </div>
          <div>
            <div className="text-lg font-bold text-foreground">{formatAge(agg.oldest_rework_minutes)}</div>
            <div className="text-[11px] text-muted-foreground">Rework tertua</div>
          </div>
        </GlassPanel>
      </div>

      {/* Filter bar */}
      {(items.length > 0 || filterWo || filterLineCode) && (
        <GlassPanel className="p-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 text-[11px] text-foreground/50">
              <Filter className="w-3.5 h-3.5" /> Filter:
            </div>
            {/* WO chips */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                onClick={() => setFilterWo('')}
                className={`px-2.5 h-7 text-[11px] rounded-full border font-semibold transition-colors
                  ${!filterWo
                    ? 'bg-[hsl(var(--primary)/0.12)] border-[hsl(var(--primary)/0.35)] text-foreground'
                    : 'bg-transparent border-[var(--glass-border)] text-foreground/60 hover:text-foreground hover:bg-[var(--glass-bg-hover)]'}`}
                data-testid="rework-filter-wo-all"
              >
                Semua WO ({items.length})
              </button>
              {activeWos.slice(0, 8).map((wo) => (
                <button
                  key={wo}
                  onClick={() => setFilterWo(filterWo === wo ? '' : wo)}
                  className={`px-2.5 h-7 text-[11px] rounded-full border font-semibold transition-colors
                    ${filterWo === wo
                      ? 'bg-[hsl(var(--primary)/0.12)] border-[hsl(var(--primary)/0.35)] text-foreground'
                      : 'bg-transparent border-[var(--glass-border)] text-foreground/60 hover:text-foreground hover:bg-[var(--glass-bg-hover)]'}`}
                  data-testid={`rework-filter-wo-${wo}`}
                >
                  {wo}
                </button>
              ))}
            </div>
            {filterLineCode && (
              <button
                onClick={() => setFilterLineCode('')}
                className="ml-auto px-2.5 h-7 text-[11px] rounded-full border border-[var(--glass-border)] text-foreground/60 hover:text-foreground"
                data-testid="rework-filter-clear-line"
              >
                <XCircle className="w-3 h-3 inline mr-1" /> Clear line filter "{filterLineCode}"
              </button>
            )}
          </div>
        </GlassPanel>
      )}

      {/* Loading state */}
      {loading && items.length === 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-40" />)}
        </div>
      )}

      {/* Empty state */}
      {!loading && filteredItems.length === 0 && items.length === 0 && (
        <GlassCard className="p-8 text-center" hover={false} data-testid="rework-empty">
          <div className="w-14 h-14 rounded-full bg-emerald-400/12 border border-emerald-300/30 grid place-items-center mx-auto mb-3">
            <CheckCircle2 className="w-7 h-7 text-emerald-400" />
          </div>
          <div className="text-base font-bold text-foreground mb-1">Tidak ada bundle rework aktif</div>
          <div className="text-sm text-foreground/60 max-w-md mx-auto">
            Semua bundle lolos QC. Jika ada QC fail, bundle otomatis muncul di sini dengan informasi proses return dan operator terakhir.
          </div>
          {onNavigate && (
            <Button
              onClick={() => onNavigate('prod-bundles')}
              variant="outline"
              className="mt-4 h-9"
              data-testid="rework-empty-to-bundles"
            >
              <Package className="w-4 h-4 mr-1.5" /> Lihat semua bundle
            </Button>
          )}
        </GlassCard>
      )}

      {/* Filter results empty */}
      {!loading && filteredItems.length === 0 && items.length > 0 && (
        <GlassPanel className="p-6 text-center" data-testid="rework-filter-empty">
          <Filter className="w-8 h-8 text-foreground/30 mx-auto mb-2" />
          <div className="text-sm text-foreground/70">Tidak ada bundle cocok dengan filter aktif.</div>
          <Button
            variant="ghost"
            className="mt-2 h-8 text-[11px]"
            onClick={() => { setFilterWo(''); setFilterLineCode(''); }}
          >
            Bersihkan filter
          </Button>
        </GlassPanel>
      )}

      {/* Card grid */}
      {filteredItems.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {filteredItems.map((b) => {
            const lastFail = b.last_qc_fail_event || {};
            const ageMinutes = b.rework_age_minutes || 0;
            const tone = ageTone(ageMinutes);
            return (
              <GlassCard
                key={b.id}
                className="p-4 border-orange-300/20 bg-orange-400/[0.03] cursor-pointer hover:border-orange-300/40 hover:bg-orange-400/[0.06] transition-[border-color,background-color] duration-150"
                onClick={() => setActiveBundleId(b.id)}
                data-testid={`rework-card-${b.bundle_number}`}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-bold text-foreground">{b.bundle_number}</span>
                      <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-orange-400/15 text-orange-300 border border-orange-300/30">
                        <Hammer className="w-2.5 h-2.5 inline -mt-0.5 mr-1" />
                        Rework
                      </span>
                    </div>
                    <div className="text-[11px] text-foreground/60 mt-0.5">
                      WO <b className="text-foreground/80">{b.wo_number_snapshot || '—'}</b> · {b.model_code || '—'} · {b.size_code || '—'} · {b.qty} pcs
                    </div>
                  </div>
                  <div className={`text-right rounded-lg px-2.5 py-1 border ${tone.bg} ${tone.border}`} title={`Rework berjalan ${formatAge(ageMinutes)}`}>
                    <div className={`text-[10px] uppercase tracking-wider font-semibold ${tone.fg}`}>Usia</div>
                    <div className={`text-xs font-bold ${tone.fg}`}>{formatAge(ageMinutes)}</div>
                  </div>
                </div>

                {/* Big qty_fail callout */}
                <div className="mt-3 flex items-center gap-3">
                  <div className="flex-shrink-0 w-14 h-14 rounded-xl bg-red-400/10 border border-red-300/30 grid place-items-center">
                    <div className="text-lg font-black text-red-400 leading-none">{b.qty_fail || 0}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] uppercase tracking-wider text-foreground/50 font-semibold">Pcs gagal QC</div>
                    <div className="text-xs text-foreground/70 leading-relaxed">
                      Harus diulang di <b className="text-foreground">{b.must_return_process_code || b.current_process_code || '—'}</b>
                      {b.must_return_process_name && <span className="text-foreground/50"> · {b.must_return_process_name}</span>}
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-foreground/60 mt-1">
                      <Factory className="w-3 h-3 text-foreground/45" />
                      Saat ini di proses <b className="text-foreground/85">{b.current_process_code}</b>
                    </div>
                  </div>
                </div>

                {/* Last QC fail info */}
                <div className="mt-3 p-2.5 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)]">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-foreground/50 font-semibold mb-1.5">
                    <AlertTriangle className="w-3 h-3 text-red-400" /> QC Fail Terakhir
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1 text-foreground/85 truncate">
                        <User className="w-3 h-3 text-foreground/45 flex-shrink-0" />
                        <span className="truncate font-medium">{lastFail.by || '—'}</span>
                      </div>
                      {lastFail.line_code && (
                        <div className="flex items-center gap-1 text-foreground/60 mt-0.5 truncate">
                          <MapPin className="w-3 h-3 text-foreground/45 flex-shrink-0" />
                          <span className="truncate">{lastFail.line_code}</span>
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="text-foreground/75 flex items-center gap-1 justify-end">
                        <Clock className="w-3 h-3 text-foreground/45" />
                        {formatDateTime(lastFail.at || b.last_qc_fail_at)}
                      </div>
                      {lastFail.qty != null && (
                        <div className="text-red-300 font-semibold mt-0.5">{lastFail.qty} pcs fail</div>
                      )}
                    </div>
                  </div>
                  {lastFail.notes && (
                    <div className="mt-1.5 text-[11px] text-foreground/70 italic border-t border-[var(--glass-border)] pt-1.5">
                      "{lastFail.notes}"
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="mt-3 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="outline"
                    className="h-8 flex-1"
                    onClick={(e) => { e.stopPropagation(); setActiveBundleId(b.id); }}
                    data-testid={`rework-open-${b.bundle_number}`}
                  >
                    <Eye className="w-3.5 h-3.5 mr-1.5" /> Buka Detail
                  </Button>
                  <Button
                    variant="ghost"
                    className="h-8 border border-[var(--glass-border)]"
                    onClick={(e) => { e.stopPropagation(); openBundleTicket(b, token); }}
                    data-testid={`rework-print-${b.bundle_number}`}
                    title="Cetak ticket QR"
                  >
                    <Printer className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}

      {/* Live updates hint */}
      {items.length > 0 && (
        <div className="text-center text-[10px] text-foreground/40 italic">
          Data otomatis diperbarui setiap {AUTO_REFRESH_MS / 1000} detik.
        </div>
      )}
    </div>
  );
}
