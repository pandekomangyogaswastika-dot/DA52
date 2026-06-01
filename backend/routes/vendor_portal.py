"""
Vendor CMT Portal — CV. Dewi Aditya ERP
========================================
Endpoints untuk vendor CMT (sub-kontraktor jahit) agar dapat:
  1. Melihat daftar pekerjaan yang ditugaskan ke mereka
  2. Submit progress harian per pekerjaan
  3. Melihat riwayat progress mereka sendiri

Admin dapat:
  1. Membuat & mengelola vendor partner (entitas vendor)
  2. Membuat & mengelola akun user vendor (role=cmt_vendor)
  3. Melihat semua job & progress lintas vendor

Koleksi baru (additive, tidak ubah koleksi existing):
  vendor_partners        : entitas vendor (nama, kontak)
  vendor_jobs            : pekerjaan yang diassign ke vendor
  vendor_progress_reports: laporan progress dari vendor

Route prefix: /api/vendor-portal
"""

from fastapi import APIRouter, HTTPException, Depends, Query, Request
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, timezone
from database import get_db
from auth import require_auth, serialize_doc, log_activity, hash_password, check_role
from utils.counters import next_counter
import uuid

router = APIRouter(prefix='/api/vendor-portal', tags=['Vendor-Portal'])
logger = __import__('logging').getLogger(__name__)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _now(): return datetime.now(timezone.utc)
def _uid(): return str(uuid.uuid4())

def _require_admin(user: dict):
    if not check_role(user, ['admin', 'superadmin', 'owner', 'manager', 'ppic']):
        raise HTTPException(403, "Hanya admin yang dapat mengakses endpoint ini.")

def _require_vendor(user: dict):
    if user.get('role') != 'cmt_vendor':
        raise HTTPException(403, "Hanya akun vendor yang dapat mengakses endpoint ini.")

def _get_vendor_partner_id(user: dict) -> str:
    vid = user.get('cmt_vendor_id') or ''
    if not vid:
        raise HTTPException(403, "Akun vendor belum terhubung ke partner. Hubungi admin.")
    return vid


# ── Models ────────────────────────────────────────────────────────────────────

class PartnerIn(BaseModel):
    name:         str
    code:         str = ''
    contact_name: str = ''
    contact_phone:str = ''
    address:      str = ''
    notes:        str = ''

class VendorAccountIn(BaseModel):
    email:      str
    name:       str
    password:   str
    partner_id: str  # harus ada partner dulu

class VendorJobIn(BaseModel):
    title:      str               # cth: "Jahit Kemeja Batik - 500 pcs"
    partner_id: str
    wo_id:      str = ''
    wo_number:  str = ''
    qty_target: int = Field(ge=0, default=0)
    due_date:   str = ''
    process:    str = 'SEWING'    # SEWING | FINISHING | QC | EMBROIDERY | ...
    notes:      str = ''

class ProgressIn(BaseModel):
    qty_done:    int = Field(ge=0)
    qty_reject:  int = Field(default=0, ge=0)
    report_date: str = ''         # YYYY-MM-DD, default today
    process_step:str = ''         # tahap spesifik jika berbeda dari job.process
    notes:       str = ''


# ── Startup index ──────────────────────────────────────────────────────────────

async def create_vendor_portal_indexes():
    db = get_db()
    await db.vendor_partners.create_index('code', unique=True, sparse=True)
    await db.vendor_jobs.create_index('partner_id')
    await db.vendor_jobs.create_index('job_number')
    await db.vendor_progress_reports.create_index([('job_id', 1), ('report_date', -1)])
    await db.vendor_progress_reports.create_index('partner_id')


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  ADMIN ENDPOINTS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# ── Partners ──────────────────────────────────────────────────────────────────

@router.get('/partners')
async def list_partners(request: Request):
    user = await require_auth(request)
    _require_admin(user)
    db = get_db()
    docs = await db.vendor_partners.find({}, {'_id': 0}).sort('name', 1).to_list(500)
    # Tambahkan stats per partner
    for p in docs:
        p['job_count']    = await db.vendor_jobs.count_documents({'partner_id': p['id']})
        p['account_count']= await db.users.count_documents({'cmt_vendor_id': p['id']})
    return serialize_doc(docs)


@router.post('/partners')
async def create_partner(payload: PartnerIn, request: Request):
    user = await require_auth(request)
    _require_admin(user)
    db = get_db()
    if payload.code:
        if await db.vendor_partners.find_one({'code': payload.code.upper()}):
            raise HTTPException(400, f"Kode vendor '{payload.code}' sudah digunakan.")
    doc = {
        'id':            _uid(),
        'name':          payload.name.strip(),
        'code':          payload.code.upper().strip() if payload.code else '',
        'contact_name':  payload.contact_name,
        'contact_phone': payload.contact_phone,
        'address':       payload.address,
        'notes':         payload.notes,
        'is_active':     True,
        'created_at':    _now(),
        'created_by':    user['id'],
    }
    await db.vendor_partners.insert_one(doc)
    await log_activity(user['id'], user.get('name',''), f"create_vendor_partner:{doc['name']}", 'vendor_portal', doc['id'])
    return serialize_doc(doc)


@router.put('/partners/{partner_id}')
async def update_partner(partner_id: str, payload: PartnerIn, request: Request):
    user = await require_auth(request)
    _require_admin(user)
    db = get_db()
    partner = await db.vendor_partners.find_one({'id': partner_id})
    if not partner:
        raise HTTPException(404, "Partner tidak ditemukan.")
    update = {
        'name':          payload.name.strip(),
        'contact_name':  payload.contact_name,
        'contact_phone': payload.contact_phone,
        'address':       payload.address,
        'notes':         payload.notes,
        'updated_at':    _now(),
    }
    await db.vendor_partners.update_one({'id': partner_id}, {'$set': update})
    return {'ok': True}


# ── Vendor Accounts ────────────────────────────────────────────────────────────

@router.get('/accounts')
async def list_vendor_accounts(request: Request):
    user = await require_auth(request)
    _require_admin(user)
    db = get_db()
    users = await db.users.find({'role': 'cmt_vendor'}, {'_id': 0, 'password': 0}).sort('name', 1).to_list(500)
    # Enrich dengan nama partner
    partner_ids = {u.get('cmt_vendor_id') for u in users if u.get('cmt_vendor_id')}
    partner_map = {}
    if partner_ids:
        async for p in db.vendor_partners.find({'id': {'$in': list(partner_ids)}}, {'_id': 0, 'id': 1, 'name': 1}):
            partner_map[p['id']] = p['name']
    for u in users:
        u['partner_name'] = partner_map.get(u.get('cmt_vendor_id'), '—')
    return serialize_doc(users)


@router.post('/accounts')
async def create_vendor_account(payload: VendorAccountIn, request: Request):
    user = await require_auth(request)
    _require_admin(user)
    db = get_db()
    # Cek partner exists
    partner = await db.vendor_partners.find_one({'id': payload.partner_id})
    if not partner:
        raise HTTPException(400, "Partner ID tidak ditemukan. Buat partner dulu.")
    # Cek email unik
    if await db.users.find_one({'email': payload.email.lower()}):
        raise HTTPException(400, f"Email '{payload.email}' sudah terdaftar.")
    doc = {
        'id':             _uid(),
        'email':          payload.email.lower().strip(),
        'name':           payload.name.strip(),
        'password':       hash_password(payload.password),
        'role':           'cmt_vendor',
        'cmt_vendor_id':  payload.partner_id,
        'is_active':      True,
        'created_at':     _now(),
        'created_by':     user['id'],
    }
    await db.users.insert_one(doc)
    await log_activity(user['id'], user.get('name',''), f"create_vendor_account:{payload.email}", 'vendor_portal', doc['id'])
    safe = {k: v for k, v in doc.items() if k != 'password'}
    return serialize_doc(safe)


@router.delete('/accounts/{account_id}')
async def deactivate_vendor_account(account_id: str, request: Request):
    user = await require_auth(request)
    _require_admin(user)
    db = get_db()
    acc = await db.users.find_one({'id': account_id, 'role': 'cmt_vendor'})
    if not acc:
        raise HTTPException(404, "Akun vendor tidak ditemukan.")
    await db.users.update_one({'id': account_id}, {'$set': {'is_active': False}})
    return {'ok': True}


# ── Jobs (admin view) ──────────────────────────────────────────────────────────

@router.get('/jobs')
async def list_all_jobs(
    request: Request,
    partner_id: str = Query(default=''),
    status:     str = Query(default=''),
):
    user = await require_auth(request)
    _require_admin(user)
    db = get_db()
    filt: dict = {}
    if partner_id: filt['partner_id'] = partner_id
    if status:     filt['status']     = status
    jobs = await db.vendor_jobs.find(filt, {'_id': 0}).sort('created_at', -1).to_list(500)
    return serialize_doc(jobs)


@router.post('/jobs')
async def create_job(payload: VendorJobIn, request: Request):
    user = await require_auth(request)
    _require_admin(user)
    db = get_db()
    partner = await db.vendor_partners.find_one({'id': payload.partner_id})
    if not partner:
        raise HTTPException(400, "Partner ID tidak ditemukan.")
    num = await next_counter(db, 'vendor_job', namespace='vendor_portal')
    doc = {
        'id':          _uid(),
        'job_number':  f'VJ-{num:05d}',
        'title':       payload.title.strip(),
        'partner_id':  payload.partner_id,
        'partner_name': partner.get('name', ''),
        'wo_id':       payload.wo_id,
        'wo_number':   payload.wo_number,
        'qty_target':  payload.qty_target,
        'qty_done':    0,
        'due_date':    payload.due_date,
        'process':     payload.process.upper(),
        'notes':       payload.notes,
        'status':      'open',      # open | in_progress | done | cancelled
        'created_at':  _now(),
        'created_by':  user['id'],
    }
    await db.vendor_jobs.insert_one(doc)
    await log_activity(user['id'], user.get('name',''), f"create_vendor_job:{doc['job_number']}", 'vendor_portal', doc['id'])
    return serialize_doc(doc)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  VENDOR SELF-SERVICE ENDPOINTS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

@router.get('/me')
async def vendor_me(request: Request):
    """Profil vendor yang sedang login."""
    user = await require_auth(request)
    _require_vendor(user)
    db = get_db()
    partner_id = user.get('cmt_vendor_id', '')
    partner    = None
    if partner_id:
        partner = await db.vendor_partners.find_one({'id': partner_id}, {'_id': 0})
    return serialize_doc({
        'id':     user['id'],
        'name':   user.get('name', ''),
        'email':  user.get('email', ''),
        'role':   user.get('role', ''),
        'partner': serialize_doc(partner) if partner else None,
    })


@router.get('/my-jobs')
async def vendor_my_jobs(
    request: Request,
    status: str = Query(default=''),
):
    """Daftar pekerjaan yang ditugaskan ke vendor ini."""
    user = await require_auth(request)
    _require_vendor(user)
    partner_id = _get_vendor_partner_id(user)
    db = get_db()
    filt: dict = {'partner_id': partner_id}
    if status: filt['status'] = status
    jobs = await db.vendor_jobs.find(filt, {'_id': 0}).sort('created_at', -1).to_list(200)
    # Tambah total progress per job
    for j in jobs:
        total = await db.vendor_progress_reports.aggregate([
            {'$match': {'job_id': j['id']}},
            {'$group': {'_id': None, 'total_done': {'$sum': '$qty_done'}, 'total_reject': {'$sum': '$qty_reject'}}},
        ]).to_list(1)
        j['reported_qty_done']   = total[0]['total_done']   if total else 0
        j['reported_qty_reject'] = total[0]['total_reject'] if total else 0
    return serialize_doc(jobs)


@router.get('/my-jobs/{job_id}')
async def vendor_job_detail(job_id: str, request: Request):
    """Detail satu pekerjaan milik vendor."""
    user = await require_auth(request)
    _require_vendor(user)
    partner_id = _get_vendor_partner_id(user)
    db = get_db()
    job = await db.vendor_jobs.find_one({'id': job_id, 'partner_id': partner_id}, {'_id': 0})
    if not job:
        raise HTTPException(404, "Pekerjaan tidak ditemukan atau bukan milik vendor ini.")
    # Progress summary
    total = await db.vendor_progress_reports.aggregate([
        {'$match': {'job_id': job_id}},
        {'$group': {'_id': None, 'total_done': {'$sum': '$qty_done'}, 'total_reject': {'$sum': '$qty_reject'}, 'report_count': {'$sum': 1}}},
    ]).to_list(1)
    job['reported_qty_done']   = total[0]['total_done']   if total else 0
    job['reported_qty_reject'] = total[0]['total_reject'] if total else 0
    job['report_count']        = total[0]['report_count'] if total else 0
    # Progress percentage
    target = job.get('qty_target', 0)
    job['progress_pct'] = round(job['reported_qty_done'] / target * 100, 1) if target > 0 else 0
    return serialize_doc(job)


@router.post('/my-jobs/{job_id}/progress')
async def vendor_submit_progress(job_id: str, payload: ProgressIn, request: Request):
    """Vendor submit progress harian untuk satu job."""
    user = await require_auth(request)
    _require_vendor(user)
    partner_id = _get_vendor_partner_id(user)
    db = get_db()
    # Verifikasi kepemilikan job
    job = await db.vendor_jobs.find_one({'id': job_id, 'partner_id': partner_id})
    if not job:
        raise HTTPException(404, "Pekerjaan tidak ditemukan atau bukan milik vendor ini.")
    if job.get('status') in ('done', 'cancelled'):
        raise HTTPException(400, f"Pekerjaan sudah berstatus '{job['status']}', tidak bisa update progress.")
    if payload.qty_done <= 0:
        raise HTTPException(400, "qty_done harus lebih dari 0.")
    if payload.qty_reject > payload.qty_done:
        raise HTTPException(400, "qty_reject tidak boleh melebihi qty_done.")
    report_date = payload.report_date or _now().date().isoformat()
    doc = {
        'id':           _uid(),
        'job_id':       job_id,
        'job_number':   job.get('job_number', ''),
        'partner_id':   partner_id,
        'qty_done':     payload.qty_done,
        'qty_reject':   payload.qty_reject,
        'qty_pass':     payload.qty_done - payload.qty_reject,
        'report_date':  report_date,
        'process_step': (payload.process_step or job.get('process', '')).upper(),
        'notes':        payload.notes,
        'submitted_by': user['id'],
        'submitted_name': user.get('name', ''),
        'submitted_at': _now(),
        'source':       'vendor_self_report',
    }
    await db.vendor_progress_reports.insert_one(doc)
    # Update job.qty_done (kumulatif) dan set status in_progress
    total_done = (await db.vendor_progress_reports.aggregate([
        {'$match': {'job_id': job_id}},
        {'$group': {'_id': None, 'total': {'$sum': '$qty_done'}}},
    ]).to_list(1))
    new_total = total_done[0]['total'] if total_done else doc['qty_done']
    target    = job.get('qty_target', 0)
    new_status = 'done' if (target > 0 and new_total >= target) else 'in_progress'
    await db.vendor_jobs.update_one({'id': job_id}, {'$set': {'qty_done': new_total, 'status': new_status, 'updated_at': _now()}})
    await log_activity(user['id'], user.get('name',''), f"vendor_progress:{job['job_number']}:qty={payload.qty_done}", 'vendor_portal', job_id)
    return serialize_doc({**doc, 'job_status': new_status, 'cumulative_done': new_total})


@router.get('/my-jobs/{job_id}/progress-history')
async def vendor_progress_history(job_id: str, request: Request):
    """Riwayat progress yang sudah disubmit vendor untuk satu job."""
    user = await require_auth(request)
    _require_vendor(user)
    partner_id = _get_vendor_partner_id(user)
    db = get_db()
    # Verifikasi kepemilikan
    if not await db.vendor_jobs.find_one({'id': job_id, 'partner_id': partner_id}):
        raise HTTPException(404, "Pekerjaan tidak ditemukan.")
    reports = await db.vendor_progress_reports.find(
        {'job_id': job_id}, {'_id': 0}
    ).sort('submitted_at', -1).to_list(200)
    return serialize_doc(reports)


@router.delete('/my-jobs/{job_id}/progress/{report_id}')
async def vendor_delete_progress(job_id: str, report_id: str, request: Request):
    """Hapus 1 entry progress (hanya entry hari ini & milik sendiri)."""
    user = await require_auth(request)
    _require_vendor(user)
    partner_id = _get_vendor_partner_id(user)
    db = get_db()
    report = await db.vendor_progress_reports.find_one({'id': report_id, 'job_id': job_id, 'partner_id': partner_id})
    if not report:
        raise HTTPException(404, "Progress tidak ditemukan.")
    # Hanya boleh hapus entry hari ini
    today = _now().date().isoformat()
    if report.get('report_date') != today:
        raise HTTPException(400, "Hanya bisa menghapus progress yang diinput hari ini.")
    await db.vendor_progress_reports.delete_one({'id': report_id})
    # Recalculate cumulative
    total = await db.vendor_progress_reports.aggregate([
        {'$match': {'job_id': job_id}},
        {'$group': {'_id': None, 'total': {'$sum': '$qty_done'}}},
    ]).to_list(1)
    new_total = total[0]['total'] if total else 0
    job = await db.vendor_jobs.find_one({'id': job_id})
    target = job.get('qty_target', 0) if job else 0
    new_status = 'done' if (target > 0 and new_total >= target) else ('in_progress' if new_total > 0 else 'open')
    await db.vendor_jobs.update_one({'id': job_id}, {'$set': {'qty_done': new_total, 'status': new_status}})
    return {'ok': True}


# ── Admin: Progress History semua vendor ──────────────────────────────────────

@router.get('/progress-audit')
async def admin_progress_audit(
    request: Request,
    partner_id: str = Query(default=''),
    date_from:  str = Query(default=''),
    date_to:    str = Query(default=''),
    limit:      int = Query(default=100, le=500),
):
    """Admin: Lihat semua progress report dari semua vendor."""
    user = await require_auth(request)
    _require_admin(user)
    db = get_db()
    filt: dict = {}
    if partner_id: filt['partner_id'] = partner_id
    if date_from:  filt.setdefault('report_date', {})['$gte'] = date_from
    if date_to:    filt.setdefault('report_date', {})['$lte'] = date_to
    reports = await db.vendor_progress_reports.find(filt, {'_id': 0}).sort('submitted_at', -1).to_list(limit)
    return serialize_doc(reports)
