"""
Production Work Orders Management
Split from production.py for better maintainability
"""
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from database import get_db
from auth import (require_auth, check_role, serialize_doc)
from routes.shared import new_id, now
import logging

logger = logging.getLogger(__name__)

router = APIRouter(tags=["production-work-orders"])

@router.get("/work-orders")
async def get_work_orders(request: Request):
    user = await require_auth(request)
    db = get_db()
    sp = request.query_params
    query = {}
    if sp.get('po_id'):
        query['po_id'] = sp['po_id']
    if sp.get('garment_id'):
        query['garment_id'] = sp['garment_id']
    if sp.get('status'):
        query['status'] = sp['status']
    if user.get('role') == 'vendor':
        query['garment_id'] = user.get('vendor_id')
    return serialize_doc(await db.work_orders.find(query, {'_id': 0}).sort('created_at', -1).to_list(500))

@router.post("/work-orders")
async def create_work_order(request: Request):
    user = await require_auth(request)
    if not check_role(user, ['admin']):
        raise HTTPException(403, 'Forbidden')
    db = get_db()
    body = await request.json()
    po = await db.production_pos.find_one({'id': body.get('po_id')})
    if not po:
        raise HTTPException(404, 'PO not found')
    garment = await db.garments.find_one({'id': body.get('garment_id')})
    if not garment:
        raise HTTPException(404, 'Garment not found')
    wo = {
        'id': new_id(), 'distribution_code': f"WO-{po.get('po_number')}-{garment.get('garment_code')}",
        'po_id': body['po_id'], 'po_number': po.get('po_number'),
        'customer_name': po.get('customer_name'),
        'garment_id': body['garment_id'], 'garment_name': garment.get('garment_name'),
        'garment_code': garment.get('garment_code'),
        'quantity': int(body.get('quantity', 0)), 'completed_quantity': 0,
        'status': 'Waiting', 'notes': body.get('notes', ''),
        'created_by': user['name'], 'created_at': now(), 'updated_at': now()
    }
    await db.work_orders.insert_one(wo)
    await db.production_pos.update_one({'id': body['po_id']}, {'$set': {'status': 'Distributed', 'updated_at': now()}})
    return JSONResponse(serialize_doc(wo), status_code=201)

@router.delete("/work-orders/{woid}")
async def delete_work_order(woid: str, request: Request):
    user = await require_auth(request)
    if user.get('role') != 'superadmin':
        raise HTTPException(403, 'Forbidden')
    db = get_db()
    doc = await db.work_orders.find_one({'id': woid})
    if not doc:
        raise HTTPException(404, 'Not found')
    await db.production_progress.delete_many({'work_order_id': woid})
    await db.work_orders.delete_one({'id': woid})
    return {'success': True}


# ─── RECALCULATE JOBS ────────────────────────────────────────────────────────
@router.post("/recalculate-jobs")
async def recalculate_jobs(request: Request):
    """Admin-only maintenance endpoint to repair/backfill po_item_id & available_qty.

    ════════════════════════════════════════════════════════════════════════
    ⚠️  TECHNICAL DEBT — N+1 QUERIES (intentionally NOT refactored)
    ════════════════════════════════════════════════════════════════════════
    **Status**: ~9 N+1 patterns remain (audit Phase 3). DO NOT naive-prefetch.

    **Why prefetch is DANGEROUS here**:
      1. Dynamic dependency — Step 1 UPDATES vendor_shipment_items.po_item_id
         then Step 2 reads those same docs. If we prefetch everything at the
         start of Step 2, we get STALE data (snapshot before mutation) →
         incorrect recalculation output.
      2. 3-level fallback hierarchy: try parent_shipment → grandparent_shipment
         → sku/size/color match. Prefetch must eagerly load all 3 hierarchy
         levels which explodes the working set.
      3. Conditional branches only execute based on prior-iteration results
         (e.g., "if po_item_id still not resolved, try grandparent"). Cannot
         be flattened into a batch operation without reproducing the entire
         state machine.

    **Why it stays slow but tolerable**:
      - Admin-only, manually triggered (not user-facing).
      - Called rarely (only when data drift detected, e.g. after bulk import
        or schema migration). Typical runtime: 30s-2min, users accept it.

    **Recommended future rearchitecture** (NOT a simple N+1 fix):
      - Move to background job (Celery / RQ / APScheduler) with progress
        tracker exposed via SSE or polling endpoint.
      - Add idempotency hooks in vendor_shipment_items write path so drift
        doesn't accumulate in the first place → endpoint becomes rarely needed.
      - Effort: ~3-5 days with migration plan. Separate from N+1 cleanup.

    **Owner**: Platform/data-integrity team (separate backlog).
    """
    user = await require_auth(request)
    if not check_role(user, ['admin']):
        raise HTTPException(403, 'Forbidden')
    db = get_db()
    fixed = 0
    # First: backfill po_item_id on child shipment items that are missing it
    orphan_items = await db.vendor_shipment_items.find({'$or': [{'po_item_id': None}, {'po_item_id': ''}, {'po_item_id': {'$exists': False}}]}).to_list(500)
    for oi in orphan_items:
        ship = await db.vendor_shipments.find_one({'id': oi.get('shipment_id')})
        if not ship or not ship.get('parent_shipment_id'):
            continue
        # Find matching item in parent shipment by sku+size+color
        parent_items = await db.vendor_shipment_items.find({'shipment_id': ship['parent_shipment_id']}).to_list(500)
        for pi in parent_items:
            if pi.get('sku') == oi.get('sku') and pi.get('size', '') == oi.get('size', '') and pi.get('color', '') == oi.get('color', ''):
                if pi.get('po_item_id'):
                    await db.vendor_shipment_items.update_one({'id': oi['id']}, {'$set': {
                        'po_item_id': pi['po_item_id'], 'po_id': pi.get('po_id', ''),
                        'po_number': pi.get('po_number', ''), 'serial_number': pi.get('serial_number', ''),
                    }})
                    break
        # If still no match, try grandparent
        if not pi.get('po_item_id'):
            gp_ship = await db.vendor_shipments.find_one({'id': ship['parent_shipment_id']})
            if gp_ship and gp_ship.get('parent_shipment_id'):
                gp_items = await db.vendor_shipment_items.find({'shipment_id': gp_ship['parent_shipment_id']}).to_list(500)
                for gpi in gp_items:
                    if gpi.get('sku') == oi.get('sku') and gpi.get('size', '') == oi.get('size', '') and gpi.get('color', '') == oi.get('color', ''):
                        if gpi.get('po_item_id'):
                            await db.vendor_shipment_items.update_one({'id': oi['id']}, {'$set': {
                                'po_item_id': gpi['po_item_id'], 'po_id': gpi.get('po_id', ''),
                                'po_number': gpi.get('po_number', ''), 'serial_number': gpi.get('serial_number', ''),
                            }})
                            break
    # Now recalculate job items
    all_jobs = await db.production_jobs.find({}).to_list(500)
    for job in all_jobs:
        job_items = await db.production_job_items.find({'job_id': job['id']}).to_list(500)
        # If this is a child job, try to resolve missing po_item_id from parent job items
        parent_job_items = []
        if job.get('parent_job_id'):
            parent_job_items = await db.production_job_items.find({'job_id': job['parent_job_id']}).to_list(500)
        for ji in job_items:
            po_item_id = ji.get('po_item_id')
            # Try to resolve po_item_id if missing
            if not po_item_id:
                # Try from vendor shipment item
                if ji.get('vendor_shipment_item_id'):
                    vsi = await db.vendor_shipment_items.find_one({'id': ji['vendor_shipment_item_id']})
                    if vsi and vsi.get('po_item_id'):
                        po_item_id = vsi['po_item_id']
                # Try from parent job items by sku+size+color
                if not po_item_id and parent_job_items:
                    for pji in parent_job_items:
                        if (pji.get('sku', '') == ji.get('sku', '') and
                            pji.get('size', '') == ji.get('size', '') and
                            pji.get('color', '') == ji.get('color', '')):
                            po_item_id = pji.get('po_item_id')
                            break
            if not po_item_id:
                continue
            # Get available_qty from THIS job item's specific shipment only (not all shipments)
            own_received = 0
            own_defect = 0
            if ji.get('vendor_shipment_item_id'):
                own_vsi = await db.vendor_shipment_items.find_one({'id': ji['vendor_shipment_item_id']})
                if own_vsi:
                    own_insp = await db.vendor_material_inspections.find_one({'shipment_id': own_vsi.get('shipment_id')})
                    if own_insp:
                        own_ii = await db.vendor_material_inspection_items.find_one({
                            'inspection_id': own_insp['id'], 'shipment_item_id': own_vsi['id']})
                        if own_ii:
                            own_received = own_ii.get('received_qty', 0)
                            own_defect = own_ii.get('defect_qty', 0)
                        else:
                            own_received = own_vsi.get('qty_sent', 0)
                    elif own_vsi:
                        own_received = own_vsi.get('qty_sent', 0)
            new_avail = max(0, own_received - own_defect) if own_received > 0 else ji.get('available_qty', 0)
            sn = ji.get('serial_number', '')
            if not sn and po_item_id:
                poi = await db.po_items.find_one({'id': po_item_id})
                sn = (poi or {}).get('serial_number', '')
            update_fields = {
                'po_item_id': po_item_id,
                'serial_number': sn,
                'updated_at': now()
            }
            # Only update available_qty if we got received data from this item's own shipment
            if own_received > 0:
                update_fields['available_qty'] = new_avail
            await db.production_job_items.update_one({'id': ji['id']}, {'$set': update_fields})
            fixed += 1
    return {'success': True, 'items_updated': fixed, 'jobs_processed': len(all_jobs), 'orphans_fixed': len(orphan_items)}


# ─── PRODUCTION RETURNS ──────────────────────────────────────────────────────
