"""
Production Jobs Management
Split from production.py for better maintainability
"""
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from database import get_db
from auth import (require_auth, log_activity, serialize_doc)
from routes.shared import new_id, now
import logging

logger = logging.getLogger(__name__)

router = APIRouter(tags=["production-jobs"])

@router.get("/production-jobs")
async def get_jobs(request: Request):
    user = await require_auth(request)
    db = get_db()
    sp = request.query_params
    skip = int(sp.get("skip", 0))
    limit = int(sp.get("limit", 30))
    filt = {}
    if user.get('role') == 'vendor':
        filt['vendor_id'] = user.get('vendor_id')
    if sp.get('vendor_id'):
        filt['vendor_id'] = sp['vendor_id']
    if sp.get('include_children') != 'true':
        filt['parent_job_id'] = {'$in': [None, '', False]}
    total = await db.production_jobs.count_documents(filt)
    jobs = await db.production_jobs.find(filt, {'_id': 0}).sort('created_at', -1).skip(skip).limit(limit).to_list(500)
    # Also include jobs where parent_job_id doesn't exist (only page 1)
    if sp.get('include_children') != 'true' and skip == 0:
        extra = await db.production_jobs.find({**{k:v for k,v in filt.items() if k != 'parent_job_id'}, 'parent_job_id': {'$exists': False}}, {'_id': 0}).sort('created_at', -1).to_list(500)
        existing_ids = {j['id'] for j in jobs}
        for e in extra:
            if e['id'] not in existing_ids:
                jobs.append(e)

    if not jobs:
        return {"total": total, "skip": skip, "limit": limit, "has_more": False, "items": []}

    # ── Batch prefetch: eliminate N+1 queries ──────────────────────────────
    job_ids = [j['id'] for j in jobs]

    # 1) All direct job items in one query
    raw_job_items = await db.production_job_items.find({'job_id': {'$in': job_ids}}, {'_id': 0}).to_list(2000)
    items_by_job = {}
    for ji in raw_job_items:
        items_by_job.setdefault(ji['job_id'], []).append(ji)

    # 2) All child jobs in one query
    raw_child_jobs = await db.production_jobs.find({'parent_job_id': {'$in': job_ids}}, {'_id': 0}).to_list(2000)
    children_by_parent = {}
    for cj in raw_child_jobs:
        children_by_parent.setdefault(cj['parent_job_id'], []).append(cj)

    # 3) All child job items in one query
    child_ids = [cj['id'] for cj in raw_child_jobs]
    raw_child_items = await db.production_job_items.find({'job_id': {'$in': child_ids}}, {'_id': 0}).to_list(2000) if child_ids else []
    child_items_by_job = {}
    for ci in raw_child_items:
        child_items_by_job.setdefault(ci['job_id'], []).append(ci)

    # 4) All buyer_shipment_items in one compound query
    all_job_item_ids = [ji['id'] for ji in raw_job_items + raw_child_items]
    all_po_item_ids  = list({ji['po_item_id'] for ji in (raw_job_items + raw_child_items) if ji.get('po_item_id')})
    buyer_or_clauses = [{'job_id': {'$in': job_ids}}]
    if all_job_item_ids:
        buyer_or_clauses.append({'job_item_id': {'$in': all_job_item_ids}})
    if all_po_item_ids:
        buyer_or_clauses.append({'po_item_id': {'$in': all_po_item_ids}})
    raw_buyer_items = await db.buyer_shipment_items.find({'$or': buyer_or_clauses}).to_list(5000)
    # Build a lookup: job_id → set of unique buyer_shipment_item ids + qty
    buyer_shipped_by_job = {}
    seen_bids_global = set()
    for bi in raw_buyer_items:
        bid = bi.get('id', str(bi.get('_id', '')))
        if bid in seen_bids_global:
            continue
        seen_bids_global.add(bid)
        # Attribute to parent job via job_id field first, then job_item_id → job_id
        target_job = bi.get('job_id')
        if not target_job:
            # Find which job owns this job_item
            for ji in raw_job_items + raw_child_items:
                if ji.get('id') == bi.get('job_item_id') or ji.get('po_item_id') == bi.get('po_item_id'):
                    target_job = ji.get('job_id')
                    break
        if target_job:
            # Map child job back to parent
            parent_id = target_job
            for cj in raw_child_jobs:
                if cj['id'] == target_job:
                    parent_id = cj.get('parent_job_id', target_job)
                    break
            buyer_shipped_by_job[parent_id] = buyer_shipped_by_job.get(parent_id, 0) + bi.get('qty_shipped', 0)
    # ── Build result ────────────────────────────────────────────────────────
    result = []
    for j in jobs:
        jid = j['id']
        items = items_by_job.get(jid, [])
        child_jobs = children_by_parent.get(jid, [])
        total_ordered   = sum(i.get('ordered_qty', 0) for i in items)
        total_available = sum(i.get('available_qty', i.get('shipment_qty', 0)) for i in items)
        total_produced  = sum(i.get('produced_qty', 0) for i in items)
        for child in child_jobs:
            ci = child_items_by_job.get(child['id'], [])
            total_available += sum(i.get('available_qty', i.get('shipment_qty', 0)) for i in ci)
            total_produced  += sum(i.get('produced_qty', 0) for i in ci)
        total_shipped_to_buyer = buyer_shipped_by_job.get(jid, 0)
        shippable_produced = min(total_produced, total_ordered) if total_ordered > 0 else total_produced
        remaining_to_ship  = max(0, shippable_produced - total_shipped_to_buyer)
        serial_numbers = list(set(i.get('serial_number', '') for i in items if i.get('serial_number')))
        result.append({**serialize_doc(j), 'item_count': len(items),
                       'total_ordered': total_ordered, 'total_available': total_available,
                       'total_produced': total_produced, 'total_shipped_to_buyer': total_shipped_to_buyer,
                       'remaining_to_ship': remaining_to_ship,
                       'progress_pct': round((total_produced / total_available * 100) if total_available > 0 else 0),
                       'serial_numbers': serial_numbers, 'child_job_count': len(child_jobs),
                       'child_jobs': [{'id': c['id'], 'job_number': c.get('job_number'), 'status': c.get('status'), 'shipment_type': c.get('shipment_type')} for c in child_jobs]})
    return {"total": total, "skip": skip, "limit": limit, "has_more": (skip + limit) < total, "items": result}

@router.get("/production-jobs/{jid}")
async def get_job(jid: str, request: Request):
    await require_auth(request)
    db = get_db()
    job = await db.production_jobs.find_one({'id': jid}, {'_id': 0})
    if not job:
        raise HTTPException(404, 'Not found')
    items = await db.production_job_items.find({'job_id': jid}, {'_id': 0}).to_list(500)
    enriched_items = []
    for item in items:
        defects = await db.material_defect_reports.find({'job_item_id': item['id']}).to_list(500)
        total_defect = sum(d.get('defect_qty', 0) for d in defects)
        effective_available = max(0, (item.get('available_qty', item.get('shipment_qty', 0))) - total_defect)
        enriched_items.append({**serialize_doc(item), 'total_defect_qty': total_defect, 'effective_available_qty': effective_available})
    child_jobs = await db.production_jobs.find({'parent_job_id': jid}, {'_id': 0}).to_list(500)
    result = serialize_doc(job)
    result['items'] = enriched_items
    result['child_jobs'] = serialize_doc(child_jobs)
    return result

@router.post("/production-jobs")
async def create_job(request: Request):
    user = await require_auth(request)
    db = get_db()
    body = await request.json()
    vendor_id = user.get('vendor_id') if user.get('role') == 'vendor' else body.get('vendor_id')
    if not vendor_id:
        raise HTTPException(400, 'vendor_id diperlukan')
    shipment = await db.vendor_shipments.find_one({'id': body.get('vendor_shipment_id')})
    if not shipment:
        raise HTTPException(404, 'Shipment tidak ditemukan')
    if shipment.get('status') != 'Received':
        raise HTTPException(400, 'Shipment belum dikonfirmasi diterima.')
    if shipment.get('vendor_id') != vendor_id:
        raise HTTPException(403, 'Shipment ini bukan milik vendor Anda')
    if shipment.get('inspection_status') != 'Inspected':
        raise HTTPException(400, "Inspeksi material belum selesai.")
    existing = await db.production_jobs.find_one({'vendor_shipment_id': body['vendor_shipment_id']})
    if existing:
        raise HTTPException(400, f"Production Job sudah ada ({existing.get('job_number')})")
    parent_job_id = None
    parent_job_number = None
    if shipment.get('parent_shipment_id'):
        parent_job = await db.production_jobs.find_one({'vendor_shipment_id': shipment['parent_shipment_id']})
        if parent_job:
            parent_job_id = parent_job['id']
            parent_job_number = parent_job.get('job_number')
    ship_items = await db.vendor_shipment_items.find({'shipment_id': body['vendor_shipment_id']}).to_list(500)
    po_id = body.get('po_id') or (ship_items[0].get('po_id') if ship_items else None)
    po = await db.production_pos.find_one({'id': po_id}) if po_id else None
    job_id = new_id()
    job_seq = (await db.production_jobs.count_documents({})) + 1
    if parent_job_number:
        suffix = 'A' if shipment.get('shipment_type') == 'ADDITIONAL' else 'R'
        child_count = await db.production_jobs.count_documents({'parent_job_id': parent_job_id})
        job_number = f"{parent_job_number}-{suffix}{child_count + 1}"
    else:
        job_number = f"JOB-{str(job_seq).zfill(4)}"
    job = {
        'id': job_id, 'job_number': job_number,
        'parent_job_id': parent_job_id, 'parent_job_number': parent_job_number,
        'vendor_id': vendor_id, 'vendor_name': shipment.get('vendor_name', ''),
        'po_id': po_id, 'po_number': (po or {}).get('po_number', ''),
        'customer_name': (po or {}).get('customer_name', ''),
        'vendor_shipment_id': body['vendor_shipment_id'],
        'shipment_number': shipment.get('shipment_number'),
        'shipment_type': shipment.get('shipment_type', 'NORMAL'),
        'deadline': (po or {}).get('deadline'), 'delivery_deadline': (po or {}).get('delivery_deadline'),
        'status': 'In Progress', 'notes': body.get('notes', ''),
        'created_by': user['name'], 'created_at': now(), 'updated_at': now()
    }
    await db.production_jobs.insert_one(job)
    inspection = await db.vendor_material_inspections.find_one({'shipment_id': body['vendor_shipment_id']})
    # Pre-load parent job items for inheritance if this is a child job
    parent_job_items = []
    if parent_job_id:
        parent_job_items = await db.production_job_items.find({'job_id': parent_job_id}).to_list(500)
    inserted_items = []
    # ── Two-pass: resolve all po_item_ids first, then batch prefetch ──
    resolved_list = []
    for si in ship_items:
        resolved_po_item_id = si.get('po_item_id')
        resolved_serial = si.get('serial_number', '')
        if not resolved_po_item_id and parent_job_items:
            for pji in parent_job_items:
                if (pji.get('sku', '') == si.get('sku', '') and
                    pji.get('size', '') == si.get('size', '') and
                    pji.get('color', '') == si.get('color', '')):
                    resolved_po_item_id = pji.get('po_item_id')
                    if not resolved_serial:
                        resolved_serial = pji.get('serial_number', '')
                    break
        resolved_list.append((si, resolved_po_item_id, resolved_serial))

    # Batch fetch po_items by id
    po_item_ids_to_fetch = list({rp for _, rp, _ in resolved_list if rp})
    po_items_map = {}
    if po_item_ids_to_fetch:
        async for d in db.po_items.find({'id': {'$in': po_item_ids_to_fetch}}):
            po_items_map[d['id']] = d
    # Batch fetch inspection items (one query per inspection_id total)
    insp_items_by_si_id = {}
    insp_items_by_triple = {}
    if inspection:
        async for ii in db.vendor_material_inspection_items.find({'inspection_id': inspection['id']}):
            if ii.get('shipment_item_id'):
                insp_items_by_si_id[ii['shipment_item_id']] = ii
            triple = (ii.get('sku', ''), ii.get('size', ''), ii.get('color', ''))
            insp_items_by_triple.setdefault(triple, ii)

    for si, resolved_po_item_id, resolved_serial in resolved_list:
        po_item = po_items_map.get(resolved_po_item_id) if resolved_po_item_id else None
        available_qty = si.get('qty_sent', 0)
        if inspection:
            insp_item = insp_items_by_si_id.get(si['id'])
            if not insp_item:
                triple = (si.get('sku', ''), si.get('size', ''), si.get('color', ''))
                insp_item = insp_items_by_triple.get(triple)
            if insp_item:
                available_qty = insp_item.get('received_qty', si.get('qty_sent', 0))
        ji = {
            'id': new_id(), 'job_id': job_id, 'job_number': job_number,
            'po_item_id': resolved_po_item_id,
            'vendor_shipment_item_id': si['id'],
            'product_name': si.get('product_name', ''), 'sku': si.get('sku', ''),
            'size': si.get('size', ''), 'color': si.get('color', ''),
            'serial_number': (po_item or {}).get('serial_number', resolved_serial),
            'ordered_qty': (po_item or {}).get('qty', si.get('qty_sent', 0)),
            'shipment_qty': si.get('qty_sent', 0), 'available_qty': available_qty,
            'produced_qty': 0, 'created_at': now()
        }
        await db.production_job_items.insert_one(ji)
        inserted_items.append(ji)
    if po_id:
        current_po = await db.production_pos.find_one({'id': po_id})
        if current_po and current_po.get('status') not in ['Completed', 'Closed']:
            await db.production_pos.update_one({'id': po_id}, {'$set': {'status': 'In Production', 'updated_at': now()}})
    await log_activity(user['id'], user['name'], 'Create', 'Production Job', f"Created job {job_number}")
    result = serialize_doc(job)
    result['items'] = serialize_doc(inserted_items)
    return JSONResponse(result, status_code=201)

@router.delete("/production-jobs/{jid}")
async def delete_job(jid: str, request: Request):
    user = await require_auth(request)
    if user.get('role') != 'superadmin':
        raise HTTPException(403, 'Forbidden')
    db = get_db()
    doc = await db.production_jobs.find_one({'id': jid})
    if not doc:
        raise HTTPException(404, 'Not found')
    child_jobs = await db.production_jobs.find({'parent_job_id': jid}).to_list(500)
    for cj in child_jobs:
        await db.production_job_items.delete_many({'job_id': cj['id']})
        await db.production_progress.delete_many({'job_id': cj['id']})
        await db.production_jobs.delete_one({'id': cj['id']})
    await db.production_job_items.delete_many({'job_id': jid})
    await db.production_progress.delete_many({'job_id': jid})
    await db.production_jobs.delete_one({'id': jid})
    await log_activity(user['id'], user['name'], 'Delete', 'Production Job', f"Deleted job: {doc.get('job_number')}")
    return {'success': True}


# ─── PRODUCTION JOB ITEMS ────────────────────────────────────────────────────
@router.get("/production-job-items")
async def get_job_items(request: Request):
    await require_auth(request)
    db = get_db()
    job_id = request.query_params.get('job_id')
    if not job_id:
        raise HTTPException(400, 'job_id required')
    items = await db.production_job_items.find({'job_id': job_id}, {'_id': 0}).to_list(500)
    child_jobs = await db.production_jobs.find({'parent_job_id': job_id}).to_list(500)
    child_job_ids = [c['id'] for c in child_jobs]
    child_items_by_poi = {}
    # Also build a secondary index by sku+size+color for fallback matching
    child_items_by_sku = {}
    for cj_id in child_job_ids:
        ci = await db.production_job_items.find({'job_id': cj_id}).to_list(500)
        for c in ci:
            if c.get('po_item_id'):
                key = c['po_item_id']
                if key not in child_items_by_poi:
                    child_items_by_poi[key] = []
                child_items_by_poi[key].append(c)
            else:
                # Fallback: index by sku+size+color
                sku_key = f"{c.get('sku', '')}|{c.get('size', '')}|{c.get('color', '')}"
                if sku_key not in child_items_by_sku:
                    child_items_by_sku[sku_key] = []
                child_items_by_sku[sku_key].append(c)
    result = []
    for item in items:
        progress = await db.production_progress.find({'job_item_id': item['id']}, {'_id': 0}).sort('progress_date', -1).to_list(500)
        key = item.get('po_item_id')
        child_items = child_items_by_poi.get(key, []) if key else []
        # Fallback: match by sku+size+color if no po_item_id match found
        if not child_items:
            sku_key = f"{item.get('sku', '')}|{item.get('size', '')}|{item.get('color', '')}"
            child_items = child_items_by_sku.get(sku_key, [])
        child_produced = sum(ci.get('produced_qty', 0) for ci in child_items)
        total_produced = (item.get('produced_qty', 0)) + child_produced
        all_job_item_ids = [item['id']] + [ci['id'] for ci in child_items]
        # Search buyer shipment items by po_item_id OR by job_item_id to cover both link types
        buyer_filter_clauses = [{'job_item_id': {'$in': all_job_item_ids}}]
        if item.get('po_item_id'):
            buyer_filter_clauses.append({'po_item_id': item['po_item_id']})
        buyer_items = await db.buyer_shipment_items.find({'$or': buyer_filter_clauses}).to_list(500)
        # Deduplicate by item id to avoid double counting
        seen_ids = set()
        shipped = 0
        for b in buyer_items:
            bid = b.get('id', b.get('_id'))
            if bid not in seen_ids:
                seen_ids.add(bid)
                shipped += b.get('qty_shipped', 0)
        # Cap shippable quantity at ordered_qty (can't ship more than ordered)
        ordered_qty = item.get('ordered_qty', 0)
        shippable_produced = min(total_produced, ordered_qty) if ordered_qty > 0 else total_produced
        remaining = max(0, shippable_produced - shipped)
        result.append({**serialize_doc(item), 'progress_history': serialize_doc(progress),
                       'shipped_to_buyer': shipped, 'remaining_to_ship': remaining,
                       'child_produced_qty': child_produced, 'total_produced_qty': total_produced,
                       'shippable_produced_qty': shippable_produced})
    return result

