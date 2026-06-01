"""
Dewi Accessories - Stock
Stock overview, movements, receive, issue
"""
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
import uuid
import logging
from datetime import datetime, timezone
from database import get_db
from auth import require_auth, serialize_doc

_log = logging.getLogger(__name__)

router = APIRouter(tags=["accessories-stock"])

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

@router.get("/stock")
async def get_stock_overview(request: Request):
    await require_auth(request)
    db = get_db()
    mats = await db.rahaza_materials.find(
        {"type": "accessory", "active": True}, {"_id": 0}
    ).sort("name", 1).to_list(2000)
    stock_map = await _all_accessory_stock(db)
    result = []
    for m in mats:
        qty = float(stock_map.get(m["id"], 0))
        min_stock = float(m.get("min_stock") or 0)
        result.append({
            "id": m["id"],
            "code": m.get("code", ""),
            "name": m.get("name", ""),
            "category": m.get("category", "Umum"),
            "unit": m.get("unit", "pcs"),
            "stock_qty": qty,
            "min_stock": min_stock,
            "stock_status": (
                "out" if qty <= 0
                else "low" if qty <= min_stock and min_stock > 0
                else "ok"
            ),
        })
    return serialize_doc(result)


@router.get("/stock/movements")
async def get_movements(request: Request):
    await require_auth(request)
    db = get_db()
    sp = request.query_params
    query: dict = {"domain": "accessory"}
    if sp.get("acc_id"):
        query["material_id"] = sp["acc_id"]
    if sp.get("movement_type"):
        # accept both legacy and canonical types
        mt = sp["movement_type"].strip()
        query["$or"] = [
            {"legacy_movement_type": mt.upper()},
            {"type": mt.lower()},
        ]
    docs = await db.rahaza_material_movements.find(query, {"_id": 0}).sort("created_at", -1).limit(500).to_list(500)
    out = [await _enrich_movement(db, d) for d in docs]
    return serialize_doc(out)


@router.post("/stock/receive")
async def receive_stock(request: Request):
    user = await require_auth(request)
    db = get_db()
    body = await request.json()
    acc_id = body.get("acc_id")
    try:
        qty = float(body.get("qty", 0))
    except Exception:
        raise HTTPException(400, "qty harus angka")
    if not acc_id or qty <= 0:
        raise HTTPException(400, "acc_id dan qty > 0 wajib diisi")

    item = await db.rahaza_materials.find_one({"id": acc_id, "type": "accessory", "active": True})
    if not item:
        raise HTTPException(404, "Aksesoris tidak ditemukan")
    
    # NEW: Check if input is in packs, convert to base unit
    input_unit = body.get("input_unit", "base")  # "base" or "pack"
    pack_size = item.get("pack_size", 1)
    if pack_size <= 0:
        pack_size = 1
    
    qty_in_base_unit = qty
    if input_unit == "pack":
        qty_in_base_unit = qty * pack_size
        _log.info(f"Receive: {qty} pack × {pack_size} = {qty_in_base_unit} {item.get('unit')}")

    loc_id = await _get_accessory_location_id(db)
    await _add_stock(db, acc_id, loc_id, qty_in_base_unit)
    await _log_movement(
        db, user,
        material_id=acc_id, mv_type="receive", qty=qty_in_base_unit,
        notes=body.get("notes", ""),
        related_ref=body.get("reference", ""),
        related_type="receive",
    )
    new_stock = await _stock_qty(db, acc_id)
    return {"ok": True, "new_stock_qty": new_stock}


@router.post("/stock/issue")
async def issue_stock(request: Request):
    user = await require_auth(request)
    db = get_db()
    body = await request.json()
    acc_id = body.get("acc_id")
    try:
        qty = float(body.get("qty", 0))
    except Exception:
        raise HTTPException(400, "qty harus angka")
    if not acc_id or qty <= 0:
        raise HTTPException(400, "acc_id dan qty > 0 wajib diisi")

    item = await db.rahaza_materials.find_one({"id": acc_id, "type": "accessory", "active": True})
    if not item:
        raise HTTPException(404, "Aksesoris tidak ditemukan")
    
    # NEW: Check if input is in packs, convert to base unit
    input_unit = body.get("input_unit", "base")  # "base" or "pack"
    pack_size = item.get("pack_size", 1)
    if pack_size <= 0:
        pack_size = 1
    
    qty_in_base_unit = qty
    if input_unit == "pack":
        qty_in_base_unit = qty * pack_size
        _log.info(f"Issue: {qty} pack × {pack_size} = {qty_in_base_unit} {item.get('unit')}")

    current = await _stock_qty(db, acc_id)
    if current < qty_in_base_unit:
        raise HTTPException(400, f"Stok tidak cukup. Stok saat ini: {current}")

    loc_id = await _get_accessory_location_id(db)
    await _add_stock(db, acc_id, loc_id, -qty_in_base_unit)
    await _log_movement(
        db, user,
        material_id=acc_id, mv_type="issue", qty=-qty_in_base_unit,
        related_type=body.get("ref_type", "manual"),
        related_ref=body.get("ref_id", ""),
        notes=body.get("notes", ""),
    )
    new_qty = await _stock_qty(db, acc_id)
    return JSONResponse({"ok": True, "new_qty": new_qty}, status_code=201)


# ═══════════════════════════════════════════════════════════════
# ⚠️  DEPRECATED (P3 TD-009 — Session #11.10)
# ─────────────────────────────────────────────────────────────────
# INTERNAL REQUESTS — superseded by SSOT `dewi_accessory_requests`
# with `request_type='internal_issuance'`. New client code MUST
# target `/api/dewi/accessory-requests` (routes/dewi_accessory_requests.py).
#
# Routes here remain functional for backward compat (1-week monitor
# before deletion). Stock-deduction side effect on `Issued` status
# remains in place — when migrating, the new endpoint will need an
# equivalent allocate/deliver hook (planned for follow-up).
#
# Migration script: migrations/migrate_acc_requests_consolidation.py
# Logger.info on legacy hits emitted by module-level import below.
# ═══════════════════════════════════════════════════════════════

DIVISI_OPTIONS = ["Produksi", "Cutting", "CMT", "Gudang", "Kantor", "SDM", "QC", "Packing", "Marketing", "Lainnya"]

_log.info(
    "[DEPRECATION] /api/acc/internal-requests/* is DEPRECATED — superseded by "
    "/api/dewi/accessory-requests (request_type='internal_issuance'). See P3 TD-009."
)


