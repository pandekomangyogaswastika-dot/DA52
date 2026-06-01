import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, ComposedChart } from 'recharts';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart3, AlertCircle, TrendingDown } from 'lucide-react';

const API = process.env.REACT_APP_BACKEND_URL;

const SEVERITY_COLOR = { critical: '#ef4444', major: '#f97316', minor: '#eab308' };

export default function RahazaParetoModule({ headers }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState('30');
  const [lines, setLines] = useState([]);
  const [lineId, setLineId] = useState('');

  const loadLines = useCallback(async () => {
    try { const { data } = await axios.get(`${API}/api/rahaza/lines`, { headers }); setLines(data || []); } catch (e) {}
  }, [headers]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const from = new Date(Date.now() - parseInt(period) * 86400000).toISOString().slice(0, 10);
      const to   = new Date().toISOString().slice(0, 10);
      const params = { from, to };
      if (lineId && lineId !== '__all__') params.line_id = lineId;
      const { data: d } = await axios.get(`${API}/api/rahaza/qc/pareto`, { headers, params });
      setData(d);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [headers, period, lineId]);

  useEffect(() => { loadLines(); }, [loadLines]);
  useEffect(() => { load(); }, [load]);

  const chartData = (data?.pareto || []).map(p => ({
    name: p.code,
    fullName: p.name,
    count: p.count,
    cumulative: p.cumulative_pct,
    fill: SEVERITY_COLOR[p.severity] || '#6366f1',
  }));

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2"><TrendingDown className="w-5 h-5 text-red-500" /> Analisis Pareto Cacat</h2>
          <p className="text-sm text-muted-foreground">Top defect categories — prinsip 80/20</p>
        </div>
        <div className="flex gap-2">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 hari</SelectItem>
              <SelectItem value="30">30 hari</SelectItem>
              <SelectItem value="90">90 hari</SelectItem>
            </SelectContent>
          </Select>
          <Select value={lineId || '__all__'} onValueChange={v => setLineId(v === '__all__' ? '' : v)}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Semua Lini" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Semua Lini</SelectItem>
              {lines.map(l => <SelectItem key={l.id} value={l.id}>{l.name || l.code}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={load} size="sm">Perbarui</Button>
        </div>
      </div>

      {data && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Diperiksa', value: data.total_checked?.toLocaleString() || 0 },
            { label: 'Total Gagal', value: data.total_fail?.toLocaleString() || 0 },
            { label: 'Fail Rate', value: `${data.fail_rate_pct || 0}%` },
            { label: 'Total Event QC', value: data.total_events?.toLocaleString() || 0 },
          ].map(s => (
            <Card key={s.label}><CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-2xl font-bold">{s.value}</p>
            </CardContent></Card>
          ))}
        </div>
      )}

      {loading ? <div className="text-center py-12 text-muted-foreground">Memuat...</div> : chartData.length > 0 ? (
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">Pareto Chart — Jumlah Defect per Kode</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={chartData} margin={{ top: 10, right: 40, bottom: 20, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.1} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value, name) => [name === 'cumulative' ? `${value}%` : value, name === 'cumulative' ? 'Kumulatif' : 'Jumlah']}
                  labelFormatter={label => chartData.find(d => d.name === label)?.fullName || label} />
                <Bar yAxisId="left" dataKey="count" fill="#6366f1" radius={[3,3,0,0]} />
                <Line yAxisId="right" type="monotone" dataKey="cumulative" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      ) : null}

      {data?.pareto?.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">Detail Defect</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b">
                  <th className="text-left py-2 font-medium">Kode</th>
                  <th className="text-left py-2 font-medium">Nama</th>
                  <th className="text-left py-2 font-medium">Kategori</th>
                  <th className="text-left py-2 font-medium">Severity</th>
                  <th className="text-right py-2 font-medium">Jumlah</th>
                  <th className="text-right py-2 font-medium">%</th>
                  <th className="text-right py-2 font-medium">Kumulatif</th>
                </tr></thead>
                <tbody>
                  {data.pareto.map((p, i) => (
                    <tr key={i} className="border-t hover:bg-muted/30">
                      <td className="py-2 font-mono text-xs">{p.code}</td>
                      <td className="py-2">{p.name}</td>
                      <td className="py-2 text-muted-foreground text-xs">{p.category}</td>
                      <td className="py-2"><span className="text-xs px-1.5 py-0.5 rounded" style={{ background: `${SEVERITY_COLOR[p.severity]}20`, color: SEVERITY_COLOR[p.severity] }}>{p.severity}</span></td>
                      <td className="py-2 text-right font-medium">{p.count}</td>
                      <td className="py-2 text-right">{p.percentage}%</td>
                      <td className="py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 bg-muted rounded-full h-1.5">
                            <div className="h-1.5 rounded-full bg-orange-400" style={{ width: `${p.cumulative_pct}%` }} />
                          </div>
                          {p.cumulative_pct}%
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {!loading && chartData.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p>Belum ada data QC dengan kode cacat tercatat dalam periode ini.</p>
          <p className="text-xs mt-1">Pastikan sudah ada event QC dengan defect_code_ids terisi.</p>
        </div>
      )}
    </div>
  );
}
