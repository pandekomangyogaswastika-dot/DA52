/**
 * ProcurementRequestModule — Pengadaan Barang/Jasa (Purchase Requests)
 * CV. Dewi Aditya — P1.C Procure-to-Pay
 *
 * Backend: /api/procurement/*
 * Flows: Draft → Submit → Approve/Reject → Complete
 */
import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  Plus, RefreshCw, ChevronRight, Search, AlertTriangle,
  CheckCircle2, XCircle, Clock, ShoppingCart, FileText,
  Send, Trash2, BarChart3, History,
} from 'lucide-react';

const API = process.env.REACT_APP_BACKEND_URL;

const PRIORITY_CFG = {
  low:    { label: 'Rendah',   color: 'text-slate-400 bg-slate-400/10 border-slate-400/20' },
  medium: { label: 'Sedang',  color: 'text-blue-400  bg-blue-400/10  border-blue-400/20'  },
  high:   { label: 'Tinggi',  color: 'text-amber-400 bg-amber-400/10 border-amber-400/20' },
  urgent: { label: 'Urgent',  color: 'text-red-400   bg-red-400/10   border-red-400/20'   },
};

const STATUS_CFG = {
  draft:            { label: 'Draft',                      icon: FileText,    color: 'text-slate-400  bg-slate-400/10  border-slate-400/20'  },
  submitted:        { label: 'Menunggu Approval Dept',     icon: Clock,       color: 'text-amber-400  bg-amber-400/10  border-amber-400/20'  },
  dept_approved:    { label: 'Menunggu Approval Finance',  icon: Clock,       color: 'text-orange-400 bg-orange-400/10 border-orange-400/20' },
  finance_approved: { label: 'Menunggu Final Approval',   icon: Clock,       color: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20' },
  approved:         { label: 'Disetujui',                  icon: CheckCircle2,color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' },
  in_procurement:   { label: 'Sedang Pengadaan',           icon: ShoppingCart,color: 'text-blue-400   bg-blue-400/10   border-blue-400/20'   },
  rejected:         { label: 'Ditolak',                    icon: XCircle,     color: 'text-red-400    bg-red-400/10    border-red-400/20'    },
  completed:        { label: 'Selesai',                    icon: CheckCircle2,color: 'text-sky-400    bg-sky-400/10    border-sky-400/20'    },
  cancelled:        { label: 'Dibatalkan',                 icon: XCircle,     color: 'text-zinc-500   bg-zinc-500/10   border-zinc-500/20'  },
};

const TYPE_LABELS = {
  asset: 'Aset Tetap', consumable: 'Barang Habis Pakai',
  service: 'Jasa', subscription: 'Langganan / SaaS',
  maintenance: 'Kontrak Maintenance', rental: 'Sewa Alat/Fasilitas',
  project: 'Berbasis Proyek', other: 'Lainnya',
};

const fmtRp = (n) => `Rp ${Number(n||0).toLocaleString('id-ID')}`;

function StatusBadge({ status }) {
  const c = STATUS_CFG[status] || STATUS_CFG.draft;
  const Icon = c.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${c.color}`}>
      <Icon size={10} /> {c.label}
    </span>
  );
}

function PriorityBadge({ priority }) {
  const c = PRIORITY_CFG[priority] || PRIORITY_CFG.medium;
  return (
    <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border ${c.color}`}>
      {c.label}
    </span>
  );
}

// ── Stats Card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color = 'text-white' }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4">
      <div className="text-xs text-zinc-400 mb-1">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-xs text-zinc-500 mt-0.5">{sub}</div>}
    </div>
  );
}

// ── Create PR Modal ───────────────────────────────────────────────────────────
function CreatePRModal({ onClose, onCreated, token }) {
  const [form, setForm] = useState({
    title: '', description: '', justification: '',
    priority: 'medium', request_type: 'consumable', department: '',
  });
  const [items, setItems] = useState([{ name: '', specification: '', qty: 1, unit: 'pcs', estimated_price: 0, notes: '' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const [requestTypes, setRequestTypes] = useState(Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label })));

  // Fetch request types dari API (Phase 5B)
  useEffect(() => {
    const fetchTypes = async () => {
      try {
        const res = await fetch(`${API}/api/procurement/request-types`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.items?.length > 0) {
            setRequestTypes(data.items);
          }
        }
      } catch {
        // fallback ke TYPE_LABELS jika fetch gagal
      }
    };
    fetchTypes();
  }, [token]);

  const addItem = () => setItems(p => [...p, { name: '', specification: '', qty: 1, unit: 'pcs', estimated_price: 0, notes: '' }]);
  const rmItem  = (i) => setItems(p => p.filter((_, idx) => idx !== i));
  const setItem = (i, k, v) => setItems(p => p.map((it, idx) => idx === i ? { ...it, [k]: v } : it));

  const totalEst = items.reduce((s, it) => s + Number(it.qty||0) * Number(it.estimated_price||0), 0);

  const submit = async () => {
    if (!form.title.trim()) return setError('Judul wajib diisi');
    if (!items[0].name.trim()) return setError('Minimal 1 item harus diisi');
    setSaving(true); setError('');
    try {
      await axios.post(`${API}/api/procurement/requests`, { ...form, items }, { headers: { Authorization: `Bearer ${token}` } });
      onCreated();
    } catch (e) {
      setError(e.response?.data?.detail || 'Gagal membuat PR');
    } finally { setSaving(false); }
  };

  const inp = 'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500/50';
  const sel = inp + ' appearance-none';

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 className="text-base font-semibold text-white">Buat Permintaan Pengadaan</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">✕</button>
        </div>
        <div className="p-5 space-y-4">
          {error && <div className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs text-zinc-400 mb-1 block">Judul Permintaan *</label>
              <input className={inp} placeholder="mis. Pembelian Laptop Karyawan Baru" value={form.title} onChange={e => setForm(p=>({...p,title:e.target.value}))} />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Tipe Pengadaan</label>
              <select className={sel} value={form.request_type} onChange={e => setForm(p=>({...p,request_type:e.target.value}))}>
                {requestTypes.map(rt => <option key={rt.value} value={rt.value}>{rt.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Prioritas</label>
              <select className={sel} value={form.priority} onChange={e => setForm(p=>({...p,priority:e.target.value}))}>
                {Object.entries(PRIORITY_CFG).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-xs text-zinc-400 mb-1 block">Departemen</label>
              <input className={inp} placeholder="mis. Produksi, HR, IT" value={form.department} onChange={e => setForm(p=>({...p,department:e.target.value}))} />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-zinc-400 mb-1 block">Justifikasi / Alasan</label>
              <textarea className={inp} rows={2} placeholder="Jelaskan mengapa pengadaan ini diperlukan" value={form.justification} onChange={e => setForm(p=>({...p,justification:e.target.value}))} />
            </div>
          </div>

          <div className="border-t border-white/10 pt-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-white">Items ({items.length})</span>
              <button onClick={addItem} className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
                <Plus size={12} /> Tambah Item
              </button>
            </div>
            {items.map((it, i) => (
              <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-3 mb-2 space-y-2">
                <div className="flex gap-2">
                  <input className={inp} placeholder="Nama item *" value={it.name} onChange={e => setItem(i,'name',e.target.value)} />
                  {items.length > 1 && (
                    <button onClick={() => rmItem(i)} className="p-2 text-red-400 hover:text-red-300 flex-shrink-0">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                <input className={inp} placeholder="Spesifikasi" value={it.specification} onChange={e => setItem(i,'specification',e.target.value)} />
                <div className="grid grid-cols-3 gap-2">
                  <input type="number" min="1" className={inp} placeholder="Qty" value={it.qty} onChange={e => setItem(i,'qty',e.target.value)} />
                  <input className={inp} placeholder="Satuan" value={it.unit} onChange={e => setItem(i,'unit',e.target.value)} />
                  <input type="number" min="0" className={inp} placeholder="Estimasi Harga" value={it.estimated_price} onChange={e => setItem(i,'estimated_price',e.target.value)} />
                </div>
              </div>
            ))}
            <div className="text-right text-sm font-semibold text-white mt-2">
              Total Estimasi: <span className="text-emerald-400">{fmtRp(totalEst)}</span>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 p-5 border-t border-white/10">
          <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-400 hover:text-white">Batal</button>
          <button onClick={submit} disabled={saving} className="px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-xl disabled:opacity-50">
            {saving ? 'Menyimpan...' : 'Simpan Draft'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Create PO from PR Modal ───────────────────────────────────────────────────
function CreatePOFromPRModal({ pr, token, onClose, onCreated }) {
  const [form, setForm] = useState({
    vendor_name: '', vendor_contact: '', vendor_address: '',
    expected_delivery_date: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inp = 'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500/50';

  const submit = async () => {
    if (!form.vendor_name.trim()) return setError('Nama vendor wajib diisi');
    setSaving(true); setError('');
    try {
      await axios.post(`${API}/api/procurement/requests/${pr.id}/create-po`, form, {
        headers: { Authorization: `Bearer ${token}` }
      });
      onCreated();
    } catch (e) {
      setError(e.response?.data?.detail || 'Gagal membuat PO');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-lg" data-testid="create-po-from-pr-modal">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <div>
            <h2 className="text-base font-semibold text-white">Buat Purchase Order</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Dari PR: {pr.request_number} — {pr.title}</p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">✕</button>
        </div>
        <div className="p-5 space-y-3">
          {error && <div className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Nama Vendor / Supplier *</label>
            <input className={inp} placeholder="mis. PT. Sumber Makmur" value={form.vendor_name}
              onChange={e => setForm(p=>({...p,vendor_name:e.target.value}))} data-testid="po-vendor-name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Kontak Vendor</label>
              <input className={inp} placeholder="Telepon / Email" value={form.vendor_contact}
                onChange={e => setForm(p=>({...p,vendor_contact:e.target.value}))} />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Tgl. Pengiriman Diharapkan</label>
              <input type="date" className={inp} value={form.expected_delivery_date}
                onChange={e => setForm(p=>({...p,expected_delivery_date:e.target.value}))} />
            </div>
          </div>
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Alamat Vendor</label>
            <input className={inp} placeholder="Alamat lengkap vendor" value={form.vendor_address}
              onChange={e => setForm(p=>({...p,vendor_address:e.target.value}))} />
          </div>
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Catatan</label>
            <textarea className={inp} rows={2} placeholder="Instruksi tambahan untuk vendor" value={form.notes}
              onChange={e => setForm(p=>({...p,notes:e.target.value}))} />
          </div>
          {/* Item preview */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-3">
            <p className="text-xs text-zinc-400 mb-2">Item dari PR ({(pr.items||[]).length} item):</p>
            <div className="space-y-1">
              {(pr.items||[]).map((it,i) => (
                <div key={i} className="flex justify-between text-xs">
                  <span className="text-zinc-300">{it.name} <span className="text-zinc-500">× {it.qty} {it.unit}</span></span>
                  <span className="text-emerald-400">{fmtRp(it.total_price)}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between text-sm font-semibold mt-2 pt-2 border-t border-white/10">
              <span className="text-zinc-300">Total Estimasi</span>
              <span className="text-emerald-400">{fmtRp(pr.total_estimated)}</span>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 p-5 border-t border-white/10">
          <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-400 hover:text-white">Batal</button>
          <button onClick={submit} disabled={saving}
            className="px-5 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl disabled:opacity-50"
            data-testid="btn-confirm-create-po">
            {saving ? 'Membuat PO...' : 'Buat PO'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Detail Modal ──────────────────────────────────────────────────────────────
function DetailModal({ item, onClose, onAction, token, userRole }) {
  const [note, setNote] = useState('');
  const [acting, setActing] = useState('');
  const [timeline, setTimeline] = useState([]);
  const [loadTL, setLoadTL] = useState(false);
  const [showCreatePO, setShowCreatePO] = useState(false);

  useEffect(() => {
    setLoadTL(true);
    axios.get(`${API}/api/procurement/requests/${item.id}/timeline`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setTimeline(r.data?.steps || []))
      .catch(() => {})
      .finally(() => setLoadTL(false));
  }, [item.id, token]);

  const doAction = async (action) => {
    setActing(action);
    try {
      const endpoint = action === 'submit'   ? 'submit'
                     : action === 'approve'  ? 'approve'
                     : action === 'reject'   ? 'reject'
                     : action === 'complete' ? 'complete'
                     : action;
      await axios.post(
        `${API}/api/procurement/requests/${item.id}/${endpoint}`,
        { comment: note, reason: note },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      onAction();
    } catch (e) {
      alert(e.response?.data?.detail || `Gagal ${action}`);
    } finally { setActing(''); }
  };

  const isAdmin = ['superadmin', 'admin'].includes(userRole);
  const canSubmit   = item.status === 'draft';
  const canApprove  = ['submitted', 'dept_approved', 'finance_approved'].includes(item.status) &&
                      (isAdmin || ['manager','dept_head','supervisor','finance','finance_manager','accountant','director','cfo','ceo'].includes(userRole));
  const canComplete = item.status === 'in_procurement' && (isAdmin || ['manager','superadmin'].includes(userRole));
  const canCreatePO = item.status === 'approved';

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center p-4 pt-16" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto">
        <div className="flex items-start justify-between p-5 border-b border-white/10">
          <div>
            <h2 className="text-base font-semibold text-white">{item.title}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-zinc-500">{item.request_number}</span>
              <StatusBadge status={item.status} />
              <PriorityBadge priority={item.priority} />
            </div>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">✕</button>
        </div>
        <div className="p-5 space-y-4">
          {/* Linked PO info */}
          {item.linked_po_number && (
            <div className="flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 rounded-xl px-3 py-2 text-sm">
              <FileText size={13} className="text-blue-400" />
              <span className="text-zinc-300">Purchase Order terhubung:</span>
              <span className="text-blue-400 font-semibold">{item.linked_po_number}</span>
            </div>
          )}
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div><div className="text-xs text-zinc-400">Tipe</div><div className="text-white">{TYPE_LABELS[item.request_type] || item.request_type}</div></div>
            <div><div className="text-xs text-zinc-400">Departemen</div><div className="text-white">{item.department || '-'}</div></div>
            <div><div className="text-xs text-zinc-400">Total Estimasi</div><div className="text-emerald-400 font-semibold">{fmtRp(item.total_estimated)}</div></div>
          </div>
          {item.justification && (
            <div className="bg-white/5 border border-white/10 rounded-xl p-3">
              <div className="text-xs text-zinc-400 mb-1">Justifikasi</div>
              <p className="text-sm text-zinc-300">{item.justification}</p>
            </div>
          )}
          <div>
            <div className="text-sm font-semibold text-white mb-2">Items ({(item.items||[]).length})</div>
            <div className="space-y-1">
              {(item.items||[]).map((it, i) => (
                <div key={i} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2 text-sm">
                  <div>
                    <span className="text-white">{it.name}</span>
                    {it.specification && <span className="text-zinc-500 text-xs ml-2">{it.specification}</span>}
                  </div>
                  <div className="text-right">
                    <span className="text-zinc-300">{it.qty} {it.unit}</span>
                    <span className="text-emerald-400 ml-3">{fmtRp(it.total_price)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Timeline */}
          {timeline.length > 0 && (
            <div>
              <div className="text-sm font-semibold text-white mb-2 flex items-center gap-1.5"><History size={13} /> Riwayat</div>
              <div className="space-y-1">
                {timeline.map((t, i) => (
                  <div key={i} className="flex gap-2 text-xs">
                    <span className="text-zinc-500 w-32 flex-shrink-0">{new Date(t.timestamp).toLocaleString('id-ID',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</span>
                    <span className="text-zinc-300">{t.action_label || t.action}</span>
                    {t.actor_name && <span className="text-zinc-500">— {t.actor_name}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {(canApprove || canSubmit || canComplete || canCreatePO) && (
            <div className="border-t border-white/10 pt-4 space-y-2">
              {(canSubmit || canApprove) && (
                <textarea
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none"
                  rows={2} placeholder="Catatan (opsional)" value={note} onChange={e => setNote(e.target.value)}
                />
              )}
              <div className="flex gap-2 justify-end flex-wrap">
                {canSubmit && (
                  <button onClick={() => doAction('submit')} disabled={!!acting}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-xl disabled:opacity-50"
                    data-testid="btn-submit-pr">
                    <Send size={13} /> {acting === 'submit' ? 'Mengirim...' : 'Submit ke Approver'}
                  </button>
                )}
                {canApprove && (
                  <>
                    <button onClick={() => doAction('reject')} disabled={!!acting}
                      className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-red-600/20 hover:bg-red-600/40 text-red-400 border border-red-500/20 rounded-xl disabled:opacity-50"
                      data-testid="btn-reject-pr">
                      <XCircle size={13} /> Tolak
                    </button>
                    <button onClick={() => doAction('approve')} disabled={!!acting}
                      className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl disabled:opacity-50"
                      data-testid="btn-approve-pr">
                      <CheckCircle2 size={13} /> {acting === 'approve' ? 'Menyetujui...' : 'Setujui'}
                    </button>
                  </>
                )}
                {canCreatePO && (
                  <button onClick={() => setShowCreatePO(true)} disabled={!!acting}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl disabled:opacity-50"
                    data-testid="btn-create-po-from-pr">
                    <FileText size={13} /> Buat Purchase Order
                  </button>
                )}
                {canComplete && (
                  <button onClick={() => doAction('complete')} disabled={!!acting}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-sky-600 hover:bg-sky-500 text-white rounded-xl disabled:opacity-50"
                    data-testid="btn-complete-pr">
                    <CheckCircle2 size={13} /> {acting === 'complete' ? 'Menyelesaikan...' : 'Tandai Selesai'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      {showCreatePO && (
        <CreatePOFromPRModal
          pr={item}
          token={token}
          onClose={() => setShowCreatePO(false)}
          onCreated={() => { setShowCreatePO(false); onAction(); }}
        />
      )}
    </div>
  );
}

// ── Main Module ───────────────────────────────────────────────────────────────
export default function ProcurementRequestModule({ token, user }) {
  const [stats, setStats]   = useState(null);
  const [items, setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]  = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [detail, setDetail]  = useState(null);
  const [page, setPage]      = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const headers = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 15 };
      if (filterStatus)   params.status   = filterStatus;
      if (filterPriority) params.priority  = filterPriority;
      if (search)         params.search    = search;
      const [listRes, dashRes] = await Promise.all([
        axios.get(`${API}/api/procurement/requests`, { headers, params }),
        axios.get(`${API}/api/procurement/dashboard`, { headers }),
      ]);
      setItems(listRes.data?.items || []);
      setTotalPages(listRes.data?.pagination?.total_pages || 1);
      setStats(dashRes.data?.summary || null);
    } catch (e) {
      console.error('Procurement load error', e);
    } finally { setLoading(false); }
  }, [token, page, filterStatus, filterPriority, search]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-4 space-y-4 max-w-6xl mx-auto" data-testid="procurement-module">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2"><ShoppingCart size={20} className="text-blue-400" /> Pengadaan Barang & Jasa</h1>
          <p className="text-xs text-zinc-400 mt-0.5">Permintaan Pengadaan (PR) — PR/YYYY/MM/XXXX</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="p-2 text-zinc-400 hover:text-white rounded-lg hover:bg-white/5">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-xl shadow-sm">
            <Plus size={14} /> Buat PR
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total PR" value={stats.total} />
          <StatCard label="Menunggu Approval" value={stats.pending} color="text-amber-400" />
          <StatCard label="Disetujui" value={stats.approved} color="text-emerald-400" />
          <StatCard label="Nilai Disetujui (Bulan Ini)" value={fmtRp(stats.total_value_approved_this_month)} color="text-sky-400" sub="bulan ini" />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            className="w-full bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-sm text-white placeholder-zinc-500 focus:outline-none"
            placeholder="Cari judul atau nomor PR..."
            value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <select
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none"
          value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }}
        >
          <option value="">Semua Status</option>
          <option value="draft">Draft</option>
          <option value="submitted">Menunggu Approval Dept</option>
          <option value="dept_approved">Menunggu Approval Finance</option>
          <option value="finance_approved">Menunggu Final Approval</option>
          <option value="approved">Disetujui</option>
          <option value="in_procurement">Sedang Pengadaan</option>
          <option value="rejected">Ditolak</option>
          <option value="completed">Selesai</option>
          <option value="cancelled">Dibatalkan</option>
        </select>
        <select
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none"
          value={filterPriority} onChange={e => { setFilterPriority(e.target.value); setPage(1); }}
        >
          <option value="">Semua Prioritas</option>
          {Object.entries(PRIORITY_CFG).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-zinc-500">
          <RefreshCw size={20} className="animate-spin mr-2" /> Memuat...
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
          <ShoppingCart size={36} className="mb-3 opacity-40" />
          <p className="text-sm">Belum ada permintaan pengadaan</p>
          <button onClick={() => setShowCreate(true)}
            className="mt-4 flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 border border-blue-500/20 rounded-xl">
            <Plus size={13} /> Buat Permintaan Pertama
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(it => (
            <div key={it.id} onClick={() => setDetail(it)}
              className="bg-white/5 border border-white/10 hover:border-white/20 rounded-xl p-4 cursor-pointer transition-all group">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusBadge status={it.status} />
                    <PriorityBadge priority={it.priority} />
                    <span className="text-[10px] text-zinc-500">{it.request_number}</span>
                    {it.department && <span className="text-[10px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">{it.department}</span>}
                  </div>
                  <h3 className="text-sm font-semibold text-white mt-1.5 leading-snug">{it.title}</h3>
                  <div className="flex items-center gap-3 mt-1 text-xs text-zinc-500">
                    <span>{it.requested_by_name || 'Admin'}</span>
                    <span>{new Date(it.created_at).toLocaleDateString('id-ID')}</span>
                    <span className="text-emerald-400 font-medium">{fmtRp(it.total_estimated)}</span>
                    <span>{(it.items||[]).length} item</span>
                  </div>
                </div>
                <ChevronRight size={16} className="text-zinc-600 group-hover:text-zinc-400 flex-shrink-0 mt-1" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage(p => p-1)}
            className="px-3 py-1.5 text-sm rounded-lg bg-white/5 border border-white/10 text-zinc-400 disabled:opacity-40 hover:bg-white/10">
            ← Prev
          </button>
          <span className="text-sm text-zinc-400">Hal. {page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(p => p+1)}
            className="px-3 py-1.5 text-sm rounded-lg bg-white/5 border border-white/10 text-zinc-400 disabled:opacity-40 hover:bg-white/10">
            Next →
          </button>
        </div>
      )}

      {/* Modals */}
      {showCreate && <CreatePRModal token={token} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />}
      {detail && <DetailModal item={detail} token={token} userRole={user?.role} onClose={() => setDetail(null)} onAction={() => { setDetail(null); load(); }} />}
    </div>
  );
}
