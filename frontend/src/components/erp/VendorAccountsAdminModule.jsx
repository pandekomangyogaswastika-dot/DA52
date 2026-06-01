/**
 * VendorAccountsAdminModule — Admin kelola vendor CMT
 * Tab 1: Vendor Partners (entitas vendor)
 * Tab 2: Akun User Vendor (login credentials)
 * Tab 3: Semua Jobs lintas vendor
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Users, Building2, Briefcase, Plus, Trash2,
  Loader2, RefreshCw, CheckCircle2, AlertCircle, ChevronDown, X
} from 'lucide-react';
import { Button } from '@/components/ui/button';

const TABS = [
  { id: 'partners', label: 'Vendor Partner', icon: Building2 },
  { id: 'accounts', label: 'Akun Vendor', icon: Users },
  { id: 'jobs',     label: 'Semua Jobs', icon: Briefcase },
];

const JOB_STATUS_COLOR = {
  open:        'text-slate-400',
  in_progress: 'text-blue-400',
  done:        'text-green-400',
  cancelled:   'text-red-400',
};

function Toast({ msg, type, onClose }) {
  return (
    <div className={`fixed top-5 right-5 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-xl border
      ${type==='ok' ? 'bg-green-500/20 border-green-400/30 text-green-200' : 'bg-red-500/20 border-red-400/30 text-red-200'}`}>
      {type==='ok' ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <AlertCircle className="w-5 h-5 shrink-0" />}
      <span className="text-sm font-medium">{msg}</span>
      <button onClick={onClose} className="ml-1"><X className="w-4 h-4" /></button>
    </div>
  );
}

// ── Partners Tab ──────────────────────────────────────────────────────────────

function PartnersTab({ token, showToast }) {
  const [list,    setList]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [form,    setForm]    = useState({ name:'', code:'', contact_name:'', contact_phone:'', address:'' });
  const [saving,  setSaving]  = useState(false);
  const [showForm,setShowForm]= useState(false);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await fetch('/api/vendor-portal/partners', { headers }); if (r.ok) setList(await r.json()); }
    finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function create(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const r = await fetch('/api/vendor-portal/partners', { method:'POST', headers, body: JSON.stringify(form) });
      if (!r.ok) { const er = await r.json(); throw new Error(er.detail); }
      showToast('ok', `Partner "${form.name}" berhasil dibuat.`);
      setForm({ name:'', code:'', contact_name:'', contact_phone:'', address:'' });
      setShowForm(false); load();
    } catch(e) { showToast('err', e.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm text-foreground">Vendor Partner ({list.length})</h3>
        <Button size="sm" onClick={() => setShowForm(!showForm)} data-testid="btn-add-partner">
          <Plus className="w-3.5 h-3.5 mr-1.5" /> Tambah Partner
        </Button>
      </div>

      {showForm && (
        <form onSubmit={create} className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3" data-testid="partner-form">
          <h4 className="text-sm font-semibold">Vendor Baru</h4>
          <div className="grid grid-cols-2 gap-3">
            {[['name','Nama Vendor *','text'],['code','Kode (opsional)','text'],
              ['contact_name','Nama Kontak','text'],['contact_phone','No. HP','tel']].map(([k,l,t]) => (
              <div key={k} className="space-y-1">
                <label className="text-[11px] text-muted-foreground uppercase font-semibold">{l}</label>
                <input type={t} value={form[k]} onChange={e=>setForm(p=>({...p,[k]:e.target.value}))}
                  data-testid={`partner-${k}`}
                  className="w-full px-3 py-2 rounded-lg bg-white/8 border border-white/15 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
              </div>
            ))}
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground uppercase font-semibold">Alamat</label>
            <input value={form.address} onChange={e=>setForm(p=>({...p,address:e.target.value}))}
              className="w-full px-3 py-2 rounded-lg bg-white/8 border border-white/15 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Simpan'}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={()=>setShowForm(false)}>Batal</Button>
          </div>
        </form>
      )}

      {loading
        ? <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin"/>Memuat...</div>
        : list.length === 0
          ? <p className="text-center py-8 text-sm text-muted-foreground">Belum ada vendor partner.</p>
          : (
            <div className="space-y-2" data-testid="partners-list">
              {list.map(p => (
                <div key={p.id} className="flex items-center gap-3 p-3 rounded-xl border border-white/10 bg-white/5">
                  <Building2 className="w-8 h-8 text-primary/60 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-foreground">{p.name}</span>
                      {p.code && <span className="text-[11px] text-primary/70 font-mono bg-primary/10 px-1.5 rounded">{p.code}</span>}
                    </div>
                    <p className="text-xs text-muted-foreground">{p.contact_name} · {p.contact_phone}</p>
                    <p className="text-xs text-muted-foreground/70">{p.job_count || 0} job · {p.account_count || 0} akun</p>
                  </div>
                </div>
              ))}
            </div>
          )
      }
    </div>
  );
}

// ── Accounts Tab ──────────────────────────────────────────────────────────────

function AccountsTab({ token, showToast }) {
  const [list,     setList]     = useState([]);
  const [partners, setPartners] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [form,     setForm]     = useState({ email:'', name:'', password:'', partner_id:'' });
  const [saving,   setSaving]   = useState(false);
  const [showForm, setShowForm] = useState(false);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [accRes, parRes] = await Promise.all([
        fetch('/api/vendor-portal/accounts', { headers }),
        fetch('/api/vendor-portal/partners',  { headers }),
      ]);
      if (accRes.ok) setList(await accRes.json());
      if (parRes.ok) setPartners(await parRes.json());
    } finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function create(e) {
    e.preventDefault();
    if (!form.email || !form.name || !form.password || !form.partner_id) {
      showToast('err', 'Semua field wajib diisi.'); return;
    }
    setSaving(true);
    try {
      const r = await fetch('/api/vendor-portal/accounts', { method:'POST', headers, body: JSON.stringify(form) });
      if (!r.ok) { const er = await r.json(); throw new Error(er.detail); }
      showToast('ok', `Akun vendor "${form.email}" berhasil dibuat.`);
      setForm({ email:'', name:'', password:'', partner_id:'' });
      setShowForm(false); load();
    } catch(e) { showToast('err', e.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm text-foreground">Akun Vendor ({list.length})</h3>
        <Button size="sm" onClick={() => setShowForm(!showForm)} data-testid="btn-add-account">
          <Plus className="w-3.5 h-3.5 mr-1.5" /> Tambah Akun
        </Button>
      </div>

      {showForm && (
        <form onSubmit={create} className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3" data-testid="account-form">
          <h4 className="text-sm font-semibold">Akun Vendor Baru</h4>
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground uppercase font-semibold">Partner Vendor *</label>
            <div className="relative">
              <select value={form.partner_id} onChange={e=>setForm(p=>({...p,partner_id:e.target.value}))}
                data-testid="account-partner-select"
                className="w-full px-3 py-2 rounded-lg bg-white/8 border border-white/15 text-sm text-foreground appearance-none focus:outline-none focus:ring-2 focus:ring-primary/50">
                <option value="">— Pilih Partner —</option>
                {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[['name','Nama Lengkap *'],['email','Email Login *'],['password','Password *']].slice(0,2).map(([k,l]) => (
              <div key={k} className="space-y-1">
                <label className="text-[11px] text-muted-foreground uppercase font-semibold">{l}</label>
                <input value={form[k]} onChange={e=>setForm(p=>({...p,[k]:e.target.value}))}
                  data-testid={`account-${k}`}
                  className="w-full px-3 py-2 rounded-lg bg-white/8 border border-white/15 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[['email','Email Login *'],['password','Password *']].slice(1).map(([k,l]) => (
              <div key={k} className="space-y-1">
                <label className="text-[11px] text-muted-foreground uppercase font-semibold">{l}</label>
                <input type={k==='password'?'password':'text'} value={form[k]} onChange={e=>setForm(p=>({...p,[k]:e.target.value}))}
                  data-testid={`account-${k}`}
                  className="w-full px-3 py-2 rounded-lg bg-white/8 border border-white/15 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Buat Akun'}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={()=>setShowForm(false)}>Batal</Button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex justify-center py-8 gap-2 text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin"/>Memuat...</div>
      ) : list.length === 0 ? (
        <p className="text-center py-8 text-sm text-muted-foreground">Belum ada akun vendor.</p>
      ) : (
        <div className="space-y-2" data-testid="accounts-list">
          {list.map(u => (
            <div key={u.id} className="flex items-center gap-3 p-3 rounded-xl border border-white/10 bg-white/5">
              <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center text-primary text-sm font-bold shrink-0">
                {u.name?.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-foreground">{u.name}</p>
                <p className="text-xs text-muted-foreground">{u.email} · {u.partner_name}</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full border ${
                u.is_active ? 'bg-green-500/10 text-green-400 border-green-400/20' : 'bg-red-500/10 text-red-400 border-red-400/20'
              }`}>{u.is_active ? 'Aktif' : 'Nonaktif'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Jobs Tab ──────────────────────────────────────────────────────────────────

function AllJobsTab({ token }) {
  const [jobs,    setJobs]    = useState([]);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try { const r = await fetch('/api/vendor-portal/jobs', { headers }); if (r.ok) setJobs(await r.json()); }
      finally { setLoading(false); }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm text-foreground">Semua Jobs ({jobs.length})</h3>
      </div>
      {loading
        ? <div className="flex justify-center py-8 gap-2 text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin"/>Memuat...</div>
        : jobs.length === 0
          ? <p className="text-center py-8 text-sm text-muted-foreground">Belum ada job.</p>
          : (
            <div className="space-y-2" data-testid="all-jobs-list">
              {jobs.map(j => {
                const pct = j.qty_target > 0 ? Math.round((j.qty_done || 0) / j.qty_target * 100) : 0;
                return (
                  <div key={j.id} className="p-3 rounded-xl border border-white/10 bg-white/5">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-primary">{j.job_number}</span>
                        <span className={`text-xs font-semibold ${JOB_STATUS_COLOR[j.status]}`}>
                          {j.status === 'open' ? 'Belum Mulai' : j.status === 'in_progress' ? 'Berjalan' : j.status === 'done' ? 'Selesai' : j.status}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground">{j.partner_name}</span>
                    </div>
                    <p className="text-sm text-foreground mb-2">{j.title}</p>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div className="h-full rounded-full bg-primary transition-all" style={{width:`${pct}%`}} />
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">{j.qty_done || 0}/{j.qty_target} pcs ({pct}%)</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )
      }
    </div>
  );
}

// ── Main Admin Module ─────────────────────────────────────────────────────────

export default function VendorAccountsAdminModule({ token }) {
  const [tab,   setTab]   = useState('partners');
  const [toast, setToast] = useState(null);

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  }

  return (
    <div className="space-y-5 p-4 max-w-3xl mx-auto" data-testid="vendor-admin-module">
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={()=>setToast(null)} />}

      {/* Header */}
      <div className="flex items-center gap-2">
        <Users className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-xl font-bold text-foreground">Kelola Vendor CMT</h1>
          <p className="text-sm text-muted-foreground">Daftarkan vendor, buat akun login, dan pantau semua job</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-white/5 border border-white/10">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              data-testid={`tab-${t.id}`}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-all
                ${tab === t.id ? 'bg-primary text-white shadow' : 'text-muted-foreground hover:text-foreground hover:bg-white/5'}`}>
              <Icon className="w-4 h-4" />
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {tab === 'partners' && <PartnersTab token={token} showToast={showToast} />}
      {tab === 'accounts' && <AccountsTab token={token} showToast={showToast} />}
      {tab === 'jobs'     && <AllJobsTab  token={token} />}
    </div>
  );
}
