/**
 * CMT Packing & Stok Opname — Blueprint §2.7
 *
 * Alur:
 *   1. Tim Packing buat 'CMT Receipt' saat terima barang dari CMT
 *   2. Input hitung fisik per SKU/warna/ukuran
 *   3. Submit ke Admin Produksi → Admin approve → FG stock diupdate
 *   4. Display Rak — tampilkan produk yang sudah di-approve
 *
 * Tabs:
 *   Stok Opname CMT  — create receipt + input count per baris
 *   Rekap & Approval — Admin verifikasi & approve
 *   Display Rak      — produk approved per SKU di rak
 *   Dashboard        — summary stats
 */

import { useState, useEffect, useCallback } from 'react';
import {
  PackageCheck, Plus, Search, X, RefreshCw, Eye, Check,
  XCircle, ChevronDown, Trash2, ClipboardList, BarChart3,
  AlertTriangle, CheckCircle, Clock, Package, ArrowUpCircle,
  Factory, Edit2, Layers, Send
} from 'lucide-react';

const API = process.env.REACT_APP_BACKEND_URL || '';

const STATUS_COLORS = {
  Draft:     'text-slate-400 bg-slate-500/10',
  Submitted: 'text-amber-400 bg-amber-500/10',
  Approved:  'text-emerald-400 bg-emerald-500/10',
  Rejected:  'text-red-400 bg-red-500/10',
};
const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'Free Size', 'Lainnya'];

function Badge({ status }) {
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status] || 'text-muted-foreground bg-secondary'}`}>{status}</span>;
}
function fmtDate(iso) {
  if (!iso) return '-';
  try { return new Date(iso).toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric' }); }
  catch { return iso?.slice(0,10)||'-'; }
}
function fmtNum(n) { return Number(n||0).toLocaleString('id-ID'); }

async function api(method, path, token, body) {
  const opts = { method, headers: { Authorization:`Bearer ${token}`, 'Content-Type':'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${API}${path}`, opts);
  const data = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(data.detail||`HTTP ${r.status}`);
  return data;
}

// ─── RECEIPT DETAIL PANEL ─────────────────────────────────────────────────────
function ReceiptDetail({ receipt: initReceipt, token, onClose, onRefresh }) {
  const [receipt, setReceipt]   = useState(initReceipt);
  const [lines, setLines]       = useState(initReceipt.lines || []);
  const [showAddLine, setAdd]   = useState(false);
  const [lineForm, setLineForm] = useState({ sku_code:'', product_name:'', color:'', size:'', qty_expected:0, notes:'' });
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState('');

  const reload = async () => {
    try {
      const d = await api('GET', `/api/prod/cmt-receipts/${receipt.id}`, token);
      setReceipt(d); setLines(d.lines || []);
    } catch {}
  };

  const addLine = async () => {
    if (!lineForm.product_name && !lineForm.sku_code) { setErr('Nama produk atau kode SKU wajib'); return; }
    setSaving(true); setErr('');
    try {
      await api('POST', `/api/prod/cmt-receipts/${receipt.id}/lines`, token, lineForm);
      setAdd(false); setLineForm({ sku_code:'', product_name:'', color:'', size:'', qty_expected:0, notes:'' });
      reload(); onRefresh();
    } catch(e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const updateCount = async (line, val) => {
    try {
      await api('PUT', `/api/prod/cmt-receipts/${receipt.id}/lines/${line.id}`, token, { qty_actual: val===''?null:parseInt(val) });
      setLines(prev => prev.map(l => l.id===line.id ? {...l, qty_actual: val===''?null:parseInt(val)} : l));
    } catch(e) { alert(e.message); }
  };

  const deleteLine = async (line) => {
    if (!window.confirm('Hapus baris ini?')) return;
    await api('DELETE', `/api/prod/cmt-receipts/${receipt.id}/lines/${line.id}`, token);
    reload();
  };

  const submitReceipt = async () => {
    setSaving(true); setErr('');
    try {
      const d = await api('POST', `/api/prod/cmt-receipts/${receipt.id}/submit`, token, {});
      setReceipt(d); onRefresh();
    } catch(e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const isDraft = receipt.status === 'Draft';
  const countedLines = lines.filter(l => l.qty_actual !== null && l.qty_actual !== undefined);
  const totalExpected = lines.reduce((s,l) => s + (l.qty_expected||0), 0);
  const totalActual   = countedLines.reduce((s,l) => s + (l.qty_actual||0), 0);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[var(--card-surface)] rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e=>e.stopPropagation()}>
        <div className="sticky top-0 bg-[var(--card-surface)] border-b border-border px-6 py-4 flex items-start justify-between rounded-t-2xl">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold">{receipt.receipt_code}</h3>
              <Badge status={receipt.status} />
            </div>
            <p className="text-sm text-muted-foreground">{receipt.cmt_name} {receipt.wo_number && `· WO: ${receipt.wo_number}`}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white/3 rounded-xl p-3 text-center">
              <div className="text-xs text-muted-foreground">Total Item</div>
              <div className="text-xl font-bold">{lines.length}</div>
            </div>
            <div className="bg-white/3 rounded-xl p-3 text-center">
              <div className="text-xs text-muted-foreground">Qty Ekspektasi</div>
              <div className="text-xl font-bold text-sky-400">{fmtNum(totalExpected)}</div>
            </div>
            <div className="bg-white/3 rounded-xl p-3 text-center">
              <div className="text-xs text-muted-foreground">Qty Hitung Fisik</div>
              <div className={`text-xl font-bold ${totalActual===totalExpected&&totalExpected>0?'text-emerald-400':'text-amber-400'}`}>{fmtNum(totalActual)}</div>
            </div>
          </div>

          {/* Lines Table */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Detail per SKU / Variant ({countedLines.length}/{lines.length} dihitung)</span>
              {isDraft && (
                <button onClick={()=>setAdd(true)} className="flex items-center gap-1 text-xs text-primary hover:underline" data-testid="add-line-btn">
                  <Plus className="w-3.5 h-3.5" /> Tambah
                </button>
              )}
            </div>

            <div className="bg-[var(--card-surface)] border border-border rounded-xl overflow-x-auto">
              <table className="w-full text-sm min-w-[550px]">
                <thead className="bg-[var(--glass-bg)] border-b border-border">
                  <tr>
                    <th className="text-left px-3 py-2 text-muted-foreground font-medium">SKU</th>
                    <th className="text-left px-3 py-2 text-muted-foreground font-medium">Produk</th>
                    <th className="text-center px-3 py-2 text-muted-foreground font-medium">Warna</th>
                    <th className="text-center px-3 py-2 text-muted-foreground font-medium">Ukuran</th>
                    <th className="text-right px-3 py-2 text-muted-foreground font-medium">Ekspek.</th>
                    <th className="text-right px-3 py-2 text-muted-foreground font-medium">Fisik</th>
                    <th className="text-right px-3 py-2 text-muted-foreground font-medium">Selisih</th>
                    {isDraft && <th className="w-8" />}
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 ? (
                    <tr><td colSpan="8" className="text-center py-6 text-muted-foreground">Belum ada item — klik Tambah</td></tr>
                  ) : lines.map(ln => {
                    const diff = ln.qty_actual !== null && ln.qty_actual !== undefined
                      ? (ln.qty_actual - (ln.qty_expected||0)) : null;
                    return (
                      <tr key={ln.id} className={`border-b border-border ${ln.qty_actual===null||ln.qty_actual===undefined?'':'bg-emerald-500/3'}`}>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{ln.sku_code||'-'}</td>
                        <td className="px-3 py-2 font-medium">{ln.product_name}</td>
                        <td className="px-3 py-2 text-center text-muted-foreground">{ln.color||'-'}</td>
                        <td className="px-3 py-2 text-center">
                          <span className="px-1.5 py-0.5 bg-white/5 rounded text-xs">{ln.size||'-'}</span>
                        </td>
                        <td className="px-3 py-2 text-right">{fmtNum(ln.qty_expected)}</td>
                        <td className="px-3 py-2 text-right">
                          {isDraft ? (
                            <input type="number" min="0"
                              defaultValue={ln.qty_actual ?? ''}
                              onBlur={e => updateCount(ln, e.target.value)}
                              className="w-20 border border-border rounded px-2 py-1 text-sm bg-[var(--card-surface)] text-right"
                              placeholder="0" data-testid={`count-${ln.id}`} />
                          ) : (
                            <span className={`font-medium ${ln.qty_actual!==null?'text-emerald-400':'text-muted-foreground'}`}>
                              {ln.qty_actual??'-'}
                            </span>
                          )}
                        </td>
                        <td className={`px-3 py-2 text-right text-sm font-medium ${diff===null?'text-muted-foreground':diff===0?'text-emerald-400':diff>0?'text-sky-400':'text-red-400'}`}>
                          {diff===null ? '-' : diff===0 ? '=' : diff>0 ? `+${diff}` : diff}
                        </td>
                        {isDraft && (
                          <td className="px-3 py-2">
                            <button onClick={()=>deleteLine(ln)} className="p-1 hover:bg-red-500/10 rounded">
                              <Trash2 className="w-3.5 h-3.5 text-red-400" />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Add Line Form */}
          {showAddLine && (
            <div className="bg-white/3 border border-border rounded-xl p-4 space-y-3">
              <h4 className="text-sm font-semibold">Tambah Baris</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">SKU / Kode</label>
                  <input value={lineForm.sku_code} onChange={e=>setLineForm({...lineForm,sku_code:e.target.value})}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-[var(--card-surface)]" placeholder="DA-KMJ-BLK-S" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Nama Produk *</label>
                  <input value={lineForm.product_name} onChange={e=>setLineForm({...lineForm,product_name:e.target.value})}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-[var(--card-surface)]" placeholder="Kemeja Batik Wiru" data-testid="line-product-name" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Warna</label>
                  <input value={lineForm.color} onChange={e=>setLineForm({...lineForm,color:e.target.value})}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-[var(--card-surface)]" placeholder="Hitam / Putih / dll" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Ukuran</label>
                  <select value={lineForm.size} onChange={e=>setLineForm({...lineForm,size:e.target.value})}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-[var(--card-surface)]">
                    <option value="">Pilih...</option>
                    {SIZES.map(s=><option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Qty Ekspektasi</label>
                  <input type="number" min="0" value={lineForm.qty_expected} onChange={e=>setLineForm({...lineForm,qty_expected:+e.target.value})}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-[var(--card-surface)]" />
                </div>
              </div>
              {err && <div className="text-xs text-red-400">{err}</div>}
              <div className="flex gap-2">
                <button onClick={()=>setAdd(false)} className="px-3 py-1.5 border border-border rounded-lg text-sm hover:bg-white/5">Batal</button>
                <button onClick={addLine} disabled={saving} className="px-4 py-1.5 bg-primary text-white rounded-lg text-sm hover:brightness-110 disabled:opacity-50" data-testid="save-line-btn">
                  {saving?'...':'Tambah Baris'}
                </button>
              </div>
            </div>
          )}

          {err && !showAddLine && <div className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{err}</div>}

          {/* Action Buttons */}
          {isDraft && lines.length > 0 && (
            <div className="border-t border-border pt-4">
              <button onClick={submitReceipt} disabled={saving || countedLines.length===0}
                className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:brightness-110 disabled:opacity-50"
                data-testid="submit-receipt-btn">
                <Send className="w-4 h-4" />
                {saving ? 'Mengirim...' : `Submit ke Admin (${countedLines.length} item dihitung)`}
              </button>
              {countedLines.length === 0 && <p className="text-xs text-amber-400 mt-1">Hitung qty fisik minimal 1 item terlebih dahulu</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── TAB: STOK OPNAME CMT ────────────────────────────────────────────────────
function StokOpnameCMTTab({ token }) {
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShow]     = useState(false);
  const [form, setForm]         = useState({ cmt_name:'', wo_number:'', receipt_date:'', delivery_note:'', notes:'' });
  const [detail, setDetail]     = useState(null);
  const [search, setSearch]     = useState('');
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('cmt_name', search);
      params.set('status', 'Draft'); // Tim packing hanya lihat Draft
      const data = await api('GET', `/api/prod/cmt-receipts?${params}`, token);
      setReceipts(Array.isArray(data)?data:[]);
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  }, [token, search]);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!form.cmt_name) { setErr('Nama CMT wajib diisi'); return; }
    setSaving(true); setErr('');
    try {
      const r = await api('POST', '/api/prod/cmt-receipts', token, form);
      setShow(false); setForm({ cmt_name:'', wo_number:'', receipt_date:'', delivery_note:'', notes:'' });
      load();
      // Auto-open detail
      const full = await api('GET', `/api/prod/cmt-receipts/${r.id}`, token);
      setDetail(full);
    } catch(e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const openDetail = async (r) => {
    const full = await api('GET', `/api/prod/cmt-receipts/${r.id}`, token);
    setDetail(full);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-2 border border-border rounded-lg px-3 py-2 bg-[var(--card-surface)] flex-1 min-w-48">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Cari nama CMT..."
            className="flex-1 bg-transparent text-sm focus:outline-none" />
          {search && <button onClick={()=>setSearch('')}><X className="w-4 h-4 text-muted-foreground" /></button>}
        </div>
        <button onClick={load} className="p-2 border border-border rounded-lg hover:bg-white/5"><RefreshCw className="w-4 h-4" /></button>
        <button onClick={()=>{setShow(true);setErr('');}}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:brightness-110"
          data-testid="create-receipt-btn">
          <Plus className="w-4 h-4" /> Buat Penerimaan CMT
        </button>
      </div>

      <div className="bg-[var(--card-surface)] rounded-xl border border-border overflow-x-auto">
        <table className="w-full text-sm min-w-[620px]">
          <thead className="bg-[var(--glass-bg)] border-b border-border">
            <tr>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">Kode</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">CMT</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">No. WO</th>
              <th className="text-center px-4 py-3 text-muted-foreground font-medium">Item</th>
              <th className="text-right px-4 py-3 text-muted-foreground font-medium">Qty Fisik</th>
              <th className="text-center px-4 py-3 text-muted-foreground font-medium">Status</th>
              <th className="text-right px-4 py-3 text-muted-foreground font-medium">Tgl Terima</th>
              <th className="w-12" />
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan="8" className="text-center py-8 text-muted-foreground">Memuat...</td></tr>
            : receipts.length===0 ? <tr><td colSpan="8" className="text-center py-8 text-muted-foreground">Belum ada penerimaan draft</td></tr>
            : receipts.map(r => (
              <tr key={r.id} className="border-b border-border hover:bg-white/2 cursor-pointer" onClick={()=>openDetail(r)} data-testid={`receipt-row-${r.id}`}>
                <td className="px-4 py-3 font-mono text-xs">{r.receipt_code}</td>
                <td className="px-4 py-3 font-medium">{r.cmt_name}</td>
                <td className="px-4 py-3 text-muted-foreground">{r.wo_number||'-'}</td>
                <td className="px-4 py-3 text-center">{r.line_count||0}</td>
                <td className="px-4 py-3 text-right font-medium">{fmtNum(r.total_qty_actual)}</td>
                <td className="px-4 py-3 text-center"><Badge status={r.status} /></td>
                <td className="px-4 py-3 text-right text-muted-foreground text-xs">{fmtDate(r.receipt_date)}</td>
                <td className="px-4 py-3">
                  <button onClick={e=>{e.stopPropagation();openDetail(r);}} className="p-1 hover:bg-white/5 rounded">
                    <Eye className="w-4 h-4 text-muted-foreground" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={()=>setShow(false)}>
          <div className="bg-[var(--card-surface)] rounded-2xl shadow-xl w-full max-w-md p-6" onClick={e=>e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">Buat Penerimaan dari CMT</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Nama CMT / Kontraktor *</label>
                <input value={form.cmt_name} onChange={e=>setForm({...form,cmt_name:e.target.value})}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-[var(--card-surface)]"
                  placeholder="CV. Berkah Jaya / Bu Yuli / dll" data-testid="cmt-name-input" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">No. Work Order</label>
                  <input value={form.wo_number} onChange={e=>setForm({...form,wo_number:e.target.value})}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-[var(--card-surface)]" placeholder="WO-2026-001" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Tgl Terima</label>
                  <input type="date" value={form.receipt_date} onChange={e=>setForm({...form,receipt_date:e.target.value})}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-[var(--card-surface)]" />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">No. Surat Jalan / Delivery Note</label>
                <input value={form.delivery_note} onChange={e=>setForm({...form,delivery_note:e.target.value})}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-[var(--card-surface)]" placeholder="SJ-CMT-001" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Catatan</label>
                <textarea value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} rows="2"
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-[var(--card-surface)] resize-none" />
              </div>
              {err && <div className="text-xs text-red-400">{err}</div>}
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={()=>setShow(false)} className="flex-1 py-2 border border-border rounded-lg text-sm hover:bg-white/5">Batal</button>
              <button onClick={create} disabled={saving} className="flex-1 py-2 bg-primary text-white rounded-lg text-sm hover:brightness-110 disabled:opacity-50" data-testid="save-receipt-btn">
                {saving?'...':'Buat & Input Detail'}
              </button>
            </div>
          </div>
        </div>
      )}

      {detail && (
        <ReceiptDetail receipt={detail} token={token}
          onClose={()=>setDetail(null)} onRefresh={load} />
      )}
    </div>
  );
}

// ─── TAB: REKAP & APPROVAL ────────────────────────────────────────────────────
function RekapApprovalTab({ token }) {
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [statusF, setStatusF]   = useState('Submitted');
  const [detail, setDetail]     = useState(null);
  const [rejectModal, setReject]= useState(null);
  const [reason, setReason]     = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = statusF ? `?status=${statusF}` : '';
      const data = await api('GET', `/api/prod/cmt-receipts${params}`, token);
      setReceipts(Array.isArray(data)?data:[]);
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  }, [token, statusF]);

  useEffect(() => { load(); }, [load]);

  const approve = async (r) => {
    if (!window.confirm(`Approve penerimaan ${r.receipt_code}? Stok FG akan diupdate.`)) return;
    try { await api('POST', `/api/prod/cmt-receipts/${r.id}/approve`, token, {}); load(); }
    catch(e) { alert(e.message); }
  };

  const doReject = async () => {
    try {
      await api('POST', `/api/prod/cmt-receipts/${rejectModal.id}/reject`, token, { reason });
      setReject(null); setReason(''); load();
    } catch(e) { alert(e.message); }
  };

  const openDetail = async (r) => {
    const full = await api('GET', `/api/prod/cmt-receipts/${r.id}`, token);
    setDetail(full);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 justify-between">
        <div className="flex items-center gap-2">
          {['Submitted','Approved','Rejected',''].map(s=>(
            <button key={s} onClick={()=>setStatusF(s)}
              className={`px-3 py-1.5 rounded-lg text-sm transition ${statusF===s?'bg-primary text-white':'border border-border hover:bg-white/5'}`}>
              {s||'Semua'}
            </button>
          ))}
          <button onClick={load} className="p-2 border border-border rounded-lg hover:bg-white/5"><RefreshCw className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="bg-[var(--card-surface)] rounded-xl border border-border overflow-x-auto">
        <table className="w-full text-sm min-w-[680px]">
          <thead className="bg-[var(--glass-bg)] border-b border-border">
            <tr>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">Kode</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">CMT</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">No. WO</th>
              <th className="text-right px-4 py-3 text-muted-foreground font-medium">Qty Fisik</th>
              <th className="text-center px-4 py-3 text-muted-foreground font-medium">Status</th>
              <th className="text-right px-4 py-3 text-muted-foreground font-medium">Disubmit</th>
              <th className="text-right px-4 py-3 text-muted-foreground font-medium">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan="7" className="text-center py-8 text-muted-foreground">Memuat...</td></tr>
            : receipts.length===0 ? <tr><td colSpan="7" className="text-center py-8 text-muted-foreground">Tidak ada data</td></tr>
            : receipts.map(r => (
              <tr key={r.id} className="border-b border-border hover:bg-white/2 cursor-pointer" onClick={()=>openDetail(r)} data-testid={`approval-row-${r.id}`}>
                <td className="px-4 py-3 font-mono text-xs">{r.receipt_code}</td>
                <td className="px-4 py-3 font-medium">{r.cmt_name}</td>
                <td className="px-4 py-3 text-muted-foreground">{r.wo_number||'-'}</td>
                <td className="px-4 py-3 text-right font-medium text-emerald-400">{fmtNum(r.total_qty_actual)} pcs</td>
                <td className="px-4 py-3 text-center"><Badge status={r.status} /></td>
                <td className="px-4 py-3 text-right text-muted-foreground text-xs">{fmtDate(r.submitted_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={e=>{e.stopPropagation();openDetail(r);}} className="p-1 hover:bg-white/5 rounded">
                      <Eye className="w-4 h-4 text-muted-foreground" />
                    </button>
                    {r.status==='Submitted' && (
                      <>
                        <button onClick={e=>{e.stopPropagation();approve(r);}} className="p-1 hover:bg-emerald-500/10 rounded" title="Approve" data-testid={`approve-${r.id}`}>
                          <Check className="w-4 h-4 text-emerald-400" />
                        </button>
                        <button onClick={e=>{e.stopPropagation();setReject(r);setReason('');}} className="p-1 hover:bg-red-500/10 rounded" title="Reject" data-testid={`reject-${r.id}`}>
                          <XCircle className="w-4 h-4 text-red-400" />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail && <ReceiptDetail receipt={detail} token={token} onClose={()=>setDetail(null)} onRefresh={load} />}

      {rejectModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={()=>setReject(null)}>
          <div className="bg-[var(--card-surface)] rounded-2xl p-6 w-full max-w-sm" onClick={e=>e.stopPropagation()}>
            <h3 className="font-bold mb-3">Tolak Penerimaan</h3>
            <p className="text-sm text-muted-foreground mb-3">{rejectModal.receipt_code} — {rejectModal.cmt_name}</p>
            <textarea value={reason} onChange={e=>setReason(e.target.value)} rows="3" placeholder="Alasan penolakan..."
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-[var(--card-surface)] resize-none" />
            <div className="flex gap-3 mt-4">
              <button onClick={()=>setReject(null)} className="flex-1 py-2 border border-border rounded-lg text-sm hover:bg-white/5">Batal</button>
              <button onClick={doReject} className="flex-1 py-2 bg-red-600 text-white rounded-lg text-sm hover:brightness-110" data-testid="confirm-reject-btn">Tolak</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TAB: DISPLAY RAK ─────────────────────────────────────────────────────────
function DisplayRakTab({ token }) {
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = search ? `?search=${encodeURIComponent(search)}` : '';
      const data = await api('GET', `/api/prod/display-rak${params}`, token);
      setItems(Array.isArray(data)?data:[]);
    } catch { }
    finally { setLoading(false); }
  }, [token, search]);

  useEffect(() => { load(); }, [load]);

  const grouped = items.reduce((acc, it) => {
    const key = it.product_name || it.sku_code || '-';
    if (!acc[key]) acc[key] = [];
    acc[key].push(it);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 border border-border rounded-lg px-3 py-2 bg-[var(--card-surface)] flex-1 min-w-48">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Cari produk / SKU..."
            className="flex-1 bg-transparent text-sm focus:outline-none" data-testid="rak-search" />
          {search && <button onClick={()=>setSearch('')}><X className="w-4 h-4 text-muted-foreground" /></button>}
        </div>
        <button onClick={load} className="p-2 border border-border rounded-lg hover:bg-white/5"><RefreshCw className="w-4 h-4" /></button>
        <div className="text-sm text-muted-foreground">{items.length} variant tersedia</div>
      </div>

      {loading ? <div className="text-center py-10 text-muted-foreground">Memuat...</div>
      : items.length===0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>Belum ada produk di rak</p>
          <p className="text-xs mt-1">Approve penerimaan dari CMT untuk menampilkan produk</p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([name, variants]) => (
            <div key={name} className="bg-[var(--card-surface)] border border-border rounded-xl overflow-hidden">
              <div className="bg-[var(--glass-bg)] px-4 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <PackageCheck className="w-4 h-4 text-emerald-400" />
                  <span className="font-medium">{name}</span>
                  <span className="text-xs text-muted-foreground">({variants.length} variant)</span>
                </div>
                <div className="font-bold text-emerald-400">
                  {fmtNum(variants.reduce((s,v)=>s+v.total_qty,0))} pcs total
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 p-3">
                {variants.map((v,i) => (
                  <div key={i} className="bg-white/3 rounded-lg px-3 py-2.5 flex items-center justify-between" data-testid={`rak-item-${v.sku_code}`}>
                    <div>
                      {v.sku_code && <div className="text-xs font-mono text-muted-foreground">{v.sku_code}</div>}
                      <div className="text-sm font-medium">
                        {v.color && <span className="mr-1">{v.color}</span>}
                        {v.size && <span className="px-1.5 py-0.5 bg-white/5 rounded text-xs">{v.size}</span>}
                        {!v.color && !v.size && <span className="text-muted-foreground">-</span>}
                      </div>
                    </div>
                    <div className="text-lg font-bold text-emerald-400 ml-2">{fmtNum(v.total_qty)}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── TAB: DASHBOARD ───────────────────────────────────────────────────────────
function DashboardTab({ token }) {
  const [summary, setSummary] = useState(null);
  const [recent, setRecent]   = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, r] = await Promise.all([
        api('GET', '/api/prod/cmt-receipts/summary', token),
        api('GET', '/api/prod/cmt-receipts?status=Submitted', token)
      ]);
      setSummary(s);
      setRecent(Array.isArray(r)?r.slice(0,10):[]);
    } catch { }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-5">
      {summary && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label:'Total Penerimaan', val:summary.total, color:'slate', icon:ClipboardList },
              { label:'Draft (Tim Packing)', val:summary.pending, color:'amber', icon:Clock },
              { label:'Menunggu Approval', val:summary.submitted, color:'sky', icon:Send },
              { label:'Sudah Disetujui', val:summary.approved, color:'emerald', icon:CheckCircle },
              { label:'Ditolak', val:summary.rejected, color:'red', icon:XCircle },
              { label:'Pcs Disetujui Hari Ini', val:summary.pcs_approved_today, color:'violet', icon:PackageCheck },
            ].map(s=>(
              <div key={s.label} className={`bg-${s.color}-500/5 border border-${s.color}-500/20 rounded-xl p-3`}>
                <div className="flex items-center gap-1.5 mb-1">
                  <s.icon className={`w-3.5 h-3.5 text-${s.color}-400`} />
                  <span className="text-xs text-muted-foreground">{s.label}</span>
                </div>
                <div className={`text-2xl font-bold text-${s.color}-400`}>{fmtNum(s.val)}</div>
              </div>
            ))}
          </div>

          {summary.submitted > 0 && (
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-medium text-amber-400">{summary.submitted} Penerimaan Menunggu Approval Admin</span>
              </div>
              <p className="text-xs text-muted-foreground">Buka tab "Rekap & Approval" untuk memproses</p>
            </div>
          )}

          {recent.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-3">Menunggu Persetujuan</h3>
              <div className="space-y-2">
                {recent.map(r=>(
                  <div key={r.id} className="bg-[var(--card-surface)] border border-border rounded-xl p-3 flex items-center justify-between">
                    <div>
                      <div className="font-medium text-sm">{r.receipt_code} — {r.cmt_name}</div>
                      <div className="text-xs text-muted-foreground">{r.wo_number || 'Tanpa WO'} · {fmtNum(r.total_qty_actual)} pcs · {fmtDate(r.submitted_at)}</div>
                    </div>
                    <Badge status={r.status} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function CMTPackingModule({ token }) {
  const [tab, setTab] = useState('opname');

  const TABS = [
    { id:'opname',   label:'Stok Opname CMT',   icon:ClipboardList },
    { id:'rekap',    label:'Rekap & Approval',   icon:CheckCircle },
    { id:'rak',      label:'Display Rak',         icon:Layers },
    { id:'dashboard',label:'Dashboard',           icon:BarChart3 },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Packing & Stok Opname CMT</h2>
        <p className="text-muted-foreground text-sm mt-1">Terima barang dari CMT, hitung fisik, verifikasi Admin, dan tampilkan di rak</p>
      </div>

      <div className="flex items-center gap-1 border-b border-border overflow-x-auto pb-0">
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)}
            data-testid={`cmt-tab-${t.id}`}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition whitespace-nowrap -mb-px ${
              tab===t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}>
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab==='opname'    && <StokOpnameCMTTab token={token} />}
      {tab==='rekap'     && <RekapApprovalTab token={token} />}
      {tab==='rak'       && <DisplayRakTab token={token} />}
      {tab==='dashboard' && <DashboardTab token={token} />}
    </div>
  );
}
