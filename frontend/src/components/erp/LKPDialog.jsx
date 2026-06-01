/**
 * LKPDialog — Lembar Kerja Produksi (Production Work Sheet) form.
 *
 * Multi-step wizard:
 *   1. Tech Pack & Assignment
 *   2. SOP per Proses (manual input)
 *   3. QC Checkpoints
 *   4. Packing Instruction
 *   5. Special Notes & Generate
 */
import { useState, useEffect } from 'react';
import { Plus, X, ChevronLeft, ChevronRight, FileText, Loader2, AlertCircle } from 'lucide-react';
import Modal from './Modal';
import { GlassInput } from '@/components/ui/glass';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const DEFAULT_FLOW = ['Cutting', 'CMT-Sewing', 'Finishing', 'QC', 'Packing'];

const STEP_LABELS = [
  '1. Info Produk & Lini',
  '2. SOP per Proses',
  '3. QC & Checkpoints',
  '4. Packing Instruction',
  '5. Catatan Khusus',
];

const initialForm = {
  tech_pack: {
    color: '', color_code: '', gauge: '', weight_per_pcs: '',
    knit_structure: '', measurements: [{ part: 'Chest', value: '' }, { part: 'Length', value: '' }, { part: 'Sleeve', value: '' }],
  },
  assignment: {
    line_id: '', line_name: '', machine_id: '', machine_name: '',
    operator_id: '', operator_name: '', shift_id: '', shift_name: '',
    daily_target: '', shift_target: '',
  },
  process_flow: DEFAULT_FLOW.map(name => ({ name, duration_estimate: '', sam: '', line: '' })),
  sop_steps: DEFAULT_FLOW.map(name => ({
    process_name: name, tools: '', safety: '', steps: '',
    acceptance_criteria: '', common_defects: '',
  })),
  qc: {
    aql_level: 'AQL 2.5',
    sampling_rule: 'Random 10% per bundle',
    dimensional_tolerance: '± 1 cm dari size chart',
    checkpoints: ['Cek warna match dengan sample', 'Cek dimensi sesuai size chart', 'Cek tampilan visual', 'Cek aksesoris terpasang dengan benar'],
    defect_code_ids: [],
  },
  packing: {
    instruction: '', fold_method: '', polybag_spec: '',
    hangtag_placement: '', qty_per_carton: '',
    carton_spec: '', shipping_mark: '',
  },
  special_notes: '',
};

function StepNav({ step, setStep }) {
  return (
    <div className="flex items-center gap-1 flex-wrap mb-4 pb-3 border-b border-[var(--glass-border)]">
      {STEP_LABELS.map((label, i) => {
        const idx = i + 1;
        const active = step === idx;
        const done = step > idx;
        return (
          <button
            key={idx}
            onClick={() => setStep(idx)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              active
                ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                : done
                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-300/30'
                  : 'bg-[var(--glass-bg)] text-muted-foreground hover:bg-[var(--glass-bg-hover)] border border-[var(--glass-border)]'
            }`}
            data-testid={`lkp-step-${idx}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function FieldGroup({ label, children, hint }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground block mb-1">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground/70 mt-0.5">{hint}</p>}
    </div>
  );
}

export default function LKPDialog({ wo, token, onClose, onCreated }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [defectCodes, setDefectCodes] = useState([]);
  const [lines, setLines] = useState([]);
  const [machines, setMachines] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [employees, setEmployees] = useState([]);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  useEffect(() => {
    // Pre-load options
    (async () => {
      try {
        const [dc, ln, mc, sh, em] = await Promise.all([
          fetch('/api/rahaza/defect-codes', { headers }).then(r => r.ok ? r.json() : []),
          fetch('/api/rahaza/lines', { headers }).then(r => r.ok ? r.json() : []),
          fetch('/api/rahaza/machines', { headers }).then(r => r.ok ? r.json() : []),
          fetch('/api/rahaza/shifts', { headers }).then(r => r.ok ? r.json() : []),
          fetch('/api/rahaza/employees', { headers }).then(r => r.ok ? r.json() : []),
        ]);
        setDefectCodes(Array.isArray(dc) ? dc : []);
        setLines(Array.isArray(ln) ? ln : []);
        setMachines(Array.isArray(mc) ? mc : []);
        setShifts(Array.isArray(sh) ? sh : []);
        setEmployees(Array.isArray(em) ? em : []);
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updTech = (k, v) => setForm(f => ({ ...f, tech_pack: { ...f.tech_pack, [k]: v } }));
  const updAsgn = (k, v) => setForm(f => ({ ...f, assignment: { ...f.assignment, [k]: v } }));
  const updMeasure = (i, k, v) => {
    const arr = [...form.tech_pack.measurements];
    arr[i] = { ...arr[i], [k]: v };
    updTech('measurements', arr);
  };
  const addMeasure = () => updTech('measurements', [...form.tech_pack.measurements, { part: '', value: '' }]);
  const delMeasure = (i) => {
    const arr = form.tech_pack.measurements.filter((_, idx) => idx !== i);
    updTech('measurements', arr);
  };

  const updProcess = (i, k, v) => {
    const arr = [...form.process_flow];
    arr[i] = { ...arr[i], [k]: v };
    setForm(f => ({ ...f, process_flow: arr }));
  };
  const updSOP = (i, k, v) => {
    const arr = [...form.sop_steps];
    arr[i] = { ...arr[i], [k]: v };
    setForm(f => ({ ...f, sop_steps: arr }));
  };

  const updPack = (k, v) => setForm(f => ({ ...f, packing: { ...f.packing, [k]: v } }));
  const updQC = (k, v) => setForm(f => ({ ...f, qc: { ...f.qc, [k]: v } }));

  const toggleDefect = (id) => {
    const ids = form.qc.defect_code_ids || [];
    if (ids.includes(id)) {
      updQC('defect_code_ids', ids.filter(x => x !== id));
    } else {
      updQC('defect_code_ids', [...ids, id]);
    }
  };

  const updCheckpoint = (i, v) => {
    const cps = [...form.qc.checkpoints];
    cps[i] = v;
    updQC('checkpoints', cps);
  };
  const addCheckpoint = () => updQC('checkpoints', [...form.qc.checkpoints, '']);
  const delCheckpoint = (i) => updQC('checkpoints', form.qc.checkpoints.filter((_, idx) => idx !== i));

  const splitLines = (s) => (s || '').split('\n').map(x => x.trim()).filter(Boolean);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      // Auto-fill names from selected ids
      const lineDoc = lines.find(l => l.id === form.assignment.line_id);
      const machDoc = machines.find(m => m.id === form.assignment.machine_id);
      const opDoc = employees.find(e => e.id === form.assignment.operator_id);
      const shDoc = shifts.find(s => s.id === form.assignment.shift_id);

      const payload = {
        tech_pack: {
          ...form.tech_pack,
          measurements: form.tech_pack.measurements.filter(m => m.part || m.value),
        },
        assignment: {
          ...form.assignment,
          line_name: lineDoc?.name || form.assignment.line_name,
          machine_name: machDoc?.name || form.assignment.machine_name,
          machine_gauge: machDoc?.gauge || '',
          operator_name: opDoc?.name || form.assignment.operator_name,
          shift_name: shDoc?.name || form.assignment.shift_name,
        },
        process_flow: form.process_flow,
        sop_steps: form.sop_steps.map(s => ({
          process_name: s.process_name,
          tools: splitLines(s.tools),
          safety: splitLines(s.safety),
          steps: splitLines(s.steps),
          acceptance_criteria: s.acceptance_criteria,
          common_defects: splitLines(s.common_defects),
        })).filter(s => s.steps.length > 0 || s.tools.length > 0 || s.acceptance_criteria),
        qc: {
          ...form.qc,
          checkpoints: form.qc.checkpoints.filter(Boolean),
        },
        packing: form.packing,
        special_notes: form.special_notes,
      };

      const r = await fetch(`/api/rahaza/work-orders/${wo.id}/lkp`, {
        method: 'POST', headers, body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        toast.error(err.detail || `Gagal generate LKP (HTTP ${r.status})`);
        return;
      }
      const data = await r.json();
      toast.success(`LKP ${data.lkp_number} berhasil dibuat (versi ${data.version})`);
      onCreated && onCreated(data);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const next = () => setStep(s => Math.min(STEP_LABELS.length, s + 1));
  const prev = () => setStep(s => Math.max(1, s - 1));

  return (
    <Modal onClose={onClose} title={`Buat Lembar Kerja Produksi · ${wo.wo_number}`} size="xl">
      <div className="space-y-3" data-testid="lkp-dialog">
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] text-xs">
          <FileText className="w-4 h-4 text-primary" />
          <div className="flex-1">
            <b>{wo.wo_number}</b> · {wo.model_code} {wo.model_name} · Size {wo.size_code} · {wo.qty} pcs · Customer: <b>{wo.customer_snapshot || '-'}</b>
          </div>
        </div>

        <StepNav step={step} setStep={setStep} />

        {/* STEP 1: Tech Pack & Assignment */}
        {step === 1 && (
          <div className="space-y-4" data-testid="lkp-step-1-content">
            <div>
              <h4 className="text-sm font-semibold mb-2">Tech Pack / Spesifikasi Produk</h4>
              <div className="grid grid-cols-2 gap-3">
                <FieldGroup label="Warna Utama">
                  <GlassInput value={form.tech_pack.color} onChange={e => updTech('color', e.target.value)}
                    placeholder="Navy Blue" data-testid="lkp-color" />
                </FieldGroup>
                <FieldGroup label="Color Code / Lot Benang">
                  <GlassInput value={form.tech_pack.color_code} onChange={e => updTech('color_code', e.target.value)}
                    placeholder="NB-203 / Lot 11/2026" data-testid="lkp-color-code" />
                </FieldGroup>
                <FieldGroup label="Gauge">
                  <GlassInput value={form.tech_pack.gauge} onChange={e => updTech('gauge', e.target.value)}
                    placeholder="12 GG" data-testid="lkp-gauge" />
                </FieldGroup>
                <FieldGroup label="Berat target / pcs">
                  <GlassInput value={form.tech_pack.weight_per_pcs} onChange={e => updTech('weight_per_pcs', e.target.value)}
                    placeholder="350 gr" data-testid="lkp-weight" />
                </FieldGroup>
                <FieldGroup label="Knit Structure">
                  <GlassInput value={form.tech_pack.knit_structure} onChange={e => updTech('knit_structure', e.target.value)}
                    placeholder="Jersey / Rib / Cable" data-testid="lkp-structure" />
                </FieldGroup>
              </div>
              <div className="mt-3">
                <label className="text-xs text-muted-foreground block mb-1">Size Chart / Measurement (cm)</label>
                <div className="space-y-1.5">
                  {form.tech_pack.measurements.map((m, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <GlassInput value={m.part} onChange={e => updMeasure(i, 'part', e.target.value)}
                        placeholder="Bagian (Chest/Length...)" className="flex-1" data-testid={`lkp-measure-part-${i}`} />
                      <GlassInput value={m.value} onChange={e => updMeasure(i, 'value', e.target.value)}
                        placeholder="56 ± 1" className="flex-1" data-testid={`lkp-measure-val-${i}`} />
                      <button onClick={() => delMeasure(i)} className="p-1.5 text-muted-foreground hover:text-red-400">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  <button onClick={addMeasure} className="text-xs text-primary hover:underline flex items-center gap-1" data-testid="lkp-add-measure">
                    <Plus className="w-3 h-3" /> Tambah baris ukuran
                  </button>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-[var(--glass-border)]">
              <h4 className="text-sm font-semibold mb-2">Assignment & Resource</h4>
              <div className="grid grid-cols-2 gap-3">
                <FieldGroup label="Lini Produksi">
                  <select value={form.assignment.line_id} onChange={e => updAsgn('line_id', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] text-sm"
                    data-testid="lkp-line">
                    <option value="">— Pilih Lini —</option>
                    {lines.filter(l => l.active !== false).map(l => <option key={l.id} value={l.id}>{`${l.code} · ${l.name}`}</option>)}
                  </select>
                </FieldGroup>
                <FieldGroup label="Mesin">
                  <select value={form.assignment.machine_id} onChange={e => updAsgn('machine_id', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] text-sm"
                    data-testid="lkp-machine">
                    <option value="">— Pilih Mesin —</option>
                    {machines.filter(m => m.active !== false).map(m => <option key={m.id} value={m.id}>{`${m.code} · ${m.name}${m.gauge ? ` (${m.gauge}GG)` : ''}`}</option>)}
                  </select>
                </FieldGroup>
                <FieldGroup label="Operator (utama)">
                  <select value={form.assignment.operator_id} onChange={e => updAsgn('operator_id', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] text-sm"
                    data-testid="lkp-operator">
                    <option value="">— Pilih Operator —</option>
                    {employees.filter(e => e.active !== false).map(e => <option key={e.id} value={e.id}>{`${e.name}${e.position ? ` · ${e.position}` : ''}`}</option>)}
                  </select>
                </FieldGroup>
                <FieldGroup label="Shift">
                  <select value={form.assignment.shift_id} onChange={e => updAsgn('shift_id', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] text-sm"
                    data-testid="lkp-shift">
                    <option value="">— Pilih Shift —</option>
                    {shifts.filter(s => s.active !== false).map(s => <option key={s.id} value={s.id}>{`${s.name}${s.start_time ? ` (${s.start_time}-${s.end_time})` : ''}`}</option>)}
                  </select>
                </FieldGroup>
                <FieldGroup label="Target / hari (pcs)">
                  <GlassInput type="number" value={form.assignment.daily_target}
                    onChange={e => updAsgn('daily_target', e.target.value)}
                    placeholder="25" data-testid="lkp-daily-target" />
                </FieldGroup>
                <FieldGroup label="Target / shift (pcs)">
                  <GlassInput type="number" value={form.assignment.shift_target}
                    onChange={e => updAsgn('shift_target', e.target.value)}
                    placeholder="25" data-testid="lkp-shift-target" />
                </FieldGroup>
              </div>
            </div>

            <div className="pt-3 border-t border-[var(--glass-border)]">
              <h4 className="text-sm font-semibold mb-2">Estimasi Durasi & SAM per Proses</h4>
              <div className="space-y-1.5">
                {form.process_flow.map((p, i) => (
                  <div key={i} className="grid grid-cols-3 gap-2">
                    <div className="px-3 py-2 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] text-sm font-medium">
                      {i + 1}. {p.name}
                    </div>
                    <GlassInput value={p.duration_estimate} onChange={e => updProcess(i, 'duration_estimate', e.target.value)}
                      placeholder="Durasi (mis. 3 hari)" data-testid={`lkp-flow-dur-${i}`} />
                    <GlassInput value={p.sam} onChange={e => updProcess(i, 'sam', e.target.value)}
                      placeholder="SAM (menit/pcs)" data-testid={`lkp-flow-sam-${i}`} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: SOP per Proses */}
        {step === 2 && (
          <div className="space-y-4" data-testid="lkp-step-2-content">
            <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 text-xs">
              <AlertCircle className="w-4 h-4 text-blue-300 shrink-0 mt-0.5" />
              <div>
                <b>Tip:</b> isi SOP step-by-step yang jelas dan ringkas. Pisahkan tiap langkah dengan <b>baris baru</b> (Enter).
                Tools, safety, dan common defects juga 1 item per baris.
              </div>
            </div>
            {form.sop_steps.map((s, i) => (
              <div key={i} className="p-3 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)]">
                <h4 className="text-sm font-semibold mb-2 text-primary">{i + 1}. {s.process_name}</h4>
                <div className="grid grid-cols-2 gap-3">
                  <FieldGroup label="Alat / Tools (1 baris per item)">
                    <textarea value={s.tools} onChange={e => updSOP(i, 'tools', e.target.value)}
                      placeholder="Mesin Shima Seiki SES122FF&#10;Pita ukur&#10;Sarung tangan"
                      rows={3} className="w-full px-3 py-2 rounded-lg bg-white/5 border border-[var(--glass-border)] text-sm resize-y"
                      data-testid={`lkp-sop-tools-${i}`} />
                  </FieldGroup>
                  <FieldGroup label="Safety (1 baris per item)">
                    <textarea value={s.safety} onChange={e => updSOP(i, 'safety', e.target.value)}
                      placeholder="Pakai sarung tangan&#10;Cek tegangan benang sebelum mulai"
                      rows={3} className="w-full px-3 py-2 rounded-lg bg-white/5 border border-[var(--glass-border)] text-sm resize-y"
                      data-testid={`lkp-sop-safety-${i}`} />
                  </FieldGroup>
                </div>
                <FieldGroup label="Step-by-Step Instruksi (1 baris per langkah)">
                  <textarea value={s.steps} onChange={e => updSOP(i, 'steps', e.target.value)}
                    placeholder={`Setting program model di mesin\nCek kualitas benang lot 203\nMulai produksi 1 panel test\nPeriksa dimensi sesuai size chart\nLanjutkan produksi qty target`}
                    rows={5} className="w-full px-3 py-2 rounded-lg bg-white/5 border border-[var(--glass-border)] text-sm resize-y"
                    data-testid={`lkp-sop-steps-${i}`} />
                </FieldGroup>
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <FieldGroup label="Kriteria Kualitas (Acceptance)">
                    <textarea value={s.acceptance_criteria} onChange={e => updSOP(i, 'acceptance_criteria', e.target.value)}
                      placeholder="Tidak ada lubang, tegangan rata, gauge sesuai 12GG"
                      rows={2} className="w-full px-3 py-2 rounded-lg bg-white/5 border border-[var(--glass-border)] text-sm resize-y"
                      data-testid={`lkp-sop-acceptance-${i}`} />
                  </FieldGroup>
                  <FieldGroup label="Hindari Cacat Umum (1/baris)">
                    <textarea value={s.common_defects} onChange={e => updSOP(i, 'common_defects', e.target.value)}
                      placeholder="Hole / lubang&#10;Broken stitch&#10;Tension uneven"
                      rows={2} className="w-full px-3 py-2 rounded-lg bg-white/5 border border-[var(--glass-border)] text-sm resize-y"
                      data-testid={`lkp-sop-defects-${i}`} />
                  </FieldGroup>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* STEP 3: QC Checkpoints */}
        {step === 3 && (
          <div className="space-y-4" data-testid="lkp-step-3-content">
            <div className="grid grid-cols-2 gap-3">
              <FieldGroup label="AQL Level">
                <GlassInput value={form.qc.aql_level} onChange={e => updQC('aql_level', e.target.value)}
                  placeholder="AQL 2.5" data-testid="lkp-qc-aql" />
              </FieldGroup>
              <FieldGroup label="Toleransi Dimensi">
                <GlassInput value={form.qc.dimensional_tolerance} onChange={e => updQC('dimensional_tolerance', e.target.value)}
                  placeholder="± 1 cm" data-testid="lkp-qc-tolerance" />
              </FieldGroup>
            </div>
            <FieldGroup label="Sampling Rule">
              <GlassInput value={form.qc.sampling_rule} onChange={e => updQC('sampling_rule', e.target.value)}
                placeholder="Random 10% per bundle" data-testid="lkp-qc-sampling" />
            </FieldGroup>

            <FieldGroup label="Defect Codes yang Harus Diperhatikan">
              <div className="max-h-48 overflow-y-auto p-2 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] grid grid-cols-2 gap-1">
                {defectCodes.length === 0 && (
                  <p className="text-xs text-muted-foreground col-span-2">
                    (Belum ada master defect codes. Buat di menu Master Defect Codes.)
                  </p>
                )}
                {defectCodes.map(d => {
                  const checked = (form.qc.defect_code_ids || []).includes(d.id);
                  return (
                    <label key={d.id} className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-[var(--glass-bg-hover)] ${checked ? 'bg-primary/10' : ''}`}
                      data-testid={`lkp-defect-${d.code}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleDefect(d.id)} />
                      <span className="text-xs"><b>{d.code}</b> {d.category} ({d.severity})</span>
                    </label>
                  );
                })}
              </div>
            </FieldGroup>

            <FieldGroup label="Critical Checkpoints (akan tampil sebagai checkbox di PDF)">
              <div className="space-y-1.5">
                {form.qc.checkpoints.map((c, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <GlassInput value={c} onChange={e => updCheckpoint(i, e.target.value)}
                      placeholder="Cek warna match dengan sample" className="flex-1"
                      data-testid={`lkp-checkpoint-${i}`} />
                    <button onClick={() => delCheckpoint(i)} className="p-1.5 text-muted-foreground hover:text-red-400">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <button onClick={addCheckpoint} className="text-xs text-primary hover:underline flex items-center gap-1"
                  data-testid="lkp-add-checkpoint">
                  <Plus className="w-3 h-3" /> Tambah checkpoint
                </button>
              </div>
            </FieldGroup>
          </div>
        )}

        {/* STEP 4: Packing Instruction */}
        {step === 4 && (
          <div className="space-y-3" data-testid="lkp-step-4-content">
            <div className="grid grid-cols-2 gap-3">
              <FieldGroup label="Cara Lipat / Fold Method">
                <GlassInput value={form.packing.fold_method} onChange={e => updPack('fold_method', e.target.value)}
                  placeholder="Standard knitwear fold" data-testid="lkp-pack-fold" />
              </FieldGroup>
              <FieldGroup label="Polybag Spec">
                <GlassInput value={form.packing.polybag_spec} onChange={e => updPack('polybag_spec', e.target.value)}
                  placeholder="PE 0.05mm dengan logo PT" data-testid="lkp-pack-polybag" />
              </FieldGroup>
              <FieldGroup label="Hangtag Placement">
                <GlassInput value={form.packing.hangtag_placement} onChange={e => updPack('hangtag_placement', e.target.value)}
                  placeholder="Kiri leher belakang" data-testid="lkp-pack-hangtag" />
              </FieldGroup>
              <FieldGroup label="Qty per Carton">
                <GlassInput type="number" value={form.packing.qty_per_carton}
                  onChange={e => updPack('qty_per_carton', e.target.value)}
                  placeholder="50" data-testid="lkp-pack-qty-carton" />
              </FieldGroup>
              <FieldGroup label="Carton Spec">
                <GlassInput value={form.packing.carton_spec} onChange={e => updPack('carton_spec', e.target.value)}
                  placeholder="5-ply 60x40x40 cm" data-testid="lkp-pack-carton-spec" />
              </FieldGroup>
              <FieldGroup label="Shipping Mark">
                <GlassInput value={form.packing.shipping_mark} onChange={e => updPack('shipping_mark', e.target.value)}
                  placeholder="PT-RAHAZA-EXPORT-2026" data-testid="lkp-pack-shipping-mark" />
              </FieldGroup>
            </div>
            <FieldGroup label="Instruksi Tambahan / Detail Packing">
              <textarea value={form.packing.instruction} onChange={e => updPack('instruction', e.target.value)}
                placeholder="Instruksi tambahan untuk packing..."
                rows={3} className="w-full px-3 py-2 rounded-lg bg-white/5 border border-[var(--glass-border)] text-sm resize-y"
                data-testid="lkp-pack-instruction" />
            </FieldGroup>
          </div>
        )}

        {/* STEP 5: Special Notes */}
        {step === 5 && (
          <div className="space-y-3" data-testid="lkp-step-5-content">
            <FieldGroup label="Catatan Khusus & Instruksi Tambahan"
              hint="Misal: handling khusus warna, batch sensitive, instruksi customer khusus, riwayat rework, substitusi material, dll.">
              <textarea value={form.special_notes} onChange={e => setForm(f => ({ ...f, special_notes: e.target.value }))}
                placeholder={`Customer minta extra hati-hati untuk warna navy.\nCek lot benang harus sama untuk 1 order.\nHubungi PPIC bila warna tidak match.`}
                rows={6} className="w-full px-3 py-2 rounded-lg bg-white/5 border border-[var(--glass-border)] text-sm resize-y"
                data-testid="lkp-special-notes" />
            </FieldGroup>

            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs">
              <b>Siap generate.</b> Klik "Generate PDF" untuk membuat Lembar Kerja Produksi.
              Sistem akan auto-snapshot data WO + BOM + foto model + konten yang Anda isi, lalu menyimpan PDF terversi.
              Anda bisa cetak ulang kapan saja dari tab LKP di detail WO.
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-3 border-t border-[var(--glass-border)]">
          <Button variant="ghost" onClick={prev} disabled={step === 1} data-testid="lkp-prev">
            <ChevronLeft className="w-4 h-4 mr-1" /> Kembali
          </Button>
          <span className="text-xs text-muted-foreground">Step {step} / {STEP_LABELS.length}</span>
          {step < STEP_LABELS.length ? (
            <Button onClick={next} data-testid="lkp-next">
              Lanjut <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={submitting} data-testid="lkp-submit">
              {submitting ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Generating...</> : <><FileText className="w-4 h-4 mr-1" /> Generate PDF</>}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
