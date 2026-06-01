# ruff: noqa: F401
"""
marketing_livehost_hosts.py — LiveHost Profile Management
Extracted from marketing_livehost.py (2278 LOC monolith)

Refactored: Session #11.19 Phase 3.2 Batch #2
Endpoints: POST /livehost, GET /livehost, GET /livehost/{host_id}, PATCH /livehost/{host_id}
"""
from fastapi import APIRouter, HTTPException, Request, Query, Path
from fastapi.responses import StreamingResponse
from database import get_db
from auth import require_auth, serialize_doc, log_activity, hash_password
from routes.marketing_livehost_shared import (
    _uid, _now, _get_user, _create_livehost_token, _decode_livehost_token,
    require_livehost_auth, LiveHostCreate, LiveHostUpdate, ShiftCreate, ShiftUpdate,
    ClockInOut, ShiftPerformanceRecord, ScriptCreate, TrainingCreate, TrainingAssign,
    TrainingComplete, LiveHostLoginIn, UPLOAD_DIR, UUID_PATH_REGEX,
    _notif_insert_ssot, _reshape_lh_notif
)
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, List
import json
import asyncio

_log = logging.getLogger(__name__)

router = APIRouter(prefix='/api/marketing/livehost', tags=['Marketing-LiveHost-Hosts'])

@router.post('')
async def create_livehost(data: LiveHostCreate, request: Request):
    """Admin creates a new LiveHost"""
    await require_auth(request)
    db = get_db()
    
    # Check duplicate email
    if await db.marketing_livehosts.find_one({'email': data.email.lower().strip()}):
        raise HTTPException(400, f"Email '{data.email}' sudah terdaftar")
    
    host = {
        'id': _uid(),
        'name': data.name,
        'email': data.email.lower().strip(),
        'password_hash': hash_password(data.password),
        'phone': data.phone or '',
        'employment_type': data.employment_type,
        'hourly_rate': data.hourly_rate,
        'shift_preferences': data.shift_preferences or [],
        'language_skills': data.language_skills or [],
        'product_expertise': data.product_expertise or [],
        'assigned_account_ids': data.assigned_account_ids or [],
        'status': 'active',
        'notes': data.notes or '',
        'training_completed': [],
        'certification_expiry': {},
        'created_at': _now(),
        'created_by': _get_user(request).get('email', 'system'),
        'last_login_at': None,
    }
    
    await db.marketing_livehosts.insert_one(host)
    
    user = _get_user(request)
    await log_activity(
        user.get('id', 'system'),
        user.get('name') or user.get('email', 'system'),
        'create', 'marketing_livehost',
        f"Created LiveHost: {data.name} ({data.email})"
    )
    
    host_safe = {**host}
    host_safe.pop('password_hash', None)
    return serialize_doc({'message': 'LiveHost berhasil dibuat', 'host': host_safe})


@router.get('')
async def list_livehosts(
    request: Request,
    status: Optional[str] = Query(None),
    employment_type: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
):
    """Admin lists all LiveHosts with filters"""
    await require_auth(request)
    db = get_db()
    
    query = {}
    if status:
        query['status'] = status
    if employment_type:
        query['employment_type'] = employment_type
    if search:
        query['$or'] = [
            {'name': {'$regex': search, '$options': 'i'}},
            {'email': {'$regex': search, '$options': 'i'}},
        ]
    
    hosts = await db.marketing_livehosts.find(
        query, {'_id': 0, 'password_hash': 0}
    ).sort('name', 1).to_list(500)
    
    # Enrich dengan assigned account names
    if hosts:
        account_ids = list(set(aid for h in hosts for aid in h.get('assigned_account_ids', [])))
        if account_ids:
            accounts = await db.marketing_platform_accounts.find(
                {'id': {'$in': account_ids}}, {'_id': 0, 'id': 1, 'account_name': 1}
            ).to_list(500)
            account_map = {a['id']: a['account_name'] for a in accounts}
            for host in hosts:
                host['assigned_accounts'] = [
                    {'id': aid, 'name': account_map.get(aid, 'Unknown')}
                    for aid in host.get('assigned_account_ids', [])
                ]
    
    return serialize_doc(hosts)


# NOTE: Routes for `/{host_id}` (GET/PATCH/DELETE) are intentionally defined at the
# BOTTOM of this file. This is required because FastAPI evaluates routes in
# declaration order: putting `/{host_id}` here would cause static single-segment
# routes like `/shifts`, `/scripts`, `/training` to be incorrectly matched as
# `host_id="shifts"` etc. They are placed at the end so all static routes are
# registered first. See the "DYNAMIC HOST ID ROUTES" section near the end.


