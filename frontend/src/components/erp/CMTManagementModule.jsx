import { useState, useEffect, useCallback, useMemo } from 'react';
import { Factory, Plus, CheckCircle2, AlertTriangle, Clock, Banknote, Truck, Users, Star, Edit2, Eye, RefreshCw, XCircle, Package } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { PageHeader } from './moduleAtoms';

const JOB_STATUS = {
  assigned:   { label: 'Ditugaskan',  color: 'bg-blue-500/15 text-blue-300 border-blue-400/30' },
  in_sewing:  { label: 'Sedang Jahit', color: 'bg-violet-500/15 text-violet-300 border-violet-400/30' },
  done:       { label: 'Selesai',     color: 'bg-green-500/15 text-green-300 border-green-400/30' },
  partial:    { label: 'Sebagian',    color: 'bg-amber-500/15 text-amber-300 border-amber-400/30' },
  cancelled:  { label: 'Dibatalkan', color: 'bg-slate-500/15 text-slate-300 border-slate-400/30' },
  overdue:    { label: 'Terlambat',   color: 'bg-red-500/15 text-red-300 border-red-400/30' },
};
const DLV_STATUS = {
  pending:  { label: 'Menunggu Terima', color: 'bg-amber-500/15 text-amber-300 border-amber-400/30' },
  verified: { label: 'Diterima',        color: 'bg-green-500/15 text-green-300 border-green-400/30' },
};
const PAY_STATUS = {
  draft:    { label: 'Draft',     color: 'bg-slate-500/15 text-slate-300 border-slate-400/30' },
  approved: { label: 'Disetujui', color: 'bg-blue-500/15 text-blue-300 border-blue-400/30' },
  paid:     { label: 'Lunas',     color: 'bg-green-500/15 text-green-300 border-green-400/30' },
};

function StatusBadge({ status, map }) {
  const c = map[status] || map.draft;
  return <span className={`inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full border ${c.color}`}>{c.label}</span>;
}

const formatRp = (n) => `Rp ${Number(n||0).toLocaleString('id-ID')}`;

export default function CMTManagementModule({ token, onNavigate }) {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }), [token]);

  const [summary, setSummary]       = useState({});
  const [partners, setPartners]     = useState([]);
  const [jobs, setJobs]             = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [payments, setPayments]     = useState([]);
  const [loading, setLoading]       = useState(false);
  const [tab, setTab]               = useState('partners');

  // Dialogs
  const [partnerDialog, setPartnerDialog]   = useState(null);  // null | {} | {data}
  const [jobDialog, setJobDialog]           = useState(false);
  const [deliveryDialog, setDeliveryDialog] = useState(false);
  const [receiveDialog, setReceiveDialog]   = useState(null);
  const [paymentDialog, setPaymentDialog]   = useState(false);
  const [viewJob, setViewJob]               = useState(null);
  const [compReqDialog, setCompReqDialog]   = useState(null);  // job

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [sumR, parR, jobR, dlvR, payR] = await Promise.all([
        fetch('/api/dewi/cmt/summary',    { headers }),
        fetch('/api/dewi/cmt/partners',   { headers }),
        fetch('/api/dewi/cmt/jobs',       { headers }),
        fetch('/api/dewi/cmt/deliveries', { headers }),
        fetch('/api/dewi/cmt/payments',   { headers }),
      ]);
      if (sumR.ok) setSummary(await sumR.json());
      if (parR.ok) setPartners(await parR.json());
      if (jobR.ok) setJobs(await jobR.json());
      if (dlvR.ok) setDeliveries(await dlvR.json());
      if (payR.ok) setPayments(await payR.json());
    } catch(e) { toast.error('Gagal memuat data CMT'); }
    finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const togglePartner = async (p) => {
    const r = await fetch(`/api/dewi/cmt/partners/${p.id}/toggle`, { method: 'PUT', headers });
    if (r.ok) { toast.success(`CMT ${p.name} ${p.status === 'active' ? 'dinonaktifkan' : 'diaktifkan'}`); fetchAll(); }
  };

  const updateJobStatus = async (job, status, delivery_date_actual = null) => {
    const body = { status };
    if (delivery_date_actual) body.delivery_date_actual = delivery_date_actual;
    const r = await fetch(`/api/dewi/cmt/jobs/${job.id}/status`, { method: 'PUT', headers, body: JSON.stringify(body) });
    if (r.ok) { toast.success('Status job diperbarui'); fetchAll(); }
    else { const e = await r.json(); toast.error(e.detail || 'Gagal'); }
  };

  const approvePayment = async (pay) => {
    const r = await fetch(`/api/dewi/cmt/payments/${pay.id}/approve`, { method: 'PUT', headers });
    if (r.ok) { toast.success('Pembayaran disetujui'); fetchAll(); }
  };
  const markPaid = async (pay) => {
    const r = await fetch(`/api/dewi/cmt/payments/${pay.id}/paid`, { method: 'PUT', headers, body: JSON.stringify({ payment_date: new Date().toISOString().split('T')[0] }) });
    if (r.ok) { toast.success('Pembayaran ditandai lunas'); fetchAll(); }
  };

  const stats = [
    { label: 'CMT Aktif',          value: summary.active_cmt           || 0, icon: Users,        color: 'text-blue-400 bg-blue-500/10 border-blue-400/20' },
    { label: 'Job Berjalan',       value: summary.active_jobs          || 0, icon: Factory,      color: 'text-violet-400 bg-violet-500/10 border-violet-400/20' },
    { label: 'Terlambat',          value: summary.overdue_jobs         || 0, icon: AlertTriangle,color: 'text-red-400 bg-red-500/10 border-red-400/20' },
    { label: 'Tagihan Pending',    value: summary.pending_payments     || 0, icon: Banknote,     color: 'text-amber-400 bg-amber-500/10 border-amber-400/20' },
  ];

  return (
    <div className="p-6 space-y-6" data-testid="cmt-module">
      <PageHeader
        title="Manajemen CMT"
        description="Contract Manufacturing Team — job assignment, tracking, penerimaan, dan pembayaran jahit"
        icon={Factory}
        actions={<Button size="sm" onClick={fetchAll} variant="outline" className="gap-2"><RefreshCw className="w-3.5 h-3.5" /> Refresh</Button>}
      />

      {/* Stats */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 * i }}>
            <GlassCard className={`p-4 border ${s.color.split(' ')[2]}`}>
              <div className={`w-8 h-8 rounded-lg border ${s.color} flex items-center justify-center mb-2`}>
                <s.icon className={`w-4 h-4 ${s.color.split(' ')[0]}`} />
              </div>
              <div className="text-2xl font-bold text-foreground">{s.value}</div>
              <div className="text-xs text-foreground/50">{s.label}</div>
            </GlassCard>
          </motion.div>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 flex-wrap h-auto gap-1">
          <TabsTrigger value="partners">Master CMT ({partners.length})</TabsTrigger>
          <TabsTrigger value="jobs">Job Assignment ({jobs.length})</TabsTrigger>
          <TabsTrigger value="deliveries">Terima dari CMT ({deliveries.length})</TabsTrigger>
          <TabsTrigger value="payments">Pembayaran ({payments.length})</TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Master CMT ── */}
        <TabsContent value="partners">
          <GlassCard className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-foreground/80">Database CMT (Kontraktor Jahit)</h3>
              <Button size="sm" onClick={() => setPartnerDialog({})} className="gap-1.5"><Plus className="w-3.5 h-3.5" /> Tambah CMT</Button>
            </div>
            {partners.length === 0 ? (
              <div className="text-center py-10 text-foreground/40 text-sm">Belum ada CMT terdaftar</div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                {partners.map(p => (
                  <div key={p.id} className={`p-4 rounded-xl border transition-all ${ p.status === 'active' ? 'bg-white/3 border-white/8 hover:border-white/15' : 'bg-white/1 border-white/5 opacity-60' }`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground">{p.name}</span>
                          <span className="text-[10px] bg-white/8 px-1.5 py-0.5 rounded text-foreground/50 font-mono">{p.code}</span>
                          {p.status === 'inactive' && <span className="text-[10px] bg-red-500/15 text-red-400 px-1.5 py-0.5 rounded border border-red-400/25">Nonaktif</span>}
                        </div>
                        <div className="text-xs text-foreground/50 mt-0.5">{p.owner_name} · {p.city} · {p.phone}</div>
                        <div className="flex items-center gap-3 mt-2">
                          <span className="text-xs text-foreground/60"><strong className="text-foreground">{formatRp(p.rate_per_pcs)}</strong>/pcs</span>
                          <span className="text-xs text-foreground/50">Kapasitas: {p.capacity_per_week || '-'} pcs/minggu</span>
                        </div>
                        {(p.specialization||[]).length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {p.specialization.map(s => <span key={s} className="text-[10px] bg-violet-500/15 text-violet-300 px-1.5 py-0.5 rounded border border-violet-400/25">{s}</span>)}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <div className="flex items-center gap-0.5">
                          {[1,2,3,4,5].map(n => <Star key={n} className={`w-3 h-3 ${n <= Math.round(p.rating||0) ? 'text-amber-400 fill-amber-400' : 'text-foreground/20'}`} />)}
                        </div>
                        <div className="flex gap-1 mt-1">
                          <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => setPartnerDialog({ data: p })}><Edit2 className="w-3.5 h-3.5" /></Button>
                          <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => togglePartner(p)}>{p.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'}</Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>
        </TabsContent>

        {/* ── Tab 2: Job Assignment ── */}
        <TabsContent value="jobs">
          <GlassCard className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-foreground/80">Job Assignment ke CMT</h3>
              <Button size="sm" onClick={() => setJobDialog(true)} className="gap-1.5"><Plus className="w-3.5 h-3.5" /> Buat Job</Button>
            </div>
            {jobs.length === 0 ? (
              <div className="text-center py-10 text-foreground/40 text-sm">Belum ada job CMT</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-white/5 text-xs text-foreground/50">
                    <th className="pb-2 text-left">Job Code</th>
                    <th className="pb-2 text-left">CMT</th>
                    <th className="pb-2 text-left">Produk</th>
                    <th className="pb-2 text-center">Qty</th>
                    <th className="pb-2 text-right">Biaya Jahit</th>
                    <th className="pb-2 text-left">Deadline</th>
                    <th className="pb-2 text-center">Sisa Hari</th>
                    <th className="pb-2 text-left">Status</th>
                    <th className="pb-2 text-center">Aksi</th>
                  </tr></thead>
                  <tbody className="divide-y divide-white/5">
                    {jobs.map(j => {
                      const today = new Date();
                      const deadline = new Date(j.deadline_date);
                      const diffDays = Math.ceil((deadline - today) / (1000*60*60*24));
                      const isOverdue = j.is_overdue || (diffDays < 0 && !['done','cancelled'].includes(j.status));
                      const displayStatus = isOverdue && j.status !== 'done' ? 'overdue' : j.status;
                      return (
                        <tr key={j.id} className={`hover:bg-white/3 transition-colors ${isOverdue ? 'bg-red-500/3' : ''}`}>
                          <td className="py-2.5 pr-3 font-mono text-xs text-foreground/70">{j.job_code}</td>
                          <td className="py-2.5 pr-3">
                            <div className="font-medium text-foreground">{j.cmt_name}</div>
                          </td>
                          <td className="py-2.5 pr-3 text-foreground/80">{j.product_model_name}</td>
                          <td className="py-2.5 pr-3 text-center font-bold">{j.qty_total}</td>
                          <td className="py-2.5 pr-3 text-right text-foreground/80">{formatRp(j.total_sewing_cost)}</td>
                          <td className="py-2.5 pr-3 text-xs">{j.deadline_date}</td>
                          <td className="py-2.5 pr-3 text-center">
                            <span className={`text-xs font-semibold ${ diffDays < 0 ? 'text-red-400' : diffDays <= 3 ? 'text-amber-400' : 'text-green-400' }`}>
                              {diffDays < 0 ? `+${Math.abs(diffDays)}H terlambat` : `${diffDays}H`}
                            </span>
                          </td>
                          <td className="py-2.5 pr-3"><StatusBadge status={displayStatus} map={JOB_STATUS} /></td>
                          <td className="py-2.5">
                            <div className="flex gap-1 justify-center">
                              <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => setViewJob(j)}><Eye className="w-3.5 h-3.5" /></Button>
                              {j.status === 'assigned' && (
                                <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => updateJobStatus(j, 'in_sewing')}>Mulai Jahit</Button>
                              )}
                              {j.status === 'in_sewing' && (
                                <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setDeliveryDialog(j)}>Catat Kiriman</Button>
                              )}
                              <Button size="icon" variant="ghost" className="w-7 h-7 text-amber-400" title="Request Komponen" onClick={() => setCompReqDialog(j)}>
                                <Package className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </GlassCard>
        </TabsContent>

        {/* ── Tab 3: Terima dari CMT ── */}
        <TabsContent value="deliveries">
          <GlassCard className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-foreground/80">Penerimaan Barang dari CMT</h3>
            </div>
            {deliveries.length === 0 ? (
              <div className="text-center py-10 text-foreground/40 text-sm">Belum ada pengiriman dari CMT</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-white/5 text-xs text-foreground/50">
                    <th className="pb-2 text-left">Kode</th><th className="pb-2 text-left">CMT</th>
                    <th className="pb-2 text-left">Produk</th><th className="pb-2 text-center">Qty Kirim</th>
                    <th className="pb-2 text-left">Tgl Kirim</th><th className="pb-2 text-center">Terlambat</th>
                    <th className="pb-2 text-right">Denda</th><th className="pb-2 text-left">Status</th>
                    <th className="pb-2 text-center">Aksi</th>
                  </tr></thead>
                  <tbody className="divide-y divide-white/5">
                    {deliveries.map(d => (
                      <tr key={d.id} className={`hover:bg-white/3 ${d.is_late ? 'bg-red-500/3' : ''}`}>
                        <td className="py-2.5 pr-3 font-mono text-xs text-foreground/70">{d.delivery_code}</td>
                        <td className="py-2.5 pr-3 font-medium">{d.cmt_name}</td>
                        <td className="py-2.5 pr-3 text-foreground/80">{d.product_model_name}</td>
                        <td className="py-2.5 pr-3 text-center font-bold">{d.qty_delivered}</td>
                        <td className="py-2.5 pr-3 text-xs">{d.delivery_date}</td>
                        <td className="py-2.5 pr-3 text-center">
                          {d.is_late ? (
                            <span className="text-xs text-red-400 font-semibold">+{d.late_days}H</span>
                          ) : <span className="text-xs text-green-400">Tepat Waktu</span>}
                        </td>
                        <td className="py-2.5 pr-3 text-right text-xs">{d.penalty_amount > 0 ? <span className="text-red-400">{formatRp(d.penalty_amount)}</span> : '—'}</td>
                        <td className="py-2.5 pr-3"><StatusBadge status={d.status} map={DLV_STATUS} /></td>
                        <td className="py-2.5">
                          {d.status === 'pending' && (
                            <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setReceiveDialog(d)}>Terima</Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </GlassCard>
        </TabsContent>

        {/* ── Tab 4: Pembayaran ── */}
        <TabsContent value="payments">
          <GlassCard className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-foreground/80">Pembayaran Ongkos Jahit CMT</h3>
              <Button size="sm" onClick={() => setPaymentDialog(true)} className="gap-1.5"><Plus className="w-3.5 h-3.5" /> Buat Tagihan</Button>
            </div>
            {payments.length === 0 ? (
              <div className="text-center py-10 text-foreground/40 text-sm">Belum ada tagihan pembayaran</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-white/5 text-xs text-foreground/50">
                    <th className="pb-2 text-left">Kode</th><th className="pb-2 text-left">CMT</th>
                    <th className="pb-2 text-center">Total Pcs</th><th className="pb-2 text-right">Subtotal</th>
                    <th className="pb-2 text-right">Denda</th><th className="pb-2 text-right">Net Bayar</th>
                    <th className="pb-2 text-left">Status</th><th className="pb-2 text-center">Aksi</th>
                  </tr></thead>
                  <tbody className="divide-y divide-white/5">
                    {payments.map(p => (
                      <tr key={p.id} className="hover:bg-white/3">
                        <td className="py-2.5 pr-3 font-mono text-xs text-foreground/70">{p.payment_code}</td>
                        <td className="py-2.5 pr-3 font-medium">{p.cmt_name}</td>
                        <td className="py-2.5 pr-3 text-center">{p.total_pcs}</td>
                        <td className="py-2.5 pr-3 text-right text-foreground/80">{formatRp(p.subtotal)}</td>
                        <td className="py-2.5 pr-3 text-right">{p.total_penalty > 0 ? <span className="text-red-400">{formatRp(p.total_penalty)}</span> : '—'}</td>
                        <td className="py-2.5 pr-3 text-right font-bold text-foreground">{formatRp(p.net_amount)}</td>
                        <td className="py-2.5 pr-3"><StatusBadge status={p.status} map={PAY_STATUS} /></td>
                        <td className="py-2.5">
                          <div className="flex gap-1 justify-center">
                            {p.status === 'draft' && <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => approvePayment(p)}>Approve</Button>}
                            {p.status === 'approved' && <Button size="sm" className="text-xs h-7" onClick={() => markPaid(p)}>Tandai Lunas</Button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </GlassCard>
        </TabsContent>
      </Tabs>

      {/* ── Dialogs ── */}
      {partnerDialog !== null && (
        <CMTPartnerDialog data={partnerDialog?.data || null} headers={headers} onClose={() => setPartnerDialog(null)} onSuccess={() => { setPartnerDialog(null); fetchAll(); }} />
      )}
      {jobDialog && (
        <CreateJobDialog partners={partners} headers={headers} onClose={() => setJobDialog(false)} onSuccess={() => { setJobDialog(false); fetchAll(); }} />
      )}
      {deliveryDialog && (
        <CreateDeliveryDialog job={deliveryDialog} headers={headers} onClose={() => setDeliveryDialog(false)} onSuccess={() => { setDeliveryDialog(false); fetchAll(); }} />
      )}
      {receiveDialog && (
        <ReceiveDeliveryDialog delivery={receiveDialog} headers={headers} onClose={() => setReceiveDialog(null)} onSuccess={() => { setReceiveDialog(null); fetchAll(); }} />
      )}
      {paymentDialog && (
        <CreatePaymentDialog partners={partners} jobs={jobs} headers={headers} onClose={() => setPaymentDialog(false)} onSuccess={() => { setPaymentDialog(false); fetchAll(); }} />
      )}
      {viewJob && <JobDetailDialog job={viewJob} onClose={() => setViewJob(null)} />}
      {compReqDialog && (
        <ComponentRequestDialog job={compReqDialog} headers={headers} onClose={() => setCompReqDialog(null)} onSuccess={() => { setCompReqDialog(null); fetchAll(); }} />
      )}
    </div>
  );
}

// ─── Dialogs ──────────────────────────────────────────────────────────────────

const SPECIALIZATIONS = ['Blouse', 'Dress', 'Rok', 'Celana', 'Hijab', 'Baju Anak', 'Set/Setelan', 'Kaos', 'Lainnya'];

function CMTPartnerDialog({ data, headers, onClose, onSuccess }) {
  const isEdit = !!data;
  const [form, setForm] = useState(data ? { ...data } : {
    name: '', owner_name: '', phone: '', address: '', city: 'Sragen',
    specialization: [], rate_per_pcs: '', capacity_per_week: '',
    bank_name: '', bank_account: '', bank_holder: '', penalty_per_day: '', rating: 4, notes: ''
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const toggleSpec = (s) => setForm(p => ({ ...p, specialization: p.specialization.includes(s) ? p.specialization.filter(x => x !== s) : [...p.specialization, s] }));

  const save = async () => {
    if (!form.name) { toast.error('Nama CMT wajib diisi'); return; }
    setSaving(true);
    const url = isEdit ? `/api/dewi/cmt/partners/${data.id}` : '/api/dewi/cmt/partners';
    const method = isEdit ? 'PUT' : 'POST';
    const r = await fetch(url, { method, headers, body: JSON.stringify({ ...form, rate_per_pcs: Number(form.rate_per_pcs||0), capacity_per_week: Number(form.capacity_per_week||0), penalty_per_day: Number(form.penalty_per_day||0) }) });
    setSaving(false);
    if (r.ok) { toast.success(isEdit ? 'CMT diperbarui' : 'CMT ditambahkan'); onSuccess(); }
    else { const e = await r.json(); toast.error(e.detail || 'Gagal menyimpan'); }
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{isEdit ? `Edit CMT: ${data.name}` : 'Tambah CMT Baru'}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1 col-span-2"><Label>Nama CMT *</Label><Input value={form.name} onChange={e => set('name', e.target.value)} /></div>
            <div className="space-y-1"><Label>Nama Pemilik</Label><Input value={form.owner_name} onChange={e => set('owner_name', e.target.value)} /></div>
            <div className="space-y-1"><Label>Nomor HP</Label><Input value={form.phone} onChange={e => set('phone', e.target.value)} /></div>
            <div className="space-y-1 col-span-2"><Label>Alamat</Label><Input value={form.address} onChange={e => set('address', e.target.value)} /></div>
            <div className="space-y-1"><Label>Kota/Kecamatan</Label><Input value={form.city} onChange={e => set('city', e.target.value)} /></div>
            <div className="space-y-1"><Label>Rate Jahit (Rp/pcs)</Label><Input type="number" value={form.rate_per_pcs} onChange={e => set('rate_per_pcs', e.target.value)} /></div>
            <div className="space-y-1"><Label>Kapasitas (pcs/minggu)</Label><Input type="number" value={form.capacity_per_week} onChange={e => set('capacity_per_week', e.target.value)} /></div>
            <div className="space-y-1"><Label>Denda Keterlambatan (Rp/hari)</Label><Input type="number" value={form.penalty_per_day} onChange={e => set('penalty_per_day', e.target.value)} /></div>
          </div>
          <div className="space-y-1">
            <Label>Spesialisasi</Label>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {SPECIALIZATIONS.map(s => (
                <button key={s} onClick={() => toggleSpec(s)} className={`text-xs px-2.5 py-1 rounded-full border transition-all ${ form.specialization.includes(s) ? 'bg-violet-500/20 border-violet-400/40 text-violet-300' : 'bg-white/5 border-white/10 text-foreground/60 hover:border-white/25' }`}>{s}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1"><Label>Nama Bank</Label><Input value={form.bank_name} onChange={e => set('bank_name', e.target.value)} placeholder="BRI / BNI / BSI" /></div>
            <div className="space-y-1"><Label>Nomor Rekening</Label><Input value={form.bank_account} onChange={e => set('bank_account', e.target.value)} /></div>
            <div className="space-y-1"><Label>Atas Nama</Label><Input value={form.bank_holder} onChange={e => set('bank_holder', e.target.value)} /></div>
          </div>
          <div className="space-y-1"><Label>Catatan</Label><Textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Menyimpan...' : (isEdit ? 'Simpan' : 'Tambah CMT')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateJobDialog({ partners, headers, onClose, onSuccess }) {
  const today = new Date().toISOString().split('T')[0];
  const sevenDays = new Date(Date.now() + 7*24*60*60*1000).toISOString().split('T')[0];
  const [form, setForm] = useState({
    cmt_partner_id: '', product_model_name: '', product_category: '',
    qty_total: '', qty_per_color: [], sewing_rate_per_pcs: '',
    assign_date: today, deadline_date: sevenDays,
    penalty_per_day: '', notes: ''
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const selectPartner = (id) => {
    const p = partners.find(x => x.id === id);
    setForm(prev => ({ ...prev, cmt_partner_id: id, sewing_rate_per_pcs: p?.rate_per_pcs || '', penalty_per_day: p?.penalty_per_day || '' }));
  };

  const addColorQty = () => setForm(p => ({ ...p, qty_per_color: [...p.qty_per_color, { color: '', pcs: '' }] }));
  const updateColorQty = (i, k, v) => setForm(p => { const r = [...p.qty_per_color]; r[i] = { ...r[i], [k]: v }; return { ...p, qty_per_color: r }; });
  const removeColorQty = (i) => setForm(p => ({ ...p, qty_per_color: p.qty_per_color.filter((_, idx) => idx !== i) }));

  const save = async () => {
    if (!form.cmt_partner_id || !form.product_model_name || !form.qty_total || !form.deadline_date) {
      toast.error('CMT, produk, qty, dan deadline wajib diisi'); return;
    }
    setSaving(true);
    const r = await fetch('/api/dewi/cmt/jobs', {
      method: 'POST', headers,
      body: JSON.stringify({ ...form, qty_total: Number(form.qty_total), sewing_rate_per_pcs: Number(form.sewing_rate_per_pcs||0), penalty_per_day: Number(form.penalty_per_day||0) })
    });
    setSaving(false);
    if (r.ok) { toast.success('Job CMT dibuat'); onSuccess(); }
    else { const e = await r.json(); toast.error(e.detail || 'Gagal membuat job'); }
  };

  const activePartners = partners.filter(p => p.status === 'active');
  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Buat Job CMT</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Pilih CMT *</Label>
            <Select value={form.cmt_partner_id} onValueChange={selectPartner}>
              <SelectTrigger><SelectValue placeholder="Pilih CMT..." /></SelectTrigger>
              <SelectContent>
                {activePartners.map(p => <SelectItem key={p.id} value={p.id}>{p.name} — {formatRp(p.rate_per_pcs)}/pcs</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1 col-span-2"><Label>Nama Produk *</Label><Input value={form.product_model_name} onChange={e => set('product_model_name', e.target.value)} /></div>
            <div className="space-y-1"><Label>Total Qty *</Label><Input type="number" value={form.qty_total} onChange={e => set('qty_total', e.target.value)} /></div>
            <div className="space-y-1"><Label>Rate Jahit (Rp/pcs)</Label><Input type="number" value={form.sewing_rate_per_pcs} onChange={e => set('sewing_rate_per_pcs', e.target.value)} /></div>
            <div className="space-y-1"><Label>Tanggal Assign</Label><Input type="date" value={form.assign_date} onChange={e => set('assign_date', e.target.value)} /></div>
            <div className="space-y-1"><Label>Deadline *</Label><Input type="date" value={form.deadline_date} onChange={e => set('deadline_date', e.target.value)} /></div>
            <div className="space-y-1 col-span-2"><Label>Denda Keterlambatan (Rp/hari)</Label><Input type="number" value={form.penalty_per_day} onChange={e => set('penalty_per_day', e.target.value)} /></div>
          </div>

          {/* Qty per Color */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Qty per Warna</Label>
              <Button size="sm" variant="outline" onClick={addColorQty} className="text-xs h-7">+ Tambah</Button>
            </div>
            {form.qty_per_color.map((c, i) => (
              <div key={i} className="grid grid-cols-3 gap-2 items-end p-2 rounded-lg bg-white/3 border border-white/8">
                <div><Label className="text-xs">Warna</Label><Input className="h-8" value={c.color} onChange={e => updateColorQty(i, 'color', e.target.value)} /></div>
                <div><Label className="text-xs">Pcs</Label><Input className="h-8" type="number" value={c.pcs} onChange={e => updateColorQty(i, 'pcs', e.target.value)} /></div>
                <Button size="icon" variant="ghost" className="h-8 w-8 mt-auto text-red-400" onClick={() => removeColorQty(i)}><XCircle className="w-3.5 h-3.5" /></Button>
              </div>
            ))}
          </div>
          <div className="space-y-1"><Label>Catatan</Label><Textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Menyimpan...' : 'Buat Job'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateDeliveryDialog({ job, headers, onClose, onSuccess }) {
  const [form, setForm] = useState({ job_id: job.id, delivery_date: new Date().toISOString().split('T')[0], qty_delivered: job.qty_total || '', qty_per_color: [], notes: '' });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const save = async () => {
    if (!form.qty_delivered) { toast.error('Qty wajib diisi'); return; }
    setSaving(true);
    const r = await fetch('/api/dewi/cmt/deliveries', { method: 'POST', headers, body: JSON.stringify({ ...form, qty_delivered: Number(form.qty_delivered) }) });
    setSaving(false);
    if (r.ok) { toast.success('Pengiriman CMT dicatat'); onSuccess(); }
    else { const e = await r.json(); toast.error(e.detail || 'Gagal'); }
  };
  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Catat Kiriman dari CMT: {job.cmt_name}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="p-3 rounded-xl bg-white/3 border border-white/8 text-sm">
            <div className="text-foreground/60">Job: <strong className="text-foreground">{job.job_code}</strong> · Produk: <strong>{job.product_model_name}</strong></div>
            <div className="text-foreground/60 mt-0.5">Qty total: <strong>{job.qty_total} pcs</strong> · Deadline: <strong className="text-amber-400">{job.deadline_date}</strong></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Tanggal Kirim</Label><Input className="mt-1" type="date" value={form.delivery_date} onChange={e => set('delivery_date', e.target.value)} /></div>
            <div><Label>Qty Dikirim *</Label><Input className="mt-1" type="number" value={form.qty_delivered} onChange={e => set('qty_delivered', e.target.value)} /></div>
          </div>
          <div><Label>Catatan</Label><Textarea className="mt-1" value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Menyimpan...' : 'Catat Pengiriman'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReceiveDeliveryDialog({ delivery, headers, onClose, onSuccess }) {
  const [form, setForm] = useState({ received_date: new Date().toISOString().split('T')[0], qty_received: delivery.qty_delivered, qc_pass_qty: delivery.qty_delivered, qc_reject_qty: 0 });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const save = async () => {
    setSaving(true);
    const r = await fetch(`/api/dewi/cmt/deliveries/${delivery.id}/receive`, { method: 'PUT', headers, body: JSON.stringify(form) });
    setSaving(false);
    if (r.ok) { toast.success('Barang diterima dari CMT'); onSuccess(); }
    else toast.error('Gagal menerima');
  };
  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Terima Barang dari {delivery.cmt_name}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="p-3 rounded-xl bg-white/3 border border-white/8 text-sm">
            <div>Qty dikirim: <strong>{delivery.qty_delivered} pcs</strong></div>
            {delivery.is_late && <div className="text-red-400 mt-0.5">⚠️ Terlambat {delivery.late_days} hari · Denda: {formatRp(delivery.penalty_amount)}</div>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Tanggal Terima</Label><Input className="mt-1" type="date" value={form.received_date} onChange={e => set('received_date', e.target.value)} /></div>
            <div><Label>Qty Diterima</Label><Input className="mt-1" type="number" value={form.qty_received} onChange={e => set('qty_received', Number(e.target.value))} /></div>
            <div><Label>QC Lolos</Label><Input className="mt-1" type="number" value={form.qc_pass_qty} onChange={e => set('qc_pass_qty', Number(e.target.value))} /></div>
            <div><Label>QC Reject</Label><Input className="mt-1" type="number" value={form.qc_reject_qty} onChange={e => set('qc_reject_qty', Number(e.target.value))} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Menyimpan...' : 'Konfirmasi Terima'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreatePaymentDialog({ partners, jobs, headers, onClose, onSuccess }) {
  const today = new Date().toISOString().split('T')[0];
  const [cmtId, setCmtId] = useState('');
  const [selectedJobs, setSelectedJobs] = useState([]);
  const [form, setForm] = useState({ period_from: today, period_to: today, payment_method: 'transfer', notes: '' });
  const [saving, setSaving] = useState(false);

  const availableJobs = jobs.filter(j => j.cmt_partner_id === cmtId && ['done','partial'].includes(j.status));
  const toggleJob = (id) => setSelectedJobs(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

  const totals = useMemo(() => {
    const sel = availableJobs.filter(j => selectedJobs.includes(j.id));
    return {
      pcs: sel.reduce((s, j) => s + (j.qty_received || j.qty_total), 0),
      cost: sel.reduce((s, j) => s + (j.total_sewing_cost || 0), 0),
      penalty: sel.reduce((s, j) => s + (j.total_penalty || 0), 0),
    };
  }, [selectedJobs, availableJobs]);

  const save = async () => {
    if (!cmtId) { toast.error('Pilih CMT dahulu'); return; }
    setSaving(true);
    const r = await fetch('/api/dewi/cmt/payments', {
      method: 'POST', headers,
      body: JSON.stringify({ cmt_partner_id: cmtId, job_ids: selectedJobs, ...form })
    });
    setSaving(false);
    if (r.ok) { toast.success('Tagihan pembayaran dibuat'); onSuccess(); }
    else { const e = await r.json(); toast.error(e.detail || 'Gagal'); }
  };

  const activePartners = partners.filter(p => p.status === 'active');
  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Buat Tagihan Pembayaran CMT</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Pilih CMT *</Label>
            <Select value={cmtId} onValueChange={v => { setCmtId(v); setSelectedJobs([]); }}>
              <SelectTrigger><SelectValue placeholder="Pilih CMT..." /></SelectTrigger>
              <SelectContent>{activePartners.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {cmtId && availableJobs.length > 0 && (
            <div className="space-y-2">
              <Label>Pilih Job yang Dibayar</Label>
              {availableJobs.map(j => (
                <div key={j.id} onClick={() => toggleJob(j.id)} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${ selectedJobs.includes(j.id) ? 'bg-primary/10 border-primary/30' : 'bg-white/3 border-white/8 hover:border-white/15' }`}>
                  <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${ selectedJobs.includes(j.id) ? 'bg-primary border-primary' : 'border-foreground/30' }`}>
                    {selectedJobs.includes(j.id) && <CheckCircle2 className="w-3 h-3 text-white" />}
                  </div>
                  <div className="flex-1 text-sm">
                    <div className="font-medium">{j.job_code} · {j.product_model_name}</div>
                    <div className="text-xs text-foreground/50">{j.qty_received || j.qty_total} pcs · {formatRp(j.total_sewing_cost)} · Denda: {formatRp(j.total_penalty)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {cmtId && availableJobs.length === 0 && <p className="text-sm text-foreground/50 italic">Tidak ada job selesai untuk CMT ini.</p>}
          {selectedJobs.length > 0 && (
            <div className="p-3 rounded-xl bg-primary/8 border border-primary/20 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-foreground/60">Total Pcs:</span><strong>{totals.pcs}</strong></div>
              <div className="flex justify-between"><span className="text-foreground/60">Subtotal Biaya:</span><strong>{formatRp(totals.cost)}</strong></div>
              <div className="flex justify-between"><span className="text-foreground/60">Total Denda:</span><strong className="text-red-400">{formatRp(totals.penalty)}</strong></div>
              <div className="flex justify-between border-t border-white/10 pt-1"><span className="font-semibold">NET BAYAR:</span><strong className="text-green-400">{formatRp(totals.cost - totals.penalty)}</strong></div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Periode Dari</Label><Input className="mt-1" type="date" value={form.period_from} onChange={e => setForm(p => ({ ...p, period_from: e.target.value }))} /></div>
            <div><Label>Periode Sampai</Label><Input className="mt-1" type="date" value={form.period_to} onChange={e => setForm(p => ({ ...p, period_to: e.target.value }))} /></div>
          </div>
          <div><Label>Catatan</Label><Textarea className="mt-1" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Menyimpan...' : 'Buat Tagihan'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ComponentRequestDialog({ job, headers, onClose, onSuccess }) {
  const [form, setForm] = useState({ component_name: '', qty: '', unit: 'pcs', reason: '' });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const save = async () => {
    if (!form.component_name || !form.qty) { toast.error('Nama komponen dan qty wajib'); return; }
    setSaving(true);
    const r = await fetch(`/api/dewi/cmt/jobs/${job.id}/component-request`, { method: 'POST', headers, body: JSON.stringify({ ...form, qty: Number(form.qty) }) });
    setSaving(false);
    if (r.ok) { toast.success('Request komponen dicatat'); onSuccess(); }
    else toast.error('Gagal');
  };
  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Request Komponen dari CMT: {job.cmt_name}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="p-3 rounded-xl bg-amber-500/8 border border-amber-400/20 text-xs text-foreground/70">Job: {job.job_code} · {job.product_model_name}</div>
          <div><Label>Nama Komponen *</Label><Input className="mt-1" value={form.component_name} onChange={e => set('component_name', e.target.value)} placeholder="Contoh: Label merek, Kancing, dll" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Qty *</Label><Input className="mt-1" type="number" value={form.qty} onChange={e => set('qty', e.target.value)} /></div>
            <div><Label>Satuan</Label><Select value={form.unit} onValueChange={v => set('unit', v)}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pcs">pcs</SelectItem><SelectItem value="meter">meter</SelectItem><SelectItem value="kg">kg</SelectItem><SelectItem value="set">set</SelectItem></SelectContent></Select></div>
          </div>
          <div><Label>Alasan</Label><Textarea className="mt-1" value={form.reason} onChange={e => set('reason', e.target.value)} rows={2} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Menyimpan...' : 'Kirim Request'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function JobDetailDialog({ job, onClose }) {
  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Detail Job: {job.job_code}</DialogTitle></DialogHeader>
        <div className="space-y-2 py-2 text-sm">
          <InfoRow label="CMT" value={job.cmt_name} />
          <InfoRow label="Produk" value={job.product_model_name} />
          <InfoRow label="Total Qty" value={`${job.qty_total} pcs`} />
          <InfoRow label="Qty Diterima" value={`${job.qty_received || 0} pcs`} />
          <InfoRow label="QC Lolos" value={`${job.qc_pass_qty || 0} pcs`} />
          <InfoRow label="QC Reject" value={`${job.qc_reject_qty || 0} pcs`} />
          <InfoRow label="Rate Jahit" value={formatRp(job.sewing_rate_per_pcs)} />
          <InfoRow label="Total Biaya" value={formatRp(job.total_sewing_cost)} />
          <InfoRow label="Deadline" value={job.deadline_date} />
          {job.delivery_date_actual && <InfoRow label="Tgl Kirim Aktual" value={job.delivery_date_actual} />}
          {job.total_penalty > 0 && <div className="flex gap-3"><span className="text-foreground/50 w-32">Denda:</span><span className="text-red-400 font-semibold">{formatRp(job.total_penalty)}</span></div>}
          <InfoRow label="Status" value={<StatusBadge status={job.status} map={JOB_STATUS} />} />
          {(job.component_requests||[]).length > 0 && (
            <div className="mt-3 p-3 rounded-xl bg-amber-500/8 border border-amber-400/20">
              <p className="text-xs font-semibold text-amber-400 mb-2">Request Komponen ({job.component_requests.length})</p>
              {job.component_requests.map((cr, i) => <div key={i} className="text-xs text-foreground/60">{cr.component_name} — {cr.qty} {cr.unit} ({cr.status})</div>)}
            </div>
          )}
          {job.notes && <InfoRow label="Catatan" value={job.notes} />}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Tutup</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InfoRow({ label, value }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex gap-3">
      <span className="text-foreground/50 shrink-0 w-32">{label}:</span>
      <span className="text-foreground/80">{value}</span>
    </div>
  );
}
