/**
 * WMS Fabric Rolls — Garment Roll Tracking
 * P0-WH-1: Fabric roll tracking dengan barcode, QC status, position management
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Package, Plus, RefreshCw, Eye, Search, MapPin, QrCode, CheckCircle2,
  XCircle, AlertCircle, Truck, RotateCcw, Edit2, ArrowRightLeft, Loader2,
  ChevronRight, Filter, Download, X, Save, Printer, Sparkles, Brain
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { EmptyState } from './EmptyState';

const API = process.env.REACT_APP_BACKEND_URL;

const QC_STATUS = {
  pending: { label: 'Pending', color: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  pass: { label: 'Pass', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  partial: { label: 'Partial', color: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  reject: { label: 'Reject', color: 'bg-red-500/20 text-red-300 border-red-500/30' },
};

const STOCK_STATUS = {
  in_stock: { label: 'In Stock', color: 'bg-green-500/20 text-green-300' },
  partly_issued: { label: 'Sebagian Terpakai', color: 'bg-blue-500/20 text-blue-300' },
  fully_issued: { label: 'Habis', color: 'bg-zinc-500/20 text-zinc-400' },
  returned: { label: 'Dikembalikan', color: 'bg-purple-500/20 text-purple-300' },
  rejected: { label: 'Ditolak', color: 'bg-red-500/20 text-red-300' },
};

const fmt = (n) => new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n ?? 0);

export default function WMSFabricRollsModule({ token }) {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }), [token]);
  const [rolls, setRolls] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ qc_status: 'all', status: '' });
  const [viewDialog, setViewDialog] = useState(null); // {roll, movements}
  const [createDialog, setCreateDialog] = useState(false);
  const [issueDialog, setIssueDialog] = useState(null); // {roll}
  const [putawayDialog, setPutawayDialog] = useState(null); // {roll}
  const [aiAnalysisDialog, setAiAnalysisDialog] = useState(null); // AI insights
  const [aiLoading, setAiLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (filters.qc_status && filters.qc_status !== 'all') params.set('qc_status', filters.qc_status);
      if (filters.status) params.set('status', filters.status);
      if (tab !== 'all') params.set('status', tab);
      const r = await fetch(`${API}/api/wms/fabric-rolls?${params}`, { headers });
      const d = await r.json();
      setRolls(d.items || []);
    } catch (e) {
      toast.error('Gagal memuat data roll');
    } finally {
      setLoading(false);
    }
  }, [headers, search, filters, tab]);

  useEffect(() => { load(); }, [load]);

  const handleView = async (roll) => {
    try {
      const r = await fetch(`${API}/api/wms/fabric-rolls/${roll.id}`, { headers });
      const d = await r.json();
      setViewDialog(d);
    } catch {
      toast.error('Gagal memuat detail roll');
    }
  };

  const handleCreateRoll = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {
      roll_no: fd.get('roll_no'),
      material_id: fd.get('material_id') || '',
      material_code: fd.get('material_code') || '',
      material_name: fd.get('material_name'),
      color: fd.get('color') || '',
      color_lot: fd.get('color_lot') || '',
      supplier_name: fd.get('supplier_name') || '',
      uom: fd.get('uom') || 'meter',
      length_m: parseFloat(fd.get('length_m')) || 0,
      weight_kg: parseFloat(fd.get('weight_kg')) || 0,
      po_no: fd.get('po_no') || '',
      unit_cost: parseFloat(fd.get('unit_cost')) || 0,
      notes: fd.get('notes') || '',
    };
    try {
      const r = await fetch(`${API}/api/wms/fabric-rolls`, {
        method: 'POST',
        headers,
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error();
      toast.success('Roll berhasil dibuat');
      setCreateDialog(false);
      load();
    } catch {
      toast.error('Gagal membuat roll');
    }
  };

  const handlePutaway = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const r = await fetch(`${API}/api/wms/fabric-rolls/${putawayDialog.id}/putaway`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          position_id: fd.get('position_id'),
          position_barcode: fd.get('position_barcode') || '',
          notes: fd.get('notes') || '',
        }),
      });
      if (!r.ok) throw new Error();
      toast.success('Roll berhasil dipindahkan ke posisi');
      setPutawayDialog(null);
      load();
    } catch {
      toast.error('Gagal put-away');
    }
  };

  const handleIssue = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const r = await fetch(`${API}/api/wms/fabric-rolls/${issueDialog.id}/issue`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          qty: parseFloat(fd.get('qty')),
          unit: fd.get('unit') || 'meter',
          reference_type: fd.get('reference_type') || 'wo',
          reference_no: fd.get('reference_no') || '',
          notes: fd.get('notes') || '',
        }),
      });
      if (!r.ok) throw new Error();
      toast.success('Roll berhasil di-issue');
      setIssueDialog(null);
      load();
    } catch {
      toast.error('Gagal issue roll');
    }
  };

  const handleAIAnalysis = async () => {
    setAiLoading(true);
    try {
      const rejectedRolls = rolls.filter(r => r.qc_status === 'reject' || r.qc_status === 'partial');
      const rollIds = rejectedRolls.map(r => r.id);
      
      const r = await fetch(`${API}/api/wms/ai/fabric-rolls/quality-analysis`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          roll_ids: rollIds,
          time_period_days: 30
        }),
      });
      
      if (!r.ok) throw new Error();
      const data = await r.json();
      setAiAnalysisDialog(data);
      toast.success('🤖 AI Analysis berhasil!');
    } catch (e) {
      toast.error('Gagal melakukan AI analysis');
      console.error(e);
    } finally {
      setAiLoading(false);
    }
  };

  const filteredRolls = useMemo(() => {
    if (tab === 'all') return rolls;
    return rolls.filter(r => r.status === tab);
  }, [rolls, tab]);

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-800 text-zinc-100" data-testid="wms-fabric-rolls-module">
      {/* Header */}
      <div className="border-b border-white/10 bg-black/20 backdrop-blur-sm">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-violet-500/20 border border-violet-500/30">
                <Package className="w-5 h-5 text-violet-300" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold text-white">Fabric Roll Tracking</h1>
                <p className="text-sm text-zinc-400 mt-0.5">Tracking kain garment per roll dengan barcode</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleAIAnalysis}
                disabled={aiLoading}
                variant="outline"
                className="border-violet-500/30 bg-violet-500/10 hover:bg-violet-500/20 text-violet-300"
                data-testid="ai-analysis-btn"
              >
                {aiLoading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Brain className="w-4 h-4 mr-2" />
                )}
                AI Insights
              </Button>
              <Button
                onClick={() => setCreateDialog(true)}
                className="bg-violet-600 hover:bg-violet-700 text-white"
                data-testid="create-roll-btn"
              >
                <Plus className="w-4 h-4 mr-2" />
                Roll Baru
              </Button>
            </div>
          </div>

          {/* Search & Filters */}
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <Input
                placeholder="Cari roll number, material, color, supplier..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-white/5 border-white/10 text-white"
                data-testid="search-roll-input"
              />
            </div>
            <Select value={filters.qc_status} onValueChange={(v) => setFilters({ ...filters, qc_status: v })}>
              <SelectTrigger className="w-40 bg-white/5 border-white/10" data-testid="qc-filter">
                <SelectValue placeholder="Semua QC" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua QC</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="pass">Pass</SelectItem>
                <SelectItem value="partial">Partial</SelectItem>
                <SelectItem value="reject">Reject</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={load}
              disabled={loading}
              className="border-white/10 hover:bg-white/5"
              data-testid="refresh-rolls-btn"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={setTab} className="px-6">
          <TabsList className="bg-white/5 border-b border-white/10 w-full justify-start rounded-none">
            <TabsTrigger value="all" data-testid="tab-all">Semua</TabsTrigger>
            <TabsTrigger value="in_stock" data-testid="tab-in-stock">In Stock</TabsTrigger>
            <TabsTrigger value="partly_issued" data-testid="tab-partly-issued">Sebagian Terpakai</TabsTrigger>
            <TabsTrigger value="fully_issued" data-testid="tab-fully-issued">Habis</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Rolls List */}
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-64" data-testid="loading-rolls">
            <Loader2 className="w-8 h-8 animate-spin text-violet-400" />
          </div>
        ) : filteredRolls.length === 0 ? (
          <EmptyState 
            icon={Package}
            title={search ? 'Tidak ada hasil pencarian' : 'Belum ada data roll'}
            description={search ? `Tidak ditemukan roll dengan kata kunci "${search}"` : 'Roll fabric akan muncul di sini setelah Anda menambahkan atau menerima roll dari supplier'}
            action={{
              label: 'Tambah Roll Baru',
              onClick: () => setCreateDialog(true),
              icon: Plus
            }}
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredRolls.map((roll) => (
              <div
                key={roll.id}
                className="bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 transition-colors cursor-pointer"
                onClick={() => handleView(roll)}
                data-testid={`roll-card-${roll.roll_no}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <QrCode className="w-4 h-4 text-violet-400" />
                      <h3 className="font-semibold text-white">{roll.roll_no}</h3>
                    </div>
                    <p className="text-sm text-zinc-400">{roll.material_name}</p>
                  </div>
                  <div className="flex flex-col gap-1 items-end">
                    <span className={`px-2 py-0.5 rounded-full text-xs border ${QC_STATUS[roll.qc_status]?.color || ''}`}>
                      {QC_STATUS[roll.qc_status]?.label || roll.qc_status}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-xs ${STOCK_STATUS[roll.status]?.color || ''}`}>
                      {STOCK_STATUS[roll.status]?.label || roll.status}
                    </span>
                  </div>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Color / Lot:</span>
                    <span className="text-zinc-200">{roll.color || '-'} / {roll.color_lot || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Panjang:</span>
                    <span className="text-zinc-200 font-mono">{fmt(roll.remaining_m)} / {fmt(roll.length_m)} m</span>
                  </div>
                  {roll.weight_kg > 0 && (
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Berat:</span>
                      <span className="text-zinc-200 font-mono">{fmt(roll.remaining_kg)} / {fmt(roll.weight_kg)} kg</span>
                    </div>
                  )}
                  {roll.position_barcode && (
                    <div className="flex items-center gap-2 text-xs text-violet-400">
                      <MapPin className="w-3 h-3" />
                      {roll.position_barcode}
                    </div>
                  )}
                </div>

                <div className="mt-3 pt-3 border-t border-white/10 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 border-white/10 hover:bg-white/5 text-xs"
                    onClick={(e) => { e.stopPropagation(); setPutawayDialog(roll); }}
                    data-testid={`putaway-btn-${roll.roll_no}`}
                  >
                    <ArrowRightLeft className="w-3 h-3 mr-1" />
                    Put-Away
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 border-white/10 hover:bg-white/5 text-xs"
                    onClick={(e) => { e.stopPropagation(); setIssueDialog(roll); }}
                    disabled={roll.status === 'fully_issued'}
                    data-testid={`issue-btn-${roll.roll_no}`}
                  >
                    <Truck className="w-3 h-3 mr-1" />
                    Issue
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Roll Dialog */}
      <Dialog open={createDialog} onOpenChange={setCreateDialog}>
        <DialogContent className="bg-zinc-900 text-white border-white/10 max-w-2xl" data-testid="create-roll-dialog">
          <DialogHeader>
            <DialogTitle>Buat Roll Baru</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateRoll}>
            <div className="grid grid-cols-2 gap-4 py-4">
              <div>
                <Label>Roll Number *</Label>
                <Input name="roll_no" required className="bg-white/5 border-white/10" data-testid="input-roll-no" />
              </div>
              <div>
                <Label>Material Code</Label>
                <Input name="material_code" className="bg-white/5 border-white/10" data-testid="input-material-code" />
              </div>
              <div className="col-span-2">
                <Label>Material Name *</Label>
                <Input name="material_name" required className="bg-white/5 border-white/10" data-testid="input-material-name" />
              </div>
              <div>
                <Label>Color</Label>
                <Input name="color" className="bg-white/5 border-white/10" data-testid="input-color" />
              </div>
              <div>
                <Label>Color Lot</Label>
                <Input name="color_lot" className="bg-white/5 border-white/10" data-testid="input-color-lot" />
              </div>
              <div>
                <Label>Supplier Name</Label>
                <Input name="supplier_name" className="bg-white/5 border-white/10" data-testid="input-supplier" />
              </div>
              <div>
                <Label>PO Number</Label>
                <Input name="po_no" className="bg-white/5 border-white/10" data-testid="input-po-no" />
              </div>
              <div>
                <Label>UOM</Label>
                <Select name="uom" defaultValue="meter">
                  <SelectTrigger className="bg-white/5 border-white/10" data-testid="input-uom">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="meter">Meter</SelectItem>
                    <SelectItem value="kg">Kilogram</SelectItem>
                    <SelectItem value="yard">Yard</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Length (m)</Label>
                <Input name="length_m" type="number" step="0.01" defaultValue="0" className="bg-white/5 border-white/10" data-testid="input-length" />
              </div>
              <div>
                <Label>Weight (kg)</Label>
                <Input name="weight_kg" type="number" step="0.01" defaultValue="0" className="bg-white/5 border-white/10" data-testid="input-weight" />
              </div>
              <div>
                <Label>Unit Cost</Label>
                <Input name="unit_cost" type="number" step="0.01" defaultValue="0" className="bg-white/5 border-white/10" data-testid="input-unit-cost" />
              </div>
              <div className="col-span-2">
                <Label>Notes</Label>
                <Input name="notes" className="bg-white/5 border-white/10" data-testid="input-notes" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateDialog(false)} className="border-white/10">
                Batal
              </Button>
              <Button type="submit" className="bg-violet-600 hover:bg-violet-700" data-testid="submit-create-roll">
                <Save className="w-4 h-4 mr-2" />
                Simpan
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* View Dialog */}
      {viewDialog && (
        <Dialog open={!!viewDialog} onOpenChange={() => setViewDialog(null)}>
          <DialogContent className="bg-zinc-900 text-white border-white/10 max-w-3xl" data-testid="view-roll-dialog">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <QrCode className="w-5 h-5 text-violet-400" />
                Roll {viewDialog.roll?.roll_no}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-zinc-500">Material:</span>
                  <p className="text-white font-medium">{viewDialog.roll?.material_name}</p>
                </div>
                <div>
                  <span className="text-zinc-500">Color / Lot:</span>
                  <p className="text-white font-medium">{viewDialog.roll?.color || '-'} / {viewDialog.roll?.color_lot || '-'}</p>
                </div>
                <div>
                  <span className="text-zinc-500">Supplier:</span>
                  <p className="text-white font-medium">{viewDialog.roll?.supplier_name || '-'}</p>
                </div>
                <div>
                  <span className="text-zinc-500">PO Number:</span>
                  <p className="text-white font-medium">{viewDialog.roll?.po_no || '-'}</p>
                </div>
              </div>

              <div className="border-t border-white/10 pt-4">
                <h3 className="text-sm font-medium mb-3 text-zinc-400">Movement History</h3>
                {viewDialog.movements?.length === 0 ? (
                  <p className="text-zinc-600 text-sm">Belum ada pergerakan</p>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-auto">
                    {viewDialog.movements?.map((m, i) => (
                      <div key={i} className="bg-white/5 border border-white/10 rounded p-3 text-sm">
                        <div className="flex justify-between mb-1">
                          <span className="font-medium text-violet-400">{m.movement_type}</span>
                          <span className="text-zinc-500">{new Date(m.created_at).toLocaleString('id-ID')}</span>
                        </div>
                        <p className="text-zinc-400">Qty: {fmt(m.qty)} {m.unit} - {m.notes || 'No notes'}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Put-Away Dialog */}
      {putawayDialog && (
        <Dialog open={!!putawayDialog} onOpenChange={() => setPutawayDialog(null)}>
          <DialogContent className="bg-zinc-900 text-white border-white/10" data-testid="putaway-dialog">
            <DialogHeader>
              <DialogTitle>Put-Away Roll {putawayDialog.roll_no}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handlePutaway}>
              <div className="space-y-4 py-4">
                <div>
                  <Label>Position ID *</Label>
                  <Input name="position_id" required className="bg-white/5 border-white/10" data-testid="input-position-id" />
                </div>
                <div>
                  <Label>Position Barcode</Label>
                  <Input name="position_barcode" className="bg-white/5 border-white/10" data-testid="input-position-barcode" />
                </div>
                <div>
                  <Label>Notes</Label>
                  <Input name="notes" className="bg-white/5 border-white/10" data-testid="input-putaway-notes" />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setPutawayDialog(null)} className="border-white/10">
                  Batal
                </Button>
                <Button type="submit" className="bg-violet-600 hover:bg-violet-700" data-testid="submit-putaway">
                  Simpan
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {/* Issue Dialog */}
      {issueDialog && (
        <Dialog open={!!issueDialog} onOpenChange={() => setIssueDialog(null)}>
          <DialogContent className="bg-zinc-900 text-white border-white/10" data-testid="issue-dialog">
            <DialogHeader>
              <DialogTitle>Issue Roll {issueDialog.roll_no}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleIssue}>
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Qty *</Label>
                    <Input name="qty" type="number" step="0.01" required className="bg-white/5 border-white/10" data-testid="input-issue-qty" />
                  </div>
                  <div>
                    <Label>Unit</Label>
                    <Select name="unit" defaultValue="meter">
                      <SelectTrigger className="bg-white/5 border-white/10" data-testid="input-issue-unit">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="meter">Meter</SelectItem>
                        <SelectItem value="kg">Kilogram</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>Reference Type</Label>
                  <Select name="reference_type" defaultValue="wo">
                    <SelectTrigger className="bg-white/5 border-white/10" data-testid="input-ref-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="wo">Work Order</SelectItem>
                      <SelectItem value="cmt">CMT</SelectItem>
                      <SelectItem value="manual">Manual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Reference No</Label>
                  <Input name="reference_no" className="bg-white/5 border-white/10" data-testid="input-ref-no" />
                </div>
                <div>
                  <Label>Notes</Label>
                  <Input name="notes" className="bg-white/5 border-white/10" data-testid="input-issue-notes" />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIssueDialog(null)} className="border-white/10">
                  Batal
                </Button>
                <Button type="submit" className="bg-violet-600 hover:bg-violet-700" data-testid="submit-issue">
                  Issue
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
      
      {/* AI Analysis Dialog */}
      {aiAnalysisDialog && (
        <Dialog open={!!aiAnalysisDialog} onOpenChange={() => setAiAnalysisDialog(null)}>
          <DialogContent className="bg-zinc-900 text-white border-white/10 max-w-4xl max-h-[85vh] overflow-auto" data-testid="ai-analysis-dialog">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Brain className="w-5 h-5 text-violet-400" />
                🤖 AI Quality Pattern Analysis
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-violet-500/10 border border-violet-500/20 rounded-lg p-3">
                  <div className="text-xs text-zinc-500 mb-1">Total Rejections</div>
                  <div className="text-2xl font-bold text-violet-300">{aiAnalysisDialog.data_summary?.total_rejections || 0}</div>
                </div>
                <div className="bg-violet-500/10 border border-violet-500/20 rounded-lg p-3">
                  <div className="text-xs text-zinc-500 mb-1">Affected Suppliers</div>
                  <div className="text-2xl font-bold text-violet-300">{aiAnalysisDialog.data_summary?.affected_suppliers || 0}</div>
                </div>
                <div className="bg-violet-500/10 border border-violet-500/20 rounded-lg p-3">
                  <div className="text-xs text-zinc-500 mb-1">Period</div>
                  <div className="text-2xl font-bold text-violet-300">{aiAnalysisDialog.data_summary?.period_days || 30} hari</div>
                </div>
              </div>

              {/* AI Analysis Content */}
              <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="w-4 h-4 text-violet-400" />
                  <h3 className="font-semibold text-white">AI Analysis Results</h3>
                </div>
                <div className="prose prose-invert prose-sm max-w-none">
                  <div className="whitespace-pre-wrap text-zinc-300 leading-relaxed">
                    {aiAnalysisDialog.analysis}
                  </div>
                </div>
              </div>

              {/* Timestamp */}
              <div className="text-xs text-zinc-500 text-center">
                Generated at: {new Date(aiAnalysisDialog.generated_at).toLocaleString('id-ID')}
              </div>
            </div>
            <DialogFooter>
              <Button 
                onClick={() => setAiAnalysisDialog(null)} 
                className="bg-violet-600 hover:bg-violet-700"
                data-testid="close-ai-dialog"
              >
                Tutup
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
