/**
 * Toko Adapter (Frontend)
 * =======================
 * Phase B Toko Frontend Cutover (2026-05-23).
 *
 * Converts marketing_* response shapes → legacy dewi_toko_* shapes.
 * Used by frontend Toko modules after they cut over from
 * `/api/dewi/toko/*` to `/api/marketing/*` endpoints.
 *
 * IMPORTANT: backend `_toko_adapter.py` has the canonical functions.
 * Keep this file in sync with that.
 */

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

export const CHANNEL_TO_PLATFORM = {
  shopee: 'shopee',
  tiktok: 'tiktok',
  tokopedia: 'tokopedia',
  lazada: 'lazada',
  blibli: 'blibli',
  instagram: 'instagram',
  whatsapp: 'whatsapp',
};

export const PLATFORM_TO_CHANNEL = Object.fromEntries(
  Object.entries(CHANNEL_TO_PLATFORM).map(([k, v]) => [v, k])
);

export const MKT_TO_TOKO_ORDER_STATUS = {
  new: 'new',
  packed: 'packed',
  shipped: 'shipped',
  delivered: 'delivered',
  cancelled: 'cancelled',
  returned: 'returned',
};

export const TOKO_TO_MKT_ORDER_STATUS = {
  new: 'new',
  packed: 'packed',
  shipped: 'shipped',
  delivered: 'delivered',
  cancelled: 'cancelled',
  closed: 'delivered',
  returned: 'returned',
};

// For inverse direction: toko field → marketing field (for write payloads)
export const TOKO_TO_MKT_ORDER_FIELDS = {
  packed_at: 'packed_date',
  shipped_at: 'shipped_date',
  delivered_at: 'delivered_date',
  cancelled_at: 'cancelled_date',
  total_amount: 'total_payment',
  customer_city: 'city',
  notes: 'note',
  order_number: '_legacy_order_number',
  order_ref: 'order_id',
};


// ──────────────────────────────────────────────────────────────────────────────
// PRODUCTS: marketing_catalog_items → dewi_toko_products
// ──────────────────────────────────────────────────────────────────────────────

export function catalogItemToTokoProduct(it) {
  if (!it) return null;
  return {
    id: it.id,
    sku_code: it.sku_code || '',
    name: it.name || '',
    description: it.description || '',
    category: it.category || '',
    base_price: Number(it.base_price || 0),
    cost_price: Number(it.cost_price || 0),
    channel_prices: it.channel_prices || [],
    variants: it.variants || [],
    photos: it.photos || [],
    stock_total: Number(it.stock_total || 0),
    stock_reserved: Number(it.stock_reserved || 0),
    weight_grams: it.weight_grams,
    status: it.status || 'draft',
    tags: it.tags || [],
    sales_count_total: Number(it.sales_count_total || 0),
    _source: 'marketing_catalog_items',
    created_by: it.created_by || '',
    created_at: it.created_at,
    updated_at: it.updated_at,
  };
}


// ──────────────────────────────────────────────────────────────────────────────
// ORDERS: marketing_orders → dewi_toko_orders
// ──────────────────────────────────────────────────────────────────────────────

export function marketingToTokoOrder(mo) {
  if (!mo) return null;
  const status = MKT_TO_TOKO_ORDER_STATUS[mo.status] || 'new';
  let items = Array.isArray(mo.items) ? mo.items : [];
  if (items.length === 0 && mo.sku_id) {
    items = [{
      sku_code: mo.sku_id || '',
      name: mo.product_name || '',
      qty: Number(mo.quantity || 1),
      price: Number(mo.price_final || mo.price_original || 0),
      variant: mo.variation || '',
    }];
  }
  return {
    id: mo.id,
    order_number: mo._legacy_order_number || mo.order_id,
    order_ref: mo.order_id,
    channel_code: mo.channel_code || PLATFORM_TO_CHANNEL[(mo.platform || '').toLowerCase()] || mo.platform || '',
    customer_name: mo.customer_name || '',
    customer_address: mo.customer_address || '',
    customer_city: mo.city || '',
    customer_phone: mo.customer_phone || '',
    items,
    total_amount: Number(mo.total_payment || 0),
    fee_amount: Number(mo.fee_amount || 0),
    net_amount: Number(mo.net_amount || mo.revenue || 0),
    shipping_cost: Number(mo.shipping_cost || 0),
    payment_method: mo.payment_method || '',
    status,
    courier: mo.courier || '',
    tracking_number: mo.tracking_number,
    notes: mo.note || '',
    pack_batch_id: mo.pack_batch_id,
    packed_at: mo.packed_date,
    shipped_at: mo.shipped_date,
    delivered_at: mo.delivered_date,
    cancelled_at: mo.cancelled_date,
    _source: 'marketing_orders',
    created_by: mo.created_by,
    created_at: mo.created_at || mo.order_date,
    updated_at: mo.updated_at,
  };
}

export function tokoOrderToMarketing(o) {
  if (!o) return null;
  const items = Array.isArray(o.items) ? o.items : [];
  const primary = items[0] || {};
  const qty_total = items.reduce((s, it) => s + Number(it.qty || 0), 0);
  const total_amount = Number(o.total_amount || 0);
  const fee_amount = Number(o.fee_amount || 0);
  const net_amount = Number(o.net_amount || total_amount - fee_amount);
  const channel_code = (o.channel_code || '').toLowerCase();
  const platform = CHANNEL_TO_PLATFORM[channel_code] || channel_code;
  const status = TOKO_TO_MKT_ORDER_STATUS[o.status || 'new'] || 'new';

  return {
    id: o.id,
    order_id: o.order_number || o.order_ref,
    platform,
    channel_code,
    account_name: o.channel_code || platform,
    product_name: primary.name || primary.sku_code || '(multi item)',
    sku_id: primary.sku_code || '',
    variation: primary.variant || '',
    items,
    quantity: qty_total,
    price_original: Number(primary.price || 0),
    price_final: Number(primary.price || 0),
    discount_seller: 0,
    shipping_cost: Number(o.shipping_cost || 0),
    total_payment: total_amount,
    fee_amount,
    net_amount,
    revenue: net_amount,
    payment_method: o.payment_method || '',
    status,
    courier: o.courier || '',
    tracking_number: o.tracking_number,
    customer_name: o.customer_name || '',
    customer_phone: o.customer_phone || '',
    customer_address: o.customer_address || '',
    city: o.customer_city || '',
    note: o.notes || '',
    pack_batch_id: o.pack_batch_id,
    _legacy_order_number: o.order_number,
    _legacy_toko: true,
  };
}


// ──────────────────────────────────────────────────────────────────────────────
// RETURNS: marketing_returns ↔ dewi_toko_returns
// ──────────────────────────────────────────────────────────────────────────────

export function marketingReturnToToko(mr) {
  if (!mr) return null;
  return {
    id: mr.id,
    return_code: mr.return_number,
    return_number: mr.return_number,
    order_id: mr.order_id,
    order_number: mr.order_number,
    channel_code: mr.channel_code || '',
    return_type: mr.return_type || 'customer_refund',
    customer_name: mr.customer_name || '',
    reason: mr.reason || '',
    reason_category: mr.reason_category || 'other',
    evidence_notes: mr.evidence_notes || '',
    evidence_photos: mr.evidence_photos || [],
    estimated_value: Number(mr.estimated_value || 0),
    status: mr.status || 'new',
    decision: mr.decision || 'pending',
    decision_notes: mr.decision_notes || '',
    tracking_number: mr.tracking_number,
    _source: 'marketing_returns',
    created_by: mr.created_by,
    created_at: mr.created_at,
    updated_at: mr.updated_at,
  };
}


// ──────────────────────────────────────────────────────────────────────────────
// REVIEWS: marketing_reviews ↔ dewi_toko_reviews
// ──────────────────────────────────────────────────────────────────────────────

export function marketingReviewToToko(mrv) {
  if (!mrv) return null;
  return {
    id: mrv.id,
    channel_code: mrv.channel_code || PLATFORM_TO_CHANNEL[(mrv.platform || '').toLowerCase()] || mrv.platform || 'shopee',
    order_ref: mrv.order_ref,
    customer_name: mrv.customer_name || '',
    rating: Number(mrv.rating || 5),
    review_text: mrv.review_text || '',
    sku_code: mrv.sku_code,
    status: mrv.status || 'unread',
    response_text: mrv.response_text,
    responded_at: mrv.responded_at,
    _source: 'marketing_reviews',
    created_by: mrv.created_by,
    created_at: mrv.created_at,
    updated_at: mrv.updated_at,
  };
}


// ──────────────────────────────────────────────────────────────────────────────
// Helper utilities
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Discover the "Toko Legacy" catalog id from marketing_catalogs.
 * Caches the result globally per page session.
 */
let _tokoCatalogIdCache = null;
let _tokoCatalogPromise = null;

export async function getTokoCatalogId(headers) {
  if (_tokoCatalogIdCache) return _tokoCatalogIdCache;
  if (_tokoCatalogPromise) return await _tokoCatalogPromise;

  _tokoCatalogPromise = (async () => {
    try {
      const r = await fetch('/api/marketing/catalogs', { headers });
      if (!r.ok) throw new Error('Failed to load catalogs');
      const catalogs = await r.json();
      const list = Array.isArray(catalogs) ? catalogs : (catalogs.items || []);
      const legacy = list.find(c => c._toko_legacy === true || c.name?.includes('Toko Legacy'));
      if (legacy) {
        _tokoCatalogIdCache = legacy.id;
        return legacy.id;
      }
      // Auto-create if missing (admin only — will fail silently for non-admins)
      const createR = await fetch('/api/marketing/catalogs', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Toko Legacy (Auto-Created)',
          description: 'Auto-created catalog untuk Toko modules.',
          platform: 'multi',
        }),
      });
      if (createR.ok) {
        const created = await createR.json();
        _tokoCatalogIdCache = created.id;
        return created.id;
      }
      throw new Error('Toko Legacy catalog not found and could not be created');
    } catch (e) {
      console.error('[tokoAdapter] getTokoCatalogId failed:', e);
      return null;
    } finally {
      _tokoCatalogPromise = null;
    }
  })();
  return await _tokoCatalogPromise;
}

/** Reset cache (use in tests or on logout) */
export function resetTokoCatalogCache() {
  _tokoCatalogIdCache = null;
  _tokoCatalogPromise = null;
}


// Array helpers (handle both [] and {items:[]} response shapes)
export function projectMarketingOrders(resp) {
  if (Array.isArray(resp)) return resp.map(marketingToTokoOrder).filter(Boolean);
  if (resp && Array.isArray(resp.items)) return resp.items.map(marketingToTokoOrder).filter(Boolean);
  return [];
}

export function projectCatalogItems(resp) {
  if (Array.isArray(resp)) return resp.map(catalogItemToTokoProduct).filter(Boolean);
  if (resp && Array.isArray(resp.items)) return resp.items.map(catalogItemToTokoProduct).filter(Boolean);
  return [];
}

export function projectMarketingReturns(resp) {
  if (Array.isArray(resp)) return resp.map(marketingReturnToToko).filter(Boolean);
  if (resp && Array.isArray(resp.items)) return resp.items.map(marketingReturnToToko).filter(Boolean);
  return [];
}

export function projectMarketingReviews(resp) {
  if (Array.isArray(resp)) return resp.map(marketingReviewToToko).filter(Boolean);
  if (resp && Array.isArray(resp.items)) return resp.items.map(marketingReviewToToko).filter(Boolean);
  return [];
}
