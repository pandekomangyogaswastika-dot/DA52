/**
 * Creator Portal — Login + Main Shell
 * Route: /creator
 * Auth: Separate JWT with audience='creator-portal'
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { LogOut, User, Video, ShoppingBag, Target, RefreshCw, 
  Eye, TrendingUp, Package, ChevronRight, Check, X, Star, Award } from 'lucide-react';
import { toast } from 'sonner';

const API = process.env.REACT_APP_BACKEND_URL;
const CREATOR_TOKEN_KEY = 'creator_portal_token';
const CREATOR_USER_KEY = 'creator_portal_user';

const fmt = (n) => new Intl.NumberFormat('id-ID').format(n || 0);
const fmtRp = (n) => `Rp ${fmt(n)}`;

// ─── Storage helpers ──────────────────────────────────────────────────────────
const creatorSession = {
  save: (token, user) => {
    localStorage.setItem(CREATOR_TOKEN_KEY, token);
    localStorage.setItem(CREATOR_USER_KEY, JSON.stringify(user));
  },
  load: () => {
    const token = localStorage.getItem(CREATOR_TOKEN_KEY);
    const user = localStorage.getItem(CREATOR_USER_KEY);
    return { token, user: user ? JSON.parse(user) : null };
  },
  clear: () => {
    localStorage.removeItem(CREATOR_TOKEN_KEY);
    localStorage.removeItem(CREATOR_USER_KEY);
  },
};

// ─── Creator Login Form ───────────────────────────────────────────────────────
function CreatorLoginPage({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email || !password) { setError('Email dan password wajib diisi'); return; }
    setLoading(true);
    setError('');
    try {
      const r = await fetch(`${API}/api/marketing/creator-portal/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || 'Login gagal');
      creatorSession.save(d.token, { creator_id: d.creator_id, creator_name: d.creator_name, creator_code: d.creator_code });
      onLogin(d.token, { creator_id: d.creator_id, creator_name: d.creator_name, creator_code: d.creator_code });
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  return (
    <div
      data-testid="creator-login-page"
      className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-4"
      style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(139,92,246,0.15) 0%, #0a0a0f 70%)' }}
    >
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-600 to-pink-600 mb-4 shadow-xl">
            <Video size={26} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Creator Portal</h1>
          <p className="text-sm text-zinc-400 mt-1">Portal untuk KOL & Creator</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white/4 border border-white/8 rounded-2xl p-6 shadow-2xl"
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">Email</label>
              <input
                data-testid="creator-login-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-violet-500/50"
                placeholder="email@creator.com"
                autoComplete="username"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">Password</label>
              <input
                data-testid="creator-login-password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-violet-500/50"
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>
            {error && (
              <div data-testid="creator-login-error" className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                {error}
              </div>
            )}
            <button
              data-testid="creator-login-btn"
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-700 hover:to-pink-700 text-white font-semibold py-3 rounded-xl transition-all disabled:opacity-50 mt-2"
            >
              {loading ? 'Masuk...' : 'Masuk ke Creator Portal'}
            </button>
          </div>
        </form>

        <p className="text-center text-xs text-zinc-500 mt-5">
          Butuh akun? Hubungi admin marketing.
        </p>
      </div>
    </div>
  );
}

// ─── KPI Progress Card ────────────────────────────────────────────────────────
function KPICard({ label, actual, target, unit = '', color = 'violet' }) {
  const pct = target ? Math.min(100, Math.round((actual / target) * 100)) : 0;
  const barColor = pct >= 80 ? 'from-emerald-500 to-emerald-400' : pct >= 50 ? 'from-amber-500 to-amber-400' : 'from-red-500 to-red-400';
  return (
    <div className="bg-white/4 border border-white/8 rounded-2xl p-5">
      <div className="text-xs text-zinc-400 mb-1">{label}</div>
      <div className="text-2xl font-bold text-white mb-1">{unit}{fmt(actual)}</div>
      <div className="text-xs text-zinc-400 mb-3">Target: {unit}{fmt(target)}</div>
      <div className="h-1.5 rounded-full bg-white/10">
        <div className={`h-full rounded-full bg-gradient-to-r ${barColor} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <div className="text-xs text-right mt-1 font-medium" style={{ color: pct >= 80 ? '#34d399' : pct >= 50 ? '#fbbf24' : '#f87171' }}>
        {pct}%
      </div>
    </div>
  );
}

// ─── Creator Dashboard ────────────────────────────────────────────────────────
function CreatorDashboard({ token, creator }) {
  const [kpi, setKpi] = useState(null);
  const [performance, setPerformance] = useState(null);
  const [loading, setLoading] = useState(true);

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  useEffect(() => {
    async function load() {
      try {
        const [kpiRes, perfRes] = await Promise.all([
          fetch(`${API}/api/marketing/creator-portal/my-kpi`, { headers }).then(r => r.json()),
          fetch(`${API}/api/marketing/creator-portal/my-performance`, { headers }).then(r => r.json()),
        ]);
        setKpi(kpiRes);
        setPerformance(perfRes);
      } catch { toast.error('Gagal memuat data'); }
      finally { setLoading(false); }
    }
    load();
  }, [headers]);

  if (loading) return <div className="text-center py-12 text-zinc-400">Memuat data...</div>;

  const targets = kpi?.kpi_targets || {};
  const actuals = kpi?.actuals || {};
  const sessions = performance?.sessions || [];

  return (
    <div data-testid="creator-dashboard" className="space-y-6">
      {/* KPI Cards */}
      <div>
        <h2 className="text-sm font-semibold text-zinc-300 mb-3">KPI Bulan Ini — {kpi?.month}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KPICard label="Revenue" actual={actuals.monthly_revenue} target={targets.monthly_revenue} unit="Rp " />
          <KPICard label="Sesi Live" actual={actuals.monthly_sessions} target={targets.monthly_sessions} />
          <KPICard label="Total Penonton" actual={actuals.monthly_viewers} target={targets.monthly_viewers} />
        </div>
      </div>

      {/* Recent Sessions */}
      <div>
        <h2 className="text-sm font-semibold text-zinc-300 mb-3">Sesi Live Terbaru</h2>
        {sessions.length === 0 ? (
          <div className="text-center py-8 text-zinc-500 text-sm">Belum ada sesi live bulan ini.</div>
        ) : (
          <div className="space-y-2">
            {sessions.slice(0, 5).map(s => (
              <div key={s.id} data-testid="creator-session-row" className="flex items-center justify-between bg-white/4 border border-white/8 rounded-xl p-4">
                <div>
                  <div className="font-medium text-sm text-white">{s.session_name || s.date}</div>
                  <div className="text-xs text-zinc-400 mt-0.5">{s.date} · {s.duration_minutes}m · {fmt(s.viewers)} penonton</div>
                </div>
                <div className="text-right">
                  <div className="text-emerald-400 font-semibold text-sm">{fmtRp(s.revenue)}</div>
                  <div className="text-xs text-zinc-400">{fmt(s.orders)} orders</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Creator Catalog & Requests ───────────────────────────────────────────────
function CreatorCatalogPage({ token }) {
  const [catalog, setCatalog] = useState([]);
  const [myRequests, setMyRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [requestingItem, setRequestingItem] = useState(null);
  const [reqForm, setReqForm] = useState({ quantity_requested: 1, purpose: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const load = useCallback(async () => {
    try {
      const [catRes, reqRes] = await Promise.all([
        fetch(`${API}/api/marketing/creator-portal/catalog`, { headers }).then(r => r.json()),
        fetch(`${API}/api/marketing/creator-portal/my-requests`, { headers }).then(r => r.json()),
      ]);
      setCatalog(Array.isArray(catRes) ? catRes : []);
      setMyRequests(Array.isArray(reqRes) ? reqRes : []);
    } catch { toast.error('Gagal memuat katalog'); }
    finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  async function submitRequest() {
    if (!requestingItem) return;
    setSaving(true);
    try {
      const r = await fetch(`${API}/api/marketing/creator-portal/requests`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: requestingItem.account_id,
          catalog_item_id: requestingItem.id,
          quantity_requested: Number(reqForm.quantity_requested),
          purpose: reqForm.purpose,
          notes: reqForm.notes,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || 'Gagal mengirim request');
      toast.success('Request berhasil dikirim ke admin');
      setRequestingItem(null);
      setReqForm({ quantity_requested: 1, purpose: '', notes: '' });
      load();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  }

  const STATUS_COLOR = { pending: 'text-amber-400', approved: 'text-emerald-400', rejected: 'text-red-400' };

  if (loading) return <div className="text-center py-12 text-zinc-400">Memuat katalog...</div>;

  return (
    <div data-testid="creator-catalog" className="space-y-6">
      {/* Catalog Grid */}
      <div>
        <h2 className="text-sm font-semibold text-zinc-300 mb-3">Katalog Produk ({catalog.length})</h2>
        {catalog.length === 0 ? (
          <div className="text-center py-10 text-zinc-500 text-sm">
            <Package className="mx-auto mb-2 opacity-30" size={32} />
            Belum ada produk di katalog.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {catalog.map(item => (
              <div key={item.id} data-testid="catalog-product-card" className="bg-white/4 border border-white/8 rounded-2xl p-4 hover:border-violet-500/30 transition-all">
                <div className="mb-3">
                  <div className="font-semibold text-white">{item.product_name}</div>
                  <div className="text-xs text-zinc-400 mt-0.5">SKU: {item.sku}</div>
                  {item.category && (
                    <span className="inline-block mt-2 text-xs bg-white/5 border border-white/10 rounded px-2 py-0.5 text-zinc-400">{item.category}</span>
                  )}
                </div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-emerald-400 font-semibold text-sm">{fmtRp(item.unit_price)}</span>
                  <span className={`text-xs font-medium ${item.stock_qty > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    Stok: {fmt(item.stock_qty)} pcs
                  </span>
                </div>
                <button
                  data-testid="request-item-btn"
                  onClick={() => setRequestingItem(item)}
                  disabled={item.stock_qty === 0}
                  className="w-full py-2 rounded-xl bg-violet-600/80 hover:bg-violet-600 text-white text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {item.stock_qty === 0 ? 'Stok Habis' : 'Request Produk'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* My Requests */}
      <div>
        <h2 className="text-sm font-semibold text-zinc-300 mb-3">Request Saya ({myRequests.length})</h2>
        {myRequests.length === 0 ? (
          <div className="text-center py-8 text-zinc-500 text-sm">Belum ada request.</div>
        ) : (
          <div className="space-y-2">
            {myRequests.map(req => (
              <div key={req.id} data-testid="my-request-row" className="flex items-center justify-between bg-white/4 border border-white/8 rounded-xl p-4">
                <div>
                  <div className="font-medium text-sm text-white">{req.product_name} <span className="text-zinc-400 text-xs">({req.sku})</span></div>
                  <div className="text-xs text-zinc-400 mt-0.5">
                    {req.quantity_requested} pcs · {req.purpose || '-'}
                  </div>
                </div>
                <div className="text-right">
                  <span className={`font-medium text-sm capitalize ${STATUS_COLOR[req.status]}`}>{req.status}</span>
                  {req.rejection_reason && (
                    <div className="text-xs text-red-400 mt-0.5">{req.rejection_reason}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Request Modal */}
      {requestingItem && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-[#111118] border border-white/10 rounded-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-white">Request Produk</h3>
              <button onClick={() => setRequestingItem(null)} className="text-zinc-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="bg-white/4 rounded-xl p-3 mb-4">
              <div className="font-medium text-white text-sm">{requestingItem.product_name}</div>
              <div className="text-xs text-zinc-400 mt-1">SKU: {requestingItem.sku} · Stok: {fmt(requestingItem.stock_qty)} pcs</div>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">Jumlah yang Diminta *</label>
                <input
                  data-testid="req-quantity-input"
                  type="number"
                  min="1"
                  max={requestingItem.stock_qty}
                  value={reqForm.quantity_requested}
                  onChange={e => setReqForm(f => ({ ...f, quantity_requested: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">Tujuan Promo</label>
                <input
                  data-testid="req-purpose-input"
                  value={reqForm.purpose}
                  onChange={e => setReqForm(f => ({ ...f, purpose: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white"
                  placeholder="Flash sale, review, giveaway..."
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">Catatan Tambahan</label>
                <textarea
                  value={reqForm.notes}
                  onChange={e => setReqForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white resize-none"
                  rows={2}
                  placeholder="Catatan untuk admin..."
                />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setRequestingItem(null)} className="flex-1 py-3 rounded-xl border border-white/10 text-sm hover:bg-white/5">Batal</button>
              <button
                data-testid="submit-request-btn"
                onClick={submitRequest}
                disabled={saving}
                className="flex-1 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-50"
              >
                {saving ? 'Mengirim...' : 'Kirim Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Creator Performance Page ─────────────────────────────────────────────────
function CreatorPerformancePage({ token }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const r = await fetch(`${API}/api/marketing/creator-portal/my-performance?month=${month}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const d = await r.json();
        setData(d);
      } catch { toast.error('Gagal memuat performa'); }
      finally { setLoading(false); }
    }
    load();
  }, [token, month]);

  if (loading) return <div className="text-center py-12 text-zinc-400">Memuat performa...</div>;

  const sessions = data?.sessions || [];
  const summary = data?.summary || {};
  const kpi = data?.kpi_targets || {};
  const progress = data?.kpi_progress || {};

  return (
    <div data-testid="creator-performance" className="space-y-6">
      <div className="flex items-center gap-3">
        <label className="text-xs text-zinc-400">Bulan:</label>
        <input
          type="month"
          value={month}
          onChange={e => setMonth(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
        />
      </div>

      {/* Summary Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Sesi', value: fmt(summary.total_sessions), icon: Video },
          { label: 'Total Revenue', value: fmtRp(summary.total_revenue), icon: TrendingUp },
          { label: 'Total Penonton', value: fmt(summary.total_viewers), icon: Eye },
          { label: 'Total Orders', value: fmt(summary.total_orders), icon: ShoppingBag },
        ].map(card => (
          <div key={card.label} className="bg-white/4 border border-white/8 rounded-2xl p-4 text-center">
            <card.icon size={18} className="mx-auto mb-2 text-violet-400" />
            <div className="text-lg font-bold text-white">{card.value}</div>
            <div className="text-xs text-zinc-400">{card.label}</div>
          </div>
        ))}
      </div>

      {/* KPI Progress */}
      <div className="bg-white/4 border border-white/8 rounded-2xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-zinc-300">Progress KPI Bulan Ini</h3>
        {kpi.monthly_revenue > 0 && (
          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-zinc-400">Revenue</span>
              <span className="text-white">{fmtRp(summary.total_revenue)} / {fmtRp(kpi.monthly_revenue)} ({progress.revenue_pct || 0}%)</span>
            </div>
            <div className="h-2 rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-pink-500 transition-all" style={{ width: `${Math.min(100, progress.revenue_pct || 0)}%` }} />
            </div>
          </div>
        )}
        {kpi.monthly_sessions > 0 && (
          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-zinc-400">Sesi Live</span>
              <span className="text-white">{summary.total_sessions} / {kpi.monthly_sessions} ({progress.sessions_pct || 0}%)</span>
            </div>
            <div className="h-2 rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-500 transition-all" style={{ width: `${Math.min(100, progress.sessions_pct || 0)}%` }} />
            </div>
          </div>
        )}
        {kpi.monthly_viewers > 0 && (
          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-zinc-400">Penonton</span>
              <span className="text-white">{fmt(summary.total_viewers)} / {fmt(kpi.monthly_viewers)} ({progress.viewers_pct || 0}%)</span>
            </div>
            <div className="h-2 rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all" style={{ width: `${Math.min(100, progress.viewers_pct || 0)}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Sessions List */}
      <div>
        <h3 className="text-sm font-semibold text-zinc-300 mb-3">Riwayat Sesi ({sessions.length})</h3>
        {sessions.length === 0 ? (
          <div className="text-center py-8 text-zinc-500 text-sm">Belum ada sesi bulan ini.</div>
        ) : (
          <div className="space-y-2">
            {sessions.map(s => (
              <div key={s.id} className="flex items-center justify-between bg-white/4 border border-white/8 rounded-xl p-4">
                <div>
                  <div className="font-medium text-sm text-white">{s.session_name}</div>
                  <div className="text-xs text-zinc-400 mt-0.5">
                    {s.date} · {s.platform} · {s.duration_minutes}m · {fmt(s.viewers)} penonton
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-emerald-400 font-semibold text-sm">{fmtRp(s.revenue)}</div>
                  <div className="text-xs text-zinc-400">{fmt(s.orders)} orders</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN CREATOR PORTAL APP
// ══════════════════════════════════════════════════════════════════════════════
export default function CreatorPortalApp() {
  const [token, setToken] = useState(null);
  const [creator, setCreator] = useState(null);
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [catalogBadge, setCatalogBadge] = useState(0);

  useEffect(() => {
    const { token: t, user: u } = creatorSession.load();
    if (t && u) {
      setToken(t);
      setCreator(u);
    }
  }, []);

  // Check for newly reviewed requests (approved/rejected since last visit)
  useEffect(() => {
    if (!token) return;
    const lastSeen = localStorage.getItem('creator_requests_last_seen') || '2000-01-01T00:00:00Z';
    async function checkBadge() {
      try {
        const r = await fetch(`${API}/api/marketing/creator-portal/my-requests`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) return;
        const reqs = await r.json();
        const newlyReviewed = Array.isArray(reqs)
          ? reqs.filter(req => req.status !== 'pending' && req.reviewed_at > lastSeen).length
          : 0;
        setCatalogBadge(newlyReviewed);
      } catch { /* silent */ }
    }
    checkBadge();
  }, [token]);

  // Clear badge when visiting catalog tab
  function handleNavClick(pageId) {
    setCurrentPage(pageId);
    if (pageId === 'catalog') {
      setCatalogBadge(0);
      localStorage.setItem('creator_requests_last_seen', new Date().toISOString());
    }
  }

  function handleLogin(t, u) {
    setToken(t);
    setCreator(u);
    setCurrentPage('dashboard');
  }

  function handleLogout() {
    creatorSession.clear();
    setToken(null);
    setCreator(null);
  }

  if (!token || !creator) {
    return <CreatorLoginPage onLogin={handleLogin} />;
  }

  const NAV = [
    { id: 'dashboard', label: 'Dashboard', icon: Target },
    { id: 'catalog', label: 'Katalog & Request', icon: ShoppingBag },
    { id: 'performance', label: 'Performa Saya', icon: TrendingUp },
  ];

  return (
    <div
      data-testid="creator-portal-shell"
      className="min-h-screen"
      style={{ background: '#0a0a0f', color: '#e4e4e7' }}
    >
      {/* Top Nav */}
      <header className="border-b border-white/8 bg-black/30 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600 to-pink-600 flex items-center justify-center">
              <Video size={16} className="text-white" />
            </div>
            <div>
              <div className="font-semibold text-sm text-white">{creator.creator_name}</div>
              <div className="text-xs text-zinc-400">{creator.creator_code}</div>
            </div>
          </div>
          <button
            data-testid="creator-logout-btn"
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors"
          >
            <LogOut size={14} /> Keluar
          </button>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Tab Nav */}
        <div className="flex gap-1 p-1 bg-white/4 rounded-xl w-fit mb-6">
          {NAV.map(n => (
            <button
              key={n.id}
              data-testid={`creator-nav-${n.id}`}
              onClick={() => handleNavClick(n.id)}
              className={`relative flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                currentPage === n.id
                  ? 'bg-violet-600 text-white shadow-lg shadow-violet-500/20'
                  : 'text-zinc-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <n.icon size={15} />
              {n.label}
              {n.id === 'catalog' && catalogBadge > 0 && (
                <span data-testid="creator-catalog-badge" className="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center px-1">
                  {catalogBadge > 9 ? '9+' : catalogBadge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Page Content */}
        {currentPage === 'dashboard' && <CreatorDashboard token={token} creator={creator} />}
        {currentPage === 'catalog' && <CreatorCatalogPage token={token} />}
        {currentPage === 'performance' && <CreatorPerformancePage token={token} />}
      </div>
    </div>
  );
}
