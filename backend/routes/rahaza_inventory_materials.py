"""rahaza_inventory — Materials Master CRUD."""
# ruff: noqa: E741
from fastapi import Request, HTTPException
from database import get_db
from auth import require_auth, serialize_doc, log_activity
from routes.rahaza_inventory_shared import (
    router, _uid, _now, MATERIAL_TYPES, MATERIAL_UNITS, _require_admin,
    get_pagination_params, paginated_response,
)
from typing import Optional


# ──────────────────────────────────────────────────────────────────────────────
# MATERIALS MASTER
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/materials")
async def list_materials(request: Request, type: Optional[str] = None, search: Optional[str] = None,
                         low_stock: Optional[str] = None, include_inactive: Optional[str] = None):
    await require_auth(request)
    db = get_db()
    q = {}
    if not (include_inactive and include_inactive.lower() == "true"):
        q["active"] = True
    if type:
        if type not in MATERIAL_TYPES:
            raise HTTPException(400, f"type harus: {MATERIAL_TYPES}")
        q["type"] = type
    if search:
        import re
        pattern = re.compile(re.escape(search), re.IGNORECASE)
        q["$or"] = [{"code": pattern}, {"name": pattern}]

    use_pagination = "page" in request.query_params
    if use_pagination:
        page, pg_limit, pg_skip = get_pagination_params(request, default_limit=50)

    if low_stock and low_stock.lower() == "true":
        rows = await db.rahaza_materials.find(q, {"_id": 0}).sort([("type", 1), ("code", 1)]).to_list(500)
        stock_docs = await db.rahaza_material_stock.find({}, {"_id": 0}).to_list(500)
        stock_by_mat = {}
        for s in stock_docs:
            mid = s.get("material_id")
            if mid:
                stock_by_mat[mid] = stock_by_mat.get(mid, 0) + float(s.get("qty") or 0)
        low_rows = []
        for m in rows:
            mid = m.get("id")
            current_qty = stock_by_mat.get(mid, 0)
            min_qty = m.get("min_stock_qty")
            min_pct = m.get("min_stock_percentage")
            min_legacy = m.get("min_stock", 0)
            is_low = False
            if min_qty and current_qty < float(min_qty):
                is_low = True
            elif min_pct:
                baseline = float(m.get("max_historical_qty") or (min_qty or 100))
                threshold = baseline * (float(min_pct) / 100)
                if current_qty < threshold:
                    is_low = True
            elif min_legacy and current_qty < float(min_legacy):
                is_low = True
            if is_low:
                m["current_qty"] = current_qty
                m["is_low_stock"] = True
                low_rows.append(m)
        if use_pagination:
            total = len(low_rows)
            paged = low_rows[pg_skip:pg_skip + pg_limit]
            return paginated_response(serialize_doc(paged), total, page, pg_limit)
        return serialize_doc(low_rows)

    if use_pagination:
        total = await db.rahaza_materials.count_documents(q)
        rows = await db.rahaza_materials.find(q, {"_id": 0}).sort([("type", 1), ("code", 1)]).skip(pg_skip).limit(pg_limit).to_list(length=10000)
        return paginated_response(serialize_doc(rows), total, page, pg_limit)

    rows = await db.rahaza_materials.find(q, {"_id": 0}).sort([("type", 1), ("code", 1)]).to_list(500)
    return serialize_doc(rows)


@router.get("/materials/reorder-alerts")
async def list_reorder_alerts(request: Request):
    await require_auth(request)
    db = get_db()
    stock_docs = await db.rahaza_material_stock.find({}, {"_id": 0}).to_list(500)
    stock_by_mat = {}
    for s in stock_docs:
        mid = s.get("material_id")
        if mid:
            stock_by_mat[mid] = stock_by_mat.get(mid, 0) + float(s.get("qty") or 0)
    mats = await db.rahaza_materials.find({"active": True, "reorder_point": {"$gt": 0}}, {"_id": 0}).to_list(500)
    alerts = []
    for m in mats:
        current = stock_by_mat.get(m["id"], 0)
        rp = float(m.get("reorder_point") or 0)
        if current < rp:
            alerts.append({**m, "current_qty": current, "shortage": round(rp - current, 2)})
    return serialize_doc(alerts)


@router.post("/materials")
async def create_material(request: Request):
    user = await _require_admin(request)
    db = get_db()
    body = await request.json()
    code = (body.get("code") or "").strip().upper()
    name = (body.get("name") or "").strip()
    t    = (body.get("type") or "").strip().lower()
    unit = (body.get("unit") or "").strip().lower()
    if not code or not name:
        raise HTTPException(400, "code & name wajib diisi.")
    if t not in MATERIAL_TYPES:
        raise HTTPException(400, f"type harus salah satu: {MATERIAL_TYPES}")
    if unit not in MATERIAL_UNITS:
        raise HTTPException(400, f"unit harus salah satu: {MATERIAL_UNITS}")
    if await db.rahaza_materials.find_one({"code": code, "active": True}):
        raise HTTPException(409, f"Kode '{code}' sudah terpakai.")
    
    # NEW: Pack/packaging fields
    pack_unit = (body.get("pack_unit") or "pack").strip()
    pack_size = float(body.get("pack_size") or 1)
    if pack_size <= 0:
        pack_size = 1  # Safety fallback
    display_in_packs = bool(body.get("display_in_packs", False))
    
    doc = {
        "id": _uid(), "code": code, "name": name,
        "type": t, "unit": unit,
        "yarn_type": (body.get("yarn_type") or "").strip(),
        "color": (body.get("color") or "").strip(),
        "notes": body.get("notes") or "",
        "min_stock": float(body.get("min_stock") or 0),
        "min_stock_qty": float(body["min_stock_qty"]) if body.get("min_stock_qty") not in (None, "") else None,
        "min_stock_percentage": float(body["min_stock_percentage"]) if body.get("min_stock_percentage") not in (None, "") else None,
        "reorder_point": float(body.get("reorder_point") or 0),
        # NEW: Pack fields
        "pack_unit": pack_unit,
        "pack_size": pack_size,
        "display_in_packs": display_in_packs,
        "active": True,
        "created_at": _now(), "updated_at": _now(),
    }
    await db.rahaza_materials.insert_one(doc)
    await log_activity(user["id"], user.get("name", ""), "create", "rahaza.material", code)
    return serialize_doc(doc)


@router.put("/materials/{mid}")
async def update_material(mid: str, request: Request):
    user = await _require_admin(request)
    db = get_db()
    body = await request.json()
    body.pop("_id", None)
    body.pop("id", None)
    body.pop("created_at", None)
    body["updated_at"] = _now()
    if "code" in body:
        body["code"] = body["code"].strip().upper()
    if "type" in body and body["type"] not in MATERIAL_TYPES:
        raise HTTPException(400, f"type harus: {MATERIAL_TYPES}")
    if "unit" in body and body["unit"] not in MATERIAL_UNITS:
        raise HTTPException(400, f"unit harus: {MATERIAL_UNITS}")
    if "min_stock_qty" in body:
        body["min_stock_qty"] = float(body["min_stock_qty"]) if body["min_stock_qty"] else None
    if "min_stock_percentage" in body:
        body["min_stock_percentage"] = float(body["min_stock_percentage"]) if body["min_stock_percentage"] else None
    
    # NEW: Pack fields update
    if "pack_unit" in body:
        body["pack_unit"] = (body["pack_unit"] or "pack").strip()
    if "pack_size" in body:
        ps = float(body["pack_size"] or 1)
        body["pack_size"] = ps if ps > 0 else 1
    if "display_in_packs" in body:
        body["display_in_packs"] = bool(body["display_in_packs"])
    
    res = await db.rahaza_materials.update_one({"id": mid}, {"$set": body})
    if res.matched_count == 0:
        raise HTTPException(404, "Material tidak ditemukan.")
    await log_activity(user["id"], user.get("name", ""), "update", "rahaza.material", mid)
    return serialize_doc(await db.rahaza_materials.find_one({"id": mid}, {"_id": 0}))


@router.delete("/materials/{mid}")
async def deactivate_material(mid: str, request: Request):
    await _require_admin(request)
    db = get_db()
    await db.rahaza_materials.update_one({"id": mid}, {"$set": {"active": False, "updated_at": _now()}})
    return {"status": "deactivated"}
