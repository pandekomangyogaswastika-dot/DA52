import { useState, useEffect, useCallback } from 'react';
import { Database, Download, Trash2, RefreshCw, AlertTriangle, CheckCircle2, Clock, HardDrive, Calendar, Upload, FileUp, CheckSquare, Square } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass';
import { Button } from '@/components/ui/button';
import { PageHeader, StatTile } from './moduleAtoms';
import { useToast } from '@/hooks/use-toast';
import { downloadBackup, uploadBackup, listCollections, restoreSelective } from './backupRestoreHelpers';

const fmt = (n) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;
const formatDate = (isoStr) => {
  if (!isoStr) return '-';
  const d = new Date(isoStr);
  return d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
};

export default function BackupRestoreModule({ token }) {
  const [backups, setBackups] = useState([]);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(null);
  const [restoreTarget, setRestoreTarget] = useState(null);
  const [selectiveRestore, setSelectiveRestore] = useState(null);
  const [collections, setCollections] = useState([]);
  const [selectedCollections, setSelectedCollections] = useState([]);
  const [restoreMode, setRestoreMode] = useState('overwrite');
  const [uploadFile, setUploadFile] = useState(null);
  const { toast } = useToast();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const fetchBackups = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/admin/backup/list', { headers });
      if (r.ok) {
        const data = await r.json();
        setBackups(data.backups || []);
      } else {
        toast({ title: 'Error', description: 'Gagal memuat daftar backup', variant: 'destructive' });
      }
    } catch (e) {
      toast({ title: 'Error', description: 'Gagal memuat data', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const fetchConfig = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/backup/config', { headers });
      if (r.ok) setConfig(await r.json());
    } catch (e) {
      // Silent fail
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    fetchBackups();
    fetchConfig();
  }, [fetchBackups, fetchConfig]);

  const createBackup = async () => {
    setProcessing('create');
    try {
      const r = await fetch('/api/admin/backup/create', {
        method: 'POST',
        headers,
        body: JSON.stringify({ notify: true })
      });
      if (r.ok) {
        const data = await r.json();
        toast({
          title: 'Backup Dimulai',
          description: `Backup '${data.backup_name}' sedang diproses di background. Anda akan menerima notifikasi saat selesai.`
        });
        setTimeout(fetchBackups, 3000); // Refresh after 3 seconds
      } else {
        const err = await r.json();
        toast({ title: 'Error', description: err.detail || 'Gagal membuat backup', variant: 'destructive' });
      }
    } catch (e) {
      toast({ title: 'Error', description: 'Gagal membuat backup', variant: 'destructive' });
    } finally {
      setProcessing(null);
    }
  };

  const restoreBackup = async () => {
    if (!restoreTarget) return;
    setProcessing('restore');
    try {
      const r = await fetch('/api/admin/backup/restore', {
        method: 'POST',
        headers,
        body: JSON.stringify({ backup_id: restoreTarget.backup_id, confirm: true })
      });
      if (r.ok) {
        toast({
          title: 'Restore Berhasil',
          description: `Database berhasil di-restore dari '${restoreTarget.backup_name}'. Halaman akan di-reload...`
        });
        setTimeout(() => window.location.reload(), 2000);
      } else {
        const err = await r.json();
        toast({ title: 'Error', description: err.detail || 'Restore gagal', variant: 'destructive' });
      }
    } catch (e) {
      toast({ title: 'Error', description: 'Restore gagal', variant: 'destructive' });
    } finally {
      setProcessing(null);
      setRestoreTarget(null);
    }
  };

  const deleteBackup = async (backup) => {
    if (!window.confirm(`Hapus backup '${backup.backup_name}'?`)) return;
    setProcessing(backup.backup_id);
    try {
      const r = await fetch(`/api/admin/backup/${backup.backup_id}`, {
        method: 'DELETE',
        headers
      });
      if (r.ok) {
        toast({ title: 'Sukses', description: `Backup '${backup.backup_name}' berhasil dihapus` });
        fetchBackups();
      } else {
        toast({ title: 'Error', description: 'Gagal menghapus backup', variant: 'destructive' });
      }
    } catch (e) {
      toast({ title: 'Error', description: 'Gagal menghapus backup', variant: 'destructive' });
    } finally {
      setProcessing(null);
    }
  };

  const cleanup = async () => {
    if (!window.confirm(`Hapus semua backup yang lebih lama dari ${config?.retention_days || 30} hari?`)) return;
    setProcessing('cleanup');
    try {
      const r = await fetch('/api/admin/backup/cleanup', {
        method: 'POST',
        headers
      });
      if (r.ok) {
        toast({ title: 'Sukses', description: 'Cleanup berhasil' });
        fetchBackups();
      } else {
        toast({ title: 'Error', description: 'Cleanup gagal', variant: 'destructive' });
      }
    } catch (e) {
      toast({ title: 'Error', description: 'Cleanup gagal', variant: 'destructive' });
    } finally {
      setProcessing(null);
    }
  };

  const handleDownload = async (backup) => {
    setProcessing(backup.backup_id);
    toast({ title: 'Downloading...', description: `Mengunduh ${backup.backup_name}.zip` });
    const result = await downloadBackup(backup.backup_id, token);
    setProcessing(null);
    if (result.ok) {
      toast({ title: 'Sukses', description: 'Backup berhasil diunduh' });
    } else {
      toast({ title: 'Error', description: result.error || 'Download gagal', variant: 'destructive' });
    }
  };

  const handleUpload = async () => {
    if (!uploadFile) {
      toast({ title: 'Error', description: 'Pilih file ZIP terlebih dahulu', variant: 'destructive' });
      return;
    }
    setProcessing('upload');
    toast({ title: 'Uploading...', description: `Mengupload ${uploadFile.name}` });
    const result = await uploadBackup(uploadFile, token);
    setProcessing(null);
    setUploadFile(null);
    if (result.ok) {
      toast({ title: 'Sukses', description: `Backup ${result.backup_name} berhasil diupload` });
      fetchBackups();
    } else {
      toast({ title: 'Error', description: result.error || 'Upload gagal', variant: 'destructive' });
    }
  };

  const openSelectiveRestore = async (backup) => {
    setProcessing(backup.backup_id);
    const result = await listCollections(backup.backup_id, token);
    setProcessing(null);
    if (result.error) {
      toast({ title: 'Error', description: result.error, variant: 'destructive' });
      return;
    }
    setCollections(result.collections || []);
    setSelectedCollections([]);
    setRestoreMode('overwrite');
    setSelectiveRestore(backup);
  };

  const toggleCollection = (collectionName) => {
    setSelectedCollections(prev =>
      prev.includes(collectionName)
        ? prev.filter(c => c !== collectionName)
        : [...prev, collectionName]
    );
  };

  const selectAllCollections = () => {
    setSelectedCollections(collections.map(c => c.name));
  };

  const clearSelections = () => {
    setSelectedCollections([]);
  };

  const confirmSelectiveRestore = async () => {
    if (selectedCollections.length === 0) {
      toast({ title: 'Error', description: 'Pilih minimal 1 collection', variant: 'destructive' });
      return;
    }
    setProcessing('selective-restore');
    const result = await restoreSelective(selectiveRestore.backup_id, selectedCollections, restoreMode, token);
    setProcessing(null);
    if (result.ok) {
      toast({
        title: 'Restore Selesai',
        description: `${result.total_restored}/${result.total_requested} collections berhasil di-restore`
      });
      setSelectiveRestore(null);
    } else {
      toast({ title: 'Error', description: result.error || 'Restore gagal', variant: 'destructive' });
    }
  };

  const latestBackup = backups[0];
  const totalSize = backups.reduce((sum, b) => {
    const sizeStr = b.size || '0';
    const sizeNum = parseFloat(sizeStr.replace(/[^0-9.]/g, ''));
    return sum + (sizeStr.includes('G') ? sizeNum * 1024 : sizeNum);
  }, 0);

  return (
    <div className="space-y-5" data-testid="backup-restore-page">
      <PageHeader
        icon={Database}
        eyebrow="Portal Management · System"
        title="Database Backup & Restore"
        subtitle="Kelola backup database untuk disaster recovery. Backup otomatis berjalan setiap hari jam 02:00 WIB."
        actions={
          <>
            <input
              type="file"
              accept=".zip"
              onChange={e => setUploadFile(e.target.files[0])}
              style={{ display: 'none' }}
              id="backup-upload-input"
            />
            {uploadFile && (
              <Button
                variant="outline"
                onClick={handleUpload}
                className="h-9 border-emerald-500/50 text-emerald-300"
                disabled={processing === 'upload'}
                data-testid="backup-upload-confirm"
              >
                <Upload className="w-3.5 h-3.5 mr-1.5" />
                {processing === 'upload' ? 'Uploading...' : `Upload ${uploadFile.name.slice(0, 15)}...`}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => document.getElementById('backup-upload-input').click()}
              className="h-9 border border-[var(--glass-border)]"
              data-testid="backup-upload"
              disabled={processing === 'upload'}
            >
              <FileUp className="w-3.5 h-3.5 mr-1.5" />
              Upload ZIP
            </Button>
            <Button
              variant="ghost"
              onClick={fetchBackups}
              className="h-9 border border-[var(--glass-border)]"
              data-testid="backup-refresh"
              disabled={loading}
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
              Muat Ulang
            </Button>
            <Button
              onClick={createBackup}
              className="h-9"
              data-testid="backup-create"
              disabled={processing === 'create'}
            >
              <Database className="w-3.5 h-3.5 mr-1.5" />
              {processing === 'create' ? 'Membuat...' : 'Buat Backup'}
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <StatTile label="Total Backups" value={backups.length} />
        <StatTile label="Latest Backup" value={latestBackup ? formatDate(latestBackup.created_at).split(',')[0] : '-'} accent="primary" />
        <StatTile label="Total Size" value={`${totalSize.toFixed(1)} MB`} />
        <StatTile label="Retention" value={`${config?.retention_days || 30} Hari`} accent="warning" />
      </div>

      {config && (
        <GlassCard className="p-4 bg-blue-500/5 border-blue-500/30">
          <div className="flex items-start gap-3">
            <Clock className="w-5 h-5 text-blue-300 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-sm font-semibold text-foreground mb-1">Automated Backup Schedule</div>
              <div className="text-sm text-muted-foreground">
                <div>• Schedule: <span className="text-blue-300 font-medium">{config.auto_backup_schedule}</span></div>
                <div>• Retention: <span className="text-blue-300 font-medium">{config.retention_days} hari</span> (backup otomatis dihapus setelah periode ini)</div>
                <div>• Storage: <span className="text-blue-300 font-medium">{config.storage_type === 'local_filesystem' ? 'Local Filesystem' : config.storage_type}</span></div>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={cleanup}
              disabled={processing === 'cleanup'}
              data-testid="backup-cleanup"
            >
              {processing === 'cleanup' ? 'Processing...' : 'Cleanup Old Backups'}
            </Button>
          </div>
        </GlassCard>
      )}

      <GlassCard className="p-4">
        <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
          <HardDrive className="w-5 h-5" />
          Backup History ({backups.length})
        </h3>
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">Memuat...</div>
        ) : backups.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            Belum ada backup. Tekan "Buat Backup" untuk membuat backup pertama.
          </div>
        ) : (
          <div className="space-y-3">
            {backups.map(backup => (
              <div
                key={backup.backup_id}
                className="flex items-center gap-4 p-4 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-surface)] hover:bg-[var(--glass-border)]/30 transition"
                data-testid={`backup-item-${backup.backup_id}`}
              >
                <Database className="w-8 h-8 text-primary flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-sm font-semibold text-foreground truncate">
                      {backup.backup_name}
                    </span>
                    {backup.status === 'success' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-300 flex-shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-yellow-300 flex-shrink-0" />
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {formatDate(backup.created_at)}
                    </span>
                    <span className="flex items-center gap-1">
                      <HardDrive className="w-3 h-3" />
                      {backup.size}
                    </span>
                    {backup.database && (
                      <span className="px-2 py-0.5 rounded bg-primary/10 text-primary">
                        {backup.database}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDownload(backup)}
                    disabled={processing === backup.backup_id}
                    className="text-blue-300 hover:text-blue-200 hover:bg-blue-500/10"
                    data-testid={`backup-download-${backup.backup_id}`}
                    title="Download as ZIP"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openSelectiveRestore(backup)}
                    disabled={processing === backup.backup_id}
                    data-testid={`backup-selective-${backup.backup_id}`}
                    title="Selective Restore"
                  >
                    <CheckSquare className="w-3.5 h-3.5 mr-1" />
                    Pilih
                  </Button>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => setRestoreTarget(backup)}
                    disabled={processing === 'restore'}
                    data-testid={`backup-restore-${backup.backup_id}`}
                    title="Full Restore"
                  >
                    <Download className="w-3.5 h-3.5 mr-1" />
                    Restore All
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deleteBackup(backup)}
                    disabled={processing === backup.backup_id}
                    className="text-red-300 hover:text-red-200 hover:bg-red-500/10"
                    data-testid={`backup-delete-${backup.backup_id}`}
                  >
                    {processing === backup.backup_id ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      {restoreTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setRestoreTarget(null)}>
          <GlassCard className="p-6 max-w-lg w-full" onClick={e => e.stopPropagation()} data-testid="restore-dialog">
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle className="w-6 h-6 text-red-400 flex-shrink-0" />
              <div>
                <h2 className="text-xl font-bold text-foreground">⚠️ Konfirmasi Restore Database</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Tindakan ini akan <span className="text-red-300 font-semibold">MENGGANTI seluruh database saat ini</span> dengan backup yang dipilih.
                  Semua perubahan setelah backup akan hilang!
                </p>
              </div>
            </div>
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-4">
              <div className="text-sm space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Backup:</span>
                  <span className="font-mono font-semibold">{restoreTarget.backup_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Dibuat:</span>
                  <span className="font-semibold">{formatDate(restoreTarget.created_at)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Size:</span>
                  <span className="font-semibold">{restoreTarget.size}</span>
                </div>
              </div>
            </div>
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 mb-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-yellow-300 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-yellow-200">
                  <strong>PERINGATAN:</strong> Proses restore akan:
                  <ul className="list-disc list-inside mt-1 space-y-0.5">
                    <li>Menghapus database saat ini</li>
                    <li>Restore data dari backup</li>
                    <li>Restart semua services</li>
                    <li>Durasi: 30 detik - 5 menit (tergantung ukuran database)</li>
                  </ul>
                </div>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="ghost"
                onClick={() => setRestoreTarget(null)}
                className="border border-[var(--glass-border)]"
                data-testid="restore-cancel"
                disabled={processing === 'restore'}
              >
                Batal
              </Button>
              <Button
                variant="destructive"
                onClick={restoreBackup}
                disabled={processing === 'restore'}
                data-testid="restore-confirm"
              >
                {processing === 'restore' ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Restoring...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-2" />
                    Konfirmasi Restore
                  </>
                )}
              </Button>
            </div>
          </GlassCard>
        </div>
      )}

      {selectiveRestore && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setSelectiveRestore(null)}>
          <GlassCard className="p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()} data-testid="selective-restore-dialog">
            <h2 className="text-xl font-bold text-foreground mb-4">Selective Restore: {selectiveRestore.backup_name}</h2>
            
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-4">
              <div className="text-sm">
                <div className="font-semibold mb-2">Pilih collection yang ingin di-restore:</div>
                <div className="flex gap-3 mb-2">
                  <Button size="sm" variant="outline" onClick={selectAllCollections} data-testid="select-all-collections">
                    Pilih Semua ({collections.length})
                  </Button>
                  <Button size="sm" variant="ghost" onClick={clearSelections}>
                    Clear ({selectedCollections.length} selected)
                  </Button>
                </div>
                <div className="text-xs text-muted-foreground">
                  Selected: {selectedCollections.length} / {collections.length} collections
                </div>
              </div>
            </div>

            <div className="mb-4">
              <label className="text-sm font-semibold text-foreground mb-2 block">Restore Mode:</label>
              <div className="flex gap-3">
                <button
                  onClick={() => setRestoreMode('overwrite')}
                  className={`flex-1 p-3 rounded-lg border text-left transition ${
                    restoreMode === 'overwrite'
                      ? 'border-primary bg-primary/10'
                      : 'border-[var(--glass-border)] hover:border-primary/50'
                  }`}
                  data-testid="mode-overwrite"
                >
                  <div className="font-semibold text-sm">Overwrite (Drop & Restore)</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Hapus collection yang ada, lalu restore dari backup (default)
                  </div>
                </button>
                <button
                  onClick={() => setRestoreMode('merge')}
                  className={`flex-1 p-3 rounded-lg border text-left transition ${
                    restoreMode === 'merge'
                      ? 'border-emerald-500 bg-emerald-500/10'
                      : 'border-[var(--glass-border)] hover:border-emerald-500/50'
                  }`}
                  data-testid="mode-merge"
                >
                  <div className="font-semibold text-sm">Merge (Insert Only)</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Tambahkan data dari backup tanpa menghapus data existing
                  </div>
                </button>
              </div>
            </div>

            <div className="border border-[var(--glass-border)] rounded-lg p-4 max-h-96 overflow-y-auto">
              <div className="space-y-2">
                {collections.map(collection => (
                  <div
                    key={collection.name}
                    onClick={() => toggleCollection(collection.name)}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition ${
                      selectedCollections.includes(collection.name)
                        ? 'border-primary bg-primary/10'
                        : 'border-[var(--glass-border)] hover:border-primary/30'
                    }`}
                    data-testid={`collection-${collection.name}`}
                  >
                    {selectedCollections.includes(collection.name) ? (
                      <CheckSquare className="w-5 h-5 text-primary flex-shrink-0" />
                    ) : (
                      <Square className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-sm font-semibold truncate">{collection.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {collection.document_count} docs · {collection.size_mb} MB
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2 justify-end mt-6">
              <Button
                variant="ghost"
                onClick={() => setSelectiveRestore(null)}
                className="border border-[var(--glass-border)]"
                data-testid="selective-cancel"
                disabled={processing === 'selective-restore'}
              >
                Batal
              </Button>
              <Button
                onClick={confirmSelectiveRestore}
                disabled={processing === 'selective-restore' || selectedCollections.length === 0}
                data-testid="selective-confirm"
              >
                {processing === 'selective-restore' ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Restoring...
                  </>
                ) : (
                  <>
                    <CheckSquare className="w-4 h-4 mr-2" />
                    Restore {selectedCollections.length} Collections ({restoreMode})
                  </>
                )}
              </Button>
            </div>
          </GlassCard>
        </div>
      )}
    </div>
  );
}
