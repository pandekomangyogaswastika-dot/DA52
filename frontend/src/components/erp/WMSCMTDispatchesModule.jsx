/**
 * WMS CMT Dispatches — Material Disbursement to CMT Partners
 * P1: Track material dispatches to CMT partners with return tracking
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Truck, Plus, RefreshCw, Eye, CheckCircle2, RotateCcw, Loader2, Search,
  Package, MapPin, Calendar, User, X, Save, ArrowRight, Brain, Sparkles
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { EmptyState } from './EmptyState';

const API = process.env.REACT_APP_BACKEND_URL;

const STATUS_COLORS = {
  pending: 'bg-amber-500/20 text-amber-300',
  dispatched: 'bg-blue-500/20 text-blue-300',
  received: 'bg-emerald-500/20 text-emerald-300',
  partial_return: 'bg-purple-500/20 text-purple-300',
  completed: 'bg-green-500/20 text-green-300',
  cancelled: 'bg-red-500/20 text-red-300',
};

const fmt = (n) => new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2 }).format(n ?? 0);

export default function WMSCMTDispatchesModule({ token }) {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }), [token]);
  const [dispatches, setDispatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [createDialog, setCreateDialog] = useState(false);
  const [viewDialog, setViewDialog] = useState(null);
  const [aiRecommendDialog, setAiRecommendDialog] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [selectedPartner, setSelectedPartner] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (tab !== 'all') params.set('status', tab);
      const r = await fetch(`${API}/api/wms/cmt-dispatches?${params}`, { headers });
      const d = await r.json();
      setDispatches(d.items || []);
    } catch {
      toast.error('Gagal memuat data CMT dispatch');
    } finally {
      setLoading(false);
    }
  }, [headers, search, tab]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {
      cmt_partner_id: fd.get('cmt_partner_id'),
      cmt_partner_name: fd.get('cmt_partner_name'),
      material_id: fd.get('material_id'),
      material_code: fd.get('material_code'),
      material_name: fd.get('material_name'),
      qty_sent: parseFloat(fd.get('qty_sent')) || 0,
      unit: fd.get('unit') || 'pcs',
      expected_return_date: fd.get('expected_return_date') || null,
      notes: fd.get('notes') || '',
    };
    try {
      const r = await fetch(`${API}/api/wms/cmt-dispatches`, { method: 'POST', headers, body: JSON.stringify(data) });
      if (!r.ok) throw new Error();
      toast.success('CMT dispatch berhasil dibuat');
      setCreateDialog(false);
      load();
    } catch {
      toast.error('Gagal membuat CMT dispatch');
    }
  };

  const handleDispatch = async (id) => {
    try {
      const r = await fetch(`${API}/api/wms/cmt-dispatches/${id}/dispatch`, { method: 'POST', headers });
      if (!r.ok) throw new Error();
      toast.success('Material berhasil di-dispatch ke CMT');
      load();
    } catch {
      toast.error('Gagal dispatch material');
    }
  };

  const handleAIRecommendations = async () => {
    if (!selectedPartner) {
      toast.error('Pilih CMT Partner terlebih dahulu');
      return;
    }
    
    setAiLoading(true);
    try {
      const r = await fetch(`${API}/api/wms/ai/cmt-dispatches/smart-recommendations`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ cmt_partner_id: selectedPartner }),
      });
      
      if (!r.ok) throw new Error();
      const data = await r.json();
      setAiRecommendDialog(data);
      toast.success('🤖 AI Recommendations siap!');
    } catch (e) {
      toast.error('Gagal mendapatkan AI recommendations');
      console.error(e);
    } finally {
      setAiLoading(false);
    }
  };

  const filteredDispatches = useMemo(() => {
    if (tab === 'all') return dispatches;
    return dispatches.filter(d => d.status === tab);
  }, [dispatches, tab]);

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-800 text-zinc-100" data-testid="wms-cmt-dispatches-module">
      {/* Header */}
      <div className="border-b border-white/10 bg-black/20 backdrop-blur-sm">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-blue-500/20 border border-blue-500/30">
                <Truck className="w-5 h-5 text-blue-300" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold text-white">CMT Material Dispatch</h1>
                <p className="text-sm text-zinc-400 mt-0.5">Pengiriman & tracking material ke CMT partner</p>
              </div>
            </div>
            <Button
              onClick={() => setCreateDialog(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white"
              data-testid="create-dispatch-btn"
            >
              <Plus className="w-4 h-4 mr-2" />
              Dispatch Baru
            </Button>
          </div>

          <div className="flex gap-3 mb-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <Input
                placeholder="Cari dispatch number, CMT partner, material..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-white/5 border-white/10 text-white"
                data-testid="search-dispatch-input"
              />
            </div>
            <Button
              variant="outline"
              onClick={load}
              disabled={loading}
              className="border-white/10 hover:bg-white/5"
              data-testid="refresh-dispatch-btn"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          {/* AI Recommendations Panel */}
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <Label className="text-xs text-zinc-400 mb-1.5 block">CMT Partner ID untuk AI Recommendations</Label>
                <Input
                  placeholder="Masukkan CMT Partner ID..."
                  value={selectedPartner}
                  onChange={(e) => setSelectedPartner(e.target.value)}
                  className="bg-white/5 border-white/10 text-white"
                  data-testid="ai-partner-input"
                />
              </div>
              <Button
                onClick={handleAIRecommendations}
                disabled={aiLoading || !selectedPartner}
                className="bg-blue-600 hover:bg-blue-700 text-white mt-5"
                data-testid="ai-recommend-btn"
              >
                {aiLoading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Brain className="w-4 h-4 mr-2" />
                )}
                AI Recommendations
              </Button>
            </div>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab} className="px-6">
          <TabsList className="bg-white/5 border-b border-white/10 w-full justify-start rounded-none">
            <TabsTrigger value="all" data-testid="tab-all">Semua</TabsTrigger>
            <TabsTrigger value="pending" data-testid="tab-pending">Pending</TabsTrigger>
            <TabsTrigger value="dispatched" data-testid="tab-dispatched">Dispatched</TabsTrigger>
            <TabsTrigger value="completed" data-testid="tab-completed">Completed</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Dispatches List */}
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="loading-dispatches">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="border border-white/10 rounded-xl p-4 space-y-3">
                <div className="flex justify-between">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-5 w-16" />
                </div>
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-36" />
                <div className="flex gap-2 pt-1">
                  <Skeleton className="h-7 w-16" />
                  <Skeleton className="h-7 w-24" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredDispatches.length === 0 ? (
          <EmptyState
            icon={Truck}
            title="Belum ada CMT dispatch"
            description="Dispatch ke mitra CMT akan muncul di sini setelah dibuat. Klik 'Dispatch Baru' untuk memulai."
            data-testid="empty-dispatches"
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredDispatches.map((dispatch) => (
              <div
                key={dispatch.id}
                className="bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 transition-colors cursor-pointer"
                onClick={() => setViewDialog(dispatch)}
                data-testid={`dispatch-card-${dispatch.dispatch_number}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Truck className="w-4 h-4 text-blue-400" />
                      <h3 className="font-semibold text-white">{dispatch.dispatch_number}</h3>
                    </div>
                    <p className="text-sm text-zinc-400">{dispatch.cmt_partner_name}</p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_COLORS[dispatch.status] || ''}`}>
                    {dispatch.status}
                  </span>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Material:</span>
                    <span className="text-zinc-200 truncate max-w-[200px]">{dispatch.material_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Qty Sent:</span>
                    <span className="text-zinc-200 font-mono">{fmt(dispatch.qty_sent)} {dispatch.unit}</span>
                  </div>
                  {dispatch.qty_returned > 0 && (
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Qty Returned:</span>
                      <span className="text-emerald-300 font-mono">{fmt(dispatch.qty_returned)} {dispatch.unit}</span>
                    </div>
                  )}
                </div>

                <div className="mt-3 pt-3 border-t border-white/10">
                  {dispatch.status === 'pending' && (
                    <Button
                      size="sm"
                      className="w-full bg-blue-600 hover:bg-blue-700 text-xs"
                      onClick={(e) => { e.stopPropagation(); handleDispatch(dispatch.id); }}
                      data-testid={`dispatch-btn-${dispatch.dispatch_number}`}
                    >
                      <ArrowRight className="w-3 h-3 mr-1" />
                      Dispatch Sekarang
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={createDialog} onOpenChange={setCreateDialog}>
        <DialogContent className="bg-zinc-900 text-white border-white/10 max-w-2xl" data-testid="create-dispatch-dialog">
          <DialogHeader>
            <DialogTitle>Buat CMT Dispatch Baru</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate}>
            <div className="grid grid-cols-2 gap-4 py-4">
              <div className="col-span-2">
                <Label>CMT Partner Name *</Label>
                <Input name="cmt_partner_name" required className="bg-white/5 border-white/10" data-testid="input-cmt-partner" />
              </div>
              <div>
                <Label>CMT Partner ID</Label>
                <Input name="cmt_partner_id" className="bg-white/5 border-white/10" data-testid="input-cmt-id" />
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
                <Label>Material ID</Label>
                <Input name="material_id" className="bg-white/5 border-white/10" data-testid="input-material-id" />
              </div>
              <div>
                <Label>Qty Sent *</Label>
                <Input name="qty_sent" type="number" step="0.01" required className="bg-white/5 border-white/10" data-testid="input-qty-sent" />
              </div>
              <div>
                <Label>Unit</Label>
                <Input name="unit" defaultValue="pcs" className="bg-white/5 border-white/10" data-testid="input-unit" />
              </div>
              <div>
                <Label>Expected Return Date</Label>
                <Input name="expected_return_date" type="date" className="bg-white/5 border-white/10" data-testid="input-return-date" />
              </div>
              <div className="col-span-2">
                <Label>Notes</Label>
                <Textarea name="notes" className="bg-white/5 border-white/10" data-testid="input-notes" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateDialog(false)} className="border-white/10">
                Batal
              </Button>
              <Button type="submit" className="bg-blue-600 hover:bg-blue-700" data-testid="submit-create-dispatch">
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
          <DialogContent className="bg-zinc-900 text-white border-white/10 max-w-2xl" data-testid="view-dispatch-dialog">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Truck className="w-5 h-5 text-blue-400" />
                {viewDialog.dispatch_number}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-zinc-500">CMT Partner:</span>
                  <p className="text-white font-medium">{viewDialog.cmt_partner_name}</p>
                </div>
                <div>
                  <span className="text-zinc-500">Status:</span>
                  <p className="text-white font-medium">{viewDialog.status}</p>
                </div>
                <div>
                  <span className="text-zinc-500">Material:</span>
                  <p className="text-white font-medium">{viewDialog.material_name}</p>
                </div>
                <div>
                  <span className="text-zinc-500">Material Code:</span>
                  <p className="text-white font-medium">{viewDialog.material_code || '-'}</p>
                </div>
                <div>
                  <span className="text-zinc-500">Qty Sent:</span>
                  <p className="text-white font-medium font-mono">{fmt(viewDialog.qty_sent)} {viewDialog.unit}</p>
                </div>
                <div>
                  <span className="text-zinc-500">Qty Returned:</span>
                  <p className="text-white font-medium font-mono">{fmt(viewDialog.qty_returned)} {viewDialog.unit}</p>
                </div>
              </div>
              {viewDialog.notes && (
                <div>
                  <span className="text-zinc-500">Notes:</span>
                  <p className="text-white mt-1">{viewDialog.notes}</p>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
      
      {/* AI Recommendations Dialog */}
      {aiRecommendDialog && (
        <Dialog open={!!aiRecommendDialog} onOpenChange={() => setAiRecommendDialog(null)}>
          <DialogContent className="bg-zinc-900 text-white border-white/10 max-w-3xl max-h-[85vh] overflow-auto" data-testid="ai-recommend-dialog">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Brain className="w-5 h-5 text-blue-400" />
                🤖 Smart Material Recommendations
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {/* Confidence & Stats */}
              <div className="flex items-center justify-between bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                <div>
                  <div className="text-xs text-zinc-500">Confidence Level</div>
                  <div className="text-lg font-bold text-blue-300 capitalize">{aiRecommendDialog.confidence}</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500">Based on Dispatches</div>
                  <div className="text-lg font-bold text-blue-300">{aiRecommendDialog.top_materials?.length || 0}</div>
                </div>
              </div>

              {/* Top Materials Table */}
              {aiRecommendDialog.top_materials && aiRecommendDialog.top_materials.length > 0 && (
                <div className="bg-white/5 border border-white/10 rounded-lg overflow-hidden">
                  <div className="px-4 py-2 bg-white/5 border-b border-white/10">
                    <h3 className="font-semibold text-white text-sm">Top Performing Materials</h3>
                  </div>
                  <div className="p-3 space-y-2">
                    {aiRecommendDialog.top_materials.map((mat, idx) => (
                      <div key={idx} className="flex items-center justify-between bg-white/5 border border-white/10 rounded p-3">
                        <div className="flex-1">
                          <div className="font-medium text-white">{mat.material_name}</div>
                          <div className="text-xs text-zinc-500">Dispatched {mat.dispatch_count}x</div>
                        </div>
                        <div className="flex gap-4 text-sm">
                          <div>
                            <div className="text-xs text-zinc-500">Return Rate</div>
                            <div className={`font-mono font-bold ${mat.return_rate > 20 ? 'text-red-400' : 'text-emerald-400'}`}>
                              {mat.return_rate}%
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-zinc-500">Success Score</div>
                            <div className="font-mono font-bold text-emerald-400">{mat.success_score}%</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* AI Analysis */}
              <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="w-4 h-4 text-blue-400" />
                  <h3 className="font-semibold text-white">AI Analysis & Recommendations</h3>
                </div>
                <div className="prose prose-invert prose-sm max-w-none">
                  <div className="whitespace-pre-wrap text-zinc-300 leading-relaxed">
                    {aiRecommendDialog.ai_analysis || aiRecommendDialog.message}
                  </div>
                </div>
              </div>

              {/* Timestamp */}
              <div className="text-xs text-zinc-500 text-center">
                Generated at: {new Date(aiRecommendDialog.generated_at).toLocaleString('id-ID')}
              </div>
            </div>
            <DialogFooter>
              <Button 
                onClick={() => setAiRecommendDialog(null)} 
                className="bg-blue-600 hover:bg-blue-700"
                data-testid="close-ai-recommend-dialog"
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
