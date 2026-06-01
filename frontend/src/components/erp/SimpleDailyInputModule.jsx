import { useState, useEffect, useCallback } from 'react';
import {
  PenLine, CheckCircle2, Trash2, RefreshCw, Info,
  ClipboardList, ChevronDown, AlertCircle, Clock,
  Scissors, Layers, ShieldCheck, Package, Loader2,
  Download, Bookmark, X, TrendingUp, Smartphone
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import useSimpleInputPresets from '@/hooks/useSimpleInputPresets';

/* ─────────────────────────────────────────────────────────────────────────────
   Input Harian Sederhana
   Mode tracking output tanpa scan bundle / tanpa line assignment.
   User cukup: pilih WO (opsional) → pilih tahap → ketik qty → simpan.
   Data masuk ke rahaza_wip_events (source='simple_input') — dashboard/
   laporan existing otomatis include data ini.
───────────────────────────────────────────────────────────────────────────── */

const STAGES = [
  { code: 'SEWING',    label: 'Jahit',      icon: Scissors,     color: 'bg-blue-500/15 border-blue-400/30 text-blue-300',     active: 'bg-blue-500 text-white border-blue-500' },
  { code: 'FINISHING', label: 'Finishing',  icon: Layers,       color: 'bg-purple-500/15 border-purple-400/30 text-purple-300', active: 'bg-purple-500 text-white border-purple-500' },
  { code: 'QC',        label: 'QC Final',   icon: ShieldCheck,  color: 'bg-amber-500/15 border-amber-400/30 text-amber-300',   active: 'bg-amber-500 text-white border-amber-500' },
  { code: 'PACKING',   label: 'Packing',    icon: Package,      color: 'bg-green-500/15 border-green-400/30 text-green-300',   active: 'bg-green-500 text-white border-green-500' },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function eventTypeLabel(type) {
  return type === 'qc_pass' ? 'Lolos' : type === 'qc_fail' ? 'Gagal' : 'Output';
}

function eventTypeColor(type) {
  if (type === 'qc_pass') return 'text-green-400';
  if (type === 'qc_fail') return 'text-red-400';
  return 'text-foreground';
}

// ─── Export CSV (Fitur 1) ─────────────────────────────────────────────────────
function exportCSV(history, date) {
  if (!history.length) return;
  const head = ['Tanggal', 'WO', 'Tahap', 'Tipe', 'Qty (pcs)', 'Catatan', 'Waktu'];
  const rows = history.map(ev => [
    date, ev.wo_number_display || '—', ev.process_code,
    eventTypeLabel(ev.event_type), ev.qty, ev.notes || '', fmtTime(ev.timestamp)
  ]);
  const csv = [head, ...rows]
    .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `produksi_${date}.csv`; a.click();
  URL.revokeObjectURL(url);
}

// ─── WO Progress Info (Fitur inline — ditampilkan saat WO dipilih) ────────────
function WOInfoBadge({ wo, historyToday, stage }) {
  if (!wo) return null;
  const target = wo.qty || 0;
  // Hitung output hari ini untuk WO ini dari histori (tanpa perlu API call tambahan)
  const todayOutput = historyToday
    .filter(ev => ev.work_order_id === wo.id && ev.process_code === stage && ev.event_type === 'output')
    .reduce((s, ev) => s + (ev.qty || 0), 0);
  const todayPass = historyToday
    .filter(ev => ev.work_order_id === wo.id && ev.process_code === stage && ev.event_type === 'qc_pass')
    .reduce((s, ev) => s + (ev.qty || 0), 0);
  const relevant = stage === 'QC' ? todayPass : todayOutput;
  const pct = target > 0 ? Math.min(100, Math.round((relevant / target) * 100)) : 0;

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/8 border border-primary/15 text-sm">
      <TrendingUp className="w-4 h-4 text-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center mb-1 text-xs">
          <span className="text-muted-foreground">Input hari ini ({STAGES.find(s=>s.code===stage)?.label})</span>
          <span className="font-semibold text-foreground">{relevant} / {target} pcs {pct > 0 && <span className="text-primary">({pct}%)</span>}</span>
        </div>
        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}

// ─── Preset Chips (Fitur 2) ───────────────────────────────────────────────────
function PresetChips({ presets, onApply, onRemove }) {
  if (!presets.length) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-semibold flex items-center gap-1">
        <Bookmark className="w-3 h-3" /> Preset Tersimpan
      </p>
      <div className="flex flex-wrap gap-2">
        {presets.map(p => (
          <div key={p.id} className="flex items-center gap-0 rounded-full border border-primary/25 bg-primary/10 text-xs overflow-hidden">
            <button
              type="button"
              onClick={() => onApply(p)}
              className="pl-3 pr-2 py-1.5 text-primary hover:text-white hover:bg-primary/40 transition-colors font-medium"
              data-testid={`preset-${p.id}`}
            >
              {p.label}
            </button>
            <button
              type="button"
              onClick={() => onRemove(p.id)}
              className="px-1.5 py-1.5 text-muted-foreground hover:text-red-400 transition-colors"
              title="Hapus preset"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Stage Button ─────────────────────────────────────────────────────────────
function StageButton({ stage, selected, onClick, mobile }) {
  const Icon = stage.icon;
  return (
    <button
      type="button"
      onClick={() => onClick(stage.code)}
      data-testid={`stage-btn-${stage.code}`}
      className={`flex flex-col items-center gap-1.5 rounded-xl border-2 transition-all font-medium
        ${mobile ? 'px-2 py-4 text-base' : 'px-4 py-3 text-sm'}
        ${selected ? stage.active + ' shadow-lg scale-105' : stage.color + ' hover:opacity-80'}`}
    >
      <Icon className={mobile ? 'w-7 h-7' : 'w-5 h-5'} />
      <span>{stage.label}</span>
    </button>
  );
}

// ─── Main Module ─────────────────────────────────────────────────────────────
export default function SimpleDailyInputModule({ token }) {
  const { presets, savePreset, removePreset } = useSimpleInputPresets();

  const [workOrders, setWorkOrders] = useState([]);
  const [history,    setHistory]    = useState([]);
  const [loadingWOs, setLoadingWOs] = useState(true);
  const [loadingHist,setLoadingHist]= useState(false);
  const [saving,     setSaving]     = useState(false);
  const [deleting,   setDeleting]   = useState(null);
  const [toast,      setToast]      = useState(null);
  const [mobileMode, setMobileMode] = useState(             // Fitur 3: mobile toggle
    () => localStorage.getItem('simple_input_mobile') === '1'
  );

  // Form state
  const [date,         setDate]         = useState(todayIso());
  const [selectedWO,   setSelectedWO]   = useState('');
  const [stage,        setStage]        = useState('SEWING');
  const [qty,          setQty]          = useState('');
  const [qtyFail,      setQtyFail]      = useState('');
  const [notes,        setNotes]        = useState('');
  const [formErr,      setFormErr]      = useState('');

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // Derived: selected WO object
  const selectedWOObj = workOrders.find(wo => wo.id === selectedWO) || null;

  // Toggle mobile mode
  function toggleMobile() {
    setMobileMode(prev => {
      const next = !prev;
      localStorage.setItem('simple_input_mobile', next ? '1' : '0');
      return next;
    });
  }

  // ── Load WOs ──────────────────────────────────────────────────────────────
  const fetchWOs = useCallback(async () => {
    setLoadingWOs(true);
    try {
      const r = await fetch('/api/rahaza/work-orders?limit=300', { headers });
      if (r.ok) {
        const data = await r.json();
        setWorkOrders(Array.isArray(data) ? data : (data.items || []));
      }
    } finally { setLoadingWOs(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // ── Load History ──────────────────────────────────────────────────────────
  const fetchHistory = useCallback(async (d) => {
    setLoadingHist(true);
    try {
      const r = await fetch(`/api/rahaza/execution/simple-input/history?date=${d}`, { headers });
      if (r.ok) setHistory(await r.json());
      else setHistory([]);
    } finally { setLoadingHist(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { fetchWOs(); }, [fetchWOs]);
  useEffect(() => { fetchHistory(date); }, [fetchHistory, date]);

  // ── Show toast ───────────────────────────────────────────────────────────
  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  }

  // ── Validate & Submit ────────────────────────────────────────────────────
  async function handleSubmit(e) {
    e.preventDefault();
    setFormErr('');
    const qtyNum  = parseInt(qty, 10);
    const failNum = parseInt(qtyFail, 10) || 0;

    if (!stage) { setFormErr('Pilih tahap produksi terlebih dahulu.'); return; }
    if (!(qtyNum > 0)) { setFormErr('Jumlah (qty) harus lebih dari 0.'); return; }
    if (stage === 'QC' && failNum > qtyNum) {
      setFormErr(`Qty gagal (${failNum}) tidak boleh melebihi total (${qtyNum}).`);
      return;
    }

    setSaving(true);
    try {
      const body = {
        process_code:   stage,
        qty:            qtyNum,
        qty_fail:       stage === 'QC' ? failNum : 0,
        work_order_id:  selectedWO || null,
        input_date:     date,
        notes:          notes.trim(),
      };
      const r = await fetch('/api/rahaza/execution/simple-input', {
        method: 'POST', headers, body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.detail || 'Gagal menyimpan.');
      }
      showToast('ok', `✅ Tersimpan! ${STAGES.find(s=>s.code===stage)?.label} — ${qtyNum} pcs`);
      // Auto-simpan preset jika WO dipilih
      if (selectedWO && selectedWOObj) {
        savePreset({
          id: `${selectedWO}-${stage}`,
          label: `${selectedWOObj.wo_number} · ${STAGES.find(s=>s.code===stage)?.label}`,
          wo_id: selectedWO,
          wo_number: selectedWOObj.wo_number,
          process_code: stage,
        });
      }
      setQty(''); setQtyFail(''); setNotes('');
      fetchHistory(date);
    } catch (err) {
      showToast('err', err.message);
    } finally {
      setSaving(false);
    }
  }

  // ── Apply preset ──────────────────────────────────────────────────────────
  function applyPreset(preset) {
    setSelectedWO(preset.wo_id || '');
    setStage(preset.process_code);
    setQty(''); setQtyFail(''); setFormErr('');
  }

  // ── Delete entry ─────────────────────────────────────────────────────────
  async function handleDelete(eventId) {
    if (!window.confirm('Hapus entry ini?')) return;
    setDeleting(eventId);
    try {
      const r = await fetch(`/api/rahaza/execution/simple-input/${eventId}`, {
        method: 'DELETE', headers,
      });
      if (!r.ok) throw new Error('Gagal menghapus.');
      showToast('ok', 'Entry dihapus.');
      fetchHistory(date);
    } catch (err) {
      showToast('err', err.message);
    } finally {
      setDeleting(null);
    }
  }

  // ── Summarize history ────────────────────────────────────────────────────
  const summary = {};
  history.forEach(ev => {
    const k = ev.process_code;
    if (!summary[k]) summary[k] = { output: 0, pass: 0, fail: 0 };
    if (ev.event_type === 'output')   summary[k].output += ev.qty;
    if (ev.event_type === 'qc_pass')  summary[k].pass   += ev.qty;
    if (ev.event_type === 'qc_fail')  summary[k].fail   += ev.qty;
  });

  return (
    <div className="space-y-6 p-4 max-w-3xl mx-auto" data-testid="simple-daily-input-module">

      {/* ── Toast ─────────────────────────────────────────────────────────── */}
      {toast && (
        <div className={`fixed top-5 right-5 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-xl border
          ${toast.type === 'ok'
            ? 'bg-green-500/20 border-green-400/30 text-green-200'
            : 'bg-red-500/20 border-red-400/30 text-red-200'}`}
          data-testid="toast-msg"
        >
          {toast.type === 'ok' ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <AlertCircle className="w-5 h-5 shrink-0" />}
          <span className="text-sm font-medium">{toast.msg}</span>
        </div>
      )}

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <PenLine className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold text-foreground">Input Harian Sederhana</h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/15 border border-primary/25 text-primary uppercase tracking-wide">
              Tanpa Bundle
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Input output produksi per Work Order tanpa scan bundle.
            Data langsung masuk ke dashboard &amp; laporan produksi.
          </p>
        </div>
        {/* Mobile toggle (Fitur 3) */}
        <button
          type="button"
          onClick={toggleMobile}
          title={mobileMode ? 'Matikan mode mobile' : 'Mode mobile (tombol besar untuk HP)'}
          data-testid="btn-mobile-toggle"
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-all
            ${mobileMode
              ? 'bg-primary/20 border-primary/40 text-primary'
              : 'bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10'}`}
        >
          <Smartphone className="w-4 h-4" />
          <span className="hidden sm:inline">{mobileMode ? 'Mode HP Aktif' : 'Mode HP'}</span>
        </button>
      </div>

      {/* ── Info Banner ───────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-500/10 border border-blue-400/20">
        <Info className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
        <div className="text-sm text-blue-200 space-y-1">
          <p className="font-semibold text-blue-100">Mode ini bisa berjalan beriringan dengan mode Bundle Scan</p>
          <p className="text-blue-300">
            Tidak perlu scanner, tidak perlu assign lini. Cukup pilih tahap, isi jumlah, simpan.
            Data tetap masuk ke <code className="text-blue-200 bg-blue-900/30 px-1 rounded">rahaza_wip_events</code> sehingga
            semua dashboard, Control Tower, dan laporan produksi otomatis menampilkan data ini.
          </p>
        </div>
      </div>

      {/* ── Preset Chips (Fitur 2) ────────────────────────────────────────── */}
      <PresetChips presets={presets} onApply={applyPreset} onRemove={removePreset} />

      {/* ── Form ──────────────────────────────────────────────────────────── */}
      <form onSubmit={handleSubmit}
        className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-5"
        data-testid="simple-input-form"
      >
        <h2 className="font-semibold text-foreground text-base flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-primary" /> Tambah Input Baru
        </h2>

        {/* Tanggal + WO */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tanggal</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              max={todayIso()}
              data-testid="input-date"
              className="w-full px-3 py-2.5 rounded-lg bg-white/8 border border-white/15 text-foreground text-sm
                focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Work Order <span className="font-normal text-muted-foreground/70">(opsional)</span>
            </label>
            <div className="relative">
              {loadingWOs
                ? <div className="flex items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" /> Memuat WO...
                  </div>
                : (
                  <select
                    value={selectedWO}
                    onChange={e => setSelectedWO(e.target.value)}
                    data-testid="wo-select"
                    className="w-full px-3 py-2.5 rounded-lg bg-white/8 border border-white/15 text-foreground text-sm
                      focus:outline-none focus:ring-2 focus:ring-primary/50 appearance-none pr-8"
                  >
                    <option value="">— Tanpa Work Order —</option>
                    {workOrders.map(wo => (
                      <option key={wo.id} value={wo.id}>
                        {wo.wo_number || wo.id} {wo.model_name ? `· ${wo.model_name}` : ''}
                      </option>
                    ))}
                  </select>
                )}
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            </div>
          </div>
        </div>

        {/* WO Info Badge — muncul saat WO dipilih (Fitur inline) */}
        {selectedWOObj && (
          <WOInfoBadge wo={selectedWOObj} historyToday={history} stage={stage} />
        )}

        {/* Pilih Tahap */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tahap Produksi</label>
          <div className={`grid gap-2 ${mobileMode ? 'grid-cols-2' : 'grid-cols-4'}`}>
            {STAGES.map(s => (
              <StageButton
                key={s.code}
                stage={s}
                selected={stage === s.code}
                onClick={setStage}
                mobile={mobileMode}
              />
            ))}
          </div>
        </div>

        {/* Qty Fields */}
        {stage !== 'QC'
          ? (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Jumlah Output (pcs)
              </label>
              <input
                type="number"
                min={1}
                value={qty}
                onChange={e => setQty(e.target.value)}
                placeholder="cth: 150"
                data-testid="input-qty"
                inputMode="numeric"
                className={`w-full px-3 rounded-lg bg-white/8 border border-white/15 text-foreground
                  focus:outline-none focus:ring-2 focus:ring-primary/50
                  ${mobileMode ? 'py-4 text-2xl text-center' : 'py-2.5 text-sm'}`}
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-green-400 uppercase tracking-wide flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Lolos QC (pcs)
                </label>
                <input
                  type="number"
                  min={0}
                  value={qty}
                  onChange={e => setQty(e.target.value)}
                  placeholder="cth: 140"
                  data-testid="input-qty-pass"
                  inputMode="numeric"
                  className={`w-full px-3 rounded-lg bg-green-500/10 border border-green-400/25 text-foreground
                    focus:outline-none focus:ring-2 focus:ring-green-500/40
                    ${mobileMode ? 'py-4 text-2xl text-center' : 'py-2.5 text-sm'}`}
                />
                <p className="text-[11px] text-muted-foreground">Jumlah total pcs yang di-QC</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-red-400 uppercase tracking-wide flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" /> Gagal / Rework (pcs)
                </label>
                <input
                  type="number"
                  min={0}
                  value={qtyFail}
                  onChange={e => setQtyFail(e.target.value)}
                  placeholder="cth: 10"
                  data-testid="input-qty-fail"
                  inputMode="numeric"
                  className={`w-full px-3 rounded-lg bg-red-500/10 border border-red-400/25 text-foreground
                    focus:outline-none focus:ring-2 focus:ring-red-500/40
                    ${mobileMode ? 'py-4 text-2xl text-center' : 'py-2.5 text-sm'}`}
                />
                <p className="text-[11px] text-muted-foreground">Yang tidak lolos (akan masuk rework)</p>
              </div>
              {qty && qtyFail && parseInt(qty) > 0 && (
                <div className="col-span-2 flex gap-4 text-xs text-muted-foreground bg-white/5 rounded-lg px-3 py-2">
                  <span className="text-green-400 font-medium">Lolos: {Math.max(0, parseInt(qty) - (parseInt(qtyFail)||0))} pcs</span>
                  <span className="text-red-400 font-medium">Gagal: {parseInt(qtyFail)||0} pcs</span>
                  <span>FPY: {qty > 0 ? Math.round(((parseInt(qty)-(parseInt(qtyFail)||0))/parseInt(qty))*100) : 0}%</span>
                </div>
              )}
            </div>
          )
        }

        {/* Catatan */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Catatan <span className="font-normal text-muted-foreground/70">(opsional)</span>
          </label>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="cth: Shift pagi, mesin A ada kendala"
            data-testid="input-notes"
            className="w-full px-3 py-2.5 rounded-lg bg-white/8 border border-white/15 text-foreground text-sm
              focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        {/* Error */}
        {formErr && (
          <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-400/20 rounded-lg px-3 py-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {formErr}
          </div>
        )}

        {/* Submit */}
        <Button
          type="submit"
          disabled={saving}
          data-testid="btn-simpan"
          className="w-full py-3 text-sm font-semibold"
        >
          {saving
            ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Menyimpan...</>
            : <><CheckCircle2 className="w-4 h-4 mr-2" /> Simpan Input</>
          }
        </Button>
      </form>

      {/* ── Summary Hari Ini ──────────────────────────────────────────────── */}
      {Object.keys(summary).length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {STAGES.filter(s => summary[s.code]).map(s => {
            const sm = summary[s.code];
            const Icon = s.icon;
            return (
              <div key={s.code} className={`rounded-xl border p-3 ${s.color}`}>
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon className="w-4 h-4" />
                  <span className="text-xs font-semibold">{s.label}</span>
                </div>
                {s.code === 'QC'
                  ? <>
                      <div className="text-xl font-bold">{sm.pass + sm.fail} pcs</div>
                      <div className="text-[11px] mt-0.5">✅ {sm.pass} lolos · ❌ {sm.fail} gagal</div>
                    </>
                  : <div className="text-xl font-bold">{sm.output} pcs</div>
                }
              </div>
            );
          })}
        </div>
      )}

      {/* ── Riwayat ───────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
          <h2 className="font-semibold text-sm text-foreground flex items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            Riwayat — {fmtDate(date)}
            <span className="text-muted-foreground font-normal">({history.length} entry)</span>
          </h2>
          <div className="flex items-center gap-1">
            {/* Export CSV (Fitur 1) */}
            {history.length > 0 && (
              <button
                type="button"
                onClick={() => exportCSV(history, date)}
                title="Export CSV"
                data-testid="btn-export-csv"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs
                  bg-emerald-500/10 border border-emerald-400/20 text-emerald-300
                  hover:bg-emerald-500/20 transition-colors font-medium"
              >
                <Download className="w-3.5 h-3.5" /> CSV
              </button>
            )}
            <button
              type="button"
              onClick={() => fetchHistory(date)}
              disabled={loadingHist}
              className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-muted-foreground"
              data-testid="btn-refresh-history"
            >
              <RefreshCw className={`w-4 h-4 ${loadingHist ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {loadingHist
          ? <div className="flex items-center justify-center py-8 text-muted-foreground text-sm gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Memuat riwayat...
            </div>
          : history.length === 0
            ? <div className="text-center py-8 text-muted-foreground text-sm">
                Belum ada input untuk tanggal ini.
              </div>
            : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="history-table">
                  <thead>
                    <tr className="border-b border-white/8 text-xs text-muted-foreground uppercase tracking-wide">
                      <th className="px-4 py-2.5 text-left">WO</th>
                      <th className="px-4 py-2.5 text-left">Tahap</th>
                      <th className="px-4 py-2.5 text-right">Tipe</th>
                      <th className="px-4 py-2.5 text-right">Qty</th>
                      <th className="px-4 py-2.5 text-left">Catatan</th>
                      <th className="px-4 py-2.5 text-center">Waktu</th>
                      <th className="px-4 py-2.5 text-center">Hapus</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map(ev => (
                      <tr key={ev.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="px-4 py-2.5 font-mono text-xs text-primary">
                          {ev.wo_number_display || '—'}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full
                            ${STAGES.find(s=>s.code===ev.process_code)?.color || 'bg-white/10 text-foreground'}`}>
                            {ev.process_code}
                          </span>
                        </td>
                        <td className={`px-4 py-2.5 text-right text-xs font-medium ${eventTypeColor(ev.event_type)}`}>
                          {eventTypeLabel(ev.event_type)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-foreground">
                          {ev.qty} <span className="text-muted-foreground font-normal text-xs">pcs</span>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground text-xs max-w-[160px] truncate">
                          {ev.notes || '—'}
                        </td>
                        <td className="px-4 py-2.5 text-center text-xs text-muted-foreground">
                          {fmtTime(ev.timestamp)}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <button
                            type="button"
                            onClick={() => handleDelete(ev.id)}
                            disabled={deleting === ev.id}
                            data-testid={`btn-delete-${ev.id}`}
                            className="p-1.5 rounded-lg text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-all"
                          >
                            {deleting === ev.id
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : <Trash2 className="w-3.5 h-3.5" />
                            }
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
        }
      </div>
    </div>
  );
}
