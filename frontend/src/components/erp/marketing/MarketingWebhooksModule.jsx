/**
 * MarketingWebhooksModule — Phase 1/2: Webhook Events Monitor
 *
 * Monitor dan kelola event webhook dari marketplace (Tokopedia, Shopee, TikTok).
 * Mendukung reprocess event yang gagal dan manual ingest untuk testing.
 */
import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  Zap, RefreshCw, CheckCircle2, XCircle, Clock,
  AlertTriangle, Send, ChevronRight, Eye, RotateCcw,
  Filter, Search, Copy, ExternalLink,
} from 'lucide-react';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '../../ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../ui/select';
import { Textarea } from '../../ui/textarea';
import { useToast } from '../../../hooks/use-toast';

const API = process.env.REACT_APP_BACKEND_URL || '';

const PLATFORM_COLORS = {
  tokopedia: 'bg-green-500/15 text-green-400 border-green-500/30',
  shopee:    'bg-orange-500/15 text-orange-400 border-orange-500/30',
  tiktok:    'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
  manual:    'bg-blue-500/15 text-blue-400 border-blue-500/30',
};

const PLATFORM_LABELS = {
  tokopedia: '🟢 Tokopedia',
  shopee:    '🟠 Shopee',
  tiktok:    '⚫ TikTok',
  manual:    '🔵 Manual',
};

function StatusBadge({ processed, error }) {
  if (error === 'duplicate') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-zinc-500/20 text-zinc-400">
      <Copy className="w-3 h-3" /> Duplikat
    </span>
  );
  if (error) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-red-500/15 text-red-400">
      <XCircle className="w-3 h-3" /> Error
    </span>
  );
  if (processed) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-emerald-500/15 text-emerald-400">
      <CheckCircle2 className="w-3 h-3" /> Processed
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-amber-500/15 text-amber-400">
      <Clock className="w-3 h-3" /> Pending
    </span>
  );
}

export default function MarketingWebhooksModule({ user, headers }) {
  const [events, setEvents] = useState([]);
  const [stats, setStats] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filterPlatform, setFilterPlatform] = useState('');
  const [filterProcessed, setFilterProcessed] = useState('');
  const [search, setSearch] = useState('');
  const [skip, setSkip] = useState(0);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [showManualIngest, setShowManualIngest] = useState(false);
  const [manualForm, setManualForm] = useState({ platform: 'tokopedia', payload: '' });
  const [manualSending, setManualSending] = useState(false);
  const { toast } = useToast();
  const authH = headers || {};

  const LIMIT = 20;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = { skip, limit: LIMIT };
      if (filterPlatform) params.platform = filterPlatform;
      if (filterProcessed !== '') params.processed = filterProcessed === 'true';

      const [evtRes, statsRes] = await Promise.all([
        axios.get(`${API}/api/marketing/webhooks/events`, { headers: authH, params }),
        axios.get(`${API}/api/marketing/webhooks/stats`, { headers: authH }),
      ]);
      setEvents(evtRes.data?.data || []);
      setTotal(evtRes.data?.total || 0);
      setStats(statsRes.data?.data || []);
    } catch (e) {
      toast({ title: 'Error', description: e.response?.data?.detail || 'Gagal load data', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [skip, filterPlatform, filterProcessed, authH, toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleReprocess = async (eventId) => {
    try {
      await axios.post(`${API}/api/marketing/webhooks/events/${eventId}/reprocess`, {}, { headers: authH });
      toast({ title: 'Berhasil', description: 'Event di-queue untuk reprocess.' });
      fetchData();
    } catch (e) {
      toast({ title: 'Error', description: e.response?.data?.detail || 'Gagal reprocess', variant: 'destructive' });
    }
  };

  const handleManualIngest = async () => {
    setManualSending(true);
    try {
      let parsedPayload;
      try { parsedPayload = JSON.parse(manualForm.payload); }
      catch { throw new Error('Payload bukan JSON valid.'); }
      const res = await axios.post(
        `${API}/api/marketing/webhooks/manual`,
        { platform: manualForm.platform, event_type: 'order.new', payload: parsedPayload },
        { headers: authH },
      );
      toast({ title: 'Berhasil', description: `Event diterima. ID: ${res.data.event_id}` });
      setShowManualIngest(false);
      setManualForm({ platform: 'tokopedia', payload: '' });
      fetchData();
    } catch (e) {
      toast({ title: 'Error', description: e.message || e.response?.data?.detail || 'Gagal ingest', variant: 'destructive' });
    } finally {
      setManualSending(false);
    }
  };

  const TOKOPEDIA_SAMPLE = JSON.stringify({
    message: "Push Notification Tokopedia",
    message_id: `tokped-test-${Date.now()}`,
    order: {
      order_id: Math.floor(Math.random() * 9000000 + 1000000),
      invoice_ref_num: `INV/TEST/${Date.now()}`,
      order_status: 10,
      buyer: { name: "Test Buyer" },
      total_amount: 150000,
      products: [{ product_id: "SKU-001", name: "Test Product", quantity: 1, subtotal: 150000 }],
      est_start_delivery: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
    },
  }, null, 2);

  const SHOPEE_SAMPLE = JSON.stringify({
    code: "ORDER_STATUS_UPDATE",
    shop_id: 12345,
    data: {
      ordersn: `TEST${Date.now()}`,
      status: "READY_TO_SHIP",
      buyer_username: "test_buyer",
      total_amount: 200000,
      ship_by_date: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
      item_list: [{ item_sku: "SKU-002", item_name: "Test Item", model_quantity_purchased: 2, model_discounted_price: 100000 }],
    },
  }, null, 2);

  const filtered = search
    ? events.filter(e =>
        (e.platform || '').includes(search.toLowerCase()) ||
        (e.event_type || '').includes(search.toLowerCase()) ||
        (e.id || '').includes(search)
      )
    : events;

  return (
    <div className="p-4 md:p-6 space-y-6 text-white">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Zap className="text-amber-400" /> Webhook Events Monitor
          </h2>
          <p className="text-sm text-zinc-400 mt-1">Monitor inbound events dari Tokopedia, Shopee, TikTok Shop</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline" size="sm"
            onClick={() => setShowManualIngest(true)}
            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            data-testid="btn-manual-ingest"
          >
            <Send className="w-4 h-4 mr-1" /> Test Ingest
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={fetchData}
            disabled={loading}
            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            data-testid="btn-refresh-webhooks"
          >
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.length === 0 ? (
          <div className="col-span-4 text-center text-zinc-500 text-sm py-4">Belum ada webhook events</div>
        ) : stats.map(s => (
          <Card key={s.platform} className="bg-zinc-900 border-zinc-800">
            <CardContent className="pt-4 pb-3">
              <div className="text-xs text-zinc-400 mb-1">{PLATFORM_LABELS[s.platform] || s.platform}</div>
              <div className="text-2xl font-bold">{s.total}</div>
              <div className="flex justify-between text-xs text-zinc-500 mt-1">
                <span className="text-emerald-400">{s.processed} OK</span>
                <span className={s.errors > 0 ? 'text-red-400' : 'text-zinc-500'}>{s.errors} err</span>
                <span>{s.success_rate}%</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <Input
            placeholder="Cari platform / event type / ID..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 bg-zinc-900 border-zinc-700 text-sm"
            data-testid="input-webhook-search"
          />
        </div>
        <Select value={filterPlatform} onValueChange={v => { setFilterPlatform(v === 'all' ? '' : v); setSkip(0); }}>
          <SelectTrigger className="w-36 bg-zinc-900 border-zinc-700 text-sm" data-testid="select-platform">
            <SelectValue placeholder="Platform" />
          </SelectTrigger>
          <SelectContent className="bg-zinc-900 border-zinc-800">
            <SelectItem value="all">Semua Platform</SelectItem>
            <SelectItem value="tokopedia">Tokopedia</SelectItem>
            <SelectItem value="shopee">Shopee</SelectItem>
            <SelectItem value="tiktok">TikTok</SelectItem>
            <SelectItem value="manual">Manual</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterProcessed} onValueChange={v => { setFilterProcessed(v === 'all' ? '' : v); setSkip(0); }}>
          <SelectTrigger className="w-32 bg-zinc-900 border-zinc-700 text-sm">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent className="bg-zinc-900 border-zinc-800">
            <SelectItem value="all">Semua Status</SelectItem>
            <SelectItem value="true">Processed</SelectItem>
            <SelectItem value="false">Pending/Error</SelectItem>
          </SelectContent>
        </Select>
        <div className="text-xs text-zinc-500">{total} total events</div>
      </div>

      {/* Events Table */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardContent className="p-0">
          {loading ? (
            <div className="text-center py-10 text-zinc-500">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-10 text-zinc-500">
              <Zap className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p>Belum ada webhook events</p>
              <p className="text-xs mt-1">Klik "Test Ingest" untuk kirim payload sample</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-400 text-xs">
                    <th className="text-left px-4 py-3">Platform</th>
                    <th className="text-left px-4 py-3">Event Type</th>
                    <th className="text-left px-4 py-3">Status</th>
                    <th className="text-left px-4 py-3">Order ID</th>
                    <th className="text-left px-4 py-3">Received</th>
                    <th className="text-right px-4 py-3">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(evt => (
                    <tr key={evt.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded border ${PLATFORM_COLORS[evt.platform] || 'bg-zinc-700 text-zinc-300'}`}>
                          {PLATFORM_LABELS[evt.platform] || evt.platform}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-zinc-300 font-mono text-xs">{evt.event_type || '—'}</td>
                      <td className="px-4 py-3">
                        <StatusBadge processed={evt.processed} error={evt.error} />
                      </td>
                      <td className="px-4 py-3 text-zinc-400 text-xs font-mono">
                        {evt.normalized_order?.platform_order_id || '—'}
                      </td>
                      <td className="px-4 py-3 text-zinc-500 text-xs">
                        {evt.received_at ? new Date(evt.received_at).toLocaleString('id-ID') : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-1 justify-end">
                          <Button
                            variant="ghost" size="sm"
                            className="h-7 w-7 p-0 hover:bg-zinc-700"
                            onClick={() => setSelectedEvent(evt)}
                            data-testid={`btn-view-event-${evt.id}`}
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                          {(evt.error && evt.error !== 'duplicate') && (
                            <Button
                              variant="ghost" size="sm"
                              className="h-7 w-7 p-0 hover:bg-zinc-700 text-amber-400"
                              onClick={() => handleReprocess(evt.id)}
                              data-testid={`btn-reprocess-${evt.id}`}
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline" size="sm"
          disabled={skip === 0}
          onClick={() => setSkip(Math.max(0, skip - LIMIT))}
          className="border-zinc-700 text-zinc-300"
        >Prev</Button>
        <span className="text-xs text-zinc-500">Halaman {Math.floor(skip / LIMIT) + 1}</span>
        <Button
          variant="outline" size="sm"
          disabled={skip + LIMIT >= total}
          onClick={() => setSkip(skip + LIMIT)}
          className="border-zinc-700 text-zinc-300"
        >Next</Button>
      </div>

      {/* Event Detail Dialog */}
      <Dialog open={!!selectedEvent} onOpenChange={o => !o && setSelectedEvent(null)}>
        <DialogContent className="bg-zinc-900 border-zinc-700 max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white">
              Event Detail — {PLATFORM_LABELS[selectedEvent?.platform] || selectedEvent?.platform}
            </DialogTitle>
          </DialogHeader>
          {selectedEvent && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div><span className="text-zinc-500">ID:</span> <span className="font-mono text-zinc-300">{selectedEvent.id}</span></div>
                <div><span className="text-zinc-500">Event:</span> <span className="text-zinc-300">{selectedEvent.event_type}</span></div>
                <div><span className="text-zinc-500">Status:</span> <StatusBadge processed={selectedEvent.processed} error={selectedEvent.error} /></div>
                <div><span className="text-zinc-500">Received:</span> <span className="text-zinc-300">{selectedEvent.received_at ? new Date(selectedEvent.received_at).toLocaleString('id-ID') : '—'}</span></div>
              </div>
              {selectedEvent.error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded p-3">
                  <p className="text-xs text-red-400 font-medium">Error:</p>
                  <p className="text-xs text-zinc-300 mt-1">{selectedEvent.error}</p>
                </div>
              )}
              {selectedEvent.normalized_order && (
                <div>
                  <p className="text-xs text-zinc-500 mb-2">Normalized Order:</p>
                  <pre className="bg-zinc-950 p-3 rounded text-xs text-zinc-300 overflow-x-auto">
                    {JSON.stringify(selectedEvent.normalized_order, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Manual Ingest Dialog */}
      <Dialog open={showManualIngest} onOpenChange={setShowManualIngest}>
        <DialogContent className="bg-zinc-900 border-zinc-700 max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-white">Test Ingest Webhook Payload</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Platform</label>
              <Select
                value={manualForm.platform}
                onValueChange={v => setManualForm(f => ({ ...f, platform: v }))}
              >
                <SelectTrigger className="bg-zinc-800 border-zinc-700" data-testid="select-manual-platform">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-800">
                  <SelectItem value="tokopedia">Tokopedia</SelectItem>
                  <SelectItem value="shopee">Shopee</SelectItem>
                  <SelectItem value="tiktok">TikTok</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs text-zinc-400">JSON Payload</label>
                <button
                  className="text-xs text-blue-400 hover:underline"
                  onClick={() => {
                    const sample = manualForm.platform === 'shopee' ? SHOPEE_SAMPLE : TOKOPEDIA_SAMPLE;
                    setManualForm(f => ({ ...f, payload: sample }));
                  }}
                >Load Sample</button>
              </div>
              <Textarea
                value={manualForm.payload}
                onChange={e => setManualForm(f => ({ ...f, payload: e.target.value }))}
                placeholder='{"order": {...}}'
                rows={8}
                className="bg-zinc-800 border-zinc-700 font-mono text-xs"
                data-testid="textarea-webhook-payload"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setShowManualIngest(false)}>Batal</Button>
              <Button
                onClick={handleManualIngest}
                disabled={manualSending || !manualForm.payload}
                className="bg-amber-600 hover:bg-amber-700 text-white"
                data-testid="btn-submit-manual-ingest"
              >
                {manualSending ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : <Send className="w-4 h-4 mr-1" />}
                Send
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
