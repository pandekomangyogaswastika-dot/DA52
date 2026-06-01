/**
 * CMTProgressModule — Tracking Progress Vendor CMT
 * 
 * Fitur:
 * - Input laporan progress harian (admin mode)
 * - Lihat ringkasan progress per job
 * - Laporan harian (filter by tanggal/vendor)
 * - Laporan bulanan per vendor
 * - CMT Delivery Order (DO) management
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  BarChart3, Plus, RefreshCw, Calendar, Truck, FileText,
  CheckCircle2, Clock, AlertCircle, ChevronRight, Package,
  Activity, Users, TrendingUp
} from 'lucide-react';
import { GlassCard } from '@/components/ui/glass';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { PageHeader } from './moduleAtoms';

const API = process.env.REACT_APP_BACKEND_URL;

const PROCESS_STEPS = [
  { value: 'cutting', label: 'Cutting', color: 'text-violet-300' },
  { value: 'sewing', label: 'Sewing', color: 'text-blue-300' },
  { value: 'finishing', label: 'Finishing', color: 'text-cyan-300' },
  { value: 'qc', label: 'QC', color: 'text-amber-300' },
  { value: 'packing', label: 'Packing', color: 'text-green-300' },
];

const DO_STATUS_CONFIG = {
  draft:               { label: 'Draft',         color: 'bg-slate-500/15 text-slate-300 border-slate-400/30' },
  issued:              { label: 'Diterbitkan',   color: 'bg-blue-500/15 text-blue-300 border-blue-400/30' },
  received_by_vendor:  { label: 'Diterima',      color: 'bg-green-500/15 text-green-300 border-green-400/30' },
  cancelled:           { label: 'Dibatalkan',    color: 'bg-red-500/15 text-red-300 border-red-400/30' },
};

function StatusBadge({ status, config = DO_STATUS_CONFIG }) {
  const c = config[status] || config.draft;
  return <span className={`inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full border ${c.color}`}>{c.label}</span>;
}

function fmtNum(v) { return Number(v || 0).toLocaleString('id-ID'); }

// ─── PROGRESS INPUT FORM ──────────────────────────────────────────────────────
function ProgressInputForm({ jobs, onSave, onClose }) {
  const token = window._authToken;
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }), [token]);

  const [form, setForm] = useState({
    cmt_job_id: '',
    report_date: new Date().toISOString().split('T')[0],
    process_step: 'sewing',
    qty_processed: 0,
    qty_passed: 0,
    qty_failed: 0,
    is_vendor_self_report: false,
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.cmt_job_id) return toast.error('Pilih CMT Job');
    if (form.qty_processed <= 0) return toast.error('Qty harus > 0');
    setSaving(true);
    try {
      const r = await fetch(`${API}/api/dewi/cmt/progress`, { method: 'POST', headers, body: JSON.stringify(form) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.detail || 'Gagal'); }
      toast.success('Laporan progress tersimpan');
      onSave();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <div className="bg-amber-500/10 border border-amber-400/20 rounded-lg px-3 py-2 text-xs text-amber-300">
        Mode Admin: Input progress untuk vendor yang tidak menggunakan sistem
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs">CMT Job *</Label>
          <Select value={form.cmt_job_id} onValueChange={v => setForm(f => ({ ...f, cmt_job_id: v }))}>
            <SelectTrigger className="bg-white/5 border-white/10 text-sm">
              <SelectValue placeholder="Pilih job..." />
            </SelectTrigger>
            <SelectContent>
              {jobs.map(j => (
                <SelectItem key={j.id} value={j.id}>
                  {j.job_code} — {j.cmt_name || j.partner_name || ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Tanggal Laporan</Label>
          <Input type="date" value={form.report_date} onChange={e => setForm(f => ({ ...f, report_date: e.target.value }))}
            className="bg-white/5 border-white/10 text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Proses *</Label>
          <Select value={form.process_step} onValueChange={v => setForm(f => ({ ...f, process_step: v }))}>
            <SelectTrigger className="bg-white/5 border-white/10 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PROCESS_STEPS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Qty Diproses *</Label>
          <Input type="number" value={form.qty_processed} onChange={e => setForm(f => ({ ...f, qty_processed: parseInt(e.target.value) || 0 }))}
            className="bg-white/5 border-white/10 text-sm" min={0} />
        </div>
        {form.process_step === 'qc' && (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs">Qty Lulus QC</Label>
              <Input type="number" value={form.qty_passed} onChange={e => setForm(f => ({ ...f, qty_passed: parseInt(e.target.value) || 0 }))}
                className="bg-white/5 border-white/10 text-sm" min={0} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Qty Gagal/Reject</Label>
              <Input type="number" value={form.qty_failed} onChange={e => setForm(f => ({ ...f, qty_failed: parseInt(e.target.value) || 0 }))}
                className="bg-white/5 border-white/10 text-sm" min={0} />
            </div>
          </>
        )}
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Catatan</Label>
        <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          rows={2} className="bg-white/5 border-white/10 text-sm resize-none" />
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} className="text-slate-400">Batal</Button>
        <Button onClick={handleSave} disabled={saving} className="bg-amber-600 hover:bg-amber-500">
          {saving ? 'Menyimpan...' : 'Simpan Laporan'}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ─── DO CREATE FORM ───────────────────────────────────────────────────────────
function DOCreateForm({ jobs, onSave, onClose }) {
  const token = window._authToken;
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }), [token]);

  const [form, setForm] = useState({
    cmt_job_id: '',
    source_type: 'internal',
    do_date: new Date().toISOString().split('T')[0],
    notes: '',
    items: [{ material_type: 'wip', description: '', qty: 0, unit: 'pcs' }]
  });
  const [saving, setSaving] = useState(false);

  const addItem = () => setForm(f => ({ ...f, items: [...f.items, { material_type: 'wip', description: '', qty: 0, unit: 'pcs' }] }));
  const upd = (idx, field, val) => setForm(f => ({ ...f, items: f.items.map((it, i) => i === idx ? { ...it, [field]: val } : it) }));

  const handleSave = async () => {
    if (!form.cmt_job_id) return toast.error('Pilih CMT Job');
    if (form.items.some(i => !i.description.trim())) return toast.error('Semua item harus ada keterangan');
    setSaving(true);
    try {
      const r = await fetch(`${API}/api/dewi/cmt/delivery-orders`, { method: 'POST', headers, body: JSON.stringify(form) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.detail || 'Gagal'); }
      const d = await r.json();
      toast.success(`DO ${d.do_number} berhasil dibuat`);
      onSave();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs">CMT Job *</Label>
          <Select value={form.cmt_job_id} onValueChange={v => setForm(f => ({ ...f, cmt_job_id: v }))}>
            <SelectTrigger className="bg-white/5 border-white/10 text-sm"><SelectValue placeholder="Pilih job..." /></SelectTrigger>
            <SelectContent>
              {jobs.map(j => <SelectItem key={j.id} value={j.id}>{j.job_code} — {j.cmt_name || ''}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Jenis Produksi</Label>
          <Select value={form.source_type} onValueChange={v => setForm(f => ({ ...f, source_type: v }))}>
            <SelectTrigger className="bg-white/5 border-white/10 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="internal">Produksi Internal</SelectItem>
              <SelectItem value="maklon">Maklon</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Tanggal DO</Label>
          <Input type="date" value={form.do_date} onChange={e => setForm(f => ({ ...f, do_date: e.target.value }))}
            className="bg-white/5 border-white/10 text-sm" />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Items DO *</Label>
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs border-white/10 hover:bg-white/10" onClick={addItem}>
            <Plus className="w-3 h-3 mr-1" /> Tambah Item
          </Button>
        </div>
        {form.items.map((it, idx) => (
          <div key={idx} className="grid grid-cols-4 gap-2 items-end">
            <div className="space-y-1">
              <Label className="text-xs">Tipe Material</Label>
              <Select value={it.material_type} onValueChange={v => upd(idx, 'material_type', v)}>
                <SelectTrigger className="h-7 text-xs bg-white/5 border-white/10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="wip">WIP (Cut Pieces)</SelectItem>
                  <SelectItem value="rm_maklon">Material Maklon</SelectItem>
                  <SelectItem value="fabric">Kain</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Input value={it.description} onChange={e => upd(idx, 'description', e.target.value)}
              className="h-7 text-xs bg-white/5 border-white/10" placeholder="Keterangan..." />
            <Input type="number" value={it.qty} onChange={e => upd(idx, 'qty', parseFloat(e.target.value) || 0)}
              className="h-7 text-xs bg-white/5 border-white/10" placeholder="Qty" min={0} />
            <Select value={it.unit} onValueChange={v => upd(idx, 'unit', v)}>
              <SelectTrigger className="h-7 text-xs bg-white/5 border-white/10"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['pcs', 'yard', 'kg', 'roll'].map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Catatan</Label>
        <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          rows={2} className="bg-white/5 border-white/10 text-sm resize-none" />
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose} className="text-slate-400">Batal</Button>
        <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-500">
          {saving ? 'Membuat...' : 'Buat DO'}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ─── MAIN MODULE ──────────────────────────────────────────────────────────────
export default function CMTProgressModule({ token }) {
  window._authToken = token;
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }), [token]);

  const [tab, setTab] = useState('daily');
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [reports, setReports] = useState([]);
  const [dos, setDos] = useState([]);
  const [dailySummary, setDailySummary] = useState(null);
  const [monthlyData, setMonthlyData] = useState([]);
  const [progressDialog, setProgressDialog] = useState(false);
  const [doDialog, setDoDialog] = useState(false);
  const [filterDate, setFilterDate] = useState(new Date().toISOString().split('T')[0]);
  const [filterMonth, setFilterMonth] = useState(new Date().getMonth() + 1);
  const [filterYear, setFilterYear] = useState(new Date().getFullYear());
  const [filterPartner, setFilterPartner] = useState('all');
  const [partners, setPartners] = useState([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [jobsR, reportR, dosR, partnersR] = await Promise.all([
        fetch(`${API}/api/dewi/cmt/jobs`, { headers }),
        fetch(`${API}/api/dewi/cmt/progress?limit=100`, { headers }),
        fetch(`${API}/api/dewi/cmt/delivery-orders?limit=100`, { headers }),
        fetch(`${API}/api/dewi/cmt/partners`, { headers }),
      ]);
      if (jobsR.ok) setJobs(await jobsR.json());
      if (reportR.ok) setReports(await reportR.json());
      if (dosR.ok) setDos(await dosR.json());
      if (partnersR.ok) setPartners(await partnersR.json());
    } catch (e) { toast.error('Gagal memuat data'); }
    finally { setLoading(false); }
  }, [headers]);

  const fetchDailySummary = useCallback(async () => {
    const params = new URLSearchParams({ report_date: filterDate });
    if (filterPartner && filterPartner !== 'all') params.append('cmt_partner_id', filterPartner);
    const r = await fetch(`${API}/api/dewi/cmt/progress/daily-summary?${params}`, { headers });
    if (r.ok) setDailySummary(await r.json());
  }, [filterDate, filterPartner, headers]);

  const fetchMonthly = useCallback(async () => {
    const params = new URLSearchParams({ year: filterYear, month: filterMonth });
    if (filterPartner && filterPartner !== 'all') params.append('cmt_partner_id', filterPartner);
    const r = await fetch(`${API}/api/dewi/cmt/progress/monthly-report?${params}`, { headers });
    if (r.ok) { const d = await r.json(); setMonthlyData(d.data || []); }
  }, [filterYear, filterMonth, filterPartner, headers]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { if (tab === 'daily') fetchDailySummary(); }, [tab, fetchDailySummary]);
  useEffect(() => { if (tab === 'monthly') fetchMonthly(); }, [tab, fetchMonthly]);

  const issueDO = async (doId) => {
    const r = await fetch(`${API}/api/dewi/cmt/delivery-orders/${doId}/issue`, { method: 'PUT', headers });
    if (r.ok) { toast.success('DO diterbitkan'); fetchData(); }
    else { const e = await r.json(); toast.error(e.detail || 'Gagal'); }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="CMT Progress & Delivery Order"
        subtitle="Tracking progress produksi vendor CMT — input harian, laporan, dan surat jalan"
        icon={Activity}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={fetchData} disabled={loading} className="text-slate-400">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDoDialog(true)} className="border-blue-400/30 text-blue-300 hover:bg-blue-500/10">
              <Truck className="w-4 h-4 mr-2" /> Buat DO
            </Button>
            <Button size="sm" onClick={() => setProgressDialog(true)} className="bg-amber-600 hover:bg-amber-500">
              <Plus className="w-4 h-4 mr-2" /> Input Progress
            </Button>
          </div>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-white/5">
          <TabsTrigger value="daily">Laporan Harian</TabsTrigger>
          <TabsTrigger value="monthly">Laporan Bulanan</TabsTrigger>
          <TabsTrigger value="reports">Semua Laporan</TabsTrigger>
          <TabsTrigger value="do">Delivery Order</TabsTrigger>
        </TabsList>

        {/* Daily Summary */}
        <TabsContent value="daily" className="mt-4 space-y-4">
          <GlassCard className="p-4">
            <div className="flex items-center gap-3 mb-4">
              <Input type="date" value={filterDate} onChange={e => { setFilterDate(e.target.value); }}
                className="w-44 bg-white/5 border-white/10 text-sm" />
              <Select value={filterPartner} onValueChange={setFilterPartner}>
                <SelectTrigger className="w-48 bg-white/5 border-white/10 text-sm">
                  <SelectValue placeholder="Semua Vendor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Vendor</SelectItem>
                  {partners.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={fetchDailySummary} className="bg-amber-600 hover:bg-amber-500">
                Lihat
              </Button>
            </div>

            {dailySummary ? (
              dailySummary.summary.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-sm">Tidak ada laporan untuk tanggal {filterDate}</div>
              ) : (
                <div className="space-y-3">
                  {dailySummary.summary.map((s, idx) => (
                    <motion.div key={idx} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                      className="bg-white/5 rounded-lg p-3 border border-white/8">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-semibold text-white">{s.cmt_name || 'Vendor'}</h4>
                        <span className="text-lg font-bold text-amber-300">{fmtNum(s.total_processed)} pcs</span>
                      </div>
                      <div className="grid grid-cols-5 gap-2">
                        {Object.entries(s.jobs || {}).map(([jobId, job]) => (
                          <div key={jobId} className="bg-white/3 rounded p-2 text-xs">
                            <div className="font-mono text-violet-300 mb-1">{job.job_code}</div>
                            {Object.entries(job.steps || {}).map(([step, qty]) => {
                              const ps = PROCESS_STEPS.find(p => p.value === step);
                              return (
                                <div key={step} className="flex justify-between">
                                  <span className={`${ps?.color || 'text-slate-400'}`}>{ps?.label || step}</span>
                                  <span className="font-semibold">{fmtNum(qty)}</span>
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  ))}
                </div>
              )
            ) : (
              <div className="text-center py-8 text-slate-500 text-sm">Klik "Lihat" untuk muat laporan</div>
            )}
          </GlassCard>
        </TabsContent>

        {/* Monthly Report */}
        <TabsContent value="monthly" className="mt-4 space-y-4">
          <GlassCard className="p-4">
            <div className="flex items-center gap-3 mb-4">
              <Select value={String(filterMonth)} onValueChange={v => setFilterMonth(parseInt(v))}>
                <SelectTrigger className="w-32 bg-white/5 border-white/10 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[...Array(12)].map((_, i) => (
                    <SelectItem key={i + 1} value={String(i + 1)}>
                      {new Date(2024, i).toLocaleString('id-ID', { month: 'long' })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input type="number" value={filterYear} onChange={e => setFilterYear(parseInt(e.target.value))}
                className="w-24 bg-white/5 border-white/10 text-sm" />
              <Button size="sm" onClick={fetchMonthly} className="bg-violet-600 hover:bg-violet-500">Lihat</Button>
            </div>

            {monthlyData.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-sm">Tidak ada data untuk periode ini</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-white/5">
                    <tr>
                      {['Vendor CMT', 'Total Diproses', 'Total Lulus', 'Total Reject', 'Pass Rate', 'Hari Aktif', 'Job Aktif'].map(h => (
                        <th key={h} className="py-3 px-3 text-left text-xs text-slate-400 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyData.map((d, i) => (
                      <motion.tr key={i} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: i * 0.05 } }}
                        className="border-b border-white/5 hover:bg-white/3">
                        <td className="py-3 px-3 font-semibold text-white">{d.cmt_name}</td>
                        <td className="py-3 px-3 font-bold text-amber-300">{fmtNum(d.total_processed)}</td>
                        <td className="py-3 px-3 text-green-300">{fmtNum(d.total_passed)}</td>
                        <td className="py-3 px-3 text-red-300">{fmtNum(d.total_failed)}</td>
                        <td className="py-3 px-3">
                          <span className={`font-semibold ${d.pass_rate_pct >= 95 ? 'text-green-300' : d.pass_rate_pct >= 85 ? 'text-amber-300' : 'text-red-300'}`}>
                            {d.pass_rate_pct}%
                          </span>
                        </td>
                        <td className="py-3 px-3 text-slate-300">{d.active_days} hari</td>
                        <td className="py-3 px-3 text-slate-300">{d.job_count}</td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </GlassCard>
        </TabsContent>

        {/* All Reports */}
        <TabsContent value="reports" className="mt-4">
          <GlassCard className="p-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-white/5">
                  <tr>
                    {['Tanggal', 'Job', 'Vendor', 'Proses', 'Diproses', 'Lulus', 'Reject', 'Mode'].map(h => (
                      <th key={h} className="py-2 px-3 text-left text-xs text-slate-400">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r, idx) => {
                    const ps = PROCESS_STEPS.find(p => p.value === r.process_step);
                    return (
                      <tr key={r.id} className="border-b border-white/5 hover:bg-white/3">
                        <td className="py-2 px-3 text-slate-300">{r.report_date}</td>
                        <td className="py-2 px-3 font-mono text-violet-300">{r.job_code}</td>
                        <td className="py-2 px-3">{r.cmt_name}</td>
                        <td className={`py-2 px-3 font-medium ${ps?.color || 'text-slate-300'}`}>{ps?.label || r.process_step}</td>
                        <td className="py-2 px-3 font-bold text-amber-300">{fmtNum(r.qty_processed)}</td>
                        <td className="py-2 px-3 text-green-300">{r.qty_passed > 0 ? fmtNum(r.qty_passed) : '—'}</td>
                        <td className="py-2 px-3 text-red-300">{r.qty_failed > 0 ? fmtNum(r.qty_failed) : '—'}</td>
                        <td className="py-2 px-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${r.is_vendor_self_report ? 'bg-blue-500/15 text-blue-300' : 'bg-amber-500/15 text-amber-300'}`}>
                            {r.is_vendor_self_report ? 'Vendor' : 'Admin'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {reports.length === 0 && (
                <div className="text-center py-8 text-slate-500 text-sm">Belum ada laporan progress</div>
              )}
            </div>
          </GlassCard>
        </TabsContent>

        {/* Delivery Orders */}
        <TabsContent value="do" className="mt-4">
          <GlassCard className="p-4 space-y-3">
            {dos.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                <Truck className="w-10 h-10 mx-auto opacity-30 mb-2" />
                <p className="text-sm">Belum ada Delivery Order</p>
              </div>
            ) : dos.map(d => (
              <motion.div key={d.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/8 hover:bg-white/8 transition-all">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-blue-500/20 flex items-center justify-center">
                    <Truck className="w-4 h-4 text-blue-300" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono font-bold">{d.do_number}</span>
                      <StatusBadge status={d.status} />
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      Job: {d.job_code} — {d.cmt_name} — {d.do_date}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-right text-xs text-slate-400">
                    {d.items?.length || 0} item
                  </div>
                  {d.status === 'draft' && (
                    <Button size="sm" onClick={() => issueDO(d.id)} className="h-7 text-xs bg-blue-600 hover:bg-blue-500">
                      <CheckCircle2 className="w-3 h-3 mr-1" /> Issue DO
                    </Button>
                  )}
                </div>
              </motion.div>
            ))}
          </GlassCard>
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <Dialog open={progressDialog} onOpenChange={setProgressDialog}>
        <DialogContent className="max-w-xl bg-[#0f1117] border-white/10">
          <DialogHeader><DialogTitle>Input Progress CMT (Admin Mode)</DialogTitle></DialogHeader>
          <ProgressInputForm jobs={jobs} onSave={() => { setProgressDialog(false); fetchData(); fetchDailySummary(); }}
            onClose={() => setProgressDialog(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={doDialog} onOpenChange={setDoDialog}>
        <DialogContent className="max-w-2xl bg-[#0f1117] border-white/10">
          <DialogHeader><DialogTitle>Buat Delivery Order ke Vendor CMT</DialogTitle></DialogHeader>
          <DOCreateForm jobs={jobs} onSave={() => { setDoDialog(false); fetchData(); }}
            onClose={() => setDoDialog(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
