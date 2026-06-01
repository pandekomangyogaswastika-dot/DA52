import { useState, useEffect, useCallback } from 'react';
import { Store, Plus, RefreshCw, Pencil, Archive, Loader2, UserCheck } from 'lucide-react';
import { GlassCard, GlassPanel, GlassInput } from '@/components/ui/glass';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { PageHeader } from './moduleAtoms';
import { toast } from 'sonner';

const API = process.env.REACT_APP_BACKEND_URL;

const PLATFORMS = [
  { value: 'shopee', label: 'Shopee' },
  { value: 'tiktokshop', label: 'TikTokShop' },
  { value: 'tokopedia', label: 'Tokopedia' },
];

const GROUPS = [
  { value: 'official_store', label: 'Official Store' },
  { value: 'reseller', label: 'Reseller' },
  { value: 'distributor', label: 'Distributor' },
  { value: 'other', label: 'Other' },
];

const STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'suspended', label: 'Suspended' },
];

const platformColors = {
  shopee: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
  tiktokshop: 'bg-pink-500/10 text-pink-400 border-pink-500/30',
  tokopedia: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
};

const statusColors = {
  active: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  inactive: 'bg-gray-500/10 text-gray-400 border-gray-500/30',
  suspended: 'bg-red-500/10 text-red-400 border-red-500/30',
};

function AccountFormDialog({ open, onOpenChange, account, onSaved, token }) {
  const isEdit = !!account;
  const [submitting, setSubmitting] = useState(false);
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({
    account_code: '',
    account_name: '',
    platform: 'shopee',
    username: '',
    group: 'other',
    status: 'active',
    has_api_integration: false,
    pic_user_id: '',
  });

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // Fetch users for PIC dropdown
  useEffect(() => {
    if (open && isEdit) {
      fetch(`${API}/api/auth/users?limit=100`, { headers })
        .then(r => r.ok ? r.json() : [])
        .then(data => setUsers(Array.isArray(data) ? data : []))
        .catch(() => {});
    }
  }, [open, isEdit]); // eslint-disable-line

  useEffect(() => {
    if (open && account) {
      setForm({
        account_code: account.account_code || '',
        account_name: account.account_name || '',
        platform: account.platform || 'shopee',
        username: account.username || '',
        group: account.group || 'other',
        status: account.status || 'active',
        has_api_integration: !!account?.credentials?.has_api_integration,
        pic_user_id: account.pic_user_id || '',
      });
    } else if (open && !account) {
      setForm({
        account_code: '',
        account_name: '',
        platform: 'shopee',
        username: '',
        group: 'other',
        status: 'active',
        has_api_integration: false,
        pic_user_id: '',
      });
    }
  }, [open, account]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.account_name.trim()) {
      toast.error('Nama akun wajib diisi');
      return;
    }
    if (!isEdit && !form.account_code.trim()) {
      toast.error('Account code wajib diisi');
      return;
    }

    setSubmitting(true);
    try {
      let res;
      if (isEdit) {
        const payload = {
          account_name: form.account_name.trim(),
          username: form.username.trim() || null,
          group: form.group,
          status: form.status,
          has_api_integration: form.has_api_integration,
          pic_user_id: form.pic_user_id || null,
        };
        res = await fetch(`/api/marketing/accounts/${account.id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(payload),
        });
      } else {
        const payload = {
          account_code: form.account_code.trim().toUpperCase(),
          account_name: form.account_name.trim(),
          platform: form.platform,
          username: form.username.trim() || null,
          group: form.group,
          has_api_integration: form.has_api_integration,
        };
        res = await fetch('/api/marketing/accounts', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Gagal menyimpan akun');
      }

      toast.success(isEdit ? 'Akun berhasil diupdate' : 'Akun berhasil dibuat');
      onOpenChange(false);
      if (onSaved) onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="account-form-dialog">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Akun' : 'Tambah Akun Baru'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Update informasi akun platform.' : 'Daftarkan akun marketplace baru ke Marketing portal.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isEdit && (
            <div>
              <Label htmlFor="acc-code">Account Code <span className="text-red-400">*</span></Label>
              <GlassInput
                id="acc-code"
                value={form.account_code}
                onChange={e => setForm(f => ({ ...f, account_code: e.target.value.toUpperCase() }))}
                placeholder="SHOPEE-OFFICIAL"
                data-testid="acc-code-input"
                required
              />
              <p className="text-xs text-muted-foreground mt-1">Kode unik (uppercase, contoh: SHOPEE-OFFICIAL)</p>
            </div>
          )}

          <div>
            <Label htmlFor="acc-name">Nama Akun <span className="text-red-400">*</span></Label>
            <GlassInput
              id="acc-name"
              value={form.account_name}
              onChange={e => setForm(f => ({ ...f, account_name: e.target.value }))}
              placeholder="Shopee Official Store DEMO"
              data-testid="acc-name-input"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {!isEdit && (
              <div>
                <Label>Platform <span className="text-red-400">*</span></Label>
                <Select value={form.platform} onValueChange={v => setForm(f => ({ ...f, platform: v }))}>
                  <SelectTrigger data-testid="acc-platform-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PLATFORMS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Group</Label>
              <Select value={form.group} onValueChange={v => setForm(f => ({ ...f, group: v }))}>
                <SelectTrigger data-testid="acc-group-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GROUPS.map(g => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="acc-username">Username Platform</Label>
              <GlassInput
                id="acc-username"
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                placeholder="demobrand_official"
                data-testid="acc-username-input"
              />
            </div>
            {isEdit && (
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger data-testid="acc-status-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* PIC — hanya saat edit */}
          {isEdit && (
            <div>
              <Label className="flex items-center gap-1.5">
                <UserCheck size={13} className="text-primary" />
                PIC (Person in Charge)
              </Label>
              <Select
                value={form.pic_user_id || 'none'}
                onValueChange={v => setForm(f => ({ ...f, pic_user_id: v === 'none' ? '' : v }))}
              >
                <SelectTrigger data-testid="acc-pic-select"><SelectValue placeholder="Pilih PIC..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Tidak ada PIC —</SelectItem>
                  {users.map(u => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name || u.email}
                      <span className="text-muted-foreground text-xs ml-1">({u.role})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Task otomatis (input sales, health alert) akan di-assign ke PIC ini.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Batal
            </Button>
            <Button type="submit" disabled={submitting} data-testid="acc-submit-btn">
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {isEdit ? 'Simpan Perubahan' : 'Buat Akun'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function AccountManagementModule({ token }) {
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState([]);
  const [filter, setFilter] = useState({ platform: 'all', status: 'all' });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editAccount, setEditAccount] = useState(null);
  const [archiveTarget, setArchiveTarget] = useState(null);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter.platform !== 'all') params.append('platform', filter.platform);
      if (filter.status !== 'all') params.append('status', filter.status);
      const res = await fetch(`/api/marketing/accounts?${params.toString()}`, { headers });
      if (res.ok) {
        setAccounts(await res.json());
      }
    } catch (e) {
      toast.error('Gagal memuat akun');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const handleEdit = (acc) => {
    setEditAccount(acc);
    setDialogOpen(true);
  };

  const handleCreate = () => {
    setEditAccount(null);
    setDialogOpen(true);
  };

  const handleArchive = async () => {
    if (!archiveTarget) return;
    try {
      const res = await fetch(`/api/marketing/accounts/${archiveTarget.id}`, {
        method: 'DELETE',
        headers,
      });
      if (!res.ok) throw new Error('Gagal archive');
      toast.success('Akun di-archive');
      setArchiveTarget(null);
      fetchAccounts();
    } catch (e) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-5" data-testid="account-management-module">
      <PageHeader
        icon={Store}
        eyebrow="Portal Marketing · Multi-Akun"
        title="Manage Platform Accounts"
        subtitle="Kelola akun Shopee, TikTokShop, Tokopedia (multi-akun per platform)"
        actions={
          <div className="flex items-center gap-2">
            <Button onClick={fetchAccounts} variant="outline" size="sm" data-testid="refresh-accounts-btn">
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
            </Button>
            <Button onClick={handleCreate} size="sm" data-testid="create-account-btn">
              <Plus className="w-3.5 h-3.5 mr-1.5" /> Tambah Akun
            </Button>
          </div>
        }
      />

      {/* Filters */}
      <GlassPanel className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]">
            <Label className="text-xs">Filter Platform</Label>
            <Select value={filter.platform} onValueChange={v => setFilter(f => ({ ...f, platform: v }))}>
              <SelectTrigger data-testid="filter-platform"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Platform</SelectItem>
                {PLATFORMS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[180px]">
            <Label className="text-xs">Filter Status</Label>
            <Select value={filter.status} onValueChange={v => setFilter(f => ({ ...f, status: v }))}>
              <SelectTrigger data-testid="filter-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                {STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center text-sm text-muted-foreground">
            Total: <span className="text-foreground font-semibold ml-1">{accounts.length}</span> akun
          </div>
        </div>
      </GlassPanel>

      {/* Accounts list */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-44" />)}
        </div>
      ) : accounts.length === 0 ? (
        <GlassCard className="p-12 text-center">
          <Store className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-50" />
          <p className="text-muted-foreground mb-4">Belum ada akun. Tambahkan akun pertama Anda.</p>
          <Button size="sm" onClick={handleCreate} data-testid="create-first-account-btn">
            <Plus className="w-4 h-4 mr-2" /> Tambah Akun Pertama
          </Button>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts.map(acc => (
            <GlassCard key={acc.id} className="p-4" data-testid={`acc-row-${acc.account_code}`}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-foreground text-sm truncate">{acc.account_name}</div>
                  <div className="text-xs text-muted-foreground font-mono">{acc.account_code}</div>
                </div>
                <div className={`text-xs font-bold tabular-nums px-2 py-1 rounded-md ${acc.health_score >= 80 ? 'bg-emerald-500/10 text-emerald-400' : acc.health_score >= 60 ? 'bg-yellow-500/10 text-yellow-400' : 'bg-red-500/10 text-red-400'}`}>
                  {acc.health_score || 0}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 mb-3">
                <Badge variant="outline" className={platformColors[acc.platform]}>{acc.platform}</Badge>
                <Badge variant="outline" className={statusColors[acc.status]}>{acc.status}</Badge>
                {acc.group && acc.group !== 'other' && (
                  <Badge variant="outline" className="text-xs">{acc.group.replace('_', ' ')}</Badge>
                )}
              </div>

              {acc.username && (
                <div className="text-xs text-muted-foreground mb-1">
                  Username: <span className="text-foreground font-mono">{acc.username}</span>
                </div>
              )}

              {/* PIC info */}
              {acc.pic_user_name && (
                <div className="text-xs text-muted-foreground mb-3 flex items-center gap-1">
                  <UserCheck size={11} className="text-primary shrink-0" />
                  PIC: <span className="text-foreground font-medium">{acc.pic_user_name}</span>
                </div>
              )}
              {!acc.pic_user_name && (
                <div className="text-xs text-amber-500/80 mb-3 flex items-center gap-1 italic">
                  <UserCheck size={11} className="shrink-0" />
                  Belum ada PIC
                </div>
              )}

              <div className="flex items-center gap-2 pt-3 border-t border-[var(--glass-border)]">
                <Button size="sm" variant="outline" className="flex-1" onClick={() => handleEdit(acc)} data-testid={`edit-acc-${acc.account_code}`}>
                  <Pencil className="w-3 h-3 mr-1" /> Edit
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-400 hover:bg-red-500/10"
                  onClick={() => setArchiveTarget(acc)}
                  data-testid={`archive-acc-${acc.account_code}`}
                >
                  <Archive className="w-3 h-3" />
                </Button>
              </div>
            </GlassCard>
          ))}
        </div>
      )}

      <AccountFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        account={editAccount}
        onSaved={fetchAccounts}
        token={token}
      />

      <AlertDialog open={!!archiveTarget} onOpenChange={(o) => !o && setArchiveTarget(null)}>
        <AlertDialogContent data-testid="archive-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Archive Akun?</AlertDialogTitle>
            <AlertDialogDescription>
              Akun <b>{archiveTarget?.account_name}</b> akan dipindahkan ke status inactive.
              Data akun tidak dihapus permanen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={handleArchive} className="bg-red-500 hover:bg-red-600" data-testid="confirm-archive-btn">
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
