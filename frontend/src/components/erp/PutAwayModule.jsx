import { useState, useEffect, useCallback } from 'react';
import { GlassCard, GlassInput } from '@/components/ui/glass';
import { Button } from '@/components/ui/button';
import { MapPin, ArrowRight, Boxes, Search, RefreshCw, Check } from 'lucide-react';
import { IconButton } from './IconButton';

const fmtNum = (v) => (v || 0).toLocaleString('id-ID');

export default function PutAwayModule({ token }) {
  const [stock, setStock] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedStock, setSelectedStock] = useState(null);
  const [targetLoc, setTargetLoc] = useState('');
  const [qty, setQty] = useState(0);
  const [message, setMessage] = useState(null);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const fetchData = useCallback(async () => {
    try {
      const [sRes, lRes] = await Promise.all([
        fetch('/api/wms/legacy/stock', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/wms/legacy/locations', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (sRes.ok) setStock(await sRes.json());
      if (lRes.ok) setLocations(await lRes.json());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [token]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(); }, []);

  const handlePutAway = async () => {
    if (!selectedStock || !targetLoc || qty <= 0) return;
    try {
      const res = await fetch('/api/wms/legacy/putaway', {
        method: 'POST', headers,
        body: JSON.stringify({ stock_id: selectedStock.id, target_location_id: targetLoc, qty })
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: 'success', text: `Moved ${qty} units to ${data.target_location}` });
        setSelectedStock(null); setTargetLoc(''); setQty(0); fetchData();
      } else { setMessage({ type: 'error', text: data.detail || 'Error' }); }
    } catch (e) { setMessage({ type: 'error', text: e.message }); }
    setTimeout(() => setMessage(null), 4000);
  };

  const availableStock = stock.filter(s => s.quantity > 0);
  const binLocations = locations.filter(l => l.type === 'bin' || l.type === 'zone');

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" /></div>;

  return (
    <div className="space-y-6" data-testid="wh-putaway-module">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-foreground">Put-Away</h1><p className="text-muted-foreground text-sm">Alokasi barang ke lokasi penyimpanan</p></div>
        <IconButton label="Refresh data" onClick={fetchData} data-testid="putaway-refresh"><RefreshCw className="w-4 h-4 text-muted-foreground" /></IconButton>
      </div>

      {message && (
        <div className={`p-3 rounded-xl text-sm font-medium ${message.type === 'success' ? 'bg-emerald-400/10 text-emerald-400 border border-emerald-300/20' : 'bg-red-400/10 text-red-400 border border-red-300/20'}`}>{message.text}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Step 1: Select Stock */}
        <GlassCard hover={false} className="p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2"><Boxes className="w-4 h-4 text-primary" /> 1. Pilih Stock</h3>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {availableStock.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No stock available</p>
            ) : availableStock.map(s => (
              <button key={s.id} onClick={() => { setSelectedStock(s); setQty(s.quantity); }}
                className={`w-full text-left p-3 rounded-xl border transition-colors ${
                  selectedStock?.id === s.id ? 'border-primary/40 bg-primary/10' : 'border-[var(--glass-border)] bg-[var(--glass-bg)] hover:bg-[var(--glass-bg-hover)]'
                }`} data-testid={`stock-${s.sku}`}>
                <p className="text-sm font-medium text-foreground">{s.product_name}</p>
                <p className="text-xs text-muted-foreground font-mono">{s.sku} • {fmtNum(s.quantity)} {s.unit || 'pcs'}</p>
              </button>
            ))}
          </div>
        </GlassCard>

        {/* Step 2: Select Target & Qty */}
        <GlassCard hover={false} className="p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2"><MapPin className="w-4 h-4 text-primary" /> 2. Target & Quantity</h3>
          {selectedStock ? (
            <div className="space-y-4">
              <div className="p-3 rounded-xl bg-primary/10 border border-primary/20">
                <p className="text-sm font-medium text-foreground">{selectedStock.product_name}</p>
                <p className="text-xs text-muted-foreground">Available: {fmtNum(selectedStock.quantity)}</p>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Target Location</label>
                <select value={targetLoc} onChange={e => setTargetLoc(e.target.value)}
                  className="w-full border border-[var(--glass-border)] bg-[var(--input-surface)] rounded-lg px-3 py-2 text-sm text-foreground" data-testid="target-location-select">
                  <option value="">Select bin/zone...</option>
                  {binLocations.map(l => <option key={l.id} value={l.id}>{`${l.code} - ${l.name}`}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Quantity to Move</label>
                <GlassInput type="number" value={qty} onChange={e => setQty(Math.min(selectedStock.quantity, parseInt(e.target.value) || 0))}
                  max={selectedStock.quantity} data-testid="putaway-qty-input" />
              </div>
            </div>
          ) : <p className="text-xs text-muted-foreground text-center py-8">Select a stock item first</p>}
        </GlassCard>

        {/* Step 3: Execute */}
        <GlassCard hover={false} className="p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2"><ArrowRight className="w-4 h-4 text-primary" /> 3. Confirm</h3>
          {selectedStock && targetLoc && qty > 0 ? (
            <div className="space-y-4">
              <div className="p-3 rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)] space-y-2">
                <div className="flex justify-between text-xs"><span className="text-muted-foreground">Product</span><span className="text-foreground font-medium">{selectedStock.product_name}</span></div>
                <div className="flex justify-between text-xs"><span className="text-muted-foreground">SKU</span><span className="text-foreground font-mono">{selectedStock.sku}</span></div>
                <div className="flex justify-between text-xs"><span className="text-muted-foreground">Target</span><span className="text-foreground">{binLocations.find(l => l.id === targetLoc)?.code}</span></div>
                <div className="flex justify-between text-xs"><span className="text-muted-foreground">Quantity</span><span className="text-foreground font-bold">{fmtNum(qty)}</span></div>
              </div>
              <Button onClick={handlePutAway} className="w-full bg-primary text-primary-foreground hover:brightness-110" data-testid="confirm-putaway-btn">
                <Check className="w-4 h-4 mr-1" /> Execute Put-Away
              </Button>
            </div>
          ) : <p className="text-xs text-muted-foreground text-center py-8">Complete steps 1 & 2 first</p>}
        </GlassCard>
      </div>
    </div>
  );
}
