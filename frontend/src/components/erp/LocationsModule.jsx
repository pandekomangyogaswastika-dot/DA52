import { useState, useEffect, useCallback } from 'react';
import { GlassCard, GlassInput } from '@/components/ui/glass';
import Modal from '@/components/erp/Modal';
import ConfirmDialog from '@/components/erp/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { MapPin, Plus, Pencil, Trash2, Warehouse, Search } from 'lucide-react';

export default function LocationsModule({ token }) {
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [search, setSearch] = useState('');
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const [form, setForm] = useState({ code: '', name: '', type: 'warehouse', zone: '', rack: '', shelf: '', bin_code: '' });

  const fetchLocations = useCallback(async () => {
    try {
      const res = await fetch('/api/wms/legacy/locations', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setLocations(await res.json());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [token]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchLocations(); }, []);

  const handleSave = async () => {
    try {
      const url = editing ? `/api/wms/legacy/locations/${editing.id}` : '/api/wms/legacy/locations';
      const method = editing ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers, body: JSON.stringify(form) });
      if (res.ok) { setShowForm(false); setEditing(null); resetForm(); fetchLocations(); }
      else { const err = await res.json(); alert(err.detail || 'Error'); }
    } catch (e) { alert('Error: ' + e.message); }
  };

  const handleDelete = async (id) => {
    try {
      const res = await fetch(`/api/wms/legacy/locations/${id}`, { method: 'DELETE', headers });
      if (res.ok) { setConfirmDelete(null); fetchLocations(); }
      else { const err = await res.json(); alert(err.detail || 'Error'); }
    } catch (e) { alert('Error: ' + e.message); }
  };

  const startEdit = (loc) => {
    setForm({ code: loc.code, name: loc.name, type: loc.type, zone: loc.zone || '', rack: loc.rack || '', shelf: loc.shelf || '', bin_code: loc.bin_code || '' });
    setEditing(loc);
    setShowForm(true);
  };

  const resetForm = () => setForm({ code: '', name: '', type: 'warehouse', zone: '', rack: '', shelf: '', bin_code: '' });

  const filtered = search ? locations.filter(l => l.code?.toLowerCase().includes(search.toLowerCase()) || l.name?.toLowerCase().includes(search.toLowerCase())) : locations;
  const typeColors = { warehouse: 'bg-sky-400/15 text-sky-400 border-sky-300/20', zone: 'bg-amber-400/15 text-amber-400 border-amber-300/20', bin: 'bg-emerald-400/15 text-emerald-300 border-emerald-300/20' };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" /></div>;

  return (
    <div className="space-y-5" data-testid="wh-locations-module">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Warehouse Locations</h1>
          <p className="text-muted-foreground text-sm">Kelola gudang, zone, rack, dan bin location</p>
        </div>
        <Button onClick={() => { resetForm(); setEditing(null); setShowForm(true); }} className="bg-primary text-primary-foreground hover:brightness-110 gap-1.5" data-testid="add-location-btn">
          <Plus className="w-4 h-4" /> Add Location
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <GlassInput placeholder="Search locations..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.length === 0 ? (
          <GlassCard hover={false} className="col-span-full p-8 text-center">
            <Warehouse className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No locations yet</p>
          </GlassCard>
        ) : filtered.map(loc => (
          <GlassCard key={loc.id} className="p-4" data-testid={`location-${loc.code}`}>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center">
                  <MapPin className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-bold text-foreground font-mono">{loc.code}</p>
                  <p className="text-xs text-muted-foreground">{loc.name}</p>
                </div>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${typeColors[loc.type] || typeColors.warehouse}`}>{loc.type}</span>
            </div>
            {(loc.zone || loc.rack || loc.bin_code) && (
              <div className="mt-2 flex gap-2 flex-wrap">
                {loc.zone && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--glass-bg)] text-muted-foreground border border-[var(--glass-border)]">Zone: {loc.zone}</span>}
                {loc.rack && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--glass-bg)] text-muted-foreground border border-[var(--glass-border)]">Rack: {loc.rack}</span>}
                {loc.bin_code && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--glass-bg)] text-muted-foreground border border-[var(--glass-border)]">Bin: {loc.bin_code}</span>}
              </div>
            )}
            <div className="mt-3 flex gap-2">
              <button onClick={() => startEdit(loc)} className="text-xs text-primary hover:brightness-110 flex items-center gap-1"><Pencil className="w-3 h-3" /> Edit</button>
              <button onClick={() => setConfirmDelete(loc.id)} className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1"><Trash2 className="w-3 h-3" /> Delete</button>
            </div>
          </GlassCard>
        ))}
      </div>

      {showForm && (
        <Modal title={editing ? 'Edit Location' : 'Add Location'} onClose={() => { setShowForm(false); setEditing(null); }}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Code</label>
                <GlassInput value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="WH-001" disabled={!!editing} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Type</label>
                <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className="w-full border border-[var(--glass-border)] bg-[var(--input-surface)] rounded-lg px-3 py-2 text-sm text-foreground">
                  <option value="warehouse">Warehouse</option>
                  <option value="zone">Zone</option>
                  <option value="bin">Bin</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Name</label>
              <GlassInput value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Gudang Utama" />
            </div>
            <div className="grid grid-cols-4 gap-2">
              <div><label className="text-[10px] text-muted-foreground">Zone</label><GlassInput value={form.zone} onChange={e => setForm(f => ({ ...f, zone: e.target.value }))} className="h-8 text-xs" /></div>
              <div><label className="text-[10px] text-muted-foreground">Rack</label><GlassInput value={form.rack} onChange={e => setForm(f => ({ ...f, rack: e.target.value }))} className="h-8 text-xs" /></div>
              <div><label className="text-[10px] text-muted-foreground">Shelf</label><GlassInput value={form.shelf} onChange={e => setForm(f => ({ ...f, shelf: e.target.value }))} className="h-8 text-xs" /></div>
              <div><label className="text-[10px] text-muted-foreground">Bin Code</label><GlassInput value={form.bin_code} onChange={e => setForm(f => ({ ...f, bin_code: e.target.value }))} className="h-8 text-xs" /></div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => { setShowForm(false); setEditing(null); }} className="border-[var(--glass-border)] text-muted-foreground">Batal</Button>
              <Button onClick={handleSave} className="bg-primary text-primary-foreground hover:brightness-110" data-testid="save-location-btn">{editing ? 'Update' : 'Create'}</Button>
            </div>
          </div>
        </Modal>
      )}

      {confirmDelete && <ConfirmDialog title="Delete Location?" message="Location with existing stock cannot be deleted." onConfirm={() => handleDelete(confirmDelete)} onCancel={() => setConfirmDelete(null)} />}
    </div>
  );
}
