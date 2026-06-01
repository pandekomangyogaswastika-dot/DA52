"""
Admin: Users, Activity Logs, Company Settings, RBAC
Extracted from server.py monolith.
"""
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from database import get_db
from auth import (require_auth, check_role, hash_password, serialize_doc)
from routes.shared import new_id, now
from routes.rahaza_audit import log_audit
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["admin"])

# ─── USERS ───────────────────────────────────────────────────────────────────
@router.get("/users")
async def get_users(request: Request):
    user = await require_auth(request)
    if not check_role(user, ['admin']):
        raise HTTPException(403, 'Forbidden')
    db = get_db()
    return serialize_doc(await db.users.find({}, {'password': 0, '_id': 0}).sort('created_at', -1).to_list(500))

@router.post("/users")
async def create_user(request: Request):
    user = await require_auth(request)
    if user.get('role') != 'superadmin':
        raise HTTPException(403, 'Forbidden')
    db = get_db()
    body = await request.json()
    email = (body.get('email') or '').strip().lower()
    if not email:
        raise HTTPException(400, 'Email wajib diisi.')
    existing = await db.users.find_one({'email': email}, {'_id': 0, 'id': 1})
    if existing:
        raise HTTPException(409, f"Email '{email}' sudah terdaftar.")
    hashed = hash_password(body.get('password', 'User@123'))
    new_user = {'id': new_id(), **body, 'email': email, 'password': hashed, 'status': 'active', 'created_at': now(), 'updated_at': now()}
    try:
        await db.users.insert_one(new_user)
    except Exception as e:
        if 'duplicate key' in str(e).lower() or 'E11000' in str(e):
            raise HTTPException(409, f"Email '{email}' sudah terdaftar.")
        raise HTTPException(500, f"Gagal membuat user: {e}")
    result = {k: v for k, v in new_user.items() if k != 'password'}
    return JSONResponse(serialize_doc(result), status_code=201)

@router.put("/users/{uid}")
async def update_user(uid: str, request: Request):
    user = await require_auth(request)
    if user.get('role') != 'superadmin':
        raise HTTPException(403, 'Forbidden')
    db = get_db()
    body = await request.json()
    body.pop('_id', None)
    body.pop('id', None)
    if body.get('password'):
        body['password'] = hash_password(body['password'])
    await db.users.update_one({'id': uid}, {'$set': {**body, 'updated_at': now()}})
    return serialize_doc(await db.users.find_one({'id': uid}, {'password': 0, '_id': 0}))

@router.delete("/users/{uid}")
async def delete_user(uid: str, request: Request):
    user = await require_auth(request)
    if user.get('role') != 'superadmin':
        raise HTTPException(403, 'Forbidden')
    db = get_db()
    doc = await db.users.find_one({'id': uid})
    if not doc:
        raise HTTPException(404, 'Not found')
    if doc.get('role') == 'superadmin':
        raise HTTPException(403, 'Cannot delete superadmin')
    if doc['id'] == user['id']:
        raise HTTPException(403, 'Cannot delete own account')
    await db.users.delete_one({'id': uid})
    return {'success': True}


# ─── ACTIVITY LOGS ───────────────────────────────────────────────────────────
@router.get("/activity-logs")
async def get_activity_logs(request: Request):
    user = await require_auth(request)
    if not check_role(user, ['admin']):
        raise HTTPException(403, 'Forbidden')
    db = get_db()
    sp = request.query_params
    query = {}
    if sp.get('module'):
        query['module'] = sp['module']
    if sp.get('user_id'):
        query['user_id'] = sp['user_id']  # NEW: filter by user
    limit = int(sp.get('limit', '100'))
    return serialize_doc(await db.activity_logs.find(query, {'_id': 0}).sort('timestamp', -1).limit(limit).to_list(500))

@router.delete("/activity-logs/{log_id}")
async def delete_activity_log(log_id: str, request: Request):
    user = await require_auth(request)
    if user.get('role') != 'superadmin':
        raise HTTPException(403, 'Forbidden')
    db = get_db()
    if log_id == 'all':
        await db.activity_logs.delete_many({})
    else:
        await db.activity_logs.delete_one({'id': log_id})
    return {'success': True}


# ─── COMPANY SETTINGS ────────────────────────────────────────────────────────
@router.get("/company-settings")
async def get_company_settings(request: Request):
    await require_auth(request)
    db = get_db()
    settings = await db.company_settings.find_one({'type': 'general'}, {'_id': 0})
    if not settings:
        settings = {
            'id': new_id(), 'type': 'general',
            'company_name': 'PT Garment ERP System', 'company_address': '',
            'company_phone': '', 'company_email': '', 'company_website': '',
            'company_logo_url': '', 'pdf_header_line1': '', 'pdf_header_line2': '',
            'pdf_footer_text': '', 'created_at': now(), 'updated_at': now()
        }
        await db.company_settings.insert_one(settings)
    return serialize_doc(settings)

@router.post("/company-settings")
async def save_company_settings(request: Request):
    user = await require_auth(request)
    if not check_role(user, ['admin']):
        raise HTTPException(403, 'Forbidden')
    db = get_db()
    body = await request.json()
    existing = await db.company_settings.find_one({'type': 'general'})
    data = {
        'company_name': body.get('company_name', ''), 'company_address': body.get('company_address', ''),
        'company_phone': body.get('company_phone', ''), 'company_email': body.get('company_email', ''),
        'company_website': body.get('company_website', ''), 'company_logo_url': body.get('company_logo_url', ''),
        'pdf_header_line1': body.get('pdf_header_line1', ''), 'pdf_header_line2': body.get('pdf_header_line2', ''),
        'pdf_footer_text': body.get('pdf_footer_text', ''),
        'updated_by': user['name'], 'updated_at': now()
    }
    if existing:
        await db.company_settings.update_one({'type': 'general'}, {'$set': data})
    else:
        await db.company_settings.insert_one({'id': new_id(), 'type': 'general', **data, 'created_at': now()})
    return serialize_doc(await db.company_settings.find_one({'type': 'general'}, {'_id': 0}))


# ─── RBAC ────────────────────────────────────────────────────────────────────
@router.get("/roles")
async def get_roles(request: Request):
    user = await require_auth(request)
    if not check_role(user, ['admin']):
        raise HTTPException(403, 'Forbidden')
    db = get_db()
    roles = await db.roles.find({}, {'_id': 0}).sort('name', 1).to_list(500)
    result = []
    for r in roles:
        perms = await db.role_permissions.find({'role_id': r['id']}, {'_id': 0}).to_list(500)
        result.append({**serialize_doc(r), 'permissions': serialize_doc(perms)})
    return result

@router.post("/roles")
async def create_role(request: Request):
    user = await require_auth(request)
    if user.get('role') != 'superadmin':
        raise HTTPException(403, 'Forbidden')
    db = get_db()
    body = await request.json()
    existing = await db.roles.find_one({'name': body.get('name')})
    if existing:
        raise HTTPException(400, f"Role '{body['name']}' already exists")
    role = {'id': new_id(), 'name': body['name'], 'description': body.get('description', ''),
            'is_system': False, 'created_at': now(), 'updated_at': now()}
    await db.roles.insert_one(role)
    # Assign permissions
    for perm_key in body.get('permissions', []):
        await db.role_permissions.insert_one({
            'id': new_id(), 'role_id': role['id'], 'permission_key': perm_key, 'created_at': now()
        })
    # Audit: role created
    await log_audit(db, entity_type='role', entity_id=role['id'], action='create',
                    before=None, after={**role, 'permissions': body.get('permissions', [])},
                    user=user, request=request)
    return JSONResponse(serialize_doc(role), status_code=201)

@router.put("/roles/{role_id}")
async def update_role(role_id: str, request: Request):
    user = await require_auth(request)
    if user.get('role') != 'superadmin':
        raise HTTPException(403, 'Forbidden')
    db = get_db()
    body = await request.json()
    # Snapshot BEFORE for audit
    before_role = await db.roles.find_one({'id': role_id}, {'_id': 0})
    if not before_role:
        raise HTTPException(404, 'Role not found')
    before_perms = [p['permission_key'] for p in await db.role_permissions.find(
        {'role_id': role_id}, {'_id': 0, 'permission_key': 1}
    ).to_list(500)]

    await db.roles.update_one({'id': role_id}, {'$set': {
        'name': body.get('name'), 'description': body.get('description', ''), 'updated_at': now()
    }})
    if 'permissions' in body:
        await db.role_permissions.delete_many({'role_id': role_id})
        for perm_key in body['permissions']:
            await db.role_permissions.insert_one({
                'id': new_id(), 'role_id': role_id, 'permission_key': perm_key, 'created_at': now()
            })
    after_role = await db.roles.find_one({'id': role_id}, {'_id': 0})
    after_perms = [p['permission_key'] for p in await db.role_permissions.find(
        {'role_id': role_id}, {'_id': 0, 'permission_key': 1}
    ).to_list(500)]
    # Audit: role updated
    await log_audit(db, entity_type='role', entity_id=role_id, action='update',
                    before={**before_role, 'permissions': sorted(before_perms)},
                    after={**after_role, 'permissions': sorted(after_perms)},
                    user=user, request=request)
    return serialize_doc(after_role)

@router.delete("/roles/{role_id}")
async def delete_role(role_id: str, request: Request):
    user = await require_auth(request)
    if user.get('role') != 'superadmin':
        raise HTTPException(403, 'Forbidden')
    db = get_db()
    role = await db.roles.find_one({'id': role_id}, {'_id': 0})
    if not role:
        raise HTTPException(404, 'Role not found')
    if role.get('is_system'):
        raise HTTPException(400, 'Cannot delete system role')
    before_perms = [p['permission_key'] for p in await db.role_permissions.find(
        {'role_id': role_id}, {'_id': 0, 'permission_key': 1}
    ).to_list(500)]
    await db.role_permissions.delete_many({'role_id': role_id})
    await db.roles.delete_one({'id': role_id})
    # Audit: role deleted
    await log_audit(db, entity_type='role', entity_id=role_id, action='delete',
                    before={**role, 'permissions': sorted(before_perms)}, after=None,
                    user=user, request=request)
    return {'success': True}

# ─── Matrix bulk update: replace permissions for a single role ──────────────
@router.put("/roles/{role_id}/permissions")
async def set_role_permissions(role_id: str, request: Request):
    """Bulk replace permissions for a role (used by Matrix UI)."""
    user = await require_auth(request)
    if user.get('role') != 'superadmin':
        raise HTTPException(403, 'Forbidden')
    db = get_db()
    body = await request.json()
    perms = body.get('permissions') or []
    if not isinstance(perms, list):
        raise HTTPException(400, 'permissions must be a list')
    role = await db.roles.find_one({'id': role_id}, {'_id': 0})
    if not role:
        raise HTTPException(404, 'Role not found')
    before_perms = [p['permission_key'] for p in await db.role_permissions.find(
        {'role_id': role_id}, {'_id': 0, 'permission_key': 1}
    ).to_list(500)]
    # Replace all permissions
    await db.role_permissions.delete_many({'role_id': role_id})
    for perm_key in set(perms):
        await db.role_permissions.insert_one({
            'id': new_id(), 'role_id': role_id, 'permission_key': perm_key, 'created_at': now()
        })
    await db.roles.update_one({'id': role_id}, {'$set': {'updated_at': now()}})
    # Audit
    await log_audit(db, entity_type='role', entity_id=role_id, action='permissions_update',
                    before={'permissions': sorted(before_perms)},
                    after={'permissions': sorted(list(set(perms)))},
                    user=user, request=request)
    return {'success': True, 'role_id': role_id, 'count': len(set(perms))}

# ─── Bulk matrix save: update multiple roles in one call ────────────────────
@router.post("/roles/matrix/bulk")
async def bulk_update_roles_matrix(request: Request):
    """Batch replace permissions for many roles (Matrix UI "Save All")."""
    user = await require_auth(request)
    if user.get('role') != 'superadmin':
        raise HTTPException(403, 'Forbidden')
    db = get_db()
    body = await request.json()
    changes = body.get('changes') or []  # [{role_id, permissions: [...]}, ...]
    if not isinstance(changes, list):
        raise HTTPException(400, 'changes must be a list')
    updated = 0
    # Batch prefetch all roles & existing permissions in single queries
    role_ids = [ch.get('role_id') for ch in changes if ch.get('role_id')]
    role_map = {}
    if role_ids:
        async for r in db.roles.find({'id': {'$in': role_ids}}, {'_id': 0}):
            role_map[r['id']] = r
    # Prefetch all existing permissions for all affected roles
    existing_perms_by_role: dict = {}
    if role_ids:
        async for p in db.role_permissions.find(
            {'role_id': {'$in': role_ids}}, {'_id': 0, 'role_id': 1, 'permission_key': 1}
        ):
            existing_perms_by_role.setdefault(p['role_id'], []).append(p['permission_key'])
    for ch in changes:
        role_id = ch.get('role_id')
        perms = ch.get('permissions') or []
        if not role_id or not isinstance(perms, list):
            continue
        role = role_map.get(role_id)
        if not role:
            continue
        before_perms = existing_perms_by_role.get(role_id, [])
        await db.role_permissions.delete_many({'role_id': role_id})
        # Batch insert new permissions
        new_perm_docs = [
            {'id': new_id(), 'role_id': role_id, 'permission_key': perm_key, 'created_at': now()}
            for perm_key in set(perms)
        ]
        if new_perm_docs:
            await db.role_permissions.insert_many(new_perm_docs)
        await db.roles.update_one({'id': role_id}, {'$set': {'updated_at': now()}})
        await log_audit(db, entity_type='role', entity_id=role_id, action='permissions_update',
                        before={'permissions': sorted(before_perms)},
                        after={'permissions': sorted(list(set(perms)))},
                        user=user, request=request)
        updated += 1
    return {'success': True, 'updated': updated}

# ─── Audit convenience: RBAC change history ─────────────────────────────────
@router.get("/roles/audit")
async def get_rbac_audit(request: Request):
    """Return RBAC audit trail (entity_type='role'), newest first."""
    user = await require_auth(request)
    if not check_role(user, ['admin']):
        raise HTTPException(403, 'Forbidden')
    db = get_db()
    sp = request.query_params
    q = {'entity_type': 'role'}
    if sp.get('role_id'):
        q['entity_id'] = sp['role_id']
    if sp.get('action'):
        q['action'] = sp['action']
    limit = min(int(sp.get('limit') or 200), 1000)
    rows = await db.rahaza_audit_logs.find(q, {'_id': 0}).sort('timestamp', -1).limit(limit).to_list(500)
    return {'items': rows, 'total': len(rows)}

@router.get("/permissions")
async def get_permissions(request: Request):
    user = await require_auth(request)
    if not check_role(user, ['admin']):
        raise HTTPException(403, 'Forbidden')
    # PT Rahaza ERP — permission keys by module
    permissions = [
        # Shared
        {"key": "dashboard.view",  "module": "Dashboard",  "description": "Lihat dashboard"},

        # Management · Master Data
        {"key": "products.view",   "module": "Produk",      "description": "Lihat data produk"},
        {"key": "products.create", "module": "Produk",      "description": "Buat produk"},
        {"key": "products.edit",   "module": "Produk",      "description": "Edit produk"},
        {"key": "products.delete", "module": "Produk",      "description": "Hapus produk"},
        {"key": "customers.view",  "module": "Pelanggan",   "description": "Lihat pelanggan"},
        {"key": "customers.manage","module": "Pelanggan",   "description": "Kelola pelanggan"},

        # Management · Administrasi
        {"key": "users.view",      "module": "User",        "description": "Lihat user"},
        {"key": "users.manage",    "module": "User",        "description": "Kelola user"},
        {"key": "roles.manage",    "module": "Role",        "description": "Kelola role & permission"},
        {"key": "activity.view",   "module": "Log",         "description": "Lihat log aktivitas"},
        {"key": "settings.manage", "module": "Settings",    "description": "Kelola pengaturan perusahaan"},
        {"key": "pdf.manage",      "module": "Settings",    "description": "Kelola konfigurasi PDF"},
        {"key": "report.view",     "module": "Laporan",     "description": "Lihat laporan"},
        {"key": "report.export",   "module": "Laporan",     "description": "Export laporan"},

        # Warehouse
        {"key": "wh.receiving.view",   "module": "Gudang", "description": "Lihat penerimaan barang"},
        {"key": "wh.receiving.manage", "module": "Gudang", "description": "Kelola penerimaan barang"},
        {"key": "wh.putaway.manage",   "module": "Gudang", "description": "Kelola put-away"},
        {"key": "wh.opname.manage",    "module": "Gudang", "description": "Kelola stock opname"},
        {"key": "wh.bin.manage",       "module": "Gudang", "description": "Kelola lokasi / bin"},
        {"key": "wh.accessory.manage", "module": "Gudang", "description": "Kelola aksesoris"},

        # Finance
        {"key": "fin.ar.view",      "module": "Finance", "description": "Lihat piutang (AR)"},
        {"key": "fin.ar.manage",    "module": "Finance", "description": "Kelola piutang (AR)"},
        {"key": "fin.ap.view",      "module": "Finance", "description": "Lihat hutang (AP)"},
        {"key": "fin.ap.manage",    "module": "Finance", "description": "Kelola hutang (AP)"},
        {"key": "fin.invoice.view", "module": "Finance", "description": "Lihat invoice"},
        {"key": "fin.invoice.manage","module":"Finance", "description": "Kelola invoice"},
        {"key": "fin.approval.manage","module":"Finance","description": "Approval perubahan invoice"},
        {"key": "fin.payment.view", "module": "Finance", "description": "Lihat pembayaran"},
        {"key": "fin.payment.manage","module":"Finance", "description": "Kelola pembayaran"},
        {"key": "fin.recap.view",   "module": "Finance", "description": "Lihat rekap keuangan"},

        # Produksi (akan aktif mulai Fase 3-6)
        {"key": "prod.dashboard.view", "module": "Produksi", "description": "Lihat dashboard produksi"},
        {"key": "prod.master.manage",  "module": "Produksi", "description": "Kelola master (mesin, shift, line)"},
        {"key": "prod.line.view",      "module": "Produksi", "description": "Lihat line board"},
        {"key": "prod.line.manage",    "module": "Produksi", "description": "Kelola line & assignment"},
        {"key": "prod.process.input",  "module": "Produksi", "description": "Input output per proses"},
        {"key": "prod.wip.view",       "module": "Produksi", "description": "Lihat WIP real-time"},

        # Operator View (/operator)
        {"key": "operator.view",  "module": "Operator", "description": "Akses Operator View"},
        {"key": "operator.input", "module": "Operator", "description": "Input output line (operator)"},

        # HR (Fase 8)
        {"key": "hr.dashboard.view",  "module": "HR", "description": "Lihat dashboard HR"},
        {"key": "hr.employee.view",   "module": "HR", "description": "Lihat karyawan"},
        {"key": "hr.employee.manage", "module": "HR", "description": "Kelola karyawan"},
        {"key": "hr.attendance.manage","module":"HR", "description": "Kelola absensi & shift"},
        {"key": "hr.payroll.view",    "module": "HR", "description": "Lihat payroll"},
        {"key": "hr.payroll.run",     "module": "HR", "description": "Jalankan payroll (borongan/mingguan/bulanan)"},

        # HPP / Costing (Fase 9)
        {"key": "hpp.view",   "module": "HPP", "description": "Lihat HPP"},
        {"key": "hpp.manage", "module": "HPP", "description": "Kelola HPP & parameter costing"},

        # Orders & Work Orders (Fase 5)
        {"key": "orders.view",      "module": "Order",      "description": "Lihat order produksi"},
        {"key": "orders.manage",    "module": "Order",      "description": "Kelola order produksi"},
        {"key": "wo.view",          "module": "Work Order", "description": "Lihat Work Order"},
        {"key": "wo.manage",        "module": "Work Order", "description": "Kelola Work Order"},
        {"key": "bom.view",         "module": "BOM",        "description": "Lihat BOM"},
        {"key": "bom.manage",       "module": "BOM",        "description": "Kelola BOM"},

        # Inventory / Material (Fase 7)
        {"key": "inv.material.view",      "module": "Inventory", "description": "Lihat master material"},
        {"key": "inv.material.manage",    "module": "Inventory", "description": "Kelola master material"},
        {"key": "inv.stock.view",         "module": "Inventory", "description": "Lihat stok & movement"},
        {"key": "inv.material_issue.manage","module":"Inventory", "description": "Issue material ke WO"},

        # Finance Extended (Fase 8.5)
        {"key": "fin.cash.view",          "module": "Finance", "description": "Lihat Cash & Bank"},
        {"key": "fin.cash.manage",        "module": "Finance", "description": "Kelola Cash & Bank"},
        {"key": "fin.expense.view",       "module": "Finance", "description": "Lihat Expenses"},
        {"key": "fin.expense.manage",     "module": "Finance", "description": "Kelola Expenses"},
        {"key": "fin.costcenter.manage",  "module": "Finance", "description": "Kelola Cost Centers"},

        # Sales Closure (Fase 14)
        {"key": "shipment.view",    "module": "Shipment", "description": "Lihat Shipment / Surat Jalan"},
        {"key": "shipment.manage",  "module": "Shipment", "description": "Kelola Shipment / Surat Jalan"},
        {"key": "shipment.dispatch","module": "Shipment", "description": "Dispatch & delivered shipment"},

        # Notifications & Audit
        {"key": "notifications.view", "module": "Sistem", "description": "Lihat notifikasi sistem"},
        {"key": "audit.view",         "module": "Sistem", "description": "Lihat audit trail"},
    ]
    return permissions

