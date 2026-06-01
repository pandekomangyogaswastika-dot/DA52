import { useState, useCallback } from 'react';
import apiFetch from '@/lib/apiFetch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sparkles, Copy, History, Instagram, ShoppingCart, Film, Clock, RefreshCw, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const PLATFORM_CONFIG = {
  instagram: { label: 'Instagram', icon: Instagram, color: 'from-pink-500 to-purple-600', badge: 'IG', limit: 150 },
  tiktok:    { label: 'TikTok',    icon: Film,      color: 'from-slate-800 to-slate-600', badge: 'TikTok', limit: 100 },
  shopee:    { label: 'Shopee',    icon: ShoppingCart, color: 'from-orange-500 to-red-500', badge: 'Shopee', limit: 200 },
  tokopedia: { label: 'Tokopedia', icon: ShoppingCart, color: 'from-green-500 to-teal-600', badge: 'Tokped', limit: 180 },
};

function CopyButton({ text, className = '' }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <Button size="sm" variant="ghost" onClick={handleCopy} className={className}>
      {copied ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
      <span className="ml-1 text-xs">{copied ? 'Tersalin' : 'Copy'}</span>
    </Button>
  );
}

function GeneratorTab() {
  const { toast } = useToast();
  const [form, setForm] = useState({ product_name: '', category: '', material: '', colors: '', price: '', platform: 'instagram', custom_notes: '' });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleChange = useCallback((field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleGenerate = async () => {
    if (!form.product_name.trim()) {
      toast({ title: 'Nama produk wajib diisi', variant: 'destructive' });
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const payload = {
        product_name: form.product_name,
        platform: form.platform,
        ...(form.category && { category: form.category }),
        ...(form.material && { material: form.material }),
        ...(form.colors && { colors: form.colors.split(',').map(c => c.trim()).filter(Boolean) }),
        ...(form.price && { price: parseFloat(form.price) }),
        ...(form.custom_notes && { custom_notes: form.custom_notes }),
      };
      const data = await apiFetch('/marketing/ai-content/generate-caption', { method: 'POST', body: payload });
      setResult(data.data);
      toast({ title: 'Caption berhasil digenerate! ✨' });
    } catch (err) {
      toast({ title: 'Gagal generate caption', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const platform = form.platform;
  const cfg = PLATFORM_CONFIG[platform] || PLATFORM_CONFIG.instagram;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Form */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-500" />
            Input Produk
          </CardTitle>
          <CardDescription className="text-xs">Isi informasi produk untuk caption yang relevan</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs font-medium">Platform *</Label>
            <Select value={form.platform} onValueChange={v => handleChange('platform', v)}>
              <SelectTrigger className="mt-1 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PLATFORM_CONFIG).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    <span className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px] px-1 py-0">{v.badge}</Badge>
                      {v.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs font-medium">Nama Produk *</Label>
            <Input
              className="mt-1 h-9 text-sm"
              placeholder="Contoh: Blouse Batik Modern"
              value={form.product_name}
              onChange={e => handleChange('product_name', e.target.value)}
              data-testid="caption-product-name"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-medium">Kategori</Label>
              <Input className="mt-1 h-9 text-sm" placeholder="Atasan, Dress..." value={form.category} onChange={e => handleChange('category', e.target.value)} />
            </div>
            <div>
              <Label className="text-xs font-medium">Material</Label>
              <Input className="mt-1 h-9 text-sm" placeholder="Katun, Rayon..." value={form.material} onChange={e => handleChange('material', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-medium">Warna (pisahkan koma)</Label>
              <Input className="mt-1 h-9 text-sm" placeholder="Merah, Hitam, Putih" value={form.colors} onChange={e => handleChange('colors', e.target.value)} />
            </div>
            <div>
              <Label className="text-xs font-medium">Harga (Rp)</Label>
              <Input className="mt-1 h-9 text-sm" type="number" placeholder="85000" value={form.price} onChange={e => handleChange('price', e.target.value)} />
            </div>
          </div>

          <div>
            <Label className="text-xs font-medium">Catatan Tambahan (opsional)</Label>
            <Textarea
              className="mt-1 text-sm"
              rows={2}
              placeholder="Promosi flashsale, keunggulan khusus, target audience..."
              value={form.custom_notes}
              onChange={e => handleChange('custom_notes', e.target.value)}
            />
          </div>

          <Button
            className={`w-full bg-gradient-to-r ${cfg.color} text-white hover:opacity-90`}
            onClick={handleGenerate}
            disabled={loading}
            data-testid="btn-generate-caption"
          >
            {loading ? (
              <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Sedang generate...</>
            ) : (
              <><Sparkles className="h-4 w-4 mr-2" />Generate Caption AI</>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Result */}
      <Card className="border border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Badge variant="outline" className={`text-[10px]`}>{cfg.badge}</Badge>
            Hasil Caption
          </CardTitle>
          <CardDescription className="text-xs">Caption dan hashtag siap copy-paste</CardDescription>
        </CardHeader>
        <CardContent>
          {!result && !loading && (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <Sparkles className="h-10 w-10 mb-3 opacity-30" />
              <p className="text-sm">Isi form di sebelah kiri lalu<br />klik "Generate Caption AI"</p>
            </div>
          )}
          {loading && (
            <div className="flex flex-col items-center justify-center py-12">
              <RefreshCw className="h-8 w-8 animate-spin text-purple-500 mb-3" />
              <p className="text-sm text-muted-foreground">AI sedang menulis caption terbaik...</p>
            </div>
          )}
          {result && (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Caption</Label>
                  <CopyButton text={result.caption} />
                </div>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{result.caption}</p>
                <p className="text-[11px] text-muted-foreground mt-2">{result.caption?.length || 0} karakter (maks {cfg.limit})</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hashtag</Label>
                  <CopyButton text={result.hashtags} />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {result.hashtags?.split(' ').filter(h => h.startsWith('#')).map((h, i) => (
                    <Badge key={i} variant="secondary" className="text-xs font-normal">{h}</Badge>
                  ))}
                </div>
              </div>
              <CopyButton
                text={`${result.caption}\n\n${result.hashtags}`}
                className="w-full justify-center border border-dashed border-border"
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function HistoryTab() {
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all');

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const type = filter === 'all' ? '' : filter;
      const data = await apiFetch(`/marketing/ai-content/history?limit=30${type ? `&content_type=${type}` : ''}`);
      setHistory(data.data || []);
    } catch (err) {
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useState(() => { loadHistory(); }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <Select value={filter} onValueChange={v => { setFilter(v); loadHistory(); }}>
          <SelectTrigger className="w-40 h-8 text-sm">
            <SelectValue placeholder="Filter type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua</SelectItem>
            <SelectItem value="caption">Caption</SelectItem>
            <SelectItem value="image">Image</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={loadHistory}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />Refresh
        </Button>
      </div>

      {loading && <div className="text-center py-8 text-muted-foreground text-sm">Memuat riwayat...</div>}
      {!loading && !history?.length && <div className="text-center py-8 text-muted-foreground text-sm">Belum ada riwayat generate</div>}
      {!loading && history?.length > 0 && (
        <div className="space-y-3">
          {history.map((item, i) => (
            <Card key={i} className="border border-border">
              <CardContent className="p-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="text-[10px]">{item.type === 'caption' ? 'Caption' : 'Image'}</Badge>
                      {item.platform && <Badge variant="secondary" className="text-[10px]">{PLATFORM_CONFIG[item.platform]?.badge || item.platform}</Badge>}
                    </div>
                    <p className="text-sm font-medium">{item.product_name || item.prompt || 'N/A'}</p>
                    {item.caption && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.caption}</p>}
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {item.generated_at ? new Date(item.generated_at).toLocaleDateString('id-ID') : '-'}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AIContentGeneratorModule() {
  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            AI Content Generator
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">Generate caption & hashtag untuk IG, TikTok, Shopee, Tokopedia</p>
        </div>
        <Badge className="bg-purple-100 text-purple-700 border-purple-200">Powered by AI</Badge>
      </div>

      <Tabs defaultValue="generator">
        <TabsList className="h-9">
          <TabsTrigger value="generator" className="text-xs"><Sparkles className="h-3.5 w-3.5 mr-1.5" />Generator</TabsTrigger>
          <TabsTrigger value="history" className="text-xs"><History className="h-3.5 w-3.5 mr-1.5" />Riwayat</TabsTrigger>
        </TabsList>
        <TabsContent value="generator" className="mt-4">
          <GeneratorTab />
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          <HistoryTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
