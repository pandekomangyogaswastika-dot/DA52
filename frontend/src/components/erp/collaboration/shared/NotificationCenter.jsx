/**
 * NotificationCenter.jsx
 * Phase 3.2 — In-app notification center for Portal Kolaborasi.
 * Shows notifications from: LMS (enroll, quiz, assignment, certificate), chat mentions,
 * document shares, system announcements.
 */
import { useState, useEffect, useCallback } from 'react';
import { Button } from '../../../ui/button';
import { Badge } from '../../../ui/badge';
import { ScrollArea } from '../../../ui/scroll-area';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '../../../ui/sheet';
import { formatDistanceToNow } from 'date-fns';
import { id as localeId } from 'date-fns/locale';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

const apiFetch = async (path, token, opts = {}) => {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...opts,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

const TYPE_CONFIG = {
  message:     { bg: 'bg-blue-100',   text: 'text-blue-700',   icon: '💬', label: 'Pesan' },
  mention:     { bg: 'bg-purple-100', text: 'text-purple-700', icon: '@',    label: 'Mention' },
  document:    { bg: 'bg-amber-100',  text: 'text-amber-700',  icon: '📄', label: 'Dokumen' },
  course:      { bg: 'bg-green-100',  text: 'text-green-700',  icon: '📚', label: 'Course' },
  assignment:  { bg: 'bg-orange-100', text: 'text-orange-700', icon: '📝', label: 'Tugas' },
  grade:       { bg: 'bg-yellow-100', text: 'text-yellow-700', icon: '⭐', label: 'Nilai' },
  certificate: { bg: 'bg-emerald-100',text: 'text-emerald-700',icon: '🎓', label: 'Sertifikat' },
  deadline:    { bg: 'bg-red-100',    text: 'text-red-700',    icon: '⏰', label: 'Deadline' },
  system:      { bg: 'bg-gray-100',   text: 'text-gray-700',   icon: '🔔', label: 'Sistem' },
};

function timeAgo(dateStr) {
  if (!dateStr) return '';
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true, locale: localeId });
  } catch {
    return '';
  }
}

export default function NotificationCenter({ token, open, onClose }) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState('all'); // all | unread

  const fetchNotifications = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await apiFetch(
        `/api/collab/notifications?limit=50${activeFilter === 'unread' ? '&unread_only=true' : ''}`,
        token
      );
      setNotifications(data.notifications || []);
      setUnreadCount(data.unread_count || 0);
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
    }
  }, [token, activeFilter]);

  useEffect(() => {
    if (open) fetchNotifications();
  }, [open, fetchNotifications]);

  const markRead = async (notifId) => {
    try {
      await apiFetch(`/api/collab/notifications/${notifId}/read`, token, { method: 'POST' });
      setNotifications(prev =>
        prev.map(n => n.notification_id === notifId ? { ...n, read: true } : n)
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch { /* ignore */ }
  };

  const markAllRead = async () => {
    try {
      await apiFetch('/api/collab/notifications/mark-all-read', token, { method: 'POST' });
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch { /* ignore */ }
  };

  const deleteNotif = async (notifId) => {
    try {
      await apiFetch(`/api/collab/notifications/${notifId}`, token, { method: 'DELETE' });
      setNotifications(prev => prev.filter(n => n.notification_id !== notifId));
    } catch { /* ignore */ }
  };

  const unread = notifications.filter(n => !n.read);
  const displayed = activeFilter === 'unread' ? unread : notifications;

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="right" className="w-[400px] sm:w-[440px] p-0 flex flex-col">
        <SheetHeader className="p-4 border-b">
          <div className="flex items-center justify-between">
            <SheetTitle className="flex items-center gap-2">
              🔔 Notifikasi
              {unreadCount > 0 && (
                <Badge variant="destructive" className="text-xs px-1.5">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </Badge>
              )}
            </SheetTitle>
            <div className="flex gap-2">
              {unreadCount > 0 && (
                <Button variant="ghost" size="sm" className="text-xs" onClick={markAllRead}>
                  Tandai semua dibaca
                </Button>
              )}
            </div>
          </div>

          {/* Filter tabs */}
          <div className="flex gap-1 mt-2">
            {[{id:'all',label:'Semua'},{id:'unread',label:`Belum dibaca${unread.length ? ` (${unread.length})` : ''}`}].map(f => (
              <button
                key={f.id}
                onClick={() => setActiveFilter(f.id)}
                className={`px-3 py-1 text-xs rounded-full transition-colors ${
                  activeFilter === f.id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground">
              <div className="animate-spin text-2xl">🔔</div>
            </div>
          ) : displayed.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-3">
              <div className="text-4xl">👍</div>
              <p className="text-sm">
                {activeFilter === 'unread' ? 'Tidak ada notifikasi belum dibaca' : 'Belum ada notifikasi'}
              </p>
            </div>
          ) : (
            <div className="divide-y" data-testid="notification-list">
              {displayed.map(notif => {
                const cfg = TYPE_CONFIG[notif.type] || TYPE_CONFIG.system;
                return (
                  <div
                    key={notif.notification_id}
                    data-testid={`notification-item-${notif.notification_id}`}
                    className={`flex gap-3 p-4 cursor-pointer hover:bg-accent/50 transition-colors ${
                      !notif.read ? 'bg-primary/5 border-l-2 border-primary' : ''
                    }`}
                    onClick={() => !notif.read && markRead(notif.notification_id)}
                  >
                    {/* Icon */}
                    <div className={`w-10 h-10 rounded-full ${cfg.bg} flex items-center justify-center flex-shrink-0 text-lg`}>
                      {cfg.icon}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-1">
                        <p className={`text-sm font-medium leading-tight ${
                          !notif.read ? 'text-foreground' : 'text-muted-foreground'
                        }`}>
                          {notif.title}
                        </p>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteNotif(notif.notification_id); }}
                          className="text-muted-foreground hover:text-destructive text-xs flex-shrink-0 opacity-0 group-hover:opacity-100"
                          title="Hapus"
                        >
                          ×
                        </button>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                        {notif.content}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${cfg.bg} ${cfg.text}`}>
                          {cfg.label}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {timeAgo(notif.created_at)}
                        </span>
                        {!notif.read && (
                          <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        <div className="p-3 border-t">
          <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground" onClick={fetchNotifications}>
            ↻ Perbarui notifikasi
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
