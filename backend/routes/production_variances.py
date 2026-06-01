"""
Production Production Variances
Split from production.py for better maintainability
"""
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from database import get_db
from auth import (require_auth, check_role, log_activity, serialize_doc)
from routes.shared import new_id, now, parse_date, to_end_of_day
import logging
import re

logger = logging.getLogger(__name__)

router = APIRouter(tags=["production-variances"])

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



# ══════════════════════════════════════════════════════════════════════════════
# PHASE 7C: PRODUCTION VARIANCE → GL AUTO-POSTING
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/production-variances/{vid}/post-gl")
async def post_variance_to_gl(vid: str, request: Request):
    """
    Phase 7C: Post production variance ke GL.
    
    OVERPRODUCTION: Dr Inventory FG (1-1404) / Cr Variance Income (5-9100)
    UNDERPRODUCTION: Dr Variance Loss (6-4100) / Cr WIP (1-1403)
    """
    user = await require_auth(request)
    db = get_db()
    body = await request.json()
    
    variance = await db.production_variances.find_one({'id': vid})
    if not variance:
        raise HTTPException(404, 'Variance not found')
    
    # Calculate variance value if not already set
    variance_value = float(variance.get('variance_value', 0))
    if variance_value == 0:
        # Calculate from items if available
        items = variance.get('items', [])
        total_value = 0
        for item in items:
            var_qty = int(item.get('variance_qty', 0) or 0)
            # Get unit cost from product catalog or use default
            product_sku = item.get('sku')
            unit_cost = 0
            if product_sku:
                # Lookup from catalog or BOM
                product = await db.rahaza_products.find_one({'sku': product_sku}, {'_id': 0})
                if product:
                    unit_cost = float(product.get('cost_per_unit', 0) or product.get('price', 0) or 0)
            # Fallback: use provided unit_cost or 0
            unit_cost = float(body.get('unit_cost', unit_cost))
            total_value += abs(var_qty) * unit_cost
        
        variance_value = round(total_value)
        # Update variance record with calculated value
        await db.production_variances.update_one(
            {'id': vid},
            {'$set': {'variance_value': variance_value, 'updated_at': now()}}
        )
        variance['variance_value'] = variance_value
    
    if variance_value <= 0:
        raise HTTPException(400, 'Variance value harus > 0. Set unit_cost jika belum ada.')
    
    # Auto-post GL
    posting_result = None
    try:
        from routes.rahaza_posting import post_production_variance
        variance_refresh = await db.production_variances.find_one({'id': vid}, {'_id': 0})
        posting_result = await post_production_variance(db, variance_refresh, user)
    except Exception as e:
        logger.exception("Production variance auto-post failed")
        posting_result = {"ok": False, "error": str(e)}
    
    # Get final state
    final_variance = await db.production_variances.find_one({'id': vid}, {'_id': 0})
    final_variance['_posting_result'] = posting_result
    
    await log_activity(user['id'], user['name'], 'Post GL', 'Production Variance',
                      f"Posted variance {variance['variance_type']} to GL: {variance_value}")
    
    return serialize_doc(final_variance)


@router.post("/production-variances/{vid}/retry-posting")
async def retry_variance_posting(vid: str, request: Request):
    """Retry posting production variance to GL (idempotent)"""
    user = await require_auth(request)
    db = get_db()
    
    variance = await db.production_variances.find_one({'id': vid}, {'_id': 0})
    if not variance:
        raise HTTPException(404, 'Variance not found')
    
    try:
        from routes.rahaza_posting import post_production_variance
        result = await post_production_variance(db, variance, user)
    except Exception as e:
        logger.exception("Production variance retry post failed")
        result = {"ok": False, "error": str(e)}
    
    final_variance = await db.production_variances.find_one({'id': vid}, {'_id': 0})
    final_variance['_posting_result'] = result
    return serialize_doc(final_variance)

