"""
Content Calendar Module — Backend Routes
Phase 3 Week 8: Jadwal konten multi-platform dengan AI hook generation
"""
import os
import uuid
import logging
from datetime import datetime, timezone, timedelta, date
from typing import Optional
from fastapi import APIRouter, Request, HTTPException, Query
from pydantic import BaseModel
from database import get_db
from auth import require_auth
from emergentintegrations.llm.chat import LlmChat, UserMessage
import json
import calendar

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/marketing/content-calendar", tags=["marketing-content-calendar"])

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")

CONTENT_TYPES = [
    "foto_produk", "video_produk", "reels_tiktok", "live_streaming",
    "story", "promo_flash_sale", "konten_edukasi", "behind_scenes",
    "testimonial", "unboxing", "kolaborasi_kol"
]

CONTENT_TYPE_LABELS = {
    "foto_produk":       "Foto Produk",
    "video_produk":      "Video Produk",
    "reels_tiktok":      "Reels / TikTok",
    "live_streaming":    "Live Streaming",
    "story":             "Story",
    "promo_flash_sale":  "Promo Flash Sale",
    "konten_edukasi":    "Konten Edukasi",
    "behind_scenes":     "Behind the Scenes",
    "testimonial":       "Testimonial",
    "unboxing":          "Unboxing",
    "kolaborasi_kol":    "Kolaborasi KOL",
}

CONTENT_STATUSES = ["draft", "scheduled", "posted", "cancelled"]
PLATFORMS = ["shopee", "tiktok", "tokopedia", "instagram", "facebook"]

# ── Helpers ───────────────────────────────────────────────────────────────────
def _now() -> datetime:
    return datetime.now(timezone.utc)

def serialize(obj):
    if isinstance(obj, list):
        return [serialize(i) for i in obj]
    if isinstance(obj, dict):
        return {k: serialize(v) for k, v in obj.items() if k != "_id"}
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, date):
        return obj.isoformat()
    return obj

def _get_user(request: Request) -> dict:
    return getattr(request.state, "user", {}) or {}


# ── Seed ─────────────────────────────────────────────────────────────────────
async def seed_content_calendar_if_empty():
    db = get_db()
    if await db.marketing_content_calendar.count_documents({}) > 0:
        return

    import random
    accounts = [
        {"account_name": "DA Official Shopee",  "platform": "shopee"},
        {"account_name": "Daluna TikTok Shop",  "platform": "tiktok"},
        {"account_name": "DA Instagram",         "platform": "instagram"},
        {"account_name": "DA Tokopedia",          "platform": "tokopedia"},
    ]
    content_types = CONTENT_TYPES
    hooks = [
        "Gamis busui friendly yang bikin nyaman seharian!",
        "Koleksi terbaru Daluna – tampil syari & modern",
        "Flash sale 3 hari, diskon hingga 50%!",
        "Tutorial styling kerudung segiempat dalam 60 detik",
        "Unboxing paket gamis ukuran M-XXXL – semua ada!",
        "Customer review bintang 5 – yuk intip!",
        "Behind the scenes proses jahit kualitas premium",
        "Tips memilih bahan gamis yang adem untuk iklim tropis",
        "Live sore ini jam 3 – ada doorprize!",
        "Bundle hemat 2 pcs gamis + kerudung",
    ]
    ctas = ["Klik di bio!", "Order sekarang!", "DM admin!", "Klik link di bio!", "Swipe up!"]
    post_times = ["07:00", "09:00", "11:00", "12:00", "15:00", "17:00", "19:00", "20:00", "21:00"]
    statuses = ["posted", "posted", "posted", "scheduled", "scheduled", "draft"]

    entries = []
    base = _now().replace(day=1)
    for i in range(30):
        day_offset = random.randint(-5, 25)
        post_date = (base + timedelta(days=day_offset)).date()
        acc = random.choice(accounts)
        ct  = random.choice(content_types)
        entries.append({
            "id":           str(uuid.uuid4()),
            "account_name": acc["account_name"],
            "platform":     acc["platform"],
            "date":         post_date.isoformat(),
            "content_type": ct,
            "content_type_label": CONTENT_TYPE_LABELS.get(ct, ct),
            "title":        random.choice(hooks),
            "description":  "Konten ini bertujuan meningkatkan engagement dan penjualan produk busana muslim DA/Daluna.",
            "cta":          random.choice(ctas),
            "post_time":    random.choice(post_times),
            "reference_link": "",
            "status":       random.choice(statuses),
            "created_by":   "system",
            "created_at":   _now(),
            "updated_at":   _now(),
        })

    if entries:
        await db.marketing_content_calendar.insert_many(entries)
    logger.info(f"[content_calendar] seeded {len(entries)} entries")


# ── Models ───────────────────────────────────────────────────────────────────
class ContentEntryIn(BaseModel):
    account_id: Optional[str] = None  # UUID dari marketing_platform_accounts
    account_name: str
    platform: str
    date: str          # YYYY-MM-DD
    content_type: str
    title: str
    description: Optional[str] = ""
    cta: Optional[str] = ""
    post_time: Optional[str] = ""  # HH:MM
    reference_link: Optional[str] = ""
    status: Optional[str] = "draft"

class ContentEntryUpdate(BaseModel):
    account_id: Optional[str] = None
    account_name: Optional[str] = None
    platform: Optional[str] = None
    date: Optional[str] = None
    content_type: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    cta: Optional[str] = None
    post_time: Optional[str] = None
    reference_link: Optional[str] = None
    status: Optional[str] = None


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/types")
async def get_content_types():
    return {"success": True, "types": [{"value": k, "label": v} for k, v in CONTENT_TYPE_LABELS.items()]}

@router.get("/platforms")
async def get_platforms():
    labels = {"shopee": "Shopee", "tiktok": "TikTok", "tokopedia": "Tokopedia",
               "instagram": "Instagram", "facebook": "Facebook"}
    return {"success": True, "platforms": [{"value": p, "label": labels.get(p, p)} for p in PLATFORMS]}


@router.get("/summary")
async def get_summary(request: Request):
    await require_auth(request)
    await seed_content_calendar_if_empty()
    db = get_db()

    total     = await db.marketing_content_calendar.count_documents({})
    draft     = await db.marketing_content_calendar.count_documents({"status": "draft"})
    scheduled = await db.marketing_content_calendar.count_documents({"status": "scheduled"})
    posted    = await db.marketing_content_calendar.count_documents({"status": "posted"})
    cancelled = await db.marketing_content_calendar.count_documents({"status": "cancelled"})

    # This month
    now = _now()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    now.strftime("%Y-%m")
    this_month = await db.marketing_content_calendar.count_documents(
        {"date": {"$gte": month_start.strftime("%Y-%m-01"), "$lte": now.strftime("%Y-%m-%d")}}
    )

    # By platform
    pipeline = [{"$group": {"_id": "$platform", "count": {"$sum": 1}}}]
    by_platform_raw = await db.marketing_content_calendar.aggregate(pipeline).to_list(100)
    by_platform = {r["_id"]: r["count"] for r in by_platform_raw if r["_id"]}

    return {
        "success": True,
        "data": {
            "total":      total,
            "draft":      draft,
            "scheduled":  scheduled,
            "posted":     posted,
            "cancelled":  cancelled,
            "this_month": this_month,
            "by_platform": by_platform,
        }
    }


@router.get("/monthly")
async def get_monthly(
    request: Request,
    year:    int = Query(default=None),
    month:   int = Query(default=None),
    account: str = Query(default=""),
    platform: str = Query(default="")
):
    await require_auth(request)
    await seed_content_calendar_if_empty()
    db = get_db()

    now = _now()
    y = year  or now.year
    m = month or now.month

    # Build date range for the month
    start_d = f"{y:04d}-{m:02d}-01"
    last_day = calendar.monthrange(y, m)[1]
    end_d   = f"{y:04d}-{m:02d}-{last_day:02d}"

    q = {"date": {"$gte": start_d, "$lte": end_d}}
    if account:
        q["account_name"] = {"$regex": account, "$options": "i"}
    if platform:
        q["platform"]    = platform

    entries = await db.marketing_content_calendar.find(q, {"_id": 0}).sort("date", 1).to_list(500)
    return {"success": True, "data": serialize(entries), "year": y, "month": m}


@router.get("")
async def list_entries(
    request: Request,
    page:     int = Query(default=1, ge=1),
    page_size:int = Query(default=20, le=100),
    status:   str = Query(default=""),
    platform: str = Query(default=""),
    account:  str = Query(default=""),
    content_type: str = Query(default=""),
    date_from: str = Query(default=""),
    date_to:   str = Query(default=""),
):
    await require_auth(request)
    await seed_content_calendar_if_empty()
    db = get_db()

    q = {}
    if status:
        q["status"]       = status
    if platform:
        q["platform"]     = platform
    if content_type:
        q["content_type"] = content_type
    if account:
        q["account_name"] = {"$regex": account, "$options": "i"}
    if date_from:
        q.setdefault("date", {})["$gte"] = date_from
    if date_to:
        q.setdefault("date", {})["$lte"] = date_to

    total  = await db.marketing_content_calendar.count_documents(q)
    skip   = (page - 1) * page_size
    items  = await db.marketing_content_calendar.find(q, {"_id": 0})\
                     .sort("date", 1).skip(skip).limit(page_size).to_list(page_size)
    return {
        "success": True,
        "data": serialize(items),
        "pagination": {"total": total, "page": page, "page_size": page_size,
                       "total_pages": (total + page_size - 1) // page_size}
    }


@router.post("")
async def create_entry(body: ContentEntryIn, request: Request):
    await require_auth(request)
    user = _get_user(request)
    db   = get_db()

    entry = {
        "id":           str(uuid.uuid4()),
        "account_id":   body.account_id,  # FK to marketing_platform_accounts (UUID)
        "account_name": body.account_name,
        "platform":     body.platform,
        "date":         body.date,
        "content_type": body.content_type,
        "content_type_label": CONTENT_TYPE_LABELS.get(body.content_type, body.content_type),
        "title":        body.title,
        "description":  body.description or "",
        "cta":          body.cta or "",
        "post_time":    body.post_time or "",
        "reference_link": body.reference_link or "",
        "status":       body.status if body.status in CONTENT_STATUSES else "draft",
        "created_by":   user.get("email", "unknown"),
        "created_at":   _now(),
        "updated_at":   _now(),
    }
    await db.marketing_content_calendar.insert_one(entry)
    return {"success": True, "data": serialize(entry)}


@router.put("/{entry_id}")
async def update_entry(entry_id: str, body: ContentEntryUpdate, request: Request):
    await require_auth(request)
    db = get_db()

    existing = await db.marketing_content_calendar.find_one({"id": entry_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Entry not found")

    upd = {k: v for k, v in body.dict().items() if v is not None}
    if "content_type" in upd:
        upd["content_type_label"] = CONTENT_TYPE_LABELS.get(upd["content_type"], upd["content_type"])
    upd["updated_at"] = _now()
    await db.marketing_content_calendar.update_one({"id": entry_id}, {"$set": upd})
    updated = {**existing, **upd}
    return {"success": True, "data": serialize(updated)}


@router.delete("/{entry_id}")
async def delete_entry(entry_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    res = await db.marketing_content_calendar.delete_one({"id": entry_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Entry not found")
    return {"success": True, "message": "Deleted"}


@router.post("/{entry_id}/status")
async def update_status(entry_id: str, request: Request):
    await require_auth(request)
    body = await request.json()
    new_status = body.get("status", "")
    if new_status not in CONTENT_STATUSES:
        raise HTTPException(400, f"Invalid status: {new_status}")
    db = get_db()
    existing = await db.marketing_content_calendar.find_one({"id": entry_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Entry not found")
    await db.marketing_content_calendar.update_one(
        {"id": entry_id}, {"$set": {"status": new_status, "updated_at": _now()}}
    )
    return {"success": True, "status": new_status}


@router.post("/{entry_id}/ai-hook")
async def generate_ai_hook(entry_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    entry = await db.marketing_content_calendar.find_one({"id": entry_id}, {"_id": 0})
    if not entry:
        raise HTTPException(404, "Entry not found")

    if not EMERGENT_LLM_KEY:
        raise HTTPException(503, "AI not configured")

    ct_label = CONTENT_TYPE_LABELS.get(entry.get("content_type", ""), entry.get("content_type", ""))
    platform = entry.get("platform", "")
    account  = entry.get("account_name", "")

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"content-hook-{entry_id[:8]}",
        system_message="Kamu adalah copywriter ahli untuk marketplace Indonesia (Shopee, TikTok Shop, Tokopedia). Buat caption/hook yang menarik, singkat, relevan untuk audiens Indonesia. Respond ONLY with valid JSON."
    ).with_model("openai", "gpt-4o-mini")

    prompt = (
        f"Buat 3 variasi hook/judul konten untuk:\n"
        f"Platform: {platform} | Akun: {account} | Jenis: {ct_label}\n"
        f"Konten saat ini: '{entry.get('title', '')}\n\n"
        f"Return JSON persis: {{\"hooks\": [\"hook1\", \"hook2\", \"hook3\"], "
        f"\"best_hook\": \"pilihan terbaik\", \"cta_suggestion\": \"CTA rekomendasi\", "
        f"\"description_suggestion\": \"deskripsi 1-2 kalimat\"}}"
    )

    try:
        response = await chat.send_message(UserMessage(text=prompt))
        clean = response.strip()
        if clean.startswith("```"):
            clean = clean.split("```")[1]
            if clean.startswith("json"):
                clean = clean[4:]
        result = json.loads(clean.strip())

        best_hook = result.get("best_hook", entry.get("title", ""))
        await db.marketing_content_calendar.update_one(
            {"id": entry_id},
            {"$set": {
                "title": best_hook,
                "cta":   result.get("cta_suggestion", entry.get("cta", "")),
                "description": result.get("description_suggestion", entry.get("description", "")),
                "updated_at": _now()
            }}
        )
        return {"success": True, "result": result, "applied_hook": best_hook}
    except Exception as e:
        raise HTTPException(500, f"AI hook generation failed: {e}")
