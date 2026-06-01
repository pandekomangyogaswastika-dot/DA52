import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { AlertTriangle, CheckCircle, Clock, TrendingUp, Siren, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const API = process.env.REACT_APP_BACKEND_URL;

const RISK_CONFIG = {
  overdue:  { color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200', badge: 'destructive', label: 'Overdue', Icon: AlertTriangle },
  at_risk:  { color: 'text-yellow-600', bg: 'bg-yellow-50', border: 'border-yellow-200', badge: 'outline', label: 'Berisiko', Icon: Clock },
  on_track: { color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200', badge: 'secondary', label: 'On Track', Icon: CheckCircle },
};

export default function RahazaBacklogModule({ headers }) {
  const { toast } = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: d } = await axios.get(`${API}/api/rahaza/backlog`, { headers, params: { status: filter } });
      setData(d);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [headers, filter]);

  useEffect(() => { load(); }, [load]);

  const handleEscalate = async (woId, woNum) => {
    try {
      await axios.post(`${API}/api/rahaza/backlog/escalate/${woId}`, {}, { headers });
      toast({ title: `WO ${woNum} berhasil dieskalasi ke PPIC` });
    } catch (e) { toast({ title: 'Gagal eskalasi', variant: 'destructive' }); }
  };

  const summary = data?.summary || {};
  const items   = data?.data || [];

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2"><TrendingUp className="w-5 h-5 text-blue-500" /> Backlog & Forecast Produksi</h2>
          <p className="text-sm text-muted-foreground">WO aktif dengan risk scoring & prediksi penyelesaian</p>
        </div>
        <div className="flex gap-2">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Status</SelectItem>
              <SelectItem value="released">Released</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={load}><RefreshCw className="w-4 h-4" /></Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total WO', value: summary.total || 0, color: 'text-foreground' },
          { label: 'Overdue', value: summary.overdue || 0, color: 'text-red-600' },
          { label: 'Berisiko', value: summary.at_risk || 0, color: 'text-yellow-600' },
          { label: 'On Track', value: summary.on_track || 0, color: 'text-green-600' },
        ].map(s => (
          <Card key={s.label}><CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          </CardContent></Card>
        ))}
      </div>

      {loading ? <div className="text-center py-12 text-muted-foreground">Memuat...</div> : (
        <div className="space-y-3">
          {items.map(wo => {
            const cfg = RISK_CONFIG[wo.risk] || RISK_CONFIG.on_track;
            const Icon = cfg.Icon;
            return (
              <Card key={wo.id} className={`border-l-4 ${cfg.border}`}>
                <CardContent className="pt-4">
                  <div className="flex items-start gap-4">
                    <Icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${cfg.color}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-sm">{wo.wo_number}</span>
                        <Badge variant={cfg.badge} className="text-xs">{cfg.label}</Badge>
                        <span className="text-xs text-muted-foreground">{wo.status}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {wo.model_name} · {wo.size_name} · {wo.customer_name || wo.order_number}
                        {wo.line_name && <> · Lini: <strong>{wo.line_name}</strong></>}
                      </p>
                      <div className="mt-2 flex items-center gap-3">
                        <div className="flex-1">
                          <div className="flex justify-between text-xs text-muted-foreground mb-1">
                            <span>{wo.qty_produced} / {wo.qty} pcs</span>
                            <span>{wo.pct_complete}%</span>
                          </div>
                          <Progress value={wo.pct_complete} className="h-1.5" />
                        </div>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0 space-y-1">
                      <div className="text-xs text-muted-foreground">
                        <div>Due: <strong className={wo.risk === 'overdue' ? 'text-red-600' : ''}>{wo.due_date?.slice(0, 10) || '-'}</strong></div>
                        <div>Forecast: <strong>{wo.forecast_date}</strong></div>
                        <div className="text-muted-foreground">{wo.avg_daily_output} pcs/hari avg</div>
                      </div>
                      {wo.risk !== 'on_track' && (
                        <Button
                          variant="outline" size="sm"
                          className="text-xs h-7"
                          onClick={() => handleEscalate(wo.id, wo.wo_number)}
                        >
                          <Siren className="w-3 h-3 mr-1" /> Eskalasi
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {items.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <CheckCircle className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p>Tidak ada WO aktif dalam backlog.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
