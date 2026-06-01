"""
Dewi Accessories - Purchase
Purchase requests to finance
"""
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
import uuid
import logging
from datetime import datetime, timezone
from database import get_db
from auth import require_auth, serialize_doc

_log = logging.getLogger(__name__)

router = APIRouter(tags=["accessories-purchase"])

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

@router.get("/purchase-requests")
async def list_purchase_requests(request: Request):
    await require_auth(request)
    db = get_db()
    sp = request.query_params
    query: dict = {}
    if sp.get("status"):
        query["status"] = sp["status"]
    docs = await db.acc_purchase_requests.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    return serialize_doc(docs)


@router.post("/purchase-requests")
async def create_purchase_request(request: Request):
    user = await require_auth(request)
    db = get_db()
    body = await request.json()
    items = body.get("items") or []
    if not items:
        raise HTTPException(400, "items wajib diisi")
    
    # NEW: Process pack conversion for each item
    for item in items:
        input_unit = item.get("input_unit", "base")  # "base" or "pack"
        if input_unit == "pack" and item.get("acc_id"):
            mat = await db.rahaza_materials.find_one({"id": item["acc_id"]}, {"_id": 0})
            if mat and mat.get("pack_size"):
                pack_size = float(mat.get("pack_size", 1))
                qty_in_packs = float(item.get("qty_requested", 0))
                qty_in_base = qty_in_packs * pack_size
                item["qty_requested"] = qty_in_base
                item["qty_requested_in_packs"] = qty_in_packs
                item["pack_unit"] = mat.get("pack_unit", "pack")
                item["pack_size"] = pack_size
                _log.info(f"PR pack mode: {qty_in_packs} {item['pack_unit']} × {pack_size} = {qty_in_base}")

    seq = (await db.acc_purchase_requests.count_documents({})) + 1
    doc = {
        "id": _id(),
        "pr_number": f"ACC-PR-{str(seq).zfill(4)}",
        "priority": body.get("priority", "Normal"),
        "purpose": body.get("purpose", ""),
        "supplier": body.get("supplier", ""),
        "items": items,
        "total_estimated": sum(
            float(i.get("qty_requested") or 0) * float(i.get("estimated_price") or 0)
            for i in items
        ),
        "notes": body.get("notes", ""),
        "status": "Draft",
        "submitted_at": "",
        "approved_by": "", "approved_at": "",
        "finance_notes": "",
        "created_by": user.get("name", ""),
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    await db.acc_purchase_requests.insert_one(doc)
    return JSONResponse(serialize_doc(doc), status_code=201)


@router.put("/purchase-requests/{pr_id}")
async def update_purchase_request(pr_id: str, request: Request):
    user = await require_auth(request)
    db = get_db()
    body = await request.json()
    doc = await db.acc_purchase_requests.find_one({"id": pr_id})
    if not doc:
        raise HTTPException(404, "PR tidak ditemukan")

    new_status = body.get("status")
    upd: dict = {"updated_at": _now_iso()}

    if new_status == "Submitted":
        upd.update({"status": "Submitted", "submitted_at": _now_iso()})
    elif new_status == "Approved":
        upd.update({
            "status": "Approved",
            "approved_by": user.get("name", ""),
            "approved_at": _now_iso(),
            "finance_notes": body.get("finance_notes", ""),
        })
    elif new_status == "Rejected":
        upd.update({
            "status": "Rejected",
            "finance_notes": body.get("finance_notes", ""),
            "rejected_by": user.get("name", ""),
            "rejected_at": _now_iso(),
        })
    elif new_status == "Ordered":
        upd.update({"status": "Ordered", "ordered_at": _now_iso()})
    elif new_status == "Received":
        loc_id = await _get_accessory_location_id(db)
        for it in doc.get("items", []):
            acc_id = it.get("acc_id")
            try:
                qty = float(it.get("qty_requested") or 0)
            except Exception:
                qty = 0.0
            if not acc_id or qty <= 0:
                continue
            await _add_stock(db, acc_id, loc_id, qty)
            await _log_movement(
                db, user,
                material_id=acc_id, mv_type="receive", qty=qty,
                related_type="purchase_request", related_ref=pr_id,
                notes=f"Terima dari PR {doc['pr_number']}",
            )
        upd.update({"status": "Received", "received_at": _now_iso()})
    else:
        allowed = {k: v for k, v in body.items() if k not in ("_id", "id", "created_at", "created_by", "pr_number")}
        upd.update(allowed)

    await db.acc_purchase_requests.update_one({"id": pr_id}, {"$set": upd})
    result = await db.acc_purchase_requests.find_one({"id": pr_id}, {"_id": 0})
    return serialize_doc(result)


# ═══════════════════════════════════════════════════════════════
# DASHBOARD
# ═══════════════════════════════════════════════════════════════

