"""
CV. Dewi Aditya — CMT Lifecycle Dashboard (Aggregator)
Phase 29 — Cross-Module Vendor View

Single-pane-of-glass dashboard untuk CMT (Cut-Make-Trim) vendor management:
Vendor-centric view showing all data across modules per CMT partner:
  - Jobs (active/completed/overdue) with throughput KPIs
  - Material Issued (delivery orders + dispatches)
  - Progress History (daily reports)
  - Receipts (CMT returns) with QC status
  - Payments (draft / approved / paid)
  - Performance Metrics (on-time %, defect rate, monthly throughput)

Endpoints:
  GET /api/dewi/cmt/lifecycle              — vendor list with KPIs per vendor
  GET /api/dewi/cmt/lifecycle/summary      — system-wide KPIs strip
  GET /api/dewi/cmt/lifecycle/{vendor_id}  — single-vendor full detail aggregator
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional, Dict, Any
from datetime import datetime, timezone, timedelta, date
from database import get_db
from auth import require_auth, serialize_doc
import logging

log = logging.getLogger(__name__)
router = APIRouter(prefix='/api/dewi/cmt/lifecycle', tags=['Dewi-CMT-Lifecycle'])

# Status buckets
JOB_ACTIVE = ('assigned', 'in_sewing', 'sewing', 'in_progress', 'qc')
JOB_TERMINAL = ('completed', 'cancelled')
PAYMENT_PENDING = ('draft', 'approved')


def _today_iso() -> str:
    return date.today().isoformat()


def _parse_date(v: Optional[str]) -> Optional[date]:
    if not v:
        return None
    try:
        if isinstance(v, date):
            return v
        return date.fromisoformat(str(v)[:10])
    except Exception:
        return None


def _to_iso(dt):
    if dt is None:
        return None
    if isinstance(dt, str):
        return dt
    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()
    return str(dt)


# ─────────────────────────────────────────────────────────────────────────────
# Per-vendor computation
# ─────────────────────────────────────────────────────────────────────────────
async def _compute_vendor_kpis(db, vendor: Dict[str, Any], deep: bool = False) -> Dict[str, Any]:
    """
    Compute KPIs for a single CMT vendor.
    If `deep=True`, also includes job/payment lists (for detail view).
    """
    vid = vendor['id']
    today = date.today()
    last_30 = (today - timedelta(days=30)).isoformat()
    last_90 = (today - timedelta(days=90)).isoformat()

    # ── Jobs ────────────────────────────────────────────────────────────────
    all_jobs = await db.dewi_cmt_jobs.find({'cmt_partner_id': vid}, {'_id': 0}).to_list(length=2000)
    active_jobs = [j for j in all_jobs if (j.get('status') or '').lower() in JOB_ACTIVE]
    completed_jobs = [j for j in all_jobs if (j.get('status') or '').lower() == 'completed']
    cancelled_jobs = [j for j in all_jobs if (j.get('status') or '').lower() == 'cancelled']

    # Overdue logic — active jobs with deadline_date < today
    overdue_jobs = []
    on_time_completed = 0
    late_completed = 0
    for j in all_jobs:
        st = (j.get('status') or '').lower()
        deadline = _parse_date(j.get('deadline_date'))
        if st in JOB_ACTIVE and deadline and deadline < today:
            late_days = (today - deadline).days
            overdue_jobs.append({**j, 'late_days': late_days})
        if st == 'completed' and deadline:
            completed_at = _parse_date(j.get('completed_at') or j.get('updated_at'))
            if completed_at:
                if completed_at <= deadline:
                    on_time_completed += 1
                else:
                    late_completed += 1

    total_completed_with_deadline = on_time_completed + late_completed
    on_time_pct = round((on_time_completed / total_completed_with_deadline) * 100, 1) if total_completed_with_deadline > 0 else None

    total_pcs_active = sum(int(j.get('qty_total', j.get('qty', 0)) or 0) for j in active_jobs)
    total_pcs_completed_ytd = sum(int(j.get('qty_received', j.get('qty_processed', j.get('qty_total', j.get('qty', 0)))) or 0)
                                  for j in completed_jobs
                                  if (j.get('completed_at') or '')[:4] == str(today.year))

    last_30_completed = [j for j in completed_jobs
                         if (j.get('completed_at') or j.get('updated_at') or '')[:10] >= last_30]
    last_90_completed = [j for j in completed_jobs
                         if (j.get('completed_at') or j.get('updated_at') or '')[:10] >= last_90]
    pcs_last_30 = sum(int(j.get('qty_received', j.get('qty_processed', j.get('qty_total', j.get('qty', 0)))) or 0) for j in last_30_completed)
    pcs_last_90 = sum(int(j.get('qty_received', j.get('qty_processed', j.get('qty_total', j.get('qty', 0)))) or 0) for j in last_90_completed)

    # Defects — sum defect_qty / rework_qty from completed jobs
    total_received_for_qc = 0
    total_defects = 0
    for j in completed_jobs:
        total_received_for_qc += int(j.get('qty_received', j.get('qty_processed', 0)) or 0)
        total_defects += int(j.get('defect_qty', 0) or 0) + int(j.get('rework_qty', 0) or 0)
    defect_rate_pct = round((total_defects / total_received_for_qc) * 100, 2) if total_received_for_qc > 0 else None

    # ── Material dispatches (WMS-side) + DOs (Dewi CMT-side) ────────────────
    dispatches_count = await db.wms_cmt_dispatches.count_documents({'partner_id': vid})
    active_dispatches = await db.wms_cmt_dispatches.count_documents(
        {'partner_id': vid, 'status': {'$in': ['dispatched', 'sent', 'in_transit']}}
    )
    dos_count = await db.dewi_cmt_delivery_orders.count_documents({'partner_id': vid})

    # ── CMT Receipts (returns from vendor) ──────────────────────────────────
    receipts_count = await db.cmt_receipts.count_documents({'partner_id': vid})
    receipts_pending_qc = await db.cmt_receipts.count_documents(
        {'partner_id': vid, 'status': {'$in': ['submitted', 'pending_approval', 'in_review']}}
    )

    # ── Payments ────────────────────────────────────────────────────────────
    payments = await db.dewi_cmt_payments.find({'cmt_partner_id': vid}, {'_id': 0}).to_list(length=500)
    total_billed = sum(float(p.get('net_amount', 0) or 0) for p in payments
                       if (p.get('status') or '').lower() != 'cancelled')
    total_paid = sum(float(p.get('net_amount', 0) or 0) for p in payments
                     if (p.get('status') or '').lower() == 'paid')
    outstanding = max(0.0, total_billed - total_paid)
    pending_payments = [p for p in payments if (p.get('status') or '').lower() in PAYMENT_PENDING]
    pending_payments_amt = sum(float(p.get('net_amount', 0) or 0) for p in pending_payments)

    # ── Progress reports (last 30 days) ─────────────────────────────────────
    progress_count_30 = await db.dewi_cmt_progress.count_documents({
        'partner_id': vid,
        'date': {'$gte': last_30},
    })

    kpis = {
        'partner_id': vid,
        'code': vendor.get('code'),
        'name': vendor.get('name'),
        'status': vendor.get('status'),
        'rate_per_pcs': float(vendor.get('rate_per_pcs', 0) or 0),
        'penalty_per_day': float(vendor.get('penalty_per_day', 0) or 0),
        'address': vendor.get('address', ''),
        'contact_phone': vendor.get('contact_phone', '') or vendor.get('phone', ''),

        # Jobs
        'jobs_total': len(all_jobs),
        'jobs_active': len(active_jobs),
        'jobs_completed': len(completed_jobs),
        'jobs_cancelled': len(cancelled_jobs),
        'jobs_overdue': len(overdue_jobs),
        'pcs_in_process': total_pcs_active,
        'pcs_completed_ytd': total_pcs_completed_ytd,
        'pcs_last_30': pcs_last_30,
        'pcs_last_90': pcs_last_90,

        # Performance
        'on_time_pct': on_time_pct,
        'defect_rate_pct': defect_rate_pct,
        'on_time_completed': on_time_completed,
        'late_completed': late_completed,

        # Cross-module
        'dispatches_total': dispatches_count,
        'dispatches_active': active_dispatches,
        'dos_total': dos_count,
        'receipts_total': receipts_count,
        'receipts_pending_qc': receipts_pending_qc,
        'progress_reports_30d': progress_count_30,

        # Financial
        'total_billed': round(total_billed, 2),
        'total_paid': round(total_paid, 2),
        'outstanding': round(outstanding, 2),
        'pending_payments_count': len(pending_payments),
        'pending_payments_amount': round(pending_payments_amt, 2),
    }

    if deep:
        # Sort jobs by created_at desc
        sorted_jobs = sorted(all_jobs, key=lambda j: j.get('created_at') or '', reverse=True)
        # Enrich active jobs with overdue flag
        for j in sorted_jobs:
            st = (j.get('status') or '').lower()
            dl = _parse_date(j.get('deadline_date'))
            if st in JOB_ACTIVE and dl:
                if dl < today:
                    j['is_overdue'] = True
                    j['late_days'] = (today - dl).days
                else:
                    j['is_overdue'] = False
                    j['days_to_deadline'] = (dl - today).days
        # Progress reports
        progress = await db.dewi_cmt_progress.find(
            {'partner_id': vid}, {'_id': 0}
        ).sort('date', -1).limit(60).to_list(length=60)
        # Dispatches
        dispatches = await db.wms_cmt_dispatches.find(
            {'partner_id': vid}, {'_id': 0}
        ).sort('created_at', -1).limit(50).to_list(length=50)
        # DOs
        dos = await db.dewi_cmt_delivery_orders.find(
            {'partner_id': vid}, {'_id': 0}
        ).sort('created_at', -1).limit(50).to_list(length=50)
        # Receipts
        receipts = await db.cmt_receipts.find(
            {'partner_id': vid}, {'_id': 0}
        ).sort('created_at', -1).limit(50).to_list(length=50)
        # Sort payments by created_at desc
        sorted_payments = sorted(payments, key=lambda p: p.get('created_at') or '', reverse=True)

        # Monthly throughput series (last 6 months)
        monthly: Dict[str, Dict[str, Any]] = {}
        for j in completed_jobs:
            completed_at = j.get('completed_at') or j.get('updated_at')
            if not completed_at:
                continue
            ym = str(completed_at)[:7]  # YYYY-MM
            if ym not in monthly:
                monthly[ym] = {'month': ym, 'jobs': 0, 'pcs': 0, 'defects': 0}
            monthly[ym]['jobs'] += 1
            monthly[ym]['pcs'] += int(j.get('qty_received', j.get('qty_processed', j.get('qty_total', j.get('qty', 0)))) or 0)
            monthly[ym]['defects'] += int(j.get('defect_qty', 0) or 0) + int(j.get('rework_qty', 0) or 0)
        monthly_series = sorted(monthly.values(), key=lambda x: x['month'])[-6:]

        return {
            'kpis': kpis,
            'partner': serialize_doc(vendor),
            'jobs': serialize_doc(sorted_jobs[:50]),
            'overdue_jobs': serialize_doc(overdue_jobs[:20]),
            'progress_reports': serialize_doc(progress),
            'dispatches': serialize_doc(dispatches),
            'delivery_orders': serialize_doc(dos),
            'receipts': serialize_doc(receipts),
            'payments': serialize_doc(sorted_payments[:50]),
            'monthly_series': monthly_series,
        }

    return kpis


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────
@router.get('')
async def list_vendor_lifecycle(
    status: Optional[str] = Query(None, description='active|inactive|all'),
    user: dict = Depends(require_auth),
):
    """
    List CMT vendors with KPI strip for each (light aggregate — no deep lists).
    Use this for the picker / overview grid.
    """
    db = get_db()
    filt: Dict[str, Any] = {}
    if status and status != 'all':
        filt['status'] = status
    vendors = await db.dewi_cmt_partners.find(filt, {'_id': 0}).sort('name', 1).to_list(length=500)

    out = []
    for v in vendors:
        kpis = await _compute_vendor_kpis(db, v, deep=False)
        out.append(kpis)
    return {'total': len(out), 'items': out}


@router.get('/summary')
async def lifecycle_summary(user: dict = Depends(require_auth)):
    """System-wide KPIs across ALL CMT vendors (for the header strip)."""
    db = get_db()
    today_iso = _today_iso()
    last_30 = (date.today() - timedelta(days=30)).isoformat()

    total_vendors = await db.dewi_cmt_partners.count_documents({})
    active_vendors = await db.dewi_cmt_partners.count_documents({'status': 'active'})

    # Aggregate jobs across all CMT
    total_active_jobs = await db.dewi_cmt_jobs.count_documents({'status': {'$in': list(JOB_ACTIVE)}})
    total_completed_jobs = await db.dewi_cmt_jobs.count_documents({'status': 'completed'})

    # Overdue
    all_active_jobs = await db.dewi_cmt_jobs.find(
        {'status': {'$in': list(JOB_ACTIVE)}, 'deadline_date': {'$lt': today_iso}},
        {'_id': 0, 'id': 1}
    ).to_list(length=10000)
    overdue_count = len(all_active_jobs)

    # Active pcs in process — sum qty_total of active jobs (use qty as fallback for older docs)
    pcs_pipeline_cursor = db.dewi_cmt_jobs.aggregate([
        {'$match': {'status': {'$in': list(JOB_ACTIVE)}}},
        {'$group': {'_id': None, 'total': {'$sum': {'$ifNull': ['$qty_total', '$qty']}}}}
    ])
    pcs_pipeline = await pcs_pipeline_cursor.to_list(length=1)
    pcs_in_process_total = int(pcs_pipeline[0]['total']) if pcs_pipeline and pcs_pipeline[0].get('total') else 0

    # Material flow
    active_dispatches_total = await db.wms_cmt_dispatches.count_documents(
        {'status': {'$in': ['dispatched', 'sent', 'in_transit']}}
    )
    receipts_pending_total = await db.cmt_receipts.count_documents(
        {'status': {'$in': ['submitted', 'pending_approval', 'in_review']}}
    )

    # Financial across all payments
    payments = await db.dewi_cmt_payments.find({}, {'_id': 0}).to_list(length=10000)
    total_billed_all = sum(float(p.get('net_amount', 0) or 0) for p in payments
                           if (p.get('status') or '').lower() != 'cancelled')
    total_paid_all = sum(float(p.get('net_amount', 0) or 0) for p in payments
                         if (p.get('status') or '').lower() == 'paid')
    outstanding_all = max(0.0, total_billed_all - total_paid_all)
    pending_payments_all = [p for p in payments if (p.get('status') or '').lower() in PAYMENT_PENDING]

    # Throughput last 30 days
    recent_completed_cursor = db.dewi_cmt_jobs.find({
        'status': 'completed',
        'completed_at': {'$gte': last_30}
    }, {'qty_received': 1, 'qty_total': 1, 'qty_processed': 1, 'qty': 1, '_id': 0})
    recent_completed = await recent_completed_cursor.to_list(length=2000)
    pcs_completed_30d = sum(int(j.get('qty_received', j.get('qty_processed', j.get('qty_total', j.get('qty', 0)))) or 0) for j in recent_completed)

    return {
        'as_of': datetime.now(timezone.utc).isoformat(),
        'total_vendors': total_vendors,
        'active_vendors': active_vendors,
        'inactive_vendors': total_vendors - active_vendors,
        'total_active_jobs': total_active_jobs,
        'total_completed_jobs': total_completed_jobs,
        'total_overdue_jobs': overdue_count,
        'total_pcs_in_process': pcs_in_process_total,
        'pcs_completed_30d': pcs_completed_30d,
        'active_dispatches': active_dispatches_total,
        'receipts_pending_qc': receipts_pending_total,
        'total_billed': round(total_billed_all, 2),
        'total_paid': round(total_paid_all, 2),
        'total_outstanding': round(outstanding_all, 2),
        'pending_payments_count': len(pending_payments_all),
        'pending_payments_amount': round(sum(float(p.get('net_amount', 0) or 0) for p in pending_payments_all), 2),
    }


@router.get('/{vendor_id}')
async def vendor_lifecycle_detail(vendor_id: str, user: dict = Depends(require_auth)):
    """
    Single-vendor deep aggregator. Returns all data needed for detail view tabs:
      kpis, partner, jobs[], overdue_jobs[], progress_reports[], dispatches[],
      delivery_orders[], receipts[], payments[], monthly_series[].
    """
    db = get_db()
    vendor = await db.dewi_cmt_partners.find_one({'id': vendor_id}, {'_id': 0})
    if not vendor:
        raise HTTPException(404, 'CMT vendor tidak ditemukan')
    return await _compute_vendor_kpis(db, vendor, deep=True)
