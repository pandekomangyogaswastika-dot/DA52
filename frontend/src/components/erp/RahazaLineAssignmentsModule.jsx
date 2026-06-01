import { useEffect, useState, useCallback } from 'react';
import { Copy, CheckCircle2, AlertTriangle, RefreshCw, Calendar as CalendarIcon, Info } from 'lucide-react';
import MasterDataCRUD from './MasterDataCRUD';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format, subDays } from 'date-fns';
import { id as localeId } from 'date-fns/locale';

/**
 * RahazaLineAssignmentsModule — Line Assignments with Copy Yesterday + Date Picker + AlertDialog
 *
 * Assignment menyimpan:
 * - process_id / process_code → proses yang dikerjakan (RAJUT/LINKING/SEWING/dll)
 * - work_order_id → WO yang sedang dikerjakan (bisa lebih dari 1 WO per line)
 *
 * Collision check: (line_id, date, shift_id, process_id) — unik per kombinasi.
 */

function CopyYesterdayBanner({ token, onAssigned }) {
  const [state, setState] = useState('idle'); // idle | loading | preview | confirm | done | error
  const [preview, setPreview] = useState(null);
  const [msg, setMsg] = useState('');
  const [targetDate, setTargetDate] = useState(new Date()); // default: today
  const [calOpen, setCalOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [overwrite, setOverwrite] = useState(false);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const targetDateStr = format(targetDate, 'yyyy-MM-dd');
  const yesterdayStr = format(subDays(new Date(), 1), 'yyyy-MM-dd');

  const fetchPreview = async () => {
    setState('loading');
    try {
      const r = await fetch('/api/rahaza/supervisor/assignments/yesterday', { headers });
      if (!r.ok) { setState('error'); setMsg('Gagal mengambil data assignment kemarin.'); return; }
      const d = await r.json();
      setPreview(d);
      setState('preview');
    } catch (e) {
      setState('error');
      setMsg(String(e));
    }
  };

  const handleCopyClick = async () => {
    if (state !== 'preview') {
      await fetchPreview();
    } else {
      setConfirmOpen(true);
    }
  };

  const applyTemplate = async () => {
    if (!preview?.assignments?.length) return;
    setState('loading');
    setConfirmOpen(false);
    try {
      const r = await fetch('/api/rahaza/supervisor/assignments/bulk', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          assignments: preview.assignments,
          assign_date: targetDateStr,
          overwrite,
        }),
      });
      const d = await r.json();
      setState('done');
      setMsg(
        `${d.created} assignment berhasil disalin ke ${targetDateStr}.` +
        (d.skipped > 0 ? ` ${d.skipped} dilewati (sudah ada).` : '')
      );
      onAssigned && onAssigned();
    } catch (e) {
      setState('error');
      setMsg(String(e));
    }
  };

  const reset = () => {
    setState('idle');
    setPreview(null);
    setMsg('');
  };

  return (
    <>
      {/* Main copy-yesterday card */}
      <GlassCard className="p-4">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Copy className="w-4 h-4 text-primary shrink-0" />
              <span className="font-semibold text-sm text-foreground">Salin Assignment Kemarin</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Salin assignment dari tanggal kemarin ({yesterdayStr}) ke tanggal target sebagai template awal.
            </p>

            {/* Target date picker */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Target tanggal:</span>
              <Popover open={calOpen} onOpenChange={setCalOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-3 text-xs font-mono gap-2"
                    data-testid="assignment-copy-date-picker"
                  >
                    <CalendarIcon className="w-3.5 h-3.5" />
                    {targetDateStr}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={targetDate}
                    onSelect={(d) => { if (d) { setTargetDate(d); setCalOpen(false); setState('idle'); setPreview(null); } }}
                    locale={localeId}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>

              {/* Overwrite toggle */}
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={overwrite}
                  onChange={e => setOverwrite(e.target.checked)}
                  className="w-3.5 h-3.5 accent-primary"
                />
                <span className="text-xs text-muted-foreground">Timpa jika sudah ada</span>
              </label>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {(state === 'done' || state === 'error') && (
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={reset}>
                Reset
              </Button>
            )}
            <Button
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={state === 'preview' ? () => setConfirmOpen(true) : fetchPreview}
              disabled={state === 'loading'}
              data-testid="assignment-copy-yesterday-button"
            >
              {state === 'loading'
                ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Memuat...</>
                : state === 'preview'
                ? <><Copy className="w-3.5 h-3.5" /> Salin ke {targetDateStr}</>
                : <><Copy className="w-3.5 h-3.5" /> Cek & Salin</>
              }
            </Button>
          </div>
        </div>

        {/* Preview result */}
        {state === 'preview' && preview && (
          <div className="mt-3 border-t border-border/40 pt-3">
            {preview.count > 0 ? (
              <>
                <div className="flex items-center gap-1.5 text-xs text-foreground/80 mb-2">
                  <Info className="w-3.5 h-3.5 text-primary" />
                  <strong>{preview.count} assignment</strong> ditemukan dari kemarin ({preview.date || yesterdayStr}).
                  Siap disalin ke <strong>{targetDateStr}</strong>.
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                  {preview.assignments.slice(0, 10).map((a, i) => (
                    <span
                      key={i}
                      className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-primary font-mono"
                    >
                      {a.line_name || '?'} · {a.employee_name || a.operator_name || '?'}
                      {a.process_code ? ` · ${a.process_code}` : ''}
                    </span>
                  ))}
                  {preview.count > 10 && (
                    <span className="text-[10px] text-muted-foreground">+{preview.count - 10} lainnya</span>
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2 text-xs text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5" />
                Tidak ada assignment kemarin ({preview.date || yesterdayStr}). Template kosong.
              </div>
            )}
          </div>
        )}

        {/* Status messages */}
        {state === 'done' && (
          <div className="mt-3 flex items-center gap-2 text-xs text-emerald-400 border-t border-border/40 pt-3">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {msg}
          </div>
        )}
        {state === 'error' && (
          <div className="mt-3 flex items-center gap-2 text-xs text-red-400 border-t border-border/40 pt-3">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {msg}
          </div>
        )}
      </GlassCard>

      {/* AlertDialog Konfirmasi */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen} data-testid="assignment-copy-confirm-dialog">
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Konfirmasi Salin Assignment</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>Anda akan menyalin <strong>{preview?.count || 0} assignment</strong> dari:</p>
                <div className="bg-muted/50 rounded-lg px-3 py-2 space-y-1 text-xs font-mono">
                  <div>Sumber: <span className="text-primary">{preview?.date || yesterdayStr}</span></div>
                  <div>Target: <span className="text-primary">{targetDateStr}</span></div>
                  <div>Mode: <span className="text-primary">{overwrite ? 'Timpa yang sudah ada' : 'Skip yang sudah ada'}</span></div>
                </div>
                {preview?.count > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2 max-h-20 overflow-y-auto">
                    {preview.assignments.slice(0, 8).map((a, i) => (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                        {a.line_name || '?'}{a.process_code ? ` (${a.process_code})` : ''}
                      </span>
                    ))}
                    {preview.count > 8 && <span className="text-[10px] text-muted-foreground">+{preview.count - 8} lainnya</span>}
                  </div>
                )}
                <p className="text-muted-foreground text-xs">Tindakan ini tidak dapat dibatalkan.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={applyTemplate}
              disabled={!preview?.count}
              data-testid="assignment-copy-confirm-button"
            >
              Ya, Salin Sekarang
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function RahazaLineAssignmentsModule({ token }) {
  const [lines, setLines] = useState([]);
  const [emps, setEmps] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [models, setModels] = useState([]);
  const [sizes, setSizes] = useState([]);
  const [processes, setProcesses] = useState([]);
  const [workOrders, setWorkOrders] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadMasterData = useCallback(() => {
    const h = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch('/api/rahaza/lines', { headers: h }).then(r => r.ok ? r.json() : []),
      fetch('/api/rahaza/employees', { headers: h }).then(r => r.ok ? r.json() : []),
      fetch('/api/rahaza/shifts', { headers: h }).then(r => r.ok ? r.json() : []),
      fetch('/api/rahaza/models', { headers: h }).then(r => r.ok ? r.json() : []),
      fetch('/api/rahaza/sizes', { headers: h }).then(r => r.ok ? r.json() : []),
      fetch('/api/rahaza/processes', { headers: h }).then(r => r.ok ? r.json() : []),
      fetch('/api/rahaza/work-orders?status=released,in_production&limit=200', { headers: h }).then(r => r.ok ? r.json() : []),
    ]).then(([l, e, s, m, sz, p, wo]) => {
      // Ensure all data are arrays to prevent .filter() errors
      setLines(Array.isArray(l) ? l : []);
      setEmps(Array.isArray(e) ? e : []);
      setShifts(Array.isArray(s) ? s : []);
      setModels(Array.isArray(m) ? m : []);
      setSizes(Array.isArray(sz) ? sz : []);
      setProcesses(Array.isArray(p) ? p : []);
      setWorkOrders(Array.isArray(wo) ? wo : (wo?.items || []));
    }).catch(err => {
      console.error('Failed to load master data:', err);
      // Set empty arrays on error to prevent crashes
      setLines([]); setEmps([]); setShifts([]); setModels([]); setSizes([]);
      setProcesses([]); setWorkOrders([]);
    });
  }, [token]);

  useEffect(() => { loadMasterData(); }, [loadMasterData]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      {/* Salin Assignment Kemarin banner with date picker + AlertDialog */}
      <CopyYesterdayBanner token={token} onAssigned={() => setRefreshKey(k => k + 1)} />

      {/* Info how-to */}
      <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg px-4 py-3 text-sm text-blue-700 dark:text-blue-300">
        <strong>Cara penggunaan baru:</strong> Satu line bisa di-assign ke banyak proses berbeda pada hari yang sama.
        Pilih <strong>Proses</strong> (wajib) dan <strong>Work Order</strong> (opsional) untuk setiap assignment.
        Ini memungkinkan LINE-01 mengerjakan RAJUT pagi dan SEWING sore pada hari yang sama.
      </div>

      <MasterDataCRUD
        key={refreshKey}
        title="Assign Line (Operator + Proses + Shift + WO)"
        description="Setiap hari/shift, Line di-assign dengan Operator, Proses yang dikerjakan, Model, WO, dan Target produksi."
        endpoint="/api/rahaza/line-assignments"
        token={token}
        testIdPrefix="rahaza-line-assign"
        columns={[
          { key: 'assign_date', label: 'Tanggal' },
          { key: 'line_name', label: 'Line' },
          { key: 'process_code', label: 'Proses', render: v => v
            ? <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-primary/10 text-primary">{v}</span>
            : <span className="text-muted-foreground text-xs">-</span>
          },
          { key: 'operator_name', label: 'Operator', render: v => v || '-' },
          { key: 'shift_name', label: 'Shift', render: v => v || '-' },
          { key: 'model_name', label: 'Model', render: v => v || '-' },
          { key: 'size_name', label: 'Size', render: v => v || '-' },
          { key: 'work_order_no', label: 'Work Order', render: v => v
            ? <span className="font-mono text-xs text-foreground/80">{v}</span>
            : <span className="text-muted-foreground text-xs">-</span>
          },
          { key: 'target_qty', label: 'Target', render: v => v ? `${v} pcs` : '-' },
        ]}
        fields={[
          { key: 'assign_date', label: 'Tanggal', type: 'text', placeholder: today, required: true },
          { key: 'line_id', label: 'Line', type: 'select', required: true,
            options: lines.filter(l => l.active).map(l => ({ value: l.id, label: `${l.code} · ${l.name}` })) },
          { key: 'process_id', label: 'Proses (wajib)', type: 'select', required: true,
            options: processes.filter(p => p.active).map(p => ({ value: p.id, label: `${p.code} — ${p.name}` })) },
          { key: 'operator_id', label: 'Operator', type: 'select',
            options: emps.filter(e => e.active).map(e => ({ value: e.id, label: `${e.employee_code} · ${e.name}` })) },
          { key: 'shift_id', label: 'Shift', type: 'select',
            options: shifts.filter(s => s.active).map(s => ({ value: s.id, label: `${s.name} (${s.start_time}-${s.end_time})` })) },
          { key: 'work_order_id', label: 'Work Order (opsional)', type: 'select',
            options: workOrders.map(wo => ({ value: wo.id, label: `${wo.wo_number} · ${wo.model_name || ''} ${wo.size_code || ''}`.trim() })) },
          { key: 'model_id', label: 'Model', type: 'select',
            options: models.filter(m => m.active).map(m => ({ value: m.id, label: `${m.code} · ${m.name}` })) },
          { key: 'size_id', label: 'Size', type: 'select',
            options: sizes.filter(s => s.active).map(s => ({ value: s.id, label: s.code })) },
          { key: 'target_qty', label: 'Target pcs', type: 'number', placeholder: 'Contoh: 200' },
          { key: 'notes', label: 'Catatan' },
        ]}
        defaultItem={{ assign_date: today, line_id: '', process_id: '', operator_id: '', shift_id: '', work_order_id: '', model_id: '', size_id: '', target_qty: 0, notes: '' }}
      />
    </div>
  );
}
