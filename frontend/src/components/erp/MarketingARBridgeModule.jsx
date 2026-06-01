/**
 * MarketingARBridgeModule — Phase 7E
 * Generate AR Invoices dari Marketing Sales Data dalam batch
 */
import React, { useState } from 'react';
import { Calendar, DollarSign, FileText, TrendingUp, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

const API_BASE = process.env.REACT_APP_BACKEND_URL || '';

export default function MarketingARBridgeModule() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [revenueType, setRevenueType] = useState('total');
  const [grouping, setGrouping] = useState('daily');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);

  const handleGenerate = async () => {
    if (!dateFrom || !dateTo) {
      toast.error('Tanggal From dan To wajib diisi');
      return;
    }

    setLoading(true);
    setResults(null);

    try {
      const res = await fetch(`${API_BASE}/api/marketing/sales-data/generate-ar-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          date_from: dateFrom,
          date_to: dateTo,
          revenue_type: revenueType,
          grouping,
          notes,
        }),
      });

      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.detail || 'Generate AR batch failed');
      }

      setResults(data);
      
      const successCount = data.invoices?.filter(inv => inv._posting_result?.ok).length || 0;
      const errorCount = (data.invoices?.length || 0) - successCount;

      if (errorCount > 0) {
        toast.warning(`${data.count} AR Invoice dibuat, ${errorCount} gagal posting GL`);
      } else {
        toast.success(`${data.count} AR Invoice berhasil dibuat dan dipost ke GL`);
      }
    } catch (err) {
      console.error('Generate AR batch error:', err);
      toast.error(err.message || 'Terjadi kesalahan');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setDateFrom('');
    setDateTo('');
    setRevenueType('total');
    setGrouping('daily');
    setNotes('');
    setResults(null);
  };

  return (
    <div className="h-screen overflow-auto bg-background p-4 md:p-6" data-testid="marketing-ar-bridge-module">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="module-title">
              Marketing Sales → AR Invoice Bridge
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Generate AR Invoice secara batch dari data penjualan marketing
            </p>
          </div>
          <Badge variant="outline" className="text-xs">
            Phase 7E
          </Badge>
        </div>

        {/* Form */}
        <Card className="border-border/50 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Generate AR Batch</CardTitle>
            <CardDescription>
              Pilih periode dan strategi grouping untuk membuat AR Invoice otomatis
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="date-from">Tanggal Dari *</Label>
                <Input
                  id="date-from"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  data-testid="date-from-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="date-to">Tanggal Sampai *</Label>
                <Input
                  id="date-to"
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  data-testid="date-to-input"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="revenue-type">Revenue Type</Label>
                <Select value={revenueType} onValueChange={setRevenueType}>
                  <SelectTrigger id="revenue-type" data-testid="revenue-type-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="total">Total Revenue</SelectItem>
                    <SelectItem value="live">Live Revenue Only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="grouping">Grouping Strategy</Label>
                <Select value={grouping} onValueChange={setGrouping}>
                  <SelectTrigger id="grouping" data-testid="grouping-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily (1 invoice per hari per platform)</SelectItem>
                    <SelectItem value="weekly">Weekly (1 invoice per minggu)</SelectItem>
                    <SelectItem value="monthly">Monthly (1 invoice per bulan)</SelectItem>
                    <SelectItem value="platform">Platform (1 invoice per platform)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Catatan (Optional)</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Catatan tambahan untuk AR Invoice..."
                rows={2}
                data-testid="notes-textarea"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button 
                onClick={handleGenerate} 
                disabled={loading}
                data-testid="generate-btn"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <FileText className="mr-2 h-4 w-4" />
                    Generate AR Batch
                  </>
                )}
              </Button>
              <Button variant="outline" onClick={handleReset} disabled={loading}>
                Reset
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        {results && (
          <Card className="border-border/50 shadow-sm" data-testid="results-card">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-success" />
                Hasil Generate ({results.count} Invoice)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {results.invoices && results.invoices.length > 0 ? (
                  <div className="space-y-2">
                    {results.invoices.map((inv) => (
                      <div
                        key={inv.id}
                        className="flex items-center justify-between p-3 rounded-lg border border-border/50 hover:bg-muted/30 transition-colors"
                        data-testid={`invoice-item-${inv.invoice_number}`}
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{inv.invoice_number}</span>
                            <Badge variant="outline" className="text-xs">
                              {inv.source_metadata?.platform?.toUpperCase()}
                            </Badge>
                          </div>
                          <div className="text-sm text-muted-foreground mt-1">
                            {inv.source_metadata?.entries_count} entries • {inv.issue_date}
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <div className="font-semibold">
                              Rp {(inv.total || 0).toLocaleString('id-ID')}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Status: {inv.status}
                            </div>
                          </div>
                          {inv._posting_result?.ok ? (
                            <CheckCircle2 className="h-5 w-5 text-success" data-testid="posting-success" />
                          ) : (
                            <AlertCircle 
                              className="h-5 w-5 text-destructive" 
                              title={inv._posting_result?.error || 'Posting failed'}
                              data-testid="posting-error"
                            />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    Tidak ada invoice yang dibuat
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Info */}
        <Card className="border-border/50 bg-muted/20">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Cara Kerja
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>• Sistem akan mengambil data penjualan dari <strong>marketing_sales_data</strong> sesuai periode yang dipilih</p>
            <p>• Data akan di-group sesuai strategi (daily/weekly/monthly/platform)</p>
            <p>• AR Invoice akan dibuat otomatis dengan customer default: <strong>Marketplace Customer</strong></p>
            <p>• Setiap invoice langsung di-<strong>send</strong> dan di-<strong>post ke GL</strong> (Dr. AR / Cr. Revenue)</p>
            <p>• Status posting ditampilkan per invoice (✓ sukses / ⚠️ error)</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
