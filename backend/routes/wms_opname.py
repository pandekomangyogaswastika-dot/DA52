"""
WMS — Stock Opname (Cycle Count) berbasis Scanner per Rak
Phase 1.5: Inventory Verification

⚠️  DEPRECATED (P3 TD-008 — Session #11.9) — kept functional for backward
compatibility ONLY. Superseded by /api/wms/opname2/* (wms_opname2.py)
which uses the SSOT collection `wh_opname_sessions2` with embedded
count_items[] and approval workflow.

Migration script: /app/backend/migrations/migrate_opname_consolidation.py
maps `wh_opname_sessions` + `wh_opname_lines` (GEN2 scanner) to
`wh_opname_sessions2` (SSOT) with `domain='warehouse_scan'`.

Per TD-008 rule, this router is preserved for 1-week monitoring. New
client code MUST target /api/wms/opname2/*.

Flow:
  1. Operator pilih rak → POST /opname/start (rack_id) → buat sesi opname
     berisi snapshot semua posisi di rak + system_qty saat itu.
  2. Operator scan setiap posisi (barcode rak) + input qty fisik
     → POST /opname/{session_id}/scan {position_barcode, counted_qty}
     Server mencatat counted_qty + diff terhadap system_qty.
  3. Operator selesai hitung → POST /opname/{session_id}/complete
     Server membandingkan & otomatis bikin adjustment:
       - Jika counted > system → adjustment +qty (stok bertambah)
       - Jika counted < system → adjustment -qty (stok berkurang)
       - Jika counted == system → no-op
     Setiap adjustment masuk ke rahaza_fg_movements (source=opname_adjustment)
     dan rahaza_material_stock dimodifikasi sesuai.
  4. Sesi yang belum selesai bisa di-cancel.

Collections (DEPRECATED — superseded by wh_opname_sessions2 SSOT):
  - wh_opname_sessions: {id, ref, rack_id, building_id, zone_id, status, started_at, started_by, ...}
  - wh_opname_lines: {id, session_id, position_id, position_barcode, system_qty,
                       system_material_id, counted_qty, counted_at, scanned_by, diff,
                       material_id_actual (kalau ganti material), notes}

Routes:
  POST   /api/wms/opname/start                — start sesi (snapshot)
  GET    /api/wms/opname                      — list sesi
  GET    /api/wms/opname/{session_id}         — detail + lines + diff summary
  POST   /api/wms/opname/{session_id}/scan    — scan satu posisi (counted_qty)
  POST   /api/wms/opname/{session_id}/complete — finalize + adjust stok
  POST   /api/wms/opname/{session_id}/cancel  — batalkan
"""
# ruff: noqa: E741

import uuid
import logging
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException, Request, Query
from pydantic import BaseModel, Field
from database import get_db
from auth import require_auth, serialize_doc, log_activity
from utils.counters import next_counter

logger = logging.getLogger(__name__)
logger.info(
    "[DEPRECATION] /api/wms/opname/* is DEPRECATED — superseded by "
    "/api/wms/opname2/* (wh_opname_sessions2 SSOT). See P3 TD-008."
)

router = APIRouter(prefix="/api/wms", tags=["wms-opname-deprecated"])


def _uid(): return str(uuid.uuid4())
def _now(): return datetime.now(timezone.utc)


async def _next_opname_ref(db) -> str:
    seq = await next_counter(db, "OPN", namespace="wms")
    return f"OPN-{seq:05d}"


# ─── Models ───────────────────────────────────────────────────────────────────

class OpnameStartIn(BaseModel):
    rack_id: str
    notes: Optional[str] = None


class OpnameScanIn(BaseModel):
    position_barcode: str = Field(..., description="Barcode posisi yang di-scan")
    counted_qty: float = Field(..., ge=0, description="Qty fisik yang dihitung")
    material_id: Optional[str] = Field(None, description="Material yang ada di slot — boleh berbeda dari sistem")
    material_code: Optional[str] = None
    material_name: Optional[str] = None
    notes: Optional[str] = None


# ══════════════════════════════════════════════════════════════════════════════
# START SESSION (snapshot positions in rack)
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/opname/start")
async def opname_start(data: OpnameStartIn, request: Request):
    """Mulai sesi opname untuk satu rak. Membuat snapshot semua posisi."""
    user = await require_auth(request)
    db = get_db()

    rack = await db.wh_racks.find_one({"id": data.rack_id, "active": True}, {"_id": 0})
    if not rack:
        raise HTTPException(404, "Rak tidak ditemukan")

    # Cegah multiple sesi aktif untuk rak yang sama
    existing = await db.wh_opname_sessions.find_one({
        "rack_id": data.rack_id, "status": {"$in": ["draft", "in_progress"]}
    }, {"_id": 0})
    if existing:
        raise HTTPException(400, f"Masih ada sesi opname aktif untuk rak ini: {existing.get('ref_number')}")

    positions = await db.wh_positions.find({"rack_id": data.rack_id}, {"_id": 0})\
        .sort([("shelf_no", 1), ("slot_no", 1)]).to_list(500)

    if not positions:
        raise HTTPException(400, "Rak tidak memiliki posisi untuk di-opname")

    ref = await _next_opname_ref(db)
    session_id = _uid()
    session = {
        "id": session_id, "ref_number": ref,
        "rack_id": data.rack_id, "rack_code": rack["code"], "rack_name": rack.get("name"),
        "zone_id": rack["zone_id"], "zone_code": rack.get("zone_code"),
        "building_id": rack["building_id"], "building_code": rack.get("building_code"),
        "total_positions": len(positions), "scanned_positions": 0,
        "status": "in_progress", "notes": data.notes or "",
        "started_at": _now(), "started_by": user.get("email", user.get("name", "system")),
        "started_by_name": user.get("name", ""),
        "completed_at": None, "completed_by": None,
        "cancelled_at": None,
        "summary": None,  # filled at complete
    }
    await db.wh_opname_sessions.insert_one(session)

    # Snapshot lines
    lines = []
    for p in positions:
        lines.append({
            "id": _uid(), "session_id": session_id,
            "position_id": p["id"], "position_barcode": p["barcode"],
            "shelf_no": p.get("shelf_no"), "slot_no": p.get("slot_no"),
            "label": p.get("label"),
            # snapshot system state at session start
            "system_material_id": p.get("material_id"),
            "system_material_code": p.get("material_code"),
            "system_material_name": p.get("material_name"),
            "system_qty": float(p.get("qty", 0) or 0),
            "system_unit": p.get("unit"),
            # to be filled by scan
            "counted_qty": None,
            "counted_material_id": None,
            "counted_material_code": None,
            "counted_material_name": None,
            "diff": None,
            "scanned_at": None, "scanned_by": None,
            "scanned": False,
            "notes": "",
        })
    if lines:
        await db.wh_opname_lines.insert_many(lines)

    await log_activity(user["id"], user.get("name", ""), "create", "wh_opname",
                       f"Start opname {ref} rak {rack.get('code')} ({len(positions)} posisi)")

    return serialize_doc({
        "message": f"Sesi opname {ref} dibuat ({len(positions)} posisi siap di-scan)",
        "session_id": session_id,
        "ref_number": ref,
        "rack": {"id": rack["id"], "code": rack["code"], "name": rack.get("name")},
        "total_positions": len(positions),
    })


# ══════════════════════════════════════════════════════════════════════════════
# LIST + DETAIL
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/opname")
async def opname_list(
    request: Request,
    status: Optional[str] = None,
    rack_id: Optional[str] = None,
    limit: int = Query(50, le=200),
):
    await require_auth(request)
    db = get_db()
    q = {}
    if status:
        q["status"] = status
    if rack_id:
        q["rack_id"] = rack_id
    sessions = await db.wh_opname_sessions.find(q, {"_id": 0}).sort("started_at", -1).limit(limit).to_list(500)
    return serialize_doc(sessions)


@router.get("/opname/{session_id}")
async def opname_detail(session_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    session = await db.wh_opname_sessions.find_one({"id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(404, "Sesi opname tidak ditemukan")
    lines = await db.wh_opname_lines.find({"session_id": session_id}, {"_id": 0})\
        .sort([("shelf_no", 1), ("slot_no", 1)]).to_list(500)

    # Live diff summary (untuk in-progress)
    scanned = [l for l in lines if l.get("scanned")]
    total_diff = 0.0
    pos_diff = 0
    neg_diff = 0
    for l in scanned:
        diff = l.get("diff") or 0
        total_diff += diff
        if diff > 0:
            pos_diff += 1
        elif diff < 0:
            neg_diff += 1

    session["lines"] = lines
    session["scanned_count"] = len(scanned)
    session["unscanned_count"] = len(lines) - len(scanned)
    session["live_summary"] = {
        "total_diff_qty": round(total_diff, 4),
        "positions_with_surplus": pos_diff,
        "positions_with_shortage": neg_diff,
    }
    return serialize_doc(session)


# ══════════════════════════════════════════════════════════════════════════════
# SCAN A POSITION
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/opname/{session_id}/scan")
async def opname_scan(session_id: str, data: OpnameScanIn, request: Request):
    """Scan satu posisi: rekam counted_qty dan compute diff vs system snapshot."""
    user = await require_auth(request)
    db = get_db()

    session = await db.wh_opname_sessions.find_one({"id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(404, "Sesi tidak ditemukan")
    if session["status"] not in ("in_progress", "draft"):
        raise HTTPException(400, f"Sesi sudah {session['status']}, tidak bisa scan lagi")

    line = await db.wh_opname_lines.find_one(
        {"session_id": session_id, "position_barcode": data.position_barcode}, {"_id": 0}
    )
    if not line:
        raise HTTPException(404, f"Barcode {data.position_barcode} bukan bagian dari rak ini")

    # Counted material — default ke system snapshot kalau tidak diisi
    counted_mat_id = data.material_id or line.get("system_material_id")
    counted_mat_code = data.material_code or line.get("system_material_code")
    counted_mat_name = data.material_name or line.get("system_material_name")

    diff = float(data.counted_qty) - float(line.get("system_qty", 0) or 0)

    update_doc = {
        "counted_qty": float(data.counted_qty),
        "counted_material_id": counted_mat_id,
        "counted_material_code": counted_mat_code,
        "counted_material_name": counted_mat_name,
        "diff": round(diff, 4),
        "scanned": True,
        "scanned_at": _now(),
        "scanned_by": user.get("email", user.get("name", "system")),
        "notes": data.notes or "",
    }
    await db.wh_opname_lines.update_one(
        {"session_id": session_id, "position_barcode": data.position_barcode},
        {"$set": update_doc}
    )

    # Update session counter
    scanned_count = await db.wh_opname_lines.count_documents(
        {"session_id": session_id, "scanned": True}
    )
    await db.wh_opname_sessions.update_one(
        {"id": session_id},
        {"$set": {"scanned_positions": scanned_count, "updated_at": _now()}}
    )

    return serialize_doc({
        "ok": True,
        "position_barcode": data.position_barcode,
        "system_qty": line.get("system_qty"),
        "counted_qty": data.counted_qty,
        "diff": round(diff, 4),
        "scanned_count": scanned_count,
        "total_positions": session.get("total_positions"),
        "remaining": session.get("total_positions", 0) - scanned_count,
    })


# ══════════════════════════════════════════════════════════════════════════════
# COMPLETE — apply adjustments
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/opname/{session_id}/complete")
async def opname_complete(session_id: str, request: Request):
    """
    Finalize opname: posisi yang tidak di-scan dianggap sesuai sistem (skipped).
    Posisi yang di-scan dengan diff != 0 menghasilkan adjustment otomatis:
      - Update wh_positions (qty + material info)
      - Update rahaza_material_stock (+/- diff)
      - Catat di rahaza_fg_movements dengan source=opname_adjustment
    """
    user = await require_auth(request)
    db = get_db()

    session = await db.wh_opname_sessions.find_one({"id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(404, "Sesi tidak ditemukan")
    if session["status"] in ("completed", "cancelled"):
        raise HTTPException(400, f"Sesi sudah {session['status']}")

    lines = await db.wh_opname_lines.find({"session_id": session_id, "scanned": True}, {"_id": 0}).to_list(500)
    if not lines:
        raise HTTPException(400, "Belum ada posisi yang di-scan")

    # Default location for stock ledger
    default_loc = await db.rahaza_locations.find_one({"active": True}, {"_id": 0})
    loc_id = default_loc["id"] if default_loc else None

    adjustments = []
    surplus_count = 0
    shortage_count = 0
    no_change_count = 0

    for line in lines:
        diff = line.get("diff") or 0
        counted_qty = line.get("counted_qty") or 0
        position_id = line["position_id"]
        counted_mat_id = line.get("counted_material_id")
        counted_mat_code = line.get("counted_material_code")
        counted_mat_name = line.get("counted_material_name")
        system_mat_id = line.get("system_material_id")

        if abs(diff) < 0.0001 and counted_mat_id == system_mat_id:
            no_change_count += 1
            continue

        # 1) Update position (qty + material)
        pos_status = "occupied" if (counted_mat_id and counted_qty > 0) else "empty"
        await db.wh_positions.update_one(
            {"id": position_id},
            {"$set": {
                "qty": float(counted_qty),
                "material_id": counted_mat_id if counted_qty > 0 else None,
                "material_code": counted_mat_code if counted_qty > 0 else None,
                "material_name": counted_mat_name if counted_qty > 0 else None,
                "status": pos_status,
                "last_updated": _now(),
                "updated_by": user.get("email", "opname"),
            }}
        )

        # 2) Adjust rahaza_material_stock
        # Jika system material tetap, naik/turunkan qty.
        # Jika beda material (rare), kurangi system_mat dan tambah counted_mat.
        if loc_id:
            # Kurangi system material (kalau ada qty system)
            if system_mat_id and (line.get("system_qty") or 0) > 0:
                if system_mat_id == counted_mat_id:
                    # Same material — apply diff directly
                    await db.rahaza_material_stock.update_one(
                        {"material_id": system_mat_id, "location_id": loc_id},
                        {"$inc": {"qty": diff}, "$set": {"updated_at": _now()}, "$setOnInsert": {"id": _uid(), "material_id": system_mat_id, "location_id": loc_id}},
                        upsert=True,
                    )
                else:
                    # Different material → zero-out system, set counted
                    await db.rahaza_material_stock.update_one(
                        {"material_id": system_mat_id, "location_id": loc_id},
                        {"$inc": {"qty": -float(line.get("system_qty") or 0)}, "$set": {"updated_at": _now()}}
                    )
                    if counted_mat_id and counted_qty > 0:
                        await db.rahaza_material_stock.update_one(
                            {"material_id": counted_mat_id, "location_id": loc_id},
                            {"$inc": {"qty": float(counted_qty)}, "$set": {"updated_at": _now()},
                             "$setOnInsert": {"id": _uid(), "material_id": counted_mat_id, "location_id": loc_id}},
                            upsert=True,
                        )
            elif counted_mat_id and counted_qty > 0:
                # System empty → add counted
                await db.rahaza_material_stock.update_one(
                    {"material_id": counted_mat_id, "location_id": loc_id},
                    {"$inc": {"qty": float(counted_qty)}, "$set": {"updated_at": _now()},
                     "$setOnInsert": {"id": _uid(), "material_id": counted_mat_id, "location_id": loc_id}},
                    upsert=True,
                )

        # 3) Movement log
        if abs(diff) >= 0.0001:
            await db.rahaza_fg_movements.insert_one({
                "id": _uid(),
                "material_id": counted_mat_id or system_mat_id,
                "fg_code": counted_mat_code or line.get("system_material_code"),
                "direction": "adjust_in" if diff > 0 else "adjust_out",
                "qty": abs(diff),
                "source": "opname_adjustment",
                "session_id": session_id,
                "session_ref": session.get("ref_number"),
                "position_id": position_id,
                "position_barcode": line.get("position_barcode"),
                "notes": f"Opname diff: system {line.get('system_qty')} → counted {counted_qty}",
                "timestamp": _now(),
                "created_by": user.get("email", "opname"),
            })

        adjustments.append({
            "position_barcode": line.get("position_barcode"),
            "label": line.get("label"),
            "system_qty": line.get("system_qty"),
            "counted_qty": counted_qty,
            "diff": diff,
            "material_change": system_mat_id != counted_mat_id,
        })

        if diff > 0:
            surplus_count += 1
        elif diff < 0:
            shortage_count += 1

    summary = {
        "total_lines_scanned": len(lines),
        "no_change": no_change_count,
        "surplus": surplus_count,
        "shortage": shortage_count,
        "total_adjustments": len(adjustments),
        "completed_at": _now().isoformat(),
    }
    await db.wh_opname_sessions.update_one(
        {"id": session_id},
        {"$set": {
            "status": "completed",
            "completed_at": _now(),
            "completed_by": user.get("email", user.get("name", "system")),
            "summary": summary,
        }}
    )
    await log_activity(user["id"], user.get("name", ""), "complete", "wh_opname",
                       f"Opname {session.get('ref_number')} selesai: {surplus_count} surplus, {shortage_count} shortage")

    # Trigger rack occupancy alert check for the rack we just adjusted
    try:
        from routes.wms_receiving import helper_check_rack_occupancy_alert
        await helper_check_rack_occupancy_alert(db, session.get("rack_id"))
    except Exception:
        pass

    return serialize_doc({
        "message": f"Opname selesai. {len(adjustments)} adjustment diterapkan.",
        "summary": summary,
        "adjustments": adjustments,
    })


@router.post("/opname/{session_id}/cancel")
async def opname_cancel(session_id: str, request: Request):
    user = await require_auth(request)
    db = get_db()
    session = await db.wh_opname_sessions.find_one({"id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(404, "Sesi tidak ditemukan")
    if session["status"] == "completed":
        raise HTTPException(400, "Sesi yang sudah completed tidak bisa dibatalkan")
    await db.wh_opname_sessions.update_one(
        {"id": session_id},
        {"$set": {"status": "cancelled", "cancelled_at": _now(),
                  "cancelled_by": user.get("email", user.get("name", "system"))}}
    )
    return {"message": "Sesi opname dibatalkan"}
