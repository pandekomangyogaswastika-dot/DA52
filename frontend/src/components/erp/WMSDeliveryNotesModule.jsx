/**
 * WMS Delivery Notes — Surat Jalan PDF Generator
 * P0-WH-2: Create, issue, and download PDF delivery notes
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FileText, Plus, RefreshCw, Eye, Download, Truck, X, Save, Edit2,
  CheckCircle2, XCircle, Loader2, Search, Calendar, User, Package
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

const SJ_TYPES = {
  'SJ-CMT': { label: 'CMT', color: 'bg-blue-500/20 text-blue-300' },
  'SJ-MAKLON': { label: 'Maklon', color: 'bg-purple-500/20 text-purple-300' },
  'SJ-SUPPLIER': { label: 'Supplier Return', color: 'bg-amber-500/20 text-amber-300' },
  'SJ-INTERNAL': { label: 'Internal Transfer', color: 'bg-emerald-500/20 text-emerald-300' },
  'SJ-ONLINE': { label: 'Online Shop', color: 'bg-pink-500/20 text-pink-300' },
};

const STATUS_COLORS = {
  draft: 'bg-zinc-500/20 text-zinc-300',
  issued: 'bg-blue-500/20 text-blue-300',
  received: 'bg-emerald-500/20 text-emerald-300',
  cancelled: 'bg-red-500/20 text-red-300',
};

export default function WMSDeliveryNotesModule({ token }) {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }), [token]);
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [createDialog, setCreateDialog] = useState(false);
  const [viewDialog, setViewDialog] = useState(null);
  const [editingLines, setEditingLines] = useState([{ line_no: 1, description: '', qty: 0, unit: 'pcs', remarks: '' }]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (tab !== 'all') params.set('status', tab);
      const r = await fetch(`${API}/api/wms/delivery-notes?${params}`, { headers });
      const d = await r.json();
      setNotes(d.items || []);
    } catch {
      toast.error('Gagal memuat surat jalan');
    } finally {
      setLoading(false);
    }
  }, [headers, search, tab]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {
      sj_type: fd.get('sj_type'),
      recipient_name: fd.get('recipient_name'),
      recipient_address: fd.get('recipient_address'),
      recipient_phone: fd.get('recipient_phone') || '',
      shipper_name: fd.get('shipper_name') || '',
      vehicle_no: fd.get('vehicle_no') || '',
      notes: fd.get('notes') || '',
      lines: editingLines.filter(l => l.description),
    };
    try {
      const r = await fetch(`${API}/api/wms/delivery-notes`, { method: 'POST', headers, body: JSON.stringify(data) });
      if (!r.ok) throw new Error();
      toast.success('Surat jalan berhasil dibuat');
      setCreateDialog(false);
      setEditingLines([{ line_no: 1, description: '', qty: 0, unit: 'pcs', remarks: '' }]);
      load();
    } catch {
      toast.error('Gagal membuat surat jalan');
    }
  };

  const handleIssue = async (id) => {
    try {
      const r = await fetch(`${API}/api/wms/delivery-notes/${id}/issue`, { method: 'POST', headers });
      if (!r.ok) throw new Error();
      toast.success('Surat jalan berhasil di-issue');
      load();
    } catch {
      toast.error('Gagal issue surat jalan');
    }
  };

  const handleDownloadPDF = async (id) => {
    try {
      const r = await fetch(`${API}/api/wms/delivery-notes/${id}/pdf`, { headers });
      if (!r.ok) throw new Error();
      const blob = await r.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `SJ-${id}.pdf`;
      a.click();
      toast.success('PDF berhasil didownload');
    } catch {
      toast.error('Gagal download PDF');
    }
  };

  const addLine = () => {
    setEditingLines([...editingLines, { line_no: editingLines.length + 1, description: '', qty: 0, unit: 'pcs', remarks: '' }]);
  };

  const removeLine = (idx) => {
    setEditingLines(editingLines.filter((_, i) => i !== idx));
  };

  const updateLine = (idx, field, value) => {
    const updated = [...editingLines];
    updated[idx][field] = value;
    setEditingLines(updated);
  };

  const filteredNotes = useMemo(() => {
    if (tab === 'all') return notes;
    return notes.filter(n => n.status === tab);
  }, [notes, tab]);

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-800 text-zinc-100" data-testid="wms-delivery-notes-module">
      {/* Header */}
      <div className="border-b border-white/10 bg-black/20 backdrop-blur-sm">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-emerald-500/20 border border-emerald-500/30">
                <FileText className="w-5 h-5 text-emerald-300" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold text-white">Surat Jalan</h1>
                <p className="text-sm text-zinc-400 mt-0.5">Generate PDF delivery notes untuk pengiriman</p>
              </div>
            </div>
            <Button
              onClick={() => setCreateDialog(true)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              data-testid="create-sj-btn"
            >
              <Plus className="w-4 h-4 mr-2" />
              Surat Jalan Baru
            </Button>
          </div>

          {/* Search & Filters */}
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <Input
                placeholder="Cari nomor SJ, penerima..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-white/5 border-white/10 text-white"
                data-testid="search-sj-input"
              />
            </div>
            <Button
              variant="outline"
              onClick={load}
              disabled={loading}
              className="border-white/10 hover:bg-white/5"
              data-testid="refresh-sj-btn"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={setTab} className="px-6">
          <TabsList className="bg-white/5 border-b border-white/10 w-full justify-start rounded-none">
            <TabsTrigger value="all" data-testid="tab-all">Semua</TabsTrigger>
            <TabsTrigger value="draft" data-testid="tab-draft">Draft</TabsTrigger>
            <TabsTrigger value="issued" data-testid="tab-issued">Issued</TabsTrigger>
            <TabsTrigger value="received" data-testid="tab-received">Received</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Delivery Notes List */}
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="loading-sj">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="border border-white/10 rounded-xl p-4 space-y-3">
                <div className="flex justify-between">
                  <Skeleton className="h-5 w-28" />
                  <Skeleton className="h-5 w-16" />
                </div>
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-4 w-32" />
                <div className="flex gap-2 pt-1">
                  <Skeleton className="h-7 w-20" />
                  <Skeleton className="h-7 w-20" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredNotes.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="Belum ada surat jalan"
            description="Surat jalan akan muncul di sini setelah dibuat. Klik 'Buat Surat Jalan' untuk memulai."
            data-testid="empty-sj"
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredNotes.map((note) => (
              <div
                key={note.id}
                className="bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 transition-colors"
                data-testid={`sj-card-${note.sj_number}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <FileText className="w-4 h-4 text-emerald-400" />
                      <h3 className="font-semibold text-white">{note.sj_number}</h3>
                    </div>
                    <p className="text-sm text-zinc-400">{note.recipient_name}</p>
                  </div>
                  <div className="flex flex-col gap-1 items-end">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${SJ_TYPES[note.sj_type]?.color || ''}`}>
                      {SJ_TYPES[note.sj_type]?.label || note.sj_type}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_COLORS[note.status] || ''}`}>
                      {note.status}
                    </span>
                  </div>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Alamat:</span>
                    <span className="text-zinc-200 text-right truncate max-w-[200px]">{note.recipient_address}</span>
                  </div>
                  {note.vehicle_no && (
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Kendaraan:</span>
                      <span className="text-zinc-200">{note.vehicle_no}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Items:</span>
                    <span className="text-zinc-200">{note.lines?.length || 0} item</span>
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-white/10 flex gap-2">
                  {note.status === 'draft' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 border-white/10 hover:bg-white/5 text-xs"
                      onClick={() => handleIssue(note.id)}
                      data-testid={`issue-btn-${note.sj_number}`}
                    >
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                      Issue
                    </Button>
                  )}
                  {(note.status === 'issued' || note.status === 'received') && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 border-white/10 hover:bg-white/5 text-xs"
                      onClick={() => handleDownloadPDF(note.id)}
                      data-testid={`download-btn-${note.sj_number}`}
                    >
                      <Download className="w-3 h-3 mr-1" />
                      PDF
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 border-white/10 hover:bg-white/5 text-xs"
                    onClick={() => setViewDialog(note)}
                    data-testid={`view-btn-${note.sj_number}`}
                  >
                    <Eye className="w-3 h-3 mr-1" />
                    Detail
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={createDialog} onOpenChange={setCreateDialog}>
        <DialogContent className="bg-zinc-900 text-white border-white/10 max-w-3xl max-h-[90vh] overflow-auto" data-testid="create-sj-dialog">
          <DialogHeader>
            <DialogTitle>Buat Surat Jalan Baru</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate}>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Tipe SJ *</Label>
                  <Select name="sj_type" required>
                    <SelectTrigger className="bg-white/5 border-white/10" data-testid="input-sj-type">
                      <SelectValue placeholder="Pilih tipe" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SJ-CMT">CMT</SelectItem>
                      <SelectItem value="SJ-MAKLON">Maklon</SelectItem>
                      <SelectItem value="SJ-SUPPLIER">Supplier Return</SelectItem>
                      <SelectItem value="SJ-INTERNAL">Internal Transfer</SelectItem>
                      <SelectItem value="SJ-ONLINE">Online Shop</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Nama Penerima *</Label>
                  <Input name="recipient_name" required className="bg-white/5 border-white/10" data-testid="input-recipient-name" />
                </div>
              </div>

              <div>
                <Label>Alamat Penerima *</Label>
                <Textarea name="recipient_address" required className="bg-white/5 border-white/10" data-testid="input-recipient-address" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Telepon Penerima</Label>
                  <Input name="recipient_phone" className="bg-white/5 border-white/10" data-testid="input-recipient-phone" />
                </div>
                <div>
                  <Label>Nama Pengirim</Label>
                  <Input name="shipper_name" className="bg-white/5 border-white/10" data-testid="input-shipper-name" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Nomor Kendaraan</Label>
                  <Input name="vehicle_no" className="bg-white/5 border-white/10" data-testid="input-vehicle-no" />
                </div>
                <div>
                  <Label>Catatan</Label>
                  <Input name="notes" className="bg-white/5 border-white/10" data-testid="input-sj-notes" />
                </div>
              </div>

              {/* Line Items */}
              <div className="border-t border-white/10 pt-4">
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-base">Item Pengiriman</Label>
                  <Button type="button" size="sm" variant="outline" onClick={addLine} className="border-white/10" data-testid="add-line-btn">
                    <Plus className="w-4 h-4 mr-1" />
                    Tambah Item
                  </Button>
                </div>
                <div className="space-y-3">
                  {editingLines.map((line, idx) => (
                    <div key={idx} className="flex gap-2 items-start bg-white/5 p-3 rounded-lg border border-white/10">
                      <div className="flex-1 grid grid-cols-4 gap-2">
                        <Input
                          placeholder="Deskripsi"
                          value={line.description}
                          onChange={(e) => updateLine(idx, 'description', e.target.value)}
                          className="col-span-2 bg-white/5 border-white/10"
                          data-testid={`line-desc-${idx}`}
                        />
                        <Input
                          type="number"
                          placeholder="Qty"
                          value={line.qty}
                          onChange={(e) => updateLine(idx, 'qty', parseFloat(e.target.value) || 0)}
                          className="bg-white/5 border-white/10"
                          data-testid={`line-qty-${idx}`}
                        />
                        <Input
                          placeholder="Unit"
                          value={line.unit}
                          onChange={(e) => updateLine(idx, 'unit', e.target.value)}
                          className="bg-white/5 border-white/10"
                          data-testid={`line-unit-${idx}`}
                        />
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => removeLine(idx)}
                        className="text-red-400 hover:bg-red-500/10"
                        data-testid={`remove-line-${idx}`}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateDialog(false)} className="border-white/10">
                Batal
              </Button>
              <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700" data-testid="submit-create-sj">
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
          <DialogContent className="bg-zinc-900 text-white border-white/10 max-w-2xl" data-testid="view-sj-dialog">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-emerald-400" />
                {viewDialog.sj_number}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-zinc-500">Tipe:</span>
                  <p className="text-white font-medium">{SJ_TYPES[viewDialog.sj_type]?.label || viewDialog.sj_type}</p>
                </div>
                <div>
                  <span className="text-zinc-500">Status:</span>
                  <p className="text-white font-medium">{viewDialog.status}</p>
                </div>
                <div>
                  <span className="text-zinc-500">Penerima:</span>
                  <p className="text-white font-medium">{viewDialog.recipient_name}</p>
                </div>
                <div>
                  <span className="text-zinc-500">Telepon:</span>
                  <p className="text-white font-medium">{viewDialog.recipient_phone || '-'}</p>
                </div>
              </div>

              <div>
                <span className="text-zinc-500">Alamat:</span>
                <p className="text-white font-medium">{viewDialog.recipient_address}</p>
              </div>

              <div className="border-t border-white/10 pt-4">
                <h3 className="font-medium mb-3 text-zinc-400">Items</h3>
                <div className="space-y-2">
                  {viewDialog.lines?.map((line, idx) => (
                    <div key={idx} className="bg-white/5 border border-white/10 rounded p-3">
                      <div className="flex justify-between">
                        <span className="text-white">{line.description}</span>
                        <span className="text-zinc-400">{line.qty} {line.unit}</span>
                      </div>
                      {line.remarks && <p className="text-xs text-zinc-500 mt-1">{line.remarks}</p>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
