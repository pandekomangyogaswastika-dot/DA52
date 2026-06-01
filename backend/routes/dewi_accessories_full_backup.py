"""
Aksesoris Management — SSOT-backed implementation (P1.A consolidation, 2026-05-22).

API CONTRACT UNCHANGED. Frontend `/api/acc/*` endpoints tetap berfungsi sama.

INTERNAL CHANGES:
    Old (legacy)              -> New (SSOT)
    -----------               -----------
    acc_items                 -> rahaza_materials (filter type='accessory')
    acc_stock_movements       -> rahaza_material_movements (filter material.type='accessory')
    (sum of qty_signed)       -> rahaza_material_stock (location-aware running totals)

PRESERVED (specialized features, not duplicates):
    acc_internal_requests     (request dari divisi internal)
    acc_loans                 (peminjaman aksesoris)
    acc_purchase_requests     (PR ke finance untuk aksesoris)

OPNAME — Migrated 2026-05-23 (Aksesoris SSOT Full Migration Phase 2):
    acc_opname_sessions       -> wh_opname_sessions2 (domain='accessory')
    acc_opname_lines          -> wh_opname_sessions2.count_items[] (embedded)
    Status mapping: Active->open, Completed->approved, Cancelled->cancelled
    Listing /api/wms/opname2 auto-filters domain != 'accessory' to avoid leak.

Endpoints (semuanya tetap):
    GET/POST       /api/acc/items
    PUT/DELETE     /api/acc/items/{id}
    GET            /api/acc/stock
    POST           /api/acc/stock/receive   (terima stok masuk)
    POST           /api/acc/stock/issue     (keluarkan stok)
    GET            /api/acc/stock/movements
    GET            /api/acc/internal-requests
    POST           /api/acc/internal-requests
    PUT            /api/acc/internal-requests/{id}
    GET/POST       /api/acc/loans
    PUT            /api/acc/loans/{id}/return
    GET/POST       /api/acc/opname
    PUT            /api/acc/opname/{id}/count
    POST           /api/acc/opname/{id}/complete
    POST           /api/acc/opname/{id}/cancel
    GET/POST       /api/acc/purchase-requests
    PUT            /api/acc/purchase-requests/{id}
    GET            /api/acc/dashboard
"""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
import uuid
import logging
from datetime import datetime, timezone

from database import get_db
from auth import require_auth, serialize_doc

_log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/acc", tags=["accessories"])

# ── helpers ──────────────────────────────────────────────────────────────────
def _id():    return str(uuid.uuid4())
def _now_iso(): return datetime.now(timezone.utc).isoformat()
def _now():   return datetime.now(timezone.utc)


# Allowed units for accessories (subset of MATERIAL_UNITS in rahaza_inventory).
# We auto-normalize to lowercase. Defaults to 'pcs' if invalid.
_VALID_UNITS = {
    "m", "cm", "yard", "inch",
    "kg", "gram", "ton",
    "pcs", "lusin", "kodi", "gross", "helai", "set", "pair",
    "rol", "gulung", "bal", "karton", "pak", "sak",
    "liter", "ml",
}


def _normalize_unit(unit: str) -> str:
    """Map common labels to the canonical MATERIAL_UNITS values."""
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
    """Return id of the default 'Area Aksesoris' location (ZNA-AKSESORIS).
    Auto-create if missing (idempotent).
    """
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
        "type": "zona",
        "created_at": _now(),
        "updated_at": _now(),
    })
    return new_id


# ── STOCK helpers (SSOT: rahaza_material_stock) ──────────────────────────────

async def _stock_qty(db, material_id: str) -> float:
    """Total stock across all locations for one accessory material."""
    pipeline = [
        {"$match": {"material_id": material_id}},
        {"$group": {"_id": None, "total": {"$sum": "$qty"}}},
    ]
    res = await db.rahaza_material_stock.aggregate(pipeline).to_list(1)
    return float(res[0]["total"]) if res else 0.0


async def _all_accessory_stock(db) -> dict:
    """Return {material_id: total_qty} for ALL accessory-type materials.

    Uses $lookup so we only count stock rows whose material.type='accessory'.
    """
    pipeline = [
        {"$lookup": {
            "from": "rahaza_materials",
            "localField": "material_id",
            "foreignField": "id",
            "as": "_mat",
        }},
        {"$unwind": "$_mat"},
        {"$match": {"_mat.type": "accessory"}},
        {"$group": {"_id": "$material_id", "total": {"$sum": "$qty"}}},
    ]
    res = await db.rahaza_material_stock.aggregate(pipeline).to_list(5000)
    return {r["_id"]: float(r["total"]) for r in res}


async def _add_stock(db, material_id: str, location_id: str, delta: float):
    """Idempotent upsert + increment, mirrors rahaza_inventory._add_stock."""
    await db.rahaza_material_stock.update_one(
        {"material_id": material_id, "location_id": location_id},
        {
            "$inc": {"qty": float(delta)},
            "$setOnInsert": {"id": _id()},
            "$set": {"updated_at": _now()},
        },
        upsert=True,
    )


async def _log_movement(db, user: dict, *, material_id: str, mv_type: str, qty: float,
                        from_loc: str | None, to_loc: str | None,
                        ref_type: str = "", ref_id: str = "", ref_number: str = "",
                        notes: str = "", legacy_type: str = "") -> dict:
    """Append a row to rahaza_material_movements.

    `mv_type` ∈ {'receive','issue','transfer','adjust'} (rahaza canonical types).
    `legacy_type` is the original acc_* movement_type label kept for compatibility
    (e.g. 'IN','OUT','LOAN_OUT','LOAN_RETURN','ADJUST') so /movements endpoint can
    return the same label the frontend already understands.
    """
    ts = _now()
    doc = {
        "id": _id(),
        "type": mv_type,
        "material_id": material_id,
        "qty": float(qty),
        "from_location_id": from_loc,
        "to_location_id": to_loc,
        "ref_type": ref_type,
        "ref_id": ref_id,
        "ref_number": ref_number,
        "notes": notes,
        "legacy_movement_type": legacy_type or mv_type.upper(),
        "domain": "accessory",
        "created_at": ts,
        "timestamp": ts,
        "created_by": user.get("id") or user.get("name") or "",
        "created_by_name": user.get("name", ""),
    }
    await db.rahaza_material_movements.insert_one(doc)
    return doc


async def _enrich_movement(db, mv: dict) -> dict:
    """Add acc_id / acc_name / qty_signed / movement_type back-compat fields."""
    mid = mv.get("material_id")
    name = ""
    if mid:
        m = await db.rahaza_materials.find_one({"id": mid}, {"_id": 0, "name": 1, "code": 1})
        if m:
            name = m.get("name", "")
    legacy = (mv.get("legacy_movement_type") or "").upper()
    if not legacy:
        # derive from canonical type if legacy missing
        t = (mv.get("type") or "").lower()
        legacy = {"receive": "IN", "issue": "OUT", "adjust": "ADJUST", "transfer": "TRANSFER"}.get(t, t.upper())

    qty = float(mv.get("qty") or 0)
    # qty_signed convention (legacy): IN/RETURN positive, OUT/LOAN_OUT negative, ADJUST signed
    if legacy in ("IN", "LOAN_RETURN"):
        qty_signed = abs(qty)
    elif legacy in ("OUT", "LOAN_OUT"):
        qty_signed = -abs(qty)
    elif legacy == "ADJUST":
        qty_signed = qty  # already signed
    else:
        qty_signed = qty

    return {
        "id": mv.get("id"),
        "acc_id": mid,
        "acc_name": name,
        "material_id": mid,
        "movement_type": legacy,
        "qty_signed": qty_signed,
        "qty": qty,
        "ref_type": mv.get("ref_type", ""),
        "ref_id": mv.get("ref_id", ""),
        "ref_number": mv.get("ref_number", ""),
        "notes": mv.get("notes", ""),
        "created_by": mv.get("created_by_name") or mv.get("created_by") or "",
        "created_at": mv.get("created_at"),
    }


def _material_to_acc_item(mat: dict, stock_qty: float = 0.0) -> dict:
    """Project rahaza_materials doc into the legacy acc_items shape."""
    if not mat:
        return {}
    min_stock = float(mat.get("min_stock") or 0)
    out = {
        "id": mat.get("id"),
        "code": mat.get("code", ""),
        "name": mat.get("name", ""),
        "category": mat.get("category") or "Umum",
        "unit": mat.get("unit", "pcs"),
        "description": mat.get("description", ""),
        "min_stock": min_stock,
        "supplier": mat.get("supplier", ""),
        "notes": mat.get("notes", ""),
        "deleted": not mat.get("active", True),
        "created_by": mat.get("created_by", ""),
        "created_at": mat.get("created_at"),
        "updated_at": mat.get("updated_at"),
        "stock_qty": float(stock_qty),
        "stock_status": (
            "out" if stock_qty <= 0
            else "low" if stock_qty <= min_stock and min_stock > 0
            else "ok"
        ),
    }
    return out


# ═══════════════════════════════════════════════════════════════
# MASTER AKSESORIS (rahaza_materials with type='accessory')
# ═══════════════════════════════════════════════════════════════

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

    loc_id = await _get_accessory_location_id(db)
    await _add_stock(db, acc_id, loc_id, qty)
    await _log_movement(
        db, user,
        material_id=acc_id, mv_type="receive", qty=qty,
        from_loc=None, to_loc=loc_id,
        ref_type=body.get("ref_type", "manual"),
        ref_id=body.get("ref_id", ""),
        ref_number=body.get("ref_number", ""),
        notes=body.get("notes", ""),
        legacy_type="IN",
    )
    new_qty = await _stock_qty(db, acc_id)
    return JSONResponse({"ok": True, "new_qty": new_qty}, status_code=201)


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

    current = await _stock_qty(db, acc_id)
    if current < qty:
        raise HTTPException(400, f"Stok tidak cukup. Stok saat ini: {current}")

    loc_id = await _get_accessory_location_id(db)
    await _add_stock(db, acc_id, loc_id, -qty)
    await _log_movement(
        db, user,
        material_id=acc_id, mv_type="issue", qty=qty,
        from_loc=loc_id, to_loc=None,
        ref_type=body.get("ref_type", "manual"),
        ref_id=body.get("ref_id", ""),
        ref_number=body.get("ref_number", ""),
        notes=body.get("notes", ""),
        legacy_type="OUT",
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


@router.get("/internal-requests")
async def list_internal_requests(request: Request):
    await require_auth(request)
    db = get_db()
    sp = request.query_params
    query: dict = {}
    if sp.get("status"):
        query["status"] = sp["status"]
    if sp.get("divisi"):
        query["divisi"] = sp["divisi"]
    docs = await db.acc_internal_requests.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    return serialize_doc(docs)


@router.post("/internal-requests")
async def create_internal_request(request: Request):
    user = await require_auth(request)
    db = get_db()
    body = await request.json()
    if not body.get("divisi"):
        raise HTTPException(400, "divisi wajib diisi")
    items = body.get("items") or []
    if not items or not isinstance(items, list):
        raise HTTPException(400, "items wajib diisi minimal 1")

    seq = (await db.acc_internal_requests.count_documents({})) + 1
    doc = {
        "id": _id(),
        "request_number": f"INT-REQ-{str(seq).zfill(4)}",
        "divisi": body["divisi"],
        "requester_name": body.get("requester_name", user.get("name", "")),
        "purpose": body.get("purpose", ""),
        "needed_by": body.get("needed_by", ""),
        "items": items,
        "status": "Pending",
        "admin_notes": "",
        "issued_by": "",
        "issued_at": "",
        "created_by": user.get("name", ""),
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    await db.acc_internal_requests.insert_one(doc)
    return JSONResponse(serialize_doc(doc), status_code=201)


@router.put("/internal-requests/{req_id}")
async def update_internal_request(req_id: str, request: Request):
    user = await require_auth(request)
    db = get_db()
    body = await request.json()
    doc = await db.acc_internal_requests.find_one({"id": req_id})
    if not doc:
        raise HTTPException(404, "Request tidak ditemukan")

    new_status = body.get("status")
    upd: dict = {"updated_at": _now_iso()}

    if new_status == "Approved":
        upd.update({
            "status": "Approved",
            "admin_notes": body.get("admin_notes", ""),
            "approved_by": user.get("name", ""),
            "approved_at": _now_iso(),
        })
    elif new_status == "Rejected":
        upd.update({
            "status": "Rejected",
            "admin_notes": body.get("admin_notes", ""),
            "rejected_by": user.get("name", ""),
            "rejected_at": _now_iso(),
        })
    elif new_status == "Issued":
        loc_id = await _get_accessory_location_id(db)
        for it in doc.get("items", []):
            acc_id = it.get("acc_id")
            try:
                qty = float(it.get("qty_requested", 0))
            except Exception:
                qty = 0.0
            if not acc_id or qty <= 0:
                continue
            current = await _stock_qty(db, acc_id)
            if current < qty:
                raise HTTPException(
                    400,
                    f"Stok tidak cukup untuk {it.get('acc_name', acc_id)} (ada: {current}, diminta: {qty})",
                )
            await _add_stock(db, acc_id, loc_id, -qty)
            await _log_movement(
                db, user,
                material_id=acc_id, mv_type="issue", qty=qty,
                from_loc=loc_id, to_loc=None,
                ref_type="internal_request", ref_id=req_id,
                ref_number=doc["request_number"],
                notes=f"Issued ke {doc['divisi']}",
                legacy_type="OUT",
            )
        upd.update({"status": "Issued", "issued_by": user.get("name", ""), "issued_at": _now_iso()})
    else:
        allowed = {k: v for k, v in body.items() if k not in ("_id", "id", "created_at", "created_by", "request_number")}
        upd.update(allowed)

    await db.acc_internal_requests.update_one({"id": req_id}, {"$set": upd})
    result = await db.acc_internal_requests.find_one({"id": req_id}, {"_id": 0})
    return serialize_doc(result)


# ═══════════════════════════════════════════════════════════════
# PEMINJAMAN AKSESORIS (preserved: acc_loans)
# ═══════════════════════════════════════════════════════════════

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
            material_id=acc_id, mv_type="issue", qty=qty,
            from_loc=loc_id, to_loc=None,
            ref_type="loan", ref_id=loan_id,
            ref_number=doc["loan_number"],
            notes=f"Dipinjam oleh {body['borrower_name']}",
            legacy_type="LOAN_OUT",
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
            from_loc=None, to_loc=loc_id,
            ref_type="loan", ref_id=loan_id,
            ref_number=loan["loan_number"],
            notes=f"Dikembalikan oleh {loan['borrower_name']}",
            legacy_type="LOAN_RETURN",
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
            from_loc=loc_id if diff < 0 else None,
            to_loc=loc_id if diff > 0 else None,
            ref_type="opname", ref_id=session_id,
            ref_number=session["session_no"],
            notes=f"Adjustment opname {session['session_no']}",
            legacy_type="ADJUST",
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
                from_loc=None, to_loc=loc_id,
                ref_type="purchase_request", ref_id=pr_id,
                ref_number=doc["pr_number"],
                notes=f"Terima dari PR {doc['pr_number']}",
                legacy_type="IN",
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

@router.get("/dashboard")
async def get_dashboard(request: Request):
    await require_auth(request)
    db = get_db()

    total_items = await db.rahaza_materials.count_documents({"type": "accessory", "active": True})
    stock_map = await _all_accessory_stock(db)
    mats = await db.rahaza_materials.find(
        {"type": "accessory", "active": True}, {"_id": 0}
    ).to_list(5000)

    low_stock_items: list[dict] = []
    out_of_stock = 0
    low_stock = 0
    for m in mats:
        qty = float(stock_map.get(m["id"], 0))
        min_s = float(m.get("min_stock") or 0)
        if qty <= 0:
            out_of_stock += 1
        elif min_s > 0 and qty <= min_s:
            low_stock += 1
            low_stock_items.append({
                "id": m["id"],
                "code": m.get("code", ""),
                "name": m.get("name", ""),
                "stock_qty": qty,
                "min_stock": min_s,
                "unit": m.get("unit", "pcs"),
            })

    pending_requests = await db.acc_internal_requests.count_documents({"status": "Pending"})
    active_loans = await db.acc_loans.count_documents({"status": "Active"})
    pending_pr = await db.acc_purchase_requests.count_documents({"status": {"$in": ["Draft", "Submitted"]}})
    active_opname = await db.wh_opname_sessions2.find_one({"domain": "accessory", "status": "open"})

    return {
        "total_items": total_items,
        "out_of_stock": out_of_stock,
        "low_stock": low_stock,
        "low_stock_items": low_stock_items[:5],
        "pending_requests": pending_requests,
        "active_loans": active_loans,
        "pending_pr": pending_pr,
        "active_opname": active_opname["session_no"] if active_opname else None,
    }
