import { useState, useEffect, useCallback, useRef } from 'react';
import { AlertTriangle, CheckCircle2, XCircle, Clock, RefreshCw, Wrench, Package, HelpCircle, Shield, Radio, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GlassCard, GlassPanel } from '@/components/ui/glass';
import { toast } from 'sonner';

const API_BASE = process.env.REACT_APP_BACKEND_URL || '';

/* ─── AndonBoardModule — Supervisor/Manager Andon Board (Phase 18B) ───────────
   Shows active andon events with SLA progress, ack/resolve actions.
 ──────────────────────────────────────────────────────────────────────────── */

const TYPE_META = {
  machine_breakdown: { label: 'Mesin Rusak',    icon: Wrench,       color: 'red' },
  material_shortage: { label: 'Material Habis', icon: Package,      color: 'amber' },
  quality_issue:     { label: 'Defect Banyak',  icon: XCircle,      color: 'orange' },
  help:              { label: 'Minta Bantuan',  icon: HelpCircle,   color: 'blue' },
};

const STATUS_META = {
  active:       { label: 'Aktif',       bg: 'bg-red-400/15 text-red-300 border-red-400/25' },
  acknowledged: { label: 'Ditangani',   bg: 'bg-amber-400/15 text-amber-300 border-amber-400/25' },
  resolved:     { label: 'Selesai',     bg: 'bg-emerald-400/15 text-emerald-300 border-emerald-400/25' },
  cancelled:    { label: 'Dibatalkan',  bg: 'bg-foreground/10 text-muted-foreground border-foreground/15' },
};

function AgePill({ minutes, slaSup, slaMgr }) {
  const overSup = minutes > slaSup;
  const overMgr = minutes > slaMgr;
  const bg = overMgr
    ? 'bg-red-500/20 text-red-300 border-red-400/30'
    : overSup
    ? 'bg-amber-500/20 text-amber-300 border-amber-400/30'
    : 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30';
  const m = Math.round(minutes);
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-semibold ${bg}`}>
      <Clock className="w-3 h-3" /> {m} mnt
    </span>
  );
}

function SLABar({ minutes, slaSup, slaMgr }) {
  const pct = Math.min(100, (minutes / slaMgr) * 100);
  const color = minutes > slaMgr ? 'bg-red-500' : minutes > slaSup ? 'bg-amber-400' : 'bg-emerald-400';
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-0.5">
        <span>SLA {slaSup}m → {slaMgr}m</span>
        <span>{Math.round(minutes)} / {slaMgr} mnt</span>
      </div>
      <div className="h-1.5 bg-[var(--glass-bg)] rounded-full overflow-hidden">
        <div className={`h-full ${color} transition-all duration-300`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function AndonCard({ event, token, onUpdate }) {
  const [acking, setAcking] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [notesResolve, setNotesResolve] = useState('');
  const [showResolve, setShowResolve] = useState(false);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const TypeMeta = TYPE_META[event.type] || TYPE_META.help;
  const TypeIcon = TypeMeta.icon;
  const statusMeta = STATUS_META[event.status] || STATUS_META.active;

  const handleAck = async () => {
    setAcking(true);
    try {
      const r = await fetch(`/api/rahaza/andon/${event.id}/ack`, { method: 'POST', headers, body: '{}' });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`);
      toast.success('Andon di-acknowledge');
      onUpdate();
    } catch (e) { toast.error(e.message); } finally { setAcking(false); }
  };

  const handleResolve = async () => {
    setResolving(true);
    try {
      const r = await fetch(`/api/rahaza/andon/${event.id}/resolve`, {
        method: 'POST', headers,
        body: JSON.stringify({ notes: notesResolve }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`);
      toast.success('Andon diselesaikan');
      setShowResolve(false);
      onUpdate();
    } catch (e) { toast.error(e.message); } finally { setResolving(false); }
  };

  return (
    <GlassCard className="p-4" data-testid={`andon-card-${event.id}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
            TypeMeta.color === 'red'    ? 'bg-red-500/15'    :
            TypeMeta.color === 'amber' ? 'bg-amber-500/15'  :
            TypeMeta.color === 'orange'? 'bg-orange-500/15' :
                                         'bg-blue-500/15'
          }`}>
            <TypeIcon className={`w-4.5 h-4.5 ${
              TypeMeta.color === 'red'    ? 'text-red-400'    :
              TypeMeta.color === 'amber' ? 'text-amber-400'  :
              TypeMeta.color === 'orange'? 'text-orange-400' :
                                           'text-blue-400'
            }`} />
          </div>
          <div>
            <div className="font-semibold text-sm text-foreground">{TypeMeta.label}</div>
            <div className="text-xs text-muted-foreground">
              {event.line_code ? `Line ${event.line_code}` : ''}
              {event.process_code ? ` · ${event.process_code}` : ''}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <AgePill minutes={event.age_minutes || 0} slaSup={event.sla_supervisor_min} slaMgr={event.sla_manager_min} />
          <span className={`inline-flex items-center text-[10px] px-2 py-0.5 rounded-full border font-semibold ${statusMeta.bg}`}>
            {statusMeta.label}
          </span>
        </div>
      </div>

      {event.employee_name && (
        <div className="text-xs text-muted-foreground mb-1">
          Operator: <span className="text-foreground font-medium">{event.employee_name}</span>
        </div>
      )}

      {event.message && (
        <div className="text-xs bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-foreground/80 italic mb-2">
          "{event.message}"
        </div>
      )}

      {event.status === 'active' && (
        <SLABar
          minutes={event.age_minutes || 0}
          slaSup={event.sla_supervisor_min}
          slaMgr={event.sla_manager_min}
        />
      )}

      {event.acknowledged_by_name && (
        <div className="text-xs text-emerald-300 mt-1">
          Dihandle oleh: {event.acknowledged_by_name}
        </div>
      )}

      {event.resolved_by_name && (
        <div className="text-xs text-emerald-300 mt-1">
          Diselesaikan oleh: {event.resolved_by_name}
          {event.notes_resolve ? ` — "${event.notes_resolve}"` : ''}
        </div>
      )}

      {event.status === 'active' && (
        <div className="flex gap-2 mt-3">
          <Button
            size="sm"
            onClick={handleAck}
            disabled={acking || resolving}
            className="h-8 px-3 text-xs"
            data-testid={`andon-ack-btn-${event.id}`}
          >
            {acking ? '...' : <><CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Ack</>}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowResolve(!showResolve)}
            disabled={acking || resolving}
            className="h-8 px-3 text-xs border border-emerald-400/25 text-emerald-300 hover:bg-emerald-400/10"
            data-testid={`andon-resolve-btn-${event.id}`}
          >
            <Shield className="w-3.5 h-3.5 mr-1" /> Selesai
          </Button>
        </div>
      )}

      {event.status === 'acknowledged' && (
        <div className="flex gap-2 mt-3">
          <Button
            size="sm"
            onClick={() => setShowResolve(!showResolve)}
            disabled={resolving}
            className="h-8 px-3 text-xs bg-emerald-500 hover:bg-emerald-600 text-white"
            data-testid={`andon-resolve-btn-${event.id}`}
          >
            <Shield className="w-3.5 h-3.5 mr-1" /> Tandai Selesai
          </Button>
        </div>
      )}

      {showResolve && (
        <div className="mt-2 space-y-2 animate-in fade-in duration-150" data-testid="andon-resolve-form">
          <textarea
            className="w-full min-h-[48px] px-3 py-2 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-xs text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))] resize-none"
            placeholder="Catatan penyelesaian (opsional)..."
            value={notesResolve}
            onChange={e => setNotesResolve(e.target.value)}
          />
          <Button
            size="sm"
            onClick={handleResolve}
            disabled={resolving}
            className="h-8 px-4 text-xs w-full"
          >
            {resolving ? 'Menyimpan...' : 'Konfirmasi Selesai'}
          </Button>
        </div>
      )}
    </GlassCard>
  );
}

export default function AndonBoardModule({ token }) {
  const [data, setData] = useState(null);
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('active'); // 'active' | 'history'
  const [settings, setSettings] = useState(null);
  const [editSettings, setEditSettings] = useState(false);
  const [slaSup, setSlaSup] = useState(10);
  const [slaMgr, setSlaMgr] = useState(20);
  const [savingSettings, setSavingSettings] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const loadActive = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/rahaza/andon/active', { headers });
      if (r.ok) setData(await r.json());
    } finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const loadHistory = useCallback(async () => {
    try {
      const r = await fetch('/api/rahaza/andon/history?limit=50', { headers });
      if (r.ok) setHistory(await r.json());
    } catch (_) {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const loadSettings = useCallback(async () => {
    try {
      const r = await fetch('/api/rahaza/andon/settings', { headers });
      if (r.ok) {
        const s = await r.json();
        setSettings(s);
        setSlaSup(s.sla_supervisor_min);
        setSlaMgr(s.sla_manager_min);
      }
    } catch (_) {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    loadActive();
    loadSettings();
  }, [loadActive, loadSettings]);

  useEffect(() => {
    if (tab === 'history') loadHistory();
  }, [tab, loadHistory]);

  // Real-time WebSocket connection
  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      const wsBase = API_BASE.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');
      const url = `${wsBase}/api/rahaza/andon/ws?token=${encodeURIComponent(token)}`;
      let ws;
      try { ws = new WebSocket(url); } catch (_) { return; }
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) { try { ws.close(); } catch (_) {} return; }
        setWsConnected(true);
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'init') {
            // Hydrate from init snapshot
            setData(prev => ({ ...(prev || {}), events: msg.data?.events || [], total: (msg.data?.events || []).length }));
            // Also fetch full overview for totals (overdue counters)
            loadActive();
          } else if (msg.type === 'andon_update') {
            // Any andon event change — refresh lists
            if (tab === 'active') loadActive();
            else if (tab === 'history') loadHistory();
          }
          // ping → ignore
        } catch (_) {}
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (!cancelled) {
          // Reconnect after 3s
          reconnectTimerRef.current = setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => {
        setWsConnected(false);
        try { ws.close(); } catch (_) {}
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        try { wsRef.current.close(); } catch (_) {}
        wsRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Fallback polling every 30s only when WebSocket disconnected
  useEffect(() => {
    if (wsConnected) return;
    const id = setInterval(() => {
      if (tab === 'active') loadActive();
    }, 30000);
    return () => clearInterval(id);
  }, [wsConnected, tab, loadActive]);

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      const r = await fetch('/api/rahaza/andon/settings', {
        method: 'PUT', headers,
        body: JSON.stringify({ sla_supervisor_min: +slaSup, sla_manager_min: +slaMgr }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
      setSettings(d);
      setEditSettings(false);
      toast.success('Pengaturan SLA disimpan');
    } catch (e) { toast.error(e.message); } finally { setSavingSettings(false); }
  };

  const active = data?.events || [];
  const hist = history?.events || [];

  return (
    <div className="space-y-6" data-testid="andon-board-module">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-red-400" />
            Papan Andon
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Permintaan bantuan operator realtime · SLA escalation otomatis
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            data-testid="andon-ws-status"
            className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-semibold ${
              wsConnected
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30'
                : 'bg-foreground/10 text-muted-foreground border-foreground/15'
            }`}
            title={wsConnected ? 'Realtime terhubung' : 'Realtime terputus — fallback polling 30s'}
          >
            {wsConnected
              ? <><Radio className="w-3 h-3" /> LIVE</>
              : <><WifiOff className="w-3 h-3" /> Offline</>}
          </span>
          <Button variant="ghost" size="sm" onClick={loadActive} className="h-9">
            <RefreshCw className="w-4 h-4 mr-1.5" /> Muat Ulang
          </Button>
          <Button
            variant="ghost" size="sm"
            onClick={() => setEditSettings(!editSettings)}
            className="h-9"
            data-testid="andon-settings-btn"
          >
            SLA Settings
          </Button>
        </div>
      </div>

      {/* SLA Settings panel */}
      {editSettings && (
        <GlassCard className="p-4" data-testid="andon-settings-panel">
          <div className="font-semibold text-sm text-foreground mb-3">Konfigurasi SLA Andon</div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">SLA Supervisor (menit)</label>
              <input
                type="number" min="1" max="120"
                value={slaSup}
                onChange={e => setSlaSup(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm text-foreground"
                data-testid="sla-sup-input"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">SLA Manager (menit)</label>
              <input
                type="number" min="2" max="240"
                value={slaMgr}
                onChange={e => setSlaMgr(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm text-foreground"
                data-testid="sla-mgr-input"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <Button size="sm" onClick={saveSettings} disabled={savingSettings} className="h-8 px-4 text-xs">
              {savingSettings ? 'Menyimpan...' : 'Simpan'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditSettings(false)} className="h-8 px-4 text-xs">Batal</Button>
          </div>
        </GlassCard>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Andon Aktif',         value: data?.total || 0,                    color: 'text-red-400' },
          { label: 'SLA Sup Overdue',     value: data?.total_overdue_supervisor || 0, color: 'text-amber-400' },
          { label: 'SLA Mgr Overdue',     value: data?.total_overdue_manager || 0,    color: 'text-orange-400' },
          { label: 'Total History',       value: history?.total || '—',              color: 'text-foreground' },
        ].map(k => (
          <GlassCard key={k.label} className="p-3 text-center">
            <div className={`text-2xl font-bold ${k.color}`}>{k.value}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{k.label}</div>
          </GlassCard>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--glass-border)]">
        {[['active', 'Aktif'], ['history', 'Riwayat']].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`pb-2 px-4 text-sm font-medium transition-colors ${
              tab === key ? 'text-[hsl(var(--primary))] border-b-2 border-[hsl(var(--primary))]' : 'text-muted-foreground hover:text-foreground'
            }`}
            data-testid={`andon-tab-${key}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[hsl(var(--primary))]" />
        </div>
      ) : tab === 'active' ? (
        active.length === 0 ? (
          <GlassCard className="p-8 text-center">
            <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-emerald-400" />
            <div className="font-semibold text-foreground">Tidak ada Andon aktif</div>
            <div className="text-sm text-muted-foreground mt-1">Semua operator bekerja normal — tidak ada permintaan bantuan.</div>
          </GlassCard>
        ) : (
          <div className="space-y-3">
            {active.map(ev => (
              <AndonCard key={ev.id} event={ev} token={token} onUpdate={loadActive} />
            ))}
          </div>
        )
      ) : (
        hist.length === 0 ? (
          <GlassCard className="p-8 text-center">
            <Clock className="w-10 h-10 mx-auto mb-3 text-foreground/30" />
            <div className="text-sm text-muted-foreground">Belum ada riwayat Andon</div>
          </GlassCard>
        ) : (
          <div className="space-y-3">
            {hist.map(ev => (
              <AndonCard key={ev.id} event={ev} token={token} onUpdate={loadHistory} />
            ))}
          </div>
        )
      )}
    </div>
  );
}
