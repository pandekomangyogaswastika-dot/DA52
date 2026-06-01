"""
Session 13 — P1-14, P1-15, P1-16: Smart Inventory Features

P1-14: Alert Auto Gudang >90%
- GET /api/warehouse/alerts — rack occupancy alerts (>90% by default)

P1-15: Smart Reorder Point
- GET  /api/warehouse/smart-reorder — materials with smart reorder calc
- POST /api/warehouse/smart-reorder/{material_id} — update reorder point

P1-16: Undo Stock Reset (Soft Delete + Restore)
- POST /api/warehouse/stock-adjustments/{adj_id}/undo — soft-delete a stock adj
- POST /api/warehouse/stock-adjustments/{adj_id}/restore — restore a soft-deleted adj
- GET  /api/warehouse/stock-adjustments/undo-history — list of undoable adjustments (7 days)
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, Request, Query, HTTPException
from pydantic import BaseModel, Field
from database import get_db
from auth import require_auth

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/warehouse", tags=["warehouse-smart"])

# ──────────────────────────────────────────────────────────────────────────────
# DEPRECATION NOTICE (Session #11.14)
# ──────────────────────────────────────────────────────────────────────────────
# This module references LEGACY GEN 1 collections (per FORENSIC_04 Cluster 3):
#   - `warehouse_stock`      → superseded by `rahaza_material_stock` (SSOT)
#   - `warehouse_movements`  → superseded by `rahaza_material_movements` (SSOT)
#   - `warehouse_locations`  → superseded by `wh_positions` (SSOT)
#   - `warehouse_opname`     → superseded by `wh_opname2_cycles` (SSOT, TD-008)
#
# As of Session #11.14, all 4 collections in the test database are EMPTY
# (auto-recreated by server.py startup index code but never written to in
# current flows). Active routes are Smart Reorder, Rack Alerts, Undo Stock
# Reset which read from `rahaza_material_stock` + `rahaza_material_movements`
# and reuse the legacy collection names for historical reporting only.
#
# This router is kept for the smart-features API surface. New domain
# operations MUST use the SSOT collections. After monitor period the
# legacy collections (`warehouse_stock`, `warehouse_movements`,
# `warehouse_locations`, `warehouse_opname`) can be DROPPED and the
# corresponding indexes removed from server.py.
# ──────────────────────────────────────────────────────────────────────────────
logger.info(
    "[DEPRECATION] warehouse_stock/movements/locations/opname (legacy GEN 1) are "
    "DEPRECATED — superseded by rahaza_material_stock + rahaza_material_movements + "
    "wh_positions + wh_opname2_cycles SSOTs. dewi_warehouse_smart.py read-only "
    "shims may continue working; new writes MUST target SSOTs. See FORENSIC_04 Cluster 3."
)


def _now():
    return datetime.now(timezone.utc)


def ok(data=None, meta=None):
    r = {"success": True}
    if data is not None:
        r["data"] = data
    if meta is not None:
        r["metadata"] = meta
    return r


def serialize(o):
    if isinstance(o, list):
        return [serialize(i) for i in o]
    if isinstance(o, dict):
        return {k: serialize(v) for k, v in o.items() if k != "_id"}
    if isinstance(o, datetime):
        return o.isoformat()
    return o


# ═══════════════════════════════════════════════════════════════════════════
#  P1-14: WAREHOUSE OCCUPANCY ALERTS
# ═══════════════════════════════════════════════════════════════════════════

@router.get("/alerts")
async def get_warehouse_alerts(
    request: Request,
    threshold: int = Query(90, ge=0, le=100, description="Occupancy threshold %"),
):
    """
    P1-14: Warehouse alerts — racks at/above threshold occupancy.
    Also includes low stock alerts.
    """
    await require_auth(request)
    db = get_db()

    # Get rack occupancy
    racks = await db.rahaza_racks.find({}, {"_id": 0}).to_list(length=500)

    high_occupancy = []
    for rack in racks:
        total = rack.get("total_slots", 0)
        occupied = rack.get("occupied", rack.get("occupied_slots", 0))
        if total <= 0:
            continue
        pct = round(occupied / total * 100)
        if pct >= threshold:
            high_occupancy.append({
                "type": "rack_occupancy",
                "severity": "critical" if pct >= 95 else "warning",
                "rack_code": rack.get("rack_code", rack.get("code")),
                "location": rack.get("location", rack.get("zone")),
                "occupied": occupied,
                "total": total,
                "occupancy_pct": pct,
                "message": f"Rak {rack.get('rack_code', rack.get('code'))} mencapai {pct}% kapasitas",
            })

    # Get low stock alerts
    low_stock_mats = await db.rahaza_materials.find(
        {"active": True, "reorder_point": {"$gt": 0}},
        {"_id": 0, "id": 1, "name": 1, "sku": 1, "total_qty": 1, "reorder_point": 1, "unit": 1}
    ).to_list(length=500)

    low_stock_alerts = []
    for mat in low_stock_mats:
        qty = float(mat.get("total_qty", 0))
        rp = float(mat.get("reorder_point", 0))
        if qty <= rp:
            low_stock_alerts.append({
                "type": "low_stock",
                "severity": "critical" if qty <= 0 else "warning",
                "material_id": mat.get("id"),
                "material_name": mat.get("name"),
                "sku": mat.get("sku"),
                "current_qty": qty,
                "reorder_point": rp,
                "unit": mat.get("unit", ""),
                "message": f"Stok {mat.get('name')} ({qty} {mat.get('unit','')}) di bawah reorder point ({rp})",
            })

    all_alerts = high_occupancy + low_stock_alerts
    all_alerts.sort(key=lambda x: (0 if x["severity"] == "critical" else 1))

    return ok(
        data=all_alerts,
        meta={
            "total_alerts": len(all_alerts),
            "critical": sum(1 for a in all_alerts if a["severity"] == "critical"),
            "warning": sum(1 for a in all_alerts if a["severity"] == "warning"),
            "rack_alerts": len(high_occupancy),
            "stock_alerts": len(low_stock_alerts),
            "threshold_pct": threshold,
        }
    )


# ═══════════════════════════════════════════════════════════════════════════
#  P1-15: SMART REORDER POINT
# ═══════════════════════════════════════════════════════════════════════════

@router.get("/smart-reorder")
async def get_smart_reorder(
    request: Request,
    limit: int = Query(50, ge=1, le=200),
):
    """
    P1-15: Smart Reorder Point calculator.
    Calculates recommended reorder point based on:
    - Average daily consumption (from warehouse movements last 30 days)
    - Lead time (avg 7 days as default, override-able)
    - Safety stock (20% buffer)
    """
    await require_auth(request)
    db = get_db()

    # Get all active materials
    materials = await db.rahaza_materials.find(
        {"active": True},
        {"_id": 0}
    ).to_list(length=limit)

    since30 = _now() - timedelta(days=30)

    results = []
    for mat in materials:
        mat_id = mat.get("id")
        sku = mat.get("sku")

        # Get consumption from warehouse movements (last 30 days)
        movements = await db.warehouse_movements.find(
            {
                "sku": sku,
                "movement_type": "out",
                "created_at": {"$gte": since30}
            },
            {"_id": 0, "qty": 1, "created_at": 1}
        ).to_list(length=500)

        total_out = sum(float(m.get("qty", 0)) for m in movements)
        avg_daily_consumption = total_out / 30 if total_out > 0 else 0

        # Lead time days (use stored or default 7)
        lead_time_days = float(mat.get("lead_time_days", 7))

        # Safety stock = 20% buffer
        safety_stock = avg_daily_consumption * lead_time_days * 0.2

        # Smart reorder point = avg_daily × lead_time + safety_stock
        smart_rp = round((avg_daily_consumption * lead_time_days) + safety_stock, 2)

        current_rp = float(mat.get("reorder_point", 0))
        current_qty = float(mat.get("total_qty", 0))

        results.append({
            "material_id": mat_id,
            "name": mat.get("name"),
            "sku": sku,
            "unit": mat.get("unit"),
            "current_qty": current_qty,
            "current_reorder_point": current_rp,
            "smart_reorder_point": smart_rp,
            "avg_daily_consumption": round(avg_daily_consumption, 2),
            "lead_time_days": lead_time_days,
            "safety_stock": round(safety_stock, 2),
            "needs_update": abs(smart_rp - current_rp) > 1 if smart_rp > 0 else False,
            "status": "low" if current_qty <= current_rp else "ok",
            "movements_30d": len(movements),
        })

    # Sort by needs_update first, then by status
    results.sort(key=lambda x: (not x["needs_update"], x["status"] != "low"))

    return ok(
        data=results,
        meta={"total": len(results), "needs_update": sum(1 for r in results if r["needs_update"])}
    )


class UpdateReorderIn(BaseModel):
    reorder_point: float = Field(..., ge=0)
    lead_time_days: Optional[float] = None


@router.put("/smart-reorder/{material_id}")
async def update_smart_reorder(
    material_id: str,
    payload: UpdateReorderIn,
    request: Request,
):
    """P1-15: Update reorder point (and optional lead_time_days) for a material."""
    await require_auth(request)
    db = get_db()

    mat = await db.rahaza_materials.find_one({"id": material_id})
    if not mat:
        raise HTTPException(status_code=404, detail="Material tidak ditemukan")

    update_data = {"reorder_point": payload.reorder_point, "updated_at": _now().isoformat()}
    if payload.lead_time_days is not None:
        update_data["lead_time_days"] = payload.lead_time_days

    await db.rahaza_materials.update_one({"id": material_id}, {"$set": update_data})
    return ok(data={"material_id": material_id, "reorder_point": payload.reorder_point})


# ═══════════════════════════════════════════════════════════════════════════
#  P1-16: UNDO STOCK RESET (Soft Delete + Restore)
# ═══════════════════════════════════════════════════════════════════════════

@router.get("/stock-adjustments/undo-history")
async def get_undo_history(
    request: Request,
    days: int = Query(7, description="Tampilkan history N hari terakhir"),
):
    """
    P1-16: List stock adjustments that can be undone (last 7 days, not yet soft-deleted).
    Also shows recently soft-deleted (can be restored).
    """
    await require_auth(request)
    db = get_db()

    since = _now() - timedelta(days=days)

    # Get recent stock adjustments (movements with type 'reset' or 'adjustment')
    recent = await db.warehouse_movements.find(
        {
            "created_at": {"$gte": since},
            "movement_type": {"$in": ["adjustment", "reset", "opname"]},
        },
        {"_id": 0}
    ).sort("created_at", -1).to_list(length=200)

    undoable = [r for r in recent if not r.get("soft_deleted")]
    deleted  = [r for r in recent if r.get("soft_deleted")]

    return ok(
        data={"undoable": serialize(undoable), "soft_deleted": serialize(deleted)},
        meta={
            "undoable_count": len(undoable),
            "soft_deleted_count": len(deleted),
            "period_days": days,
        }
    )


@router.post("/stock-adjustments/{movement_id}/undo")
async def undo_stock_adjustment(
    movement_id: str,
    request: Request,
):
    """
    P1-16: Soft-delete a stock adjustment (undo).
    Reverses the qty effect and marks movement as soft_deleted.
    """
    user = await require_auth(request)
    db = get_db()

    movement = await db.warehouse_movements.find_one({"id": movement_id})
    if not movement:
        raise HTTPException(status_code=404, detail="Movement tidak ditemukan")
    if movement.get("soft_deleted"):
        raise HTTPException(status_code=400, detail="Movement sudah di-undo sebelumnya")

    # Check 7-day window
    created = movement.get("created_at")
    if created:
        if isinstance(created, str):
            try:
                created_dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
            except Exception:
                created_dt = _now()
        else:
            created_dt = created
        if (_now() - created_dt).days > 7:
            raise HTTPException(status_code=400, detail="Undo hanya bisa dilakukan dalam 7 hari")

    # Reverse the qty effect on material
    sku = movement.get("sku")
    qty = float(movement.get("qty", 0))
    mv_type = movement.get("movement_type", "")

    if sku and qty:
        if mv_type == "reset":
            # A reset set qty to a value; we can't fully reverse without snapshots,
            # so we just soft-delete and log a warning
            logger.warning(f"[undo] Reset movement {movement_id} — cannot fully reverse qty. Soft-deleting only.")
        else:
            # Reverse: if 'in' → subtract; if 'out' or 'adjustment' → add back
            direction = 1 if movement.get("direction") == "out" else -1
            await db.rahaza_materials.update_one(
                {"sku": sku},
                {"$inc": {"total_qty": direction * qty}}
            )

    # Mark as soft_deleted
    await db.warehouse_movements.update_one(
        {"id": movement_id},
        {"$set": {
            "soft_deleted": True,
            "deleted_at": _now().isoformat(),
            "deleted_by": user.get("email", "unknown"),
        }}
    )

    return ok(data={"movement_id": movement_id, "undone": True})


@router.post("/stock-adjustments/{movement_id}/restore")
async def restore_stock_adjustment(
    movement_id: str,
    request: Request,
):
    """
    P1-16: Restore a soft-deleted stock adjustment.
    """
    user = await require_auth(request)
    db = get_db()

    movement = await db.warehouse_movements.find_one({"id": movement_id})
    if not movement:
        raise HTTPException(status_code=404, detail="Movement tidak ditemukan")
    if not movement.get("soft_deleted"):
        raise HTTPException(status_code=400, detail="Movement tidak dalam status soft-deleted")

    # Re-apply the qty effect
    sku = movement.get("sku")
    qty = float(movement.get("qty", 0))
    mv_type = movement.get("movement_type", "")

    if sku and qty and mv_type != "reset":
        direction = -1 if movement.get("direction") == "out" else 1
        await db.rahaza_materials.update_one(
            {"sku": sku},
            {"$inc": {"total_qty": direction * qty}}
        )

    # Unmark soft_deleted
    await db.warehouse_movements.update_one(
        {"id": movement_id},
        {"$set": {
            "soft_deleted": False,
            "restored_at": _now().isoformat(),
            "restored_by": user.get("email", "unknown"),
        }}
    )

    return ok(data={"movement_id": movement_id, "restored": True})
