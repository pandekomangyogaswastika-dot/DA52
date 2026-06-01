"""dewi_rnd — Material Research + Sample Costing."""
import re
from fastapi import Depends, HTTPException
from database import get_db
from auth import require_auth
from routes.dewi_rnd_shared import router, now_utc, sid, serialize

# ──────────────────────────────────────────────────────────────────────────────
# MATERIAL RESEARCH (Fabric/Material Research)
# ──────────────────────────────────────────────────────────────────────────────

@router.get('/materials')
async def list_materials(
    search: str = None,
    category: str = None,
    limit: int = 200,
    user: dict = Depends(require_auth),
):
    db = get_db()
    q = {}
    if search:
        q['$or'] = [
            {'material_code': {'$regex': re.escape(search), '$options': 'i'}},
            {'material_name': {'$regex': re.escape(search), '$options': 'i'}},
        ]
    if category:
        q['category'] = category

    items = await db.dewi_rnd_materials.find(q).sort('created_at', -1).limit(limit).to_list(length=limit)
    return [serialize(it) for it in items]


@router.post('/materials')
async def create_material(body: dict, user: dict = Depends(require_auth)):
    db = get_db()
    code = (body.get('material_code') or '').strip().upper()
    name = (body.get('material_name') or '').strip()
    if not code or not name:
        raise HTTPException(400, 'material_code dan material_name wajib diisi')

    existing = await db.dewi_rnd_materials.find_one({'material_code': code})
    if existing:
        raise HTTPException(409, f'Material code {code} sudah ada')

    doc = {
        'id': sid(),
        'material_code': code,
        'material_name': name,
        'category': body.get('category', ''),
        'vendor': body.get('vendor', ''),
        'composition': body.get('composition', ''),
        'weight': body.get('weight', 0),
        'price_per_meter': body.get('price_per_meter', 0),
        'min_order_qty': body.get('min_order_qty', 0),
        'test_results': body.get('test_results', ''),
        'notes': body.get('notes', ''),
        'status': body.get('status', 'active'),
        'created_by': user['id'],
        'created_by_name': user.get('name', ''),
        'created_at': now_utc(),
        'updated_at': now_utc(),
    }
    await db.dewi_rnd_materials.insert_one(doc)
    return serialize(doc)


@router.get('/materials/{material_id}')
async def get_material(material_id: str, user: dict = Depends(require_auth)):
    db = get_db()
    mat = await db.dewi_rnd_materials.find_one({'id': material_id})
    if not mat:
        raise HTTPException(404, 'Material tidak ditemukan')
    return serialize(mat)


@router.put('/materials/{material_id}')
async def update_material(material_id: str, body: dict, user: dict = Depends(require_auth)):
    db = get_db()
    body.pop('_id', None)
    body.pop('id', None)
    body.pop('created_at', None)
    body['updated_at'] = now_utc()

    res = await db.dewi_rnd_materials.update_one({'id': material_id}, {'$set': body})
    if res.matched_count == 0:
        raise HTTPException(404, 'Material tidak ditemukan')

    updated = await db.dewi_rnd_materials.find_one({'id': material_id})
    return serialize(updated)


@router.delete('/materials/{material_id}')
async def delete_material(material_id: str, user: dict = Depends(require_auth)):
    db = get_db()
    res = await db.dewi_rnd_materials.delete_one({'id': material_id})
    if res.deleted_count == 0:
        raise HTTPException(404, 'Material tidak ditemukan')
    return {'success': True}


# ──────────────────────────────────────────────────────────────────────────────
# SAMPLE COSTING (Costing & BOM untuk Sample)
# ──────────────────────────────────────────────────────────────────────────────

@router.get('/sample-costing')
async def list_sample_costing(
    sample_request_id: str = None,
    limit: int = 200,
    user: dict = Depends(require_auth),
):
    db = get_db()
    q = {}
    if sample_request_id:
        q['sample_request_id'] = sample_request_id

    items = await db.dewi_rnd_sample_costing.find(q).sort('created_at', -1).limit(limit).to_list(length=limit)
    return [serialize(it) for it in items]


@router.post('/sample-costing')
async def create_sample_costing(body: dict, user: dict = Depends(require_auth)):
    db = get_db()
    sample_request_id = body.get('sample_request_id')
    if not sample_request_id:
        raise HTTPException(400, 'sample_request_id wajib diisi')

    req = await db.dewi_rnd_sample_requests.find_one({'id': sample_request_id})
    if not req:
        raise HTTPException(404, 'Sample request tidak ditemukan')

    bom_lines = body.get('bom_lines', [])
    total_material_cost = sum(line.get('total_cost', 0) for line in bom_lines)

    doc = {
        'id': sid(),
        'sample_request_id': sample_request_id,
        'sample_code': req.get('sample_code', ''),
        'bom_lines': bom_lines,
        'total_material_cost': total_material_cost,
        'labor_cost': body.get('labor_cost', 0),
        'overhead_cost': body.get('overhead_cost', 0),
        'total_cost': total_material_cost + body.get('labor_cost', 0) + body.get('overhead_cost', 0),
        'notes': body.get('notes', ''),
        'created_by': user['id'],
        'created_by_name': user.get('name', ''),
        'created_at': now_utc(),
        'updated_at': now_utc(),
    }
    await db.dewi_rnd_sample_costing.insert_one(doc)
    return serialize(doc)


@router.get('/sample-costing/{costing_id}')
async def get_sample_costing(costing_id: str, user: dict = Depends(require_auth)):
    db = get_db()
    costing = await db.dewi_rnd_sample_costing.find_one({'id': costing_id})
    if not costing:
        raise HTTPException(404, 'Sample costing tidak ditemukan')
    return serialize(costing)


@router.put('/sample-costing/{costing_id}')
async def update_sample_costing(costing_id: str, body: dict, user: dict = Depends(require_auth)):
    db = get_db()
    body.pop('_id', None)
    body.pop('id', None)
    body.pop('created_at', None)
    body['updated_at'] = now_utc()

    if 'bom_lines' in body:
        total_material_cost = sum(line.get('total_cost', 0) for line in body['bom_lines'])
        body['total_material_cost'] = total_material_cost
        body['total_cost'] = total_material_cost + body.get('labor_cost', 0) + body.get('overhead_cost', 0)

    res = await db.dewi_rnd_sample_costing.update_one({'id': costing_id}, {'$set': body})
    if res.matched_count == 0:
        raise HTTPException(404, 'Sample costing tidak ditemukan')

    updated = await db.dewi_rnd_sample_costing.find_one({'id': costing_id})
    return serialize(updated)


@router.delete('/sample-costing/{costing_id}')
async def delete_sample_costing(costing_id: str, user: dict = Depends(require_auth)):
    db = get_db()
    res = await db.dewi_rnd_sample_costing.delete_one({'id': costing_id})
    if res.deleted_count == 0:
        raise HTTPException(404, 'Sample costing tidak ditemukan')
    return {'success': True}
