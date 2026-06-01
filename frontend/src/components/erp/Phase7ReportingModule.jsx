/**
 * Phase 7 — Laporan & Dashboard Module
 *
 * Tabs:
 *  1. Laporan Harian      — produksi, DO, fulfillment, adjustment per hari
 *  2. Laporan Bulanan     — agregat per vendor & per klien
 *  3. Per PO Maklon       — pilih PO, lihat progress + dispatch + finance
 *  4. Actual vs Target    — comparison per CMT job & per PO untuk periode tertentu
 *  5. Trend Produksi      — chart line N hari terakhir
 *
 * Export: CSV (backend), Excel (xlsx client-side), PDF (jsPDF + html2canvas)
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  BarChart3, Calendar, FileText, TrendingUp, Target, Download,
  RefreshCw, FileSpreadsheet, Printer, Loader2, Package, Truck,
  CheckCircle2, AlertTriangle, DollarSign
} from 'lucide-react';
import { GlassCard } from '@/components/ui/glass';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, PieChart, Pie, Cell
} from 'recharts';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

const API = process.env.REACT_APP_BACKEND_URL;

function fmtNum(v) { return Number(v || 0).toLocaleString('id-ID'); }
function fmtCurrency(v) { return 'Rp ' + Number(v || 0).toLocaleString('id-ID'); }
function fmtPct(v) { return `${Number(v || 0).toFixed(1)}%`; }
function fmtDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

const CHART_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899'];

// ─── EXPORT HELPERS ────────────────────────────────────────────────────────────
function exportToExcel(rows, filename, sheetName = 'Laporan') {
  if (!rows || rows.length === 0) {
    toast.error('Tidak ada data untuk diekspor');
    return;
  }
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `${filename}.xlsx`);
  toast.success(`Excel berhasil di-export: ${filename}.xlsx`);
}

async function exportToPDF(elementRef, filename) {
  if (!elementRef.current) {
    toast.error('Element tidak ditemukan');
    return;
  }
  try {
    toast.info('Membuat PDF...');
    const canvas = await html2canvas(elementRef.current, {
      backgroundColor: '#0f1117',
      scale: 1.5,
      logging: false,
      useCORS: true,
    });

    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();

    // Calculate scale-down ratio: image width fits PDF width
    const imgWidthMM = pdfWidth;
    const imgHeightMM = (canvas.height * pdfWidth) / canvas.width;

    // If content fits single page → simple addImage
    if (imgHeightMM <= pdfHeight) {
      pdf.addImage(imgData, 'PNG', 0, 0, imgWidthMM, imgHeightMM);
    } else {
      // Multi-page: slice the canvas vertically and add each chunk on separate page
      const pageHeightPx = Math.floor((pdfHeight * canvas.width) / pdfWidth);
      let yOffset = 0;
      let pageNum = 0;

      while (yOffset < canvas.height) {
        const sliceHeight = Math.min(pageHeightPx, canvas.height - yOffset);

        // Create temp canvas for this slice
        const sliceCanvas = document.createElement('canvas');
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = sliceHeight;
        const ctx = sliceCanvas.getContext('2d');
        ctx.fillStyle = '#0f1117';
        ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
        ctx.drawImage(
          canvas,
          0, yOffset, canvas.width, sliceHeight,
          0, 0, canvas.width, sliceHeight
        );

        const sliceImg = sliceCanvas.toDataURL('image/png');
        const sliceHeightMM = (sliceHeight * pdfWidth) / canvas.width;

        if (pageNum > 0) pdf.addPage();
        pdf.addImage(sliceImg, 'PNG', 0, 0, imgWidthMM, sliceHeightMM);

        // Add footer with page number
        pdf.setFontSize(8);
        pdf.setTextColor(150);
        pdf.text(
          `Halaman ${pageNum + 1}`,
          pdfWidth - 25,
          pdfHeight - 5
        );

        yOffset += sliceHeight;
        pageNum += 1;
      }
    }

    pdf.save(`${filename}.pdf`);
    toast.success(`PDF berhasil di-export: ${filename}.pdf`);
  } catch (e) {
    toast.error('Gagal membuat PDF');
    console.error(e);
  }
}

// ─── 1. DAILY REPORT ───────────────────────────────────────────────────────────
function DailyReportTab({ headers, token }) {
  const [reportDate, setReportDate] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const printRef = useRef(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/dewi/reports/daily?date=${reportDate}`, { headers });
      if (r.ok) setData(await r.json());
      else toast.error('Gagal memuat laporan harian');
    } catch (e) {
      toast.error('Network error');
    } finally {
      setLoading(false);
    }
  }, [reportDate, headers]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCSVExport = () => {
    window.open(`${API}/api/dewi/reports/export/daily.csv?date=${reportDate}&token=${token}`, '_blank');
    // Sebenarnya backend butuh auth header, jadi pakai fetch lalu blob
    fetch(`${API}/api/dewi/reports/export/daily.csv?date=${reportDate}`, { headers })
      .then(r => r.blob())
      .then(blob => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `laporan-harian-${reportDate}.csv`;
        a.click();
        toast.success('CSV berhasil diunduh');
      })
      .catch(() => toast.error('Gagal mengunduh CSV'));
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-end gap-3 flex-wrap">
        <div className="space-y-1.5">
          <Label className="text-xs text-slate-300">Tanggal Laporan</Label>
          <Input
            data-testid="daily-report-date"
            type="date"
            value={reportDate}
            onChange={e => setReportDate(e.target.value)}
            className="bg-white/5 border-white/10"
          />
        </div>
        <Button onClick={fetchData} disabled={loading} variant="outline" className="border-white/10">
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
        <div className="flex gap-2 ml-auto">
          <Button onClick={handleCSVExport} variant="outline" size="sm" className="border-white/10">
            <Download className="w-4 h-4 mr-2" />CSV
          </Button>
          <Button
            onClick={() => exportToExcel(data?.production?.by_vendor || [], `laporan-harian-${reportDate}`, 'Vendor')}
            variant="outline"
            size="sm"
            className="border-white/10"
          >
            <FileSpreadsheet className="w-4 h-4 mr-2" />Excel
          </Button>
          <Button
            onClick={() => exportToPDF(printRef, `laporan-harian-${reportDate}`)}
            variant="outline"
            size="sm"
            className="border-white/10"
          >
            <Printer className="w-4 h-4 mr-2" />PDF
          </Button>
        </div>
      </div>

      {loading || !data ? (
        <div className="text-center py-12 text-slate-400">
          <Loader2 className="w-8 h-8 mx-auto animate-spin mb-3" />
          Memuat laporan...
        </div>
      ) : (
        <div ref={printRef} className="space-y-4 bg-[#0f1117] p-4 rounded-lg">
          {/* Header for PDF */}
          <div className="border-b border-white/10 pb-3">
            <h2 className="text-xl font-bold text-white">Laporan Harian — {fmtDate(data.date)}</h2>
            <p className="text-xs text-slate-400 mt-1">CV. Dewi Aditya — Diunduh: {new Date().toLocaleString('id-ID')}</p>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Total Diproses', value: fmtNum(data.production.total_processed), icon: Package, color: 'text-blue-300' },
              { label: 'Lolos QC', value: fmtNum(data.production.total_passed), icon: CheckCircle2, color: 'text-green-300' },
              { label: 'Pass Rate', value: fmtPct(data.production.pass_rate_pct), icon: Target, color: 'text-cyan-300' },
              { label: 'Adjustment Stok', value: fmtNum(data.stock_adjustments), icon: AlertTriangle, color: 'text-amber-300' },
            ].map(s => (
              <GlassCard key={s.label} className="p-3" data-testid={`stat-${s.label}`}>
                <div className="flex items-center justify-between mb-1">
                  <s.icon className={`w-4 h-4 ${s.color}`} />
                </div>
                <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-[10px] text-slate-400">{s.label}</div>
              </GlassCard>
            ))}
          </div>

          {/* Two Column */}
          <div className="grid grid-cols-2 gap-4">
            {/* Production by Vendor */}
            <GlassCard className="p-4">
              <h3 className="text-sm font-semibold text-white mb-3">Produksi per Vendor</h3>
              {data.production.by_vendor.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-6">Belum ada produksi tercatat</p>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data.production.by_vendor}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="cmt_name" stroke="#94a3b8" fontSize={10} />
                    <YAxis stroke="#94a3b8" fontSize={10} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', fontSize: 12 }}
                    />
                    <Bar dataKey="qty_processed" fill="#3b82f6" name="Diproses" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </GlassCard>

            {/* By Step */}
            <GlassCard className="p-4">
              <h3 className="text-sm font-semibold text-white mb-3">Distribusi per Process Step</h3>
              {data.production.by_step.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-6">Belum ada data</p>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={data.production.by_step} dataKey="qty" nameKey="step" cx="50%" cy="50%" outerRadius={70}>
                      {data.production.by_step.map((entry, idx) => (
                        <Cell key={`cell-${idx}`} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </GlassCard>
          </div>

          {/* DO + Fulfillment Cards */}
          <div className="grid grid-cols-3 gap-3">
            <GlassCard className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-slate-400">Delivery Orders</div>
                <Truck className="w-4 h-4 text-violet-300" />
              </div>
              <div className="flex gap-4 mt-2">
                <div>
                  <div className="text-lg font-bold text-blue-300">{data.delivery_orders.issued}</div>
                  <div className="text-[10px] text-slate-500">Diterbitkan</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-green-300">{data.delivery_orders.received}</div>
                  <div className="text-[10px] text-slate-500">Diterima</div>
                </div>
              </div>
            </GlassCard>
            <GlassCard className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-slate-400">Fulfillment Online</div>
                <Package className="w-4 h-4 text-cyan-300" />
              </div>
              <div className="flex gap-4 mt-2">
                <div>
                  <div className="text-lg font-bold text-cyan-300">{data.fulfillment.dispatched_orders}</div>
                  <div className="text-[10px] text-slate-500">Order Dikirim</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-emerald-300">{fmtNum(data.fulfillment.dispatched_qty)}</div>
                  <div className="text-[10px] text-slate-500">Qty</div>
                </div>
              </div>
            </GlassCard>
            <GlassCard className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-slate-400">Defect Rate</div>
                <AlertTriangle className="w-4 h-4 text-red-300" />
              </div>
              <div className="text-2xl font-bold text-red-300">{fmtNum(data.production.total_failed)}</div>
              <div className="text-[10px] text-slate-500">Gagal QC</div>
            </GlassCard>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 2. MONTHLY REPORT ─────────────────────────────────────────────────────────
function MonthlyReportTab({ headers }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const printRef = useRef(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/dewi/reports/monthly?year=${year}&month=${month}`, { headers });
      if (r.ok) setData(await r.json());
    } catch (e) {
      toast.error('Network error');
    } finally {
      setLoading(false);
    }
  }, [year, month, headers]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const months = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];

  const handleCSVExport = () => {
    fetch(`${API}/api/dewi/reports/export/monthly.csv?year=${year}&month=${month}`, { headers })
      .then(r => r.blob())
      .then(blob => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `laporan-bulanan-${year}-${String(month).padStart(2, '0')}.csv`;
        a.click();
        toast.success('CSV berhasil diunduh');
      })
      .catch(() => toast.error('Gagal mengunduh'));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3 flex-wrap">
        <div className="space-y-1.5">
          <Label className="text-xs text-slate-300">Tahun</Label>
          <Input
            data-testid="monthly-year-input"
            type="number"
            value={year}
            onChange={e => setYear(parseInt(e.target.value) || now.getFullYear())}
            className="bg-white/5 border-white/10 w-24"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-slate-300">Bulan</Label>
          <Select value={String(month)} onValueChange={v => setMonth(parseInt(v))}>
            <SelectTrigger data-testid="monthly-month-select" className="bg-white/5 border-white/10 w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {months.map((m, idx) => (
                <SelectItem key={idx + 1} value={String(idx + 1)}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={fetchData} disabled={loading} variant="outline" className="border-white/10">
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
        <div className="flex gap-2 ml-auto">
          <Button onClick={handleCSVExport} variant="outline" size="sm" className="border-white/10">
            <Download className="w-4 h-4 mr-2" />CSV
          </Button>
          <Button
            onClick={() => {
              const wb = XLSX.utils.book_new();
              if (data?.production_by_vendor?.length) {
                XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.production_by_vendor), 'Produksi');
              }
              if (data?.maklon_by_client?.length) {
                XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.maklon_by_client), 'Maklon');
              }
              XLSX.writeFile(wb, `laporan-bulanan-${year}-${String(month).padStart(2, '0')}.xlsx`);
              toast.success('Excel berhasil diunduh');
            }}
            variant="outline"
            size="sm"
            className="border-white/10"
          >
            <FileSpreadsheet className="w-4 h-4 mr-2" />Excel
          </Button>
          <Button
            onClick={() => exportToPDF(printRef, `laporan-bulanan-${year}-${String(month).padStart(2, '0')}`)}
            variant="outline"
            size="sm"
            className="border-white/10"
          >
            <Printer className="w-4 h-4 mr-2" />PDF
          </Button>
        </div>
      </div>

      {loading || !data ? (
        <div className="text-center py-12 text-slate-400">
          <Loader2 className="w-8 h-8 mx-auto animate-spin mb-3" />Memuat laporan...
        </div>
      ) : (
        <div ref={printRef} className="space-y-4 bg-[#0f1117] p-4 rounded-lg">
          <div className="border-b border-white/10 pb-3">
            <h2 className="text-xl font-bold text-white">Laporan Bulanan — {months[month - 1]} {year}</h2>
            <p className="text-xs text-slate-400 mt-1">CV. Dewi Aditya — Diunduh: {new Date().toLocaleString('id-ID')}</p>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-4 gap-3">
            <GlassCard className="p-3">
              <div className="text-[10px] text-slate-400">Total Produksi</div>
              <div className="text-2xl font-bold text-blue-300">{fmtNum(data.summary.total_processed)}</div>
              <div className="text-[10px] text-slate-500 mt-1">Pass: {fmtPct(data.summary.pass_rate_pct)}</div>
            </GlassCard>
            <GlassCard className="p-3">
              <div className="text-[10px] text-slate-400">Vendor Aktif</div>
              <div className="text-2xl font-bold text-violet-300">{data.summary.vendor_count}</div>
            </GlassCard>
            <GlassCard className="p-3">
              <div className="text-[10px] text-slate-400">Maklon PO</div>
              <div className="text-2xl font-bold text-cyan-300">{data.summary.maklon_po_count}</div>
              <div className="text-[10px] text-slate-500 mt-1">{fmtCurrency(data.summary.maklon_total_value)}</div>
            </GlassCard>
            <GlassCard className="p-3">
              <div className="text-[10px] text-slate-400">DO Diterbitkan</div>
              <div className="text-2xl font-bold text-emerald-300">{data.summary.do_issued}</div>
              <div className="text-[10px] text-slate-500 mt-1">Diterima: {data.summary.do_received}</div>
            </GlassCard>
          </div>

          {/* Vendor Production Table */}
          <GlassCard className="p-4">
            <h3 className="text-sm font-semibold text-white mb-3">Produksi per Vendor CMT</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left py-2 px-2 text-slate-400">Vendor</th>
                    <th className="text-right py-2 px-2 text-slate-400">Diproses</th>
                    <th className="text-right py-2 px-2 text-slate-400">Lolos</th>
                    <th className="text-right py-2 px-2 text-slate-400">Gagal</th>
                    <th className="text-right py-2 px-2 text-slate-400">Pass %</th>
                    <th className="text-right py-2 px-2 text-slate-400">Active Days</th>
                    <th className="text-right py-2 px-2 text-slate-400">Jobs</th>
                  </tr>
                </thead>
                <tbody>
                  {data.production_by_vendor.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-4 text-slate-500">Belum ada data</td></tr>
                  ) : data.production_by_vendor.map(v => (
                    <tr key={v.cmt_partner_id} className="border-b border-white/5">
                      <td className="py-2 px-2 text-white">{v.cmt_name}</td>
                      <td className="py-2 px-2 text-right font-mono text-blue-300">{fmtNum(v.total_processed)}</td>
                      <td className="py-2 px-2 text-right font-mono text-green-300">{fmtNum(v.total_passed)}</td>
                      <td className="py-2 px-2 text-right font-mono text-red-300">{fmtNum(v.total_failed)}</td>
                      <td className="py-2 px-2 text-right font-mono text-cyan-300">{fmtPct(v.pass_rate_pct)}</td>
                      <td className="py-2 px-2 text-right text-slate-300">{v.active_days}</td>
                      <td className="py-2 px-2 text-right text-slate-300">{v.jobs_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </GlassCard>

          {/* Maklon Client Table */}
          <GlassCard className="p-4">
            <h3 className="text-sm font-semibold text-white mb-3">Maklon per Klien</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left py-2 px-2 text-slate-400">Klien</th>
                    <th className="text-right py-2 px-2 text-slate-400">PO Count</th>
                    <th className="text-right py-2 px-2 text-slate-400">Total Qty</th>
                    <th className="text-right py-2 px-2 text-slate-400">Total Value</th>
                    <th className="text-right py-2 px-2 text-slate-400">Paid</th>
                    <th className="text-right py-2 px-2 text-slate-400">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {data.maklon_by_client.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-4 text-slate-500">Belum ada data</td></tr>
                  ) : data.maklon_by_client.map(c => (
                    <tr key={c.client_id} className="border-b border-white/5">
                      <td className="py-2 px-2 text-white">{c.client_name}</td>
                      <td className="py-2 px-2 text-right font-mono">{c.po_count}</td>
                      <td className="py-2 px-2 text-right font-mono text-blue-300">{fmtNum(c.total_qty)}</td>
                      <td className="py-2 px-2 text-right font-mono text-cyan-300">{fmtCurrency(c.total_value)}</td>
                      <td className="py-2 px-2 text-right font-mono text-green-300">{fmtCurrency(c.amount_paid)}</td>
                      <td className="py-2 px-2 text-right font-mono text-amber-300">{fmtCurrency(c.outstanding)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </GlassCard>
        </div>
      )}
    </div>
  );
}

// ─── 3. PER PO REPORT ──────────────────────────────────────────────────────────
function PerPOReportTab({ headers }) {
  const [pos, setPos] = useState([]);
  const [selectedPO, setSelectedPO] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const printRef = useRef(null);

  useEffect(() => {
    fetch(`${API}/api/dewi/maklon/pos?limit=200`, { headers })
      .then(r => r.json())
      .then(d => setPos(Array.isArray(d) ? d : (d.items || [])))
      .catch(() => toast.error('Gagal memuat list PO'));
  }, [headers]);

  const fetchPO = useCallback(async () => {
    if (!selectedPO) return;
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/dewi/reports/po/${selectedPO}`, { headers });
      if (r.ok) setData(await r.json());
      else toast.error('Gagal memuat laporan PO');
    } catch (e) {
      toast.error('Network error');
    } finally {
      setLoading(false);
    }
  }, [selectedPO, headers]);

  useEffect(() => { fetchPO(); }, [fetchPO]);

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3 flex-wrap">
        <div className="space-y-1.5 flex-1 max-w-md">
          <Label className="text-xs text-slate-300">Pilih PO Maklon</Label>
          <Select value={selectedPO} onValueChange={setSelectedPO}>
            <SelectTrigger data-testid="po-select" className="bg-white/5 border-white/10">
              <SelectValue placeholder="-- Pilih PO --" />
            </SelectTrigger>
            <SelectContent>
              {pos.map(po => (
                <SelectItem key={po.id} value={po.id}>
                  {po.po_number} — {po.client_name} ({fmtNum(po.total_qty)} pcs)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {data && (
          <div className="flex gap-2 ml-auto">
            <Button
              onClick={() => exportToPDF(printRef, `laporan-po-${data.po.po_number}`)}
              variant="outline"
              size="sm"
              className="border-white/10"
            >
              <Printer className="w-4 h-4 mr-2" />PDF
            </Button>
          </div>
        )}
      </div>

      {!selectedPO ? (
        <div className="text-center py-12 text-slate-500">
          <FileText className="w-12 h-12 mx-auto opacity-20 mb-3" />
          <p>Pilih PO untuk melihat laporan detail</p>
        </div>
      ) : loading ? (
        <div className="text-center py-12 text-slate-400">
          <Loader2 className="w-8 h-8 mx-auto animate-spin mb-3" />Memuat...
        </div>
      ) : data ? (
        <div ref={printRef} className="space-y-4 bg-[#0f1117] p-4 rounded-lg">
          <div className="border-b border-white/10 pb-3">
            <h2 className="text-xl font-bold text-white">Laporan PO — {data.po.po_number}</h2>
            <p className="text-sm text-slate-400 mt-1">{data.po.client_name}</p>
            <p className="text-xs text-slate-500 mt-1">Diunduh: {new Date().toLocaleString('id-ID')}</p>
          </div>

          {/* Progress Cards */}
          <div className="grid grid-cols-4 gap-3">
            <GlassCard className="p-3">
              <div className="text-[10px] text-slate-400">Target</div>
              <div className="text-2xl font-bold text-blue-300">{fmtNum(data.progress.target_qty)}</div>
            </GlassCard>
            <GlassCard className="p-3">
              <div className="text-[10px] text-slate-400">Diproduksi</div>
              <div className="text-2xl font-bold text-violet-300">{fmtNum(data.progress.qty_produced)}</div>
              <div className="text-[10px] text-slate-500 mt-1">{fmtPct(data.progress.production_pct)}</div>
            </GlassCard>
            <GlassCard className="p-3">
              <div className="text-[10px] text-slate-400">Dispatched</div>
              <div className="text-2xl font-bold text-cyan-300">{fmtNum(data.progress.qty_dispatched)}</div>
              <div className="text-[10px] text-slate-500 mt-1">{fmtPct(data.progress.dispatch_pct)}</div>
            </GlassCard>
            <GlassCard className="p-3">
              <div className="text-[10px] text-slate-400">Sisa</div>
              <div className="text-2xl font-bold text-amber-300">{fmtNum(data.progress.qty_remaining)}</div>
            </GlassCard>
          </div>

          {/* Progress Bar */}
          <GlassCard className="p-4">
            <div className="flex justify-between text-xs text-slate-400 mb-2">
              <span>Progress Dispatch</span>
              <span>{fmtPct(data.progress.dispatch_pct)}</span>
            </div>
            <div className="h-3 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500"
                style={{ width: `${Math.min(100, data.progress.dispatch_pct)}%` }}
              />
            </div>
          </GlassCard>

          <div className="grid grid-cols-2 gap-4">
            {/* PO Items */}
            <GlassCard className="p-4">
              <h3 className="text-sm font-semibold text-white mb-3">Item PO ({(data.po.items || []).length})</h3>
              <div className="overflow-x-auto max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="text-left py-2 px-2 text-slate-400">Artikel</th>
                      <th className="text-right py-2 px-2 text-slate-400">Qty</th>
                      <th className="text-right py-2 px-2 text-slate-400">Dispatched</th>
                      <th className="text-left py-2 px-2 text-slate-400">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.po.items || []).map(it => (
                      <tr key={it.item_id} className="border-b border-white/5">
                        <td className="py-2 px-2 text-white">{it.artikel}</td>
                        <td className="py-2 px-2 text-right font-mono">{fmtNum(it.qty)}</td>
                        <td className="py-2 px-2 text-right font-mono text-cyan-300">{fmtNum(it.qty_dispatched)}</td>
                        <td className="py-2 px-2">
                          <Badge className="text-[9px] bg-white/10">{it.status}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </GlassCard>

            {/* Dispatches */}
            <GlassCard className="p-4">
              <h3 className="text-sm font-semibold text-white mb-3">Riwayat Dispatch ({data.dispatches.length})</h3>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {data.dispatches.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-4">Belum ada dispatch</p>
                ) : data.dispatches.map(d => (
                  <div key={d.id} className="bg-white/5 rounded-lg p-2 border border-white/10">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-mono text-white">{d.dispatch_number}</span>
                      <Badge className="text-[9px] bg-cyan-500/20 text-cyan-300">{d.status}</Badge>
                    </div>
                    <div className="text-[10px] text-slate-400">
                      📅 {fmtDate(d.dispatch_date)} • 📦 {fmtNum(d.qty)} pcs
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>
          </div>

          {/* Finance */}
          <GlassCard className="p-4">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <DollarSign className="w-4 h-4" /> Status Finance
            </h3>
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div>
                <div className="text-slate-400">AR Invoice</div>
                <div className="text-white font-mono">{data.finance.ar_invoice_number || '-'}</div>
              </div>
              <div>
                <div className="text-slate-400">Payment Status</div>
                <Badge className={
                  data.finance.payment_status === 'paid' ? 'bg-green-500/20 text-green-300' :
                  data.finance.payment_status === 'partial' ? 'bg-amber-500/20 text-amber-300' :
                  'bg-red-500/20 text-red-300'
                }>{data.finance.payment_status}</Badge>
              </div>
              <div>
                <div className="text-slate-400">GL Posted</div>
                <Badge className={data.finance.gl_posted ? 'bg-green-500/20 text-green-300' : 'bg-slate-500/20 text-slate-300'}>
                  {data.finance.gl_posted ? 'Sudah Posted' : 'Belum Posted'}
                </Badge>
              </div>
              <div>
                <div className="text-slate-400">Total Value</div>
                <div className="text-cyan-300 font-mono">{fmtCurrency(data.po.total_value)}</div>
              </div>
              <div>
                <div className="text-slate-400">Paid</div>
                <div className="text-green-300 font-mono">{fmtCurrency(data.finance.amount_paid)}</div>
              </div>
              <div>
                <div className="text-slate-400">Outstanding</div>
                <div className="text-amber-300 font-mono">{fmtCurrency(data.finance.outstanding)}</div>
              </div>
            </div>
          </GlassCard>
        </div>
      ) : null}
    </div>
  );
}

// ─── 4. ACTUAL VS TARGET ───────────────────────────────────────────────────────
function ActualVsTargetTab({ headers }) {
  const now = new Date();
  const [period, setPeriod] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/dewi/reports/actual-vs-target?period=${period}`, { headers });
      if (r.ok) setData(await r.json());
    } catch (e) {
      toast.error('Network error');
    } finally {
      setLoading(false);
    }
  }, [period, headers]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3 flex-wrap">
        <div className="space-y-1.5">
          <Label className="text-xs text-slate-300">Periode (YYYY-MM)</Label>
          <Input
            data-testid="period-input"
            value={period}
            onChange={e => setPeriod(e.target.value)}
            placeholder="2026-05"
            className="bg-white/5 border-white/10 w-32 font-mono"
          />
        </div>
        <Button onClick={fetchData} disabled={loading} variant="outline" className="border-white/10">
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />Refresh
        </Button>
        {data && (
          <Button
            onClick={() => {
              const wb = XLSX.utils.book_new();
              if (data.cmt_jobs?.length) {
                XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.cmt_jobs), 'CMT Jobs');
              }
              if (data.maklon_pos?.length) {
                XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.maklon_pos), 'Maklon POs');
              }
              XLSX.writeFile(wb, `actual-vs-target-${period}.xlsx`);
              toast.success('Excel diunduh');
            }}
            variant="outline"
            size="sm"
            className="border-white/10 ml-auto"
          >
            <FileSpreadsheet className="w-4 h-4 mr-2" />Excel
          </Button>
        )}
      </div>

      {loading || !data ? (
        <div className="text-center py-12 text-slate-400">
          <Loader2 className="w-8 h-8 mx-auto animate-spin mb-3" />Memuat...
        </div>
      ) : (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-4 gap-3">
            <GlassCard className="p-3">
              <div className="text-[10px] text-slate-400">CMT: Target Total</div>
              <div className="text-xl font-bold text-blue-300">{fmtNum(data.summary.cmt_total_target)}</div>
            </GlassCard>
            <GlassCard className="p-3">
              <div className="text-[10px] text-slate-400">CMT: Actual</div>
              <div className="text-xl font-bold text-cyan-300">{fmtNum(data.summary.cmt_total_actual)}</div>
            </GlassCard>
            <GlassCard className="p-3">
              <div className="text-[10px] text-slate-400">Maklon: Target</div>
              <div className="text-xl font-bold text-violet-300">{fmtNum(data.summary.maklon_total_target)}</div>
            </GlassCard>
            <GlassCard className="p-3">
              <div className="text-[10px] text-slate-400">Maklon: Dispatched</div>
              <div className="text-xl font-bold text-emerald-300">{fmtNum(data.summary.maklon_total_dispatched)}</div>
            </GlassCard>
          </div>

          {/* CMT Jobs Comparison */}
          <GlassCard className="p-4">
            <h3 className="text-sm font-semibold text-white mb-3">CMT Jobs: Target vs Actual ({data.cmt_jobs.length})</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left py-2 px-2 text-slate-400">Job</th>
                    <th className="text-left py-2 px-2 text-slate-400">Produk</th>
                    <th className="text-left py-2 px-2 text-slate-400">Vendor</th>
                    <th className="text-right py-2 px-2 text-slate-400">Target</th>
                    <th className="text-right py-2 px-2 text-slate-400">Actual</th>
                    <th className="text-right py-2 px-2 text-slate-400">Variance</th>
                    <th className="text-right py-2 px-2 text-slate-400">%</th>
                  </tr>
                </thead>
                <tbody>
                  {data.cmt_jobs.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-4 text-slate-500">Belum ada data</td></tr>
                  ) : data.cmt_jobs.map(j => (
                    <tr key={j.job_id} className="border-b border-white/5">
                      <td className="py-2 px-2 font-mono text-white">{j.job_code}</td>
                      <td className="py-2 px-2 text-slate-300">{j.product_name}</td>
                      <td className="py-2 px-2 text-slate-400">{j.cmt_name}</td>
                      <td className="py-2 px-2 text-right font-mono text-blue-300">{fmtNum(j.target)}</td>
                      <td className="py-2 px-2 text-right font-mono text-cyan-300">{fmtNum(j.actual)}</td>
                      <td className={`py-2 px-2 text-right font-mono ${j.variance >= 0 ? 'text-green-300' : 'text-red-300'}`}>
                        {j.variance >= 0 ? '+' : ''}{fmtNum(j.variance)}
                      </td>
                      <td className="py-2 px-2 text-right">
                        <Badge className={
                          j.achievement_pct >= 100 ? 'bg-green-500/20 text-green-300' :
                          j.achievement_pct >= 75 ? 'bg-amber-500/20 text-amber-300' :
                          'bg-red-500/20 text-red-300'
                        }>{fmtPct(j.achievement_pct)}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </GlassCard>

          {/* Maklon PO Comparison */}
          <GlassCard className="p-4">
            <h3 className="text-sm font-semibold text-white mb-3">Maklon PO: Target vs Dispatch ({data.maklon_pos.length})</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left py-2 px-2 text-slate-400">PO</th>
                    <th className="text-left py-2 px-2 text-slate-400">Klien</th>
                    <th className="text-right py-2 px-2 text-slate-400">Target</th>
                    <th className="text-right py-2 px-2 text-slate-400">Dispatched</th>
                    <th className="text-right py-2 px-2 text-slate-400">Sisa</th>
                    <th className="text-right py-2 px-2 text-slate-400">%</th>
                    <th className="text-left py-2 px-2 text-slate-400">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.maklon_pos.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-4 text-slate-500">Belum ada data</td></tr>
                  ) : data.maklon_pos.map(p => (
                    <tr key={p.po_id} className="border-b border-white/5">
                      <td className="py-2 px-2 font-mono text-white">{p.po_number}</td>
                      <td className="py-2 px-2 text-slate-300">{p.client_name}</td>
                      <td className="py-2 px-2 text-right font-mono text-blue-300">{fmtNum(p.target_qty)}</td>
                      <td className="py-2 px-2 text-right font-mono text-cyan-300">{fmtNum(p.dispatched_qty)}</td>
                      <td className="py-2 px-2 text-right font-mono text-amber-300">{fmtNum(p.remaining_qty)}</td>
                      <td className="py-2 px-2 text-right">
                        <Badge className={
                          p.achievement_pct >= 100 ? 'bg-green-500/20 text-green-300' :
                          p.achievement_pct >= 75 ? 'bg-amber-500/20 text-amber-300' :
                          'bg-red-500/20 text-red-300'
                        }>{fmtPct(p.achievement_pct)}</Badge>
                      </td>
                      <td className="py-2 px-2"><Badge className="text-[9px] bg-white/10">{p.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </GlassCard>
        </div>
      )}
    </div>
  );
}

// ─── 5. PRODUCTION TREND ───────────────────────────────────────────────────────
function ProductionTrendTab({ headers }) {
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/dewi/reports/production-trend?days=${days}`, { headers });
      if (r.ok) setData(await r.json());
    } catch (e) {
      toast.error('Network error');
    } finally {
      setLoading(false);
    }
  }, [days, headers]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3 flex-wrap">
        <div className="space-y-1.5">
          <Label className="text-xs text-slate-300">Rentang Hari</Label>
          <Select value={String(days)} onValueChange={v => setDays(parseInt(v))}>
            <SelectTrigger data-testid="trend-days-select" className="bg-white/5 border-white/10 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 hari</SelectItem>
              <SelectItem value="14">14 hari</SelectItem>
              <SelectItem value="30">30 hari</SelectItem>
              <SelectItem value="60">60 hari</SelectItem>
              <SelectItem value="90">90 hari</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={fetchData} disabled={loading} variant="outline" className="border-white/10">
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />Refresh
        </Button>
      </div>

      {loading || !data ? (
        <div className="text-center py-12 text-slate-400">
          <Loader2 className="w-8 h-8 mx-auto animate-spin mb-3" />Memuat trend...
        </div>
      ) : (
        <>
          <GlassCard className="p-4">
            <h3 className="text-sm font-semibold text-white mb-3">
              Trend Produksi Harian — {data.start_date} s/d {data.end_date}
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={data.trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" stroke="#94a3b8" fontSize={10} />
                <YAxis stroke="#94a3b8" fontSize={10} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="total_processed" stroke="#3b82f6" name="Diproses" strokeWidth={2} />
                <Line type="monotone" dataKey="total_passed" stroke="#10b981" name="Lolos QC" strokeWidth={2} />
                <Line type="monotone" dataKey="total_failed" stroke="#ef4444" name="Gagal QC" strokeWidth={2} />
                <Line type="monotone" dataKey="dispatched_qty" stroke="#8b5cf6" name="Dispatched" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </GlassCard>

          <GlassCard className="p-4">
            <h3 className="text-sm font-semibold text-white mb-3">Volume Produksi & Dispatch (Bar)</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={data.trend.slice(-14)}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" stroke="#94a3b8" fontSize={10} />
                <YAxis stroke="#94a3b8" fontSize={10} />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="total_processed" fill="#3b82f6" name="Diproses" />
                <Bar dataKey="dispatched_qty" fill="#8b5cf6" name="Dispatched" />
              </BarChart>
            </ResponsiveContainer>
          </GlassCard>
        </>
      )}
    </div>
  );
}

// ─── MAIN MODULE ───────────────────────────────────────────────────────────────
export default function Phase7ReportingModule({ token }) {
  const headers = useMemo(() => ({
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }), [token]);

  const [tab, setTab] = useState('daily');

  return (
    <div className="space-y-6 p-6" data-testid="phase7-reporting-module">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            Laporan & Dashboard
          </h1>
          <p className="text-sm text-slate-400 mt-1">Phase 7 — Reporting Hub (Harian, Bulanan, Per PO, Actual vs Target)</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-white/5 border border-white/10">
          <TabsTrigger data-testid="tab-daily" value="daily">
            <Calendar className="w-4 h-4 mr-2" />Harian
          </TabsTrigger>
          <TabsTrigger data-testid="tab-monthly" value="monthly">
            <FileText className="w-4 h-4 mr-2" />Bulanan
          </TabsTrigger>
          <TabsTrigger data-testid="tab-per-po" value="per-po">
            <FileSpreadsheet className="w-4 h-4 mr-2" />Per PO
          </TabsTrigger>
          <TabsTrigger data-testid="tab-actual-vs-target" value="actual-target">
            <Target className="w-4 h-4 mr-2" />Actual vs Target
          </TabsTrigger>
          <TabsTrigger data-testid="tab-trend" value="trend">
            <TrendingUp className="w-4 h-4 mr-2" />Trend
          </TabsTrigger>
        </TabsList>

        <TabsContent value="daily" className="mt-4">
          <DailyReportTab headers={headers} token={token} />
        </TabsContent>
        <TabsContent value="monthly" className="mt-4">
          <MonthlyReportTab headers={headers} />
        </TabsContent>
        <TabsContent value="per-po" className="mt-4">
          <PerPOReportTab headers={headers} />
        </TabsContent>
        <TabsContent value="actual-target" className="mt-4">
          <ActualVsTargetTab headers={headers} />
        </TabsContent>
        <TabsContent value="trend" className="mt-4">
          <ProductionTrendTab headers={headers} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
