"""
Production: Jobs, Progress, Monitoring, Work Orders, Returns, Variances
Extracted from server.py monolith.
"""
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from database import get_db
from auth import (require_auth, check_role, log_activity, serialize_doc)
from routes.shared import new_id, now, parse_date, to_end_of_day
import logging
import re

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["production"])

# ─── PRODUCTION JOBS ─────────────────────────────────────────────────────────
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


# ─── PRODUCTION PROGRESS ─────────────────────────────────────────────────────
@router.get("/production-progress")
async def get_progress(request: Request):
    user = await require_auth(request)
    db = get_db()
    query = {}
    sp = request.query_params
    if sp.get('work_order_id'):
        query['work_order_id'] = sp['work_order_id']
    if user.get('role') == 'vendor':
        query['garment_id'] = user.get('vendor_id')
    return serialize_doc(await db.production_progress.find(query, {'_id': 0}).sort('progress_date', -1).to_list(500))

@router.post("/production-progress")
async def create_progress(request: Request):
    user = await require_auth(request)
    db = get_db()
    body = await request.json()
    if body.get('job_item_id'):
        job_item = await db.production_job_items.find_one({'id': body['job_item_id']})
        if not job_item:
            raise HTTPException(404, 'Job item tidak ditemukan')
        qty_today = int(body.get('completed_quantity', 0) or 0)
        if qty_today <= 0:
            raise HTTPException(400, 'Jumlah produksi harus lebih dari 0')
        max_qty = job_item.get('available_qty', job_item.get('shipment_qty', 0))
        new_total = (job_item.get('produced_qty', 0)) + qty_today
        if new_total > max_qty:
            raise HTTPException(400, f"Total produksi ({new_total}) melebihi material tersedia ({max_qty} pcs)")
        progress = {
            'id': new_id(), 'job_id': job_item.get('job_id'), 'job_item_id': body['job_item_id'],
            'sku': job_item.get('sku', ''), 'product_name': job_item.get('product_name', ''),
            'size': job_item.get('size', ''), 'color': job_item.get('color', ''),
            'progress_date': parse_date(body.get('progress_date')) or now(),
            'completed_quantity': qty_today, 'notes': body.get('notes', ''),
            'recorded_by': user['name'], 'created_at': now()
        }
        await db.production_progress.insert_one(progress)
        await db.production_job_items.update_one({'id': body['job_item_id']}, {'$set': {'produced_qty': new_total, 'updated_at': now()}})
        all_items = await db.production_job_items.find({'job_id': job_item['job_id']}).to_list(500)
        all_done = all(
            (new_total if i['id'] == body['job_item_id'] else i.get('produced_qty', 0)) >= i.get('shipment_qty', 0)
            for i in all_items
        )
        if all_done:
            await db.production_jobs.update_one({'id': job_item['job_id']}, {'$set': {'status': 'Completed', 'updated_at': now()}})
        await log_activity(user['id'], user['name'], 'Create', 'Production Progress', f"Progress {job_item.get('sku')}: +{qty_today}")
        result = serialize_doc(progress)
        result['new_total'] = new_total
        return JSONResponse(result, status_code=201)
    # Legacy: work_order_id
    wo = await db.work_orders.find_one({'id': body.get('work_order_id')})
    if not wo:
        raise HTTPException(404, 'Work order tidak ditemukan')
    progress = {
        'id': new_id(), 'work_order_id': body['work_order_id'],
        'distribution_code': wo.get('distribution_code'),
        'garment_id': wo.get('garment_id'), 'garment_name': wo.get('garment_name'),
        'po_id': wo.get('po_id'), 'po_number': wo.get('po_number'),
        'progress_date': parse_date(body.get('progress_date')) or now(),
        'completed_quantity': int(body.get('completed_quantity', 0)),
        'notes': body.get('notes', ''), 'recorded_by': user['name'], 'created_at': now()
    }
    await db.production_progress.insert_one(progress)
    all_prog = await db.production_progress.find({'work_order_id': body['work_order_id']}).to_list(500)
    total_completed = sum(p.get('completed_quantity', 0) for p in all_prog)
    new_status = 'Completed' if total_completed >= wo.get('quantity', 0) else 'In Progress'
    await db.work_orders.update_one({'id': body['work_order_id']}, {'$set': {'completed_quantity': total_completed, 'status': new_status, 'updated_at': now()}})
    await db.production_pos.update_one({'id': wo.get('po_id')}, {'$set': {'status': 'In Production', 'updated_at': now()}})
    return JSONResponse(serialize_doc(progress), status_code=201)


# ─── PRODUCTION MONITORING V2 ────────────────────────────────────────────────
@router.get("/production-monitoring-v2")
async def production_monitoring(request: Request):
    """Vendor-level monitoring summary with nested parent/child job rollups.

    ════════════════════════════════════════════════════════════════════════
    ⚠️  TECHNICAL DEBT — N+1 QUERIES (intentionally not refactored)
    ════════════════════════════════════════════════════════════════════════
    **Status**: ~8 N+1 patterns remain (audit Phase 3).
    **Why NOT fixed by prefetch pattern**:
      1. Quadruple-nested loops: vendor → parent_jobs → job_items →
         child_jobs → child_job_items. Each level has 2-3 find_one calls
         for enrichment (po_item details, buyer shipments, progress).
      2. Child-job-items have no explicit parent_po_item_id link — they
         match via parent_job_items by (sku, size, color) triple.
         Batch-prefetching this requires Cartesian $in expansion across
         all parent scope (potentially 1000s of triples for large vendors).
      3. Business logic mixes aggregation (sum produced) with filtering
         (skip orphans already counted) in the same loop — not a pure
         aggregation problem.

    **Recommended future rewrite**:
      - Replace with 2-stage aggregation pipeline:
        Stage A: `$lookup` parent_jobs → job_items → child_jobs → child_job_items
                  with `$unwind` to flatten, then `$group` by vendor.
        Stage B: Enrich with buyer_shipment_items & inspection data via
                  additional `$lookup` on flat result set.
      - Alternative: materialized view (refresh every N minutes) if this
        endpoint is dashboard-polled frequently.
      - Effort: ~1-2 days with fixture-based regression.

    **Impact if deferred**: Low-medium. Dashboard endpoint — users tolerate
    2-5s load. Index on `production_jobs.vendor_id` + `.parent_job_id`
    already helps significantly (added in Phase 6).

    **Owner**: Refactoring squad (next sprint window).
    """
    await require_auth(request)
    db = get_db()
    sp = request.query_params
    g_query = {'status': 'active'}
    if sp.get('vendor_id'):
        g_query['id'] = sp['vendor_id']
    garments = await db.garments.find(g_query, {'_id': 0}).to_list(500)
    result = []
    for g in garments:
        parent_jobs = await db.production_jobs.find({
            'vendor_id': g['id'],
            '$or': [{'parent_job_id': None}, {'parent_job_id': ''}, {'parent_job_id': {'$exists': False}}]
        }, {'_id': 0}).sort('created_at', -1).to_list(500)
        if not parent_jobs:
            continue
        all_job_items = []
        for job in parent_jobs:
            items = await db.production_job_items.find({'job_id': job['id']}, {'_id': 0}).to_list(500)
            child_jobs = await db.production_jobs.find({'parent_job_id': job['id']}).to_list(500)
            for item in items:
                child_produced = 0
                child_job_item_ids = []
                for cj in child_jobs:
                    cji = None
                    if item.get('po_item_id'):
                        cji = await db.production_job_items.find_one({'job_id': cj['id'], 'po_item_id': item['po_item_id']})
                    # Fallback: match by sku+size+color
                    if not cji:
                        cji = await db.production_job_items.find_one({
                            'job_id': cj['id'], 'sku': item.get('sku', ''),
                            'size': item.get('size', ''), 'color': item.get('color', '')
                        })
                    if cji:
                        child_produced += cji.get('produced_qty', 0)
                        child_job_item_ids.append(cji['id'])
                total_prod = (item.get('produced_qty', 0)) + child_produced
                # Get shipped to buyer for this item
                shipped_to_buyer = 0
                all_item_ids = [item['id']] + child_job_item_ids
                buyer_clauses = [{'job_item_id': {'$in': all_item_ids}}]
                if item.get('po_item_id'):
                    buyer_clauses.append({'po_item_id': item['po_item_id']})
                buyer_items = await db.buyer_shipment_items.find({'$or': buyer_clauses}).to_list(500)
                seen_bids = set()
                for bi in buyer_items:
                    bid = bi.get('id', bi.get('_id'))
                    if bid not in seen_bids:
                        seen_bids.add(bid)
                        shipped_to_buyer += bi.get('qty_shipped', 0)
                all_job_items.append({**item, 'total_produced_qty': total_prod, 'shipped_to_buyer_qty': shipped_to_buyer, 'job': job})
        total_qty = sum(i.get('ordered_qty', 0) for i in all_job_items)
        total_produced_raw = sum(i.get('total_produced_qty', 0) for i in all_job_items)
        total_produced = min(total_produced_raw, total_qty) if total_qty > 0 else total_produced_raw
        total_shipped_to_buyer = sum(i.get('shipped_to_buyer_qty', 0) for i in all_job_items)
        pct = min(100, round((total_produced_raw / total_qty * 100) if total_qty > 0 else 0))
        result.append({
            'vendor_id': g['id'], 'vendor_name': g.get('garment_name'),
            'vendor_code': g.get('garment_code'), 'location': g.get('location', ''),
            'total_jobs': len(parent_jobs), 'total_qty': total_qty,
            'total_produced': total_produced, 'total_shipped_to_buyer': total_shipped_to_buyer,
            'progress_pct': pct,
            'jobs_by_status': {
                'in_progress': len([j for j in parent_jobs if j.get('status') == 'In Progress']),
                'completed': len([j for j in parent_jobs if j.get('status') == 'Completed'])
            }
        })
    return result


# ─── DISTRIBUSI KERJA ────────────────────────────────────────────────────────
@router.get("/distribusi-kerja")
async def distribusi_kerja(request: Request):
    await require_auth(request)
    db = get_db()
    sp = request.query_params
    # Get all POs (or filtered by vendor)
    po_query = {}
    if sp.get('vendor_id'):
        po_query['vendor_id'] = sp['vendor_id']
    if sp.get('po_id'):
        po_query['id'] = sp['po_id']
    pos = await db.production_pos.find(po_query, {'_id': 0}).sort('created_at', -1).to_list(500)
    flat_rows = []
    if not pos:
        return {'vendors': []}

    # ── Batch prefetch maps to eliminate triple-nested N+1 ──
    po_ids = [po['id'] for po in pos]
    items_by_po = {}
    async for it in db.po_items.find({'po_id': {'$in': po_ids}}):
        items_by_po.setdefault(it['po_id'], []).append(it)
    all_items = [it for arr in items_by_po.values() for it in arr]
    all_item_ids = [it['id'] for it in all_items]

    # Vendor shipment items grouped by po_item_id
    vsi_by_poi = {}
    if all_item_ids:
        async for s in db.vendor_shipment_items.find({'po_item_id': {'$in': all_item_ids}}):
            vsi_by_poi.setdefault(s['po_item_id'], []).append(s)
    # Inspections by shipment_id
    ship_ids = list({s.get('shipment_id') for arr in vsi_by_poi.values() for s in arr if s.get('shipment_id')})
    insp_by_ship = {}
    if ship_ids:
        async for ins in db.vendor_material_inspections.find({'shipment_id': {'$in': ship_ids}}):
            insp_by_ship[ins.get('shipment_id')] = ins
    # Inspection items keyed by (inspection_id, shipment_item_id)
    insp_ids = [i['id'] for i in insp_by_ship.values()]
    insp_items_lookup = {}
    if insp_ids:
        async for ii in db.vendor_material_inspection_items.find({'inspection_id': {'$in': insp_ids}}):
            insp_items_lookup[(ii.get('inspection_id'), ii.get('shipment_item_id'))] = ii
    # Job items by po_item_id
    ji_by_poi = {}
    if all_item_ids:
        async for j in db.production_job_items.find({'po_item_id': {'$in': all_item_ids}}):
            ji_by_poi.setdefault(j['po_item_id'], []).append(j)
    # Orphan job items by (sku, size, color)
    triples = list({(it.get('sku', ''), it.get('size', ''), it.get('color', '')) for it in all_items})
    orphan_lookup = {}
    if triples:
        skus = list({t[0] for t in triples})
        sizes = list({t[1] for t in triples})
        colors = list({t[2] for t in triples})
        async for oji in db.production_job_items.find({
            '$or': [{'po_item_id': None}, {'po_item_id': ''}, {'po_item_id': {'$exists': False}}],
            'sku': {'$in': skus}, 'size': {'$in': sizes}, 'color': {'$in': colors},
        }):
            key = (oji.get('sku', ''), oji.get('size', ''), oji.get('color', ''))
            orphan_lookup.setdefault(key, []).append(oji)

    # Buyer shipment items: by po_item_id OR job_item_id (both indexes hit)
    bsi_by_poi = {}
    bsi_by_jiid = {}
    if all_item_ids:
        # Single $in over po_item_id (covers buyer items linked via po_item_id)
        async for b in db.buyer_shipment_items.find({'po_item_id': {'$in': all_item_ids}}):
            bsi_by_poi.setdefault(b.get('po_item_id'), []).append(b)
    # Build candidate ji_ids (own + orphan, deduped)
    all_ji_ids = []
    for arr in ji_by_poi.values():
        all_ji_ids.extend(j['id'] for j in arr)
    for arr in orphan_lookup.values():
        all_ji_ids.extend(j['id'] for j in arr)
    if all_ji_ids:
        async for b in db.buyer_shipment_items.find({'job_item_id': {'$in': list(set(all_ji_ids))}}):
            bsi_by_jiid.setdefault(b.get('job_item_id'), []).append(b)

    for po in pos:
        for pi in items_by_po.get(po['id'], []):
            all_ship_items = vsi_by_poi.get(pi['id'], [])
            total_received = 0
            total_sent = 0
            total_missing = 0
            for si in all_ship_items:
                total_sent += si.get('qty_sent', 0)
                insp = insp_by_ship.get(si.get('shipment_id'))
                if insp:
                    ii = insp_items_lookup.get((insp['id'], si['id']))
                    if ii:
                        total_received += ii.get('received_qty', 0)
                        total_missing += ii.get('missing_qty', 0)
            ji_list = ji_by_poi.get(pi['id'], [])
            produced_qty = sum(j.get('produced_qty', 0) for j in ji_list)
            triple_key = (pi.get('sku', ''), pi.get('size', ''), pi.get('color', ''))
            already_counted_ids = {j['id'] for j in ji_list}
            orphan_for_item = []
            for oji in orphan_lookup.get(triple_key, []):
                if oji['id'] not in already_counted_ids:
                    produced_qty += oji.get('produced_qty', 0)
                    orphan_for_item.append(oji)
            # Buyer shipped: union by id of (po_item_id-matched ∪ job_item_id-matched)
            buyer_items = list(bsi_by_poi.get(pi['id'], []))
            seen_bi_ids = {b.get('id') for b in buyer_items if b.get('id')}
            relevant_ji_ids = [j['id'] for j in ji_list] + [j['id'] for j in orphan_for_item]
            for jid in relevant_ji_ids:
                for b in bsi_by_jiid.get(jid, []):
                    bid = b.get('id')
                    if bid and bid not in seen_bi_ids:
                        seen_bi_ids.add(bid)
                        buyer_items.append(b)
            shipped_to_buyer_qty = sum(b.get('qty_shipped', 0) for b in buyer_items)

            ordered_qty = pi.get('qty', 0)
            capped_produced = min(produced_qty, ordered_qty) if ordered_qty > 0 else produced_qty
            progress_pct = min(100, round((produced_qty / ordered_qty * 100) if ordered_qty > 0 else 0))
            flat_rows.append({
                'id': pi['id'], 'po_item_id': pi['id'],
                'vendor_id': po.get('vendor_id'), 'vendor_name': po.get('vendor_name', ''),
                'po_id': po['id'], 'po_number': po.get('po_number', ''),
                'po_date': serialize_doc(po.get('created_at')),
                'customer_name': po.get('customer_name', ''),
                'serial_number': pi.get('serial_number', ''),
                'product_name': pi.get('product_name', ''), 'sku': pi.get('sku', ''),
                'size': pi.get('size', ''), 'color': pi.get('color', ''),
                'ordered_qty': ordered_qty, 'shipment_qty': total_sent,
                'received_qty': total_received, 'produced_qty': capped_produced,
                'missing_qty': total_missing,
                'shipped_to_buyer_qty': shipped_to_buyer_qty,
                'shipped_to_buyer': shipped_to_buyer_qty,
                'progress_pct': progress_pct,
            })
    # Build hierarchy
    vendor_map = {}
    for row in flat_rows:
        vid = row.get('vendor_id')
        if vid not in vendor_map:
            vendor_map[vid] = {'vendor_id': vid, 'vendor_name': row.get('vendor_name'),
                               'total_ordered': 0, 'total_received': 0, 'total_produced': 0, 'total_shipped_to_buyer': 0, 'total_missing': 0, 'pos': {}}
        vm = vendor_map[vid]
        vm['total_ordered'] += row.get('ordered_qty', 0)
        vm['total_received'] += row.get('received_qty', 0)
        vm['total_produced'] += row.get('produced_qty', 0)
        vm['total_shipped_to_buyer'] += row.get('shipped_to_buyer_qty', 0)
        vm['total_missing'] += row.get('missing_qty', 0)
        po_key = row.get('po_id', 'unknown')
        if po_key not in vm['pos']:
            vm['pos'][po_key] = {'po_id': row.get('po_id'), 'po_number': row.get('po_number'),
                                  'customer_name': row.get('customer_name'),
                                  'total_ordered': 0, 'total_received': 0, 'total_produced': 0, 'total_shipped_to_buyer': 0, 'total_missing': 0, 'serials': {}}
        pm = vm['pos'][po_key]
        pm['total_ordered'] += row.get('ordered_qty', 0)
        pm['total_received'] += row.get('received_qty', 0)
        pm['total_produced'] += row.get('produced_qty', 0)
        pm['total_shipped_to_buyer'] += row.get('shipped_to_buyer_qty', 0)
        pm['total_missing'] += row.get('missing_qty', 0)
        sn = row.get('serial_number', '__no_serial__')
        if sn not in pm['serials']:
            pm['serials'][sn] = {'serial_number': row.get('serial_number', ''),
                                  'total_ordered': 0, 'total_received': 0, 'total_produced': 0, 'total_shipped_to_buyer': 0, 'total_missing': 0, 'skus': []}
        sm = pm['serials'][sn]
        sm['total_ordered'] += row.get('ordered_qty', 0)
        sm['total_received'] += row.get('received_qty', 0)
        sm['total_produced'] += row.get('produced_qty', 0)
        sm['total_shipped_to_buyer'] += row.get('shipped_to_buyer_qty', 0)
        sm['total_missing'] += row.get('missing_qty', 0)
        sm['skus'].append(row)
    hierarchy = []
    for vm in vendor_map.values():
        vm['progress_pct'] = min(100, round((vm['total_produced'] / vm['total_ordered'] * 100) if vm['total_ordered'] > 0 else 0))
        vm['total_shipped'] = vm['total_shipped_to_buyer']  # alias for frontend
        pos_list = []
        for pm in vm['pos'].values():
            pm['progress_pct'] = min(100, round((pm['total_produced'] / pm['total_ordered'] * 100) if pm['total_ordered'] > 0 else 0))
            pm['total_shipped'] = pm['total_shipped_to_buyer']  # alias for frontend
            serials_list = []
            for sm in pm['serials'].values():
                sm['progress_pct'] = min(100, round((sm['total_produced'] / sm['total_ordered'] * 100) if sm['total_ordered'] > 0 else 0))
                sm['total_shipped'] = sm['total_shipped_to_buyer']  # alias for frontend
                serials_list.append(sm)
            pm['serials'] = serials_list
            pos_list.append(pm)
        vm['pos'] = pos_list
        hierarchy.append(vm)
    return {'hierarchy': hierarchy, 'flat': flat_rows, 'invalid_records': []}


# ─── WORK ORDERS ─────────────────────────────────────────────────────────────
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
@router.post("/production-variances")
async def create_variance(request: Request):
    """Vendor reports overproduction or underproduction for a job/item"""
    user = await require_auth(request)
    db = get_db()
    body = await request.json()
    
    # Get vendor_id from user context if vendor role
    vendor_id = user.get('vendor_id') if user.get('role') == 'vendor' else body.get('vendor_id')
    if not vendor_id:
        raise HTTPException(400, 'vendor_id required')
    
    # Validate job exists
    job_id = body.get('job_id')
    if not job_id:
        raise HTTPException(400, 'job_id required')
    job = await db.production_jobs.find_one({'id': job_id})
    if not job:
        raise HTTPException(404, 'Job not found')
    if job.get('vendor_id') != vendor_id:
        raise HTTPException(403, 'Job does not belong to this vendor')
    
    # Get PO info
    po_id = job.get('po_id') or body.get('po_id')
    po = await db.production_pos.find_one({'id': po_id}) if po_id else None
    po_number = po.get('po_number', '') if po else ''
    
    variance_type = body.get('variance_type')  # 'OVERPRODUCTION' or 'UNDERPRODUCTION'
    if variance_type not in ['OVERPRODUCTION', 'UNDERPRODUCTION']:
        raise HTTPException(400, 'variance_type must be OVERPRODUCTION or UNDERPRODUCTION')
    
    # Create variance record
    variance = {
        'id': new_id(),
        'vendor_id': vendor_id,
        'vendor_name': job.get('vendor_name', ''),
        'job_id': job_id,
        'job_number': job.get('job_number', ''),
        'po_id': po_id,
        'po_number': po_number,
        'variance_type': variance_type,
        'reason': body.get('reason', ''),
        'notes': body.get('notes', ''),
        'items': body.get('items', []),  # Array of {job_item_id, product_name, sku, ordered_qty, produced_qty, variance_qty}
        'total_variance_qty': sum(int(item.get('variance_qty', 0) or 0) for item in body.get('items', [])),
        'reported_by': user['name'],
        'status': 'Reported',  # Reported, Acknowledged, Resolved
        'created_at': now(),
        'updated_at': now()
    }
    
    await db.production_variances.insert_one(variance)
    await log_activity(user['id'], user['name'], 'Create', 'Production Variance',
                      f"Reported {variance_type} for job {job.get('job_number')}: {variance['total_variance_qty']} pcs")
    
    return JSONResponse(serialize_doc(variance), status_code=201)

@router.get("/production-variances")
async def get_variances(request: Request):
    """List production variances with filters"""
    user = await require_auth(request)
    db = get_db()
    sp = request.query_params
    
    query = {}
    
    # Vendor filter (auto for vendor role, optional for admin)
    if user.get('role') == 'vendor':
        query['vendor_id'] = user.get('vendor_id')
    elif sp.get('vendor_id'):
        query['vendor_id'] = sp['vendor_id']
    
    # Type filter
    if sp.get('variance_type'):
        query['variance_type'] = sp['variance_type']
    
    # Status filter
    if sp.get('status'):
        query['status'] = sp['status']
    
    # Date range filter
    date_from = parse_date(sp.get('from'))
    date_to = to_end_of_day(sp.get('to'))
    if date_from or date_to:
        date_filter = {}
        if date_from:
            date_filter['$gte'] = date_from
        if date_to:
            date_filter['$lte'] = date_to
        if date_filter:
            query['created_at'] = date_filter
    
    # Search
    search = sp.get('search')
    if search:
        query['$or'] = [
            {'job_number': {'$regex': re.escape(search), '$options': 'i'}},
            {'po_number': {'$regex': re.escape(search), '$options': 'i'}},
            {'vendor_name': {'$regex': re.escape(search), '$options': 'i'}},
            {'reason': {'$regex': re.escape(search), '$options': 'i'}}
        ]
    
    variances = await db.production_variances.find(query, {'_id': 0}).sort('created_at', -1).to_list(500)
    return serialize_doc(variances)

@router.get("/production-variances/stats")
async def get_variance_stats(request: Request):
    """Get summary statistics for production variances"""
    user = await require_auth(request)
    db = get_db()
    sp = request.query_params
    
    query = {}
    
    # Vendor filter
    if user.get('role') == 'vendor':
        query['vendor_id'] = user.get('vendor_id')
    elif sp.get('vendor_id'):
        query['vendor_id'] = sp['vendor_id']
    
    # Date range filter
    date_from = parse_date(sp.get('from'))
    date_to = to_end_of_day(sp.get('to'))
    if date_from or date_to:
        date_filter = {}
        if date_from:
            date_filter['$gte'] = date_from
        if date_to:
            date_filter['$lte'] = date_to
        if date_filter:
            query['created_at'] = date_filter
    
    # Aggregate stats
    all_variances = await db.production_variances.find(query, {'_id': 0}).to_list(500)
    
    overproduction = [v for v in all_variances if v.get('variance_type') == 'OVERPRODUCTION']
    underproduction = [v for v in all_variances if v.get('variance_type') == 'UNDERPRODUCTION']
    
    stats = {
        'total_records': len(all_variances),
        'overproduction': {
            'count': len(overproduction),
            'total_qty': sum(v.get('total_variance_qty', 0) for v in overproduction)
        },
        'underproduction': {
            'count': len(underproduction),
            'total_qty': sum(v.get('total_variance_qty', 0) for v in underproduction)
        },
        'by_status': {},
        'by_vendor': {}
    }
    
    # Group by status
    for v in all_variances:
        status = v.get('status', 'Unknown')
        if status not in stats['by_status']:
            stats['by_status'][status] = 0
        stats['by_status'][status] += 1
    
    # Group by vendor
    for v in all_variances:
        vname = v.get('vendor_name', 'Unknown')
        if vname not in stats['by_vendor']:
            stats['by_vendor'][vname] = {'overproduction': 0, 'underproduction': 0, 'total_qty': 0}
        stats['by_vendor'][vname][v.get('variance_type', '').lower()] += 1
        stats['by_vendor'][vname]['total_qty'] += v.get('total_variance_qty', 0)
    
    return stats

@router.put("/production-variances/{vid}")
async def update_variance_status(vid: str, request: Request):
    """Admin updates variance status (Acknowledged/Resolved)"""
    user = await require_auth(request)
    if not check_role(user, ['admin']):
        raise HTTPException(403, 'Forbidden')
    db = get_db()
    body = await request.json()
    
    variance = await db.production_variances.find_one({'id': vid})
    if not variance:
        raise HTTPException(404, 'Variance not found')
    
    await db.production_variances.update_one({'id': vid}, {'$set': {
        'status': body.get('status', variance.get('status')),
        'admin_notes': body.get('admin_notes', ''),
        'updated_by': user['name'],
        'updated_at': now()
    }})
    
    await log_activity(user['id'], user['name'], 'Update', 'Production Variance',
                      f"Updated variance status to {body.get('status')} for {variance.get('job_number')}")
    
    return {'success': True}

