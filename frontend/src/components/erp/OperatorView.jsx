import { useState, useEffect, useCallback } from 'react';
import { Factory, LogOut, User, RefreshCw, Plus, CheckCircle2, XCircle, Clock, Target, Smartphone, LogIn, QrCode, Package2, BookOpen } from 'lucide-react';
import { GlassCard, GlassPanel, GlassInput } from '@/components/ui/glass';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import Modal from './Modal';
import BundleScannerModal from './BundleScannerModal';
import AndonPanel from './AndonPanel';
import SOPModal from './SOPModal';
import { toast } from 'sonner';

/* ─── Operator View (Fase 6) ──────────────────────────────────────────────────
   - Operator pilih identitas dari daftar karyawan (persist di localStorage).
   - Tampil assignment hari ini → card besar mobile-friendly.
   - Tombol cepat +5/+10/+25 + input custom.
   - QC card punya 2 tombol: Pass & Fail.
 ────────────────────────────────────────────────────────────────────────── */

const OP_LS_KEY = 'rahaza_operator_id';

export default function OperatorView({ user, token, onLogout }) {
  const [employees, setEmployees] = useState([]);
  const [operatorId, setOperatorId] = useState(localStorage.getItem(OP_LS_KEY) || '');
  const [myWork, setMyWork] = useState(null);
  const [loading, setLoading] = useState(false);
  const [quick, setQuick] = useState(null); // { row, mode: 'output'|'qc', bundle? }
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState('');
  const [sopContext, setSopContext] = useState(null); // { model_id, process_id, model_code, process_code }

  // Attendance state (Fase 8a)
  const [attendance, setAttendance] = useState(null);  // { has_clock_in, has_clock_out, status, record }
  const [clocking, setClocking] = useState(false);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // Load employees once
  useEffect(() => {
    fetch('/api/rahaza/employees', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : [])
      .then(rows => setEmployees((rows || []).filter(e => e.active)))
      .catch(() => setEmployees([]));
  }, [token]);

  const loadMyWork = useCallback(async () => {
    if (!operatorId) { setMyWork(null); setAttendance(null); return; }
    setLoading(true);
    try {
      const [wRes, aRes] = await Promise.all([
        fetch(`/api/rahaza/execution/my-work?operator_id=${operatorId}`, { headers }),
        fetch(`/api/rahaza/attendance/my-today?employee_id=${operatorId}`, { headers }),
      ]);
      if (wRes.ok) setMyWork(await wRes.json());
      if (aRes.ok) setAttendance(await aRes.json());
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operatorId, token]);

  useEffect(() => { loadMyWork(); }, [loadMyWork]);
  useEffect(() => {
    if (!operatorId) return;
    const id = setInterval(loadMyWork, 20000);
    return () => clearInterval(id);
  }, [operatorId, loadMyWork]);

  const chooseOperator = (id) => {
    setOperatorId(id);
    if (id) localStorage.setItem(OP_LS_KEY, id);
    else localStorage.removeItem(OP_LS_KEY);
  };

  const doClockIn = async () => {
    if (!operatorId) return;
    setClocking(true);
    try {
      const r = await fetch('/api/rahaza/attendance/clock-in', { method: 'POST', headers, body: JSON.stringify({ employee_id: operatorId }) });
      if (!r.ok) {
        const STATUS_MSG = { 400: 'Sudah clock-in sebelumnya / data tidak valid.', 403: 'Tidak ada akses.' };
        alert(STATUS_MSG[r.status] || `Gagal clock-in (HTTP ${r.status})`);
        return;
      }
      loadMyWork();
    } finally { setClocking(false); }
  };

  const doClockOut = async () => {
    if (!operatorId) return;
    if (!window.confirm('Konfirmasi clock-out untuk hari ini?')) return;
    setClocking(true);
    try {
      const r = await fetch('/api/rahaza/attendance/clock-out', { method: 'POST', headers, body: JSON.stringify({ employee_id: operatorId }) });
      if (!r.ok) {
        const STATUS_MSG = { 400: 'Belum clock-in atau sudah clock-out.', 403: 'Tidak ada akses.' };
        alert(STATUS_MSG[r.status] || `Gagal clock-out (HTTP ${r.status})`);
        return;
      }
      loadMyWork();
    } finally { setClocking(false); }
  };

  const openQuick = (row) => {
    setFormError('');
    setQuick({ row, qty: '', qty_pass: '', qty_fail: '', notes: '' });
  };

  const handleScanDetected = useCallback((bundle) => {
    setScannerError('');
    const assignments = myWork?.assignments || [];
    if (!assignments.length) {
      setScannerOpen(false);
      setScannerError(
        `Bundle ${bundle.bundle_number} terdeteksi, tapi belum ada assignment hari ini untuk Anda.`,
      );
      toast.error('Belum ada assignment hari ini');
      return;
    }
    // Match assignments that cover the bundle's current process
    const matches = assignments.filter((a) => a.process_id === bundle.current_process_id);
    if (matches.length === 0) {
      setScannerOpen(false);
      const procLabel = bundle.current_process_code || bundle.current_process_name || '—';
      setScannerError(
        `Bundle ${bundle.bundle_number} saat ini di proses ${procLabel}, yang tidak ada di assignment Anda hari ini.`,
      );
      toast.error(`Bundle ada di proses ${procLabel} — tidak cocok dengan line Anda`);
      return;
    }
    // Pick first match (later: let operator pick line if multiple)
    const row = matches[0];
    setScannerOpen(false);
    setScannerError('');
    setFormError('');
    const defaultQty = Number(bundle.qty_remaining) || 0;
    setQuick({
      row,
      bundle,
      qty: row.is_qc ? '' : String(defaultQty),
      qty_pass: row.is_qc ? String(defaultQty) : '',
      qty_fail: '',
      notes: '',
    });
  }, [myWork]);

  const submit = async () => {
    if (!quick) return;
    setSaving(true); setFormError('');
    try {
      const row = quick.row;
      const bundle = quick.bundle;

      if (bundle) {
        // Phase 17C — scan-submit path (updates bundle + wip_event in a single call)
        const payload = {
          line_id: row.line_id,
          process_id: row.process_id,
          line_assignment_id: row.assignment_id,
          notes: quick.notes || '',
        };
        if (row.is_qc) {
          const qty_pass = Number(quick.qty_pass) || 0;
          const qty_fail = Number(quick.qty_fail) || 0;
          if (qty_pass <= 0 && qty_fail <= 0) throw new Error('Isi minimal Pass atau Fail.');
          if (qty_pass + qty_fail > (Number(bundle.qty_remaining) || 0)) {
            throw new Error(`Total pass+fail (${qty_pass + qty_fail}) melebihi sisa qty bundle (${bundle.qty_remaining}).`);
          }
          payload.qty_pass = qty_pass;
          payload.qty_fail = qty_fail;
        } else {
          const qty = Number(quick.qty);
          if (!(qty > 0)) throw new Error('Qty harus > 0.');
          if (qty > (Number(bundle.qty_remaining) || 0)) {
            throw new Error(`Qty (${qty}) melebihi sisa qty bundle (${bundle.qty_remaining}).`);
          }
          payload.qty = qty;
        }
        const r = await fetch(`/api/rahaza/bundles/${bundle.id}/scan-submit`, {
          method: 'POST', headers, body: JSON.stringify(payload),
        });
        if (!r.ok) {
          let detail = '';
          try { detail = (await r.json()).detail || ''; } catch (_) { /* noop */ }
          throw new Error(detail || `Gagal simpan (HTTP ${r.status})`);
        }
        const data = await r.json();
        toast.success(
          `Bundle ${bundle.bundle_number} tersimpan${data.advanced ? ` · lanjut ke ${data?.bundle?.current_process_code || 'proses berikutnya'}` : ''}`,
        );
      } else if (row.is_qc) {
        const qty_pass = Number(quick.qty_pass) || 0;
        const qty_fail = Number(quick.qty_fail) || 0;
        if (qty_pass <= 0 && qty_fail <= 0) throw new Error('Isi minimal Pass atau Fail.');
        const body = {
          line_id: row.line_id, qty_pass, qty_fail,
          line_assignment_id: row.assignment_id,
          model_id: row.model_id, size_id: row.size_id,
          notes: quick.notes || '',
        };
        const r = await fetch('/api/rahaza/execution/qc-event', { method: 'POST', headers, body: JSON.stringify(body) });
        if (!r.ok) {
          const STATUS_MSG = { 400:'Input QC tidak valid.', 403:'Tidak ada akses.', 404:'Line QC tidak ditemukan.' };
          throw new Error(STATUS_MSG[r.status] || `Gagal simpan (HTTP ${r.status})`);
        }
      } else {
        const qty = Number(quick.qty);
        if (!(qty > 0)) throw new Error('Qty harus > 0.');
        const body = {
          line_id: row.line_id, process_id: row.process_id, qty,
          line_assignment_id: row.assignment_id,
          model_id: row.model_id, size_id: row.size_id,
          notes: quick.notes || '',
        };
        const r = await fetch('/api/rahaza/execution/quick-output', { method: 'POST', headers, body: JSON.stringify(body) });
        if (!r.ok) {
          const STATUS_MSG = { 400:'Input tidak valid.', 403:'Tidak ada akses.', 404:'Data tidak ditemukan.' };
          throw new Error(STATUS_MSG[r.status] || `Gagal simpan (HTTP ${r.status})`);
        }
      }
      setQuick(null);
      loadMyWork();
    } catch (e) { setFormError(e.message); }
    finally { setSaving(false); }
  };

  const opName = employees.find(e => e.id === operatorId)?.name || '';
  const opCode = employees.find(e => e.id === operatorId)?.employee_code || '';

  return (
    <div className="min-h-screen bg-ambient noise-overlay" data-testid="operator-view-page">
      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-[var(--glass-border)] bg-[var(--card-surface)] backdrop-blur-xl">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[hsl(var(--primary))]/15 border border-[hsl(var(--primary))]/25 flex items-center justify-center flex-shrink-0">
              <Factory className="w-5 h-5 text-[hsl(var(--primary))]" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">Operator · CV. Dewi Aditya</p>
              <p className="text-xs text-foreground/50 truncate">{opName ? `${opCode} · ${opName}` : 'Belum pilih operator'}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="sm"
              onClick={loadMyWork}
              disabled={!operatorId}
              className="text-foreground/60 hover:text-foreground gap-1.5 min-h-[44px] min-w-[44px] h-11 w-11 px-0"
              data-testid="operator-refresh-btn"
              aria-label="Muat ulang data"
              title="Muat ulang"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onLogout}
              className="text-foreground/60 hover:text-foreground gap-1.5 min-h-[44px] px-3"
              data-testid="operator-logout-btn"
              aria-label="Keluar dari sistem"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline text-xs">Keluar</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-4 space-y-4">
        {/* Operator selector */}
        <GlassPanel className="p-3" data-testid="operator-selector-panel">
          <label className="block text-[10px] font-semibold uppercase text-muted-foreground mb-1">Identitas Operator</label>
          <select
            value={operatorId}
            onChange={e => chooseOperator(e.target.value)}
            className="w-full min-h-[48px] h-12 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-base text-foreground focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:outline-none"
            data-testid="operator-select"
            aria-label="Pilih operator"
          >
            <option value="">— Pilih nama Anda —</option>
            {employees.map(e => (
              <option key={e.id} value={e.id}>{`${e.employee_code} · ${e.name}`}</option>
            ))}
          </select>
        </GlassPanel>

        {!operatorId ? (
          <GlassCard className="p-6 text-center">
            <Smartphone className="w-10 h-10 mx-auto mb-3 text-foreground/30" />
            <h2 className="text-base font-semibold text-foreground mb-1">Selamat datang Operator</h2>
            <p className="text-sm text-muted-foreground">Pilih nama Anda di atas untuk melihat assignment hari ini dan input output.</p>
          </GlassCard>
        ) : (
          <>
            {/* Attendance panel */}
            <GlassCard className="p-4" data-testid="operator-attendance-card">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase text-muted-foreground mb-1">
                    <Clock className="w-3 h-3" /> Kehadiran Hari Ini
                  </div>
                  {!attendance?.has_clock_in ? (
                    <div>
                      <div className="text-sm font-semibold text-foreground">Belum clock-in</div>
                      <div className="text-[11px] text-muted-foreground">Tekan tombol kanan untuk mulai shift.</div>
                    </div>
                  ) : attendance?.has_clock_out ? (
                    <div>
                      <div className="text-sm font-semibold text-emerald-300">Shift selesai</div>
                      <div className="text-[11px] text-muted-foreground">
                        Masuk {new Date(attendance.record?.clock_in).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} · Keluar {new Date(attendance.record?.clock_out).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} · {attendance.record?.hours_worked || 0} jam
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="text-sm font-semibold text-primary">Sedang bekerja</div>
                      <div className="text-[11px] text-muted-foreground">Mulai {new Date(attendance.record?.clock_in).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                  )}
                </div>
                <div className="flex-shrink-0">
                  {!attendance?.has_clock_in ? (
                    <Button onClick={doClockIn} disabled={clocking} className="h-11 px-4" data-testid="operator-clock-in-btn">
                      <LogIn className="w-4 h-4 mr-1.5" /> {clocking ? '...' : 'Clock In'}
                    </Button>
                  ) : !attendance?.has_clock_out ? (
                    <Button onClick={doClockOut} disabled={clocking} variant="ghost" className="h-11 px-4 border border-red-300/30 text-red-300 hover:bg-red-400/10" data-testid="operator-clock-out-btn">
                      <LogOut className="w-4 h-4 mr-1.5" /> {clocking ? '...' : 'Clock Out'}
                    </Button>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300 px-3 py-2 rounded-lg bg-emerald-400/10 border border-emerald-300/20">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Selesai
                    </span>
                  )}
                </div>
              </div>
            </GlassCard>

            {/* Phase 18B — Andon Panel */}
            <AndonPanel
              token={token}
              operatorId={operatorId}
              lineId={myWork?.assignments?.[0]?.line_id || ''}
              processId={myWork?.assignments?.[0]?.process_id || ''}
              lineCode={myWork?.assignments?.[0]?.line_code || ''}
              processCode={myWork?.assignments?.[0]?.process_name || ''}
              onSuccess={loadMyWork}
            />

            {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
          </div>
        ) : (myWork?.assignments || []).length === 0 ? (
          <GlassCard className="p-6 text-center">
            <Target className="w-10 h-10 mx-auto mb-3 text-foreground/30" />
            <h3 className="text-base font-semibold text-foreground mb-1">Tidak ada assignment hari ini</h3>
            <p className="text-sm text-muted-foreground">Hubungi supervisor untuk assignment. Tanggal: {myWork?.date}</p>
          </GlassCard>
        ) : (
          <>
            {/* Phase 17C — Scan Bundle CTA (primary entry for scan-to-submit) */}
            <Button
              onClick={() => { setScannerError(''); setScannerOpen(true); }}
              className="w-full h-14 text-base font-semibold gap-2"
              data-testid="operator-scan-bundle-btn"
              disabled={!attendance?.has_clock_in || attendance?.has_clock_out}
              title={!attendance?.has_clock_in ? 'Clock-in dulu untuk mulai scan' : 'Scan QR ticket bundle'}
            >
              <QrCode className="w-5 h-5" /> Scan Bundle
            </Button>
            {scannerError && (
              <div className="bg-amber-400/10 border border-amber-300/25 rounded-lg p-2.5 text-xs text-amber-300 flex items-start gap-2" data-testid="operator-scanner-error">
                <Package2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span>{scannerError}</span>
              </div>
            )}

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{myWork.assignments.length} assignment hari ini · {myWork.date}</span>
            </div>
            {myWork.assignments.map(row => {
              const pct = row.target_qty > 0 ? Math.min(100, Math.round((row.output_today / row.target_qty) * 100)) : 0;
              return (
                <GlassCard key={row.assignment_id} className="p-4" data-testid={`op-assignment-${row.line_code}`}>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <div className="text-base font-semibold text-foreground">{row.line_code} · {row.process_name}</div>
                      <div className="text-xs text-muted-foreground">{row.model_code ? `${row.model_code} (${row.model_name})` : <span className="italic">Model tidak diset</span>} · Size {row.size_code || '—'}</div>
                      {row.shift_name && <div className="text-[11px] text-muted-foreground">Shift {row.shift_name}</div>}
                    </div>
                    {row.is_qc && <span className="flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/15 border border-primary/25 text-primary">QC GATE</span>}
                  </div>

                  <div className="flex items-end justify-between gap-3 mb-3">
                    <div>
                      <div className="text-3xl font-bold text-primary leading-none">{row.output_today}</div>
                      <div className="text-[11px] text-muted-foreground">{row.target_qty > 0 ? `dari ${row.target_qty} pcs (${pct}%)` : 'pcs hari ini'}</div>
                    </div>
                    <Button onClick={() => openQuick(row)} className="h-12 px-5 text-base font-semibold" data-testid={`op-input-btn-${row.line_code}`}>
                      <Plus className="w-5 h-5 mr-1" /> Input
                    </Button>
                  </div>

                  {row.target_qty > 0 && (
                    <div className="h-1.5 bg-[var(--glass-bg)] rounded-full overflow-hidden">
                      <div className="h-full bg-[hsl(var(--primary))]" style={{ width: `${pct}%` }} />
                    </div>
                  )}

                  {row.is_qc && (row.output_breakdown?.qc_pass || row.output_breakdown?.qc_fail) && (
                    <div className="flex items-center gap-2 mt-2 text-[11px]">
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-400/10 text-emerald-300"><CheckCircle2 className="w-3 h-3" /> {row.output_breakdown?.qc_pass || 0}</span>
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-400/10 text-red-300"><XCircle className="w-3 h-3" /> {row.output_breakdown?.qc_fail || 0}</span>
                    </div>
                  )}

                  {/* Phase 18D — SOP button */}
                  {row.model_id && row.process_id && (
                    <button
                      className="mt-2 flex items-center gap-1.5 text-[11px] text-[hsl(var(--primary))]/70 hover:text-[hsl(var(--primary))] transition-colors"
                      onClick={() => setSopContext({ model_id: row.model_id, process_id: row.process_id, model_code: row.model_code, process_code: row.process_name })}
                      data-testid={`op-sop-btn-${row.line_code}`}
                    >
                      <BookOpen className="w-3 h-3" /> Lihat SOP
                    </button>
                  )}
                </GlassCard>
              );
            })}

            {/* Recent */}
            {(myWork.recent_events || []).length > 0 && (
              <GlassCard className="p-0 overflow-hidden">
                <div className="px-3 py-2 border-b border-[var(--glass-border)] bg-[var(--glass-bg)] flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold text-foreground">Input Anda Hari Ini</span>
                </div>
                <div className="max-h-56 overflow-y-auto">
                  <table className="w-full text-xs">
                    <tbody>
                      {myWork.recent_events.map(ev => (
                        <tr key={ev.id} className="border-t border-[var(--glass-border)]">
                          <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">{new Date(ev.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</td>
                          <td className="px-3 py-1.5">
                            {ev.event_type === 'qc_pass' && <span className="text-emerald-300">Pass</span>}
                            {ev.event_type === 'qc_fail' && <span className="text-red-300">Fail</span>}
                            {ev.event_type === 'output'  && <span className="text-foreground/80">Output</span>}
                          </td>
                          <td className="px-3 py-1.5 text-right font-semibold text-foreground">{ev.qty} pcs</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </GlassCard>
            )}
          </>
        )}
          </>
        )}

        <p className="text-[10px] text-foreground/30 text-center pt-2">
          Login: {user?.name} · Role: {user?.role}
        </p>
      </main>

      {/* Quick input modal (mobile) */}
      {quick && (
        <Modal onClose={() => setQuick(null)} title={`Input · ${quick.row.line_code}${quick.bundle ? ` · ${quick.bundle.bundle_number}` : ''}`} size="sm">
          <div className="space-y-3" data-testid="operator-quick-modal">
            {formError && <div className="bg-red-400/10 border border-red-300/20 rounded-lg p-2.5 text-sm text-red-300">{formError}</div>}

            {quick.bundle && (
              <div className="bg-[hsl(var(--primary)/0.08)] border border-[hsl(var(--primary)/0.25)] rounded-lg p-2.5 text-xs" data-testid="quick-modal-bundle-context">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[hsl(var(--primary))] mb-1">
                  <QrCode className="w-3 h-3" /> Bundle Terdeteksi
                </div>
                <div className="font-mono font-semibold text-foreground">{quick.bundle.bundle_number}</div>
                <div className="text-muted-foreground mt-0.5">
                  WO <b className="text-foreground">{quick.bundle.wo_number_snapshot || '—'}</b> · {quick.bundle.model_code} · {quick.bundle.size_code}
                </div>
                <div className="text-muted-foreground">
                  Proses sekarang: <b className="text-foreground">{quick.bundle.current_process_code}</b> · Sisa qty: <b className="text-foreground">{quick.bundle.qty_remaining} pcs</b>
                </div>
              </div>
            )}

            <div className="text-xs text-muted-foreground bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg p-2.5">
              <div className="text-foreground font-medium">{quick.row.process_name} · {quick.row.model_code || '?'} · {quick.row.size_code || '?'}</div>
              <div>Target {quick.row.target_qty} pcs · sudah {quick.row.output_today}</div>
            </div>
            {quick.row.is_qc ? (
              <>
                <div>
                  <label className="block text-xs font-medium text-emerald-300 mb-1"><CheckCircle2 className="w-3 h-3 inline mr-1" /> Pass (lolos → Steam)</label>
                  <GlassInput type="number" inputMode="numeric" value={quick.qty_pass} onChange={e => setQuick(q => ({ ...q, qty_pass: e.target.value }))} placeholder="0" data-testid="op-qc-pass" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-red-300 mb-1"><XCircle className="w-3 h-3 inline mr-1" /> Fail (rework → Washer)</label>
                  <GlassInput type="number" inputMode="numeric" value={quick.qty_fail} onChange={e => setQuick(q => ({ ...q, qty_fail: e.target.value }))} placeholder="0" data-testid="op-qc-fail" />
                </div>
              </>
            ) : (
              <div>
                <label className="block text-xs font-medium text-foreground/70 mb-1">
                  Qty Output (pcs){quick.bundle ? <span className="text-[10px] text-muted-foreground ml-1">max {quick.bundle.qty_remaining}</span> : null}
                </label>
                <GlassInput type="number" inputMode="numeric" value={quick.qty} onChange={e => setQuick(q => ({ ...q, qty: e.target.value }))} placeholder="0" data-testid="op-qty-input" autoFocus />
                <div className="grid grid-cols-4 gap-1.5 mt-2">
                  {[1, 5, 10, 25].map(n => (
                    <button key={n} onClick={() => setQuick(q => ({ ...q, qty: String((Number(q.qty) || 0) + n) }))}
                      className="min-h-[44px] h-12 text-base font-semibold border border-[var(--glass-border)] rounded-lg bg-[var(--glass-bg)] hover:bg-[var(--glass-bg-hover)] active:scale-95 text-foreground/80 transition-transform duration-150"
                      data-testid={`op-chip-${n}`}
                      aria-label={`Tambah ${n} pcs`}>
                      +{n}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <GlassInput value={quick.notes} onChange={e => setQuick(q => ({ ...q, notes: e.target.value }))} placeholder="Catatan (opsional)" />
            <Button onClick={submit} disabled={saving} className="w-full h-12 text-base font-semibold" data-testid="op-submit-btn">
              {saving ? 'Menyimpan...' : 'Simpan Input'}
            </Button>
          </div>
        </Modal>
      )}

      {/* Phase 17C — Bundle Scanner Modal */}
      {scannerOpen && (
        <BundleScannerModal
          token={token}
          onClose={() => setScannerOpen(false)}
          onDetected={handleScanDetected}
        />
      )}

      {/* Phase 18D — SOP Modal */}
      {sopContext && (
        <SOPModal
          token={token}
          modelId={sopContext.model_id}
          processId={sopContext.process_id}
          modelCode={sopContext.model_code}
          processCode={sopContext.process_code}
          onClose={() => setSopContext(null)}
        />
      )}
    </div>
  );
}
