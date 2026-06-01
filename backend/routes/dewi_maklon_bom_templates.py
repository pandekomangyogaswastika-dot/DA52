"""
CV. Dewi Aditya — Portal Maklon: BOM Template (Phase M2.2)

Konsep:
- 1 Buyer Catalog bisa punya banyak versi BOM Template (v1, v2, v3, ...)
- Hanya 1 yang berstatus 'is_active = true' pada satu waktu (yang dipakai default)
- Saat buat PO Maklon, user bisa "Apply Template" → copy materials ke dewi_maklon_bom (per-PO override)
- Versi lama tetap tersimpan untuk audit/rollback

Collection: dewi_maklon_bom_templates
- One catalog → many templates
- Composite uniqueness (buyer_catalog_id + version) supaya tidak ada versi double

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
router = APIRouter(prefix='/api/dewi/maklon', tags=['Dewi-Maklon-BOM-Template'])


def _uid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ──────────────────────────────────────────────────────────────────────────────
# PYDANTIC MODELS
# ──────────────────────────────────────────────────────────────────────────────
class BOMMaterialItem(BaseModel):
    material_name: str = Field(..., min_length=1, max_length=255)
    category: Optional[str] = Field(default='', max_length=64)
    unit: str = Field(default='pcs', max_length=16)
    qty_per_pcs: float = Field(default=0, ge=0, description='Qty per pcs produk')
    cost_per_unit: float = Field(default=0, ge=0, description='Estimasi cost per unit (Rp)')
    supplier: Optional[str] = Field(default='', max_length=128)
    notes: Optional[str] = Field(default='', max_length=500)


class BOMTemplateIn(BaseModel):
    buyer_catalog_id: str = Field(..., description='FK ke dewi_maklon_buyer_catalog')
    version_label: Optional[str] = Field(default='', max_length=64, description='Label custom, mis: "Initial", "Revisi material baru"')
    materials: List[BOMMaterialItem] = Field(default_factory=list)
    notes: Optional[str] = Field(default='', max_length=1000)
    set_active: bool = Field(default=True, description='Set sebagai active version (set false untuk simpan as draft)')


class BOMTemplateUpdate(BaseModel):
    version_label: Optional[str] = Field(default=None, max_length=64)
    materials: Optional[List[BOMMaterialItem]] = None
    notes: Optional[str] = Field(default=None, max_length=1000)


# ──────────────────────────────────────────────────────────────────────────────
# HELPERS
# ──────────────────────────────────────────────────────────────────────────────
async def _ensure_catalog_exists(db, catalog_id: str) -> dict:
    cat = await db.dewi_maklon_buyer_catalog.find_one({'id': catalog_id}, {'_id': 0})
    if not cat:
        raise HTTPException(404, 'Buyer Catalog tidak ditemukan')
    return cat


async def _next_version(db, catalog_id: str) -> int:
    last = await db.dewi_maklon_bom_templates.find_one(
        {'buyer_catalog_id': catalog_id}, sort=[('version', -1)]
    )
    return int((last or {}).get('version', 0)) + 1


async def _deactivate_others(db, catalog_id: str, except_id: Optional[str] = None) -> None:
    """Set semua template untuk catalog ini → is_active=False kecuali except_id."""
    filt: dict = {'buyer_catalog_id': catalog_id, 'is_active': True}
    if except_id:
        filt['id'] = {'$ne': except_id}
    await db.dewi_maklon_bom_templates.update_many(
        filt, {'$set': {'is_active': False, 'updated_at': _now()}}
    )


def _compute_total_cost(materials: List[dict]) -> float:
    """Hitung total estimasi cost per pcs produk."""
    total = 0.0
    for m in materials or []:
        try:
            total += float(m.get('qty_per_pcs') or 0) * float(m.get('cost_per_unit') or 0)
        except (ValueError, TypeError):
            continue
    return round(total, 2)


# ──────────────────────────────────────────────────────────────────────────────
# CRUD ENDPOINTS
# ──────────────────────────────────────────────────────────────────────────────
@router.get('/bom-templates')
async def list_bom_templates(
    buyer_catalog_id: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(None),
    user: dict = Depends(require_auth),
):
    """List BOM templates. Filter by catalog atau is_active."""
    db = get_db()
    filt: dict = {}
    if buyer_catalog_id:
        filt['buyer_catalog_id'] = buyer_catalog_id
    if is_active is not None:
        filt['is_active'] = is_active
    cursor = db.dewi_maklon_bom_templates.find(filt).sort([('buyer_catalog_id', 1), ('version', -1)]).limit(500)
    items = [serialize_doc(d) async for d in cursor]
    return items


@router.post('/bom-templates', status_code=201)
async def create_bom_template(payload: BOMTemplateIn, user: dict = Depends(require_auth)):
    """Buat BOM Template baru (versi auto-increment per catalog)."""
    db = get_db()
    cat = await _ensure_catalog_exists(db, payload.buyer_catalog_id)

    version = await _next_version(db, payload.buyer_catalog_id)
    materials = [m.dict() for m in (payload.materials or [])]
    total_cost = _compute_total_cost(materials)

    doc = {
        'id': _uid(),
        'buyer_catalog_id': payload.buyer_catalog_id,
        'catalog_artikel_code': cat.get('artikel_code', ''),
        'catalog_product_name': cat.get('product_name', ''),
        'client_id': cat.get('client_id'),
        'client_name': cat.get('client_name', ''),
        'version': version,
        'version_label': (payload.version_label or f'v{version}').strip() or f'v{version}',
        'materials': materials,
        'material_count': len(materials),
        'total_cost_per_pcs': total_cost,
        'notes': (payload.notes or '').strip(),
        'is_active': bool(payload.set_active),
        'created_at': _now(),
        'updated_at': _now(),
        'created_by_id': user.get('id') or '',
        'created_by_name': user.get('name') or user.get('email') or 'system',
    }
    await db.dewi_maklon_bom_templates.insert_one(doc)

    # Kalau set_active → deactivate yang lain
    if payload.set_active:
        await _deactivate_others(db, payload.buyer_catalog_id, except_id=doc['id'])

    await log_activity(
        user.get('id') or '',
        user.get('name') or user.get('email') or 'system',
        'bom_template.create',
        'dewi-maklon',
        f"catalog={payload.buyer_catalog_id} version={version} active={payload.set_active}",
    )
    return {'message': f'BOM Template v{version} dibuat', 'item': serialize_doc(doc)}


@router.get('/bom-templates/{template_id}')
async def get_bom_template(template_id: str, user: dict = Depends(require_auth)):
    db = get_db()
    doc = await db.dewi_maklon_bom_templates.find_one({'id': template_id})
    if not doc:
        raise HTTPException(404, 'BOM Template tidak ditemukan')
    return serialize_doc(doc)


@router.put('/bom-templates/{template_id}')
async def update_bom_template(template_id: str, payload: BOMTemplateUpdate, user: dict = Depends(require_auth)):
    """Update BOM Template existing. NOTE: tidak menambah versi baru — overwrite versi ini."""
    db = get_db()
    doc = await db.dewi_maklon_bom_templates.find_one({'id': template_id})
    if not doc:
        raise HTTPException(404, 'BOM Template tidak ditemukan')

    update_data = payload.model_dump(exclude_unset=True)
    if 'materials' in update_data and update_data['materials'] is not None:
        materials_list = [
            (m.dict() if isinstance(m, BOMMaterialItem) else m)
            for m in update_data['materials']
        ]
        update_data['materials'] = materials_list
        update_data['material_count'] = len(materials_list)
        update_data['total_cost_per_pcs'] = _compute_total_cost(materials_list)
    if 'version_label' in update_data and isinstance(update_data['version_label'], str):
        update_data['version_label'] = update_data['version_label'].strip()
    if 'notes' in update_data and isinstance(update_data['notes'], str):
        update_data['notes'] = update_data['notes'].strip()
    update_data['updated_at'] = _now()

    await db.dewi_maklon_bom_templates.update_one({'id': template_id}, {'$set': update_data})
    refreshed = await db.dewi_maklon_bom_templates.find_one({'id': template_id})
    await log_activity(
        user.get('id') or '',
        user.get('name') or user.get('email') or 'system',
        'bom_template.update',
        'dewi-maklon',
        f"id={template_id}",
    )
    return {'message': 'BOM Template diperbarui', 'item': serialize_doc(refreshed)}


@router.post('/bom-templates/{template_id}/activate')
async def activate_bom_template(template_id: str, user: dict = Depends(require_auth)):
    """Set template ini sebagai active version untuk catalog-nya (deactivate yang lain)."""
    db = get_db()
    doc = await db.dewi_maklon_bom_templates.find_one({'id': template_id})
    if not doc:
        raise HTTPException(404, 'BOM Template tidak ditemukan')
    await _deactivate_others(db, doc['buyer_catalog_id'], except_id=template_id)
    await db.dewi_maklon_bom_templates.update_one(
        {'id': template_id}, {'$set': {'is_active': True, 'updated_at': _now()}}
    )
    await log_activity(
        user.get('id') or '',
        user.get('name') or user.get('email') or 'system',
        'bom_template.activate',
        'dewi-maklon',
        f"id={template_id} catalog={doc['buyer_catalog_id']}",
    )
    return {'message': f"v{doc['version']} sekarang aktif untuk artikel ini"}


@router.delete('/bom-templates/{template_id}')
async def delete_bom_template(template_id: str, user: dict = Depends(require_auth)):
    """Hapus permanen (boleh karena versioning sudah handle audit)."""
    db = get_db()
    doc = await db.dewi_maklon_bom_templates.find_one({'id': template_id})
    if not doc:
        raise HTTPException(404, 'BOM Template tidak ditemukan')
    await db.dewi_maklon_bom_templates.delete_one({'id': template_id})
    await log_activity(
        user.get('id') or '',
        user.get('name') or user.get('email') or 'system',
        'bom_template.delete',
        'dewi-maklon',
        f"id={template_id} catalog={doc['buyer_catalog_id']} version={doc['version']}",
    )
    return {'message': 'BOM Template dihapus'}


# ──────────────────────────────────────────────────────────────────────────────
# APPLY-TO-PO — copy template materials ke dewi_maklon_bom (per-PO BOM)
# ──────────────────────────────────────────────────────────────────────────────
class ApplyToPOIn(BaseModel):
    po_id: str = Field(..., description='Target PO Maklon')
    template_id: Optional[str] = Field(default=None, description='Specific template ID; jika kosong → pakai active version')


@router.post('/bom-templates/apply-to-po')
async def apply_template_to_po(payload: ApplyToPOIn, user: dict = Depends(require_auth)):
    """
    Copy materials dari BOM Template ke dewi_maklon_bom (per-PO BOM, ada unique po_id).
    Jika BOM untuk PO sudah ada → akan REPLACE (override).
    Strategi:
      - Tentukan template: explicit template_id ATAU active version dari catalog di item PO pertama
      - Multi-catalog dalam 1 PO: pakai catalog di item pertama yang punya buyer_catalog_id
    """
    db = get_db()
    po = await db.dewi_maklon_pos.find_one({'id': payload.po_id})
    if not po:
        raise HTTPException(404, 'PO Maklon tidak ditemukan')

    # Resolve template
    template: Optional[dict] = None
    if payload.template_id:
        template = await db.dewi_maklon_bom_templates.find_one({'id': payload.template_id})
        if not template:
            raise HTTPException(404, 'BOM Template tidak ditemukan')
    else:
        # Cari catalog dari item PO pertama yang punya buyer_catalog_id, lalu ambil active template
        first_cat_id: Optional[str] = None
        for it in (po.get('items') or []):
            if it.get('buyer_catalog_id'):
                first_cat_id = it['buyer_catalog_id']
                break
        if not first_cat_id:
            raise HTTPException(
                400,
                'Tidak ada item PO yang terhubung ke Buyer Catalog. Pilih template_id eksplisit.',
            )
        template = await db.dewi_maklon_bom_templates.find_one(
            {'buyer_catalog_id': first_cat_id, 'is_active': True}
        )
        if not template:
            raise HTTPException(
                404,
                'Tidak ada BOM Template aktif untuk artikel ini. Buat template dulu di Buyer Catalog.',
            )

    # Build / upsert PO BOM
    now = _now()
    new_materials = []
    for m in (template.get('materials') or []):
        new_materials.append({
            'id': _uid(),
            'material_name': m.get('material_name', ''),
            'category': m.get('category', ''),
            'unit': m.get('unit', 'pcs'),
            'qty_per_pcs': float(m.get('qty_per_pcs') or 0),
            'qty_total_est': float(m.get('qty_per_pcs') or 0) * float(po.get('total_qty') or 0),
            'qty_actual': 0,
            'cost_per_unit': float(m.get('cost_per_unit') or 0),
            'supplier': m.get('supplier', ''),
            'notes': m.get('notes', ''),
        })

    existing_bom = await db.dewi_maklon_bom.find_one({'po_id': payload.po_id})
    if existing_bom:
        await db.dewi_maklon_bom.update_one(
            {'po_id': payload.po_id},
            {
                '$set': {
                    'materials': new_materials,
                    'source_template_id': template['id'],
                    'source_template_version': template['version'],
                    'source_template_label': template.get('version_label', ''),
                    'applied_at': now,
                    'applied_by_name': user.get('name', 'System'),
                    'updated_at': now,
                }
            },
        )
        msg = f"BOM PO {po['po_number']} di-REPLACE dengan template v{template['version']}"
    else:
        bom_doc = {
            'id': _uid(),
            'po_id': payload.po_id,
            'po_number': po.get('po_number'),
            'materials': new_materials,
            'source_template_id': template['id'],
            'source_template_version': template['version'],
            'source_template_label': template.get('version_label', ''),
            'applied_at': now,
            'applied_by_name': user.get('name', 'System'),
            'created_at': now,
            'updated_at': now,
        }
        await db.dewi_maklon_bom.insert_one(bom_doc)
        msg = f"BOM PO {po['po_number']} dibuat dari template v{template['version']}"

    await log_activity(
        user.get('id') or '',
        user.get('name') or user.get('email') or 'system',
        'bom_template.apply',
        'dewi-maklon',
        f"po={payload.po_id} template={template['id']} version={template['version']}",
    )
    return {
        'message': msg,
        'template_id': template['id'],
        'template_version': template['version'],
        'material_count': len(new_materials),
    }
