import { useState, useEffect, useCallback } from 'react';
import { GlassCard, GlassInput } from '@/components/ui/glass';
import Modal from '@/components/erp/Modal';
import { Button } from '@/components/ui/button';
import { ClipboardCheck, Plus, Search, RefreshCw, CheckCircle, AlertTriangle, Download } from 'lucide-react';
import { IconButton } from './IconButton';
import * as XLSX from 'xlsx';

const fmtNum = (v) => (v || 0).toLocaleString('id-ID');
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';

const STATUS_STYLES = {
  draft:    'bg-slate-400/15 text-slate-400 border border-slate-300/20',
  counting: 'bg-amber-400/15 text-amber-400 border border-amber-300/20',
  review:   'bg-sky-400/15 text-sky-400 border border-sky-300/20',
  approved: 'bg-emerald-400/15 text-emerald-300 border border-emerald-300/20',
  adjusted: 'bg-teal-400/15 text-teal-400 border border-teal-300/20',
};

function exportOpnameExcel(opname) {
  const rows = (opname.items || []).map(it => ({
    'SKU':            it.sku || '',
    'Nama Produk':    it.product_name || '',
    'Qty Sistem':     it.system_qty ?? 0,
    'Qty Fisik':      it.counted_qty ?? it.physical_qty ?? 0,
    'Selisih':        it.variance ?? it.discrepancy ?? 0,
    'Keterangan':     it.notes || '',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{ wch: 20 }, { wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 25 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Opname');
  // Summary sheet
  const summaryRows = [
    { Kunci: 'Nomor Opname', Nilai: opname.opname_number || opname.id?.slice(0, 8) },
    { Kunci: 'Lokasi', Nilai: opname.location_name || '' },
    { Kunci: 'Status', Nilai: opname.status || '' },
    { Kunci: 'Dibuat', Nilai: fmtDate(opname.created_at) },
    { Kunci: 'Total Item', Nilai: rows.length },
    { Kunci: 'Total Selisih', Nilai: rows.reduce((s, r) => s + r['Selisih'], 0) },
  ];
  const ws2 = XLSX.utils.json_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, ws2, 'Summary');
  XLSX.writeFile(wb, `Opname-${opname.opname_number || opname.id?.slice(0, 8)}-${new Date().toISOString().slice(0,10)}.xlsx`);
}

export default function OpnameModule({ token }) {
  const [opnames, setOpnames] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState(null);
  const [createLoc, setCreateLoc] = useState('');
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const fetchData = useCallback(async () => {
    try {
      const [oRes, lRes] = await Promise.all([
        fetch('/api/wms/legacy/opname', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/wms/legacy/locations', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (oRes.ok) setOpnames(await oRes.json());
      if (lRes.ok) setLocations(await lRes.json());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [token]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(); }, []);

  const handleCreate = async () => {
    const loc = locations.find(l => l.id === createLoc);
    const res = await fetch('/api/wms/legacy/opname', {
      method: 'POST', headers,
      body: JSON.stringify({ location_id: createLoc, location_name: loc?.name || '' })
    });
    if (res.ok) { setShowCreate(false); setCreateLoc(''); fetchData(); }
  };

  const handleUpdateItem = (itemIdx, field, value) => {
    if (!showDetail) return;
    const items = [...showDetail.items];
    items[itemIdx] = { ...items[itemIdx], [field]: value };
    if (field === 'physical_qty') {
      items[itemIdx].discrepancy = (parseInt(value) || 0) - (items[itemIdx].system_qty || 0);
    }
    setShowDetail({ ...showDetail, items });
  };

  const handleSaveCounts = async () => {
    if (!showDetail) return;
    await fetch(`/api/wms/legacy/opname/${showDetail.id}`, {
      method: 'PUT', headers,
      body: JSON.stringify({ items: showDetail.items, status: 'review' })
    });
    setShowDetail(null); fetchData();
  };

  const handleApprove = async (opname) => {
    await fetch(`/api/wms/legacy/opname/${opname.id}`, {
      method: 'PUT', headers,
      body: JSON.stringify({ status: 'approved', items: opname.items })
    });
    setShowDetail(null); fetchData();
  };

  const handleAdjust = async (opname) => {
    await fetch(`/api/wms/legacy/opname/${opname.id}`, {
      method: 'PUT', headers,
      body: JSON.stringify({ status: 'adjusted', items: opname.items })
    });
    setShowDetail(null); fetchData();
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" /></div>;

  return (
    <div className="space-y-5" data-testid="wh-opname-module">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-foreground">Stock Opname</h1><p className="text-muted-foreground text-sm">Cycle count, selisih, dan adjustment stok</p></div>
        <div className="flex gap-2">
          <IconButton label="Refresh data" onClick={fetchData} data-testid="opname-refresh"><RefreshCw className="w-4 h-4 text-muted-foreground" /></IconButton>
          <Button onClick={() => setShowCreate(true)} className="bg-primary text-primary-foreground hover:brightness-110 gap-1.5" data-testid="create-opname-btn"><Plus className="w-4 h-4" /> New Opname</Button>
        </div>
      </div>

      <div className="space-y-3">
        {opnames.length === 0 ? (
          <GlassCard hover={false} className="p-8 text-center"><ClipboardCheck className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" /><p className="text-sm text-muted-foreground">No opname sessions yet</p></GlassCard>
        ) : opnames.map(op => (
          <GlassCard key={op.id} className="p-4 cursor-pointer" onClick={() => setShowDetail(op)} data-testid={`opname-${op.opname_number}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center"><ClipboardCheck className="w-5 h-5 text-primary" /></div>
                <div>
                  <p className="text-sm font-semibold text-foreground font-mono">{op.opname_number}</p>
                  <p className="text-xs text-muted-foreground">{op.location_name || 'All locations'} • {op.items?.length || 0} items</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${STATUS_STYLES[op.status] || STATUS_STYLES.counting}`}>{op.status}</span>
                <span className="text-xs text-muted-foreground">{fmtDate(op.created_at)}</span>
              </div>
            </div>
          </GlassCard>
        ))}
      </div>

      {showCreate && (
        <Modal title="New Stock Opname" onClose={() => setShowCreate(false)}>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Location (optional - leave empty for all)</label>
              <select value={createLoc} onChange={e => setCreateLoc(e.target.value)}
                className="w-full border border-[var(--glass-border)] bg-[var(--input-surface)] rounded-lg px-3 py-2 text-sm text-foreground">
                <option value="">All Locations</option>
                {locations.map(l => <option key={l.id} value={l.id}>{`${l.code} - ${l.name}`}</option>)}
              </select>
            </div>
            <p className="text-xs text-muted-foreground">System will pre-populate current stock items for counting.</p>
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setShowCreate(false)} className="border-[var(--glass-border)] text-muted-foreground">Batal</Button><Button onClick={handleCreate} className="bg-primary text-primary-foreground hover:brightness-110">Mulai Opname</Button></div>
          </div>
        </Modal>
      )}

      {showDetail && (
        <Modal title={`Opname ${showDetail.opname_number}`} onClose={() => setShowDetail(null)} size="xl">
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${STATUS_STYLES[showDetail.status]}`}>{showDetail.status}</span>
              <span className="text-xs text-muted-foreground">{showDetail.location_name || 'All locations'}</span>
              <span className="text-xs text-muted-foreground">By: {showDetail.counted_by}</span>
            </div>

            <GlassCard hover={false} className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr className="bg-[var(--glass-bg)]">
                    <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">Product</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">SKU</th>
                    <th className="text-right px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">System</th>
                    <th className="text-right px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">Physical</th>
                    <th className="text-right px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">Diff</th>
                  </tr></thead>
                  <tbody className="divide-y divide-[var(--glass-border)]">
                    {(showDetail.items || []).map((item, idx) => (
                      <tr key={item.id || idx} className="hover:bg-[var(--glass-bg-hover)]">
                        <td className="px-4 py-2 text-sm text-foreground">{item.product_name}</td>
                        <td className="px-4 py-2 text-sm text-muted-foreground font-mono">{item.sku}</td>
                        <td className="px-4 py-2 text-sm text-foreground text-right">{fmtNum(item.system_qty)}</td>
                        <td className="px-4 py-2 text-right">
                          {showDetail.status === 'counting' ? (
                            <input type="number" value={item.physical_qty ?? ''} onChange={e => handleUpdateItem(idx, 'physical_qty', e.target.value)}
                              className="w-20 text-right border border-[var(--glass-border)] bg-[var(--input-surface)] rounded px-2 py-1 text-sm text-foreground" />
                          ) : <span className="text-sm text-foreground">{item.physical_qty ?? '-'}</span>}
                        </td>
                        <td className={`px-4 py-2 text-sm text-right font-bold ${item.discrepancy > 0 ? 'text-emerald-400' : item.discrepancy < 0 ? 'text-red-400' : 'text-muted-foreground'}`}>
                          {item.discrepancy > 0 ? '+' : ''}{item.discrepancy || 0}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </GlassCard>

            <div className="flex justify-between items-center gap-2 pt-2 border-t border-[var(--glass-border)]">
              {/* U4 — Excel Export */}
              <button
                onClick={() => exportOpnameExcel(showDetail)}
                className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 px-3 py-1.5 bg-emerald-500/10 rounded-lg border border-emerald-500/20 transition-colors"
                data-testid="opname-export-excel-btn"
              >
                <Download size={13} /> Export Excel
              </button>
              <div className="flex gap-2">
                {showDetail.status === 'counting' && <Button onClick={handleSaveCounts} className="bg-sky-500 text-white hover:brightness-110">Submit for Review</Button>}
                {showDetail.status === 'review' && <Button onClick={() => handleApprove(showDetail)} className="bg-emerald-500 text-white hover:brightness-110"><CheckCircle className="w-4 h-4 mr-1" /> Approve</Button>}
                {showDetail.status === 'approved' && <Button onClick={() => handleAdjust(showDetail)} className="bg-primary text-primary-foreground hover:brightness-110"><AlertTriangle className="w-4 h-4 mr-1" /> Apply Adjustment</Button>}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
