"""
Dewi Accessories - Opname
Stock opname sessions (SSOT: wh_opname_sessions2)
"""
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
import uuid
import logging
from datetime import datetime, timezone
from database import get_db
from auth import require_auth

_log = logging.getLogger(__name__)

router = APIRouter(tags=["accessories-opname"])

# ── helpers ──────────────────────────────────────────────────────────────────
def _id():    return str(uuid.uuid4())
def _now_iso(): return datetime.now(timezone.utc).isoformat()
def _now():   return datetime.now(timezone.utc)

_VALID_UNITS = {
    "m", "cm", "yard", "inch",
    "kg", "gram", "ton",
    "pcs", "lusin", "kodi", "gross", "helai", "set", "pair",
    "rol", "gulung", "bal", "karton", "pak", "sak",
    "liter", "ml",
}

def _normalize_unit(unit: str) -> str:
    if not unit:
        return "pcs"
    u = str(unit).strip().lower()
    aliases = {
        "piece": "pcs", "pieces": "pcs", "buah": "pcs",
        "meter": "m", "centimeter": "cm",
        "kilogram": "kg", "gr": "gram", "grams": "gram",
        "pasang": "pair", "set/pair": "set",
        "rolls": "rol", "roll": "rol",
        "pack": "pak", "packs": "pak",
        "karton/dus": "karton", "dus": "karton",
    }
    u = aliases.get(u, u)
    return u if u in _VALID_UNITS else "pcs"

async def _get_accessory_location_id(db) -> str:
    loc = await db.rahaza_locations.find_one(
        {"code": "ZNA-AKSESORIS"}, {"_id": 0, "id": 1}
    )
    if loc:
        return loc["id"]
    new_id = _id()
    await db.rahaza_locations.insert_one({
        "id": new_id,
        "code": "ZNA-AKSESORIS",
        "name": "Area Aksesoris",
        "description": "Dedicated location for accessory items",
        "type": "warehouse",
        "active": True,
        "created_at": _now(),
    })
    return new_id

async def _stock_qty(db, material_id: str) -> float:
    stock = await db.rahaza_material_stock.find_one(
        {"material_id": material_id, "location.code": "ZNA-AKSESORIS"},
        {"_id": 0, "total_qty": 1}
    )
    return float(stock.get("total_qty", 0)) if stock else 0.0

async def _all_accessory_stock(db) -> dict:
    cursor = db.rahaza_material_stock.find(
        {"location.code": "ZNA-AKSESORIS"},
        {"_id": 0, "material_id": 1, "total_qty": 1}
    )
    stock_map = {}
    async for doc in cursor:
        stock_map[doc["material_id"]] = float(doc.get("total_qty", 0))
    return stock_map

async def _add_stock(db, material_id: str, location_id: str, delta: float):
    await db.rahaza_material_stock.update_one(
        {"material_id": material_id, "location.id": location_id},
        {
            "$inc": {"total_qty": delta},
            "$setOnInsert": {
                "material_id": material_id,
                "location": {"id": location_id, "code": "ZNA-AKSESORIS"},
                "created_at": _now(),
            },
            "$set": {"updated_at": _now()}
        },
        upsert=True
    )

async def _log_movement(db, user: dict, *, material_id: str, mv_type: str, qty: float,
                        notes: str = "", related_ref: str = "", related_type: str = ""):
    mat = await db.rahaza_materials.find_one(
        {"id": material_id}, {"_id": 0, "id": 1, "code": 1, "name": 1, "type": 1, "unit": 1}
    )
    if not mat:
        return
    loc_id = await _get_accessory_location_id(db)
    mvdoc = {
        "id": _id(),
        "material_id": material_id,
        "material": mat,
        "movement_type": mv_type,
        "qty_signed": qty,
        "location": {"id": loc_id, "code": "ZNA-AKSESORIS", "name": "Area Aksesoris"},
        "notes": notes,
        "reference_type": related_type,
        "reference_id": related_ref,
        "created_by": user.get("id", ""),
        "created_at": _now(),
    }
    await db.rahaza_material_movements.insert_one(mvdoc)

async def _enrich_movement(db, mv: dict) -> dict:
    if mv.get("related_req_id"):
        req = await db.acc_internal_requests.find_one(
            {"id": mv["related_req_id"]}, {"_id": 0, "request_number": 1, "division": 1}
        )
        if req:
            mv["related_request"] = req
    if mv.get("related_loan_id"):
        loan = await db.acc_loans.find_one(
            {"id": mv["related_loan_id"]}, {"_id": 0, "loan_number": 1, "borrower_name": 1}
        )
        if loan:
            mv["related_loan"] = loan
    return mv

def _material_to_acc_item(mat: dict, stock_qty: float = 0.0) -> dict:
    return {
        "id": mat.get("id", ""),
        "code": mat.get("code", ""),
        "name": mat.get("name", ""),
        "description": mat.get("description", ""),
        "unit": mat.get("unit", "pcs"),
        "color": mat.get("color", ""),
        "category": mat.get("category", ""),
        "min_stock": mat.get("min_stock", 0),
        "max_stock": mat.get("max_stock", 0),
        "stock_qty": stock_qty,
        "active": mat.get("active", True),
        "tags": mat.get("tags", []),
        "created_at": mat.get("created_at", _now_iso()),
    }

# Opname-specific helpers
_STATUS_WH_TO_ACC = {"open": "Active", "approved": "Completed", "cancelled": "Cancelled",
                     "pending_approval": "Active", "counted": "Active"}

def _iso_str(ts) -> str:
    if not ts:
        return ""
    if isinstance(ts, str):
        return ts
    if hasattr(ts, "isoformat"):
        try:
            return ts.isoformat()
        except Exception:
            return str(ts)
    return str(ts)

def _wh_line_to_acc(item: dict, session_id: str) -> dict:
    return {
        "id": item.get("line_id") or item.get("position_id") or "",
        "session_id": session_id,
        "acc_id": item.get("material_id") or item.get("position_id") or "",
        "acc_name": item.get("material_name", ""),
        "acc_code": item.get("material_code", ""),
        "unit": item.get("unit", "pcs"),
        "system_qty": float(item.get("system_qty") or 0),
        "counted_qty": item.get("counted_qty"),
        "diff": item.get("variance"),
        "notes": item.get("notes", ""),
        "counted_by": item.get("counted_by", ""),
        "counted_at": _iso_str(item.get("counted_at")),
    }

def _wh_session_to_acc(s: dict, include_lines: bool = False) -> dict:
    out = {
        "id": s.get("id"),
        "ref_number": s.get("session_no") or "",
        "notes": s.get("notes", ""),
        "status": _STATUS_WH_TO_ACC.get(s.get("status", ""), s.get("status", "Active")),
        "total_items": s.get("total_items", 0),
        "counted_items": s.get("counted_items", 0),
        "started_by": s.get("created_by", ""),
        "started_at": _iso_str(s.get("created_at")),
        "completed_by": s.get("approved_by", "") or "",
        "completed_at": _iso_str(s.get("approved_at")) or "",
        "created_at": _iso_str(s.get("created_at")),
        "updated_at": _iso_str(s.get("submitted_at") or s.get("approved_at") or s.get("created_at")),
    }
    if include_lines:
        out["lines"] = [_wh_line_to_acc(it, s.get("id", "")) for it in s.get("count_items", [])]
    return out

async def _next_acc_opname_ref(db) -> str:
    seq = await db.wh_opname_sessions2.count_documents({"domain": "accessory"}) + 1
    return f"OPNAME-{str(seq).zfill(4)}"

@router.get("/opname")
async def list_opname(request: Request):
    await require_auth(request)
    db = get_db()
    sessions = await db.wh_opname_sessions2.find(
        {"domain": "accessory"}, {"_id": 0}
    ).sort("created_at", -1).to_list(500)
    return [_wh_session_to_acc(s, include_lines=False) for s in sessions]


@router.post("/opname")
async def start_opname(request: Request):
    user = await require_auth(request)
    db = get_db()
    body = await request.json()

    active = await db.wh_opname_sessions2.find_one(
        {"domain": "accessory", "status": "open"}, {"_id": 0}
    )
    if active:
        raise HTTPException(400, f"Masih ada sesi opname aktif: {active.get('session_no')}")

    session_id = _id()
    ref = await _next_acc_opname_ref(db)

    # Snapshot semua aksesoris dengan stok sistem (dari SSOT rahaza_material_stock)
    mats = await db.rahaza_materials.find(
        {"type": "accessory", "active": True}, {"_id": 0}
    ).to_list(5000)
    stock_map = await _all_accessory_stock(db)
    count_items = []
    for m in mats:
        count_items.append({
            "line_id": _id(),                          # internal stable id for this row
            "material_id": m["id"],                    # SSOT material reference
            "position_id": m["id"],                    # back-compat alias (acc_id == material_id)
            "material_code": m.get("code", ""),
            "material_name": m.get("name", ""),
            "unit": m.get("unit", "pcs"),
            "system_qty": float(stock_map.get(m["id"], 0)),
            "counted_qty": None,
            "variance": None,
            "variance_pct": None,
            "notes": "",
            "counted": False,
        })

    session = {
        "id": session_id,
        "session_no": ref,
        "mode": "full_count",
        "scope_type": "all",
        "scope_id": "",
        "scope_label": "Aksesoris",
        "domain": "accessory",                          # ← SSOT discriminator
        "status": "open",
        "count_items": count_items,
        "total_items": len(count_items),
        "counted_items": 0,
        "total_variance_items": 0,
        "total_variance_value": 0.0,
        "notes": body.get("notes", ""),
        "created_at": _now(),
        "created_by": user.get("name", user.get("id", "")),
        "counted_by": None,
        "approved_by": None,
        "approved_at": None,
        "closed_at": None,
    }
    await db.wh_opname_sessions2.insert_one(session)
    out = await db.wh_opname_sessions2.find_one({"id": session_id}, {"_id": 0})
    return JSONResponse(_wh_session_to_acc(out, include_lines=True), status_code=201)


@router.get("/opname/{session_id}")
async def get_opname_detail(session_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    session = await db.wh_opname_sessions2.find_one(
        {"id": session_id, "domain": "accessory"}, {"_id": 0}
    )
    if not session:
        raise HTTPException(404, "Sesi tidak ditemukan")
    return _wh_session_to_acc(session, include_lines=True)


@router.put("/opname/{session_id}/count")
async def update_count(session_id: str, request: Request):
    user = await require_auth(request)
    db = get_db()
    body = await request.json()
    acc_id = body.get("acc_id")
    counted_qty = body.get("counted_qty")
    if acc_id is None or counted_qty is None:
        raise HTTPException(400, "acc_id dan counted_qty wajib diisi")

    session = await db.wh_opname_sessions2.find_one(
        {"id": session_id, "domain": "accessory"}
    )
    if not session:
        raise HTTPException(404, "Sesi tidak ditemukan")
    if session.get("status") != "open":
        raise HTTPException(400, "Sesi sudah selesai atau dibatalkan")

    items = session.get("count_items", [])
    target = None
    for item in items:
        # match either material_id or legacy position_id (kept identical for acc opname)
        if item.get("material_id") == acc_id or item.get("position_id") == acc_id:
            target = item
            break
    if target is None:
        raise HTTPException(404, "Baris opname tidak ditemukan")

    system_qty = float(target.get("system_qty") or 0)
    counted_qty_f = float(counted_qty)
    variance = counted_qty_f - system_qty
    variance_pct = (variance / system_qty * 100.0) if system_qty > 0 else (100.0 if counted_qty_f > 0 else 0.0)

    target["counted_qty"] = counted_qty_f
    target["variance"] = variance
    target["variance_pct"] = variance_pct
    target["notes"] = body.get("notes", "")
    target["counted_by"] = user.get("name", user.get("id", ""))
    target["counted_at"] = _now_iso()
    target["counted"] = True

    counted_items = sum(1 for it in items if it.get("counted"))
    total_variance_items = sum(1 for it in items if it.get("counted") and (it.get("variance") or 0) != 0)
    await db.wh_opname_sessions2.update_one(
        {"id": session_id, "domain": "accessory"},
        {"$set": {
            "count_items": items,
            "counted_items": counted_items,
            "total_variance_items": total_variance_items,
            "counted_by": user.get("name", user.get("id", "")),
        }},
    )
    return {"ok": True, "diff": variance}


@router.post("/opname/{session_id}/complete")
async def complete_opname(session_id: str, request: Request):
    """Apply adjustments + close session (skips pending_approval step for back-compat).

    Legacy acc workflow: Active → Completed (direct).
    SSOT: open → approved (with adjustments). No pending_approval step required."""
    user = await require_auth(request)
    db = get_db()
    session = await db.wh_opname_sessions2.find_one(
        {"id": session_id, "domain": "accessory"}
    )
    if not session:
        raise HTTPException(404, "Sesi tidak ditemukan")
    if session.get("status") != "open":
        raise HTTPException(400, "Sesi sudah selesai atau dibatalkan")

    loc_id = await _get_accessory_location_id(db)
    adjustments_made = 0
    total_variance_value = 0.0
    items = session.get("count_items", [])
    for ln in items:
        if not ln.get("counted"):
            continue
        diff = float(ln.get("variance") or 0)
        if diff == 0:
            continue
        material_id = ln.get("material_id") or ln.get("position_id")
        if not material_id:
            continue
        # Apply adjustment to stock + log to SSOT movements
        await _add_stock(db, material_id, loc_id, diff)
        await _log_movement(
            db, user,
            material_id=material_id, mv_type="adjust", qty=diff,
            related_type="opname", related_ref=session_id,
            notes=f"Adjustment opname {session['session_no']}",
        )
        adjustments_made += 1
        total_variance_value += abs(diff)

    now = _now()
    await db.wh_opname_sessions2.update_one(
        {"id": session_id, "domain": "accessory"},
        {"$set": {
            "status": "approved",
            "approved_by": user.get("name", user.get("id", "")),
            "approved_at": now,
            "closed_at": now,
            "submitted_at": now,
            "total_variance_value": total_variance_value,
        }},
    )
    return {"ok": True, "adjustments_made": adjustments_made}


@router.post("/opname/{session_id}/cancel")
async def cancel_opname(session_id: str, request: Request):
    user = await require_auth(request)
    db = get_db()
    res = await db.wh_opname_sessions2.update_one(
        {"id": session_id, "domain": "accessory"},
        {"$set": {
            "status": "cancelled",
            "closed_at": _now(),
            "approved_by": user.get("name", user.get("id", "")),
        }},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Sesi tidak ditemukan")
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════
# PURCHASE REQUEST (preserved: acc_purchase_requests)
# ═══════════════════════════════════════════════════════════════

