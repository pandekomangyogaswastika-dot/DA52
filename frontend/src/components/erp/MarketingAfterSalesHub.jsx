/**
 * MarketingAfterSalesHub.jsx
 * Consolidation #9: Komplain + Returns & Refunds + Resolution Log
 * Replaces: marketing-complaints + marketing-returns (2 sidebar entries → 1)
 */
import React, { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, RotateCcw, CheckCircle2, RefreshCw, Loader2 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import ComplaintsManagementModule from './marketing/ComplaintsManagementModule';
import ReturnsRefundsModule from './marketing/ReturnsRefundsModule';
import axios from 'axios';

const API = process.env.REACT_APP_BACKEND_URL;

// ── Resolution Log Tab ──────────────────────────────────────────────────────
const STATUS_LABEL = {
  resolved: { label: 'Diselesaikan', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  closed:   { label: 'Ditutup',      color: 'bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400' },
  completed:{ label: 'Selesai',      color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  rejected: { label: 'Ditolak',      color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
};

function ResolutionLogTab({ token }) {
  const authH = { Authorization: `Bearer ${token || localStorage.getItem('auth_token')}` };
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchLog = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, rRes] = await Promise.all([
        axios.get(`${API}/api/marketing/complaints`, {
          params: { status: 'resolved', page_size: 15 }, headers: authH
        }).catch(() => ({ data: { complaints: [] } })),
        axios.get(`${API}/api/marketing/returns`, {
          params: { status: 'completed', page_size: 15 }, headers: authH
        }).catch(() => ({ data: { data: [] } })),
      ]);

      const complaints = (cRes.data?.complaints || []).map(c => ({
        id: c.id,
        type: 'complaint',
        title: c.complaint_number || 'Komplain',
        summary: `${c.customer_name || '-'} • ${c.product_name || '-'}`,
        status: c.status,
        date: c.updated_at || c.complaint_date,
        platform: c.platform,
      }));

      const returns = (rRes.data?.data || []).map(r => ({
        id: r.id,
        type: 'return',
        title: `Return #${r.order_id || '?'}`,
        summary: `${r.product || '-'} • Rp ${(r.refund_amount || 0).toLocaleString('id-ID')}`,
        status: r.status,
        date: r.updated_at || r.date,
        platform: r.platform,
      }));

      const merged = [...complaints, ...returns]
        .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
        .slice(0, 25);

      setItems(merged);
    } finally {
      setLoading(false);
    }
  }, [token]); // eslint-disable-line

  useEffect(() => { fetchLog(); }, [fetchLog]);

  if (loading) return (
    <div className="flex items-center justify-center h-48">
      <Loader2 className="animate-spin text-muted-foreground" size={24} />
    </div>
  );

  if (items.length === 0) return (
    <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
      <CheckCircle2 size={32} className="opacity-30 mb-2" />
      <p className="text-sm">Belum ada riwayat penyelesaian</p>
    </div>
  );

  return (
    <div className="p-4 space-y-2" data-testid="resolution-log">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">Log Penyelesaian</h2>
          <p className="text-sm text-muted-foreground">Riwayat komplain & return yang sudah ditangani</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchLog}>
          <RefreshCw size={13} className="mr-1" /> Refresh
        </Button>
      </div>
      {items.map(item => (
        <div
          key={`${item.type}-${item.id}`}
          className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/30 transition-colors"
          data-testid={`log-item-${item.type}-${item.id}`}
        >
          <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
            item.type === 'complaint' ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-blue-100 dark:bg-blue-900/30'
          }`}>
            {item.type === 'complaint'
              ? <AlertTriangle size={14} className="text-amber-600" />
              : <RotateCcw size={14} className="text-blue-600" />
            }
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium">{item.title}</span>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                STATUS_LABEL[item.status]?.color || 'bg-gray-100 text-gray-600'
              }`}>
                {STATUS_LABEL[item.status]?.label || item.status}
              </span>
              <span className="text-xs text-muted-foreground capitalize">{item.platform || '-'}</span>
            </div>
            <p className="text-xs text-muted-foreground truncate mt-0.5">{item.summary}</p>
          </div>
          <div className="text-xs text-muted-foreground flex-shrink-0 text-right">
            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium mr-2 ${
              item.type === 'complaint'
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
            }`}>
              {item.type === 'complaint' ? 'Komplain' : 'Return'}
            </span>
            {item.date ? new Date(item.date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: '2-digit' }) : '-'}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Hub Component ──────────────────────────────────────────────────────
export default function MarketingAfterSalesHub({ token }) {
  const authH = { Authorization: `Bearer ${token || localStorage.getItem('auth_token')}` };
  const [openComplaints, setOpenComplaints] = useState(0);
  const [pendingReturns, setPendingReturns] = useState(0);
  const [activeTab, setActiveTab] = useState('complaints');

  useEffect(() => {
    // Fetch summary counts for badge indicators
    axios.get(`${API}/api/marketing/complaints/summary`, { headers: authH })
      .then(r => setOpenComplaints((r.data?.by_status?.open || 0) + (r.data?.by_status?.in_progress || 0)))
      .catch(() => {});
    axios.get(`${API}/api/marketing/returns/summary`, { headers: authH })
      .then(r => setPendingReturns(r.data?.data?.pending || 0))
      .catch(() => {});
  }, [token]); // eslint-disable-line

  return (
    <div className="h-full" data-testid="after-sales-hub">
      {/* Hub Header */}
      <div className="px-4 md:px-6 py-4 border-b bg-background">
        <h1 className="text-xl font-bold tracking-tight">Komplain & Returns</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Pengelolaan pasca-penjualan: komplain pelanggan dan retur produk dalam satu tampilan terpadu
        </p>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
        <div className="px-4 md:px-6 pt-4 border-b bg-background">
          <TabsList className="h-9">
            <TabsTrigger value="complaints" className="gap-1.5" data-testid="tab-complaints">
              <AlertTriangle size={13} />
              Komplain
              {openComplaints > 0 && (
                <Badge variant="destructive" className="ml-1 h-4 min-w-4 px-1 text-[10px]">
                  {openComplaints}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="returns" className="gap-1.5" data-testid="tab-returns">
              <RotateCcw size={13} />
              Returns & Refunds
              {pendingReturns > 0 && (
                <Badge variant="secondary" className="ml-1 h-4 min-w-4 px-1 text-[10px]">
                  {pendingReturns}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="log" className="gap-1.5" data-testid="tab-resolution-log">
              <CheckCircle2 size={13} />
              Log Penyelesaian
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="complaints" className="flex-1 overflow-auto m-0 p-0">
          <ComplaintsManagementModule token={token} />
        </TabsContent>
        <TabsContent value="returns" className="flex-1 overflow-auto m-0 p-0 pt-4">
          <div className="px-4 md:px-6">
            <ReturnsRefundsModule token={token} />
          </div>
        </TabsContent>
        <TabsContent value="log" className="flex-1 overflow-auto m-0">
          <Card className="m-4 md:m-6">
            <CardContent className="p-0">
              <ResolutionLogTab token={token} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
