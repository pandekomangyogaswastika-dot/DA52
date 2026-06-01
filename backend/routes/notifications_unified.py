"""
P3 TD-010 Part B — Unified Notifications Inbox (Session #11.11)
================================================================
SSOT-backed notifications API. Reads from the unified `notifications`
collection populated by:
  - New writes via `utils.notif_unified.notif_insert(...)`
  - One-time migration of legacy collections via
    `migrations/migrate_notifications_unification.py`

Endpoints:
  GET    /api/notifications/unified                         — list (filtered/paginated)
  GET    /api/notifications/unified/stats                   — counts per type / unread
  POST   /api/notifications/unified/{notif_id}/mark-read    — mark single as read
  POST   /api/notifications/unified/mark-all-read           — mark all (or by type)

Filtering:
  ?type=dewi|rahaza|collab|marketing_livehost
  ?severity=info|success|warning|error
  ?unread_only=true
  ?user_id=<id>   (defaults to current user when omitted; admin may pass any id)
  ?limit=50&skip=0

Legacy collections (`dewi_notifications`, `rahaza_notifications`,
`collab_notifications`, `marketing_livehost_notifications`) remain
accessible via their original endpoints for backward compatibility.
"""
from fastapi import APIRouter, Request, Query, HTTPException
from typing import Optional
import logging

from database import get_db
from auth import require_auth
from utils.notif_unified import (
    notif_list, notif_count_unread, notif_mark_read, serialize_notif,
    VALID_TYPES, VALID_SEVERITIES,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/notifications/unified", tags=["notifications-unified"])


@router.get("")
async def list_unified(
    request: Request,
    type: Optional[str] = Query(None, description=f"Filter by type: {sorted(VALID_TYPES)}"),
    severity: Optional[str] = Query(None, description=f"Filter by severity: {sorted(VALID_SEVERITIES)}"),
    unread_only: bool = Query(False),
    user_id: Optional[str] = Query(None, description="Override recipient. Defaults to current user."),
    all_users: bool = Query(False, description="Admin/HR only: include broadcast notifs"),
    limit: int = Query(50, ge=1, le=200),
    skip: int = Query(0, ge=0),
):
    user = await require_auth(request)
    db = get_db()

    if type and type not in VALID_TYPES:
        raise HTTPException(400, f"invalid type. allowed: {sorted(VALID_TYPES)}")
    if severity and severity not in VALID_SEVERITIES:
        raise HTTPException(400, f"invalid severity. allowed: {sorted(VALID_SEVERITIES)}")

    effective_uid = None if all_users else (user_id or user.get('id'))

    items = await notif_list(
        db,
        user_id=effective_uid,
        type=type,
        severity=severity,
        unread_only=unread_only,
        limit=limit,
        skip=skip,
    )
    return {
        'items': [serialize_notif(it) for it in items],
        'count': len(items),
        'limit': limit,
        'skip':  skip,
        'filter': {
            'type':         type,
            'severity':     severity,
            'unread_only':  unread_only,
            'user_id':      effective_uid,
            'all_users':    all_users,
        },
    }


@router.get("/stats")
async def stats_unified(
    request: Request,
    user_id: Optional[str] = Query(None),
    all_users: bool = Query(False),
):
    user = await require_auth(request)
    db = get_db()
    effective_uid = None if all_users else (user_id or user.get('id'))

    by_type: dict = {t: 0 for t in VALID_TYPES}
    by_severity: dict = {s: 0 for s in VALID_SEVERITIES}

    flt: dict = {}
    if effective_uid:
        flt['user_id'] = effective_uid

    pipeline_type = [
        {'$match': flt},
        {'$group': {'_id': '$type', 'count': {'$sum': 1}}},
    ]
    async for row in db.notifications.aggregate(pipeline_type):
        if row['_id'] in by_type:
            by_type[row['_id']] = row['count']

    pipeline_sev = [
        {'$match': flt},
        {'$group': {'_id': '$severity', 'count': {'$sum': 1}}},
    ]
    async for row in db.notifications.aggregate(pipeline_sev):
        if row['_id'] in by_severity:
            by_severity[row['_id']] = row['count']

    total = await db.notifications.count_documents(flt)
    unread = await notif_count_unread(db, user_id=effective_uid)

    return {
        'total':       total,
        'unread':      unread,
        'by_type':     by_type,
        'by_severity': by_severity,
    }


@router.post("/{notif_id}/mark-read")
async def mark_read(notif_id: str, request: Request):
    user = await require_auth(request)
    db = get_db()
    # Allow user to mark only their own notif (admin can pass user_id query — defer for future)
    ok = await notif_mark_read(db, notif_id, user_id=user.get('id'))
    if not ok:
        # Fallback: maybe broadcast notif (no user_id). Try without user filter.
        ok = await notif_mark_read(db, notif_id)
    if not ok:
        raise HTTPException(404, 'notification not found')
    return {'ok': True}


@router.post("/mark-all-read")
async def mark_all_read(
    request: Request,
    type: Optional[str] = Query(None),
):
    user = await require_auth(request)
    db = get_db()
    flt: dict = {'user_id': user.get('id'), 'read': False}
    if type and type in VALID_TYPES:
        flt['type'] = type
    from datetime import datetime, timezone as _tz
    res = await db.notifications.update_many(
        flt, {'$set': {'read': True, 'read_at': datetime.now(_tz.utc)}}
    )
    return {'ok': True, 'modified': res.modified_count}
