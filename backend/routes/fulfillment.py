"""
CV. Dewi Aditya — Fulfillment Management (Phase 6)
Bridge between Marketing Orders and Inventory FG

Flow:
1. Marketing order status "packed" → auto masuk fulfillment queue (fulfillment_status = "pending_fulfillment")
2. Admin Inventory: Allocate FG stock (manual select dari rahaza_material_stock)
3. Picking: Mark order sedang diambil dari gudang
4. Packing: Konfirmasi sudah dikemas
5. Dispatch: Scan out FG (kurangi stock) + Post COGS → Finance GL

Collections:
- marketing_orders (extend dengan fulfillment_status, fulfillment_items[], shipment_ref, dispatched_at)
- rahaza_material_stock (source FG stock: ownership=cv_da, inventory_category=fg_internal)

Endpoints:
- GET    /api/fulfillment/queue                    — List orders pending fulfillment
- GET    /api/fulfillment/orders/{id}              — Order detail dengan fulfillment info
- GET    /api/fulfillment/inventory/available      — List FG available untuk allocate
- POST   /api/fulfillment/orders/{id}/allocate     — Allocate FG stock ke order (manual select)
- POST   /api/fulfillment/orders/{id}/pick         — Start picking
- POST   /api/fulfillment/orders/{id}/pack         — Confirm packing done
- POST   /api/fulfillment/orders/{id}/dispatch     — Dispatch + reduce stock + post COGS
- GET    /api/fulfillment/summary                  — Stats dashboard
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, timezone
import uuid
import logging

from database import get_db
from auth import require_auth, serialize_doc, log_activity
from routes.rahaza_posting import post_cogs_shipment

logger = logging.getLogger(__name__)
router = APIRouter(prefix='/api/fulfillment', tags=['fulfillment'])

def _uid(): return str(uuid.uuid4())
def _now(): return datetime.now(timezone.utc)

# ── Pydantic Models ────────────────────────────────────────────────────────────

class FulfillmentItemIn(BaseModel):
    material_id: str = Field(..., description="Material ID dari rahaza_material_stock")
    sku_code: str = Field(default='', description="SKU code untuk reference")
    material_name: str = Field(default='', description="Nama material")
    qty_allocated: int = Field(..., ge=1, description="Qty yang dialokasikan")
    location_id: str = Field(default='', description="Location ID gudang")

class AllocateInventoryIn(BaseModel):
    items: List[FulfillmentItemIn] = Field(..., min_items=1, description="List FG items to allocate")

class DispatchIn(BaseModel):
    tracking_number: str = Field(default='', description="Nomor resi pengiriman")
    courier: str = Field(default='', description="Kurir pengiriman")
    notes: str = Field(default='', description="Catatan tambahan")

# ── Helpers ────────────────────────────────────────────────────────────────────

FULFILLMENT_STATUSES = ["pending_fulfillment", "allocated", "picking", "packed_ready", "dispatched", "delivered"]

async def _get_order(db, order_id: str):
    """Get marketing order by ID."""
    order = await db.marketing_orders.find_one({"id": order_id})
    if not order:
        raise HTTPException(404, f"Order {order_id} tidak ditemukan")
    return order

async def _check_fulfillment_status(order: dict, expected: List[str]):
    """Validate fulfillment status."""
    status = order.get("fulfillment_status", "")
    if status not in expected:
        raise HTTPException(400, f"Status fulfillment saat ini '{status}', harus salah satu dari: {expected}")

# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/summary")
async def fulfillment_summary(user: dict = Depends(require_auth)):
    """Dashboard summary stats."""
    db = get_db()
    
    pending = await db.marketing_orders.count_documents({"fulfillment_status": "pending_fulfillment"})
    allocated = await db.marketing_orders.count_documents({"fulfillment_status": "allocated"})
    picking = await db.marketing_orders.count_documents({"fulfillment_status": "picking"})
    packed = await db.marketing_orders.count_documents({"fulfillment_status": "packed_ready"})
    dispatched_today = await db.marketing_orders.count_documents({
        "fulfillment_status": "dispatched",
        "dispatched_at": {"$gte": _now().date().isoformat()}
    })
    
    return {
        "pending_fulfillment": pending,
        "allocated": allocated,
        "picking": picking,
        "packed_ready": packed,
        "dispatched_today": dispatched_today,
    }


@router.get("/queue")
async def get_fulfillment_queue(
    status: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
    user: dict = Depends(require_auth)
):
    """
    List orders in fulfillment queue.
    Filter by fulfillment_status.
    """
    db = get_db()
    
    query = {}
    if status:
        query["fulfillment_status"] = status
    else:
        # Default: show active fulfillment orders (not yet dispatched)
        query["fulfillment_status"] = {"$in": ["pending_fulfillment", "allocated", "picking", "packed_ready"]}
    
    cursor = db.marketing_orders.find(query, {"_id": 0}).sort("created_at", 1).skip(skip).limit(limit)
    orders = [serialize_doc(o) async for o in cursor]
    
    total = await db.marketing_orders.count_documents(query)
    
    return {
        "orders": orders,
        "total": total,
        "skip": skip,
        "limit": limit
    }


@router.get("/orders/{order_id}")
async def get_fulfillment_order_detail(order_id: str, user: dict = Depends(require_auth)):
    """Get order detail with fulfillment info."""
    db = get_db()
    order = await _get_order(db, order_id)
    return serialize_doc(order)


@router.get("/inventory/available")
async def get_available_inventory(
    search: Optional[str] = None,
    limit: int = 100,
    user: dict = Depends(require_auth)
):
    """
    List FG inventory available untuk allocate.
    Filter: ownership=cv_da, inventory_category=fg_internal, available_quantity > 0
    """
    db = get_db()
    
    query = {
        "ownership": "cv_da",
        "inventory_category": "fg_internal",
        "available_quantity": {"$gt": 0}
    }
    
    if search:
        query["$or"] = [
            {"material_id": {"$regex": search, "$options": "i"}},
            {"material_name": {"$regex": search, "$options": "i"}},
            {"material_code": {"$regex": search, "$options": "i"}}
        ]
    
    cursor = db.rahaza_material_stock.find(query, {"_id": 0}).sort("material_name", 1).limit(limit)
    items = [serialize_doc(i) async for i in cursor]
    
    return {
        "items": items,
        "total": len(items)
    }


@router.post("/orders/{order_id}/allocate")
async def allocate_inventory(
    order_id: str,
    payload: AllocateInventoryIn,
    user: dict = Depends(require_auth)
):
    """
    Allocate FG inventory ke order (manual select).
    Reserve qty di rahaza_material_stock (available_quantity -= qty, reserved_quantity += qty).
    """
    db = get_db()
    order = await _get_order(db, order_id)
    
    # Check status: harus pending_fulfillment
    await _check_fulfillment_status(order, ["pending_fulfillment"])
    
    # Validate & reserve stock
    fulfillment_items = []
    for item in payload.items:
        stock = await db.rahaza_material_stock.find_one({
            "material_id": item.material_id,
            "ownership": "cv_da",
            "inventory_category": "fg_internal"
        })
        
        if not stock:
            raise HTTPException(404, f"FG stock {item.material_id} tidak ditemukan")
        
        available = stock.get("available_quantity", 0)
        if available < item.qty_allocated:
            raise HTTPException(400, f"Stock {item.material_id} tidak cukup. Available: {available}, diminta: {item.qty_allocated}")
        
        # Reserve stock
        await db.rahaza_material_stock.update_one(
            {"id": stock["id"]},
            {
                "$inc": {
                    "available_quantity": -item.qty_allocated,
                    "reserved_quantity": item.qty_allocated
                },
                "$set": {"updated_at": _now()}
            }
        )
        
        fulfillment_items.append({
            "material_id": item.material_id,
            "sku_code": item.sku_code or stock.get("material_code", ""),
            "material_name": item.material_name or stock.get("material_name", ""),
            "qty_allocated": item.qty_allocated,
            "location_id": item.location_id or stock.get("location", ""),
            "stock_id": stock["id"]
        })
    
    # Update order
    await db.marketing_orders.update_one(
        {"id": order_id},
        {
            "$set": {
                "fulfillment_status": "allocated",
                "fulfillment_items": fulfillment_items,
                "allocated_at": _now(),
                "allocated_by": user.get("name", ""),
                "updated_at": _now()
            }
        }
    )
    
    await log_activity(
        user.get("id", ""),
        user.get("name", ""),
        "allocate_inventory",
        "marketing_orders",
        f"Allocate {len(fulfillment_items)} items untuk order {order.get('order_id')}"
    )
    
    return {
        "status": "success",
        "message": f"{len(fulfillment_items)} items dialokasikan",
        "fulfillment_items": fulfillment_items
    }


@router.post("/orders/{order_id}/pick")
async def start_picking(order_id: str, user: dict = Depends(require_auth)):
    """Mark order as picking (sedang diambil dari gudang)."""
    db = get_db()
    order = await _get_order(db, order_id)
    
    await _check_fulfillment_status(order, ["allocated"])
    
    await db.marketing_orders.update_one(
        {"id": order_id},
        {
            "$set": {
                "fulfillment_status": "picking",
                "picking_started_at": _now(),
                "picking_by": user.get("name", ""),
                "updated_at": _now()
            }
        }
    )
    
    await log_activity(
        user.get("id", ""),
        user.get("name", ""),
        "start_picking",
        "marketing_orders",
        f"Start picking order {order.get('order_id')}"
    )
    
    return {"status": "success", "message": "Picking dimulai"}


@router.post("/orders/{order_id}/pack")
async def confirm_packing(order_id: str, user: dict = Depends(require_auth)):
    """Confirm packing done (barang sudah dikemas, siap kirim)."""
    db = get_db()
    order = await _get_order(db, order_id)
    
    await _check_fulfillment_status(order, ["picking"])
    
    await db.marketing_orders.update_one(
        {"id": order_id},
        {
            "$set": {
                "fulfillment_status": "packed_ready",
                "packed_at": _now(),
                "packed_by": user.get("name", ""),
                "updated_at": _now()
            }
        }
    )
    
    await log_activity(
        user.get("id", ""),
        user.get("name", ""),
        "confirm_packing",
        "marketing_orders",
        f"Packing selesai untuk order {order.get('order_id')}"
    )
    
    return {"status": "success", "message": "Packing selesai"}


@router.post("/orders/{order_id}/dispatch")
async def dispatch_order(
    order_id: str,
    payload: DispatchIn,
    user: dict = Depends(require_auth)
):
    """
    Dispatch order:
    1. Reduce FG stock (reserved → actual reduction)
    2. Post COGS to Finance GL
    3. Update order status to dispatched
    """
    db = get_db()
    order = await _get_order(db, order_id)
    
    await _check_fulfillment_status(order, ["packed_ready"])
    
    fulfillment_items = order.get("fulfillment_items", [])
    if not fulfillment_items:
        raise HTTPException(400, "Tidak ada items yang dialokasikan")
    
    # 1. Reduce FG stock (reserved -> actual qty reduction)
    for item in fulfillment_items:
        stock_id = item.get("stock_id")
        qty = item.get("qty_allocated", 0)
        
        stock = await db.rahaza_material_stock.find_one({"id": stock_id})
        if not stock:
            logger.warning(f"Stock {stock_id} tidak ditemukan saat dispatch")
            continue
        
        # Reduce qty & reserved
        await db.rahaza_material_stock.update_one(
            {"id": stock_id},
            {
                "$inc": {
                    "quantity": -qty,
                    "reserved_quantity": -qty
                },
                "$set": {"updated_at": _now()}
            }
        )
        
        # Log movement
        await db.rahaza_material_movements.insert_one({
            "id": _uid(),
            "material_id": item.get("material_id"),
            "movement_type": "OUT",
            "quantity": -qty,
            "location_id": item.get("location_id", ""),
            "source_module": "fulfillment",
            "source_ref": order_id,
            "notes": f"Dispatch order {order.get('order_id')} - {item.get('material_name')}",
            "created_by": user.get("name", ""),
            "created_at": _now()
        })
    
    # 2. Post COGS (simplified: based on simple calculation or HPP if available)
    # For Phase 6 MVP: We'll create a simple shipment record and post COGS
    shipment_id = _uid()
    shipment_number = f"FUL-{order.get('order_id')}"
    
    shipment = {
        "id": shipment_id,
        "shipment_number": shipment_number,
        "order_id": order_id,
        "marketing_order_id": order_id,
        "items": [
            {
                "material_id": it.get("material_id"),
                "qty": it.get("qty_allocated"),
                "sku_code": it.get("sku_code")
            } for it in fulfillment_items
        ],
        "dispatched_at": _now(),
        "tracking_number": payload.tracking_number,
        "courier": payload.courier,
        "notes": payload.notes,
        "created_by": user.get("name", ""),
        "created_at": _now()
    }
    
    # Post COGS to GL (will use HPP if available, otherwise skip with warning)
    cogs_result = await post_cogs_shipment(db, shipment, user)
    
    # 3. Update order status
    await db.marketing_orders.update_one(
        {"id": order_id},
        {
            "$set": {
                "fulfillment_status": "dispatched",
                "dispatched_at": _now(),
                "dispatched_by": user.get("name", ""),
                "shipment_ref": shipment_id,
                "tracking_number": payload.tracking_number,
                "courier": payload.courier,
                "cogs_posted": cogs_result.get("ok", False),
                "cogs_je_id": cogs_result.get("je_id"),
                "cogs_je_number": cogs_result.get("je_number"),
                "cogs_error": cogs_result.get("error"),
                "updated_at": _now()
            }
        }
    )
    
    await log_activity(
        user.get("id", ""),
        user.get("name", ""),
        "dispatch_order",
        "marketing_orders",
        f"Dispatch order {order.get('order_id')} - {len(fulfillment_items)} items"
    )
    
    return {
        "status": "success",
        "message": "Order berhasil di-dispatch",
        "shipment_id": shipment_id,
        "shipment_number": shipment_number,
        "cogs_posted": cogs_result.get("ok", False),
        "cogs_je_number": cogs_result.get("je_number"),
        "cogs_error": cogs_result.get("error")
    }
