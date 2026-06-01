"""rahaza_inventory — Material Issues CRUD + draft-from-wo + approval workflow."""
# ruff: noqa: E741
from fastapi import Request, HTTPException
from database import get_db
from auth import require_auth, serialize_doc, log_activity  # noqa: F401
from typing import Optional
from routes.rahaza_inventory_shared import (
    router, log, _uid, _now, _require_admin,
    _gen_mi_number, _enrich_mi, _norm_mi_items, _require_mi_approver,
    _log_movement,
)
from routes.rahaza_posting import post_inventory_issue


@router.get("/material-issues")
async def list_mis(request: Request, work_order_id: Optional[str] = None,
                   status: Optional[str] = None, building_id: Optional[str] = None,
                   limit: int = 200, skip: int = 0):
    await require_auth(request)
    db = get_db()
    q = {}
    if work_order_id:
        q["work_order_id"] = work_order_id
    if status:
        q["status"] = status
    if building_id:
        pending_ids = await db.wh_pending_movements.distinct(
            "source_id",
            {"type": "outbound_rm", "source_type": "rahaza_material_issue", "building_id": building_id}
        )
        q["id"] = {"$in": pending_ids or ["__none__"]}
    rows = await db.rahaza_material_issues.find(q, {"_id": 0}).sort("created_at", -1).skip(skip).limit(limit).to_list(500)
    for mi in rows:
        await _enrich_mi(db, mi)
        mi["item_count"] = len(mi.get("items") or [])
        mi["total_required"] = round(sum(float(i.get("qty_required") or 0) for i in (mi.get("items") or [])), 4)
    return serialize_doc(rows)


@router.get("/material-issues/{mid}")
async def get_mi(mid: str, request: Request):
    await require_auth(request)
    db = get_db()
    mi = await db.rahaza_material_issues.find_one({"id": mid}, {"_id": 0})
    if not mi:
        raise HTTPException(404, "MI tidak ditemukan.")
    await _enrich_mi(db, mi)
    return serialize_doc(mi)


@router.post("/material-issues/draft-from-wo")
async def draft_mi_from_wo(request: Request):
    user = await _require_admin(request)
    db = get_db()
    body = await request.json()
    wo_id = body.get("work_order_id")
    default_loc = body.get("default_location_id") or None
    if not wo_id:
        raise HTTPException(400, "work_order_id wajib diisi.")
    wo = await db.rahaza_work_orders.find_one({"id": wo_id}, {"_id": 0})
    if not wo:
        raise HTTPException(404, "WO tidak ditemukan.")
    snap = wo.get("bom_snapshot") or {}
    yarns = snap.get("yarn_materials") or []
    accs  = snap.get("accessory_materials") or []
    if not yarns and not accs:
        raise HTTPException(400, "WO tidak punya BOM snapshot. Pastikan BOM sudah diisi sebelum generate WO.")
    wo_qty = float(wo.get("qty") or 0)

    all_codes = list({(c or "").strip().upper() for c in
                       [y.get("code") for y in yarns] + [a.get("code") for a in accs] if c})
    existing_mats = {}
    if all_codes:
        async for m in db.rahaza_materials.find({"code": {"$in": all_codes}, "active": True}, {"_id": 0}):
            existing_mats[m["code"]] = m

    items = []
    missing_codes = []
    for y in yarns:
        code = (y.get("code") or "").strip().upper()
        if not code:
            missing_codes.append(f"yarn:{y.get('name')}")
            continue
        mat = existing_mats.get(code)
        if not mat:
            mat = {
                "id": _uid(), "code": code, "name": y.get("name") or code,
                "type": "yarn", "unit": "kg",
                "yarn_type": y.get("yarn_type") or "", "color": "",
                "notes": "Auto-created from WO BOM", "min_stock": 0,
                "active": True, "created_at": _now(), "updated_at": _now(),
            }
            await db.rahaza_materials.insert_one(mat)
            existing_mats[code] = mat
        items.append({
            "id": _uid(), "material_id": mat["id"],
            "qty_required": round(float(y.get("qty_kg") or 0) * wo_qty, 4),
            "qty_issued": 0, "location_id": default_loc, "notes": y.get("notes") or "",
        })
    for a in accs:
        code = (a.get("code") or "").strip().upper()
        if not code:
            missing_codes.append(f"acc:{a.get('name')}")
            continue
        mat = existing_mats.get(code)
        if not mat:
            mat = {
                "id": _uid(), "code": code, "name": a.get("name") or code,
                "type": "accessory", "unit": (a.get("unit") or "pcs").lower(),
                "yarn_type": "", "color": "",
                "notes": "Auto-created from WO BOM", "min_stock": 0,
                "active": True, "created_at": _now(), "updated_at": _now(),
            }
            await db.rahaza_materials.insert_one(mat)
            existing_mats[code] = mat
        items.append({
            "id": _uid(), "material_id": mat["id"],
            "qty_required": round(float(a.get("qty") or 0) * wo_qty, 4),
            "qty_issued": 0, "location_id": default_loc, "notes": a.get("notes") or "",
        })

    if not items:
        raise HTTPException(400, "BOM snapshot kosong (tidak ada material dengan kode).")

    doc = {
        "id": _uid(),
        "mi_number": await _gen_mi_number(db),
        "work_order_id": wo_id,
        "wo_number_snapshot": wo.get("wo_number"),
        "model_id": wo.get("model_id"), "size_id": wo.get("size_id"),
        "qty_wo_pcs": int(wo_qty),
        "items": items, "status": "draft",
        "notes": body.get("notes") or "",
        "missing_codes": missing_codes,
        "created_by": user["id"], "created_by_name": user.get("name", ""),
        "created_at": _now(), "updated_at": _now(),
    }
    await db.rahaza_material_issues.insert_one(doc)
    await log_activity(user["id"], user.get("name", ""), "draft_from_wo", "rahaza.mi", doc["mi_number"])
    await _enrich_mi(db, doc)
    return serialize_doc(doc)


@router.post("/material-issues")
async def create_mi_manual(request: Request):
    user = await _require_admin(request)
    db = get_db()
    body = await request.json()
    items = _norm_mi_items(body.get("items"))
    if not items:
        raise HTTPException(400, "Minimal 1 item material.")
    doc = {
        "id": _uid(),
        "mi_number": await _gen_mi_number(db),
        "work_order_id": body.get("work_order_id") or None,
        "wo_number_snapshot": body.get("wo_number_snapshot") or "",
        "model_id": body.get("model_id") or None,
        "size_id":  body.get("size_id") or None,
        "qty_wo_pcs": int(body.get("qty_wo_pcs") or 0),
        "items": items, "status": "draft",
        "notes": body.get("notes") or "",
        "created_by": user["id"], "created_by_name": user.get("name", ""),
        "created_at": _now(), "updated_at": _now(),
    }
    await db.rahaza_material_issues.insert_one(doc)
    await log_activity(user["id"], user.get("name", ""), "create", "rahaza.mi", doc["mi_number"])
    await _enrich_mi(db, doc)
    return serialize_doc(doc)


@router.put("/material-issues/{mid}")
async def update_mi(mid: str, request: Request):
    await _require_admin(request)
    db = get_db()
    mi = await db.rahaza_material_issues.find_one({"id": mid}, {"_id": 0})
    if not mi:
        raise HTTPException(404, "MI tidak ditemukan.")
    if mi.get("status") != "draft":
        raise HTTPException(400, "Hanya MI Draft yang bisa diedit.")
    body = await request.json()
    upd = {"updated_at": _now()}
    if "items" in body:
        items = _norm_mi_items(body["items"])
        if not items:
            raise HTTPException(400, "Minimal 1 item material.")
        upd["items"] = items
    if "notes" in body:
        upd["notes"] = body["notes"]
    await db.rahaza_material_issues.update_one({"id": mid}, {"$set": upd})
    out = await db.rahaza_material_issues.find_one({"id": mid}, {"_id": 0})
    await _enrich_mi(db, out)
    return serialize_doc(out)


@router.post("/material-issues/{mid}/submit")
async def submit_mi(mid: str, request: Request):
    user = await _require_admin(request)
    db = get_db()
    mi = await db.rahaza_material_issues.find_one({"id": mid}, {"_id": 0})
    if not mi:
        raise HTTPException(404, "MI tidak ditemukan.")
    if mi.get("status") not in ("draft", "rejected"):
        raise HTTPException(400, f"Hanya MI Draft/Rejected yang bisa diajukan. Status: {mi.get('status')}")
    missing = [it for it in (mi.get("items") or []) if not it.get("location_id")]
    if missing:
        raise HTTPException(400, f"{len(missing)} item belum punya lokasi. Set lokasi dulu sebelum submit.")
    await db.rahaza_material_issues.update_one(
        {"id": mid},
        {"$set": {"status": "pending_approval", "submitted_at": _now(), "submitted_by": user["id"], "updated_at": _now()}}
    )
    await log_activity(user["id"], user.get("name", ""), "submit", "rahaza.mi", mi["mi_number"])
    out = await db.rahaza_material_issues.find_one({"id": mid}, {"_id": 0})
    await _enrich_mi(db, out)
    return serialize_doc(out)


@router.post("/material-issues/{mid}/approve")
async def approve_mi(mid: str, request: Request):  # noqa: C901
    user = await _require_mi_approver(request)
    db = get_db()
    mi = await db.rahaza_material_issues.find_one({"id": mid}, {"_id": 0})
    if not mi:
        raise HTTPException(404, "MI tidak ditemukan.")
    if mi.get("status") != "pending_approval":
        raise HTTPException(400, f"Hanya MI Pending Approval yang bisa di-approve. Status: {mi.get('status')}")
    await db.rahaza_material_issues.update_one(
        {"id": mid},
        {"$set": {"approved_at": _now(), "approved_by": user["id"], "approved_by_name": user.get("name", ""), "updated_at": _now()}}
    )
    body = {}
    try:
        body = await request.json()
    except Exception:
        body = {}
    loc_overrides = body.get("location_overrides") or {}
    plan = []
    shortages = []
    raw_items = list(mi.get("items") or [])
    pairs = set()
    for it in raw_items:
        loc = loc_overrides.get(it["material_id"]) or it.get("location_id")
        if loc and float(it.get("qty_required") or 0) > 0:
            pairs.add((it["material_id"], loc))
    stock_map = {}
    if pairs:
        mids = list({p[0] for p in pairs})
        locs = list({p[1] for p in pairs})
        async for s in db.rahaza_material_stock.find({"material_id": {"$in": mids}, "location_id": {"$in": locs}}):
            stock_map[(s.get("material_id"), s.get("location_id"))] = s
    for it in raw_items:
        loc = loc_overrides.get(it["material_id"]) or it.get("location_id")
        if not loc:
            raise HTTPException(400, f"Item belum punya lokasi: material {it.get('material_id')}.")
        qty = float(it.get("qty_required") or 0)
        if qty <= 0:
            continue
        stock = stock_map.get((it["material_id"], loc))
        avail = float((stock or {}).get("qty") or 0)
        if avail < qty:
            shortages.append({"material_id": it["material_id"], "required": qty, "available": avail, "location_id": loc})
        plan.append({"material_id": it["material_id"], "location_id": loc, "qty": qty, "item_id": it["id"]})
    if shortages:
        raise HTTPException(400, {"message": "Stok tidak cukup untuk issue.", "shortages": shortages})
    from pymongo import ReturnDocument
    race_failures = []
    for p in plan:
        result = await db.rahaza_material_stock.find_one_and_update(
            {"material_id": p["material_id"], "location_id": p["location_id"], "qty": {"$gte": p["qty"]}},
            {"$inc": {"qty": -p["qty"]}, "$set": {"updated_at": _now()}},
            return_document=ReturnDocument.AFTER,
        )
        if result is None:
            race_failures.append({"material_id": p["material_id"], "location_id": p["location_id"], "required": p["qty"]})
        else:
            await _log_movement(db, user,
                type="issue", material_id=p["material_id"], qty=p["qty"],
                from_location_id=p["location_id"], to_location_id=None,
                ref_type="wo_issue" if mi.get("work_order_id") else "manual_issue",
                ref_id=mi["id"], notes=f"MI {mi['mi_number']}",
            )
    if race_failures:
        raise HTTPException(409, {"message": "Stok habis karena concurrent issue.", "failures": race_failures})
    new_items = []
    for it in (mi.get("items") or []):
        new_items.append({**it, "qty_issued": float(it.get("qty_required") or 0),
                         "location_id": loc_overrides.get(it["material_id"]) or it.get("location_id")})
    await db.rahaza_material_issues.update_one(
        {"id": mid},
        {"$set": {"items": new_items, "status": "issued", "issued_at": _now(), "issued_by": user["id"], "updated_at": _now()}}
    )
    await log_activity(user["id"], user.get("name", ""), "approve+issue", "rahaza.mi", mi["mi_number"])
    out = await db.rahaza_material_issues.find_one({"id": mid}, {"_id": 0})
    await _enrich_mi(db, out)
    posting_result = None
    try:
        posting_result = await post_inventory_issue(db, out, user)
    except Exception as e:
        log.exception("Inventory issue auto-post failed")
        posting_result = {"ok": False, "error": str(e)}
    out_refresh = await db.rahaza_material_issues.find_one({"id": mid}, {"_id": 0})
    await _enrich_mi(db, out_refresh)
    out_refresh["_posting_result"] = posting_result
    return serialize_doc(out_refresh)


@router.post("/material-issues/{mid}/reject")
async def reject_mi(mid: str, request: Request):
    user = await _require_mi_approver(request)
    db = get_db()
    body = await request.json()
    reason = body.get("reason") or "Tidak ada alasan"
    mi = await db.rahaza_material_issues.find_one({"id": mid}, {"_id": 0})
    if not mi:
        raise HTTPException(404, "MI tidak ditemukan.")
    if mi.get("status") != "pending_approval":
        raise HTTPException(400, f"Hanya MI Pending Approval yang bisa di-reject. Status: {mi.get('status')}")
    await db.rahaza_material_issues.update_one(
        {"id": mid},
        {"$set": {"status": "rejected", "rejected_at": _now(), "rejected_by": user["id"],
                 "rejected_by_name": user.get("name", ""), "rejected_reason": reason, "updated_at": _now()}}
    )
    await log_activity(user["id"], user.get("name", ""), f"reject:{reason}", "rahaza.mi", mi["mi_number"])
    out = await db.rahaza_material_issues.find_one({"id": mid}, {"_id": 0})
    await _enrich_mi(db, out)
    return serialize_doc(out)
