/**
 * ExecutiveReportModule — Phase 3 P1
 *
 * Cross-module consolidated executive dashboard.
 * Fitur: KPI summary semua domain, month-on-month comparison chart,
 *        finance/produksi/HR/marketing snapshots, trend multi-KPI.
 */
import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  BarChart3, RefreshCw, TrendingUp, TrendingDown,
  DollarSign, Factory, Users, Zap, ChevronUp,
  ChevronDown, Calendar, ArrowRight,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../ui/select';
import { useToast } from '../../hooks/use-toast';

const API = process.env.REACT_APP_BACKEND_URL || '';
const FMT_IDR = v => `Rp ${(+v || 0).toLocaleString('id-ID')}`;
const FMT_NUM = v => (+v || 0).toLocaleString('id-ID');
const FMT_PCT = v => `${(+v || 0).toFixed(1)}%`;

function Delta({ pct, invert = false }) {
  if (pct == null) return <span className="text-zinc-600 text-xs">n/a</span>;
  const positive = invert ? pct <= 0 : pct >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${
      positive ? 'text-emerald-400' : 'text-red-400'
    }`}>
      {pct >= 0 ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      {Math.abs(pct)}%
    </span>
  );
}

function KpiCard({ icon: Icon, iconColor, label, value, sub, delta, invertDelta }) {
  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardContent className="pt-4 pb-3">
        <div className="flex justify-between items-start mb-1">
          <span className="text-xs text-zinc-400">{label}</span>
          <Icon className={`w-4 h-4 ${iconColor}`} />
        </div>
        <div className="text-xl font-bold text-white">{value}</div>
        <div className="flex items-center gap-2 mt-0.5">
          {sub && <span className="text-xs text-zinc-500">{sub}</span>}
          {delta !== undefined && <Delta pct={delta} invert={invertDelta} />}
        </div>
      </CardContent>
    </Card>
  );
}

function TrendChart({ data, keys }) {
  if (!data || data.length === 0) return (
    <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">Belum ada data</div>
  );
  const colorMap = {
    revenue_rp:           'bg-blue-500',
    net_income_rp:        'bg-emerald-500',
    ar_overdue_rp:        'bg-red-500',
    payroll_total_rp:     'bg-purple-500',
  };
  const labelMap = {
    revenue_rp:       'Revenue',
    net_income_rp:    'Net Income',
    ar_overdue_rp:    'AR Overdue',
    payroll_total_rp: 'Payroll',
  };
  const activeKey = keys[0];
  const maxVal = Math.max(...data.map(d => d[activeKey] || 0), 1);
  return (
    <div>
      <div className="flex gap-3 mb-2 flex-wrap">
        {keys.map(k => (
          <span key={k} className="flex items-center gap-1 text-xs text-zinc-400">
            <span className={`w-2 h-2 rounded-full ${colorMap[k] || 'bg-zinc-500'}`} />
            {labelMap[k] || k}
          </span>
        ))}
      </div>
      <div className="flex items-end gap-1 h-32">
        {data.map((d, i) => (
          <div key={i} className="flex-1 flex flex-col items-center group relative">
            <div
              className={`w-full ${colorMap[activeKey] || 'bg-blue-500'} rounded-sm opacity-70 hover:opacity-100`}
              style={{ height: `${((d[activeKey] || 0) / maxVal) * 100}%` }}
            />
            <div className="text-xs text-zinc-600 mt-1 truncate w-full text-center">{d.period?.slice(5)}</div>
            <div className="absolute bottom-full mb-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 z-10">
              {d.period}: {FMT_IDR(d[activeKey])}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ExecutiveReportModule({ user, headers }) {
  const [summary, setSummary] = useState(null);
  const [kpiComparison, setKpiComparison] = useState([]);
  const [trend, setTrend] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedYear, setSelectedYear] = useState(String(new Date().getFullYear()));
  const [selectedMonth, setSelectedMonth] = useState(String(new Date().getMonth() + 1));
  const [trendMonths, setTrendMonths] = useState('6');
  const [activeSection, setActiveSection] = useState('summary');
  const { toast } = useToast();
  const authH = headers || {};

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const params = { year: parseInt(selectedYear), month: parseInt(selectedMonth) };
      const [sumRes, cmpRes, trendRes] = await Promise.all([
        axios.get(`${API}/api/reports/executive/summary`, { headers: authH, params }),
        axios.get(`${API}/api/reports/executive/kpi-comparison`, { headers: authH, params: { months: 6 } }),
        axios.get(`${API}/api/reports/executive/trend`, { headers: authH, params: { months: parseInt(trendMonths) } }),
      ]);
      setSummary(sumRes.data);
      setKpiComparison(cmpRes.data?.data || []);
      setTrend(trendRes.data?.data || []);
    } catch (e) {
      toast({ title: 'Error', description: e.response?.data?.detail || 'Gagal load laporan', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [selectedYear, selectedMonth, trendMonths, authH, toast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const fin = summary?.finance || {};
  const prod = summary?.production || {};
  const hr = summary?.hr || {};
  const mkt = summary?.marketing || {};

  const MONTHS = [
    { v: '1', l: 'Januari' }, { v: '2', l: 'Februari' }, { v: '3', l: 'Maret' },
    { v: '4', l: 'April' }, { v: '5', l: 'Mei' }, { v: '6', l: 'Juni' },
    { v: '7', l: 'Juli' }, { v: '8', l: 'Agustus' }, { v: '9', l: 'September' },
    { v: '10', l: 'Oktober' }, { v: '11', l: 'November' }, { v: '12', l: 'Desember' },
  ];
  const CY = new Date().getFullYear();
  const YEARS = [String(CY - 1), String(CY)];

  const SECTIONS = [
    { id: 'summary',    label: 'Executive Summary' },
    { id: 'finance',    label: 'Keuangan' },
    { id: 'production', label: 'Produksi' },
    { id: 'hr',         label: 'SDM' },
    { id: 'trend',      label: 'Trend Multi-KPI' },
  ];

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="text-indigo-400" /> Executive Report Hub
          </h2>
          <p className="text-sm text-zinc-400 mt-1">Laporan konsolidat cross-module untuk manajemen</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-32 bg-zinc-900 border-zinc-700 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-800">
              {MONTHS.map(m => <SelectItem key={m.v} value={m.v}>{m.l}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={selectedYear} onValueChange={setSelectedYear}>
            <SelectTrigger className="w-24 bg-zinc-900 border-zinc-700 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-800">
              {YEARS.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={fetchAll} disabled={loading}
            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800" data-testid="btn-refresh-exec">
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Period label */}
      {summary && (
        <div className="text-sm text-zinc-400">
          Laporan periode: <span className="text-white font-medium">{summary.period?.label}</span>
          <span className="text-zinc-600 ml-2">({summary.period?.range?.from} s/d {summary.period?.range?.to})</span>
        </div>
      )}

      {/* Sections nav */}
      <div className="flex gap-1 border-b border-zinc-800 overflow-x-auto">
        {SECTIONS.map(s => (
          <button key={s.id} onClick={() => setActiveSection(s.id)}
            className={`px-4 py-2 text-sm whitespace-nowrap transition-colors ${
              activeSection === s.id
                ? 'text-white border-b-2 border-indigo-500'
                : 'text-zinc-400 hover:text-white'
            }`}
            data-testid={`tab-exec-${s.id}`}>{s.label}</button>
        ))}
      </div>

      {/* Summary Section */}
      {activeSection === 'summary' && (
        <div className="space-y-5">
          {/* Revenue headline */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard icon={DollarSign} iconColor="text-emerald-400" label="Revenue Bulan Ini"
              value={loading ? '…' : FMT_IDR(fin.revenue_rp)}
              sub={`${fin.invoice_count || 0} invoice`}
              delta={fin.revenue_delta_vs_prev_pct} />
            <KpiCard icon={TrendingUp} iconColor="text-blue-400" label="Net Income"
              value={loading ? '…' : FMT_IDR(fin.net_income_rp)}
              sub={`Margin ${FMT_PCT(fin.profit_margin_pct)}`} />
            <KpiCard icon={Factory} iconColor="text-orange-400" label="WO Selesai"
              value={loading ? '…' : FMT_NUM(prod.completed_wo)}
              sub={`dari ${prod.total_wo || 0} total`} />
            <KpiCard icon={Users} iconColor="text-purple-400" label="Karyawan Aktif"
              value={loading ? '…' : FMT_NUM(hr.total_active_employees)}
              sub={`Absen ${hr.absent_count || 0} hari ini`} />
          </div>

          {/* Domain rows */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Finance */}
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-zinc-300 flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-emerald-400" /> Keuangan
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                {[
                  ['Revenue', FMT_IDR(fin.revenue_rp)],
                  ['Revenue Terbayar', FMT_IDR(fin.paid_revenue_rp)],
                  ['Total Biaya', FMT_IDR(fin.total_expenses_rp)],
                  ['Net Income', FMT_IDR(fin.net_income_rp)],
                  ['AR Overdue', `${FMT_IDR(fin.ar_overdue_rp)} (${fin.ar_overdue_count || 0} inv)`],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-zinc-400">{k}</span>
                    <span className="text-white">{loading ? '…' : v}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Production */}
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-zinc-300 flex items-center gap-2">
                  <Factory className="w-4 h-4 text-orange-400" /> Produksi
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                {[
                  ['Total WO', FMT_NUM(prod.total_wo)],
                  ['WO Selesai', `${prod.completed_wo} (${FMT_PCT(prod.completion_rate_pct)})`],
                  ['WO Aktif', FMT_NUM(prod.active_wo)],
                  ['Qty Ordered', FMT_NUM(prod.total_qty_ordered)],
                  ['Defect Rate', FMT_PCT(prod.defect_rate_pct)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-zinc-400">{k}</span>
                    <span className="text-white">{loading ? '…' : v}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* HR */}
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-zinc-300 flex items-center gap-2">
                  <Users className="w-4 h-4 text-purple-400" /> SDM
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                {[
                  ['Karyawan Aktif', FMT_NUM(hr.total_active_employees)],
                  ['Karyawan Baru', FMT_NUM(hr.new_hires)],
                  ['Attendance Rate', FMT_PCT(hr.attendance_rate_pct)],
                  ['Overtime Jam', `${hr.overtime_hours || 0} jam`],
                  ['Total Payroll', FMT_IDR(hr.payroll_total_rp)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-zinc-400">{k}</span>
                    <span className="text-white">{loading ? '…' : v}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Marketing */}
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-zinc-300 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-400" /> Marketing
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                {[
                  ['Live Sessions', FMT_NUM(mkt.live_sessions)],
                  ['Revenue Live', FMT_IDR(mkt.live_revenue_rp)],
                  ['Live Orders', FMT_NUM(mkt.live_orders)],
                  ['Marketplace Orders', FMT_NUM(mkt.marketplace_orders_via_webhook)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-zinc-400">{k}</span>
                    <span className="text-white">{loading ? '…' : v}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Finance Section */}
      {activeSection === 'finance' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <KpiCard icon={DollarSign} iconColor="text-emerald-400" label="Revenue"
              value={loading ? '…' : FMT_IDR(fin.revenue_rp)}
              sub={`${fin.invoice_count || 0} invoice`}
              delta={fin.revenue_delta_vs_prev_pct} />
            <KpiCard icon={TrendingUp} iconColor="text-blue-400" label="Net Income"
              value={loading ? '…' : FMT_IDR(fin.net_income_rp)}
              sub={`${FMT_PCT(fin.profit_margin_pct)} margin`} />
            <KpiCard icon={TrendingDown} iconColor="text-red-400" label="AR Overdue"
              value={loading ? '…' : FMT_IDR(fin.ar_overdue_rp)}
              sub={`${fin.ar_overdue_count || 0} invoice`} invertDelta />
          </div>
          {/* KPI Comparison Table */}
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-zinc-300">Perbandingan 6 Bulan</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-400">
                    <th className="text-left px-4 py-2">Periode</th>
                    <th className="text-right px-4 py-2">Revenue</th>
                    <th className="text-right px-4 py-2">Net Income</th>
                    <th className="text-right px-4 py-2">AR Overdue</th>
                    <th className="text-right px-4 py-2">WO Selesai</th>
                  </tr>
                </thead>
                <tbody>
                  {kpiComparison.map(r => (
                    <tr key={r.period} className="border-b border-zinc-800/40">
                      <td className="px-4 py-2 text-zinc-300">{r.period}</td>
                      <td className="px-4 py-2 text-right text-emerald-400">{FMT_IDR(r.revenue_rp)}</td>
                      <td className="px-4 py-2 text-right text-blue-400">{FMT_IDR(r.net_income_rp)}</td>
                      <td className="px-4 py-2 text-right text-red-400">{FMT_IDR(r.ar_overdue_rp)}</td>
                      <td className="px-4 py-2 text-right text-zinc-300">{r.wo_completed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Production Section */}
      {activeSection === 'production' && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { label: 'Total WO', value: FMT_NUM(prod.total_wo), icon: Factory, color: 'text-orange-400' },
            { label: 'WO Selesai', value: `${prod.completed_wo} (${FMT_PCT(prod.completion_rate_pct)})`, icon: Factory, color: 'text-emerald-400' },
            { label: 'WO Aktif', value: FMT_NUM(prod.active_wo), icon: Factory, color: 'text-blue-400' },
            { label: 'Qty Ordered', value: FMT_NUM(prod.total_qty_ordered), icon: BarChart3, color: 'text-zinc-400' },
            { label: 'Qty Selesai', value: `${FMT_NUM(prod.total_qty_completed)} (${FMT_PCT(prod.fulfillment_rate_pct)})`, icon: BarChart3, color: 'text-emerald-400' },
            { label: 'Defect Rate', value: FMT_PCT(prod.defect_rate_pct), icon: TrendingDown, color: prod.defect_rate_pct > 2 ? 'text-red-400' : 'text-emerald-400' },
          ].map(({ label, value, icon: Icon, color }) => (
            <KpiCard key={label} icon={Icon} iconColor={color} label={label} value={loading ? '…' : value} />
          ))}
        </div>
      )}

      {/* HR Section */}
      {activeSection === 'hr' && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { label: 'Karyawan Aktif', value: FMT_NUM(hr.total_active_employees), icon: Users, color: 'text-purple-400' },
            { label: 'Karyawan Baru', value: FMT_NUM(hr.new_hires), icon: Users, color: 'text-blue-400' },
            { label: 'Attendance Rate', value: FMT_PCT(hr.attendance_rate_pct), icon: TrendingUp, color: hr.attendance_rate_pct < 90 ? 'text-amber-400' : 'text-emerald-400' },
            { label: 'Absen (hari ini)', value: FMT_NUM(hr.absent_count), icon: Users, color: 'text-red-400' },
            { label: 'Overtime Hours', value: `${hr.overtime_hours || 0} jam`, icon: TrendingUp, color: 'text-zinc-400' },
            { label: 'Total Payroll', value: FMT_IDR(hr.payroll_total_rp), icon: DollarSign, color: 'text-emerald-400' },
          ].map(({ label, value, icon: Icon, color }) => (
            <KpiCard key={label} icon={Icon} iconColor={color} label={label} value={loading ? '…' : value} />
          ))}
        </div>
      )}

      {/* Trend Section */}
      {activeSection === 'trend' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <label className="text-xs text-zinc-400">Periode:</label>
            <Select value={trendMonths} onValueChange={setTrendMonths}>
              <SelectTrigger className="w-24 bg-zinc-900 border-zinc-700 text-xs h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800">
                <SelectItem value="3">3 Bulan</SelectItem>
                <SelectItem value="6">6 Bulan</SelectItem>
                <SelectItem value="12">12 Bulan</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-zinc-300">Revenue vs Net Income Trend</CardTitle>
            </CardHeader>
            <CardContent>
              <TrendChart data={trend} keys={['revenue_rp', 'net_income_rp']} />
            </CardContent>
          </Card>
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-zinc-300">Data Trend</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-400">
                    <th className="text-left px-4 py-2">Periode</th>
                    <th className="text-right px-4 py-2">Revenue</th>
                    <th className="text-right px-4 py-2">Net Income</th>
                    <th className="text-right px-4 py-2">AR Overdue</th>
                    <th className="text-right px-4 py-2">Attd%</th>
                    <th className="text-right px-4 py-2">Payroll</th>
                  </tr>
                </thead>
                <tbody>
                  {trend.map(r => (
                    <tr key={r.period} className="border-b border-zinc-800/40">
                      <td className="px-4 py-2 text-zinc-300">{r.period}</td>
                      <td className="px-4 py-2 text-right text-emerald-400">{FMT_IDR(r.revenue_rp)}</td>
                      <td className="px-4 py-2 text-right text-blue-400">{FMT_IDR(r.net_income_rp)}</td>
                      <td className="px-4 py-2 text-right text-red-400">{FMT_IDR(r.ar_overdue_rp)}</td>
                      <td className="px-4 py-2 text-right text-zinc-300">{FMT_PCT(r.attendance_rate_pct)}</td>
                      <td className="px-4 py-2 text-right text-purple-400">{FMT_IDR(r.payroll_total_rp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
