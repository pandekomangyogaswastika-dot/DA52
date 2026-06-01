/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Sparkles, FileSpreadsheet, Upload, ArrowRight, ArrowLeft, Loader2,
  CheckCircle, AlertCircle, RefreshCw, History, Eye, Play, X, Info,
  Bookmark, BookmarkCheck, Trash2, ChevronDown,
} from 'lucide-react';
import { GlassCard, GlassPanel, GlassInput } from '@/components/ui/glass';
import { PageHeader } from './moduleAtoms';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from '@/components/ui/tabs';
import { toast } from 'sonner';

const STEPS = [
  { id: 1, label: 'Upload', icon: Upload },
  { id: 2, label: 'AI Mapping', icon: Sparkles },
  { id: 3, label: 'Preview', icon: Eye },
  { id: 4, label: 'Execute', icon: Play },
];

const STATUS_BADGES = {
  uploaded: { label: 'Uploaded', cls: 'bg-blue-500/10 text-blue-400 border-blue-500/30' },
  analyzed: { label: 'AI Analyzed', cls: 'bg-purple-500/10 text-purple-400 border-purple-500/30' },
  mapped: { label: 'Mapped', cls: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30' },
  executed: { label: 'Executed', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
  failed: { label: 'Failed', cls: 'bg-red-500/10 text-red-400 border-red-500/30' },
};

export default function SmartImportModule({ token }) {
  const [step, setStep] = useState(1);
  const [activeTab, setActiveTab] = useState('wizard');
  const [accounts, setAccounts] = useState([]);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Template state
  const [templates, setTemplates] = useState([]);
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);

  // Step 1 state
  const [accountId, setAccountId] = useState('');
  const [revenueType, setRevenueType] = useState('total');
  const [file, setFile] = useState(null);
  const [uploadResult, setUploadResult] = useState(null);

  // Step 2 state
  const [aiMapping, setAiMapping] = useState([]);
  const [overallConfidence, setOverallConfidence] = useState(0);
  const [mappingNotes, setMappingNotes] = useState('');
  const [mappingSource, setMappingSource] = useState('');
  const [aggregation, setAggregation] = useState('by_date');

  // Step 3 state
  const [preview, setPreview] = useState(null);

  // Step 4 state
  const [executing, setExecuting] = useState(false);
  const [executeResult, setExecuteResult] = useState(null);

  // Loading states per step
  const [loading, setLoading] = useState(false);

  const headers = useMemo(
    () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
    [token]
  );

  // ─── Initial fetch: accounts + history ─────────────────────────────────────
  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch('/api/marketing/accounts?status=active', { headers });
      if (res.ok) setAccounts(await res.json());
    } catch (e) {
      // silent
    }
  }, [headers]);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch('/api/marketing/import/history', { headers });
      if (res.ok) setHistory(await res.json());
    } catch (e) {
      toast.error('Gagal memuat history');
    } finally {
      setHistoryLoading(false);
    }
  }, [headers]);

  const fetchTemplates = useCallback(async (accId) => {
    if (!accId) { setTemplates([]); return; }
    try {
      const res = await fetch(`/api/marketing/import-templates?account_id=${accId}`, { headers });
      if (res.ok) setTemplates(await res.json());
    } catch { setTemplates([]); }
  }, [headers]);

  useEffect(() => {
    fetchAccounts();
    fetchHistory();
  }, [fetchAccounts, fetchHistory]);

  // Load templates whenever account changes
  useEffect(() => { fetchTemplates(accountId); }, [accountId, fetchTemplates]);

  // ─── Step 1: Upload ────────────────────────────────────────────────────────
  const resetWizard = () => {
    setStep(1);
    setFile(null);
    setUploadResult(null);
    setAiMapping([]);
    setOverallConfidence(0);
    setMappingNotes('');
    setMappingSource('');
    setPreview(null);
    setExecuteResult(null);
    setAggregation('by_date');
    setShowSaveTemplate(false);
    setTemplateName('');
  };

  const handleUpload = async () => {
    if (!file) {
      toast.error('Pilih file terlebih dahulu');
      return;
    }
    if (!accountId) {
      toast.error('Pilih akun terlebih dahulu');
      return;
    }

    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('account_id', accountId);
      fd.append('revenue_type', revenueType);

      const res = await fetch('/api/marketing/import/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Upload gagal');
      }
      const data = await res.json();
      setUploadResult(data);
      toast.success(`File diupload: ${data.total_rows} baris terdeteksi`);
      setStep(2);
      // auto-trigger analyze
      runAnalyze(data.upload_id);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── Step 2: Analyze (AI Mapping) ──────────────────────────────────────────
  const runAnalyze = async (uploadId) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/marketing/import/${uploadId}/analyze`, {
        method: 'POST',
        headers,
      });
      if (!res.ok) throw new Error('AI mapping gagal');
      const data = await res.json();
      setAiMapping(data.ai_mapping || []);
      setOverallConfidence(data.overall_confidence || 0);
      setMappingNotes(data.notes || '');
      setMappingSource(data.mapping_source || '');
      toast.success(`AI mapping selesai (${data.mapping_source})`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Apply a saved template to the current upload
  const applyTemplate = async (tmpl) => {
    if (!uploadResult?.upload_id) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/marketing/import/${uploadResult.upload_id}/apply-template/${tmpl.id}`,
        { method: 'POST', headers }
      );
      if (!res.ok) throw new Error((await res.json()).detail || 'Gagal apply template');
      const data = await res.json();
      // Sync mapping state from template
      setAiMapping(data.mapping || []);
      setAggregation(data.aggregation || 'by_date');
      setMappingSource('template');
      setMappingNotes(`Template diterapkan: "${tmpl.template_name}"`);
      setOverallConfidence(0.95);
      toast.success(`Template "${tmpl.template_name}" diterapkan`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false); }
  };

  // Save current mapping as a new template
  const saveAsTemplate = async () => {
    if (!templateName.trim()) { toast.error('Nama template tidak boleh kosong'); return; }
    if (!accountId) { toast.error('Pilih akun terlebih dahulu'); return; }
    setSavingTemplate(true);
    try {
      const res = await fetch('/api/marketing/import-templates', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          template_name: templateName.trim(),
          account_id: accountId,
          mapping: aiMapping.map(m => ({ source_column: m.source_column, target_field: m.target_field || null, confidence: m.confidence || 0 })),
          revenue_type: revenueType,
          aggregation,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || 'Gagal menyimpan template');
      toast.success(`Template "${templateName}" disimpan`);
      setShowSaveTemplate(false);
      setTemplateName('');
      fetchTemplates(accountId);
    } catch (e) { toast.error(e.message); }
    finally { setSavingTemplate(false); }
  };

  const deleteTemplate = async (id, name) => {
    if (!confirm(`Hapus template "${name}"?`)) return;
    try {
      const res = await fetch(`/api/marketing/import-templates/${id}`, { method: 'DELETE', headers });
      if (!res.ok) throw new Error((await res.json()).detail);
      toast.success('Template dihapus');
      fetchTemplates(accountId);
    } catch (e) { toast.error(e.message); }
  };

  const updateMappingItem = (idx, field, value) => {
    setAiMapping(prev =>
      prev.map((m, i) => (i === idx ? { ...m, [field]: value === 'none' ? null : value } : m))
    );
  };

  const handleSaveMappingAndPreview = async () => {
    if (!uploadResult) return;
    setLoading(true);
    try {
      const payload = {
        mapping: aiMapping.map(m => ({
          source_column: m.source_column,
          target_field: m.target_field || null,
          confidence: m.confidence || 0,
        })),
        revenue_type: revenueType,
        aggregation,
      };
      const saveRes = await fetch(`/api/marketing/import/${uploadResult.upload_id}/mapping`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(payload),
      });
      if (!saveRes.ok) {
        const err = await saveRes.json().catch(() => ({}));
        throw new Error(err.detail || 'Gagal menyimpan mapping');
      }
      // Fetch preview
      const previewRes = await fetch(`/api/marketing/import/${uploadResult.upload_id}/preview`, { headers });
      if (!previewRes.ok) throw new Error('Gagal memuat preview');
      const previewData = await previewRes.json();
      setPreview(previewData);
      setStep(3);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── Step 4: Execute ───────────────────────────────────────────────────────
  const handleExecute = async () => {
    if (!uploadResult) return;
    setExecuting(true);
    try {
      const res = await fetch(`/api/marketing/import/${uploadResult.upload_id}/execute`, {
        method: 'POST',
        headers,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Execute gagal');
      }
      const data = await res.json();
      setExecuteResult(data);
      toast.success(data.summary);
      setStep(4);
      fetchHistory();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setExecuting(false);
    }
  };

  // ─── Rollback ──────────────────────────────────────────────────────────────
  const handleRollback = async (importId) => {
    if (!confirm('Yakin rollback import ini? Semua baris yang diimport akan dihapus.')) return;
    try {
      const res = await fetch(`/api/marketing/import/${importId}/rollback`, {
        method: 'POST',
        headers,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Rollback gagal');
      }
      const data = await res.json();
      toast.success(data.message || 'Rollback berhasil');
      fetchHistory();
    } catch (e) {
      toast.error(e.message);
    }
  };

  // ─── Helpers ───────────────────────────────────────────────────────────────
  const fmt = (n) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;
  const systemFields = uploadResult?.system_fields || {};
  const targetFieldOptions = useMemo(() => {
    return [{ value: 'none', label: '— Skip / Tidak digunakan —' }].concat(
      Object.entries(systemFields).map(([key, meta]) => ({
        value: key,
        label: `${meta.label}${meta.required ? ' *' : ''}`,
      }))
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemFields]);

  const confColor = (c) => {
    if (c >= 0.85) return 'text-emerald-400';
    if (c >= 0.6) return 'text-yellow-400';
    return 'text-orange-400';
  };

  const fmtDate = (s) => s ? new Date(s).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';

  return (
    <div className="space-y-5" data-testid="smart-import-module">
      <PageHeader
        icon={FileSpreadsheet}
        eyebrow="Portal Marketing · Smart Import"
        title="Smart Excel/CSV Import"
        subtitle="Upload data penjualan dari Shopee/TikTokShop dengan AI-assisted column mapping (powered by Emergent LLM)"
        actions={
          <Button onClick={() => { fetchAccounts(); fetchHistory(); }} variant="outline" size="sm" data-testid="refresh-import-btn">
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
          </Button>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="wizard" data-testid="tab-wizard">
            <Sparkles className="w-3.5 h-3.5 mr-1.5" /> Import Wizard
          </TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">
            <History className="w-3.5 h-3.5 mr-1.5" /> History ({history.length})
          </TabsTrigger>
        </TabsList>

        {/* ─── WIZARD TAB ──────────────────────────────────────────────── */}
        <TabsContent value="wizard" className="space-y-5 mt-4">
          {/* Step indicator */}
          <GlassPanel className="p-4">
            <div className="flex items-center justify-between gap-2">
              {STEPS.map((s, idx) => {
                const Icon = s.icon;
                const isActive = step === s.id;
                const isDone = step > s.id;
                return (
                  <div key={s.id} className="flex-1 flex items-center">
                    <div className={`flex items-center gap-2 ${isActive ? 'text-primary' : isDone ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center border-2 ${
                        isActive ? 'border-primary bg-primary/10' : isDone ? 'border-emerald-400 bg-emerald-500/10' : 'border-muted-foreground/30'
                      }`}>
                        {isDone ? <CheckCircle className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground uppercase tracking-wider">Step {s.id}</div>
                        <div className="text-sm font-semibold">{s.label}</div>
                      </div>
                    </div>
                    {idx < STEPS.length - 1 && (
                      <div className={`flex-1 h-0.5 mx-2 ${isDone ? 'bg-emerald-400' : 'bg-muted-foreground/20'}`} />
                    )}
                  </div>
                );
              })}
            </div>
          </GlassPanel>

          {/* ─── Step 1: Upload ───────────────────────────────────────── */}
          {step === 1 && (
            <GlassCard className="p-6 space-y-4" data-testid="step-1">
              <div>
                <h3 className="text-lg font-semibold mb-1">Upload File</h3>
                <p className="text-xs text-muted-foreground">
                  Format yang didukung: <b>CSV</b>, <b>XLSX</b>. Max 10MB, 50.000 baris.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Akun Platform <span className="text-red-400">*</span></Label>
                  <Select value={accountId} onValueChange={setAccountId}>
                    <SelectTrigger data-testid="upload-account-select"><SelectValue placeholder="Pilih akun" /></SelectTrigger>
                    <SelectContent>
                      {accounts.map(a => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.account_name} ({a.platform})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Tipe Revenue <span className="text-red-400">*</span></Label>
                  <Select value={revenueType} onValueChange={setRevenueType}>
                    <SelectTrigger data-testid="upload-type-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="total">📊 Total Revenue (regular + live)</SelectItem>
                      <SelectItem value="live">🎥 Live Revenue (live streaming saja)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label>Pilih File <span className="text-red-400">*</span></Label>
                <div className="border-2 border-dashed border-[var(--glass-border)] rounded-lg p-8 text-center hover:bg-[var(--glass-bg)] transition-colors">
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    onChange={e => setFile(e.target.files[0])}
                    className="hidden"
                    id="file-upload-input"
                    data-testid="file-upload-input"
                  />
                  <label htmlFor="file-upload-input" className="cursor-pointer">
                    <Upload className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                    {file ? (
                      <div>
                        <div className="text-sm font-semibold text-foreground">{file.name}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {(file.size / 1024).toFixed(1)} KB
                        </div>
                        <Button variant="outline" size="sm" className="mt-3" onClick={(e) => { e.preventDefault(); setFile(null); }}>
                          <X className="w-3 h-3 mr-1" /> Ganti file
                        </Button>
                      </div>
                    ) : (
                      <div>
                        <div className="text-sm font-semibold text-foreground">Klik untuk pilih file</div>
                        <div className="text-xs text-muted-foreground mt-1">CSV / XLSX, max 10MB</div>
                      </div>
                    )}
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button onClick={handleUpload} disabled={!file || !accountId || loading} data-testid="upload-btn">
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ArrowRight className="w-4 h-4 mr-2" />}
                  Upload & Analyze
                </Button>
              </div>
            </GlassCard>
          )}

          {/* ─── Step 2: AI Mapping ───────────────────────────────────── */}
          {step === 2 && (
            <GlassCard className="p-6 space-y-4" data-testid="step-2">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold mb-1 flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-primary" /> AI Column Mapping
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Review hasil mapping AI, edit jika perlu. Kolom dengan target null akan di-skip.
                  </p>
                </div>
                {!loading && aiMapping.length > 0 && (
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground uppercase tracking-wider">Confidence</div>
                    <div className={`text-2xl font-bold ${confColor(overallConfidence)}`}>
                      {(overallConfidence * 100).toFixed(0)}%
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {mappingSource === 'llm' ? '🤖 AI' : mappingSource === 'template' ? '📋 Template' : '📋 Heuristik'}
                    </Badge>
                  </div>
                )}
              </div>

              {/* ── Template Picker ── */}
              {templates.length > 0 && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                    <BookmarkCheck className="w-3.5 h-3.5" />
                    {templates.length} Template Tersimpan untuk Akun Ini
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {templates.map(tmpl => (
                      <div key={tmpl.id} className="flex items-center gap-1 bg-background/60 border border-primary/20 rounded-lg px-2 py-1">
                        <button
                          data-testid={`apply-template-${tmpl.id}`}
                          onClick={() => applyTemplate(tmpl)}
                          className="text-xs text-primary hover:text-primary/80 font-medium"
                          disabled={loading}
                        >
                          {tmpl.template_name}
                          <span className="text-muted-foreground ml-1">({tmpl.usage_count || 0}x)</span>
                        </button>
                        <button
                          onClick={() => deleteTemplate(tmpl.id, tmpl.template_name)}
                          className="ml-1 text-muted-foreground hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Klik nama template untuk menerapkan mapping secara otomatis
                  </p>
                </div>
              )}

              {mappingNotes && (
                <div className="px-3 py-2 rounded-md bg-blue-500/10 border border-blue-500/30 text-xs text-blue-300 flex items-start gap-2">
                  <Info className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{mappingNotes}</span>
                </div>
              )}

              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                  <span className="ml-3 text-sm text-muted-foreground">AI sedang menganalisis kolom...</span>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto rounded-lg border border-[var(--glass-border)]">
                    <table className="w-full text-sm">
                      <thead className="bg-[var(--glass-bg)]">
                        <tr>
                          <th className="text-left px-3 py-2 font-semibold">Kolom Sumber</th>
                          <th className="text-left px-3 py-2 font-semibold">→ Field Sistem</th>
                          <th className="text-right px-3 py-2 font-semibold w-20">Conf</th>
                        </tr>
                      </thead>
                      <tbody>
                        {aiMapping.map((m, idx) => (
                          <tr key={idx} className="border-t border-[var(--glass-border)]" data-testid={`mapping-row-${idx}`}>
                            <td className="px-3 py-2">
                              <div className="font-mono text-xs">{m.source_column}</div>
                              {uploadResult?.sample_rows?.[0]?.[m.source_column] && (
                                <div className="text-[10px] text-muted-foreground italic truncate max-w-[200px]">
                                  Sample: "{String(uploadResult.sample_rows[0][m.source_column]).slice(0, 30)}"
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <Select
                                value={m.target_field || 'none'}
                                onValueChange={v => updateMappingItem(idx, 'target_field', v)}
                              >
                                <SelectTrigger data-testid={`mapping-select-${idx}`} className="h-8"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {targetFieldOptions.map(o => (
                                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </td>
                            <td className={`px-3 py-2 text-right font-mono text-xs ${confColor(m.confidence || 0)}`}>
                              {((m.confidence || 0) * 100).toFixed(0)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Mode Aggregation</Label>
                      <Select value={aggregation} onValueChange={setAggregation}>
                        <SelectTrigger data-testid="aggregation-select"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="by_date">📅 By Date — agregasi per tanggal (recommended)</SelectItem>
                          <SelectItem value="row_per_row">📋 Row per Row — 1 baris = 1 entry harian</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </>
              )}

              <div className="flex justify-between gap-2 pt-2">
                <Button variant="outline" onClick={() => setStep(1)} disabled={loading}>
                  <ArrowLeft className="w-4 h-4 mr-2" /> Kembali
                </Button>
                <div className="flex gap-2">
                  {/* Save as template */}
                  {aiMapping.length > 0 && !loading && (
                    <Button
                      variant="outline"
                      data-testid="save-template-btn"
                      onClick={() => setShowSaveTemplate(s => !s)}
                    >
                      <Bookmark className="w-4 h-4 mr-2" /> Simpan Template
                    </Button>
                  )}
                  <Button onClick={handleSaveMappingAndPreview} disabled={loading || aiMapping.length === 0} data-testid="save-mapping-btn">
                    {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Eye className="w-4 h-4 mr-2" />}
                    Simpan & Preview
                  </Button>
                </div>
              </div>

              {/* Save Template Inline Form */}
              {showSaveTemplate && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
                  <p className="text-sm font-medium">Simpan Mapping sebagai Template</p>
                  <p className="text-xs text-muted-foreground">
                    Template ini akan tersedia di import berikutnya untuk akun yang sama.
                  </p>
                  <div className="flex gap-2">
                    <input
                      data-testid="template-name-input"
                      value={templateName}
                      onChange={e => setTemplateName(e.target.value)}
                      placeholder="Nama template, mis. Shopee Harian v1"
                      className="flex-1 bg-background border border-[var(--glass-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      onKeyDown={e => e.key === 'Enter' && saveAsTemplate()}
                    />
                    <Button
                      data-testid="confirm-save-template-btn"
                      onClick={saveAsTemplate}
                      disabled={savingTemplate || !templateName.trim()}
                      size="sm"
                    >
                      {savingTemplate ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookmarkCheck className="w-4 h-4 mr-1" />}
                      Simpan
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setShowSaveTemplate(false)}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </GlassCard>
          )}

          {/* ─── Step 3: Preview ──────────────────────────────────────── */}
          {step === 3 && preview && (
            <GlassCard className="p-6 space-y-4" data-testid="step-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold mb-1 flex items-center gap-2">
                    <Eye className="w-5 h-5 text-primary" /> Preview Data
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Review data yang akan disimpan ke sistem. Validasi otomatis sudah dijalankan.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-3">
                <GlassPanel className="p-3">
                  <div className="text-[10px] uppercase text-muted-foreground tracking-wider">Source rows</div>
                  <div className="text-2xl font-bold tabular-nums">{preview.total_source_rows}</div>
                </GlassPanel>
                <GlassPanel className="p-3 border-emerald-500/30">
                  <div className="text-[10px] uppercase text-emerald-400 tracking-wider">Valid</div>
                  <div className="text-2xl font-bold tabular-nums text-emerald-400">{preview.valid_rows}</div>
                </GlassPanel>
                <GlassPanel className={`p-3 ${preview.error_rows > 0 ? 'border-red-500/30' : ''}`}>
                  <div className="text-[10px] uppercase text-muted-foreground tracking-wider">Errors</div>
                  <div className={`text-2xl font-bold tabular-nums ${preview.error_rows > 0 ? 'text-red-400' : ''}`}>{preview.error_rows}</div>
                </GlassPanel>
                <GlassPanel className="p-3 bg-primary/5 border-primary/30">
                  <div className="text-[10px] uppercase text-primary tracking-wider">Akan disimpan</div>
                  <div className="text-2xl font-bold tabular-nums text-primary">{preview.total_target_rows}</div>
                  <div className="text-[10px] text-muted-foreground">{preview.aggregation === 'by_date' ? 'rows aggregated' : 'rows raw'}</div>
                </GlassPanel>
              </div>

              {preview.errors_sample && preview.errors_sample.length > 0 && (
                <details className="rounded-md bg-red-500/5 border border-red-500/30 px-3 py-2">
                  <summary className="cursor-pointer text-sm font-medium text-red-300 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" /> {preview.errors_sample.length} baris bermasalah (klik untuk lihat)
                  </summary>
                  <ul className="text-xs space-y-1 mt-2 max-h-40 overflow-auto">
                    {preview.errors_sample.slice(0, 10).map((e, i) => (
                      <li key={i}>
                        <span className="font-mono">Row {e.row_index}:</span> {e.errors.map(er => er.error).join('; ')}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              <div className="overflow-x-auto rounded-lg border border-[var(--glass-border)] max-h-96">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--glass-bg)] sticky top-0">
                    <tr>
                      {preview.preview_rows[0] && Object.keys(preview.preview_rows[0]).filter(k => !k.startsWith('_')).map(k => (
                        <th key={k} className="text-left px-3 py-2 font-semibold capitalize">{k}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.preview_rows.slice(0, 50).map((row, i) => (
                      <tr key={i} className="border-t border-[var(--glass-border)]" data-testid={`preview-row-${i}`}>
                        {Object.entries(row).filter(([k]) => !k.startsWith('_')).map(([k, v]) => (
                          <td key={k} className="px-3 py-1.5 tabular-nums text-xs">
                            {typeof v === 'number' && k.toLowerCase().includes('revenue') ? fmt(v) : String(v)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-between gap-2 pt-2">
                <Button variant="outline" onClick={() => setStep(2)} disabled={executing}>
                  <ArrowLeft className="w-4 h-4 mr-2" /> Kembali
                </Button>
                <Button
                  onClick={handleExecute}
                  disabled={executing || preview.total_target_rows === 0}
                  className="bg-emerald-500 hover:bg-emerald-600"
                  data-testid="execute-btn"
                >
                  {executing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
                  Execute Import ({preview.total_target_rows} rows)
                </Button>
              </div>
            </GlassCard>
          )}

          {/* ─── Step 4: Execute Result ───────────────────────────────── */}
          {step === 4 && executeResult && (
            <GlassCard className="p-8 text-center space-y-4" data-testid="step-4">
              <CheckCircle className="w-20 h-20 mx-auto text-emerald-400" />
              <h3 className="text-2xl font-bold">Import Berhasil!</h3>
              <p className="text-muted-foreground">{executeResult.summary}</p>

              <div className="grid grid-cols-2 gap-3 max-w-md mx-auto pt-4">
                <GlassPanel className="p-3">
                  <div className="text-[10px] uppercase text-emerald-400 tracking-wider">Sukses</div>
                  <div className="text-2xl font-bold tabular-nums text-emerald-400">{executeResult.success_count}</div>
                </GlassPanel>
                <GlassPanel className="p-3">
                  <div className="text-[10px] uppercase text-muted-foreground tracking-wider">Gagal</div>
                  <div className={`text-2xl font-bold tabular-nums ${executeResult.error_count > 0 ? 'text-red-400' : ''}`}>{executeResult.error_count}</div>
                </GlassPanel>
              </div>

              <div className="text-xs text-muted-foreground pt-2">
                Rollback tersedia hingga: <span className="text-foreground font-semibold">{fmtDate(executeResult.rollback_deadline)}</span>
              </div>

              <div className="flex justify-center gap-2 pt-4">
                <Button variant="outline" onClick={resetWizard} data-testid="reset-wizard-btn">
                  <Upload className="w-4 h-4 mr-2" /> Import File Lainnya
                </Button>
                <Button onClick={() => { fetchHistory(); setActiveTab('history'); }} data-testid="goto-history-btn">
                  <History className="w-4 h-4 mr-2" /> Lihat History
                </Button>
              </div>
            </GlassCard>
          )}
        </TabsContent>

        {/* ─── HISTORY TAB ────────────────────────────────────────────── */}
        <TabsContent value="history" className="space-y-3 mt-4">
          {historyLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}
            </div>
          ) : history.length === 0 ? (
            <GlassCard className="p-12 text-center">
              <History className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-50" />
              <p className="text-muted-foreground">Belum ada history import</p>
            </GlassCard>
          ) : (
            <div className="space-y-2">
              {history.map(h => {
                const status = h.rolled_back ? 'rolled_back' : 'imported';
                return (
                  <GlassCard key={h.id} className="p-4" data-testid={`history-row-${h.id}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-foreground truncate">{h.filename}</span>
                          {h.rolled_back ? (
                            <Badge variant="outline" className="bg-orange-500/10 text-orange-400 border-orange-500/30">Rolled back</Badge>
                          ) : (
                            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30">Imported</Badge>
                          )}
                          <Badge variant="outline" className="text-xs">{h.import_type}</Badge>
                          {h.aggregation && <Badge variant="outline" className="text-xs">{h.aggregation}</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground space-y-0.5">
                          <div>Account: <span className="text-foreground">{h.account_name}</span></div>
                          <div>
                            Sukses: <span className="text-emerald-400 font-semibold">{h.success_count}</span>
                            {' · '}
                            Errors: <span className={h.error_count > 0 ? 'text-red-400' : ''}>{h.error_count}</span>
                            {' · '}
                            {fmtDate(h.created_at)}
                          </div>
                          {h.rolled_back && (
                            <div className="text-orange-400">
                              Rolled back: {fmtDate(h.rolled_back_at)} ({h.deleted_count || 0} rows removed)
                            </div>
                          )}
                          {!h.rolled_back && h.can_rollback && (
                            <div>Rollback s/d: {fmtDate(h.rollback_deadline)}</div>
                          )}
                        </div>
                      </div>

                      {!h.rolled_back && h.can_rollback && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRollback(h.id)}
                          className="text-orange-400 hover:bg-orange-500/10"
                          data-testid={`rollback-btn-${h.id}`}
                        >
                          <RefreshCw className="w-3.5 h-3.5 mr-1" /> Rollback
                        </Button>
                      )}
                    </div>
                  </GlassCard>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
