/**
 * PushNotificationToggle — Browser push notification opt-in/out widget.
 * Shows in Portal Saya > Workspace > Reminder tab or as a floating card.
 * Uses Web Push API (VAPID). No third-party service required.
 */
import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Bell, BellOff, BellRing, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';

const API = process.env.REACT_APP_BACKEND_URL;

// Convert base64url string to Uint8Array (required by PushManager.subscribe)
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export default function PushNotificationToggle({ headers }) {
  const { toast } = useToast();
  const [status, setStatus] = useState('idle'); // idle | checking | subscribed | unsubscribed | unsupported | denied
  const [loading, setLoading] = useState(false);
  const [testSent, setTestSent] = useState(false);

  const checkStatus = useCallback(async () => {
    setStatus('checking');
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setStatus('unsupported');
      return;
    }
    if (Notification.permission === 'denied') {
      setStatus('denied');
      return;
    }
    try {
      const { data } = await axios.get(`${API}/api/push/status`, { headers });
      setStatus(data.push_enabled ? 'subscribed' : 'unsubscribed');
    } catch {
      setStatus('unsubscribed');
    }
  }, [headers]);

  useEffect(() => { checkStatus(); }, [checkStatus]);

  const subscribe = async () => {
    setLoading(true);
    try {
      // 1. Register service worker
      const reg = await navigator.serviceWorker.register('/sw-push.js');
      await navigator.serviceWorker.ready;

      // 2. Request notification permission
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus('denied');
        toast({ title: 'Izin notifikasi ditolak.', description: 'Aktifkan notifikasi di pengaturan browser.', variant: 'destructive' });
        setLoading(false);
        return;
      }

      // 3. Get VAPID public key
      const { data: vapidData } = await axios.get(`${API}/api/push/vapid-public-key`);
      const appServerKey = urlBase64ToUint8Array(vapidData.vapid_public_key);

      // 4. Subscribe via PushManager
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appServerKey,
      });

      // 5. Send subscription to backend
      await axios.post(`${API}/api/push/subscribe`, { subscription: subscription.toJSON() }, { headers });

      setStatus('subscribed');
      toast({ title: 'Notifikasi diaktifkan!', description: 'Anda akan menerima notifikasi browser dari sistem ERP.' });
    } catch (e) {
      console.error('Push subscribe error:', e);
      toast({ title: 'Gagal mengaktifkan notifikasi.', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const unsubscribe = async () => {
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw-push.js');
      if (reg) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await axios.post(`${API}/api/push/unsubscribe`, { endpoint: sub.endpoint }, { headers });
          await sub.unsubscribe();
        }
      }
      setStatus('unsubscribed');
      toast({ title: 'Notifikasi dinonaktifkan.' });
    } catch (e) {
      toast({ title: 'Gagal menonaktifkan notifikasi.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const sendTest = async () => {
    setLoading(true);
    try {
      await axios.post(`${API}/api/push/test`, {}, { headers });
      setTestSent(true);
      toast({ title: 'Notifikasi tes terkirim!', description: 'Cek notifikasi browser Anda.' });
      setTimeout(() => setTestSent(false), 4000);
    } catch (e) {
      const msg = e?.response?.data?.detail || e.message;
      toast({ title: 'Gagal kirim tes.', description: msg, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border" data-testid="push-notification-toggle">
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
              status === 'subscribed' ? 'bg-green-100 text-green-600' :
              status === 'denied' ? 'bg-red-100 text-red-500' :
              'bg-muted text-muted-foreground'
            }`}>
              {status === 'subscribed' ? <BellRing className="w-5 h-5" /> :
               status === 'denied'     ? <BellOff className="w-5 h-5" />  :
                                         <Bell className="w-5 h-5" />}
            </div>
            <div>
              <p className="text-sm font-medium">Notifikasi Browser</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {status === 'subscribed'   ? 'Aktif — menerima notifikasi ERP' :
                 status === 'unsubscribed' ? 'Nonaktif — klik untuk mengaktifkan' :
                 status === 'denied'       ? 'Diblokir — aktifkan di pengaturan browser' :
                 status === 'unsupported'  ? 'Browser tidak mendukung push notification' :
                 status === 'checking'     ? 'Memeriksa status...' : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {status === 'subscribed' && (
              <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50 text-xs">
                <CheckCircle2 className="w-3 h-3 mr-1" /> Aktif
              </Badge>
            )}
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          {status === 'unsubscribed' && (
            <Button size="sm" onClick={subscribe} disabled={loading} data-testid="btn-push-subscribe">
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Bell className="w-4 h-4 mr-1" />}
              Aktifkan Notifikasi
            </Button>
          )}

          {status === 'subscribed' && (
            <>
              <Button size="sm" variant="outline" onClick={sendTest} disabled={loading} data-testid="btn-push-test">
                {testSent ? <CheckCircle2 className="w-4 h-4 mr-1 text-green-500" /> : loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <BellRing className="w-4 h-4 mr-1" />}
                {testSent ? 'Terkirim!' : 'Tes Notifikasi'}
              </Button>
              <Button size="sm" variant="ghost" onClick={unsubscribe} disabled={loading} data-testid="btn-push-unsubscribe"
                className="text-muted-foreground hover:text-red-600">
                <BellOff className="w-4 h-4 mr-1" /> Nonaktifkan
              </Button>
            </>
          )}

          {status === 'denied' && (
            <p className="text-xs text-red-500 flex items-center gap-1">
              <BellOff className="w-3.5 h-3.5" />
              Buka pengaturan browser → Notifications → Izinkan untuk situs ini.
            </p>
          )}

          {status === 'unsupported' && (
            <p className="text-xs text-muted-foreground">
              Browser Anda tidak mendukung Web Push Notifications.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
