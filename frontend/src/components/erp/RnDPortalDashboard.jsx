import { useState, useEffect } from 'react';
import { GlassCard, GlassPanel } from '@/components/ui/glass';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Palette, FlaskConical, Layers, Ruler, Calculator, Activity,
  TrendingUp, ClipboardCheck, AlertTriangle, CheckCircle2, Clock,
  ArrowRight, RefreshCw, Sparkles, PlusCircle
} from 'lucide-react';
import { toast } from '../ui/sonner';

const API = process.env.REACT_APP_BACKEND_URL || '';

const STATUS_BADGE = {
  submitted: { label: 'Menunggu', cls: 'bg-amber-500/20 text-amber-600 border-amber-500/30' },
  approved:  { label: 'Disetujui', cls: 'bg-emerald-500/20 text-emerald-600 border-emerald-500/30' },
  rejected:  { label: 'Ditolak', cls: 'bg-red-500/20 text-red-600 border-red-500/30' },
  draft:     { label: 'Draft', cls: 'bg-zinc-500/20 text-zinc-500 border-zinc-500/30' },
  active:    { label: 'Aktif', cls: 'bg-emerald-500/20 text-emerald-600 border-emerald-500/30' },
};

function KPICard({ icon: Icon, label, value, sub, color = 'primary', badge }) {
  const colors = {
    primary: 'from-violet-500/10 to-purple-500/10 border-violet-500/20',
    success: 'from-emerald-500/10 to-green-500/10 border-emerald-500/20',
    warning: 'from-amber-500/10 to-orange-500/10 border-amber-500/20',
    danger:  'from-red-500/10 to-rose-500/10 border-red-500/20',
    info:    'from-sky-500/10 to-blue-500/10 border-sky-500/20',
  };
  const iconColors = {
    primary: 'text-violet-500',
    success: 'text-emerald-500',
    warning: 'text-amber-500',
    danger:  'text-red-500',
    info:    'text-sky-500',
  };
  return (
    <GlassCard className={`p-5 border bg-gradient-to-br ${colors[color]}`}>
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center border ${colors[color].split(' ')[2]}`}>
          <Icon className={`w-5 h-5 ${iconColors[color]}`} />
        </div>
        {badge && (
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${STATUS_BADGE[badge]?.cls || ''}`}>
            {STATUS_BADGE[badge]?.label || badge}
          </span>
        )}
      </div>
      <div className="text-2xl font-bold text-foreground mb-0.5">{value ?? '—'}</div>
      <div className="text-sm text-foreground/60">{label}</div>
      {sub && <div className="text-xs text-foreground/40 mt-1">{sub}</div>}
    </GlassCard>
  );
}

function RecentRow({ title, subtitle, status, date }) {
  const s = STATUS_BADGE[status] || { label: status, cls: 'bg-zinc-500/20 text-zinc-500 border-zinc-500/30' };
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-white/5 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground truncate">{title}</div>
        <div className="text-xs text-foreground/50 truncate">{subtitle}</div>
      </div>
      <div className="flex items-center gap-2 ml-3 flex-shrink-0">
        <span className={`text-xs px-2 py-0.5 rounded-full border ${s.cls}`}>{s.label}</span>
        {date && <span className="text-xs text-foreground/30">{new Date(date).toLocaleDateString('id-ID', { day:'2-digit', month:'short' })}</span>}
      </div>
    </div>
  );
}

export default function RnDPortalDashboard({ token, onNavigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const h = { Authorization: `Bearer ${token}` };

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/dewi/rnd/dashboard`, { headers: h });
      if (!res.ok) throw new Error('Gagal memuat dashboard');
      setData(await res.json());
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const seedDemo = async () => {
    try {
      await fetch(`${API}/api/dewi/rnd/seed`, { method: 'POST', headers: h });
      toast.success('Data demo berhasil dimuat');
      load();
    } catch { toast.error('Gagal seed demo'); }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const kpi = data?.kpi || {};

  return (
    <div className="p-6 space-y-6" data-testid="rnd-dashboard">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FlaskConical className="w-7 h-7 text-violet-500" />
            Dashboard RnD
          </h1>
          <p className="text-sm text-foreground/50 mt-1">Ringkasan aktivitas Research & Development produk</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}
            className="gap-2 text-xs">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={seedDemo} className="gap-2 text-xs">
            <Sparkles className="w-3.5 h-3.5" /> Load Demo
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-500" />
        </div>
      ) : (
        <>
          {/* KPI Cards Row 1 — Style Master */}
          <div>
            <h2 className="text-xs font-semibold text-foreground/40 uppercase tracking-wider mb-3">Style Master</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <KPICard icon={Palette}       label="Total Style"     value={kpi.total_styles}   color="primary" />
              <KPICard icon={CheckCircle2}  label="Style Aktif"     value={kpi.active_styles}  color="success" />
              <KPICard icon={Clock}         label="Style Draft"     value={kpi.draft_styles}   color="warning" />
              <KPICard icon={Layers}        label="Total Varian"    value={kpi.total_variants} color="info"    />
            </div>
          </div>

          {/* KPI Cards Row 2 — Sampling */}
          <div>
            <h2 className="text-xs font-semibold text-foreground/40 uppercase tracking-wider mb-3">Proses Sampling</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <KPICard icon={FlaskConical}  label="Total Sample"    value={kpi.total_samples}    color="primary" />
              <KPICard icon={AlertTriangle} label="Menunggu Approve" value={kpi.pending_samples}  color="warning" />
              <KPICard icon={CheckCircle2}  label="Disetujui"        value={kpi.approved_samples} color="success" />
              <KPICard icon={Activity}      label="Total Revisi"     value={kpi.total_revisions}  color="info"    />
            </div>
          </div>

          {/* KPI Cards Row 3 — Costing & Material */}
          <div>
            <h2 className="text-xs font-semibold text-foreground/40 uppercase tracking-wider mb-3">Costing & Material</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <KPICard icon={Calculator}    label="HPP Tersimpan"   value={kpi.total_hpp}       color="primary" />
              <KPICard icon={Ruler}         label="Pola Terdaftar"  value={kpi.total_patterns}  color="info"    />
              <KPICard icon={ClipboardCheck}label="Riset Material"  value={kpi.total_materials} color="success" />
              <KPICard icon={TrendingUp}    label="Style Review"    value={kpi.review_styles}   color="warning" />
            </div>
          </div>

          {/* Recent Activity */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Recent Styles */}
            <GlassCard className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Palette className="w-4 h-4 text-violet-500" />
                  Style Terbaru
                </h3>
                {onNavigate && (
                  <Button variant="ghost" size="sm" className="text-xs gap-1 text-foreground/50 hover:text-foreground h-7"
                    onClick={() => onNavigate('rnd-styles')}>
                    Lihat semua <ArrowRight className="w-3 h-3" />
                  </Button>
                )}
              </div>
              {(data?.recent_styles || []).length === 0 ? (
                <div className="text-sm text-foreground/40 text-center py-4">
                  Belum ada data style. <button onClick={seedDemo} className="text-violet-500 hover:underline">Muat demo →</button>
                </div>
              ) : (
                (data?.recent_styles || []).map(s => (
                  <RecentRow key={s.id}
                    title={`${s.style_code} — ${s.style_name}`}
                    subtitle={`${s.category || '—'} · ${s.buyer || '—'} · ${s.season || '—'}`}
                    status={s.status}
                    date={s.created_at}
                  />
                ))
              )}
            </GlassCard>

            {/* Recent Samples */}
            <GlassCard className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <FlaskConical className="w-4 h-4 text-violet-500" />
                  Sample Request Terbaru
                </h3>
                {onNavigate && (
                  <Button variant="ghost" size="sm" className="text-xs gap-1 text-foreground/50 hover:text-foreground h-7"
                    onClick={() => onNavigate('rnd-samples')}>
                    Lihat semua <ArrowRight className="w-3 h-3" />
                  </Button>
                )}
              </div>
              {(data?.recent_samples || []).length === 0 ? (
                <div className="text-sm text-foreground/40 text-center py-4">
                  Belum ada sample request.
                </div>
              ) : (
                (data?.recent_samples || []).map(s => (
                  <RecentRow key={s.id}
                    title={`${s.sample_code || 'Sample'} — ${s.style_name || '—'}`}
                    subtitle={`Prioritas: ${s.priority || 'normal'} · ${s.requested_by_name || '—'}`}
                    status={s.status}
                    date={s.created_at}
                  />
                ))
              )}
            </GlassCard>

            {/* Recent HPP */}
            <GlassCard className="p-5 lg:col-span-2">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Calculator className="w-4 h-4 text-violet-500" />
                  HPP Calculator Terbaru
                </h3>
                {onNavigate && (
                  <Button variant="ghost" size="sm" className="text-xs gap-1 text-foreground/50 hover:text-foreground h-7"
                    onClick={() => onNavigate('rnd-hpp')}>
                    Lihat semua <ArrowRight className="w-3 h-3" />
                  </Button>
                )}
              </div>
              {(data?.recent_hpp || []).length === 0 ? (
                <div className="text-sm text-foreground/40 text-center py-4">
                  Belum ada kalkulasi HPP. <button onClick={() => onNavigate && onNavigate('rnd-hpp')} className="text-violet-500 hover:underline">Buat HPP →</button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-foreground/50 text-xs">
                        <th className="text-left py-2 pr-4 font-medium">Kode HPP</th>
                        <th className="text-left py-2 pr-4 font-medium">Style</th>
                        <th className="text-right py-2 pr-4 font-medium">HPP/pcs</th>
                        <th className="text-right py-2 pr-4 font-medium">Harga Jual Proposal</th>
                        <th className="text-right py-2 font-medium">Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.recent_hpp || []).map(h => (
                        <tr key={h.id} className="border-b border-white/5 last:border-0 hover:bg-white/3">
                          <td className="py-2 pr-4 font-mono text-xs text-foreground/70">{h.hpp_code}</td>
                          <td className="py-2 pr-4 text-foreground">{h.style_code || h.style_name || '—'}</td>
                          <td className="py-2 pr-4 text-right text-foreground">
                            {h.hpp_total ? `Rp ${h.hpp_total.toLocaleString('id-ID')}` : '—'}
                          </td>
                          <td className="py-2 pr-4 text-right font-semibold text-emerald-500">
                            {h.selling_price_proposal ? `Rp ${h.selling_price_proposal.toLocaleString('id-ID')}` : '—'}
                          </td>
                          <td className="py-2 text-right">
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 border border-emerald-500/25">
                              {h.margin_pct}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </GlassCard>
          </div>
        </>
      )}
    </div>
  );
}
