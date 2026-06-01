import { useState, useEffect, useCallback } from 'react';
import { Plus, Edit2, Trash2, X, Copy, Package, Scale, Gem, Save, FileText, Search } from 'lucide-react';
import { GlassCard, GlassPanel, GlassInput } from '@/components/ui/glass';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { InlineMaterialPicker } from './bom/InlineMaterialPicker';
import { VersionRail } from './bom/VersionRail';
import { RequirementsPreviewCard } from './bom/RequirementsPreviewCard';

/* ─── PT Rahaza · Fase 5b — BOM Multi-Version Configuration ────────────────────
   - Matrix view dengan active version per size
   - Multi-version management (create, edit, activate)
   - Material picker integration (select existing + create new inline)
   - Requirements preview untuk X pcs
   - Copy-to-sizes untuk ratakan BOM ke ukuran lain
────────────────────────────────────────────────────────────────────────────── */

export default function RahazaBOMModuleV2({ token }) {
  const [models, setModels] = useState([]);
  const [sizes, setSizes]   = useState([]);
  const [matrix, setMatrix] = useState(null);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [selectedSizeId, setSelectedSizeId] = useState('');
  const [loading, setLoading] = useState(false);

  // Tab state
  const [activeTab, setActiveTab] = useState('matrix');

  // Versions state
  const [versions, setVersions] = useState([]);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [versionsLoading, setVersionsLoading] = useState(false);

  // Editor state
  const [editor, setEditor] = useState(null); // { mode: 'edit' | 'create', form }
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [isDirty, setIsDirty] = useState(false);

  // Copy modal state
  const [copyModal, setCopyModal] = useState(null);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const loadBase = useCallback(async () => {
    const h = { Authorization: `Bearer ${token}` };
    const [mRes, sRes] = await Promise.all([
      fetch('/api/rahaza/models', { headers: h }).then(r => r.ok ? r.json() : []),
      fetch('/api/rahaza/sizes',  { headers: h }).then(r => r.ok ? r.json() : []),
    ]);
    const activeModels = (mRes || []).filter(m => m.active);
    setModels(activeModels);
    setSizes((sRes || []).filter(s => s.active));
    // Auto-select first model if none selected
    const storedModel = localStorage.getItem('bom_selected_model');
    if (storedModel && activeModels.find(m => m.id === storedModel)) {
      setSelectedModelId(storedModel);
    } else if (!selectedModelId && activeModels.length) {
      setSelectedModelId(activeModels[0].id);
    }
  }, [token, selectedModelId]);

  const loadMatrix = useCallback(async () => {
    if (!selectedModelId) { setMatrix(null); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/rahaza/models/${selectedModelId}/bom`, { headers });
      if (res.ok) {
        const data = await res.json();
        setMatrix(data);
      } else {
        setMatrix(null);
      }
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModelId, token]);

  const loadVersions = useCallback(async () => {
    if (!selectedModelId || !selectedSizeId) {
      setVersions([]);
      setSelectedVersion(null);
      return;
    }
    setVersionsLoading(true);
    try {
      const res = await fetch(
        `/api/rahaza/boms/versions?model_id=${selectedModelId}&size_id=${selectedSizeId}`,
        { headers }
      );
      if (res.ok) {
        const data = await res.json();
        setVersions(data || []);
        // Auto-select active version
        const active = data.find(v => v.is_active);
        if (active) {
          setSelectedVersion(active);
        } else if (data.length > 0) {
          setSelectedVersion(data[0]);
        }
      } else {
        setVersions([]);
      }
    } finally {
      setVersionsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModelId, selectedSizeId, token]);

  useEffect(() => { loadBase(); }, [loadBase]);
  useEffect(() => { loadMatrix(); }, [loadMatrix]);
  useEffect(() => { loadVersions(); }, [loadVersions]);

  // Save selected model to localStorage
  useEffect(() => {
    if (selectedModelId) {
      localStorage.setItem('bom_selected_model', selectedModelId);
    }
  }, [selectedModelId]);

  const openEditorForSize = (sizeId, versionId) => {
    setSelectedSizeId(sizeId);
    setActiveTab('editor');
    // Versions will auto-load and select the version
  };

  const startCreateVersion = () => {
    // Jika ada selectedVersion → copy materials sebagai template
    // Jika belum ada versi sama sekali → buat dengan template kosong
    const template = selectedVersion ? {
      yarn_materials: (selectedVersion.yarn_materials || []).map(y => ({ ...y, qty_kg: String(y.qty_kg ?? '') })),
      accessory_materials: (selectedVersion.accessory_materials || []).map(a => ({ ...a, qty: String(a.qty ?? '') })),
      notes: '',
    } : {
      yarn_materials: [{ name: '', code: '', yarn_type: '', qty_kg: '', notes: '', material_id: null }],
      accessory_materials: [],
      notes: '',
    };
    setEditor({ mode: 'create', form: template });
    setIsDirty(false);
  };

  const startEditVersion = () => {
    if (!selectedVersion) {
      toast.error('Pilih versi untuk diedit');
      return;
    }
    setEditor({
      mode: 'edit',
      versionId: selectedVersion.id,
      form: {
        yarn_materials: (selectedVersion.yarn_materials || []).map(y => ({ ...y, qty_kg: String(y.qty_kg ?? '') })),
        accessory_materials: (selectedVersion.accessory_materials || []).map(a => ({ ...a, qty: String(a.qty ?? '') })),
        notes: selectedVersion.notes || '',
      }
    });
    setIsDirty(false);
  };

  // Yarn material handlers
  const updateYarn = (idx, key, val) => {
    setEditor(e => ({
      ...e,
      form: { ...e.form, yarn_materials: e.form.yarn_materials.map((y, i) => i === idx ? { ...y, [key]: val } : y) }
    }));
    setIsDirty(true);
  };

  const addYarn = () => {
    setEditor(e => ({
      ...e,
      form: { ...e.form, yarn_materials: [...e.form.yarn_materials, { name:'', code:'', yarn_type:'', qty_kg:'', notes:'', material_id: null }] }
    }));
    setIsDirty(true);
  };

  const removeYarn = (idx) => {
    setEditor(e => ({
      ...e,
      form: { ...e.form, yarn_materials: e.form.yarn_materials.filter((_, i) => i !== idx) }
    }));
    setIsDirty(true);
  };

  const selectYarnFromMaster = (idx, material) => {
    setEditor(e => ({
      ...e,
      form: {
        ...e.form,
        yarn_materials: e.form.yarn_materials.map((y, i) => i === idx ? {
          ...y,
          material_id: material.id,
          code: material.code,
          name: material.name,
          yarn_type: material.yarn_type || y.yarn_type || '',
        } : y)
      }
    }));
    setIsDirty(true);
    toast.success(`Material ${material.code} dipilih`);
  };

  // Accessory material handlers
  const updateAcc = (idx, key, val) => {
    setEditor(e => ({
      ...e,
      form: { ...e.form, accessory_materials: e.form.accessory_materials.map((a, i) => i === idx ? { ...a, [key]: val } : a) }
    }));
    setIsDirty(true);
  };

  const addAcc = () => {
    setEditor(e => ({
      ...e,
      form: { ...e.form, accessory_materials: [...e.form.accessory_materials, { name:'', code:'', qty:'', unit:'pcs', notes:'', material_id: null }] }
    }));
    setIsDirty(true);
  };

  const removeAcc = (idx) => {
    setEditor(e => ({
      ...e,
      form: { ...e.form, accessory_materials: e.form.accessory_materials.filter((_, i) => i !== idx) }
    }));
    setIsDirty(true);
  };

  const selectAccFromMaster = (idx, material) => {
    setEditor(e => ({
      ...e,
      form: {
        ...e.form,
        accessory_materials: e.form.accessory_materials.map((a, i) => i === idx ? {
          ...a,
          material_id: material.id,
          code: material.code,
          name: material.name,
          unit: material.unit || a.unit || 'pcs',
        } : a)
      }
    }));
    setIsDirty(true);
    toast.success(`Material ${material.code} dipilih`);
  };

  const saveBOM = async () => {
    if (!editor || !selectedModelId || !selectedSizeId) return;
    setSaving(true);
    setFormError('');
    try {
      const yarns = editor.form.yarn_materials
        .filter(y => y.name && Number(y.qty_kg) > 0)
        .map(y => ({ ...y, qty_kg: Number(y.qty_kg) }));
      const accs = editor.form.accessory_materials
        .filter(a => a.name && Number(a.qty) > 0)
        .map(a => ({ ...a, qty: Number(a.qty) }));
      
      if (yarns.length === 0 && accs.length === 0) {
        throw new Error('Tambahkan minimal 1 benang (dengan KG > 0) atau 1 aksesoris.');
      }

      const payload = {
        model_id: selectedModelId,
        size_id: selectedSizeId,
        yarn_materials: yarns,
        accessory_materials: accs,
        notes: editor.form.notes || '',
      };

      let res;
      if (editor.mode === 'edit' && editor.versionId) {
        // Update existing version
        res = await fetch(`/api/rahaza/boms/${editor.versionId}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(payload)
        });
      } else {
        // Create new version
        res = await fetch('/api/rahaza/boms', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });
      }

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || `Gagal menyimpan (HTTP ${res.status})`);
      }

      toast.success(editor.mode === 'edit' ? 'Perubahan berhasil disimpan' : 'Versi baru berhasil dibuat');
      setEditor(null);
      setIsDirty(false);
      loadMatrix();
      loadVersions();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleActivateVersion = async (versionId) => {
    try {
      const res = await fetch(`/api/rahaza/boms/${versionId}/activate`, {
        method: 'POST',
        headers
      });
      if (!res.ok) {
        throw new Error('Gagal mengaktifkan versi');
      }
      toast.success('Versi berhasil diaktifkan');
      loadMatrix();
      loadVersions();
    } catch (err) {
      toast.error(err.message || 'Gagal mengaktifkan versi');
    }
  };

  const handleSelectVersion = (versionId) => {
    const version = versions.find(v => v.id === versionId);
    if (version) {
      setSelectedVersion(version);
    }
  };

  const openCopy = (row) => {
    if (!row.bom_id) return;
    setCopyModal({ bom_id: row.bom_id, source_size_code: row.size_code, target_ids: [], overwrite: false });
  };

  const runCopy = async () => {
    if (!copyModal) return;
    if (!copyModal.target_ids.length) {
      toast.error('Pilih minimal 1 size target.');
      return;
    }
    try {
      const res = await fetch(`/api/rahaza/boms/${copyModal.bom_id}/copy-to-sizes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ target_size_ids: copyModal.target_ids, overwrite: copyModal.overwrite }),
      });
      if (!res.ok) {
        throw new Error(`Gagal copy (HTTP ${res.status})`);
      }
      const data = await res.json();
      setCopyModal(null);
      loadMatrix();
      toast.success(`Copy selesai. Dibuat: ${data.created.length} · Overwrite: ${data.overwritten.length} · Dilewati: ${data.skipped.length}`);
    } catch (err) {
      toast.error(err.message || 'Gagal copy BOM');
    }
  };

  const selectedModel = matrix?.model;
  const selectedSize = sizes.find(s => s.id === selectedSizeId);
  const activeVersion = versions.find(v => v.is_active);

  return (
    <div className="space-y-5" data-testid="rahaza-bom-page">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Bill of Materials (BOM)</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Konfigurasi BOM multi-version dengan material master integration & preview kebutuhan
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={selectedModelId}
            onValueChange={val => {
              setSelectedModelId(val);
              setSelectedSizeId('');
              setActiveTab('matrix');
            }}
            data-testid="bom-model-selector"
          >
            <SelectTrigger className="w-[240px]">
              <SelectValue placeholder="— Pilih Model —" />
            </SelectTrigger>
            <SelectContent>
              {models.map(m => (
                <SelectItem key={m.id} value={m.id}>
                  {m.code} · {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!selectedModelId ? (
        <GlassCard className="p-12 text-center text-muted-foreground">
          <Package className="w-10 h-10 mx-auto mb-3 text-foreground/30" />
          Pilih model terlebih dahulu untuk mulai mengisi BOM.
        </GlassCard>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList>
            <TabsTrigger value="matrix" data-testid="bom-tab-matrix">Matriks BOM</TabsTrigger>
            <TabsTrigger value="editor" disabled={!selectedSizeId} data-testid="bom-tab-editor">
              Editor {selectedSize ? `· ${selectedSize.code}` : ''}
            </TabsTrigger>
            <TabsTrigger value="preview" disabled={!selectedVersion} data-testid="bom-tab-preview">
              Preview Kebutuhan
            </TabsTrigger>
          </TabsList>

          {/* Matrix Tab */}
          <TabsContent value="matrix" className="space-y-4">
            {loading ? (
              <div className="flex items-center justify-center h-48">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
              </div>
            ) : !matrix ? (
              <GlassCard className="p-6 text-center text-muted-foreground">
                Tidak dapat memuat data BOM.
              </GlassCard>
            ) : (
              <GlassCard className="p-0 overflow-hidden">
                <div className="px-4 py-3 border-b border-[var(--glass-border)] bg-[var(--glass-bg)]">
                  <div className="flex items-center gap-2 text-sm">
                    <Package className="w-4 h-4 text-primary" />
                    <span className="font-semibold text-foreground">{selectedModel?.code}</span>
                    <span className="text-muted-foreground">· {selectedModel?.name}</span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Size</TableHead>
                        <TableHead>Versi Aktif</TableHead>
                        <TableHead><Scale className="w-3 h-3 inline mr-1" /> Total Benang /pcs</TableHead>
                        <TableHead>Material</TableHead>
                        <TableHead>Terakhir Update</TableHead>
                        <TableHead className="text-right">Aksi</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(matrix.matrix || []).map(row => (
                        <TableRow
                          key={row.size_id}
                          className="hover:bg-[var(--glass-bg-hover)]"
                          data-testid={`bom-row-${row.size_code}`}
                        >
                          <TableCell className="font-semibold text-foreground">{row.size_code}</TableCell>
                          <TableCell>
                            {row.bom_id ? (
                              <Badge variant="default" className="text-[10px]">
                                v{row.version}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">Belum ada</span>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-foreground">
                            {row.total_yarn_kg_per_pcs ? row.total_yarn_kg_per_pcs.toFixed(3) : '—'} kg
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs">
                            {row.yarn_count} benang · {row.accessory_count} aksesoris
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs">
                            {row.updated_at ? new Date(row.updated_at).toLocaleDateString('id-ID') : '—'}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="inline-flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2"
                                onClick={() => openEditorForSize(row.size_id, row.bom_id)}
                                data-testid={`bom-open-${row.size_code}`}
                              >
                                {row.bom_id ? <Edit2 className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                              </Button>
                              {row.bom_id && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 px-2"
                                  onClick={() => openCopy(row)}
                                  data-testid={`bom-copy-${row.size_code}`}
                                >
                                  <Copy className="w-3.5 h-3.5" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </GlassCard>
            )}
          </TabsContent>

          {/* Editor Tab */}
          <TabsContent value="editor" className="space-y-4">
            {!selectedSizeId ? (
              <GlassCard className="p-12 text-center text-muted-foreground">
                Pilih size dari matriks untuk mulai edit BOM
              </GlassCard>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <div className="lg:col-span-8 space-y-4">
                  {/* Editor Form or Version Viewer */}
                  {editor ? (
                    <GlassCard className="p-5 space-y-5" data-testid="bom-editor-form">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-lg font-semibold text-foreground">
                            {editor.mode === 'edit' ? 'Edit Versi' : 'Buat Versi Baru'}
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            {selectedModel?.code} · {selectedSize?.code}
                            {editor.mode === 'edit' && selectedVersion ? ` · v${selectedVersion.version}` : ''}
                          </p>
                        </div>
                        {isDirty && (
                          <Badge variant="outline" className="text-warning border-warning">
                            Belum disimpan
                          </Badge>
                        )}
                      </div>

                      {formError && (
                        <div className="bg-red-400/10 border border-red-300/20 rounded-lg p-3 text-sm text-red-300">
                          {formError}
                        </div>
                      )}

                      {/* Yarn Materials */}
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <Scale className="w-4 h-4 text-primary" />
                            <span className="text-sm font-semibold text-foreground">Benang (Yarn)</span>
                            <span className="text-xs text-muted-foreground">KG per pcs</span>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={addYarn}
                            data-testid="bom-add-yarn-btn"
                          >
                            <Plus className="w-4 h-4 mr-1" /> Tambah Benang
                          </Button>
                        </div>
                        <div className="border border-[var(--glass-border)] rounded-lg overflow-hidden">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-[30px]"></TableHead>
                                <TableHead>Nama</TableHead>
                                <TableHead>Kode</TableHead>
                                <TableHead>Jenis</TableHead>
                                <TableHead className="w-28">Qty (KG)</TableHead>
                                <TableHead className="w-10"></TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {editor.form.yarn_materials.map((y, idx) => (
                                <TableRow key={idx}>
                                  <TableCell>
                                    <InlineMaterialPicker
                                      type="yarn"
                                      token={token}
                                      onSelect={mat => selectYarnFromMaster(idx, mat)}
                                    >
                                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                                        <Search className="w-3.5 h-3.5" />
                                      </Button>
                                    </InlineMaterialPicker>
                                  </TableCell>
                                  <TableCell>
                                    <GlassInput
                                      value={y.name}
                                      onChange={e => updateYarn(idx, 'name', e.target.value)}
                                      placeholder="Benang Acrylic 2/28"
                                      data-testid={`bom-yarn-${idx}-name`}
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <GlassInput
                                      value={y.code}
                                      onChange={e => updateYarn(idx, 'code', e.target.value)}
                                      placeholder="YRN-ACR28"
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <GlassInput
                                      value={y.yarn_type}
                                      onChange={e => updateYarn(idx, 'yarn_type', e.target.value)}
                                      placeholder="Acrylic / 100%"
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <GlassInput
                                      type="number"
                                      step="0.001"
                                      value={y.qty_kg}
                                      onChange={e => updateYarn(idx, 'qty_kg', e.target.value)}
                                      placeholder="0.300"
                                      data-testid={`bom-yarn-${idx}-qty`}
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 w-7 p-0 hover:bg-red-400/10 hover:text-red-400"
                                      onClick={() => removeYarn(idx)}
                                    >
                                      <X className="w-4 h-4" />
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                              {editor.form.yarn_materials.length === 0 && (
                                <TableRow>
                                  <TableCell colSpan={6} className="text-center py-6 text-xs text-muted-foreground">
                                    Belum ada benang. Klik "Tambah Benang" untuk mulai.
                                  </TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
                        </div>
                      </div>

                      {/* Accessory Materials */}
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <Gem className="w-4 h-4 text-primary" />
                            <span className="text-sm font-semibold text-foreground">Aksesoris</span>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={addAcc}
                            data-testid="bom-add-accessory-btn"
                          >
                            <Plus className="w-4 h-4 mr-1" /> Tambah Aksesoris
                          </Button>
                        </div>
                        <div className="border border-[var(--glass-border)] rounded-lg overflow-hidden">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-[30px]"></TableHead>
                                <TableHead>Nama</TableHead>
                                <TableHead>Kode</TableHead>
                                <TableHead className="w-24">Qty</TableHead>
                                <TableHead className="w-24">Unit</TableHead>
                                <TableHead className="w-10"></TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {editor.form.accessory_materials.map((a, idx) => (
                                <TableRow key={idx}>
                                  <TableCell>
                                    <InlineMaterialPicker
                                      type="accessory"
                                      token={token}
                                      onSelect={mat => selectAccFromMaster(idx, mat)}
                                    >
                                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                                        <Search className="w-3.5 h-3.5" />
                                      </Button>
                                    </InlineMaterialPicker>
                                  </TableCell>
                                  <TableCell>
                                    <GlassInput
                                      value={a.name}
                                      onChange={e => updateAcc(idx, 'name', e.target.value)}
                                      placeholder="Kancing bulat"
                                      data-testid={`bom-acc-${idx}-name`}
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <GlassInput
                                      value={a.code}
                                      onChange={e => updateAcc(idx, 'code', e.target.value)}
                                      placeholder="ACC-BTN"
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <GlassInput
                                      type="number"
                                      step="0.01"
                                      value={a.qty}
                                      onChange={e => updateAcc(idx, 'qty', e.target.value)}
                                      placeholder="6"
                                      data-testid={`bom-acc-${idx}-qty`}
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <Select
                                      value={a.unit || 'pcs'}
                                      onValueChange={val => updateAcc(idx, 'unit', val)}
                                    >
                                      <SelectTrigger>
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="pcs">pcs</SelectItem>
                                        <SelectItem value="m">m</SelectItem>
                                        <SelectItem value="set">set</SelectItem>
                                        <SelectItem value="pair">pair</SelectItem>
                                        <SelectItem value="gram">gram</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </TableCell>
                                  <TableCell>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 w-7 p-0 hover:bg-red-400/10 hover:text-red-400"
                                      onClick={() => removeAcc(idx)}
                                    >
                                      <X className="w-4 h-4" />
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                              {editor.form.accessory_materials.length === 0 && (
                                <TableRow>
                                  <TableCell colSpan={6} className="text-center py-6 text-xs text-muted-foreground">
                                    Belum ada aksesoris. (Opsional)
                                  </TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
                        </div>
                      </div>

                      {/* Notes */}
                      <div>
                        <label className="block text-xs font-medium text-foreground/70 mb-1">
                          Catatan BOM (opsional)
                        </label>
                        <GlassInput
                          value={editor.form.notes}
                          onChange={e => {
                            setEditor(ed => ({ ...ed, form: { ...ed.form, notes: e.target.value } }));
                            setIsDirty(true);
                          }}
                          placeholder="cth: sample awal, revisi #2, dsb"
                        />
                      </div>

                      {/* Actions */}
                      <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--glass-border)]">
                        <Button
                          variant="ghost"
                          onClick={() => {
                            if (isDirty && !window.confirm('Ada perubahan belum disimpan. Batalkan?')) {
                              return;
                            }
                            setEditor(null);
                            setIsDirty(false);
                          }}
                          disabled={saving}
                        >
                          Batal
                        </Button>
                        <Button
                          onClick={saveBOM}
                          disabled={saving}
                          data-testid="bom-save-btn"
                        >
                          <Save className="w-4 h-4 mr-2" />
                          {saving ? 'Menyimpan...' : (editor.mode === 'edit' ? 'Simpan Perubahan' : 'Simpan Versi Baru')}
                        </Button>
                      </div>
                    </GlassCard>
                  ) : (
                    // Version Viewer
                    <GlassCard className="p-5">
                      {selectedVersion ? (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                                <FileText className="w-5 h-5 text-primary" />
                                BOM v{selectedVersion.version}
                                {selectedVersion.is_active && (
                                  <Badge variant="default" className="ml-2">Aktif</Badge>
                                )}
                              </h3>
                              <p className="text-sm text-muted-foreground mt-1">
                                {selectedModel?.code} · {selectedSize?.code}
                              </p>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={startCreateVersion}
                                data-testid="bom-create-new-version-btn"
                              >
                                <Plus className="w-4 h-4 mr-2" />
                                Versi Baru
                              </Button>
                              <Button
                                variant="default"
                                size="sm"
                                onClick={startEditVersion}
                                data-testid="bom-edit-version-btn"
                              >
                                <Edit2 className="w-4 h-4 mr-2" />
                                Edit
                              </Button>
                            </div>
                          </div>

                          {/* Yarn Display */}
                          {selectedVersion.yarn_materials && selectedVersion.yarn_materials.length > 0 && (
                            <div>
                              <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                                <Scale className="w-4 h-4 text-primary" />
                                Benang ({selectedVersion.yarn_materials.length})
                              </h4>
                              <div className="border border-[var(--glass-border)] rounded-lg overflow-hidden">
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>Kode</TableHead>
                                      <TableHead>Nama</TableHead>
                                      <TableHead>Jenis</TableHead>
                                      <TableHead className="text-right">Qty (kg)</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {selectedVersion.yarn_materials.map((y, idx) => (
                                      <TableRow key={idx}>
                                        <TableCell className="font-mono text-xs">{y.code}</TableCell>
                                        <TableCell>{y.name}</TableCell>
                                        <TableCell className="text-xs text-muted-foreground">{y.yarn_type || '—'}</TableCell>
                                        <TableCell className="text-right font-mono">{y.qty_kg}</TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            </div>
                          )}

                          {/* Accessory Display */}
                          {selectedVersion.accessory_materials && selectedVersion.accessory_materials.length > 0 && (
                            <div>
                              <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                                <Gem className="w-4 h-4 text-primary" />
                                Aksesoris ({selectedVersion.accessory_materials.length})
                              </h4>
                              <div className="border border-[var(--glass-border)] rounded-lg overflow-hidden">
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>Kode</TableHead>
                                      <TableHead>Nama</TableHead>
                                      <TableHead className="text-right">Qty</TableHead>
                                      <TableHead>Unit</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {selectedVersion.accessory_materials.map((a, idx) => (
                                      <TableRow key={idx}>
                                        <TableCell className="font-mono text-xs">{a.code}</TableCell>
                                        <TableCell>{a.name}</TableCell>
                                        <TableCell className="text-right font-mono">{a.qty}</TableCell>
                                        <TableCell className="text-xs">{a.unit}</TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            </div>
                          )}

                          {selectedVersion.notes && (
                            <div className="p-3 bg-[var(--glass-bg)] rounded-lg border border-[var(--glass-border)]">
                              <div className="text-xs font-medium text-muted-foreground mb-1">Catatan</div>
                              <div className="text-sm text-foreground">{selectedVersion.notes}</div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-center py-12 text-muted-foreground">
                          <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
                          <p>Belum ada versi BOM untuk size ini</p>
                          <Button
                            variant="outline"
                            size="sm"
                            className="mt-4"
                            onClick={() => {
                              // Create first version with empty template
                              setEditor({
                                mode: 'create',
                                form: {
                                  yarn_materials: [{ name:'', code:'', yarn_type:'', qty_kg:'', notes:'', material_id: null }],
                                  accessory_materials: [],
                                  notes: '',
                                }
                              });
                            }}
                          >
                            <Plus className="w-4 h-4 mr-2" />
                            Buat Versi Pertama
                          </Button>
                        </div>
                      )}
                    </GlassCard>
                  )}
                </div>

                {/* Version Rail */}
                <div className="lg:col-span-4">
                  <VersionRail
                    versions={versions}
                    activeVersionId={activeVersion?.id}
                    selectedVersionId={selectedVersion?.id}
                    onSelectVersion={handleSelectVersion}
                    onCreateVersion={startCreateVersion}
                    onActivateVersion={handleActivateVersion}
                    loading={versionsLoading}
                  />
                </div>
              </div>
            )}
          </TabsContent>

          {/* Preview Tab */}
          <TabsContent value="preview">
            {selectedVersion ? (
              <RequirementsPreviewCard bom={selectedVersion} token={token} />
            ) : (
              <GlassCard className="p-12 text-center text-muted-foreground">
                Pilih versi BOM untuk melihat preview kebutuhan material
              </GlassCard>
            )}
          </TabsContent>
        </Tabs>
      )}

      {/* Copy Modal */}
      {copyModal && (
        <Dialog open={!!copyModal} onOpenChange={() => setCopyModal(null)}>
          <DialogContent className="sm:max-w-[600px]" data-testid="bom-copy-modal">
            <DialogHeader>
              <DialogTitle>Copy BOM dari Size {copyModal.source_size_code}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <p className="text-sm text-muted-foreground">
                Pilih size tujuan. Material akan disalin sesuai versi aktif.
              </p>
              <div className="grid grid-cols-4 gap-2">
                {(matrix?.matrix || [])
                  .filter(r => r.size_code !== copyModal.source_size_code)
                  .map(r => {
                    const checked = copyModal.target_ids.includes(r.size_id);
                    return (
                      <label
                        key={r.size_id}
                        className={`border border-[var(--glass-border)] rounded-lg px-3 py-2 cursor-pointer text-sm flex items-center gap-2 transition-colors ${
                          checked
                            ? 'bg-primary/10 border-primary/40 text-foreground'
                            : 'bg-[var(--glass-bg)] text-foreground/70 hover:bg-[var(--glass-bg-hover)]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={e =>
                            setCopyModal(c => ({
                              ...c,
                              target_ids: e.target.checked
                                ? [...c.target_ids, r.size_id]
                                : c.target_ids.filter(x => x !== r.size_id)
                            }))
                          }
                          data-testid={`bom-copy-target-${r.size_code}`}
                        />
                        <span className="font-mono">{r.size_code}</span>
                        {r.bom_id && <span className="text-[10px] text-amber-300">(ada)</span>}
                      </label>
                    );
                  })}
              </div>
              <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={copyModal.overwrite}
                  onChange={e => setCopyModal(c => ({ ...c, overwrite: e.target.checked }))}
                  data-testid="bom-copy-overwrite"
                />
                Overwrite BOM yang sudah ada
              </label>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setCopyModal(null)}>
                Batal
              </Button>
              <Button onClick={runCopy} data-testid="bom-copy-run-btn">
                Copy
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
