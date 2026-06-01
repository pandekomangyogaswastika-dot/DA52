import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Pencil, Trash2, RefreshCw, ShieldAlert } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const API = process.env.REACT_APP_BACKEND_URL;

const SEVERITY_COLORS = {
  critical: 'bg-red-100 text-red-800 border-red-200',
  major:    'bg-orange-100 text-orange-800 border-orange-200',
  minor:    'bg-yellow-100 text-yellow-800 border-yellow-200',
};

export default function RahazaDefectCodesModule({ headers }) {
  const { toast } = useToast();
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ code: '', name: '', category: '', severity: 'minor' });
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/api/rahaza/defect-codes`, { headers });
      setCodes(data);
    } catch (e) {
      toast({ title: 'Gagal memuat kode cacat', variant: 'destructive' });
    } finally { setLoading(false); }
  }, [headers, toast]);

  useEffect(() => { load(); }, [load]);

  const handleSeed = async () => {
    try {
      const { data } = await axios.post(`${API}/api/rahaza/defect-codes/seed`, {}, { headers });
      toast({ title: `Seed berhasil: ${data.created} kode baru ditambahkan` });
      load();
    } catch (e) { toast({ title: 'Seed gagal', variant: 'destructive' }); }
  };

  const openForm = (dc = null) => {
    setEditing(dc);
    setForm(dc ? { code: dc.code, name: dc.name, category: dc.category, severity: dc.severity } : { code: '', name: '', category: '', severity: 'minor' });
    setShowForm(true);
  };

  const handleSave = async () => {
    try {
      if (editing) {
        await axios.put(`${API}/api/rahaza/defect-codes/${editing.id}`, form, { headers });
        toast({ title: 'Kode cacat diperbarui' });
      } else {
        await axios.post(`${API}/api/rahaza/defect-codes`, form, { headers });
        toast({ title: 'Kode cacat ditambahkan' });
      }
      setShowForm(false);
      load();
    } catch (e) {
      toast({ title: e.response?.data?.detail || 'Gagal menyimpan', variant: 'destructive' });
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Hapus kode cacat ini?')) return;
    try {
      await axios.delete(`${API}/api/rahaza/defect-codes/${id}`, { headers });
      toast({ title: 'Kode cacat dihapus' });
      load();
    } catch (e) { toast({ title: 'Gagal menghapus', variant: 'destructive' }); }
  };

  const filtered = codes.filter(c =>
    c.code?.toLowerCase().includes(search.toLowerCase()) ||
    c.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.category?.toLowerCase().includes(search.toLowerCase())
  );

  const byCategory = filtered.reduce((acc, c) => {
    const cat = c.category || 'Lainnya';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(c);
    return acc;
  }, {});

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2"><ShieldAlert className="w-5 h-5 text-orange-500" /> Master Kode Cacat</h2>
          <p className="text-sm text-muted-foreground">Definisi kategori cacat untuk QC konsisten — {codes.length} kode aktif</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleSeed}><RefreshCw className="w-4 h-4 mr-1" /> Seed Default</Button>
          <Button size="sm" onClick={() => openForm()}><Plus className="w-4 h-4 mr-1" /> Tambah</Button>
        </div>
      </div>

      <Input placeholder="Cari kode, nama, kategori..." value={search} onChange={e => setSearch(e.target.value)} className="max-w-sm" />

      {loading ? <div className="text-center py-8 text-muted-foreground">Memuat...</div> : (
        <div className="space-y-4">
          {Object.entries(byCategory).map(([cat, items]) => (
            <div key={cat}>
              <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2 tracking-wide">{cat}</h3>
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium">Kode</th>
                      <th className="text-left px-4 py-2 font-medium">Nama Cacat</th>
                      <th className="text-left px-4 py-2 font-medium">Severity</th>
                      <th className="text-right px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(dc => (
                      <tr key={dc.id} className="border-t hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2 font-mono text-xs font-semibold text-foreground">{dc.code}</td>
                        <td className="px-4 py-2">{dc.name}</td>
                        <td className="px-4 py-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${SEVERITY_COLORS[dc.severity] || SEVERITY_COLORS.minor}`}>
                            {dc.severity}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openForm(dc)}><Pencil className="w-3.5 h-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(dc.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="text-center py-10 text-muted-foreground">
              <ShieldAlert className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p>Belum ada kode cacat.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={handleSeed}>Seed 20 Kode Default</Button>
            </div>
          )}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? 'Edit' : 'Tambah'} Kode Cacat</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Kode *</label>
              <Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="DC-001" />
            </div>
            <div>
              <label className="text-sm font-medium">Nama Cacat *</label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Lubang (Hole)" />
            </div>
            <div>
              <label className="text-sm font-medium">Kategori</label>
              <Input value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} placeholder="Struktur Rajut" />
            </div>
            <div>
              <label className="text-sm font-medium">Severity</label>
              <Select value={form.severity} onValueChange={v => setForm(f => ({ ...f, severity: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="major">Major</SelectItem>
                  <SelectItem value="minor">Minor</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowForm(false)}>Batal</Button>
              <Button onClick={handleSave}>Simpan</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
