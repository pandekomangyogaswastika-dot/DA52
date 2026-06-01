/**
 * ProductionWizardModule — Production Wizard (P0 Automation)
 * Menggabungkan Order → WO → Release → Bundles jadi 1 wizard 3-step.
 * Design: Dialog (desktop) + Drawer fallback (mobile)
 */
import { useState, useEffect } from 'react';
import {
  Wand2, Package, FileText, CheckCircle2, AlertCircle, ChevronRight,
  ChevronLeft, Calendar, User, Boxes
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader,
  DialogTitle, DialogFooter
} from '@/components/ui/dialog';
import { GlassCard, GlassInput } from '@/components/ui/glass';
import { useProductionUI } from '@/contexts/ProductionUIContext';
import { toast } from 'sonner';

/**
 * Wizard Stepper (3 steps)
 */
const WizardStepper = ({ currentStep }) => {
  const steps = [
    { id: 1, label: 'Data Order', icon: FileText },
    { id: 2, label: 'Preview WO', icon: Package },
    { id: 3, label: 'Konfirmasi', icon: CheckCircle2 },
  ];

  return (
    <div className="hidden md:block w-[240px] pr-4 border-r border-border/60" data-testid="wizard-stepper">
      <div className="space-y-3">
        {steps.map((step, idx) => {
          const Icon = step.icon;
          const isActive = currentStep === step.id;
          const isDone = currentStep > step.id;
          return (
            <div key={step.id} className="flex items-start gap-3 py-3">
              <div
                className={`h-8 w-8 rounded-full border flex items-center justify-center shrink-0 transition-all ${
                  isActive
                    ? 'bg-primary text-primary-foreground border-primary shadow-[0_0_12px_hsl(var(--primary)/0.5)]'
                    : isDone
                    ? 'bg-[hsl(var(--success))] text-black border-[hsl(var(--success))]'
                    : 'border-border bg-[var(--glass-bg)] text-muted-foreground'
                }`}
                data-testid={`wizard-step-dot-${step.id}`}
              >
                {isDone ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
              </div>
              <div className="flex-1 min-w-0">
                <div
                  className={`text-sm font-medium ${
                    isActive ? 'text-foreground' : isDone ? 'text-[hsl(var(--success))]' : 'text-muted-foreground'
                  }`}
                >
                  {step.label}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">Step {step.id}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/**
 * Step 1: Data Order
 */
const Step1OrderData = ({ form, setForm, customers, models, sizes }) => {
  return (
    <div className="space-y-4" data-testid="production-wizard-step-order">
      <div>
        <label className="block text-sm font-medium text-foreground/80 mb-1.5">
          Jenis Order
        </label>
        <div className="flex gap-3">
          <button
            onClick={() => setForm(f => ({ ...f, is_internal: false }))}
            className={`flex-1 h-10 rounded-[var(--radius-control)] border transition-all ${
              !form.is_internal
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-[var(--glass-bg)] text-muted-foreground hover:bg-[var(--glass-bg-hover)]'
            }`}
            data-testid="wizard-order-type-customer"
          >
            <User className="w-4 h-4 inline mr-2" />
            Customer
          </button>
          <button
            onClick={() => setForm(f => ({ ...f, is_internal: true, customer_id: '' }))}
            className={`flex-1 h-10 rounded-[var(--radius-control)] border transition-all ${
              form.is_internal
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-[var(--glass-bg)] text-muted-foreground hover:bg-[var(--glass-bg-hover)]'
            }`}
            data-testid="wizard-order-type-internal"
          >
            <Boxes className="w-4 h-4 inline mr-2" />
            Internal
          </button>
        </div>
      </div>

      {!form.is_internal && (
        <div>
          <label className="block text-sm font-medium text-foreground/80 mb-1.5">
            Pelanggan <span className="text-red-400">*</span>
          </label>
          <select
            className="w-full h-10 px-3 rounded-[var(--radius-control)] border border-border bg-[var(--input-surface)] text-foreground"
            value={form.customer_id}
            onChange={e => setForm(f => ({ ...f, customer_id: e.target.value }))}
            data-testid="wizard-customer-select"
          >
            <option value="">— Pilih Pelanggan —</option>
            {customers.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-foreground/80 mb-1.5">
            <Calendar className="w-3.5 h-3.5 inline mr-1" />
            Tanggal Order
          </label>
          <GlassInput
            type="date"
            value={form.order_date}
            onChange={e => setForm(f => ({ ...f, order_date: e.target.value }))}
            data-testid="wizard-order-date"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground/80 mb-1.5">
            Deadline
          </label>
          <GlassInput
            type="date"
            value={form.due_date}
            onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
            data-testid="wizard-due-date"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground/80 mb-1.5">
          Item Order <span className="text-red-400">*</span>
        </label>
        <GlassCard className="p-3 space-y-2">
          {form.items.map((item, idx) => (
            <div key={idx} className="grid grid-cols-3 gap-2">
              <select
                className="h-9 px-2 rounded-lg border border-border bg-[var(--input-surface)] text-sm"
                value={item.model_id}
                onChange={e => {
                  const newItems = [...form.items];
                  newItems[idx].model_id = e.target.value;
                  setForm(f => ({ ...f, items: newItems }));
                }}
                data-testid={`wizard-item-model-${idx}`}
              >
                <option value="">Model</option>
                {models.map(m => (
                  <option key={m.id} value={m.id}>{`${m.code} - ${m.name}`}</option>
                ))}
              </select>
              <select
                className="h-9 px-2 rounded-lg border border-border bg-[var(--input-surface)] text-sm"
                value={item.size_id}
                onChange={e => {
                  const newItems = [...form.items];
                  newItems[idx].size_id = e.target.value;
                  setForm(f => ({ ...f, items: newItems }));
                }}
                data-testid={`wizard-item-size-${idx}`}
              >
                <option value="">Size</option>
                {sizes.map(s => (
                  <option key={s.id} value={s.id}>{s.code}</option>
                ))}
              </select>
              <GlassInput
                type="number"
                placeholder="Qty"
                value={item.qty}
                onChange={e => {
                  const newItems = [...form.items];
                  newItems[idx].qty = e.target.value;
                  setForm(f => ({ ...f, items: newItems }));
                }}
                data-testid={`wizard-item-qty-${idx}`}
              />
            </div>
          ))}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setForm(f => ({ ...f, items: [...f.items, { model_id: '', size_id: '', qty: '' }] }))}
            data-testid="wizard-add-item-btn"
          >
            + Tambah Item
          </Button>
        </GlassCard>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground/80 mb-1.5">Catatan</label>
        <textarea
          className="w-full h-20 px-3 py-2 rounded-[var(--radius-control)] border border-border bg-[var(--input-surface)] text-foreground text-sm resize-none"
          placeholder="Catatan order (opsional)"
          value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          data-testid="wizard-order-notes"
        />
      </div>
    </div>
  );
};

/**
 * Step 2: Preview WO
 */
const Step2Preview = ({ previewData, loading }) => {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64" data-testid="production-wizard-step-preview">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Menghitung preview...</p>
        </div>
      </div>
    );
  }

  if (!previewData) {
    return (
      <div className="text-center text-muted-foreground py-12" data-testid="production-wizard-step-preview">
        <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-40" />
        <p>Preview belum tersedia</p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="production-wizard-step-preview">
      <GlassCard className="p-4">
        <div className="text-sm font-semibold text-foreground mb-3">Ringkasan</div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-xs text-muted-foreground">Work Orders</div>
            <div className="text-2xl font-bold text-primary">{previewData.wo_count || 0}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Total Bundles</div>
            <div className="text-2xl font-bold text-foreground">{previewData.total_bundles || 0}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Item</div>
            <div className="text-2xl font-bold text-foreground">{previewData.items?.length || 0}</div>
          </div>
        </div>
      </GlassCard>

      <div>
        <div className="text-sm font-semibold text-foreground mb-2">Detail WO yang akan dibuat:</div>
        <div className="space-y-2">
          {(previewData.items || []).map((item, idx) => (
            <GlassCard key={idx} className="p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-foreground">
                    {item.model_code || '—'} · {item.size_code || '—'}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {item.model_name || 'Model'}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-mono text-primary">{item.qty} pcs</div>
                  <div className="text-xs text-muted-foreground">
                    {item.num_bundles} bundle (@{item.bundle_size})
                  </div>
                </div>
              </div>
            </GlassCard>
          ))}
        </div>
      </div>
    </div>
  );
};

/**
 * Step 3: Konfirmasi
 */
const Step3Confirm = ({ form, previewData, confirmed, setConfirmed }) => {
  return (
    <div className="space-y-4" data-testid="production-wizard-step-confirm">
      <div className="bg-[hsl(var(--info))]/10 border border-[hsl(var(--info))]/20 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-[hsl(var(--info))] shrink-0 mt-0.5" />
          <div className="text-sm text-foreground/90">
            Wizard akan membuat <strong>{previewData?.wo_count || 0} Work Order</strong> dan{' '}
            <strong>{previewData?.total_bundles || 0} bundles</strong>. WO akan otomatis di-release
            dan siap untuk produksi.
          </div>
        </div>
      </div>

      <GlassCard className="p-4">
        <div className="text-sm font-semibold text-foreground mb-3">Checklist Validasi</div>
        <div className="space-y-2">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={e => setConfirmed(e.target.checked)}
              className="mt-0.5"
              data-testid="wizard-confirm-checkbox"
            />
            <span className="text-sm text-foreground/90">
              Saya sudah mengecek target qty dan deadline. Data sudah benar.
            </span>
          </label>
        </div>
      </GlassCard>

      <div className="text-xs text-muted-foreground">
        <strong>Catatan:</strong> Setelah eksekusi, Order akan muncul di modul Order dan WO akan
        tersedia di modul Work Orders dengan status Released.
      </div>
    </div>
  );
};

/**
 * Main Wizard Component
 */
export default function ProductionWizardModule({ token, isGlobalMount = false }) {
  const { wizardOpen, wizardInitial, openWizard, closeWizard } = useProductionUI();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    is_internal: false,
    customer_id: '',
    order_date: new Date().toISOString().split('T')[0],
    due_date: '',
    items: [{ model_id: '', size_id: '', qty: '' }],
    notes: '',
  });
  const [previewData, setPreviewData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Master data
  const [customers, setCustomers] = useState([]);
  const [models, setModels] = useState([]);
  const [sizes, setSizes] = useState([]);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  useEffect(() => {
    if (wizardOpen) {
      fetchMasterData();
      if (wizardInitial) {
        setForm(f => ({ ...f, ...wizardInitial }));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardOpen]);

  const fetchMasterData = async () => {
    try {
      const [c, m, s] = await Promise.all([
        fetch('/api/rahaza/customers?active=true&limit=200', { headers }).then(r => r.json()),
        fetch('/api/rahaza/models?active=true&limit=200', { headers }).then(r => r.json()),
        fetch('/api/rahaza/sizes?active=true&limit=200', { headers }).then(r => r.json()),
      ]);
      setCustomers(Array.isArray(c) ? c : c.items || []);
      setModels(Array.isArray(m) ? m : m.items || []);
      setSizes(Array.isArray(s) ? s : s.items || []);
    } catch (e) {
      console.error('Failed to fetch master data:', e);
    }
  };

  const validateStep1 = () => {
    if (!form.is_internal && !form.customer_id) {
      setError('Pilih pelanggan atau centang Produksi Internal.');
      return false;
    }
    const validItems = form.items.filter(i => i.model_id && i.size_id && Number(i.qty) > 0);
    if (validItems.length === 0) {
      setError('Minimal 1 item dengan model, size, dan qty > 0.');
      return false;
    }
    setError('');
    return true;
  };

  const handleNext = async () => {
    if (step === 1) {
      if (!validateStep1()) return;
      // Fetch preview
      setPreviewLoading(true);
      try {
        const cleanedItems = form.items
          .filter(i => i.model_id && i.size_id && Number(i.qty) > 0)
          .map(i => ({ model_id: i.model_id, size_id: i.size_id, qty: Number(i.qty) }));
        const res = await fetch('/api/rahaza/wizard/preview-production', {
          method: 'POST',
          headers,
          body: JSON.stringify({ items: cleanedItems }),
        });
        if (!res.ok) throw new Error('Preview gagal');
        const data = await res.json();
        setPreviewData(data);
        setStep(2);
      } catch (e) {
        toast.error('Gagal mendapatkan preview: ' + e.message);
      } finally {
        setPreviewLoading(false);
      }
    } else if (step === 2) {
      setStep(3);
    }
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const handleSubmit = async () => {
    if (!confirmed) {
      setError('Centang konfirmasi terlebih dahulu.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const payload = {
        is_internal: form.is_internal,
        customer_id: form.customer_id || null,
        order_date: form.order_date,
        due_date: form.due_date || null,
        items: form.items
          .filter(i => i.model_id && i.size_id && Number(i.qty) > 0)
          .map(i => ({ model_id: i.model_id, size_id: i.size_id, qty: Number(i.qty) })),
        notes: form.notes,
        auto_release_wo: true,
        auto_generate_bundles: true,
      };
      const res = await fetch('/api/rahaza/wizard/start-production', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `HTTP ${res.status}`);
      }
      const result = await res.json();
      toast.success(
        `✅ Produksi dimulai! Order ${result.order_number} · ${result.wos_created} WO · ${result.bundles_created} bundles`
      );
      handleClose();
    } catch (e) {
      toast.error('Gagal memulai produksi: ' + e.message);
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setStep(1);
    setForm({
      is_internal: false,
      customer_id: '',
      order_date: new Date().toISOString().split('T')[0],
      due_date: '',
      items: [{ model_id: '', size_id: '', qty: '' }],
      notes: '',
    });
    setPreviewData(null);
    setConfirmed(false);
    setError('');
    closeWizard();
  };

  if (!wizardOpen) {
    // Global mount (in PortalShell): only renders the dialog, don't show landing page
    if (isGlobalMount) return null;
    // Navigation module render: show landing page with launch button
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center px-4">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center shadow-[0_0_24px_hsl(var(--primary)/0.2)]">
          <Wand2 className="w-8 h-8 text-primary" />
        </div>
        <div>
          <h2 className="text-2xl font-display font-semibold text-foreground mb-2">Production Wizard</h2>
          <p className="text-muted-foreground text-sm max-w-md">
            Mulai produksi baru dengan cepat: Order → WO → Release → Bundles dalam 3 langkah.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-4 text-left max-w-lg w-full">
          {[
            { step: 1, icon: FileText, label: 'Data Order', desc: 'Isi customer, model, size, dan qty.' },
            { step: 2, icon: Package, label: 'Preview WO', desc: 'Review Work Order yang akan dibuat.' },
            { step: 3, icon: CheckCircle2, label: 'Konfirmasi', desc: 'Konfirmasi & mulai produksi.' },
          ].map(s => {
            const Icon = s.icon;
            return (
              <div key={s.step} className="rounded-[var(--radius-lg)] border border-border/50 bg-[var(--glass-bg)] p-4">
                <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mb-2">
                  <Icon className="w-4 h-4 text-primary" />
                </div>
                <p className="text-xs font-semibold text-foreground mb-1">Step {s.step}: {s.label}</p>
                <p className="text-[11px] text-muted-foreground">{s.desc}</p>
              </div>
            );
          })}
        </div>
        <Button
          size="lg"
          className="gap-2 px-8 shadow-[var(--shadow-glow-blue)]"
          onClick={openWizard}
          data-testid="production-wizard-open-button"
        >
          <Wand2 className="w-5 h-5" />
          Mulai Wizard Produksi
        </Button>
        <p className="text-xs text-muted-foreground">
          Atau gunakan tombol ✨ di pojok kanan bawah · Shortcut: <kbd className="px-1.5 py-0.5 rounded border border-border text-[10px] font-mono bg-[var(--glass-bg)]">Alt+I</kbd>
        </p>
      </div>
    );
  }

  // When wizard is open:
  // - Nav module: keep showing landing page (dialog is rendered by global mount)
  // - Global mount: render the actual dialog
  if (!isGlobalMount) {
    // Nav module instance — the global mount handles the actual dialog rendering
    return null;
  }

  return (
    <Dialog open={wizardOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-[980px] max-h-[85vh] overflow-hidden flex flex-col" data-testid="production-wizard-dialog">
        <DialogHeader className="pb-2 border-b border-border/60">
          <DialogTitle className="text-xl font-display flex items-center gap-2">
            <Wand2 className="w-5 h-5 text-primary" />
            Production Wizard
          </DialogTitle>
          <DialogDescription>
            Mulai produksi dengan 1 klik: Order → WO → Release → Bundles
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-4 flex-1 overflow-hidden">
          <WizardStepper currentStep={step} />

          <div className="flex-1 overflow-y-auto pr-2">
            {error && (
              <div className="bg-red-400/10 border border-red-300/20 rounded-lg p-3 mb-4 text-sm text-red-300">
                {error}
              </div>
            )}

            {step === 1 && <Step1OrderData form={form} setForm={setForm} customers={customers} models={models} sizes={sizes} />}
            {step === 2 && <Step2Preview previewData={previewData} loading={previewLoading} />}
            {step === 3 && <Step3Confirm form={form} previewData={previewData} confirmed={confirmed} setConfirmed={setConfirmed} />}
          </div>
        </div>

        <DialogFooter className="pt-3 border-t border-border/60">
          {step > 1 && (
            <Button variant="ghost" onClick={handleBack} disabled={submitting} data-testid="production-wizard-back-button">
              <ChevronLeft className="w-4 h-4 mr-1" /> Kembali
            </Button>
          )}
          <div className="flex-1" />
          {step < 3 && (
            <Button onClick={handleNext} disabled={previewLoading} data-testid="production-wizard-next-button">
              Lanjut <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          )}
          {step === 3 && (
            <Button
              onClick={handleSubmit}
              disabled={!confirmed || submitting}
              data-testid="production-wizard-confirm-button"
            >
              {submitting ? 'Memproses...' : 'Mulai Produksi'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
