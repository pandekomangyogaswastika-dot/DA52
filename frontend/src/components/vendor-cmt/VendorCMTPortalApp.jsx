/**
 * Vendor CMT Portal — Standalone Portal untuk Vendor CMT
 * Route: /vendor-cmt
 * 
 * Fitur:
 * - Login khusus vendor CMT (role: cmt_vendor)
 * - Dashboard: List jobs assigned ke vendor
 * - Submit progress harian per process step
 * - Lihat riwayat progress
 * - Lihat DO/surat jalan (read-only)
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Package, TrendingUp, Clock, CheckCircle2, AlertCircle, Calendar,
  FileText, Truck, LogOut, RefreshCw, Plus, BarChart3, User, History
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

const API = process.env.REACT_APP_BACKEND_URL;

const PROCESS_STEPS = [
  { value: 'sewing', label: 'Sewing', icon: '🧵', color: 'bg-blue-500/20 text-blue-300 border-blue-400/30' },
  { value: 'finishing', label: 'Finishing', icon: '✨', color: 'bg-cyan-500/20 text-cyan-300 border-cyan-400/30' },
  { value: 'qc', label: 'QC', icon: '✓', color: 'bg-amber-500/20 text-amber-300 border-amber-400/30' },
  { value: 'packing', label: 'Packing', icon: '📦', color: 'bg-green-500/20 text-green-300 border-green-400/30' },
];

const JOB_STATUS = {
  assigned: { label: 'Ditugaskan', color: 'bg-blue-500/15 text-blue-300' },
  in_sewing: { label: 'Dalam Jahit', color: 'bg-violet-500/15 text-violet-300' },
  completed: { label: 'Selesai', color: 'bg-green-500/15 text-green-300' },
  delivered: { label: 'Terkirim', color: 'bg-emerald-500/15 text-emerald-300' },
};

const DO_STATUS = {
  draft: { label: 'Draft', color: 'bg-slate-500/15 text-slate-300' },
  issued: { label: 'Dikirim', color: 'bg-blue-500/15 text-blue-300' },
  received: { label: 'Diterima', color: 'bg-green-500/15 text-green-300' },
  completed: { label: 'Selesai', color: 'bg-emerald-500/15 text-emerald-300' },
};

function fmtNum(v) { return Number(v || 0).toLocaleString('id-ID'); }
function fmtDate(d) { 
  if (!d) return '-';
  return new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── LOGIN PAGE ───────────────────────────────────────────────────────────────
function VendorLogin({ onLogin }) {
  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!form.email || !form.password) return toast.error('Email dan password wajib diisi');
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.detail || 'Login gagal');
      }
      const data = await r.json();
      if (data.user?.role !== 'cmt_vendor') {
        throw new Error('Akun ini bukan akun Vendor CMT. Silakan gunakan akun yang tepat.');
      }
      localStorage.setItem('vendor_cmt_token', data.token);
      localStorage.setItem('vendor_cmt_user', JSON.stringify(data.user));
      toast.success(`Selamat datang, ${data.user.name}!`);
      onLogin(data.token, data.user);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md">
        <GlassCard className="p-8 space-y-6">
          <div className="text-center space-y-2">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-violet-500 mx-auto flex items-center justify-center">
              <Package className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white">Portal Vendor CMT</h1>
            <p className="text-sm text-slate-400">CV. Dewi Aditya Official</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-300">Email Vendor</Label>
              <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="vendor@cmt.com" className="bg-white/5 border-white/10 text-white"
                disabled={loading} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-300">Password</Label>
              <Input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="••••••••" className="bg-white/5 border-white/10 text-white"
                disabled={loading} />
            </div>
            <Button type="submit" className="w-full bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500"
              disabled={loading}>
              {loading ? 'Memproses...' : 'Masuk ke Portal'}
            </Button>
          </form>

          <div className="pt-4 border-t border-white/10 text-center text-xs text-slate-500">
            Demo credentials: vendor1@cmt.com / Vendor@123
          </div>
        </GlassCard>
      </motion.div>
    </div>
  );
}

// ─── PROGRESS SUBMIT FORM ─────────────────────────────────────────────────────
function ProgressSubmitForm({ job, onSave, onClose, token }) {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }), [token]);
  const [form, setForm] = useState({
    cmt_job_id: job.id,
    report_date: new Date().toISOString().split('T')[0],
    process_step: 'sewing',
    qty_processed: 0,
    qty_passed: 0,
    qty_failed: 0,
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (form.qty_processed <= 0) return toast.error('Qty diproses harus > 0');
    setSaving(true);
    try {
      const r = await fetch(`${API}/api/dewi/cmt/vendor/progress`, { method: 'POST', headers, body: JSON.stringify(form) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.detail || 'Gagal'); }
      toast.success('Progress berhasil dilaporkan');
      onSave();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <div className="bg-blue-500/10 border border-blue-400/20 rounded-lg px-3 py-2 text-xs text-blue-300">
        <strong>Job:</strong> {job.job_code} — {job.product_name} ({fmtNum(job.qty)} pcs)
      </div>

      <div className="grid grid-cols-2 gap-4">
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
              {PROCESS_STEPS.map(s => (
                <SelectItem key={s.value} value={s.value}>{s.icon} {s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Qty Diproses *</Label>
          <Input type="number" value={form.qty_processed} onChange={e => setForm(f => ({ ...f, qty_processed: parseInt(e.target.value) || 0 }))}
            className="bg-white/5 border-white/10 text-sm" min={0} placeholder="0" />
        </div>
        {form.process_step === 'qc' && (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs">Qty Lulus QC</Label>
              <Input type="number" value={form.qty_passed} onChange={e => setForm(f => ({ ...f, qty_passed: parseInt(e.target.value) || 0 }))}
                className="bg-white/5 border-white/10 text-sm" min={0} />
            </div>
            <div className="space-y-1.5 col-span-2">
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
          rows={2} className="bg-white/5 border-white/10 text-sm resize-none" placeholder="Catatan tambahan..." />
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose} className="text-slate-400">Batal</Button>
        <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-500">
          {saving ? 'Menyimpan...' : 'Simpan Laporan'}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ─── JOB PROGRESS HISTORY CONTENT ─────────────────────────────────────────────
function JobProgressHistoryContent({ job, token, onClose }) {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }), [token]);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);

  useEffect(() => {
    const fetch_ = async () => {
      setLoading(true);
      try {
        const r = await fetch(`${API}/api/dewi/cmt/vendor/my-jobs/${job.id}/progress-history?limit=200`, { headers });
        if (r.ok) {
          setData(await r.json());
        } else {
          toast.error('Gagal memuat riwayat');
        }
      } catch (e) {
        toast.error('Network error');
      } finally {
        setLoading(false);
      }
    };
    fetch_();
  }, [job.id, headers]);

  const progressPct = useMemo(() => {
    if (!data?.summary || !data?.job?.qty) return 0;
    return Math.round((data.summary.total_processed / data.job.qty) * 100);
  }, [data]);

  if (loading) {
    return (
      <div className="text-center py-12 text-slate-400">
        <RefreshCw className="w-8 h-8 mx-auto animate-spin mb-3" />
        Memuat riwayat...
      </div>
    );
  }

  if (!data) {
    return <div className="text-center py-8 text-slate-500">Tidak ada data riwayat</div>;
  }

  return (
    <div className="space-y-4">
      {/* Job Header */}
      <div className="bg-blue-500/10 border border-blue-400/20 rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-xs text-slate-400">Job</div>
            <div className="text-base font-mono font-bold text-white">{data.job.job_code}</div>
          </div>
          <span className="text-[10px] px-2 py-1 rounded-full bg-violet-500/15 text-violet-300">
            {data.job.status}
          </span>
        </div>
        <div className="text-sm text-white">{data.job.product_name}</div>
        <div className="grid grid-cols-3 gap-2 mt-3 text-[11px]">
          <div>
            <div className="text-slate-400">Target Qty</div>
            <div className="text-white font-mono">{fmtNum(data.job.qty)} pcs</div>
          </div>
          <div>
            <div className="text-slate-400">Diproses</div>
            <div className="text-cyan-300 font-mono">{fmtNum(data.summary.total_processed)} pcs</div>
          </div>
          <div>
            <div className="text-slate-400">Deadline</div>
            <div className="text-white">{data.job.deadline_date || '-'}</div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mt-3">
          <div className="flex justify-between text-[10px] text-slate-400 mb-1">
            <span>Progress</span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-2 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500"
              style={{ width: `${Math.min(100, progressPct)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-4 gap-2">
        <GlassCard className="p-3" data-testid="hist-stat-reports">
          <div className="text-[10px] text-slate-400">Total Laporan</div>
          <div className="text-xl font-bold text-blue-300">{data.summary.total_reports}</div>
        </GlassCard>
        <GlassCard className="p-3">
          <div className="text-[10px] text-slate-400">Diproses</div>
          <div className="text-xl font-bold text-cyan-300">{fmtNum(data.summary.total_processed)}</div>
        </GlassCard>
        <GlassCard className="p-3">
          <div className="text-[10px] text-slate-400">Lolos QC</div>
          <div className="text-xl font-bold text-green-300">{fmtNum(data.summary.total_passed)}</div>
        </GlassCard>
        <GlassCard className="p-3">
          <div className="text-[10px] text-slate-400">Pass Rate</div>
          <div className="text-xl font-bold text-emerald-300">
            {data.summary.total_processed > 0 ? `${data.summary.pass_rate_pct}%` : '-'}
          </div>
        </GlassCard>
      </div>

      {/* By Step */}
      {data.by_step.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-300">Ringkasan per Process Step</div>
          <div className="grid grid-cols-2 gap-2">
            {data.by_step.map(s => {
              const stepInfo = PROCESS_STEPS.find(x => x.value === s.step);
              return (
                <div
                  key={s.step}
                  className={`rounded-lg p-3 border ${stepInfo?.color || 'bg-white/5 border-white/10'}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold">
                      {stepInfo?.icon} {stepInfo?.label || s.step}
                    </span>
                    <span className="text-[10px] opacity-75">{s.report_count} laporan</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[11px]">
                    <div>
                      <div className="opacity-60">Total</div>
                      <div className="font-mono font-bold">{fmtNum(s.total_processed)}</div>
                    </div>
                    <div>
                      <div className="opacity-60">Lolos</div>
                      <div className="font-mono">{fmtNum(s.total_passed)}</div>
                    </div>
                    <div>
                      <div className="opacity-60">Gagal</div>
                      <div className="font-mono">{fmtNum(s.total_failed)}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Reports List */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-slate-300">
          Riwayat Laporan ({data.reports.length})
        </div>
        {data.reports.length === 0 ? (
          <div className="text-center py-6 text-slate-500 text-sm">Belum ada laporan progress</div>
        ) : (
          <div className="max-h-72 overflow-y-auto bg-white/3 border border-white/10 rounded-lg" data-testid="progress-reports-list">
            <table className="w-full text-xs">
              <thead className="bg-white/5 sticky top-0">
                <tr className="border-b border-white/10">
                  <th className="text-left py-2 px-3 font-semibold text-slate-400">Tanggal</th>
                  <th className="text-left py-2 px-3 font-semibold text-slate-400">Step</th>
                  <th className="text-right py-2 px-3 font-semibold text-slate-400">Diproses</th>
                  <th className="text-right py-2 px-3 font-semibold text-slate-400">Lolos</th>
                  <th className="text-right py-2 px-3 font-semibold text-slate-400">Gagal</th>
                  <th className="text-left py-2 px-3 font-semibold text-slate-400">Self-Report</th>
                </tr>
              </thead>
              <tbody>
                {data.reports.map(r => {
                  const stepInfo = PROCESS_STEPS.find(s => s.value === r.process_step);
                  return (
                    <tr key={r.id} className="border-b border-white/5 last:border-0">
                      <td className="py-2 px-3 text-white">{fmtDate(r.report_date)}</td>
                      <td className="py-2 px-3">
                        <span className={`text-[10px] px-2 py-0.5 rounded-md ${stepInfo?.color || 'bg-white/10 text-slate-300'}`}>
                          {stepInfo?.icon} {stepInfo?.label || r.process_step}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-cyan-300">{fmtNum(r.qty_processed)}</td>
                      <td className="py-2 px-3 text-right font-mono text-green-300">{fmtNum(r.qty_passed)}</td>
                      <td className="py-2 px-3 text-right font-mono text-red-300">{fmtNum(r.qty_failed)}</td>
                      <td className="py-2 px-3">
                        {r.is_vendor_self_report ? (
                          <span className="text-[10px] text-emerald-300">✓ Vendor</span>
                        ) : (
                          <span className="text-[10px] text-slate-500">Admin</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="ghost" data-testid="history-close-btn" onClick={onClose} className="text-slate-400">
          Tutup
        </Button>
      </DialogFooter>
    </div>
  );
}

// ─── DO DETAIL DIALOG CONTENT ─────────────────────────────────────────────────
function DODetailContent({ do_, token, onClose, onConfirm }) {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }), [token]);
  const [detail, setDetail] = useState(do_);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');

  useEffect(() => {
    const fetchDetail = async () => {
      setLoading(true);
      try {
        const r = await fetch(`${API}/api/dewi/cmt/delivery-orders/vendor/my-dos/${do_.id}`, { headers });
        if (r.ok) {
          const data = await r.json();
          setDetail(data);
        }
      } catch (e) { /* fallback to passed do_ */ }
      finally { setLoading(false); }
    };
    fetchDetail();
  }, [do_.id, headers]);

  const handleConfirmReceipt = async () => {
    setConfirming(true);
    try {
      const r = await fetch(`${API}/api/dewi/cmt/delivery-orders/vendor/my-dos/${do_.id}/confirm-receipt`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ received_date: receivedDate, notes }),
      });
      if (r.ok) {
        toast.success('Penerimaan DO berhasil dikonfirmasi');
        if (onConfirm) onConfirm();
        onClose();
      } else {
        const err = await r.json().catch(() => ({}));
        toast.error(err.detail || 'Gagal mengonfirmasi penerimaan');
      }
    } catch (e) {
      toast.error('Network error saat konfirmasi');
    } finally {
      setConfirming(false);
    }
  };

  const items = detail?.items || [];
  const statusInfo = DO_STATUS[detail?.status] || { label: detail?.status, color: 'bg-slate-500/15 text-slate-300' };
  const canConfirm = detail?.status === 'issued';

  return (
    <div className="space-y-4">
      {loading && <div className="text-xs text-slate-400">Memuat detail...</div>}

      {/* Header DO */}
      <div className="bg-blue-500/10 border border-blue-400/20 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-xs text-slate-400">No. Surat Jalan</div>
            <div className="text-lg font-mono font-bold text-white">{detail?.do_number}</div>
          </div>
          <span className={`text-xs px-3 py-1 rounded-full ${statusInfo.color}`}>
            {statusInfo.label}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
          <div>
            <span className="text-slate-400">Tanggal DO:</span>{' '}
            <span className="text-white">{fmtDate(detail?.do_date || detail?.created_at)}</span>
          </div>
          <div>
            <span className="text-slate-400">Tipe:</span>{' '}
            <span className="text-white">{detail?.type || 'OUT'}</span>
          </div>
          <div>
            <span className="text-slate-400">Job Code:</span>{' '}
            <span className="text-white font-mono">{detail?.cmt_job_code || detail?.cmt_job_id || '-'}</span>
          </div>
          <div>
            <span className="text-slate-400">Total Qty:</span>{' '}
            <span className="text-cyan-300 font-mono">{fmtNum(detail?.total_qty)}</span>
          </div>
          {detail?.issued_at && (
            <div>
              <span className="text-slate-400">Dikirim:</span>{' '}
              <span className="text-white">{fmtDate(detail?.issued_at)}</span>
            </div>
          )}
          {detail?.received_at && (
            <div>
              <span className="text-slate-400">Diterima:</span>{' '}
              <span className="text-white">{fmtDate(detail?.received_at)}</span>
            </div>
          )}
        </div>
        {detail?.notes && (
          <div className="mt-3 pt-3 border-t border-blue-400/20 text-xs text-slate-300 italic">
            📝 {detail.notes}
          </div>
        )}
      </div>

      {/* Items Table */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-slate-300">Rincian Item ({items.length})</div>
        <div className="bg-white/3 border border-white/10 rounded-lg overflow-hidden">
          <table className="w-full text-xs" data-testid="do-detail-items">
            <thead>
              <tr className="bg-white/5 border-b border-white/10">
                <th className="text-left py-2 px-3 font-semibold text-slate-400">SKU / Material</th>
                <th className="text-left py-2 px-3 font-semibold text-slate-400">Nama</th>
                <th className="text-right py-2 px-3 font-semibold text-slate-400">Qty</th>
                <th className="text-left py-2 px-3 font-semibold text-slate-400">Unit</th>
                <th className="text-left py-2 px-3 font-semibold text-slate-400">Keterangan</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-6 text-slate-500">
                    Tidak ada rincian item
                  </td>
                </tr>
              ) : items.map((it, idx) => (
                <tr key={idx} className="border-b border-white/5 last:border-0">
                  <td className="py-2 px-3 font-mono text-white">{it.sku_code || it.material_id || '-'}</td>
                  <td className="py-2 px-3 text-slate-200">{it.material_name || it.name || '-'}</td>
                  <td className="py-2 px-3 text-right font-mono text-cyan-300">{fmtNum(it.qty || it.quantity)}</td>
                  <td className="py-2 px-3 text-slate-400">{it.unit || 'pcs'}</td>
                  <td className="py-2 px-3 text-slate-400">{it.notes || it.size_color || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confirm Receipt (jika status = issued) */}
      {canConfirm && (
        <div className="bg-amber-500/10 border border-amber-400/20 rounded-lg p-4 space-y-3">
          <div className="text-sm font-semibold text-amber-300">📥 Konfirmasi Penerimaan</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-slate-300">Tanggal Diterima</Label>
              <Input
                type="date"
                data-testid="do-received-date"
                value={receivedDate}
                onChange={e => setReceivedDate(e.target.value)}
                className="bg-white/5 border-white/10 text-sm"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-300">Catatan (Opsional)</Label>
            <Textarea
              data-testid="do-receive-notes"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Catatan kondisi barang yang diterima..."
              className="bg-white/5 border-white/10 text-sm resize-none"
            />
          </div>
          <div className="flex justify-end">
            <Button
              data-testid="do-confirm-receipt-btn"
              onClick={handleConfirmReceipt}
              disabled={confirming}
              className="bg-gradient-to-r from-amber-500 to-orange-500 text-white"
            >
              <CheckCircle2 className="w-4 h-4 mr-2" />
              {confirming ? 'Memproses...' : 'Konfirmasi Diterima'}
            </Button>
          </div>
        </div>
      )}

      <DialogFooter>
        <Button variant="ghost" data-testid="do-detail-close-btn" onClick={onClose} className="text-slate-400">
          Tutup
        </Button>
      </DialogFooter>
    </div>
  );
}

// ─── MAIN PORTAL ──────────────────────────────────────────────────────────────
function VendorPortalMain({ user, token, onLogout }) {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }), [token]);
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [dos, setDos] = useState([]);
  const [tab, setTab] = useState('active');
  const [activeView, setActiveView] = useState('jobs'); // 'jobs' or 'dos'
  const [progressDialog, setProgressDialog] = useState(null);
  const [doDetailDialog, setDoDetailDialog] = useState(null);
  const [historyDialog, setHistoryDialog] = useState(null);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/dewi/cmt/vendor/my-jobs`, { headers });
      if (r.ok) setJobs(await r.json());
    } catch (e) { toast.error('Gagal memuat data jobs'); }
    finally { setLoading(false); }
  }, [headers]);

  const fetchDOs = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/dewi/cmt/delivery-orders/vendor/my-dos`, { headers });
      if (r.ok) {
        const data = await r.json();
        setDos(data.delivery_orders || []);
      }
    } catch (e) { toast.error('Gagal memuat data DO'); }
    finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { 
    if (activeView === 'jobs') {
      fetchJobs(); 
    } else {
      fetchDOs();
    }
  }, [activeView, fetchJobs, fetchDOs]);

  const filtered = useMemo(() => {
    if (tab === 'active') return jobs.filter(j => ['assigned', 'in_sewing'].includes(j.status));
    if (tab === 'completed') return jobs.filter(j => j.status === 'completed');
    return jobs;
  }, [jobs, tab]);

  const stats = useMemo(() => {
    if (activeView === 'jobs') {
      const active = jobs.filter(j => ['assigned', 'in_sewing'].includes(j.status));
      const totalQty = active.reduce((s, j) => s + j.qty, 0);
      const processed = active.reduce((s, j) => s + (j.qty_processed || 0), 0);
      const overdue = jobs.filter(j => j.is_overdue).length;
      return { totalJobs: jobs.length, activeJobs: active.length, totalQty, processed, overdue };
    } else {
      const issued = dos.filter(d => d.status === 'issued').length;
      const received = dos.filter(d => d.status === 'received').length;
      const totalItems = dos.reduce((s, d) => s + (d.total_qty || 0), 0);
      return { totalDOs: dos.length, issued, received, totalItems };
    }
  }, [jobs, dos, activeView]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <div className="border-b border-white/10 bg-black/20 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center">
              <Package className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">Portal Vendor CMT</h1>
              <p className="text-xs text-slate-400">{user.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => activeView === 'jobs' ? fetchJobs() : fetchDOs()} disabled={loading} className="text-slate-400">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button variant="ghost" size="sm" onClick={onLogout} className="text-red-400 hover:text-red-300">
              <LogOut className="w-4 h-4 mr-2" /> Keluar
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* View Tabs */}
        <div className="flex gap-2 border-b border-white/10 pb-2">
          <Button 
            variant={activeView === 'jobs' ? 'default' : 'ghost'}
            onClick={() => setActiveView('jobs')}
            className={activeView === 'jobs' ? 'bg-blue-600' : 'text-slate-400'}
          >
            <Package className="w-4 h-4 mr-2" />
            Jobs & Progress
          </Button>
          <Button 
            variant={activeView === 'dos' ? 'default' : 'ghost'}
            onClick={() => setActiveView('dos')}
            className={activeView === 'dos' ? 'bg-violet-600' : 'text-slate-400'}
          >
            <FileText className="w-4 h-4 mr-2" />
            Surat Jalan (DO)
          </Button>
        </div>

        {/* Stats */}
        {activeView === 'jobs' ? (
          <div className="grid grid-cols-5 gap-4">
            {[
              { label: 'Total Jobs', value: stats.totalJobs, icon: Package, color: 'text-blue-300' },
              { label: 'Jobs Aktif', value: stats.activeJobs, icon: TrendingUp, color: 'text-violet-300' },
              { label: 'Total Qty', value: fmtNum(stats.totalQty), icon: BarChart3, color: 'text-cyan-300' },
              { label: 'Diproses', value: fmtNum(stats.processed), icon: CheckCircle2, color: 'text-green-300' },
              { label: 'Overdue', value: stats.overdue, icon: AlertCircle, color: stats.overdue > 0 ? 'text-red-300' : 'text-slate-500' },
            ].map(s => (
              <GlassCard key={s.label} className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <s.icon className={`w-5 h-5 ${s.color}`} />
                </div>
                <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-xs text-slate-400 mt-0.5">{s.label}</div>
              </GlassCard>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: 'Total DO', value: stats.totalDOs, icon: FileText, color: 'text-blue-300' },
              { label: 'Dikirim', value: stats.issued, icon: Truck, color: 'text-violet-300' },
              { label: 'Diterima', value: stats.received, icon: CheckCircle2, color: 'text-green-300' },
              { label: 'Total Items', value: fmtNum(stats.totalItems), icon: Package, color: 'text-cyan-300' },
            ].map(s => (
              <GlassCard key={s.label} className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <s.icon className={`w-5 h-5 ${s.color}`} />
                </div>
                <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-xs text-slate-400 mt-0.5">{s.label}</div>
              </GlassCard>
            ))}
          </div>
        )}

        {/* Jobs List atau DO List */}
        <GlassCard className="p-6 space-y-4">
          {activeView === 'jobs' ? (
            <>
              <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="bg-white/5">
                  <TabsTrigger value="active">Aktif</TabsTrigger>
                  <TabsTrigger value="completed">Selesai</TabsTrigger>
                  <TabsTrigger value="all">Semua</TabsTrigger>
                </TabsList>
              </Tabs>

              {loading ? (
                <div className="text-center py-12 text-slate-400">Memuat jobs...</div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <Package className="w-12 h-12 mx-auto opacity-20 mb-3" />
                  <p>Tidak ada jobs untuk tab ini</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filtered.map(job => {
                    const progressPct = job.qty > 0 ? Math.round((job.qty_processed / job.qty) * 100) : 0;
                    const isOverdue = job.is_overdue;
                    return (
                      <motion.div key={job.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                        className="bg-white/3 border border-white/8 rounded-lg p-4 hover:bg-white/5 transition-all">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-mono font-bold text-white">{job.job_code}</span>
                              {JOB_STATUS[job.status] && (
                                <span className={`text-[10px] px-2 py-0.5 rounded-full ${JOB_STATUS[job.status].color}`}>
                                  {JOB_STATUS[job.status].label}
                                </span>
                              )}
                              {isOverdue && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/15 text-red-300">
                                  ⚠ Overdue
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-white font-medium">{job.product_name}</p>
                            <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
                              <span>📦 {fmtNum(job.qty)} pcs</span>
                              <span>✓ {fmtNum(job.qty_processed)} diproses</span>
                              <span className={isOverdue ? 'text-red-400' : ''}>📅 {job.deadline_date}</span>
                            </div>
                          </div>
                          <Button size="sm" data-testid={`report-progress-${job.job_code}`} onClick={() => setProgressDialog(job)}
                            className="bg-blue-600 hover:bg-blue-500">
                            <Plus className="w-3 h-3 mr-1.5" /> Lapor Progress
                          </Button>
                        </div>

                        {/* Progress bar */}
                        <div className="space-y-2">
                          <div className="flex justify-between text-xs text-slate-400">
                            <span>Progress</span>
                            <span>{progressPct}%</span>
                          </div>
                          <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                            <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500"
                              style={{ width: `${progressPct}%` }} />
                          </div>
                        </div>

                        {/* Progress by step */}
                        {Object.keys(job.progress_by_step || {}).length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-3">
                            {Object.entries(job.progress_by_step).map(([step, data]) => {
                              const stepInfo = PROCESS_STEPS.find(s => s.value === step);
                              return (
                                <div key={step} className={`text-xs px-2 py-1 rounded-md border ${stepInfo?.color || 'bg-white/5 text-slate-300'}`}>
                                  {stepInfo?.icon} {stepInfo?.label || step}: {fmtNum(data.total_processed)}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Action: View History */}
                        <div className="mt-3 flex justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid={`view-history-${job.job_code}`}
                            onClick={() => setHistoryDialog(job)}
                            className="border-white/10 text-slate-300 hover:bg-white/5 h-7 text-xs"
                          >
                            <History className="w-3 h-3 mr-1.5" /> Lihat Riwayat Lengkap
                          </Button>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <>
              {/* DO LIST */}
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Daftar Surat Jalan (Delivery Orders)</h3>
                <span className="text-xs text-slate-400">{dos.length} DO</span>
              </div>

              {loading ? (
                <div className="text-center py-12 text-slate-400">Memuat surat jalan...</div>
              ) : dos.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <FileText className="w-12 h-12 mx-auto opacity-20 mb-3" />
                  <p>Belum ada surat jalan masuk untuk vendor Anda</p>
                </div>
              ) : (
                <div className="space-y-3" data-testid="do-list">
                  {dos.map(d => {
                    const statusInfo = DO_STATUS[d.status] || { label: d.status, color: 'bg-slate-500/15 text-slate-300' };
                    return (
                      <motion.div
                        key={d.id}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-white/3 border border-white/8 rounded-lg p-4 hover:bg-white/5 transition-all"
                        data-testid={`do-card-${d.do_number}`}
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="text-sm font-mono font-bold text-white">{d.do_number}</span>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full ${statusInfo.color}`}>
                                {statusInfo.label}
                              </span>
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-300">
                                {d.type || 'OUT'}
                              </span>
                            </div>
                            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-400">
                              <div>📅 Tanggal: <span className="text-slate-300">{fmtDate(d.do_date || d.created_at)}</span></div>
                              <div>📦 Item: <span className="text-slate-300">{(d.items || []).length} jenis</span></div>
                              <div>🔢 Total Qty: <span className="text-cyan-300 font-mono">{fmtNum(d.total_qty)}</span></div>
                              <div>🏷 Job: <span className="text-slate-300">{d.cmt_job_code || d.cmt_job_id || '-'}</span></div>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid={`view-do-${d.do_number}`}
                            onClick={() => setDoDetailDialog(d)}
                            className="border-white/10 hover:bg-white/5"
                          >
                            <FileText className="w-3 h-3 mr-1.5" /> Detail
                          </Button>
                        </div>
                        {d.notes && (
                          <div className="text-xs text-slate-500 italic mt-2">📝 {d.notes}</div>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </GlassCard>
      </div>

      {/* Progress Dialog */}
      <Dialog open={!!progressDialog} onOpenChange={() => setProgressDialog(null)}>
        <DialogContent className="max-w-xl bg-[#0f1117] border-white/10">
          <DialogHeader>
            <DialogTitle>Lapor Progress — {progressDialog?.job_code}</DialogTitle>
          </DialogHeader>
          {progressDialog && (
            <ProgressSubmitForm job={progressDialog} token={token}
              onSave={() => { setProgressDialog(null); fetchJobs(); }}
              onClose={() => setProgressDialog(null)} />
          )}
        </DialogContent>
      </Dialog>

      {/* DO Detail Dialog */}
      <Dialog open={!!doDetailDialog} onOpenChange={() => setDoDetailDialog(null)}>
        <DialogContent className="max-w-2xl bg-[#0f1117] border-white/10 max-h-[90vh] overflow-y-auto" data-testid="do-detail-dialog">
          <DialogHeader>
            <DialogTitle>Detail Surat Jalan — {doDetailDialog?.do_number}</DialogTitle>
          </DialogHeader>
          {doDetailDialog && (
            <DODetailContent
              do_={doDetailDialog}
              token={token}
              onClose={() => setDoDetailDialog(null)}
              onConfirm={() => { setDoDetailDialog(null); fetchDOs(); }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Progress History Dialog */}
      <Dialog open={!!historyDialog} onOpenChange={() => setHistoryDialog(null)}>
        <DialogContent className="max-w-3xl bg-[#0f1117] border-white/10 max-h-[90vh] overflow-y-auto" data-testid="progress-history-dialog">
          <DialogHeader>
            <DialogTitle>Riwayat Progress — {historyDialog?.job_code}</DialogTitle>
          </DialogHeader>
          {historyDialog && (
            <JobProgressHistoryContent
              job={historyDialog}
              token={token}
              onClose={() => setHistoryDialog(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function VendorCMTPortalApp() {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);

  useEffect(() => {
    const storedToken = localStorage.getItem('vendor_cmt_token');
    const storedUser = localStorage.getItem('vendor_cmt_user');
    if (storedToken && storedUser) {
      try {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
      } catch (e) {
        localStorage.removeItem('vendor_cmt_token');
        localStorage.removeItem('vendor_cmt_user');
      }
    }
  }, []);

  const handleLogin = (tk, usr) => {
    setToken(tk);
    setUser(usr);
  };

  const handleLogout = () => {
    localStorage.removeItem('vendor_cmt_token');
    localStorage.removeItem('vendor_cmt_user');
    setToken(null);
    setUser(null);
    toast.success('Anda telah keluar');
  };

  if (!token || !user) {
    return <VendorLogin onLogin={handleLogin} />;
  }

  return <VendorPortalMain user={user} token={token} onLogout={handleLogout} />;
}
