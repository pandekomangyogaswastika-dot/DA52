import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Activity, RefreshCw, Package, Scissors, Shirt, ClipboardCheck,
  PackageCheck, Truck, Link2, AlertTriangle, CheckCircle2, ChevronRight,
  ExternalLink, Info, ArrowRight, Zap, Warehouse
} from 'lucide-react';
import { GlassCard } from '@/components/ui/glass';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { PageHeader } from './moduleAtoms';
import { fetchMaklonOrders } from '@/lib/maklonOrderAdapter';
import MaklonMaterialIssuePanel from './MaklonMaterialIssuePanel';

// ─── STAGE CONFIG ────────────────────────────────────────────────────────────
const STAGE_CONFIG = {
  draft:          { label: 'Draft',         icon: Package,        color: 'text-slate-400 bg-slate-500/10 border-slate-400/30',   pct: 0 },
  confirmed:      { label: 'Dikonfirmasi',  icon: Package,        color: 'text-blue-400 bg-blue-500/10 border-blue-400/30',      pct: 5 },
  material_ready: { label: 'Material Siap', icon: Package,        color: 'text-cyan-400 bg-cyan-500/10 border-cyan-400/30',      pct: 10 },
  cutting:        { label: 'Cutting',       icon: Scissors,       color: 'text-violet-400 bg-violet-500/10 border-violet-400/30', pct: 30 },
  sewing:         { label: 'Sewing',        icon: Shirt,          color: 'text-purple-400 bg-purple-500/10 border-purple-400/30', pct: 50 },
  qc:             { label: 'QC',            icon: ClipboardCheck, color: 'text-amber-400 bg-amber-500/10 border-amber-400/30',   pct: 70 },
  packing:        { label: 'Packing',       icon: PackageCheck,   color: 'text-orange-400 bg-orange-500/10 border-orange-400/30', pct: 85 },
  completed:      { label: 'Selesai',       icon: Truck,          color: 'text-green-400 bg-green-500/10 border-green-400/30',   pct: 100 },
  invoiced:       { label: 'Ditagih',       icon: Truck,          color: 'text-emerald-400 bg-emerald-500/10 border-emerald-400/30', pct: 100 },
};

const STAGES_ORDER = ['confirmed', 'material_ready', 'cutting', 'sewing', 'qc', 'packing', 'completed'];

const WO_STATUS_COLOR = {
  draft:          'text-slate-400 bg-slate-500/10 border-slate-400/30',
  released:       'text-blue-400 bg-blue-500/10 border-blue-400/30',
  in_production:  'text-violet-400 bg-violet-500/10 border-violet-400/30',
  completed:      'text-green-400 bg-green-500/10 border-green-400/30',
  cancelled:      'text-red-400 bg-red-500/10 border-red-400/30',
};
const WO_STATUS_LABEL = {
  draft: 'Draft', released: 'Released', in_production: 'In Produksi',
  completed: 'Selesai', cancelled: 'Dibatalkan',
};

// ─── COMPONENTS ────────────────────────────────────────────────────────────
function StageBadge({ status }) {
  const c = STAGE_CONFIG[status] || STAGE_CONFIG.draft;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${c.color}`}>
      <c.icon className="w-3 h-3" />{c.label}
    </span>
  );
}

function WoBadge({ status }) {
  const color = WO_STATUS_COLOR[status] || WO_STATUS_COLOR.draft;
  const label = WO_STATUS_LABEL[status] || status;
  return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${color}`}>{label}</span>;
}

// ─── STAGE QTY INPUT DIALOG ──────────────────────────────────────────────────────
function StageQtyDialog({ order, stage, onClose, onSuccess, headers }) {
  const stageConfig = STAGE_CONFIG[stage] || {};
  const sq = order.stage_qty || {};
  const [vals, setVals] = useState({
    qty_in:   sq.cutting_input  || '',
    qty_out:  stage === 'cutting' ? (sq.cutting_output  || '') :
              stage === 'sewing'  ? (sq.sewing_output   || '') :
              stage === 'packing' ? (sq.packing_output  || '') : '',
    qty_pass: sq.qc_pass  || '',
    qty_fail: sq.qc_fail  || '',
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const payload = { stage };
      if (stage === 'cutting') {
        if (vals.qty_in  !== '') payload.qty_in  = Number(vals.qty_in);
        if (vals.qty_out !== '') payload.qty_out = Number(vals.qty_out);
      } else if (stage === 'sewing') {
        if (vals.qty_out !== '') payload.qty_out = Number(vals.qty_out);
      } else if (stage === 'qc') {
        if (vals.qty_pass !== '') payload.qty_pass = Number(vals.qty_pass);
        if (vals.qty_fail !== '') payload.qty_fail = Number(vals.qty_fail);
      } else if (stage === 'packing') {
        if (vals.qty_out !== '') payload.qty_out = Number(vals.qty_out);
      }
      const r = await fetch(`/api/dewi/maklon/orders/${order.id}/stage-qty`, {
        method: 'PUT', headers, body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const e = await r.json();
        throw new Error(e.detail || 'Gagal menyimpan');
      }
      const data = await r.json();
      toast.success(`Qty ${stageConfig.label} diperbarui`);
      onSuccess(data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {stageConfig.icon && <stageConfig.icon className="w-4 h-4" />}
            Input Qty — {stageConfig.label}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="text-xs text-foreground/50 flex items-center gap-2 bg-foreground/5 p-2 rounded">
            <Info className="w-3.5 h-3.5 shrink-0" />
            Target: <strong>{order.qty_ordered} pcs</strong>
          </div>

          {stage === 'cutting' && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">Input ke Cutting (pcs)</Label>
                <Input type="number" min="0" value={vals.qty_in} onChange={e => setVals(p=>({...p,qty_in:e.target.value}))} placeholder="0" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Output Cutting / Siap Jahit (pcs)</Label>
                <Input type="number" min="0" value={vals.qty_out} onChange={e => setVals(p=>({...p,qty_out:e.target.value}))} placeholder="0" />
              </div>
            </>
          )}
          {stage === 'sewing' && (
            <div className="space-y-1.5">
              <Label className="text-xs">Output Jahit / Siap QC (pcs)</Label>
              <Input type="number" min="0" value={vals.qty_out} onChange={e => setVals(p=>({...p,qty_out:e.target.value}))} placeholder="0" />
            </div>
          )}
          {stage === 'qc' && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs text-green-400">QC Lolos / Pass (pcs)</Label>
                <Input type="number" min="0" value={vals.qty_pass} onChange={e => setVals(p=>({...p,qty_pass:e.target.value}))} placeholder="0" className="border-green-500/30 focus:border-green-500/60" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-red-400">QC Gagal / Fail (pcs)</Label>
                <Input type="number" min="0" value={vals.qty_fail} onChange={e => setVals(p=>({...p,qty_fail:e.target.value}))} placeholder="0" className="border-red-500/30 focus:border-red-500/60" />
              </div>
              {vals.qty_pass !== '' && vals.qty_fail !== '' && (
                <div className="text-xs text-foreground/50 bg-foreground/5 p-2 rounded">
                  Reject rate: {(Number(vals.qty_fail) / (Number(vals.qty_pass) + Number(vals.qty_fail) || 1) * 100).toFixed(1)}%
                </div>
              )}
            </>
          )}
          {stage === 'packing' && (
            <div className="space-y-1.5">
              <Label className="text-xs">Output Packing / Siap Kirim (pcs)</Label>
              <Input type="number" min="0" value={vals.qty_out} onChange={e => setVals(p=>({...p,qty_out:e.target.value}))} placeholder="0" />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Batal</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── STAGE ADVANCE CONFIRM DIALOG ───────────────────────────────────────────────
function StageAdvanceDialog({ fromStage, toStage, order, headers, onClose, onSuccess }) {
  const [force, setForce] = useState(false);
  const [loading, setLoading] = useState(false);
  const [gateError, setGateError] = useState(null);

  const sq = order.stage_qty || {};
  const qty = order.qty_ordered;

  // Check gate conditions locally
  const checkGate = () => {
    if (toStage === 'sewing' && !(sq.cutting_output > 0)) return `Cutting output belum diinput (0/${qty})`;
    if (toStage === 'qc' && !(sq.sewing_output > 0)) return `Sewing output belum diinput (0/${qty})`;
    if (toStage === 'packing' && !(sq.qc_pass > 0)) return `QC Pass belum diinput (0/${qty})`;
    if (toStage === 'completed' && !(sq.packing_output > 0)) return `Packing output belum diinput (0/${qty})`;
    return null;
  };

  const localGate = checkGate();

  const advance = async (forceFlag) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/dewi/maklon/orders/${order.id}/status`, {
        method: 'PUT', headers,
        body: JSON.stringify({ status: toStage, force: forceFlag }),
      });
      if (!r.ok) {
        const e = await r.json();
        if (r.status === 422) {
          setGateError(e.detail);
          return;
        }
        throw new Error(e.detail || 'Gagal update status');
      }
      const data = await r.json();
      toast.success(`Status → ${STAGE_CONFIG[toStage]?.label || toStage}`);
      onSuccess(data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Maju ke Tahap Berikutnya?</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex items-center gap-3 text-sm">
            <StageBadge status={fromStage} />
            <ArrowRight className="w-4 h-4 text-foreground/40" />
            <StageBadge status={toStage} />
          </div>
          {(gateError || localGate) && (
            <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-xs text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <div>
                <div className="font-semibold mb-1">Stage Gate Peringatan</div>
                <div>{gateError || localGate}</div>
                <div className="mt-2 flex items-center gap-2">
                  <input type="checkbox" id="force-cb" checked={force} onChange={e => setForce(e.target.checked)} />
                  <label htmlFor="force-cb" className="cursor-pointer text-amber-200">Lanjutkan paksa (override)</label>
                </div>
              </div>
            </div>
          )}
          {!(gateError || localGate) && (
            <p className="text-xs text-foreground/60">Konfirmasi pindah ke tahap <strong>{STAGE_CONFIG[toStage]?.label}</strong>?</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Batal</Button>
          <Button
            onClick={() => advance((gateError || localGate) ? force : false)}
            disabled={loading || ((gateError || localGate) && !force)}
            className={localGate && !force ? 'opacity-50' : ''}
          >
            {loading ? 'Memproses...' : 'Konfirmasi'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── MAIN MODULE ────────────────────────────────────────────────────────────
export default function MaklonProductionTracking({ token }) {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }), [token]);

  const [orders, setOrders] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [prodDetail, setProdDetail] = useState(null);
  const [qcData, setQcData] = useState({ checks: [], stages_summary: {} });
  const [samples, setSamples] = useState([]);
  const [loading, setLoading] = useState(false);
  const [stageQtyDialog, setStageQtyDialog] = useState(null);   // stage string
  const [advanceDialog, setAdvanceDialog] = useState(null);     // { from, to }
  const [loadingDetail, setLoadingDetail] = useState(false);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      // P1.B cutover: list from /pos via adapter; detail/stage-qty/status stay on legacy /orders
      // because PO doesn't have the stage_qty workflow that this tracker uses.
      const all = await fetchMaklonOrders(headers);
      setOrders(all.filter(o => !['cancelled', 'draft'].includes(o.status)));
    } catch (e) { toast.error('Gagal memuat order'); }
    finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const loadDetail = useCallback(async (o) => {
    setSelectedOrder(o);
    setLoadingDetail(true);
    try {
      const [prodR, qcR, sampR] = await Promise.all([
        fetch(`/api/dewi/maklon/orders/${o.id}/production-detail`, { headers }),
        fetch(`/api/dewi/maklon/qc/by-order/${o.id}`, { headers }),
        fetch(`/api/dewi/maklon/samples/by-order/${o.id}`, { headers }),
      ]);
      if (prodR.ok) setProdDetail(await prodR.json());
      else setProdDetail({ order: o, linked_wos: [], stage_qty: o.stage_qty || {}, sync_mode: 'manual', wo_count: 0 });
      if (qcR.ok) setQcData(await qcR.json()); else setQcData({ checks: [], stages_summary: {} });
      if (sampR.ok) setSamples(await sampR.json()); else setSamples([]);
    } catch (e) { console.warn(e); }
    finally { setLoadingDetail(false); }
  }, [headers]);

  const refreshDetail = useCallback(async () => {
    if (!selectedOrder) return;
    // Re-fetch both list (from /pos) and detail (still legacy because stage_qty workflow)
    const [allOrders, prodR] = await Promise.all([
      fetchMaklonOrders(headers),
      fetch(`/api/dewi/maklon/orders/${selectedOrder.id}/production-detail`, { headers }),
    ]);
    setOrders(allOrders.filter(o => !['cancelled', 'draft'].includes(o.status)));
    const updated = allOrders.find(o => o.id === selectedOrder.id);
    if (updated) setSelectedOrder(updated);
    if (prodR.ok) setProdDetail(await prodR.json());
  }, [headers, selectedOrder]);

  const handleStageQtySuccess = async (data) => {
    setStageQtyDialog(null);
    await refreshDetail();
  };

  const handleAdvanceSuccess = async (data) => {
    setAdvanceDialog(null);
    await refreshDetail();
  };

  const currentOrder = prodDetail?.order || selectedOrder;
  const sq = prodDetail?.stage_qty || {};
  const linkedWos = prodDetail?.linked_wos || [];
  const syncMode = prodDetail?.sync_mode || 'manual';

  const currentStageIdx = currentOrder ? STAGES_ORDER.indexOf(currentOrder.status) : -1;
  const nextStage = currentStageIdx >= 0 && currentStageIdx < STAGES_ORDER.length - 1
    ? STAGES_ORDER[currentStageIdx + 1] : null;

  const isTerminal = currentOrder && ['completed', 'invoiced', 'cancelled'].includes(currentOrder.status);

  // Stage qty display rows
  const stageRows = [
    { stage: 'cutting',  label: 'Cutting',  items: [
        { key: 'cutting_input',  label: 'Input',  val: sq.cutting_input },
        { key: 'cutting_output', label: 'Output', val: sq.cutting_output },
      ] },
    { stage: 'sewing',   label: 'Sewing',   items: [
        { key: 'sewing_output',  label: 'Output', val: sq.sewing_output },
      ] },
    { stage: 'qc',       label: 'QC',       items: [
        { key: 'qc_pass', label: 'Pass', val: sq.qc_pass, color: 'text-green-400' },
        { key: 'qc_fail', label: 'Fail', val: sq.qc_fail, color: 'text-red-400' },
      ] },
    { stage: 'packing',  label: 'Packing',  items: [
        { key: 'packing_output', label: 'Output', val: sq.packing_output },
      ] },
  ];

  return (
    <div className="p-6 space-y-6" data-testid="maklon-tracking">
      <PageHeader
        title="Tracking Produksi Maklon"
        subtitle="Monitor & input progress per tahap — terintegrasi dengan Work Order produksi"
        icon={Activity}
        actions={
          <Button size="sm" variant="outline" onClick={fetchOrders} className="gap-2" data-testid="tracking-refresh-btn">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-5">
        {/* ── Order List ── */}
        <GlassCard className="p-4 max-h-[780px] overflow-y-auto space-y-1.5">
          <h3 className="text-xs font-semibold text-foreground/60 uppercase tracking-wider mb-3">
            Order Aktif ({orders.length})
          </h3>
          {loading ? (
            <div className="text-center py-10 text-foreground/40 text-sm">Memuat...</div>
          ) : orders.length === 0 ? (
            <div className="text-center py-10 text-foreground/40 text-sm">Belum ada order aktif</div>
          ) : (
            orders.map(o => {
              const c = STAGE_CONFIG[o.status] || STAGE_CONFIG.draft;
              const active = selectedOrder?.id === o.id;
              const woCount = (o.linked_wo_ids || []).length;
              return (
                <button
                  key={o.id}
                  onClick={() => loadDetail(o)}
                  className={`w-full text-left rounded-xl border p-3 transition-all ${
                    active ? 'bg-primary/10 border-primary/40 shadow-sm' : 'bg-white/3 border-white/8 hover:bg-white/5'
                  }`}
                  data-testid={`tracking-order-${o.order_code}`}
                >
                  <div className="flex justify-between items-start mb-1.5">
                    <span className="font-mono text-[10px] text-foreground/50">{o.order_code}</span>
                    <div className="flex items-center gap-1">
                      {woCount > 0 && (
                        <span className="text-[9px] bg-blue-500/20 border border-blue-400/30 text-blue-300 rounded px-1.5 py-0.5 flex items-center gap-0.5">
                          <Link2 className="w-2.5 h-2.5" />{woCount} WO
                        </span>
                      )}
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${c.color}`}>{c.label}</span>
                    </div>
                  </div>
                  <div className="text-sm font-semibold text-foreground">{o.product_name}</div>
                  <div className="text-xs text-foreground/50">{o.client_name} · {o.qty_ordered} pcs</div>
                  <div className="mt-2.5 space-y-1">
                    <div className="flex justify-between text-[10px] text-foreground/40">
                      <span>Progress</span><span>{o.progress_percentage || 0}%</span>
                    </div>
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-violet-400 to-purple-500 transition-all duration-500"
                        style={{ width: `${o.progress_percentage || 0}%` }}
                      />
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </GlassCard>

        {/* ── Detail Panel ── */}
        <div className="space-y-4 min-w-0">
          {!selectedOrder ? (
            <GlassCard className="p-14 text-center text-foreground/50">
              <Activity className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <div className="text-sm">Pilih order untuk melihat detail tracking</div>
            </GlassCard>
          ) : loadingDetail ? (
            <GlassCard className="p-14 text-center text-foreground/40 text-sm">Memuat detail...</GlassCard>
          ) : currentOrder ? (
            <>
              {/* Header Card */}
              <GlassCard className="p-5 space-y-4">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-mono text-[10px] text-foreground/40 mb-0.5">{currentOrder.order_code}</div>
                    <h3 className="text-xl font-bold text-foreground">{currentOrder.product_name}</h3>
                    <div className="text-sm text-foreground/50 mt-0.5">
                      {currentOrder.client_name} · {currentOrder.qty_ordered} pcs · Deadline {currentOrder.deadline_date}
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <StageBadge status={currentOrder.status} />
                      {syncMode === 'wo' && (
                        <span className="text-[10px] bg-blue-500/15 border border-blue-400/25 text-blue-300 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <Zap className="w-2.5 h-2.5" /> WO Sync Aktif
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-4xl font-bold text-primary">{currentOrder.progress_percentage || 0}%</div>
                    <div className="text-xs text-foreground/40">Progress</div>
                  </div>
                </div>

                {/* Stage Timeline */}
                <div className="grid grid-cols-7 gap-1">
                  {STAGES_ORDER.map((st, idx) => {
                    const c = STAGE_CONFIG[st];
                    const stIdx = STAGES_ORDER.indexOf(currentOrder.status);
                    const isDone = idx <= stIdx;
                    const isCurrent = idx === stIdx;
                    return (
                      <div key={st} className="flex flex-col items-center gap-1">
                        {idx > 0 && (
                          <div className="hidden" />
                        )}
                        <motion.div
                          initial={{ scale: 0.85, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ delay: 0.04 * idx }}
                          className={`w-9 h-9 rounded-full border-2 flex items-center justify-center transition-all ${
                            isDone ? c.color : 'border-white/10 text-foreground/20 bg-white/3'
                          } ${isCurrent ? 'ring-2 ring-offset-2 ring-offset-background ring-primary/60 scale-110' : ''}`}
                        >
                          <c.icon className="w-4 h-4" />
                        </motion.div>
                        <div className={`text-[8px] text-center leading-tight ${
                          isDone ? 'text-foreground/70' : 'text-foreground/25'
                        }`}>{c.label}</div>
                      </div>
                    );
                  })}
                </div>

                {/* Next Stage Action */}
                {!isTerminal && nextStage && (
                  <div className="flex items-center justify-between pt-3 border-t border-white/5">
                    <div className="text-xs text-foreground/50">Tahap selanjutnya:</div>
                    <Button
                      size="sm"
                      className="gap-2 text-xs"
                      onClick={() => setAdvanceDialog({ from: currentOrder.status, to: nextStage })}
                    >
                      Maju ke {STAGE_CONFIG[nextStage]?.label}
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )}
                {isTerminal && (
                  <div className="pt-3 border-t border-white/5">
                    <div className="flex items-center gap-2 text-xs text-green-400">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Order selesai — {currentOrder.completion_date || ''}
                    </div>
                  </div>
                )}
              </GlassCard>

              {/* ── Stage Qty Input Cards ── */}
              <GlassCard className="p-5">
                <div className="flex justify-between items-center mb-4">
                  <h4 className="text-sm font-semibold text-foreground/80">Input Qty per Tahap</h4>
                  <div className="text-xs text-foreground/40">Target: {currentOrder.qty_ordered} pcs</div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {stageRows.map(({ stage, label, items }) => {
                    const stageIdx = STAGES_ORDER.indexOf(stage);
                    const currentIdx2 = STAGES_ORDER.indexOf(currentOrder.status);
                    const isActive = currentIdx2 >= stageIdx;
                    const hasData = items.some(i => i.val > 0);
                    return (
                      <motion.div
                        key={stage}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`rounded-xl border p-3 space-y-2 transition-all ${
                          isActive
                            ? hasData
                              ? 'bg-primary/5 border-primary/25'
                              : 'bg-white/4 border-white/12 hover:border-white/20'
                            : 'bg-white/2 border-white/5 opacity-50'
                        }`}
                      >
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-semibold text-foreground/70">{label}</span>
                          {hasData && <CheckCircle2 className="w-3 h-3 text-green-400" />}
                        </div>
                        {items.map(item => (
                          <div key={item.key} className="flex justify-between text-xs">
                            <span className="text-foreground/40">{item.label}</span>
                            <span className={`font-bold ${item.color || 'text-foreground/80'}`}>
                              {item.val ?? '—'}
                            </span>
                          </div>
                        ))}
                        {isActive && !isTerminal && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full h-6 text-[10px] mt-1"
                            onClick={() => setStageQtyDialog(stage)}
                          >
                            Input
                          </Button>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
                {/* QC Rate summary */}
                {(sq.qc_pass > 0 || sq.qc_fail > 0) && (
                  <div className="mt-3 flex items-center gap-4 text-xs bg-foreground/5 rounded-lg p-2.5">
                    <span className="text-foreground/50">QC Summary:</span>
                    <span className="text-green-400 font-semibold">✓ Pass: {sq.qc_pass || 0}</span>
                    <span className="text-red-400 font-semibold">✗ Fail: {sq.qc_fail || 0}</span>
                    <span className="text-foreground/50">
                      Reject rate: {(((sq.qc_fail || 0) / ((sq.qc_pass || 0) + (sq.qc_fail || 0) || 1)) * 100).toFixed(1)}%
                    </span>
                  </div>
                )}
              </GlassCard>

              {/* ── Linked Work Orders ── */}
              <GlassCard className="p-5">
                <div className="flex justify-between items-center mb-4">
                  <h4 className="text-sm font-semibold text-foreground/80 flex items-center gap-2">
                    <Link2 className="w-4 h-4 text-blue-400" />
                    Work Order Terhubung ({linkedWos.length})
                  </h4>
                  {syncMode === 'manual' && (
                    <span className="text-[10px] text-foreground/40 bg-foreground/5 px-2 py-1 rounded">Mode Manual</span>
                  )}
                </div>
                {linkedWos.length === 0 ? (
                  <div className="text-center py-6 text-foreground/40 text-sm">
                    <Link2 className="w-6 h-6 mx-auto mb-2 opacity-30" />
                    {currentOrder.status === 'confirmed'
                      ? 'WO belum dibuat. Konfirmasi order akan otomatis membuat WO.'
                      : 'Tidak ada WO yang terhubung ke order ini.'}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {linkedWos.map(wo => (
                      <div
                        key={wo.id}
                        className="flex items-center justify-between rounded-lg border border-white/8 bg-white/3 px-3 py-2.5"
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-semibold text-foreground/80">{wo.wo_number}</span>
                            <WoBadge status={wo.status} />
                          </div>
                          <div className="text-[10px] text-foreground/40">
                            {wo.product_name_snapshot || currentOrder.product_name}
                            {wo.size_label && wo.size_label !== 'All' ? ` · Size: ${wo.size_label}` : ''}
                            {' · '}{wo.qty} pcs
                          </div>
                        </div>
                        <div className="text-right space-y-1">
                          <div className="text-sm font-bold text-primary">{wo.progress_pct || 0}%</div>
                          <div className="w-24 h-1 bg-white/10 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary/70 transition-all"
                              style={{ width: `${wo.progress_pct || 0}%` }}
                            />
                          </div>
                          <div className="text-[10px] text-foreground/40">{wo.completed_qty || 0}/{wo.qty} pcs</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </GlassCard>

              {/* ── QC & Samples Row ── */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <GlassCard className="p-4">
                  <h4 className="text-xs font-semibold text-foreground/60 uppercase tracking-wider mb-3">QC per Stage</h4>
                  {Object.keys(qcData.stages_summary || {}).length === 0 ? (
                    <div className="text-foreground/40 text-xs py-4 text-center">Belum ada QC tercatat</div>
                  ) : (
                    <div className="space-y-2">
                      {Object.entries(qcData.stages_summary).map(([st, d]) => (
                        <div key={st} className="flex items-center justify-between text-xs">
                          <Badge variant="outline" className="text-[10px]">{st}</Badge>
                          <div className="text-right">
                            <div className="text-foreground/70">{d.qty_passed}/{d.qty_inspected} pass</div>
                            <div className={`text-[10px] ${d.reject_rate_pct > 5 ? 'text-red-400' : 'text-green-400'}`}>
                              Reject {d.reject_rate_pct}%
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </GlassCard>
                <GlassCard className="p-4">
                  <h4 className="text-xs font-semibold text-foreground/60 uppercase tracking-wider mb-3">Samples ({samples.length})</h4>
                  {samples.length === 0 ? (
                    <div className="text-foreground/40 text-xs py-4 text-center">Belum ada sample</div>
                  ) : (
                    <div className="space-y-2">
                      {samples.map(s => (
                        <div key={s.id} className="flex items-center justify-between text-xs">
                          <div>
                            <div className="font-mono text-[10px] text-foreground/50">{s.sample_code}</div>
                            <div className="text-foreground/70">{s.product_name}</div>
                          </div>
                          <Badge variant="outline" className="text-[10px]">{s.status}</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </GlassCard>
              </div>

              {/* ── Material Issue Panel (GAP #4) ── */}
              {currentOrder && (
                <GlassCard className="p-5">
                  <MaklonMaterialIssuePanel order={currentOrder} headers={headers} />
                </GlassCard>
              )}
            </>
          ) : null}
        </div>
      </div>

      {/* Dialogs */}
      <AnimatePresence>
        {stageQtyDialog && (
          <StageQtyDialog
            order={prodDetail?.order || selectedOrder}
            stage={stageQtyDialog}
            headers={headers}
            onClose={() => setStageQtyDialog(null)}
            onSuccess={handleStageQtySuccess}
          />
        )}
        {advanceDialog && (
          <StageAdvanceDialog
            fromStage={advanceDialog.from}
            toStage={advanceDialog.to}
            order={prodDetail?.order || selectedOrder}
            headers={headers}
            onClose={() => setAdvanceDialog(null)}
            onSuccess={handleAdvanceSuccess}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
