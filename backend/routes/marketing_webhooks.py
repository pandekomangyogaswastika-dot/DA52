"""Marketing Webhooks — Phase 1 POC + Phase 2 MVP.

Endpoints:
  POST /api/marketing/webhooks/tokopedia   — Tokopedia push notification receiver
  POST /api/marketing/webhooks/shopee      — Shopee order webhook receiver
  POST /api/marketing/webhooks/tiktok      — TikTok Shop order webhook
  POST /api/marketing/webhooks/manual      — Manual ingest (test/CSV backfill)
  GET  /api/marketing/webhooks/events      — List events (admin)
  GET  /api/marketing/webhooks/events/{id} — Event detail
  POST /api/marketing/webhooks/events/{id}/reprocess — Retry failed event
  GET  /api/marketing/webhooks/stats       — Stats per platform

Collection: marketing_webhook_events
"""
from __future__ import annotations

import hashlib
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Query, Request
from pydantic import BaseModel

from auth import require_auth, serialize_doc
from database import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/marketing/webhooks", tags=["marketing-webhooks"])


def _uid() -> str:
    return str(uuid.uuid4())


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _idempotency_key(platform: str, event_type: str, payload: dict) -> str:
    raw_id = (
        payload.get("msg_id") or
        payload.get("message_id") or
        (payload.get("data") or {}).get("ordersn") or
        str((payload.get("order") or {}).get("order_id") or "") or
        hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16]
    )
    return f"{platform}:{event_type}:{raw_id}"


async def _is_duplicate(db, key: str) -> bool:
    exists = await db.marketing_webhook_events.find_one({"idempotency_key": key}, {"_id": 1})
    return exists is not None


def _normalize_tokopedia(payload: dict) -> Optional[dict]:
    order = payload.get("order") or {}
    if not order:
        return None
    status_map = {
        0: "pending", 2: "payment_verified", 3: "payment_verified",
        5: "rejected", 6: "cancelled", 10: "new_order",
        400: "packing", 450: "waiting_pickup", 500: "in_transit",
        501: "delivered", 600: "completed",
    }
    return {
        "platform": "tokopedia",
        "platform_order_id": str(order.get("order_id", "")),
        "order_number": order.get("invoice_ref_num", ""),
        "customer_name": (order.get("buyer") or {}).get("name", "Unknown"),
        "status": status_map.get(order.get("order_status", 0), "unknown"),
        "total_amount": float(order.get("total_amount") or 0),
        "items": [
            {
                "sku": p.get("product_id"),
                "name": p.get("name"),
                "qty": p.get("quantity", 0),
                "price": float(p.get("subtotal") or 0),
            }
            for p in (order.get("products") or [])
        ],
        "shipping_deadline": order.get("est_start_delivery", ""),
    }


def _normalize_shopee(payload: dict) -> Optional[dict]:
    data = payload.get("data") or {}
    if not data:
        return None
    return {
        "platform": "shopee",
        "platform_order_id": str(data.get("ordersn", "")),
        "order_number": data.get("ordersn", ""),
        "customer_name": data.get("buyer_username", "Unknown"),
        "status": (data.get("status") or "UNPAID").lower(),
        "total_amount": float(data.get("total_amount") or 0),
        "items": [
            {
                "sku": item.get("item_sku"),
                "name": item.get("item_name"),
                "qty": item.get("model_quantity_purchased", 0),
                "price": float(item.get("model_discounted_price") or 0),
            }
            for item in (data.get("item_list") or [])
        ],
        "shipping_deadline": data.get("ship_by_date", ""),
    }


def _normalize_tiktok(payload: dict) -> Optional[dict]:
    order = payload.get("data") or {}
    return {
        "platform": "tiktok",
        "platform_order_id": str(order.get("order_id", "")),
        "order_number": str(order.get("order_id", "")),
        "customer_name": (order.get("recipient_address") or {}).get("name", "Unknown"),
        "status": (order.get("order_status") or "unpaid").lower(),
        "total_amount": float((order.get("payment") or {}).get("total_amount") or 0),
        "items": [
            {
                "sku": sku.get("seller_sku"),
                "name": sku.get("product_name"),
                "qty": sku.get("quantity", 0),
                "price": float(sku.get("sale_price") or 0),
            }
            for sku in (order.get("item_list") or [])
        ],
        "shipping_deadline": order.get("shipping_due_time", ""),
    }


async def _save_event(
    db,
    platform: str,
    event_type: str,
    payload: dict,
    normalized,
    idem_key: str,
    error=None,
) -> str:
    doc = {
        "id": _uid(),
        "platform": platform,
        "event_type": event_type,
        "payload": payload,
        "idempotency_key": idem_key,
        "normalized_order": normalized,
        "processed": error is None and normalized is not None,
        "error": error,
        "received_at": _now(),
        "created_order_id": None,
    }
    try:
        await db.marketing_webhook_events.insert_one(doc)
    except Exception as e:
        logger.warning("Webhook event save error: %s", e)
    return doc["id"]


async def _maybe_create_order(db, event_id: str, normalized: dict):
    try:
        platform_order_id = normalized.get("platform_order_id", "")
        if not platform_order_id:
            return
        existing = await db.marketing_orders.find_one(
            {"platform_order_id": platform_order_id, "platform": normalized["platform"]},
            {"_id": 0, "id": 1},
        )
        if existing:
            await db.marketing_orders.update_one(
                {"id": existing["id"]},
                {"$set": {"status": normalized["status"], "updated_at": _now(), "webhook_event_id": event_id}},
            )
            return
        order_doc = {
            "id": _uid(),
            "platform": normalized["platform"],
            "platform_order_id": platform_order_id,
            "order_number": normalized.get("order_number", ""),
            "customer_name": normalized.get("customer_name", ""),
            "status": normalized.get("status", "new_order"),
            "total_amount": normalized.get("total_amount", 0),
            "items": normalized.get("items", []),
            "shipping_deadline": normalized.get("shipping_deadline", ""),
            "source": "webhook",
            "webhook_event_id": event_id,
            "created_at": _now(),
            "updated_at": _now(),
        }
        await db.marketing_orders.insert_one(order_doc)
        await db.marketing_webhook_events.update_one(
            {"id": event_id},
            {"$set": {"created_order_id": order_doc["id"]}},
        )
    except Exception as e:
        logger.error("Webhook downstream order creation failed: %s", e)


@router.post("/tokopedia")
async def receive_tokopedia(
    request: Request,
    background_tasks: BackgroundTasks,
    x_tokopedia_hmac_signature: Optional[str] = Header(None),  # noqa: B008
):
    body = await request.body()
    try:
        payload = json.loads(body)
    except Exception:
        raise HTTPException(400, "Invalid JSON")
    db = get_db()
    event_type = payload.get("message") or "order.event"
    idem_key = _idempotency_key("tokopedia", event_type, payload)
    if await _is_duplicate(db, idem_key):
        return {"ok": True, "status": "duplicate", "idempotency_key": idem_key}
    normalized = _normalize_tokopedia(payload)
    error = None if normalized else "Normalization failed"
    event_id = await _save_event(db, "tokopedia", event_type, payload, normalized, idem_key, error)
    if normalized:
        background_tasks.add_task(_maybe_create_order, db, event_id, normalized)
    return {"ok": True, "event_id": event_id, "status": "accepted"}


@router.post("/shopee")
async def receive_shopee(
    request: Request,
    background_tasks: BackgroundTasks,
    x_shopee_signature: Optional[str] = Header(None),  # noqa: B008
):
    body = await request.body()
    try:
        payload = json.loads(body)
    except Exception:
        raise HTTPException(400, "Invalid JSON")
    db = get_db()
    event_type = str(payload.get("code") or "ORDER_STATUS_UPDATE")
    idem_key = _idempotency_key("shopee", event_type, payload)
    if await _is_duplicate(db, idem_key):
        return {"ok": True, "status": "duplicate", "idempotency_key": idem_key}
    normalized = _normalize_shopee(payload)
    error = None if normalized else "Normalization failed"
    event_id = await _save_event(db, "shopee", event_type, payload, normalized, idem_key, error)
    if normalized:
        background_tasks.add_task(_maybe_create_order, db, event_id, normalized)
    return {"ok": True, "event_id": event_id, "status": "accepted"}


@router.post("/tiktok")
async def receive_tiktok(
    request: Request,
    background_tasks: BackgroundTasks,
):
    body = await request.body()
    try:
        payload = json.loads(body)
    except Exception:
        raise HTTPException(400, "Invalid JSON")
    db = get_db()
    event_type = payload.get("type") or "order.event"
    idem_key = _idempotency_key("tiktok", event_type, payload)
    if await _is_duplicate(db, idem_key):
        return {"ok": True, "status": "duplicate", "idempotency_key": idem_key}
    normalized = _normalize_tiktok(payload)
    error = None if normalized else "Normalization failed"
    event_id = await _save_event(db, "tiktok", event_type, payload, normalized, idem_key, error)
    if normalized:
        background_tasks.add_task(_maybe_create_order, db, event_id, normalized)
    return {"ok": True, "event_id": event_id, "status": "accepted"}


class ManualIngestBody(BaseModel):
    platform: str
    event_type: str = "order.new"
    payload: dict


@router.post("/manual")
async def manual_ingest(body: ManualIngestBody, request: Request, background_tasks: BackgroundTasks):
    await require_auth(request)
    db = get_db()
    idem_key = _idempotency_key(body.platform, body.event_type, body.payload)
    if await _is_duplicate(db, idem_key):
        return {"ok": True, "status": "duplicate", "idempotency_key": idem_key}
    normalizers = {
        "tokopedia": _normalize_tokopedia,
        "shopee": _normalize_shopee,
        "tiktok": _normalize_tiktok,
    }
    fn = normalizers.get(body.platform, lambda p: None)
    normalized = fn(body.payload)
    error = None if normalized else f"No normalizer for platform '{body.platform}'"
    event_id = await _save_event(db, body.platform, body.event_type, body.payload, normalized, idem_key, error)
    if normalized:
        background_tasks.add_task(_maybe_create_order, db, event_id, normalized)
    return {"ok": True, "event_id": event_id, "status": "accepted", "normalized": normalized}


@router.get("/events")
async def list_events(
    request: Request,
    platform: Optional[str] = None,
    processed: Optional[bool] = None,
    skip: int = 0,
    limit: int = Query(50, le=200),
):
    await require_auth(request)
    db = get_db()
    filt: dict = {}
    if platform:
        filt["platform"] = platform
    if processed is not None:
        filt["processed"] = processed
    docs = await db.marketing_webhook_events.find(
        filt, {"_id": 0, "payload": 0},
    ).sort("received_at", -1).skip(skip).limit(limit).to_list(limit)
    total = await db.marketing_webhook_events.count_documents(filt)
    return {"ok": True, "total": total, "data": [serialize_doc(d) for d in docs]}


@router.get("/events/{event_id}")
async def get_event(event_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    doc = await db.marketing_webhook_events.find_one({"id": event_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, f"Event {event_id} not found")
    return {"ok": True, "data": serialize_doc(doc)}


@router.post("/events/{event_id}/reprocess")
async def reprocess_event(event_id: str, request: Request, background_tasks: BackgroundTasks):
    await require_auth(request)
    db = get_db()
    doc = await db.marketing_webhook_events.find_one({"id": event_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, f"Event {event_id} not found")
    normalized = doc.get("normalized_order")
    if not normalized:
        platform = doc.get("platform", "")
        payload = doc.get("payload", {})
        normalizers = {"tokopedia": _normalize_tokopedia, "shopee": _normalize_shopee, "tiktok": _normalize_tiktok}
        fn = normalizers.get(platform, lambda p: None)
        normalized = fn(payload)
        if not normalized:
            raise HTTPException(422, "Cannot normalize payload")
        await db.marketing_webhook_events.update_one(
            {"id": event_id},
            {"$set": {"normalized_order": normalized, "error": None, "processed": True}},
        )
    background_tasks.add_task(_maybe_create_order, db, event_id, normalized)
    return {"ok": True, "status": "reprocess_queued"}


@router.get("/stats")
async def webhook_stats(request: Request):
    await require_auth(request)
    db = get_db()
    pipeline = [
        {"$group": {
            "_id": "$platform",
            "total": {"$sum": 1},
            "processed": {"$sum": {"$cond": ["$processed", 1, 0]}},
            "errors": {"$sum": {"$cond": [{"$ne": ["$error", None]}, 1, 0]}},
        }},
        {"$sort": {"total": -1}},
    ]
    rows = await db.marketing_webhook_events.aggregate(pipeline).to_list(20)
    return {
        "ok": True,
        "data": [
            {
                "platform": r["_id"],
                "total": r["total"],
                "processed": r["processed"],
                "errors": r["errors"],
                "success_rate": round(r["processed"] / max(r["total"], 1) * 100, 1),
            }
            for r in rows
        ],
    }
