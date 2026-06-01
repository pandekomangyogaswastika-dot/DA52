"""
P3 TD-010 Part B — Unified Notifications Helper (Session #11.12)
================================================================
Single SSOT helper for the `notifications` collection.

After Session #11.12 (TD-010 Phase B), ALL legacy notification writers
(dewi_notifications, rahaza_notifications, collab_notifications,
marketing_livehost_notifications) have been refactored to call
`notif_insert()` directly. The 4 legacy collections are now empty
and scheduled for removal after a 1-week monitor period via
`migrations/drop_legacy_notif_collections.py`.

This module also exposes BACKWARD-COMPAT reshape helpers used by
the 4 legacy routers to keep their public response schema unchanged
while reading from the SSOT.
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Optional, Any, List
import uuid


VALID_TYPES = {'dewi', 'rahaza', 'collab', 'marketing_livehost'}
VALID_SEVERITIES = {'info', 'success', 'warning', 'error'}
VALID_CHANNELS = {'in_app', 'whatsapp', 'email', 'sse'}


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ─────────────────────────────────────────────────────────────────────────────
# CORE INSERT
# ─────────────────────────────────────────────────────────────────────────────

async def notif_insert(
    db,
    *,
    type: str,
    body: str,
    id: Optional[str] = None,
    subtype: Optional[str] = None,
    severity: str = 'info',
    user_id: Optional[str] = None,
    title: Optional[str] = None,
    channel: str = 'in_app',
    recipient: Optional[str] = None,
    source_type: Optional[str] = None,
    source_id: Optional[str] = None,
    source_url: Optional[str] = None,
    source_ref: Optional[str] = None,
    client_id: Optional[str] = None,
    host_id: Optional[str] = None,
    meta: Optional[dict] = None,
    status: str = 'queued',
    sent_at: Optional[datetime] = None,
    read: bool = False,
    failed_reason: Optional[str] = None,
) -> str:
    """Insert a notification into the SSOT `notifications` collection.

    Returns the new notification id (UUID).

    Arguments:
        type:        Domain discriminator. Must be one of VALID_TYPES.
        body:        Main message body. Required.
        id:          Optional pre-allocated UUID (else generated).
        subtype:     Optional sub-classification (event_type, notif_type, etc.)
        severity:    info|success|warning|error
        user_id:     Recipient user id (None for broadcast)
        title:       Optional title/subject
        channel:     Delivery channel: in_app|whatsapp|email|sse
        recipient:   Phone/email when external delivery (whatsapp/email)
        source_*:    Linking info to originating resource
        client_id:   For dewi external client notifs
        host_id:     For marketing_livehost SSE
        meta:        Free-form metadata dict
        status:      queued|sent|failed|read
        sent_at:     Timestamp the notification was actually sent (channel ack)
        read:        Initial read state (default False)
        failed_reason: Error string when status='failed'
    """
    if type not in VALID_TYPES:
        raise ValueError(f'Invalid notification type {type!r}; must be one of {VALID_TYPES}')
    if severity not in VALID_SEVERITIES:
        severity = 'info'
    if channel not in VALID_CHANNELS:
        channel = 'in_app'

    doc = {
        'id':            id or str(uuid.uuid4()),
        'type':          type,
        'subtype':       subtype,
        'severity':      severity,
        'user_id':       user_id,
        'title':         title,
        'body':          body,
        'channel':       channel,
        'recipient':     recipient,
        'source_type':   source_type,
        'source_id':     source_id,
        'source_url':    source_url,
        'source_ref':    source_ref,
        'client_id':     client_id,
        'host_id':       host_id,
        'meta':          meta or {},
        'status':        status,
        'read':          read,
        'read_at':       None,
        'created_at':    _now(),
        'sent_at':       sent_at,
        'failed_reason': failed_reason,
    }
    await db.notifications.insert_one(doc)
    return doc['id']


# ─────────────────────────────────────────────────────────────────────────────
# READ/COUNT/UPDATE
# ─────────────────────────────────────────────────────────────────────────────

async def notif_mark_read(db, notif_id: str, *, user_id: Optional[str] = None) -> bool:
    """Mark a notification as read. Returns True if a doc was updated.

    For single-recipient notifs (user_id-scoped), pass user_id for safety.
    For multi-recipient rahaza notifs, use update_meta to push to read_by[].
    """
    flt: dict = {'id': notif_id}
    if user_id:
        flt['user_id'] = user_id
    res = await db.notifications.update_one(
        flt,
        {'$set': {'read': True, 'read_at': _now()}},
    )
    return res.modified_count > 0


async def notif_count_unread(
    db, *, user_id: Optional[str] = None, type: Optional[str] = None,
) -> int:
    flt: dict = {'read': False}
    if user_id:
        flt['user_id'] = user_id
    if type:
        flt['type'] = type
    return await db.notifications.count_documents(flt)


async def notif_list(
    db,
    *,
    user_id: Optional[str] = None,
    type: Optional[str] = None,
    severity: Optional[str] = None,
    unread_only: bool = False,
    limit: int = 50,
    skip: int = 0,
) -> list:
    flt: dict = {}
    if user_id:
        flt['user_id'] = user_id
    if type:
        flt['type'] = type
    if severity:
        flt['severity'] = severity
    if unread_only:
        flt['read'] = False
    cursor = (
        db.notifications
        .find(flt, {'_id': 0})
        .sort('created_at', -1)
        .skip(skip)
        .limit(limit)
    )
    return [doc async for doc in cursor]


async def notif_find_one(db, flt: dict) -> Optional[dict]:
    """Get a single notif by arbitrary filter (excludes _id)."""
    return await db.notifications.find_one(flt, {'_id': 0})


async def notif_update_one(db, flt: dict, update: dict) -> int:
    """Apply a Mongo update operator on a single notif. Returns modified count."""
    res = await db.notifications.update_one(flt, update)
    return res.modified_count


async def notif_update_many(db, flt: dict, update: dict) -> int:
    """Apply a Mongo update on multiple notifs. Returns modified count."""
    res = await db.notifications.update_many(flt, update)
    return res.modified_count


async def notif_delete_one(db, flt: dict) -> int:
    """Delete a single notif. Returns delete count."""
    res = await db.notifications.delete_one(flt)
    return res.deleted_count


# ─────────────────────────────────────────────────────────────────────────────
# SERIALIZE
# ─────────────────────────────────────────────────────────────────────────────

def serialize_notif(doc: Any) -> dict:
    """Return a JSON-safe shallow copy (datetimes → ISO strings)."""
    if doc is None:
        return None  # type: ignore
    out = dict(doc)
    out.pop('_id', None)
    for k, v in out.items():
        if isinstance(v, datetime):
            out[k] = v.isoformat()
    return out


# ─────────────────────────────────────────────────────────────────────────────
# BACKWARD-COMPAT RESHAPE HELPERS
# Each helper converts an SSOT doc back into the legacy router's response
# schema so frontend clients continue to receive the same shape.
# ─────────────────────────────────────────────────────────────────────────────

def reshape_as_dewi(doc: dict) -> dict:
    """Reshape SSOT doc → legacy `dewi_notifications` schema."""
    if not doc:
        return {}
    out = dict(doc)
    out.pop('_id', None)
    meta = out.get('meta') or {}
    # Legacy field projection
    return {
        'id':            out.get('id'),
        'channel':       out.get('channel'),
        'recipient':     out.get('recipient'),
        'subject':       out.get('title'),
        'body':          out.get('body'),
        'event_type':    out.get('subtype'),
        'source_ref':    out.get('source_ref'),
        'client_id':     out.get('client_id'),
        'status':        out.get('status'),
        'meta':          {k: v for k, v in meta.items() if k not in ('sent_real', 'sent_mock')},
        'sent_real':     meta.get('sent_real', False),
        'sent_mock':     meta.get('sent_mock', False),
        'created_at':    _to_iso(out.get('created_at')),
        'sent_at':       _to_iso(out.get('sent_at')),
        'failed_reason': out.get('failed_reason'),
    }


def reshape_as_rahaza(doc: dict, *, current_user_id: Optional[str] = None) -> dict:
    """Reshape SSOT doc → legacy `rahaza_notifications` schema.

    Multi-recipient fields (target_roles, target_user_ids, read_by, dismissed,
    dedup_key) are stored in `meta` and reprojected to top-level.
    """
    if not doc:
        return {}
    out = dict(doc)
    out.pop('_id', None)
    meta = out.get('meta') or {}
    read_by = meta.get('read_by') or []
    shaped = {
        'id':              out.get('id'),
        'type':            out.get('subtype'),
        'severity':        out.get('severity'),
        'title':           out.get('title'),
        'message':         out.get('body'),
        'link_module':     meta.get('link_module'),
        'link_id':         out.get('source_id'),
        'target_roles':    meta.get('target_roles') or [],
        'target_user_ids': meta.get('target_user_ids') or [],
        'dedup_key':       meta.get('dedup_key'),
        'read_by':         read_by,
        'dismissed':       bool(meta.get('dismissed', False)),
        'created_at':      _to_iso(out.get('created_at')),
    }
    if current_user_id is not None:
        shaped['read'] = current_user_id in read_by
    return shaped


def reshape_as_collab(doc: dict) -> dict:
    """Reshape SSOT doc → legacy `collab_notifications` schema."""
    if not doc:
        return {}
    out = dict(doc)
    out.pop('_id', None)
    meta = out.get('meta') or {}
    return {
        'notification_id': out.get('id'),
        'user_id':         out.get('user_id'),
        'type':            out.get('subtype'),
        'icon':            meta.get('icon'),
        'title':           out.get('title'),
        'content':         out.get('body'),
        'source_type':     out.get('source_type'),
        'source_id':       out.get('source_id'),
        'source_url':      out.get('source_url'),
        'metadata':        {k: v for k, v in meta.items() if k != 'icon'},
        'read':            bool(out.get('read', False)),
        'read_at':         _to_iso(out.get('read_at')),
        'created_at':      _to_iso(out.get('created_at')),
    }


def reshape_as_livehost(doc: dict) -> dict:
    """Reshape SSOT doc → legacy `marketing_livehost_notifications` schema."""
    if not doc:
        return {}
    out = dict(doc)
    out.pop('_id', None)
    return {
        'id':         out.get('id'),
        'host_id':    out.get('host_id'),
        'type':       out.get('subtype'),
        'severity':   out.get('severity'),
        'title':      out.get('title'),
        'message':    out.get('body'),
        'link':       out.get('source_url'),
        'read':       bool(out.get('read', False)),
        'read_at':    _to_iso(out.get('read_at')),
        'created_at': _to_iso(out.get('created_at')),
    }


def _to_iso(v: Any) -> Optional[str]:
    """Convert datetime → ISO string; pass-through strings/None."""
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.isoformat()
    return v


# ─────────────────────────────────────────────────────────────────────────────
# RAHAZA — multi-recipient helpers (read_by[], dedup, target filtering)
# ─────────────────────────────────────────────────────────────────────────────

async def rahaza_check_dedup(
    db, *, dedup_key: str, within_minutes: int = 10,
) -> Optional[dict]:
    """Check if an active rahaza notif with same dedup_key was created recently."""
    from datetime import timedelta
    if not dedup_key:
        return None
    since = _now() - timedelta(minutes=within_minutes)
    return await db.notifications.find_one({
        'type': 'rahaza',
        'meta.dedup_key': dedup_key,
        'meta.dismissed': {'$ne': True},
        'created_at': {'$gte': since},
    })


async def rahaza_mark_read_by(db, notif_id: str, user_id: str) -> int:
    """Add user_id to meta.read_by[] for a rahaza notif. Returns modified count."""
    res = await db.notifications.update_one(
        {'id': notif_id, 'type': 'rahaza'},
        {'$addToSet': {'meta.read_by': user_id}},
    )
    return res.modified_count


async def rahaza_mark_read_by_many(
    db, notif_ids: List[str], user_id: str,
) -> int:
    """Mark a batch of rahaza notifs as read by user."""
    if not notif_ids:
        return 0
    res = await db.notifications.update_many(
        {'id': {'$in': notif_ids}, 'type': 'rahaza'},
        {'$addToSet': {'meta.read_by': user_id}},
    )
    return res.modified_count


def rahaza_matches_user(notif: dict, user: dict) -> bool:
    """Return True if a rahaza notif (SSOT shape) is visible to user."""
    role = (user.get('role') or '').lower()
    uid = user.get('id') or user.get('user_id') or user.get('sub') or user.get('email')
    meta = notif.get('meta') or {}
    target_users = meta.get('target_user_ids') or []
    target_roles = meta.get('target_roles') or []
    if uid in target_users:
        return True
    if role in target_roles:
        return True
    if role == 'superadmin':
        return True
    if not target_users and not target_roles:
        return True
    return False
