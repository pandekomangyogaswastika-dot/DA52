"""
CV. Dewi Aditya Official — CMT (Contract Manufacturing Team) Management

Collections:
  - dewi_cmt_partners   — Database CMT/kontraktor jahit
  - dewi_cmt_jobs       — Job assignment potongan ke CMT
  - dewi_cmt_deliveries — Pengiriman hasil jahit dari CMT ke gudang
  - dewi_cmt_payments   — Pembayaran ongkos jahit ke CMT

Endpoints (all under /api/dewi/cmt):
  GET/POST /partners              — list/create CMT partner
  PUT      /partners/{id}         — update CMT partner
  PUT      /partners/{id}/toggle  — activate/deactivate
  GET/POST /jobs                  — list/create CMT job
  PUT      /jobs/{id}             — update job
  PUT      /jobs/{id}/status      — update job status
  POST     /jobs/{id}/component-request — request komponen dari CMT
  GET/POST /deliveries            — list/create CMT delivery
  PUT      /deliveries/{id}/receive — terima delivery
  GET/POST /payments              — list/create payment batch
  PUT      /payments/{id}/approve — approve payment
  PUT      /payments/{id}/paid    — tandai sudah dibayar
  GET      /summary               — stats
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional, List, Any, Dict
from datetime import date
from database import get_db
from auth import require_auth, serialize_doc, log_activity
from utils.helpers import _uid, _now, _next_code, user_display_name

router = APIRouter(prefix="/api/dewi/cmt", tags=["dewi-cmt"])


async def _auto_code_partner(db) -> str:
    total = await db.dewi_cmt_partners.count_documents({})
    return f"CMT-{str(total + 1).zfill(3)}"


# ══════════════════════════════════════════════════════════════════════════════
# PYDANTIC MODELS
# ══════════════════════════════════════════════════════════════════════════════

class CMTPartnerIn(BaseModel):
    name: str = Field(..., min_length=1)
    owner_name: str = Field(default='')
    phone: str = Field(default='')
    address: str = Field(default='')
    city: str = Field(default='Sragen')
    specialization: List[str] = Field(default_factory=list)
    rate_per_pcs: float = Field(default=0, ge=0)
    capacity_per_week: int = Field(default=0, ge=0)
    bank_name: str = Field(default='')
    bank_account: str = Field(default='')
    bank_holder: str = Field(default='')
    rating: float = Field(default=4.0, ge=0, le=5)
    notes: str = Field(default='')
    penalty_per_day: float = Field(default=0, ge=0)


class CMTPartnerUpdateIn(BaseModel):
    name: Optional[str] = None
    owner_name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    specialization: Optional[List[str]] = None
    rate_per_pcs: Optional[float] = None
    capacity_per_week: Optional[int] = None
    bank_name: Optional[str] = None
    bank_account: Optional[str] = None
    bank_holder: Optional[str] = None
    rating: Optional[float] = None
    notes: Optional[str] = None
    penalty_per_day: Optional[float] = None


class CMTJobIn(BaseModel):
    cmt_partner_id: str = Field(..., min_length=1)
    product_model_name: str = Field(..., min_length=1)
    product_category: str = Field(default='')
    qty_total: int = Field(..., ge=1)
    qty_per_color: List[Dict[str, Any]] = Field(default_factory=list)
    sewing_rate_per_pcs: Optional[float] = None
    penalty_per_day: Optional[float] = None
    cutting_batch_id: str = Field(default='')
    batch_code: str = Field(default='')
    assign_date: Optional[str] = None
    deadline_date: str = Field(..., min_length=1)
    notes: str = Field(default='')
    cmt_name: Optional[str] = None


class CMTJobStatusIn(BaseModel):
    status: str = Field(...)
    delivery_date_actual: Optional[str] = None


class CMTJobUpdateIn(BaseModel):
    qty_per_color: Optional[List[Dict[str, Any]]] = None
    sewing_rate_per_pcs: Optional[float] = None
    deadline_date: Optional[str] = None
    notes: Optional[str] = None
    penalty_per_day: Optional[float] = None
    qty_received: Optional[int] = None
    qc_pass_qty: Optional[int] = None
    qc_reject_qty: Optional[int] = None
    qty_total: Optional[int] = None


class ComponentRequestIn(BaseModel):
    component_name: str = Field(default='')
    qty: float = Field(default=0)
    unit: str = Field(default='pcs')
    reason: str = Field(default='')


class DeliveryIn(BaseModel):
    job_id: str = Field(..., min_length=1)
    qty_delivered: int = Field(default=0, ge=0)
    qty_per_color: List[Dict[str, Any]] = Field(default_factory=list)
    delivery_date: Optional[str] = None
    notes: str = Field(default='')


class DeliveryReceiveIn(BaseModel):
    received_date: Optional[str] = None
    qty_received: Optional[int] = None
    qc_pass_qty: int = Field(default=0, ge=0)
    qc_reject_qty: int = Field(default=0, ge=0)


class PaymentIn(BaseModel):
    cmt_partner_id: str = Field(..., min_length=1)
    cmt_name: Optional[str] = None
    job_ids: List[str] = Field(default_factory=list)
    period_from: Optional[str] = None
    period_to: Optional[str] = None
    subtotal: float = Field(default=0, ge=0)
    total_penalty: float = Field(default=0, ge=0)
    total_pcs: int = Field(default=0, ge=0)
    payment_method: str = Field(default='transfer')
    notes: str = Field(default='')


class PaymentPaidIn(BaseModel):
    payment_date: Optional[str] = None
    payment_method: Optional[str] = None


# ══════════════════════════════════════════════════════════════════════════════
# CMT PARTNERS
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/partners")
async def list_cmt_partners(status: str = None, user: dict = Depends(require_auth)):
    db = get_db()
    filt = {}
    if status and status != 'all':
        filt['status'] = status
    cursor = db.dewi_cmt_partners.find(filt).sort('name', 1)
    return [serialize_doc(d) async for d in cursor]


@router.post("/partners")
async def create_cmt_partner(payload: CMTPartnerIn, user: dict = Depends(require_auth)):
    db = get_db()
    code = await _auto_code_partner(db)
    doc = {
        'id': _uid(),
        'code': code,
        **payload.dict(),
        'status': 'active',
        'created_at': _now(),
        'updated_at': _now(),
    }
    await db.dewi_cmt_partners.insert_one(doc)
    await log_activity(user.get('id', ''), user_display_name(user), 'create', 'dewi_cmt_partners', f"Tambah CMT: {doc['name']}")
    return serialize_doc(doc)


@router.put("/partners/{partner_id}")
async def update_cmt_partner(partner_id: str, payload: CMTPartnerUpdateIn, user: dict = Depends(require_auth)):
    db = get_db()
    doc = await db.dewi_cmt_partners.find_one({'id': partner_id})
    if not doc:
        raise HTTPException(404, 'CMT tidak ditemukan')

    update = {k: v for k, v in payload.dict(exclude_unset=True).items() if v is not None}
    update['updated_at'] = _now()
    await db.dewi_cmt_partners.update_one({'id': partner_id}, {'$set': update})
    await log_activity(user.get('id', ''), user_display_name(user), 'update', 'dewi_cmt_partners', f"Update CMT: {doc['name']}")
    return {'status': 'updated'}


@router.put("/partners/{partner_id}/toggle")
async def toggle_cmt_partner(partner_id: str, user: dict = Depends(require_auth)):
    db = get_db()
    doc = await db.dewi_cmt_partners.find_one({'id': partner_id})
    if not doc:
        raise HTTPException(404, 'CMT tidak ditemukan')
    new_status = 'inactive' if doc['status'] == 'active' else 'active'
    await db.dewi_cmt_partners.update_one({'id': partner_id}, {'$set': {'status': new_status, 'updated_at': _now()}})
    return {'status': new_status}


# ══════════════════════════════════════════════════════════════════════════════
# CMT JOBS
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/jobs")
async def list_cmt_jobs(status: str = None, cmt_id: str = None, user: dict = Depends(require_auth)):
    db = get_db()
    filt = {}
    if status and status != 'all':
        filt['status'] = status
    if cmt_id:
        filt['cmt_partner_id'] = cmt_id
    cursor = db.dewi_cmt_jobs.find(filt).sort('created_at', -1).limit(200)
    jobs = [serialize_doc(d) async for d in cursor]
    # Auto-compute overdue flag
    today_str = date.today().isoformat()
    for j in jobs:
        if j.get('status') in ('assigned', 'in_sewing') and j.get('deadline_date'):
            if j['deadline_date'] < today_str:
                j['is_overdue'] = True
                j['late_days'] = (date.today() - date.fromisoformat(j['deadline_date'])).days
            else:
                j['is_overdue'] = False
                j['late_days'] = 0
        else:
            j['is_overdue'] = False
            j['late_days'] = 0
    return jobs


@router.post("/jobs")
async def create_cmt_job(payload: CMTJobIn, user: dict = Depends(require_auth)):
    db = get_db()
    cmt = await db.dewi_cmt_partners.find_one({'id': payload.cmt_partner_id})
    cmt_name = cmt['name'] if cmt else (payload.cmt_name or '')
    rate = payload.sewing_rate_per_pcs if payload.sewing_rate_per_pcs is not None else (float(cmt['rate_per_pcs']) if cmt else 0.0)
    qty = payload.qty_total
    penalty_per_day = payload.penalty_per_day if payload.penalty_per_day is not None else (float(cmt.get('penalty_per_day', 0)) if cmt else 0.0)

    code = await _next_code(db, 'JOB', 'dewi_cmt_jobs', 'job_code')
    doc = {
        'id': _uid(),
        'job_code': code,
        'cmt_partner_id': payload.cmt_partner_id,
        'cmt_name': cmt_name,
        'cutting_batch_id': payload.cutting_batch_id,
        'batch_code': payload.batch_code,
        'product_model_name': payload.product_model_name,
        'product_category': payload.product_category,
        'qty_total': qty,
        'qty_per_color': payload.qty_per_color,
        'sewing_rate_per_pcs': rate,
        'total_sewing_cost': round(rate * qty, 2),
        'assign_date': payload.assign_date or date.today().isoformat(),
        'deadline_date': payload.deadline_date,
        'delivery_date_actual': None,
        'penalty_per_day': penalty_per_day,
        'total_penalty': 0.0,
        'status': 'assigned',
        'qty_received': 0,
        'qc_pass_qty': 0,
        'qc_reject_qty': 0,
        'component_requests': [],
        'notes': payload.notes,
        'created_at': _now(),
        'updated_at': _now(),
    }
    await db.dewi_cmt_jobs.insert_one(doc)
    if doc['cutting_batch_id']:
        await db.dewi_cutting_batches.update_one(
            {'id': doc['cutting_batch_id']},
            {'$set': {'status': 'assigned_to_cmt', 'updated_at': _now()},
             '$push': {'cmt_assignments': {'job_id': doc['id'], 'job_code': code, 'cmt_name': cmt_name, 'qty': qty}}}
        )
    await log_activity(user.get('id', ''), user_display_name(user), 'create', 'dewi_cmt_jobs', f"Buat job CMT {code} — {cmt_name} {qty} pcs")
    return serialize_doc(doc)


@router.put("/jobs/{job_id}/status")
async def update_job_status(job_id: str, payload: CMTJobStatusIn, user: dict = Depends(require_auth)):
    db = get_db()
    doc = await db.dewi_cmt_jobs.find_one({'id': job_id})
    if not doc:
        raise HTTPException(404, 'Job tidak ditemukan')

    VALID = ['assigned', 'in_sewing', 'done', 'partial', 'cancelled']
    if payload.status not in VALID:
        raise HTTPException(400, f"Status tidak valid. Pilihan: {VALID}")

    update = {'status': payload.status, 'updated_at': _now()}
    if payload.status == 'done' and payload.delivery_date_actual:
        update['delivery_date_actual'] = payload.delivery_date_actual
        deadline = date.fromisoformat(doc['deadline_date'])
        actual = date.fromisoformat(payload.delivery_date_actual)
        if actual > deadline:
            late = (actual - deadline).days
            update['total_penalty'] = round(late * doc.get('penalty_per_day', 0), 2)
        else:
            update['total_penalty'] = 0.0

    await db.dewi_cmt_jobs.update_one({'id': job_id}, {'$set': update})
    await log_activity(user.get('id', ''), user_display_name(user), 'update_status', 'dewi_cmt_jobs', f"Update status job {doc['job_code']} → {payload.status}")
    return {'status': payload.status}


@router.put("/jobs/{job_id}")
async def update_cmt_job(job_id: str, payload: CMTJobUpdateIn, user: dict = Depends(require_auth)):
    db = get_db()
    doc = await db.dewi_cmt_jobs.find_one({'id': job_id})
    if not doc:
        raise HTTPException(404, 'Job tidak ditemukan')

    update = {k: v for k, v in payload.dict(exclude_unset=True).items() if v is not None}
    if 'sewing_rate_per_pcs' in update or 'qty_total' in update:
        rate = float(update.get('sewing_rate_per_pcs', doc['sewing_rate_per_pcs']))
        qty = int(update.get('qty_total', doc['qty_total']))
        update['total_sewing_cost'] = round(rate * qty, 2)
    update['updated_at'] = _now()
    await db.dewi_cmt_jobs.update_one({'id': job_id}, {'$set': update})
    return {'status': 'updated'}


@router.post("/jobs/{job_id}/component-request")
async def add_component_request(job_id: str, payload: ComponentRequestIn, user: dict = Depends(require_auth)):
    db = get_db()
    doc = await db.dewi_cmt_jobs.find_one({'id': job_id})
    if not doc:
        raise HTTPException(404, 'Job tidak ditemukan')

    entry = {
        'id': _uid(),
        'request_date': _now().isoformat(),
        **payload.dict(),
        'status': 'pending',
        'fulfilled_at': None,
    }
    await db.dewi_cmt_jobs.update_one(
        {'id': job_id},
        {'$push': {'component_requests': entry}, '$set': {'updated_at': _now()}}
    )
    await log_activity(user.get('id', ''), user_display_name(user), 'component_request', 'dewi_cmt_jobs', f"Request komponen dari CMT {doc['cmt_name']}: {entry['component_name']}")
    return entry


# ══════════════════════════════════════════════════════════════════════════════
# CMT DELIVERIES
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/deliveries")
async def list_deliveries(status: str = None, user: dict = Depends(require_auth)):
    db = get_db()
    filt = {}
    if status and status != 'all':
        filt['status'] = status
    cursor = db.dewi_cmt_deliveries.find(filt).sort('created_at', -1).limit(200)
    return [serialize_doc(d) async for d in cursor]


@router.post("/deliveries")
async def create_delivery(payload: DeliveryIn, user: dict = Depends(require_auth)):
    db = get_db()
    job = await db.dewi_cmt_jobs.find_one({'id': payload.job_id})
    if not job:
        raise HTTPException(404, 'Job CMT tidak ditemukan')

    code = await _next_code(db, 'DLV', 'dewi_cmt_deliveries', 'delivery_code')
    delivery_date = payload.delivery_date or date.today().isoformat()
    deadline = job['deadline_date']
    is_late = delivery_date > deadline
    late_days = max(0, (date.fromisoformat(delivery_date) - date.fromisoformat(deadline)).days) if is_late else 0
    penalty = round(late_days * float(job.get('penalty_per_day', 0)), 2)

    doc = {
        'id': _uid(),
        'delivery_code': code,
        'job_id': payload.job_id,
        'job_code': job['job_code'],
        'cmt_partner_id': job['cmt_partner_id'],
        'cmt_name': job['cmt_name'],
        'product_model_name': job['product_model_name'],
        'qty_delivered': payload.qty_delivered,
        'qty_per_color': payload.qty_per_color,
        'delivery_date': delivery_date,
        'received_date': None,
        'is_late': is_late,
        'late_days': late_days,
        'penalty_amount': penalty,
        'notes': payload.notes,
        'status': 'pending',
        'created_at': _now(),
        'updated_at': _now(),
    }
    await db.dewi_cmt_deliveries.insert_one(doc)
    qty_total = job['qty_total']
    new_status = 'done' if payload.qty_delivered >= qty_total else 'partial'
    await db.dewi_cmt_jobs.update_one(
        {'id': payload.job_id},
        {'$set': {'status': new_status, 'delivery_date_actual': delivery_date,
                  'total_penalty': penalty, 'updated_at': _now()}}
    )
    await log_activity(user.get('id', ''), user_display_name(user), 'create', 'dewi_cmt_deliveries', f"CMT {job['cmt_name']} kirim {payload.qty_delivered} pcs (Job {job['job_code']})")
    return serialize_doc(doc)


@router.put("/deliveries/{delivery_id}/receive")
async def receive_delivery(delivery_id: str, payload: DeliveryReceiveIn, user: dict = Depends(require_auth)):
    db = get_db()
    doc = await db.dewi_cmt_deliveries.find_one({'id': delivery_id})
    if not doc:
        raise HTTPException(404, 'Delivery tidak ditemukan')
    if doc['status'] == 'verified':
        raise HTTPException(400, 'Delivery sudah diterima')

    update = {
        'status': 'verified',
        'received_date': payload.received_date or date.today().isoformat(),
        'qty_received': payload.qty_received if payload.qty_received is not None else doc['qty_delivered'],
        'qc_pass_qty': payload.qc_pass_qty,
        'qc_reject_qty': payload.qc_reject_qty,
        'updated_at': _now(),
    }
    await db.dewi_cmt_deliveries.update_one({'id': delivery_id}, {'$set': update})
    await db.dewi_cmt_jobs.update_one(
        {'id': doc['job_id']},
        {'$set': {'qty_received': update['qty_received'],
                  'qc_pass_qty': update['qc_pass_qty'],
                  'qc_reject_qty': update['qc_reject_qty'],
                  'updated_at': _now()}}
    )
    await log_activity(user.get('id', ''), user_display_name(user), 'receive', 'dewi_cmt_deliveries', f"Terima {update['qty_received']} pcs dari CMT {doc['cmt_name']}")
    return {'status': 'verified', 'qty_received': update['qty_received']}


# ══════════════════════════════════════════════════════════════════════════════
# CMT PAYMENTS
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/payments")
async def list_payments(status: str = None, user: dict = Depends(require_auth)):
    db = get_db()
    filt = {}
    if status and status != 'all':
        filt['status'] = status
    cursor = db.dewi_cmt_payments.find(filt).sort('created_at', -1).limit(200)
    return [serialize_doc(d) async for d in cursor]


@router.post("/payments")
async def create_payment(payload: PaymentIn, user: dict = Depends(require_auth)):
    db = get_db()
    cmt = await db.dewi_cmt_partners.find_one({'id': payload.cmt_partner_id})
    cmt_name = cmt['name'] if cmt else (payload.cmt_name or '')

    total_pcs = payload.total_pcs
    subtotal = payload.subtotal
    total_penalty = payload.total_penalty
    if payload.job_ids:
        total_pcs = 0
        subtotal = 0.0
        total_penalty = 0.0
        cursor = db.dewi_cmt_jobs.find({'id': {'$in': payload.job_ids}})
        async for j in cursor:
            total_pcs += j.get('qty_received', j.get('qty_total', 0))
            subtotal += float(j.get('total_sewing_cost', 0))
            total_penalty += float(j.get('total_penalty', 0))

    code = await _next_code(db, 'PAY', 'dewi_cmt_payments', 'payment_code')
    net = round(subtotal - total_penalty, 2)
    doc = {
        'id': _uid(),
        'payment_code': code,
        'cmt_partner_id': payload.cmt_partner_id,
        'cmt_name': cmt_name,
        'job_ids': payload.job_ids,
        'period_from': payload.period_from or date.today().isoformat(),
        'period_to': payload.period_to or date.today().isoformat(),
        'total_pcs': total_pcs,
        'subtotal': subtotal,
        'total_penalty': total_penalty,
        'net_amount': net,
        'status': 'draft',
        'payment_date': None,
        'payment_method': payload.payment_method,
        'bank_name': cmt.get('bank_name', '') if cmt else '',
        'bank_account': cmt.get('bank_account', '') if cmt else '',
        'bank_holder': cmt.get('bank_holder', '') if cmt else '',
        'notes': payload.notes,
        'created_at': _now(),
        'updated_at': _now(),
    }
    await db.dewi_cmt_payments.insert_one(doc)
    await log_activity(user.get('id', ''), user_display_name(user), 'create', 'dewi_cmt_payments', f"Buat pembayaran CMT {code} — {cmt_name} Rp {net:,.0f}")
    return serialize_doc(doc)


@router.put("/payments/{pay_id}/approve")
async def approve_payment(pay_id: str, user: dict = Depends(require_auth)):
    db = get_db()
    doc = await db.dewi_cmt_payments.find_one({'id': pay_id})
    if not doc:
        raise HTTPException(404, 'Pembayaran tidak ditemukan')
    if doc['status'] != 'draft':
        raise HTTPException(400, f"Tidak bisa approve status: {doc['status']}")
    await db.dewi_cmt_payments.update_one({'id': pay_id}, {'$set': {'status': 'approved', 'updated_at': _now()}})
    await log_activity(user.get('id', ''), user_display_name(user), 'approve', 'dewi_cmt_payments', f"Approve pembayaran {doc['payment_code']}")
    return {'status': 'approved'}


@router.put("/payments/{pay_id}/paid")
async def mark_payment_paid(pay_id: str, payload: PaymentPaidIn, user: dict = Depends(require_auth)):
    db = get_db()
    doc = await db.dewi_cmt_payments.find_one({'id': pay_id})
    if not doc:
        raise HTTPException(404, 'Pembayaran tidak ditemukan')
    if doc['status'] != 'approved':
        raise HTTPException(400, 'Harus diapprove dulu sebelum ditandai paid')
    await db.dewi_cmt_payments.update_one({'id': pay_id}, {'$set': {
        'status': 'paid',
        'payment_date': payload.payment_date or date.today().isoformat(),
        'payment_method': payload.payment_method or doc.get('payment_method', 'transfer'),
        'updated_at': _now(),
    }})
    await log_activity(user.get('id', ''), user_display_name(user), 'paid', 'dewi_cmt_payments', f"Tandai lunas pembayaran {doc['payment_code']} — {doc['cmt_name']}")
    return {'status': 'paid'}


# ══════════════════════════════════════════════════════════════════════════════
# SUMMARY
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/summary")
async def cmt_summary(user: dict = Depends(require_auth)):
    db = get_db()
    total_cmt    = await db.dewi_cmt_partners.count_documents({'status': 'active'})
    active_jobs  = await db.dewi_cmt_jobs.count_documents({'status': {'$in': ['assigned', 'in_sewing']}})
    done_jobs    = await db.dewi_cmt_jobs.count_documents({'status': 'done'})
    pending_dlv  = await db.dewi_cmt_deliveries.count_documents({'status': 'pending'})
    pending_pay  = await db.dewi_cmt_payments.count_documents({'status': {'$in': ['draft', 'approved']}})
    today = date.today().isoformat()
    overdue = await db.dewi_cmt_jobs.count_documents({
        'status': {'$in': ['assigned', 'in_sewing']},
        'deadline_date': {'$lt': today}
    })
    return {
        'active_cmt': total_cmt,
        'active_jobs': active_jobs,
        'done_jobs': done_jobs,
        'overdue_jobs': overdue,
        'pending_deliveries': pending_dlv,
        'pending_payments': pending_pay,
    }
