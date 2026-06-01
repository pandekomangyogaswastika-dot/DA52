"""
CV. Dewi Aditya — Browser Push Notifications (Web Push / VAPID)

Endpoints:
  GET  /push/vapid-public-key  - Return VAPID public key for frontend subscription
  POST /push/subscribe         - Save push subscription for current user
  POST /push/unsubscribe       - Remove push subscription
  POST /push/test              - Send a test push to current user
  POST /push/send              - (Admin) Send push to all subscribers or specific user_id
"""
import os
import json
import logging
from fastapi import APIRouter, Request, HTTPException
from database import get_db
from auth import require_auth
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent.parent / '.env')

logger = logging.getLogger(__name__)

VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "")
VAPID_PUBLIC_KEY  = os.environ.get("VAPID_PUBLIC_KEY", "")
VAPID_EMAIL       = os.environ.get("VAPID_CLAIMS_EMAIL", "admin@dewi-aditya.com")

router = APIRouter(prefix="/api/push", tags=["push-notifications"])


def _vapid_claims():
    return {"sub": f"mailto:{VAPID_EMAIL}"}


def _send_webpush(subscription_info: dict, payload: dict) -> bool:
    """Send a web push notification. Returns True on success."""
    try:
        from pywebpush import webpush
        webpush(
            subscription_info=subscription_info,
            data=json.dumps(payload),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims=_vapid_claims(),
        )
        return True
    except Exception as e:
        logger.warning(f"Push send failed: {e}")
        return False


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/vapid-public-key")
async def get_vapid_public_key():
    """Return VAPID public key for frontend PushManager.subscribe()."""
    if not VAPID_PUBLIC_KEY:
        raise HTTPException(503, "Web Push not configured.")
    return {"vapid_public_key": VAPID_PUBLIC_KEY}


@router.post("/subscribe")
async def subscribe(request: Request):
    """Save/update push subscription for authenticated user."""
    user = await require_auth(request)
    db = get_db()
    body = await request.json()
    sub = body.get("subscription")
    if not sub or not sub.get("endpoint"):
        raise HTTPException(400, "Invalid subscription object.")
    endpoint = sub["endpoint"]
    # Upsert by (user_id, endpoint)
    await db.push_subscriptions.update_one(
        {"user_id": user["id"], "endpoint": endpoint},
        {"$set": {
            "user_id": user["id"],
            "endpoint": endpoint,
            "keys": sub.get("keys", {}),
            "subscription": sub,
            "user_agent": request.headers.get("user-agent", ""),
        }},
        upsert=True,
    )
    return {"ok": True, "message": "Subscription saved."}


@router.post("/unsubscribe")
async def unsubscribe(request: Request):
    """Remove push subscription."""
    user = await require_auth(request)
    db = get_db()
    body = await request.json()
    endpoint = body.get("endpoint")
    if endpoint:
        await db.push_subscriptions.delete_one({"user_id": user["id"], "endpoint": endpoint})
    else:
        # Remove all subscriptions for user
        await db.push_subscriptions.delete_many({"user_id": user["id"]})
    return {"ok": True}


@router.post("/test")
async def send_test_push(request: Request):
    """Send a test push to the current user's subscriptions."""
    user = await require_auth(request)
    db = get_db()
    subs = await db.push_subscriptions.find({"user_id": user["id"]}, {"_id": 0}).to_list(20)
    if not subs:
        raise HTTPException(404, "Tidak ada subscription aktif. Aktifkan notifikasi browser terlebih dahulu.")
    payload = {
        "title": "CV. Dewi Aditya ERP",
        "body": "Notifikasi browser berhasil diaktifkan!",
        "icon": "/favicon.ico",
        "data": {"url": "/"},
    }
    sent = 0
    failed_endpoints = []
    for s in subs:
        ok = _send_webpush(s["subscription"], payload)
        if ok:
            sent += 1
        else:
            failed_endpoints.append(s["endpoint"])
    # Remove stale subscriptions
    for ep in failed_endpoints:
        await db.push_subscriptions.delete_one({"endpoint": ep})
    return {"ok": True, "sent": sent, "stale_removed": len(failed_endpoints)}


@router.post("/send")
async def send_push(request: Request):
    """(Admin/System) Send push notification to specific user or all subscribers."""
    await require_auth(request)
    db = get_db()
    body = await request.json()
    target_user_id = body.get("user_id")
    title   = body.get("title", "CV. Dewi Aditya")
    message = body.get("body", "")
    url     = body.get("url", "/")
    if not message:
        raise HTTPException(400, "body (pesan) wajib diisi.")
    query = {"user_id": target_user_id} if target_user_id else {}
    subs = await db.push_subscriptions.find(query, {"_id": 0}).to_list(500)
    payload = {"title": title, "body": message, "icon": "/favicon.ico", "data": {"url": url}}
    sent = 0
    stale = []
    for s in subs:
        ok = _send_webpush(s["subscription"], payload)
        if ok:
            sent += 1
        else:
            stale.append(s["endpoint"])
    for ep in stale:
        await db.push_subscriptions.delete_one({"endpoint": ep})
    return {"ok": True, "sent": sent, "total_subs": len(subs), "stale_removed": len(stale)}


@router.get("/status")
async def push_status(request: Request):
    """Check if user has active push subscriptions."""
    user = await require_auth(request)
    db = get_db()
    count = await db.push_subscriptions.count_documents({"user_id": user["id"]})
    return {"active_subscriptions": count, "push_enabled": count > 0}
