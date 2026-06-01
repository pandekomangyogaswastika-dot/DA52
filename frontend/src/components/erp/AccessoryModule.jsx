/**
 * Aksesoris Management — Full Implementation (Blueprint §3.3)
 * Tabs:
 *   1. Master & Stok   — CRUD + stock levels + alerts
 *   2. Request Internal — divisi → Admin Aksesoris
 *   3. Stok Opname      — sesi count fisik + adjustment
 *   4. Peminjaman       — borrow & return tracking
 *   5. Purchase Request — PR ke Finance
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Package, Plus, Edit2, Trash2, Search, X, CheckCircle, Clock,
  AlertTriangle, TrendingDown, FileText, RotateCcw, ShoppingCart,
  ChevronDown, ChevronUp, RefreshCw, Eye, Check, XCircle,  ArrowUpCircle, ArrowDownCircle, ClipboardCheck, Banknote,
  PackageMinus, PackagePlus, Info, BarChart3
} from 'lucide-react';
import { EmptyState } from './EmptyState';
import { Skeleton } from '@/components/ui/skeleton';

const API = process.env.REACT_APP_BACKEND_URL || '';

const DIVISI = ['Produksi', 'Cutting', 'CMT', 'Gudang', 'Kantor', 'SDM', 'QC', 'Packing', 'Marketing', 'Lainnya'];
const UNITS  = ['pcs', 'meter', 'roll', 'yard', 'kg', 'set', 'lembar', 'buah'];
const STATUS_COLOR = {
  ok:      'text-emerald-400 bg-emerald-500/10',
  low:     'text-amber-400 bg-amber-500/10',
  out:     'text-red-400 bg-red-500/10',
  Pending:   'text-amber-400 bg-amber-500/10',
  Approved:  'text-sky-400 bg-sky-500/10',
  Rejected:  'text-red-400 bg-red-500/10',
  Issued:    'text-emerald-400 bg-emerald-500/10',
  Active:    'text-sky-400 bg-sky-500/10',
  Returned:  'text-emerald-400 bg-emerald-500/10',
  Overdue:   'text-red-400 bg-red-500/10',
  Draft:     'text-slate-400 bg-slate-500/10',
  Submitted: 'text-amber-400 bg-amber-500/10',
  Completed: 'text-emerald-400 bg-emerald-500/10',
  Cancelled: 'text-slate-400 bg-slate-500/10',
  Ordered:   'text-violet-400 bg-violet-500/10',
  Received:  'text-emerald-400 bg-emerald-500/10',
};

function Badge({ status, label }) {
  const cls = STATUS_COLOR[status] || 'text-muted-foreground bg-secondary';
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{label || status}</span>;
}

function fmtDate(iso) {
  if (!iso) return '-';
  try { return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return iso?.slice(0, 10) || '-'; }
}

function fmtNum(n) { return Number(n || 0).toLocaleString('id-ID'); }

async function api(method, path, token, body) {
  const opts = { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${API}${path}`, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`);
  return data;
}

// ─── TAB 1: MASTER & STOK ────────────────────────────────────────────────────
function MasterTab({ token, onRefreshDash }) {
  const [items, setItems]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [catFilter, setCat]     = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm]         = useState({ code:'', name:'', category:'Umum', unit:'pcs', description:'', min_stock:0, supplier:'', notes:'', pack_unit:'pack', pack_size:1, display_in_packs:false });
  const [showMove, setShowMove] = useState(null); // {id, name, action:'in'|'out'}
  const [moveForm, setMoveForm] = useState({ qty:'', notes:'', input_unit:'base' });
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (catFilter) params.set('category', catFilter);
      const data = await api('GET', `/api/acc/items?${params}`, token);
      setItems(Array.isArray(data) ? data : []);
    } catch(e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [token, search, catFilter]);

  useEffect(() => { load(); }, [load]);

  const cats = [...new Set(items.map(i => i.category).filter(Boolean))];

  const openAdd = () => { setEditItem(null); setForm({ code:'', name:'', category:'Umum', unit:'pcs', description:'', min_stock:0, supplier:'', notes:'', pack_unit:'pack', pack_size:1, display_in_packs:false }); setShowForm(true); };
  const openEdit = it => { setEditItem(it); setForm({ code: it.code||'', name: it.name||'', category: it.category||'Umum', unit: it.unit||'pcs', description: it.description||'', min_stock: it.min_stock||0, supplier: it.supplier||'', notes: it.notes||'', pack_unit: it.pack_unit||'pack', pack_size: it.pack_size||1, display_in_packs: it.display_in_packs||false }); setShowForm(true); };

  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true); setErr('');
    try {
      if (editItem) await api('PUT', `/api/acc/items/${editItem.id}`, token, form);
      else          await api('POST', '/api/acc/items', token, form);
      setShowForm(false); load(); onRefreshDash();
    } catch(e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const del = async it => {
    if (!window.confirm(`Hapus ${it.name}?`)) return;
    try { await api('DELETE', `/api/acc/items/${it.id}`, token); load(); onRefreshDash(); }
    catch(e) { alert(e.message); }
  };

  const doMove = async () => {
    const qty = parseFloat(moveForm.qty);
    if (!qty || qty <= 0) { setErr('Qty harus > 0'); return; }
    setSaving(true); setErr('');
    try {
      const path = showMove.action === 'in' ? '/api/acc/stock/receive' : '/api/acc/stock/issue';
      await api('POST', path, token, { acc_id: showMove.id, qty, notes: moveForm.notes, input_unit: moveForm.input_unit });
      setShowMove(null); setMoveForm({ qty:'', notes:'', input_unit:'base' }); load(); onRefreshDash();
    } catch(e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const lowCount = items.filter(i => i.stock_status === 'low').length;
  const outCount = items.filter(i => i.stock_status === 'out').length;

  return (
    <div className="space-y-5">
      {/* Stat Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label:'Total Item', val: items.length, icon: Package, color:'violet' },
          { label:'Stok Aman', val: items.filter(i=>i.stock_status==='ok').length, icon: CheckCircle, color:'emerald' },
          { label:'Stok Rendah', val: lowCount, icon: AlertTriangle, color:'amber' },
          { label:'Habis', val: outCount, icon: TrendingDown, color:'red' },
        ].map(s => (
          <div key={s.label} className={`bg-${s.color}-500/5 border border-${s.color}-500/20 rounded-xl p-3`}>
            <div className="flex items-center gap-2 mb-1">
              <s.icon className={`w-4 h-4 text-${s.color}-400`} />
              <span className="text-xs text-muted-foreground">{s.label}</span>
            </div>
            <div className={`text-2xl font-bold text-${s.color}-400`}>{s.val}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 border border-border rounded-lg px-3 py-2 bg-[var(--card-surface)] flex-1 min-w-48">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Cari aksesoris..." className="flex-1 bg-transparent text-sm focus:outline-none" data-testid="acc-search" />
          {search && <button onClick={()=>setSearch('')}><X className="w-4 h-4 text-muted-foreground" /></button>}
        </div>
        <select value={catFilter} onChange={e=>setCat(e.target.value)} className="border border-border rounded-lg px-3 py-2 bg-[var(--card-surface)] text-sm" data-testid="acc-cat-filter">
          <option value="">Semua Kategori</option>
          {cats.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
        <button onClick={load} className="p-2 border border-border rounded-lg hover:bg-white/5"><RefreshCw className="w-4 h-4" /></button>
        <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:brightness-110" data-testid="add-acc-btn">
          <Plus className="w-4 h-4" /> Tambah Aksesoris
        </button>
      </div>

      {err && <div className="text-sm text-red-400 bg-red-500/10 rounded-lg px-4 py-2">{err}</div>}

      {/* Table */}
      <div className="bg-[var(--card-surface)] rounded-xl border border-border overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead className="bg-[var(--glass-bg)] border-b border-border">
            <tr>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">Kode</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">Nama</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">Kategori</th>
              <th className="text-right px-4 py-3 text-muted-foreground font-medium">Stok</th>
              <th className="text-right px-4 py-3 text-muted-foreground font-medium">Min</th>
              <th className="text-center px-4 py-3 text-muted-foreground font-medium">Status</th>
              <th className="text-right px-4 py-3 text-muted-foreground font-medium">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>{[...Array(7)].map((__, j) => <td key={j} className="px-3 py-2.5"><Skeleton className="h-4" /></td>)}</tr>
              ))
            ) : items.length === 0 ? (
              <tr><td colSpan="7">
                <EmptyState icon={Package} title="Belum ada item aksesoris" description="Tambah item pertama untuk mulai mengelola stok aksesoris." />
              </td></tr>
            ) : items.map(it => (
              <tr key={it.id} className="border-b border-border hover:bg-white/2" data-testid={`acc-row-${it.id}`}>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{it.code}</td>
                <td className="px-4 py-3 font-medium">{it.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{it.category}</td>
                <td className="px-4 py-3 text-right font-medium">
                  {it.display_in_packs ? (
                    <div>
                      <div>{fmtNum(it.stock_qty_in_packs)} {it.pack_unit}</div>
                      <div className="text-xs text-muted-foreground">({fmtNum(it.stock_qty)} {it.unit})</div>
                    </div>
                  ) : (
                    <>{fmtNum(it.stock_qty)} <span className="text-xs text-muted-foreground">{it.unit}</span></>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-muted-foreground text-xs">
                  {it.display_in_packs ? (
                    <>{fmtNum(it.min_stock_in_packs)} {it.pack_unit}</>
                  ) : (
                    <>{fmtNum(it.min_stock)}</>
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  <Badge status={it.stock_status} label={it.stock_status==='ok'?'Aman':it.stock_status==='low'?'Rendah':'Habis'} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={()=>{const item=items.find(x=>x.id===it.id); setShowMove({id:it.id,name:it.name,action:'in',unit:item?.unit,pack_unit:item?.pack_unit,pack_size:item?.pack_size,display_in_packs:item?.display_in_packs}); setMoveForm({qty:'',notes:'',input_unit:'base'}); setErr('');}}
                      className="p-1 hover:bg-emerald-500/10 rounded" title="Terima Stok" data-testid={`acc-in-${it.id}`}>
                      <PackagePlus className="w-4 h-4 text-emerald-400" />
                    </button>
                    <button onClick={()=>{const item=items.find(x=>x.id===it.id); setShowMove({id:it.id,name:it.name,action:'out',unit:item?.unit,pack_unit:item?.pack_unit,pack_size:item?.pack_size,display_in_packs:item?.display_in_packs}); setMoveForm({qty:'',notes:'',input_unit:'base'}); setErr('');}}
                      className="p-1 hover:bg-amber-500/10 rounded" title="Keluarkan Stok" data-testid={`acc-out-${it.id}`}>
                      <PackageMinus className="w-4 h-4 text-amber-400" />
                    </button>
                    <button onClick={()=>openEdit(it)} className="p-1 hover:bg-white/5 rounded" data-testid={`edit-acc-${it.id}`}><Edit2 className="w-4 h-4 text-muted-foreground" /></button>
                    <button onClick={()=>del(it)} className="p-1 hover:bg-red-500/10 rounded" data-testid={`del-acc-${it.id}`}><Trash2 className="w-4 h-4 text-red-400" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={()=>setShowForm(false)}>
          <div className="bg-[var(--card-surface)] rounded-2xl shadow-xl w-full max-w-md p-6" onClick={e=>e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">{editItem ? 'Edit Aksesoris' : 'Tambah Aksesoris'}</h3>
            <div className="space-y-3">
              {[
                {label:'Kode', key:'code', placeholder:'ACC-001'},
                {label:'Nama *', key:'name', placeholder:'Kancing'},
                {label:'Kategori', key:'category', placeholder:'Trimming'},
                {label:'Supplier', key:'supplier', placeholder:'CV. Supplier'},
              ].map(f => (
                <div key={f.key}>
                  <label className="text-xs text-muted-foreground block mb-1">{f.label}</label>
                  <input value={form[f.key]||''} onChange={e=>setForm({...form,[f.key]:e.target.value})}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-[var(--card-surface)]" placeholder={f.placeholder} />
                </div>
              ))}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Unit</label>
                  <select value={form.unit} onChange={e=>setForm({...form,unit:e.target.value})} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-[var(--card-surface)]">
                    {UNITS.map(u=><option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Stok Minimum</label>
                  <input type="number" min="0" value={form.min_stock} onChange={e=>setForm({...form,min_stock:e.target.value})}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-[var(--card-surface)]" />
                </div>
              </div>
              
              {/* NEW: Pack/Packaging Fields */}
              <div className="border-t border-border pt-3 mt-3">
                <div className="flex items-center gap-2 mb-3">
                  <input type="checkbox" id="display_in_packs" checked={form.display_in_packs} 
                    onChange={e => setForm({...form, display_in_packs: e.target.checked})}
                    className="w-4 h-4" />
                  <label htmlFor="display_in_packs" className="text-sm">Item ini dijual/disimpan per kemasan</label>
                </div>
                
                {form.display_in_packs && (
                  <div className="grid grid-cols-2 gap-3 pl-6">
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">Satuan Kemasan</label>
                      <select value={form.pack_unit} onChange={e=>setForm({...form,pack_unit:e.target.value})} 
                        className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-[var(--card-surface)]">
                        <option value="pack">Pack</option>
                        <option value="box">Box</option>
                        <option value="karton">Karton</option>
                        <option value="bundle">Bundle</option>
                        <option value="rol">Rol/Gulungan</option>
                        <option value="bal">Bal</option>
                        <option value="sak">Sak</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">Isi per {form.pack_unit}</label>
                      <input type="number" min="1" step="0.01" value={form.pack_size} 
                        onChange={e=>setForm({...form,pack_size:parseFloat(e.target.value)||1})}
                        className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-[var(--card-surface)]" 
                        placeholder="50" />
                    </div>
                    <div className="col-span-2">
                      <small className="text-xs text-muted-foreground">
                        1 {form.pack_unit} = {form.pack_size} {form.unit}
                      </small>
                    </div>
                  </div>
                )}
              </div>
              
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Catatan</label>
                <textarea value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} rows="2"
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-[var(--card-surface)] resize-none" />
              </div>
              {err && <div className="text-xs text-red-400">{err}</div>}
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={()=>setShowForm(false)} className="flex-1 py-2 border border-border rounded-lg text-sm hover:bg-white/5">Batal</button>
              <button onClick={save} disabled={!form.name||saving} className="flex-1 py-2 bg-primary text-white rounded-lg text-sm hover:brightness-110 disabled:opacity-50" data-testid="save-acc-btn">
                {saving ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Move Modal */}
      {showMove && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={()=>setShowMove(null)}>
          <div className="bg-[var(--card-surface)] rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={e=>e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1">
              {showMove.action === 'in' ? 'Terima Stok Masuk' : 'Keluarkan Stok'}
            </h3>
            <p className="text-sm text-muted-foreground mb-4">{showMove.name}</p>
            <div className="space-y-3">
              {showMove.display_in_packs && (
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Satuan Input</label>
                  <select value={moveForm.input_unit} onChange={e=>setMoveForm({...moveForm,input_unit:e.target.value})}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-[var(--card-surface)]">
                    <option value="base">Dalam {showMove.unit}</option>
                    <option value="pack">Dalam {showMove.pack_unit} (1 {showMove.pack_unit} = {showMove.pack_size} {showMove.unit})</option>
                  </select>
                </div>
              )}
              <div>
                <label className="text-xs text-muted-foreground block mb-1">
                  Jumlah ({moveForm.input_unit === 'pack' && showMove.display_in_packs ? showMove.pack_unit : showMove.unit}) *
                </label>
                <input type="number" min="0.01" step="0.01" value={moveForm.qty} onChange={e=>setMoveForm({...moveForm,qty:e.target.value})}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-[var(--card-surface)]" placeholder="0" data-testid="move-qty-input" />
                {moveForm.input_unit === 'pack' && showMove.display_in_packs && moveForm.qty && (
                  <small className="text-xs text-muted-foreground">= {(parseFloat(moveForm.qty) * showMove.pack_size).toFixed(2)} {showMove.unit}</small>
                )}
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Catatan</label>
                <input value={moveForm.notes} onChange={e=>setMoveForm({...moveForm,notes:e.target.value})}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-[var(--card-surface)]" placeholder="Keterangan..." />
              </div>
              {err && <div className="text-xs text-red-400">{err}</div>}
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={()=>setShowMove(null)} className="flex-1 py-2 border border-border rounded-lg text-sm hover:bg-white/5">Batal</button>
              <button onClick={doMove} disabled={saving}
                className={`flex-1 py-2 text-white rounded-lg text-sm hover:brightness-110 disabled:opacity-50 ${showMove.action==='in'?'bg-emerald-600':'bg-amber-600'}`}
                data-testid="confirm-move-btn">
                {saving ? 'Memproses...' : showMove.action==='in' ? 'Terima' : 'Keluarkan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TAB 2: REQUEST INTERNAL ─────────────────────────────────────────────────
function RequestInternalTab({ token, items }) {
  const [requests, setReqs]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShow]   = useState(false);
  const [form, setForm]       = useState({ divisi:'', requester_name:'', purpose:'', needed_by:'', items:[] });
  const [lines, setLines]     = useState([{ acc_id:'', qty_requested:1, unit:'pcs', notes:'' }]);
  const [detail, setDetail]   = useState(null);
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState('');
  const [statusFilter, setStatusF] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = statusFilter ? `?status=${statusFilter}` : '';
      const data = await api('GET', `/api/acc/internal-requests${params}`, token);
      setReqs(Array.isArray(data) ? data : []);
    } catch(e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [token, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const addLine = () => setLines([...lines, { acc_id:'', qty_requested:1, unit:'pcs', notes:'' }]);
  const removeLine = idx => setLines(lines.filter((_,i)=>i!==idx));
  const updateLine = (idx, key, val) => setLines(lines.map((l,i)=>i===idx?{...l,[key]:val}:l));

  const lineChange = (idx, acc_id) => {
    const acc = items.find(a=>a.id===acc_id);
    updateLine(idx, 'acc_id', acc_id);
    if (acc) {
      setLines(prev => prev.map((l,i)=>i===idx ? {...l, acc_id, acc_name:acc.name, acc_code:acc.code, unit:acc.unit} : l));
    }
  };

  const submit = async () => {
    if (!form.divisi) { setErr('Divisi wajib dipilih'); return; }
    const validLines = lines.filter(l=>l.acc_id && l.qty_requested>0);
    if (validLines.length === 0) { setErr('Minimal 1 item'); return; }
    setSaving(true); setErr('');
    try {
      await api('POST', '/api/acc/internal-requests', token, { ...form, items: validLines });
      setShow(false); setLines([{ acc_id:'', qty_requested:1, unit:'pcs', notes:'' }]);
      setForm({ divisi:'', requester_name:'', purpose:'', needed_by:'', items:[] });
      load();
    } catch(e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const updateStatus = async (id, status, notes='') => {
    try {
      await api('PUT', `/api/acc/internal-requests/${id}`, token, { status, admin_notes: notes });
      load();
      if (detail?.id === id) setDetail(null);
    } catch(e) { alert(e.message); }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-2">
          <select value={statusFilter} onChange={e=>setStatusF(e.target.value)} className="border border-border rounded-lg px-3 py-2 bg-[var(--card-surface)] text-sm">
            <option value="">Semua Status</option>
            {['Pending','Approved','Rejected','Issued'].map(s=><option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={load} className="p-2 border border-border rounded-lg hover:bg-white/5"><RefreshCw className="w-4 h-4" /></button>
        </div>
        <button onClick={()=>{setShow(true);setErr('');}} className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:brightness-110" data-testid="add-int-req-btn">
          <Plus className="w-4 h-4" /> Buat Request
        </button>
      </div>

      {err && <div className="text-sm text-red-400 bg-red-500/10 rounded-lg px-4 py-2">{err}</div>}

      <div className="bg-[var(--card-surface)] rounded-xl border border-border overflow-x-auto">
        <table className="w-full text-sm min-w-[650px]">
          <thead className="bg-[var(--glass-bg)] border-b border-border">
            <tr>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">No. Request</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">Divisi</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">Pemohon</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">Keperluan</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">Tgl Butuh</th>
              <th className="text-center px-4 py-3 text-muted-foreground font-medium">Status</th>
              <th className="text-right px-4 py-3 text-muted-foreground font-medium">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>{[...Array(7)].map((__, j) => <td key={j} className="px-3 py-2.5"><Skeleton className="h-4" /></td>)}</tr>
            )) : requests.length === 0 ? <tr><td colSpan="7"><EmptyState icon={FileText} title="Belum ada request internal" description="Request dari divisi akan muncul di sini." /></td></tr>
            : requests.map(r => (
              <tr key={r.id} className="border-b border-border hover:bg-white/2" data-testid={`req-row-${r.id}`}>
                <td className="px-4 py-3 font-mono text-xs">{r.request_number}</td>
                <td className="px-4 py-3">{r.divisi}</td>
                <td className="px-4 py-3 text-muted-foreground">{r.requester_name}</td>
                <td className="px-4 py-3 text-muted-foreground max-w-xs truncate">{r.purpose || '-'}</td>
                <td className="px-4 py-3 text-muted-foreground text-xs">{fmtDate(r.needed_by)}</td>
                <td className="px-4 py-3 text-center"><Badge status={r.status} /></td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={()=>setDetail(r)} className="p-1 hover:bg-white/5 rounded" title="Detail" data-testid={`view-req-${r.id}`}>
                      <Eye className="w-4 h-4 text-muted-foreground" />
                    </button>
                    {r.status === 'Pending' && (
                      <>
                        <button onClick={()=>updateStatus(r.id,'Approved')} className="p-1 hover:bg-emerald-500/10 rounded" title="Setujui" data-testid={`approve-req-${r.id}`}>
                          <Check className="w-4 h-4 text-emerald-400" />
                        </button>
                        <button onClick={()=>updateStatus(r.id,'Rejected')} className="p-1 hover:bg-red-500/10 rounded" title="Tolak">
                          <XCircle className="w-4 h-4 text-red-400" />
                        </button>
                      </>
                    )}
                    {r.status === 'Approved' && (
                      <button onClick={()=>updateStatus(r.id,'Issued')} className="p-1 hover:bg-sky-500/10 rounded" title="Issue / Keluarkan" data-testid={`issue-req-${r.id}`}>
                        <ArrowDownCircle className="w-4 h-4 text-sky-400" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detail Panel */}
      {detail && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={()=>setDetail(null)}>
          <div className="bg-[var(--card-surface)] rounded-2xl shadow-xl w-full max-w-lg p-6" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">{detail.request_number}</h3>
              <Badge status={detail.status} />
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
              <div><span className="text-muted-foreground">Divisi:</span> <span className="font-medium ml-1">{detail.divisi}</span></div>
              <div><span className="text-muted-foreground">Pemohon:</span> <span className="font-medium ml-1">{detail.requester_name}</span></div>
              <div><span className="text-muted-foreground">Keperluan:</span> <span className="font-medium ml-1">{detail.purpose||'-'}</span></div>
              <div><span className="text-muted-foreground">Tgl Butuh:</span> <span className="font-medium ml-1">{fmtDate(detail.needed_by)}</span></div>
            </div>
            <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Item yang diminta:</p>
            <div className="space-y-1 mb-4">
              {(detail.items||[]).map((it,i)=>(
                <div key={i} className="flex items-center justify-between text-sm bg-white/3 rounded-lg px-3 py-2">
                  <span>{it.acc_name || it.acc_id}</span>
                  <span className="font-medium">{it.qty_requested} {it.unit}</span>
                </div>
              ))}
            </div>
            {detail.admin_notes && <p className="text-xs text-muted-foreground">Catatan admin: {detail.admin_notes}</p>}
            <button onClick={()=>setDetail(null)} className="mt-4 w-full py-2 border border-border rounded-lg text-sm hover:bg-white/5">Tutup</button>
          </div>
        </div>
      )}

      {/* Create Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={()=>setShow(false)}>
          <div className="bg-[var(--card-surface)] rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto" onClick={e=>e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">Buat Request Internal</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Divisi *</label>
                  <select value={form.divisi} onChange={e=>setForm({...form,divisi:e.target.value})} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-[var(--card-surface)]" data-testid="req-divisi">
                    <option value="">Pilih...</option>
                    {DIVISI.map(d=><option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Nama Pemohon</label>
                  <input value={form.requester_name} onChange={e=>setForm({...form,requester_name:e.target.value})} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-[var(--card-surface)]" placeholder="Nama..." />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Keperluan</label>
                  <input value={form.purpose} onChange={e=>setForm({...form,purpose:e.target.value})} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-[var(--card-surface)]" placeholder="Untuk apa..." />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Dibutuhkan Tgl</label>
                  <input type="date" value={form.needed_by} onChange={e=>setForm({...form,needed_by:e.target.value})} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-[var(--card-surface)]" />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Item yang Diminta</label>
                  <button onClick={addLine} className="text-xs text-primary flex items-center gap-1 hover:underline"><Plus className="w-3 h-3" /> Tambah</button>
                </div>
                {lines.map((ln,i) => (
                  <div key={i} className="flex items-center gap-2 mb-2">
                    <select value={ln.acc_id} onChange={e=>lineChange(i,e.target.value)} className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-[var(--card-surface)]" data-testid={`req-item-${i}`}>
                      <option value="">Pilih item...</option>
                      {items.map(a=><option key={a.id} value={a.id}>{a.name} (stok: {a.stock_qty} {a.unit})</option>)}
                    </select>
                    <input type="number" min="1" value={ln.qty_requested} onChange={e=>updateLine(i,'qty_requested',+e.target.value)}
                      className="w-16 border border-border rounded-lg px-2 py-1.5 text-xs bg-[var(--card-surface)]" placeholder="Qty" />
                    <span className="text-xs text-muted-foreground w-8">{ln.unit}</span>
                    {lines.length > 1 && <button onClick={()=>removeLine(i)}><X className="w-4 h-4 text-muted-foreground hover:text-red-400" /></button>}
                  </div>
                ))}
              </div>
              {err && <div className="text-xs text-red-400">{err}</div>}
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={()=>setShow(false)} className="flex-1 py-2 border border-border rounded-lg text-sm hover:bg-white/5">Batal</button>
              <button onClick={submit} disabled={saving} className="flex-1 py-2 bg-primary text-white rounded-lg text-sm hover:brightness-110 disabled:opacity-50" data-testid="submit-int-req-btn">
                {saving ? 'Mengirim...' : 'Kirim Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TAB 3: STOK OPNAME ─────────────────────────────────────────────────────
function StokOpnameTab({ token }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [active, setActive]     = useState(null);
  const [lines, setLines]       = useState([]);
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api('GET', '/api/acc/opname', token);
      setSessions(Array.isArray(data) ? data : []);
    } catch(e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const openSession = async (s) => {
    try {
      const detail = await api('GET', `/api/acc/opname/${s.id}`, token);
      setActive(detail);
      setLines(detail.lines || []);
    } catch(e) { alert(e.message); }
  };

  const startOpname = async () => {
    setSaving(true); setErr('');
    try {
      const session = await api('POST', '/api/acc/opname', token, { notes: 'Opname manual' });
      setActive(session);
      setLines(session.lines || []);
      load();
    } catch(e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const updateCount = async (line, val) => {
    try {
      await api('PUT', `/api/acc/opname/${active.id}/count`, token, {
        acc_id: line.acc_id, counted_qty: parseFloat(val), notes: ''
      });
      setLines(prev => prev.map(l => l.acc_id === line.acc_id ? {...l, counted_qty: parseFloat(val), diff: parseFloat(val) - parseFloat(l.system_qty)} : l));
    } catch(e) { alert(e.message); }
  };

  const finalize = async () => {
    if (!window.confirm('Finalisasi opname? Selisih stok akan di-adjust otomatis.')) return;
    setSaving(true);
    try {
      await api('POST', `/api/acc/opname/${active.id}/complete`, token, {});
      setActive(null); setLines([]); load();
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const cancel = async () => {
    if (!window.confirm('Batalkan sesi opname ini?')) return;
    try {
      await api('POST', `/api/acc/opname/${active.id}/cancel`, token, {});
      setActive(null); setLines([]); load();
    } catch(e) { alert(e.message); }
  };

  if (active) return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-lg">{active.ref_number}</h3>
          <p className="text-sm text-muted-foreground">{active.counted_items || 0}/{active.total_items} item sudah dihitung</p>
        </div>
        <div className="flex gap-2">
          <button onClick={cancel} className="px-3 py-1.5 border border-border rounded-lg text-sm hover:bg-white/5">Batalkan</button>
          <button onClick={finalize} disabled={saving} className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-sm hover:brightness-110 disabled:opacity-50" data-testid="finalize-opname-btn">
            {saving ? 'Memproses...' : 'Finalisasi & Adjust'}
          </button>
        </div>
      </div>
      <div className="bg-[var(--card-surface)] rounded-xl border border-border overflow-x-auto">
        <table className="w-full text-sm min-w-[600px]">
          <thead className="bg-[var(--glass-bg)] border-b border-border">
            <tr>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">Kode</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">Nama</th>
              <th className="text-right px-4 py-3 text-muted-foreground font-medium">Stok Sistem</th>
              <th className="text-right px-4 py-3 text-muted-foreground font-medium">Jumlah Fisik</th>
              <th className="text-right px-4 py-3 text-muted-foreground font-medium">Selisih</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(ln => (
              <tr key={ln.acc_id} className={`border-b border-border ${ln.diff !== null && ln.diff !== 0 ? 'bg-amber-500/5' : ''}`}>
                <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{ln.acc_code}</td>
                <td className="px-4 py-2">{ln.acc_name}</td>
                <td className="px-4 py-2 text-right font-medium">{fmtNum(ln.system_qty)} <span className="text-xs text-muted-foreground">{ln.unit}</span></td>
                <td className="px-4 py-2 text-right">
                  <input type="number" min="0" step="0.01"
                    defaultValue={ln.counted_qty ?? ''}
                    onBlur={e => { if(e.target.value !== '') updateCount(ln, e.target.value); }}
                    className="w-24 border border-border rounded px-2 py-1 text-sm bg-[var(--card-surface)] text-right" placeholder="Hitung..."
                    data-testid={`opname-count-${ln.acc_id}`} />
                </td>
                <td className={`px-4 py-2 text-right font-medium ${ln.diff > 0 ? 'text-emerald-400' : ln.diff < 0 ? 'text-red-400' : 'text-muted-foreground'}`}>
                  {ln.diff !== null ? (ln.diff > 0 ? `+${fmtNum(ln.diff)}` : fmtNum(ln.diff)) : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Sesi Stok Opname</h3>
          <p className="text-sm text-muted-foreground">Hitung fisik stok dan auto-adjust selisih</p>
        </div>
        <button onClick={startOpname} disabled={saving || sessions.some(s=>s.status==='Active')} className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm hover:brightness-110 disabled:opacity-50" data-testid="start-opname-btn">
          <ClipboardCheck className="w-4 h-4" /> Mulai Opname Baru
        </button>
      </div>
      {err && <div className="text-sm text-red-400 bg-red-500/10 rounded-lg px-4 py-2">{err}</div>}

      <div className="space-y-3">
        {loading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
        ) : sessions.length === 0 ? <EmptyState icon={ClipboardCheck} title="Belum ada sesi opname" description="Buat sesi baru untuk mulai menghitung stok fisik aksesoris." />
        : sessions.map(s => (
          <div key={s.id} className="bg-[var(--card-surface)] border border-border rounded-xl p-4 flex items-center justify-between gap-4">
            <div>
              <div className="font-medium flex items-center gap-2">
                {s.ref_number}
                <Badge status={s.status} />
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Oleh {s.started_by} · {fmtDate(s.started_at)} · {s.counted_items}/{s.total_items} item
              </div>
            </div>
            {s.status === 'Active' && (
              <button onClick={()=>openSession(s)} className="px-3 py-1.5 bg-primary/10 text-primary rounded-lg text-sm hover:bg-primary/20" data-testid={`open-opname-${s.id}`}>
                Lanjutkan
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── TAB 4: PEMINJAMAN ───────────────────────────────────────────────────────
function PeminjamanTab({ token, items }) {
  const [loans, setLoans]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShow]   = useState(false);
  const [form, setForm]       = useState({ borrower_name:'', borrower_divisi:'', purpose:'', loan_date:'', expected_return_date:'', items:[] });
  const [lines, setLines]     = useState([{ acc_id:'', qty:1, unit:'pcs' }]);
  const [filter, setFilter]   = useState('Active');
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = filter ? `?status=${filter}` : '';
      const data = await api('GET', `/api/acc/loans${params}`, token);
      setLoans(Array.isArray(data) ? data : []);
    } catch(e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [token, filter]);

  useEffect(() => { load(); }, [load]);

  const addLine = () => setLines([...lines,{acc_id:'',qty:1,unit:'pcs'}]);
  const removeLine = idx => setLines(lines.filter((_,i)=>i!==idx));
  const updateLine = (idx, k, v) => setLines(lines.map((l,i)=>i===idx?{...l,[k]:v}:l));

  const lineChange = (idx, acc_id) => {
    const acc = items.find(a=>a.id===acc_id);
    setLines(prev => prev.map((l,i)=>i===idx ? {...l, acc_id, acc_name:acc?.name||'', unit:acc?.unit||'pcs'} : l));
  };

  const submit = async () => {
    if (!form.borrower_name) { setErr('Nama peminjam wajib diisi'); return; }
    const validLines = lines.filter(l=>l.acc_id && l.qty>0);
    if (!validLines.length) { setErr('Minimal 1 item'); return; }
    setSaving(true); setErr('');
    try {
      await api('POST', '/api/acc/loans', token, { ...form, items: validLines });
      setShow(false); setLines([{acc_id:'',qty:1,unit:'pcs'}]);
      setForm({ borrower_name:'', borrower_divisi:'', purpose:'', loan_date:'', expected_return_date:'', items:[] });
      load();
    } catch(e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const returnLoan = async (id) => {
    const notes = prompt('Catatan pengembalian (opsional):') ?? '';
    try { await api('PUT', `/api/acc/loans/${id}/return`, token, { return_notes: notes }); load(); }
    catch(e) { alert(e.message); }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-2">
          {['Active','Returned',''].map(s=>(
            <button key={s} onClick={()=>setFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-sm transition ${filter===s?'bg-primary text-white':'border border-border hover:bg-white/5'}`}>
              {s||'Semua'}
            </button>
          ))}
          <button onClick={load} className="p-2 border border-border rounded-lg hover:bg-white/5"><RefreshCw className="w-4 h-4" /></button>
        </div>
        <button onClick={()=>{setShow(true);setErr('');}} className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:brightness-110" data-testid="add-loan-btn">
          <Plus className="w-4 h-4" /> Catat Peminjaman
        </button>
      </div>

      {err && <div className="text-sm text-red-400 bg-red-500/10 rounded-lg px-4 py-2">{err}</div>}

      <div className="bg-[var(--card-surface)] rounded-xl border border-border overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead className="bg-[var(--glass-bg)] border-b border-border">
            <tr>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">No. Pinjam</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">Peminjam</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">Divisi</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">Item</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">Tgl Pinjam</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">Tgl Kembali</th>
              <th className="text-center px-4 py-3 text-muted-foreground font-medium">Status</th>
              <th className="text-right px-4 py-3 text-muted-foreground font-medium">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>{[...Array(8)].map((__, j) => <td key={j} className="px-3 py-2.5"><Skeleton className="h-4" /></td>)}</tr>
            )) : loans.length === 0 ? <tr><td colSpan="8"><EmptyState icon={RotateCcw} title="Belum ada peminjaman" description="Peminjaman aksesoris akan tercatat di sini." /></td></tr>
            : loans.map(l => (
              <tr key={l.id} className="border-b border-border hover:bg-white/2" data-testid={`loan-row-${l.id}`}>
                <td className="px-4 py-3 font-mono text-xs">{l.loan_number}</td>
                <td className="px-4 py-3 font-medium">{l.borrower_name}</td>
                <td className="px-4 py-3 text-muted-foreground">{l.borrower_divisi||'-'}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {(l.items||[]).map((it,i)=><div key={i}>{it.acc_name}: {it.qty} {it.unit}</div>)}
                </td>
                <td className="px-4 py-3 text-muted-foreground text-xs">{fmtDate(l.loan_date)}</td>
                <td className="px-4 py-3 text-muted-foreground text-xs">{fmtDate(l.expected_return_date)}</td>
                <td className="px-4 py-3 text-center"><Badge status={l.status} /></td>
                <td className="px-4 py-3 text-right">
                  {l.status === 'Active' && (
                    <button onClick={()=>returnLoan(l.id)} className="px-3 py-1 bg-emerald-600/10 text-emerald-400 rounded-lg text-xs hover:bg-emerald-600/20" data-testid={`return-loan-${l.id}`}>
                      Kembalikan
                    </button>
                  )}
                  {l.status === 'Returned' && <span className="text-xs text-muted-foreground">{fmtDate(l.returned_at)}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create Loan Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={()=>setShow(false)}>
          <div className="bg-[var(--card-surface)] rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto" onClick={e=>e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">Catat Peminjaman Aksesoris</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Nama Peminjam *</label>
                  <input value={form.borrower_name} onChange={e=>setForm({...form,borrower_name:e.target.value})} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-[var(--card-surface)]" placeholder="Nama..." data-testid="loan-borrower" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Divisi</label>
                  <select value={form.borrower_divisi} onChange={e=>setForm({...form,borrower_divisi:e.target.value})} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-[var(--card-surface)]">
                    <option value="">Pilih...</option>
                    {DIVISI.map(d=><option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Tgl Pinjam</label>
                  <input type="date" value={form.loan_date} onChange={e=>setForm({...form,loan_date:e.target.value})} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-[var(--card-surface)]" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Tgl Kembali (Rencana)</label>
                  <input type="date" value={form.expected_return_date} onChange={e=>setForm({...form,expected_return_date:e.target.value})} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-[var(--card-surface)]" />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Keperluan</label>
                <input value={form.purpose} onChange={e=>setForm({...form,purpose:e.target.value})} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-[var(--card-surface)]" placeholder="Untuk apa..." />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Item Dipinjam</label>
                  <button onClick={addLine} className="text-xs text-primary flex items-center gap-1 hover:underline"><Plus className="w-3 h-3" />Tambah</button>
                </div>
                {lines.map((ln,i)=>(
                  <div key={i} className="flex items-center gap-2 mb-2">
                    <select value={ln.acc_id} onChange={e=>lineChange(i,e.target.value)} className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-[var(--card-surface)]">
                      <option value="">Pilih item...</option>
                      {items.map(a=><option key={a.id} value={a.id}>{a.name} (stok: {a.stock_qty} {a.unit})</option>)}
                    </select>
                    <input type="number" min="1" value={ln.qty} onChange={e=>updateLine(i,'qty',+e.target.value)} className="w-16 border border-border rounded-lg px-2 py-1.5 text-xs bg-[var(--card-surface)]" />
                    <span className="text-xs text-muted-foreground w-8">{ln.unit}</span>
                    {lines.length>1 && <button onClick={()=>removeLine(i)}><X className="w-4 h-4 text-muted-foreground" /></button>}
                  </div>
                ))}
              </div>
              {err && <div className="text-xs text-red-400">{err}</div>}
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={()=>setShow(false)} className="flex-1 py-2 border border-border rounded-lg text-sm hover:bg-white/5">Batal</button>
              <button onClick={submit} disabled={saving} className="flex-1 py-2 bg-primary text-white rounded-lg text-sm hover:brightness-110 disabled:opacity-50" data-testid="save-loan-btn">
                {saving?'Menyimpan...':'Simpan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TAB 5: PURCHASE REQUEST ─────────────────────────────────────────────────
function PurchaseRequestTab({ token, items }) {
  const [prs, setPRs]         = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShow]   = useState(false);
  const [form, setForm]       = useState({ priority:'Normal', purpose:'', supplier:'', notes:'', items:[] });
  const [lines, setLines]     = useState([{ acc_id:'', qty_requested:1, unit:'pcs', estimated_price:0, notes:'' }]);
  const [filter, setFilter]   = useState('');
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = filter ? `?status=${filter}` : '';
      const data = await api('GET', `/api/acc/purchase-requests${params}`, token);
      setPRs(Array.isArray(data) ? data : []);
    } catch(e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [token, filter]);

  useEffect(() => { load(); }, [load]);

  const addLine = () => setLines([...lines,{acc_id:'',qty_requested:1,unit:'pcs',estimated_price:0,notes:''}]);
  const removeLine = idx => setLines(lines.filter((_,i)=>i!==idx));
  const updateLine = (idx,k,v) => setLines(lines.map((l,i)=>i===idx?{...l,[k]:v}:l));

  const lineChange = (idx, acc_id) => {
    const acc = items.find(a=>a.id===acc_id);
    setLines(prev => prev.map((l,i)=>i===idx ? {...l, acc_id, acc_name:acc?.name||'', unit:acc?.unit||'pcs'} : l));
  };

  const submit = async () => {
    const validLines = lines.filter(l=>l.acc_id && l.qty_requested>0);
    if (!validLines.length) { setErr('Minimal 1 item'); return; }
    setSaving(true); setErr('');
    try {
      await api('POST', '/api/acc/purchase-requests', token, { ...form, items: validLines });
      setShow(false); setLines([{acc_id:'',qty_requested:1,unit:'pcs',estimated_price:0,notes:''}]);
      setForm({ priority:'Normal', purpose:'', supplier:'', notes:'', items:[] });
      load();
    } catch(e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const updateStatus = async (id, status, notes='') => {
    try { await api('PUT', `/api/acc/purchase-requests/${id}`, token, { status, finance_notes: notes }); load(); }
    catch(e) { alert(e.message); }
  };

  const totalEst = lines.reduce((s,l)=>s + (parseFloat(l.qty_requested)||0)*(parseFloat(l.estimated_price)||0), 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-2">
          <select value={filter} onChange={e=>setFilter(e.target.value)} className="border border-border rounded-lg px-3 py-2 bg-[var(--card-surface)] text-sm">
            <option value="">Semua Status</option>
            {['Draft','Submitted','Approved','Rejected','Ordered','Received'].map(s=><option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={load} className="p-2 border border-border rounded-lg hover:bg-white/5"><RefreshCw className="w-4 h-4" /></button>
        </div>
        <button onClick={()=>{setShow(true);setErr('');}} className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:brightness-110" data-testid="add-pr-btn">
          <Plus className="w-4 h-4" /> Buat Purchase Request
        </button>
      </div>

      {err && <div className="text-sm text-red-400 bg-red-500/10 rounded-lg px-4 py-2">{err}</div>}

      <div className="bg-[var(--card-surface)] rounded-xl border border-border overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead className="bg-[var(--glass-bg)] border-b border-border">
            <tr>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">No. PR</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">Keperluan</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">Supplier</th>
              <th className="text-center px-4 py-3 text-muted-foreground font-medium">Prioritas</th>
              <th className="text-right px-4 py-3 text-muted-foreground font-medium">Est. Total</th>
              <th className="text-center px-4 py-3 text-muted-foreground font-medium">Status</th>
              <th className="text-right px-4 py-3 text-muted-foreground font-medium">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>{[...Array(7)].map((__, j) => <td key={j} className="px-3 py-2.5"><Skeleton className="h-4" /></td>)}</tr>
            )) : prs.length === 0 ? <tr><td colSpan="7"><EmptyState icon={ShoppingCart} title="Belum ada purchase request" description="Buat PR baru untuk mengajukan pengadaan aksesoris ke Finance." /></td></tr>
            : prs.map(pr => (
              <tr key={pr.id} className="border-b border-border hover:bg-white/2" data-testid={`pr-row-${pr.id}`}>
                <td className="px-4 py-3 font-mono text-xs">{pr.pr_number}</td>
                <td className="px-4 py-3 max-w-xs truncate">{pr.purpose||'-'}</td>
                <td className="px-4 py-3 text-muted-foreground">{pr.supplier||'-'}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${pr.priority==='Urgent'?'bg-red-500/10 text-red-400':pr.priority==='Low'?'bg-slate-500/10 text-slate-400':'bg-sky-500/10 text-sky-400'}`}>
                    {pr.priority}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-medium">Rp {fmtNum(pr.total_estimated)}</td>
                <td className="px-4 py-3 text-center"><Badge status={pr.status} /></td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {pr.status === 'Draft' && (
                      <button onClick={()=>updateStatus(pr.id,'Submitted')} className="px-2 py-1 bg-sky-600/10 text-sky-400 rounded text-xs hover:bg-sky-600/20" data-testid={`submit-pr-${pr.id}`}>Submit</button>
                    )}
                    {pr.status === 'Submitted' && (
                      <>
                        <button onClick={()=>updateStatus(pr.id,'Approved')} className="px-2 py-1 bg-emerald-600/10 text-emerald-400 rounded text-xs hover:bg-emerald-600/20" data-testid={`approve-pr-${pr.id}`}>Setujui</button>
                        <button onClick={()=>updateStatus(pr.id,'Rejected')} className="px-2 py-1 bg-red-600/10 text-red-400 rounded text-xs hover:bg-red-600/20">Tolak</button>
                      </>
                    )}
                    {pr.status === 'Approved' && (
                      <button onClick={()=>updateStatus(pr.id,'Ordered')} className="px-2 py-1 bg-violet-600/10 text-violet-400 rounded text-xs hover:bg-violet-600/20" data-testid={`order-pr-${pr.id}`}>Order</button>
                    )}
                    {pr.status === 'Ordered' && (
                      <button onClick={()=>updateStatus(pr.id,'Received')} className="px-2 py-1 bg-emerald-600/10 text-emerald-400 rounded text-xs hover:bg-emerald-600/20" data-testid={`receive-pr-${pr.id}`}>Terima Barang</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create PR Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={()=>setShow(false)}>
          <div className="bg-[var(--card-surface)] rounded-2xl shadow-xl w-full max-w-xl p-6 max-h-[90vh] overflow-y-auto" onClick={e=>e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">Buat Purchase Request</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Prioritas</label>
                  <select value={form.priority} onChange={e=>setForm({...form,priority:e.target.value})} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-[var(--card-surface)]" data-testid="pr-priority">
                    {['Urgent','Normal','Low'].map(p=><option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Supplier</label>
                  <input value={form.supplier} onChange={e=>setForm({...form,supplier:e.target.value})} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-[var(--card-surface)]" placeholder="Nama supplier..." />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Keperluan / Alasan</label>
                <input value={form.purpose} onChange={e=>setForm({...form,purpose:e.target.value})} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-[var(--card-surface)]" placeholder="Stok habis, urgent untuk order WO-XXX..." data-testid="pr-purpose" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Item yang Dipesan</label>
                  <button onClick={addLine} className="text-xs text-primary flex items-center gap-1 hover:underline"><Plus className="w-3 h-3" />Tambah</button>
                </div>
                {lines.map((ln,i)=>(
                  <div key={i} className="flex items-center gap-2 mb-2">
                    <select value={ln.acc_id} onChange={e=>lineChange(i,e.target.value)} className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-[var(--card-surface)]">
                      <option value="">Pilih item...</option>
                      {items.map(a=><option key={a.id} value={a.id}>{a.name} (stok: {a.stock_qty} {a.unit})</option>)}
                    </select>
                    <input type="number" min="1" value={ln.qty_requested} onChange={e=>updateLine(i,'qty_requested',+e.target.value)} className="w-14 border border-border rounded-lg px-2 py-1.5 text-xs bg-[var(--card-surface)]" placeholder="Qty" />
                    <span className="text-xs text-muted-foreground">{ln.unit}</span>
                    <input type="number" min="0" value={ln.estimated_price} onChange={e=>updateLine(i,'estimated_price',+e.target.value)} className="w-24 border border-border rounded-lg px-2 py-1.5 text-xs bg-[var(--card-surface)]" placeholder="Harga Est." />
                    {lines.length>1 && <button onClick={()=>removeLine(i)}><X className="w-4 h-4 text-muted-foreground" /></button>}
                  </div>
                ))}
                <div className="text-right text-sm font-medium text-primary mt-1">Est. Total: Rp {fmtNum(totalEst)}</div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Catatan</label>
                <textarea value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} rows="2" className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-[var(--card-surface)] resize-none" />
              </div>
              {err && <div className="text-xs text-red-400">{err}</div>}
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={()=>setShow(false)} className="flex-1 py-2 border border-border rounded-lg text-sm hover:bg-white/5">Batal</button>
              <button onClick={submit} disabled={saving} className="flex-1 py-2 bg-primary text-white rounded-lg text-sm hover:brightness-110 disabled:opacity-50" data-testid="save-pr-btn">
                {saving?'Menyimpan...':'Simpan Draft'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ROOT COMPONENT ──────────────────────────────────────────────────────────
export default function AccessoryModule({ token, userRole, defaultTab = 'master' }) {
  const [tab, setTab]     = useState(defaultTab);
  const [dash, setDash]   = useState(null);
  const [items, setItems] = useState([]);  // shared items list for sub-tabs

  const loadDash = useCallback(async () => {
    try {
      const d = await api('GET', '/api/acc/dashboard', token);
      setDash(d);
    } catch {}
  }, [token]);

  const loadItems = useCallback(async () => {
    try {
      const data = await api('GET', '/api/acc/items', token);
      setItems(Array.isArray(data) ? data : []);
    } catch {}
  }, [token]);

  useEffect(() => { loadDash(); loadItems(); }, [loadDash, loadItems]);

  const TABS = [
    { id:'master',   label:'Master & Stok',     icon: Package },
    { id:'internal', label:'Request Internal',  icon: FileText },
    { id:'opname',   label:'Stok Opname',       icon: ClipboardCheck },
    { id:'pinjam',   label:'Peminjaman',        icon: RotateCcw },
    { id:'pr',       label:'Purchase Request',  icon: ShoppingCart },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold">Manajemen Aksesoris</h2>
        <p className="text-muted-foreground text-sm mt-1">Master, stok, request, peminjaman, dan purchase request aksesoris produksi</p>
      </div>

      {/* Dashboard Summary */}
      {dash && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label:'Total Item', val: dash.total_items, color:'violet', icon: Package },
            { label:'Stok Habis', val: dash.out_of_stock, color:'red', icon: TrendingDown },
            { label:'Stok Rendah', val: dash.low_stock, color:'amber', icon: AlertTriangle },
            { label:'Request Pending', val: dash.pending_requests, color:'sky', icon: Clock },
            { label:'Dipinjam', val: dash.active_loans, color:'orange', icon: RotateCcw },
            { label:'PR Pending', val: dash.pending_pr, color:'emerald', icon: ShoppingCart },
          ].map(s=>(
            <div key={s.label} className={`bg-${s.color}-500/5 border border-${s.color}-500/20 rounded-xl p-3`}>
              <div className="flex items-center gap-1.5 mb-1">
                <s.icon className={`w-3.5 h-3.5 text-${s.color}-400`} />
                <span className="text-xs text-muted-foreground">{s.label}</span>
              </div>
              <div className={`text-xl font-bold text-${s.color}-400`}>{s.val}</div>
            </div>
          ))}
        </div>
      )}

      {/* Low Stock Alerts */}
      {dash?.low_stock_items?.length > 0 && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-medium text-amber-400">Stok Rendah — Perlu Purchase Request</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {dash.low_stock_items.map(it=>(
              <span key={it.id} className="px-3 py-1 bg-amber-500/10 text-amber-400 rounded-full text-xs">
                {it.name}: {fmtNum(it.stock_qty)}/{fmtNum(it.min_stock)} {it.unit}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border overflow-x-auto pb-0">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            data-testid={`acc-tab-${t.id}`}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition whitespace-nowrap -mb-px ${
              tab === t.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}>
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div>
        {tab === 'master'   && <MasterTab token={token} onRefreshDash={() => { loadDash(); loadItems(); }} />}
        {tab === 'internal' && <RequestInternalTab token={token} items={items} />}
        {tab === 'opname'   && <StokOpnameTab token={token} />}
        {tab === 'pinjam'   && <PeminjamanTab token={token} items={items} />}
        {tab === 'pr'       && <PurchaseRequestTab token={token} items={items} />}
      </div>
    </div>
  );
}
