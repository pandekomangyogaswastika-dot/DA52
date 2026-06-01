import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Plus, RefreshCw, Package, CheckCircle, XCircle, Clock, Truck, AlertTriangle, Printer } from 'lucide-react';

const API = process.env.REACT_APP_BACKEND_URL;

// Task 2.5: Simple print-ready return note using browser print
const printReturnNote = (item) => {
  const REASON_LABEL = {
    sisa_produksi: 'Sisa Produksi', salah_material: 'Material Salah/Tidak Sesuai',
    kelebihan_issue: 'Kelebihan Issue', order_dibatalkan: 'Order Dibatalkan', lainnya: 'Lainnya',
  };
  const COND_LABEL = { good: 'Baik (kembali ke stok)', damaged: 'Rusak', scrap: 'Scrap/Sortir' };
  const html = `
    <html><head><title>Nota Retur ${item.ref_no}</title>
    <style>
      body{font-family:Arial,sans-serif;font-size:12px;margin:20px}
      h2{font-size:16px;margin-bottom:4px}
      .meta{color:#555;margin-bottom:16px;font-size:11px}
      table{width:100%;border-collapse:collapse;margin-top:12px}
      th{background:#f0f0f0;padding:6px 8px;text-align:left;border:1px solid #ccc;font-size:11px}
      td{padding:5px 8px;border:1px solid #ddd;font-size:11px}
      .footer{margin-top:40px;display:flex;gap:80px}
      .sign{border-top:1px solid #000;min-width:120px;padding-top:4px;text-align:center;font-size:11px}
      @media print{button{display:none}}
    </style></head><body>
    <h2>NOTA RETUR MATERIAL PRODUKSI</h2>
    <div class="meta">
      <b>No. Ref:</b> ${item.ref_no} &nbsp;|&nbsp;
      <b>WO:</b> ${item.work_order_code || '-'} &nbsp;|&nbsp;
      <b>Line:</b> ${item.production_line || '-'} &nbsp;|&nbsp;
      <b>Tanggal:</b> ${new Date(item.created_at).toLocaleDateString('id-ID')} &nbsp;|&nbsp;
      <b>Dibuat oleh:</b> ${item.submitted_by || '-'} &nbsp;|&nbsp;
      <b>Alasan:</b> ${REASON_LABEL[item.return_reason] || item.return_reason || '-'}
    </div>
    <table>
      <thead><tr><th>#</th><th>Kode Material</th><th>Nama Material</th><th>Qty</th><th>Satuan</th><th>Kondisi</th><th>Keterangan</th></tr></thead>
      <tbody>
        ${(item.items || []).map((it, i) => `
          <tr>
            <td>${i+1}</td><td>${it.material_code||''}</td><td>${it.material_name||''}</td>
            <td style="text-align:right">${it.qty_returned||0}</td><td>${it.unit||''}</td>
            <td>${COND_LABEL[it.condition]||it.condition||''}</td><td>${it.note||''}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    <div class="footer">
      <div class="sign">Dibuat Oleh<br/><br/><br/>(________________)</div>
      <div class="sign">Disetujui Supervisor<br/><br/><br/>(________________)</div>
      <div class="sign">Diterima Gudang<br/><br/><br/>(________________)</div>
    </div>
    </body></html>`;
  const w = window.open('', '_blank', 'width=800,height=600');
  w.document.write(html);
  w.document.close();
  w.onload = () => w.print();
};

const STATUS_CONFIG = {
  draft:     { label: 'Draft',       color: 'text-zinc-400',    bg: 'bg-zinc-500/10',    border: 'border-zinc-500/20' },
  submitted: { label: 'Diajukan',    color: 'text-amber-400',   bg: 'bg-amber-400/10',   border: 'border-amber-400/20' },
  approved:  { label: 'Disetujui',   color: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-400/20' },
  rejected:  { label: 'Ditolak',     color: 'text-red-400',     bg: 'bg-red-400/10',     border: 'border-red-400/20' },
  received:  { label: 'Diterima WH', color: 'text-blue-400',    bg: 'bg-blue-400/10',    border: 'border-blue-400/20' },
};

const REASON_OPTIONS = [
  { value: 'sisa_produksi',    label: 'Sisa Produksi' },
  { value: 'salah_material',   label: 'Material Salah/Tidak Sesuai' },
  { value: 'kelebihan_issue',  label: 'Kelebihan Issue dari Gudang' },
  { value: 'order_dibatalkan', label: 'Order Dibatalkan' },
  { value: 'lainnya',          label: 'Lainnya' },
];

const CONDITION_OPTIONS = [
  { value: 'good',    label: 'Baik (kembali ke stok)' },
  { value: 'damaged', label: 'Rusak (tidak ke stok)' },
  { value: 'scrap',   label: 'Scrap / Sortir' },
];

const INP = 'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500/50';
const INP_SM = 'bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500/50';

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.draft;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.color} ${cfg.bg} ${cfg.border}`}>
      {cfg.label}
    </span>
  );
}

function ReturnForm({ onSuccess, onCancel, headers }) {
  const [form, setForm] = useState({ work_order_code: '', production_line: '', return_reason: 'sisa_produksi', notes: '' });
  const [items, setItems] = useState([{ material_code: '', material_name: '', qty_returned: '', unit: 'meter', condition: 'good', note: '' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const addItem    = () => setItems(p => [...p, { material_code: '', material_name: '', qty_returned: '', unit: 'meter', condition: 'good', note: '' }]);
  const removeItem = (i) => setItems(p => p.filter((_, idx) => idx !== i));
  const setItem    = (i, field, val) => setItems(p => p.map((it, idx) => idx === i ? { ...it, [field]: val } : it));

  const handleSubmit = async () => {
    if (!items.some(it => it.material_code && parseFloat(it.qty_returned) > 0)) {
      setError('Tambahkan minimal 1 item dengan material code dan qty > 0'); return;
    }
    setSaving(true); setError('');
    try {
      await axios.post(`${API}/api/production/material-returns`, {
        ...form,
        items: items.filter(it => it.material_code && parseFloat(it.qty_returned) > 0)
                    .map(it => ({ ...it, qty_returned: parseFloat(it.qty_returned) })),
      }, { headers });
      onSuccess();
    } catch (e) {
      setError(e.response?.data?.detail || 'Gagal menyimpan');
    } finally { setSaving(false); }
  };

  return (
    <div className="bg-zinc-900 border border-white/10 rounded-2xl p-5 space-y-5">
      <h2 className="font-semibold text-white">Buat Return Material Baru</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">No. Work Order (opsional)</label>
          <input value={form.work_order_code} onChange={e=>setForm(p=>({...p,work_order_code:e.target.value}))}
            className={INP} placeholder="WO-2024-001" />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">Lini Produksi</label>
          <input value={form.production_line} onChange={e=>setForm(p=>({...p,production_line:e.target.value}))}
            className={INP} placeholder="Lini A" />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">Alasan Return</label>
          <select value={form.return_reason} onChange={e=>setForm(p=>({...p,return_reason:e.target.value}))}
            className={INP + ' [&>option]:bg-zinc-900'}>
            {REASON_OPTIONS.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">Catatan</label>
          <input value={form.notes} onChange={e=>setForm(p=>({...p,notes:e.target.value}))}
            className={INP} placeholder="Catatan tambahan..." />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-zinc-200">Item Material</h3>
          <button onClick={addItem} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
            <Plus size={13} /> Tambah Item
          </button>
        </div>
        <div className="space-y-3">
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-6 gap-2 p-3 bg-white/5 rounded-xl border border-white/10">
              <input value={it.material_code} onChange={e=>setItem(i,'material_code',e.target.value)}
                placeholder="Kode Material" className={INP_SM + ' col-span-2'} />
              <input value={it.material_name} onChange={e=>setItem(i,'material_name',e.target.value)}
                placeholder="Nama Material"  className={INP_SM + ' col-span-2'} />
              <input type="number" value={it.qty_returned} onChange={e=>setItem(i,'qty_returned',e.target.value)}
                placeholder="Qty" className={INP_SM} />
              <button onClick={()=>removeItem(i)} className="text-red-400 hover:text-red-300 flex items-center justify-center">
                <XCircle size={16}/>
              </button>
              <select value={it.condition} onChange={e=>setItem(i,'condition',e.target.value)}
                className={INP_SM + ' col-span-3 [&>option]:bg-zinc-900'}>
                {CONDITION_OPTIONS.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <input value={it.unit} onChange={e=>setItem(i,'unit',e.target.value)}
                placeholder="Satuan" className={INP_SM} />
              <input value={it.note} onChange={e=>setItem(i,'note',e.target.value)}
                placeholder="Keterangan item" className={INP_SM + ' col-span-2'} />
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-400/10 rounded-lg p-2 border border-red-400/20">{error}</div>
      )}

      <div className="flex gap-3 pt-2">
        <button onClick={onCancel}
          className="px-4 py-2 text-sm border border-white/10 rounded-xl text-zinc-400 hover:text-white hover:bg-white/5">
          Batal
        </button>
        <button onClick={handleSubmit} disabled={saving}
          className="flex-1 flex items-center justify-center gap-2 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-xl disabled:opacity-50">
          {saving ? <RefreshCw size={15} className="animate-spin" /> : <Plus size={15} />} Simpan Return
        </button>
      </div>
    </div>
  );
}

function ReturnCard({ item, onAction, canApprove }) {
  const [acting, setActing] = useState(false);
  const doAction = async (endpoint) => {
    setActing(true);
    await onAction(item.id, endpoint);
    setActing(false);
  };

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4 hover:border-white/20 transition-all">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs text-zinc-500">{item.ref_no}</span>
            <StatusBadge status={item.status} />
          </div>
          <p className="text-sm font-semibold text-white mt-1">
            {item.work_order_code ? `WO: ${item.work_order_code}` : 'Return Material'}
            {item.production_line && <span className="text-zinc-500 font-normal"> • {item.production_line}</span>}
          </p>
          <p className="text-xs text-zinc-400 mt-0.5">
            {REASON_OPTIONS.find(r=>r.value===item.return_reason)?.label || item.return_reason}
          </p>
          <p className="text-xs text-zinc-500 mt-0.5">
            {item.items?.length || 0} item • {item.submitted_by} • {new Date(item.created_at).toLocaleDateString('id-ID')}
          </p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => printReturnNote(item)}
          title="Cetak Nota Retur"
          className="p-1.5 text-zinc-500 hover:text-zinc-200 hover:bg-white/5 rounded-lg border border-white/10"
        >
          <Printer size={14} />
        </button>
        {item.status === 'draft' && canApprove && (
          <button onClick={()=>doAction('submit')} disabled={acting}
            className="flex-1 text-xs font-medium py-1.5 rounded-lg bg-amber-400/10 text-amber-400 hover:bg-amber-400/20 border border-amber-400/20 disabled:opacity-50">
            Ajukan ke Supervisor
          </button>
        )}
        {item.status === 'submitted' && canApprove && (
          <>
            <button onClick={()=>doAction('reject')} disabled={acting}
              className="flex-1 text-xs font-medium py-1.5 rounded-lg bg-red-400/10 text-red-400 hover:bg-red-400/20 border border-red-400/20 disabled:opacity-50">
              Tolak
            </button>
            <button onClick={()=>doAction('approve')} disabled={acting}
              className="flex-1 text-xs font-medium py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50">
              {acting ? '...' : 'Setujui'}
            </button>
          </>
        )}
        {item.status === 'approved' && canApprove && (
          <button onClick={()=>doAction('receive')} disabled={acting}
            className="flex-1 flex items-center justify-center gap-1 text-xs font-medium py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50">
            <Truck size={12}/> Terima di Gudang
          </button>
        )}
      </div>
    </div>
  );
}

export default function ProductionMaterialReturnsModule({ user }) {
  const [returns, setReturns]       = useState([]);
  const [summary, setSummary]       = useState({});
  const [loading, setLoading]       = useState(true);
  const [view, setView]             = useState('list');
  const [filterStatus, setFilterStatus] = useState('');
  const token   = localStorage.getItem('token');
  const headers = { Authorization: `Bearer ${token}` };
  const canApprove = ['superadmin','admin','owner','manager'].includes((user?.role||'').toLowerCase());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, sumRes] = await Promise.all([
        axios.get(`${API}/api/production/material-returns`, { headers, params: { status: filterStatus || undefined } }),
        axios.get(`${API}/api/production/material-returns/summary`, { headers }),
      ]);
      setReturns(listRes.data?.data || []);
      setSummary(sumRes.data?.data || {});
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [filterStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const handleAction = async (id, action) => {
    try {
      await axios.post(`${API}/api/production/material-returns/${id}/${action}`, { note: '' }, { headers });
      load();
    } catch (e) {
      alert(e.response?.data?.detail || 'Gagal melakukan aksi');
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-5" data-testid="material-returns-module">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-white flex items-center gap-2">
            <Package className="text-purple-400" size={20} /> Return Material Produksi
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">Pengembalian material dari lantai produksi ke gudang</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load}
            className="p-2 text-zinc-500 hover:text-white rounded-lg hover:bg-white/5 border border-white/10">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          {view === 'list' && (
            <button onClick={() => setView('form')}
              className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-xl">
              <Plus size={15} /> Return Baru
            </button>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Object.entries(STATUS_CONFIG).map(([k, v]) => (
          <button key={k} onClick={() => setFilterStatus(filterStatus === k ? '' : k)}
            className={`text-left p-3 rounded-xl border transition-all ${
              filterStatus === k
                ? `${v.bg} ${v.border} ${v.color}`
                : 'border-white/10 bg-white/5 hover:border-white/20'
            }`}>
            <p className={`text-xl font-bold ${v.color}`}>{summary[k] || 0}</p>
            <p className="text-xs text-zinc-500 mt-0.5">{v.label}</p>
          </button>
        ))}
      </div>

      {/* Content */}
      {view === 'form' ? (
        <ReturnForm onSuccess={()=>{setView('list');load();}} onCancel={()=>setView('list')} headers={headers} />
      ) : loading ? (
        <div className="flex items-center justify-center py-20 text-zinc-500">
          <RefreshCw size={24} className="animate-spin text-purple-400" />
          <span className="ml-3">Memuat...</span>
        </div>
      ) : returns.length === 0 ? (
        <div className="text-center py-20 text-zinc-600">
          <Package size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-base font-medium text-zinc-400">Belum ada return material</p>
          <p className="text-sm mt-1">Klik "Return Baru" untuk membuat return pertama</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {returns.map(item => (
            <ReturnCard key={item.id} item={item} onAction={handleAction} canApprove={canApprove} />
          ))}
        </div>
      )}
    </div>
  );
}
