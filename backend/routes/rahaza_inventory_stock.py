"""rahaza_inventory — Stock, Operations (receive/transfer/adjust), Movement Ledger."""
# ruff: noqa: E741
from fastapi import Request, HTTPException
from database import get_db
from auth import require_auth, serialize_doc, log_activity
from typing import Optional
from routes.rahaza_inventory_shared import (
    router, log, _require_admin, _add_stock, _log_movement,
    get_pagination_params, paginated_response,
)
from routes.rahaza_posting import (
    post_inventory_receive,
    post_inventory_adjust,
)


# ──────────────────────────────────────────────────────────────────────────────
# STOCK
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/material-stock")
async def list_stock(request: Request, material_id: Optional[str] = None,
                    location_id: Optional[str] = None, type: Optional[str] = None):
    await require_auth(request)
    db = get_db()
    stock_q = {}
    if material_id:
        stock_q["material_id"] = material_id
    if location_id:
        stock_q["location_id"] = location_id
    stocks = await db.rahaza_material_stock.find(stock_q, {"_id": 0}).to_list(500)
    m_ids = list({s["material_id"] for s in stocks})
    l_ids = list({s["location_id"] for s in stocks})
    mats = await db.rahaza_materials.find({"id": {"$in": m_ids}}, {"_id": 0}).to_list(500) if m_ids else []
    locs = await db.rahaza_locations.find({"id": {"$in": l_ids}}, {"_id": 0}).to_list(500) if l_ids else []
    m_map = {m["id"]: m for m in mats}
    l_map = {l["id"]: l for l in locs}
    rows = []
    for s in stocks:
        m = m_map.get(s["material_id"]) or {}
        l = l_map.get(s["location_id"]) or {}
        if type and m.get("type") != type:
            continue
        current_qty = float(s.get("qty", 0))
        is_low_stock = False
        low_stock_reason = None
        min_stock_qty = m.get("min_stock_qty")
        if min_stock_qty and current_qty < min_stock_qty:
            is_low_stock = True
            low_stock_reason = f"Below min qty: {current_qty} < {min_stock_qty}"
        min_stock_pct = m.get("min_stock_percentage")
        if min_stock_pct and not is_low_stock:
            baseline_max = 1000
            threshold_qty = baseline_max * (min_stock_pct / 100)
            if current_qty < threshold_qty:
                is_low_stock = True
                low_stock_reason = f"Below {min_stock_pct}% threshold: {current_qty} < {threshold_qty:.0f}"
        if not is_low_stock and m.get("min_stock"):
            if current_qty < m.get("min_stock"):
                is_low_stock = True
                low_stock_reason = f"Below legacy min_stock: {current_qty} < {m.get('min_stock')}"
        rows.append({
            **s,
            "material_code": m.get("code"), "material_name": m.get("name"),
            "material_type": m.get("type"), "unit": m.get("unit"),
            "min_stock": m.get("min_stock", 0),
            "min_stock_qty": m.get("min_stock_qty"),
            "min_stock_percentage": m.get("min_stock_percentage"),
            "location_code": l.get("code"), "location_name": l.get("name"),
            "below_min": is_low_stock,
            "low_stock_reason": low_stock_reason,
        })
    rows.sort(key=lambda r: (r.get("material_type") or "", r.get("material_code") or "", r.get("location_code") or ""))
    return serialize_doc(rows)


@router.get("/material-stock/summary")
async def stock_summary(request: Request):
    await require_auth(request)
    db = get_db()
    pipe = [
        {"$lookup": {"from": "rahaza_materials", "localField": "material_id", "foreignField": "id", "as": "mat"}},
        {"$unwind": "$mat"},
        {"$group": {"_id": "$mat.type", "total_qty": {"$sum": "$qty"}, "count": {"$sum": 1}}},
    ]
    rows = await db.rahaza_material_stock.aggregate(pipe).to_list(500)
    by_type = {r["_id"]: {"total_qty": r["total_qty"], "row_count": r["count"]} for r in rows}
    stocks = await db.rahaza_material_stock.find({}, {"_id": 0}).to_list(500)
    mats_raw = await db.rahaza_materials.find({}, {"_id": 0}).to_list(500)
    mat_by_id = {m["id"]: m for m in mats_raw}
    total_by_mat: dict = {}
    for s in stocks:
        total_by_mat[s["material_id"]] = total_by_mat.get(s["material_id"], 0) + float(s.get("qty") or 0)
    low_materials = []
    for mid, total in total_by_mat.items():
        m = mat_by_id.get(mid)
        if not m:
            continue
        if m.get("min_stock") and total < float(m["min_stock"]):
            low_materials.append({"material_id": mid, "material_code": m["code"], "name": m["name"],
                                   "type": m["type"], "unit": m["unit"], "qty": total, "min_stock": m["min_stock"]})
    return {"by_type": by_type, "low_stock_count": len(low_materials), "low_materials": low_materials}


# ──────────────────────────────────────────────────────────────────────────────
# MOVEMENT LEDGER
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/material-movements")
async def list_movements(request: Request, material_id: Optional[str] = None, limit: int = 100):
    await require_auth(request)
    db = get_db()
    q = {}
    if material_id:
        q["material_id"] = material_id
    use_pagination = "page" in request.query_params
    if use_pagination:
        page, pg_limit, pg_skip = get_pagination_params(request, default_limit=50)
        total = await db.rahaza_material_movements.count_documents(q)
        rows = await db.rahaza_material_movements.find(q, {"_id": 0}).sort("created_at", -1).skip(pg_skip).limit(pg_limit).to_list(length=10000)
    else:
        rows = await db.rahaza_material_movements.find(q, {"_id": 0}).sort("created_at", -1).limit(int(limit)).to_list(500)
    m_ids = list({r["material_id"] for r in rows if r.get("material_id")})
    loc_ids = list({x for r in rows for x in (r.get("from_location_id"), r.get("to_location_id")) if x})
    mats = await db.rahaza_materials.find({"id": {"$in": m_ids}}, {"_id": 0}).to_list(500) if m_ids else []
    locs = await db.rahaza_locations.find({"id": {"$in": loc_ids}}, {"_id": 0}).to_list(500) if loc_ids else []
    l_map = {l["id"]: l for l in locs}
    missing_ids = [lid for lid in loc_ids if lid not in l_map]
    if missing_ids:
        wh_locs = await db.warehouse_locations.find({"id": {"$in": missing_ids}}, {"_id": 0}).to_list(500)
        for wl in wh_locs:
            l_map[wl["id"]] = wl
    m_map = {m["id"]: m for m in mats}
    for r in rows:
        m = m_map.get(r.get("material_id")) or {}
        r["material_code"] = m.get("code")
        r["material_name"] = m.get("name")
        r["unit"] = m.get("unit")
        r["from_location_name"] = (l_map.get(r.get("from_location_id")) or {}).get("name")
        r["to_location_name"]   = (l_map.get(r.get("to_location_id")) or {}).get("name")
    if use_pagination:
        return paginated_response(serialize_doc(rows), total, page, pg_limit)
    return serialize_doc(rows)


# ──────────────────────────────────────────────────────────────────────────────
# OPERATIONS (receive / transfer / adjust)
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/material-receive")
async def material_receive(request: Request):
    user = await _require_admin(request)
    db = get_db()
    body = await request.json()
    material_id = body.get("material_id")
    location_id = body.get("location_id")
    qty = float(body.get("qty") or 0)
    if not (material_id and location_id) or qty <= 0:
        raise HTTPException(400, "material_id, location_id, qty(>0) wajib diisi.")
    if not await db.rahaza_materials.find_one({"id": material_id}):
        raise HTTPException(404, "Material tidak ditemukan.")
    if not await db.rahaza_locations.find_one({"id": location_id}):
        raise HTTPException(404, "Location tidak ditemukan.")
    await _add_stock(db, material_id, location_id, qty)
    mv = await _log_movement(db, user,
        type="receive", material_id=material_id, qty=qty,
        unit_cost=float(body.get("unit_cost") or 0),
        from_location_id=None, to_location_id=location_id,
        ref_type=body.get("ref_type") or "receiving", ref_id=body.get("ref_id") or None,
        notes=body.get("notes") or "",
    )
    await log_activity(user["id"], user.get("name", ""), f"receive:{qty}", "rahaza.material", material_id)
    posting_result = None
    try:
        posting_result = await post_inventory_receive(db, mv, user)
    except Exception as e:
        log.exception("Inventory receive auto-post failed")
        posting_result = {"ok": False, "error": str(e)}
    mv_refresh = await db.rahaza_material_movements.find_one({"id": mv["id"]}, {"_id": 0})
    mv_refresh["_posting_result"] = posting_result
    return serialize_doc(mv_refresh)


@router.post("/material-transfer")
async def material_transfer(request: Request):
    user = await _require_admin(request)
    db = get_db()
    body = await request.json()
    material_id = body.get("material_id")
    from_loc = body.get("from_location_id")
    to_loc = body.get("to_location_id")
    qty = float(body.get("qty") or 0)
    if not (material_id and from_loc and to_loc) or qty <= 0:
        raise HTTPException(400, "material_id, from_location_id, to_location_id, qty(>0) wajib.")
    if from_loc == to_loc:
        raise HTTPException(400, "Lokasi asal dan tujuan tidak boleh sama.")
    src = await db.rahaza_material_stock.find_one({"material_id": material_id, "location_id": from_loc})
    if not src or float(src.get("qty") or 0) < qty:
        raise HTTPException(400, f"Stok tidak cukup di lokasi asal (tersedia: {float((src or {}).get('qty') or 0)}).")
    await _add_stock(db, material_id, from_loc, -qty)
    await _add_stock(db, material_id, to_loc,    qty)
    mv = await _log_movement(db, user,
        type="transfer", material_id=material_id, qty=qty,
        from_location_id=from_loc, to_location_id=to_loc,
        ref_type="transfer", ref_id=None, notes=body.get("notes") or "",
    )
    return serialize_doc(mv)


@router.post("/material-adjust")
async def material_adjust(request: Request):
    user = await _require_admin(request)
    db = get_db()
    body = await request.json()
    material_id = body.get("material_id")
    location_id = body.get("location_id")
    delta = float(body.get("qty") or 0)
    reason = body.get("reason") or ""
    if not (material_id and location_id) or delta == 0:
        raise HTTPException(400, "material_id, location_id, qty (≠0) wajib.")
    cur = await db.rahaza_material_stock.find_one({"material_id": material_id, "location_id": location_id}) or {"qty": 0}
    if float(cur.get("qty") or 0) + delta < 0:
        raise HTTPException(400, "Penyesuaian akan membuat stok negatif.")
    await _add_stock(db, material_id, location_id, delta)
    mv = await _log_movement(db, user,
        type="adjust", material_id=material_id, qty=delta,
        from_location_id=None, to_location_id=location_id,
        ref_type="adjustment", ref_id=None, notes=reason,
    )
    posting_result = None
    try:
        posting_result = await post_inventory_adjust(db, mv, user)
    except Exception as e:
        log.exception("Inventory adjust auto-post failed")
        posting_result = {"ok": False, "error": str(e)}
    mv_refresh = await db.rahaza_material_movements.find_one({"id": mv["id"]}, {"_id": 0})
    mv_refresh["_posting_result"] = posting_result
    return serialize_doc(mv_refresh)
