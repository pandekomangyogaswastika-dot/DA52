"""
PT Rahaza — Phase 22A: Material Reservation System

Endpoints (prefix /api/rahaza):
  Material Reservations:
    POST /materials/reserve              — reserve materials for WO (auto on release)
    GET  /materials/{id}/reservations    — get reservations for material
    GET  /materials/{id}/availability    — check available qty (stock - reserved)
    DELETE /materials/reservation/{id}   — release reservation (auto on WO complete/cancel)
    GET  /work-orders/{wo_id}/reservations — get all material reservations for WO

Purpose:
  - Prevent over-allocation of materials
  - Track reserved vs available inventory
  - Auto-reserve when WO released
  - Auto-release when WO completed/cancelled
"""
from fastapi import APIRouter, Request, HTTPException, Query
from database import get_db
from auth import require_auth
from datetime import datetime, timezone
from typing import Optional
import uuid
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/rahaza", tags=["rahaza-material-reservation"])


def _uid() -> str:
    return str(uuid.uuid4())


def _now():
    return datetime.now(timezone.utc)


# ─── MATERIAL AVAILABILITY ─────────────────────────────────────────────────
@router.get("/materials/{material_id}/availability")
async def get_material_availability(material_id: str, request: Request):
    """
    Get material availability (stock - reserved qty).
    Returns: {material_id, stock_qty, reserved_qty, available_qty, unit}
    """
    await require_auth(request)
    db = get_db()
    
    # Get material stock
    material = await db.rahaza_materials.find_one({"id": material_id}, {"_id": 0})
    if not material:
        raise HTTPException(404, "Material tidak ditemukan")
    
    # B1 Fix: Query rahaza_material_stock for canonical stock (not stale stock_qty from materials doc)
    stock_rows = await db.rahaza_material_stock.find(
        {"material_id": material_id}, {"_id": 0, "qty": 1}
    ).to_list(500)
    stock_qty = sum(float(s.get("qty") or 0) for s in stock_rows)

    # Calculate total reserved qty (status = active)
    pipeline = [
        {"$match": {"material_id": material_id, "status": "active"}},
        {"$group": {"_id": None, "total_reserved": {"$sum": "$reserved_qty"}}}
    ]
    result = await db.rahaza_material_reservations.aggregate(pipeline).to_list(1)
    reserved_qty = result[0].get("total_reserved", 0) if result else 0
    
    available_qty = max(0, stock_qty - reserved_qty)
    
    return {
        "material_id": material_id,
        "code": material.get("code"),
        "name": material.get("name"),
        "stock_qty": stock_qty,
        "reserved_qty": reserved_qty,
        "available_qty": available_qty,
        "unit": material.get("unit"),
    }


@router.get("/materials/{material_id}/reservations")
async def get_material_reservations(
    material_id: str,
    request: Request,
    status: Optional[str] = Query(None, description="active | released | cancelled")
):
    """Get all reservations for a material."""
    await require_auth(request)
    db = get_db()
    
    q = {"material_id": material_id}
    if status:
        q["status"] = status
    
    reservations = await db.rahaza_material_reservations.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return reservations


# ─── RESERVE MATERIALS ─────────────────────────────────────────────────────
@router.post("/materials/reserve")
async def reserve_materials(request: Request):
    """
    Reserve materials for a Work Order.
    Body: {wo_id, materials: [{material_id, required_qty}]}
    
    This is typically called automatically when WO is released.
    """
    user = await require_auth(request)
    db = get_db()
    
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON body")
    
    wo_id = body.get("wo_id")
    materials = body.get("materials", [])
    
    if not wo_id:
        raise HTTPException(400, "wo_id wajib diisi")
    if not materials:
        raise HTTPException(400, "materials array wajib diisi")
    
    # Verify WO exists
    wo = await db.rahaza_work_orders.find_one({"id": wo_id}, {"_id": 0})
    if not wo:
        raise HTTPException(404, "Work Order tidak ditemukan")
    
    created_reservations = []
    insufficient_materials = []
    
    for mat in materials:
        material_id = mat.get("material_id")
        required_qty = mat.get("required_qty", 0)
        
        if not material_id or required_qty <= 0:
            continue
        
        # Check availability
        availability = await get_material_availability(material_id, request)
        if availability["available_qty"] < required_qty:
            insufficient_materials.append({
                "material_id": material_id,
                "code": availability["code"],
                "name": availability["name"],
                "required": required_qty,
                "available": availability["available_qty"],
            })
            continue
        
        # Create reservation
        reservation = {
            "id": _uid(),
            "material_id": material_id,
            "wo_id": wo_id,
            "wo_order_id": wo.get("order_id"),
            "reserved_qty": required_qty,
            "status": "active",  # active | released | cancelled
            "created_at": _now().isoformat(),
            "created_by": user.get("id"),
            "created_by_name": user.get("name", user.get("email")),
        }
        await db.rahaza_material_reservations.insert_one(reservation)
        reservation.pop("_id", None)
        created_reservations.append(reservation)
    
    if insufficient_materials and not created_reservations:
        # All materials insufficient
        raise HTTPException(400, {
            "error": "Material tidak cukup",
            "insufficient": insufficient_materials,
        })
    
    return {
        "ok": True,
        "wo_id": wo_id,
        "reservations_created": len(created_reservations),
        "reservations": created_reservations,
        "insufficient_materials": insufficient_materials if insufficient_materials else None,
    }


# ─── RELEASE RESERVATION ───────────────────────────────────────────────────
@router.delete("/materials/reservation/{reservation_id}")
async def release_reservation(reservation_id: str, request: Request):
    """
    Release a material reservation (set status to released).
    This frees up the material for other WOs.
    """
    user = await require_auth(request)
    db = get_db()
    
    reservation = await db.rahaza_material_reservations.find_one({"id": reservation_id}, {"_id": 0})
    if not reservation:
        raise HTTPException(404, "Reservation tidak ditemukan")
    
    if reservation.get("status") != "active":
        raise HTTPException(400, f"Reservation sudah {reservation.get('status')}")
    
    await db.rahaza_material_reservations.update_one(
        {"id": reservation_id},
        {
            "$set": {
                "status": "released",
                "released_at": _now().isoformat(),
                "released_by": user.get("id"),
                "released_by_name": user.get("name", user.get("email")),
            }
        }
    )
    
    return {"ok": True, "reservation_id": reservation_id, "status": "released"}


@router.post("/work-orders/{wo_id}/release-reservations")
async def release_wo_reservations(wo_id: str, request: Request):
    """
    Release all material reservations for a Work Order.
    Typically called when WO is completed or cancelled.
    """
    user = await require_auth(request)
    db = get_db()
    
    result = await db.rahaza_material_reservations.update_many(
        {"wo_id": wo_id, "status": "active"},
        {
            "$set": {
                "status": "released",
                "released_at": _now().isoformat(),
                "released_by": user.get("id"),
                "released_by_name": user.get("name", user.get("email")),
            }
        }
    )
    
    return {
        "ok": True,
        "wo_id": wo_id,
        "reservations_released": result.modified_count,
    }


@router.get("/work-orders/{wo_id}/reservations")
async def get_wo_reservations(wo_id: str, request: Request):
    """Get all material reservations for a Work Order."""
    await require_auth(request)
    db = get_db()
    
    reservations = await db.rahaza_material_reservations.find(
        {"wo_id": wo_id},
        {"_id": 0}
    ).sort("created_at", -1).to_list(500)
    
    # Enrich with material info
    if reservations:
        material_ids = list(set(r["material_id"] for r in reservations))
        materials = await db.rahaza_materials.find(
            {"id": {"$in": material_ids}},
            {"_id": 0, "id": 1, "code": 1, "name": 1, "unit": 1}
        ).to_list(500)
        mat_map = {m["id"]: m for m in materials}
        
        for r in reservations:
            mat_info = mat_map.get(r["material_id"], {})
            r["material_code"] = mat_info.get("code")
            r["material_name"] = mat_info.get("name")
            r["unit"] = mat_info.get("unit")
    
    return reservations


# ─── ADMIN: LIST ALL RESERVATIONS ──────────────────────────────────────────
@router.get("/material-reservations")
async def list_all_reservations(
    request: Request,
    status: Optional[str] = Query(None, description="active | released | cancelled"),
    limit: int = Query(100, ge=1, le=500),
    skip: int = Query(0, ge=0),
):
    """Admin view: list all material reservations with material and WO info."""
    await require_auth(request)
    db = get_db()

    q = {}
    if status:
        q["status"] = status

    reservations = await db.rahaza_material_reservations.find(q, {"_id": 0}).sort(
        "created_at", -1
    ).skip(skip).limit(limit).to_list(500)

    total = await db.rahaza_material_reservations.count_documents(q)

    if reservations:
        mat_ids = list(set(r["material_id"] for r in reservations))
        wo_ids = list(set(r["wo_id"] for r in reservations))
        mats = await db.rahaza_materials.find(
            {"id": {"$in": mat_ids}}, {"_id": 0, "id": 1, "code": 1, "name": 1, "unit": 1}
        ).to_list(500)
        wos = await db.rahaza_work_orders.find(
            {"id": {"$in": wo_ids}}, {"_id": 0, "id": 1, "wo_number": 1}
        ).to_list(500)
        mat_map = {m["id"]: m for m in mats}
        wo_map = {w["id"]: w for w in wos}
        for r in reservations:
            m = mat_map.get(r["material_id"], {})
            r["material_code"] = m.get("code")
            r["material_name"] = m.get("name")
            r["unit"] = m.get("unit")
            w = wo_map.get(r["wo_id"], {})
            r["wo_number"] = w.get("wo_number")

    return {"reservations": reservations, "total": total, "limit": limit, "skip": skip}
