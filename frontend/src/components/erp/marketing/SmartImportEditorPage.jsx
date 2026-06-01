import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DataGrid } from 'react-data-grid';
import {
  ArrowLeft, CheckCircle2, RotateCcw, Loader2, Bot,
  GitCompare, Activity, Lock, Cpu
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
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
import 'react-data-grid/lib/styles.css';

const API = process.env.REACT_APP_BACKEND_URL;

function getRowClass(row) {
  if (!row) return '';
  const conf = row.confidence ?? 1;
  if (conf >= 0.9) return 'rdg-row-high';
  if (conf >= 0.7) return 'rdg-row-medium';
  return 'rdg-row-low';
}

function ConfidenceDot({ confidence }) {
  const conf = confidence ?? 0;
  const color = conf >= 0.9 ? 'bg-emerald-500' : conf >= 0.7 ? 'bg-amber-500' : 'bg-red-500';
  return <span className={`w-2 h-2 rounded-full ${color} inline-block`} title={`${(conf * 100).toFixed(0)}%`} />;
}

export default function SmartImportEditorPage({ sessionId, user, token, onBack }) {
  const { toast } = useToast();
  const [session, setSession] = useState(null);
  const [rows, setRows] = useState([]);
  const [columns, setColumns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confidenceFilter, setConfidenceFilter] = useState('all');
  const [sideTab, setSideTab] = useState('assist');
  const [assistInput, setAssistInput] = useState('');
  const [assistResult, setAssistResult] = useState(null);
  const [assistLoading, setAssistLoading] = useState(false);
  const [commitDialog, setCommitDialog] = useState(false);
  const [rollbackDialog, setRollbackDialog] = useState(false);
  const [rowLocks, setRowLocks] = useState({});
  const [collaborators, setCollaborators] = useState([]);
  const [wsStatus, setWsStatus] = useState('disconnected');
  const [focusedRowId, setFocusedRowId] = useState(null);
  const wsRef = useRef(null);
  const pollRef = useRef(null);
  const authHeaders = { Authorization: `Bearer ${token || localStorage.getItem('auth_token')}` };

  const fetchSession = useCallback(async () => {
    try {
      const res = await axios.get(
        `${API}/api/marketing/import/sessions/${sessionId}`,
        { headers: authHeaders }
      );
      const s = res.data;
      setSession(s);
      if (s.row_locks) setRowLocks(s.row_locks);

      const rawRows = s.draft_rows || [];
      const gridRows = rawRows.map(r => ({
        row_id: r.row_id,
        confidence: r.confidence ?? 1,
        validation_status: r.validation_status ?? 'valid',
        _has_edit: !!r.user_edited_data,
        _anomalies: r.validation_messages || [],
        _edit_count: (r.edit_history || []).length,
        ...(r.user_edited_data || r.ai_parsed_data || r.original_data || {})
      }));
      setRows(gridRows);

      if (gridRows.length > 0) {
        const systemKeys = new Set(['row_id', 'confidence', 'validation_status', '_has_edit', '_anomalies', '_edit_count']);
        const dataKeys = new Set();
        gridRows.forEach(r => Object.keys(r).forEach(k => !systemKeys.has(k) && dataKeys.add(k)));

        const cols = [
          {
            key: '_conf', name: '', width: 32, resizable: false, frozen: true,
            renderCell: ({ row }) => (
              <div className="flex items-center justify-center h-full">
                <ConfidenceDot confidence={row.confidence} />
              </div>
            )
          },
          {
            key: 'row_id', name: '#', width: 44, resizable: false, frozen: true,
            renderCell: ({ row }) => (
              <span className="text-xs text-muted-foreground tabular-nums pl-1">{(row.row_id ?? 0) + 1}</span>
            )
          },
          ...Array.from(dataKeys).slice(0, 18).map(key => ({
            key,
            name: key.replace(/_/g, ' '),
            width: 150,
            resizable: true,
            editable: !['committed', 'rolled_back'].includes(s.status),
            renderCell: ({ row }) => {
              const val = row[key];
              const valStr = val == null ? '' : String(val);
              const hasAnomaly = (row._anomalies || []).some(a =>
                typeof a === 'string' && a.toLowerCase().includes(key.toLowerCase())
              );
              return (
                <div
                  className={`px-2 text-xs truncate h-full flex items-center ${
                    hasAnomaly ? 'text-amber-700 dark:text-amber-300' : ''
                  }`}
                  title={valStr}
                >
                  {valStr || <span className="text-muted-foreground/30 italic">—</span>}
                </div>
              );
            },
            renderEditCell: ({ row, onRowChange }) => (
              <input
                autoFocus
                className="w-full h-full px-2 text-xs bg-background border-0 outline-none ring-1 ring-primary"
                defaultValue={row[key] ?? ''}
                onBlur={e => onRowChange({ ...row, [key]: e.target.value })}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    onRowChange({ ...row, [key]: e.target.value });
                  }
                }}
              />
            )
          }))
        ];
        setColumns(cols);
      }
    } catch (e) {
      console.error('fetchSession', e);
      toast({ title: 'Gagal memuat session', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [sessionId, token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchSession();
    pollRef.current = setInterval(() => {
      setSession(prev => {
        if (prev?.status === 'parsing' || prev?.status === 'queued') fetchSession();
        return prev;
      });
    }, 3000);
    return () => clearInterval(pollRef.current);
  }, [fetchSession]);

  // WebSocket
  useEffect(() => {
    if (!sessionId) return;
    const wsBase = API.replace('https://', 'wss://').replace('http://', 'ws://');
    const wsUrl = `${wsBase}/api/marketing/import/sessions/${sessionId}/ws`;

    let ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      setWsStatus('connected');
      ws.send(JSON.stringify({ type: 'presence', user_email: user?.email || 'anonymous' }));
    };
    ws.onclose = () => setWsStatus('disconnected');
    ws.onerror  = () => setWsStatus('error');
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'cell_edited') {
          setRows(prev => prev.map(r =>
            r.row_id === msg.row_id ? { ...r, [msg.column]: msg.new_value, _has_edit: true } : r
          ));
        } else if (msg.type === 'row_locked') {
          setRowLocks(prev => ({ ...prev, [String(msg.row_id)]: msg.locked_by }));
        } else if (msg.type === 'row_unlocked') {
          setRowLocks(prev => { const n = { ...prev }; delete n[String(msg.row_id)]; return n; });
        } else if (['session_updated', 'session_committed'].includes(msg.type)) {
          fetchSession();
        } else if (msg.type === 'collaborator_present') {
          setCollaborators(prev => {
            const filtered = prev.filter(c => c.email !== msg.user_email);
            return [...filtered, { email: msg.user_email, seen_at: Date.now() }];
          });
        }
      } catch (_) {}
    };

    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
    }, 30000);

    return () => { clearInterval(ping); ws.close(); };
  }, [sessionId, user, fetchSession]);

  const handleRowsChange = useCallback(async (updatedRows, { column, indexes }) => {
    if (!indexes || indexes.length === 0) return;
    const row = updatedRows[indexes[0]];
    setRows(updatedRows);
    try {
      await axios.patch(
        `${API}/api/marketing/import/sessions/${sessionId}/cells`,
        { row_id: row.row_id, column: column.key, new_value: row[column.key] },
        { headers: authHeaders }
      );
    } catch (e) {
      toast({ title: 'Gagal simpan edit', variant: 'destructive' });
    }
  }, [sessionId, token]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAiAssist = async () => {
    if (focusedRowId == null) {
      toast({ title: 'Pilih baris terlebih dahulu' }); return;
    }
    setAssistLoading(true);
    try {
      const res = await axios.post(
        `${API}/api/marketing/import/sessions/${sessionId}/ai-assist`,
        { row_id: focusedRowId, question: assistInput || undefined },
        { headers: authHeaders }
      );
      setAssistResult(res.data.suggestion);
    } catch (e) {
      toast({ title: 'AI Assist gagal', variant: 'destructive' });
    } finally {
      setAssistLoading(false);
    }
  };

  const handleCommit = async () => {
    try {
      const res = await axios.post(
        `${API}/api/marketing/import/sessions/${sessionId}/commit`,
        {},
        { headers: authHeaders }
      );
      toast({ title: `✅ ${res.data.committed_count} baris di-commit!` });
      await fetchSession();
    } catch (e) {
      toast({ title: 'Commit gagal', description: e.response?.data?.detail, variant: 'destructive' });
    }
    setCommitDialog(false);
  };

  const handleRollback = async () => {
    try {
      const res = await axios.post(
        `${API}/api/marketing/import/sessions/${sessionId}/rollback`,
        {},
        { headers: authHeaders }
      );
      toast({ title: `↩️ Rolled back ${res.data.rolled_back_count} baris` });
      await fetchSession();
    } catch (e) {
      toast({ title: 'Rollback gagal', variant: 'destructive' });
    }
    setRollbackDialog(false);
  };

  const filteredRows = rows.filter(r => {
    if (confidenceFilter === 'high')    return (r.confidence ?? 0) >= 0.9;
    if (confidenceFilter === 'medium')  return (r.confidence ?? 0) >= 0.7 && (r.confidence ?? 0) < 0.9;
    if (confidenceFilter === 'low')     return (r.confidence ?? 0) < 0.7;
    if (confidenceFilter === 'warning') return r.validation_status === 'warning' || r.validation_status === 'error';
    return true;
  });

  if (loading) return (
    <div className="flex items-center justify-center h-full min-h-[400px]">
      <Loader2 className="animate-spin text-muted-foreground" size={28} />
    </div>
  );
  if (!session) return (
    <div className="flex items-center justify-center h-full min-h-[200px] text-muted-foreground">
      Session tidak ditemukan.
    </div>
  );

  const isEditable = ['ready_review', 'draft'].includes(session.status);
  const cs = session.confidence_summary || {};
  const total = (cs.high || 0) + (cs.medium || 0) + (cs.low || 0);

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 56px)' }} data-testid="smart-import-editor">
      {/* Topbar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b bg-background/95 backdrop-blur flex-wrap flex-shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="btn-back">
          <ArrowLeft size={16} className="mr-1" /> Kembali
        </Button>
        <div className="h-4 w-px bg-border" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm truncate max-w-[200px]">{session.filename}</span>
            <Badge variant="outline" className="text-xs">{session.status}</Badge>
            {session.source_type && (
              <Badge variant="secondary" className="text-xs">{session.source_type.replace(/_/g, ' ')}</Badge>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
            <span>{total} baris</span>
            {cs.high > 0 && <span className="text-emerald-600">🟢 {cs.high}</span>}
            {cs.medium > 0 && <span className="text-amber-600">🟡 {cs.medium}</span>}
            {cs.low > 0 && <span className="text-red-600">🔴 {cs.low}</span>}
            {session.overall_confidence && (
              <span>AI: {(session.overall_confidence * 100).toFixed(0)}%</span>
            )}
          </div>
        </div>

        {/* Collaborators */}
        {collaborators.length > 0 && (
          <div className="flex items-center gap-1">
            {collaborators.slice(0, 3).map(c => (
              <div key={c.email} title={c.email}
                className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center font-bold flex-shrink-0"
              >
                {(c.email || 'A')[0].toUpperCase()}
              </div>
            ))}
            <span className="text-xs text-muted-foreground">{collaborators.length} online</span>
          </div>
        )}

        {/* WS Dot */}
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
          wsStatus === 'connected' ? 'bg-emerald-500' : wsStatus === 'error' ? 'bg-red-500' : 'bg-gray-400'
        }`} title={`WebSocket: ${wsStatus}`} />

        <Select value={confidenceFilter} onValueChange={setConfidenceFilter}>
          <SelectTrigger className="w-[130px] h-8 text-xs flex-shrink-0">
            <SelectValue placeholder="Filter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Baris</SelectItem>
            <SelectItem value="high">🟢 Tinggi</SelectItem>
            <SelectItem value="medium">🟡 Sedang</SelectItem>
            <SelectItem value="low">🔴 Rendah</SelectItem>
            <SelectItem value="warning">⚠️ Perlu Review</SelectItem>
          </SelectContent>
        </Select>

        {isEditable && (
          <Button size="sm" className="h-8 flex-shrink-0" onClick={() => setCommitDialog(true)} data-testid="btn-commit">
            <CheckCircle2 size={13} className="mr-1" /> Commit
          </Button>
        )}
        {session.status === 'committed' && (
          <Button size="sm" variant="outline" className="h-8 text-amber-600 border-amber-200 flex-shrink-0"
            onClick={() => setRollbackDialog(true)} data-testid="btn-rollback"
          >
            <RotateCcw size={13} className="mr-1" /> Rollback
          </Button>
        )}
      </div>

      {/* Main: Grid + Side Panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* DataGrid */}
        <div className="flex-1 overflow-hidden" data-testid="data-grid-container">
          {(session.status === 'parsing' || session.status === 'queued') ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
              <Loader2 size={32} className="animate-spin" />
              <p className="text-sm font-medium">
                {session.status === 'queued' ? 'Menunggu antrian AI...' : 'AI sedang memproses file...'}
              </p>
              <p className="text-xs">Halaman update otomatis</p>
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
              <span className="text-4xl">📭</span>
              <p className="text-sm">Tidak ada data untuk ditampilkan</p>
            </div>
          ) : (
            <DataGrid
              columns={columns}
              rows={filteredRows}
              onRowsChange={isEditable ? handleRowsChange : undefined}
              rowKeyGetter={row => row.row_id}
              className="rdg-light"
              style={{ height: '100%', blockSize: '100%' }}
              rowClass={row => {
                const classes = [getRowClass(row)];
                if (row._has_edit) classes.push('rdg-row-edited');
                if (rowLocks[String(row.row_id)]) classes.push('rdg-row-locked');
                return classes.join(' ');
              }}
              onCellClick={({ row }) => {
                setFocusedRowId(row.row_id);
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                  wsRef.current.send(JSON.stringify({
                    type: 'lock_row', row_id: row.row_id,
                    user_email: user?.email || 'anonymous'
                  }));
                }
              }}
            />
          )}
        </div>

        {/* Side Panel */}
        <div className="w-72 xl:w-80 border-l flex flex-col bg-background overflow-hidden flex-shrink-0">
          <Tabs value={sideTab} onValueChange={setSideTab} className="flex flex-col h-full">
            <TabsList className="rounded-none border-b bg-muted/30 h-9 flex-shrink-0">
              <TabsTrigger value="assist" className="text-xs flex-1">
                <Bot size={11} className="mr-1" /> AI Assist
              </TabsTrigger>
              <TabsTrigger value="diff" className="text-xs flex-1">
                <GitCompare size={11} className="mr-1" /> Diff
              </TabsTrigger>
              <TabsTrigger value="info" className="text-xs flex-1">
                <Activity size={11} className="mr-1" /> Info
              </TabsTrigger>
            </TabsList>

            {/* AI Assist */}
            <TabsContent value="assist" className="flex flex-col flex-1 overflow-hidden p-3 gap-3 mt-0">
              <p className="text-xs text-muted-foreground">
                {focusedRowId != null
                  ? <span>Baris dipilih: <strong className="text-foreground">#{(focusedRowId ?? 0) + 1}</strong></span>
                  : 'Klik baris di grid untuk memilih'}
              </p>
              <Textarea
                placeholder="Tanya AI... (opsional)"
                value={assistInput}
                onChange={e => setAssistInput(e.target.value)}
                className="text-xs resize-none h-16 flex-shrink-0"
                data-testid="ai-assist-input"
              />
              <Button size="sm" className="flex-shrink-0" onClick={handleAiAssist}
                disabled={assistLoading || focusedRowId == null}
                data-testid="btn-ai-assist"
              >
                {assistLoading ? <Loader2 size={12} className="mr-1 animate-spin" /> : <Cpu size={12} className="mr-1" />}
                Analisis Baris
              </Button>
              {assistResult && (
                <div className="rounded-lg border bg-muted/30 p-3 text-xs space-y-2 overflow-auto flex-1">
                  <p className="font-semibold">Saran AI:</p>
                  <p className="text-muted-foreground leading-relaxed">{assistResult.suggestion}</p>
                  {assistResult.field_fixes && Object.keys(assistResult.field_fixes).length > 0 && (
                    <div className="mt-2">
                      <p className="font-semibold mb-1">Field Fixes:</p>
                      {Object.entries(assistResult.field_fixes).map(([k, v]) => (
                        <div key={k} className="flex justify-between py-0.5 border-b last:border-0">
                          <span className="text-muted-foreground font-mono">{k}</span>
                          <span className="font-medium">{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

            {/* Diff */}
            <TabsContent value="diff" className="flex flex-col flex-1 overflow-auto p-3 mt-0 gap-2">
              <p className="text-xs text-muted-foreground">Perubahan dari data AI asli:</p>
              {rows.filter(r => r._has_edit).length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Belum ada perubahan</p>
              ) : (
                <div className="space-y-2">
                  {rows.filter(r => r._has_edit).slice(0, 20).map(r => (
                    <div key={r.row_id} className="rounded border bg-muted/20 p-2 text-xs">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-muted-foreground font-mono">#{(r.row_id ?? 0) + 1}</span>
                        <span className="text-amber-600">{r._edit_count} edit</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Info */}
            <TabsContent value="info" className="flex flex-col flex-1 overflow-auto p-3 mt-0 gap-2">
              <div className="space-y-2 text-xs">
                <div><span className="text-muted-foreground">Source: </span><span className="font-medium">{session.source_type || '-'}</span></div>
                <div><span className="text-muted-foreground">Platform: </span><span className="font-medium">{session.detected_platform || '-'}</span></div>
                <div><span className="text-muted-foreground">Oleh: </span><span className="font-medium">{session.created_by}</span></div>
                {(session.schema_warnings || []).length > 0 && (
                  <div className="rounded border-l-2 border-amber-500 bg-amber-50/50 dark:bg-amber-900/10 p-2">
                    <p className="font-semibold text-amber-700 dark:text-amber-300 mb-1">⚠️ Schema Warnings:</p>
                    {session.schema_warnings.map((w, i) => (
                      <p key={i} className="text-muted-foreground">{w}</p>
                    ))}
                  </div>
                )}
                <div>
                  <p className="font-semibold mb-1">Column Mappings ({(session.column_mappings || []).length}):</p>
                  <div className="space-y-0.5">
                    {(session.column_mappings || []).slice(0, 15).map((m, i) => (
                      <div key={i} className="flex justify-between gap-2">
                        <span className="text-muted-foreground font-mono text-[10px] truncate max-w-[100px]">{m.source_column}</span>
                        <span className="text-[10px] font-medium truncate">{m.canonical_field}</span>
                        <span className={`text-[10px] tabular-nums flex-shrink-0 ${
                          (m.confidence || 0) >= 0.9 ? 'text-emerald-600' :
                          (m.confidence || 0) >= 0.7 ? 'text-amber-600' : 'text-red-600'
                        }`}>{((m.confidence || 0) * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Status Bar */}
      <div className="flex items-center gap-4 px-4 py-1 border-t bg-muted/20 text-xs text-muted-foreground flex-shrink-0">
        <span>{filteredRows.length} baris</span>
        <span className="flex-1" />
        <span>WS: <span className={wsStatus === 'connected' ? 'text-emerald-600' : 'text-red-600'}>{wsStatus}</span></span>
        {Object.keys(rowLocks).length > 0 && (
          <span><Lock size={10} className="inline mr-0.5" />{Object.keys(rowLocks).length} terkunci</span>
        )}
      </div>

      {/* Commit Dialog */}
      <AlertDialog open={commitDialog} onOpenChange={setCommitDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Commit Data ke Database?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{(cs.high || 0) + (cs.medium || 0) + (cs.low || 0)}</strong> baris akan dicommit ke koleksi database yang sesuai.
              Anda bisa rollback setelahnya jika ada kesalahan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={handleCommit} data-testid="btn-confirm-commit">
              <CheckCircle2 size={14} className="mr-1" /> Commit Sekarang
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rollback Dialog */}
      <AlertDialog open={rollbackDialog} onOpenChange={setRollbackDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rollback Data?</AlertDialogTitle>
            <AlertDialogDescription>
              Semua data yang di-commit dari session ini akan DIHAPUS dari database.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={handleRollback}
              className="bg-destructive text-destructive-foreground"
              data-testid="btn-confirm-rollback"
            >
              <RotateCcw size={14} className="mr-1" /> Rollback
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
