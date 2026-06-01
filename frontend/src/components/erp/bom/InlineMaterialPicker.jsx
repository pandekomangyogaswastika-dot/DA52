import { useState, useEffect } from 'react';
import { Plus, Search, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { GlassInput } from '@/components/ui/glass';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

/**
 * InlineMaterialPicker
 * 
 * Komponen untuk memilih material dari master data atau membuat material baru inline.
 * Digunakan pada form BOM untuk input benang dan aksesoris.
 * 
 * Props:
 * - type: 'yarn' | 'accessory'
 * - token: JWT token
 * - onSelect: (material) => void
 */
export const InlineMaterialPicker = ({ type = 'yarn', token, onSelect, children }) => {
  const [open, setOpen] = useState(false);
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newMaterial, setNewMaterial] = useState({
    code: '',
    name: '',
    type: type,
    unit: type === 'yarn' ? 'kg' : 'pcs',
    yarn_type: '',
    color: '',
    notes: ''
  });
  const [saving, setSaving] = useState(false);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  useEffect(() => {
    if (open) {
      loadMaterials();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Re-fetch saat searchQuery berubah (debounce 300ms)
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      loadMaterials();
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  const loadMaterials = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/rahaza/materials?type=${type}${searchQuery ? `&search=${searchQuery}` : ''}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setMaterials(data || []);
      }
    } catch (err) {
      console.error('Error loading materials:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectMaterial = (material) => {
    if (onSelect) {
      onSelect(material);
    }
    setOpen(false);
  };

  const handleCreateMaterial = async () => {
    if (!newMaterial.code || !newMaterial.name) {
      toast.error('Kode dan Nama material wajib diisi');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/rahaza/materials', {
        method: 'POST',
        headers,
        body: JSON.stringify(newMaterial)
      });
      if (!res.ok) {
        const error = await res.text();
        throw new Error(error || 'Gagal membuat material');
      }
      const created = await res.json();
      toast.success(`Material ${created.code} berhasil dibuat`);
      setCreateDialogOpen(false);
      setNewMaterial({
        code: '',
        name: '',
        type: type,
        unit: type === 'yarn' ? 'kg' : 'pcs',
        yarn_type: '',
        color: '',
        notes: ''
      });
      // Select the newly created material
      handleSelectMaterial(created);
      // Reload materials
      loadMaterials();
    } catch (err) {
      toast.error(err.message || 'Gagal membuat material');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild data-testid="inline-material-picker-trigger">
          {children || (
            <Button variant="outline" size="sm" className="w-full justify-start">
              <Search className="w-4 h-4 mr-2" />
              Pilih dari master data
            </Button>
          )}
        </PopoverTrigger>
        <PopoverContent className="w-[400px] p-0" align="start">
          <Command>
            <CommandInput
              placeholder={`Cari ${type === 'yarn' ? 'benang' : 'aksesoris'}...`}
              value={searchQuery}
              onValueChange={setSearchQuery}
              data-testid="inline-material-picker-search-input"
            />
            <CommandList>
              <CommandEmpty>
                {loading ? 'Memuat...' : 'Tidak ada material ditemukan.'}
              </CommandEmpty>
              <CommandGroup>
                {materials.map(mat => (
                  <CommandItem
                    key={mat.id}
                    onSelect={() => handleSelectMaterial(mat)}
                    className="cursor-pointer"
                    data-testid={`material-option-${mat.code}`}
                  >
                    <Package className="w-4 h-4 mr-2 text-muted-foreground" />
                    <div className="flex flex-col">
                      <span className="font-medium">{mat.code} · {mat.name}</span>
                      {type === 'yarn' && mat.yarn_type && (
                        <span className="text-xs text-muted-foreground">{mat.yarn_type}</span>
                      )}
                      {mat.color && (
                        <span className="text-xs text-muted-foreground">Warna: {mat.color}</span>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
            <div className="border-t border-border p-2">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start text-primary"
                onClick={() => {
                  setCreateDialogOpen(true);
                  setOpen(false);
                }}
                data-testid="inline-material-picker-create-new-button"
              >
                <Plus className="w-4 h-4 mr-2" />
                Buat material baru
              </Button>
            </div>
          </Command>
        </PopoverContent>
      </Popover>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-[500px]" data-testid="inline-material-create-dialog">
          <DialogHeader>
            <DialogTitle>Buat {type === 'yarn' ? 'Benang' : 'Aksesoris'} Baru</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="mat-code">Kode Material *</Label>
                <GlassInput
                  id="mat-code"
                  placeholder="YRN-001"
                  value={newMaterial.code}
                  onChange={e => setNewMaterial({ ...newMaterial, code: e.target.value.toUpperCase() })}
                  data-testid="inline-material-create-code"
                />
              </div>
              <div>
                <Label htmlFor="mat-unit">Unit</Label>
                <Select
                  value={newMaterial.unit}
                  onValueChange={val => setNewMaterial({ ...newMaterial, unit: val })}
                >
                  <SelectTrigger data-testid="inline-material-create-unit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="kg">kg</SelectItem>
                    <SelectItem value="pcs">pcs</SelectItem>
                    <SelectItem value="m">m</SelectItem>
                    <SelectItem value="set">set</SelectItem>
                    <SelectItem value="pair">pair</SelectItem>
                    <SelectItem value="gram">gram</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="mat-name">Nama Material *</Label>
              <GlassInput
                id="mat-name"
                placeholder="Benang Acrylic 2/28"
                value={newMaterial.name}
                onChange={e => setNewMaterial({ ...newMaterial, name: e.target.value })}
                data-testid="inline-material-create-name"
              />
            </div>
            {type === 'yarn' && (
              <div>
                <Label htmlFor="mat-yarn-type">Jenis / Komposisi Benang</Label>
                <GlassInput
                  id="mat-yarn-type"
                  placeholder="Acrylic / 100%"
                  value={newMaterial.yarn_type}
                  onChange={e => setNewMaterial({ ...newMaterial, yarn_type: e.target.value })}
                  data-testid="inline-material-create-yarn-type"
                />
              </div>
            )}
            <div>
              <Label htmlFor="mat-color">Warna (opsional)</Label>
              <GlassInput
                id="mat-color"
                placeholder="Merah, Biru, dll"
                value={newMaterial.color}
                onChange={e => setNewMaterial({ ...newMaterial, color: e.target.value })}
                data-testid="inline-material-create-color"
              />
            </div>
            <div>
              <Label htmlFor="mat-notes">Catatan (opsional)</Label>
              <GlassInput
                id="mat-notes"
                placeholder="Catatan tambahan"
                value={newMaterial.notes}
                onChange={e => setNewMaterial({ ...newMaterial, notes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateDialogOpen(false)} disabled={saving}>
              Batal
            </Button>
            <Button
              onClick={handleCreateMaterial}
              disabled={saving}
              data-testid="inline-material-create-form-submit-button"
            >
              {saving ? 'Menyimpan...' : 'Buat Material'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
