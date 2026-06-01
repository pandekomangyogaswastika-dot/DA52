/**
 * DO Management Module — Delivery Orders (Surat Jalan)
 * Phase 2 Enhancement: DO Issue/Receive System
 * 
 * Fitur:
 * - List DOs dengan filter status & partner
 * - Create DO (pilih cutting batch, CMT partner, items)
 * - Issue DO (confirm pengiriman + WIP scan-out)
 * - Receive DO (vendor konfirmasi penerimaan)
 * - View DO detail dengan items & tracking info
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FileText, Truck, CheckCircle2, AlertCircle, Plus, Search, RefreshCw,
  Package, Send, User, Calendar, MapPin, X, Loader2, ScanLine
} from 'lucide-react';
import { GlassCard } from '@/components/ui/glass';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
// Sprint A.1: UniversalScanner SSOT
import UniversalScanner from './scanner/UniversalScanner';

const API = process.env.REACT_APP_BACKEND_URL;

const DO_STATUS = {
  draft: { label: 'Draft', color: 'bg-slate-500/15 text-slate-300', icon: FileText },
  issued: { label: 'Dikirim', color: 'bg-blue-500/15 text-blue-300', icon: Send },
  received: { label: 'Diterima', color: 'bg-green-500/15 text-green-300', icon: CheckCircle2 },
  completed: { label: 'Selesai', color: 'bg-emerald-500/15 text-emerald-300', icon: Package },
  cancelled: { label: 'Batal', color: 'bg-red-500/15 text-red-300', icon: X },
};

function fmtNum(v) { return Number(v || 0).toLocaleString('id-ID'); }
function fmtDate(d) { 
  if (!d) return '-';
  return new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── CREATE DO DIALOG ──────────────────────────────────────────────────────────
function CreateDODialog({ onClose, onSuccess, headers }) {
  const [loading, setLoading] = useState(false);
  const [partners, setPartners] = useState([]);
  const [batches, setBatches] = useState([]);
  const [form, setForm] = useState({
    cmt_partner_id: '',
    cutting_batch_id: '',
    cmt_job_id: '',
    items: [],
    delivery_date: new Date().toISOString().split('T')[0],
    notes: ''
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [partnersRes, batchesRes] = await Promise.all([
          fetch(`${API}/api/dewi/cmt/partners`, { headers }),
          fetch(`${API}/api/dewi/cutting/batches?status=cut_done&limit=50`, { headers })
        ]);
        if (partnersRes.ok) setPartners(await partnersRes.json());
        if (batchesRes.ok) {
          const data = await batchesRes.json();
          setBatches(data.batches || data || []);
        }
      } catch (e) {
        console.error('Failed to fetch data', e);
      }
    };
    fetchData();
  }, [headers]);

  const selectedBatch = useMemo(() => {
    return batches.find(b => b.id === form.cutting_batch_id);
  }, [batches, form.cutting_batch_id]);

  useEffect(() => {
    if (selectedBatch) {
      // Auto-populate items from selected batch
      const item = {
        material_id: `WIP-${selectedBatch.batch_code}`,
        material_name: selectedBatch.product_model_name || 'WIP dari Cutting',
        qty: selectedBatch.total_cut_pcs || 0,
        uom: 'pcs'
      };
      setForm(f => ({ ...f, items: [item] }));
    }
  }, [selectedBatch]);

  const handleSubmit = async () => {
    if (!form.cmt_partner_id) return toast.error('Pilih CMT Partner');
    if (form.items.length === 0) return toast.error('Tambahkan minimal 1 item');

    setLoading(true);
    try {
      const r = await fetch(`${API}/api/dewi/cmt/delivery-orders`, {
        method: 'POST',
        headers,
        body: JSON.stringify(form)
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.detail || 'Gagal membuat DO');
      }
      const data = await r.json();
      toast.success(`DO ${data.do_number} berhasil dibuat`);
      onSuccess();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-[#0f1117] border-white/10">
      <DialogHeader>
        <DialogTitle>Buat Delivery Order Baru</DialogTitle>
        <DialogDescription className="text-slate-400">
          Buat DO untuk pengiriman WIP ke vendor CMT
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs">CMT Partner *</Label>
          <Select value={form.cmt_partner_id} onValueChange={v => setForm(f => ({ ...f, cmt_partner_id: v }))}>
            <SelectTrigger className="bg-white/5 border-white/10">
              <SelectValue placeholder="Pilih CMT Partner" />
            </SelectTrigger>
            <SelectContent>
              {partners.map(p => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} — {p.code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Cutting Batch (Optional)</Label>
          <Select value={form.cutting_batch_id} onValueChange={v => setForm(f => ({ ...f, cutting_batch_id: v }))}>
            <SelectTrigger className="bg-white/5 border-white/10">
              <SelectValue placeholder="Pilih Cutting Batch" />
            </SelectTrigger>
            <SelectContent>
              {batches.map(b => (
                <SelectItem key={b.id} value={b.id}>
                  {b.batch_code} — {b.product_model_name} ({fmtNum(b.total_cut_pcs)} pcs)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Tanggal Kirim</Label>
          <Input 
            type="date"
            value={form.delivery_date}
            onChange={e => setForm(f => ({ ...f, delivery_date: e.target.value }))}
            className="bg-white/5 border-white/10"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Catatan</Label>
          <Textarea 
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            rows={2}
            className="bg-white/5 border-white/10 resize-none"
            placeholder="Catatan DO..."
          />
        </div>

        {form.items.length > 0 && (
          <div className="border border-blue-400/30 rounded-lg p-3 bg-blue-500/5">
            <div className="text-xs font-semibold text-blue-300 mb-2">Items yang akan dikirim:</div>
            {form.items.map((item, idx) => (
              <div key={idx} className="text-sm text-white flex justify-between py-1">
                <span>{item.material_name}</span>
                <span className="font-mono">{fmtNum(item.qty)} {item.uom}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose} className="text-slate-400">Batal</Button>
        <Button onClick={handleSubmit} disabled={loading} className="bg-blue-600 hover:bg-blue-500">
          {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Buat DO
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ─── ISSUE DO DIALOG ───────────────────────────────────────────────────────────
function IssueDODialog({ doItem, onClose, onSuccess, headers }) {
  const [loading, setLoading] = useState(false);
  const [scannedDO, setScannedDO] = useState(false); // Sprint A.1: scan confirmation
  const [form, setForm] = useState({
    actual_delivery_date: new Date().toISOString().split('T')[0],
    driver_name: '',
    vehicle_number: '',
    notes: ''
  });

  // Sprint A.1: Scan-out confirmation handler
  const handleScanDO = useCallback((code) => {
    if (code === doItem.do_number || code === doItem.id || code.includes(doItem.do_number)) {
      setScannedDO(true);
      toast.success(`DO ${doItem.do_number} terverifikasi via scan`);
    } else {
      toast.warning(`Barcode "${code}" tidak cocok dengan DO ${doItem.do_number}`);
    }
  }, [doItem.do_number, doItem.id]);

  const handleSubmit = async () => {
    if (!form.driver_name) return toast.error('Nama driver wajib diisi');

    setLoading(true);
    try {
      const r = await fetch(`${API}/api/dewi/cmt/delivery-orders/${doItem.id}/issue`, {
        method: 'POST',
        headers,
        body: JSON.stringify(form)
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.detail || 'Gagal issue DO');
      }
      toast.success(`DO ${doItem.do_number} berhasil di-issue & WIP ter-scan-out`);
      onSuccess();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <DialogContent className="max-w-lg bg-[#0f1117] border-white/10">
      <DialogHeader>
        <DialogTitle>Issue DO — {doItem.do_number}</DialogTitle>
        <DialogDescription className="text-slate-400">
          Konfirmasi pengiriman & scan-out WIP stock
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="bg-amber-500/10 border border-amber-400/20 rounded p-3 text-xs text-amber-300">
          ⚠️ Setelah di-issue: WIP stock akan berkurang dari inventory
        </div>

        {/* Sprint A.1: Scan DO number untuk konfirmasi */}
        <div className="bg-indigo-500/10 border border-indigo-400/20 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-indigo-300 font-semibold">
              <ScanLine className="w-3.5 h-3.5" /> Verifikasi Scan DO (opsional)
            </div>
            {scannedDO && (
              <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Terverifikasi
              </span>
            )}
          </div>
          <UniversalScanner
            variant="inline"
            onScan={handleScanDO}
            placeholder={`Scan barcode DO ${doItem.do_number}...`}
            data-testid="do-scan-input"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Tanggal Kirim *</Label>
          <Input 
            type="date"
            value={form.actual_delivery_date}
            onChange={e => setForm(f => ({ ...f, actual_delivery_date: e.target.value }))}
            className="bg-white/5 border-white/10"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Nama Driver *</Label>
          <Input 
            value={form.driver_name}
            onChange={e => setForm(f => ({ ...f, driver_name: e.target.value }))}
            placeholder="Nama driver..."
            className="bg-white/5 border-white/10"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Nomor Kendaraan</Label>
          <Input 
            value={form.vehicle_number}
            onChange={e => setForm(f => ({ ...f, vehicle_number: e.target.value }))}
            placeholder="B 1234 XYZ"
            className="bg-white/5 border-white/10"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Catatan</Label>
          <Textarea 
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            rows={2}
            className="bg-white/5 border-white/10 resize-none"
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose} className="text-slate-400">Batal</Button>
        <Button onClick={handleSubmit} disabled={loading} className="bg-blue-600 hover:bg-blue-500">
          {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          <Send className="w-4 h-4 mr-2" />
          Issue DO
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ─── DO CARD ───────────────────────────────────────────────────────────────────
function DOCard({ doItem, onAction }) {
  const statusInfo = DO_STATUS[doItem.status] || DO_STATUS.draft;
  const StatusIcon = statusInfo.icon;

  return (
    <GlassCard className="p-4 hover:bg-white/8 transition-all">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-mono font-bold text-white">{doItem.do_number}</span>
            <Badge className={`text-[10px] px-2 py-0.5 ${statusInfo.color}`}>
              <StatusIcon className="w-3 h-3 mr-1" />
              {statusInfo.label}
            </Badge>
          </div>
          <div className="text-sm text-white font-medium">{doItem.cmt_partner_name}</div>
          <div className="text-xs text-slate-400 mt-1">
            {doItem.total_qty} items • {fmtDate(doItem.delivery_date)}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {doItem.status === 'draft' && (
            <Button size="sm" onClick={() => onAction(doItem, 'issue')} className="bg-blue-600 hover:bg-blue-500">
              <Send className="w-3 h-3 mr-1" /> Issue
            </Button>
          )}
          {doItem.status === 'issued' && (
            <Button size="sm" onClick={() => onAction(doItem, 'receive')} className="bg-green-600 hover:bg-green-500">
              <CheckCircle2 className="w-3 h-3 mr-1" /> Receive
            </Button>
          )}
        </div>
      </div>

      {doItem.items && doItem.items.length > 0 && (
        <div className="border-t border-white/10 pt-2 mt-2 space-y-1">
          {doItem.items.slice(0, 2).map((item, idx) => (
            <div key={idx} className="text-xs bg-white/5 rounded px-2 py-1 flex justify-between">
              <span className="text-slate-300">{item.material_name}</span>
              <span className="text-white font-mono">{fmtNum(item.qty)} {item.uom}</span>
            </div>
          ))}
          {doItem.items.length > 2 && (
            <div className="text-xs text-slate-500 pl-2">+{doItem.items.length - 2} items lainnya</div>
          )}
        </div>
      )}

      {doItem.driver_name && (
        <div className="border-t border-white/10 pt-2 mt-2 text-xs text-slate-400">
          🚚 Driver: {doItem.driver_name} {doItem.vehicle_number && `(${doItem.vehicle_number})`}
        </div>
      )}
    </GlassCard>
  );
}

// ─── MAIN MODULE ───────────────────────────────────────────────────────────────
export default function DOManagementModule({ token }) {
  const headers = useMemo(() => ({ 
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }), [token]);

  const [loading, setLoading] = useState(false);
  const [dos, setDos] = useState([]);
  const [stats, setStats] = useState({});
  const [tab, setTab] = useState('draft');
  const [createDialog, setCreateDialog] = useState(false);
  const [issueDialog, setIssueDialog] = useState(null);

  const fetchStats = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/dewi/cmt/delivery-orders/summary/stats`, { headers });
      if (r.ok) setStats(await r.json());
    } catch (e) {
      console.error('Failed to fetch stats', e);
    }
  }, [headers]);

  const fetchDOs = useCallback(async () => {
    setLoading(true);
    try {
      const status = tab === 'all' ? '' : tab;
      const r = await fetch(`${API}/api/dewi/cmt/delivery-orders?status=${status}&limit=50`, { headers });
      if (r.ok) {
        const data = await r.json();
        setDos(data.delivery_orders || []);
      }
    } catch (e) {
      toast.error('Gagal memuat DO');
    } finally {
      setLoading(false);
    }
  }, [tab, headers]);

  useEffect(() => {
    fetchStats();
    fetchDOs();
  }, [fetchStats, fetchDOs]);

  const handleAction = (doItem, action) => {
    if (action === 'issue') {
      setIssueDialog(doItem);
    } else if (action === 'receive') {
      // For simplicity, directly call receive API
      handleReceive(doItem);
    }
  };

  const handleReceive = async (doItem) => {
    try {
      const r = await fetch(`${API}/api/dewi/cmt/delivery-orders/${doItem.id}/receive`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ received_date: new Date().toISOString().split('T')[0] })
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.detail || 'Gagal receive DO');
      }
      toast.success(`DO ${doItem.do_number} berhasil diterima`);
      fetchDOs();
      fetchStats();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const handleRefresh = () => {
    fetchStats();
    fetchDOs();
  };

  return (
    <div className="space-y-6 p-6" data-testid="do-management-page">
      {/* DEPRECATION BANNER (Session #11.14 — P2 Consolidation #12) */}
      <div
        className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300"
        data-testid="do-deprecation-banner"
        role="alert"
      >
        <strong>⚠️ Modul Ini Sudah Tidak Aktif (DEPRECATED)</strong> — Dispatch WIP ke
        Vendor CMT kini dikelola di <em>Warehouse → Dispatch ke CMT (SSOT)</em>
        (<code>wms-cmt-dispatches</code>). Modul ini dipertahankan sementara untuk
        kompatibilitas data lama. Lihat <strong>FORENSIC_09 — P2 Consolidation #12</strong>.
      </div>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center">
              <FileText className="w-5 h-5 text-white" />
            </div>
            Delivery Orders (Surat Jalan)
          </h1>
          <p className="text-sm text-slate-400 mt-1">Kelola pengiriman WIP ke vendor CMT</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleRefresh} variant="outline" size="sm" className="border-white/10">
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={() => setCreateDialog(true)} className="bg-blue-600 hover:bg-blue-500">
            <Plus className="w-4 h-4 mr-2" />
            Buat DO
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Draft', value: stats.draft || 0, color: 'text-slate-300' },
          { label: 'Dikirim', value: stats.issued || 0, color: 'text-blue-300' },
          { label: 'Diterima', value: stats.received || 0, color: 'text-green-300' },
          { label: 'Total', value: stats.total || 0, color: 'text-white' },
        ].map(s => (
          <GlassCard key={s.label} className="p-4">
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-slate-400 mt-0.5">{s.label}</div>
          </GlassCard>
        ))}
      </div>

      {/* DO List */}
      <GlassCard className="p-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="bg-white/5 mb-4">
            <TabsTrigger value="draft">Draft</TabsTrigger>
            <TabsTrigger value="issued">Dikirim</TabsTrigger>
            <TabsTrigger value="received">Diterima</TabsTrigger>
            <TabsTrigger value="all">Semua</TabsTrigger>
          </TabsList>
        </Tabs>

        {loading ? (
          <div className="text-center py-12 text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" />
            Memuat DOs...
          </div>
        ) : dos.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            <FileText className="w-12 h-12 mx-auto opacity-20 mb-3" />
            <p>Tidak ada DO untuk status ini</p>
          </div>
        ) : (
          <div className="space-y-3">
            {dos.map(doItem => (
              <DOCard key={doItem.id} doItem={doItem} onAction={handleAction} />
            ))}
          </div>
        )}
      </GlassCard>

      {/* Dialogs */}
      {createDialog && (
        <Dialog open={createDialog} onOpenChange={setCreateDialog}>
          <CreateDODialog 
            headers={headers}
            onClose={() => setCreateDialog(false)}
            onSuccess={() => {
              setCreateDialog(false);
              fetchDOs();
              fetchStats();
            }}
          />
        </Dialog>
      )}

      {issueDialog && (
        <Dialog open={!!issueDialog} onOpenChange={() => setIssueDialog(null)}>
          <IssueDODialog 
            doItem={issueDialog}
            headers={headers}
            onClose={() => setIssueDialog(null)}
            onSuccess={() => {
              setIssueDialog(null);
              fetchDOs();
              fetchStats();
            }}
          />
        </Dialog>
      )}
    </div>
  );
}
