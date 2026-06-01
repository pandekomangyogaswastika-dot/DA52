/**
 * NotificationBell — Phase 12.2 Alert Engine frontend.
 *
 * Fitur:
 *   - Badge unread count (refresh setiap 60 detik + realtime via SSE)
 *   - Popover daftar notifikasi (unread dulu)
 *   - Klik notifikasi → mark read + navigate ke link module bila ada
 *   - Tombol "Tandai semua dibaca"
 *   - Subscribe SSE /api/notifications/stream?token=... saat mount
 *   - Toast pop-up via sonner saat event baru masuk
 *   - Respect reduced-motion & theme tokens
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Bell, CheckCheck, AlertTriangle, AlertCircle, Info,
  CheckCircle2, Package, Factory, Clock, X
} from 'lucide-react';
import { toast } from 'sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || '';

// Icon map per severity
const SEV_ICON = {
  info:    Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error:   AlertCircle,
};

// Warna per severity (theme-aware)
const SEV_COLOR = {
  info:    'text-[hsl(var(--info,195_82%_55%))]',
  success: 'text-[hsl(var(--success))]',
  warning: 'text-[hsl(var(--warning))]',
  error:   'text-[hsl(var(--destructive))]',
};

// Icon per type — dapat diperluas seiring trigger baru
const TYPE_ICON = {
  low_stock:     Package,
  qc_fail_spike: AlertTriangle,
  wo_due_soon:   Clock,
  system_test:   Info,
  behind_target: Factory,
};

function formatTimeAgo(iso) {
  if (!iso) return '';
  const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return 'baru saja';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} menit lalu`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} jam lalu`;
  return `${Math.floor(diffSec / 86400)} hari lalu`;
}

export function NotificationBell({ token, onNavigateModule }) {
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const popoverRef = useRef(null);
  const eventSourceRef = useRef(null);

  // Fetch list & unread count
  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      // Phase 3.3C: Use unified SSOT endpoint
      const [listRes, statsRes] = await Promise.all([
        fetch(`${BACKEND_URL}/api/notifications/unified?limit=20&unread_only=false`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${BACKEND_URL}/api/notifications/unified/stats`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      if (listRes.ok) {
        const data = await listRes.json();
        setItems(data.items || []);
      }
      if (statsRes.ok) {
        const data = await statsRes.json();
        setUnreadCount(data.total_unread || 0);
      }
    } catch (e) {
      // silent
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    refresh();
    const id = setInterval(refresh, 60000);
    return () => clearInterval(id);
  }, [token, refresh]);

  // SSE subscribe
  useEffect(() => {
    if (!token) return;
    try {
      // EventSource tidak bisa set Authorization header → pakai query param
      const url = `${BACKEND_URL}/api/notifications/stream?token=${encodeURIComponent(token)}`;
      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.addEventListener('notification', (e) => {
        try {
          const n = JSON.parse(e.data);
          // Update state
          setItems((prev) => [{ ...n, read: false }, ...prev.filter((x) => x.id !== n.id)]);
          setUnreadCount((c) => c + 1);

          // Toast pop-up dengan sonner (severity-aware)
          const sev = n.severity || 'info';
          const toastFn = sev === 'error' ? toast.error
                       : sev === 'warning' ? toast.warning
                       : sev === 'success' ? toast.success
                       : toast.info;
          toastFn(n.title, {
            description: n.message,
            duration: sev === 'error' ? 8000 : 5000,
            action: n.link_module ? {
              label: 'Buka',
              onClick: () => {
                if (onNavigateModule) onNavigateModule(n.link_module);
                markRead(n.id);
              },
            } : undefined,
          });
        } catch (_) { /* ignore */ }
      });

      es.addEventListener('ping', () => {
        // heartbeat, no-op
      });

      es.onerror = () => {
        // Browser akan auto-retry. Tutup jika error persist tidak bisa langsung tapi biarkan.
      };

      return () => {
        es.close();
        eventSourceRef.current = null;
      };
    } catch (e) {
      // EventSource tidak tersedia
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Close popover on outside click
  useEffect(() => {
    const handler = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const markRead = async (id) => {
    try {
      // Phase 3.3C: Use unified endpoint
      await fetch(`${BACKEND_URL}/api/notifications/unified/${id}/mark-read`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      setItems((prev) => prev.map((x) => (x.id === id ? { ...x, read: true } : x)));
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch (_) {}
  };

  const markAllRead = async () => {
    try {
      // Phase 3.3C: Use unified endpoint
      await fetch(`${BACKEND_URL}/api/notifications/unified/mark-all-read`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      setItems((prev) => prev.map((x) => ({ ...x, read: true })));
      setUnreadCount(0);
    } catch (_) {}
  };

  const handleItemClick = async (n) => {
    if (!n.read) await markRead(n.id);
    if (n.link_module && onNavigateModule) {
      onNavigateModule(n.link_module, n.link_id);
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative inline-flex items-center justify-center h-11 w-11 min-h-[44px] min-w-[44px] rounded-full border bg-[var(--nav-pill-bg)] border-[var(--glass-border)] text-foreground/70 hover:text-foreground hover:bg-[var(--nav-pill-active)] transition-[background-color,color,transform] duration-200 ease-[var(--ease-out)] active:scale-95"
        aria-label={`Notifikasi ${unreadCount > 0 ? `(${unreadCount} belum dibaca)` : ''}`}
        title="Notifikasi"
        data-testid="notification-bell-btn"
      >
        <Bell className="w-4 h-4" strokeWidth={2} />
        {unreadCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 h-4 min-w-[16px] px-1 rounded-full bg-[hsl(var(--destructive))] text-white text-[10px] font-bold leading-4 text-center shadow"
            data-testid="notification-unread-count"
            aria-hidden="true"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute top-full right-0 mt-2 w-[360px] max-w-[92vw] rounded-[var(--radius-md)] border border-[var(--glass-border)] bg-[var(--popover-surface)] backdrop-blur-[var(--glass-blur-strong)] shadow-[var(--shadow-soft)] z-50 overflow-hidden"
          data-testid="notification-popover"
          role="region"
          aria-label="Daftar notifikasi"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--glass-border)]">
            <h3 className="text-sm font-semibold text-foreground">Notifikasi</h3>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-[11px] font-medium text-[hsl(var(--primary))] hover:underline px-2 py-1"
                  data-testid="notification-mark-all-read-btn"
                >
                  <CheckCheck className="w-3.5 h-3.5 inline mr-1" />
                  Tandai semua dibaca
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded text-foreground/50 hover:text-foreground"
                aria-label="Tutup"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-[420px] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-10 text-center text-xs text-foreground/50">
                <Bell className="w-8 h-8 mx-auto mb-2 text-foreground/20" strokeWidth={1.5} />
                <p>Belum ada notifikasi</p>
                <p className="text-[10px] text-foreground/40 mt-1">Kami akan beri tahu saat ada yang perlu perhatian.</p>
              </div>
            ) : (
              items.map((n) => {
                const SevIcon = SEV_ICON[n.severity] || Info;
                const TypeIcon = TYPE_ICON[n.type] || SevIcon;
                const sevColor = SEV_COLOR[n.severity] || 'text-foreground/70';
                return (
                  <button
                    key={n.id}
                    onClick={() => handleItemClick(n)}
                    className={`w-full text-left px-4 py-3 border-b border-[var(--glass-border)] last:border-0 hover:bg-[var(--glass-bg-hover)] transition-colors duration-150
                      ${n.read ? 'opacity-60' : ''}`}
                    data-testid={`notification-item-${n.id}`}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className={`shrink-0 mt-0.5 ${sevColor}`}>
                        <TypeIcon className="w-4 h-4" strokeWidth={2} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`text-xs font-semibold text-foreground leading-snug ${!n.read ? 'font-bold' : ''}`}>
                            {n.title}
                          </p>
                          {!n.read && (
                            <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-[hsl(var(--primary))] mt-1" aria-label="belum dibaca" />
                          )}
                        </div>
                        <p className="text-[11px] text-foreground/70 mt-0.5 leading-snug">{n.message}</p>
                        <p className="text-[10px] text-foreground/40 mt-1">
                          {formatTimeAgo(n.created_at)}
                          {n.link_module && <span className="ml-1">· klik untuk buka</span>}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
