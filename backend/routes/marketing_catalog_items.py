"""
Marketing Catalog - Items
Item CRUD + photos + FG integration
"""
import os
import re
import uuid
import html
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from pydantic import BaseModel
from database import get_db
from auth import require_auth

router = APIRouter(prefix='/api/marketing/catalogs', tags=['Marketing-Catalog-items'])

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

