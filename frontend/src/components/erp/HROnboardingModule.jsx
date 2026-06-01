import { useState, useEffect, useCallback, useMemo } from 'react';
import { GlassCard } from '@/components/ui/glass';
import {
  UserPlus, CheckCircle2, Circle, AlertCircle, RefreshCw, Plus, X,
  ChevronRight, Clock, Users, TrendingUp, Check, ClipboardList,
  User, Pencil, Trash2, Calendar, BarChart3, BookOpen, Star
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = (path, opts = {}) => fetch(`${BACKEND_URL}/api/dewi/onboarding${path}`, opts);
const fmtDate = d => d ? new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';

const STATUS_CFG = {
  active:    { label: 'Aktif',    color: 'bg-blue-400/15 text-blue-400 border-blue-400/20' },
  completed: { label: 'Selesai', color: 'bg-emerald-400/15 text-emerald-400 border-emerald-400/20' },
  paused:    { label: 'Ditunda', color: 'bg-amber-400/15 text-amber-400 border-amber-400/20' },
};

const TASK_STATUS_CFG = {
  pending: { label: 'Belum',    icon: Circle,       color: '#94a3b8' },
  done:    { label: 'Selesai', icon: CheckCircle2, color: '#10b981' },
  skipped: { label: 'Skip',    icon: CheckCircle2, color: '#6366f1' },
};

const CATEGORY_COLORS = { HR: '#6366f1', IT: '#10b981', Legal: '#f59e0b', Keselamatan: '#ef4444', Training: '#8b5cf6', Administrasi: '#14b8a6', default: '#64748b' };

function StatusBadge({ status }) {
  const c = STATUS_CFG[status] || STATUS_CFG.active;
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${c.color}`}>{c.label}</span>;
}

function ProgressBar({ pct }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">Progress</span>
        <span className="font-semibold">{pct || 0}%</span>
      </div>
      <div className="h-2 rounded-full bg-[var(--glass-border)] overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct || 0}%`, background: pct >= 100 ? '#10b981' : 'hsl(var(--primary))' }} />
      </div>
    </div>
  );
}

function ChecklistDetail({ cl, token, onUpdate }) {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }), [token]);
  const [saving, setSaving] = useState(null);

  const toggleTask = async (task) => {
    const newStatus = task.status === 'done' ? 'pending' : 'done';
    setSaving(task.task_id);
    try {
      const r = await fetch(`${BACKEND_URL}/api/dewi/onboarding/checklists/${cl.checklist_id}/tasks/${task.task_id}`, {
        method: 'PUT', headers, body: JSON.stringify({ status: newStatus })
      });
      const d = await r.json();
      if (d.ok) onUpdate(d.checklist);
    } finally { setSaving(null); }
  };

  const byCategory = useMemo(() => {
    const acc = {};
    (cl.tasks || []).forEach(t => {
      if (!acc[t.category]) acc[t.category] = [];
      acc[t.category].push(t);
    });
    return acc;
  }, [cl.tasks]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold">{cl.employee_name}</h2>
          <p className="text-sm text-muted-foreground">{cl.employee_position} · {cl.employee_dept}</p>
        </div>
        <StatusBadge status={cl.status} />
      </div>

      <ProgressBar pct={cl.progress_pct} />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
        <div className="p-3 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)]">
          <p className="text-lg font-bold text-emerald-400">{cl.completed_tasks}</p>
          <p className="text-xs text-muted-foreground">Selesai</p>
        </div>
        <div className="p-3 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)]">
          <p className="text-lg font-bold">{cl.total_tasks}</p>
          <p className="text-xs text-muted-foreground">Total Tugas</p>
        </div>
        <div className="p-3 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)]">
          <p className="text-sm font-medium">{cl.buddy || '—'}</p>
          <p className="text-xs text-muted-foreground">Buddy</p>
        </div>
        <div className="p-3 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)]">
          <p className="text-sm font-medium">{fmtDate(cl.target_completion)}</p>
          <p className="text-xs text-muted-foreground">Target</p>
        </div>
      </div>

      {/* Tasks by Category */}
      {Object.entries(byCategory).map(([cat, tasks]) => (
        <div key={cat}>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full" style={{ background: CATEGORY_COLORS[cat] || CATEGORY_COLORS.default }} />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{cat}</span>
          </div>
          <div className="space-y-1.5">
            {tasks.map(t => (
              <div key={t.task_id}
                className="flex items-center gap-3 p-3 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)] hover:border-[hsl(var(--primary)/0.3)] transition-colors">
                <button onClick={() => toggleTask(t)} disabled={saving === t.task_id}
                  className="w-6 h-6 rounded-full flex items-center justify-center transition-all"
                  style={{ background: t.status === 'done' ? '#10b98120' : 'transparent', border: `2px solid ${t.status === 'done' ? '#10b981' : '#475569'}` }}>
                  {t.status === 'done' && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                </button>
                <div className="flex-1">
                  <p className={`text-sm ${t.status === 'done' ? 'line-through text-muted-foreground' : 'text-foreground'}`}>{t.title}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    <span>Hari ke-{t.day}</span>
                    {t.assigned_to && <span>· {t.assigned_to}</span>}
                    {t.completed_at && <span className="text-emerald-400">· Selesai {fmtDate(t.completed_at)}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function HROnboardingModule({ token }) {
  const [tab, setTab] = useState('checklists');
  const [checklists, setChecklists] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [form, setForm] = useState({ employee_id: '', employee_name: '', employee_dept: '', employee_position: '', template_id: '', buddy: '', supervisor: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }), [token]);

  const fetchAll = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [clRes, tRes, aRes] = await Promise.all([
        API(`/checklists?limit=50`, { headers }),
        API(`/templates`, { headers }),
        API(`/analytics`, { headers }),
      ]);
      const [cl, tpl, an] = await Promise.all([clRes.json(), tRes.json(), aRes.json()]);
      setChecklists(cl.checklists || []);
      setTemplates(tpl.templates || []);
      setAnalytics(an);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleSeed = async () => {
    setSeeding(true);
    await API(`/seed`, { method: 'POST', headers });
    setSeeding(false);
    fetchAll();
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await API(`/checklists`, { method: 'POST', headers, body: JSON.stringify(form) });
      setShowForm(false);
      fetchAll();
    } catch {} finally { setSaving(false); }
  };

  const handleUpdateChecklist = (updated) => {
    setChecklists(prev => prev.map(c => c.checklist_id === updated.checklist_id ? updated : c));
    setSelected(updated);
  };

  const filtered = useMemo(() => checklists.filter(c => {
    if (filterStatus && c.status !== filterStatus) return false;
    if (q && !c.employee_name.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [checklists, q, filterStatus]);

  if (loading) return (
    <div className="space-y-4 p-4" data-testid="hr-onboarding-skeleton">
      <Skeleton className="h-16 rounded-xl" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
      </div>
      <Skeleton className="h-48 rounded-xl" />
    </div>
  );

  return (
    <div className="space-y-5" data-testid="hr-onboarding-module">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><UserPlus className="w-6 h-6 text-primary" />Onboarding Karyawan</h1>
          <p className="text-muted-foreground text-sm">Checklist & tracking proses onboarding karyawan baru</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleSeed} disabled={seeding}
            className="h-9 px-3 rounded-lg border border-dashed border-[var(--glass-border)] text-xs text-muted-foreground hover:text-foreground">
            {seeding ? 'Memuat...' : 'Muat Demo'}
          </button>
          <button onClick={() => setShowForm(true)} data-testid="onboarding-add-btn"
            className="h-9 px-4 rounded-xl bg-[hsl(var(--primary))] text-white text-sm font-medium hover:opacity-90 flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Onboarding Baru
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-[var(--nav-pill-bg)] border border-[var(--glass-border)] w-fit">
        {[['checklists','Checklist'],['analytics','Analitik'],['templates','Template']].map(([k,l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              tab === k ? 'bg-[var(--nav-pill-active)] text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}>{l}</button>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-400/10 border border-red-400/20 text-sm text-red-400">
          <AlertCircle className="w-4 h-4" />{error}
        </div>
      )}

      {/* ─── CHECKLISTS ─────────────────────────────────── */}
      {tab === 'checklists' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-48 h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)]">
              <User className="w-4 h-4 text-muted-foreground" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Cari karyawan..."
                className="flex-1 bg-transparent text-sm focus:outline-none" />
            </div>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              className="h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm">
              <option value="">Semua Status</option>
              <option value="active">Aktif</option>
              <option value="completed">Selesai</option>
              <option value="paused">Ditunda</option>
            </select>
            <button onClick={fetchAll} className="h-9 w-9 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] flex items-center justify-center">
              <RefreshCw className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>

          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
              <ClipboardList className="w-10 h-10 text-muted-foreground/30" />
              <p className="text-muted-foreground text-sm">Belum ada checklist onboarding</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {filtered.map(cl => (
                <GlassCard key={cl.checklist_id} hover className="p-5 cursor-pointer" onClick={() => setSelected(cl)} data-testid={`checklist-card-${cl.checklist_id}`}>
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-[hsl(var(--primary)/0.15)] flex items-center justify-center text-primary font-bold">
                        {cl.employee_name?.[0]?.toUpperCase() || 'K'}
                      </div>
                      <div>
                        <p className="font-semibold text-foreground">{cl.employee_name}</p>
                        <p className="text-xs text-muted-foreground">{cl.employee_position} · {cl.employee_dept}</p>
                      </div>
                    </div>
                    <StatusBadge status={cl.status} />
                  </div>
                  <ProgressBar pct={cl.progress_pct} />
                  <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
                    <span>{cl.completed_tasks}/{cl.total_tasks} tugas selesai</span>
                    <span>Target: {fmtDate(cl.target_completion)}</span>
                  </div>
                </GlassCard>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── ANALYTICS ───────────────────────────────────── */}
      {tab === 'analytics' && analytics && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {[
              { label: 'Total', value: analytics.summary?.total, color: '#6366f1' },
              { label: 'Aktif', value: analytics.summary?.active, color: '#3b82f6' },
              { label: 'Selesai', value: analytics.summary?.completed, color: '#10b981' },
              { label: 'Overdue', value: analytics.summary?.overdue, color: '#ef4444' },
              { label: 'Avg Progress', value: `${analytics.summary?.avg_progress || 0}%`, color: '#8b5cf6' },
            ].map((k, i) => (
              <GlassCard key={i} hover={false} className="p-4 text-center">
                <p className="text-2xl font-bold" style={{ color: k.color }}>{k.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{k.label}</p>
              </GlassCard>
            ))}
          </div>

          <GlassCard hover={false} className="p-5">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><ClipboardList className="w-4 h-4 text-primary" />Onboarding Terbaru</h3>
            <div className="space-y-3">
              {(analytics.recent || []).map(cl => (
                <div key={cl.checklist_id} className="flex items-center gap-3 p-3 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)] cursor-pointer hover:border-[hsl(var(--primary)/0.3)]" onClick={() => { setTab('checklists'); setSelected(cl); }}>
                  <div className="w-8 h-8 rounded-full bg-[hsl(var(--primary)/0.15)] flex items-center justify-center text-primary text-sm font-bold">
                    {cl.employee_name?.[0]?.toUpperCase() || 'K'}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{cl.employee_name}</p>
                    <p className="text-xs text-muted-foreground">{cl.employee_position}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold">{cl.progress_pct}%</p>
                    <StatusBadge status={cl.status} />
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>
        </div>
      )}

      {/* ─── TEMPLATES ───────────────────────────────────── */}
      {tab === 'templates' && (
        <div className="space-y-4">
          {templates.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">Belum ada template</div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {templates.map(t => (
                <GlassCard key={t.template_id} hover={false} className="p-5">
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-semibold text-foreground">{t.name}</h3>
                    {t.is_default && <span className="text-xs px-2 py-0.5 rounded-full bg-[hsl(var(--primary)/0.15)] text-primary border border-[hsl(var(--primary)/0.3)]">Default</span>}
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">{t.description}</p>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>{t.dept}</span>
                    <span>{t.duration_days} hari</span>
                    <span>{(t.tasks || []).length} tugas</span>
                  </div>
                </GlassCard>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── CHECKLIST DETAIL MODAL ──────────────────────── */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-[var(--card-surface)] rounded-2xl border border-[var(--glass-border)] shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-lg">Detail Onboarding</h2>
                <button onClick={() => setSelected(null)} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[var(--nav-pill-active)]">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ChecklistDetail cl={selected} token={token} onUpdate={handleUpdateChecklist} />
            </div>
          </div>
        </div>
      )}

      {/* ─── CREATE MODAL ─────────────────────────────────── */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--card-surface)] rounded-2xl border border-[var(--glass-border)] shadow-2xl w-full max-w-lg">
            <div className="p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-bold">Buat Onboarding Baru</h2>
                <button onClick={() => setShowForm(false)} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[var(--nav-pill-active)]">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Nama Karyawan *</label>
                    <input value={form.employee_name} onChange={e => setForm(p => ({...p, employee_name: e.target.value}))}
                      className="w-full h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm" placeholder="Nama lengkap" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Jabatan</label>
                    <input value={form.employee_position} onChange={e => setForm(p => ({...p, employee_position: e.target.value}))}
                      className="w-full h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm" placeholder="Jabatan" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Departemen</label>
                    <input value={form.employee_dept} onChange={e => setForm(p => ({...p, employee_dept: e.target.value}))}
                      className="w-full h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm" placeholder="Departemen" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Buddy</label>
                    <input value={form.buddy} onChange={e => setForm(p => ({...p, buddy: e.target.value}))}
                      className="w-full h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm" placeholder="Nama buddy" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Supervisor</label>
                    <input value={form.supervisor} onChange={e => setForm(p => ({...p, supervisor: e.target.value}))}
                      className="w-full h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm" placeholder="Nama supervisor" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Template</label>
                    <select value={form.template_id} onChange={e => setForm(p => ({...p, template_id: e.target.value}))}
                      className="w-full h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm">
                      <option value="">Gunakan Default</option>
                      {templates.map(t => <option key={t.template_id} value={t.template_id}>{t.name}</option>)}
                    </select>
                  </div>
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button onClick={() => setShowForm(false)} className="flex-1 h-10 rounded-xl border border-[var(--glass-border)] text-sm text-muted-foreground">Batal</button>
                <button onClick={handleSave} disabled={saving || !form.employee_name}
                  className="flex-1 h-10 rounded-xl bg-[hsl(var(--primary))] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50">
                  {saving ? 'Membuat...' : 'Buat Checklist'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
