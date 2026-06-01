"""
Product Launch Manager — Backend Routes
Phase 3 Week 10: Manajemen peluncuran produk multi-platform dengan timeline
"""
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, List
from fastapi import APIRouter, Request, HTTPException, Query
from pydantic import BaseModel
from database import get_db
from auth import require_auth

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/marketing/product-launches", tags=["marketing-product-launches"])

LAUNCH_STATUSES = ["planning", "ready", "launched", "postponed", "cancelled"]
PLATFORMS = ["shopee", "tiktok", "tokopedia", "instagram", "website"]

STATUS_LABELS = {
    "planning":  "Perencanaan",
    "ready":     "Siap Launch",
    "launched":  "Sudah Launch",
    "postponed": "Ditunda",
    "cancelled": "Dibatalkan",
}


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
async def seed_product_launches_if_empty():
    db = get_db()
    if await db.marketing_product_launches.count_documents({}) > 0:
        return

    import random
    now = _now()
    products = [
        {"name": "Gamis Busui Friendly DA-2026 Series 1", "material": "Katun Linen Premium",   "model": "Polos",    "original_price": 125000, "flash_sale_price": 89000},
        {"name": "Rok Plisket 3 Warna Daluna DL-105",     "material": "Ceruti Satin",           "model": "Plisket",  "original_price": 89000,  "flash_sale_price": 65000},
        {"name": "Kerudung Pashmina Premium KP-2026",     "material": "Voal Lasercut",           "model": "Pashmina", "original_price": 65000,  "flash_sale_price": 45000},
        {"name": "Blouse Batik Modern DA-BM-12",           "material": "Katun Batik Cap",         "model": "Kemeja",   "original_price": 145000, "flash_sale_price": 110000},
        {"name": "Celana Kulot Wanita DA-CK-08",          "material": "Katun Twill",             "model": "Kulot",    "original_price": 95000,  "flash_sale_price": 70000},
        {"name": "Gamis Syari Daluna DL-GMS-2026",        "material": "Maxmara Premium",         "model": "Syari",    "original_price": 165000, "flash_sale_price": 130000},
        {"name": "Tunik Casual DA-TC-05",                 "material": "Rayon Viscose",           "model": "Tunik",    "original_price": 85000,  "flash_sale_price": 65000},
        {"name": "Mukena Travel Daluna MT-01",            "material": "Katun Jepang",            "model": "Mukena",   "original_price": 185000, "flash_sale_price": 145000},
    ]
    all_platforms = ["shopee", "tiktok", "tokopedia"]
    statuses = ["planning", "planning", "ready", "ready", "launched", "launched", "launched", "postponed"]

    entries = []
    for i, prod in enumerate(products):
        days_offset = random.randint(-7, 30)
        launch_date = (now + timedelta(days=days_offset)).strftime("%Y-%m-%d")
        num_platforms = random.randint(1, 3)
        plats = random.sample(all_platforms, num_platforms)
        status = statuses[i]
        # If in the past and status was planning/ready → auto move to launched
        if days_offset < 0 and status in ["planning", "ready"]:
            status = "launched"

        cross_price = int(prod["original_price"] * 1.2)
        listing_price = prod["flash_sale_price"]

        entries.append({
            "id":           str(uuid.uuid4()),
            "product_name": prod["name"],
            "launch_date":  launch_date,
            "material":     prod["material"],
            "model":        prod["model"],
            "photo_urls":   [],
            "original_price":    prod["original_price"],
            "flash_sale_price":  prod["flash_sale_price"],
            "cross_price":       cross_price,
            "listing_price":     listing_price,
            "platforms":         plats,
            "description":       "Produk fashion muslimah berkualitas untuk koleksi 2026.",
            "status":            status,
            "status_label":      STATUS_LABELS.get(status, status),
            "launch_notes":      "",
            "created_by":        "system",
            "created_at":        _now(),
            "updated_at":        _now(),
        })

    if entries:
        await db.marketing_product_launches.insert_many(entries)
    logger.info(f"[product_launches] seeded {len(entries)} launches")


# ── Models ───────────────────────────────────────────────────────────────────
class LaunchIn(BaseModel):
    product_name: str
    launch_date: str      # YYYY-MM-DD
    material: Optional[str] = ""
    model: Optional[str] = ""
    photo_urls: Optional[List[str]] = []
    original_price: Optional[float] = 0
    flash_sale_price: Optional[float] = 0
    cross_price: Optional[float] = 0
    listing_price: Optional[float] = 0
    platforms: Optional[List[str]] = []
    description: Optional[str] = ""
    status: Optional[str] = "planning"
    launch_notes: Optional[str] = ""
    # ── RnD Master link (NEW) ──
    style_id: Optional[str] = None      # FK to dewi_rnd_styles
    style_code: Optional[str] = None    # denormalized
    target_account_ids: Optional[List[str]] = []  # multi-platform accounts

class LaunchUpdate(BaseModel):
    product_name: Optional[str] = None
    launch_date: Optional[str] = None
    material: Optional[str] = None
    model: Optional[str] = None
    photo_urls: Optional[List[str]] = None
    original_price: Optional[float] = None
    flash_sale_price: Optional[float] = None
    cross_price: Optional[float] = None
    listing_price: Optional[float] = None
    platforms: Optional[List[str]] = None
    description: Optional[str] = None
    status: Optional[str] = None
    launch_notes: Optional[str] = None
    style_id: Optional[str] = None
    style_code: Optional[str] = None
    target_account_ids: Optional[List[str]] = None


# ── Endpoints ────────────────────────────────────────────────────────────────
@router.get("/summary")
async def get_summary(request: Request):
    await require_auth(request)
    await seed_product_launches_if_empty()
    db = get_db()

    all_docs = await db.marketing_product_launches.find({}, {"_id": 0, "status": 1, "launch_date": 1, "platforms": 1}).to_list(1000)

    counts = {s: 0 for s in LAUNCH_STATUSES}
    by_platform = {}
    upcoming_30 = 0
    today = _now().date()
    in_30 = today + timedelta(days=30)

    for d in all_docs:
        s = d.get("status", "")
        if s in counts:
            counts[s] += 1
        for p in (d.get("platforms") or []):
            by_platform[p] = by_platform.get(p, 0) + 1
        try:
            ld = datetime.fromisoformat(d["launch_date"]).date()
            if today <= ld <= in_30 and d.get("status") in ["planning", "ready"]:
                upcoming_30 += 1
        except Exception:
            pass

    return {
        "success": True,
        "data": {
            "total":       len(all_docs),
            "planning":    counts["planning"],
            "ready":       counts["ready"],
            "launched":    counts["launched"],
            "postponed":   counts["postponed"],
            "cancelled":   counts["cancelled"],
            "upcoming_30": upcoming_30,
            "by_platform": by_platform,
        }
    }


@router.get("")
async def list_launches(
    request: Request,
    page:      int = Query(default=1, ge=1),
    page_size: int = Query(default=20, le=100),
    status:    str = Query(default=""),
    platform:  str = Query(default=""),
    search:    str = Query(default=""),
    date_from: str = Query(default=""),
    date_to:   str = Query(default=""),
):
    await require_auth(request)
    await seed_product_launches_if_empty()
    db = get_db()

    q = {}
    if status:
        q["status"]   = status
    if platform:
        q["platforms"] = platform
    if search:
        q["product_name"] = {"$regex": search, "$options": "i"}
    if date_from:
        q.setdefault("launch_date", {})["$gte"] = date_from
    if date_to:
        q.setdefault("launch_date", {})["$lte"] = date_to

    total = await db.marketing_product_launches.count_documents(q)
    skip  = (page - 1) * page_size
    items = await db.marketing_product_launches.find(q, {"_id": 0})\
                    .sort("launch_date", 1).skip(skip).limit(page_size).to_list(page_size)
    return {
        "success": True,
        "data": serialize(items),
        "pagination": {"total": total, "page": page, "page_size": page_size,
                       "total_pages": max(1, (total + page_size - 1) // page_size)}
    }


@router.post("")
async def create_launch(body: LaunchIn, request: Request):
    await require_auth(request)
    user = _get_user(request)
    db   = get_db()

    status = body.status if body.status in LAUNCH_STATUSES else "planning"
    launch = {
        "id":           str(uuid.uuid4()),
        "product_name": body.product_name,
        "launch_date":  body.launch_date,
        "material":     body.material or "",
        "model":        body.model or "",
        "photo_urls":   body.photo_urls or [],
        "original_price":   body.original_price or 0,
        "flash_sale_price": body.flash_sale_price or 0,
        "cross_price":      body.cross_price or 0,
        "listing_price":    body.listing_price or 0,
        "platforms":        body.platforms or [],
        "description":      body.description or "",
        "status":           status,
        "status_label":     STATUS_LABELS.get(status, status),
        "launch_notes":     body.launch_notes or "",
        # ── RnD & Account linkage ──
        "style_id":         body.style_id,
        "style_code":       body.style_code or "",
        "target_account_ids": body.target_account_ids or [],
        "fg_material_id":   None,  # populated when launch reaches 'launched' status
        "created_by":       user.get("email", "unknown"),
        "created_at":       _now(),
        "updated_at":       _now(),
    }
    await db.marketing_product_launches.insert_one(launch)
    return {"success": True, "data": serialize(launch)}


@router.put("/{launch_id}")
async def update_launch(launch_id: str, body: LaunchUpdate, request: Request):
    await require_auth(request)
    db = get_db()
    existing = await db.marketing_product_launches.find_one({"id": launch_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Launch not found")

    upd = {k: v for k, v in body.dict().items() if v is not None}
    if "status" in upd:
        upd["status_label"] = STATUS_LABELS.get(upd["status"], upd["status"])
    upd["updated_at"] = _now()
    await db.marketing_product_launches.update_one({"id": launch_id}, {"$set": upd})
    updated = {**existing, **upd}
    return {"success": True, "data": serialize(updated)}


@router.delete("/{launch_id}")
async def delete_launch(launch_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    res = await db.marketing_product_launches.delete_one({"id": launch_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Launch not found")
    return {"success": True, "message": "Deleted"}


@router.post("/{launch_id}/status")
async def update_status(launch_id: str, request: Request):
    """
    Update launch status. Saat status berubah ke 'launched', system akan:
    1. Auto-create FG entry di rahaza_materials (type='fg') jika belum ada
    2. Link launch.fg_material_id ke FG yang dibuat
    """
    await require_auth(request)
    body = await request.json()
    new_status = body.get("status", "")
    if new_status not in LAUNCH_STATUSES:
        raise HTTPException(400, f"Invalid status: {new_status}")
    db = get_db()
    existing = await db.marketing_product_launches.find_one({"id": launch_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Launch not found")
    
    update_fields = {
        "status": new_status,
        "status_label": STATUS_LABELS.get(new_status, new_status),
        "updated_at": _now(),
    }
    
    # ── Auto-create FG when launched ──
    fg_created = None
    if new_status == "launched" and not existing.get("fg_material_id"):
        fg_doc = await _auto_create_fg_from_launch(db, existing)
        if fg_doc:
            update_fields["fg_material_id"] = fg_doc["id"]
            update_fields["fg_code"] = fg_doc["code"]
            fg_created = fg_doc
    
    await db.marketing_product_launches.update_one(
        {"id": launch_id},
        {"$set": update_fields}
    )
    
    return {
        "success": True,
        "status": new_status,
        "fg_auto_created": bool(fg_created),
        "fg": serialize(fg_created) if fg_created else None,
    }


async def _auto_create_fg_from_launch(db, launch: dict) -> Optional[dict]:
    """
    Auto-create FG entry di rahaza_materials saat product launch berstatus 'launched'.
    Skip jika sudah ada FG dengan source_launch_id sama atau code yang collide.
    """
    try:
        # Determine FG code
        code = launch.get("style_code") or launch.get("model") or launch.get("product_name", "").replace(" ", "-").upper()[:30]
        if not code:
            logger.warning(f"Launch {launch.get('id')} has no code/style_code/model, skip FG auto-create")
            return None
        
        # Check if FG already exists with this code
        existing_fg = await db.rahaza_materials.find_one(
            {"code": code, "type": "fg"}, {"_id": 0}
        )
        if existing_fg:
            logger.info(f"FG with code '{code}' already exists, skip auto-create")
            return existing_fg
        
        # Create FG
        fg_doc = {
            "id": str(uuid.uuid4()),
            "code": code.upper(),
            "name": launch.get("product_name", code),
            "type": "fg",
            "unit": "pcs",
            "color": "",
            "yarn_type": launch.get("material", ""),
            "category": "launch",
            "min_stock": 0,
            "reorder_point": 10,
            "active": True,
            "notes": f"Auto-created from Product Launch (launch_id: {launch.get('id')})",
            "source_launch_id": launch.get("id"),
            "source_style_id": launch.get("style_id"),
            "created_via": "product_launch_auto",
            "created_at": _now(),
            "updated_at": _now(),
        }
        await db.rahaza_materials.insert_one(fg_doc)
        logger.info(f"Auto-created FG '{code}' from launch {launch.get('id')}")
        return fg_doc
    except Exception as e:
        logger.error(f"Failed to auto-create FG from launch {launch.get('id')}: {e}", exc_info=True)
        return None
