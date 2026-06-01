"""
CV. Dewi Aditya — Marketing Portal Phase 5: Catalog Management + Stock Sync

Features:
  - Manajemen katalog produk per akun platform (Shopee, TikTok, Tokopedia, dst)
  - Item management dengan SKU, harga, dan stok
  - Stock sync dari WMS (rahaza_material_stock) untuk item yang ter-link ke material
  - Manual stock update + bulk update
  - Low-stock alerts (configurable threshold per item)
  - Stock dashboard dengan ringkasan multi-katalog

Collections:
  - marketing_catalogs       — Catalog header per account
  - marketing_catalog_items  — Product items dalam catalog
  - marketing_stock_syncs    — Log riwayat sinkronisasi stok

Author: CV. Dewi Aditya Development Team
Date: 2026-05-03
"""
# ruff: noqa: E741

import os
import re
import uuid
import html
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Request, Query, UploadFile, File
from pydantic import BaseModel
from database import get_db
from auth import require_auth

router = APIRouter(prefix='/api/marketing/catalogs', tags=['Marketing-Catalog'])

# ── Photo upload settings (Phase B Toko cutover) ──────────────────────────────
PRODUCT_UPLOAD_ROOT = Path('/app/uploads/products')
PRODUCT_UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
MAX_PHOTO_BYTES = 5 * 1024 * 1024
ALLOWED_MIMES = {'image/jpeg', 'image/png', 'image/webp'}
ALLOWED_EXT = {'jpg', 'jpeg', 'png', 'webp'}


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _uid():
    return str(uuid.uuid4())


def _now():
    return datetime.now(timezone.utc)


def _san(value: str, max_len: int = 500) -> str:
    """HTML-escape dan trim untuk prevent XSS."""
    if not isinstance(value, str):
        return value
    return html.escape(value.strip())[:max_len]


def _s(doc: dict) -> dict:
    if doc is None:
        return {}
    out = dict(doc)
    out.pop('_id', None)
    for k, v in out.items():
        if isinstance(v, datetime):
            out[k] = v.isoformat()
    return out


def _stock_status(qty: float, threshold: float) -> str:
    if qty <= 0:
        return 'out_of_stock'
    elif qty <= threshold:
        return 'low_stock'
    else:
        return 'in_stock'


# ─── Pydantic Models ──────────────────────────────────────────────────────────

class CatalogCreate(BaseModel):
    account_id: str
    name: str
    description: Optional[str] = ''
    platform: Optional[str] = ''     # inherited from account, stored for quick filter
    is_active: Optional[bool] = True


class CatalogUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None


class CatalogItemCreate(BaseModel):
    sku: str
    name: str
    description: Optional[str] = ''
    price: Optional[float] = 0          # selling price
    original_price: Optional[float] = 0 # HPP / base price
    platform_price: Optional[float] = 0 # actual listed price on platform (can differ)
    stock_quantity: Optional[float] = 0
    stock_alert_threshold: Optional[float] = 10
    material_id: Optional[str] = None   # optional link to WMS material (rahaza_materials)
    platform_url: Optional[str] = ''
    images: Optional[List[str]] = []
    tags: Optional[List[str]] = []
    weight_gram: Optional[float] = 0
    category: Optional[str] = ''
    variant_info: Optional[str] = ''    # e.g. "Warna: Merah, Size: L"
    is_active: Optional[bool] = True


class CatalogItemUpdate(BaseModel):
    sku: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    price: Optional[float] = None
    original_price: Optional[float] = None
    platform_price: Optional[float] = None
    stock_quantity: Optional[float] = None
    stock_alert_threshold: Optional[float] = None
    material_id: Optional[str] = None
    platform_url: Optional[str] = None
    images: Optional[List[str]] = None
    tags: Optional[List[str]] = None
    weight_gram: Optional[float] = None
    category: Optional[str] = None
    variant_info: Optional[str] = None
    is_active: Optional[bool] = None


class StockUpdateBody(BaseModel):
    stock_quantity: float
    notes: Optional[str] = ''


class CatalogItemFromFG(BaseModel):
    """Create catalog item by picking from FG master (rahaza_materials, type='fg').
    Backend auto-fills SKU/name/color/category from FG; user only sets selling price + URL.
    """
    fg_material_id: str  # UUID dari rahaza_materials
    price: float                              # selling price (required)
    original_price: Optional[float] = 0       # HPP/coret price (optional)
    platform_price: Optional[float] = 0       # actual listed price
    platform_url: Optional[str] = ''
    images: Optional[List[str]] = []
    tags: Optional[List[str]] = []
    stock_alert_threshold: Optional[float] = 10
    description_override: Optional[str] = ''  # custom description (optional)


class BulkStockUpdate(BaseModel):
    updates: List[dict]   # [{ item_id, stock_quantity, notes }]


# ═══════════════════════════════════════════════════════════════════════════════
# CATALOG CRUD
# ═══════════════════════════════════════════════════════════════════════════════

@router.post('')
async def create_catalog(data: CatalogCreate, request: Request):
    """Buat catalog baru untuk satu akun platform."""
    user = await require_auth(request)
    db = get_db()

    account = await db.marketing_platform_accounts.find_one({'id': data.account_id}, {'_id': 0})
    if not account:
        raise HTTPException(404, 'Akun platform tidak ditemukan.')

    # Use platform from account if not provided
    platform = data.platform or account.get('platform', '')

    doc = {
        'id': _uid(),
        'account_id': data.account_id,
        'account_name': account.get('name', ''),
        'platform': platform,
        'name': _san(data.name, 200),
        'description': _san(data.description or '', 1000),
        'is_active': data.is_active,
        'item_count': 0,
        'total_stock': 0.0,
        'low_stock_count': 0,
        'out_of_stock_count': 0,
        'created_at': _now(),
        'updated_at': _now(),
        'created_by': user.get('id', ''),
    }
    await db.marketing_catalogs.insert_one(doc)
    return {'ok': True, 'catalog': _s(doc)}


@router.get('')
async def list_catalogs(
    request: Request,
    account_id: Optional[str] = None,
    platform: Optional[str] = None,
    is_active: Optional[bool] = None,
    search: Optional[str] = None,
):
    """List semua katalog dengan filter opsional."""
    await require_auth(request)
    db = get_db()

    q = {}
    if account_id:
        q['account_id'] = account_id
    if platform:
        q['platform'] = platform
    if is_active is not None:
        q['is_active'] = is_active
    if search:
        q['name'] = {'$regex': search, '$options': 'i'}

    docs = await db.marketing_catalogs.find(q, {'_id': 0}).sort('created_at', -1).to_list(500)
    return {'ok': True, 'catalogs': [_s(d) for d in docs], 'total': len(docs)}


@router.get('/stock-dashboard')
async def stock_dashboard(
    request: Request,
    account_id: Optional[str] = None,
    platform: Optional[str] = None,
):
    """
    Ringkasan stok lintas semua katalog (atau filter per account/platform).
    Returns: total_items, in_stock, low_stock, out_of_stock, catalogs summary.
    """
    await require_auth(request)
    db = get_db()

    q: dict = {}
    if account_id:
        q['account_id'] = account_id
    if platform:
        q['platform'] = platform

    items = await db.marketing_catalog_items.find(q, {'_id': 0,
        'catalog_id': 1, 'stock_quantity': 1, 'stock_alert_threshold': 1,
        'stock_status': 1, 'name': 1, 'sku': 1, 'price': 1, 'platform': 1,
        'account_id': 1, 'is_active': 1,
    }).to_list(500)

    active_items = [i for i in items if i.get('is_active', True)]
    total = len(active_items)
    in_stock = sum(1 for i in active_items if i.get('stock_status') == 'in_stock')
    low_stock = sum(1 for i in active_items if i.get('stock_status') == 'low_stock')
    out_stock = sum(1 for i in active_items if i.get('stock_status') == 'out_of_stock')

    # Low stock items list (top 20 by stock_quantity asc)
    low_items = sorted(
        [i for i in active_items if i.get('stock_status') in ('low_stock', 'out_of_stock')],
        key=lambda x: x.get('stock_quantity', 0)
    )[:20]

    # Per-platform breakdown
    platform_summary: dict = {}
    for i in active_items:
        p = i.get('platform', 'Other')
        if p not in platform_summary:
            platform_summary[p] = {'platform': p, 'total': 0, 'in_stock': 0, 'low_stock': 0, 'out_of_stock': 0}
        platform_summary[p]['total'] += 1
        st = i.get('stock_status', 'in_stock')
        platform_summary[p][st] = platform_summary[p].get(st, 0) + 1

    # Get last sync info
    last_sync = await db.marketing_stock_syncs.find_one(
        q, {'_id': 0}, sort=[('synced_at', -1)]
    )

    return {
        'ok': True,
        'summary': {
            'total_items': total,
            'in_stock': in_stock,
            'low_stock': low_stock,
            'out_of_stock': out_stock,
            'health_pct': round(in_stock / total * 100, 1) if total else 0,
        },
        'low_stock_items': [_s(i) for i in low_items],
        'platform_breakdown': list(platform_summary.values()),
        'last_sync': _s(last_sync) if last_sync else None,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# FG MASTER INTEGRATION — REGISTERED HERE (BEFORE /{catalog_id}) for route precedence
# ═══════════════════════════════════════════════════════════════════════════════

@router.get('/fg-products')
async def search_fg_products(
    request: Request,
    q: Optional[str] = Query(None, description="Search by FG code or name"),
    limit: int = Query(50, ge=1, le=200),
):
    """Search FG (Finished Goods) products dari master inventory (rahaza_materials, type='fg').
    
    Used by Catalog Item creation flow untuk pick produk dari master, bukan input manual.
    Returns: List of FG with current stock from rahaza_material_stock.
    """
    await require_auth(request)
    db = get_db()
    
    query = {'type': 'fg', '$or': [{'active': True}, {'active': {'$exists': False}}]}
    if q and q.strip():
        search = q.strip()
        # Combine with the active filter
        query = {
            'type': 'fg',
            '$or': [{'active': True}, {'active': {'$exists': False}}],
            '$and': [
                {
                    '$or': [
                        {'name': {'$regex': search, '$options': 'i'}},
                        {'code': {'$regex': search, '$options': 'i'}},
                    ]
                }
            ],
        }
    
    materials = await db.rahaza_materials.find(query, {'_id': 0}).sort('name', 1).limit(limit).to_list(length=limit)
    
    # Get default active location
    default_loc = await db.rahaza_locations.find_one({'active': True}, {'_id': 0})
    loc_id = default_loc['id'] if default_loc else None
    
    # Attach stock info
    for mat in materials:
        if loc_id:
            stock_doc = await db.rahaza_material_stock.find_one(
                {'material_id': mat.get('id'), 'location_id': loc_id}, {'_id': 0}
            )
            mat['stock_qty'] = float(stock_doc.get('qty', 0)) if stock_doc else 0.0
        else:
            mat['stock_qty'] = 0.0
        mat['location_id'] = loc_id
    
    return {'ok': True, 'data': [_s(m) for m in materials], 'total': len(materials)}


@router.post('/archive-legacy-items')
async def archive_legacy_items(request: Request):
    """Archive catalog items yang dibuat manual (tanpa fg_material_id link).
    
    Marks items as is_active=False dan tambah 'legacy_archived' tag untuk hidden filter.
    Admin only.
    """
    user = await require_auth(request)
    role = user.get('role', '')
    if role not in ['admin', 'owner', 'superadmin']:
        raise HTTPException(403, 'Hanya admin/owner yang bisa archive legacy data.')
    
    db = get_db()
    
    # Find items without fg_material_id (legacy manual entries)
    result = await db.marketing_catalog_items.update_many(
        {
            '$or': [
                {'fg_material_id': None},
                {'fg_material_id': {'$exists': False}},
            ],
            'source': {'$ne': 'from_fg'},
        },
        {
            '$set': {
                'is_active': False,
                'legacy_archived': True,
                'archived_at': _now(),
                'archived_by': user.get('id', ''),
            }
        }
    )
    
    # Refresh catalog stats for affected catalogs
    affected_catalogs = await db.marketing_catalog_items.distinct('catalog_id', {'legacy_archived': True})
    for cid in affected_catalogs:
        await _refresh_catalog_stats(db, cid)
    
    return {
        'ok': True,
        'archived_count': result.modified_count,
        'message': f'{result.modified_count} item legacy berhasil di-archive. Item baru harus pakai FG picker.',
    }


@router.get('/{catalog_id}')
async def get_catalog(catalog_id: str, request: Request):
    """Get catalog detail."""
    await require_auth(request)
    db = get_db()

    doc = await db.marketing_catalogs.find_one({'id': catalog_id}, {'_id': 0})
    if not doc:
        raise HTTPException(404, 'Katalog tidak ditemukan.')
    return {'ok': True, 'catalog': _s(doc)}


@router.put('/{catalog_id}')
async def update_catalog(catalog_id: str, data: CatalogUpdate, request: Request):
    """Update catalog info."""
    user = await require_auth(request)
    db = get_db()

    patch = {k: v for k, v in data.dict().items() if v is not None}
    if not patch:
        raise HTTPException(400, 'Tidak ada perubahan.')
    patch['updated_at'] = _now()
    patch['updated_by'] = user.get('id', '')

    res = await db.marketing_catalogs.update_one({'id': catalog_id}, {'$set': patch})
    if res.matched_count == 0:
        raise HTTPException(404, 'Katalog tidak ditemukan.')

    doc = await db.marketing_catalogs.find_one({'id': catalog_id}, {'_id': 0})
    return {'ok': True, 'catalog': _s(doc)}


@router.delete('/{catalog_id}')
async def delete_catalog(catalog_id: str, request: Request):
    """Hapus catalog dan semua item-nya."""
    await require_auth(request)
    db = get_db()

    cat = await db.marketing_catalogs.find_one({'id': catalog_id}, {'_id': 0, 'name': 1})
    if not cat:
        raise HTTPException(404, 'Katalog tidak ditemukan.')

    item_count = await db.marketing_catalog_items.count_documents({'catalog_id': catalog_id})
    await db.marketing_catalog_items.delete_many({'catalog_id': catalog_id})
    await db.marketing_catalogs.delete_one({'id': catalog_id})

    return {'ok': True, 'message': f"Katalog '{cat['name']}' dan {item_count} item dihapus."}


# ═══════════════════════════════════════════════════════════════════════════════
# CATALOG ITEMS CRUD
# ═══════════════════════════════════════════════════════════════════════════════

async def _refresh_catalog_stats(db, catalog_id: str):
    """Recompute aggregate stock stats on the parent catalog."""
    items = await db.marketing_catalog_items.find(
        {'catalog_id': catalog_id, 'is_active': True},
        {'_id': 0, 'stock_quantity': 1, 'stock_status': 1}
    ).to_list(500)
    total_stock = sum(float(i.get('stock_quantity', 0)) for i in items)
    low = sum(1 for i in items if i.get('stock_status') == 'low_stock')
    out = sum(1 for i in items if i.get('stock_status') == 'out_of_stock')
    await db.marketing_catalogs.update_one(
        {'id': catalog_id},
        {'$set': {
            'item_count': len(items),
            'total_stock': total_stock,
            'low_stock_count': low,
            'out_of_stock_count': out,
            'updated_at': _now(),
        }}
    )


@router.post('/{catalog_id}/items', status_code=201)
async def add_catalog_item(catalog_id: str, data: CatalogItemCreate, request: Request):
    """Tambah item/produk ke dalam katalog.
    
    NOTE (Legacy mode): Untuk produk baru, prefer endpoint POST /items/from-fg
    yang link langsung ke master FG (rahaza_materials) untuk konsistensi data.
    """
    user = await require_auth(request)
    db = get_db()

    catalog = await db.marketing_catalogs.find_one({'id': catalog_id}, {'_id': 0})
    if not catalog:
        raise HTTPException(404, 'Katalog tidak ditemukan.')

    # Check SKU uniqueness within catalog
    existing_sku = await db.marketing_catalog_items.find_one({
        'catalog_id': catalog_id, 'sku': data.sku.strip().upper()
    })
    if existing_sku:
        raise HTTPException(409, f'SKU {data.sku} sudah ada dalam katalog ini.')

    stock_qty = float(data.stock_quantity or 0)
    threshold = float(data.stock_alert_threshold or 10)

    doc = {
        'id': _uid(),
        'catalog_id': catalog_id,
        'account_id': catalog.get('account_id', ''),
        'platform': catalog.get('platform', ''),
        'sku': _san(data.sku, 100).upper(),
        'name': _san(data.name, 200),
        'description': _san(data.description or '', 2000),
        'price': float(data.price or 0),
        'original_price': float(data.original_price or 0),
        'platform_price': float(data.platform_price or 0),
        'stock_quantity': stock_qty,
        'stock_alert_threshold': threshold,
        'stock_status': _stock_status(stock_qty, threshold),
        'material_id': data.material_id,
        'fg_material_id': None,                # mark as legacy (no master link)
        'source': 'manual',                    # manual entry vs from_fg
        'platform_url': (data.platform_url or '').strip(),
        'images': data.images or [],
        'tags': data.tags or [],
        'weight_gram': float(data.weight_gram or 0),
        'category': _san(data.category or '', 100),
        'variant_info': _san(data.variant_info or '', 200),
        'is_active': data.is_active,
        'last_stock_sync': None,
        'created_at': _now(),
        'updated_at': _now(),
        'created_by': user.get('id', ''),
    }
    await db.marketing_catalog_items.insert_one(doc)
    await _refresh_catalog_stats(db, catalog_id)
    return {'ok': True, 'item': _s(doc)}


# ═══════════════════════════════════════════════════════════════════════════════
# PHOTO UPLOAD — Catalog item photos (Phase B Toko Cutover)
# ═══════════════════════════════════════════════════════════════════════════════

class RemovePhotoIn(BaseModel):
    url: str


@router.post('/{catalog_id}/items/{item_id}/photos')
async def upload_catalog_item_photo(
    catalog_id: str,
    item_id: str,
    file: UploadFile = File(...),
    request: Request = None,
):
    """Upload a photo for a catalog item. Saves under /app/uploads/products/{item_id}/
    and appends URL to both `images[]` (marketing native) and `photos[]` (legacy)
    arrays for backwards compatibility.
    """
    await require_auth(request)
    db = get_db()
    item = await db.marketing_catalog_items.find_one(
        {'id': item_id, 'catalog_id': catalog_id}, {'_id': 0}
    )
    if not item:
        raise HTTPException(404, 'Item tidak ditemukan dalam katalog ini.')

    if file.content_type not in ALLOWED_MIMES:
        raise HTTPException(415, f'Hanya {sorted(ALLOWED_MIMES)} diizinkan')
    data = await file.read()
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(413, 'Ukuran file > 5MB')
    if len(data) < 50:
        raise HTTPException(400, 'File terlalu kecil (min 50 bytes)')

    ext = 'jpg'
    if file.filename and '.' in file.filename:
        candidate = file.filename.rsplit('.', 1)[-1].lower()
        candidate = re.sub(r'[^a-z0-9]', '', candidate)
        if candidate in ALLOWED_EXT:
            ext = candidate
    folder = PRODUCT_UPLOAD_ROOT / item_id
    folder.mkdir(parents=True, exist_ok=True)
    fname = f'{uuid.uuid4().hex}.{ext}'
    with open(folder / fname, 'wb') as f:
        f.write(data)
    url = f'/api/uploads/products/{item_id}/{fname}'

    # Dual-write to images[] (marketing native) and photos[] (legacy back-compat)
    await db.marketing_catalog_items.update_one(
        {'id': item_id, 'catalog_id': catalog_id},
        {
            '$addToSet': {'images': url, 'photos': url},
            '$set': {'updated_at': _now()},
        },
    )
    return {'ok': True, 'url': url, 'size': len(data)}


@router.post('/{catalog_id}/items/{item_id}/photos/remove')
async def remove_catalog_item_photo(
    catalog_id: str,
    item_id: str,
    payload: RemovePhotoIn,
    request: Request,
):
    """Remove a photo URL from a catalog item. Pulls from both `images[]` and
    `photos[]` arrays and best-effort deletes the underlying file.
    """
    await require_auth(request)
    db = get_db()
    item = await db.marketing_catalog_items.find_one(
        {'id': item_id, 'catalog_id': catalog_id}, {'_id': 0}
    )
    if not item:
        raise HTTPException(404, 'Item tidak ditemukan.')

    await db.marketing_catalog_items.update_one(
        {'id': item_id, 'catalog_id': catalog_id},
        {
            '$pull': {'images': payload.url, 'photos': payload.url},
            '$set': {'updated_at': _now()},
        },
    )

    # Best-effort file delete
    try:
        if payload.url.startswith('/api/uploads/products/'):
            rel = payload.url.replace('/api/uploads/products/', '')
            fp = PRODUCT_UPLOAD_ROOT / rel
            if fp.exists() and fp.is_file():
                os.unlink(fp)
    except Exception:
        pass

    return {'ok': True, 'message': 'Foto dihapus'}


# ═══════════════════════════════════════════════════════════════════════════════
# FG MASTER INTEGRATION — Item creation from FG (catalog-scoped routes)
# ═══════════════════════════════════════════════════════════════════════════════

@router.post('/{catalog_id}/items/from-fg', status_code=201)
async def add_catalog_item_from_fg(catalog_id: str, data: CatalogItemFromFG, request: Request):
    """Tambah catalog item dari master FG produk.
    
    Auto-fills SKU, name, description, weight, category, color, variant info from FG record.
    Stock quantity snapshot dari rahaza_material_stock (location default).
    User HANYA perlu set: selling price, original_price (optional), platform_url.
    """
    user = await require_auth(request)
    db = get_db()
    
    # Validate catalog exists
    catalog = await db.marketing_catalogs.find_one({'id': catalog_id}, {'_id': 0})
    if not catalog:
        raise HTTPException(404, 'Katalog tidak ditemukan.')
    
    # Validate FG material exists & is type='fg'
    fg = await db.rahaza_materials.find_one({'id': data.fg_material_id}, {'_id': 0})
    if not fg:
        raise HTTPException(404, 'FG produk tidak ditemukan di master inventory.')
    if fg.get('type') != 'fg':
        raise HTTPException(400, f"Material bukan tipe FG (tipe: {fg.get('type')}). Hanya Finished Goods yang bisa di-link ke catalog.")
    
    # Check if FG already in this catalog (prevent duplicate)
    existing = await db.marketing_catalog_items.find_one({
        'catalog_id': catalog_id,
        'fg_material_id': data.fg_material_id,
    })
    if existing:
        raise HTTPException(409, f"Produk '{fg.get('name')}' sudah ada di katalog ini.")
    
    # Get current stock from default location
    default_loc = await db.rahaza_locations.find_one({'active': True}, {'_id': 0})
    loc_id = default_loc['id'] if default_loc else None
    stock_qty = 0.0
    if loc_id:
        stock_doc = await db.rahaza_material_stock.find_one(
            {'material_id': fg.get('id'), 'location_id': loc_id}, {'_id': 0}
        )
        stock_qty = float(stock_doc.get('qty', 0)) if stock_doc else 0.0
    
    threshold = float(data.stock_alert_threshold or 10)
    
    # Auto-fill from FG record
    fg_code = fg.get('code') or ''
    fg_name = fg.get('name') or ''
    fg_color = fg.get('color') or ''
    fg_yarn = fg.get('yarn_type') or ''
    fg_unit = fg.get('unit') or 'pcs'
    fg_category = fg.get('category') or fg.get('subtype') or ''
    
    # Build variant info from FG attributes
    variant_parts = []
    if fg_color:
        variant_parts.append(f"Warna: {fg_color}")
    if fg_yarn:
        variant_parts.append(f"Material: {fg_yarn}")
    variant_info = ' | '.join(variant_parts)
    
    description = (data.description_override or '').strip()
    if not description:
        description = f"FG: {fg_name}"
        if variant_info:
            description += f" ({variant_info})"
    
    doc = {
        'id': _uid(),
        'catalog_id': catalog_id,
        'account_id': catalog.get('account_id', ''),
        'platform': catalog.get('platform', ''),
        # Master FG references
        'fg_material_id': fg.get('id'),
        'material_id': fg.get('id'),       # legacy alias for backward compat
        'fg_code': fg_code,
        'fg_name': fg_name,
        'fg_color': fg_color,
        'source': 'from_fg',
        # Display fields (denormalized for performance)
        'sku': fg_code.upper(),
        'name': fg_name,
        'description': _san(description, 2000),
        'category': fg_category,
        'variant_info': variant_info,
        'unit': fg_unit,
        # Pricing
        'price': float(data.price or 0),
        'original_price': float(data.original_price or 0),
        'platform_price': float(data.platform_price or 0),
        # Stock (snapshot from master)
        'stock_quantity': stock_qty,
        'stock_alert_threshold': threshold,
        'stock_status': _stock_status(stock_qty, threshold),
        'stock_location_id': loc_id,
        'last_stock_sync': _now(),
        # Marketing fields
        'platform_url': (data.platform_url or '').strip(),
        'images': data.images or [],
        'tags': data.tags or [],
        'weight_gram': float(fg.get('weight_gram', 0)) if fg.get('weight_gram') else 0,
        'is_active': True,
        'created_at': _now(),
        'updated_at': _now(),
        'created_by': user.get('id', ''),
    }
    
    await db.marketing_catalog_items.insert_one(doc)
    await _refresh_catalog_stats(db, catalog_id)
    
    return {'ok': True, 'item': _s(doc), 'message': f"Produk '{fg_name}' berhasil ditambahkan ke katalog dari master FG"}


@router.put('/{catalog_id}/items/{item_id}/sync-fg-stock')
async def sync_item_stock_from_fg(catalog_id: str, item_id: str, request: Request):
    """Manual sync stock untuk single catalog item dari master FG.
    
    Untuk item yang sudah link via fg_material_id, ambil stock terbaru dari rahaza_material_stock.
    """
    await require_auth(request)
    db = get_db()
    
    item = await db.marketing_catalog_items.find_one({'id': item_id, 'catalog_id': catalog_id}, {'_id': 0})
    if not item:
        raise HTTPException(404, 'Item tidak ditemukan.')
    
    fg_id = item.get('fg_material_id') or item.get('material_id')
    if not fg_id:
        raise HTTPException(400, 'Item tidak link ke master FG. Tidak bisa sync otomatis.')
    
    # Get current stock from master
    loc_id = item.get('stock_location_id')
    if not loc_id:
        default_loc = await db.rahaza_locations.find_one({'active': True}, {'_id': 0})
        loc_id = default_loc['id'] if default_loc else None
    
    new_stock = 0.0
    if loc_id:
        stock_doc = await db.rahaza_material_stock.find_one(
            {'material_id': fg_id, 'location_id': loc_id}, {'_id': 0}
        )
        new_stock = float(stock_doc.get('qty', 0)) if stock_doc else 0.0
    
    threshold = float(item.get('stock_alert_threshold', 10))
    
    await db.marketing_catalog_items.update_one(
        {'id': item_id},
        {'$set': {
            'stock_quantity': new_stock,
            'stock_status': _stock_status(new_stock, threshold),
            'last_stock_sync': _now(),
            'updated_at': _now(),
        }}
    )
    
    await _refresh_catalog_stats(db, catalog_id)
    
    return {'ok': True, 'stock_quantity': new_stock, 'stock_status': _stock_status(new_stock, threshold)}


@router.get('/{catalog_id}/items')
async def list_catalog_items(
    catalog_id: str,
    request: Request,
    search: Optional[str] = None,
    status: Optional[str] = None,  # in_stock | low_stock | out_of_stock
    category: Optional[str] = None,
    is_active: Optional[bool] = None,
    skip: int = 0,
    limit: int = 100,
):
    """List item dalam katalog dengan filter."""
    await require_auth(request)
    db = get_db()

    q: dict = {'catalog_id': catalog_id}
    if search:
        q['$or'] = [
            {'name': {'$regex': search, '$options': 'i'}},
            {'sku': {'$regex': search, '$options': 'i'}},
            {'tags': {'$regex': search, '$options': 'i'}},
        ]
    if status:
        q['stock_status'] = status
    if category:
        q['category'] = {'$regex': category, '$options': 'i'}
    if is_active is not None:
        q['is_active'] = is_active

    total = await db.marketing_catalog_items.count_documents(q)
    docs = await db.marketing_catalog_items.find(q, {'_id': 0}).sort('name', 1).skip(skip).limit(limit).to_list(500)
    return {'ok': True, 'items': [_s(d) for d in docs], 'total': total}


@router.put('/{catalog_id}/items/{item_id}')
async def update_catalog_item(catalog_id: str, item_id: str, data: CatalogItemUpdate, request: Request):
    """Update item data (termasuk harga, stok, dll)."""
    user = await require_auth(request)
    db = get_db()

    item = await db.marketing_catalog_items.find_one(
        {'id': item_id, 'catalog_id': catalog_id}, {'_id': 0}
    )
    if not item:
        raise HTTPException(404, 'Item tidak ditemukan.')

    patch = {k: v for k, v in data.dict().items() if v is not None}
    if 'sku' in patch:
        patch['sku'] = patch['sku'].strip().upper()
    if 'name' in patch:
        patch['name'] = patch['name'].strip()

    # Recompute stock_status if stock fields changed
    new_qty = patch.get('stock_quantity', item.get('stock_quantity', 0))
    new_thresh = patch.get('stock_alert_threshold', item.get('stock_alert_threshold', 10))
    patch['stock_status'] = _stock_status(float(new_qty), float(new_thresh))
    patch['updated_at'] = _now()
    patch['updated_by'] = user.get('id', '')

    await db.marketing_catalog_items.update_one({'id': item_id}, {'$set': patch})
    await _refresh_catalog_stats(db, catalog_id)

    updated = await db.marketing_catalog_items.find_one({'id': item_id}, {'_id': 0})
    return {'ok': True, 'item': _s(updated)}


@router.delete('/{catalog_id}/items/{item_id}')
async def delete_catalog_item(catalog_id: str, item_id: str, request: Request):
    """Hapus item dari katalog."""
    await require_auth(request)
    db = get_db()

    res = await db.marketing_catalog_items.delete_one({'id': item_id, 'catalog_id': catalog_id})
    if res.deleted_count == 0:
        raise HTTPException(404, 'Item tidak ditemukan.')
    await _refresh_catalog_stats(db, catalog_id)
    return {'ok': True, 'message': 'Item dihapus.'}


# ═══════════════════════════════════════════════════════════════════════════════
# STOCK MANAGEMENT
# ═══════════════════════════════════════════════════════════════════════════════

@router.put('/{catalog_id}/items/{item_id}/stock')
async def update_item_stock(catalog_id: str, item_id: str, body: StockUpdateBody, request: Request):
    """Update stok item secara manual."""
    user = await require_auth(request)
    db = get_db()

    item = await db.marketing_catalog_items.find_one(
        {'id': item_id, 'catalog_id': catalog_id}, {'_id': 0}
    )
    if not item:
        raise HTTPException(404, 'Item tidak ditemukan.')

    old_qty = float(item.get('stock_quantity', 0))
    new_qty = float(body.stock_quantity)
    threshold = float(item.get('stock_alert_threshold', 10))

    patch = {
        'stock_quantity': new_qty,
        'stock_status': _stock_status(new_qty, threshold),
        'updated_at': _now(),
        'updated_by': user.get('id', ''),
        'last_stock_sync': _now(),
    }
    await db.marketing_catalog_items.update_one({'id': item_id}, {'$set': patch})
    await _refresh_catalog_stats(db, catalog_id)

    # Log sync
    await db.marketing_stock_syncs.insert_one({
        'id': _uid(),
        'catalog_id': catalog_id,
        'item_id': item_id,
        'sku': item.get('sku', ''),
        'name': item.get('name', ''),
        'old_stock': old_qty,
        'new_stock': new_qty,
        'delta': new_qty - old_qty,
        'sync_type': 'manual',
        'notes': body.notes or '',
        'synced_at': _now(),
        'synced_by': user.get('id', ''),
    })

    return {
        'ok': True,
        'item_id': item_id,
        'old_stock': old_qty,
        'new_stock': new_qty,
        'delta': new_qty - old_qty,
        'stock_status': _stock_status(new_qty, threshold),
    }


@router.post('/{catalog_id}/bulk-stock-update')
async def bulk_stock_update(catalog_id: str, body: BulkStockUpdate, request: Request):
    """
    Bulk update stok banyak item sekaligus.
    Body: { "updates": [{ "item_id": "...", "stock_quantity": 50, "notes": "..." }] }
    """
    user = await require_auth(request)
    db = get_db()

    catalog = await db.marketing_catalogs.find_one({'id': catalog_id}, {'_id': 0, 'id': 1})
    if not catalog:
        raise HTTPException(404, 'Katalog tidak ditemukan.')

    saved = 0
    skipped = 0
    sync_logs = []

    for upd in body.updates:
        item_id = upd.get('item_id')
        new_qty_raw = upd.get('stock_quantity')
        if not item_id or new_qty_raw is None:
            skipped += 1
            continue

        item = await db.marketing_catalog_items.find_one(
            {'id': item_id, 'catalog_id': catalog_id}, {'_id': 0}
        )
        if not item:
            skipped += 1
            continue

        old_qty = float(item.get('stock_quantity', 0))
        new_qty = float(new_qty_raw)
        threshold = float(item.get('stock_alert_threshold', 10))

        await db.marketing_catalog_items.update_one(
            {'id': item_id},
            {'$set': {
                'stock_quantity': new_qty,
                'stock_status': _stock_status(new_qty, threshold),
                'updated_at': _now(),
                'last_stock_sync': _now(),
            }}
        )
        sync_logs.append({
            'id': _uid(),
            'catalog_id': catalog_id,
            'item_id': item_id,
            'sku': item.get('sku', ''),
            'name': item.get('name', ''),
            'old_stock': old_qty,
            'new_stock': new_qty,
            'delta': new_qty - old_qty,
            'sync_type': 'bulk_manual',
            'notes': upd.get('notes', ''),
            'synced_at': _now(),
            'synced_by': user.get('id', ''),
        })
        saved += 1

    if sync_logs:
        await db.marketing_stock_syncs.insert_many(sync_logs)
    await _refresh_catalog_stats(db, catalog_id)

    return {'ok': True, 'saved': saved, 'skipped': skipped}


@router.post('/{catalog_id}/sync-from-wms')
async def sync_stock_from_wms(catalog_id: str, request: Request):
    """
    Sinkronisasi stok dari WMS (rahaza_material_stock) untuk item yang ter-link ke material_id.
    Item tanpa material_id tidak terpengaruh.
    """
    user = await require_auth(request)
    db = get_db()

    catalog = await db.marketing_catalogs.find_one({'id': catalog_id}, {'_id': 0})
    if not catalog:
        raise HTTPException(404, 'Katalog tidak ditemukan.')

    # Get all items with material_id set
    linked_items = await db.marketing_catalog_items.find(
        {'catalog_id': catalog_id, 'material_id': {'$exists': True, '$ne': None}},
        {'_id': 0}
    ).to_list(500)

    synced = 0
    not_found = 0
    sync_logs = []

    for item in linked_items:
        mat_id = item.get('material_id')
        if not mat_id:
            continue

        # Sum stock across all locations for this material
        stock_docs = await db.rahaza_material_stock.find(
            {'material_id': mat_id}, {'_id': 0, 'qty': 1}
        ).to_list(500)

        if not stock_docs:
            not_found += 1
            continue

        total_wms_qty = sum(float(s.get('qty', 0)) for s in stock_docs)
        old_qty = float(item.get('stock_quantity', 0))
        threshold = float(item.get('stock_alert_threshold', 10))

        await db.marketing_catalog_items.update_one(
            {'id': item['id']},
            {'$set': {
                'stock_quantity': total_wms_qty,
                'stock_status': _stock_status(total_wms_qty, threshold),
                'updated_at': _now(),
                'last_stock_sync': _now(),
            }}
        )
        sync_logs.append({
            'id': _uid(),
            'catalog_id': catalog_id,
            'item_id': item['id'],
            'sku': item.get('sku', ''),
            'name': item.get('name', ''),
            'old_stock': old_qty,
            'new_stock': total_wms_qty,
            'delta': total_wms_qty - old_qty,
            'sync_type': 'wms_sync',
            'notes': f'Sync dari WMS material_id: {mat_id}',
            'synced_at': _now(),
            'synced_by': user.get('id', ''),
        })
        synced += 1

    if sync_logs:
        await db.marketing_stock_syncs.insert_many(sync_logs)
    await _refresh_catalog_stats(db, catalog_id)

    return {
        'ok': True,
        'synced': synced,
        'not_found_in_wms': not_found,
        'total_linked': len(linked_items),
        'message': f'WMS sync selesai: {synced} item diperbarui, {not_found} material tidak ditemukan di WMS.',
        'synced_at': _now().isoformat(),
    }


@router.get('/{catalog_id}/stock-history')
async def get_stock_history(
    catalog_id: str,
    request: Request,
    item_id: Optional[str] = None,
    limit: int = 50,
):
    """Riwayat perubahan stok untuk satu katalog (atau satu item)."""
    await require_auth(request)
    db = get_db()

    q: dict = {'catalog_id': catalog_id}
    if item_id:
        q['item_id'] = item_id

    logs = await db.marketing_stock_syncs.find(q, {'_id': 0}).sort('synced_at', -1).limit(limit).to_list(500)
    return {'ok': True, 'history': [_s(l) for l in logs]}


@router.get('/{catalog_id}/low-stock')
async def get_low_stock_items(catalog_id: str, request: Request):
    """Item dengan stok rendah atau habis di katalog ini."""
    await require_auth(request)
    db = get_db()

    items = await db.marketing_catalog_items.find(
        {
            'catalog_id': catalog_id,
            'is_active': True,
            'stock_status': {'$in': ['low_stock', 'out_of_stock']},
        },
        {'_id': 0}
    ).sort('stock_quantity', 1).to_list(500)

    return {
        'ok': True,
        'items': [_s(i) for i in items],
        'count': len(items),
        'out_of_stock': sum(1 for i in items if i.get('stock_status') == 'out_of_stock'),
        'low_stock': sum(1 for i in items if i.get('stock_status') == 'low_stock'),
    }


# ═══════════════════════════════════════════════════════════════════════════════
# SEED DEMO DATA
# ═══════════════════════════════════════════════════════════════════════════════

@router.post('/seed-demo')
async def seed_demo_catalog(request: Request):
    """Seed demo catalogs + items untuk testing."""
    user = await require_auth(request)
    db = get_db()

    # Only seed if no catalogs exist yet
    existing = await db.marketing_catalogs.count_documents({})
    if existing > 0:
        return {'ok': True, 'message': f'{existing} katalog sudah ada, skip seed.'}

    # Get first active account
    account = await db.marketing_platform_accounts.find_one({'status': 'active'}, {'_id': 0})
    if not account:
        # Create a demo account first
        account = {
            'id': _uid(),
            'name': 'Toko Demo Shopee',
            'platform': 'Shopee',
            'status': 'active',
            'username': 'toko_demo_shopee',
            'created_at': _now(),
        }
        await db.marketing_platform_accounts.insert_one(account)

    catalog_id = _uid()
    cat_doc = {
        'id': catalog_id,
        'account_id': account['id'],
        'account_name': account.get('name', ''),
        'platform': account.get('platform', 'Shopee'),
        'name': 'Katalog Produk Utama',
        'description': 'Katalog utama produk fashion CV. Dewi Aditya',
        'is_active': True,
        'item_count': 0,
        'total_stock': 0.0,
        'low_stock_count': 0,
        'out_of_stock_count': 0,
        'created_at': _now(),
        'updated_at': _now(),
        'created_by': user.get('id', ''),
    }
    await db.marketing_catalogs.insert_one(cat_doc)

    # Demo items
    demo_items = [
        {'sku': 'SKU-001', 'name': 'Kaos Polos Premium Pria', 'category': 'Kaos', 'price': 85000, 'stock_quantity': 150, 'stock_alert_threshold': 20, 'variant_info': 'Warna: Hitam, Putih, Abu | Size: S, M, L, XL'},
        {'sku': 'SKU-002', 'name': 'Celana Chino Slim Fit', 'category': 'Celana', 'price': 175000, 'stock_quantity': 8, 'stock_alert_threshold': 15, 'variant_info': 'Warna: Khaki, Navy | Size: 28-34'},
        {'sku': 'SKU-003', 'name': 'Kemeja Oxford Formal', 'category': 'Kemeja', 'price': 225000, 'stock_quantity': 0, 'stock_alert_threshold': 10, 'variant_info': 'Warna: Putih, Biru Muda | Size: S–XXL'},
        {'sku': 'SKU-004', 'name': 'Jaket Bomber Pria', 'category': 'Jaket', 'price': 350000, 'stock_quantity': 45, 'stock_alert_threshold': 10, 'variant_info': 'Warna: Hitam, Olive | Size: M–XXL'},
        {'sku': 'SKU-005', 'name': 'Dress Casual Wanita', 'category': 'Dress', 'price': 195000, 'stock_quantity': 5, 'stock_alert_threshold': 10, 'variant_info': 'Warna: Floral, Polos | Size: S–XL'},
        {'sku': 'SKU-006', 'name': 'Rok Midi Motif Batik', 'category': 'Rok', 'price': 155000, 'stock_quantity': 32, 'stock_alert_threshold': 8},
        {'sku': 'SKU-007', 'name': 'Blouse Sifon Wanita', 'category': 'Blouse', 'price': 135000, 'stock_quantity': 0, 'stock_alert_threshold': 10, 'variant_info': 'Warna: Pink, Cream, Hitam | Size: S–XL'},
        {'sku': 'SKU-008', 'name': 'Jogger Pants Unisex', 'category': 'Celana', 'price': 145000, 'stock_quantity': 78, 'stock_alert_threshold': 15},
    ]

    for item_data in demo_items:
        qty = float(item_data.get('stock_quantity', 0))
        thresh = float(item_data.get('stock_alert_threshold', 10))
        doc = {
            'id': _uid(),
            'catalog_id': catalog_id,
            'account_id': account['id'],
            'platform': account.get('platform', 'Shopee'),
            'sku': item_data['sku'],
            'name': item_data['name'],
            'description': '',
            'price': float(item_data.get('price', 0)),
            'original_price': float(item_data.get('price', 0)) * 0.65,
            'platform_price': float(item_data.get('price', 0)),
            'stock_quantity': qty,
            'stock_alert_threshold': thresh,
            'stock_status': _stock_status(qty, thresh),
            'material_id': None,
            'platform_url': '',
            'images': [],
            'tags': [item_data.get('category', '')],
            'weight_gram': 250.0,
            'category': item_data.get('category', ''),
            'variant_info': item_data.get('variant_info', ''),
            'is_active': True,
            'last_stock_sync': None,
            'created_at': _now(),
            'updated_at': _now(),
            'created_by': user.get('id', ''),
        }
        await db.marketing_catalog_items.insert_one(doc)

    await _refresh_catalog_stats(db, catalog_id)

    return {
        'ok': True,
        'message': f'Seed berhasil: 1 katalog + {len(demo_items)} items.',
        'catalog_id': catalog_id,
    }
