"""
Marketing Catalog - Management
Catalog CRUD + dashboard + utilities
"""
import uuid
import html
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Request, Query
from pydantic import BaseModel
from database import get_db
from auth import require_auth

router = APIRouter(prefix='/api/marketing/catalogs', tags=['Marketing-Catalog-mgmt'])

# Photo upload settings
PRODUCT_UPLOAD_ROOT = Path('/app/uploads/products')
PRODUCT_UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
MAX_PHOTO_BYTES = 5 * 1024 * 1024
ALLOWED_MIMES = {'image/jpeg', 'image/png', 'image/webp'}
ALLOWED_EXT = {'jpg', 'jpeg', 'png', 'webp'}

# Helper functions
def _uid():
    return str(uuid.uuid4())

def _now():
    return datetime.now(timezone.utc)

def _san(value: str, max_len: int = 500) -> str:
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

async def _refresh_catalog_stats(db, catalog_id: str):
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


# Pydantic models
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
