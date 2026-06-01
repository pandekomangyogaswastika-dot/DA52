"""
operations_reports.py — Report Queries & Data Import
Endpoints: /api/reports/{report_type}, /api/import-data, /api/import-template

Refactored: Session #12 P2 (split from operations.py 2580 LOC monolith)
FORENSIC_12 GAP-01: financial report type redirects to SSOT
(rahaza_ar_invoices + rahaza_ap_invoices) instead of dropped `invoices` collection.
"""
from fastapi import APIRouter, Request, HTTPException
from database import get_db
from auth import require_auth, check_role, log_activity, serialize_doc
from auth import generate_password, hash_password
from routes.shared import new_id, now, parse_date
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["operations-reports"])


# ─── REPORTS ─────────────────────────────────────────────────────────────────
@router.get("/reports/{report_type}")
async def get_report(report_type: str, request: Request):
    await require_auth(request)
    db = get_db()
    sp = request.query_params
    if report_type == 'production':
        po_query = {}
        if sp.get('status'):
            po_query['status'] = sp['status']
        pos = await db.production_pos.find(po_query, {'_id': 0}).sort('created_at', -1).to_list(500)
        rows = []
        for po in pos:
            if sp.get('vendor_id') and po.get('vendor_id') != sp['vendor_id']:
                continue
            items = await db.po_items.find({'po_id': po['id']}).to_list(500)
            for item in items:
                if sp.get('serial_number') and item.get('serial_number') != sp['serial_number']:
                    continue
                # Get actual produced qty from production job items
                ji_list = await db.production_job_items.find({'po_item_id': item['id']}).to_list(500)
                produced_qty = sum(j.get('produced_qty', 0) for j in ji_list)
                # Also check orphaned child items by sku+size+color
                orphan_ji = await db.production_job_items.find({
                    '$or': [{'po_item_id': None}, {'po_item_id': ''}, {'po_item_id': {'$exists': False}}],
                    'sku': item.get('sku', ''), 'size': item.get('size', ''), 'color': item.get('color', '')
                }).to_list(500)
                counted_ids = {j['id'] for j in ji_list}
                for oji in orphan_ji:
                    if oji['id'] not in counted_ids:
                        produced_qty += oji.get('produced_qty', 0)
                # Get shipped to buyer
                buyer_items = await db.buyer_shipment_items.find({'po_item_id': item['id']}).to_list(500)
                shipped_qty = sum(bi.get('qty_shipped', 0) for bi in buyer_items)
                ordered_qty = item.get('qty', 0)
                harga = item.get('selling_price_snapshot', 0)
                hpp = item.get('cmt_price_snapshot', 0)
                rows.append({
                    'tanggal': serialize_doc(po.get('po_date', po.get('created_at'))),
                    'no_po': po.get('po_number'), 'no_seri': item.get('serial_number', ''),
                    'kode_produk': item.get('sku', ''),
                    'nama_produk': item.get('product_name', ''), 'sku': item.get('sku', ''),
                    'kategori': item.get('category', ''),
                    'size': item.get('size', ''), 'warna': item.get('color', ''),
                    'output_qty': ordered_qty,
                    'harga': harga, 'hpp': hpp,
                    'hasil_po': ordered_qty * harga,
                    'total_hpp': ordered_qty * hpp,
                    'garment': po.get('vendor_name', ''), 'po_status': po.get('status'),
                    'note': po.get('notes', ''),
                    'qty_sudah_diproduksi': produced_qty,
                    'qty_belum_diproduksi': max(0, ordered_qty - produced_qty),
                    'qty_sudah_dikirim': shipped_qty,
                })
        return rows
    if report_type == 'financial':
        # FORENSIC_12 GAP-01: legacy `invoices` collection was DROPPED (Session #11.16 Phase B).
        # Redirect to SSOT: rahaza_ar_invoices + rahaza_ap_invoices.
        inv_query = {}
        if sp.get('status'):
            inv_query['status'] = sp['status']
        ar_invs = await db.rahaza_ar_invoices.find(inv_query, {'_id': 0}).sort('created_at', -1).to_list(500)
        ap_invs = await db.rahaza_ap_invoices.find(inv_query, {'_id': 0}).sort('created_at', -1).to_list(500)
        invoices = ar_invs + ap_invs
        return serialize_doc(invoices)
    if report_type == 'shipment':
        vs = await db.vendor_shipments.find({}, {'_id': 0}).sort('created_at', -1).to_list(500)
        bs = await db.buyer_shipments.find({}, {'_id': 0}).sort('created_at', -1).to_list(500)
        rows = []
        for v in vs:
            if sp.get('vendor_id') and v.get('vendor_id') != sp['vendor_id']:
                continue
            items = await db.vendor_shipment_items.find({'shipment_id': v['id']}).to_list(500)
            rows.append({'direction': 'VENDOR → PRODUKSI', 'shipment_number': v.get('shipment_number'),
                         'shipment_type': v.get('shipment_type', 'NORMAL'),
                         'vendor_name': v.get('vendor_name', ''), 'status': v.get('status'),
                         'inspection_status': v.get('inspection_status', 'Pending'),
                         'date': serialize_doc(v.get('shipment_date', v.get('created_at'))),
                         'total_qty': sum(i.get('qty_sent', 0) for i in items), 'item_count': len(items)})
        for b in bs:
            if sp.get('vendor_id') and b.get('vendor_id') != sp['vendor_id']:
                continue
            items = await db.buyer_shipment_items.find({'shipment_id': b['id']}).to_list(500)
            rows.append({'direction': 'PRODUKSI → BUYER', 'shipment_number': b.get('shipment_number'),
                         'shipment_type': 'NORMAL', 'vendor_name': b.get('vendor_name', ''),
                         'status': b.get('status', b.get('ship_status', '')),
                         'date': serialize_doc(b.get('created_at')),
                         'total_qty': sum(i.get('qty_shipped', 0) for i in items), 'item_count': len(items)})
        return rows
    if report_type == 'progress':
        progs = await db.production_progress.find({}, {'_id': 0}).sort('progress_date', 1).to_list(500)
        # Batch prefetch: ji & jobs & buyer_shipment_items
        ji_ids = list({p.get('job_item_id') for p in progs if p.get('job_item_id')})
        job_ids = list({p.get('job_id') for p in progs if p.get('job_id')})
        ji_map = {}
        if ji_ids:
            async for d in db.production_job_items.find({'id': {'$in': ji_ids}}):
                ji_map[d['id']] = d
        jobs_map = {}
        if job_ids:
            async for d in db.production_jobs.find({'id': {'$in': job_ids}}):
                jobs_map[d['id']] = d
        # Buyer items per po_item_id (single $in)
        poi_ids = list({(ji_map.get(p.get('job_item_id')) or {}).get('po_item_id')
                         for p in progs if p.get('job_item_id')})
        poi_ids = [x for x in poi_ids if x]
        bsi_by_poi = {}
        if poi_ids:
            async for b in db.buyer_shipment_items.find({'po_item_id': {'$in': poi_ids}}):
                bsi_by_poi.setdefault(b['po_item_id'], []).append(b)
        rows = []
        cumulative_produced = {}
        for p in progs:
            ji = ji_map.get(p.get('job_item_id'))
            job = jobs_map.get(p.get('job_id'))
            if sp.get('vendor_id') and (job or {}).get('vendor_id') != sp['vendor_id']:
                continue
            poi_id = (ji or {}).get('po_item_id') or p.get('job_item_id', '')
            if poi_id not in cumulative_produced:
                cumulative_produced[poi_id] = 0
            cumulative_produced[poi_id] += p.get('completed_quantity', 0)
            cum_shipped = 0
            if (ji or {}).get('po_item_id'):
                cum_shipped = sum(bi.get('qty_shipped', 0) for bi in bsi_by_poi.get(ji['po_item_id'], []))
            rows.append({
                'date': serialize_doc(p.get('progress_date')),
                'job_number': (job or {}).get('job_number', ''),
                'po_number': (job or {}).get('po_number', ''),
                'vendor_name': (job or {}).get('vendor_name', ''),
                'vendor': (job or {}).get('vendor_name', ''),
                'serial_number': (ji or {}).get('serial_number', ''),
                'sku': (ji or {}).get('sku', p.get('sku', '')),
                'product_name': (ji or {}).get('product_name', p.get('product_name', '')),
                'qty_progress': p.get('completed_quantity', 0),
                'cumulative_produced': cumulative_produced[poi_id],
                'cumulative_shipped': cum_shipped,
                'status': (job or {}).get('status', ''),
                'notes': p.get('notes', ''),
                'operator': p.get('recorded_by', ''),
                'recorded_by': p.get('recorded_by', '')
            })
        rows.reverse()
        return rows
    if report_type == 'defect':
        defects = await db.material_defect_reports.find({}, {'_id': 0}).sort('created_at', -1).to_list(500)
        rows = []
        for d in defects:
            if sp.get('vendor_id') and d.get('vendor_id') != sp['vendor_id']:
                continue
            rows.append({
                'date': serialize_doc(d.get('report_date', d.get('created_at'))),
                'vendor_id': d.get('vendor_id'), 'sku': d.get('sku', ''),
                'product_name': d.get('product_name', ''),
                'size': d.get('size', ''), 'color': d.get('color', ''),
                'defect_qty': d.get('defect_qty', 0), 'defect_type': d.get('defect_type', ''),
                'description': d.get('description', ''), 'status': d.get('status', '')
            })
        return rows
    if report_type == 'return':
        returns = await db.production_returns.find({}, {'_id': 0}).sort('created_at', -1).to_list(500)
        rows = []
        for r in returns:
            items = await db.production_return_items.find({'return_id': r['id']}).to_list(500)
            rows.append({
                'return_number': r.get('return_number', ''),
                'po_number': r.get('reference_po_number', ''),
                'customer_name': r.get('customer_name', ''),
                'return_date': serialize_doc(r.get('return_date')),
                'total_qty': sum(i.get('return_qty', 0) for i in items),
                'item_count': len(items), 'reason': r.get('return_reason', ''),
                'status': r.get('status', ''), 'notes': r.get('notes', '')
            })
        return rows
    if report_type == 'missing-material':
        reqs = await db.material_requests.find({'request_type': 'ADDITIONAL'}, {'_id': 0}).sort('created_at', -1).to_list(500)
        rows = []
        for r in reqs:
            if sp.get('vendor_id') and r.get('vendor_id') != sp['vendor_id']:
                continue
            # Get request items for detail
            req_items = r.get('items', [])
            if not req_items:
                # Try to get items from a separate collection if stored there
                req_items_db = await db.material_request_items.find({'request_id': r['id']}).to_list(500)
                if req_items_db:
                    req_items = req_items_db
            if req_items:
                for ri in req_items:
                    rows.append({
                        'request_number': r.get('request_number', ''), 'request_type': r.get('request_type'),
                        'vendor_name': r.get('vendor_name', ''), 'po_number': r.get('po_number', ''),
                        'serial_number': ri.get('serial_number', r.get('serial_number', '')),
                        'sku': ri.get('sku', ''),
                        'requested_qty': ri.get('requested_qty', ri.get('qty', 0)),
                        'total_requested_qty': r.get('total_requested_qty', 0),
                        'reason': r.get('reason', ''), 'status': r.get('status', ''),
                        'child_shipment_number': r.get('child_shipment_number', ''),
                        'created_at': serialize_doc(r.get('created_at'))
                    })
            else:
                rows.append({
                    'request_number': r.get('request_number', ''), 'request_type': r.get('request_type'),
                    'vendor_name': r.get('vendor_name', ''), 'po_number': r.get('po_number', ''),
                    'serial_number': r.get('serial_number', ''),
                    'sku': r.get('sku', ''),
                    'requested_qty': r.get('total_requested_qty', 0),
                    'total_requested_qty': r.get('total_requested_qty', 0),
                    'reason': r.get('reason', ''), 'status': r.get('status', ''),
                    'child_shipment_number': r.get('child_shipment_number', ''),
                    'created_at': serialize_doc(r.get('created_at'))
                })
        return rows
    if report_type == 'replacement':
        reqs = await db.material_requests.find({'request_type': 'REPLACEMENT'}, {'_id': 0}).sort('created_at', -1).to_list(500)
        rows = []
        for r in reqs:
            if sp.get('vendor_id') and r.get('vendor_id') != sp['vendor_id']:
                continue
            req_items = r.get('items', [])
            if not req_items:
                req_items_db = await db.material_request_items.find({'request_id': r['id']}).to_list(500)
                if req_items_db:
                    req_items = req_items_db
            if req_items:
                for ri in req_items:
                    rows.append({
                        'request_number': r.get('request_number', ''), 'request_type': r.get('request_type'),
                        'vendor_name': r.get('vendor_name', ''), 'po_number': r.get('po_number', ''),
                        'serial_number': ri.get('serial_number', r.get('serial_number', '')),
                        'sku': ri.get('sku', ''),
                        'requested_qty': ri.get('requested_qty', ri.get('qty', 0)),
                        'total_requested_qty': r.get('total_requested_qty', 0),
                        'reason': r.get('reason', ''), 'status': r.get('status', ''),
                        'child_shipment_number': r.get('child_shipment_number', ''),
                        'created_at': serialize_doc(r.get('created_at'))
                    })
            else:
                rows.append({
                    'request_number': r.get('request_number', ''), 'request_type': r.get('request_type'),
                    'vendor_name': r.get('vendor_name', ''), 'po_number': r.get('po_number', ''),
                    'serial_number': r.get('serial_number', ''),
                    'sku': r.get('sku', ''),
                    'requested_qty': r.get('total_requested_qty', 0),
                    'total_requested_qty': r.get('total_requested_qty', 0),
                    'reason': r.get('reason', ''), 'status': r.get('status', ''),
                    'child_shipment_number': r.get('child_shipment_number', ''),
                    'created_at': serialize_doc(r.get('created_at'))
                })
        return rows
    if report_type == 'accessory':
        acc_ships = await db.accessory_shipments.find({}, {'_id': 0}).sort('created_at', -1).to_list(500)
        rows = []
        for s in acc_ships:
            if sp.get('vendor_id') and s.get('vendor_id') != sp['vendor_id']:
                continue
            items = await db.accessory_shipment_items.find({'shipment_id': s['id']}).to_list(500)
            for item in items:
                rows.append({
                    'shipment_number': s.get('shipment_number', ''),
                    'vendor_name': s.get('vendor_name', ''), 'po_number': s.get('po_number', ''),
                    'date': serialize_doc(s.get('shipment_date')),
                    'accessory_name': item.get('accessory_name', ''), 'accessory_code': item.get('accessory_code', ''),
                    'qty_sent': item.get('qty_sent', 0), 'unit': item.get('unit', 'pcs'),
                    'status': s.get('status', ''), 'inspection_status': s.get('inspection_status', 'Pending')
                })
        return rows
    return {'error': 'Unknown report type', 'available_types': [
        'production', 'financial', 'shipment', 'progress', 'defect', 'return',
        'missing-material', 'replacement', 'accessory']}


# ─── IMPORT DATA ─────────────────────────────────────────────────────────────
@router.post("/import-data")
async def import_data(request: Request):
    user = await require_auth(request)
    if not check_role(user, ['admin']):
        raise HTTPException(403, 'Forbidden')
    db = get_db()
    body = await request.json()
    import_type = body.get('type', '')
    data_rows = body.get('data', [])
    imported = 0
    errors = []
    if import_type == 'products':
        for row in data_rows:
            try:
                prod_id = new_id()
                prod = {'id': prod_id, 'product_code': row.get('product_code', ''),
                        'product_name': row.get('product_name', ''), 'category': row.get('category', ''),
                        'cmt_price': float(row.get('cmt_price', 0) or 0),
                        'selling_price': float(row.get('selling_price', 0) or 0),
                        'status': 'active', 'created_at': now(), 'updated_at': now()}
                await db.products.insert_one(prod)
                # Import variants if provided
                for v in row.get('variants', []):
                    await db.product_variants.insert_one({
                        'id': new_id(), 'product_id': prod_id,
                        'product_code': prod['product_code'], 'product_name': prod['product_name'],
                        'sku': v.get('sku', ''), 'size': v.get('size', ''), 'color': v.get('color', ''),
                        'status': 'active', 'created_at': now()})
                imported += 1
            except Exception as e:
                errors.append(f"Row {imported+1}: {str(e)}")
    elif import_type == 'garments':
        for row in data_rows:
            try:
                gid = new_id()
                code_slug = (row.get('garment_code', gid)).lower()
                code_slug = ''.join(c for c in code_slug if c.isalnum())
                email = f"vendor.{code_slug}@garment.com"
                raw_pw = generate_password(10)
                await db.users.insert_one({'id': new_id(), 'name': row.get('garment_name', ''),
                    'email': email, 'password': hash_password(raw_pw), 'role': 'vendor',
                    'vendor_id': gid, 'status': 'active', 'created_at': now(), 'updated_at': now()})
                await db.garments.insert_one({'id': gid, **row, 'status': 'active',
                    'login_email': email, 'vendor_password_plain': raw_pw,
                    'created_at': now(), 'updated_at': now()})
                imported += 1
            except Exception as e:
                errors.append(f"Row {imported+1}: {str(e)}")
    elif import_type == 'production-pos':
        # Batch prefetch all referenced vendors once
        vendor_ids = list({row.get('vendor_id') for row in data_rows if row.get('vendor_id')})
        vendor_map = {}
        if vendor_ids:
            async for vd in db.garments.find({'id': {'$in': vendor_ids}}):
                vendor_map[vd['id']] = vd
        for row in data_rows:
            try:
                vendor_name = ''
                if row.get('vendor_id'):
                    vd = vendor_map.get(row['vendor_id'])
                    vendor_name = (vd or {}).get('garment_name', '')
                po_id = new_id()
                po = {'id': po_id, 'po_number': row.get('po_number', ''),
                      'customer_name': row.get('customer_name', ''),
                      'vendor_id': row.get('vendor_id'), 'vendor_name': vendor_name,
                      'po_date': parse_date(row.get('po_date')) or now(),
                      'deadline': parse_date(row.get('deadline')),
                      'status': 'Draft', 'notes': row.get('notes', ''),
                      'created_by': user['name'], 'created_at': now(), 'updated_at': now()}
                await db.production_pos.insert_one(po)
                # Batch insert all po_items at once per PO
                items_to_insert = [{
                    'id': new_id(), 'po_id': po_id, 'po_number': row['po_number'],
                    'product_name': item.get('product_name', ''),
                    'sku': item.get('sku', ''), 'size': item.get('size', ''),
                    'color': item.get('color', ''), 'serial_number': item.get('serial_number', ''),
                    'qty': int(item.get('qty', 0) or 0),
                    'selling_price_snapshot': float(item.get('selling_price', 0) or 0),
                    'cmt_price_snapshot': float(item.get('cmt_price', 0) or 0),
                    'created_at': now()
                } for item in row.get('items', [])]
                if items_to_insert:
                    await db.po_items.insert_many(items_to_insert)
                imported += 1
            except Exception as e:
                errors.append(f"Row {imported+1}: {str(e)}")
    elif import_type == 'accessories':
        for row in data_rows:
            try:
                await db.accessories.insert_one({'id': new_id(), 'name': row.get('name', ''),
                    'code': row.get('code', ''), 'category': row.get('category', ''),
                    'unit': row.get('unit', 'pcs'), 'description': row.get('description', ''),
                    'status': 'active', 'created_at': now(), 'updated_at': now()})
                imported += 1
            except Exception as e:
                errors.append(f"Row {imported+1}: {str(e)}")
    else:
        raise HTTPException(400, f"Unknown import type: {import_type}")
    await log_activity(user['id'], user['name'], 'Import', import_type, f"Imported {imported} records")
    return {'imported': imported, 'errors': errors, 'type': import_type}

@router.get("/import-template")
async def import_template(request: Request):
    await require_auth(request)
    ttype = request.query_params.get('type', '')
    templates = {
        'products': {'columns': ['product_code', 'product_name', 'category', 'cmt_price', 'selling_price'],
                     'variant_columns': ['sku', 'size', 'color'], 'example': {'product_code': 'PRD-001', 'product_name': 'T-Shirt Basic', 'category': 'Shirt', 'cmt_price': 5000, 'selling_price': 15000}},
        'garments': {'columns': ['garment_code', 'garment_name', 'location', 'contact_person', 'phone', 'monthly_capacity'],
                     'example': {'garment_code': 'VND-001', 'garment_name': 'PT Garmen Jaya', 'location': 'Jakarta', 'contact_person': 'Budi', 'phone': '08123456789'}},
        'production-pos': {'columns': ['po_number', 'customer_name', 'vendor_id', 'po_date', 'deadline', 'notes'],
                           'item_columns': ['product_name', 'sku', 'size', 'color', 'serial_number', 'qty', 'selling_price', 'cmt_price'],
                           'example': {'po_number': 'PO-001', 'customer_name': 'Buyer Corp'}},
        'accessories': {'columns': ['code', 'name', 'category', 'unit', 'description'],
                        'example': {'code': 'ACC-001', 'name': 'Kancing', 'category': 'Trimming', 'unit': 'pcs'}},
    }
    if ttype not in templates:
        return {'available_types': list(templates.keys())}
    return templates[ttype]



