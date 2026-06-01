"""dewi_rnd — HPP Calculator + Tech Pack."""
from fastapi import Depends, HTTPException
from database import get_db
from auth import require_auth
from routes.dewi_rnd_shared import router, now_utc, sid, serialize

# ──────────────────────────────────────────────────────────────────────────────
# HPP CALCULATOR (Full Cost per Pcs → Harga Jual Proposal)
# ──────────────────────────────────────────────────────────────────────────────

def _calculate_hpp(body: dict) -> dict:
    """Core HPP calculation logic."""
    fabric_usage   = float(body.get('fabric_usage_per_pcs', 0) or 0)
    fabric_price   = float(body.get('fabric_price_per_meter', 0) or 0)
    accessories    = body.get('accessories_cost', [])
    cmt_cost       = float(body.get('cmt_cost_per_pcs', 0) or 0)
    cutting_cost   = float(body.get('cutting_cost_per_pcs', 0) or 0)
    packaging_cost = float(body.get('packaging_cost_per_pcs', 0) or 0)
    overhead_pct   = float(body.get('overhead_pct', 10) or 10)
    margin_pct     = float(body.get('margin_pct', 30) or 30)

    fabric_cost   = fabric_usage * fabric_price
    acc_total     = sum(
        float(a.get('unit_cost', 0) or 0) * float(a.get('qty', 1) or 1)
        for a in accessories
    )
    direct_cost   = fabric_cost + acc_total + cmt_cost + cutting_cost + packaging_cost
    overhead_val  = direct_cost * overhead_pct / 100
    hpp_total     = direct_cost + overhead_val
    selling_price = hpp_total / (1 - margin_pct / 100) if margin_pct < 100 else hpp_total

    return {
        'fabric_cost':            round(fabric_cost, 2),
        'accessories_total':      round(acc_total, 2),
        'cmt_cost':               round(cmt_cost, 2),
        'cutting_cost':           round(cutting_cost, 2),
        'packaging_cost':         round(packaging_cost, 2),
        'direct_cost':            round(direct_cost, 2),
        'overhead_value':         round(overhead_val, 2),
        'hpp_total':              round(hpp_total, 2),
        'selling_price_proposal': round(selling_price, 2),
        'margin_pct':             margin_pct,
        'overhead_pct':           overhead_pct,
    }


@router.get('/hpp-calculator')
async def list_hpp(
    style_id: str = None,
    user: dict = Depends(require_auth),
):
    db = get_db()
    q = {}
    if style_id:
        q['style_id'] = style_id
    docs = await db.dewi_rnd_hpp.find(q, {'_id': 0}).sort('created_at', -1).to_list(200)
    return [serialize(d) for d in docs]


@router.post('/hpp-calculator')
async def create_hpp(body: dict, user: dict = Depends(require_auth)):
    db = get_db()
    calc = _calculate_hpp(body)
    doc = {
        'id':         sid(),
        'hpp_code':   body.get('hpp_code', f"HPP-{sid()[:6].upper()}"),
        'style_id':   body.get('style_id', ''),
        'style_code': body.get('style_code', ''),
        'style_name': body.get('style_name', ''),
        'fabric_usage_per_pcs':   body.get('fabric_usage_per_pcs', 0),
        'fabric_price_per_meter': body.get('fabric_price_per_meter', 0),
        'accessories_cost':       body.get('accessories_cost', []),
        'cmt_cost_per_pcs':       body.get('cmt_cost_per_pcs', 0),
        'cutting_cost_per_pcs':   body.get('cutting_cost_per_pcs', 0),
        'packaging_cost_per_pcs': body.get('packaging_cost_per_pcs', 0),
        'overhead_pct':           body.get('overhead_pct', 10),
        'margin_pct':             body.get('margin_pct', 30),
        'notes':                  body.get('notes', ''),
        'status':                 body.get('status', 'draft'),
        **calc,
        'created_by':      user['id'],
        'created_by_name': user.get('name', ''),
        'created_at': now_utc(),
        'updated_at': now_utc(),
    }
    await db.dewi_rnd_hpp.insert_one(doc)
    return serialize(doc)


@router.put('/hpp-calculator/{calc_id}')
async def update_hpp(calc_id: str, body: dict, user: dict = Depends(require_auth)):
    db = get_db()
    calc = _calculate_hpp(body)
    upd = {k: v for k, v in body.items() if k not in ('id', '_id', 'created_at', 'created_by')}
    upd.update(calc)
    upd['updated_at'] = now_utc()
    await db.dewi_rnd_hpp.update_one({'id': calc_id}, {'$set': upd})
    doc = await db.dewi_rnd_hpp.find_one({'id': calc_id}, {'_id': 0})
    return serialize(doc)


@router.delete('/hpp-calculator/{calc_id}')
async def delete_hpp(calc_id: str, user: dict = Depends(require_auth)):
    db = get_db()
    await db.dewi_rnd_hpp.delete_one({'id': calc_id})
    return {'ok': True}


@router.post('/hpp-calculator/preview')
async def preview_hpp(body: dict, user: dict = Depends(require_auth)):
    """Calculate HPP on-the-fly without saving (for live preview)."""
    return _calculate_hpp(body)


# ──────────────────────────────────────────────────────────────────────────────
# TECH PACK (Dokumen teknis per style: BOM, konstruksi, grading)
# ──────────────────────────────────────────────────────────────────────────────

@router.get('/tech-packs')
async def list_tech_packs(
    style_id: str = None,
    search: str = None,
    user: dict = Depends(require_auth),
):
    db = get_db()
    q: dict = {}
    if style_id:
        q['style_id'] = style_id
    if search:
        q['$or'] = [
            {'style_code':  {'$regex': search, '$options': 'i'}},
            {'style_name':  {'$regex': search, '$options': 'i'}},
            {'version':     {'$regex': search, '$options': 'i'}},
        ]
    docs = await db.dewi_rnd_tech_packs.find(q, {'_id': 0}).sort('created_at', -1).to_list(200)
    return [serialize(d) for d in docs]


@router.post('/tech-packs')
async def create_tech_pack(body: dict, user: dict = Depends(require_auth)):
    db = get_db()
    doc = {
        'id':           sid(),
        'style_id':     body.get('style_id', ''),
        'style_code':   body.get('style_code', ''),
        'style_name':   body.get('style_name', ''),
        'version':      body.get('version', 'v1'),
        'doc_url':      body.get('doc_url', None),
        'doc_type':     body.get('doc_type', 'pdf'),
        'title':        body.get('title', ''),
        'description':  body.get('description', ''),
        'bom_items':    body.get('bom_items', []),
        'construction_notes': body.get('construction_notes', ''),
        'stitch_type':        body.get('stitch_type', ''),
        'seam_allowance_mm':  body.get('seam_allowance_mm', 10),
        'size_grading_notes': body.get('size_grading_notes', ''),
        'base_size':          body.get('base_size', 'M'),
        'size_range':         body.get('size_range', 'S-XL'),
        'measurements':       body.get('measurements', []),
        'status':       body.get('status', 'draft'),
        'approved_by':  None,
        'approved_at':  None,
        'is_latest':    True,
        'created_by':      user['id'],
        'created_by_name': user.get('name', ''),
        'created_at':   now_utc(),
        'updated_at':   now_utc(),
    }
    if body.get('style_id'):
        await db.dewi_rnd_tech_packs.update_many(
            {'style_id': body['style_id'], 'is_latest': True},
            {'$set': {'is_latest': False}},
        )
    await db.dewi_rnd_tech_packs.insert_one(doc)
    return serialize(doc)


@router.get('/tech-packs/{tp_id}')
async def get_tech_pack(tp_id: str, user: dict = Depends(require_auth)):
    db = get_db()
    doc = await db.dewi_rnd_tech_packs.find_one({'id': tp_id}, {'_id': 0})
    if not doc:
        raise HTTPException(404, 'Tech pack tidak ditemukan')
    return serialize(doc)


@router.put('/tech-packs/{tp_id}')
async def update_tech_pack(tp_id: str, body: dict, user: dict = Depends(require_auth)):
    db = get_db()
    upd = {k: v for k, v in body.items() if k not in ('id', '_id', 'created_at', 'created_by')}
    upd['updated_at'] = now_utc()
    await db.dewi_rnd_tech_packs.update_one({'id': tp_id}, {'$set': upd})
    doc = await db.dewi_rnd_tech_packs.find_one({'id': tp_id}, {'_id': 0})
    return serialize(doc)


@router.post('/tech-packs/{tp_id}/approve')
async def approve_tech_pack(tp_id: str, user: dict = Depends(require_auth)):
    db = get_db()
    await db.dewi_rnd_tech_packs.update_one(
        {'id': tp_id},
        {'$set': {
            'status':      'approved',
            'approved_by':  user.get('name', ''),
            'approved_at':  now_utc(),
            'updated_at':   now_utc(),
        }},
    )
    return {'ok': True}


@router.delete('/tech-packs/{tp_id}')
async def delete_tech_pack(tp_id: str, user: dict = Depends(require_auth)):
    db = get_db()
    await db.dewi_rnd_tech_packs.delete_one({'id': tp_id})
    return {'ok': True}
