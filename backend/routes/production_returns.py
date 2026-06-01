"""
Production Production Returns
Split from production.py for better maintainability
"""
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from database import get_db
from auth import (require_auth, check_role, serialize_doc)
from routes.shared import new_id, now, parse_date
import logging

logger = logging.getLogger(__name__)

router = APIRouter(tags=["production-returns"])

@router.get("/production-returns")
async def get_returns(request: Request):
    await require_auth(request)
    db = get_db()
    sp = request.query_params
    query = {}
    if sp.get('status'):
        query['status'] = sp['status']
    returns = await db.production_returns.find(query, {'_id': 0}).sort('created_at', -1).to_list(500)
    result = []
    for r in returns:
        items = await db.production_return_items.find({'return_id': r['id']}, {'_id': 0}).to_list(500)
        result.append({**serialize_doc(r), 'items': serialize_doc(items)})
    return result

@router.get("/production-returns/{ret_id}")
async def get_return(ret_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    ret = await db.production_returns.find_one({'id': ret_id}, {'_id': 0})
    if not ret:
        raise HTTPException(404, 'Not found')
    items = await db.production_return_items.find({'return_id': ret_id}, {'_id': 0}).to_list(500)
    result = serialize_doc(ret)
    result['items'] = serialize_doc(items)
    return result

@router.post("/production-returns")
async def create_return(request: Request):
    user = await require_auth(request)
    if not check_role(user, ['admin']):
        raise HTTPException(403, 'Forbidden')
    db = get_db()
    body = await request.json()
    return_id = new_id()
    seq = (await db.production_returns.count_documents({})) + 1
    return_number = f"RTN-{str(seq).zfill(4)}"
    ref_po = await db.production_pos.find_one({'id': body.get('reference_po_id')}) if body.get('reference_po_id') else None
    items_data = body.get('items', [])
    total_qty = sum(int(i.get('return_qty', 0) or 0) for i in items_data)
    return_doc = {
        'id': return_id, 'return_number': return_number,
        'reference_po_id': body.get('reference_po_id'),
        'reference_po_number': (ref_po or {}).get('po_number', body.get('reference_po_number', '')),
        'customer_name': body.get('customer_name', (ref_po or {}).get('customer_name', '')),
        'buyer_name': body.get('buyer_name', body.get('customer_name', '')),
        'return_date': parse_date(body.get('return_date')) or now(),
        'return_reason': body.get('return_reason', ''), 'notes': body.get('notes', ''),
        'status': 'Repair Needed', 'total_return_qty': total_qty,
        'created_by': user['name'], 'created_at': now(), 'updated_at': now()
    }
    await db.production_returns.insert_one(return_doc)
    inserted_items = []
    for item in items_data:
        ri = {
            'id': new_id(), 'return_id': return_id,
            'po_item_id': item.get('po_item_id'),
            'sku': item.get('sku', ''), 'product_name': item.get('product_name', ''),
            'serial_number': item.get('serial_number', ''),
            'size': item.get('size', ''), 'color': item.get('color', ''),
            'return_qty': int(item.get('return_qty', 0) or 0),
            'defect_type': item.get('defect_type', ''),
            'repair_notes': item.get('repair_notes', ''), 'repaired_qty': 0,
            'created_at': now()
        }
        await db.production_return_items.insert_one(ri)
        inserted_items.append(ri)
    result = serialize_doc(return_doc)
    result['items'] = serialize_doc(inserted_items)
    return JSONResponse(result, status_code=201)

@router.put("/production-returns/{ret_id}")
async def update_return(ret_id: str, request: Request):
    user = await require_auth(request)
    if not check_role(user, ['admin']):
        raise HTTPException(403, 'Forbidden')
    db = get_db()
    body = await request.json()
    body.pop('_id', None)
    body.pop('id', None)
    body.pop('items', None)
    if body.get('return_date'):
        body['return_date'] = parse_date(body['return_date'])
    await db.production_returns.update_one({'id': ret_id}, {'$set': {**body, 'updated_at': now()}})
    return serialize_doc(await db.production_returns.find_one({'id': ret_id}, {'_id': 0}))

@router.delete("/production-returns/{ret_id}")
async def delete_return(ret_id: str, request: Request):
    user = await require_auth(request)
    if user.get('role') != 'superadmin':
        raise HTTPException(403, 'Forbidden')
    db = get_db()
    doc = await db.production_returns.find_one({'id': ret_id})
    if not doc:
        raise HTTPException(404, 'Not found')
    await db.production_return_items.delete_many({'return_id': ret_id})
    await db.production_returns.delete_one({'id': ret_id})
    return {'success': True}


# ─── PRODUCTION VARIANCES (OVERPRODUCTION/UNDERPRODUCTION) ──────────────────
