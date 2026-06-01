import { useState, useEffect, useCallback } from 'react';
import { Database, Download, Trash2, RefreshCw, AlertTriangle, CheckCircle2, Clock, HardDrive, Calendar } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass';
import { Button } from '@/components/ui/button';
import { PageHeader, StatTile } from './moduleAtoms';
import { useToast } from '@/hooks/use-toast';

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
                    variant="default"
                    onClick={() => setRestoreTarget(backup)}
                    disabled={processing === 'restore'}
                    data-testid={`backup-restore-${backup.backup_id}`}
                  >
                    <Download className="w-3.5 h-3.5 mr-1" />
                    Restore
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
    </div>
  );
}
