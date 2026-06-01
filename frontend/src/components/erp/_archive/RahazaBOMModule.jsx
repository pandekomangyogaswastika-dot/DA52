import { useState, useEffect, useCallback } from 'react';
import { Plus, Edit2, Trash2, X, Copy, Package, Scale, Gem } from 'lucide-react';
import { GlassCard, GlassPanel, GlassInput } from '@/components/ui/glass';
import { Button } from '@/components/ui/button';
import Modal from './Modal';

/* ─── PT Rahaza · Fase 5b — BOM KG per Model + Size ───────────────────────────
   - List per model + matrix per size
   - Editor: yarn_materials (KG) + accessory_materials
   - Copy-to-sizes untuk ratakan BOM ke ukuran lain pada model yang sama
 ───────────────────────────────────────────────────────────────────────────── */

export default function RahazaBOMModule({ token }) {
  const [models, setModels] = useState([]);
  const [sizes, setSizes]   = useState([]);
  const [matrix, setMatrix] = useState(null);      // { model, matrix: [...] }
  const [selectedModelId, setSelectedModelId] = useState('');
  const [loading, setLoading] = useState(false);

  const [editor, setEditor] = useState(null);      // { bomId?, model_id, size_id, form }
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [copyModal, setCopyModal] = useState(null); // { bom, targetIds[], overwrite }

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
    if (!selectedModelId && activeModels.length) setSelectedModelId(activeModels[0].id);
  }, [token, selectedModelId]);

  const loadMatrix = useCallback(async () => {
    if (!selectedModelId) { setMatrix(null); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/rahaza/models/${selectedModelId}/bom`, { headers });
      if (res.ok) setMatrix(await res.json());
      else setMatrix(null);
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModelId, token]);

  useEffect(() => { loadBase(); }, [loadBase]);
  useEffect(() => { loadMatrix(); }, [loadMatrix]);

  const openEditor = async (sizeId, existingBomId) => {
    let form = {
      yarn_materials: [{ name: '', code: '', yarn_type: '', qty_kg: '', notes: '' }],
      accessory_materials: [],
      notes: '',
    };
    if (existingBomId) {
      const r = await fetch(`/api/rahaza/boms/${existingBomId}`, { headers });
      if (r.ok) {
        const b = await r.json();
        form = {
          yarn_materials:      (b.yarn_materials || []).map(y => ({ ...y, qty_kg: String(y.qty_kg ?? '') })),
          accessory_materials: (b.accessory_materials || []).map(a => ({ ...a, qty: String(a.qty ?? '') })),
          notes: b.notes || '',
        };
        if (form.yarn_materials.length === 0) form.yarn_materials = [{ name:'', code:'', yarn_type:'', qty_kg:'', notes:'' }];
      }
    }
    setFormError('');
    setEditor({ bomId: existingBomId || null, model_id: selectedModelId, size_id: sizeId, form });
  };

  const updateYarn = (idx, key, val) => setEditor(e => ({
    ...e, form: { ...e.form, yarn_materials: e.form.yarn_materials.map((y, i) => i === idx ? { ...y, [key]: val } : y) }
  }));
  const addYarn = () => setEditor(e => ({
    ...e, form: { ...e.form, yarn_materials: [...e.form.yarn_materials, { name:'', code:'', yarn_type:'', qty_kg:'', notes:'' }] }
  }));
  const removeYarn = (idx) => setEditor(e => ({
    ...e, form: { ...e.form, yarn_materials: e.form.yarn_materials.filter((_, i) => i !== idx) }
  }));

  const updateAcc = (idx, key, val) => setEditor(e => ({
    ...e, form: { ...e.form, accessory_materials: e.form.accessory_materials.map((a, i) => i === idx ? { ...a, [key]: val } : a) }
  }));
  const addAcc = () => setEditor(e => ({
    ...e, form: { ...e.form, accessory_materials: [...e.form.accessory_materials, { name:'', code:'', qty:'', unit:'pcs', notes:'' }] }
  }));
  const removeAcc = (idx) => setEditor(e => ({
    ...e, form: { ...e.form, accessory_materials: e.form.accessory_materials.filter((_, i) => i !== idx) }
  }));

  const saveBOM = async () => {
    if (!editor) return;
    setSaving(true); setFormError('');
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
        model_id: editor.model_id, size_id: editor.size_id,
        yarn_materials: yarns, accessory_materials: accs,
        notes: editor.form.notes || '',
      };
      const url = editor.bomId ? `/api/rahaza/boms/${editor.bomId}` : '/api/rahaza/boms';
      const method = editor.bomId ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers, body: JSON.stringify(payload) });
      if (!res.ok) {
        const STATUS_MSG = { 400:'Data BOM tidak valid.', 403:'Tidak ada akses BOM.', 404:'Model/Size tidak ditemukan.', 409:'BOM untuk kombinasi ini sudah ada.' };
        throw new Error(STATUS_MSG[res.status] || `Gagal menyimpan (HTTP ${res.status})`);
      }
      setEditor(null);
      loadMatrix();
    } catch (err) { setFormError(err.message); }
    finally { setSaving(false); }
  };

  const deleteBOM = async (bomId) => {
    if (!window.confirm('Hapus BOM untuk size ini?')) return;
    const res = await fetch(`/api/rahaza/boms/${bomId}`, { method: 'DELETE', headers });
    if (res.ok) loadMatrix();
  };

  const openCopy = (row) => {
    if (!row.bom_id) return;
    setCopyModal({ bom_id: row.bom_id, source_size_code: row.size_code, target_ids: [], overwrite: false });
  };
  const runCopy = async () => {
    if (!copyModal) return;
    if (!copyModal.target_ids.length) { setCopyModal(c => ({ ...c, error: 'Pilih minimal 1 size target.' })); return; }
    const res = await fetch(`/api/rahaza/boms/${copyModal.bom_id}/copy-to-sizes`, {
      method: 'POST', headers,
      body: JSON.stringify({ target_size_ids: copyModal.target_ids, overwrite: copyModal.overwrite }),
    });
    if (!res.ok) {
      setCopyModal(c => ({ ...c, error: `Gagal copy (HTTP ${res.status})` }));
      return;
    }
    const data = await res.json();
    setCopyModal(null);
    loadMatrix();
    alert(`Copy selesai.\nDibuat: ${data.created.length} · Overwrite: ${data.overwritten.length} · Dilewati: ${data.skipped.length}`);
  };

  const selectedModel = matrix?.model;

  return (
    <div className="space-y-5" data-testid="rahaza-bom-page">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Bill of Materials (BOM)</h1>
          <p className="text-muted-foreground text-sm mt-1">Kebutuhan benang (KG) & aksesoris per Model dan Size. BOM dipakai Work Order untuk hitung kebutuhan material.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedModelId}
            onChange={e => setSelectedModelId(e.target.value)}
            className="h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm text-foreground min-w-[240px]"
            data-testid="bom-model-selector"
          >
            <option value="">— Pilih Model —</option>
            {models.map(m => <option key={m.id} value={m.id}>{`${m.code} · ${m.name}`}</option>)}
          </select>
        </div>
      </div>

      {!selectedModelId ? (
        <GlassCard className="p-12 text-center text-muted-foreground">
          <Package className="w-10 h-10 mx-auto mb-3 text-foreground/30" />
          Pilih model terlebih dahulu untuk mulai mengisi BOM.
        </GlassCard>
      ) : loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
        </div>
      ) : !matrix ? (
        <GlassCard className="p-6 text-center text-muted-foreground">Tidak dapat memuat data BOM.</GlassCard>
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
            <table className="w-full text-sm">
              <thead className="bg-[var(--glass-bg)]">
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3">Size</th>
                  <th className="px-4 py-3">Status BOM</th>
                  <th className="px-4 py-3"><Scale className="w-3 h-3 inline mr-1" /> Total Benang /pcs</th>
                  <th className="px-4 py-3">Jumlah Benang</th>
                  <th className="px-4 py-3">Jumlah Aksesoris</th>
                  <th className="px-4 py-3">Catatan</th>
                  <th className="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {(matrix.matrix || []).map(row => (
                  <tr key={row.size_id} className="border-t border-[var(--glass-border)] hover:bg-[var(--glass-bg-hover)]" data-testid={`bom-row-${row.size_code}`}>
                    <td className="px-4 py-3 font-semibold text-foreground">{row.size_code}</td>
                    <td className="px-4 py-3">
                      {row.bom_id ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-400/15 border border-emerald-300/25 text-emerald-300">Tersedia</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-400/15 border border-slate-300/25 text-slate-300">Belum Ada</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-foreground">{row.total_yarn_kg_per_pcs ? row.total_yarn_kg_per_pcs.toFixed(3) : '—'} kg</td>
                    <td className="px-4 py-3 text-muted-foreground">{row.yarn_count}</td>
                    <td className="px-4 py-3 text-muted-foreground">{row.accessory_count}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs truncate max-w-[220px]">{row.notes || '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button onClick={() => openEditor(row.size_id, row.bom_id)} className="p-1.5 rounded hover:bg-[var(--glass-bg-hover)] text-muted-foreground hover:text-foreground" title={row.bom_id ? 'Edit BOM' : 'Isi BOM'} data-testid={`bom-edit-${row.size_code}`}>
                          {row.bom_id ? <Edit2 className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                        </button>
                        {row.bom_id && (
                          <>
                            <button onClick={() => openCopy(row)} className="p-1.5 rounded hover:bg-[var(--glass-bg-hover)] text-muted-foreground hover:text-primary" title="Copy ke size lain" data-testid={`bom-copy-${row.size_code}`}>
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => deleteBOM(row.bom_id)} className="p-1.5 rounded hover:bg-red-400/10 text-muted-foreground hover:text-red-400" title="Hapus BOM">
                              <Trash2 className="w-3.5 h-3.5" />
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
        </GlassCard>
      )}

      {/* Editor Modal */}
      {editor && (
        <Modal onClose={() => setEditor(null)} title={`BOM ${selectedModel?.code} · Size ${sizes.find(s => s.id === editor.size_id)?.code || ''}`} size="xl">
          <div className="space-y-5" data-testid="bom-editor-form">
            {formError && <div className="bg-red-400/10 border border-red-300/20 rounded-lg p-3 text-sm text-red-300">{formError}</div>}

            {/* Yarn section */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Scale className="w-4 h-4 text-primary" />
                  <span className="text-sm font-semibold text-foreground">Benang (Yarn)</span>
                  <span className="text-xs text-muted-foreground">KG per pcs</span>
                </div>
                <button onClick={addYarn} className="text-xs text-primary hover:text-primary/80 flex items-center gap-1" data-testid="bom-add-yarn-btn"><Plus className="w-3 h-3" /> Tambah Benang</button>
              </div>
              <GlassPanel className="p-0 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--glass-bg)]">
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2">Nama</th>
                      <th className="px-3 py-2">Kode</th>
                      <th className="px-3 py-2">Jenis / Komposisi</th>
                      <th className="px-3 py-2 w-28">Qty (KG)</th>
                      <th className="px-3 py-2">Catatan</th>
                      <th className="px-3 py-2 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {editor.form.yarn_materials.map((y, idx) => (
                      <tr key={idx} className="border-t border-[var(--glass-border)]">
                        <td className="px-2 py-1"><GlassInput value={y.name}      onChange={e => updateYarn(idx, 'name', e.target.value)}      placeholder="Benang Acrylic 2/28" data-testid={`bom-yarn-${idx}-name`} /></td>
                        <td className="px-2 py-1"><GlassInput value={y.code}      onChange={e => updateYarn(idx, 'code', e.target.value)}      placeholder="YRN-ACR28" /></td>
                        <td className="px-2 py-1"><GlassInput value={y.yarn_type} onChange={e => updateYarn(idx, 'yarn_type', e.target.value)} placeholder="Acrylic / 100%" /></td>
                        <td className="px-2 py-1"><GlassInput type="number" step="0.001" value={y.qty_kg} onChange={e => updateYarn(idx, 'qty_kg', e.target.value)} placeholder="0.300" data-testid={`bom-yarn-${idx}-qty`} /></td>
                        <td className="px-2 py-1"><GlassInput value={y.notes}     onChange={e => updateYarn(idx, 'notes', e.target.value)}     placeholder="warna utama" /></td>
                        <td className="px-2 py-1 text-center">
                          <button onClick={() => removeYarn(idx)} className="p-1 rounded hover:bg-red-400/10 text-muted-foreground hover:text-red-400" title="Hapus">
                            <X className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {editor.form.yarn_materials.length === 0 && (
                      <tr><td colSpan={6} className="text-center py-4 text-xs text-muted-foreground">Belum ada benang.</td></tr>
                    )}
                  </tbody>
                </table>
              </GlassPanel>
            </div>

            {/* Accessory section */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Gem className="w-4 h-4 text-primary" />
                  <span className="text-sm font-semibold text-foreground">Aksesoris</span>
                  <span className="text-xs text-muted-foreground">kancing, label, hangtag, dll</span>
                </div>
                <button onClick={addAcc} className="text-xs text-primary hover:text-primary/80 flex items-center gap-1" data-testid="bom-add-accessory-btn"><Plus className="w-3 h-3" /> Tambah Aksesoris</button>
              </div>
              <GlassPanel className="p-0 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--glass-bg)]">
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2">Nama</th>
                      <th className="px-3 py-2">Kode</th>
                      <th className="px-3 py-2 w-24">Qty</th>
                      <th className="px-3 py-2 w-24">Unit</th>
                      <th className="px-3 py-2">Catatan</th>
                      <th className="px-3 py-2 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {editor.form.accessory_materials.map((a, idx) => (
                      <tr key={idx} className="border-t border-[var(--glass-border)]">
                        <td className="px-2 py-1"><GlassInput value={a.name}  onChange={e => updateAcc(idx, 'name', e.target.value)}  placeholder="Kancing bulat" data-testid={`bom-acc-${idx}-name`} /></td>
                        <td className="px-2 py-1"><GlassInput value={a.code}  onChange={e => updateAcc(idx, 'code', e.target.value)}  placeholder="ACC-BTN" /></td>
                        <td className="px-2 py-1"><GlassInput type="number" step="0.01" value={a.qty} onChange={e => updateAcc(idx, 'qty', e.target.value)} placeholder="6" data-testid={`bom-acc-${idx}-qty`} /></td>
                        <td className="px-2 py-1">
                          <select value={a.unit || 'pcs'} onChange={e => updateAcc(idx, 'unit', e.target.value)}
                            className="w-full h-9 px-2 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm text-foreground">
                            <option value="pcs">pcs</option>
                            <option value="m">m</option>
                            <option value="set">set</option>
                            <option value="pair">pair</option>
                            <option value="gram">gram</option>
                          </select>
                        </td>
                        <td className="px-2 py-1"><GlassInput value={a.notes} onChange={e => updateAcc(idx, 'notes', e.target.value)} placeholder="opsional" /></td>
                        <td className="px-2 py-1 text-center">
                          <button onClick={() => removeAcc(idx)} className="p-1 rounded hover:bg-red-400/10 text-muted-foreground hover:text-red-400" title="Hapus">
                            <X className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {editor.form.accessory_materials.length === 0 && (
                      <tr><td colSpan={6} className="text-center py-4 text-xs text-muted-foreground">Belum ada aksesoris. (Opsional)</td></tr>
                    )}
                  </tbody>
                </table>
              </GlassPanel>
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground/70 mb-1">Catatan BOM (opsional)</label>
              <GlassInput value={editor.form.notes} onChange={e => setEditor(ed => ({ ...ed, form: { ...ed.form, notes: e.target.value } }))} placeholder="cth: sample awal, revisi #2, dsb" />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setEditor(null)} disabled={saving}>Batal</Button>
              <Button onClick={saveBOM} disabled={saving} data-testid="bom-save-btn">
                {saving ? 'Menyimpan...' : (editor.bomId ? 'Simpan Perubahan' : 'Simpan BOM')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Copy Modal */}
      {copyModal && (
        <Modal onClose={() => setCopyModal(null)} title={`Copy BOM dari Size ${copyModal.source_size_code}`} size="md">
          <div className="space-y-3" data-testid="bom-copy-modal">
            {copyModal.error && <div className="bg-red-400/10 border border-red-300/20 rounded-lg p-3 text-sm text-red-300">{copyModal.error}</div>}
            <p className="text-sm text-muted-foreground">Pilih size tujuan. Qty benang akan disalin apa adanya (belum pakai multiplier).</p>
            <div className="grid grid-cols-4 gap-2">
              {(matrix?.matrix || []).filter(r => r.size_code !== copyModal.source_size_code).map(r => {
                const checked = copyModal.target_ids.includes(r.size_id);
                return (
                  <label key={r.size_id} className={`border border-[var(--glass-border)] rounded-lg px-3 py-2 cursor-pointer text-sm flex items-center gap-2 ${checked ? 'bg-primary/10 border-primary/40 text-foreground' : 'bg-[var(--glass-bg)] text-foreground/70 hover:bg-[var(--glass-bg-hover)]'}`}>
                    <input
                      type="checkbox" checked={checked}
                      onChange={e => setCopyModal(c => ({ ...c,
                        target_ids: e.target.checked ? [...c.target_ids, r.size_id] : c.target_ids.filter(x => x !== r.size_id)
                      }))}
                      data-testid={`bom-copy-target-${r.size_code}`}
                    />
                    <span className="font-mono">{r.size_code}</span>
                    {r.bom_id && <span className="text-[10px] text-amber-300">(sudah ada)</span>}
                  </label>
                );
              })}
            </div>
            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
              <input type="checkbox" checked={copyModal.overwrite} onChange={e => setCopyModal(c => ({ ...c, overwrite: e.target.checked }))} data-testid="bom-copy-overwrite" />
              Overwrite BOM yang sudah ada
            </label>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setCopyModal(null)}>Batal</Button>
              <Button onClick={runCopy} data-testid="bom-copy-run-btn">Copy</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
