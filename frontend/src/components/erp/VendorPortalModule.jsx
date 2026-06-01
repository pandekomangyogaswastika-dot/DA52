/**
 * VendorPortalModule — Workspace untuk CMT Vendor
 * Diakses oleh user dengan role='cmt_vendor'
 * Menampilkan: Daftar Jobs | Detail Job + Progress Form + History
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Briefcase, ChevronRight, CheckCircle2, AlertCircle,
  Clock, Loader2, RefreshCw, ArrowLeft, TrendingUp,
  FileText, Send, Trash2, Package, Calendar
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from './EmptyState';

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtTs(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('id-ID', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
}
function todayIso() { return new Date().toISOString().slice(0,10); }

const STATUS_LABEL = { open: 'Belum Mulai', in_progress: 'Sedang Berjalan', done: 'Selesai', cancelled: 'Dibatalkan' };
const STATUS_COLOR = {
  open:        'bg-slate-500/15 text-slate-300 border-slate-400/20',
  in_progress: 'bg-blue-500/15 text-blue-300 border-blue-400/20',
  done:        'bg-green-500/15 text-green-300 border-green-400/20',
  cancelled:   'bg-red-500/15 text-red-300 border-red-400/20',
};

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${STATUS_COLOR[status] || STATUS_COLOR.open}`}>
      {STATUS_LABEL[status] || status}
    </span>
  );
}

function ProgressBar({ done, target }) {
  const pct = target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-muted-foreground">Progress</span>
        <span className="font-semibold text-foreground">{done} / {target} pcs ({pct}%)</span>
      </div>
      <div className="h-2 rounded-full bg-white/10 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            pct >= 100 ? 'bg-green-500' : pct >= 60 ? 'bg-blue-500' : 'bg-amber-500'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Job Card ─────────────────────────────────────────────────────────────────

function JobCard({ job, onClick }) {
  const done   = job.reported_qty_done || 0;
  const target = job.qty_target || 0;
  const pct    = target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0;
  return (
    <div
      onClick={onClick}
      data-testid={`job-card-${job.id}`}
      className="rounded-xl border border-white/10 bg-white/5 p-4 hover:bg-white/8 cursor-pointer transition-all group"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-xs text-primary">{job.job_number}</span>
            <StatusBadge status={job.status} />
          </div>
          <h3 className="font-semibold text-sm text-foreground truncate">{job.title}</h3>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Package className="w-3 h-3" /> {job.process}</span>
            {job.due_date && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {fmtDate(job.due_date)}</span>}
            {job.wo_number && <span className="text-primary/70">{job.wo_number}</span>}
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0 mt-1" />
      </div>
      <ProgressBar done={done} target={target} />
      {pct >= 100 && (
        <div className="flex items-center gap-1.5 mt-2 text-xs text-green-400">
          <CheckCircle2 className="w-3.5 h-3.5" /> Target tercapai!
        </div>
      )}
    </div>
  );
}

// ── Progress Form ─────────────────────────────────────────────────────────────

function ProgressForm({ job, token, onSuccess }) {
  const [qty,    setQty]    = useState('');
  const [reject, setReject] = useState('');
  const [date,   setDate]   = useState(todayIso());
  const [notes,  setNotes]  = useState('');
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  async function submit(e) {
    e.preventDefault();
    setErr('');
    const q = parseInt(qty, 10);
    const r = parseInt(reject, 10) || 0;
    if (!(q > 0))      { setErr('Jumlah selesai harus lebih dari 0.'); return; }
    if (r > q)         { setErr('Jumlah reject tidak boleh melebihi jumlah selesai.'); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/vendor-portal/my-jobs/${job.id}/progress`, {
        method: 'POST', headers,
        body: JSON.stringify({ qty_done: q, qty_reject: r, report_date: date, notes }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Gagal menyimpan.'); }
      const data = await res.json();
      setQty(''); setReject(''); setNotes('');
      onSuccess(data);
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  const isDone = job.status === 'done';

  return (
    <form onSubmit={submit} className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-4" data-testid="progress-form">
      <h3 className="font-semibold text-sm text-foreground flex items-center gap-2">
        <Send className="w-4 h-4 text-primary" /> Laporan Progress
      </h3>

      {isDone ? (
        <div className="flex items-center gap-2 text-sm text-green-400 bg-green-500/10 border border-green-400/20 rounded-lg px-3 py-2">
          <CheckCircle2 className="w-4 h-4" /> Pekerjaan ini sudah selesai (target tercapai).
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase">Tanggal</label>
              <input type="date" value={date} onChange={e=>setDate(e.target.value)} max={todayIso()}
                data-testid="prog-date"
                className="w-full px-3 py-2 rounded-lg bg-white/8 border border-white/15 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-green-400 uppercase">Selesai (pcs)</label>
              <input type="number" min={1} value={qty} onChange={e=>setQty(e.target.value)}
                placeholder="cth: 80" data-testid="prog-qty" inputMode="numeric"
                className="w-full px-3 py-2 rounded-lg bg-white/8 border border-white/15 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-red-400 uppercase">Reject / Cacat (pcs)</label>
              <input type="number" min={0} value={reject} onChange={e=>setReject(e.target.value)}
                placeholder="0" data-testid="prog-reject" inputMode="numeric"
                className="w-full px-3 py-2 rounded-lg bg-red-500/10 border border-red-400/25 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-red-500/40" />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase">Catatan</label>
              <input type="text" value={notes} onChange={e=>setNotes(e.target.value)}
                placeholder="opsional" data-testid="prog-notes"
                className="w-full px-3 py-2 rounded-lg bg-white/8 border border-white/15 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
          </div>
          {err && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-400/20 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4 shrink-0" /> {err}
            </div>
          )}
          <Button type="submit" disabled={saving} className="w-full" data-testid="btn-submit-progress">
            {saving ? <><Loader2 className="w-4 h-4 animate-spin mr-2"/>Menyimpan...</> : <><Send className="w-4 h-4 mr-2"/>Kirim Laporan</>}
          </Button>
        </>
      )}
    </form>
  );
}

// ── Progress History ──────────────────────────────────────────────────────────

function ProgressHistory({ reports, jobId, token, onDelete }) {
  const [deleting, setDeleting] = useState(null);
  const headers = { Authorization: `Bearer ${token}` };
  const today   = todayIso();

  async function handleDelete(reportId) {
    if (!window.confirm('Hapus laporan ini?')) return;
    setDeleting(reportId);
    try {
      const r = await fetch(`/api/vendor-portal/my-jobs/${jobId}/progress/${reportId}`, { method: 'DELETE', headers });
      if (!r.ok) throw new Error('Gagal.');
      onDelete(reportId);
    } catch {}
    finally { setDeleting(null); }
  }

  if (!reports.length) return (
    <EmptyState
      icon={FileText}
      title="Belum ada laporan progress"
      description="Laporan progress pekerjaan akan muncul di sini setelah dikirimkan."
    />
  );

  return (
    <div className="space-y-2" data-testid="progress-history">
      {reports.map(r => (
        <div key={r.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/5 border border-white/8 text-sm">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">{r.qty_done} pcs selesai</span>
              {r.qty_reject > 0 && <span className="text-red-400 text-xs">({r.qty_reject} reject)</span>}
              <span className="text-xs text-primary/70">{r.process_step}</span>
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
              <span>{fmtDate(r.report_date)}</span>
              <span>Dikirim: {fmtTs(r.submitted_at)}</span>
              {r.notes && <span className="truncate max-w-[160px] italic">{r.notes}</span>}
            </div>
          </div>
          {r.report_date === today && (
            <button
              onClick={() => handleDelete(r.id)}
              disabled={deleting === r.id}
              className="p-1.5 rounded text-red-400/50 hover:text-red-400 hover:bg-red-500/10 transition-all"
              data-testid={`btn-del-report-${r.id}`}
            >
              {deleting === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Job Detail View ───────────────────────────────────────────────────────────

function JobDetail({ job: initialJob, token, onBack }) {
  const [job,     setJob]     = useState(initialJob);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [detailRes, histRes] = await Promise.all([
        fetch(`/api/vendor-portal/my-jobs/${initialJob.id}`, { headers }),
        fetch(`/api/vendor-portal/my-jobs/${initialJob.id}/progress-history`, { headers }),
      ]);
      if (detailRes.ok) setJob(await detailRes.json());
      if (histRes.ok)   setReports(await histRes.json());
    } finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJob.id, token]);

  useEffect(() => { load(); }, [load]);

  function handleProgressSuccess() { load(); }
  function handleDelete(id) { setReports(prev => prev.filter(r => r.id !== id)); load(); }

  return (
    <div className="space-y-4" data-testid="job-detail-view">
      {/* Back */}
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" /> Kembali ke Daftar Pekerjaan
      </button>

      {/* Header */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <span className="font-mono text-xs text-primary">{job.job_number}</span>
            <h2 className="font-bold text-lg text-foreground mt-0.5">{job.title}</h2>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
              <span><Package className="inline w-3 h-3 mr-1" />{job.process}</span>
              {job.wo_number && <span className="text-primary/70">{job.wo_number}</span>}
              {job.due_date  && <span><Calendar className="inline w-3 h-3 mr-1" />Tenggat: {fmtDate(job.due_date)}</span>}
            </div>
          </div>
          <StatusBadge status={job.status} />
        </div>
        {loading
          ? <div className="h-2 rounded-full bg-white/10 animate-pulse" />
          : <ProgressBar done={job.reported_qty_done || 0} target={job.qty_target || 0} />
        }
        {job.notes && <p className="text-xs text-muted-foreground italic">{job.notes}</p>}
      </div>

      {/* Progress Form */}
      <ProgressForm job={job} token={token} onSuccess={handleProgressSuccess} />

      {/* History */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <FileText className="w-4 h-4 text-muted-foreground" /> Riwayat Laporan ({reports.length})
          </h3>
          <button onClick={load} className="p-1.5 rounded hover:bg-white/10 text-muted-foreground" data-testid="btn-refresh-history">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <ProgressHistory reports={reports} jobId={job.id} token={token} onDelete={handleDelete} />
      </div>
    </div>
  );
}

// ── Main Module ───────────────────────────────────────────────────────────────

export default function VendorPortalModule({ token }) {
  const [profile,    setProfile]    = useState(null);
  const [jobs,       setJobs]       = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [activeJob,  setActiveJob]  = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const headers = { Authorization: `Bearer ${token}` };

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [meRes, jobsRes] = await Promise.all([
        fetch('/api/vendor-portal/me', { headers }),
        fetch('/api/vendor-portal/my-jobs', { headers }),
      ]);
      if (meRes.ok)   setProfile(await meRes.json());
      if (jobsRes.ok) setJobs(await jobsRes.json());
    } finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const filtered = statusFilter ? jobs.filter(j => j.status === statusFilter) : jobs;
  const counts   = jobs.reduce((a, j) => { a[j.status] = (a[j.status] || 0) + 1; return a; }, {});

  if (loading) return (
    <div className="flex items-center justify-center min-h-[300px] text-muted-foreground gap-3">
      <Loader2 className="w-5 h-5 animate-spin" /> Memuat data...
    </div>
  );

  // ─── Job Detail View ──────────────────────────────────────────────────────
  if (activeJob) return (
    <div className="p-4 max-w-2xl mx-auto">
      <JobDetail job={activeJob} token={token} onBack={() => { setActiveJob(null); loadAll(); }} />
    </div>
  );

  // ─── Jobs List View ───────────────────────────────────────────────────────
  return (
    <div className="space-y-5 p-4 max-w-2xl mx-auto" data-testid="vendor-portal-module">

      {/* Header + Profile */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Briefcase className="w-6 h-6 text-primary" />
            <h1 className="text-xl font-bold text-foreground">Portal Vendor CMT</h1>
          </div>
          {profile?.partner && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {profile.partner.name} · {profile.name}
            </p>
          )}
        </div>
        <button onClick={loadAll} className="p-2 rounded-lg hover:bg-white/10 text-muted-foreground" data-testid="btn-refresh-jobs">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-3">
        {[['open','Belum Mulai','text-slate-300'],['in_progress','Berjalan','text-blue-300'],['done','Selesai','text-green-300']].map(([s,l,c]) => (
          <button key={s} onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
            className={`rounded-xl border p-3 text-center transition-all ${
              statusFilter === s ? 'border-primary/40 bg-primary/10' : 'border-white/10 bg-white/5 hover:bg-white/8'
            }`} data-testid={`filter-${s}`}>
            <div className={`text-2xl font-bold ${c}`}>{counts[s] || 0}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{l}</div>
          </button>
        ))}
      </div>

      {/* Jobs List */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title={statusFilter ? `Tidak ada pekerjaan dengan status "${STATUS_LABEL[statusFilter]}"` : 'Belum ada pekerjaan yang ditugaskan'}
          description={statusFilter ? 'Coba ganti filter status untuk melihat pekerjaan lain.' : 'Pekerjaan dari CV. Dewi Aditya akan muncul di sini setelah ditugaskan.'}
          data-testid="jobs-empty"
        />
      ) : (
        <div className="space-y-3" data-testid="jobs-list">
          {filtered.map(j => (
            <JobCard key={j.id} job={j} onClick={() => setActiveJob(j)} />
          ))}
        </div>
      )}
    </div>
  );
}
