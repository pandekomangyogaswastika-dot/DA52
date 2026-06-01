"""
Production Progress Tracking & Monitoring
Split from production.py for better maintainability
"""
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from database import get_db
from auth import (require_auth, log_activity, serialize_doc)
from routes.shared import new_id, now, parse_date
import logging

logger = logging.getLogger(__name__)

router = APIRouter(tags=["production-progress"])

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
