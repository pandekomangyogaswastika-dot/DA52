"""
notification_service.py — Unified Notification Service
CV. Dewi Aditya — P1 Service Layer Expansion

Fungsi:
- send_notification(db, user_id, title, body, category, meta) → notif_doc
- send_bulk(db, user_ids, title, body, ...) → count
- mark_read(db, notif_id, user_id) → bool
- get_unread_count(db, user_id) → int
- get_recent(db, user_id, limit) → list
"""
import uuid
from typing import Optional, List
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorDatabase


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def send_notification(
    db: AsyncIOMotorDatabase,
    user_id: str,
    title: str,
    body: str,
    category: str = "system",
    priority: str = "normal",
    meta: Optional[dict] = None,
    link_module: Optional[str] = None,
    link_ref_id: Optional[str] = None,
) -> dict:
    """Kirim 1 notifikasi ke 1 user."""
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "title": title,
        "body": body,
        "category": category,     # approval | leave | material | system | hr | finance
        "priority": priority,     # normal | urgent
        "is_read": False,
        "link_module": link_module,
        "link_ref_id": link_ref_id,
        "meta": meta or {},
        "created_at": _now(),
        "read_at": None,
    }
    await db.dewi_notifications.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


async def send_bulk(
    db: AsyncIOMotorDatabase,
    user_ids: List[str],
    title: str,
    body: str,
    category: str = "system",
    priority: str = "normal",
    meta: Optional[dict] = None,
    link_module: Optional[str] = None,
) -> int:
    """Kirim notifikasi yang sama ke banyak user. Returns count."""
    if not user_ids:
        return 0
    now = _now()
    docs = [
        {
            "id": str(uuid.uuid4()),
            "user_id": uid,
            "title": title,
            "body": body,
            "category": category,
            "priority": priority,
            "is_read": False,
            "link_module": link_module,
            "meta": meta or {},
            "created_at": now,
            "read_at": None,
        }
        for uid in user_ids
    ]
    await db.dewi_notifications.insert_many(docs)
    return len(docs)


async def mark_read(db: AsyncIOMotorDatabase, notif_id: str, user_id: str) -> bool:
    """Tandai notif sebagai sudah dibaca."""
    res = await db.dewi_notifications.update_one(
        {"id": notif_id, "user_id": user_id},
        {"$set": {"is_read": True, "read_at": _now()}}
    )
    return res.modified_count > 0


async def get_unread_count(db: AsyncIOMotorDatabase, user_id: str) -> int:
    """Hitung notifikasi belum dibaca."""
    return await db.dewi_notifications.count_documents({"user_id": user_id, "is_read": False})


async def get_recent(
    db: AsyncIOMotorDatabase,
    user_id: str,
    limit: int = 20,
    unread_only: bool = False,
) -> list:
    """Ambil notifikasi terbaru untuk user."""
    query: dict = {"user_id": user_id}
    if unread_only:
        query["is_read"] = False
    docs = await db.dewi_notifications.find(query, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return docs
