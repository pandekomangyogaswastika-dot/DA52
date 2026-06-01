"""
CV. Dewi Aditya — Portal Maklon: Buyer Catalog (Master Artikel Buyer)
Phase M1: Pemisahan Master Data Maklon vs Internal

Konsep:
- "Buyer Catalog" = library/master artikel yang spesifikasinya diberikan oleh BUYER (client maklon).
- Sederhana, langsung dari spek buyer, TIDAK lewat R&D internal.
- Reusable: 1 artikel buyer bisa dipakai di banyak PO Maklon.

Collection: dewi_maklon_buyer_catalog
- 1 entry = 1 artikel milik 1 buyer (client)
- Composite uniqueness (client_id + artikel_code) supaya kode internal kita unik per buyer.

Endpoint prefix: /api/dewi/maklon
"""
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, timezone

from database import get_db
from auth import require_auth, serialize_doc, log_activity
import uuid
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix='/api/dewi/maklon', tags=['Dewi-Maklon-Buyer-Catalog'])


def _uid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ──────────────────────────────────────────────────────────────────────────────
# PYDANTIC MODELS
# ──────────────────────────────────────────────────────────────────────────────
ALLOWED_STATUS = {'active', 'inactive', 'discontinued'}


class BuyerCatalogIn(BaseModel):
    client_id: str = Field(..., description='FK ke dewi_maklon_clients')
    artikel_code: str = Field(..., min_length=1, max_length=64, description='Kode internal kita (unik per buyer)')
    buyer_ref_code: Optional[str] = Field(default='', max_length=128, description='Kode artikel dari buyer (referensi)')
    product_name: str = Field(..., min_length=1, max_length=255)
    category: Optional[str] = Field(default='', max_length=64)
    season: Optional[str] = Field(default='', max_length=32)
    gender: Optional[str] = Field(default='', max_length=32)
    default_cmt_price: float = Field(default=0, ge=0, description='Default harga jasa jahit per pcs (Rp)')
    default_selling_price: float = Field(default=0, ge=0, description='Default harga jual per pcs (Rp) — opsional')
    color_options: List[str] = Field(default_factory=list)
    size_options: List[str] = Field(default_factory=list)
    description: Optional[str] = Field(default='', max_length=2000)
    hero_image_url: Optional[str] = Field(default='', max_length=1024)
    status: str = Field(default='active')


class BuyerCatalogUpdate(BaseModel):
    artikel_code: Optional[str] = Field(default=None, min_length=1, max_length=64)
    buyer_ref_code: Optional[str] = Field(default=None, max_length=128)
    product_name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    category: Optional[str] = Field(default=None, max_length=64)
    season: Optional[str] = Field(default=None, max_length=32)
    gender: Optional[str] = Field(default=None, max_length=32)
    default_cmt_price: Optional[float] = Field(default=None, ge=0)
    default_selling_price: Optional[float] = Field(default=None, ge=0)
    color_options: Optional[List[str]] = None
    size_options: Optional[List[str]] = None
    description: Optional[str] = Field(default=None, max_length=2000)
    hero_image_url: Optional[str] = Field(default=None, max_length=1024)
    status: Optional[str] = None


# ──────────────────────────────────────────────────────────────────────────────
# HELPERS
# ──────────────────────────────────────────────────────────────────────────────
async def _enrich_client(db, doc: dict) -> dict:
    """Inject client_name from dewi_maklon_clients for display convenience."""
    if not doc:
        return doc
    if doc.get('client_name'):
        return doc
    cl = await db.dewi_maklon_clients.find_one({'id': doc.get('client_id')}, {'_id': 0, 'name': 1, 'code': 1})
    if cl:
        doc['client_name'] = cl.get('name', '')
        doc['client_code'] = cl.get('code', '')
    return doc


def _validate_status(status: Optional[str]) -> None:
    if status is None:
        return
    if status not in ALLOWED_STATUS:
        raise HTTPException(400, f"status harus salah satu dari: {sorted(ALLOWED_STATUS)}")


async def _ensure_unique_artikel_code(db, client_id: str, artikel_code: str, exclude_id: Optional[str] = None) -> None:
    """Pastikan artikel_code unik dalam scope 1 client (composite uniqueness)."""
    filt = {'client_id': client_id, 'artikel_code': artikel_code}
    if exclude_id:
        filt['id'] = {'$ne': exclude_id}
    existing = await db.dewi_maklon_buyer_catalog.find_one(filt)
    if existing:
        raise HTTPException(409, f"artikel_code '{artikel_code}' sudah dipakai untuk buyer ini")


# ──────────────────────────────────────────────────────────────────────────────
# ENDPOINTS — Buyer Catalog CRUD
# ──────────────────────────────────────────────────────────────────────────────
@router.get('/buyer-catalog')
async def list_buyer_catalog(
    client_id: Optional[str] = Query(None, description='Filter by client (buyer)'),
    status: Optional[str] = Query(None, description='active | inactive | discontinued | all'),
    search: Optional[str] = Query(None, description='Search by artikel_code / buyer_ref_code / product_name'),
    limit: int = Query(200, le=500),
    user: dict = Depends(require_auth),
):
    """List Buyer Catalog. Default urut: updated_at desc."""
    db = get_db()
    filt: dict = {}

    if client_id:
        filt['client_id'] = client_id
    if status and status != 'all':
        filt['status'] = status

    if search:
        filt['$or'] = [
            {'artikel_code': {'$regex': search, '$options': 'i'}},
            {'buyer_ref_code': {'$regex': search, '$options': 'i'}},
            {'product_name': {'$regex': search, '$options': 'i'}},
        ]

    cursor = db.dewi_maklon_buyer_catalog.find(filt).sort('updated_at', -1).limit(limit)
    items = [serialize_doc(d) async for d in cursor]

    # Enrich client_name (denormalized fallback)
    for it in items:
        await _enrich_client(db, it)

    return items


@router.post('/buyer-catalog', status_code=201)
async def create_buyer_catalog(payload: BuyerCatalogIn, user: dict = Depends(require_auth)):
    """Buat entry Buyer Catalog baru."""
    db = get_db()

    # Validate status
    _validate_status(payload.status)

    # Validate client exists
    client = await db.dewi_maklon_clients.find_one({'id': payload.client_id})
    if not client:
        raise HTTPException(404, 'Klien (buyer) tidak ditemukan')

    artikel_code = payload.artikel_code.strip()
    await _ensure_unique_artikel_code(db, payload.client_id, artikel_code)

    doc = {
        'id': _uid(),
        'client_id': payload.client_id,
        'client_name': client.get('name', ''),
        'client_code': client.get('code', ''),
        'artikel_code': artikel_code,
        'buyer_ref_code': (payload.buyer_ref_code or '').strip(),
        'product_name': payload.product_name.strip(),
        'category': (payload.category or '').strip(),
        'season': (payload.season or '').strip(),
        'gender': (payload.gender or '').strip(),
        'default_cmt_price': float(payload.default_cmt_price or 0),
        'default_selling_price': float(payload.default_selling_price or 0),
        'color_options': [c.strip() for c in (payload.color_options or []) if c and c.strip()],
        'size_options': [s.strip() for s in (payload.size_options or []) if s and s.strip()],
        'description': (payload.description or '').strip(),
        'hero_image_url': (payload.hero_image_url or '').strip(),
        'status': payload.status or 'active',
        # analytics seed (akan di-update saat dipakai di PO/Phase 2)
        'total_qty_produced': 0,
        'total_revenue': 0.0,
        'last_used_at': None,
        # audit
        'created_at': _now(),
        'updated_at': _now(),
        'created_by': user.get('id') or user.get('email') or 'system',
    }
    await db.dewi_maklon_buyer_catalog.insert_one(doc)
    await log_activity(
        user.get('id') or '',
        user.get('name') or user.get('email') or 'system',
        'buyer_catalog.create',
        'dewi-maklon',
        f"id={doc['id']} client={doc['client_id']} artikel={doc['artikel_code']}",
    )
    return {'message': 'Buyer Catalog berhasil dibuat', 'id': doc['id'], 'item': serialize_doc(doc)}


@router.get('/buyer-catalog/{catalog_id}')
async def get_buyer_catalog(catalog_id: str, user: dict = Depends(require_auth)):
    db = get_db()
    doc = await db.dewi_maklon_buyer_catalog.find_one({'id': catalog_id})
    if not doc:
        raise HTTPException(404, 'Entry Buyer Catalog tidak ditemukan')
    doc = serialize_doc(doc)
    await _enrich_client(db, doc)
    return doc


@router.put('/buyer-catalog/{catalog_id}')
async def update_buyer_catalog(catalog_id: str, payload: BuyerCatalogUpdate, user: dict = Depends(require_auth)):
    db = get_db()
    existing = await db.dewi_maklon_buyer_catalog.find_one({'id': catalog_id})
    if not existing:
        raise HTTPException(404, 'Entry Buyer Catalog tidak ditemukan')

    update_data = payload.model_dump(exclude_unset=True)

    if 'status' in update_data:
        _validate_status(update_data['status'])

    # Validate artikel_code uniqueness if changed
    if 'artikel_code' in update_data and update_data['artikel_code']:
        new_code = update_data['artikel_code'].strip()
        if new_code != existing.get('artikel_code'):
            await _ensure_unique_artikel_code(db, existing['client_id'], new_code, exclude_id=catalog_id)
        update_data['artikel_code'] = new_code

    # Normalize string trims & list cleanup
    for f in ('buyer_ref_code', 'product_name', 'category', 'season', 'gender', 'description', 'hero_image_url'):
        if f in update_data and isinstance(update_data[f], str):
            update_data[f] = update_data[f].strip()

    for f in ('color_options', 'size_options'):
        if f in update_data and isinstance(update_data[f], list):
            update_data[f] = [x.strip() for x in update_data[f] if x and str(x).strip()]

    update_data['updated_at'] = _now()
    await db.dewi_maklon_buyer_catalog.update_one({'id': catalog_id}, {'$set': update_data})

    refreshed = await db.dewi_maklon_buyer_catalog.find_one({'id': catalog_id})
    refreshed = serialize_doc(refreshed)
    await _enrich_client(db, refreshed)

    await log_activity(
        user.get('id') or '',
        user.get('name') or user.get('email') or 'system',
        'buyer_catalog.update',
        'dewi-maklon',
        f"id={catalog_id} fields={list(update_data.keys())}",
    )
    return {'message': 'Buyer Catalog berhasil diperbarui', 'item': refreshed}


@router.put('/buyer-catalog/{catalog_id}/toggle')
async def toggle_buyer_catalog(catalog_id: str, user: dict = Depends(require_auth)):
    """Toggle active <-> inactive (untuk soft-delete style)."""
    db = get_db()
    doc = await db.dewi_maklon_buyer_catalog.find_one({'id': catalog_id})
    if not doc:
        raise HTTPException(404, 'Entry Buyer Catalog tidak ditemukan')

    new_status = 'inactive' if doc.get('status') == 'active' else 'active'
    await db.dewi_maklon_buyer_catalog.update_one(
        {'id': catalog_id},
        {'$set': {'status': new_status, 'updated_at': _now()}},
    )
    await log_activity(
        user.get('id') or '',
        user.get('name') or user.get('email') or 'system',
        'buyer_catalog.toggle',
        'dewi-maklon',
        f"id={catalog_id} status={new_status}",
    )
    return {'message': f"Status diubah menjadi {new_status}", 'status': new_status}


@router.delete('/buyer-catalog/{catalog_id}')
async def delete_buyer_catalog(catalog_id: str, user: dict = Depends(require_auth)):
    """Soft-delete: ubah status ke 'discontinued'. (Hard delete dihindari untuk audit trail.)"""
    db = get_db()
    doc = await db.dewi_maklon_buyer_catalog.find_one({'id': catalog_id})
    if not doc:
        raise HTTPException(404, 'Entry Buyer Catalog tidak ditemukan')

    await db.dewi_maklon_buyer_catalog.update_one(
        {'id': catalog_id},
        {'$set': {'status': 'discontinued', 'updated_at': _now()}},
    )
    await log_activity(
        user.get('id') or '',
        user.get('name') or user.get('email') or 'system',
        'buyer_catalog.discontinue',
        'dewi-maklon',
        f"id={catalog_id}",
    )
    return {'message': 'Entry diset discontinued (soft-delete)', 'id': catalog_id}


# ──────────────────────────────────────────────────────────────────────────────
# HELPER UTILITY — dipakai modul lain (mis. dewi_maklon_pos saat create PO)
# ──────────────────────────────────────────────────────────────────────────────
async def get_buyer_catalog_doc(db, catalog_id: str) -> Optional[dict]:
    """Public helper: dipanggil dari dewi_maklon_pos.py untuk auto-fill snapshot."""
    if not catalog_id:
        return None
    return await db.dewi_maklon_buyer_catalog.find_one({'id': catalog_id}, {'_id': 0})


async def bump_buyer_catalog_usage(db, catalog_id: str, qty: int = 0, revenue: float = 0.0) -> None:
    """Public helper: dipanggil saat PO yang refer ke catalog dibuat/dikonfirmasi.
    Aman dipanggil tanpa await error walau catalog_id None.
    """
    if not catalog_id:
        return
    try:
        await db.dewi_maklon_buyer_catalog.update_one(
            {'id': catalog_id},
            {
                '$set': {'last_used_at': _now()},
                '$inc': {'total_qty_produced': int(qty or 0), 'total_revenue': float(revenue or 0)},
            },
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning('Gagal bump buyer_catalog usage (%s): %s', catalog_id, exc)
