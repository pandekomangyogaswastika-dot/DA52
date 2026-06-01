import { useState, useEffect, useCallback } from 'react';
import { Wrench, Package, XCircle, HelpCircle, AlertTriangle, CheckCircle2, Clock, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass';
import { toast } from 'sonner';

/* ─── AndonPanel — Operator help-request panel (Phase 18B) ────────────────────
   4 large red buttons + 2-tap confirm + notes + SLA feedback
 ──────────────────────────────────────────────────────────────────────────── */

const ANDON_TYPES = [
  {
    key: 'machine_breakdown',
    label: 'Mesin Rusak',
    sublabel: 'Kerusakan / kemacetan mesin',
    icon: Wrench,
    color: 'red',
    bg: 'bg-red-500/10 hover:bg-red-500/20 border-red-400/30',
    activeBg: 'bg-red-500/25 border-red-400/60',
    iconColor: 'text-red-400',
    badgeBg: 'bg-red-500',
  },
  {
    key: 'material_shortage',
    label: 'Material Habis',
    sublabel: 'Benang / bahan baku habis',
    icon: Package,
    color: 'amber',
    bg: 'bg-amber-500/10 hover:bg-amber-500/20 border-amber-400/30',
    activeBg: 'bg-amber-500/25 border-amber-400/60',
    iconColor: 'text-amber-400',
    badgeBg: 'bg-amber-500',
  },
  {
    key: 'quality_issue',
    label: 'Defect Banyak',
    sublabel: 'Banyak produk gagal QC',
    icon: XCircle,
    color: 'orange',
    bg: 'bg-orange-500/10 hover:bg-orange-500/20 border-orange-400/30',
    activeBg: 'bg-orange-500/25 border-orange-400/60',
    iconColor: 'text-orange-400',
    badgeBg: 'bg-orange-500',
  },
  {
    key: 'help',
    label: 'Minta Bantuan',
    sublabel: 'Butuh bantuan umum',
    icon: HelpCircle,
    color: 'blue',
    bg: 'bg-blue-500/10 hover:bg-blue-500/20 border-blue-400/30',
    activeBg: 'bg-blue-500/25 border-blue-400/60',
    iconColor: 'text-blue-400',
    badgeBg: 'bg-blue-500',
  },
];

export default function AndonPanel({ token, operatorId, lineId, processId, lineCode, processCode, onSuccess }) {
  const [confirm, setConfirm] = useState(null); // andon type key awaiting confirm
  const [notes, setNotes] = useState('');
  const [sending, setSending] = useState(false);
  const [lastEvent, setLastEvent] = useState(null);
  const [confirmTimer, setConfirmTimer] = useState(null);
  const [activeAndon, setActiveAndon] = useState(null); // current active andon for this operator

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // Check if operator already has an active andon
  const loadActiveAndon = useCallback(async () => {
    if (!operatorId) return;
    try {
      const r = await fetch('/api/rahaza/andon/active', { headers });
      if (!r.ok) return;
      const data = await r.json();
      const myAndon = (data.events || []).find(e => e.employee_id === operatorId);
      setActiveAndon(myAndon || null);
    } catch (_) {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operatorId, token]);

  useEffect(() => { loadActiveAndon(); }, [loadActiveAndon]);

  // Clear confirm after 5s if no action
  useEffect(() => {
    if (confirm) {
      const t = setTimeout(() => { setConfirm(null); setNotes(''); }, 5000);
      setConfirmTimer(t);
      return () => clearTimeout(t);
    }
  }, [confirm]);

  const handlePress = (typeKey) => {
    if (confirm === typeKey) {
      // Second tap → submit
      clearTimeout(confirmTimer);
      sendAndon(typeKey);
    } else {
      setConfirm(typeKey);
      setNotes('');
    }
  };

  const sendAndon = async (typeKey) => {
    setSending(true);
    try {
      const r = await fetch('/api/rahaza/andon', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: typeKey,
          employee_id: operatorId,
          line_id: lineId || '',
          process_id: processId || '',
          message: notes.trim(),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`);
      const typeMeta = ANDON_TYPES.find(t => t.key === typeKey);
      toast.success(`${typeMeta?.label || 'Andon'} terkirim ke supervisor`);
      setLastEvent(data);
      setConfirm(null);
      setNotes('');
      setActiveAndon(data);
      onSuccess?.();
    } catch (e) {
      toast.error(`Gagal kirim Andon: ${e.message}`);
    } finally {
      setSending(false);
    }
  };

  const cancelConfirm = () => {
    clearTimeout(confirmTimer);
    setConfirm(null);
    setNotes('');
  };

  return (
    <GlassCard className="p-4 space-y-3" data-testid="andon-panel">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-semibold text-foreground">Bantuan Darurat (Andon)</span>
        </div>
        {activeAndon && (
          <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-400/15 border border-amber-400/30 text-amber-300">
            <Clock className="w-3 h-3" /> Andon aktif
          </span>
        )}
      </div>

      {activeAndon ? (
        <div className="bg-amber-400/10 border border-amber-400/25 rounded-lg p-3 text-xs space-y-1" data-testid="andon-active-status">
          <div className="flex items-center gap-1.5 font-semibold text-amber-300">
            <AlertTriangle className="w-3.5 h-3.5" />
            {activeAndon.type_label} — Andon aktif
          </div>
          <div className="text-muted-foreground">Sudah dikirim ke supervisor. Menunggu tindak lanjut...</div>
          {activeAndon.message && <div className="text-foreground/70 italic">"{activeAndon.message}"</div>}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground mt-1"
            onClick={loadActiveAndon}
            data-testid="andon-refresh-btn"
          >
            <RefreshCw className="w-3 h-3 mr-1" /> Muat ulang status
          </Button>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">Tekan tombol 2× untuk konfirmasi:</p>

          <div className="grid grid-cols-2 gap-2">
            {ANDON_TYPES.map(type => {
              const Icon = type.icon;
              const isConfirming = confirm === type.key;
              return (
                <button
                  key={type.key}
                  onClick={() => handlePress(type.key)}
                  disabled={sending}
                  data-testid={`andon-btn-${type.key}`}
                  className={`relative flex flex-col items-center justify-center gap-1.5 rounded-xl border p-3 min-h-[88px] transition-all duration-150 active:scale-95 ${
                    isConfirming
                      ? `${type.activeBg} ring-2 ring-offset-1 ring-offset-transparent ring-current`
                      : type.bg
                  }`}
                >
                  {isConfirming && (
                    <span className="absolute top-1.5 right-1.5 text-[9px] font-bold text-white px-1.5 py-0.5 rounded-full bg-red-500 animate-pulse">
                      Konfirmasi?
                    </span>
                  )}
                  <Icon className={`w-6 h-6 ${type.iconColor}`} />
                  <span className="text-xs font-semibold text-foreground text-center leading-tight">{type.label}</span>
                  <span className="text-[10px] text-muted-foreground text-center leading-tight hidden sm:block">{type.sublabel}</span>
                </button>
              );
            })}
          </div>

          {confirm && (
            <div className="space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-200" data-testid="andon-confirm-section">
              <div className="bg-red-500/10 border border-red-400/25 rounded-lg p-2.5 text-xs">
                <div className="flex items-center gap-1.5 font-semibold text-red-300 mb-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Konfirmasi: {ANDON_TYPES.find(t => t.key === confirm)?.label}
                </div>
                <div className="text-muted-foreground">Tap sekali lagi untuk kirim bantuan ke supervisor.</div>
              </div>
              <textarea
                className="w-full min-h-[56px] px-3 py-2 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-xs text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))] resize-none"
                placeholder="Keterangan tambahan (opsional)..."
                value={notes}
                onChange={e => setNotes(e.target.value)}
                data-testid="andon-notes-input"
              />
              <div className="flex gap-2">
                <Button
                  onClick={() => handlePress(confirm)}
                  disabled={sending}
                  className="flex-1 h-10 text-sm font-semibold bg-red-500 hover:bg-red-600 text-white"
                  data-testid="andon-confirm-btn"
                >
                  {sending ? 'Mengirim...' : `Kirim ${ANDON_TYPES.find(t => t.key === confirm)?.label}`}
                </Button>
                <Button
                  variant="ghost"
                  onClick={cancelConfirm}
                  disabled={sending}
                  className="h-10 px-4"
                  data-testid="andon-cancel-btn"
                >
                  Batal
                </Button>
              </div>
            </div>
          )}

          {lastEvent && !confirm && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-300 bg-emerald-400/10 border border-emerald-400/20 rounded-lg px-3 py-2">
              <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
              <span>Terkirim: {lastEvent.type_label}</span>
            </div>
          )}
        </>
      )}
    </GlassCard>
  );
}
