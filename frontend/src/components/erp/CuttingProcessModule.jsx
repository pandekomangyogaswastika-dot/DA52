import { useState, useEffect, useCallback, useMemo } from 'react';
import { Scissors, Plus, CheckCircle2, XCircle, Clock, AlertTriangle, Eye, Edit2, ChevronRight, Package, Layers, Truck, RefreshCw, Map, ZoomIn, ZoomOut, Maximize2, X, Image, Film, FileText, ChevronLeft, Ruler, Info } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { PageHeader } from './moduleAtoms';

const STATUS_CONFIG = {
  pending_approval: { label: 'Menunggu Approval', color: 'bg-amber-500/15 text-amber-300 border-amber-400/30' },
  approved:         { label: 'Disetujui',         color: 'bg-blue-500/15 text-blue-300 border-blue-400/30' },
  in_cutting:       { label: 'Sedang Cutting',    color: 'bg-violet-500/15 text-violet-300 border-violet-400/30' },
  done:             { label: 'Selesai',            color: 'bg-green-500/15 text-green-300 border-green-400/30' },
  rejected:         { label: 'Ditolak',            color: 'bg-red-500/15 text-red-300 border-red-400/30' },
  cancelled:        { label: 'Dibatalkan',         color: 'bg-slate-500/15 text-slate-300 border-slate-400/30' },
  cut_done:         { label: 'Cut Selesai',        color: 'bg-green-500/15 text-green-300 border-green-400/30' },
  assigned_to_cmt:  { label: 'Ke CMT',            color: 'bg-pink-500/15 text-pink-300 border-pink-400/30' },
  draft:            { label: 'Draft',              color: 'bg-slate-500/15 text-slate-300 border-slate-400/30' },
};

const PRIORITY_CONFIG = {
  normal: { label: 'Normal', color: 'bg-foreground/8 text-foreground/60 border-foreground/15' },
  urgent: { label: 'Urgent', color: 'bg-red-500/15 text-red-300 border-red-400/30' },
};

function StatusBadge({ status }) {
  const c = STATUS_CONFIG[status] || STATUS_CONFIG.draft;
  return <span className={`inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full border ${c.color}`}>{c.label}</span>;
}
function PriorityBadge({ priority }) {
  const c = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.normal;
  return <span className={`inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full border ${c.color}`}>{c.label}</span>;
}

const PRODUCT_CATEGORIES = ['Rok', 'Blouse', 'Dress', 'Celana', 'Set/Setelan', 'Baju Anak', 'Hijab', 'Aksesoris', 'Lainnya'];
const COLORS = ['Hitam', 'Putih', 'Navy', 'Abu-abu', 'Merah', 'Biru', 'Hijau', 'Coklat', 'Krem', 'Lilac', 'Pink', 'Kuning', 'Orange', 'Tosca', 'Lainnya'];

export default function CuttingProcessModule({ token, onNavigate }) {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }), [token]);

  const [summary, setSummary]   = useState({});
  const [requests, setRequests] = useState([]);
  const [batches, setBatches]   = useState([]);
  const [loading, setLoading]   = useState(false);
  const [tab, setTab]           = useState('requests');

  // Dialog state
  const [reqDialog, setReqDialog]     = useState(false);
  const [batchDialog, setBatchDialog] = useState(false);
  const [rejectDialog, setRejectDialog] = useState(null);
  const [rollDialog, setRollDialog]   = useState(null);
  const [viewDialog, setViewDialog]   = useState(null);
  const [markingDialog, setMarkingDialog] = useState(null); // GAP-P1: Marking viewer

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [sumR, reqR, bchR] = await Promise.all([
        fetch('/api/dewi/cutting/summary', { headers }),
        fetch('/api/dewi/cutting/requests', { headers }),
        fetch('/api/dewi/cutting/batches', { headers }),
      ]);
      if (sumR.ok) setSummary(await sumR.json());
      if (reqR.ok) setRequests(await reqR.json());
      if (bchR.ok) setBatches(await bchR.json());
    } catch(e) { toast.error('Gagal memuat data'); }
    finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Approve/Reject Request ──────────────────────────────────────────────────
  const approveRequest = async (req) => {
    const r = await fetch(`/api/dewi/cutting/requests/${req.id}/approve`, { method: 'PUT', headers });
    if (r.ok) { toast.success(`Request ${req.request_code} disetujui`); fetchAll(); }
    else { const e = await r.json(); toast.error(e.detail || 'Gagal approve'); }
  };

  const rejectRequest = async (req, reason) => {
    const r = await fetch(`/api/dewi/cutting/requests/${req.id}/reject`, {
      method: 'PUT', headers, body: JSON.stringify({ reason })
    });
    if (r.ok) { toast.success('Request ditolak'); setRejectDialog(null); fetchAll(); }
    else toast.error('Gagal menolak');
  };

  // ── Status update batch ─────────────────────────────────────────────────────
  const updateBatchStatus = async (batch, status) => {
    const r = await fetch(`/api/dewi/cutting/batches/${batch.id}/status`, {
      method: 'PUT', headers, body: JSON.stringify({ status })
    });
    if (r.ok) { toast.success('Status batch diperbarui'); fetchAll(); }
    else toast.error('Gagal update status');
  };

  // ── Stats cards ─────────────────────────────────────────────────────────────
  const stats = [
    { label: 'Total Request',      value: summary.total_requests     || 0, icon: Scissors,     color: 'text-violet-400 bg-violet-500/10 border-violet-400/20' },
    { label: 'Menunggu Approval',  value: summary.pending_approval   || 0, icon: Clock,        color: 'text-amber-400 bg-amber-500/10 border-amber-400/20' },
    { label: 'Sedang Cutting',     value: summary.in_cutting         || 0, icon: Layers,       color: 'text-blue-400 bg-blue-500/10 border-blue-400/20' },
    { label: 'Selesai ke CMT',     value: summary.assigned_to_cmt   || 0, icon: Truck,        color: 'text-green-400 bg-green-500/10 border-green-400/20' },
  ];

  return (
    <div className="p-6 space-y-6" data-testid="cutting-module">
      <PageHeader
        title="Proses Cutting"
        description="Request cutting, eksekusi batch, dan distribusi komponen ke CMT"
        icon={Scissors}
        actions={<Button size="sm" onClick={fetchAll} variant="outline" className="gap-2">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </Button>}
      />

      {/* Stats */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 * i }}>
            <GlassCard className={`p-4 border ${s.color.split(' ')[2]}`}>
              <div className={`w-8 h-8 rounded-lg border ${s.color} flex items-center justify-center mb-2`}>
                <s.icon className={`w-4 h-4 ${s.color.split(' ')[0]}`} />
              </div>
              <div className="text-2xl font-bold text-foreground">{s.value}</div>
              <div className="text-xs text-foreground/50">{s.label}</div>
            </GlassCard>
          </motion.div>
        ))}
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="requests">Request Cutting ({requests.length})</TabsTrigger>
          <TabsTrigger value="batches">Batch Cutting ({batches.length})</TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Request Cutting ── */}
        <TabsContent value="requests">
          <GlassCard className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-foreground/80">Daftar Request Cutting</h3>
              <Button size="sm" onClick={() => setReqDialog(true)} className="gap-1.5">
                <Plus className="w-3.5 h-3.5" /> Buat Request
              </Button>
            </div>
            {loading ? (
              <div className="text-center py-10 text-foreground/40 text-sm">Memuat...</div>
            ) : requests.length === 0 ? (
              <div className="text-center py-10 text-foreground/40 text-sm">Belum ada request cutting</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-white/5 text-xs text-foreground/50">
                    <th className="pb-2 text-left">Kode</th><th className="pb-2 text-left">Produk</th>
                    <th className="pb-2 text-center">Qty</th><th className="pb-2 text-left">Warna</th>
                    <th className="pb-2 text-left">Prioritas</th><th className="pb-2 text-left">Status</th>
                    <th className="pb-2 text-left">Oleh</th><th className="pb-2 text-center">Aksi</th>
                  </tr></thead>
                  <tbody className="divide-y divide-white/5">
                    {requests.map(req => (
                      <tr key={req.id} className="hover:bg-white/3 transition-colors">
                        <td className="py-2.5 pr-3 font-mono text-xs text-foreground/70">{req.request_code}</td>
                        <td className="py-2.5 pr-3">
                          <div className="font-medium text-foreground">{req.product_model_name}</div>
                          <div className="text-xs text-foreground/40">{req.product_category}</div>
                        </td>
                        <td className="py-2.5 pr-3 text-center font-bold text-foreground">{req.qty_requested}</td>
                        <td className="py-2.5 pr-3">
                          <div className="flex flex-wrap gap-1">
                            {(req.colors || []).slice(0,3).map(c => (
                              <span key={c} className="text-[10px] bg-white/5 px-1.5 py-0.5 rounded">{c}</span>
                            ))}
                            {(req.colors || []).length > 3 && <span className="text-[10px] text-foreground/40">+{req.colors.length-3}</span>}
                          </div>
                        </td>
                        <td className="py-2.5 pr-3"><PriorityBadge priority={req.priority} /></td>
                        <td className="py-2.5 pr-3"><StatusBadge status={req.status} /></td>
                        <td className="py-2.5 pr-3 text-xs text-foreground/50">{req.requested_by}</td>
                        <td className="py-2.5">
                          <div className="flex gap-1 justify-center">
                            <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => setViewDialog({ type: 'request', data: req })}>
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="w-7 h-7 text-violet-400 hover:text-violet-300" title="Lihat Marking Pola" onClick={() => setMarkingDialog({ productName: req.product_model_name, category: req.product_category })}>
                              <Map className="w-3.5 h-3.5" />
                            </Button>
                            {req.status === 'pending_approval' && (<>
                              <Button size="icon" variant="ghost" className="w-7 h-7 text-green-400 hover:text-green-300" onClick={() => approveRequest(req)}>
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" className="w-7 h-7 text-red-400 hover:text-red-300" onClick={() => setRejectDialog(req)}>
                                <XCircle className="w-3.5 h-3.5" />
                              </Button>
                            </>)}
                            {req.status === 'approved' && (
                              <Button size="sm" variant="outline" className="text-xs h-7 gap-1" onClick={() => setBatchDialog({ from_request: req })}>
                                <Scissors className="w-3 h-3" /> Mulai Cutting
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
          </GlassCard>
        </TabsContent>

        {/* ── Tab 2: Batch Cutting ── */}
        <TabsContent value="batches">
          <GlassCard className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-foreground/80">Batch Cutting</h3>
              <Button size="sm" onClick={() => setBatchDialog({})} className="gap-1.5">
                <Plus className="w-3.5 h-3.5" /> Buat Batch
              </Button>
            </div>
            {loading ? (
              <div className="text-center py-10 text-foreground/40 text-sm">Memuat...</div>
            ) : batches.length === 0 ? (
              <div className="text-center py-10 text-foreground/40 text-sm">Belum ada batch cutting</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-white/5 text-xs text-foreground/50">
                    <th className="pb-2 text-left">Kode Batch</th><th className="pb-2 text-left">Produk</th>
                    <th className="pb-2 text-center">Total Pcs</th><th className="pb-2 text-left">Rolls Dipakai</th>
                    <th className="pb-2 text-left">Operator</th><th className="pb-2 text-left">Status</th>
                    <th className="pb-2 text-left">Tanggal</th><th className="pb-2 text-center">Aksi</th>
                  </tr></thead>
                  <tbody className="divide-y divide-white/5">
                    {batches.map(batch => (
                      <tr key={batch.id} className="hover:bg-white/3 transition-colors">
                        <td className="py-2.5 pr-3 font-mono text-xs text-foreground/70">{batch.batch_code}</td>
                        <td className="py-2.5 pr-3">
                          <div className="font-medium text-foreground">{batch.product_model_name}</div>
                          <div className="text-xs text-foreground/40">{batch.request_code}</div>
                        </td>
                        <td className="py-2.5 pr-3 text-center font-bold text-foreground">{batch.total_cut_pcs}</td>
                        <td className="py-2.5 pr-3 text-xs text-foreground/60">{(batch.fabric_rolls_used || []).length} roll</td>
                        <td className="py-2.5 pr-3 text-xs text-foreground/70">{batch.operator_name}</td>
                        <td className="py-2.5 pr-3"><StatusBadge status={batch.status} /></td>
                        <td className="py-2.5 pr-3 text-xs text-foreground/50">{batch.cutting_date}</td>
                        <td className="py-2.5">
                          <div className="flex gap-1 justify-center">
                            <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => setViewDialog({ type: 'batch', data: batch })}>
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="w-7 h-7 text-violet-400 hover:text-violet-300" title="Lihat Marking Pola" onClick={() => setMarkingDialog({ productName: batch.product_model_name })}>
                              <Map className="w-3.5 h-3.5" />
                            </Button>
                            {batch.status === 'in_cutting' && (
                              <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => updateBatchStatus(batch, 'cut_done')}>
                                Selesai
                              </Button>
                            )}
                            {batch.status === 'cut_done' && (
                              <Button size="sm" className="text-xs h-7 gap-1" onClick={() => onNavigate && onNavigate('prod-cmt')}>
                                <ChevronRight className="w-3 h-3" /> Assign CMT
                              </Button>
                            )}
                            {batch.status === 'in_cutting' && (
                              <Button size="icon" variant="ghost" className="w-7 h-7 text-red-400" onClick={() => setRollDialog(batch)}>
                                <AlertTriangle className="w-3.5 h-3.5" />
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
          </GlassCard>
        </TabsContent>
      </Tabs>

      {/* ── Dialog: Buat Request ── */}
      <CreateRequestDialog open={reqDialog} onClose={() => setReqDialog(false)} headers={headers} onSuccess={() => { setReqDialog(false); fetchAll(); }} />

      {/* ── Dialog: Buat Batch ── */}
      {batchDialog !== false && (
        <CreateBatchDialog open={true} onClose={() => setBatchDialog(false)} headers={headers} fromRequest={batchDialog?.from_request || null} onSuccess={() => { setBatchDialog(false); fetchAll(); }} />
      )}

      {/* ── Dialog: Reject ── */}
      {rejectDialog && (
        <RejectDialog item={rejectDialog} onClose={() => setRejectDialog(null)} onReject={rejectRequest} />
      )}

      {/* ── Dialog: Add Reject Roll ── */}
      {rollDialog && (
        <RejectRollDialog batch={rollDialog} headers={headers} onClose={() => setRollDialog(null)} onSuccess={() => { setRollDialog(null); fetchAll(); }} />
      )}

      {/* ── Dialog: View Detail ── */}
      {viewDialog && (
        <ViewDetailDialog item={viewDialog} onClose={() => setViewDialog(null)} />
      )}

      {/* ── GAP-P1: Marking Reference Viewer ── */}
      {markingDialog && (
        <MarkingViewerModal
          productName={markingDialog.productName}
          category={markingDialog.category}
          headers={headers}
          onClose={() => setMarkingDialog(null)}
        />
      )}
    </div>
  );
}

// ─── Sub-Dialogs ─────────────────────────────────────────────────────────────

function CreateRequestDialog({ open, onClose, headers, onSuccess }) {
  const [form, setForm] = useState({ product_model_name: '', product_category: 'Rok', qty_requested: '', colors: [], priority: 'normal', notes: '' });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const toggleColor = (c) => setForm(p => ({ ...p, colors: p.colors.includes(c) ? p.colors.filter(x => x !== c) : [...p.colors, c] }));

  const save = async () => {
    if (!form.product_model_name || !form.qty_requested) { toast.error('Nama produk dan qty wajib diisi'); return; }
    setSaving(true);
    const r = await fetch('/api/dewi/cutting/requests', { method: 'POST', headers, body: JSON.stringify({ ...form, qty_requested: Number(form.qty_requested) }) });
    setSaving(false);
    if (r.ok) { toast.success('Request cutting dibuat'); onSuccess(); }
    else { const e = await r.json(); toast.error(e.detail || 'Gagal membuat request'); }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Buat Request Cutting</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Nama Produk *</Label>
            <Input value={form.product_model_name} onChange={e => set('product_model_name', e.target.value)} placeholder="Contoh: Rok Midi Rayon Twill" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Kategori</Label>
              <Select value={form.product_category} onValueChange={v => set('product_category', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PRODUCT_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Qty (pcs) *</Label>
              <Input type="number" min="1" value={form.qty_requested} onChange={e => set('qty_requested', e.target.value)} placeholder="0" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Warna yang dibutuhkan</Label>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {COLORS.map(c => (
                <button key={c} onClick={() => toggleColor(c)} className={`text-xs px-2.5 py-1 rounded-full border transition-all ${ form.colors.includes(c) ? 'bg-primary/20 border-primary/40 text-primary' : 'bg-white/5 border-white/10 text-foreground/60 hover:border-white/25' }`}>{c}</button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label>Prioritas</Label>
            <Select value={form.priority} onValueChange={v => set('priority', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="normal">Normal</SelectItem><SelectItem value="urgent">Urgent</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Catatan</Label>
            <Textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} placeholder="Catatan tambahan..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Menyimpan...' : 'Buat Request'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateBatchDialog({ open, onClose, headers, fromRequest, onSuccess }) {
  const [form, setForm] = useState({
    product_model_name: fromRequest?.product_model_name || '',
    product_category: fromRequest?.product_category || '',
    request_id: fromRequest?.id || '',
    request_code: fromRequest?.request_code || '',
    cutting_date: new Date().toISOString().split('T')[0],
    operator_name: '', spv_name: '',
    total_cut_pcs: fromRequest?.qty_requested || '',
    qty_per_color: [],
    fabric_rolls_used: [],
    notes: ''
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const addRoll = () => setForm(p => ({ ...p, fabric_rolls_used: [...p.fabric_rolls_used, { roll_code: '', fabric_name: '', meters_used: '' }] }));
  const updateRoll = (i, k, v) => setForm(p => { const r = [...p.fabric_rolls_used]; r[i] = { ...r[i], [k]: v }; return { ...p, fabric_rolls_used: r }; });
  const removeRoll = (i) => setForm(p => ({ ...p, fabric_rolls_used: p.fabric_rolls_used.filter((_, idx) => idx !== i) }));

  const addColorQty = () => setForm(p => ({ ...p, qty_per_color: [...p.qty_per_color, { color: '', pcs: '' }] }));
  const updateColorQty = (i, k, v) => setForm(p => { const r = [...p.qty_per_color]; r[i] = { ...r[i], [k]: v }; return { ...p, qty_per_color: r }; });

  const save = async () => {
    if (!form.product_model_name || !form.total_cut_pcs) { toast.error('Nama produk dan total pcs wajib diisi'); return; }
    setSaving(true);
    const r = await fetch('/api/dewi/cutting/batches', {
      method: 'POST', headers,
      body: JSON.stringify({ ...form, total_cut_pcs: Number(form.total_cut_pcs) })
    });
    setSaving(false);
    if (r.ok) { toast.success('Batch cutting dibuat'); onSuccess(); }
    else { const e = await r.json(); toast.error(e.detail || 'Gagal membuat batch'); }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Buat Batch Cutting</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1 col-span-2">
              <Label>Nama Produk *</Label>
              <Input value={form.product_model_name} onChange={e => set('product_model_name', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Tanggal Cutting</Label>
              <Input type="date" value={form.cutting_date} onChange={e => set('cutting_date', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Total Pcs *</Label>
              <Input type="number" min="1" value={form.total_cut_pcs} onChange={e => set('total_cut_pcs', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Nama Operator</Label>
              <Input value={form.operator_name} onChange={e => set('operator_name', e.target.value)} placeholder="Nama operator cutting" />
            </div>
            <div className="space-y-1">
              <Label>Nama SPV</Label>
              <Input value={form.spv_name} onChange={e => set('spv_name', e.target.value)} placeholder="Nama SPV" />
            </div>
          </div>

          {/* Fabric Rolls */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Roll Kain yang Dipakai</Label>
              <Button size="sm" variant="outline" onClick={addRoll} className="text-xs h-7">+ Tambah Roll</Button>
            </div>
            {form.fabric_rolls_used.map((r, i) => (
              <div key={i} className="grid grid-cols-3 gap-2 items-end p-3 rounded-xl bg-white/3 border border-white/8">
                <div><Label className="text-xs">Kode Roll</Label><Input className="h-8" value={r.roll_code} onChange={e => updateRoll(i, 'roll_code', e.target.value)} /></div>
                <div><Label className="text-xs">Nama Kain</Label><Input className="h-8" value={r.fabric_name} onChange={e => updateRoll(i, 'fabric_name', e.target.value)} /></div>
                <div className="flex gap-1">
                  <div className="flex-1"><Label className="text-xs">Meter/Kg</Label><Input className="h-8" type="number" value={r.meters_used} onChange={e => updateRoll(i, 'meters_used', e.target.value)} /></div>
                  <Button size="icon" variant="ghost" className="mt-auto h-8 w-8 text-red-400" onClick={() => removeRoll(i)}><XCircle className="w-3.5 h-3.5" /></Button>
                </div>
              </div>
            ))}
          </div>

          {/* Qty per Color */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Qty per Warna</Label>
              <Button size="sm" variant="outline" onClick={addColorQty} className="text-xs h-7">+ Tambah Warna</Button>
            </div>
            {form.qty_per_color.map((r, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 items-end p-3 rounded-xl bg-white/3 border border-white/8">
                <div><Label className="text-xs">Warna</Label><Input className="h-8" value={r.color} onChange={e => updateColorQty(i, 'color', e.target.value)} placeholder="Contoh: Hitam" /></div>
                <div><Label className="text-xs">Pcs</Label><Input className="h-8" type="number" value={r.pcs} onChange={e => updateColorQty(i, 'pcs', e.target.value)} /></div>
              </div>
            ))}
          </div>

          <div className="space-y-1">
            <Label>Catatan</Label>
            <Textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Menyimpan...' : 'Buat Batch'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({ item, onClose, onReject }) {
  const [reason, setReason] = useState('');
  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Tolak Request {item.request_code}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-foreground/70">Produk: <strong>{item.product_model_name}</strong></p>
          <div className="space-y-1">
            <Label>Alasan penolakan *</Label>
            <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} placeholder="Masukkan alasan penolakan..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button variant="destructive" onClick={() => { if (reason) onReject(item, reason); else toast.error('Alasan wajib diisi'); }}>Tolak Request</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RejectRollDialog({ batch, headers, onClose, onSuccess }) {
  const [form, setForm] = useState({ roll_code: '', fabric_name: '', reason: '', action: 'klaim_supplier' });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const save = async () => {
    if (!form.reason) { toast.error('Alasan wajib diisi'); return; }
    setSaving(true);
    const r = await fetch(`/api/dewi/cutting/batches/${batch.id}/reject-roll`, { method: 'POST', headers, body: JSON.stringify(form) });
    setSaving(false);
    if (r.ok) { toast.success('Reject roll dilaporkan'); onSuccess(); }
    else toast.error('Gagal melaporkan');
  };
  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Lapor Reject Roll — {batch.batch_code}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Kode Roll</Label><Input className="mt-1" value={form.roll_code} onChange={e => set('roll_code', e.target.value)} /></div>
            <div><Label>Nama Kain</Label><Input className="mt-1" value={form.fabric_name} onChange={e => set('fabric_name', e.target.value)} /></div>
          </div>
          <div><Label>Alasan Reject *</Label><Textarea className="mt-1" value={form.reason} onChange={e => set('reason', e.target.value)} rows={2} /></div>
          <div className="space-y-1">
            <Label>Tindakan</Label>
            <Select value={form.action} onValueChange={v => set('action', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="klaim_supplier">Klaim ke Supplier</SelectItem>
                <SelectItem value="lanjut_potong">Lanjut Potong Bagian Layak</SelectItem>
                <SelectItem value="buang">Buang</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Menyimpan...' : 'Laporkan'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ViewDetailDialog({ item, onClose }) {
  const { type, data } = item;
  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{type === 'request' ? `Detail Request: ${data.request_code}` : `Detail Batch: ${data.batch_code}`}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2 text-sm">
          {type === 'request' ? (
            <>
              <InfoRow label="Produk" value={data.product_model_name} />
              <InfoRow label="Kategori" value={data.product_category} />
              <InfoRow label="Qty" value={`${data.qty_requested} pcs`} />
              <InfoRow label="Warna" value={(data.colors || []).join(', ')} />
              <InfoRow label="Prioritas" value={data.priority} />
              <InfoRow label="Status" value={<StatusBadge status={data.status} />} />
              <InfoRow label="Diminta oleh" value={data.requested_by} />
              <InfoRow label="Catatan" value={data.notes} />
              {data.approved_by && <InfoRow label="Disetujui oleh" value={data.approved_by} />}
              {data.rejected_reason && <InfoRow label="Alasan Tolak" value={data.rejected_reason} />}
            </>
          ) : (
            <>
              <InfoRow label="Produk" value={data.product_model_name} />
              <InfoRow label="Total Cut" value={`${data.total_cut_pcs} pcs`} />
              <InfoRow label="Tanggal" value={data.cutting_date} />
              <InfoRow label="Operator" value={data.operator_name} />
              <InfoRow label="SPV" value={data.spv_name} />
              <InfoRow label="Status" value={<StatusBadge status={data.status} />} />
              <InfoRow label="Rolls Dipakai" value={`${(data.fabric_rolls_used||[]).length} roll`} />
              {(data.rejected_rolls||[]).length > 0 && (
                <div className="p-3 rounded-xl bg-red-500/8 border border-red-400/20">
                  <p className="text-xs font-semibold text-red-400 mb-2">Reject Rolls ({data.rejected_rolls.length})</p>
                  {data.rejected_rolls.map((rr, i) => (
                    <div key={i} className="text-xs text-foreground/60">{rr.roll_code} — {rr.reason} ({rr.action})</div>
                  ))}
                </div>
              )}
              {(data.qty_per_color||[]).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-foreground/60 mb-1">Qty per Warna:</p>
                  {data.qty_per_color.map((c, i) => <div key={i} className="text-xs text-foreground/60">{c.color}: {c.pcs} pcs</div>)}
                </div>
              )}
              <InfoRow label="Catatan" value={data.notes} />
            </>
          )}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Tutup</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InfoRow({ label, value }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex gap-3">
      <span className="text-foreground/50 shrink-0 w-32">{label}:</span>
      <span className="text-foreground/80">{value}</span>
    </div>
  );
}

// ─── GAP-P1: Marking Reference Viewer ────────────────────────────────────────
/**
 * Full-screen modal for cutting operators to view marking photos/videos from RnD patterns.
 * Shows fabric usage details, zoom support, and all marking media.
 */
function MarkingViewerModal({ productName, category, headers, onClose }) {
  const [patterns, setPatterns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedPattern, setSelectedPattern] = useState(null);
  const [selectedMediaIdx, setSelectedMediaIdx] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [searchQuery, setSearchQuery] = useState(productName || '');

  useEffect(() => {
    fetchPatterns(searchQuery);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchPatterns = async (q) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('search', q);
      const r = await fetch(`/api/dewi/rnd/patterns?${params}`, { headers });
      if (r.ok) {
        const data = await r.json();
        setPatterns(data);
        if (data.length > 0) setSelectedPattern(data[0]);
      }
    } catch (e) {
      toast.error('Gagal memuat data pola');
    } finally {
      setLoading(false);
    }
  };

  const allMedia = selectedPattern ? [
    // Include marking_photo_url as first item if exists
    ...(selectedPattern.marking_photo_url ? [{
      attachment_id: 'photo_main',
      url: selectedPattern.marking_photo_url,
      content_type: 'image/jpeg',
      kind: 'photo',
      original_filename: 'Foto Marking Utama',
    }] : []),
    ...(selectedPattern.marking_media || []),
  ] : [];

  const currentMedia = allMedia[selectedMediaIdx];

  const handlePrevMedia = () => setSelectedMediaIdx(i => Math.max(0, i - 1));
  const handleNextMedia = () => setSelectedMediaIdx(i => Math.min(allMedia.length - 1, i + 1));

  const handlePatternSelect = (p) => {
    setSelectedPattern(p);
    setSelectedMediaIdx(0);
    setZoom(1);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col" data-testid="marking-viewer-modal">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 bg-black/40 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Map className="w-5 h-5 text-violet-400" />
          <div>
            <h2 className="font-bold text-white text-sm">Referensi Marking Pola</h2>
            <p className="text-xs text-white/50">{productName || 'Semua Produk'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchPatterns(searchQuery)}
              placeholder="Cari pola..."
              className="w-40 pl-3 pr-3 py-1.5 bg-white/10 border border-white/20 rounded-lg text-xs text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-violet-400"
              data-testid="marking-search-input"
            />
          </div>
          <Button size="sm" variant="outline" className="text-xs border-white/20 text-white/70 hover:text-white" onClick={() => fetchPatterns(searchQuery)}>
            Cari
          </Button>
          <Button size="icon" variant="ghost" className="text-white/60 hover:text-white" onClick={onClose} data-testid="close-marking-viewer">
            <X className="w-5 h-5" />
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* LEFT: Pattern list */}
        <div className="w-64 flex-shrink-0 border-r border-white/10 bg-black/30 overflow-y-auto">
          <div className="p-3">
            <p className="text-xs text-white/40 uppercase font-semibold mb-2">Daftar Pola ({patterns.length})</p>
            {loading ? (
              <div className="text-center py-8 text-white/40 text-xs">Memuat pola...</div>
            ) : patterns.length === 0 ? (
              <div className="text-center py-8 text-white/40 text-xs">
                <Map className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p>Tidak ada pola ditemukan</p>
                <p className="mt-1 text-white/25">Coba kata kunci lain</p>
              </div>
            ) : (
              <div className="space-y-2">
                {patterns.map((p) => {
                  const mediaCount = (p.marking_media?.length || 0) + (p.marking_photo_url ? 1 : 0);
                  const isSelected = selectedPattern?.id === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => handlePatternSelect(p)}
                      className={`w-full text-left p-3 rounded-xl border transition-all ${
                        isSelected
                          ? 'bg-violet-600/30 border-violet-400/50'
                          : 'bg-white/5 border-white/10 hover:bg-white/10'
                      }`}
                      data-testid={`pattern-item-${p.id}`}
                    >
                      <div className="font-mono text-xs font-semibold text-white/80">{p.pattern_code}</div>
                      <div className="text-xs text-white/50 mt-0.5 truncate">{p.style_name || p.style_code}</div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                          p.status === 'approved'
                            ? 'bg-green-500/20 text-green-300'
                            : 'bg-amber-500/20 text-amber-300'
                        }`}>
                          {p.status === 'approved' ? 'Disetujui' : 'Draft'}
                        </span>
                        {mediaCount > 0 && (
                          <span className="text-[10px] text-violet-400 flex items-center gap-0.5">
                            <Image className="w-2.5 h-2.5" />{mediaCount}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* CENTER: Media viewer */}
        <div className="flex-1 flex flex-col bg-black/20">
          {!selectedPattern ? (
            <div className="flex-1 flex items-center justify-center text-white/30">
              <div className="text-center">
                <Map className="w-16 h-16 mx-auto mb-3 opacity-30" />
                <p>Pilih pola dari daftar kiri</p>
              </div>
            </div>
          ) : allMedia.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-white/30">
              <div className="text-center">
                <Image className="w-16 h-16 mx-auto mb-3 opacity-30" />
                <p className="font-medium">Belum ada media marking</p>
                <p className="text-sm mt-1 text-white/20">Upload foto/video marking di modul RnD &rarr; Pola</p>
              </div>
            </div>
          ) : (
            <>
              {/* Media display */}
              <div className="flex-1 relative overflow-hidden flex items-center justify-center p-4">
                {currentMedia?.kind === 'video' || (currentMedia?.content_type || '').startsWith('video') ? (
                  <video
                    key={currentMedia.url}
                    src={currentMedia.url}
                    controls
                    className="max-h-full max-w-full rounded-xl shadow-2xl"
                    style={{ transform: `scale(${zoom})`, transition: 'transform 0.2s ease' }}
                  />
                ) : (
                  <img
                    key={currentMedia?.url}
                    src={currentMedia?.url}
                    alt={currentMedia?.original_filename || 'Marking'}
                    className="max-h-full max-w-full rounded-xl shadow-2xl object-contain"
                    style={{ transform: `scale(${zoom})`, transition: 'transform 0.2s ease', cursor: zoom > 1 ? 'zoom-out' : 'zoom-in' }}
                    onClick={() => setZoom(z => z > 1 ? 1 : 2)}
                    onError={(e) => { e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150"><rect fill="%23333" width="200" height="150"/><text fill="%23888" x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-size="12">Gambar tidak tersedia</text></svg>'; }}
                  />
                )}

                {/* Navigation arrows */}
                {allMedia.length > 1 && (
                  <>
                    <button
                      onClick={handlePrevMedia}
                      disabled={selectedMediaIdx === 0}
                      className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/60 border border-white/20 flex items-center justify-center text-white hover:bg-black/80 disabled:opacity-20 transition-all"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <button
                      onClick={handleNextMedia}
                      disabled={selectedMediaIdx === allMedia.length - 1}
                      className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/60 border border-white/20 flex items-center justify-center text-white hover:bg-black/80 disabled:opacity-20 transition-all"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </>
                )}

                {/* Zoom controls */}
                <div className="absolute top-3 right-3 flex flex-col gap-1">
                  <button onClick={() => setZoom(z => Math.min(3, z + 0.5))} className="w-8 h-8 rounded-lg bg-black/60 border border-white/20 flex items-center justify-center text-white hover:bg-black/80" title="Zoom In">
                    <ZoomIn className="w-4 h-4" />
                  </button>
                  <button onClick={() => setZoom(z => Math.max(0.5, z - 0.5))} className="w-8 h-8 rounded-lg bg-black/60 border border-white/20 flex items-center justify-center text-white hover:bg-black/80" title="Zoom Out">
                    <ZoomOut className="w-4 h-4" />
                  </button>
                  {zoom !== 1 && (
                    <button onClick={() => setZoom(1)} className="w-8 h-8 rounded-lg bg-black/60 border border-white/20 flex items-center justify-center text-white hover:bg-black/80" title="Reset Zoom">
                      <Maximize2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Media counter */}
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/60 border border-white/15 text-xs text-white/70">
                  {selectedMediaIdx + 1} / {allMedia.length}
                </div>
              </div>

              {/* Thumbnail strip */}
              {allMedia.length > 1 && (
                <div className="flex gap-2 px-4 py-2 border-t border-white/10 bg-black/20 overflow-x-auto">
                  {allMedia.map((m, i) => (
                    <button
                      key={m.attachment_id}
                      onClick={() => { setSelectedMediaIdx(i); setZoom(1); }}
                      className={`flex-shrink-0 w-14 h-14 rounded-lg border-2 overflow-hidden transition-all ${
                        i === selectedMediaIdx ? 'border-violet-400' : 'border-white/15 opacity-60 hover:opacity-100'
                      }`}
                    >
                      {m.kind === 'video' || (m.content_type || '').startsWith('video') ? (
                        <div className="w-full h-full bg-white/10 flex items-center justify-center">
                          <Film className="w-5 h-5 text-white/60" />
                        </div>
                      ) : (
                        <img src={m.url} alt="" className="w-full h-full object-cover" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* RIGHT: Fabric details panel */}
        {selectedPattern && (
          <div className="w-72 flex-shrink-0 border-l border-white/10 bg-black/30 overflow-y-auto">
            <div className="p-4 space-y-4">
              <div>
                <p className="text-xs text-white/40 uppercase font-semibold mb-3">Detail Pola & Fabric</p>
                <div className="space-y-3">
                  <DetailItem icon={FileText} label="Kode Pola" value={selectedPattern.pattern_code} />
                  <DetailItem icon={Ruler} label="Ukuran" value={selectedPattern.size_range} />
                  <DetailItem icon={Layers} label="Total Pieces" value={selectedPattern.total_pieces ? `${selectedPattern.total_pieces} pcs` : null} />
                  <DetailItem icon={Ruler} label="Lebar Kain" value={selectedPattern.fabric_width ? `${selectedPattern.fabric_width} cm` : null} />
                </div>
              </div>

              {/* Fabric usage highlight */}
              {selectedPattern.fabric_usage_per_pcs > 0 && (
                <div className="p-3 rounded-xl bg-violet-500/15 border border-violet-400/30">
                  <p className="text-xs text-violet-400 font-semibold mb-1">Pemakaian Kain per Pcs</p>
                  <p className="text-2xl font-bold text-white">{selectedPattern.fabric_usage_per_pcs} <span className="text-sm font-normal text-white/50">meter</span></p>
                  {selectedPattern.efficiency_pct > 0 && (
                    <p className="text-xs text-violet-300 mt-1">Efisiensi: {selectedPattern.efficiency_pct}%</p>
                  )}
                </div>
              )}

              {selectedPattern.hpp_fabric_per_pcs > 0 && (
                <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-400/30">
                  <p className="text-xs text-emerald-400 font-semibold mb-1">HPP Kain per Pcs</p>
                  <p className="text-xl font-bold text-white">Rp {selectedPattern.hpp_fabric_per_pcs?.toLocaleString('id-ID')}</p>
                </div>
              )}

              {selectedPattern.notes && (
                <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Info className="w-3.5 h-3.5 text-white/50" />
                    <p className="text-xs text-white/50 font-semibold">Catatan Pola</p>
                  </div>
                  <p className="text-sm text-white/70">{selectedPattern.notes}</p>
                </div>
              )}

              {/* Current media info */}
              {currentMedia && (
                <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                  <p className="text-xs text-white/40 font-semibold mb-1">Media Dipilih</p>
                  <p className="text-xs text-white/70 truncate">{currentMedia.original_filename || 'Media'}</p>
                  {currentMedia.uploaded_by && (
                    <p className="text-[10px] text-white/30 mt-0.5">Diunggah: {currentMedia.uploaded_by}</p>
                  )}
                  <span className={`mt-1.5 inline-block text-[10px] px-2 py-0.5 rounded-full ${
                    currentMedia.kind === 'video' ? 'bg-blue-500/20 text-blue-300' : 'bg-green-500/20 text-green-300'
                  }`}>
                    {currentMedia.kind === 'video' ? 'Video' : 'Foto'}
                  </span>
                </div>
              )}

              {/* Style link */}
              {selectedPattern.style_name && (
                <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-xs">
                  <p className="text-white/40 font-semibold mb-1">Style Terkait</p>
                  <p className="text-white/70">{selectedPattern.style_code} — {selectedPattern.style_name}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailItem({ icon: Icon, label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2">
      <Icon className="w-3.5 h-3.5 text-white/40 mt-0.5 shrink-0" />
      <div>
        <p className="text-[10px] text-white/40">{label}</p>
        <p className="text-sm text-white/80">{value}</p>
      </div>
    </div>
  );
}
