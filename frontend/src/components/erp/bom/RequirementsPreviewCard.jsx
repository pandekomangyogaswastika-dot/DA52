import { useState } from 'react';
import { Calculator, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GlassPanel, GlassInput } from '@/components/ui/glass';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

/**
 * RequirementsPreviewCard
 * 
 * Kalkulasi kebutuhan material untuk quantity tertentu.
 * 
 * Props:
 * - bom: BOM object with materials
 * - token: JWT token
 */
export const RequirementsPreviewCard = ({ bom, token }) => {
  const [qtyPcs, setQtyPcs] = useState('1000');
  const [rounding, setRounding] = useState('none');
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const calculateRequirements = async () => {
    if (!qtyPcs || parseFloat(qtyPcs) <= 0) {
      toast.error('Masukkan quantity yang valid');
      return;
    }
    if (!bom || !bom.id) {
      toast.error('Pilih BOM terlebih dahulu');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/rahaza/boms/${bom.id}/requirements`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          qty_pcs: parseFloat(qtyPcs),
          rounding
        })
      });
      if (!res.ok) {
        throw new Error('Gagal menghitung kebutuhan material');
      }
      const data = await res.json();
      setPreview(data);
    } catch (err) {
      toast.error(err.message || 'Gagal menghitung kebutuhan');
    } finally {
      setLoading(false);
    }
  };

  const exportCSV = () => {
    if (!preview) return;
    
    let csv = 'Kategori,Kode,Nama,Jenis,Qty per pcs,Total Qty,Unit,Catatan\n';
    
    preview.yarns.forEach(y => {
      csv += `Benang,${y.code},"${y.name}","${y.yarn_type || ''}",${y.qty_per_pcs},${y.qty_total_kg},kg,"${y.notes || ''}"\n`;
    });
    
    preview.accessories.forEach(a => {
      csv += `Aksesoris,${a.code},"${a.name}",,${a.qty_per_pcs},${a.qty_total},${a.unit},"${a.notes || ''}"\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kebutuhan-material-${bom.model_code}-${bom.size_code}-v${bom.version}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    toast.success('CSV berhasil diunduh');
  };

  return (
    <GlassPanel className="p-5 space-y-5" data-testid="requirements-preview-card">
      <div>
        <h3 className="text-lg font-semibold text-foreground flex items-center gap-2 mb-1">
          <Calculator className="w-5 h-5 text-primary" />
          Preview Kebutuhan Material
        </h3>
        <p className="text-sm text-muted-foreground">
          Hitung kebutuhan material untuk produksi quantity tertentu
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2">
          <Label htmlFor="qty-pcs">Quantity (pcs) *</Label>
          <GlassInput
            id="qty-pcs"
            type="number"
            placeholder="1000"
            value={qtyPcs}
            onChange={e => setQtyPcs(e.target.value)}
            data-testid="requirements-qty-input"
          />
        </div>
        <div>
          <Label htmlFor="rounding">Pembulatan</Label>
          <Select value={rounding} onValueChange={setRounding}>
            <SelectTrigger id="rounding">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Tidak ada</SelectItem>
              <SelectItem value="ceil">Ke atas (ceil)</SelectItem>
              <SelectItem value="floor">Ke bawah (floor)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button
        onClick={calculateRequirements}
        disabled={loading || !qtyPcs}
        className="w-full"
        data-testid="requirements-calculate-button"
      >
        {loading ? 'Menghitung...' : 'Hitung Kebutuhan'}
      </Button>

      {preview && (
        <div className="space-y-4 pt-4 border-t border-[var(--glass-border)]">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-muted-foreground">Untuk produksi</div>
              <div className="text-2xl font-bold text-foreground font-mono">
                {preview.qty_pcs} pcs
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {preview.model_code} · {preview.size_code} · v{preview.version}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={exportCSV}
              data-testid="requirements-export-csv-button"
            >
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
          </div>

          {/* Yarn Summary */}
          {preview.yarns && preview.yarns.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-foreground">Benang (Yarn)</h4>
                <Badge variant="secondary" className="font-mono">
                  Total: {preview.total_yarn_kg.toFixed(3)} kg
                </Badge>
              </div>
              <div className="border border-[var(--glass-border)] rounded-lg overflow-hidden">
                <Table data-testid="requirements-preview-yarn-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Kode</TableHead>
                      <TableHead>Nama</TableHead>
                      <TableHead>Jenis</TableHead>
                      <TableHead className="text-right">Qty/pcs</TableHead>
                      <TableHead className="text-right">Total (kg)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.yarns.map((y, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-mono text-xs">{y.code}</TableCell>
                        <TableCell>{y.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{y.yarn_type || '—'}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{y.qty_per_pcs}</TableCell>
                        <TableCell className="text-right font-mono font-semibold">{y.qty_total_kg.toFixed(3)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {/* Accessory Summary */}
          {preview.accessories && preview.accessories.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-foreground">Aksesoris</h4>
                <Badge variant="secondary">
                  {preview.accessories.length} item
                </Badge>
              </div>
              <div className="border border-[var(--glass-border)] rounded-lg overflow-hidden">
                <Table data-testid="requirements-preview-accessory-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Kode</TableHead>
                      <TableHead>Nama</TableHead>
                      <TableHead className="text-right">Qty/pcs</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Unit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.accessories.map((a, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-mono text-xs">{a.code}</TableCell>
                        <TableCell>{a.name}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{a.qty_per_pcs}</TableCell>
                        <TableCell className="text-right font-mono font-semibold">{a.qty_total}</TableCell>
                        <TableCell className="text-xs">{a.unit}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>
      )}
    </GlassPanel>
  );
};
