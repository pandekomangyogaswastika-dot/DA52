/**
 * WMS Opname Enhanced — Advanced Cycle Counting & Variance Analysis
 * ─────────────────────────────────────────────────────────────────
 * P3 TD-008 (Session #11.9): Rewritten to align with actual `wms_opname2.py`
 * SSOT backend (was previously calling non-existent /api/wms/opname2/cycles
 * and /stats endpoints which never existed — module was BROKEN).
 *
 * Backend endpoints used (verified):
 *   GET    /api/wms/opname2?status=&search=&page=&limit=
 *   GET    /api/wms/opname2/stats                           (NEW, this session)
 *   POST   /api/wms/opname2/start
 *   GET    /api/wms/opname2/{session_id}
 *   POST   /api/wms/opname2/{session_id}/scan
 *   POST   /api/wms/opname2/{session_id}/submit
 *   POST   /api/wms/opname2/{session_id}/approve
 *   POST   /api/wms/opname2/{session_id}/cancel
 *
 * Status flow: open → (scan items) → submit → pending_approval → approve → approved
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ClipboardCheck, Plus, RefreshCw, CheckCircle2, AlertTriangle, Loader2,
  Search, BarChart3, X, Save, Package, Send, Ban, ScanLine, FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from './EmptyState';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

const API = process.env.REACT_APP_BACKEND_URL;

const STATUS_LABELS = {
  open:             'Berjalan',
  counted:          'Counted',
  pending_approval: 'Menunggu Persetujuan',
  approved:         'Disetujui',
  cancelled:        'Dibatalkan',
};

const STATUS_COLORS = {
  open:             'bg-amber-500/20 text-amber-300 border-amber-500/30',
  counted:          'bg-blue-500/20 text-blue-300 border-blue-500/30',
  pending_approval: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  approved:         'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  cancelled:        'bg-red-500/20 text-red-300 border-red-500/30',
};

const MODE_LABELS = {
  full_count:  'Full Count',
  cycle_count: 'Cycle Count',
};

const SCOPE_LABELS = {
  all:      'Seluruh Gudang',
  building: 'Gedung',
  zone:     'Zona',
  rack:     'Rak',
};

const fmt = (n) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n ?? 0);

export default function WMSOpnameEnhancedModule({ token }) {
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
    [token],
  );

  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [createDialog, setCreateDialog] = useState(false);
  const [detailDialog, setDetailDialog] = useState(null); // session object
  const [scanDialog, setScanDialog] = useState(null);     // session object
  const [stats, setStats] = useState(null);
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (tab !== 'all') params.set('status', tab);
      params.set('limit', '50');

      const [listRes, statsRes] = await Promise.all([
        fetch(`${API}/api/wms/opname2?${params}`, { headers }).then((r) => r.json()),
        fetch(`${API}/api/wms/opname2/stats`, { headers }).then((r) => r.json()),
      ]);
      setSessions(listRes.items || []);
      setStats(statsRes || null);
    } catch (e) {
      toast.error('Gagal memuat data opname');
    } finally {
      setLoading(false);
    }
  }, [headers, search, tab]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      mode:        fd.get('mode') || 'cycle_count',
      scope_type:  fd.get('scope_type') || 'all',
      scope_id:    (fd.get('scope_id') || '').trim(),
      scope_label: (fd.get('scope_label') || '').trim(),
      notes:       (fd.get('notes') || '').trim(),
      blind_mode:  fd.get('blind_mode') === 'on',   // Task 2.3: Blind Count mode
    };
    try {
      const r = await fetch(`${API}/api/wms/opname2/start`, {
        method: 'POST', headers, body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) {
        throw new Error(data?.detail || 'Gagal membuat sesi opname');
      }
      toast.success(`Sesi opname dibuat: ${data?.session?.session_no || ''}`);
      setCreateDialog(false);
      load();
    } catch (err) {
      toast.error(err.message || 'Gagal membuat sesi opname');
    }
  };

  const refreshDetail = async (sessionId) => {
    try {
      const r = await fetch(`${API}/api/wms/opname2/${sessionId}`, { headers });
      const data = await r.json();
      if (!r.ok) throw new Error();
      setDetailDialog(data);
    } catch {
      toast.error('Gagal memuat detail sesi');
    }
  };

  const handleViewDetail = async (session) => {
    await refreshDetail(session.id);
  };

  const handleScan = async (sess) => {
    setScanDialog(sess);
  };

  const submitScan = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      position_barcode: (fd.get('position_barcode') || '').trim(),
      position_id:      (fd.get('position_id') || '').trim(),
      material_code:    (fd.get('material_code') || '').trim(),
      counted_qty:      Number(fd.get('counted_qty') || 0),
      notes:            (fd.get('notes') || '').trim(),
    };
    try {
      const r = await fetch(`${API}/api/wms/opname2/${scanDialog.id}/scan`, {
        method: 'POST', headers, body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.detail || 'Scan gagal');
      toast.success(`Counted ${data.counted_items}/${data.total_items}`);
      e.target.reset();
      // refresh detail data so the dialog reflects new count
      if (detailDialog?.id === scanDialog.id) await refreshDetail(scanDialog.id);
    } catch (err) {
      toast.error(err.message || 'Scan gagal');
    }
  };

  const handleSubmit = async (sess) => {
    setBusyId(sess.id);
    try {
      const r = await fetch(`${API}/api/wms/opname2/${sess.id}/submit`, {
        method: 'POST', headers, body: '{}',
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.detail || 'Submit gagal');
      toast.success('Sesi opname dikirim untuk persetujuan');
      load();
      if (detailDialog?.id === sess.id) await refreshDetail(sess.id);
    } catch (err) {
      toast.error(err.message || 'Submit gagal');
    } finally {
      setBusyId('');
    }
  };

  const handleApprove = async (sess) => {
    setBusyId(sess.id);
    try {
      const r = await fetch(`${API}/api/wms/opname2/${sess.id}/approve`, {
        method: 'POST', headers,
        body: JSON.stringify({ apply_adjustments: true, notes: '' }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.detail || 'Approve gagal');
      toast.success(`Disetujui ${data.adjustments_applied ? '(adjustments applied)' : ''}`);
      load();
      if (detailDialog?.id === sess.id) await refreshDetail(sess.id);
    } catch (err) {
      toast.error(err.message || 'Approve gagal');
    } finally {
      setBusyId('');
    }
  };

  const handleCancel = async (sess) => {
    if (!confirm(`Batalkan sesi opname "${sess.session_no}"?`)) return;
    setBusyId(sess.id);
    try {
      const r = await fetch(`${API}/api/wms/opname2/${sess.id}/cancel`, {
        method: 'POST', headers, body: JSON.stringify({ reason: 'cancelled by user' }),
      });
      if (!r.ok) throw new Error();
      toast.success('Sesi dibatalkan');
      load();
      if (detailDialog?.id === sess.id) setDetailDialog(null);
    } catch {
      toast.error('Cancel gagal');
    } finally {
      setBusyId('');
    }
  };

  const handleDownloadPdf = (sess) => {
    if (!token) return toast.error('Token tidak tersedia');
    const url = `${API}/api/wms/opname2/${sess.id}/count-sheet-pdf?token=${encodeURIComponent(token)}`;
    window.open(url, '_blank');
  };

  return (
    <div
      className="h-full flex flex-col bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-800 text-zinc-100"
      data-testid="wms-opname-enhanced-module"
    >
      {/* Header */}
      <div className="border-b border-white/10 bg-black/20 backdrop-blur-sm">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-purple-500/20 border border-purple-500/30">
                <ClipboardCheck className="w-5 h-5 text-purple-300" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-semibold text-white">Opname Enhanced</h1>
                  <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 text-[11px] font-medium border border-emerald-500/30">SSOT</span>
                </div>
                <p className="text-sm text-zinc-400 mt-0.5">
                  Cycle counting &amp; variance analysis — backed by{' '}
                  <span className="font-mono text-purple-300">wh_opname_sessions2</span>
                </p>
              </div>
            </div>
            <Button
              onClick={() => setCreateDialog(true)}
              className="bg-purple-600 hover:bg-purple-700 text-white"
              data-testid="create-cycle-btn"
            >
              <Plus className="w-4 h-4 mr-2" />
              Sesi Baru
            </Button>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4" data-testid="opname-stats-grid">
            <StatCard
              testid="stat-total"
              label="Total Sesi"
              value={stats?.total_sessions ?? 0}
              icon={<ClipboardCheck className="w-4 h-4 text-purple-400" />}
            />
            <StatCard
              testid="stat-active"
              label="Aktif"
              value={stats?.active_count ?? 0}
              icon={<Loader2 className="w-4 h-4 text-amber-400" />}
            />
            <StatCard
              testid="stat-approved"
              label="Disetujui"
              value={stats?.approved_count ?? 0}
              icon={<CheckCircle2 className="w-4 h-4 text-emerald-400" />}
            />
            <StatCard
              testid="stat-variances"
              label="Total Variance"
              value={stats?.total_variances ?? 0}
              icon={<BarChart3 className="w-4 h-4 text-rose-400" />}
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <Input
                placeholder="Cari nomor sesi atau scope..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-white/5 border-white/10 text-white"
                data-testid="search-cycle-input"
              />
            </div>
            <Button
              variant="outline"
              onClick={load}
              disabled={loading}
              className="border-white/10 hover:bg-white/5"
              data-testid="refresh-cycle-btn"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab} className="px-6">
          <TabsList className="bg-white/5 border-b border-white/10 w-full justify-start rounded-none">
            <TabsTrigger value="all" data-testid="tab-all">Semua</TabsTrigger>
            <TabsTrigger value="open" data-testid="tab-open">Berjalan</TabsTrigger>
            <TabsTrigger value="pending_approval" data-testid="tab-pending">Menunggu</TabsTrigger>
            <TabsTrigger value="approved" data-testid="tab-approved">Disetujui</TabsTrigger>
            <TabsTrigger value="cancelled" data-testid="tab-cancelled">Dibatalkan</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Sessions List */}
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-64" data-testid="loading-cycles">
            <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
          </div>
        ) : sessions.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title="Belum ada sesi opname"
            description="Sesi opname akan muncul di sini. Klik 'Sesi Baru' untuk membuat sesi opname pertama."
            data-testid="empty-cycles"
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="opname-grid">
            {sessions.map((sess) => (
              <SessionCard
                key={sess.id}
                sess={sess}
                onView={() => handleViewDetail(sess)}
                onScan={() => handleScan(sess)}
                onSubmit={() => handleSubmit(sess)}
                onApprove={() => handleApprove(sess)}
                onCancel={() => handleCancel(sess)}
                onPdf={() => handleDownloadPdf(sess)}
                busy={busyId === sess.id}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={createDialog} onOpenChange={setCreateDialog}>
        <DialogContent className="bg-zinc-900 text-white border-white/10 max-w-2xl" data-testid="create-cycle-dialog">
          <DialogHeader>
            <DialogTitle>Buat Sesi Opname Baru</DialogTitle>
            <DialogDescription className="text-zinc-400">
              Sesi akan auto-membuat snapshot posisi sesuai scope yang dipilih.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate}>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Mode</Label>
                  <Select name="mode" defaultValue="cycle_count">
                    <SelectTrigger className="bg-white/5 border-white/10" data-testid="input-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cycle_count">Cycle Count</SelectItem>
                      <SelectItem value="full_count">Full Count</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Scope</Label>
                  <Select name="scope_type" defaultValue="all">
                    <SelectTrigger className="bg-white/5 border-white/10" data-testid="input-scope-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Seluruh Gudang</SelectItem>
                      <SelectItem value="building">Gedung</SelectItem>
                      <SelectItem value="zone">Zona</SelectItem>
                      <SelectItem value="rack">Rak</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Scope ID</Label>
                  <Input
                    name="scope_id"
                    placeholder="building/zone/rack ID (opsional)"
                    className="bg-white/5 border-white/10"
                    data-testid="input-scope-id"
                  />
                </div>
                <div>
                  <Label>Label Scope</Label>
                  <Input
                    name="scope_label"
                    placeholder="contoh: Gudang A / Zona Fabric"
                    className="bg-white/5 border-white/10"
                    data-testid="input-scope-label"
                  />
                </div>
              </div>
              <div>
                <Label>Catatan</Label>
                <Textarea
                  name="notes"
                  placeholder="Catatan tambahan untuk sesi ini..."
                  className="bg-white/5 border-white/10"
                  data-testid="input-notes"
                />
              </div>
              {/* Task 2.3: Blind Count Mode toggle */}
              <div className="flex items-center gap-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <input
                  type="checkbox"
                  name="blind_mode"
                  id="blind_mode"
                  className="w-4 h-4 accent-amber-500"
                  data-testid="input-blind-mode"
                />
                <div>
                  <label htmlFor="blind_mode" className="text-sm font-medium text-amber-200 cursor-pointer">
                    🙈 Blind Count Mode
                  </label>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Petugas tidak melihat jumlah sistem saat pencacahan — hasil lebih objektif &amp; akurat.
                  </p>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateDialog(false)}
                className="border-white/10"
              >
                Batal
              </Button>
              <Button
                type="submit"
                className="bg-purple-600 hover:bg-purple-700"
                data-testid="submit-create-cycle"
              >
                <Save className="w-4 h-4 mr-2" />
                Simpan
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      {detailDialog && (
        <Dialog open={!!detailDialog} onOpenChange={() => setDetailDialog(null)}>
          <DialogContent
            className="bg-zinc-900 text-white border-white/10 max-w-4xl max-h-[90vh] overflow-auto"
            data-testid="view-cycle-dialog"
          >
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ClipboardCheck className="w-5 h-5 text-purple-400" />
                {detailDialog.session_no}
                <span className={`ml-2 px-2 py-0.5 rounded-full text-xs border ${STATUS_COLORS[detailDialog.status] || ''}`}>
                  {STATUS_LABELS[detailDialog.status] || detailDialog.status}
                </span>
              </DialogTitle>
              <DialogDescription className="text-zinc-400">
                Mode: {MODE_LABELS[detailDialog.mode] || detailDialog.mode} • Scope:{' '}
                {SCOPE_LABELS[detailDialog.scope_type] || detailDialog.scope_type}
                {detailDialog.scope_label ? ` (${detailDialog.scope_label})` : ''}
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <DetailStat label="Total Item" value={detailDialog.total_items ?? 0} />
              <DetailStat label="Counted" value={detailDialog.counted_items ?? 0} />
              <DetailStat
                label="Variance Items"
                value={detailDialog.total_variance_items ?? 0}
                tone={(detailDialog.total_variance_items ?? 0) > 0 ? 'rose' : 'default'}
              />
              <DetailStat label="Dibuat oleh" value={detailDialog.created_by || '—'} mono />
            </div>

            <div className="border-t border-white/10 pt-4 mt-4">
              <h3 className="text-sm font-semibold mb-3 text-zinc-300">Count Items</h3>
              {/* Task 2.3: Blind mode reveal banner */}
              {detailDialog.blind_mode && ['submitted', 'approved'].includes(detailDialog.status) && (
                <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-400/10 px-3 py-2 rounded-lg border border-amber-400/20 mb-3">
                  🔓 <span>Qty sistem ditampilkan — sesi telah disubmit/disetujui (blind mode reveal)</span>
                </div>
              )}
              {detailDialog.blind_mode && !['submitted', 'approved'].includes(detailDialog.status) && (
                <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-400/10 px-3 py-2 rounded-lg border border-amber-400/20 mb-3">
                  🔒 <span>Mode Blind Count aktif — qty sistem tersembunyi sampai sesi disubmit</span>
                </div>
              )}
              {(detailDialog.count_items || []).length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-4">Belum ada item di sesi ini.</p>
              ) : (
                <div className="space-y-2 max-h-72 overflow-auto" data-testid="count-items-list">
                  {(detailDialog.count_items || []).map((it, i) => {
                    const variance = it.variance ?? 0;
                    return (
                      <div
                        key={i}
                        className="bg-white/5 border border-white/10 rounded p-3 text-sm flex items-center gap-3"
                        data-testid={`count-item-${i}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-white truncate">
                            {it.material_name || it.material_code || it.position_barcode || `Item ${i + 1}`}
                          </div>
                          <div className="text-xs text-zinc-500 truncate">
                            {it.position_barcode || it.position_id || ''}
                          </div>
                        </div>
                        {/* Phase 3.3C + Task 2.3: Hide system_qty if blind_mode — reveal after submit/approve */}
                        {(!detailDialog.blind_mode || ['submitted', 'approved'].includes(detailDialog.status)) && (
                          <div className="text-right">
                            <div className="text-zinc-400 text-xs">System</div>
                            <div className="font-mono">{fmt(it.system_qty)}</div>
                          </div>
                        )}
                        <div className="text-right">
                          <div className="text-zinc-400 text-xs">Counted</div>
                          <div className="font-mono">{it.counted ? fmt(it.counted_qty) : '—'}</div>
                        </div>
                        {/* Phase 3.3C + Task 2.3: Hide diff if blind_mode — reveal after submit/approve */}
                        {(!detailDialog.blind_mode || ['submitted', 'approved'].includes(detailDialog.status)) && (
                          <div className="text-right min-w-[60px]">
                            <div className="text-zinc-400 text-xs">Diff</div>
                            <div className={`font-mono ${variance > 0 ? 'text-emerald-300' : variance < 0 ? 'text-rose-300' : 'text-zinc-500'}`}>
                              {it.counted ? (variance > 0 ? `+${fmt(variance)}` : fmt(variance)) : '—'}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <DialogFooter className="flex-wrap gap-2 pt-4">
              <Button
                variant="outline"
                onClick={() => handleDownloadPdf(detailDialog)}
                className="border-white/10"
                data-testid="detail-pdf-btn"
              >
                <FileText className="w-4 h-4 mr-2" />
                Count Sheet PDF
              </Button>
              {detailDialog.status === 'open' && (
                <Button
                  onClick={() => handleScan(detailDialog)}
                  className="bg-blue-600 hover:bg-blue-700"
                  data-testid="detail-scan-btn"
                >
                  <ScanLine className="w-4 h-4 mr-2" />
                  Scan / Count
                </Button>
              )}
              {detailDialog.status === 'open' && (detailDialog.counted_items ?? 0) > 0 && (
                <Button
                  onClick={() => handleSubmit(detailDialog)}
                  className="bg-purple-600 hover:bg-purple-700"
                  data-testid="detail-submit-btn"
                >
                  <Send className="w-4 h-4 mr-2" />
                  Submit Approval
                </Button>
              )}
              {detailDialog.status === 'pending_approval' && (
                <Button
                  onClick={() => handleApprove(detailDialog)}
                  className="bg-emerald-600 hover:bg-emerald-700"
                  data-testid="detail-approve-btn"
                >
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Setujui
                </Button>
              )}
              {!['approved', 'cancelled'].includes(detailDialog.status) && (
                <Button
                  variant="outline"
                  onClick={() => handleCancel(detailDialog)}
                  className="border-red-500/30 text-red-300 hover:bg-red-500/10"
                  data-testid="detail-cancel-btn"
                >
                  <Ban className="w-4 h-4 mr-2" />
                  Batalkan
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => setDetailDialog(null)}
                className="border-white/10"
              >
                <X className="w-4 h-4 mr-2" />
                Tutup
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Scan / Quick-Count Dialog */}
      {scanDialog && (
        <Dialog open={!!scanDialog} onOpenChange={() => setScanDialog(null)}>
          <DialogContent className="bg-zinc-900 text-white border-white/10 max-w-md" data-testid="scan-dialog">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ScanLine className="w-5 h-5 text-blue-400" />
                Scan / Hitung Posisi
              </DialogTitle>
              <DialogDescription className="text-zinc-400">
                {scanDialog.session_no} • {scanDialog.scope_label}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={submitScan}>
              <div className="space-y-3 py-2">
                <div>
                  <Label>Position Barcode</Label>
                  <Input
                    name="position_barcode"
                    placeholder="Scan barcode posisi"
                    className="bg-white/5 border-white/10 font-mono"
                    autoFocus
                    data-testid="scan-barcode-input"
                  />
                </div>
                <div>
                  <Label>Position ID (opsional)</Label>
                  <Input
                    name="position_id"
                    placeholder="UUID posisi (opsional)"
                    className="bg-white/5 border-white/10 font-mono text-xs"
                    data-testid="scan-position-id-input"
                  />
                </div>
                <div>
                  <Label>Kode Material</Label>
                  <Input
                    name="material_code"
                    placeholder="contoh: MAT-001"
                    className="bg-white/5 border-white/10"
                    data-testid="scan-material-input"
                  />
                </div>
                <div>
                  <Label>Qty Fisik *</Label>
                  <Input
                    name="counted_qty"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    className="bg-white/5 border-white/10 font-mono"
                    data-testid="scan-qty-input"
                  />
                </div>
                <div>
                  <Label>Catatan</Label>
                  <Textarea
                    name="notes"
                    placeholder="Catatan (opsional)"
                    className="bg-white/5 border-white/10"
                    rows={2}
                    data-testid="scan-notes-input"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setScanDialog(null)}
                  className="border-white/10"
                >
                  Tutup
                </Button>
                <Button
                  type="submit"
                  className="bg-blue-600 hover:bg-blue-700"
                  data-testid="scan-submit-btn"
                >
                  <Package className="w-4 h-4 mr-2" />
                  Catat
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ testid, label, value, icon }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-lg p-3" data-testid={testid}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-500">{label}</span>
        {icon}
      </div>
      <p className="text-2xl font-bold text-white mt-1">{fmt(value)}</p>
    </div>
  );
}

function DetailStat({ label, value, mono, tone }) {
  const cls = tone === 'rose' ? 'text-rose-300' : 'text-white';
  return (
    <div className="bg-white/5 border border-white/10 rounded-lg p-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`font-semibold mt-1 ${cls} ${mono ? 'font-mono text-xs' : ''}`}>{value}</div>
    </div>
  );
}

function SessionCard({ sess, onView, onScan, onSubmit, onApprove, onCancel, onPdf, busy }) {
  const variance = sess.total_variance_items ?? 0;
  const counted  = sess.counted_items ?? 0;
  const total    = sess.total_items ?? 0;
  const progress = total > 0 ? Math.round((counted / total) * 100) : 0;
  return (
    <div
      className="bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 transition-colors"
      data-testid={`session-card-${sess.session_no?.replace(/[^a-zA-Z0-9]/g, '-')}`}
    >
      <div className="flex items-start justify-between mb-3">
        <button
          type="button"
          className="text-left flex-1 cursor-pointer"
          onClick={onView}
          data-testid={`session-open-${sess.id}`}
        >
          <div className="flex items-center gap-2 mb-1">
            <ClipboardCheck className="w-4 h-4 text-purple-400" />
            <h3 className="font-semibold text-white truncate">{sess.session_no || sess.id}</h3>
          </div>
          <p className="text-xs text-zinc-400 truncate">
            {MODE_LABELS[sess.mode] || sess.mode} • {SCOPE_LABELS[sess.scope_type] || sess.scope_type}
                {sess.blind_mode && <span className="ml-2 text-[10px] font-bold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">BLIND</span>}
            {sess.scope_label ? ` • ${sess.scope_label}` : ''}
          </p>
        </button>
        <span className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] border ${STATUS_COLORS[sess.status] || ''}`}>
          {STATUS_LABELS[sess.status] || sess.status}
        </span>
      </div>

      <div className="space-y-1.5 text-xs">
        <div className="flex justify-between">
          <span className="text-zinc-500">Counted</span>
          <span className="text-zinc-200 font-mono">{counted}/{total} ({progress}%)</span>
        </div>
        <div className="w-full h-1.5 rounded bg-white/5 overflow-hidden">
          <div className="h-full bg-purple-500/60" style={{ width: `${progress}%` }} />
        </div>
        {variance > 0 && (
          <div className="flex justify-between mt-2">
            <span className="text-zinc-500">Variance</span>
            <span className="text-rose-300 font-mono">{variance}</span>
          </div>
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-white/10 flex flex-wrap gap-1.5">
        {sess.status === 'open' && (
          <Button
            size="sm"
            className="bg-blue-600 hover:bg-blue-700 text-xs h-7 px-2"
            onClick={(e) => { e.stopPropagation(); onScan(); }}
            disabled={busy}
            data-testid={`scan-btn-${sess.id}`}
          >
            <ScanLine className="w-3 h-3 mr-1" />
            Scan
          </Button>
        )}
        {sess.status === 'open' && counted > 0 && (
          <Button
            size="sm"
            className="bg-purple-600 hover:bg-purple-700 text-xs h-7 px-2"
            onClick={(e) => { e.stopPropagation(); onSubmit(); }}
            disabled={busy}
            data-testid={`submit-btn-${sess.id}`}
          >
            <Send className="w-3 h-3 mr-1" />
            Submit
          </Button>
        )}
        {sess.status === 'pending_approval' && (
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-xs h-7 px-2"
            onClick={(e) => { e.stopPropagation(); onApprove(); }}
            disabled={busy}
            data-testid={`approve-btn-${sess.id}`}
          >
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Approve
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="border-white/10 text-xs h-7 px-2"
          onClick={(e) => { e.stopPropagation(); onPdf(); }}
          data-testid={`pdf-btn-${sess.id}`}
        >
          <FileText className="w-3 h-3 mr-1" />
          PDF
        </Button>
        {!['approved', 'cancelled'].includes(sess.status) && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto border-red-500/30 text-red-300 hover:bg-red-500/10 text-xs h-7 px-2"
            onClick={(e) => { e.stopPropagation(); onCancel(); }}
            disabled={busy}
            data-testid={`cancel-btn-${sess.id}`}
          >
            <Ban className="w-3 h-3 mr-1" />
            Batal
          </Button>
        )}
      </div>
    </div>
  );
}
