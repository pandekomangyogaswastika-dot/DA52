import { useState } from 'react';
import { Save, X } from 'lucide-react';
import { GlassCard, GlassInput } from '@/components/ui/glass';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';

export function SalesDataEntryForm({ accountId, accountName, onClose, onSuccess, token }) {
  const [loading, setLoading] = useState(false);
  const [revenueType, setRevenueType] = useState('total');
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    revenue: '',
    orders: '',
    // Fulfillment
    fulfillment_rate: '',
    cancellation_rate: '',
    return_rate: '',
    late_shipment_rate: '',
    // Satisfaction
    rating: '',
    review_count: '',
    response_rate: '',
    response_time_hours: '',
    // Live metrics (only if revenue_type=live)
    viewers: '',
    avg_viewers: '',
    likes: '',
    shares: '',
    comments: '',
    new_followers: '',
    live_sessions: '',
  });

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Build payload
      const payload = {
        account_id: accountId,
        date: formData.date,
        revenue_type: revenueType,
        revenue: parseFloat(formData.revenue) || 0,
        orders: parseInt(formData.orders) || 0,
        fulfillment_rate: parseFloat(formData.fulfillment_rate) || null,
        cancellation_rate: parseFloat(formData.cancellation_rate) || null,
        return_rate: parseFloat(formData.return_rate) || null,
        late_shipment_rate: parseFloat(formData.late_shipment_rate) || null,
        rating: parseFloat(formData.rating) || null,
        review_count: parseInt(formData.review_count) || null,
        response_rate: parseFloat(formData.response_rate) || null,
        response_time_hours: parseFloat(formData.response_time_hours) || null,
      };

      // Add live metrics if revenue_type=live
      if (revenueType === 'live') {
        payload.viewers = parseInt(formData.viewers) || null;
        payload.avg_viewers = parseInt(formData.avg_viewers) || null;
        payload.likes = parseInt(formData.likes) || null;
        payload.shares = parseInt(formData.shares) || null;
        payload.comments = parseInt(formData.comments) || null;
        payload.new_followers = parseInt(formData.new_followers) || null;
        payload.live_sessions = parseInt(formData.live_sessions) || null;
      }

      const res = await fetch('/api/marketing/sales-data', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        toast.success('Data penjualan tersimpan');
        if (onSuccess) onSuccess();
        if (onClose) onClose();
      } else {
        const err = await res.json();
        toast.error(err.detail || 'Gagal menyimpan data');
      }
    } catch (e) {
      toast.error('Error: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <GlassCard className="p-6" data-testid="sales-data-entry-form">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Input Data Penjualan</h3>
          <p className="text-sm text-muted-foreground">{accountName}</p>
        </div>
        {onClose && (
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Date & Revenue Type */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Tanggal</label>
            <GlassInput
              type="date"
              value={formData.date}
              onChange={e => handleChange('date', e.target.value)}
              required
              data-testid="input-date"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Tipe Revenue</label>
            <Select value={revenueType} onValueChange={setRevenueType}>
              <SelectTrigger data-testid="select-revenue-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="total">Total (Keseluruhan)</SelectItem>
                <SelectItem value="live">Live (Live Streaming)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Basic Sales */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Revenue (Rp)</label>
            <GlassInput
              type="number"
              value={formData.revenue}
              onChange={e => handleChange('revenue', e.target.value)}
              required
              data-testid="input-revenue"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Orders</label>
            <GlassInput
              type="number"
              value={formData.orders}
              onChange={e => handleChange('orders', e.target.value)}
              required
              data-testid="input-orders"
            />
          </div>
        </div>

        {/* Tabs for detailed metrics */}
        <Tabs defaultValue="fulfillment" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="fulfillment">Fulfillment</TabsTrigger>
            <TabsTrigger value="satisfaction">Satisfaction</TabsTrigger>
            {revenueType === 'live' && <TabsTrigger value="live">Live</TabsTrigger>}
          </TabsList>

          <TabsContent value="fulfillment" className="space-y-3 mt-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Fulfillment Rate (0-1)</label>
                <GlassInput
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  value={formData.fulfillment_rate}
                  onChange={e => handleChange('fulfillment_rate', e.target.value)}
                  placeholder="0.95"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Cancellation Rate (0-1)</label>
                <GlassInput
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  value={formData.cancellation_rate}
                  onChange={e => handleChange('cancellation_rate', e.target.value)}
                  placeholder="0.02"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Return Rate (0-1)</label>
                <GlassInput
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  value={formData.return_rate}
                  onChange={e => handleChange('return_rate', e.target.value)}
                  placeholder="0.01"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Late Shipment Rate (0-1)</label>
                <GlassInput
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  value={formData.late_shipment_rate}
                  onChange={e => handleChange('late_shipment_rate', e.target.value)}
                  placeholder="0.01"
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="satisfaction" className="space-y-3 mt-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Rating (0-5)</label>
                <GlassInput
                  type="number"
                  step="0.1"
                  min="0"
                  max="5"
                  value={formData.rating}
                  onChange={e => handleChange('rating', e.target.value)}
                  placeholder="4.8"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Review Count</label>
                <GlassInput
                  type="number"
                  value={formData.review_count}
                  onChange={e => handleChange('review_count', e.target.value)}
                  placeholder="150"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Response Rate (0-1)</label>
                <GlassInput
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  value={formData.response_rate}
                  onChange={e => handleChange('response_rate', e.target.value)}
                  placeholder="0.95"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Response Time (hours)</label>
                <GlassInput
                  type="number"
                  step="0.1"
                  value={formData.response_time_hours}
                  onChange={e => handleChange('response_time_hours', e.target.value)}
                  placeholder="2.5"
                />
              </div>
            </div>
          </TabsContent>

          {revenueType === 'live' && (
            <TabsContent value="live" className="space-y-3 mt-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Viewers</label>
                  <GlassInput
                    type="number"
                    value={formData.viewers}
                    onChange={e => handleChange('viewers', e.target.value)}
                    placeholder="2500"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Avg Viewers</label>
                  <GlassInput
                    type="number"
                    value={formData.avg_viewers}
                    onChange={e => handleChange('avg_viewers', e.target.value)}
                    placeholder="850"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Likes</label>
                  <GlassInput
                    type="number"
                    value={formData.likes}
                    onChange={e => handleChange('likes', e.target.value)}
                    placeholder="12000"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Shares</label>
                  <GlassInput
                    type="number"
                    value={formData.shares}
                    onChange={e => handleChange('shares', e.target.value)}
                    placeholder="450"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Comments</label>
                  <GlassInput
                    type="number"
                    value={formData.comments}
                    onChange={e => handleChange('comments', e.target.value)}
                    placeholder="3200"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">New Followers</label>
                  <GlassInput
                    type="number"
                    value={formData.new_followers}
                    onChange={e => handleChange('new_followers', e.target.value)}
                    placeholder="320"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Live Sessions</label>
                  <GlassInput
                    type="number"
                    value={formData.live_sessions}
                    onChange={e => handleChange('live_sessions', e.target.value)}
                    placeholder="2"
                  />
                </div>
              </div>
            </TabsContent>
          )}
        </Tabs>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-4 border-t border-[var(--glass-border)]">
          {onClose && (
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Batal
            </Button>
          )}
          <Button type="submit" disabled={loading} data-testid="submit-sales-data">
            <Save className="w-4 h-4 mr-2" />
            {loading ? 'Menyimpan...' : 'Simpan Data'}
          </Button>
        </div>
      </form>
    </GlassCard>
  );
}
