import { useState, useEffect, useCallback } from 'react';
import { Zap, CheckCircle2, AlertTriangle, RefreshCw, ChevronDown, ChevronUp, Package, XCircle, Info } from 'lucide-react';
import { GlassCard, GlassPanel } from '@/components/ui/glass';
import { Button } from '@/components/ui/button';

const STATUS_COLOR = { released: 'text-emerald-300', in_progress: 'text-blue-300', draft: 'text-amber-300' };

export default function RahazaBulkMIModule({ token }) {
  const [wos, setWos] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null);
  const [skipShortage, setSkipShortage] = useState(false);
  const [expandedWo, setExpandedWo] = useState(null);
  const [filterStatus, setFilterStatus] = useState('in_progress');
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const loadWOs = useCallback(async () => {
    setLoading(true);
    try {
      const q = filterStatus ? `?status=${filterStatus}&limit=200` : '?limit=200';
      const r = await fetch(`/api/rahaza/work-orders${q}`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) {
        const data = await r.json();
        // Filter out WOs that don't have BOM
        setWos(data);
      }
    } finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, filterStatus]);

  useEffect(() => { loadWOs(); }, [loadWOs]);

  const toggleSelect = (id) => setSelectedIds(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  );
  const selectAll = () => setSelectedIds(wos.map(w => w.id));
  const clearAll = () => setSelectedIds([]);

  const runPreview = async () => {
    if (!selectedIds.length) return;
    setLoading(true); setPreview(null); setResult(null);
    try {
      const r = await fetch('/api/rahaza/supervisor/bulk-mi/preview', {
        method: 'POST', headers, body: JSON.stringify({ wo_ids: selectedIds }),
      });
      if (r.ok) setPreview(await r.json());
    } finally { setLoading(false); }
  };

  const runGenerate = async () => {
    if (!selectedIds.length) return;
    setGenerating(true); setResult(null);
    try {
      const r = await fetch('/api/rahaza/supervisor/bulk-mi/generate', {
        method: 'POST', headers,
        body: JSON.stringify({ wo_ids: selectedIds, skip_shortage: skipShortage, notes: 'Bulk MI Sprint 22' }),
      });
      if (r.ok) {
        const data = await r.json();
        setResult(data); setPreview(null); setSelectedIds([]); loadWOs();
      }
    } finally { setGenerating(false); }
  };

  const readyCnt = preview ? preview.preview.filter(p => p.all_available && !p.skip && !p.error).length : 0;
  const skipCnt = preview ? preview.preview.filter(p => p.skip || p.error).length : 0;
  const shortageCnt = preview ? preview.preview.filter(p => !p.all_available && !p.skip && !p.error).length : 0;

  return (
    <div className="space-y-5" data-testid="bulk-mi-page">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Bulk Material Issue Generator</h1>
          <p className="text-muted-foreground text-sm mt-1">Pilih beberapa Work Order → Preview ketersediaan stok → Generate MI sekaligus.</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setSelectedIds([]); setPreview(null); }}
            className="h-9 px-3 rounded-lg border border-[var(--glass-border)] bg-[var(--input-surface)] text-sm text-foreground">
            <option value="released">Status: Released</option>
            <option value="in_progress">Status: In Progress</option>
            <option value="">Semua Status</option>
          </select>
          <Button variant="ghost" onClick={loadWOs} className="border border-[var(--glass-border)] h-9 px-3"><RefreshCw className="w-4 h-4" /></Button>
        </div>
      </div>

      {/* Result banner */}
      {result && (
        <div className="bg-emerald-400/10 border border-emerald-300/20 rounded-xl p-4 flex items-start gap-3" data-testid="bulk-mi-result">
          <CheckCircle2 className="w-5 h-5 text-emerald-300 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold text-emerald-300">{result.total_created} MI berhasil dibuat!</p>
            <p className="text-sm text-muted-foreground mt-0.5">{result.total_skipped} WO dilewati</p>
            {result.created.slice(0, 5).map(c => (
              <p key={c.mi_number} className="text-xs text-foreground/70 mt-0.5">{c.mi_number} → {c.wo_number} ({c.item_count} item)</p>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* WO Selection */}
        <GlassCard className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-foreground text-sm">Work Orders ({wos.length})</h2>
            <div className="flex gap-2">
              <button onClick={selectAll} className="text-xs text-primary hover:underline">Pilih Semua</button>
              <span className="text-muted-foreground">|</span>
              <button onClick={clearAll} className="text-xs text-muted-foreground hover:underline">Hapus Pilihan</button>
            </div>
          </div>
          <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
            {loading ? (
              <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
            ) : wos.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">Tidak ada WO dengan status {filterStatus || 'yang dipilih'}.</div>
            ) : wos.map(wo => {
              const isSelected = selectedIds.includes(wo.id);
              return (
                <div key={wo.id}
                  onClick={() => toggleSelect(wo.id)}
                  className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${isSelected ? 'bg-primary/15 border-primary/30' : 'border-[var(--glass-border)] hover:bg-[var(--glass-bg-hover)]'}`}
                  data-testid={`bmi-wo-${wo.wo_number}`}>
                  <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${isSelected ? 'bg-primary border-primary' : 'border-muted-foreground'}`}>
                    {isSelected && <CheckCircle2 className="w-3 h-3 text-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{wo.wo_number}</p>
                    <p className="text-xs text-muted-foreground">{wo.model_code} · {wo.qty} pcs</p>
                  </div>
                  <span className={`text-[10px] font-semibold ${STATUS_COLOR[wo.status] || 'text-muted-foreground'}`}>{wo.status}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 pt-3 border-t border-[var(--glass-border)] flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{selectedIds.length} WO dipilih</span>
            <Button onClick={runPreview} disabled={!selectedIds.length || loading} size="sm" data-testid="bmi-preview-btn">
              Preview {selectedIds.length > 0 ? `(${selectedIds.length})` : ''}
            </Button>
          </div>
        </GlassCard>

        {/* Preview / Generate Panel */}
        <GlassCard className="p-4">
          <h2 className="font-semibold text-foreground text-sm mb-3">Hasil Preview & Generate</h2>
          {!preview && !loading && (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground text-sm gap-2">
              <Package className="w-10 h-10 opacity-30" />
              <p>Pilih WO di kiri, klik "Preview" untuk melihat ketersediaan material.</p>
            </div>
          )}
          {preview && (
            <div className="space-y-3" data-testid="bmi-preview-panel">
              {/* Summary badges */}
              <div className="grid grid-cols-3 gap-2">
                <GlassPanel className="p-2.5 text-center">
                  <p className="text-xl font-bold text-emerald-300">{readyCnt}</p>
                  <p className="text-[10px] text-muted-foreground">Siap Generate</p>
                </GlassPanel>
                <GlassPanel className="p-2.5 text-center">
                  <p className="text-xl font-bold text-amber-300">{shortageCnt}</p>
                  <p className="text-[10px] text-muted-foreground">Stok Kurang</p>
                </GlassPanel>
                <GlassPanel className="p-2.5 text-center">
                  <p className="text-xl font-bold text-muted-foreground">{skipCnt}</p>
                  <p className="text-[10px] text-muted-foreground">Dilewati</p>
                </GlassPanel>
              </div>

              {/* Per-WO list */}
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {preview.preview.map(p => (
                  <div key={p.wo_id} className={`rounded-lg border p-2.5 ${p.error || p.skip ? 'border-muted-foreground/20 bg-[var(--glass-bg)]' : p.all_available ? 'border-emerald-300/20 bg-emerald-400/5' : 'border-amber-300/20 bg-amber-400/5'}`}>
                    <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpandedWo(expandedWo === p.wo_id ? null : p.wo_id)}>
                      <div className="flex items-center gap-2">
                        {p.error || p.skip ? <XCircle className="w-3.5 h-3.5 text-muted-foreground" /> : p.all_available ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" /> : <AlertTriangle className="w-3.5 h-3.5 text-amber-300" />}
                        <span className="text-sm font-medium text-foreground">{p.wo_number || p.wo_id}</span>
                        <span className="text-xs text-muted-foreground">{p.model_code} · {p.qty} pcs</span>
                      </div>
                      {p.items && (expandedWo === p.wo_id ? <ChevronUp className="w-3 h-3 text-muted-foreground" /> : <ChevronDown className="w-3 h-3 text-muted-foreground" />)}
                    </div>
                    {(p.error || p.warning) && <p className="text-[10px] text-amber-300 mt-1 ml-5">{p.error || p.warning}</p>}
                    {expandedWo === p.wo_id && p.items && (
                      <div className="mt-2 ml-5 space-y-1">
                        {p.items.map(item => (
                          <div key={item.material_id} className="flex items-center justify-between text-[11px]">
                            <span className="text-foreground/80 truncate">{item.material_code} {item.material_name}</span>
                            <span className={`ml-2 font-mono ${item.can_fulfill ? 'text-emerald-300' : 'text-red-300'}`}>
                              Need: {item.qty_required} / Avail: {item.qty_available} {item.unit}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Options + Generate */}
              <div className="pt-2 border-t border-[var(--glass-border)] space-y-2.5">
                {shortageCnt > 0 && (
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                    <input type="checkbox" checked={skipShortage} onChange={e => setSkipShortage(e.target.checked)} className="w-3.5 h-3.5" />
                    Tetap buat MI untuk WO dengan stok kurang (MI akan dibuat status draft)
                  </label>
                )}
                <div className="flex items-center gap-2">
                  <Button onClick={runGenerate} disabled={generating || (readyCnt === 0 && !skipShortage)} className="flex-1" data-testid="bmi-generate-btn">
                    <Zap className="w-4 h-4 mr-1.5" />
                    {generating ? 'Generating...' : `Generate ${readyCnt + (skipShortage ? shortageCnt : 0)} MI`}
                  </Button>
                  <button onClick={() => setPreview(null)} className="text-xs text-muted-foreground hover:text-foreground">Reset</button>
                </div>
                {readyCnt === 0 && !skipShortage && preview && (
                  <div className="flex items-center gap-1.5 text-xs text-amber-300">
                    <Info className="w-3.5 h-3.5" />
                    Semua WO memiliki masalah. Centang opsi di atas untuk tetap generate.
                  </div>
                )}
              </div>
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
