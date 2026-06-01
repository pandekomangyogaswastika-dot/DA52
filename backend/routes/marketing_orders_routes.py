"""
Unified Orders Dashboard — Backend Routes
Phase 2 Week 4: Order management dari hasil commit Universal Smart Import
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
router = APIRouter(prefix="/api/marketing/orders", tags=["marketing-orders"])

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


ORDER_STATUSES = ["new", "packed", "shipped", "delivered", "cancelled", "returned"]
STATUS_FLOW = {
    "new": ["packed", "cancelled"],
    "packed": ["shipped", "cancelled"],
    "shipped": ["delivered", "returned"],
    "delivered": ["returned"],
    "cancelled": [],
    "returned": []
}

# ── Seed Demo Data ─────────────────────────────────────────────────────────────

async def seed_orders_if_empty():
    """Auto-seed realistic demo orders if collection is empty."""
    db = get_db()
    if await db.marketing_orders.count_documents({}) > 0:
        return

    import random
    products = [
        {"product_name": "Gamis Busui Friendly DA-001", "sku_id": "DA-GMB-001",  "price": 98000,  "variations": ["M/Navy","L/Navy","XL/Sage","XXL/Black"]},
        {"product_name": "Celana Kulot Wanita DA-005",  "sku_id": "DA-CKW-005",  "price": 75000,  "variations": ["S/Hitam","M/Hitam","L/Cokelat","XL/Cokelat"]},
        {"product_name": "Kerudung Segiempat DA-010",   "sku_id": "DA-KSE-010",  "price": 45000,  "variations": ["Putih","Hitam","Abu","Cream"]},
        {"product_name": "Blouse Batik Modern DA-020",  "sku_id": "DA-BBM-020",  "price": 110000, "variations": ["S/Biru","M/Biru","L/Merah","XL/Merah"]},
        {"product_name": "Rok Plisket Premium DL-010",  "sku_id": "DL-RPP-010",  "price": 85000,  "variations": ["S/Black","M/Black","L/Navy","XL/Navy"]},
        {"product_name": "Gamis Syari Daluna DL-001",   "sku_id": "DL-GMS-001",  "price": 125000, "variations": ["M/Dusty Pink","L/Cream","XL/Sage","XXL/Navy"]},
    ]
    platforms = [
        {"platform": "shopee",    "account_name": "DA Official Shopee",   "prefix": "SHP-2026050"},
        {"platform": "tiktok",    "account_name": "Daluna TikTok Shop",   "prefix": "TT-260500-"},
        {"platform": "shopee",    "account_name": "DA Shopee Premium",    "prefix": "SHP-2026051"},
    ]
    couriers = ["J&T Express", "SiCepat", "JNE", "AnterAja", "Ninja Express", "ID Express"]
    cities   = ["Bandung", "Jakarta Selatan", "Surabaya", "Yogyakarta", "Medan", "Makassar", "Semarang", "Bekasi", "Depok", "Tangerang"]
    names    = ["Siti Rahayu", "Zahra Wulandari", "Dewi Santoso", "Rina Mardiani", "Fitri Amalia",
                "Nisa Kurniawan", "Anisa Rahman", "Eka Puspita", "Maya Putri", "Lina Agustina",
                "Rizky Amelia", "Fadila Hanum", "Yuni Kartika", "Sri Wahyuni", "Indah Permata"]
    payments = ["ShopeePay", "COD", "Transfer Bank", "Kartu Kredit", "DANA", "OVO", "GoPay"]

    orders = []
    base_date = _now() - timedelta(days=14)
    statuses_weighted = (["new"] * 5 + ["packed"] * 8 + ["shipped"] * 12 +
                         ["delivered"] * 20 + ["cancelled"] * 3 + ["returned"] * 2)

    for i in range(60):
        p   = random.choice(products)
        plat = random.choice(platforms)
        var  = random.choice(p["variations"])
        qty  = random.randint(1, 3)
        order_date = base_date + timedelta(hours=random.randint(0, 14 * 24))
        status = random.choice(statuses_weighted)

        # Compute packed/shipped dates based on status
        packed_date   = None
        shipped_date  = None
        delivered_date= None
        tracking_no   = None
        if status in ["packed", "shipped", "delivered", "returned"]:
            packed_date  = order_date + timedelta(hours=random.randint(4, 24))
        if status in ["shipped", "delivered", "returned"]:
            shipped_date = packed_date + timedelta(hours=random.randint(2, 8))
            tracking_no  = f"{'JT' if 'J&T' in couriers else 'SC'}{random.randint(1000000,9999999)}"
        if status in ["delivered"]:
            delivered_date = shipped_date + timedelta(days=random.randint(1, 4))

        courier = random.choice(couriers)
        disc = round(p["price"] * random.choice([0, 0, 0.05, 0.1]), -3)
        shipping = random.choice([0, 0, 12000, 15000, 18000, 20000])

        orders.append({
            "id":             str(uuid.uuid4()),
            "order_id":       f"{plat['prefix']}{i+1:03d}",
            "platform":       plat["platform"],
            "account_name":   plat["account_name"],
            "product_name":   p["product_name"],
            "sku_id":         p["sku_id"],
            "variation":      var,
            "quantity":       qty,
            "price_original": p["price"],
            "price_final":    p["price"] - disc,
            "discount_seller":disc,
            "shipping_cost":  shipping,
            "total_payment":  (p["price"] - disc) * qty + shipping,
            "revenue":        (p["price"] - disc) * qty,
            "payment_method": random.choice(payments),
            "status":         status,
            "courier":        courier,
            "tracking_number":tracking_no,
            "customer_name":  random.choice(names),
            "city":           random.choice(cities),
            "note":           "",
            "order_date":     order_date,
            "packed_date":    packed_date,
            "shipped_date":   shipped_date,
            "delivered_date": delivered_date,
            "cancelled_date": order_date + timedelta(hours=2) if status == "cancelled" else None,
            "_source_type":   "shopee_orders" if plat["platform"] == "shopee" else "tiktok_orders",
            "_confidence":    round(random.uniform(0.82, 0.99), 2),
            "_import_session_id": "seed-demo",
            "created_at":     order_date,
            "updated_at":     order_date,
        })

    if orders:
        await db.marketing_orders.insert_many(orders)
        # Create indexes safely (skip if exists)
        try:
            await db.marketing_orders.create_index("id", unique=True, sparse=True)
        except Exception:
            pass  # Index already exists
        try:
            await db.marketing_orders.create_index("order_id")
            await db.marketing_orders.create_index("platform")
            await db.marketing_orders.create_index("status")
            await db.marketing_orders.create_index("order_date")
            await db.marketing_orders.create_index("sku_id")
        except Exception:
            pass
        logger.info(f"[seed] Inserted {len(orders)} demo orders")


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/summary")
async def orders_summary(request: Request):
    await require_auth(request)
    db = get_db()
    await seed_orders_if_empty()

    now   = _now()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start  = today_start - timedelta(days=today_start.weekday())

    # Total counts by status
    pipeline_status = [
        {"$group": {"_id": "$status", "count": {"$sum": 1},
                    "revenue": {"$sum": "$revenue"}}}
    ]
    status_counts = {}
    status_revenue = {}
    async for doc in db.marketing_orders.aggregate(pipeline_status):
        status_counts[doc["_id"]] = doc["count"]
        status_revenue[doc["_id"]] = doc.get("revenue", 0)

    # Revenue today
    pipeline_today = [
        {"$match": {"order_date": {"$gte": today_start}, "status": {"$nin": ["cancelled", "returned"]}}},
        {"$group": {"_id": None, "revenue": {"$sum": "$revenue"}, "orders": {"$sum": 1}}}
    ]
    today_data = {"revenue": 0, "orders": 0}
    async for doc in db.marketing_orders.aggregate(pipeline_today):
        today_data = {"revenue": doc.get("revenue", 0), "orders": doc.get("orders", 0)}

    # Revenue this week
    pipeline_week = [
        {"$match": {"order_date": {"$gte": week_start}, "status": {"$nin": ["cancelled", "returned"]}}},
        {"$group": {"_id": None, "revenue": {"$sum": "$revenue"}, "orders": {"$sum": 1}}}
    ]
    week_data = {"revenue": 0, "orders": 0}
    async for doc in db.marketing_orders.aggregate(pipeline_week):
        week_data = {"revenue": doc.get("revenue", 0), "orders": doc.get("orders", 0)}

    # By platform
    pipeline_plat = [
        {"$group": {"_id": "$platform", "count": {"$sum": 1},
                    "revenue": {"$sum": "$revenue"}}}
    ]
    by_platform = {}
    async for doc in db.marketing_orders.aggregate(pipeline_plat):
        by_platform[doc["_id"]] = {"count": doc["count"], "revenue": doc.get("revenue", 0)}

    # Need action (new + packed)
    need_action = (status_counts.get("new", 0) + status_counts.get("packed", 0))
    total = sum(status_counts.values())
    total_revenue = sum(v for k, v in status_revenue.items() if k not in ["cancelled", "returned"])

    return {
        "total_orders":     total,
        "need_action":      need_action,
        "total_revenue":    round(total_revenue),
        "by_status":        status_counts,
        "by_platform":      by_platform,
        "today":            today_data,
        "this_week":        week_data,
    }


@router.get("")
async def list_orders(
    request: Request,
    platform:   Optional[str]  = Query(None),
    status:     Optional[str]  = Query(None),
    account_name: Optional[str]= Query(None),
    date_from:  Optional[str]  = Query(None),
    date_to:    Optional[str]  = Query(None),
    search:     Optional[str]  = Query(None),
    page:       int            = Query(1, ge=1),
    page_size:  int            = Query(25, le=100),
    sort_by:    str            = Query("order_date"),
    sort_dir:   int            = Query(-1)
):
    await require_auth(request)
    db = get_db()
    await seed_orders_if_empty()

    q: dict = {}
    if platform:
        q["platform"]     = platform
    if status:
        q["status"]       = status
    if account_name:
        q["account_name"] = account_name
    if date_from or date_to:
        q["order_date"] = {}
        if date_from:
            q["order_date"]["$gte"] = datetime.fromisoformat(date_from)
        if date_to:
            q["order_date"]["$lte"] = datetime.fromisoformat(date_to + "T23:59:59")
    if search:
        q["$or"] = [
            {"order_id":    {"$regex": search, "$options": "i"}},
            {"product_name":{"$regex": search, "$options": "i"}},
            {"sku_id":      {"$regex": search, "$options": "i"}},
            {"customer_name":{"$regex": search, "$options": "i"}},
        ]

    total = await db.marketing_orders.count_documents(q)
    orders = await db.marketing_orders.find(
        q, {"_id": 0}
    ).sort(sort_by, sort_dir).skip((page - 1) * page_size).limit(page_size).to_list(500)

    return serialize({
        "orders": orders,
        "pagination": {
            "page": page, "page_size": page_size, "total": total,
            "total_pages": max(1, (total + page_size - 1) // page_size)
        }
    })


@router.get("/picking-list")
async def generate_picking_list(
    request: Request,
    statuses: Optional[str] = Query("new,packed"),
    platform: Optional[str] = Query(None)
):
    """Generate a picking list grouped by SKU."""
    await require_auth(request)
    db = get_db()

    status_list = [s.strip() for s in statuses.split(",")]
    q: dict = {"status": {"$in": status_list}}
    if platform:
        q["platform"] = platform

    orders = await db.marketing_orders.find(q, {"_id": 0}).to_list(500)

    # Group by SKU + Variation
    picking: dict = {}
    for o in orders:
        key = f"{o.get('sku_id','')} | {o.get('variation','')}"
        if key not in picking:
            picking[key] = {
                "sku_id":       o.get("sku_id", ""),
                "variation":    o.get("variation", ""),
                "product_name": o.get("product_name", ""),
                "total_qty":    0,
                "order_ids":    [],
                "platforms":    set()
            }
        picking[key]["total_qty"]  += o.get("quantity", 1)
        picking[key]["order_ids"].append(o.get("order_id", ""))
        picking[key]["platforms"].add(o.get("platform", ""))

    result = []
    for k, v in sorted(picking.items(), key=lambda x: -x[1]["total_qty"]):
        result.append({
            "sku_id":       v["sku_id"],
            "variation":    v["variation"],
            "product_name": v["product_name"],
            "total_qty":    v["total_qty"],
            "order_count":  len(v["order_ids"]),
            "platforms":    list(v["platforms"]),
            "order_ids":    v["order_ids"][:10]
        })

    return {
        "picking_list": result,
        "total_items": len(result),
        "total_orders": len(orders),
        "generated_at": _now().isoformat(),
        "status_filter": status_list
    }


@router.get("/{order_id}")
async def get_order(order_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    order = await db.marketing_orders.find_one(
        {"$or": [{"id": order_id}, {"order_id": order_id}]}, {"_id": 0}
    )
    if not order:
        raise HTTPException(404, "Order not found")
    return serialize(order)


# ── Manual Order Creation (replaces legacy POST /api/dewi/toko/orders) ───────

class OrderItemBody(BaseModel):
    sku_code: Optional[str] = ""
    product_name: Optional[str] = ""
    qty: int = 1
    price: float = 0.0
    variant: Optional[str] = ""


class OrderCreateBody(BaseModel):
    # Required
    platform: str  # shopee | tiktok | tokopedia | manual | website | etc.
    customer_name: str
    # Identification
    order_id: Optional[str] = None  # marketplace reference (auto-gen if blank)
    account_name: Optional[str] = None
    # Customer
    customer_phone: Optional[str] = ""
    customer_address: Optional[str] = ""
    city: Optional[str] = ""
    # Items (can be multi or single)
    items: List[OrderItemBody] = []
    # Or single-item flat fields (used when items=[])
    sku_id: Optional[str] = ""
    product_name: Optional[str] = ""
    variation: Optional[str] = ""
    quantity: int = 1
    price_original: float = 0.0
    price_final: float = 0.0
    # Money
    total_payment: float = 0.0
    fee_amount: float = 0.0
    shipping_cost: float = 0.0
    # Logistics
    courier: Optional[str] = ""
    tracking_number: Optional[str] = None
    payment_method: Optional[str] = ""
    note: Optional[str] = ""


@router.post("", status_code=201)
async def create_order(body: OrderCreateBody, request: Request):
    """Create a manual order in marketing_orders SSOT.

    Replaces legacy POST /api/dewi/toko/orders. Supports both single-item flat
    shape and multi-item via `items[]`. When items is provided, the primary
    item populates sku_id/product_name/variation; the full array is preserved.
    """
    await require_auth(request)
    user = _get_user(request)
    db = get_db()

    # Derive primary item from items array (multi-item case)
    items_list = [it.dict() for it in body.items] if body.items else []
    primary = items_list[0] if items_list else {}

    sku_id = body.sku_id or (primary.get("sku_code") if primary else "")
    product_name = body.product_name or (primary.get("product_name") if primary else "")
    variation = body.variation or (primary.get("variant") if primary else "")
    quantity = body.quantity or sum(int(it.get("qty") or 0) for it in items_list) or 1
    price_final = body.price_final or float(primary.get("price") or 0)
    price_original = body.price_original or price_final
    total_payment = body.total_payment or (price_final * quantity + (body.shipping_cost or 0))
    revenue = total_payment - (body.fee_amount or 0)

    now = _now()
    new_id = str(uuid.uuid4())
    order_ref = body.order_id or f"MAN-{now.strftime('%Y%m%d')}-{new_id[:6].upper()}"

    doc = {
        "id":              new_id,
        "order_id":        order_ref,
        "platform":        body.platform,
        "account_name":    body.account_name or body.platform,
        "product_name":    product_name,
        "sku_id":          sku_id,
        "variation":       variation,
        "items":           items_list,
        "quantity":        quantity,
        "price_original":  price_original,
        "price_final":     price_final,
        "discount_seller": max(0.0, price_original - price_final) * quantity,
        "shipping_cost":   body.shipping_cost or 0,
        "total_payment":   total_payment,
        "fee_amount":      body.fee_amount or 0,
        "net_amount":      revenue,
        "revenue":         revenue,
        "payment_method":  body.payment_method or "",
        "status":          "new",
        "courier":         body.courier or "",
        "tracking_number": body.tracking_number,
        "customer_name":   body.customer_name,
        "customer_phone":  body.customer_phone or "",
        "customer_address": body.customer_address or "",
        "city":            body.city or "",
        "note":            body.note or "",
        "order_date":      now,
        "packed_date":     None,
        "shipped_date":    None,
        "delivered_date":  None,
        "cancelled_date":  None,
        "_source_type":    "manual_input",
        "created_by":      user.get("email", "system"),
        "created_at":      now,
        "updated_at":      now,
    }
    await db.marketing_orders.insert_one(doc)
    return serialize(doc)


@router.delete("/{order_id}")
async def delete_order(order_id: str, request: Request):
    """Delete a marketing order. Used for cancel/cleanup workflows."""
    await require_auth(request)
    db = get_db()
    res = await db.marketing_orders.delete_one({"id": order_id})
    if res.deleted_count == 0:
        # Try matching by order_id field (display ref)
        res = await db.marketing_orders.delete_one({"order_id": order_id})
        if res.deleted_count == 0:
            raise HTTPException(404, "Order not found")
    return {"ok": True, "message": "Order deleted"}


class StatusUpdateBody(BaseModel):
    status: str
    note: Optional[str] = None
    tracking_number: Optional[str] = None


@router.patch("/{order_id}/status")
async def update_order_status(
    order_id: str,
    body: StatusUpdateBody,
    request: Request
):
    await require_auth(request)
    user = _get_user(request)
    db = get_db()

    order = await db.marketing_orders.find_one({"id": order_id}, {"_id": 0, "status": 1})
    if not order:
        raise HTTPException(404, "Order not found")

    if body.status not in ORDER_STATUSES:
        raise HTTPException(400, f"Invalid status. Valid: {ORDER_STATUSES}")

    update: dict = {
        "status":     body.status,
        "updated_at": _now(),
        "updated_by": user.get("email", "system")
    }
    if body.note:
        update["note"]            = body.note
    if body.tracking_number:
        update["tracking_number"] = body.tracking_number
    if body.status == "packed":
        update["packed_date"]    = _now()
    if body.status == "shipped":
        update["shipped_date"]   = _now()
    if body.status == "delivered":
        update["delivered_date"] = _now()
    if body.status == "cancelled":
        update["cancelled_date"] = _now()

    await db.marketing_orders.update_one({"id": order_id}, {"$set": update})
    return {"ok": True, "new_status": body.status}


class BulkStatusBody(BaseModel):
    order_ids: List[str]
    status: str
    note: Optional[str] = None


@router.post("/bulk-status")
async def bulk_update_status(body: BulkStatusBody, request: Request):
    await require_auth(request)
    user = _get_user(request)
    db = get_db()

    if body.status not in ORDER_STATUSES:
        raise HTTPException(400, f"Invalid status: {body.status}")

    update: dict = {
        "status":     body.status,
        "updated_at": _now(),
        "updated_by": user.get("email", "system")
    }
    if body.note:
        update["note"] = body.note
    if body.status == "packed":
        update["packed_date"]    = _now()
    if body.status == "shipped":
        update["shipped_date"]   = _now()
    if body.status == "delivered":
        update["delivered_date"] = _now()

    result = await db.marketing_orders.update_many(
        {"id": {"$in": body.order_ids}},
        {"$set": update}
    )
    return {"ok": True, "updated_count": result.modified_count}
