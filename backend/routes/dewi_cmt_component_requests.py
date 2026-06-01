"""Session 27 — GAP-P2 CMT Component Shortage Request
CMT (Contract Manufacturing partner) mengajukan permintaan komponen yang kurang
(misal: lengan, kerah, saku, lining) ke internal team via Admin Packing → SPV Cutting.

Status workflow:
  pending → cutting → ready → delivered
                            └─→ rejected/cancelled

Request type:
  - component  (cutting/sewing parts)
  - accessory  (button, zipper, label) — GAP-P3 dicover di module ini juga
"""
from fastapi import APIRouter, Depends, HTTPException
from database import get_db
from auth import require_auth
from datetime import datetime, timezone
from typing import Optional
import uuid
import re

router = APIRouter(prefix="/api/dewi/cmt-component-requests", tags=["Production-CMT-Shortage-Requests"])


def now_utc():
    return datetime.now(timezone.utc)


def sid():
    return str(uuid.uuid4())


def serialize(doc):
    if doc is None:
        return None
    doc = dict(doc)
    doc.pop('_id', None)
    for k, v in doc.items():
        if isinstance(v, datetime):
            doc[k] = v.isoformat()
    return doc


VALID_TYPES = {'component', 'accessory'}
VALID_STATUSES = {'pending', 'cutting', 'ready', 'delivered', 'rejected', 'cancelled'}


# ─── LIST ────────────────────────────────────────────────────────────────────
@router.get('')
async def list_requests(
    status:       Optional[str] = None,
    cmt_partner:  Optional[str] = None,
    work_order:   Optional[str] = None,
    request_type: Optional[str] = None,
    search:       Optional[str] = None,
    limit:        int = 200,
    user: dict = Depends(require_auth),
):
    db = get_db()
    q: dict = {}
    if status:
        q['status'] = status
    if cmt_partner:
        q['cmt_partner_id'] = cmt_partner
    if work_order:
        q['work_order_id'] = work_order
    if request_type:
        q['request_type'] = request_type
    if search:
        rx = re.escape(search)
        q['$or'] = [
            {'request_code':    {'$regex': rx, '$options': 'i'}},
            {'cmt_partner_name':{'$regex': rx, '$options': 'i'}},
            {'product_name':    {'$regex': rx, '$options': 'i'}},
            {'work_order_code': {'$regex': rx, '$options': 'i'}},
        ]
    items = await db.dewi_cmt_component_requests.find(q).sort('created_at', -1).limit(limit).to_list(length=limit)
    return [serialize(it) for it in items]


# ─── DETAIL ──────────────────────────────────────────────────────────────────
@router.get('/{request_id}')
async def get_request(request_id: str, user: dict = Depends(require_auth)):
    db = get_db()
    doc = await db.dewi_cmt_component_requests.find_one({'id': request_id})
    if not doc:
        raise HTTPException(404, 'Request tidak ditemukan')
    return serialize(doc)


# ─── CREATE ──────────────────────────────────────────────────────────────────
@router.post('')
async def create_request(body: dict, user: dict = Depends(require_auth)):
    db = get_db()

    req_type = body.get('request_type', 'component')
    if req_type not in VALID_TYPES:
        raise HTTPException(400, f'request_type harus salah satu dari: {VALID_TYPES}')

    items = body.get('items') or []
    if not items:
        raise HTTPException(400, 'Minimal 1 item harus diisi')

    today = now_utc().strftime('%y%m%d')
    prefix = 'REQ-CMP' if req_type == 'component' else 'REQ-AKS-CMT'
    seq = await db.dewi_cmt_component_requests.count_documents({'request_code': {'$regex': f'^{prefix}-{today}-'}})
    code = body.get('request_code') or f'{prefix}-{today}-{seq+1:03d}'

    doc = {
        'id': sid(),
        'request_code': code,
        'request_type': req_type,
        'cmt_partner_id':   body.get('cmt_partner_id', ''),
        'cmt_partner_name': body.get('cmt_partner_name', ''),
        'work_order_id':    body.get('work_order_id', ''),
        'work_order_code':  body.get('work_order_code', ''),
        'product_name':     body.get('product_name', ''),
        'items': [
            {
                'component_type': it.get('component_type', ''),   # sleeve/collar/pocket/lining (component) or button/zipper (accessory)
                'size':           it.get('size', ''),             # S/M/L/XL or N/A
                'color':          it.get('color', ''),
                'qty':            float(it.get('qty', 0) or 0),
                'unit':           it.get('unit', 'pcs'),
                'notes':          it.get('notes', ''),
            } for it in items
        ],
        'urgent':         bool(body.get('urgent', False)),
        'needed_by_date': body.get('needed_by_date', ''),
        'notes':          body.get('notes', ''),
        'status':         body.get('status', 'pending'),
        # Workflow tracking
        'requester_id':   user['id'],
        'requester_name': user.get('name', ''),
        'cutting_started_by': None,
        'cutting_started_at': None,
        'ready_by': None,
        'ready_at': None,
        'delivered_by': None,
        'delivered_at': None,
        'delivery_order_number': None,
        'rejection_reason': None,
        'created_at': now_utc(),
        'updated_at': now_utc(),
    }
    await db.dewi_cmt_component_requests.insert_one(doc)
    return serialize(doc)


# ─── UPDATE ──────────────────────────────────────────────────────────────────
@router.put('/{request_id}')
async def update_request(request_id: str, body: dict, user: dict = Depends(require_auth)):
    db = get_db()
    doc = await db.dewi_cmt_component_requests.find_one({'id': request_id})
    if not doc:
        raise HTTPException(404, 'Request tidak ditemukan')
    if doc['status'] in ('delivered', 'rejected', 'cancelled'):
        raise HTTPException(400, f"Tidak bisa edit status {doc['status']}")
    upd = {k: v for k, v in body.items() if k not in ('id', '_id', 'created_at', 'requester_id', 'request_code')}
    if 'items' in upd:
        upd['items'] = [
            {
                'component_type': it.get('component_type', ''),
                'size': it.get('size', ''),
                'color': it.get('color', ''),
                'qty': float(it.get('qty', 0) or 0),
                'unit': it.get('unit', 'pcs'),
                'notes': it.get('notes', ''),
            } for it in (upd['items'] or [])
        ]
    upd['updated_at'] = now_utc()
    await db.dewi_cmt_component_requests.update_one({'id': request_id}, {'$set': upd})
    return {'ok': True}


# ─── SET STATUS (generic transition) ─────────────────────────────────────────
@router.post('/{request_id}/set-status')
async def set_status(request_id: str, body: dict, user: dict = Depends(require_auth)):
    db = get_db()
    new_status = (body or {}).get('status', '')
    if new_status not in VALID_STATUSES:
        raise HTTPException(400, f'status harus salah satu dari: {VALID_STATUSES}')
    doc = await db.dewi_cmt_component_requests.find_one({'id': request_id})
    if not doc:
        raise HTTPException(404, 'Request tidak ditemukan')

    # Transition validation (linear forward, allow rejection from non-final)
    cur = doc['status']
    order = ['pending', 'cutting', 'ready', 'delivered']
    if new_status in ('rejected', 'cancelled'):
        if cur in ('delivered',):
            raise HTTPException(400, 'Tidak bisa reject request yang sudah delivered')
    elif new_status in order and cur in order:
        if order.index(new_status) < order.index(cur):
            raise HTTPException(400, f'Transisi tidak diijinkan: {cur} → {new_status}')

    upd = {'status': new_status, 'updated_at': now_utc()}
    if new_status == 'cutting':
        upd['cutting_started_by'] = user.get('name', '')
        upd['cutting_started_at'] = now_utc()
    elif new_status == 'ready':
        upd['ready_by'] = user.get('name', '')
        upd['ready_at'] = now_utc()
    elif new_status == 'delivered':
        upd['delivered_by'] = user.get('name', '')
        upd['delivered_at'] = now_utc()
        if (body or {}).get('delivery_order_number'):
            upd['delivery_order_number'] = body['delivery_order_number']
    elif new_status == 'rejected':
        upd['rejection_reason'] = (body or {}).get('reason', '')

    await db.dewi_cmt_component_requests.update_one({'id': request_id}, {'$set': upd})
    return {'ok': True}


# ─── DELETE ──────────────────────────────────────────────────────────────────
@router.delete('/{request_id}')
async def delete_request(request_id: str, user: dict = Depends(require_auth)):
    db = get_db()
    doc = await db.dewi_cmt_component_requests.find_one({'id': request_id})
    if not doc:
        raise HTTPException(404, 'Request tidak ditemukan')
    if doc['status'] not in ('pending', 'rejected', 'cancelled'):
        raise HTTPException(400, 'Hanya pending/rejected/cancelled yang bisa dihapus')
    await db.dewi_cmt_component_requests.delete_one({'id': request_id})
    return {'ok': True}


# ─── STATS ───────────────────────────────────────────────────────────────────
@router.get('/stats/summary')
async def stats_summary(user: dict = Depends(require_auth)):
    db = get_db()
    by_status = {}
    async for row in db.dewi_cmt_component_requests.aggregate([{'$group': {'_id': '$status', 'count': {'$sum': 1}}}]):
        by_status[row['_id']] = row['count']

    urgent_pending = await db.dewi_cmt_component_requests.count_documents({
        'urgent': True,
        'status': {'$in': ['pending', 'cutting']}
    })
    return {
        'total': sum(by_status.values()),
        'pending':   by_status.get('pending', 0),
        'cutting':   by_status.get('cutting', 0),
        'ready':     by_status.get('ready', 0),
        'delivered': by_status.get('delivered', 0),
        'rejected':  by_status.get('rejected', 0),
        'urgent_pending': urgent_pending,
    }
