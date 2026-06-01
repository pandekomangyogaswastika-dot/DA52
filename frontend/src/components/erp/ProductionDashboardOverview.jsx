/**
 * Dashboard Produksi (WIP) — Tahap 2 Modernized.
 * WIP per proses real-time dengan heatmap intensity + bottleneck detection.
 * Phase 16: integrasi NextActionWidget & SetupWizard (guided operations).
 * Phase 4 (Automation): inline +Input buttons untuk Quick Input Panel.
 * Sprint 43: Multi-warehouse filter (location-based) + CMT Packing summary
 */
import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Factory, Activity, AlertTriangle, Layers, LayoutGrid, Plus, MapPin, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  StatCard, ChartCard, HeroCrystalCard,
} from './dashboardAtoms';
import NextActionWidget from './NextActionWidget';
import SetupWizard from './SetupWizard';
import { useProductionUI } from '@/contexts/ProductionUIContext';

const API = process.env.REACT_APP_BACKEND_URL || '';
const fmtNum = (v) => Number(v || 0).toLocaleString('id-ID');

export default function ProductionDashboardModule({ token, onNavigate }) {
  const [summary, setSummary]         = useState([]);
  const [loading, setLoading]         = useState(true);
  const [updatedAt, setUpdatedAt]     = useState('');
  const [wizardOpen, setWizardOpen]   = useState(false);
  const [naeNonce, setNaeNonce]       = useState(0);
  // Multi-warehouse filter state
  const [locations, setLocations]     = useState([]);
  const [selectedLoc, setSelectedLoc] = useState('');
  const [matSummary, setMatSummary]   = useState(null);
  const [cmtSummary, setCmtSummary]   = useState(null);
  const { openQuickInput } = useProductionUI();

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    try {
      const params = selectedLoc ? `?location_id=${selectedLoc}` : '';
      const res = await fetch(`${API}/api/rahaza/wip/summary${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setSummary(data.processes || []);
        setUpdatedAt(new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }));
      }
    } finally { setLoading(false); }
  }, [token, selectedLoc]);

  const fetchSidePanels = useCallback(async () => {
    try {
      const [matRes, cmtRes] = await Promise.all([
        fetch(`${API}/api/prod/material-summary-by-location${selectedLoc ? `?location_id=${selectedLoc}` : ''}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API}/api/prod/cmt-receipts/summary`, { headers: { Authorization: `Bearer ${token}` } })
      ]);
      if (matRes.ok) setMatSummary(await matRes.json());
      if (cmtRes.ok) setCmtSummary(await cmtRes.json());
    } catch {}
  }, [token, selectedLoc]);

  const fetchLocations = useCallback(async () => {
    try {
      const data = await (await fetch(`${API}/api/rahaza/locations`, { headers: { Authorization: `Bearer ${token}` } })).json();
      setLocations(Array.isArray(data) ? data : []);
    } catch {}
  }, [token]);

  useEffect(() => { fetchSummary(); fetchSidePanels(); }, [fetchSummary, fetchSidePanels]);
  useEffect(() => { fetchLocations(); }, [fetchLocations]);
  useEffect(() => { const t = setInterval(fetchSummary, 15000); return () => clearInterval(t); }, [fetchSummary]);

  // Auto-detect wizard needed on first mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch(`${API}/api/rahaza/setup/status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (mounted && data.needs_wizard) {
          // Don't auto-open wizard - user can open it manually from NextAction widget
        }
      } catch (e) { /* silent */ }
    })();
    return () => { mounted = false; };
  }, [token]);

  const wipValues = summary.map(s => s.wip_qty);
  const maxWip = Math.max(0, ...wipValues);
  const bottleneck = maxWip > 0 ? summary.find(s => s.wip_qty === maxWip) : null;
  const totalOutput = summary.reduce((a, s) => a + s.total_output, 0);
  const totalWip = summary.reduce((a, s) => a + s.wip_qty, 0);
  const totalFlow = totalOutput + totalWip;
  const efficiency = totalFlow > 0 ? Math.round((totalOutput / totalFlow) * 100) : 0;

  return (
    <div className="space-y-5" data-testid="production-dashboard">
      <HeroCrystalCard
        testId="prod-hero"
        eyebrow="Portal Produksi"
        title="Dashboard WIP Real-time"
        description="Monitoring Work-In-Progress per proses (Cutting → CMT-Sewing → Finishing → QC → Packing). Auto-refresh 15 detik."
      >
        <div className="flex flex-wrap items-center gap-3">
          {/* Multi-warehouse filter */}
          <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5" data-testid="location-filter">
            <MapPin className="w-4 h-4 text-primary/70" />
            <select
              value={selectedLoc}
              onChange={e => setSelectedLoc(e.target.value)}
              className="bg-transparent text-sm focus:outline-none pr-2"
              data-testid="location-select"
            >
              <option value="">Semua Lokasi / Gudang</option>
              {locations.map(l => (
                <option key={l.id} value={l.id}>{l.name} ({l.code})</option>
              ))}
            </select>
          </div>
          <Button onClick={() => { fetchSummary(); fetchSidePanels(); }} className="h-9 bg-[hsl(var(--primary))] hover:brightness-110" data-testid="prod-dash-refresh">
            <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Memuat...' : 'Refresh'}
          </Button>
          {updatedAt && <span className="text-xs text-foreground/50">Diperbarui: {updatedAt}</span>}
        </div>
      </HeroCrystalCard>

      {/* Phase 16: Next-Action Widget (guided operations) */}
      <NextActionWidget
        key={naeNonce}
        token={token}
        portal="production"
        onNavigate={(moduleId) => onNavigate && onNavigate(moduleId)}
        onOpenSetupWizard={() => setWizardOpen(true)}
        maxCards={5}
      />

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard testId="kpi-total-output" icon={Factory} label="Total Output"
          value={fmtNum(totalOutput)} sub="pcs tercatat semua proses" accent="success" />
        <StatCard testId="kpi-total-wip" icon={Layers} label="Total WIP"
          value={fmtNum(totalWip)} sub="pcs masih dalam proses" accent="primary" />
        <StatCard testId="kpi-efficiency" icon={Activity} label="Flow Efficiency"
          value={`${efficiency}%`} sub={`${fmtNum(totalOutput)} / ${fmtNum(totalFlow)}`}
          accent={efficiency >= 70 ? 'success' : 'warning'} />
        <StatCard testId="kpi-bottleneck" icon={AlertTriangle} label="Bottleneck"
          value={bottleneck ? bottleneck.process_code : 'Tidak ada'}
          sub={bottleneck ? `WIP ${fmtNum(bottleneck.wip_qty)} pcs` : 'WIP seimbang'}
          accent={bottleneck ? 'warning' : 'success'}
          onClick={onNavigate ? () => onNavigate('production-line-board') : undefined}
        />
      </div>

      {/* WIP Flow Diagram */}
      <ChartCard
        title="WIP per Proses (alur Cutting → Packing)"
        subtitle="Bar-strip menunjukkan proporsi WIP vs total per proses. Warna lebih terang = WIP lebih tinggi (bottleneck indicator)."
        actions={
          <Button
            variant="ghost"
            onClick={() => onNavigate && onNavigate('production-line-board')}
            className="h-8 text-xs border border-[var(--glass-border)]"
            data-testid="prod-line-board-cta"
          >
            <LayoutGrid className="w-3.5 h-3.5 mr-1.5" />
            Buka Line Board
          </Button>
        }
      >
        {summary.length === 0 ? (
          <div className="text-center py-10 text-foreground/40 text-sm">
            {loading ? 'Memuat data...' : 'Belum ada event produksi yang tercatat.'}
          </div>
        ) : (
          <div className="space-y-3">
            {summary.map((p, i) => {
              const total = p.total_output + p.wip_qty;
              const outPct = total > 0 ? (p.total_output / total) * 100 : 0;
              const wipPct = total > 0 ? (p.wip_qty / total) * 100 : 0;
              const isBottleneck = bottleneck && bottleneck.process_code === p.process_code && p.wip_qty > 0;
              const intensity = maxWip > 0 ? (p.wip_qty / maxWip) : 0;
              return (
                <div key={p.process_code || i} data-testid={`wip-row-${p.process_code}`}>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-foreground/40 font-mono w-5">#{i + 1}</span>
                      <span className="font-semibold text-foreground">{p.process_code}</span>
                      {isBottleneck && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))] border border-[hsl(var(--warning)/0.25)]">
                          <AlertTriangle className="w-2.5 h-2.5" /> Bottleneck
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 tabular-nums">
                      <span className="text-foreground/60">WIP <span className="font-bold text-foreground">{fmtNum(p.wip_qty)}</span></span>
                      <span className="text-foreground/60">Output <span className="font-bold text-foreground">{fmtNum(p.total_output)}</span></span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openQuickInput({ process_code: p.process_code })}
                        className="h-7 px-2 text-xs rounded-lg bg-white/5 hover:bg-white/10 border border-white/10"
                        data-testid={`overview-row-input-button-${p.process_code}`}
                      >
                        <Plus className="w-3 h-3 mr-1" />
                        <span className="hidden md:inline">Input</span>
                      </Button>
                    </div>
                  </div>
                  {/* Stacked bar: output (success) + wip (primary w/ intensity) */}
                  <div className="h-2.5 rounded-full overflow-hidden bg-[var(--glass-bg)] flex">
                    <div
                      className="h-full bg-[hsl(var(--success))] transition-[width] duration-500"
                      style={{ width: `${outPct}%` }}
                      title={`Output: ${p.total_output}`}
                    />
                    <div
                      className="h-full transition-[width,background-color] duration-500"
                      style={{
                        width: `${wipPct}%`,
                        background: isBottleneck
                          ? `hsl(var(--warning))`
                          : `hsl(var(--primary) / ${0.4 + intensity * 0.6})`,
                      }}
                      title={`WIP: ${p.wip_qty}`}
                    />
                  </div>
                </div>
              );
            })}
            {/* Legend */}
            <div className="flex items-center gap-4 pt-2 mt-2 border-t border-[var(--glass-border)] text-[10px] text-foreground/50">
              <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[hsl(var(--success))]" />Output selesai</div>
              <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[hsl(var(--primary))]" />WIP normal</div>
              <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[hsl(var(--warning))]" />WIP bottleneck</div>
            </div>
          </div>
        )}
      </ChartCard>

      {/* Phase 16: Setup Wizard modal */}
      <SetupWizard
        open={wizardOpen}
        token={token}
        onClose={() => setWizardOpen(false)}
        onNavigate={(moduleId) => onNavigate && onNavigate(moduleId)}
        onComplete={() => { setNaeNonce((n) => n + 1); fetchSummary(); }}
      />

      {/* Multi-Warehouse & CMT Summary Panels */}
      {(matSummary || cmtSummary) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Material Issue per Lokasi */}
          {matSummary && (
            <div className="bg-[var(--card-surface)] border border-border rounded-xl p-4" data-testid="mat-summary-panel">
              <div className="flex items-center gap-2 mb-3">
                <MapPin className="w-4 h-4 text-sky-400" />
                <span className="font-semibold text-sm">
                  Material Issue {selectedLoc && matSummary.locations ?
                    `— ${matSummary.locations.find(l=>l.id===selectedLoc)?.name || selectedLoc}` :
                    '— Semua Lokasi'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(matSummary.by_status || {}).map(([st, count]) => (
                  <div key={st} className="bg-white/3 rounded-lg p-2.5 text-center">
                    <div className="text-xs text-muted-foreground mb-0.5">{st}</div>
                    <div className="text-xl font-bold">{count}</div>
                  </div>
                ))}
                {Object.keys(matSummary.by_status || {}).length === 0 && (
                  <div className="col-span-2 text-center text-sm text-muted-foreground py-3">
                    Tidak ada material issue{selectedLoc ? ' di lokasi ini' : ''}
                  </div>
                )}
              </div>
              <div className="mt-3 pt-3 border-t border-border text-xs text-muted-foreground">
                Total MIs: <span className="font-medium text-foreground">{matSummary.total_mis}</span>
                {matSummary.locations && matSummary.locations.length > 0 && (
                  <span className="ml-3">Lokasi: {matSummary.locations.length} area</span>
                )}
              </div>
            </div>
          )}

          {/* CMT Packing Summary */}
          {cmtSummary && (
            <div className="bg-[var(--card-surface)] border border-border rounded-xl p-4" data-testid="cmt-summary-panel">
              <div className="flex items-center gap-2 mb-3">
                <Factory className="w-4 h-4 text-violet-400" />
                <span className="font-semibold text-sm">Penerimaan CMT</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label:'Menunggu Hitung', val: cmtSummary.pending, color:'amber' },
                  { label:'Menunggu Approval', val: cmtSummary.submitted, color:'sky' },
                  { label:'Sudah Disetujui', val: cmtSummary.approved, color:'emerald' },
                  { label:'Pcs Hari Ini', val: fmtNum(cmtSummary.pcs_approved_today), color:'violet' },
                ].map(s => (
                  <div key={s.label} className={`bg-${s.color}-500/5 border border-${s.color}-500/20 rounded-lg p-2.5 text-center`}>
                    <div className="text-xs text-muted-foreground mb-0.5">{s.label}</div>
                    <div className={`text-xl font-bold text-${s.color}-400`}>{s.val}</div>
                  </div>
                ))}
              </div>
              <button
                onClick={() => onNavigate && onNavigate('prod-cmt-packing')}
                className="mt-3 w-full py-1.5 text-xs text-primary border border-primary/20 rounded-lg hover:bg-primary/5 transition"
                data-testid="goto-cmt-packing-btn"
              >
                Buka Modul Packing CMT →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
