import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Shield, ShieldCheck, ShieldAlert, ShieldX, Search, RefreshCw,
  Award, Calendar, TrendingUp, TrendingDown, BarChart3, Target,
  Calculator, Package, AlertCircle, CheckCircle2, XCircle,
  Sparkles, ChevronRight, Activity, Users, Building2,
} from 'lucide-react';
import { GlassCard, GlassPanel, GlassInput } from '@/components/ui/glass';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

const GRADE_STYLE = {
  'A+': { bg: 'bg-emerald-500/15', border: 'border-emerald-400/40', text: 'text-emerald-300', icon: ShieldCheck, label: 'Excellent' },
  'A':  { bg: 'bg-emerald-500/10', border: 'border-emerald-400/30', text: 'text-emerald-300', icon: ShieldCheck, label: 'Very Good' },
  'B':  { bg: 'bg-blue-500/10',    border: 'border-blue-400/30',    text: 'text-blue-300',    icon: Shield,      label: 'Good' },
  'C':  { bg: 'bg-amber-500/10',   border: 'border-amber-400/30',   text: 'text-amber-300',   icon: ShieldAlert, label: 'Below Target' },
  'D':  { bg: 'bg-rose-500/10',    border: 'border-rose-400/30',    text: 'text-rose-300',    icon: ShieldX,     label: 'Critical' },
};

const SEVERITY_BADGE = {
  critical: 'text-rose-300 border-rose-300/40 bg-rose-500/10',
  major:    'text-amber-300 border-amber-300/40 bg-amber-500/10',
  minor:    'text-blue-300 border-blue-300/40 bg-blue-500/10',
};

export default function SupplierScorecardModule({ token }) {
  const { toast } = useToast();
  const [scorecards, setScorecards] = useState([]);
  const [periodDays, setPeriodDays] = useState(90);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('scorecard');
  const [detailSupplier, setDetailSupplier] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // AQL Tool state
  const [aqlLot, setAqlLot] = useState(500);
  const [aqlValue, setAqlValue] = useState(2.5);
  const [aqlResult, setAqlResult] = useState(null);
  const [aqlLoading, setAqlLoading] = useState(false);

  const h = useMemo(() => ({
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }), [token]);

  const fetchScorecards = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/rahaza/grn-qc/supplier-scorecard?period_days=${periodDays}`, { headers: h });
      if (res.ok) setScorecards(await res.json());
    } catch (e) {
      toast({ title: 'Gagal memuat scorecard', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [h, periodDays, toast]);

  useEffect(() => { fetchScorecards(); }, [fetchScorecards]);

  const openDetail = async (supplier) => {
    setDetailSupplier(supplier);
    setDetailLoading(true);
    setDetailData(null);
    try {
      const res = await fetch(
        `/api/rahaza/grn-qc/supplier-scorecard/${encodeURIComponent(supplier.supplier_name)}?period_days=180`,
        { headers: h }
      );
      if (res.ok) setDetailData(await res.json());
    } catch (e) {
      toast({ title: e.message, variant: 'destructive' });
    } finally {
      setDetailLoading(false);
    }
  };

  const handleAqlCalc = async () => {
    setAqlLoading(true);
    try {
      const res = await fetch('/api/rahaza/grn-qc/aql/calculate', {
        method: 'POST', headers: h,
        body: JSON.stringify({ lot_size: parseInt(aqlLot, 10), aql: parseFloat(aqlValue) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'AQL failed');
      setAqlResult(data);
    } catch (e) {
      toast({ title: e.message, variant: 'destructive' });
    } finally {
      setAqlLoading(false);
    }
  };

  const handleSeedDemo = async () => {
    try {
      const res = await fetch('/api/rahaza/grn-qc/seed-demo', { method: 'POST', headers: h });
      const data = await res.json();
      if (data.status === 'seeded') {
        toast({ title: `✅ Demo data seeded: ${data.inspections_inserted} inspections` });
      } else {
        toast({ title: 'Demo data sudah ada' });
      }
      fetchScorecards();
    } catch (e) {
      toast({ title: e.message, variant: 'destructive' });
    }
  };

  const filteredScorecards = useMemo(() => {
    if (!search) return scorecards;
    const q = search.toLowerCase();
    return scorecards.filter(s => s.supplier_name.toLowerCase().includes(q));
  }, [scorecards, search]);

  // KPIs
  const kpi = useMemo(() => {
    const total = scorecards.length;
    const aGrade = scorecards.filter(s => s.quality_grade === 'A+' || s.quality_grade === 'A').length;
    const cdGrade = scorecards.filter(s => s.quality_grade === 'C' || s.quality_grade === 'D').length;
    const totalGRNs = scorecards.reduce((a, s) => a + (s.total_grns || 0), 0);
    const totalRejected = scorecards.reduce((a, s) => a + (s.total_rejected_qty || 0), 0);
    const totalReceived = scorecards.reduce((a, s) => a + (s.total_received_qty || 0), 0);
    const avgDefect = totalReceived > 0 ? (totalRejected / totalReceived * 100) : 0;
    return { total, aGrade, cdGrade, totalGRNs, avgDefect };
  }, [scorecards]);

  return (
    <div className="space-y-5" data-testid="supplier-scorecard-page">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Award className="w-6 h-6 text-amber-400" />
            Supplier Quality Scorecard
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Performa supplier berdasarkan hasil inspeksi GRN (Goods Receiving Note).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(periodDays)} onValueChange={v => setPeriodDays(parseInt(v, 10))}>
            <SelectTrigger className="w-36 h-8 text-xs" data-testid="period-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30">30 hari terakhir</SelectItem>
              <SelectItem value="90">90 hari terakhir</SelectItem>
              <SelectItem value="180">180 hari terakhir</SelectItem>
              <SelectItem value="365">1 tahun terakhir</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="ghost" onClick={fetchScorecards} className="gap-1.5 text-xs">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          {scorecards.length === 0 && (
            <Button variant="outline" onClick={handleSeedDemo} className="gap-1.5 text-xs" data-testid="qc-seed-demo-btn">
              <Sparkles className="w-3.5 h-3.5" /> Seed Demo
            </Button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <GlassPanel className="p-3 text-center">
          <div className="text-[10px] text-muted-foreground uppercase mb-1">Total Supplier</div>
          <div className="text-2xl font-bold text-foreground">{kpi.total}</div>
        </GlassPanel>
        <GlassPanel className="p-3 text-center">
          <div className="text-[10px] text-muted-foreground uppercase mb-1 flex items-center justify-center gap-0.5">
            <ShieldCheck className="w-3 h-3 text-emerald-400" /> Grade A
          </div>
          <div className="text-2xl font-bold text-emerald-400">{kpi.aGrade}</div>
        </GlassPanel>
        <GlassPanel className="p-3 text-center">
          <div className="text-[10px] text-muted-foreground uppercase mb-1 flex items-center justify-center gap-0.5">
            <ShieldX className="w-3 h-3 text-rose-400" /> Grade C/D
          </div>
          <div className="text-2xl font-bold text-rose-400">{kpi.cdGrade}</div>
        </GlassPanel>
        <GlassPanel className="p-3 text-center">
          <div className="text-[10px] text-muted-foreground uppercase mb-1">Total GRN</div>
          <div className="text-2xl font-bold text-primary">{kpi.totalGRNs}</div>
        </GlassPanel>
        <GlassPanel className="p-3 text-center">
          <div className="text-[10px] text-muted-foreground uppercase mb-1">Avg Defect Rate</div>
          <div className={`text-2xl font-bold ${kpi.avgDefect > 5 ? 'text-rose-400' : kpi.avgDefect > 2 ? 'text-amber-400' : 'text-emerald-400'}`}>
            {kpi.avgDefect.toFixed(2)}%
          </div>
        </GlassPanel>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="scorecard" data-testid="tab-scorecard">
            <Award className="w-3.5 h-3.5 mr-1.5" /> Scorecard
          </TabsTrigger>
          <TabsTrigger value="aql" data-testid="tab-aql">
            <Calculator className="w-3.5 h-3.5 mr-1.5" /> AQL Sampling Tool
          </TabsTrigger>
        </TabsList>

        {/* ── SCORECARD TAB ── */}
        <TabsContent value="scorecard">
          <GlassCard className="p-0 overflow-hidden">
            <div className="flex items-center gap-3 p-3 border-b border-[var(--glass-border)]">
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <GlassInput
                  placeholder="Cari supplier…"
                  className="pl-8 h-8 text-sm"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </div>
            {loading ? (
              <div className="flex items-center justify-center h-48">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : filteredScorecards.length === 0 ? (
              <div className="text-center py-16">
                <Users className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground mb-1">
                  {scorecards.length === 0 ? 'Belum ada data inspeksi.' : 'Tidak ada supplier yang cocok.'}
                </p>
                {scorecards.length === 0 && (
                  <p className="text-xs text-muted-foreground/60">
                    Klik <strong>Seed Demo</strong> untuk data contoh, atau lakukan inspeksi GRN dari modul Penerimaan.
                  </p>
                )}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] text-muted-foreground border-b border-[var(--glass-border)] bg-[var(--glass-bg)]">
                    <th className="px-4 py-2.5 text-left font-medium">Supplier</th>
                    <th className="px-4 py-2.5 text-center font-medium">Grade</th>
                    <th className="px-4 py-2.5 text-right font-medium">Accept Rate</th>
                    <th className="px-4 py-2.5 text-right font-medium">Defect Rate</th>
                    <th className="px-4 py-2.5 text-right font-medium">GRN</th>
                    <th className="px-4 py-2.5 text-right font-medium">Diterima</th>
                    <th className="px-4 py-2.5 text-right font-medium">Ditolak</th>
                    <th className="px-4 py-2.5 text-center font-medium">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredScorecards.map(s => {
                    const grade = GRADE_STYLE[s.quality_grade] || GRADE_STYLE.B;
                    const GradeIcon = grade.icon;
                    return (
                      <tr key={s.supplier_name} className="border-t border-[var(--glass-border)] hover:bg-[var(--glass-bg)]" data-testid={`scorecard-row-${s.supplier_name}`}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Building2 className="w-4 h-4 text-muted-foreground" />
                            <div className="font-medium text-foreground">{s.supplier_name}</div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge variant="outline" className={`text-xs font-bold ${grade.bg} ${grade.border} ${grade.text} gap-1`}>
                            <GradeIcon className="w-3 h-3" />
                            {s.quality_grade}
                          </Badge>
                          <div className="text-[9px] text-muted-foreground mt-0.5">{grade.label}</div>
                        </td>
                        <td className={`px-4 py-3 text-right font-bold ${s.accept_rate >= 95 ? 'text-emerald-400' : s.accept_rate >= 85 ? 'text-amber-400' : 'text-rose-400'}`}>
                          {s.accept_rate.toFixed(2)}%
                        </td>
                        <td className={`px-4 py-3 text-right font-medium ${s.defect_rate <= 2 ? 'text-emerald-400' : s.defect_rate <= 5 ? 'text-amber-400' : 'text-rose-400'}`}>
                          {s.defect_rate.toFixed(2)}%
                        </td>
                        <td className="px-4 py-3 text-right text-foreground font-mono">{s.total_grns}</td>
                        <td className="px-4 py-3 text-right text-emerald-300 font-mono">{s.total_accepted_qty.toLocaleString('id-ID')}</td>
                        <td className="px-4 py-3 text-right text-rose-300 font-mono">{s.total_rejected_qty.toLocaleString('id-ID')}</td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => openDetail(s)}
                            className="inline-flex items-center gap-0.5 text-xs text-primary hover:brightness-110"
                            data-testid={`scorecard-detail-${s.supplier_name}`}
                          >
                            Detail <ChevronRight className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </GlassCard>
        </TabsContent>

        {/* ── AQL TAB ── */}
        <TabsContent value="aql">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Input */}
            <GlassCard className="p-5 lg:col-span-1">
              <h3 className="text-base font-semibold text-foreground mb-1 flex items-center gap-2">
                <Calculator className="w-4 h-4 text-primary" />
                AQL Sampling Calculator
              </h3>
              <p className="text-xs text-muted-foreground mb-4">
                Hitung ukuran sample dan batas accept/reject berdasarkan{' '}
                <strong>ANSI/ASQ Z1.4 General Inspection Level II</strong>.
              </p>

              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Lot Size (Total Qty Diterima)</label>
                  <GlassInput
                    type="number" min="1"
                    value={aqlLot}
                    onChange={e => setAqlLot(e.target.value)}
                    placeholder="Contoh: 500"
                    data-testid="aql-lot-input"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">AQL (Acceptable Quality Limit %)</label>
                  <Select value={String(aqlValue)} onValueChange={v => setAqlValue(parseFloat(v))}>
                    <SelectTrigger data-testid="aql-value-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0.65">0.65% — Critical</SelectItem>
                      <SelectItem value="1.0">1.0% — Major</SelectItem>
                      <SelectItem value="2.5">2.5% — Standard (Recommended)</SelectItem>
                      <SelectItem value="4.0">4.0% — Minor</SelectItem>
                      <SelectItem value="6.5">6.5% — Cosmetic</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={handleAqlCalc}
                  disabled={aqlLoading || !aqlLot || parseInt(aqlLot, 10) <= 0}
                  className="w-full gap-2"
                  data-testid="aql-calc-btn"
                >
                  {aqlLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
                  Hitung Sample Plan
                </Button>
              </div>
            </GlassCard>

            {/* Result */}
            <GlassCard className="p-5 lg:col-span-2">
              <h3 className="text-base font-semibold text-foreground mb-4 flex items-center gap-2">
                <Target className="w-4 h-4 text-primary" />
                Hasil Sample Plan
              </h3>
              {aqlResult ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="p-3 rounded-lg bg-[var(--glass-bg)] border border-[var(--glass-border)] text-center">
                      <div className="text-[10px] text-muted-foreground uppercase">Lot Size</div>
                      <div className="text-2xl font-bold text-foreground mt-1">{aqlResult.lot_size.toLocaleString('id-ID')}</div>
                    </div>
                    <div className="p-3 rounded-lg bg-primary/10 border border-primary/30 text-center">
                      <div className="text-[10px] text-muted-foreground uppercase">Sample Size</div>
                      <div className="text-2xl font-bold text-primary mt-1">{aqlResult.sample_size}</div>
                      <div className="text-[9px] text-muted-foreground mt-0.5">pcs untuk diperiksa</div>
                    </div>
                    <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-400/30 text-center">
                      <div className="text-[10px] text-muted-foreground uppercase flex items-center justify-center gap-0.5">
                        <CheckCircle2 className="w-2.5 h-2.5" /> Accept
                      </div>
                      <div className="text-2xl font-bold text-emerald-400 mt-1">≤ {aqlResult.accept_limit}</div>
                      <div className="text-[9px] text-muted-foreground mt-0.5">defects → ACCEPT</div>
                    </div>
                    <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-400/30 text-center">
                      <div className="text-[10px] text-muted-foreground uppercase flex items-center justify-center gap-0.5">
                        <XCircle className="w-2.5 h-2.5" /> Reject
                      </div>
                      <div className="text-2xl font-bold text-rose-400 mt-1">≥ {aqlResult.reject_limit}</div>
                      <div className="text-[9px] text-muted-foreground mt-0.5">defects → REJECT</div>
                    </div>
                  </div>

                  <GlassPanel className="p-3 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Code Letter:</span>
                      <span className="font-mono font-bold text-foreground">{aqlResult.code_letter}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">AQL Level:</span>
                      <span className="font-bold text-foreground">{aqlResult.aql}%</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Inspection Level:</span>
                      <span className="text-foreground">{aqlResult.inspection_level}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Standard:</span>
                      <span className="text-foreground">{aqlResult.standard}</span>
                    </div>
                  </GlassPanel>

                  <div className="text-xs text-muted-foreground/90 p-3 rounded-lg bg-blue-500/5 border border-blue-400/20 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-foreground">Cara pakai:</strong> Ambil random{' '}
                      <strong className="text-primary">{aqlResult.sample_size} pcs</strong> dari lot{' '}
                      {aqlResult.lot_size.toLocaleString('id-ID')} pcs. Inspeksi cacat. Bila ditemukan{' '}
                      <strong className="text-emerald-300">≤ {aqlResult.accept_limit}</strong> defect → terima
                      seluruh lot. Bila <strong className="text-rose-300">≥ {aqlResult.reject_limit}</strong>{' '}
                      defect → tolak seluruh lot.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12">
                  <Calculator className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground">
                    Masukkan lot size dan klik <strong>Hitung Sample Plan</strong> untuk melihat hasilnya.
                  </p>
                </div>
              )}
            </GlassCard>
          </div>
        </TabsContent>
      </Tabs>

      {/* Detail Modal */}
      {detailSupplier && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end md:items-center justify-center p-0 md:p-4" onClick={() => setDetailSupplier(null)}>
          <div
            className="bg-[var(--glass-bg)] backdrop-blur-xl border border-[var(--glass-border)] rounded-t-2xl md:rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}
            data-testid="scorecard-detail-modal"
          >
            <div className="px-5 py-4 border-b border-[var(--glass-border)] flex items-start gap-3">
              <div className="flex-1">
                <div className="text-xs text-muted-foreground mb-1">Supplier Detail Scorecard (180 hari)</div>
                <div className="text-lg font-bold text-foreground flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-primary" />
                  {detailSupplier.supplier_name}
                </div>
              </div>
              <button onClick={() => setDetailSupplier(null)} className="text-muted-foreground hover:text-foreground p-1">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {detailLoading && (
                <div className="flex items-center justify-center h-32">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                </div>
              )}
              {!detailLoading && detailData && detailData.summary && (
                <>
                  {/* Summary cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <GlassPanel className="p-3 text-center">
                      <div className="text-[10px] text-muted-foreground uppercase">Grade</div>
                      <div className={`text-xl font-bold ${(GRADE_STYLE[detailData.summary.quality_grade] || GRADE_STYLE.B).text}`}>
                        {detailData.summary.quality_grade}
                      </div>
                    </GlassPanel>
                    <GlassPanel className="p-3 text-center">
                      <div className="text-[10px] text-muted-foreground uppercase">Accept Rate</div>
                      <div className="text-xl font-bold text-emerald-400">{detailData.summary.accept_rate}%</div>
                    </GlassPanel>
                    <GlassPanel className="p-3 text-center">
                      <div className="text-[10px] text-muted-foreground uppercase">Defect Rate</div>
                      <div className="text-xl font-bold text-rose-400">{detailData.summary.defect_rate}%</div>
                    </GlassPanel>
                    <GlassPanel className="p-3 text-center">
                      <div className="text-[10px] text-muted-foreground uppercase">Total GRN</div>
                      <div className="text-xl font-bold text-foreground">{detailData.summary.total_grns}</div>
                    </GlassPanel>
                  </div>

                  {/* Monthly trend */}
                  {detailData.monthly_trend?.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
                        <Activity className="w-4 h-4 text-primary" /> Tren Bulanan
                      </h4>
                      <div className="space-y-1.5">
                        {detailData.monthly_trend.map(m => (
                          <div key={m.month} className="flex items-center gap-3 text-xs px-3 py-2 rounded-md bg-[var(--glass-bg)] border border-[var(--glass-border)]">
                            <Calendar className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                            <div className="font-mono text-foreground w-16">{m.month}</div>
                            <div className="flex-1 flex items-center gap-2">
                              <div className="flex-1 h-2 rounded-full bg-zinc-800/70 overflow-hidden">
                                <div
                                  className={`h-full transition-all ${m.accept_rate >= 95 ? 'bg-emerald-400' : m.accept_rate >= 85 ? 'bg-amber-400' : 'bg-rose-400'}`}
                                  style={{ width: `${Math.min(100, m.accept_rate)}%` }}
                                />
                              </div>
                              <div className="w-14 text-right font-bold text-foreground">{m.accept_rate}%</div>
                            </div>
                            <div className="text-muted-foreground w-16 text-right">
                              {m.grns} GRN
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Top reject reasons */}
                  {detailData.top_reject_reasons?.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
                        <ShieldAlert className="w-4 h-4 text-amber-400" /> Top Reject Reasons
                      </h4>
                      <div className="space-y-1.5">
                        {detailData.top_reject_reasons.map(r => (
                          <div key={r.code} className="flex items-center gap-3 text-xs px-3 py-2 rounded-md bg-[var(--glass-bg)] border border-[var(--glass-border)]">
                            <Badge variant="outline" className={`text-[10px] ${SEVERITY_BADGE[r.severity] || ''}`}>
                              {r.severity.toUpperCase()}
                            </Badge>
                            <div className="flex-1 text-foreground">{r.label}</div>
                            <div className="font-mono font-bold text-rose-300">{r.total_qty.toLocaleString('id-ID')} pcs</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Recent inspections */}
                  {detailData.recent_inspections?.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
                        <Package className="w-4 h-4 text-primary" /> Inspeksi Terbaru
                      </h4>
                      <div className="space-y-1">
                        {detailData.recent_inspections.slice(0, 8).map(i => (
                          <div key={i.id} className="flex items-center gap-2 text-xs px-3 py-2 rounded-md bg-[var(--glass-bg)] border border-[var(--glass-border)]">
                            <div className="font-mono text-primary">{i.inspection_no}</div>
                            <div className="text-muted-foreground">·</div>
                            <div className="flex-1 text-foreground truncate">{i.receipt_number}</div>
                            <Badge variant="outline" className={`text-[10px] ${
                              i.overall_result === 'accepted' ? 'text-emerald-300 border-emerald-300/30' :
                              i.overall_result === 'partial'  ? 'text-amber-300 border-amber-300/30' :
                              'text-rose-300 border-rose-300/30'
                            }`}>
                              {i.overall_result.toUpperCase()}
                            </Badge>
                            <span className="font-mono text-muted-foreground">{i.defect_rate}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
              {!detailLoading && (!detailData || !detailData.summary) && (
                <div className="text-center py-12">
                  <BarChart3 className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground">Tidak ada data inspeksi untuk supplier ini.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export { SupplierScorecardModule };
