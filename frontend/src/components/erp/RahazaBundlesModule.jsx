import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Package, Eye, Trash2, RefreshCw, ClipboardList, Search, Box,
  CheckCircle2, Clock, AlertTriangle, XCircle, ArrowRight, Tag, Printer,
  FileSearch, X as IconClose,
} from 'lucide-react';
import { GlassCard, GlassPanel } from '@/components/ui/glass';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataTable } from './DataTableV2';
import { PageHeader } from './moduleAtoms';
import Modal from './Modal';
import { toast } from 'sonner';
import { openBundleTicket, openWorkOrderBundleTickets } from './bundleTickets';
import BundleDetailPage from './BundleDetailPage';

/* ─── PT Rahaza ERP · RahazaBundlesModule (Phase 17A) ────────────────────────
   List & detail bundles per WO/proses. UI-only — generate dilakukan di modul WO.
   Phase 17B akan menambah QR ticket print, Phase 17C scan di OperatorView.
───────────────────────────────────────────────────────────────────────────── */

const STATUS_META = {
  created:    { label: 'Dibuat',       color: 'bg-slate-400/15 text-slate-300 border-slate-300/25' },
  in_process: { label: 'Dalam Proses', color: 'bg-[hsl(var(--primary)/0.15)] text-[hsl(var(--primary))] border-[hsl(var(--primary)/0.25)]' },
  qc:         { label: 'Menunggu QC',  color: 'bg-amber-400/15 text-amber-300 border-amber-300/25' },
  reworking:  { label: 'Rework',       color: 'bg-orange-400/15 text-orange-300 border-orange-300/25' },
  packed:     { label: 'Packed',       color: 'bg-emerald-400/15 text-emerald-300 border-emerald-300/25' },
  shipped:    { label: 'Terkirim',     color: 'bg-emerald-500/15 text-emerald-400 border-emerald-400/25' },
  closed:     { label: 'Ditutup',      color: 'bg-foreground/10 text-foreground/60 border-foreground/20' },
};

function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.created;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${m.color}`}>
      {m.label}
    </span>
  );
}

export default function RahazaBundlesModule({ token, onNavigate }) {
  const [bundles, setBundles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterWo, setFilterWo] = useState('');
  const [statusDefs, setStatusDefs] = useState([]);

  // Phase 17D — detail page view state
  const [activeBundleId, setActiveBundleId] = useState(null);
  const [searchValue, setSearchValue] = useState('');
  const [searching, setSearching] = useState(false);
  const searchInputRef = useRef(null);

  const fetchBundles = useCallback(async () => {
    setLoading(true);
    try {
      const qp = new URLSearchParams();
      if (filterStatus) qp.set('status', filterStatus);
      if (filterWo) qp.set('q', filterWo);
      const res = await fetch(`/api/rahaza/bundles?${qp.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setBundles(data.items || []);
      }
    } finally {
      setLoading(false);
    }
  }, [token, filterStatus, filterWo]);

  const fetchStatusDefs = useCallback(async () => {
    try {
      const res = await fetch('/api/rahaza/bundles-statuses', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setStatusDefs(data.statuses || []);
      }
    } catch (e) { /* ignore */ }
  }, [token]);

  useEffect(() => { fetchBundles(); }, [fetchBundles]);
  useEffect(() => { fetchStatusDefs(); }, [fetchStatusDefs]);

  // Phase 17D — debounced mirror: searchValue → filterWo (so table filters live)
  useEffect(() => {
    const t = setTimeout(() => {
      setFilterWo((prev) => (prev === searchValue ? prev : searchValue));
    }, 300);
    return () => clearTimeout(t);
  }, [searchValue]);

  // Phase 17D — Quick jump: Enter in search bar
  //   1) Try exact lookup by bundle_number (strip + uppercase)
  //   2) Fallback to filtered list with only-result auto-open
  //   3) Otherwise just filter the table
  const handleQuickJump = useCallback(async () => {
    const q = (searchValue || '').trim();
    if (!q) return;
    setSearching(true);
    try {
      // Normalize (bundle numbers are uppercased BDL-...)
      const normalized = q.toUpperCase();
      const isBundleFormat = /^BDL-\d{8}-\d{1,6}$/.test(normalized);

      if (isBundleFormat) {
        const res = await fetch(`/api/rahaza/bundles/by-number/${encodeURIComponent(normalized)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const b = await res.json();
          setActiveBundleId(b.id);
          return;
        }
        // fall through to filter search
      }

      // Fallback: filter list; if exactly one matches, open it directly
      const qp = new URLSearchParams();
      qp.set('q', q);
      const res2 = await fetch(`/api/rahaza/bundles?${qp.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res2.ok) {
        const data = await res2.json();
        const items = data.items || [];
        if (items.length === 1) {
          setActiveBundleId(items[0].id);
          return;
        }
        if (items.length === 0) {
          toast.error(`Tidak ada bundle cocok dengan "${q}"`);
          return;
        }
        // Many matches — update list and toast a hint
        setBundles(items);
        toast.message(`${items.length} bundle ditemukan`, {
          description: 'Klik baris untuk lihat detail atau persempit pencarian.',
        });
      }
    } catch (e) {
      toast.error('Pencarian gagal: ' + e.message);
    } finally {
      setSearching(false);
    }
  }, [searchValue, token]);

  const deleteBundle = async (bundle) => {
    if (!window.confirm(`Hapus bundle ${bundle.bundle_number}? (hanya bisa kalau status 'created' tanpa event produksi)`)) return;
    try {
      const res = await fetch(`/api/rahaza/bundles/${bundle.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        toast.success(`Bundle ${bundle.bundle_number} dihapus`);
        fetchBundles();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.detail || 'Gagal hapus bundle');
      }
    } catch (e) {
      toast.error('Error: ' + e.message);
    }
  };

  // Summary counts
  const summary = useMemo(() => {
    const by_status = {};
    for (const b of bundles) {
      by_status[b.status] = (by_status[b.status] || 0) + 1;
    }
    return {
      total: bundles.length,
      total_qty: bundles.reduce((a, b) => a + (b.qty || 0), 0),
      by_status,
    };
  }, [bundles]);

  // Phase 17B: expose bulk-print when the current list is scoped to a single WO.
  const singleWo = useMemo(() => {
    if (bundles.length === 0) return null;
    const woIds = new Set(bundles.map((b) => b.work_order_id).filter(Boolean));
    if (woIds.size !== 1) return null;
    const first = bundles[0];
    return {
      id: first.work_order_id,
      wo_number: first.wo_number_snapshot,
    };
  }, [bundles]);

  return (
    <div className="space-y-4" data-testid="bundles-module">
      {/* Phase 17D — if activeBundleId set, render full-page detail */}
      {activeBundleId ? (
        <BundleDetailPage
          token={token}
          bundleId={activeBundleId}
          onBack={() => { setActiveBundleId(null); fetchBundles(); }}
          onNavigate={onNavigate}
        />
      ) : (
      <>
      <PageHeader
        eyebrow="Produksi · Traceability"
        title="Bundle Produksi"
        description="Unit granular (default 30 pcs/bundle) yang ter-track dari Rajut sampai Packing. Bundle otomatis dibuat saat tombol 'Generate Bundles' di-klik dari Work Order."
        actions={
          <div className="flex items-center gap-2">
            {singleWo && (
              <Button
                variant="outline"
                onClick={() => openWorkOrderBundleTickets(singleWo, token)}
                className="h-9"
                data-testid="bundles-bulk-print"
                title={`Cetak semua bundle ticket untuk WO ${singleWo.wo_number}`}
              >
                <Printer className="w-4 h-4 mr-1.5" /> Print Semua ({bundles.length})
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={fetchBundles}
              className="h-9 border border-[var(--glass-border)]"
              data-testid="bundles-refresh"
            >
              <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            {onNavigate && (
              <Button
                onClick={() => onNavigate('prod-work-orders')}
                className="h-9"
                data-testid="bundles-to-wo"
              >
                <ClipboardList className="w-4 h-4 mr-1.5" /> Ke Work Order
              </Button>
            )}
          </div>
        }
      />

      {/* Phase 17D — Prominent inline search bar */}
      <GlassPanel className="p-3 border border-[hsl(var(--primary)/0.15)] bg-[hsl(var(--primary)/0.03)]">
        <form
          onSubmit={(e) => { e.preventDefault(); handleQuickJump(); }}
          className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-[hsl(var(--primary)/0.12)] border border-[hsl(var(--primary)/0.25)] grid place-items-center flex-shrink-0">
              <FileSearch className="w-4 h-4 text-[hsl(var(--primary))]" />
            </div>
            <div className="flex-1 min-w-0 relative">
              <Search className="w-3.5 h-3.5 text-foreground/40 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <Input
                ref={searchInputRef}
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                placeholder="Cari bundle (BDL-YYYYMMDD-NNNN), WO, atau model… Enter untuk langsung buka detail"
                className="pl-8 pr-8 h-9 bg-[var(--glass-bg)] border-[var(--glass-border)]"
                data-testid="bundles-search-input"
                disabled={searching}
              />
              {searchValue && (
                <button
                  type="button"
                  onClick={() => { setSearchValue(''); setFilterWo(''); searchInputRef.current?.focus(); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-[var(--glass-bg-hover)] text-foreground/40 hover:text-foreground/70"
                  title="Bersihkan"
                  data-testid="bundles-search-clear"
                >
                  <IconClose className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="submit"
              className="h-9"
              disabled={searching || !searchValue.trim()}
              data-testid="bundles-search-go"
            >
              <ArrowRight className="w-4 h-4 mr-1.5" />
              {searching ? 'Mencari…' : 'Buka Detail'}
            </Button>
          </div>
        </form>
        <div className="mt-1.5 text-[10px] text-foreground/50 pl-11">
          Tip: ketik bundle number lengkap lalu Enter untuk langsung ke halaman detail. Filter di bawah aktif otomatis saat mengetik.
        </div>
      </GlassPanel>

      {/* Summary KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <GlassPanel className="p-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[hsl(var(--primary)/0.12)] border border-[hsl(var(--primary)/0.25)] grid place-items-center">
            <Box className="w-5 h-5 text-[hsl(var(--primary))]" />
          </div>
          <div>
            <div className="text-lg font-bold text-foreground">{summary.total}</div>
            <div className="text-[11px] text-muted-foreground">Total bundle</div>
          </div>
        </GlassPanel>
        <GlassPanel className="p-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-400/10 border border-emerald-300/25 grid place-items-center">
            <Tag className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <div className="text-lg font-bold text-foreground">{summary.total_qty}</div>
            <div className="text-[11px] text-muted-foreground">Total pcs</div>
          </div>
        </GlassPanel>
        <GlassPanel className="p-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-400/10 border border-amber-300/25 grid place-items-center">
            <Clock className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <div className="text-lg font-bold text-foreground">
              {(summary.by_status.in_process || 0) + (summary.by_status.qc || 0) + (summary.by_status.reworking || 0)}
            </div>
            <div className="text-[11px] text-muted-foreground">Dalam Proses</div>
          </div>
        </GlassPanel>
        <GlassPanel className="p-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-400/10 border border-emerald-300/25 grid place-items-center">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <div className="text-lg font-bold text-foreground">
              {(summary.by_status.packed || 0) + (summary.by_status.shipped || 0)}
            </div>
            <div className="text-[11px] text-muted-foreground">Selesai / Shipped</div>
          </div>
        </GlassPanel>
      </div>

      {/* Quick filter by status */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setFilterStatus('')}
          className={`px-3 h-8 rounded-full text-[11px] font-semibold border transition-colors
            ${!filterStatus
              ? 'bg-[hsl(var(--primary)/0.12)] border-[hsl(var(--primary)/0.35)] text-foreground'
              : 'bg-transparent border-[var(--glass-border)] text-muted-foreground hover:text-foreground hover:bg-[var(--glass-bg-hover)]'}`}
          data-testid="bundles-filter-all"
        >
          Semua ({summary.total})
        </button>
        {statusDefs.map((s) => (
          <button
            key={s.value}
            onClick={() => setFilterStatus(filterStatus === s.value ? '' : s.value)}
            className={`px-3 h-8 rounded-full text-[11px] font-semibold border transition-colors
              ${filterStatus === s.value
                ? 'bg-[hsl(var(--primary)/0.12)] border-[hsl(var(--primary)/0.35)] text-foreground'
                : 'bg-transparent border-[var(--glass-border)] text-muted-foreground hover:text-foreground hover:bg-[var(--glass-bg-hover)]'}`}
            data-testid={`bundles-filter-${s.value}`}
          >
            {s.label} ({summary.by_status[s.value] || 0})
          </button>
        ))}
      </div>

      {/* Table */}
      <DataTable
        tableId="bundles"
        rows={bundles}
        loading={loading}
        rowKey="id"
        columns={[
          { key: 'bundle_number', label: 'Bundle #', sortable: true,
            render: (b) => <span className="font-mono text-xs font-semibold text-foreground">{b.bundle_number}</span> },
          { key: 'wo_number_snapshot', label: 'WO', sortable: true,
            render: (b) => <span className="text-xs text-foreground">{b.wo_number_snapshot || '—'}</span> },
          { key: 'model_code', label: 'Model', sortable: true,
            render: (b) => <span className="text-xs text-foreground/80">{b.model_code} / <b className="text-foreground">{b.size_code}</b></span> },
          { key: 'qty', label: 'Qty', sortable: true, align: 'right',
            render: (b) => <span className="font-semibold text-foreground">{b.qty}</span> },
          { key: 'current_process_code', label: 'Proses Sekarang', sortable: true,
            render: (b) => <span className="text-xs font-medium text-foreground/80">{b.current_process_code || '—'}</span> },
          { key: 'status', label: 'Status', sortable: true,
            render: (b) => <StatusBadge status={b.status} /> },
          { key: 'created_at', label: 'Dibuat', sortable: true,
            render: (b) => <span className="text-[11px] text-muted-foreground">
              {b.created_at ? new Date(b.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }) : '—'}
            </span> },
        ]}
        emptyTitle="Belum ada bundle"
        emptyDescription="Bundle dibuat dari modul Work Order. Setelah WO di-release, klik tombol 'Generate Bundles' untuk membuat bundle granular."
        emptyIcon={Box}
        emptyAction={
          onNavigate && (
            <Button
              onClick={() => onNavigate('prod-work-orders')}
              className="h-9"
              data-testid="bundles-empty-cta"
            >
              <ArrowRight className="w-4 h-4 mr-1.5" /> Buka Work Order
            </Button>
          )
        }
        emptyHelp="Bundle = batch ±30 pcs dengan QR code untuk traceability per proses. Tanpa bundle, output hanya tercatat aggregate (tidak granular)."
        exportFilename={`bundles-${new Date().toISOString().slice(0,10)}.csv`}
        rowActions={(b) => (
          <div className="inline-flex items-center gap-1">
            <button
              onClick={() => setDetail(b)}
              className="p-1.5 rounded hover:bg-[var(--glass-bg-hover)] text-muted-foreground hover:text-foreground"
              title="Detail"
              data-testid={`bundle-detail-${b.bundle_number}`}
            >
              <Eye className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => openBundleTicket(b, token)}
              className="p-1.5 rounded hover:bg-[hsl(var(--primary)/0.12)] text-muted-foreground hover:text-[hsl(var(--primary))]"
              title="Cetak ticket QR"
              data-testid={`bundle-print-${b.bundle_number}`}
            >
              <Printer className="w-3.5 h-3.5" />
            </button>
            {b.status === 'created' && (b.history || []).length <= 1 && (
              <button
                onClick={() => deleteBundle(b)}
                className="p-1.5 rounded hover:bg-red-400/10 text-muted-foreground hover:text-red-400"
                title="Hapus"
                data-testid={`bundle-delete-${b.bundle_number}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      />

      {/* Detail Drawer */}
      {detail && (
        <Modal
          onClose={() => setDetail(null)}
          title={`Bundle ${detail.bundle_number}`}
          size="lg"
          data-testid="bundle-detail-modal"
        >
          <div className="space-y-4">
            {/* Action bar */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Button
                onClick={() => { setActiveBundleId(detail.id); setDetail(null); }}
                className="h-9"
                data-testid="bundle-open-full-detail"
              >
                <FileSearch className="w-4 h-4 mr-1.5" /> Buka Detail Lengkap
              </Button>
              <Button
                variant="outline"
                onClick={() => openBundleTicket(detail, token)}
                className="h-9"
                data-testid="bundle-detail-print"
              >
                <Printer className="w-4 h-4 mr-1.5" /> Cetak Ticket
              </Button>
            </div>

            {/* Hero info */}
            <GlassPanel className="p-4 border border-[hsl(var(--primary)/0.15)] bg-[hsl(var(--primary)/0.04)]">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Bundle</div>
                  <div className="font-mono text-base font-bold text-foreground">{detail.bundle_number}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Work Order</div>
                  <div className="text-sm font-semibold text-foreground">{detail.wo_number_snapshot}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Model · Size</div>
                  <div className="text-sm font-semibold text-foreground">{detail.model_code} · {detail.size_code}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Qty</div>
                  <div className="text-base font-bold text-foreground">{detail.qty} pcs</div>
                </div>
              </div>
            </GlassPanel>

            {/* Status & progress */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <GlassPanel className="p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Status Saat Ini</div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={detail.status} />
                  <span className="text-xs text-muted-foreground">di proses</span>
                  <span className="text-xs font-semibold text-foreground">{detail.current_process_code || '—'}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3 text-[11px]">
                  <div>
                    <div className="text-muted-foreground">Pass</div>
                    <div className="text-emerald-400 font-bold">{detail.qty_pass || 0}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Fail</div>
                    <div className="text-red-400 font-bold">{detail.qty_fail || 0}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Sisa</div>
                    <div className="text-amber-400 font-bold">{detail.qty_remaining ?? detail.qty}</div>
                  </div>
                </div>
              </GlassPanel>

              <GlassPanel className="p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Urutan Proses</div>
                <div className="flex items-center flex-wrap gap-1.5">
                  {(detail.process_sequence || []).map((p) => {
                    const isCurrent = p.id === detail.current_process_id;
                    return (
                      <span
                        key={p.id}
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                          isCurrent
                            ? 'bg-[hsl(var(--primary)/0.15)] text-[hsl(var(--primary))] border border-[hsl(var(--primary)/0.35)]'
                            : 'bg-[var(--glass-bg)] text-muted-foreground border border-[var(--glass-border)]'
                        }`}
                      >
                        {p.code}
                      </span>
                    );
                  })}
                </div>
              </GlassPanel>
            </div>

            {/* History timeline */}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Histori Event (Timeline)</div>
              <div className="space-y-2">
                {(detail.history || []).slice().reverse().map((h, i) => (
                  <GlassPanel key={i} className="p-2.5">
                    <div className="flex items-start gap-2">
                      <div className="w-6 h-6 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] grid place-items-center flex-shrink-0 text-[10px] font-bold text-foreground">
                        {(detail.history.length - i)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs font-semibold text-foreground">{h.event}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {h.at ? new Date(h.at).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                          </div>
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {h.by && <span className="mr-2">oleh <b className="text-foreground/80">{h.by}</b></span>}
                          {h.qty != null && <span className="mr-2">qty <b className="text-foreground/80">{h.qty}</b></span>}
                        </div>
                        {h.notes && <div className="text-[11px] text-muted-foreground/80 mt-1">{h.notes}</div>}
                      </div>
                    </div>
                  </GlassPanel>
                ))}
              </div>
            </div>

            {/* Parent bundle info */}
            {detail.parent_bundle_id && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-400/5 border border-amber-300/25 text-xs">
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                <span className="text-foreground/80">
                  Bundle ini adalah hasil <b>split</b> dari bundle parent.
                  <span className="font-mono text-muted-foreground ml-2">(parent: {detail.parent_bundle_id})</span>
                </span>
              </div>
            )}
          </div>
        </Modal>
      )}
      </>
      )}
    </div>
  );
}
