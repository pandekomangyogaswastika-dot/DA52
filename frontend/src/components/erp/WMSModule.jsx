/**
 * WMS Module — Warehouse Management System Phase 1
 * Tabs: Dashboard | Struktur Gudang | Satuan & Konversi | Receiving (Scan In/Out) | Posisi & Stok
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Building2, Layers, Scale, PackageCheck, Search, Plus, Edit2, Trash2, X, Check,
  ArrowDownToLine, ArrowUpFromLine, RefreshCw, Scan, MapPin, Package, AlertCircle,
  ChevronRight, BarChart3, Settings, Warehouse, Info, ClipboardCheck, Printer,
  TrendingUp, TrendingDown, FileDown, Play, StopCircle, History, User as UserIcon, Calendar } from 'lucide-react';
import { toast } from 'sonner';
// Sprint A.1: UniversalScanner SSOT replaces inline ScannerInput
import UniversalScanner from './scanner/UniversalScanner';
import { EmptyState } from './EmptyState';
import { Skeleton } from '@/components/ui/skeleton';

const API = process.env.REACT_APP_BACKEND_URL;

const fmt = (n) => new Intl.NumberFormat('id-ID').format(n ?? 0);
const fmtPct = (n) => `${n ?? 0}%`;

const ZONE_TYPE_LABELS = { rm: 'Bahan Baku', fg: 'Barang Jadi', wip: 'WIP', transit: 'Transit', general: 'Umum' };
const ZONE_TYPE_COLORS = { rm: 'bg-blue-500/20 text-blue-400 border-blue-500/30', fg: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', wip: 'bg-amber-500/20 text-amber-400 border-amber-500/30', general: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30', transit: 'bg-purple-500/20 text-purple-400 border-purple-500/30' };
const STATUS_COLORS = { pending: 'text-amber-400', partial: 'text-blue-400', confirmed: 'text-emerald-400', cancelled: 'text-zinc-500' };
const RACK_COLORS = { red: 'border-red-500/50 bg-red-500/10', orange: 'border-orange-500/50 bg-orange-500/10', yellow: 'border-amber-500/50 bg-amber-500/10', green: 'border-emerald-500/50 bg-emerald-500/10' };

function Badge({ cls, children }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>{children}</span>;
}

// ─── Scanner Input Wrapper (Sprint A.1: uses UniversalScanner inline) ──────
// Backward-compat shim — converts onScan(value) + loading to UniversalScanner inline
function ScannerInput({ placeholder = "Scan atau ketik barcode...", onScan, loading, className = '' }) {
  return (
    <div className={`relative ${className}`}>
      <UniversalScanner
        variant="inline"
        onScan={(code) => onScan(code)}
        placeholder={placeholder}
        disabled={loading}
        autoFocus
        data-testid="scanner-input"
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// TAB: DASHBOARD
// ──────────────────────────────────────────────────────────────────────────────
function DashboardTab({ token }) {
  const [buildings, setBuildings] = useState([]);
  const [mapData, setMapData] = useState(null);
  const [selectedBldg, setSelectedBldg] = useState(null);
  const [summary, setSummary] = useState({});
  const [alerts, setAlerts] = useState({ critical: [], warning: [], total_alerts: 0, critical_count: 0, warning_count: 0 });
  const [loading, setLoading] = useState(true);
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const buildingFilter = selectedBldg ? `?building_id=${selectedBldg}` : '';
      const [bRes, sRes, aRes] = await Promise.all([
        fetch(`${API}/api/wms/buildings`, { headers }).then(r => r.json()),
        fetch(`${API}/api/wms/pending/summary${buildingFilter}`, { headers }).then(r => r.json()),
        fetch(`${API}/api/wms/alerts/occupancy?threshold=90${selectedBldg ? `&building_id=${selectedBldg}` : ''}`, { headers }).then(r => r.json()),
      ]);
      const bldgs = Array.isArray(bRes) ? bRes : [];
      setBuildings(bldgs);
      setSummary(sRes || {});
      setAlerts(aRes || { critical: [], warning: [], total_alerts: 0 });
      if (bldgs.length > 0 && !selectedBldg) setSelectedBldg(bldgs[0].id);
    } catch { toast.error('Gagal memuat dashboard'); }
    finally { setLoading(false); }
  }, [headers, selectedBldg]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!selectedBldg) return;
    fetch(`${API}/api/wms/map/${selectedBldg}`, { headers }).then(r => r.json()).then(d => setMapData(d)).catch(() => {});
  }, [selectedBldg, headers]);

  if (loading) return (
    <div className="space-y-5 p-2" data-testid="wms-dashboard-skeleton">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* OCCUPANCY ALERTS — racks ≥ 90% */}
      {alerts.total_alerts > 0 && (
        <div data-testid="occupancy-alert-banner" className="bg-red-500/10 border border-red-500/30 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle size={16} className="text-red-400" />
            <span className="text-sm font-semibold text-red-300">
              Peringatan Kapasitas Rak ({alerts.total_alerts} rak)
            </span>
            <span className="ml-auto text-xs text-muted-foreground">
              {alerts.critical_count > 0 && <span className="text-red-400 font-bold mr-2">⚠ {alerts.critical_count} kritis (≥95%)</span>}
              {alerts.warning_count} hampir penuh (90-94%)
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-48 overflow-y-auto">
            {[...(alerts.critical || []), ...(alerts.warning || [])].slice(0, 12).map(r => (
              <div key={r.rack_id} data-testid="occupancy-alert-row"
                className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2 border ${r.severity === 'critical' ? 'bg-red-500/15 border-red-500/40' : 'bg-amber-500/10 border-amber-500/30'}`}>
                <div className="min-w-0">
                  <div className="text-xs font-mono font-bold truncate">{r.building_code}-{r.zone_code}-{r.rack_code}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{r.rack_name}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className={`text-sm font-bold ${r.severity === 'critical' ? 'text-red-400' : 'text-amber-400'}`}>{r.occupancy_pct}%</div>
                  <div className="text-[10px] text-muted-foreground">{r.free_slots} slot kosong</div>
                </div>
              </div>
            ))}
          </div>
          {alerts.total_alerts > 12 && <div className="text-xs text-muted-foreground mt-2 text-center">+{alerts.total_alerts - 12} rak lainnya...</div>}
        </div>
      )}

      {/* Pending Summary Badges */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Pending Inbound', value: summary.pending_inbound, icon: ArrowDownToLine, color: 'emerald' },
          { label: 'Pending Outbound RM', value: summary.pending_outbound_rm, icon: ArrowUpFromLine, color: 'amber' },
          { label: 'Pending Outbound FG', value: summary.pending_outbound_fg, icon: ArrowUpFromLine, color: 'orange' },
          { label: 'Total Pending', value: summary.total_pending, icon: Package, color: 'violet' },
        ].map(c => (
          <div key={c.label} className={`bg-white/3 border border-${c.color}-500/20 rounded-2xl p-4`}>
            <c.icon size={18} className={`text-${c.color}-400 mb-2`} />
            <div className={`text-2xl font-bold text-${c.color}-400`}>{c.value ?? 0}</div>
            <div className="text-xs text-muted-foreground">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Warehouse Map */}
      {buildings.length > 0 ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground mr-1">Filter Gedung:</span>
            {buildings.map(b => (
              <button key={b.id} data-testid={`building-filter-${b.code}`} onClick={() => setSelectedBldg(b.id)}
                className={`px-3 py-1.5 rounded-lg text-sm border transition-all ${selectedBldg === b.id ? 'bg-violet-600 border-violet-500 text-white' : 'bg-white/5 border-white/10 text-muted-foreground hover:text-foreground'}`}>
                <Building2 size={13} className="inline mr-1.5" />{b.name}
              </button>
            ))}
          </div>

          {mapData && (
            <div className="space-y-4">
              {(mapData.zones || []).map(zone => (
                <div key={zone.id} className="border border-white/8 rounded-2xl overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-2.5 bg-white/3">
                    <Badge cls={ZONE_TYPE_COLORS[zone.zone_type] || ZONE_TYPE_COLORS.general}>{ZONE_TYPE_LABELS[zone.zone_type] || zone.zone_type}</Badge>
                    <span className="font-medium text-sm">{zone.name}</span>
                    <span className="text-xs text-muted-foreground ml-auto">{zone.occupied_positions}/{zone.total_positions} slot terisi ({zone.occupancy_pct}%)</span>
                  </div>
                  <div className="p-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                    {(zone.racks || []).map(rack => (
                      <div key={rack.id} data-testid="rack-map-card"
                        className={`rounded-xl border p-3 ${RACK_COLORS[rack.color] || RACK_COLORS.green}`}>
                        <div className="font-semibold text-xs mb-1">{rack.code}</div>
                        <div className="text-[10px] text-muted-foreground">{rack.name}</div>
                        <div className="mt-1.5 h-1.5 rounded-full bg-white/10">
                          <div className={`h-full rounded-full ${rack.color === 'red' ? 'bg-red-500' : rack.color === 'orange' ? 'bg-orange-500' : rack.color === 'yellow' ? 'bg-amber-500' : 'bg-emerald-500'} transition-all`}
                            style={{ width: `${rack.occupancy_pct}%` }} />
                        </div>
                        <div className="text-[10px] mt-1 text-right">{rack.occupied}/{rack.total}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <EmptyState
          icon={Warehouse}
          title="Belum ada struktur gudang"
          description="Klik 'Seed Demo' untuk membuat demo gudang atau buat gedung baru di tab Struktur."
          action={{
            label: 'Seed Demo Gudang',
            onClick: async () => {
              try {
                await fetch(`${API}/api/wms/units/seed`, { method: 'POST', headers });
                await fetch(`${API}/api/wms/structure/seed-demo`, { method: 'POST', headers });
                toast.success('Demo gudang berhasil dibuat');
                load();
              } catch { toast.error('Gagal seed demo'); }
            }
          }}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// TAB: STRUKTUR GUDANG (Building → Zone → Rack)
// ──────────────────────────────────────────────────────────────────────────────
function StructureTab({ token }) {
  const [buildings, setBuildings] = useState([]);
  const [zones, setZones] = useState([]);
  const [racks, setRacks] = useState([]);
  const [selectedBldg, setSelectedBldg] = useState(null);
  const [selectedZone, setSelectedZone] = useState(null);
  const [view, setView] = useState('buildings'); // buildings | zones | racks
  const [modal, setModal] = useState(null); // {type: 'building'|'zone'|'rack', data: null|obj}
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({});
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const loadBuildings = useCallback(async () => {
    const r = await fetch(`${API}/api/wms/buildings`, { headers });
    const d = await r.json(); setBuildings(Array.isArray(d) ? d : []);
  }, [headers]);

  const loadZones = useCallback(async (bldgId) => {
    const r = await fetch(`${API}/api/wms/zones?building_id=${bldgId}`, { headers });
    const d = await r.json(); setZones(Array.isArray(d) ? d : []);
  }, [headers]);

  const loadRacks = useCallback(async (zoneId) => {
    const r = await fetch(`${API}/api/wms/racks?zone_id=${zoneId}`, { headers });
    const d = await r.json(); setRacks(Array.isArray(d) ? d : []);
  }, [headers]);

  useEffect(() => { loadBuildings(); }, [loadBuildings]);

  function openBldgModal(data = null) { setForm(data || { code: '', name: '', address: '' }); setModal({ type: 'building', data }); }
  function openZoneModal(data = null) { setForm(data || { code: '', name: '', zone_type: 'rm', building_id: selectedBldg }); setModal({ type: 'zone', data }); }
  function openRackModal(data = null) { setForm(data || { code: '', name: '', zone_id: selectedZone, num_shelves: 4, slots_per_shelf: 6, capacity_per_slot: 0, capacity_unit: '' }); setModal({ type: 'rack', data }); }

  async function handleSave() {
    setSaving(true);
    try {
      const t = modal.type;
      const url = modal.data
        ? `${API}/api/wms/${t}s/${modal.data.id}`
        : `${API}/api/wms/${t}s`;
      const method = modal.data ? 'PUT' : 'POST';
      const r = await fetch(url, { method, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || 'Gagal menyimpan');
      toast.success(d.message || 'Berhasil');
      setModal(null);
      if (t === 'building') loadBuildings();
      if (t === 'zone') loadZones(selectedBldg);
      if (t === 'rack') loadRacks(selectedZone);
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(type, id) {
    if (!confirm('Nonaktifkan item ini?')) return;
    try {
      const r = await fetch(`${API}/api/wms/${type}s/${id}`, { method: 'DELETE', headers });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail);
      toast.success(d.message || 'Berhasil');
      if (type === 'building') loadBuildings();
      if (type === 'zone') loadZones(selectedBldg);
      if (type === 'rack') loadRacks(selectedZone);
    } catch (e) { toast.error(e.message); }
  }

  return (
    <div className="space-y-4">
      {/* Breadcrumb nav */}
      <div className="flex items-center gap-2 text-sm">
        <button onClick={() => { setView('buildings'); setSelectedBldg(null); setSelectedZone(null); }} className={`${view === 'buildings' ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'} transition-colors`}>
          <Building2 size={14} className="inline mr-1" />Gedung
        </button>
        {selectedBldg && <>
          <ChevronRight size={14} className="text-muted-foreground" />
          <button onClick={() => { setView('zones'); setSelectedZone(null); }} className={`${view === 'zones' ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'}`}>
            <Layers size={14} className="inline mr-1" />{buildings.find(b => b.id === selectedBldg)?.name}
          </button>
        </>}
        {selectedZone && <>
          <ChevronRight size={14} className="text-muted-foreground" />
          <span className="text-foreground font-medium"><Settings size={14} className="inline mr-1" />{zones.find(z => z.id === selectedZone)?.name}</span>
        </>}
      </div>

      {/* BUILDINGS */}
      {view === 'buildings' && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Gedung ({buildings.length})</h3>
            <button data-testid="add-building-btn" onClick={() => openBldgModal()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-xs font-medium transition-colors">
              <Plus size={13} /> Tambah Gedung
            </button>
          </div>
          {buildings.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="Belum ada gedung"
              description="Klik 'Tambah Gedung' di atas atau gunakan 'Seed Demo' di tab Dashboard untuk mengisi data contoh."
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {buildings.map(b => (
                <div key={b.id} data-testid="building-card" className="bg-white/3 border border-white/8 rounded-2xl p-4 hover:border-violet-500/30 transition-all cursor-pointer"
                  onClick={() => { setSelectedBldg(b.id); loadZones(b.id); setView('zones'); }}>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-bold text-lg">{b.code}</div>
                      <div className="text-sm text-muted-foreground">{b.name}</div>
                      {b.address && <div className="text-xs text-muted-foreground mt-0.5">{b.address}</div>}
                    </div>
                    <div className="flex gap-1.5">
                      <button onClick={e => { e.stopPropagation(); openBldgModal(b); }} className="text-muted-foreground hover:text-foreground p-1"><Edit2 size={13} /></button>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-3 text-xs text-muted-foreground">
                    <span><Layers size={12} className="inline mr-1" />{b.zone_count} zona</span>
                    <span><Settings size={12} className="inline mr-1" />{b.rack_count} rak</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ZONES */}
      {view === 'zones' && selectedBldg && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Zona ({zones.length})</h3>
            <button data-testid="add-zone-btn" onClick={() => openZoneModal()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-xs font-medium transition-colors">
              <Plus size={13} /> Tambah Zona
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {zones.map(z => (
              <div key={z.id} data-testid="zone-card" className="bg-white/3 border border-white/8 rounded-2xl p-4 hover:border-violet-500/30 cursor-pointer transition-all"
                onClick={() => { setSelectedZone(z.id); loadRacks(z.id); setView('racks'); }}>
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="font-bold">{z.code}</div>
                    <div className="text-sm text-muted-foreground">{z.name}</div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={e => { e.stopPropagation(); openZoneModal(z); }} className="text-muted-foreground hover:text-foreground p-1"><Edit2 size={13} /></button>
                    <button onClick={e => { e.stopPropagation(); handleDelete('zone', z.id); }} className="text-muted-foreground hover:text-red-400 p-1"><Trash2 size={13} /></button>
                  </div>
                </div>
                <Badge cls={ZONE_TYPE_COLORS[z.zone_type] || ZONE_TYPE_COLORS.general}>{ZONE_TYPE_LABELS[z.zone_type]}</Badge>
                <div className="text-xs text-muted-foreground mt-2">{z.rack_count} rak</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* RACKS */}
      {view === 'racks' && selectedZone && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Rak ({racks.length})</h3>
            <button data-testid="add-rack-btn" onClick={() => openRackModal()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-xs font-medium transition-colors">
              <Plus size={13} /> Tambah Rak
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {racks.map(rack => (
              <div key={rack.id} data-testid="rack-card" className="bg-white/3 border border-white/8 rounded-2xl p-4 hover:border-violet-500/30 transition-all">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="font-bold">{rack.code}</div>
                    <div className="text-xs text-muted-foreground">{rack.name}</div>
                  </div>
                  <div className="flex gap-1">
                    <button
                      data-testid="print-rack-labels-btn"
                      onClick={() => window.open(`${API}/api/wms/racks/${rack.id}/labels-pdf?token=${encodeURIComponent(token)}`, '_blank')}
                      className="text-violet-400 hover:text-violet-300 p-1"
                      title="Cetak label barcode untuk semua posisi di rak ini">
                      <Printer size={13} />
                    </button>
                    <button onClick={() => openRackModal(rack)} className="text-muted-foreground hover:text-foreground p-1"><Edit2 size={13} /></button>
                    <button onClick={() => handleDelete('rack', rack.id)} className="text-muted-foreground hover:text-red-400 p-1"><Trash2 size={13} /></button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs mb-2">
                  <div className="bg-white/5 rounded-lg p-2"><div className="text-muted-foreground">Shelves</div><div className="font-bold">{rack.num_shelves}</div></div>
                  <div className="bg-white/5 rounded-lg p-2"><div className="text-muted-foreground">Slot/Shelf</div><div className="font-bold">{rack.slots_per_shelf}</div></div>
                  <div className="bg-white/5 rounded-lg p-2"><div className="text-muted-foreground">Total Posisi</div><div className="font-bold">{rack.total_positions}</div></div>
                  <div className="bg-white/5 rounded-lg p-2"><div className="text-muted-foreground">Terisi</div><div className="font-bold text-emerald-400">{rack.occupied_positions}</div></div>
                </div>
                <div className="h-1.5 rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${rack.occupancy_pct}%` }} />
                </div>
                <div className="text-xs text-right mt-0.5 text-muted-foreground">{rack.occupancy_pct}% terisi</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MODAL */}
      {modal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-[hsl(var(--card))] border border-white/10 rounded-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold capitalize">{modal.data ? 'Edit' : 'Tambah'} {modal.type === 'building' ? 'Gedung' : modal.type === 'zone' ? 'Zona' : 'Rak'}</h3>
              <button onClick={() => setModal(null)}><X size={18} /></button>
            </div>
            <div className="space-y-3">
              {modal.type === 'building' && <>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-xs mb-1.5">Kode *</label><input value={form.code||''} onChange={e => setForm(f => ({...f, code: e.target.value}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm" placeholder="WH1" /></div>
                  <div><label className="block text-xs mb-1.5">Nama *</label><input value={form.name||''} onChange={e => setForm(f => ({...f, name: e.target.value}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm" placeholder="Gudang Utama" /></div>
                </div>
                <div><label className="block text-xs mb-1.5">Alamat</label><input value={form.address||''} onChange={e => setForm(f => ({...f, address: e.target.value}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm" /></div>
              </>}
              {modal.type === 'zone' && <>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-xs mb-1.5">Kode *</label><input value={form.code||''} onChange={e => setForm(f => ({...f, code: e.target.value}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm" placeholder="RM" /></div>
                  <div><label className="block text-xs mb-1.5">Nama *</label><input value={form.name||''} onChange={e => setForm(f => ({...f, name: e.target.value}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm" /></div>
                </div>
                <div><label className="block text-xs mb-1.5">Tipe Zona</label>
                  <select value={form.zone_type||'general'} onChange={e => setForm(f => ({...f, zone_type: e.target.value}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm">
                    <option value="rm">Bahan Baku (RM)</option><option value="fg">Barang Jadi (FG)</option><option value="wip">Work-in-Progress</option><option value="transit">Transit</option><option value="general">Umum</option>
                  </select>
                </div>
              </>}
              {modal.type === 'rack' && <>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-xs mb-1.5">Kode *</label><input value={form.code||''} onChange={e => setForm(f => ({...f, code: e.target.value}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm" placeholder="R01" /></div>
                  <div><label className="block text-xs mb-1.5">Nama *</label><input value={form.name||''} onChange={e => setForm(f => ({...f, name: e.target.value}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-xs mb-1.5">Jumlah Shelf</label><input type="number" min="1" max="50" value={form.num_shelves||4} onChange={e => setForm(f => ({...f, num_shelves: +e.target.value}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm" /></div>
                  <div><label className="block text-xs mb-1.5">Slot per Shelf</label><input type="number" min="1" max="100" value={form.slots_per_shelf||6} onChange={e => setForm(f => ({...f, slots_per_shelf: +e.target.value}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-xs mb-1.5">Kapasitas/Slot</label><input type="number" min="0" value={form.capacity_per_slot||0} onChange={e => setForm(f => ({...f, capacity_per_slot: +e.target.value}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm" /></div>
                  <div><label className="block text-xs mb-1.5">Satuan Kapasitas</label><input value={form.capacity_unit||''} onChange={e => setForm(f => ({...f, capacity_unit: e.target.value}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm" placeholder="kg, pcs, ..." /></div>
                </div>
                <div className="text-xs text-muted-foreground bg-white/3 rounded-lg p-2">
                  Total posisi yang akan dibuat: <span className="font-bold text-foreground">{(form.num_shelves||4) * (form.slots_per_shelf||6)}</span> slot
                  {!modal.data && <span className="text-xs"> — Barcode otomatis dibuat per slot</span>}
                </div>
              </>}
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setModal(null)} className="flex-1 py-2 rounded-lg border border-white/10 text-sm hover:bg-white/5">Batal</button>
              <button data-testid="modal-save-btn" onClick={handleSave} disabled={saving} className="flex-1 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-sm font-medium disabled:opacity-50">
                {saving ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// TAB: SATUAN & KONVERSI
// ──────────────────────────────────────────────────────────────────────────────
function UnitsTab({ token }) {
  const [units, setUnits] = useState([]);
  const [conversions, setConversions] = useState([]);
  const [subTab, setSubTab] = useState('units');
  const [calcForm, setCalcForm] = useState({ qty: 1, from_unit: '', to_unit: '' });
  const [calcResult, setCalcResult] = useState(null);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const load = useCallback(async () => {
    const [u, c] = await Promise.all([
      fetch(`${API}/api/wms/units`, { headers }).then(r => r.json()),
      fetch(`${API}/api/wms/unit-conversions`, { headers }).then(r => r.json()),
    ]);
    setUnits(Array.isArray(u) ? u : []);
    setConversions(Array.isArray(c) ? c : []);
  }, [headers]);
  useEffect(() => { load(); }, [load]);

  async function handleSave() {
    setSaving(true);
    try {
      const url = modal.type === 'unit'
        ? (modal.data ? `${API}/api/wms/units/${modal.data.id}` : `${API}/api/wms/units`)
        : (modal.data ? `${API}/api/wms/unit-conversions/${modal.data.id}` : `${API}/api/wms/unit-conversions`);
      const r = await fetch(url, { method: modal.data ? 'PUT' : 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || 'Gagal');
      toast.success(d.message || 'Berhasil'); setModal(null); load();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  async function handleCalc() {
    try {
      const r = await fetch(`${API}/api/wms/units/convert`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ qty: +calcForm.qty, from_unit: calcForm.from_unit, to_unit: calcForm.to_unit }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail);
      setCalcResult(d);
    } catch (e) { toast.error(e.message); }
  }

  const CATEGORIES = [...new Set(units.map(u => u.category))].sort();

  return (
    <div className="space-y-4">
      <div className="flex gap-1 p-1 bg-white/5 rounded-xl w-fit">
        {['units', 'conversions', 'calculator'].map(t => (
          <button key={t} onClick={() => setSubTab(t)} className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${subTab === t ? 'bg-violet-600 text-white' : 'text-muted-foreground hover:text-foreground'}`}>
            {t === 'units' ? 'Master Satuan' : t === 'conversions' ? 'Aturan Konversi' : 'Kalkulator'}
          </button>
        ))}
      </div>

      {/* MASTER SATUAN */}
      {subTab === 'units' && (
        <div>
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-semibold">Master Satuan ({units.length})</h3>
            <div className="flex gap-2">
              <button onClick={async () => { await fetch(`${API}/api/wms/units/seed`, { method: 'POST', headers }); toast.success('Seed satuan selesai'); load(); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-xs hover:bg-white/5">
                <RefreshCw size={12} /> Seed Default
              </button>
              <button data-testid="add-unit-btn" onClick={() => { setForm({ code: '', name: '', category: 'count', symbol: '', is_base: false }); setModal({ type: 'unit', data: null }); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-xs font-medium transition-colors">
                <Plus size={12} /> Tambah Satuan
              </button>
            </div>
          </div>
          {CATEGORIES.map(cat => (
            <div key={cat} className="mb-4">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{cat}</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                {units.filter(u => u.category === cat).map(u => (
                  <div key={u.id} data-testid="unit-card" className="bg-white/3 border border-white/8 rounded-xl p-3 flex items-center justify-between group">
                    <div>
                      <div className="font-bold text-sm">{u.code}</div>
                      <div className="text-xs text-muted-foreground">{u.name}</div>
                      {u.is_base && <span className="text-[10px] text-violet-400">base</span>}
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => { setForm({...u}); setModal({ type: 'unit', data: u }); }} className="text-muted-foreground hover:text-foreground p-0.5"><Edit2 size={11} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* KONVERSI */}
      {subTab === 'conversions' && (
        <div>
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-semibold">Aturan Konversi ({conversions.length})</h3>
            <button data-testid="add-conversion-btn" onClick={() => { setForm({ from_unit_code: '', to_unit_code: '', factor: 1, notes: '' }); setModal({ type: 'conversion', data: null }); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-xs font-medium transition-colors">
              <Plus size={12} /> Tambah Konversi
            </button>
          </div>
          <div className="overflow-auto rounded-xl border border-white/8">
            <table className="w-full text-sm">
              <thead className="bg-white/3"><tr>{['Dari', 'Ke', 'Faktor', 'Formula', 'Catatan', 'Aksi'].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">{h}</th>)}</tr></thead>
              <tbody>
                {conversions.map(c => (
                  <tr key={c.id} data-testid="conversion-row" className="border-t border-white/5">
                    <td className="px-4 py-3 font-bold">{c.from_unit_code}</td>
                    <td className="px-4 py-3 font-bold">{c.to_unit_code}</td>
                    <td className="px-4 py-3 font-mono text-emerald-400">{c.factor}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground font-mono">qty × {c.factor}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{c.notes || '-'}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => { setForm({...c}); setModal({ type: 'conversion', data: c }); }} className="text-muted-foreground hover:text-foreground mr-2"><Edit2 size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* KALKULATOR */}
      {subTab === 'calculator' && (
        <div className="max-w-sm">
          <h3 className="text-sm font-semibold mb-3">Kalkulator Konversi Satuan</h3>
          <div className="space-y-3 bg-white/3 border border-white/8 rounded-2xl p-5">
            <div><label className="text-xs mb-1 block">Jumlah</label>
              <input type="number" value={calcForm.qty} onChange={e => setCalcForm(f => ({...f, qty: e.target.value}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs mb-1 block">Dari</label>
                <select value={calcForm.from_unit} onChange={e => setCalcForm(f => ({...f, from_unit: e.target.value}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm">
                  <option value="">Pilih</option>{units.map(u => <option key={u.id} value={u.code}>{`${u.code} (${u.name})`}</option>)}
                </select>
              </div>
              <div><label className="text-xs mb-1 block">Ke</label>
                <select value={calcForm.to_unit} onChange={e => setCalcForm(f => ({...f, to_unit: e.target.value}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm">
                  <option value="">Pilih</option>{units.map(u => <option key={u.id} value={u.code}>{`${u.code} (${u.name})`}</option>)}
                </select>
              </div>
            </div>
            <button data-testid="calculate-btn" onClick={handleCalc} className="w-full py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-sm font-medium transition-colors">Hitung Konversi</button>
            {calcResult && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-emerald-400">{fmt(calcResult.result)} {calcResult.to}</div>
                <div className="text-xs text-muted-foreground mt-1">{calcResult.input} {calcResult.from} × {calcResult.factor}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL Unit / Conversion */}
      {modal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-[hsl(var(--card))] border border-white/10 rounded-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold">{modal.data ? 'Edit' : 'Tambah'} {modal.type === 'unit' ? 'Satuan' : 'Konversi'}</h3>
              <button onClick={() => setModal(null)}><X size={18} /></button>
            </div>
            {modal.type === 'unit' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-xs mb-1 block">Kode *</label><input value={form.code||''} onChange={e => setForm(f => ({...f, code: e.target.value}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm" placeholder="rol" /></div>
                  <div><label className="text-xs mb-1 block">Simbol *</label><input value={form.symbol||''} onChange={e => setForm(f => ({...f, symbol: e.target.value}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm" /></div>
                </div>
                <div><label className="text-xs mb-1 block">Nama *</label><input value={form.name||''} onChange={e => setForm(f => ({...f, name: e.target.value}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm" /></div>
                <div><label className="text-xs mb-1 block">Kategori</label>
                  <select value={form.category||'count'} onChange={e => setForm(f => ({...f, category: e.target.value}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm">
                    {['weight','length','count','roll','pack','volume','other'].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
            )}
            {modal.type === 'conversion' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-xs mb-1 block">Dari *</label>
                    <select value={form.from_unit_code||''} onChange={e => setForm(f => ({...f, from_unit_code: e.target.value}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm">
                      <option value="">Pilih</option>{units.map(u => <option key={u.id} value={u.code}>{u.code}</option>)}
                    </select>
                  </div>
                  <div><label className="text-xs mb-1 block">Ke *</label>
                    <select value={form.to_unit_code||''} onChange={e => setForm(f => ({...f, to_unit_code: e.target.value}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm">
                      <option value="">Pilih</option>{units.map(u => <option key={u.id} value={u.code}>{u.code}</option>)}
                    </select>
                  </div>
                </div>
                <div><label className="text-xs mb-1 block">Faktor Pengali *</label><input type="number" step="0.000001" value={form.factor||1} onChange={e => setForm(f => ({...f, factor: +e.target.value}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm" /></div>
                {form.from_unit_code && form.to_unit_code && <div className="text-xs text-muted-foreground bg-white/5 rounded-lg p-2">1 {form.from_unit_code} = {form.factor||1} {form.to_unit_code}</div>}
                <div><label className="text-xs mb-1 block">Catatan</label><input value={form.notes||''} onChange={e => setForm(f => ({...f, notes: e.target.value}))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm" /></div>
              </div>
            )}
            <div className="flex gap-3 mt-5">
              <button onClick={() => setModal(null)} className="flex-1 py-2 rounded-lg border border-white/10 text-sm hover:bg-white/5">Batal</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-sm font-medium disabled:opacity-50">{saving ? 'Menyimpan...' : 'Simpan'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// TAB: RECEIVING (Scan In / Scan Out)
// ──────────────────────────────────────────────────────────────────────────────
function ReceivingTab({ token }) {
  const [pending, setPending] = useState([]);
  const [filter, setFilter] = useState('all');
  const [buildingFilter, setBuildingFilter] = useState('');
  const [buildings, setBuildings] = useState([]);
  const [scanModal, setScanModal] = useState(null); // {movement, mode: 'in'|'out'}
  const [scanQty, setScanQty] = useState('');
  const [positionBarcode, setPositionBarcode] = useState('');
  const [positionInfo, setPositionInfo] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  useEffect(() => {
    fetch(`${API}/api/wms/buildings`, { headers }).then(r => r.json()).then(d => setBuildings(Array.isArray(d) ? d : [])).catch(() => {});
  }, [headers]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter !== 'all') params.set('type', filter);
      if (buildingFilter) params.set('building_id', buildingFilter);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const r = await fetch(`${API}/api/wms/pending${qs}`, { headers });
      const d = await r.json();
      setPending(Array.isArray(d) ? d.filter(m => m.status !== 'cancelled' && m.status !== 'confirmed') : []);
    } catch { toast.error('Gagal memuat data'); }
    finally { setLoading(false); }
  }, [headers, filter, buildingFilter]);
  useEffect(() => { load(); }, [load]);

  async function lookupPosition(barcode) {
    if (!barcode) return;
    try {
      const r = await fetch(`${API}/api/wms/positions/by-barcode/${encodeURIComponent(barcode)}`, { headers });
      if (r.ok) setPositionInfo(await r.json());
      else setPositionInfo(null);
    } catch { setPositionInfo(null); }
  }

  async function handleScan() {
    if (!scanModal || !scanQty || +scanQty <= 0) { toast.error('Masukkan jumlah yang valid'); return; }
    setSubmitting(true);
    try {
      const { movement, mode } = scanModal;
      const endpoint = mode === 'in' ? 'scan-in' : 'scan-out';
      const body = mode === 'in'
        ? { scanned_qty: +scanQty, position_barcode: positionBarcode || undefined }
        : { scanned_qty: +scanQty, position_barcode: positionBarcode || undefined };
      const r = await fetch(`${API}/api/wms/pending/${movement.id}/${endpoint}`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || 'Gagal');
      toast.success(`${mode === 'in' ? 'Scan-in' : 'Scan-out'} berhasil: ${d.ref_number} — ${d.status}`);
      setScanModal(null); setScanQty(''); setPositionBarcode(''); setPositionInfo(null);
      load();
    } catch (e) { toast.error(e.message); }
    finally { setSubmitting(false); }
  }

  const TYPE_ICON = { inbound: ArrowDownToLine, outbound_rm: ArrowUpFromLine, outbound_fg: ArrowUpFromLine };
  const TYPE_LABEL = { inbound: 'Inbound FG', outbound_rm: 'Outbound Bahan', outbound_fg: 'Outbound FG' };
  const TYPE_COLOR = { inbound: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10', outbound_rm: 'text-amber-400 border-amber-500/30 bg-amber-500/10', outbound_fg: 'text-orange-400 border-orange-500/30 bg-orange-500/10' };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 p-1 bg-white/5 rounded-xl">
          {['all', 'inbound', 'outbound_rm', 'outbound_fg'].map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${filter === f ? 'bg-violet-600 text-white' : 'text-muted-foreground hover:text-foreground'}`}>
              {f === 'all' ? 'Semua' : TYPE_LABEL[f]}
            </button>
          ))}
        </div>
        {buildings.length > 0 && (
          <select data-testid="receiving-building-filter" value={buildingFilter} onChange={e => setBuildingFilter(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs">
            <option value="">Semua Gedung</option>
            {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <button onClick={load} className="text-muted-foreground hover:text-foreground"><RefreshCw size={14} /></button>
      </div>

      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
        </div>
      )}

      {!loading && pending.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <PackageCheck className="mx-auto mb-3 opacity-30" size={40} />
          <p className="text-sm">Tidak ada pending movement{filter !== 'all' ? ` untuk ${TYPE_LABEL[filter]}` : ''}.</p>
        </div>
      )}

      {!loading && pending.length > 0 && (
        <div className="space-y-2">
          {pending.map(m => {
            const Icon = TYPE_ICON[m.type] || Package;
            return (
              <div key={m.id} data-testid="pending-movement-row" className="flex items-center gap-4 bg-white/3 border border-white/8 rounded-2xl p-4">
                <div className={`flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${TYPE_COLOR[m.type]}`}>
                  <Icon size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-violet-400">{m.ref_number}</span>
                    <Badge cls={TYPE_COLOR[m.type]}>{TYPE_LABEL[m.type]}</Badge>
                    <span className={`text-xs font-medium ${STATUS_COLORS[m.status]}`}>{m.status}</span>
                  </div>
                  <div className="font-medium text-sm mt-0.5">{m.material_name}</div>
                  <div className="text-xs text-muted-foreground">{m.source_ref || m.source_type} · {m.scanned_qty}/{m.expected_qty} {m.unit}</div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  {m.type === 'inbound' && (
                    <button
                      data-testid="scan-in-btn"
                      onClick={() => { setScanModal({ movement: m, mode: 'in' }); setScanQty(String(m.expected_qty - (m.scanned_qty || 0))); setPositionBarcode(''); setPositionInfo(null); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs hover:bg-emerald-500/30 transition-colors"
                    >
                      <Scan size={13} /> Scan In
                    </button>
                  )}
                  {(m.type === 'outbound_rm' || m.type === 'outbound_fg') && (
                    <button
                      data-testid="scan-out-btn"
                      onClick={() => { setScanModal({ movement: m, mode: 'out' }); setScanQty(String(m.expected_qty - (m.scanned_qty || 0))); setPositionBarcode(''); setPositionInfo(null); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs hover:bg-amber-500/30 transition-colors"
                    >
                      <Scan size={13} /> Scan Out
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Scan Modal */}
      {scanModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-[#111118] border border-white/10 rounded-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-white">{scanModal.mode === 'in' ? 'Scan In — Terima Barang' : 'Scan Out — Keluarkan Barang'}</h3>
              <button onClick={() => setScanModal(null)} className="text-zinc-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="bg-white/4 rounded-xl p-3 mb-4">
              <div className="font-medium text-white text-sm">{scanModal.movement.material_name}</div>
              <div className="text-xs text-zinc-400 mt-1">
                Ref: {scanModal.movement.ref_number} · Sumber: {scanModal.movement.source_ref || scanModal.movement.source_type}
              </div>
              <div className="text-xs text-zinc-400">Expected: {scanModal.movement.expected_qty} {scanModal.movement.unit} · Scanned: {scanModal.movement.scanned_qty || 0}</div>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">Jumlah yang {scanModal.mode === 'in' ? 'Diterima' : 'Dikeluarkan'} *</label>
                <input type="number" min="0.01" step="0.01" value={scanQty} onChange={e => setScanQty(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white" />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">
                  {scanModal.mode === 'in' ? 'Barcode Posisi Tujuan (Scan Rak)' : 'Barcode Posisi Asal (Scan Rak)'}
                  <span className="text-zinc-500 ml-1">— opsional</span>
                </label>
                <ScannerInput
                  placeholder={`Scan label rak (mis: WH1-RM-R01-S01-P01)`}
                  onScan={v => { setPositionBarcode(v); lookupPosition(v); }}
                />
                {positionBarcode && (
                  <div className="text-xs mt-1">
                    {positionInfo ? (
                      <span className="text-emerald-400"><MapPin size={11} className="inline mr-1" />{positionInfo.label} — {positionInfo.building_code}/{positionInfo.zone_code}/{positionInfo.rack_code}</span>
                    ) : (
                      <span className="text-amber-400"><AlertCircle size={11} className="inline mr-1" />Posisi tidak ditemukan: {positionBarcode}</span>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setScanModal(null)} className="flex-1 py-3 rounded-xl border border-white/10 text-sm hover:bg-white/5">Batal</button>
              <button
                data-testid="confirm-scan-btn"
                onClick={handleScan}
                disabled={submitting || !scanQty}
                className={`flex-1 py-3 rounded-xl text-white text-sm font-medium disabled:opacity-50 transition-colors ${scanModal.mode === 'in' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700'}`}
              >
                {submitting ? 'Memproses...' : scanModal.mode === 'in' ? 'Konfirmasi Terima' : 'Konfirmasi Keluar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// TAB: POSISI & PENCARIAN
// ──────────────────────────────────────────────────────────────────────────────
function PositionsTab({ token }) {
  const [searchQ, setSearchQ] = useState('');
  const [searchResult, setSearchResult] = useState(null);
  const [searching, setSearching] = useState(false);
  const [buildings, setBuildings] = useState([]);
  const [selectedBldg, setSelectedBldg] = useState('');
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  useEffect(() => {
    fetch(`${API}/api/wms/buildings`, { headers }).then(r => r.json()).then(d => setBuildings(Array.isArray(d) ? d : []));
  }, [headers]);

  async function doSearch(q) {
    if (!q?.trim()) return;
    setSearchQ(q);
    setSearching(true);
    try {
      const url = `${API}/api/wms/search?q=${encodeURIComponent(q)}${selectedBldg ? `&building_id=${selectedBldg}` : ''}`;
      const r = await fetch(url, { headers });
      const d = await r.json();
      setSearchResult(d);
    } catch { toast.error('Pencarian gagal'); }
    finally { setSearching(false); }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold mb-2">Smart Search — Cari Posisi Barang</h3>
        <p className="text-xs text-muted-foreground mb-3">Scan barcode rak, barcode material, atau ketik nama/kode produk</p>
        <div className="flex gap-3">
          {buildings.length > 1 && (
            <select value={selectedBldg} onChange={e => setSelectedBldg(e.target.value)} className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm flex-shrink-0">
              <option value="">Semua Gedung</option>
              {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <ScannerInput
            className="flex-1"
            placeholder="Scan barcode atau ketik nama produk..."
            onScan={doSearch}
          />
        </div>
        <p className="text-xs text-muted-foreground mt-1">Tekan Enter setelah mengetik / scanning</p>
      </div>

      {searching && <div className="text-center py-8 text-muted-foreground text-sm">Mencari...</div>}

      {searchResult && !searching && (
        <div className="space-y-4">
          {searchResult.type === 'position' ? (
            <div className="bg-white/3 border border-white/8 rounded-2xl p-5">
              <div className="text-xs font-semibold text-violet-400 mb-3">Posisi Ditemukan</div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Barcode:</span> <span className="font-mono">{searchResult.result.barcode}</span></div>
                <div><span className="text-muted-foreground">Label:</span> {searchResult.result.label}</div>
                <div><span className="text-muted-foreground">Lokasi:</span> {searchResult.result.building_code}/{searchResult.result.zone_code}/{searchResult.result.rack_code}</div>
                <div><span className="text-muted-foreground">Status:</span> <Badge cls={searchResult.result.status === 'occupied' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30'}>{searchResult.result.status}</Badge></div>
                {searchResult.result.material_name && <>
                  <div><span className="text-muted-foreground">Produk:</span> {searchResult.result.material_name}</div>
                  <div><span className="text-muted-foreground">Stok:</span> <span className="font-bold text-emerald-400">{fmt(searchResult.result.qty)} {searchResult.result.unit}</span></div>
                </>}
              </div>
            </div>
          ) : (
            <div>
              {(searchResult.materials || []).length > 0 && (
                <div className="mb-3">
                  <div className="text-xs font-semibold text-muted-foreground mb-2">Material Cocok</div>
                  <div className="flex flex-wrap gap-2">
                    {searchResult.materials.map(m => (
                      <span key={m.id} className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm">
                        <span className="font-bold">{m.code}</span> — {m.name}
                      </span>
                    ))}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Total stok di gudang: <span className="font-bold text-foreground">{fmt(searchResult.total_qty)}</span></div>
                </div>
              )}
              {(searchResult.positions || []).length > 0 ? (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground mb-2">Lokasi Penyimpanan</div>
                  <div className="space-y-2">
                    {searchResult.positions.map(pos => (
                      <div key={pos.id} data-testid="position-result" className="flex items-center gap-4 bg-white/3 border border-white/8 rounded-xl p-3">
                        <MapPin size={16} className="text-violet-400 flex-shrink-0" />
                        <div className="flex-1">
                          <div className="font-mono text-sm text-violet-400">{pos.barcode}</div>
                          <div className="text-xs text-muted-foreground">{pos.building_code} / {pos.zone_code} / {pos.rack_code} / {pos.label}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-emerald-400">{fmt(pos.qty)} {pos.unit}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground text-center py-4">Tidak ada data posisi tersimpan untuk item ini.</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// TAB: STOCK OPNAME (Cycle Count) — scanner-based per rak
// ──────────────────────────────────────────────────────────────────────────────
function OpnameTab({ token }) {
  const [view, setView] = useState('list'); // list | start | scan
  const [sessions, setSessions] = useState([]);
  const [racks, setRacks] = useState([]);
  const [selectedRackId, setSelectedRackId] = useState('');
  const [activeSession, setActiveSession] = useState(null);
  const [lines, setLines] = useState([]);
  const [scanQty, setScanQty] = useState('');
  const [scanBarcode, setScanBarcode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [completion, setCompletion] = useState(null);
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      // FORENSIC_12 GAP-02: was /api/wms/opname (deprecated), now SSOT /api/wms/opname2
      const r = await fetch(`${API}/api/wms/opname2?limit=30`, { headers });
      const d = await r.json();
      setSessions(Array.isArray(d) ? d : []);
    } catch { toast.error('Gagal memuat sesi opname'); }
    finally { setLoading(false); }
  }, [headers]);

  const loadRacks = useCallback(async () => {
    const r = await fetch(`${API}/api/wms/racks`, { headers });
    const d = await r.json();
    setRacks(Array.isArray(d) ? d : []);
  }, [headers]);

  useEffect(() => {
    loadSessions();
    loadRacks();
  }, [loadSessions, loadRacks]);

  async function handleStart() {
    if (!selectedRackId) { toast.error('Pilih rak terlebih dahulu'); return; }
    setSubmitting(true);
    try {
      // FORENSIC_12 GAP-02: was /api/wms/opname/start (deprecated), now SSOT /api/wms/opname2/start
      const r = await fetch(`${API}/api/wms/opname2/start`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rack_id: selectedRackId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || 'Gagal start opname');
      toast.success(d.message);
      await openSession(d.session_id);
    } catch (e) { toast.error(e.message); }
    finally { setSubmitting(false); }
  }

  async function openSession(sessionId) {
    setLoading(true);
    try {
      // FORENSIC_12 GAP-02: was /api/wms/opname/{id} (deprecated), now SSOT /api/wms/opname2/{id}
      const r = await fetch(`${API}/api/wms/opname2/${sessionId}`, { headers });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || 'Gagal');
      setActiveSession(d);
      setLines(d.lines || []);
      setView('scan');
      setCompletion(null);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }

  async function handleScan(barcode) {
    const bc = (barcode || scanBarcode).trim();
    if (!bc) { toast.error('Masukkan barcode'); return; }
    if (!scanQty || +scanQty < 0) { toast.error('Masukkan qty fisik'); return; }
    setSubmitting(true);
    try {
      // FORENSIC_12 GAP-02: was /api/wms/opname/{id}/scan (deprecated), now SSOT /api/wms/opname2/{id}/scan
      const r = await fetch(`${API}/api/wms/opname2/${activeSession.id}/scan`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ position_barcode: bc, counted_qty: +scanQty }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || 'Gagal scan');
      const diffLabel = d.diff > 0 ? `+${d.diff} surplus` : d.diff < 0 ? `${d.diff} kurang` : 'sesuai';
      toast.success(`${bc} → counted ${d.counted_qty} (${diffLabel}). Sisa ${d.remaining}/${d.total_positions}`);
      setScanBarcode(''); setScanQty('');
      await openSession(activeSession.id);
    } catch (e) { toast.error(e.message); }
    finally { setSubmitting(false); }
  }

  async function handleComplete() {
    if (!confirm('Selesaikan opname dan terapkan adjustment ke stok? Aksi ini tidak bisa dibatalkan.')) return;
    setSubmitting(true);
    try {
      // FORENSIC_12 GAP-02: was /api/wms/opname/{id}/complete (deprecated), now SSOT /api/wms/opname2/{id}/complete
      const r = await fetch(`${API}/api/wms/opname2/${activeSession.id}/complete`, {
        method: 'POST', headers,
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || 'Gagal complete');
      toast.success(d.message);
      setCompletion(d);
      await loadSessions();
    } catch (e) { toast.error(e.message); }
    finally { setSubmitting(false); }
  }

  async function handleCancel() {
    if (!confirm('Batalkan sesi opname ini? Hasil scan akan dibuang.')) return;
    try {
      // FORENSIC_12 GAP-02: was /api/wms/opname/{id}/cancel (deprecated), now SSOT /api/wms/opname2/{id}/cancel
      const r = await fetch(`${API}/api/wms/opname2/${activeSession.id}/cancel`, { method: 'POST', headers });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail);
      toast.success(d.message);
      setActiveSession(null); setLines([]); setView('list');
      loadSessions();
    } catch (e) { toast.error(e.message); }
  }

  const SES_STATUS_COLORS = {
    in_progress: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
    completed:   'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
    cancelled:   'text-zinc-500 border-zinc-500/30 bg-zinc-500/10',
  };

  // ─── VIEW: LIST ──────────────────────────────────────────────────────────
  if (view === 'list') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Sesi Opname ({sessions.length})</h3>
          <button data-testid="start-opname-btn" onClick={() => setView('start')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-xs font-medium transition-colors text-white">
            <Play size={13} /> Mulai Opname Baru
          </button>
        </div>

        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
          </div>
        )}

        {!loading && sessions.length === 0 && (
          <EmptyState
            icon={ClipboardCheck}
            title="Belum ada sesi opname"
            description="Buat sesi opname baru untuk mulai melakukan penghitungan stok gudang."
          />
        )}

        {!loading && sessions.length > 0 && (
          <div className="space-y-2">
            {sessions.map(s => (
              <div key={s.id} data-testid="opname-session-row" className="flex items-center gap-4 bg-white/3 border border-white/8 rounded-2xl p-4 hover:border-violet-500/30 transition-all">
                <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-violet-500/10 border border-violet-500/30 flex items-center justify-center">
                  <ClipboardCheck size={16} className="text-violet-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-violet-400">{s.ref_number}</span>
                    <Badge cls={SES_STATUS_COLORS[s.status] || 'text-zinc-400 border-zinc-500/30 bg-zinc-500/10'}>{s.status}</Badge>
                    <span className="text-xs text-muted-foreground">Rak: {s.building_code}-{s.zone_code}-{s.rack_code}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {s.scanned_positions || 0}/{s.total_positions} posisi · oleh {s.started_by_name || s.started_by}
                    {s.summary && <> · <span className="text-emerald-400">+{s.summary.surplus || 0} surplus</span> · <span className="text-red-400">{s.summary.shortage || 0} shortage</span></>}
                  </div>
                </div>
                {s.status === 'in_progress' && (
                  <button onClick={() => openSession(s.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500/20 text-violet-400 border border-violet-500/30 text-xs hover:bg-violet-500/30 transition-colors">
                    <Scan size={13} /> Lanjutkan
                  </button>
                )}
                {s.status === 'completed' && (
                  <button onClick={() => openSession(s.id)} className="text-xs text-muted-foreground hover:text-foreground">
                    Lihat Detail
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─── VIEW: START NEW SESSION ──────────────────────────────────────────────
  if (view === 'start') {
    const inProgressRackIds = new Set(sessions.filter(s => s.status === 'in_progress').map(s => s.rack_id));
    const availableRacks = racks.filter(r => !inProgressRackIds.has(r.id));
    return (
      <div className="space-y-4 max-w-md">
        <div className="flex items-center gap-2 text-sm">
          <button onClick={() => setView('list')} className="text-muted-foreground hover:text-foreground">← Kembali</button>
        </div>
        <h3 className="text-sm font-semibold">Mulai Sesi Opname Baru</h3>
        <div className="bg-white/3 border border-white/8 rounded-2xl p-5 space-y-3">
          <div>
            <label className="text-xs mb-1 block">Pilih Rak *</label>
            <select data-testid="opname-rack-select" value={selectedRackId} onChange={e => setSelectedRackId(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm">
              <option value="">— Pilih rak —</option>
              {availableRacks.map(r => (
                <option key={r.id} value={r.id}>{`${r.building_code}/${r.zone_code}/${r.code} — ${r.name} (${r.total_positions} posisi)`}</option>
              ))}
            </select>
            {availableRacks.length === 0 && (
              <div className="text-xs text-amber-400 mt-2">Semua rak sudah punya sesi opname aktif. Selesaikan dulu yang berjalan.</div>
            )}
          </div>
          <button data-testid="confirm-start-opname" onClick={handleStart} disabled={submitting || !selectedRackId}
            className="w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-sm font-medium disabled:opacity-50 transition-colors">
            {submitting ? 'Membuat sesi...' : 'Mulai & Buat Snapshot'}
          </button>
          <div className="text-xs text-muted-foreground bg-white/3 rounded-lg p-3 leading-relaxed">
            <Info size={12} className="inline mr-1" />
            Sistem akan snapshot semua posisi rak. Operator scan setiap barcode → input qty fisik → sistem otomatis adjust stok ketika sesi diselesaikan.
          </div>
        </div>
      </div>
    );
  }

  // ─── VIEW: SCAN/PROGRESS ──────────────────────────────────────────────────
  const scanned = lines.filter(l => l.scanned);
  const pct = activeSession?.total_positions ? Math.round(scanned.length / activeSession.total_positions * 100) : 0;
  const isCompleted = activeSession?.status === 'completed';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button onClick={() => { setActiveSession(null); setView('list'); loadSessions(); }} className="text-muted-foreground hover:text-foreground text-sm">← Daftar Sesi</button>
        <div className="text-right text-xs">
          <div className="font-mono text-violet-400">{activeSession?.ref_number}</div>
          <div className="text-muted-foreground">Rak: {activeSession?.building_code}-{activeSession?.zone_code}-{activeSession?.rack_code}</div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="bg-white/3 border border-white/8 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">Progress: {scanned.length}/{activeSession?.total_positions} posisi</span>
          <span className="text-sm font-bold text-violet-400">{pct}%</span>
        </div>
        <div className="h-2 rounded-full bg-white/10">
          <div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        {activeSession?.live_summary && (
          <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2"><TrendingUp size={11} className="inline mr-1 text-emerald-400" /> +{activeSession.live_summary.positions_with_surplus} surplus</div>
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2"><TrendingDown size={11} className="inline mr-1 text-red-400" /> {activeSession.live_summary.positions_with_shortage} shortage</div>
            <div className="bg-white/5 rounded-lg p-2">Δ Total: <span className={activeSession.live_summary.total_diff_qty >= 0 ? 'text-emerald-400' : 'text-red-400'}>{activeSession.live_summary.total_diff_qty > 0 ? '+' : ''}{activeSession.live_summary.total_diff_qty}</span></div>
          </div>
        )}
      </div>

      {/* Completion summary */}
      {(completion || isCompleted) && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-5">
          <div className="font-semibold text-emerald-400 mb-2">✓ Opname Selesai</div>
          {completion?.summary && (
            <div className="text-xs text-foreground/80 space-y-1">
              <div>Posisi di-scan: <span className="font-bold">{completion.summary.total_lines_scanned}</span></div>
              <div>Tanpa perubahan: <span className="font-bold">{completion.summary.no_change}</span></div>
              <div>Surplus (qty +): <span className="font-bold text-emerald-400">{completion.summary.surplus}</span></div>
              <div>Shortage (qty -): <span className="font-bold text-red-400">{completion.summary.shortage}</span></div>
              <div>Total adjustment diterapkan: <span className="font-bold">{completion.summary.total_adjustments}</span></div>
            </div>
          )}
        </div>
      )}

      {/* Scan input */}
      {!isCompleted && !completion && (
        <div className="bg-white/3 border border-white/8 rounded-2xl p-4 space-y-3">
          <div className="text-sm font-semibold flex items-center gap-2"><ScanLine size={14} className="text-violet-400" /> Scan Posisi</div>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_140px_140px] gap-3">
            <ScannerInput
              placeholder="Scan barcode posisi (mis: WH1-RM-R01-S01-P01)"
              onScan={v => { setScanBarcode(v); setTimeout(() => document.querySelector('[data-testid="opname-qty-input"]')?.focus(), 50); }}
            />
            <input
              data-testid="opname-qty-input"
              type="number" min="0" step="0.01"
              value={scanQty} onChange={e => setScanQty(e.target.value)}
              placeholder="Qty fisik"
              onKeyDown={e => { if (e.key === 'Enter' && scanBarcode && scanQty) handleScan(); }}
              className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-violet-500"
            />
            <button data-testid="opname-confirm-scan" onClick={() => handleScan()} disabled={submitting || !scanBarcode || !scanQty}
              className="px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-sm font-medium disabled:opacity-50">
              <Check size={14} className="inline mr-1" /> Konfirmasi
            </button>
          </div>
          {scanBarcode && (
            <div className="text-xs text-muted-foreground">Akan submit untuk: <span className="font-mono text-violet-400">{scanBarcode}</span></div>
          )}
        </div>
      )}

      {/* Lines table */}
      <div className="bg-white/3 border border-white/8 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between">
          <span className="text-sm font-medium">Posisi ({lines.length})</span>
          {!isCompleted && !completion && scanned.length > 0 && (
            <div className="flex gap-2">
              <button onClick={handleCancel} className="text-xs text-red-400 hover:text-red-300">Batalkan Sesi</button>
              <button data-testid="opname-complete-btn" onClick={handleComplete} disabled={submitting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-xs font-medium disabled:opacity-50">
                <StopCircle size={13} /> Selesaikan & Adjust Stok
              </button>
            </div>
          )}
        </div>
        <div className="overflow-auto max-h-[420px]">
          <table className="w-full text-sm">
            <thead className="bg-white/3 sticky top-0">
              <tr className="text-xs text-muted-foreground">
                <th className="px-3 py-2 text-left">Barcode</th>
                <th className="px-3 py-2 text-left">Slot</th>
                <th className="px-3 py-2 text-right">Sistem</th>
                <th className="px-3 py-2 text-right">Hitung</th>
                <th className="px-3 py-2 text-right">Δ Diff</th>
                <th className="px-3 py-2 text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(l => (
                <tr key={l.id} data-testid="opname-line-row" className="border-t border-white/5">
                  <td className="px-3 py-2 font-mono text-xs text-violet-400">{l.position_barcode}</td>
                  <td className="px-3 py-2 text-xs">{l.label}</td>
                  <td className="px-3 py-2 text-right text-xs">{l.system_qty ?? 0}</td>
                  <td className="px-3 py-2 text-right text-xs">{l.scanned ? l.counted_qty : '—'}</td>
                  <td className={`px-3 py-2 text-right text-xs font-bold ${(l.diff || 0) > 0 ? 'text-emerald-400' : (l.diff || 0) < 0 ? 'text-red-400' : 'text-muted-foreground'}`}>
                    {l.scanned ? (l.diff > 0 ? `+${l.diff}` : l.diff) : '—'}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {l.scanned ? <Check size={13} className="inline text-emerald-400" /> : <span className="text-xs text-muted-foreground">⏳</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB: AUDIT TRAIL — history opname adjustment per operator/posisi
// ══════════════════════════════════════════════════════════════════════════════
function AuditTrailTab({ token }) {
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(null);
  const [buildings, setBuildings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [rcaModal, setRcaModal] = useState(null); // {barcode, loading, result, error}
  const [filters, setFilters] = useState({
    operator: '', position_barcode: '', building_id: '',
    date_from: '', date_to: '', direction: '',
  });
  const [page, setPage] = useState({ limit: 50, skip: 0, total: 0 });
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  useEffect(() => {
    fetch(`${API}/api/wms/buildings`, { headers }).then(r => r.json()).then(d => setBuildings(Array.isArray(d) ? d : [])).catch(() => {});
  }, [headers]);

  const qs = useCallback(() => {
    const p = new URLSearchParams();
    if (filters.operator) p.set('operator', filters.operator);
    if (filters.position_barcode) p.set('position_barcode', filters.position_barcode);
    if (filters.building_id) p.set('building_id', filters.building_id);
    if (filters.date_from) p.set('date_from', filters.date_from);
    if (filters.date_to) p.set('date_to', filters.date_to);
    if (filters.direction) p.set('direction', filters.direction);
    return p.toString();
  }, [filters]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qStr = qs();
      const extra = qStr ? `&${qStr}` : '';
      const [listRes, statsRes] = await Promise.all([
        fetch(`${API}/api/wms/audit/adjustments?limit=${page.limit}&skip=${page.skip}${extra}`, { headers }).then(r => r.json()),
        fetch(`${API}/api/wms/audit/adjustments/stats${qStr ? `?${qStr}` : ''}`, { headers }).then(r => r.json()),
      ]);
      setItems(listRes.items || []);
      setPage(p => ({ ...p, total: listRes.total || 0 }));
      setStats(statsRes);
    } catch { toast.error('Gagal memuat audit trail'); }
    finally { setLoading(false); }
  }, [headers, qs, page.limit, page.skip]);

  useEffect(() => { load(); }, [load]);

  const resetFilters = () => {
    setFilters({ operator: '', position_barcode: '', building_id: '', date_from: '', date_to: '', direction: '' });
    setPage({ limit: 50, skip: 0, total: 0 });
  };

  const exportCSV = () => {
    const qStr = qs();
    const url = `${API}/api/wms/audit/adjustments/export-csv?token=${encodeURIComponent(token)}${qStr ? `&${qStr}` : ''}`;
    window.open(url, '_blank');
  };

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="bg-white/3 border border-white/8 rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <History size={14} className="text-violet-400" />
          <span className="text-sm font-semibold">Filter Audit Trail</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          <input data-testid="audit-filter-operator" placeholder="Operator (email)" value={filters.operator}
            onChange={e => setFilters({ ...filters, operator: e.target.value })}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs" />
          <input data-testid="audit-filter-position" placeholder="Barcode posisi" value={filters.position_barcode}
            onChange={e => setFilters({ ...filters, position_barcode: e.target.value })}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono" />
          <select data-testid="audit-filter-building" value={filters.building_id}
            onChange={e => setFilters({ ...filters, building_id: e.target.value })}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs">
            <option value="">Semua Gedung</option>
            {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select data-testid="audit-filter-direction" value={filters.direction}
            onChange={e => setFilters({ ...filters, direction: e.target.value })}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs">
            <option value="">Semua Arah</option>
            <option value="adjust_in">Surplus (Tambah)</option>
            <option value="adjust_out">Shortage (Kurang)</option>
          </select>
          <input data-testid="audit-filter-date-from" type="date" value={filters.date_from}
            onChange={e => setFilters({ ...filters, date_from: e.target.value })}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs" />
          <input data-testid="audit-filter-date-to" type="date" value={filters.date_to}
            onChange={e => setFilters({ ...filters, date_to: e.target.value })}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs" />
        </div>
        <div className="flex gap-2">
          <button data-testid="audit-apply-filters" onClick={() => { setPage(p => ({ ...p, skip: 0 })); load(); }}
            className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-xs font-medium">
            <Search size={12} className="inline mr-1" /> Cari
          </button>
          <button onClick={resetFilters} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs hover:bg-white/10">
            Reset
          </button>
          <button data-testid="audit-export-csv" onClick={exportCSV}
            className="ml-auto px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-xs font-medium">
            <FileDown size={12} className="inline mr-1" /> Export CSV
          </button>
        </div>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white/3 border border-violet-500/20 rounded-2xl p-4">
            <BarChart3 size={16} className="text-violet-400 mb-1" />
            <div className="text-xl font-bold text-violet-400">{stats.total_adjustments || 0}</div>
            <div className="text-xs text-muted-foreground">Total Adjustment</div>
          </div>
          <div className="bg-white/3 border border-emerald-500/20 rounded-2xl p-4">
            <TrendingUp size={16} className="text-emerald-400 mb-1" />
            <div className="text-xl font-bold text-emerald-400">+{stats.surplus_qty || 0}</div>
            <div className="text-xs text-muted-foreground">Surplus ({stats.surplus_count || 0}x)</div>
          </div>
          <div className="bg-white/3 border border-red-500/20 rounded-2xl p-4">
            <TrendingDown size={16} className="text-red-400 mb-1" />
            <div className="text-xl font-bold text-red-400">-{stats.shortage_qty || 0}</div>
            <div className="text-xs text-muted-foreground">Shortage ({stats.shortage_count || 0}x)</div>
          </div>
          <div className="bg-white/3 border border-amber-500/20 rounded-2xl p-4">
            <Package size={16} className="text-amber-400 mb-1" />
            <div className={`text-xl font-bold ${(stats.net_qty || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {stats.net_qty > 0 ? '+' : ''}{stats.net_qty || 0}
            </div>
            <div className="text-xs text-muted-foreground">Net Δ</div>
          </div>
        </div>
      )}

      {/* By operator + hotspots */}
      {stats && (stats.by_operator?.length > 0 || stats.by_position_hotspots?.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="bg-white/3 border border-white/8 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <UserIcon size={13} className="text-violet-400" />
              <span className="text-sm font-semibold">Top Operator</span>
            </div>
            {stats.by_operator?.length ? (
              <div className="space-y-2">
                {stats.by_operator.map(op => (
                  <div key={op.operator} data-testid="audit-operator-row"
                    className="flex items-center justify-between gap-3 bg-white/5 rounded-lg p-2.5 text-xs">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono truncate">{op.operator}</div>
                      <div className="text-[10px] text-muted-foreground">{op.count} adjustment · aktif {op.last_activity ? new Date(op.last_activity).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</div>
                    </div>
                    <div className="text-right text-[11px]">
                      <div className="text-emerald-400">+{op.surplus_qty}</div>
                      <div className="text-red-400">-{op.shortage_qty}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : <div className="text-xs text-muted-foreground italic">Tidak ada data</div>}
          </div>
          <div className="bg-white/3 border border-white/8 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <MapPin size={13} className="text-amber-400" />
              <span className="text-sm font-semibold">Hotspot Posisi (Paling Sering Adjust)</span>
            </div>
            {stats.by_position_hotspots?.length ? (
              <div className="space-y-2">
                {stats.by_position_hotspots.map(p => (
                  <div key={p.position_barcode} data-testid="audit-hotspot-row"
                    className="flex items-center justify-between gap-3 bg-white/5 rounded-lg p-2.5 text-xs">
                    <div className="font-mono text-violet-400">{p.position_barcode}</div>
                    <div className="flex items-center gap-2">
                      <div className="text-right text-[11px]">
                        <div className="font-bold">{p.count}x</div>
                        <div className={p.net_qty >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                          {p.net_qty > 0 ? '+' : ''}{p.net_qty}
                        </div>
                      </div>
                      {p.count >= 3 && (
                        <button
                          data-testid={`rca-btn-${p.position_barcode}`}
                          onClick={async () => {
                            setRcaModal({ barcode: p.position_barcode, loading: true, result: null, error: null });
                            try {
                              const r = await fetch(`${API}/api/wms/audit/hotspot/${encodeURIComponent(p.position_barcode)}/rca`, {
                                method: 'POST', headers,
                              });
                              const d = await r.json();
                              if (!r.ok) throw new Error(d.detail || 'Gagal RCA');
                              setRcaModal({ barcode: p.position_barcode, loading: false, result: d, error: null });
                            } catch (e) {
                              setRcaModal({ barcode: p.position_barcode, loading: false, result: null, error: e.message });
                            }
                          }}
                          className="flex items-center gap-1 px-2 py-1 rounded bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-[10px] font-medium text-white"
                          title="AI Root-Cause Analysis (Claude Sonnet)"
                        >
                          <Info size={10} /> Analisa AI
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : <div className="text-xs text-muted-foreground italic">Tidak ada data</div>}
          </div>
        </div>
      )}

      {/* Detail table */}
      <div className="bg-white/3 border border-white/8 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between">
          <span className="text-sm font-semibold">Detail Adjustment ({page.total} total)</span>
          {loading && <RefreshCw size={13} className="animate-spin text-muted-foreground" />}
        </div>
        <div className="overflow-auto max-h-[560px]">
          <table className="w-full text-xs">
            <thead className="bg-white/3 sticky top-0 text-muted-foreground">
              <tr className="text-left">
                <th className="px-3 py-2"><Calendar size={11} className="inline" /> Waktu</th>
                <th className="px-3 py-2">Session</th>
                <th className="px-3 py-2">Operator</th>
                <th className="px-3 py-2">Lokasi</th>
                <th className="px-3 py-2">Barcode Posisi</th>
                <th className="px-3 py-2">Material</th>
                <th className="px-3 py-2 text-right">Arah</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2">Catatan</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && !loading && (
                <tr><td colSpan={9} className="text-center py-8 text-muted-foreground">Tidak ada adjustment sesuai filter.</td></tr>
              )}
              {items.map(r => (
                <tr key={r.id} data-testid="audit-row" className="border-t border-white/5 hover:bg-white/3">
                  <td className="px-3 py-2 whitespace-nowrap">{r.timestamp ? new Date(r.timestamp).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</td>
                  <td className="px-3 py-2 font-mono text-violet-400 text-[11px]">{r.session_ref || '—'}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">{r.created_by || '—'}</td>
                  <td className="px-3 py-2 text-[11px]">{r.building_code ? `${r.building_code}/${r.zone_code}/${r.rack_code}` : '—'}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">{r.position_barcode || '—'}</td>
                  <td className="px-3 py-2">{r.fg_code || '—'}</td>
                  <td className="px-3 py-2 text-right">
                    {r.direction === 'adjust_in' ? (
                      <span className="text-emerald-400 flex items-center justify-end gap-1"><TrendingUp size={11} /> Surplus</span>
                    ) : r.direction === 'adjust_out' ? (
                      <span className="text-red-400 flex items-center justify-end gap-1"><TrendingDown size={11} /> Shortage</span>
                    ) : r.direction}
                  </td>
                  <td className="px-3 py-2 text-right font-bold">{r.qty || 0}</td>
                  <td className="px-3 py-2 text-muted-foreground text-[11px] max-w-[280px] truncate" title={r.notes}>{r.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {page.total > page.limit && (
          <div className="px-4 py-2 border-t border-white/8 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Menampilkan {page.skip + 1}–{Math.min(page.skip + page.limit, page.total)} dari {page.total}</span>
            <div className="flex gap-1">
              <button disabled={page.skip === 0}
                onClick={() => setPage(p => ({ ...p, skip: Math.max(0, p.skip - p.limit) }))}
                className="px-3 py-1 rounded bg-white/5 disabled:opacity-40">‹ Prev</button>
              <button disabled={page.skip + page.limit >= page.total}
                onClick={() => setPage(p => ({ ...p, skip: p.skip + p.limit }))}
                className="px-3 py-1 rounded bg-white/5 disabled:opacity-40">Next ›</button>
            </div>
          </div>
        )}
      </div>

      {/* RCA Modal */}
      {rcaModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setRcaModal(null)}>
          <div data-testid="rca-modal" className="bg-[#0f0d1c] border border-violet-500/30 rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-600 flex items-center justify-center">
                    <Info size={16} className="text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold">AI Root-Cause Analysis</h3>
                    <p className="text-xs text-muted-foreground font-mono">{rcaModal.barcode}</p>
                  </div>
                </div>
              </div>
              <button onClick={() => setRcaModal(null)} className="text-muted-foreground hover:text-foreground">
                <X size={18} />
              </button>
            </div>

            {rcaModal.loading && (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="w-10 h-10 rounded-full border-2 border-violet-500 border-t-transparent animate-spin mb-3"></div>
                <p className="text-sm text-muted-foreground">Claude Sonnet menganalisis pola adjustment...</p>
              </div>
            )}

            {rcaModal.error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-400">
                <AlertCircle size={14} className="inline mr-1" /> {rcaModal.error}
              </div>
            )}

            {rcaModal.result && (
              <div className="space-y-4">
                {/* Position info + stats */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="bg-white/5 rounded-lg p-2">
                    <div className="text-muted-foreground">Data Points</div>
                    <div className="font-bold text-violet-400">{rcaModal.result.data_points}</div>
                  </div>
                  <div className="bg-emerald-500/10 rounded-lg p-2">
                    <div className="text-muted-foreground">Surplus</div>
                    <div className="font-bold text-emerald-400">+{rcaModal.result.stats.surplus_qty}</div>
                  </div>
                  <div className="bg-red-500/10 rounded-lg p-2">
                    <div className="text-muted-foreground">Shortage</div>
                    <div className="font-bold text-red-400">-{rcaModal.result.stats.shortage_qty}</div>
                  </div>
                  <div className="bg-amber-500/10 rounded-lg p-2">
                    <div className="text-muted-foreground">Net Δ</div>
                    <div className={`font-bold ${rcaModal.result.stats.net_qty >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {rcaModal.result.stats.net_qty > 0 ? '+' : ''}{rcaModal.result.stats.net_qty}
                    </div>
                  </div>
                </div>

                {/* Analysis */}
                <div className="bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10 border border-violet-500/20 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-violet-400">Root Cause Hypothesis</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                      rcaModal.result.analysis.confidence === 'tinggi' ? 'bg-emerald-500/20 text-emerald-400' :
                      rcaModal.result.analysis.confidence === 'sedang' ? 'bg-amber-500/20 text-amber-400' :
                      'bg-zinc-500/20 text-zinc-400'
                    }`}>
                      confidence: {rcaModal.result.analysis.confidence}
                    </span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ml-auto ${
                      rcaModal.result.analysis.risk_level === 'tinggi' ? 'bg-red-500/20 text-red-400' :
                      rcaModal.result.analysis.risk_level === 'sedang' ? 'bg-amber-500/20 text-amber-400' :
                      'bg-emerald-500/20 text-emerald-400'
                    }`}>
                      risk: {rcaModal.result.analysis.risk_level}
                    </span>
                  </div>
                  <div className="text-base font-semibold text-foreground mb-2 capitalize">
                    {rcaModal.result.analysis.root_cause_hypothesis}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {rcaModal.result.analysis.reasoning}
                  </p>
                </div>

                {/* Recommended actions */}
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-foreground/80 mb-2">
                    <Check size={12} className="inline mr-1 text-emerald-400" /> Rekomendasi Action Item
                  </div>
                  <ol className="space-y-1.5 text-xs">
                    {(rcaModal.result.analysis.recommended_actions || []).map((a, i) => (
                      <li key={i} className="flex gap-2 bg-white/5 rounded-lg p-2.5">
                        <span className="font-mono text-violet-400 flex-shrink-0">{i + 1}.</span>
                        <span>{a}</span>
                      </li>
                    ))}
                  </ol>
                </div>

                <div className="text-[10px] text-muted-foreground text-right">
                  Generated {new Date(rcaModal.result.generated_at).toLocaleString('id-ID')} · Claude Sonnet 4.5
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN MODULE
// ══════════════════════════════════════════════════════════════════════════════
export default function WMSModule({ token }) {
  const [tab, setTab] = useState('dashboard');
  const TABS = [
    { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
    { id: 'structure', label: 'Struktur Gudang', icon: Building2 },
    { id: 'units', label: 'Satuan & Konversi', icon: Scale },
    { id: 'receiving', label: 'Receiving / Scan', icon: Scan },
    { id: 'opname', label: 'Stok Opname', icon: ClipboardCheck },
    { id: 'audit', label: 'Audit Trail', icon: History },
    { id: 'positions', label: 'Posisi & Search', icon: Search },
  ];

  return (
    <div data-testid="wms-module" className="space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Warehouse size={24} className="text-violet-400" />
          Warehouse Management System
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">Kelola struktur gudang, satuan, receiving, opname, audit trail, dan posisi barang</p>
      </div>

      <div className="flex gap-1 p-1 bg-white/5 rounded-xl overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            data-testid={`wms-tab-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
              tab === t.id ? 'bg-violet-600 text-white shadow-lg' : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
            }`}
          >
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && <DashboardTab token={token} />}
      {tab === 'structure' && <StructureTab token={token} />}
      {tab === 'units' && <UnitsTab token={token} />}
      {tab === 'receiving' && <ReceivingTab token={token} />}
      {tab === 'opname' && <OpnameTab token={token} />}
      {tab === 'audit' && <AuditTrailTab token={token} />}
      {tab === 'positions' && <PositionsTab token={token} />}
    </div>
  );
}
