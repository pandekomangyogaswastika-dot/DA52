"""
operations_reminders.py — Vendor Reminder Management
Endpoints: /api/reminders/*

Refactored: Session #12 P2 (split from operations.py 2580 LOC monolith,
deprecated accessories section removed)
"""
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from database import get_db
from auth import require_auth, check_role, log_activity, serialize_doc
from routes.shared import new_id, now

router = APIRouter(prefix="/api", tags=["reminders"])

@router.get("/reminders")
async def get_reminders(request: Request):
    user = await require_auth(request)
    db = get_db()
    query = {}
    if user.get('role') == 'vendor':
        query['vendor_id'] = user.get('vendor_id')
    sp = request.query_params
    if sp.get('status'):
        query['status'] = sp['status']
    if sp.get('vendor_id') and user.get('role') != 'vendor':
        query['vendor_id'] = sp['vendor_id']
    reminders = await db.reminders.find(query, {'_id': 0}).sort('created_at', -1).to_list(500)
    return serialize_doc(reminders)

@router.post("/reminders")
async def create_reminder(request: Request):
    user = await require_auth(request)
    if not check_role(user, ['admin']):
        raise HTTPException(403, 'Forbidden')
    db = get_db()
    body = await request.json()
    vendor_id = body.get('vendor_id')
    if not vendor_id:
        raise HTTPException(400, 'vendor_id required')
    vendor = await db.garments.find_one({'id': vendor_id})
    reminder = {
        'id': new_id(),
        'vendor_id': vendor_id, 'vendor_name': (vendor or {}).get('garment_name', ''),
        'po_id': body.get('po_id', ''), 'po_number': body.get('po_number', ''),
        'reminder_type': body.get('reminder_type', 'general'),
        'subject': body.get('subject', ''), 'message': body.get('message', ''),
        'priority': body.get('priority', 'normal'),
        'status': 'pending', 'response': None, 'response_date': None,
        'created_by': user.get('name', ''), 'created_at': now(), 'updated_at': now()
    }
    await db.reminders.insert_one(reminder)
    await log_activity(user['id'], user.get('name', ''), 'create', 'reminder', f"Sent reminder to {(vendor or {}).get('garment_name', vendor_id)}")
    return JSONResponse(serialize_doc({k: v for k, v in reminder.items() if k != '_id'}), status_code=201)

@router.put("/reminders/{reminder_id}")
async def update_reminder(reminder_id: str, request: Request):
    user = await require_auth(request)
    db = get_db()
    body = await request.json()
    existing = await db.reminders.find_one({'id': reminder_id})
    if not existing:
        raise HTTPException(404, 'Reminder not found')
    update = {'updated_at': now()}
    # Vendor responding
    if user.get('role') == 'vendor' and body.get('response'):
        update['response'] = body['response']
        update['response_date'] = now()
        update['responded_by'] = user.get('name', '')
        update['status'] = 'responded'
    # Admin updating
    if user.get('role') in ['admin', 'superadmin']:
        if 'status' in body:
            update['status'] = body['status']
        if 'message' in body:
            update['message'] = body['message']
    await db.reminders.update_one({'id': reminder_id}, {'$set': update})
    return serialize_doc(await db.reminders.find_one({'id': reminder_id}, {'_id': 0}))

@router.delete("/reminders/{reminder_id}")
async def delete_reminder(reminder_id: str, request: Request):
    user = await require_auth(request)
    if not check_role(user, ['admin']):
        raise HTTPException(403, 'Forbidden')
    db = get_db()
    await db.reminders.delete_one({'id': reminder_id})
    return {'success': True}
