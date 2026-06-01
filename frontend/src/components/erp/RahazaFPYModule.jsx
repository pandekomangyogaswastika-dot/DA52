import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { RadialBarChart, RadialBar, ResponsiveContainer } from 'recharts';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Target, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

const API = process.env.REACT_APP_BACKEND_URL;

const STATUS_CONFIG = {
  good:     { color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200', icon: CheckCircle, label: 'Baik' },
  warning:  { color: 'text-yellow-600', bg: 'bg-yellow-50', border: 'border-yellow-200', icon: AlertCircle, label: 'Perhatian' },
  critical: { color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200', icon: XCircle, label: 'Kritis' },
};

export default function RahazaFPYModule({ headers }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState('30');
  const [groupBy, setGroupBy] = useState('line');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const from = new Date(Date.now() - parseInt(period) * 86400000).toISOString().slice(0, 10);
      const to   = new Date().toISOString().slice(0, 10);
      const { data: d } = await axios.get(`${API}/api/rahaza/qc/fpy`, { headers, params: { from, to, group_by: groupBy } });
      setData(d);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [headers, period, groupBy]);

  useEffect(() => { load(); }, [load]);

  const overall = data?.overall_fpy_pct || 0;
  const overallStatus = overall >= 95 ? 'good' : overall >= 85 ? 'warning' : 'critical';
  const OvIcon = STATUS_CONFIG[overallStatus].icon;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2"><Target className="w-5 h-5 text-blue-500" /> First Pass Yield (FPY)</h2>
          <p className="text-sm text-muted-foreground">Persentase produk lolos QC tanpa rework — target 95%</p>
        </div>
        <div className="flex gap-2">
          <Select value={groupBy} onValueChange={setGroupBy}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="line">Per Lini</SelectItem>
              <SelectItem value="model">Per Model</SelectItem>
              <SelectItem value="employee">Per Operator</SelectItem>
              <SelectItem value="shift">Per Shift</SelectItem>
            </SelectContent>
          </Select>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 hari</SelectItem>
              <SelectItem value="30">30 hari</SelectItem>
              <SelectItem value="90">90 hari</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={load}>Perbarui</Button>
        </div>
      </div>

      {data && (
        <Card className={`border-2 ${STATUS_CONFIG[overallStatus].border}`}>
          <CardContent className="pt-5">
            <div className="flex items-center gap-4">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center ${STATUS_CONFIG[overallStatus].bg}`}>
                <OvIcon className={`w-8 h-8 ${STATUS_CONFIG[overallStatus].color}`} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Overall FPY</p>
                <p className={`text-4xl font-bold ${STATUS_CONFIG[overallStatus].color}`}>{overall}%</p>
                <p className="text-xs text-muted-foreground">Target: 95%</p>
              </div>
              <div className="flex-1 max-w-xs">
                <Progress value={overall} className="h-3" />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? <div className="text-center py-12 text-muted-foreground">Memuat...</div> : (
        <div className="space-y-3">
          {(data?.data || []).map(row => {
            const cfg = STATUS_CONFIG[row.status] || STATUS_CONFIG.good;
            const Icon = cfg.icon;
            return (
              <Card key={row.group_id} className={`border ${cfg.border}`}>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-4">
                    <Icon className={`w-5 h-5 flex-shrink-0 ${cfg.color}`} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{row.group_name || row.group_id}</p>
                      <p className="text-xs text-muted-foreground">{row.checked_qty} diperiksa · {row.pass_qty} lolos · {row.fail_qty} gagal</p>
                    </div>
                    <div className="text-right flex-shrink-0 w-28">
                      <p className={`text-xl font-bold ${cfg.color}`}>{row.fpy_pct}%</p>
                      <Progress value={row.fpy_pct} className="h-1.5 mt-1" />
                      <p className="text-xs text-muted-foreground mt-0.5">target {row.target_fpy_pct}%</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {(data?.data || []).length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Target className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p>Belum ada data QC dalam periode ini.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
