import { useState, useEffect, useCallback, useMemo } from 'react';
import { GlassCard } from '@/components/ui/glass';
import {
  Briefcase, Users, TrendingUp, Plus, Search, Filter, RefreshCw,
  X, ChevronRight, MapPin, Clock, Star, Phone, Mail, Eye,
  ArrowRight, BarChart3, AlertCircle, Pencil, Trash2, UserCheck,
  CheckCircle2, Circle, ChevronDown, Calendar, Bookmark, BookmarkCheck,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend } from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = (path, opts = {}) => fetch(`${BACKEND_URL}/api/dewi/recruitment${path}`, opts);
const fmtDate = d => d ? new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
const fmtCurrency = n => n ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n) : 'Negosiasi';

const JOB_STATUS_CFG = {
  open:    { label: 'Buka',    color: 'bg-emerald-400/15 text-emerald-400 border-emerald-400/20' },
  closed:  { label: 'Tutup',  color: 'bg-slate-400/15 text-slate-400 border-slate-400/20' },
  draft:   { label: 'Draft',  color: 'bg-amber-400/15 text-amber-400 border-amber-400/20' },
  on_hold: { label: 'Tunda',  color: 'bg-orange-400/15 text-orange-400 border-orange-400/20' },
};

const PIPELINE_STAGES = ['Lamaran Masuk','Screening CV','Interview HR','Interview User','Offering','Hired','Rejected'];

const STAGE_CFG = {
  'Lamaran Masuk':  { color: '#6366f1', bg: '#6366f115' },
  'Screening CV':   { color: '#3b82f6', bg: '#3b82f615' },
  'Interview HR':   { color: '#8b5cf6', bg: '#8b5cf615' },
  'Interview User': { color: '#f59e0b', bg: '#f59e0b15' },
  'Offering':       { color: '#14b8a6', bg: '#14b8a615' },
  'Hired':          { color: '#10b981', bg: '#10b98115' },
  'Rejected':       { color: '#ef4444', bg: '#ef444415' },
};

const RATING_STARS = Array.from({ length: 5 }, (_, i) => i + 1);

function JobStatusBadge({ status }) {
  const c = JOB_STATUS_CFG[status] || JOB_STATUS_CFG.draft;
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${c.color}`}>{c.label}</span>;
}

function StageBadge({ stage }) {
  const c = STAGE_CFG[stage] || { color: '#64748b', bg: '#64748b15' };
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: c.bg, color: c.color }}>{stage}</span>
  );
}

function RatingStars({ rating }) {
  return (
    <div className="flex gap-0.5">
      {RATING_STARS.map(s => (
        <Star key={s} className="w-3 h-3" fill={s <= rating ? '#f59e0b' : 'none'} stroke={s <= rating ? '#f59e0b' : '#64748b'} />
      ))}
    </div>
  );
}

// Pipeline Kanban View
function PipelineView({ pipeline, onStageCandidate, onViewCandidate }) {
  if (!pipeline) return null;
  const stages = PIPELINE_STAGES.filter(s => s !== 'Rejected');
  
  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex gap-3 min-w-max">
        {stages.map(stage => {
          const col = pipeline[stage] || { count: 0, candidates: [] };
          const cfg = STAGE_CFG[stage] || { color: '#64748b', bg: '#64748b15' };
          return (
            <div key={stage} className="w-64 flex-shrink-0">
              <div className="flex items-center justify-between mb-2 px-1">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: cfg.color }} />
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{stage}</span>
                </div>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: cfg.bg, color: cfg.color }}>{col.count}</span>
              </div>
              <div className="space-y-2">
                {col.candidates.map(c => (
                  <div key={c.candidate_id}
                    className="p-3 rounded-xl bg-[var(--card-surface)] border border-[var(--glass-border)] cursor-pointer hover:border-[hsl(var(--primary)/0.3)] transition-all group"
                    onClick={() => onViewCandidate(c)}
                    data-testid={`pipeline-card-${c.candidate_id}`}>
                    <div className="flex items-start justify-between mb-2">
                      <div className="w-7 h-7 rounded-full bg-[hsl(var(--primary)/0.15)] flex items-center justify-center text-primary text-xs font-bold">
                        {c.name?.[0]?.toUpperCase() || 'K'}
                      </div>
                      <RatingStars rating={c.rating} />
                    </div>
                    <p className="text-sm font-medium text-foreground">{c.name}</p>
                    <p className="text-xs text-muted-foreground mb-2">{c.job_title}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{c.source}</span>
                      <span className="text-xs text-muted-foreground">{fmtDate(c.applied_at)}</span>
                    </div>
                    <div className="mt-2 flex gap-1">
                      {PIPELINE_STAGES.filter(s => s !== stage && s !== 'Rejected').slice(0, 1).map(nextStage => (
                        <button key={nextStage}
                          onClick={e => { e.stopPropagation(); onStageCandidate(c.candidate_id, nextStage); }}
                          className="text-[10px] px-2 py-0.5 rounded-md border border-[var(--glass-border)] text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                          Maju →
                        </button>
                      ))}
                      <button onClick={e => { e.stopPropagation(); onStageCandidate(c.candidate_id, 'Rejected'); }}
                        className="text-[10px] px-2 py-0.5 rounded-md border border-red-400/20 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">Tolak</button>
                    </div>
                  </div>
                ))}
                {col.candidates.length === 0 && (
                  <div className="h-20 rounded-xl border border-dashed border-[var(--glass-border)] flex items-center justify-center">
                    <span className="text-xs text-muted-foreground">Kosong</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function HRATSModule({ token }) {
  const [tab, setTab] = useState('pipeline'); // pipeline | jobs | candidates | analytics | talent_pool
  const [jobs, setJobs] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [pipeline, setPipeline] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [talentPool, setTalentPool] = useState([]);
  const [talentPoolSearch, setTalentPoolSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedJob, setSelectedJob] = useState(null);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [showJobForm, setShowJobForm] = useState(false);
  const [showCandForm, setShowCandForm] = useState(false);
  const [editJob, setEditJob] = useState(null);
  const [jobForm, setJobForm] = useState({ title: '', department: '', location: 'Bandung', type: 'Full-time', level: 'Staff', salary_min: 0, salary_max: 0, headcount: 1, description: '', status: 'open', deadline: '' });
  const [candForm, setCandForm] = useState({ name: '', email: '', phone: '', job_id: '', source: 'Walk-in', education: 'SMA/SMK', experience_years: 0, notes: '' });
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [filterJobId, setFilterJobId] = useState('');
  const [q, setQ] = useState('');

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }), [token]);

  const fetchAll = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [jRes, pRes, aRes] = await Promise.all([
        API(`/jobs?limit=50`, { headers }),
        API(`/pipeline`, { headers }),
        API(`/analytics`, { headers }),
      ]);
      const [jd, pd, ad] = await Promise.all([jRes.json(), pRes.json(), aRes.json()]);
      setJobs(jd.jobs || []);
      setPipeline(pd.pipeline || null);
      setAnalytics(ad);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [headers]);

  const fetchCandidates = useCallback(async (jid = '') => {
    try {
      const r = await API(`/candidates?limit=100${jid ? `&job_id=${jid}` : ''}`, { headers });
      const d = await r.json();
      setCandidates(d.candidates || []);
    } catch {}
  }, [headers]);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useEffect(() => { if (tab === 'candidates') fetchCandidates(filterJobId); }, [tab, filterJobId, fetchCandidates]);

  const fetchTalentPool = useCallback(async (search = '') => {
    try {
      const r = await API(`/talent-pool${search ? `?search=${encodeURIComponent(search)}` : ''}`, { headers });
      const d = await r.json();
      setTalentPool(d.candidates || []);
    } catch {}
  }, [headers]);

  useEffect(() => { if (tab === 'talent_pool') fetchTalentPool(talentPoolSearch); }, [tab, talentPoolSearch, fetchTalentPool]);

  const handleToggleTalentPool = async (candidateId, name) => {
    const r = await API(`/talent-pool/${candidateId}/toggle`, { method: 'POST', headers });
    const d = await r.json();
    if (r.ok) {
      fetchTalentPool(talentPoolSearch);
      fetchAll();
    }
  };

  const handleSeed = async () => {
    setSeeding(true);
    await API(`/seed`, { method: 'POST', headers });
    setSeeding(false);
    fetchAll();
  };

  const openJobForm = (j = null) => {
    setEditJob(j);
    setJobForm(j ? {
      title: j.title, department: j.department, location: j.location, type: j.type,
      level: j.level, salary_min: j.salary_min, salary_max: j.salary_max,
      headcount: j.headcount, description: j.description, status: j.status,
      deadline: j.deadline ? j.deadline.slice(0, 10) : ''
    } : { title: '', department: '', location: 'Bandung', type: 'Full-time', level: 'Staff', salary_min: 0, salary_max: 0, headcount: 1, description: '', status: 'open', deadline: '' });
    setShowJobForm(true);
  };

  const handleSaveJob = async () => {
    setSaving(true);
    try {
      if (editJob) {
        await API(`/jobs/${editJob.job_id}`, { method: 'PUT', headers, body: JSON.stringify(jobForm) });
      } else {
        await API(`/jobs`, { method: 'POST', headers, body: JSON.stringify(jobForm) });
      }
      setShowJobForm(false);
      fetchAll();
    } catch {} finally { setSaving(false); }
  };

  const handleSaveCand = async () => {
    setSaving(true);
    try {
      await API(`/candidates`, { method: 'POST', headers, body: JSON.stringify(candForm) });
      setShowCandForm(false);
      fetchAll();
      fetchCandidates(filterJobId);
    } catch {} finally { setSaving(false); }
  };

  const handleStageChange = async (candidateId, newStage) => {
    try {
      await API(`/candidates/${candidateId}`, { method: 'PUT', headers, body: JSON.stringify({ stage: newStage }) });
      fetchAll();
    } catch {}
  };

  const filteredCandidates = useMemo(() => candidates.filter(c => {
    if (q && !c.name.toLowerCase().includes(q.toLowerCase()) && !c.email.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [candidates, q]);

  if (loading) return (
    <div className="space-y-4 p-4" data-testid="hr-ats-skeleton">
      <Skeleton className="h-16 rounded-xl" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );

  return (
    <div className="space-y-5" data-testid="hr-ats-module">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Briefcase className="w-6 h-6 text-primary" />Rekrutmen & ATS</h1>
          <p className="text-muted-foreground text-sm">Pipeline kandidat, lowongan, dan tracking proses rekrutmen</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleSeed} disabled={seeding}
            className="h-9 px-3 rounded-lg border border-dashed border-[var(--glass-border)] text-xs text-muted-foreground hover:text-foreground">
            {seeding ? 'Memuat...' : 'Muat Demo'}
          </button>
          <button onClick={() => openJobForm()}
            className="h-9 px-4 rounded-xl bg-[hsl(var(--primary))] text-white text-sm font-medium hover:opacity-90 flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Buat Lowongan
          </button>
        </div>
      </div>

      {/* Quick stats */}
      {analytics && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Lowongan Buka', value: analytics.summary?.open_jobs, color: '#10b981', icon: Briefcase },
            { label: 'Total Kandidat', value: analytics.summary?.total_candidates, color: '#6366f1', icon: Users },
            { label: 'Sudah Diterima', value: analytics.summary?.hired, color: '#10b981', icon: UserCheck },
            { label: 'Conversion Rate', value: `${analytics.summary?.conversion_rate || 0}%`, color: '#8b5cf6', icon: TrendingUp },
          ].map((k, i) => (
            <GlassCard key={i} hover={false} className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${k.color}20`, border: `1px solid ${k.color}35` }}>
                <k.icon className="w-5 h-5" style={{ color: k.color }} />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">{k.value}</p>
                <p className="text-xs text-muted-foreground">{k.label}</p>
              </div>
            </GlassCard>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-[var(--nav-pill-bg)] border border-[var(--glass-border)] w-fit flex-wrap">
        {[['pipeline','Pipeline'],['talent_pool','Talent Pool'],['jobs','Lowongan'],['candidates','Kandidat'],['analytics','Analitik']].map(([k,l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              tab === k ? 'bg-[var(--nav-pill-active)] text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`} data-testid={`ats-tab-${k}`}>{l}</button>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-400/10 border border-red-400/20 text-sm text-red-400">
          <AlertCircle className="w-4 h-4" />{error}
        </div>
      )}

      {/* ─── PIPELINE TAB ────────────────────────────────── */}
      {tab === 'pipeline' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <select value={filterJobId} onChange={e => setFilterJobId(e.target.value)}
              className="h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm">
              <option value="">Semua Lowongan</option>
              {jobs.map(j => <option key={j.job_id} value={j.job_id}>{j.title}</option>)}
            </select>
            <button onClick={() => setShowCandForm(true)}
              className="h-9 px-3 rounded-lg border border-[var(--glass-border)] text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5">
              <Plus className="w-4 h-4" /> Tambah Kandidat
            </button>
          </div>
          {pipeline ? (
            <PipelineView pipeline={pipeline} onStageCandidate={handleStageChange} onViewCandidate={setSelectedCandidate} />
          ) : (
            <div className="text-center py-12 text-muted-foreground">Belum ada kandidat</div>
          )}
        </div>
      )}

      {/* ─── JOBS TAB ───────────────────────────────────── */}
      {tab === 'jobs' && (
        <div className="space-y-4">
          {jobs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">Belum ada lowongan</div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {jobs.map(j => (
                <GlassCard key={j.job_id} hover className="p-5 cursor-pointer group" onClick={() => setSelectedJob(j)} data-testid={`job-card-${j.job_id}`}>
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <JobStatusBadge status={j.status} />
                      <h3 className="font-semibold text-foreground mt-1">{j.title}</h3>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                        <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{j.location}</span>
                        <span>{j.department}</span>
                        <span>{j.type}</span>
                      </div>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                      <button onClick={e => { e.stopPropagation(); openJobForm(j); }}
                        className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-[var(--nav-pill-active)] text-muted-foreground">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{j.candidate_count || 0} kandidat</span>
                      <span className="flex items-center gap-1"><UserCheck className="w-3.5 h-3.5" />{j.hired_count || 0} diterima</span>
                    </div>
                    <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />Deadline: {fmtDate(j.deadline)}</span>
                  </div>
                  <div className="mt-2 text-xs font-medium text-primary">
                    {j.salary_min && j.salary_max ? `${fmtCurrency(j.salary_min)} – ${fmtCurrency(j.salary_max)}` : 'Gaji: Negosiasi'}
                  </div>
                </GlassCard>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── CANDIDATES TAB ─────────────────────────────── */}
      {tab === 'candidates' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-48 h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)]">
              <Search className="w-4 h-4 text-muted-foreground" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Cari kandidat..."
                className="flex-1 bg-transparent text-sm focus:outline-none" />
            </div>
            <select value={filterJobId} onChange={e => setFilterJobId(e.target.value)}
              className="h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm">
              <option value="">Semua Lowongan</option>
              {jobs.map(j => <option key={j.job_id} value={j.job_id}>{j.title}</option>)}
            </select>
            <button onClick={() => setShowCandForm(true)} className="h-9 px-3 rounded-xl bg-[hsl(var(--primary))] text-white text-sm flex items-center gap-1">
              <Plus className="w-4 h-4" /> Tambah
            </button>
          </div>
          <GlassCard hover={false} className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-[var(--glass-border)]">
                  <tr>
                    {['Nama','Posisi','Stage','Rating','Sumber','Lamaran'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">{h}</th>
                    ))}
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--glass-border)]">
                  {filteredCandidates.map(c => (
                    <tr key={c.candidate_id} className="hover:bg-[var(--glass-bg-hover)] cursor-pointer" onClick={() => setSelectedCandidate(c)}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-[hsl(var(--primary)/0.15)] flex items-center justify-center text-xs font-bold text-primary">
                            {c.name?.[0]}
                          </div>
                          <div>
                            <p className="font-medium">{c.name}</p>
                            <p className="text-xs text-muted-foreground">{c.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{c.job_title}</td>
                      <td className="px-4 py-3"><StageBadge stage={c.stage} /></td>
                      <td className="px-4 py-3"><RatingStars rating={c.rating} /></td>
                      <td className="px-4 py-3 text-muted-foreground">{c.source}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(c.applied_at)}</td>
                      <td className="px-4 py-3">
                        <select value={c.stage} onChange={e => handleStageChange(c.candidate_id, e.target.value)}
                          onClick={e => e.stopPropagation()}
                          className="h-7 px-2 text-xs rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)]">
                          {PIPELINE_STAGES.map(s => <option key={s}>{s}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredCandidates.length === 0 && (
                <div className="py-12 text-center text-muted-foreground text-sm">Belum ada kandidat</div>
              )}
            </div>
          </GlassCard>
        </div>
      )}

      {/* ─── TALENT POOL TAB ────────────────────────────── */}
      {tab === 'talent_pool' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                value={talentPoolSearch}
                onChange={e => setTalentPoolSearch(e.target.value)}
                placeholder="Cari nama, posisi, skill..."
                className="w-full pl-9 pr-3 h-9 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm"
                data-testid="talent-pool-search"
              />
            </div>
            <span className="text-sm text-muted-foreground">{talentPool.length} kandidat</span>
          </div>

          {talentPool.length > 0 ? (
            <GlassCard hover={false} className="overflow-hidden p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--glass-border)] text-xs text-muted-foreground">
                    <th className="text-left px-4 py-3">Kandidat</th>
                    <th className="text-left px-4 py-3">Posisi Terakhir</th>
                    <th className="text-left px-4 py-3">Stage</th>
                    <th className="text-left px-4 py-3">Kontak</th>
                    <th className="text-left px-4 py-3">Ditambahkan</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--glass-border)]">
                  {talentPool.map(c => (
                    <tr key={c.candidate_id} className="hover:bg-white/5 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs text-muted-foreground">{c.education}</div>
                        {c.rating > 0 && <RatingStars rating={c.rating} />}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm">{c.position_applied || c.job_title || '—'}</div>
                        <div className="text-xs text-muted-foreground">{c.source}</div>
                      </td>
                      <td className="px-4 py-3"><StageBadge stage={c.stage} /></td>
                      <td className="px-4 py-3">
                        <div className="text-xs">{c.phone || '—'}</div>
                        <div className="text-xs text-muted-foreground">{c.email || '—'}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {c.talent_pool_added_at ? fmtDate(c.talent_pool_added_at) : '—'}
                        {c.talent_pool_added_by && <div className="text-xs">{c.talent_pool_added_by}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button onClick={() => setSelectedCandidate(c)}
                            className="p-1.5 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground" title="Lihat Detail">
                            <Eye className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleToggleTalentPool(c.candidate_id, c.name)}
                            className="p-1.5 rounded hover:bg-red-500/10 text-red-400" title="Keluarkan dari Pool"
                            data-testid={`remove-talent-pool-${c.candidate_id}`}>
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </GlassCard>
          ) : (
            <GlassCard hover={false} className="py-16 text-center">
              <Users className="w-12 h-12 mx-auto mb-3 text-muted-foreground opacity-30" />
              <p className="text-muted-foreground font-medium">Talent Pool kosong</p>
              <p className="text-sm text-muted-foreground mt-1">
                Tambahkan kandidat dari tab Pipeline atau Kandidat dengan mengklik ikon bookmark pada kandidat
              </p>
            </GlassCard>
          )}
        </div>
      )}

      {/* ─── ANALYTICS TAB ──────────────────────────────── */}
      {tab === 'analytics' && analytics && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <GlassCard hover={false} className="p-5">
              <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-primary" />Funnel Pipeline</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={analytics.pipeline_stages} layout="vertical" margin={{ left: 80 }}>
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="stage" tick={{ fontSize: 10 }} width={80} />
                  <Tooltip contentStyle={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: 10, fontSize: 12 }} />
                  <Bar dataKey="count" radius={[0,4,4,0]}>
                    {(analytics.pipeline_stages || []).map((s, i) => (
                      <Cell key={i} fill={STAGE_CFG[s.stage]?.color || '#6366f1'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </GlassCard>

            <GlassCard hover={false} className="p-5">
              <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-primary" />Sumber Kandidat</h3>
              {(analytics.source_breakdown || []).length > 0 ? (
                <div className="space-y-2">
                  {analytics.source_breakdown.map((s, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-xs w-20 text-muted-foreground truncate">{s.source}</span>
                      <div className="flex-1 h-2 rounded-full bg-[var(--glass-border)] overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${(s.count / (analytics.summary?.total_candidates || 1)) * 100}%`, background: ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6'][i % 5] }} />
                      </div>
                      <span className="text-xs font-medium w-6 text-right">{s.count}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-center text-muted-foreground text-sm py-8">Belum ada data</p>}
            </GlassCard>
          </div>
        </div>
      )}

      {/* ─── JOB DETAIL MODAL ────────────────────────────── */}
      {selectedJob && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setSelectedJob(null)}>
          <div className="bg-[var(--card-surface)] rounded-2xl border border-[var(--glass-border)] shadow-2xl max-w-xl w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <JobStatusBadge status={selectedJob.status} />
                  <h2 className="text-xl font-bold mt-2">{selectedJob.title}</h2>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                    <span>{selectedJob.department}</span><span>·</span><span>{selectedJob.location}</span><span>·</span><span>{selectedJob.type}</span>
                  </div>
                </div>
                <button onClick={() => setSelectedJob(null)} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[var(--nav-pill-active)]">
                  <X className="w-4 h-4" />
                </button>
              </div>
              {selectedJob.description && <p className="text-sm text-muted-foreground mb-4">{selectedJob.description}</p>}
              {selectedJob.requirements?.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Persyaratan</h3>
                  <ul className="space-y-1">{selectedJob.requirements.map((r, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />{r}</li>
                  ))}</ul>
                </div>
              )}
              {selectedJob.benefits?.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Benefit</h3>
                  <ul className="space-y-1">{selectedJob.benefits.map((b, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm"><Star className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" fill="#f59e0b" />{b}</li>
                  ))}</ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── CANDIDATE DETAIL MODAL ────────────────────────── */}
      {selectedCandidate && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setSelectedCandidate(null)}>
          <div className="bg-[var(--card-surface)] rounded-2xl border border-[var(--glass-border)] shadow-2xl max-w-xl w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-full bg-[hsl(var(--primary)/0.15)] flex items-center justify-center text-primary text-xl font-bold">
                    {selectedCandidate.name?.[0]}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">{selectedCandidate.name}</h2>
                    <p className="text-sm text-muted-foreground">{selectedCandidate.job_title}</p>
                    <StageBadge stage={selectedCandidate.stage} />
                  </div>
                </div>
                <button onClick={() => setSelectedCandidate(null)} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[var(--nav-pill-active)]">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="flex items-center gap-2 text-sm"><Mail className="w-3.5 h-3.5 text-muted-foreground" /><span>{selectedCandidate.email || '—'}</span></div>
                <div className="flex items-center gap-2 text-sm"><Phone className="w-3.5 h-3.5 text-muted-foreground" /><span>{selectedCandidate.phone || '—'}</span></div>
                <div className="text-sm"><span className="text-muted-foreground">Pendidikan:</span> {selectedCandidate.education}</div>
                <div className="text-sm"><span className="text-muted-foreground">Pengalaman:</span> {selectedCandidate.experience_years} tahun</div>
                <div className="text-sm"><span className="text-muted-foreground">Sumber:</span> {selectedCandidate.source}</div>
                <div className="flex items-center gap-1 text-sm"><span className="text-muted-foreground">Rating:</span><RatingStars rating={selectedCandidate.rating} /></div>
              </div>
              {selectedCandidate.skills?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {selectedCandidate.skills.map(s => <span key={s} className="text-xs px-2 py-0.5 rounded-full bg-[var(--nav-pill-active)] text-muted-foreground">{s}</span>)}
                </div>
              )}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Timeline</h3>
                <div className="space-y-2">
                  {(selectedCandidate.timeline || []).map((t, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: STAGE_CFG[t.stage]?.color || '#64748b' }} />
                      <div>
                        <p className="text-sm font-medium">{t.stage}</p>
                        <p className="text-xs text-muted-foreground">{fmtDate(t.date)} · {t.by}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-4">
                <label className="text-xs font-medium text-muted-foreground block mb-1">Pindahkan Stage</label>
                <div className="flex flex-wrap gap-2">
                  {PIPELINE_STAGES.filter(s => s !== selectedCandidate.stage).map(s => (
                    <button key={s} onClick={() => { handleStageChange(selectedCandidate.candidate_id, s); setSelectedCandidate(null); }}
                      className="text-xs px-2 py-1 rounded-lg border border-[var(--glass-border)] text-muted-foreground hover:border-[hsl(var(--primary)/0.3)] hover:text-foreground transition-colors">
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Talent Pool Action */}
              <div className="pt-2 border-t border-[var(--glass-border)]">
                <button
                  onClick={() => {
                    handleToggleTalentPool(selectedCandidate.candidate_id, selectedCandidate.name);
                    setSelectedCandidate(prev => ({ ...prev, is_talent_pool: !prev.is_talent_pool }));
                  }}
                  className={`w-full py-2 px-4 rounded-xl border text-sm font-medium flex items-center justify-center gap-2 transition-all ${
                    selectedCandidate.is_talent_pool
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                      : 'border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                  }`}
                  data-testid="toggle-talent-pool-btn"
                >
                  {selectedCandidate.is_talent_pool
                    ? <><BookmarkCheck className="w-4 h-4" /> Dalam Talent Pool — Klik untuk Keluarkan</>
                    : <><Bookmark className="w-4 h-4" /> Masukkan ke Talent Pool</>
                  }
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── JOB FORM ────────────────────────────────────── */}
      {showJobForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--card-surface)] rounded-2xl border border-[var(--glass-border)] shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-bold">{editJob ? 'Edit Lowongan' : 'Buat Lowongan Baru'}</h2>
                <button onClick={() => setShowJobForm(false)} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[var(--nav-pill-active)]">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-3">
                <div><label className="text-xs font-medium text-muted-foreground block mb-1">Judul Posisi *</label>
                  <input value={jobForm.title} onChange={e => setJobForm(p => ({...p, title: e.target.value}))}
                    className="w-full h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-xs font-medium text-muted-foreground block mb-1">Departemen</label>
                    <input value={jobForm.department} onChange={e => setJobForm(p => ({...p, department: e.target.value}))}
                      className="w-full h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm" /></div>
                  <div><label className="text-xs font-medium text-muted-foreground block mb-1">Lokasi</label>
                    <input value={jobForm.location} onChange={e => setJobForm(p => ({...p, location: e.target.value}))}
                      className="w-full h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm" /></div>
                  <div><label className="text-xs font-medium text-muted-foreground block mb-1">Tipe</label>
                    <select value={jobForm.type} onChange={e => setJobForm(p => ({...p, type: e.target.value}))}
                      className="w-full h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm">
                      <option>Full-time</option><option>Part-time</option><option>Contract</option><option>Magang</option>
                    </select></div>
                  <div><label className="text-xs font-medium text-muted-foreground block mb-1">Level</label>
                    <select value={jobForm.level} onChange={e => setJobForm(p => ({...p, level: e.target.value}))}
                      className="w-full h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm">
                      <option>Staff</option><option>Senior</option><option>Supervisor</option><option>Manager</option>
                    </select></div>
                  <div><label className="text-xs font-medium text-muted-foreground block mb-1">Gaji Min (Rp)</label>
                    <input type="number" value={jobForm.salary_min} onChange={e => setJobForm(p => ({...p, salary_min: +e.target.value}))}
                      className="w-full h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm" /></div>
                  <div><label className="text-xs font-medium text-muted-foreground block mb-1">Gaji Max (Rp)</label>
                    <input type="number" value={jobForm.salary_max} onChange={e => setJobForm(p => ({...p, salary_max: +e.target.value}))}
                      className="w-full h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm" /></div>
                  <div><label className="text-xs font-medium text-muted-foreground block mb-1">Headcount</label>
                    <input type="number" value={jobForm.headcount} onChange={e => setJobForm(p => ({...p, headcount: +e.target.value}))}
                      className="w-full h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm" min={1} /></div>
                  <div><label className="text-xs font-medium text-muted-foreground block mb-1">Deadline</label>
                    <input type="date" value={jobForm.deadline} onChange={e => setJobForm(p => ({...p, deadline: e.target.value}))}
                      className="w-full h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm" /></div>
                  <div className="col-span-2"><label className="text-xs font-medium text-muted-foreground block mb-1">Status</label>
                    <select value={jobForm.status} onChange={e => setJobForm(p => ({...p, status: e.target.value}))}
                      className="w-full h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm">
                      <option value="open">Buka</option><option value="draft">Draft</option><option value="on_hold">Tunda</option><option value="closed">Tutup</option>
                    </select></div>
                </div>
                <div><label className="text-xs font-medium text-muted-foreground block mb-1">Deskripsi</label>
                  <textarea value={jobForm.description} onChange={e => setJobForm(p => ({...p, description: e.target.value}))}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm h-20 resize-none" /></div>
              </div>
              <div className="flex gap-3 mt-5">
                <button onClick={() => setShowJobForm(false)} className="flex-1 h-10 rounded-xl border border-[var(--glass-border)] text-sm">Batal</button>
                <button onClick={handleSaveJob} disabled={saving || !jobForm.title}
                  className="flex-1 h-10 rounded-xl bg-[hsl(var(--primary))] text-white text-sm font-medium disabled:opacity-50">
                  {saving ? 'Menyimpan...' : (editJob ? 'Simpan' : 'Buat')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── CANDIDATE FORM ──────────────────────────────── */}
      {showCandForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--card-surface)] rounded-2xl border border-[var(--glass-border)] shadow-2xl w-full max-w-lg">
            <div className="p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-bold">Tambah Kandidat</h2>
                <button onClick={() => setShowCandForm(false)} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[var(--nav-pill-active)]">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2"><label className="text-xs font-medium text-muted-foreground block mb-1">Nama Lengkap *</label>
                    <input value={candForm.name} onChange={e => setCandForm(p => ({...p, name: e.target.value}))}
                      className="w-full h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm" /></div>
                  <div><label className="text-xs font-medium text-muted-foreground block mb-1">Email</label>
                    <input value={candForm.email} onChange={e => setCandForm(p => ({...p, email: e.target.value}))}
                      className="w-full h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm" /></div>
                  <div><label className="text-xs font-medium text-muted-foreground block mb-1">No. HP</label>
                    <input value={candForm.phone} onChange={e => setCandForm(p => ({...p, phone: e.target.value}))}
                      className="w-full h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm" /></div>
                  <div><label className="text-xs font-medium text-muted-foreground block mb-1">Lowongan</label>
                    <select value={candForm.job_id} onChange={e => setCandForm(p => ({...p, job_id: e.target.value}))}
                      className="w-full h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm">
                      <option value="">Pilih lowongan</option>
                      {jobs.map(j => <option key={j.job_id} value={j.job_id}>{j.title}</option>)}
                    </select></div>
                  <div><label className="text-xs font-medium text-muted-foreground block mb-1">Sumber</label>
                    <select value={candForm.source} onChange={e => setCandForm(p => ({...p, source: e.target.value}))}
                      className="w-full h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm">
                      <option>Walk-in</option><option>Jobstreet</option><option>LinkedIn</option><option>Referral</option>
                    </select></div>
                  <div><label className="text-xs font-medium text-muted-foreground block mb-1">Pendidikan</label>
                    <select value={candForm.education} onChange={e => setCandForm(p => ({...p, education: e.target.value}))}
                      className="w-full h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm">
                      <option>SMA/SMK</option><option>D3</option><option>S1</option><option>S2</option>
                    </select></div>
                  <div><label className="text-xs font-medium text-muted-foreground block mb-1">Pengalaman (tahun)</label>
                    <input type="number" value={candForm.experience_years} onChange={e => setCandForm(p => ({...p, experience_years: +e.target.value}))}
                      className="w-full h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm" min={0} /></div>
                </div>
              </div>
              <div className="flex gap-3 mt-5">
                <button onClick={() => setShowCandForm(false)} className="flex-1 h-10 rounded-xl border border-[var(--glass-border)] text-sm">Batal</button>
                <button onClick={handleSaveCand} disabled={saving || !candForm.name}
                  className="flex-1 h-10 rounded-xl bg-[hsl(var(--primary))] text-white text-sm font-medium disabled:opacity-50">
                  {saving ? 'Menyimpan...' : 'Tambah'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
