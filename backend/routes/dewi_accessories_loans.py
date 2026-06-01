"""
Dewi Accessories - Loans
Accessory loans and returns
"""
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
import uuid
import logging
from datetime import datetime, timezone
from database import get_db
from auth import require_auth, serialize_doc

_log = logging.getLogger(__name__)

router = APIRouter(tags=["accessories-loans"])

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

@router.get("/loans")
async def list_loans(request: Request):
    await require_auth(request)
    db = get_db()
    sp = request.query_params
    query: dict = {}
    if sp.get("status"):
        query["status"] = sp["status"]
    docs = await db.acc_loans.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    return serialize_doc(docs)


@router.post("/loans")
async def create_loan(request: Request):
    user = await require_auth(request)
    db = get_db()
    body = await request.json()
    if not body.get("borrower_name"):
        raise HTTPException(400, "borrower_name wajib diisi")
    items = body.get("items") or []
    if not items:
        raise HTTPException(400, "items wajib diisi")

    # Pre-check stock
    for it in items:
        acc_id = it.get("acc_id")
        try:
            qty = float(it.get("qty", 0))
        except Exception:
            qty = 0.0
        if not acc_id or qty <= 0:
            continue
        current = await _stock_qty(db, acc_id)
        if current < qty:
            name = it.get("acc_name") or acc_id
            raise HTTPException(400, f"Stok {name} tidak cukup (ada: {current}, diminta: {qty})")

    seq = (await db.acc_loans.count_documents({})) + 1
    loan_id = _id()
    doc = {
        "id": loan_id,
        "loan_number": f"LOAN-{str(seq).zfill(4)}",
        "borrower_name": body["borrower_name"],
        "borrower_divisi": body.get("borrower_divisi", ""),
        "purpose": body.get("purpose", ""),
        "loan_date": body.get("loan_date", _now_iso()[:10]),
        "expected_return_date": body.get("expected_return_date", ""),
        "items": items,
        "status": "Active",
        "return_notes": "",
        "returned_at": "",
        "created_by": user.get("name", ""),
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    await db.acc_loans.insert_one(doc)

    loc_id = await _get_accessory_location_id(db)
    for it in items:
        acc_id = it.get("acc_id")
        try:
            qty = float(it.get("qty", 0))
        except Exception:
            qty = 0.0
        if not acc_id or qty <= 0:
            continue
        await _add_stock(db, acc_id, loc_id, -qty)
        await _log_movement(
            db, user,
            material_id=acc_id, mv_type="issue", qty=-qty,
            related_type="loan", related_ref=loan_id,
            notes=f"Dipinjam oleh {body['borrower_name']} - {doc['loan_number']}",
        )
    return JSONResponse(serialize_doc(doc), status_code=201)


@router.put("/loans/{loan_id}/return")
async def return_loan(loan_id: str, request: Request):
    user = await require_auth(request)
    db = get_db()
    body = await request.json()
    loan = await db.acc_loans.find_one({"id": loan_id})
    if not loan:
        raise HTTPException(404, "Peminjaman tidak ditemukan")
    if loan["status"] != "Active":
        raise HTTPException(400, "Peminjaman sudah dikembalikan")

    loc_id = await _get_accessory_location_id(db)
    for it in loan.get("items", []):
        acc_id = it.get("acc_id")
        try:
            qty = float(it.get("qty", 0))
        except Exception:
            qty = 0.0
        if not acc_id or qty <= 0:
            continue
        await _add_stock(db, acc_id, loc_id, qty)
        await _log_movement(
            db, user,
            material_id=acc_id, mv_type="receive", qty=qty,
            related_type="loan", related_ref=loan_id,
            notes=f"Dikembalikan oleh {loan['borrower_name']} - {loan['loan_number']}",
        )

    await db.acc_loans.update_one({"id": loan_id}, {"$set": {
        "status": "Returned",
        "return_notes": body.get("return_notes", ""),
        "returned_at": _now_iso(),
        "returned_by": user.get("name", ""),
        "updated_at": _now_iso(),
    }})
    result = await db.acc_loans.find_one({"id": loan_id}, {"_id": 0})
    return serialize_doc(result)


# ═══════════════════════════════════════════════════════════════
# STOK OPNAME — SSOT-backed (2026-05-23 migration)
# Storage: wh_opname_sessions2 (domain="accessory", count_items embedded)
# Status mapping: open <-> Active, approved <-> Completed, cancelled <-> Cancelled
# API contract preserved: ref_number, status, lines[].acc_id/acc_name/system_qty/diff
# ═══════════════════════════════════════════════════════════════

# ── adapter helpers: project wh_opname_sessions2 doc → legacy acc shape ──────
_STATUS_WH_TO_ACC = {"open": "Active", "approved": "Completed", "cancelled": "Cancelled",
                     "pending_approval": "Active", "counted": "Active"}


def _iso_str(ts) -> str:
    """Convert any datetime-ish into ISO string; pass-through if already str."""
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
    """Project one wh_opname_sessions2.count_items[] entry into legacy acc_opname_lines shape."""
    return {
        "id": item.get("line_id") or item.get("position_id") or "",
        "session_id": session_id,
        "acc_id": item.get("material_id") or item.get("position_id") or "",
        "acc_name": item.get("material_name", ""),
        "acc_code": item.get("material_code", ""),
        "unit": item.get("unit", "pcs"),
        "system_qty": float(item.get("system_qty") or 0),
        "counted_qty": item.get("counted_qty"),  # may be None
        "diff": item.get("variance"),            # may be None (kept under "diff" for FE back-compat)
        "notes": item.get("notes", ""),
        "counted_by": item.get("counted_by", ""),
        "counted_at": _iso_str(item.get("counted_at")),
    }


def _wh_session_to_acc(s: dict, include_lines: bool = False) -> dict:
    """Project a wh_opname_sessions2 doc into legacy acc_opname_sessions shape."""
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
    """Assign next legacy-style reference number (OPNAME-NNNN) for accessory opname."""
    seq = await db.wh_opname_sessions2.count_documents({"domain": "accessory"}) + 1
    return f"OPNAME-{str(seq).zfill(4)}"


# ── endpoints ────────────────────────────────────────────────────────────────

