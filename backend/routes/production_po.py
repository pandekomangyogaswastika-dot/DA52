"""
Production PO, PO Items, PO Status, PO Accessories
Extracted from server.py monolith.
"""
# ruff: noqa: E402, F811
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from database import get_db
from auth import (require_auth, check_role, log_activity, serialize_doc)
from routes.shared import new_id, now, parse_date, PO_STATUSES, enrich_with_product_photos
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["production_po"])

from utils.cascade_delete import cascade_delete_po  # P1 refactor: moved to utils/ (was backend root)
from utils.batch_query import prefetch_map, prefetch_group
import re

async def enrich_with_product_photos(items, db):
    """Add product photo_url to items that have a product_name. Single batch query."""
    if not items:
        return items
    pnames = list({(it.get('product_name') or '').strip() for it in items if it.get('product_name')})
    photos = {}
    if pnames:
        prods = await db.products.find(
            {'product_name': {'$in': pnames}}, {'_id': 0, 'product_name': 1, 'photo_url': 1}
        ).to_list(500)
        photos = {p['product_name']: p.get('photo_url', '') for p in prods}
    for item in items:
        if item.get('product_name'):
            item['product_photo'] = photos.get(item['product_name'], '')
    return items


# ─── PRODUCTION POs ──────────────────────────────────────────────────────────
@router.get("/production-pos")
async def get_pos(request: Request):
    await require_auth(request)
    db = get_db()
    sp = request.query_params
    query = {}
    search = sp.get('search')
    status = sp.get('status')
    if search:
        query['$or'] = [{'po_number': {'$regex': re.escape(search), '$options': 'i'}}, {'customer_name': {'$regex': re.escape(search), '$options': 'i'}}]
    if status:
        query['status'] = status

    # Support both paginated and full-list modes (backward compatible)
    if sp.get('page') or sp.get('limit'):
        from routes.shared import get_pagination_params, paginated_response
        page, limit, skip = get_pagination_params(request, default_limit=30)
        total = await db.production_pos.count_documents(query)
        pos = await db.production_pos.find(query, {'_id': 0}).sort('created_at', -1).skip(skip).limit(limit).to_list(limit)
    else:
        total = None
        pos = await db.production_pos.find(query, {'_id': 0}).sort('created_at', -1).to_list(500)

    if not pos:
        return paginated_response([], 0, 1, 30) if total is not None else []

    # ── Batch prefetch: po_items, po_accessories, buyer_shipment_items ──
    po_ids = [po['id'] for po in pos]
    items_by_po = await prefetch_group(db.po_items, 'po_id', po_ids)
    acc_by_po = await prefetch_group(db.po_accessories, 'po_id', po_ids)
    # All po_item_ids across all POs → single $in query for buyer shipments
    all_item_ids = [it['id'] for arr in items_by_po.values() for it in arr]
    bsi_by_item = await prefetch_group(db.buyer_shipment_items, 'po_item_id', all_item_ids)

    result = []
    for po in pos:
        items = items_by_po.get(po['id'], [])
        po_accessories = acc_by_po.get(po['id'], [])
        serial_numbers = list(set(i.get('serial_number', '') for i in items if i.get('serial_number')))
        created = po.get('created_at')
        date_str = ''
        if created:
            if isinstance(created, datetime):
                date_str = created.strftime('%d/%m/%Y')
            else:
                date_str = str(created)[:10]
        composite_label = f"{po.get('po_number', '')} | {po.get('vendor_name', '')} | {date_str}"

        total_ordered = sum(i.get('qty', 0) for i in items)
        total_shipped = 0
        for item in items:
            for bi in bsi_by_item.get(item['id'], []):
                total_shipped += bi.get('qty_shipped', 0)
        remaining_qty_to_ship = total_ordered - total_shipped

        result.append({**serialize_doc(po), 'items': serialize_doc(items), 'item_count': len(items),
                       'total_qty': total_ordered,
                       'total_shipped_to_buyer': total_shipped,
                       'remaining_qty_to_ship': remaining_qty_to_ship,
                       'serial_numbers': serial_numbers, 'composite_label': composite_label,
                       'po_accessories': serialize_doc(po_accessories),
                       'po_accessories_count': len(po_accessories)})
    if total is not None:
        from routes.shared import paginated_response as pr
        return pr(result, total, page, limit)
    return result

@router.get("/production-pos/{po_id}")
async def get_po(po_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    po = await db.production_pos.find_one({'id': po_id}, {'_id': 0})
    if not po:
        raise HTTPException(404, 'Not found')
    items = await db.po_items.find({'po_id': po_id}, {'_id': 0}).to_list(500)
    wos = await db.work_orders.find({'po_id': po_id}, {'_id': 0}).to_list(500)
    po_accessories = await db.po_accessories.find({'po_id': po_id}, {'_id': 0}).sort('created_at', 1).to_list(500)
    items = await enrich_with_product_photos(items, db)
    result = serialize_doc(po)
    result['items'] = serialize_doc(items)
    result['distributions'] = serialize_doc(wos)
    result['po_accessories'] = serialize_doc(po_accessories)
    return result

@router.post("/production-pos")
async def create_po(request: Request):
    user = await require_auth(request)
    if not check_role(user, ['admin']):
        raise HTTPException(403, 'Forbidden')
    db = get_db()
    body = await request.json()
    if not body.get('po_number'):
        raise HTTPException(400, 'Nomor PO wajib diisi')
    vendor_name = ''
    if body.get('vendor_id'):
        vendor_doc = await db.garments.find_one({'id': body['vendor_id']})
        vendor_name = vendor_doc.get('garment_name', '') if vendor_doc else ''
    po_id = new_id()
    initial_status = 'Confirmed' if body.get('status') == 'Confirmed' else 'Draft'
    # Resolve buyer name from buyer_id if provided
    customer_name = body.get('customer_name', '')
    buyer_id = body.get('buyer_id')
    if buyer_id:
        buyer_doc = await db.buyers.find_one({'id': buyer_id})
        if buyer_doc:
            customer_name = buyer_doc.get('buyer_name', customer_name)
    po = {
        'id': po_id, 'po_number': body['po_number'], 'customer_name': customer_name,
        'buyer_id': buyer_id,
        'vendor_id': body.get('vendor_id'), 'vendor_name': vendor_name,
        'po_date': parse_date(body.get('po_date')) or now(),
        'deadline': parse_date(body.get('deadline')),
        'delivery_deadline': parse_date(body.get('delivery_deadline')),
        'status': initial_status, 'notes': body.get('notes', ''),
        'created_by': user['name'], 'created_at': now(), 'updated_at': now()
    }
    await db.production_pos.insert_one(po)
    items_data = body.get('items', [])
    inserted_items = []
    # Batch fetch variants & products
    var_ids = list({i.get('variant_id') for i in items_data if i.get('variant_id')})
    prod_ids = list({i.get('product_id') for i in items_data if i.get('product_id')})
    var_map = {}
    if var_ids:
        async for d in db.product_variants.find({'id': {'$in': var_ids}}, {'_id': 0}):
            var_map[d['id']] = d
    prod_map = {}
    if prod_ids:
        async for d in db.products.find({'id': {'$in': prod_ids}}, {'_id': 0}):
            prod_map[d['id']] = d
    for item in items_data:
        variant = var_map.get(item.get('variant_id'))
        product = prod_map.get(item.get('product_id'))
        po_item = {
            'id': new_id(), 'po_id': po_id, 'po_number': body['po_number'],
            'product_id': item.get('product_id'), 'product_name': (product or {}).get('product_name', ''),
            'variant_id': item.get('variant_id'), 'size': (variant or {}).get('size', item.get('size', '')),
            'color': (variant or {}).get('color', item.get('color', '')),
            'sku': (variant or {}).get('sku', item.get('sku', '')),
            'qty': int(item.get('qty', 0) or 0), 'serial_number': item.get('serial_number', ''),
            'selling_price_snapshot': float(item.get('selling_price_snapshot', 0) or (product or {}).get('selling_price', 0) or 0),
            'cmt_price_snapshot': float(item.get('cmt_price_snapshot', 0) or (product or {}).get('cmt_price', 0) or 0),
            'created_at': now()
        }
        await db.po_items.insert_one(po_item)
        inserted_items.append(po_item)
    await log_activity(user['id'], user['name'], 'Create', 'Production PO', f"Created PO: {po['po_number']} with {len(items_data)} items")
    result = serialize_doc(po)
    result['items'] = serialize_doc(inserted_items)
    return JSONResponse(result, status_code=201)

@router.post("/production-pos/{po_id}/close")
async def close_po(po_id: str, request: Request):
    user = await require_auth(request)
    if not check_role(user, ['admin']):
        raise HTTPException(403, 'Forbidden')
    db = get_db()
    body = await request.json()
    po = await db.production_pos.find_one({'id': po_id})
    if not po:
        raise HTTPException(404, 'PO not found')
    await db.production_pos.update_one({'id': po_id}, {'$set': {
        'status': 'Closed', 'close_reason': body.get('close_reason'),
        'close_notes': body.get('close_notes', ''), 'closed_by': user['name'],
        'closed_at': now(), 'updated_at': now()
    }})
    await log_activity(user['id'], user['name'], 'Close PO', 'Production PO', f"Closed PO: {po.get('po_number')}")
    return {'success': True}

@router.put("/production-pos/{po_id}")
async def update_po(po_id: str, request: Request):
    user = await require_auth(request)
    if not check_role(user, ['admin']):
        raise HTTPException(403, 'Forbidden')
    db = get_db()
    existing = await db.production_pos.find_one({'id': po_id})
    if not existing:
        raise HTTPException(404, 'PO not found')
    if existing.get('status') == 'Closed' and user.get('role') != 'superadmin':
        raise HTTPException(403, 'PO ini sudah Closed.')
    body = await request.json()
    body.pop('_id', None)
    body.pop('id', None)
    body.pop('items', None)
    if body.get('deadline'):
        body['deadline'] = parse_date(body['deadline'])
    if body.get('delivery_deadline'):
        body['delivery_deadline'] = parse_date(body['delivery_deadline'])
    if body.get('po_date'):
        body['po_date'] = parse_date(body['po_date'])
    if body.get('vendor_id'):
        vd = await db.garments.find_one({'id': body['vendor_id']})
        body['vendor_name'] = vd.get('garment_name', '') if vd else ''
    await db.production_pos.update_one({'id': po_id}, {'$set': {**body, 'updated_at': now()}})
    await log_activity(user['id'], user['name'], 'Update', 'Production PO', f"Updated PO: {existing.get('po_number')}")
    return serialize_doc(await db.production_pos.find_one({'id': po_id}, {'_id': 0}))

@router.delete("/production-pos/{po_id}")
async def delete_po(po_id: str, request: Request):
    user = await require_auth(request)
    if user.get('role') != 'superadmin':
        raise HTTPException(403, 'Forbidden')
    db = get_db()
    doc = await db.production_pos.find_one({'id': po_id})
    if not doc:
        raise HTTPException(404, 'Not found')
    await cascade_delete_po(po_id)
    await log_activity(user['id'], user['name'], 'Delete', 'Production PO', f"Cascade deleted PO: {doc.get('po_number')}")
    return {'success': True}

# ─── PO ITEMS ────────────────────────────────────────────────────────────────
@router.get("/po-items")
async def get_po_items(request: Request):
    await require_auth(request)
    db = get_db()
    query = {}
    po_id = request.query_params.get('po_id')
    if po_id:
        query['po_id'] = po_id
    return serialize_doc(await db.po_items.find(query, {'_id': 0}).sort('created_at', 1).to_list(500))

@router.get("/po-items-produced")
async def get_po_items_produced(request: Request):
    await require_auth(request)
    db = get_db()
    po_id = request.query_params.get('po_id')
    if not po_id:
        raise HTTPException(400, 'po_id wajib diisi')
    po_items = await db.po_items.find({'po_id': po_id}, {'_id': 0}).sort('created_at', 1).to_list(500)
    if not po_items:
        return []

    # ── Batch prefetch by po_item_id ──
    item_ids = [it['id'] for it in po_items]
    ji_by_item = await prefetch_group(db.production_job_items, 'po_item_id', item_ids)
    ret_by_item = await prefetch_group(db.production_return_items, 'po_item_id', item_ids)
    bsi_by_item = await prefetch_group(db.buyer_shipment_items, 'po_item_id', item_ids)

    # Parent jobs (one query for all referenced job_ids)
    job_ids = list({ji.get('job_id') for arr in ji_by_item.values() for ji in arr if ji.get('job_id')})
    jobs_by_id = await prefetch_map(db.production_jobs, job_ids)

    # Child jobs (jobs whose parent_job_id is in our parent set) — single query
    child_jobs_by_parent = await prefetch_group(db.production_jobs, 'parent_job_id', list(jobs_by_id.keys()))
    # Child job_items keyed by (job_id, po_item_id) — load all in one query
    child_job_ids = [cj['id'] for arr in child_jobs_by_parent.values() for cj in arr]
    child_ji_by_job = await prefetch_group(db.production_job_items, 'job_id', child_job_ids)

    enriched = []
    for item in po_items:
        item_id = item['id']
        job_items = ji_by_item.get(item_id, [])
        total_produced = sum(ji.get('produced_qty', 0) for ji in job_items)
        # Add produced from child jobs of each parent job
        for ji in job_items:
            parent_id = ji.get('job_id')
            if not parent_id or parent_id not in jobs_by_id:
                continue
            for cj in child_jobs_by_parent.get(parent_id, []):
                for cji in child_ji_by_job.get(cj['id'], []):
                    if cji.get('po_item_id') == item_id:
                        total_produced += cji.get('produced_qty', 0)
        total_returned = sum(r.get('return_qty', 0) for r in ret_by_item.get(item_id, []))
        total_shipped = sum(b.get('qty_shipped', 0) for b in bsi_by_item.get(item_id, []))
        enriched.append({**serialize_doc(item),
            'total_produced': total_produced, 'total_shipped': total_shipped,
            'total_returned': total_returned,
            'max_returnable': max(0, total_shipped - total_returned)})
    return enriched

@router.put("/po-items/{item_id}")
async def update_po_item(item_id: str, request: Request):
    user = await require_auth(request)
    if not check_role(user, ['admin']):
        raise HTTPException(403, 'Forbidden')
    db = get_db()
    body = await request.json()
    body.pop('_id', None)
    body.pop('id', None)
    await db.po_items.update_one({'id': item_id}, {'$set': {**body, 'updated_at': now()}})
    return serialize_doc(await db.po_items.find_one({'id': item_id}, {'_id': 0}))

@router.delete("/po-items/{item_id}")
async def delete_po_item(item_id: str, request: Request):
    user = await require_auth(request)
    if user.get('role') != 'superadmin':
        raise HTTPException(403, 'Forbidden')
    db = get_db()
    await db.po_items.delete_one({'id': item_id})
    return {'success': True}


# ─── PO STATUS TRANSITION ───────────────────────────────────────────────────
@router.post("/production-pos/{po_id}/status")
async def transition_po_status(po_id: str, request: Request):
    """Transition PO through staged statuses."""
    user = await require_auth(request)
    if not check_role(user, ['admin']):
        raise HTTPException(403, 'Forbidden')
    db = get_db()
    body = await request.json()
    new_status = body.get('status')
    if new_status not in PO_STATUSES:
        raise HTTPException(400, f"Invalid status. Valid: {PO_STATUSES}")
    po = await db.production_pos.find_one({'id': po_id})
    if not po:
        raise HTTPException(404, 'PO not found')
    update_data = {'status': new_status, 'updated_at': now()}
    if body.get('notes'):
        update_data['status_notes'] = body['notes']
    if new_status == 'Closed':
        update_data['closed_by'] = user['name']
        update_data['closed_at'] = now()
        update_data['close_reason'] = body.get('close_reason', '')
    await db.production_pos.update_one({'id': po_id}, {'$set': update_data})
    await log_activity(user['id'], user['name'], 'Status Change', 'Production PO',
                       f"PO {po.get('po_number')}: {po.get('status')} → {new_status}")
    return serialize_doc(await db.production_pos.find_one({'id': po_id}, {'_id': 0}))


# ─── PO QUANTITY SUMMARY ────────────────────────────────────────────────────
@router.get("/production-pos/{po_id}/quantity-summary")
async def po_quantity_summary(po_id: str, request: Request):
    """Get comprehensive quantity summary for a PO."""
    await require_auth(request)
    db = get_db()
    po = await db.production_pos.find_one({'id': po_id}, {'_id': 0})
    if not po:
        raise HTTPException(404, 'PO not found')
    items = await db.po_items.find({'po_id': po_id}, {'_id': 0}).to_list(500)
    summary_items = []
    totals = {'ordered': 0, 'received': 0, 'missing': 0, 'defect': 0,
              'available': 0, 'produced': 0, 'shipped': 0, 'returned': 0}
    if not items:
        return {'po': serialize_doc(po), 'items': [], 'totals': totals}

    # ── Batch prefetch ──
    item_ids = [it['id'] for it in items]
    vsi_by_item = await prefetch_group(db.vendor_shipment_items, 'po_item_id', item_ids)
    ji_by_item = await prefetch_group(db.production_job_items, 'po_item_id', item_ids)
    bsi_by_item = await prefetch_group(db.buyer_shipment_items, 'po_item_id', item_ids)
    ret_by_item = await prefetch_group(db.production_return_items, 'po_item_id', item_ids)
    defect_by_item = await prefetch_group(db.material_defect_reports, 'po_item_id', item_ids)

    # Vendor shipments map (parent docs of vsi)
    ship_ids = list({vsi.get('shipment_id') for arr in vsi_by_item.values() for vsi in arr if vsi.get('shipment_id')})
    ships_by_id = await prefetch_map(db.vendor_shipments, ship_ids)

    # Inspections keyed by shipment_id (single $in)
    insp_by_ship = {}
    if ship_ids:
        async for ins in db.vendor_material_inspections.find({'shipment_id': {'$in': ship_ids}}, {'_id': 0}):
            insp_by_ship[ins.get('shipment_id')] = ins

    # Inspection items keyed by (inspection_id, shipment_item_id)
    insp_ids = [i['id'] for i in insp_by_ship.values()]
    insp_items_lookup: dict = {}
    if insp_ids:
        async for ii in db.vendor_material_inspection_items.find({'inspection_id': {'$in': insp_ids}}, {'_id': 0}):
            insp_items_lookup[(ii.get('inspection_id'), ii.get('shipment_item_id'))] = ii

    # Orphan production_job_items by sku/size/color (single $in over distinct triples)
    triples = list({(it.get('sku', ''), it.get('size', ''), it.get('color', '')) for it in items})
    orphan_lookup: dict = {}
    if triples:
        skus = list({t[0] for t in triples})
        sizes = list({t[1] for t in triples})
        colors = list({t[2] for t in triples})
        async for oji in db.production_job_items.find({
            '$or': [{'po_item_id': None}, {'po_item_id': ''}, {'po_item_id': {'$exists': False}}],
            'sku': {'$in': skus},
            'size': {'$in': sizes},
            'color': {'$in': colors},
        }, {'_id': 0}):
            key = (oji.get('sku', ''), oji.get('size', ''), oji.get('color', ''))
            orphan_lookup.setdefault(key, []).append(oji)

    for item in items:
        item_id = item['id']
        ship_items = vsi_by_item.get(item_id, [])
        received = 0
        missing = 0
        for si in ship_items:
            ship = ships_by_id.get(si.get('shipment_id'))
            if ship and ship.get('inspection_status') == 'Inspected':
                insp = insp_by_ship.get(si.get('shipment_id'))
                if insp:
                    ii = insp_items_lookup.get((insp['id'], si['id']))
                    if ii:
                        received += ii.get('received_qty', 0)
                        missing += ii.get('missing_qty', 0)
                    else:
                        received += si.get('qty_sent', 0)
            elif ship and ship.get('status') == 'Received':
                received += si.get('qty_sent', 0)

        defects = defect_by_item.get(item_id, [])
        total_defect = sum(d.get('defect_qty', 0) for d in defects)
        available = max(0, received - total_defect)

        job_items = ji_by_item.get(item_id, [])
        produced = sum(ji.get('produced_qty', 0) for ji in job_items)
        # Orphan job items by sku/size/color
        triple_key = (item.get('sku', ''), item.get('size', ''), item.get('color', ''))
        counted_ids = {j['id'] for j in job_items}
        for oji in orphan_lookup.get(triple_key, []):
            if oji['id'] not in counted_ids:
                produced += oji.get('produced_qty', 0)

        shipped = sum(bi.get('qty_shipped', 0) for bi in bsi_by_item.get(item_id, []))
        returned = sum(ri.get('return_qty', 0) for ri in ret_by_item.get(item_id, []))
        ordered = item.get('qty', 0)
        over = max(0, produced - ordered)
        under = max(0, ordered - produced)
        summary_items.append({
            **serialize_doc(item),
            'ordered_qty': ordered, 'received_qty': received, 'missing_qty': missing,
            'defect_qty': total_defect, 'available_qty': available, 'produced_qty': produced,
            'shipped_qty': shipped, 'returned_qty': returned,
            'overproduction_qty': over, 'underproduction_qty': under
        })
        totals['ordered'] += ordered
        totals['received'] += received
        totals['missing'] += missing
        totals['defect'] += total_defect
        totals['available'] += available
        totals['produced'] += produced
        totals['shipped'] += shipped
        totals['returned'] += returned
    totals['overproduction'] = max(0, totals['produced'] - totals['ordered'])
    totals['underproduction'] = max(0, totals['ordered'] - totals['produced'])
    return {'po': serialize_doc(po), 'items': summary_items, 'totals': totals}


# ─── PO ACCESSORIES (add-on) ─────────────────────────────────────────────────
@router.get("/po-accessories")
async def get_po_accessories(request: Request):
    """Get accessories linked to a PO."""
    await require_auth(request)
    db = get_db()
    po_id = request.query_params.get('po_id')
    if not po_id:
        raise HTTPException(400, 'po_id required')
    return serialize_doc(await db.po_accessories.find({'po_id': po_id}, {'_id': 0}).sort('created_at', 1).to_list(500))

@router.post("/po-accessories")
async def add_po_accessory(request: Request):
    """Add accessory to a PO."""
    user = await require_auth(request)
    if not check_role(user, ['admin']):
        raise HTTPException(403, 'Forbidden')
    db = get_db()
    body = await request.json()
    po_id = body.get('po_id')
    if not po_id:
        raise HTTPException(400, 'po_id required')
    items = body.get('items', [])
    inserted = []
    for item in items:
        acc_doc = {
            'id': new_id(), 'po_id': po_id,
            'accessory_id': item.get('accessory_id'),
            'accessory_name': item.get('accessory_name', ''),
            'accessory_code': item.get('accessory_code', ''),
            'qty_needed': int(item.get('qty_needed', 0) or 0),
            'unit': item.get('unit', 'pcs'),
            'notes': item.get('notes', ''),
            'created_at': now()
        }
        await db.po_accessories.insert_one(acc_doc)
        inserted.append(acc_doc)
    await log_activity(user['id'], user['name'], 'Add Accessories', 'Production PO',
                       f"Added {len(inserted)} accessories to PO")
    return JSONResponse(serialize_doc(inserted), status_code=201)

@router.delete("/po-accessories/{acc_id}")
async def remove_po_accessory(acc_id: str, request: Request):
    user = await require_auth(request)
    if not check_role(user, ['admin']):
        raise HTTPException(403, 'Forbidden')
    db = get_db()
    await db.po_accessories.delete_one({'id': acc_id})
    return {'success': True}


# ─── PO STAGE TRACKING (GAP #3) ────────────────────────────────────────────

@router.put("/production-pos/{po_id}/stage-qty")
async def update_po_stage_qty(po_id: str, request: Request):
    """
    Input / update qty per tahap produksi untuk internal PO.
    stage: cutting | sewing | qc | packing
    Jika PO punya WO, data aktual diambil dari WIP events (real-time).
    Input manual di sini berlaku sebagai override/suplemen.
    """
    await require_auth(request)
    db = get_db()
    po = await db.production_pos.find_one({'id': po_id})
    if not po:
        raise HTTPException(404, 'PO tidak ditemukan')

    body = await request.json()
    stage = body.get('stage')
    valid_stages = ['cutting', 'sewing', 'qc', 'packing']
    if stage not in valid_stages:
        raise HTTPException(400, f"stage harus salah satu dari: {valid_stages}")

    stage_qty = po.get('stage_qty') or {}

    if stage == 'cutting':
        if body.get('qty_in') is not None:
            stage_qty['cutting_input'] = max(0, int(body['qty_in']))
        if body.get('qty_out') is not None:
            stage_qty['cutting_output'] = max(0, int(body['qty_out']))
    elif stage == 'sewing':
        if body.get('qty_out') is not None:
            stage_qty['sewing_output'] = max(0, int(body['qty_out']))
    elif stage == 'qc':
        if body.get('qty_pass') is not None:
            stage_qty['qc_pass'] = max(0, int(body['qty_pass']))
        if body.get('qty_fail') is not None:
            stage_qty['qc_fail'] = max(0, int(body['qty_fail']))
    elif stage == 'packing':
        if body.get('qty_out') is not None:
            stage_qty['packing_output'] = max(0, int(body['qty_out']))

    await db.production_pos.update_one(
        {'id': po_id},
        {'$set': {'stage_qty': stage_qty, 'updated_at': now()}}
    )
    return {'message': f'Stage qty {stage} diperbarui', 'stage_qty': stage_qty}


@router.get("/production-pos/{po_id}/stage-summary")
async def get_po_stage_summary(po_id: str, request: Request):
    """
    Aggregated stage summary untuk PO:
    - Real data dari rahaza_wip_events (linked WOs)
    - Suplemen manual dari po.stage_qty
    Returns cutting/sewing/qc/packing summary.
    """
    await require_auth(request)
    db = get_db()
    po = await db.production_pos.find_one({'id': po_id})
    if not po:
        raise HTTPException(404, 'PO tidak ditemukan')

    # Get all WOs for this PO
    wo_ids_raw = await db.rahaza_work_orders.find(
        {'order_id': po_id, 'source': {'$ne': 'maklon'}},
        {'_id': 0, 'id': 1, 'qty': 1, 'status': 1}
    ).to_list(500)
    wo_ids = [w['id'] for w in wo_ids_raw]
    total_wo_qty = sum(int(w.get('qty', 0)) for w in wo_ids_raw)

    # Aggregate from WIP events
    wip_summary = {'cutting_output': 0, 'sewing_output': 0, 'qc_pass': 0, 'qc_fail': 0, 'packing_output': 0}
    if wo_ids:
        # Get all processes ordered by seq
        processes = await db.rahaza_processes.find(
            {'active': True}, {'_id': 0, 'id': 1, 'name': 1, 'order_seq': 1, 'process_type': 1}
        ).sort('order_seq', 1).to_list(500)
        proc_ids = [p['id'] for p in processes]

        # For each stage, aggregate output events
        if proc_ids:
            # Cutting ≈ first process output
            cutting_proc = processes[0] if processes else None
            # Sewing / final process
            last_proc = processes[-1] if processes else None

            pipe_base = [
                {'$match': {'work_order_id': {'$in': wo_ids}, 'event_type': 'output'}},
                {'$group': {'_id': '$process_id', 'total': {'$sum': '$qty'}}}
            ]
            agg = await db.rahaza_wip_events.aggregate(pipe_base).to_list(500)
            by_proc = {r['_id']: r['total'] for r in agg}

            if cutting_proc:
                wip_summary['cutting_output'] = by_proc.get(cutting_proc['id'], 0)
            if last_proc:
                wip_summary['sewing_output'] = by_proc.get(last_proc['id'], 0)

            # QC pass/fail from QC events
            qc_pipe = [
                {'$match': {'work_order_id': {'$in': wo_ids}, 'event_type': {'$in': ['qc_pass', 'qc_fail']}}},
                {'$group': {'_id': '$event_type', 'total': {'$sum': '$qty'}}}
            ]
            qc_agg = await db.rahaza_wip_events.aggregate(qc_pipe).to_list(500)
            for r in qc_agg:
                if r['_id'] == 'qc_pass':
                    wip_summary['qc_pass'] = r['total']
                elif r['_id'] == 'qc_fail':
                    wip_summary['qc_fail'] = r['total']

    # Manual stage_qty from PO (used as override when WIP data unavailable)
    manual_sq = po.get('stage_qty') or {}
    # Merge: prefer WIP data if available, else manual
    def _pick(wip_key, manual_key):
        wip_val = wip_summary.get(wip_key, 0)
        manual_val = int(manual_sq.get(manual_key, 0))
        return wip_val if wip_val > 0 else manual_val

    # Items summary for each stage
    items = await db.po_items.find({'po_id': po_id}, {'_id': 0}).to_list(500)
    qty_ordered = sum(int(it.get('qty_ordered', 0)) for it in items)

    summary = {
        'po_id': po_id,
        'po_number': po.get('po_number', ''),
        'status': po.get('status', ''),
        'qty_ordered': qty_ordered,
        'total_wo_qty': total_wo_qty,
        'wo_count': len(wo_ids_raw),
        'stage_qty': {
            'cutting_input':   int(manual_sq.get('cutting_input', 0)),
            'cutting_output':  _pick('cutting_output', 'cutting_output'),
            'sewing_output':   _pick('sewing_output', 'sewing_output'),
            'qc_pass':         _pick('qc_pass', 'qc_pass'),
            'qc_fail':         _pick('qc_fail', 'qc_fail'),
            'packing_output':  int(manual_sq.get('packing_output', 0)),
        },
        'wip_data_available': bool(wo_ids),
        'manual_stage_qty': manual_sq,
    }

    # Calculate progress %
    sq = summary['stage_qty']
    if qty_ordered > 0:
        if sq['packing_output'] >= qty_ordered:
            summary['progress_pct'] = 100
        elif sq['qc_pass'] > 0:
            summary['progress_pct'] = min(84, 70 + int((sq['qc_pass'] / qty_ordered) * 14))
        elif sq['sewing_output'] > 0:
            summary['progress_pct'] = min(69, 50 + int((sq['sewing_output'] / qty_ordered) * 19))
        elif sq['cutting_output'] > 0:
            summary['progress_pct'] = min(49, 30 + int((sq['cutting_output'] / qty_ordered) * 19))
        else:
            # Fallback ke WO completion
            completed_wos = sum(1 for w in wo_ids_raw if w.get('status') == 'completed')
            summary['progress_pct'] = int((completed_wos / len(wo_ids_raw) * 100)) if wo_ids_raw else 0
    else:
        summary['progress_pct'] = 0

    return serialize_doc(summary)

