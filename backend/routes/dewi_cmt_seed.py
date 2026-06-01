"""
CV. Dewi Aditya — CMT Vendor Seeding
Seed demo data untuk Vendor CMT Portal testing.
"""
from fastapi import APIRouter, Depends, HTTPException
from database import get_db
from auth import require_auth, hash_password, check_role
from datetime import datetime, timezone, date, timedelta
import uuid
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix='/api/dewi/cmt/seed', tags=['Dewi-CMT-Seed'])

def _uid(): return str(uuid.uuid4())
def _now(): return datetime.now(timezone.utc)


@router.post('/vendor-demo')
async def seed_vendor_demo(user: dict = Depends(require_auth)):
    """
    Seed demo data untuk Vendor CMT Portal:
    - 3 CMT Partners (vendors)
    - 3 Vendor users (vendor1@cmt.com, vendor2@cmt.com, vendor3@cmt.com)
    - 5 CMT Jobs assigned ke vendors
    - 3 Progress reports untuk demo
    """
    if not check_role(user, ['superadmin', 'admin', 'owner'], 'admin.seed'):
        raise HTTPException(403, 'Hanya admin yang bisa seed data')

    db = get_db()
    results = {'partners': [], 'users': [], 'jobs': [], 'progress': []}

    # ─── 1. Seed CMT Partners ───
    partners_data = [
        {'code': 'CMT001', 'name': 'PT Jahit Jaya', 'contact_person': 'Budi Santoso', 'phone': '08123456789', 'address': 'Solo, Jawa Tengah'},
        {'code': 'CMT002', 'name': 'CV Garmen Mitra', 'contact_person': 'Siti Aminah', 'phone': '08234567890', 'address': 'Sragen, Jawa Tengah'},
        {'code': 'CMT003', 'name': 'UD Konveksi Prima', 'contact_person': 'Ahmad Wijaya', 'phone': '08345678901', 'address': 'Klaten, Jawa Tengah'},
    ]

    partner_ids = []
    for p_data in partners_data:
        existing = await db.dewi_cmt_partners.find_one({'code': p_data['code']})
        if existing:
            partner_ids.append(existing['id'])
            results['partners'].append(f"EXISTS: {p_data['name']}")
        else:
            partner_id = _uid()
            await db.dewi_cmt_partners.insert_one({
                'id': partner_id,
                'code': p_data['code'],
                'name': p_data['name'],
                'contact_person': p_data['contact_person'],
                'phone': p_data['phone'],
                'address': p_data['address'],
                'email': f"{p_data['code'].lower()}@cmt.com",
                'status': 'active',
                'payment_terms': 'net_14',
                'bank_account': '',
                'notes': 'Demo partner for vendor portal testing',
                'created_at': _now(),
                'updated_at': _now(),
            })
            partner_ids.append(partner_id)
            results['partners'].append(f"CREATED: {p_data['name']} (ID: {partner_id})")

    # ─── 2. Seed Vendor Users (linked to CMT Partners) ───
    vendor_users_data = [
        {'email': 'vendor1@cmt.com', 'name': 'Vendor CMT 1 (PT Jahit Jaya)', 'password': 'Vendor@123', 'partner_idx': 0},
        {'email': 'vendor2@cmt.com', 'name': 'Vendor CMT 2 (CV Garmen Mitra)', 'password': 'Vendor@123', 'partner_idx': 1},
        {'email': 'vendor3@cmt.com', 'name': 'Vendor CMT 3 (UD Konveksi Prima)', 'password': 'Vendor@123', 'partner_idx': 2},
    ]

    user_ids = []
    for v_data in vendor_users_data:
        existing = await db.users.find_one({'email': v_data['email']})
        if existing:
            # Update cmt_partner_id jika belum ada
            if not existing.get('cmt_partner_id'):
                await db.users.update_one(
                    {'id': existing['id']},
                    {'$set': {'cmt_partner_id': partner_ids[v_data['partner_idx']], 'updated_at': _now()}}
                )
            user_ids.append(existing['id'])
            results['users'].append(f"EXISTS (updated link): {v_data['email']}")
        else:
            user_id = _uid()
            hashed = hash_password(v_data['password'])
            await db.users.insert_one({
                'id': user_id,
                'name': v_data['name'],
                'email': v_data['email'],
                'password': hashed,
                'role': 'cmt_vendor',
                'cmt_partner_id': partner_ids[v_data['partner_idx']],
                'status': 'active',
                'created_at': _now(),
                'updated_at': _now(),
            })
            user_ids.append(user_id)
            results['users'].append(f"CREATED: {v_data['email']} / {v_data['password']} → Partner: {partners_data[v_data['partner_idx']]['name']}")

    # ─── 3. Seed CMT Jobs (assigned ke vendors) ───
    today = date.today()
    jobs_data = [
        {'job_code': 'JOB-2026-001', 'partner_idx': 0, 'qty': 500, 'product': 'Kemeja Pria - Biru', 'deadline_days': 7},
        {'job_code': 'JOB-2026-002', 'partner_idx': 0, 'qty': 300, 'product': 'Blouse Wanita - Putih', 'deadline_days': 10},
        {'job_code': 'JOB-2026-003', 'partner_idx': 1, 'qty': 800, 'product': 'Dress Casual - Merah', 'deadline_days': 14},
        {'job_code': 'JOB-2026-004', 'partner_idx': 1, 'qty': 400, 'product': 'Rok Midi - Hitam', 'deadline_days': 5},
        {'job_code': 'JOB-2026-005', 'partner_idx': 2, 'qty': 600, 'product': 'Celana Chino - Navy', 'deadline_days': 12},
    ]

    job_ids = []
    for j_data in jobs_data:
        existing = await db.dewi_cmt_jobs.find_one({'job_code': j_data['job_code']})
        if existing:
            job_ids.append(existing['id'])
            results['jobs'].append(f"EXISTS: {j_data['job_code']}")
        else:
            job_id = _uid()
            deadline = (today + timedelta(days=j_data['deadline_days'])).isoformat()
            partner_id = partner_ids[j_data['partner_idx']]
            partner_name = partners_data[j_data['partner_idx']]['name']

            await db.dewi_cmt_jobs.insert_one({
                'id': job_id,
                'job_code': j_data['job_code'],
                'cmt_partner_id': partner_id,
                'cmt_name': partner_name,
                'partner_name': partner_name,
                'source': 'internal',
                'production_order_id': None,
                'wo_id': None,
                'product_name': j_data['product'],
                'qty': j_data['qty'],
                'qty_processed': 0,
                'status': 'assigned',
                'job_date': today.isoformat(),
                'deadline_date': deadline,
                'rate_per_pcs': 15000,
                'notes': f'Demo job untuk vendor portal testing - {partner_name}',
                'progress_by_step': {},
                'do_ids': [],
                'created_at': _now(),
                'updated_at': _now(),
                'created_by': user.get('id'),
            })
            job_ids.append(job_id)
            results['jobs'].append(f"CREATED: {j_data['job_code']} → {partner_name} ({j_data['qty']} pcs, deadline: {deadline})")

    # ─── 4. Seed Progress Reports (beberapa untuk demo) ───
    progress_data = [
        {'job_idx': 0, 'date': today.isoformat(), 'step': 'sewing', 'qty': 100, 'vendor': True},
        {'job_idx': 2, 'date': today.isoformat(), 'step': 'sewing', 'qty': 200, 'vendor': True},
        {'job_idx': 4, 'date': (today - timedelta(days=1)).isoformat(), 'step': 'finishing', 'qty': 150, 'vendor': False},
    ]

    for p_data in progress_data:
        job_id = job_ids[p_data['job_idx']]
        job = await db.dewi_cmt_jobs.find_one({'id': job_id})
        
        report_id = _uid()
        await db.dewi_cmt_progress_reports.insert_one({
            'id': report_id,
            'cmt_job_id': job_id,
            'job_code': job['job_code'],
            'cmt_partner_id': job['cmt_partner_id'],
            'cmt_name': job['cmt_name'],
            'report_date': p_data['date'],
            'process_step': p_data['step'],
            'qty_processed': p_data['qty'],
            'qty_passed': p_data['qty'] if p_data['step'] == 'qc' else 0,
            'qty_failed': 0,
            'is_vendor_self_report': p_data['vendor'],
            'reported_by': user.get('id'),
            'reported_by_name': user.get('name', 'Seed Script'),
            'notes': 'Demo progress report',
            'created_at': _now(),
        })
        results['progress'].append(f"CREATED: Progress for {job['job_code']} - {p_data['step']} ({p_data['qty']} pcs)")

        # Update job cumulative progress
        pipeline = [
            {'$match': {'cmt_job_id': job_id}},
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
            {'id': job_id},
            {'$set': {
                'progress_by_step': progress_by_step,
                'qty_processed': sum(r.get('total_processed', 0) for r in result),
                'last_progress_date': max((r['last_report_date'] for r in result), default=None),
                'updated_at': _now(),
            }}
        )

    return {
        'status': 'success',
        'message': 'Vendor CMT demo data seeded',
        'results': results,
        'credentials': [
            {'email': 'vendor1@cmt.com', 'password': 'Vendor@123', 'partner': 'PT Jahit Jaya'},
            {'email': 'vendor2@cmt.com', 'password': 'Vendor@123', 'partner': 'CV Garmen Mitra'},
            {'email': 'vendor3@cmt.com', 'password': 'Vendor@123', 'partner': 'UD Konveksi Prima'},
        ]
    }


@router.delete('/vendor-demo')
async def cleanup_vendor_demo(user: dict = Depends(require_auth)):
    """Cleanup demo data untuk testing ulang."""
    if not check_role(user, ['superadmin', 'admin', 'owner'], 'admin.seed'):
        raise HTTPException(403, 'Hanya admin yang bisa cleanup data')

    db = get_db()
    
    # Delete progress reports
    await db.dewi_cmt_progress_reports.delete_many({'job_code': {'$regex': '^JOB-2026-00[1-5]$'}})
    
    # Delete jobs
    await db.dewi_cmt_jobs.delete_many({'job_code': {'$regex': '^JOB-2026-00[1-5]$'}})
    
    # Delete vendor users
    await db.users.delete_many({'email': {'$regex': '^vendor[1-3]@cmt.com$'}})
    
    # Delete partners (optional - keep if you want)
    # await db.dewi_cmt_partners.delete_many({'code': {'$in': ['CMT001', 'CMT002', 'CMT003']}})
    
    return {'status': 'cleaned', 'message': 'Demo data dihapus (partners tetap ada)'}
