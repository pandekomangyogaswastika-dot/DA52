/**
 * PT Rahaza ERP — Role × Permission Matrix (Phase 15)
 *
 * Admin-only UI to configure which permission each role has via a dense
 * matrix (roles as columns, permissions as rows grouped by module).
 *
 * Features:
 *  - Toggle a single cell → pending change; visual "dirty" indicator.
 *  - Bulk save all pending changes via POST /api/roles/matrix/bulk.
 *  - Per-module "select-all" row for each role column.
 *  - Search by permission key / module / description.
 *  - View audit trail per role via drawer (GET /api/roles/audit?role_id=...).
 *  - Cannot modify anything unless superadmin/admin.
 *
 * Dependencies:
 *  - Backend endpoints:
 *      GET  /api/roles
 *      GET  /api/permissions
 *      POST /api/roles/matrix/bulk   { changes: [{role_id, permissions}, ...] }
 *      GET  /api/roles/audit?role_id={id}&limit=100
 *  - /lib/rbac.jsx for RequirePerm guard.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Shield, Search, Save, RotateCcw, History, Check, X, AlertCircle,
  ChevronDown, ChevronRight, Lock, CheckSquare, Square,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { RequirePerm, PermissionDenied } from '@/lib/rbac';

export default function RoleMatrixModule({ token, user, userRole, hasPerm }) {
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  // roleId → Set<permissionKey>  (current committed state)
  const [committed, setCommitted] = useState({});
  // roleId → Set<permissionKey>  (pending state with unsaved toggles)
  const [pending, setPending] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [collapsedModules, setCollapsedModules] = useState(() => new Set());

  // Audit drawer state
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditRole, setAuditRole] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const canManage = userRole === 'superadmin' || userRole === 'admin' || userRole === 'owner';

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [rolesRes, permsRes] = await Promise.all([
        fetch('/api/roles', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/permissions', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const rolesJson = await rolesRes.json();
      const permsJson = await permsRes.json();
      setRoles(Array.isArray(rolesJson) ? rolesJson : []);
      setPermissions(Array.isArray(permsJson) ? permsJson : []);

      // Build initial committed/pending maps
      const map = {};
      (Array.isArray(rolesJson) ? rolesJson : []).forEach((r) => {
        const keys = new Set((r.permissions || []).map((p) => p.permission_key));
        map[r.id] = keys;
      });
      setCommitted(map);
      setPending(() => {
        const copy = {};
        Object.entries(map).forEach(([k, v]) => { copy[k] = new Set(v); });
        return copy;
      });
    } catch (e) {
      console.error(e);
      toast.error('Gagal memuat role & permissions');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Permissions grouped by module, with search filter
  const groupedPermissions = useMemo(() => {
    const q = search.trim().toLowerCase();
    const groups = {};
    permissions.forEach((p) => {
      const text = `${p.key} ${p.module} ${p.description || ''}`.toLowerCase();
      if (q && !text.includes(q)) return;
      const mod = p.module || 'Lain';
      if (!groups[mod]) groups[mod] = [];
      groups[mod].push(p);
    });
    // Sort modules alphabetically, keep permissions in input order
    return Object.keys(groups).sort().map((mod) => ({ module: mod, items: groups[mod] }));
  }, [permissions, search]);

  // Compute dirty state (pending != committed) for each role
  const dirtyByRole = useMemo(() => {
    const map = {};
    Object.keys(pending).forEach((rid) => {
      const p = pending[rid] || new Set();
      const c = committed[rid] || new Set();
      if (p.size !== c.size) { map[rid] = true; return; }
      for (const k of p) { if (!c.has(k)) { map[rid] = true; return; } }
    });
    return map;
  }, [pending, committed]);

  const totalDirty = Object.values(dirtyByRole).filter(Boolean).length;

  // Toggle a single permission cell
  const toggleCell = (roleId, permKey) => {
    if (!canManage) return;
    setPending((prev) => {
      const next = { ...prev };
      const cur = new Set(next[roleId] || new Set());
      if (cur.has(permKey)) cur.delete(permKey);
      else cur.add(permKey);
      next[roleId] = cur;
      return next;
    });
  };

  // Toggle all permissions of a module-group for a role
  const toggleModuleForRole = (roleId, modulePerms) => {
    if (!canManage) return;
    setPending((prev) => {
      const next = { ...prev };
      const cur = new Set(next[roleId] || new Set());
      const allOn = modulePerms.every((p) => cur.has(p.key));
      modulePerms.forEach((p) => {
        if (allOn) cur.delete(p.key);
        else cur.add(p.key);
      });
      next[roleId] = cur;
      return next;
    });
  };

  const handleReset = () => {
    if (!totalDirty) return;
    if (!window.confirm(`Batalkan ${totalDirty} perubahan?`)) return;
    const copy = {};
    Object.entries(committed).forEach(([k, v]) => { copy[k] = new Set(v); });
    setPending(copy);
    toast.info('Perubahan dibatalkan');
  };

  const handleSave = async () => {
    if (!totalDirty || saving) return;
    const changes = Object.keys(dirtyByRole)
      .filter((rid) => dirtyByRole[rid])
      .map((rid) => ({
        role_id: rid,
        permissions: Array.from(pending[rid] || new Set()),
      }));
    setSaving(true);
    try {
      const res = await fetch('/api/roles/matrix/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ changes }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      toast.success(`Tersimpan: ${data.updated} role diperbarui`);
      await fetchAll();
    } catch (e) {
      toast.error(`Gagal menyimpan: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const openAudit = async (role) => {
    setAuditRole(role);
    setAuditOpen(true);
    setAuditLoading(true);
    try {
      const res = await fetch(`/api/roles/audit?role_id=${role.id}&limit=100`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setAuditLogs(data.items || []);
    } catch (e) {
      console.error(e);
      toast.error('Gagal memuat audit trail');
      setAuditLogs([]);
    } finally {
      setAuditLoading(false);
    }
  };

  const toggleModuleCollapse = (mod) => {
    setCollapsedModules((prev) => {
      const next = new Set(prev);
      if (next.has(mod)) next.delete(mod);
      else next.add(mod);
      return next;
    });
  };

  // Guard: block non-admin outright
  if (!canManage && typeof hasPerm === 'function' && !hasPerm('roles.manage')) {
    return (
      <PermissionDenied missing={['roles.manage']} />
    );
  }

  return (
    <div className="space-y-4" data-testid="role-matrix-page">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Shield className="w-6 h-6 text-[hsl(var(--primary))]" />
            Matriks Role & Permission
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Atur izin akses per-role dengan centang cepat. Perubahan dicatat di audit trail.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-foreground/40 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Cari permission / modul..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-sm border border-[var(--glass-border)] rounded-md bg-[var(--input-surface)] min-w-[220px]"
              data-testid="matrix-search-input"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleReset}
            disabled={!totalDirty || saving}
            data-testid="matrix-reset-btn"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1" /> Batalkan
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleSave}
            disabled={!totalDirty || saving || !canManage}
            data-testid="matrix-save-btn"
            className="bg-[hsl(var(--primary))] text-white"
          >
            <Save className="w-3.5 h-3.5 mr-1" />
            {saving ? 'Menyimpan...' : totalDirty > 0 ? `Simpan (${totalDirty})` : 'Simpan'}
          </Button>
        </div>
      </div>

      {/* Status / dirty summary */}
      {totalDirty > 0 && (
        <div
          className="flex items-center gap-2 text-xs px-3 py-2 rounded-md bg-[hsl(var(--warning)/0.12)] text-[hsl(var(--warning))] border border-[hsl(var(--warning)/0.3)]"
          data-testid="matrix-dirty-banner"
        >
          <AlertCircle className="w-3.5 h-3.5" />
          <span>
            {totalDirty} role memiliki perubahan belum disimpan. Klik <b>Simpan</b> untuk menerapkan.
          </span>
        </div>
      )}

      {/* Matrix */}
      <div className="rounded-md border border-[var(--glass-border)] bg-[var(--card-surface)] overflow-auto">
        {loading ? (
          <div className="p-10 text-center text-sm text-muted-foreground">Memuat...</div>
        ) : (
          <table className="w-full text-sm" data-testid="matrix-table">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="text-left px-3 py-2 min-w-[260px] bg-[var(--nav-pill-bg)] border-b border-[var(--glass-border)] font-semibold">
                  Permission
                </th>
                {roles.map((r) => (
                  <th
                    key={r.id}
                    className="text-left px-3 py-2 min-w-[120px] bg-[var(--nav-pill-bg)] border-b border-[var(--glass-border)] border-l"
                    data-testid={`matrix-role-header-${r.name}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-semibold uppercase text-[11px] tracking-wide truncate" title={r.name}>{r.name}</span>
                        {r.is_system && (
                          <Lock className="w-3 h-3 text-foreground/40" title="Sistem role" />
                        )}
                        {dirtyByRole[r.id] && (
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[hsl(var(--warning))]" title="Perubahan belum tersimpan" />
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => openAudit(r)}
                        className="text-foreground/50 hover:text-foreground"
                        title="Lihat audit trail"
                        data-testid={`matrix-audit-btn-${r.name}`}
                      >
                        <History className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="mt-0.5 text-[10px] font-normal text-muted-foreground">
                      {(pending[r.id] || new Set()).size} izin
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groupedPermissions.length === 0 ? (
                <tr>
                  <td colSpan={roles.length + 1} className="p-8 text-center text-muted-foreground">
                    Tidak ada permission yang cocok.
                  </td>
                </tr>
              ) : (
                groupedPermissions.map(({ module, items }) => {
                  const isCollapsed = collapsedModules.has(module);
                  return (
                    <GroupRows
                      key={module}
                      module={module}
                      items={items}
                      roles={roles}
                      pending={pending}
                      collapsed={isCollapsed}
                      canManage={canManage}
                      onToggleCollapse={() => toggleModuleCollapse(module)}
                      onToggleCell={toggleCell}
                      onToggleModuleForRole={toggleModuleForRole}
                    />
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Audit drawer */}
      {auditOpen && (
        <AuditDrawer
          role={auditRole}
          logs={auditLogs}
          loading={auditLoading}
          onClose={() => setAuditOpen(false)}
        />
      )}
    </div>
  );
}

/* ── Matrix body: module header row + permission rows ───────────────── */
function GroupRows({
  module, items, roles, pending, collapsed, canManage,
  onToggleCollapse, onToggleCell, onToggleModuleForRole,
}) {
  const moduleKeys = items.map((p) => p.key);
  return (
    <>
      <tr className="bg-[var(--nav-pill-bg)]/50 border-t border-[var(--glass-border)]">
        <td className="px-3 py-1.5 font-semibold text-[11px] uppercase tracking-wider text-foreground/70">
          <button
            type="button"
            onClick={onToggleCollapse}
            className="inline-flex items-center gap-1.5 hover:text-foreground"
            data-testid={`matrix-group-toggle-${module}`}
          >
            {collapsed
              ? <ChevronRight className="w-3.5 h-3.5" />
              : <ChevronDown className="w-3.5 h-3.5" />}
            {module}
            <span className="text-foreground/40 font-normal normal-case tracking-normal ml-1">
              ({items.length})
            </span>
          </button>
        </td>
        {roles.map((r) => {
          const cur = pending[r.id] || new Set();
          const allOn = moduleKeys.every((k) => cur.has(k));
          const someOn = !allOn && moduleKeys.some((k) => cur.has(k));
          const Icon = allOn ? CheckSquare : someOn ? CheckSquare : Square;
          return (
            <td key={r.id} className="px-3 py-1.5 border-l border-[var(--glass-border)]">
              <button
                type="button"
                onClick={() => onToggleModuleForRole(r.id, items)}
                disabled={!canManage}
                className={`inline-flex items-center gap-1 text-[11px] font-medium disabled:opacity-50 ${
                  allOn ? 'text-[hsl(var(--primary))]' : someOn ? 'text-[hsl(var(--primary))]/70' : 'text-foreground/40 hover:text-foreground'
                }`}
                title={allOn ? 'Matikan semua di modul ini' : 'Pilih semua di modul ini'}
                data-testid={`matrix-group-all-${module}-${r.name}`}
              >
                <Icon className="w-3.5 h-3.5" strokeWidth={2} />
                {allOn ? 'All' : someOn ? 'Some' : '—'}
              </button>
            </td>
          );
        })}
      </tr>
      {!collapsed && items.map((p) => (
        <tr key={p.key} className="border-t border-[var(--glass-border)]">
          <td className="px-3 py-1.5">
            <div className="flex flex-col">
              <code className="text-[11px] font-mono text-foreground/80">{p.key}</code>
              {p.description && (
                <span className="text-[10px] text-muted-foreground truncate" title={p.description}>
                  {p.description}
                </span>
              )}
            </div>
          </td>
          {roles.map((r) => {
            const cur = pending[r.id] || new Set();
            const on = cur.has(p.key);
            return (
              <td key={r.id} className="px-3 py-1.5 border-l border-[var(--glass-border)]">
                <button
                  type="button"
                  onClick={() => onToggleCell(r.id, p.key)}
                  disabled={!canManage}
                  aria-pressed={on}
                  className={`w-5 h-5 inline-flex items-center justify-center rounded-sm border transition-colors duration-150 disabled:opacity-50 ${
                    on
                      ? 'bg-[hsl(var(--primary))] border-[hsl(var(--primary))] text-white'
                      : 'bg-transparent border-[var(--glass-border)] text-foreground/30 hover:border-[hsl(var(--primary))]/50'
                  }`}
                  title={`${r.name} · ${p.key}`}
                  data-testid={`matrix-cell-${r.name}-${p.key}`}
                >
                  {on && <Check className="w-3 h-3" strokeWidth={3} />}
                </button>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

/* ── Audit drawer (slide-in panel right) ───────────────────────────── */
function AuditDrawer({ role, logs, loading, onClose }) {
  const closeRef = useRef(null);
  useEffect(() => {
    closeRef.current?.focus();
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[200] flex"
      role="dialog"
      aria-modal="true"
      aria-labelledby="audit-drawer-title"
      data-testid="matrix-audit-drawer"
    >
      <div className="flex-1 bg-[var(--overlay-bg)]" onClick={onClose} />
      <div className="w-[520px] max-w-full h-full bg-[var(--card-surface)] border-l border-[var(--glass-border)] shadow-[var(--shadow-soft)] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--glass-border)]">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-[hsl(var(--primary))]" />
            <div>
              <h3 id="audit-drawer-title" className="text-sm font-semibold text-foreground">Audit Trail</h3>
              <p className="text-[11px] text-muted-foreground">Role: <code className="font-mono">{role?.name}</code></p>
            </div>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-[var(--glass-bg-hover)]"
            data-testid="matrix-audit-close"
            aria-label="Tutup"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {loading ? (
            <div className="text-center text-xs text-muted-foreground py-6">Memuat...</div>
          ) : logs.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground py-6">Belum ada perubahan tercatat untuk role ini.</div>
          ) : (
            logs.map((l) => <AuditLogRow key={l.id} log={l} />)
          )}
        </div>
      </div>
    </div>
  );
}

function AuditLogRow({ log }) {
  const action = log.action || 'update';
  const timestamp = log.timestamp ? new Date(log.timestamp).toLocaleString('id-ID') : '—';
  const actor = log.user_name || 'System';
  const permsDiff = log.diff?.permissions;
  const beforeList = Array.isArray(permsDiff?.before) ? permsDiff.before : null;
  const afterList  = Array.isArray(permsDiff?.after)  ? permsDiff.after  : null;

  let added = [], removed = [];
  if (beforeList && afterList) {
    const bSet = new Set(beforeList);
    const aSet = new Set(afterList);
    added   = afterList.filter((k) => !bSet.has(k));
    removed = beforeList.filter((k) => !aSet.has(k));
  }

  return (
    <div className="rounded-md border border-[var(--glass-border)] bg-[var(--card-surface)] px-3 py-2 text-xs" data-testid="matrix-audit-row">
      <div className="flex items-center justify-between gap-2">
        <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold tracking-wide ${
          action === 'create' ? 'bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]' :
          action === 'delete' ? 'bg-[hsl(var(--destructive)/0.15)] text-[hsl(var(--destructive))]' :
          'bg-[hsl(var(--primary)/0.15)] text-[hsl(var(--primary))]'
        }`}>
          {action.replace('_', ' ')}
        </span>
        <span className="text-muted-foreground">{timestamp}</span>
      </div>
      <div className="mt-1 text-foreground/80">
        oleh <b>{actor}</b>{log.user_role ? <span className="text-muted-foreground"> ({log.user_role})</span> : null}
      </div>
      {(added.length > 0 || removed.length > 0) && (
        <div className="mt-2 space-y-1">
          {added.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span className="text-[10px] text-[hsl(var(--success))] font-semibold">+ ADD:</span>
              {added.map((k) => (
                <code key={k} className="text-[10px] font-mono px-1 py-0.5 rounded bg-[hsl(var(--success)/0.1)] text-[hsl(var(--success))]">{k}</code>
              ))}
            </div>
          )}
          {removed.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span className="text-[10px] text-[hsl(var(--destructive))] font-semibold">− REMOVE:</span>
              {removed.map((k) => (
                <code key={k} className="text-[10px] font-mono px-1 py-0.5 rounded bg-[hsl(var(--destructive)/0.1)] text-[hsl(var(--destructive))]">{k}</code>
              ))}
            </div>
          )}
        </div>
      )}
      {log.diff?.name && (
        <div className="mt-1 text-[11px] text-foreground/70">
          name: <s className="text-muted-foreground">{log.diff.name.before}</s> → <b>{log.diff.name.after}</b>
        </div>
      )}
    </div>
  );
}
