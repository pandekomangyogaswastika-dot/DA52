# ruff: noqa: F401
"""
marketing_livehost_shared.py — Shared Helpers, Models & Constants
Extracted from marketing_livehost.py (2278 LOC monolith)

Refactored: Session #11.19 Phase 3.2 Batch #2
"""
import uuid
import os
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import HTTPException, Request
from pydantic import BaseModel
from database import get_db
from auth import JWT_SECRET
import jwt as pyjwt
import logging

logger = logging.getLogger(__name__)

# Constants
LIVEHOST_TOKEN_AUDIENCE = 'livehost-portal'
LIVEHOST_TOKEN_HOURS = 24
UPLOAD_DIR = '/app/uploads/livehost'
UUID_PATH_REGEX = r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

# Ensure upload directory exists
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(f'{UPLOAD_DIR}/scripts', exist_ok=True)
os.makedirs(f'{UPLOAD_DIR}/training', exist_ok=True)

# Notification SSOT integration
from utils.notif_unified import (  # noqa: E402
    notif_insert as _notif_insert_ssot,
    reshape_as_livehost as _reshape_lh_notif,
)

# Helpers
def _uid():
    return str(uuid.uuid4())

def _now():
    return datetime.now(timezone.utc)

def _get_user(request: Request) -> dict:
    return getattr(request.state, 'user', {"id": "system", "email": "system"})

def _create_livehost_token(host_id: str, host_name: str, host_email: str) -> str:
    """Create JWT token for LiveHost portal authentication"""
    payload = {
        'host_id': host_id,
        'host_name': host_name,
        'host_email': host_email,
        'aud': LIVEHOST_TOKEN_AUDIENCE,
        'exp': datetime.now(timezone.utc) + timedelta(hours=LIVEHOST_TOKEN_HOURS)
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm='HS256')

def _decode_livehost_token(token: str) -> dict:
    """Decode and validate LiveHost JWT token"""
    try:
        return pyjwt.decode(token, JWT_SECRET, algorithms=['HS256'], audience=LIVEHOST_TOKEN_AUDIENCE)
    except pyjwt.PyJWTError as e:
        raise HTTPException(401, f"Invalid token: {str(e)}")

async def require_livehost_auth(request: Request) -> dict:
    """Require valid LiveHost portal authentication"""
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        raise HTTPException(401, "Missing or invalid Authorization header")
    token = auth_header.split(' ', 1)[1]
    return _decode_livehost_token(token)

# Pydantic Models
class LiveHostCreate(BaseModel):
    host_name: str
    host_email: str
    phone: Optional[str] = None
    platform: str = "tiktok"

class LiveHostUpdate(BaseModel):
    host_name: Optional[str] = None
    host_email: Optional[str] = None
    phone: Optional[str] = None
    status: Optional[str] = None

class ShiftCreate(BaseModel):
    host_id: str
    shift_date: str
    start_time: str
    end_time: str
    platform: str = "tiktok"

class ShiftUpdate(BaseModel):
    shift_date: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    status: Optional[str] = None

class ClockInOut(BaseModel):
    host_id: str
    shift_id: str
    action: str  # 'clock_in' or 'clock_out'

class ShiftPerformanceRecord(BaseModel):
    gmv: float
    viewers_peak: int
    orders: int

class ScriptCreate(BaseModel):
    title: str
    content: str
    category: Optional[str] = None

class TrainingCreate(BaseModel):
    title: str
    description: Optional[str] = None
    content_url: Optional[str] = None

class TrainingAssign(BaseModel):
    training_id: str
    host_ids: list

class TrainingComplete(BaseModel):
    notes: Optional[str] = None

class LiveHostLoginIn(BaseModel):
    email: str
    password: str


# ══════════════════════════════════════════════════════════════════════════════
# PORTAL LOGIN RATE-LIMITING (Brute-force protection)
# ══════════════════════════════════════════════════════════════════════════════

# Brute-force protection for portal login
# {identifier: {'attempts': count, 'locked_until': datetime}}
PORTAL_LOGIN_ATTEMPTS: dict = {}
MAX_LOGIN_ATTEMPTS = 5
LOCKOUT_DURATION_MINUTES = 15


# ══════════════════════════════════════════════════════════════════════════════
# LIVEHOST SSE NOTIFICATION SYSTEM
# (Moved here from marketing_livehost_portal.py — Session #11.20 recovery)
# Sub-modules (shifts, training, analytics) need access without circular import.
# ══════════════════════════════════════════════════════════════════════════════

# In-memory subscriber registry: host_id → asyncio.Queue
_livehost_sse_subscribers: dict = {}


async def publish_livehost_notification(
    db,
    *,
    host_id: str,
    type_: str,
    title: str,
    message: str,
    severity: str = 'info',
    link: Optional[str] = None,
):
    """
    Persist a LiveHost notification to SSOT (`notifications`, type='marketing_livehost')
    + push to live SSE subscribers.

    Called from: shift creation/update, training assignment, payment sync, etc.
    """
    nid = _uid()
    norm_severity = severity if severity in ('info', 'success', 'warning', 'error') else 'info'
    notif = {
        'id': nid,
        'host_id': host_id,
        'type': type_,
        'severity': norm_severity,
        'title': title,
        'message': message,
        'link': link,
        'read': False,
        'created_at': _now().isoformat(),
    }
    try:
        await _notif_insert_ssot(
            db,
            id=nid,
            type='marketing_livehost',
            body=message,
            subtype=type_,
            severity=norm_severity,
            title=title,
            channel='sse',
            source_type='marketing_livehost',
            source_id=host_id,
            source_url=link,
            host_id=host_id,
        )
    except Exception:
        # Non-fatal: failure to persist must not break the originating action
        pass

    # Push to live SSE subscribers for this host
    q = _livehost_sse_subscribers.get(host_id)
    if q is not None:
        try:
            q.put_nowait(notif)
        except Exception:
            pass
    return notif
