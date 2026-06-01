"""
Sample Delivery Tracking Module — Backend Routes
Phase 3 Week 13: Tracking pengiriman sample produk ke reseller/KOL
"""
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, Request, HTTPException, Query
from pydantic import BaseModel
from database import get_db
from auth import require_auth

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/marketing/samples", tags=["marketing-samples"])

SAMPLE_TYPES = ["live", "video"]
PLATFORMS = ["tiktok", "instagram", "shopee", "tokopedia"]
COURIERS = ["jnt", "spx", "sicepat", "jne", "anteraja", "ninja", "grab", "gojek"]
SAMPLE_STATUSES = ["pending", "shipped", "delivered", "returned", "cancelled"]
PROGRESS_STATUSES = ["open", "follow_up", "sold", "no_response", "closed"]

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
    return obj

def _get_user(request: Request) -> dict:
    return getattr(request.state, "user", {}) or {}

# ── Seed ─────────────────────────────────────────────────────────────────────
async def seed_samples_if_empty():
    db = get_db()
    if await db.marketing_samples.count_documents({}) > 0:
        return

    import random
    
    products = [
        "Gamis Daluna Basic", "Khimar Syari Premium", "Tunik Busui Friendly",
        "Set Gamis + Khimar", "Outer Cardigan", "Rok Plisket Panjang",
        "Dress Casual", "Hijab Segiempat"
    ]
    
    usernames = [
        "@ayufashion", "@budihijab", "@citramuslimah", "@dinarmodest",
        "@evisyari", "@farahbusana", "@ginaootd", "@hanastyle"
    ]
    
    sizes = ["S", "M", "L", "XL", "XXL"]
    colors = ["Hitam", "Navy", "Maroon", "Olive", "Abu-abu", "Coklat"]
    couriers_list = ["jnt", "spx", "sicepat"]
    
    entries = []
    base = _now()
    
    for i in range(35):
        day_offset = random.randint(-45, 0)
        sample_date = base + timedelta(days=day_offset)
        
        quantity = random.randint(1, 3)
        hpp = random.randint(50000, 150000)
        ongkir = random.randint(15000, 35000)
        sample_type = random.choice(["live", "video", "video"])
        
        progress = random.choice(["open", "follow_up", "sold", "no_response", "closed"])
        shipment_status = "delivered" if progress in ["sold", "closed"] else "shipped" if progress == "follow_up" else "pending"
        
        entries.append({
            "id": str(uuid.uuid4()),
            "date": sample_date.date().isoformat(),
            "username": random.choice(usernames),
            "sample_type": sample_type,
            "sample_type_label": "Live Streaming" if sample_type == "live" else "Video Review",
            "platform": "tiktok" if sample_type == "live" else random.choice(["tiktok", "instagram"]),
            "product": random.choice(products),
            "size": random.choice(sizes),
            "color": random.choice(colors),
            "quantity": quantity,
            "hpp": hpp,
            "total_hpp": hpp * quantity,
            "ongkir": ongkir,
            "courier": random.choice(couriers_list),
            "video_link": f"https://vt.tiktok.com/ZS{random.randint(1000000, 9999999)}/" if sample_type == "video" else "",
            "screenshot_url": "",
            "shipment_status": shipment_status,
            "progress": progress,
            "sales_update": "Terjual 5 pcs" if progress == "sold" else "Sedang follow up" if progress == "follow_up" else "Belum ada respon" if progress == "no_response" else "",
            "notes": "",
            "created_by": "system",
            "created_at": _now(),
            "updated_at": _now(),
        })
    
    if entries:
        await db.marketing_samples.insert_many(entries)
    logger.info(f"[marketing_samples] seeded {len(entries)} entries")

# ── Models ───────────────────────────────────────────────────────────────────
class SampleIn(BaseModel):
    date: str
    username: str
    sample_type: str
    platform: str
    product: str
    size: str
    color: str
    quantity: int
    hpp: float
    ongkir: float
    courier: str
    video_link: Optional[str] = ""
    notes: Optional[str] = ""

class SampleUpdate(BaseModel):
    date: Optional[str] = None
    username: Optional[str] = None
    sample_type: Optional[str] = None
    platform: Optional[str] = None
    product: Optional[str] = None
    size: Optional[str] = None
    color: Optional[str] = None
    quantity: Optional[int] = None
    hpp: Optional[float] = None
    ongkir: Optional[float] = None
    courier: Optional[str] = None
    video_link: Optional[str] = None
    screenshot_url: Optional[str] = None
    shipment_status: Optional[str] = None
    progress: Optional[str] = None
    sales_update: Optional[str] = None
    notes: Optional[str] = None

# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/summary")
async def get_summary(request: Request):
    await require_auth(request)
    await seed_samples_if_empty()
    db = get_db()

    total = await db.marketing_samples.count_documents({})
    pending = await db.marketing_samples.count_documents({"shipment_status": "pending"})
    shipped = await db.marketing_samples.count_documents({"shipment_status": "shipped"})
    delivered = await db.marketing_samples.count_documents({"shipment_status": "delivered"})
    
    # Progress summary
    open_count = await db.marketing_samples.count_documents({"progress": "open"})
    sold_count = await db.marketing_samples.count_documents({"progress": "sold"})
    follow_up = await db.marketing_samples.count_documents({"progress": "follow_up"})
    no_response = await db.marketing_samples.count_documents({"progress": "no_response"})
    
    # Total investment
    pipeline_cost = [{"$group": {"_id": None, "total_hpp": {"$sum": "$total_hpp"}, "total_ongkir": {"$sum": "$ongkir"}}}]
    cost_result = await db.marketing_samples.aggregate(pipeline_cost).to_list(1)
    total_hpp = cost_result[0]["total_hpp"] if cost_result else 0
    total_ongkir = cost_result[0]["total_ongkir"] if cost_result else 0
    total_investment = total_hpp + total_ongkir

    return {
        "success": True,
        "data": {
            "total": total,
            "pending": pending,
            "shipped": shipped,
            "delivered": delivered,
            "open": open_count,
            "sold": sold_count,
            "follow_up": follow_up,
            "no_response": no_response,
            "total_investment": total_investment,
            "total_hpp": total_hpp,
            "total_ongkir": total_ongkir,
        }
    }

@router.get("")
async def list_samples(
    request: Request,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, le=100),
    shipment_status: str = Query(default=""),
    progress: str = Query(default=""),
    platform: str = Query(default=""),
    sample_type: str = Query(default=""),
    date_from: str = Query(default=""),
    date_to: str = Query(default=""),
    search: str = Query(default=""),
):
    await require_auth(request)
    await seed_samples_if_empty()
    db = get_db()

    q = {}
    if shipment_status:
        q["shipment_status"] = shipment_status
    if progress:
        q["progress"] = progress
    if platform:
        q["platform"] = platform
    if sample_type:
        q["sample_type"] = sample_type
    if date_from:
        q.setdefault("date", {})["$gte"] = date_from
    if date_to:
        q.setdefault("date", {})["$lte"] = date_to
    if search:
        q["$or"] = [
            {"username": {"$regex": search, "$options": "i"}},
            {"product": {"$regex": search, "$options": "i"}},
            {"sales_update": {"$regex": search, "$options": "i"}},
        ]

    total = await db.marketing_samples.count_documents(q)
    skip = (page - 1) * page_size
    items = await db.marketing_samples.find(q, {"_id": 0})\
                    .sort("date", -1).skip(skip).limit(page_size).to_list(page_size)
    
    return {
        "success": True,
        "data": serialize(items),
        "pagination": {
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size
        }
    }

@router.get("/{sample_id}")
async def get_sample(sample_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    sample = await db.marketing_samples.find_one({"id": sample_id}, {"_id": 0})
    if not sample:
        raise HTTPException(404, "Sample not found")
    return {"success": True, "data": serialize(sample)}

@router.post("")
async def create_sample(body: SampleIn, request: Request):
    await require_auth(request)
    user = _get_user(request)
    db = get_db()

    total_hpp = body.hpp * body.quantity

    sample = {
        "id": str(uuid.uuid4()),
        "date": body.date,
        "username": body.username,
        "sample_type": body.sample_type,
        "sample_type_label": "Live Streaming" if body.sample_type == "live" else "Video Review",
        "platform": body.platform,
        "product": body.product,
        "size": body.size,
        "color": body.color,
        "quantity": body.quantity,
        "hpp": body.hpp,
        "total_hpp": total_hpp,
        "ongkir": body.ongkir,
        "courier": body.courier,
        "video_link": body.video_link or "",
        "screenshot_url": "",
        "shipment_status": "pending",
        "progress": "open",
        "sales_update": "",
        "notes": body.notes or "",
        "created_by": user.get("email", "unknown"),
        "created_at": _now(),
        "updated_at": _now(),
    }
    await db.marketing_samples.insert_one(sample)
    return {"success": True, "data": serialize(sample)}

@router.put("/{sample_id}")
async def update_sample(sample_id: str, body: SampleUpdate, request: Request):
    await require_auth(request)
    db = get_db()

    existing = await db.marketing_samples.find_one({"id": sample_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Sample not found")

    upd = {k: v for k, v in body.dict().items() if v is not None}
    
    # Recalculate total_hpp if quantity or hpp changed
    if "quantity" in upd or "hpp" in upd:
        qty = upd.get("quantity", existing.get("quantity", 1))
        hpp = upd.get("hpp", existing.get("hpp", 0))
        upd["total_hpp"] = qty * hpp
    
    if "sample_type" in upd:
        upd["sample_type_label"] = "Live Streaming" if upd["sample_type"] == "live" else "Video Review"
    
    upd["updated_at"] = _now()
    
    await db.marketing_samples.update_one({"id": sample_id}, {"$set": upd})
    updated = {**existing, **upd}
    return {"success": True, "data": serialize(updated)}

@router.delete("/{sample_id}")
async def delete_sample(sample_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    res = await db.marketing_samples.delete_one({"id": sample_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Sample not found")
    return {"success": True, "message": "Deleted"}

@router.post("/{sample_id}/ship")
async def ship_sample(sample_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    existing = await db.marketing_samples.find_one({"id": sample_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Sample not found")
    
    await db.marketing_samples.update_one(
        {"id": sample_id},
        {"$set": {
            "shipment_status": "shipped",
            "updated_at": _now()
        }}
    )
    return {"success": True, "message": "Sample marked as shipped"}

@router.post("/{sample_id}/deliver")
async def deliver_sample(sample_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    existing = await db.marketing_samples.find_one({"id": sample_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Sample not found")
    
    await db.marketing_samples.update_one(
        {"id": sample_id},
        {"$set": {
            "shipment_status": "delivered",
            "progress": "follow_up",
            "updated_at": _now()
        }}
    )
    return {"success": True, "message": "Sample marked as delivered"}

@router.post("/{sample_id}/update-progress")
async def update_progress(sample_id: str, request: Request):
    await require_auth(request)
    body = await request.json()
    progress = body.get("progress", "")
    sales_update = body.get("sales_update", "")
    
    if progress not in PROGRESS_STATUSES:
        raise HTTPException(400, f"Invalid progress: {progress}")
    
    db = get_db()
    existing = await db.marketing_samples.find_one({"id": sample_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Sample not found")
    
    await db.marketing_samples.update_one(
        {"id": sample_id},
        {"$set": {
            "progress": progress,
            "sales_update": sales_update,
            "updated_at": _now()
        }}
    )
    return {"success": True, "message": "Progress updated"}
