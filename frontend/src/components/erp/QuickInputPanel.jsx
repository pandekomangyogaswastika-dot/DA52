/**
 * QuickInputPanel — Quick Input Panel (P0 Automation)
 * Panel floating/global (Sheet) untuk input qty lintas proses dari mana saja.
 * Trigger: Floating FAB + Alt+I keyboard shortcut.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Plus, X, Factory, Package, CheckCircle2, XCircle, RotateCcw,
  Clipboard, ChevronDown, RefreshCw
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { GlassCard, GlassInput } from '@/components/ui/glass';
import { useProductionUI } from '@/contexts/ProductionUIContext';
import { toast } from 'sonner';

/**
 * Process options — 6 proses utama + Rework sub-proses
 */
const MAIN_PROCESSES = [
  { code: 'RAJUT',   name: '1 · Rajut' },
  { code: 'LINKING', name: '2 · Linking' },
  { code: 'SEWING',  name: '3 · Sewing' },
  { code: 'STEAM',   name: '4 · Steam' },
  { code: 'QC',      name: '5 · QC' },
  { code: 'PACKING', name: '6 · Packing' },
];

const SUB_PROCESSES = [
  { code: 'REWORK', name: 'Rework (Sub-Proses)' },
];

export default function QuickInputPanel({ token }) {
  const { quickInputOpen, quickInputPrefill, closeQuickInput } = useProductionUI();
  
  const [processCode, setProcessCode] = useState('');
  const [lineId, setLineId] = useState('');
  const [assignmentId, setAssignmentId] = useState('');
  const [woId, setWoId] = useState('');
  const [qty, setQty] = useState('');
  const [qtyPass, setQtyPass] = useState('');
  const [qtyFail, setQtyFail] = useState('');
  const [qtyIn, setQtyIn] = useState('');
  const [qtyOut, setQtyOut] = useState('');
  const [qtyReworkFail, setQtyReworkFail] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Master data
  const [lines, setLines] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [workOrders, setWorkOrders] = useState([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [loadingWOs, setLoadingWOs] = useState(false);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const isQC = processCode === 'QC';
  const isRework = processCode === 'REWORK';

  useEffect(() => {
    if (quickInputOpen) {
      fetchWorkOrders();
      if (quickInputPrefill) {
        setProcessCode(quickInputPrefill.process_code || '');
        setLineId(quickInputPrefill.line_id || '');
        setAssignmentId(quickInputPrefill.assignment_id || '');
        setWoId(quickInputPrefill.work_order_id || '');
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickInputOpen]);

  useEffect(() => {
    if (processCode) {
      fetchLines();
    } else {
      setLines([]);
      setLineId('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processCode]);

  useEffect(() => {
    if (lineId && processCode) {
      fetchAssignments();
    } else {
      setAssignments([]);
      setAssignmentId('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineId, processCode]);

  const fetchLines = async () => {
    setLoadingLines(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const res = await fetch(
        `/api/rahaza/line-assignments?assign_date=${today}&process_code=${processCode}&active=true&limit=200`,
        { headers }
      );
      if (res.ok) {
        const data = await res.json();
        const lineIds = [...new Set((data.items || data || []).map(a => a.line_id).filter(Boolean))];
        if (lineIds.length > 0) {
          const linesRes = await fetch(`/api/rahaza/lines?active=true&limit=200`, { headers });
          if (linesRes.ok) {
            const linesData = await linesRes.json();
            const allLines = Array.isArray(linesData) ? linesData : linesData.items || [];
            setLines(allLines.filter(l => lineIds.includes(l.id)));
          }
        } else {
          setLines([]);
        }
      }
    } catch (e) {
      console.error('Failed to fetch lines:', e);
    } finally {
      setLoadingLines(false);
    }
  };

  const fetchAssignments = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const res = await fetch(
        `/api/rahaza/line-assignments?line_id=${lineId}&process_code=${processCode}&assign_date=${today}&active=true&limit=200`,
        { headers }
      );
      if (res.ok) {
        const data = await res.json();
        setAssignments(Array.isArray(data) ? data : data.items || []);
      }
    } catch (e) {
      console.error('Failed to fetch assignments:', e);
    }
  };

  const fetchWorkOrders = async () => {
    setLoadingWOs(true);
    try {
      const res = await fetch('/api/rahaza/work-orders?status=released,in_production&limit=200', { headers });
      if (res.ok) {
        const data = await res.json();
        setWorkOrders(Array.isArray(data) ? data : data.items || []);
      }
    } catch (e) {
      console.error('Failed to fetch WOs:', e);
    } finally {
      setLoadingWOs(false);
    }
  };

  const handleReset = () => {
    setProcessCode('');
    setLineId('');
    setAssignmentId('');
    setWoId('');
    setQty('');
    setQtyPass('');
    setQtyFail('');
    setQtyIn('');
    setQtyOut('');
    setQtyReworkFail('');
    setNotes('');
    setError('');
  };

  const handleSubmit = async () => {
    setError('');
    if (!processCode || !lineId) {
      setError('Proses dan Line wajib dipilih.');
      return;
    }

    setSaving(true);
    try {
      let endpoint = '';
      let payload = {};

      // Get process_id
      const proc = PROCESSES.find(p => p.code === processCode);
      const procRes = await fetch(`/api/rahaza/processes?code=${processCode}&active=true&limit=1`, { headers });
      const procData = await procRes.json();
      const processId = (Array.isArray(procData) ? procData[0] : procData?.items?.[0])?.id;

      if (!processId) {
        throw new Error(`Proses ${processCode} tidak ditemukan.`);
      }

      if (isQC) {
        // QC event
        const qp = Number(qtyPass) || 0;
        const qf = Number(qtyFail) || 0;
        if (qp <= 0 && qf <= 0) {
          throw new Error('Minimal isi salah satu: Pass atau Fail (>0).');
        }
        endpoint = '/api/rahaza/execution/qc-event';
        payload = {
          line_id: lineId,
          qty_pass: qp,
          qty_fail: qf,
          line_assignment_id: assignmentId || null,
          work_order_id: woId || null,
          notes,
        };
      } else if (isRework) {
        // Rework event
        const qi = Number(qtyIn) || 0;
        const qo = Number(qtyOut) || 0;
        const qf = Number(qtyReworkFail) || 0;
        if (qi <= 0) {
          throw new Error('Qty masuk rework harus lebih dari 0.');
        }
        if (qo <= 0 && qf <= 0) {
          throw new Error('Minimal isi qty lolos atau qty gagal (>0).');
        }
        if (qo + qf > qi) {
          throw new Error(`qty lolos (${qo}) + qty gagal (${qf}) tidak boleh melebihi qty masuk (${qi}).`);
        }
        endpoint = '/api/rahaza/execution/rework-event';
        payload = {
          line_id: lineId,
          qty_in: qi,
          qty_out: qo,
          qty_fail: qf,
          line_assignment_id: assignmentId || null,
          work_order_id: woId || null,
          notes,
        };
      } else {
        // Normal output
        const q = Number(qty) || 0;
        if (q <= 0) {
          throw new Error('Qty harus lebih dari 0.');
        }
        endpoint = '/api/rahaza/execution/quick-output';
        payload = {
          line_id: lineId,
          process_id: processId,
          qty: q,
          line_assignment_id: assignmentId || null,
          work_order_id: woId || null,
          notes,
        };
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `HTTP ${res.status}`);
      }

      toast.success(`✅ Input berhasil disimpan untuk ${proc?.name || processCode}`);
      handleReset();
      closeQuickInput();
    } catch (e) {
      toast.error('Gagal menyimpan: ' + e.message);
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    handleReset();
    closeQuickInput();
  };

  return (
    <Sheet open={quickInputOpen} onOpenChange={handleClose}>
      <SheetContent className="w-[420px] sm:w-[460px] overflow-y-auto" data-testid="quick-input-sheet">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Plus className="w-5 h-5 text-primary" />
            Quick Input
          </SheetTitle>
          <SheetDescription>
            Input qty dari mana saja tanpa pindah modul. Tekan Alt+I atau klik FAB untuk membuka.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 py-4">
          {error && (
            <div className="bg-red-400/10 border border-red-300/20 rounded-lg p-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {/* Group 1: Proses & Line */}
          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-1.5">
              Proses <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <select
                className="w-full h-10 px-3 pr-8 rounded-[var(--radius-control)] border border-border bg-[var(--input-surface)] text-foreground appearance-none"
                value={processCode}
                onChange={e => setProcessCode(e.target.value)}
                data-testid="quick-input-process-select"
              >
                <option value="">— Pilih Proses —</option>
                <optgroup label="Proses Utama (6 Tahap)">
                  {MAIN_PROCESSES.map(p => (
                    <option key={p.code} value={p.code}>{p.name}</option>
                  ))}
                </optgroup>
                <optgroup label="Sub-Proses">
                  {SUB_PROCESSES.map(p => (
                    <option key={p.code} value={p.code}>{p.name}</option>
                  ))}
                </optgroup>
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-1.5">
              Line <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <select
                className="w-full h-10 px-3 pr-8 rounded-[var(--radius-control)] border border-border bg-[var(--input-surface)] text-foreground appearance-none"
                value={lineId}
                onChange={e => setLineId(e.target.value)}
                disabled={!processCode || loadingLines}
                data-testid="quick-input-line-select"
              >
                <option value="">— Pilih Line —</option>
                {lines.map(l => (
                  <option key={l.id} value={l.id}>{`${l.code} · ${l.name}`}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            </div>
            {loadingLines && <div className="text-xs text-muted-foreground mt-1">Memuat line...</div>}
          </div>

          {/* Group 2: Assignment & WO */}
          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-1.5">
              Assignment (opsional)
            </label>
            <div className="relative">
              <select
                className="w-full h-10 px-3 pr-8 rounded-[var(--radius-control)] border border-border bg-[var(--input-surface)] text-foreground appearance-none"
                value={assignmentId}
                onChange={e => setAssignmentId(e.target.value)}
                disabled={!lineId}
              >
                <option value="">— Tidak ada assignment —</option>
                {assignments.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.operator_name || 'Operator?'} · {a.shift_name || 'Shift?'}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-1.5">
              <Clipboard className="w-3.5 h-3.5 inline mr-1" />
              Work Order (opsional)
            </label>
            <div className="relative">
              <select
                className="w-full h-10 px-3 pr-8 rounded-[var(--radius-control)] border border-border bg-[var(--input-surface)] text-foreground appearance-none"
                value={woId}
                onChange={e => setWoId(e.target.value)}
                disabled={loadingWOs}
                data-testid="quick-input-wo-combobox"
              >
                <option value="">— Pilih WO (opsional) —</option>
                {workOrders.map(wo => (
                  <option key={wo.id} value={wo.id}>
                    {wo.wo_number} · {wo.model_name || ''} {wo.size_code || ''} ({wo.status})
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            </div>
          </div>

          {/* Group 3: Qty Fields */}
          {isQC && (
            <>
              <div>
                <label className="block text-sm font-medium text-emerald-300 mb-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 inline mr-1" />
                  Qty Pass (lolos → Packing)
                </label>
                <GlassInput
                  type="number"
                  value={qtyPass}
                  onChange={e => setQtyPass(e.target.value)}
                  placeholder="0"
                  data-testid="quick-input-qty-pass-input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-red-300 mb-1.5">
                  <XCircle className="w-3.5 h-3.5 inline mr-1" />
                  Qty Fail (→ Rework)
                </label>
                <GlassInput
                  type="number"
                  value={qtyFail}
                  onChange={e => setQtyFail(e.target.value)}
                  placeholder="0"
                  data-testid="quick-input-qty-reject-input"
                />
              </div>
            </>
          )}

          {isRework && (
            <>
              <div className="bg-amber-400/10 border border-amber-300/20 rounded-lg p-3 text-xs text-amber-200 flex items-start gap-2">
                <RotateCcw className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  Proses rework: input qty yang masuk dari QC Fail, lalu pisahkan yang lolos (→ Packing) dan yang gagal total (scrap).
                </span>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-1.5">
                  Qty Masuk Rework (dari QC Fail) <span className="text-red-400">*</span>
                </label>
                <GlassInput
                  type="number"
                  value={qtyIn}
                  onChange={e => setQtyIn(e.target.value)}
                  placeholder="Jumlah pieces masuk rework"
                  data-testid="quick-input-rework-qty-in"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-emerald-300 mb-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 inline mr-1" />
                  Qty Lolos Rework (→ Packing)
                </label>
                <GlassInput
                  type="number"
                  value={qtyOut}
                  onChange={e => setQtyOut(e.target.value)}
                  placeholder="0"
                  data-testid="quick-input-rework-qty-out"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-red-300 mb-1.5">
                  <XCircle className="w-3.5 h-3.5 inline mr-1" />
                  Qty Gagal Rework (scrap/waste)
                </label>
                <GlassInput
                  type="number"
                  value={qtyReworkFail}
                  onChange={e => setQtyReworkFail(e.target.value)}
                  placeholder="0"
                  data-testid="quick-input-rework-qty-fail"
                />
              </div>
              {Number(qtyIn) > 0 && (
                <div className="text-xs text-muted-foreground bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg p-2">
                  Pending rework:{' '}
                  {Math.max(
                    0,
                    (Number(qtyIn) || 0) - (Number(qtyOut) || 0) - (Number(qtyReworkFail) || 0)
                  )}{' '}
                  pcs belum diinput
                </div>
              )}
            </>
          )}

          {!isQC && !isRework && (
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-1.5">
                Qty Output (pcs) <span className="text-red-400">*</span>
              </label>
              <GlassInput
                type="number"
                value={qty}
                onChange={e => setQty(e.target.value)}
                placeholder="0"
                data-testid="quick-input-qty-ok-input"
                autoFocus
              />
              <div className="flex gap-1 mt-2">
                {[5, 10, 25, 50].map(n => (
                  <button
                    key={n}
                    onClick={() => setQty(String((Number(qty) || 0) + n))}
                    className="flex-1 h-7 text-xs border border-[var(--glass-border)] rounded hover:bg-[var(--glass-bg-hover)] text-foreground/80"
                  >
                    +{n}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-1.5">Catatan</label>
            <GlassInput
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Opsional"
            />
          </div>
        </div>

        <SheetFooter className="gap-2">
          <Button variant="ghost" onClick={handleReset} disabled={saving}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Reset
          </Button>
          <Button onClick={handleSubmit} disabled={saving} data-testid="quick-input-submit-button">
            {saving ? 'Menyimpan...' : 'Simpan Input'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
