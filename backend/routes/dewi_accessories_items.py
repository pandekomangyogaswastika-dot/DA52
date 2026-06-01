"""
Dewi Accessories - Items
Items CRUD (SSOT: rahaza_materials)
"""
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
import uuid
import logging
from datetime import datetime, timezone
from database import get_db
from auth import require_auth, serialize_doc

_log = logging.getLogger(__name__)

router = APIRouter(tags=["accessories-items"])

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
    # Pack conversion for display
    pack_size = mat.get("pack_size", 1)
    if pack_size <= 0:
        pack_size = 1
    pack_unit = mat.get("pack_unit", "pack")
    display_in_packs = mat.get("display_in_packs", False)
    
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
        # NEW: Pack info
        "pack_unit": pack_unit,
        "pack_size": pack_size,
        "display_in_packs": display_in_packs,
        "stock_qty_in_packs": round(stock_qty / pack_size, 2) if pack_size > 0 else stock_qty,
        "min_stock_in_packs": round(mat.get("min_stock", 0) / pack_size, 2) if pack_size > 0 else mat.get("min_stock", 0),
        "active": mat.get("active", True),
        "tags": mat.get("tags", []),
        "created_at": mat.get("created_at", _now_iso()),
    }

@router.get("/items")
async def list_items(request: Request):
    await require_auth(request)
    db = get_db()
    sp = request.query_params
    query: dict = {"type": "accessory", "active": True}
    if sp.get("search"):
        import re
        rx = re.compile(re.escape(sp["search"]), re.IGNORECASE)
        query["$or"] = [{"name": rx}, {"code": rx}, {"category": rx}]
    if sp.get("category"):
        query["category"] = sp["category"]

    mats = await db.rahaza_materials.find(query, {"_id": 0}).sort("name", 1).to_list(2000)
    stock_map = await _all_accessory_stock(db)
    items = [_material_to_acc_item(m, stock_map.get(m["id"], 0.0)) for m in mats]
    return serialize_doc(items)


@router.post("/items")
async def create_item(request: Request):
    user = await require_auth(request)
    db = get_db()
    body = await request.json()
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name wajib diisi")

    seq = (await db.rahaza_materials.count_documents({"type": "accessory"})) + 1
    code = (body.get("code") or f"ACC-{str(seq).zfill(4)}").strip().upper()

    # Duplicate code guard (only within accessory namespace + active)
    if await db.rahaza_materials.find_one({"code": code, "type": "accessory", "active": True}):
        raise HTTPException(409, f"Kode '{code}' sudah terpakai untuk aksesoris.")

    unit = _normalize_unit(body.get("unit") or "pcs")
    
    # NEW: Pack/packaging fields
    pack_unit = (body.get("pack_unit") or "pack").strip()
    pack_size = float(body.get("pack_size") or 1)
    if pack_size <= 0:
        pack_size = 1  # Safety fallback
    display_in_packs = bool(body.get("display_in_packs", False))
    
    doc = {
        "id": _id(),
        "code": code,
        "name": name,
        "type": "accessory",
        "unit": unit,
        "category": (body.get("category") or "Umum"),
        "description": body.get("description", ""),
        "min_stock": float(body.get("min_stock") or 0),
        "supplier": body.get("supplier", ""),
        "notes": body.get("notes", ""),
        # NEW: Pack fields
        "pack_unit": pack_unit,
        "pack_size": pack_size,
        "display_in_packs": display_in_packs,
        "active": True,
        "created_by": user.get("name", ""),
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    await db.rahaza_materials.insert_one(doc)
    out = _material_to_acc_item(doc, 0.0)
    return JSONResponse(serialize_doc(out), status_code=201)


@router.put("/items/{item_id}")
async def update_item(item_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    body = await request.json()
    existing = await db.rahaza_materials.find_one({"id": item_id, "type": "accessory"})
    if not existing:
        raise HTTPException(404, "Aksesoris tidak ditemukan")

    upd: dict = {}
    allowed = ("name", "category", "description", "supplier", "notes")
    for k in allowed:
        if k in body:
            upd[k] = body[k]
    if "code" in body and body["code"]:
        upd["code"] = str(body["code"]).strip().upper()
    if "unit" in body and body["unit"]:
        upd["unit"] = _normalize_unit(body["unit"])
    if "min_stock" in body:
        try:
            upd["min_stock"] = float(body["min_stock"] or 0)
        except Exception:
            upd["min_stock"] = 0.0
    
    # NEW: Pack fields update
    if "pack_unit" in body:
        upd["pack_unit"] = (body["pack_unit"] or "pack").strip()
    if "pack_size" in body:
        ps = float(body["pack_size"] or 1)
        upd["pack_size"] = ps if ps > 0 else 1
    if "display_in_packs" in body:
        upd["display_in_packs"] = bool(body["display_in_packs"])
    if "deleted" in body:
        upd["active"] = not bool(body["deleted"])
    upd["updated_at"] = _now_iso()

    await db.rahaza_materials.update_one({"id": item_id}, {"$set": upd})
    result = await db.rahaza_materials.find_one({"id": item_id}, {"_id": 0})
    qty = await _stock_qty(db, item_id)
    return serialize_doc(_material_to_acc_item(result, qty))


@router.delete("/items/{item_id}")
async def delete_item(item_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    res = await db.rahaza_materials.update_one(
        {"id": item_id, "type": "accessory"},
        {"$set": {"active": False, "updated_at": _now_iso()}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Aksesoris tidak ditemukan")
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════
# STOK — receive / issue / movements / overview
# ═══════════════════════════════════════════════════════════════

