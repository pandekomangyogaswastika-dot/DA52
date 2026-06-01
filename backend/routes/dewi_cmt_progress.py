"""
CV. Dewi Aditya — CMT Progress & Delivery Order
Phase Production-Maklon Overhaul

Dua mode operasi:
1. Vendor Portal mode: vendor input sendiri (is_vendor_self_report=True)
2. Admin mode: admin input untuk vendor yang tidak pakai sistem

Collections:
- dewi_cmt_progress_reports : Laporan progress harian per job
- dewi_cmt_delivery_orders  : DO / Surat jalan ke vendor CMT
"""
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, timezone, date
from database import get_db
from auth import require_auth, serialize_doc, log_activity
from utils.counters import next_counter
import uuid
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix='/api/dewi/cmt', tags=['Dewi-CMT-Progress'])


def _uid(): return str(uuid.uuid4())
def _now(): return datetime.now(timezone.utc)


PROCESS_STEPS = ['cutting', 'sewing', 'finishing', 'qc', 'packing']


async def _next_do_number(db) -> str:
    today = date.today().strftime('%Y%m%d')
    seq = await next_counter(db, f'DO-CMT-{today}', namespace='dewi')
    return f'DO-CMT-{today}-{seq:03d}'


# ──────────────────────────────────────────────────────────────────────────────
# MODELS
# ──────────────────────────────────────────────────────────────────────────────

class CMTProgressIn(BaseModel):
    cmt_job_id: str = Field(..., description="ID dari dewi_cmt_jobs")
    report_date: Optional[str] = Field(None, description="YYYY-MM-DD, default today")
    process_step: str = Field(..., description="cutting|sewing|finishing|qc|packing")
    qty_processed: int = Field(..., ge=0, description="Qty yang sudah diproses")
    qty_passed: int = Field(default=0, ge=0, description="Qty lulus (relevan untuk QC)")
    qty_failed: int = Field(default=0, ge=0, description="Qty gagal/reject")
    is_vendor_self_report: bool = Field(default=False, description="True jika diinput langsung oleh vendor")
    notes: Optional[str] = None


class DOItemIn(BaseModel):
    material_type: str = Field(default='wip', description="wip|rm_maklon|fabric")
    description: str
    qty: float
    unit: str = Field(default='pcs')
    inventory_ref: Optional[str] = None  # material_id jika ada


class CMTDeliveryOrderIn(BaseModel):
    cmt_job_id: str = Field(..., description="FK ke dewi_cmt_jobs")
    production_order_id: Optional[str] = None  # FK internal PO
    maklon_po_id: Optional[str] = None          # FK maklon PO
    source_type: str = Field(default='internal', description="internal|maklon")
    do_date: Optional[str] = None
    items: List[DOItemIn] = Field(..., min_length=1)
    notes: Optional[str] = None


# ──────────────────────────────────────────────────────────────────────────────
# CMT PROGRESS REPORTS
# ──────────────────────────────────────────────────────────────────────────────

@router.post('/progress')
async def create_progress_report(payload: CMTProgressIn, user: dict = Depends(require_auth)):
    """Input laporan progress CMT harian."""
    db = get_db()

    if payload.process_step not in PROCESS_STEPS:
        raise HTTPException(400, f'process_step harus salah satu dari: {PROCESS_STEPS}')

    # Get job details
    job = await db.dewi_cmt_jobs.find_one({'id': payload.cmt_job_id})
    if not job:
        raise HTTPException(404, 'CMT Job tidak ditemukan')

    doc = {
        'id': _uid(),
        'cmt_job_id': payload.cmt_job_id,
        'job_code': job.get('job_code', ''),
        'cmt_partner_id': job.get('cmt_partner_id', ''),
        'cmt_name': job.get('cmt_name', ''),
        'report_date': payload.report_date or date.today().isoformat(),
        'process_step': payload.process_step,
        'qty_processed': payload.qty_processed,
        'qty_passed': payload.qty_passed,
        'qty_failed': payload.qty_failed,
        'is_vendor_self_report': payload.is_vendor_self_report,
        'reported_by': user.get('id'),
        'reported_by_name': user.get('name', ''),
        'notes': payload.notes or '',
        'created_at': _now(),
    }
    await db.dewi_cmt_progress_reports.insert_one(doc)

    # Update job's cumulative progress
    await _update_job_cumulative_progress(db, payload.cmt_job_id)

    await log_activity(user.get('id', ''), user.get('name', ''), 'report_progress', 'dewi_cmt_progress_reports',
                       f'{job.get("job_code")} — {payload.process_step} — {payload.qty_processed} pcs')
    return serialize_doc(doc)


async def _update_job_cumulative_progress(db, cmt_job_id: str):
    """Hitung dan update cumulative progress per job."""
    pipeline = [
        {'$match': {'cmt_job_id': cmt_job_id}},
        {'$group': {
            '_id': '$process_step',
            'total_processed': {'$sum': '$qty_processed'},
            'total_passed': {'$sum': '$qty_passed'},
            'total_failed': {'$sum': '$qty_failed'},
            'last_report_date': {'$max': '$report_date'},
        }}
    ]
    result = await db.dewi_cmt_progress_reports.aggregate(pipeline).to_list(length=None)
    progress_by_step = {r['_id']: r for r in result}

    await db.dewi_cmt_jobs.update_one(
        {'id': cmt_job_id},
        {'$set': {
            'progress_by_step': progress_by_step,
            'last_progress_date': max((r['last_report_date'] for r in result), default=None),
            'updated_at': _now(),
        }}
    )


@router.get('/progress')
async def list_progress_reports(
    cmt_job_id: Optional[str] = Query(None),
    cmt_partner_id: Optional[str] = Query(None),
    report_date: Optional[str] = Query(None, description="YYYY-MM-DD filter tanggal"),
    process_step: Optional[str] = Query(None),
    limit: int = Query(200, le=1000),
    user: dict = Depends(require_auth),
):
    """List laporan progress CMT."""
    db = get_db()
    filt = {}
    if cmt_job_id:
        filt['cmt_job_id'] = cmt_job_id
    if cmt_partner_id:
        filt['cmt_partner_id'] = cmt_partner_id
    if report_date:
        filt['report_date'] = report_date
    if process_step:
        filt['process_step'] = process_step
    cursor = db.dewi_cmt_progress_reports.find(filt).sort('report_date', -1).limit(limit)
    return [serialize_doc(d) async for d in cursor]


@router.get('/progress/daily-summary')
async def daily_progress_summary(
    report_date: Optional[str] = Query(None, description="YYYY-MM-DD, default today"),
    cmt_partner_id: Optional[str] = Query(None),
    user: dict = Depends(require_auth),
):
    """Ringkasan laporan produksi harian."""
    db = get_db()
    target_date = report_date or date.today().isoformat()
    filt = {'report_date': target_date}
    if cmt_partner_id:
        filt['cmt_partner_id'] = cmt_partner_id

    reports = await db.dewi_cmt_progress_reports.find(filt).to_list(length=None)

    # Group by partner + job
    summary = {}
    for r in reports:
        key = r['cmt_partner_id']
        if key not in summary:
            summary[key] = {
                'cmt_partner_id': r['cmt_partner_id'],
                'cmt_name': r.get('cmt_name', ''),
                'total_processed': 0,
                'jobs': {}
            }
        s = summary[key]
        s['total_processed'] += r.get('qty_processed', 0)
        job_key = r['cmt_job_id']
        if job_key not in s['jobs']:
            s['jobs'][job_key] = {'job_code': r.get('job_code', ''), 'steps': {}}
        s['jobs'][job_key]['steps'][r['process_step']] = r.get('qty_processed', 0)

    return {'date': target_date, 'summary': list(summary.values())}


@router.get('/progress/monthly-report')
async def monthly_progress_report(
    year: int = Query(...),
    month: int = Query(...),
    cmt_partner_id: Optional[str] = Query(None),
    user: dict = Depends(require_auth),
):
    """Laporan bulanan per vendor CMT."""
    db = get_db()
    month_str = f'{year}-{month:02d}'
    filt = {'report_date': {'$regex': f'^{month_str}'}}
    if cmt_partner_id:
        filt['cmt_partner_id'] = cmt_partner_id

    pipeline = [
        {'$match': filt},
        {'$group': {
            '_id': {'partner_id': '$cmt_partner_id', 'cmt_name': '$cmt_name'},
            'total_processed': {'$sum': '$qty_processed'},
            'total_passed': {'$sum': '$qty_passed'},
            'total_failed': {'$sum': '$qty_failed'},
            'report_days': {'$addToSet': '$report_date'},
            'jobs': {'$addToSet': '$cmt_job_id'},
        }}
    ]
    result = await db.dewi_cmt_progress_reports.aggregate(pipeline).to_list(length=None)
    return {
        'period': month_str,
        'data': [
            {
                'cmt_partner_id': r['_id']['partner_id'],
                'cmt_name': r['_id']['cmt_name'],
                'total_processed': r['total_processed'],
                'total_passed': r['total_passed'],
                'total_failed': r['total_failed'],
                'pass_rate_pct': round(r['total_passed'] / r['total_processed'] * 100, 1) if r['total_processed'] > 0 else 0,
                'active_days': len(r['report_days']),
                'job_count': len(r['jobs']),
            }
            for r in result
        ]
    }


# ──────────────────────────────────────────────────────────────────────────────
# CMT DELIVERY ORDER (DO)
# ──────────────────────────────────────────────────────────────────────────────

@router.post('/delivery-orders')
async def create_delivery_order(payload: CMTDeliveryOrderIn, user: dict = Depends(require_auth)):
    """Buat DO/Surat Jalan ke vendor CMT. Admin Produksi yang buat, tidak perlu approval Finance."""
    db = get_db()

    job = await db.dewi_cmt_jobs.find_one({'id': payload.cmt_job_id})
    if not job:
        raise HTTPException(404, 'CMT Job tidak ditemukan')

    do_number = await _next_do_number(db)
    do_id = _uid()

    doc = {
        'id': do_id,
        'do_number': do_number,
        'cmt_job_id': payload.cmt_job_id,
        'job_code': job.get('job_code', ''),
        'cmt_partner_id': job.get('cmt_partner_id', ''),
        'cmt_name': job.get('cmt_name', ''),
        'production_order_id': payload.production_order_id,
        'maklon_po_id': payload.maklon_po_id,
        'source_type': payload.source_type,
        'do_date': payload.do_date or date.today().isoformat(),
        'items': [
            {
                'line_id': _uid(),
                'material_type': it.material_type,
                'description': it.description,
                'qty': it.qty,
                'unit': it.unit,
                'inventory_ref': it.inventory_ref,
            }
            for it in payload.items
        ],
        'status': 'draft',  # draft|issued|received_by_vendor|cancelled
        'notes': payload.notes or '',
        'created_at': _now(),
        'updated_at': _now(),
        'created_by': user.get('id'),
        'created_by_name': user.get('name', ''),
    }
    await db.dewi_cmt_delivery_orders.insert_one(doc)

    # Link DO to job
    await db.dewi_cmt_jobs.update_one(
        {'id': payload.cmt_job_id},
        {'$push': {'do_ids': do_id}, '$set': {'updated_at': _now()}}
    )

    await log_activity(user.get('id', ''), user.get('name', ''), 'create_do', 'dewi_cmt_delivery_orders',
                       f'Buat DO {do_number} untuk job {job.get("job_code","")}')
    return serialize_doc(doc)


@router.put('/delivery-orders/{do_id}/issue')
async def issue_delivery_order(do_id: str, user: dict = Depends(require_auth)):
    """Issue DO (konfirmasi barang keluar dari gudang)."""
    db = get_db()
    do = await db.dewi_cmt_delivery_orders.find_one({'id': do_id})
    if not do:
        raise HTTPException(404, 'DO tidak ditemukan')
    if do.get('status') != 'draft':
        raise HTTPException(400, 'DO hanya bisa di-issue saat masih draft')

    await db.dewi_cmt_delivery_orders.update_one(
        {'id': do_id},
        {'$set': {
            'status': 'issued',
            'issued_at': _now(),
            'issued_by': user.get('id'),
            'updated_at': _now(),
        }}
    )
    return {'status': 'issued', 'do_number': do['do_number']}


@router.get('/delivery-orders')
async def list_delivery_orders(
    cmt_job_id: Optional[str] = Query(None),
    cmt_partner_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
    user: dict = Depends(require_auth),
):
    """List semua Delivery Order CMT."""
    db = get_db()
    filt = {}
    if cmt_job_id:
        filt['cmt_job_id'] = cmt_job_id
    if cmt_partner_id:
        filt['cmt_partner_id'] = cmt_partner_id
    if status and status != 'all':
        filt['status'] = status
    cursor = db.dewi_cmt_delivery_orders.find(filt).sort('created_at', -1).limit(limit)
    return [serialize_doc(d) async for d in cursor]


@router.get('/delivery-orders/{do_id}')
async def get_delivery_order(do_id: str, user: dict = Depends(require_auth)):
    """Detail satu DO."""
    db = get_db()
    do = await db.dewi_cmt_delivery_orders.find_one({'id': do_id})
    if not do:
        raise HTTPException(404, 'DO tidak ditemukan')
    return serialize_doc(do)


# ──────────────────────────────────────────────────────────────────────────────
# VENDOR PORTAL ENDPOINTS (role=cmt_vendor)
# ──────────────────────────────────────────────────────────────────────────────

@router.get('/vendor/my-jobs')
async def vendor_my_jobs(user: dict = Depends(require_auth)):
    """Vendor CMT lihat job-job yang diassign ke mereka."""
    db = get_db()
    # cmt_vendor_id harus di-link ke user profile
    cmt_partner_id = user.get('cmt_partner_id') or user.get('linked_cmt_partner_id')
    if not cmt_partner_id:
        # fallback: admin lihat semua, vendor lihat milik sendiri
        if user.get('role') in ('admin', 'superadmin', 'owner', 'manager', 'ppic'):
            jobs = await db.dewi_cmt_jobs.find({'status': {'$nin': ['cancelled']}}).sort('created_at', -1).limit(100).to_list(length=None)
        else:
            return []
    else:
        jobs = await db.dewi_cmt_jobs.find(
            {'cmt_partner_id': cmt_partner_id, 'status': {'$nin': ['cancelled']}}
        ).sort('created_at', -1).limit(100).to_list(length=None)

    result = []
    today_str = date.today().isoformat()
    for j in jobs:
        j_doc = serialize_doc(j)
        if j_doc.get('status') in ('assigned', 'in_sewing') and j_doc.get('deadline_date'):
            j_doc['is_overdue'] = j_doc['deadline_date'] < today_str
        # Get progress reports for this job
        reports = await db.dewi_cmt_progress_reports.find(
            {'cmt_job_id': j_doc['id']}
        ).sort('report_date', -1).limit(10).to_list(length=None)
        j_doc['recent_progress'] = [serialize_doc(r) for r in reports]
        result.append(j_doc)
    return result


@router.post('/vendor/progress')
async def vendor_submit_progress(payload: CMTProgressIn, user: dict = Depends(require_auth)):
    """Vendor submit progress langsung (is_vendor_self_report=True otomatis)."""
    payload.is_vendor_self_report = True
    return await create_progress_report(payload, user)


@router.get('/vendor/my-jobs/{job_id}/progress-history')
async def vendor_job_progress_history(
    job_id: str,
    limit: int = 200,
    user: dict = Depends(require_auth)
):
    """
    Vendor CMT: ambil seluruh riwayat progress untuk satu job miliknya (read-only).
    Validasi: job harus dimiliki vendor (cmt_partner_id sesuai user).
    """
    db = get_db()
    cmt_partner_id = user.get('cmt_partner_id') or user.get('linked_cmt_partner_id')
    role = (user.get('role') or '').lower()
    is_admin = role in ('admin', 'superadmin', 'owner', 'manager', 'ppic')

    # Validate job ownership
    job = await db.dewi_cmt_jobs.find_one({'id': job_id})
    if not job:
        raise HTTPException(404, f'Job {job_id} tidak ditemukan')

    if not is_admin:
        if not cmt_partner_id or job.get('cmt_partner_id') != cmt_partner_id:
            raise HTTPException(403, 'Job ini bukan milik vendor Anda')

    # Fetch progress reports
    cursor = (
        db.dewi_cmt_progress_reports
        .find({'cmt_job_id': job_id})
        .sort('report_date', -1)
        .limit(int(limit))
    )
    reports = [serialize_doc(r) async for r in cursor]

    # Aggregate by step
    by_step: dict = {}
    total_processed = 0
    total_passed = 0
    total_failed = 0
    for r in reports:
        step = r.get('process_step', 'unknown')
        if step not in by_step:
            by_step[step] = {
                'step': step,
                'total_processed': 0,
                'total_passed': 0,
                'total_failed': 0,
                'report_count': 0,
            }
        by_step[step]['total_processed'] += int(r.get('qty_processed', 0) or 0)
        by_step[step]['total_passed'] += int(r.get('qty_passed', 0) or 0)
        by_step[step]['total_failed'] += int(r.get('qty_failed', 0) or 0)
        by_step[step]['report_count'] += 1
        total_processed += int(r.get('qty_processed', 0) or 0)
        total_passed += int(r.get('qty_passed', 0) or 0)
        total_failed += int(r.get('qty_failed', 0) or 0)

    return {
        'job': {
            'id': job.get('id'),
            'job_code': job.get('job_code'),
            'product_name': job.get('product_name'),
            'qty': job.get('qty'),
            'qty_processed': job.get('qty_processed'),
            'status': job.get('status'),
            'deadline_date': job.get('deadline_date'),
            'cmt_name': job.get('cmt_name'),
        },
        'reports': reports,
        'summary': {
            'total_reports': len(reports),
            'total_processed': total_processed,
            'total_passed': total_passed,
            'total_failed': total_failed,
            'pass_rate_pct': round(total_passed / total_processed * 100, 1) if total_processed > 0 else 0,
        },
        'by_step': list(by_step.values()),
    }
