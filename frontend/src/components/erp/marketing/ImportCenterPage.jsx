import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Upload, FileSpreadsheet, CheckCircle2, Clock, AlertTriangle,
  XCircle, RotateCcw, ChevronRight, Info, Loader2,
  Trash2, RefreshCw, Eye, Filter, Users, Zap, Database
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import axios from 'axios';

const API = process.env.REACT_APP_BACKEND_URL;

const STATUS_CONFIG = {
  parsing:      { label: 'Memproses AI', color: 'text-blue-600',    bg: 'bg-blue-50 dark:bg-blue-900/20',    spin: true },
  queued:       { label: 'Antrian',      color: 'text-amber-600',   bg: 'bg-amber-50 dark:bg-amber-900/20',  spin: false },
  ready_review: { label: 'Siap Review',  color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20', spin: false },
  draft:        { label: 'Draft Edit',   color: 'text-indigo-600',  bg: 'bg-indigo-50 dark:bg-indigo-900/20', spin: false },
  committed:    { label: 'Committed',    color: 'text-green-600',   bg: 'bg-green-50 dark:bg-green-900/20',  spin: false },
  rolled_back:  { label: 'Rolled Back',  color: 'text-gray-600',    bg: 'bg-gray-50 dark:bg-gray-800/40',    spin: false },
  failed:       { label: 'Gagal',        color: 'text-red-600',     bg: 'bg-red-50 dark:bg-red-900/20',      spin: false },
};

const SOURCE_LABELS = {
  shopee_orders:       '🛒 Shopee Orders',
  tiktok_orders:       '🎵 TikTok Orders',
  tokopedia_orders:    '🟢 Tokopedia Orders',
  complaints:          '⚠️ Komplain',
  ratings_reviews:     '⭐ Rating & Review',
  ads_report:          '📊 Ads Report',
  account_health:      '💚 Kesehatan Akun',
  live_session_report: '📡 Live Session',
  content_calendar:    '📅 Konten Kalender',
  discount_campaign:   '🏷️ Diskon Kampanye',
  new_products:        '🆕 Produk Baru',
  sample_shipping:     '📦 Sample',
  returns_refunds:     '↩️ Retur & Refund',
  unknown:             '❓ Tidak Diketahui',
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.failed;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cfg.bg} ${cfg.color}`}>
      {cfg.spin && <span className="w-2 h-2 rounded-full border-2 border-current border-t-transparent animate-spin" />}
      {cfg.label}
    </span>
  );
}

function ConfidenceSummary({ summary }) {
  if (!summary) return null;
  return (
    <div className="flex items-center gap-1.5">
      {(summary.high || 0) > 0 && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />{summary.high}
        </span>
      )}
      {(summary.medium || 0) > 0 && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-amber-500/10 text-amber-700 dark:text-amber-200">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />{summary.medium}
        </span>
      )}
      {(summary.low || 0) > 0 && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-red-500/10 text-red-700 dark:text-red-300">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />{summary.low}
        </span>
      )}
    </div>
  );
}

export default function ImportCenterPage({ user, token, onOpenSession }) {
  const { toast } = useToast();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [statusCounts, setStatusCounts] = useState({});
  const [dragOver, setDragOver] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState(null);
  const fileInputRef = useRef();
  const pollRef = useRef();
  const authHeaders = { Authorization: `Bearer ${token || localStorage.getItem('auth_token')}` };

  const fetchSessions = useCallback(async () => {
    try {
      const params = { page, page_size: 15 };
      if (statusFilter) params.status = statusFilter;
      if (sourceFilter) params.source_type = sourceFilter;
      const res = await axios.get(`${API}/api/marketing/import/sessions`, { params, headers: authHeaders });
      setSessions(res.data.sessions || []);
      setPagination(res.data.pagination);
      setStatusCounts(res.data.status_counts || {});
    } catch (e) {
      console.error('fetchSessions', e);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, sourceFilter, token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchSessions();
    pollRef.current = setInterval(fetchSessions, 5000);
    return () => clearInterval(pollRef.current);
  }, [fetchSessions]);

  const handleUpload = async (files) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    let successCount = 0;
    for (const file of Array.from(files)) {
      try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await axios.post(`${API}/api/marketing/import/sessions`, fd, {
          headers: { ...authHeaders, 'Content-Type': 'multipart/form-data' }
        });
        if (res.data.duplicate) {
          toast({ title: 'Duplikat', description: `${file.name} sudah pernah diupload` });
        } else {
          successCount++;
        }
      } catch (e) {
        toast({ title: 'Upload gagal', description: `${file.name}: ${e.response?.data?.detail || e.message}`, variant: 'destructive' });
      }
    }
    if (successCount > 0) {
      toast({ title: `${successCount} file berhasil diupload`, description: 'AI sedang memproses...' });
      await fetchSessions();
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API}/api/marketing/import/sessions/${id}`, { headers: authHeaders });
      toast({ title: 'Session dihapus' });
      await fetchSessions();
    } catch (e) {
      toast({ title: 'Gagal hapus', variant: 'destructive' });
    }
    setDeleteDialog(null);
  };

  const kpiCards = [
    { label: 'Antrian / Proses', value: (statusCounts.queued || 0) + (statusCounts.parsing || 0), color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20' },
    { label: 'Siap Review',      value: statusCounts.ready_review || 0, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
    { label: 'Draft',            value: statusCounts.draft || 0, color: 'text-indigo-600', bg: 'bg-indigo-50 dark:bg-indigo-900/20' },
    { label: 'Committed',        value: statusCounts.committed || 0, color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20' },
  ];

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Smart Import Center</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Upload file marketplace → AI parsing otomatis → Review &amp; Commit ke database
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchSessions} data-testid="btn-refresh">
            <RefreshCw size={14} className="mr-1" /> Refresh
          </Button>
          <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading} data-testid="btn-upload">
            {uploading ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Upload size={14} className="mr-1" />}
            Upload File
          </Button>
          <input
            ref={fileInputRef} type="file" multiple
            accept=".csv,.xlsx,.xls,.pdf,.png,.jpg,.jpeg,.webp"
            className="hidden"
            onChange={e => handleUpload(e.target.files)}
          />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {kpiCards.map(c => (
          <div key={c.label} className={`rounded-xl border p-4 ${c.bg}`}>
            <p className="text-xs text-muted-foreground font-medium mb-1">{c.label}</p>
            <p className={`text-3xl font-bold tabular-nums ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Sessions List */}
        <div className="xl:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <CardTitle className="text-base">Import Sessions</CardTitle>
                <div className="flex items-center gap-2">
                  <Select value={statusFilter || 'all'} onValueChange={v => { setStatusFilter(v === 'all' ? '' : v); setPage(1); }}>
                    <SelectTrigger className="w-[140px] h-8 text-xs">
                      <SelectValue placeholder="Semua Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Semua Status</SelectItem>
                      {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={sourceFilter || 'all'} onValueChange={v => { setSourceFilter(v === 'all' ? '' : v); setPage(1); }}>
                    <SelectTrigger className="w-[160px] h-8 text-xs">
                      <SelectValue placeholder="Semua Tipe" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Semua Tipe</SelectItem>
                      {Object.entries(SOURCE_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center h-48">
                  <Loader2 className="animate-spin text-muted-foreground" size={24} />
                </div>
              ) : sessions.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                  <FileSpreadsheet size={32} className="mb-2 opacity-30" />
                  <p className="text-sm">Belum ada import session</p>
                  <p className="text-xs mt-1">Upload file di kanan untuk mulai</p>
                </div>
              ) : (
                <div className="divide-y">
                  {sessions.map(session => (
                    <div key={session.id}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors group"
                      data-testid={`session-row-${session.id}`}
                    >
                      <FileSpreadsheet size={18} className="text-muted-foreground flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium truncate max-w-[200px]" title={session.filename}>
                            {session.filename}
                          </span>
                          <StatusBadge status={session.status} />
                          {session.source_type && (
                            <span className="text-xs text-muted-foreground">
                              {SOURCE_LABELS[session.source_type] || session.source_type}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5">
                          <ConfidenceSummary summary={session.confidence_summary} />
                          {session.total_rows > 0 && (
                            <span className="text-xs text-muted-foreground">{session.total_rows} baris</span>
                          )}
                          {session.file_size_kb && (
                            <span className="text-xs text-muted-foreground">{session.file_size_kb}KB</span>
                          )}
                          <span className="text-xs text-muted-foreground truncate max-w-[100px]">{session.created_by}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {['ready_review', 'draft'].includes(session.status) && (
                          <Button
                            size="sm" variant="default" className="h-7 text-xs"
                            onClick={() => onOpenSession(session.id)}
                            data-testid={`btn-open-${session.id}`}
                          >
                            <Eye size={12} className="mr-1" /> Buka Editor
                          </Button>
                        )}
                        {session.status === 'committed' && (
                          <span className="flex items-center gap-1 text-xs text-green-600 border border-green-200 rounded px-2 py-1">
                            <CheckCircle2 size={10} />{(session.committed_ids?.length || 0)} rows
                          </span>
                        )}
                        <button
                          className="p-1 rounded hover:bg-muted transition-colors"
                          onClick={() => setDeleteDialog(session.id)}
                          data-testid={`btn-delete-${session.id}`}
                        >
                          <Trash2 size={13} className="text-muted-foreground" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {pagination && pagination.total_pages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <span className="text-xs text-muted-foreground">{pagination.total} total</span>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" className="h-7" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Sebelumnya</Button>
                    <span className="text-xs">{page} / {pagination.total_pages}</span>
                    <Button size="sm" variant="outline" className="h-7" disabled={page >= pagination.total_pages} onClick={() => setPage(p => p + 1)}>Berikutnya</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Upload Zone + Tips */}
        <div className="space-y-4">
          <Card
            className={`border-2 border-dashed transition-all cursor-pointer ${
              dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
            }`}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); handleUpload(e.dataTransfer.files); }}
            onClick={() => fileInputRef.current?.click()}
            data-testid="upload-dropzone"
          >
            <CardContent className="flex flex-col items-center justify-center py-10 px-6 text-center">
              {uploading ? (
                <Loader2 size={32} className="text-primary animate-spin mb-3" />
              ) : (
                <Upload size={32} className={`mb-3 transition-colors ${dragOver ? 'text-primary' : 'text-muted-foreground'}`} />
              )}
              <p className="text-sm font-medium">{uploading ? 'Mengupload...' : 'Drop file di sini'}</p>
              <p className="text-xs text-muted-foreground mt-1">atau klik untuk pilih file</p>
              <div className="flex flex-wrap gap-1 justify-center mt-3">
                {['.csv', '.xlsx', '.pdf', '.png/.jpg'].map(ext => (
                  <span key={ext} className="px-2 py-0.5 rounded text-xs bg-muted font-mono">{ext}</span>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Zap size={14} className="text-yellow-500" /> Format yang Didukung
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {[
                { icon: '🛒', label: 'Shopee Orders', desc: 'Export CSV dari Seller Center' },
                { icon: '🎵', label: 'TikTok Shop Orders', desc: 'Export CSV TikTok Shop' },
                { icon: '⚠️', label: 'File Komplain', desc: 'Excel/CSV dari tim CS' },
                { icon: '📊', label: 'Ads Report', desc: 'CSV dari Ads Manager' },
                { icon: '💚', label: 'Kesehatan Akun', desc: 'Screenshot dashboard (.png/.jpg)' },
              ].map(item => (
                <div key={item.label} className="flex items-start gap-2">
                  <span className="text-base leading-none mt-0.5">{item.icon}</span>
                  <div>
                    <p className="text-xs font-medium">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.desc}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="rounded-lg border bg-indigo-50/50 dark:bg-indigo-900/10 p-3">
            <div className="flex items-center gap-2 mb-1">
              <Info size={13} className="text-indigo-600 dark:text-indigo-400" />
              <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">Smart AI Detection</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              AI otomatis mendeteksi format file, memetakan kolom, dan memberi <strong>confidence score</strong> per baris.
              Jika AI timeout, file masuk antrian dan diproses otomatis.
            </p>
          </div>
        </div>
      </div>

      {/* Delete Dialog */}
      <AlertDialog open={!!deleteDialog} onOpenChange={() => setDeleteDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Session?</AlertDialogTitle>
            <AlertDialogDescription>
              Session akan dihapus permanen. Data yang sudah di-commit tidak terpengaruh.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={() => handleDelete(deleteDialog)} className="bg-destructive text-destructive-foreground">
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
