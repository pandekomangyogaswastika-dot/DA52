import { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, Lock, Unlock, AlertTriangle, Package, CheckCircle2, Plus, Trash2, RefreshCw } from 'lucide-react';

const STATUS_COLOR = {
  active: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  released: 'bg-foreground/10 text-foreground/50 border-foreground/20',
  cancelled: 'bg-red-500/20 text-red-300 border-red-500/30',
};

export default function RahazaMaterialReservationModule({ token }) {
  const [tab, setTab] = useState('by-wo');
  const [wos, setWos] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [selectedWo, setSelectedWo] = useState(null);
  const [woReservations, setWoReservations] = useState([]);
  const [woSearch, setWoSearch] = useState('');
  const [matSearch, setMatSearch] = useState('');
  const [matAvailability, setMatAvailability] = useState(null);
  const [loading, setLoading] = useState(false);
  const [reserveForm, setReserveForm] = useState({ wo_id: '', materials: [{ material_id: '', required_qty: '' }] });
  const [showReserveForm, setShowReserveForm] = useState(false);
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);

  const hdrs = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const loadWOs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/rahaza/work-orders?status=released&limit=100', { headers: hdrs });
      if (res.ok) setWos(await res.json());
    } finally {
      setLoading(false);
    }
  }, [hdrs]);

  const loadMaterials = useCallback(async () => {
    const res = await fetch('/api/rahaza/materials?limit=200', { headers: hdrs });
    if (res.ok) setMaterials(await res.json());
  }, [hdrs]);

  useEffect(() => { loadWOs(); loadMaterials(); }, [loadWOs, loadMaterials]);

  const loadWoReservations = async (woId) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/rahaza/work-orders/${woId}/reservations`, { headers: hdrs });
      if (res.ok) setWoReservations(await res.json());
    } finally {
      setLoading(false);
    }
  };

  const selectWO = (wo) => {
    setSelectedWo(wo);
    loadWoReservations(wo.id);
  };

  const checkMaterialAvailability = async (matId) => {
    const res = await fetch(`/api/rahaza/materials/${matId}/availability`, { headers: hdrs });
    if (res.ok) setMatAvailability(await res.json());
  };

  const releaseReservation = async (reservationId) => {
    if (!window.confirm('Release reservasi ini?')) return;
    const res = await fetch(`/api/rahaza/materials/reservation/${reservationId}`, {
      method: 'DELETE', headers: hdrs,
    });
    if (res.ok) {
      setMsg({ type: 'success', text: 'Reservasi dilepas' });
      if (selectedWo) await loadWoReservations(selectedWo.id);
    }
    setTimeout(() => setMsg(null), 3000);
  };

  const releaseAllWoReservations = async () => {
    if (!selectedWo || !window.confirm(`Release semua reservasi WO ${selectedWo.wo_number}?`)) return;
    const res = await fetch(`/api/rahaza/work-orders/${selectedWo.id}/release-reservations`, {
      method: 'POST', headers: hdrs,
    });
    if (res.ok) {
      const d = await res.json();
      setMsg({ type: 'success', text: `${d.reservations_released} reservasi dilepas` });
      await loadWoReservations(selectedWo.id);
    }
    setTimeout(() => setMsg(null), 3000);
  };

  const handleReserve = async () => {
    if (!reserveForm.wo_id) return setMsg({ type: 'error', text: 'Pilih Work Order' });
    setSaving(true);
    try {
      const body = {
        wo_id: reserveForm.wo_id,
        materials: reserveForm.materials
          .filter(m => m.material_id && m.required_qty)
          .map(m => ({ material_id: m.material_id, required_qty: parseFloat(m.required_qty) })),
      };
      if (!body.materials.length) return setMsg({ type: 'error', text: 'Tambahkan minimal 1 material' });
      const res = await fetch('/api/rahaza/materials/reserve', {
        method: 'POST', headers: { ...hdrs, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (res.ok) {
        setMsg({ type: 'success', text: `${d.reservations_created} reservasi dibuat` });
        setShowReserveForm(false);
        if (selectedWo?.id === reserveForm.wo_id) await loadWoReservations(selectedWo.id);
      } else {
        setMsg({ type: 'error', text: d.detail || 'Gagal membuat reservasi' });
      }
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(null), 4000);
    }
  };

  const filteredWos = wos.filter(w =>
    !woSearch || w.wo_number?.toLowerCase().includes(woSearch.toLowerCase()) ||
    w.model_code?.toLowerCase().includes(woSearch.toLowerCase())
  );
  const filteredMats = materials.filter(m =>
    !matSearch || m.code?.toLowerCase().includes(matSearch.toLowerCase()) ||
    m.name?.toLowerCase().includes(matSearch.toLowerCase())
  );

  return (
    <div className="space-y-5" data-testid="material-reservation-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Reservasi Material</h2>
          <p className="text-sm text-foreground/50 mt-0.5">Kelola alokasi material untuk Work Order</p>
        </div>
        <button
          onClick={() => setShowReserveForm(v => !v)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[hsl(var(--primary)/0.15)] border border-[hsl(var(--primary)/0.25)] text-[hsl(var(--primary))] text-sm hover:bg-[hsl(var(--primary)/0.25)] transition-colors"
          data-testid="new-reservation-btn"
        >
          <Plus className="w-4 h-4" /> Buat Reservasi
        </button>
      </div>

      {/* Alert */}
      {msg && (
        <div className={`px-4 py-3 rounded-xl border text-sm ${msg.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-red-500/10 border-red-500/30 text-red-300'}`}>
          {msg.text}
        </div>
      )}

      {/* Reserve Form */}
      {showReserveForm && (
        <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-2xl p-5 space-y-4" data-testid="reserve-form">
          <h3 className="font-semibold text-foreground">Buat Reservasi Material</h3>
          <div>
            <label className="block text-xs font-medium text-foreground/60 mb-1">Work Order</label>
            <select value={reserveForm.wo_id} onChange={e => setReserveForm(f => ({ ...f, wo_id: e.target.value }))}
              className="w-full h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm text-foreground"
              data-testid="reserve-wo-select">
              <option value="">-- Pilih WO --</option>
              {wos.map(w => <option key={w.id} value={w.id}>{`${w.wo_number} · ${w.model_code}`}</option>)}
            </select>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-foreground/60">Material</label>
              <button onClick={() => setReserveForm(f => ({ ...f, materials: [...f.materials, { material_id: '', required_qty: '' }] }))}
                className="text-xs text-[hsl(var(--primary))] hover:underline flex items-center gap-1">
                <Plus className="w-3 h-3" /> Tambah
              </button>
            </div>
            {reserveForm.materials.map((m, idx) => (
              <div key={idx} className="flex gap-2 mb-2">
                <select value={m.material_id} onChange={e => {
                  const u = [...reserveForm.materials]; u[idx].material_id = e.target.value;
                  setReserveForm(f => ({ ...f, materials: u }));
                  if (e.target.value) checkMaterialAvailability(e.target.value);
                }} className="flex-1 h-9 px-2 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-xs text-foreground"
                  data-testid={`reserve-mat-select-${idx}`}>
                  <option value="">-- Pilih Material --</option>
                  {materials.map(mat => <option key={mat.id} value={mat.id}>{`${mat.code} – ${mat.name}`}</option>)}
                </select>
                <input type="number" value={m.required_qty} onChange={e => {
                  const u = [...reserveForm.materials]; u[idx].required_qty = e.target.value;
                  setReserveForm(f => ({ ...f, materials: u }));
                }} placeholder="Qty" step="0.1" min="0"
                  className="w-24 h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm text-foreground"
                  data-testid={`reserve-qty-${idx}`} />
                <button onClick={() => setReserveForm(f => ({ ...f, materials: f.materials.filter((_, i) => i !== idx) }))}
                  className="h-9 w-9 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 flex items-center justify-center">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            {matAvailability && (
              <div className="p-3 rounded-lg border border-blue-500/30 bg-blue-500/10 text-xs space-y-1">
                <p className="font-medium text-blue-300">{matAvailability.code} – {matAvailability.name}</p>
                <div className="flex gap-4 text-foreground/70">
                  <span>Stok: <strong className="text-foreground">{matAvailability.stock_qty} {matAvailability.unit}</strong></span>
                  <span>Reserved: <strong className="text-amber-300">{matAvailability.reserved_qty} {matAvailability.unit}</strong></span>
                  <span>Tersedia: <strong className="text-emerald-300">{matAvailability.available_qty} {matAvailability.unit}</strong></span>
                </div>
              </div>
            )}
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={handleReserve} disabled={saving}
              className="px-5 py-2 rounded-xl bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] text-sm font-medium hover:opacity-90 disabled:opacity-50"
              data-testid="reserve-submit-btn">
              {saving ? 'Menyimpan...' : 'Buat Reservasi'}
            </button>
            <button onClick={() => setShowReserveForm(false)}
              className="px-5 py-2 rounded-xl border border-[var(--glass-border)] text-sm text-foreground/70 hover:bg-[var(--glass-bg-hover)]">
              Batal
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2">
        {[['by-wo', 'Per Work Order'], ['by-material', 'Per Material']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${tab === id ? 'bg-[var(--nav-pill-active)] text-foreground' : 'text-foreground/50 hover:bg-[var(--glass-bg-hover)]'}`}
            data-testid={`res-tab-${id}`}>
            {label}
          </button>
        ))}
      </div>

      {/* By WO */}
      {tab === 'by-wo' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* WO List */}
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/40" />
              <input value={woSearch} onChange={e => setWoSearch(e.target.value)}
                placeholder="Cari WO..." className="w-full h-9 pl-9 pr-3 rounded-xl border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm text-foreground"
                data-testid="wo-search" />
            </div>
            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
              {filteredWos.length === 0 ? (
                <div className="text-center py-8 text-foreground/40 text-sm">
                  {loading ? 'Memuat...' : 'Tidak ada WO released'}
                </div>
              ) : filteredWos.map(wo => (
                <button key={wo.id} onClick={() => selectWO(wo)}
                  className={`w-full text-left p-4 rounded-xl border transition-colors ${selectedWo?.id === wo.id ? 'border-[hsl(var(--primary)/0.4)] bg-[hsl(var(--primary)/0.05)]' : 'border-[var(--glass-border)] bg-[var(--glass-bg)] hover:bg-[var(--glass-bg-hover)]'}`}
                  data-testid={`wo-item-${wo.id}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-foreground">{wo.wo_number}</p>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">{wo.status}</span>
                  </div>
                  <p className="text-xs text-foreground/50 mt-1">{wo.model_code} · {wo.qty} pcs · {wo.line_code}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Reservations */}
          <div>
            {!selectedWo ? (
              <div className="h-full flex items-center justify-center text-foreground/30">
                <div className="text-center">
                  <Lock className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Pilih Work Order untuk melihat reservasi</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{selectedWo.wo_number}</p>
                    <p className="text-xs text-foreground/50">{woReservations.length} reservasi aktif</p>
                  </div>
                  {woReservations.some(r => r.status === 'active') && (
                    <button onClick={releaseAllWoReservations}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-500/30 text-amber-400 text-xs hover:bg-amber-500/10 transition-colors"
                      data-testid="release-all-btn">
                      <Unlock className="w-3 h-3" /> Release Semua
                    </button>
                  )}
                </div>
                {woReservations.length === 0 ? (
                  <div className="text-center py-10 text-foreground/40 text-sm">Tidak ada reservasi</div>
                ) : woReservations.map(r => (
                  <div key={r.id} className="p-4 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] flex items-center gap-3" data-testid={`reservation-${r.id}`}>
                    <Package className="w-8 h-8 p-1.5 rounded-lg bg-[var(--card-surface)] text-foreground/60 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{r.material_code} – {r.material_name}</p>
                      <p className="text-xs text-foreground/50">{r.reserved_qty} {r.unit} · {new Date(r.created_at).toLocaleDateString('id-ID')}</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs border shrink-0 ${STATUS_COLOR[r.status] || ''}`}>{r.status}</span>
                    {r.status === 'active' && (
                      <button onClick={() => releaseReservation(r.id)}
                        className="p-1.5 rounded-lg border border-[var(--glass-border)] text-foreground/40 hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/10 transition-colors"
                        title="Release reservasi ini" data-testid={`release-btn-${r.id}`}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* By Material */}
      {tab === 'by-material' && (
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/40" />
            <input value={matSearch} onChange={e => setMatSearch(e.target.value)}
              placeholder="Cari kode/nama material..." className="w-full h-9 pl-9 pr-3 rounded-xl border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm text-foreground"
              data-testid="mat-search" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredMats.map(mat => (
              <MaterialAvailabilityCard key={mat.id} mat={mat} token={token} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MaterialAvailabilityCard({ mat, token }) {
  const [avail, setAvail] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [reservations, setReservations] = useState([]);

  const load = async () => {
    const hdrs = { Authorization: `Bearer ${token}` };
    const [aRes, rRes] = await Promise.all([
      fetch(`/api/rahaza/materials/${mat.id}/availability`, { headers: hdrs }),
      fetch(`/api/rahaza/materials/${mat.id}/reservations?status=active`, { headers: hdrs }),
    ]);
    if (aRes.ok) setAvail(await aRes.json());
    if (rRes.ok) setReservations(await rRes.json());
    setExpanded(true);
  };

  const pct = avail ? Math.round((avail.available_qty / Math.max(avail.stock_qty, 1)) * 100) : null;

  return (
    <div className="p-4 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] space-y-3" data-testid={`mat-card-${mat.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-foreground">{mat.code}</p>
          <p className="text-xs text-foreground/50 truncate">{mat.name}</p>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--nav-pill-active)] text-foreground/70 shrink-0">{mat.type}</span>
      </div>
      {avail ? (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-foreground/50">Stok Total</span>
            <span className="font-mono text-foreground">{avail.stock_qty} {avail.unit}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-foreground/50">Reserved</span>
            <span className="font-mono text-amber-300">{avail.reserved_qty} {avail.unit}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-foreground/50">Tersedia</span>
            <span className={`font-mono font-semibold ${pct < 20 ? 'text-red-400' : pct < 50 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {avail.available_qty} {avail.unit}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-foreground/10 overflow-hidden">
            <div className={`h-full rounded-full transition-all ${pct < 20 ? 'bg-red-500' : pct < 50 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
          </div>
          {reservations.length > 0 && (
            <p className="text-xs text-foreground/40">{reservations.length} WO yang mereservasi</p>
          )}
        </div>
      ) : (
        <button onClick={load} className="w-full text-xs text-[hsl(var(--primary))] hover:underline flex items-center justify-center gap-1 py-1">
          <RefreshCw className="w-3 h-3" /> Cek Ketersediaan
        </button>
      )}
    </div>
  );
}
