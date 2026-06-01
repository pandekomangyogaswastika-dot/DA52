"""
PT Rahaza ERP — Production Wizard (Automation Improvement #1)

Endpoints (prefix /api/rahaza/wizard):
  POST /wizard/preview-production  — Preview what will be created (no DB write)
  POST /wizard/start-production    — One-shot: Order → WO → Release → Bundles

Workflow:
  1. Buat Order (status: draft → confirmed otomatis)
  2. Generate WO per item dari Order
  3. Release setiap WO (auto, optional)
  4. Generate Bundles per WO (auto, optional)
  5. Return ringkasan lengkap

Benefit:
  Menggantikan 4 langkah manual (Order → Generate WO → Release → Generate Bundle)
  menjadi 1 langkah saja.
"""
import math
import uuid
import logging
from datetime import datetime, timezone, date
from fastapi import APIRouter, Request, HTTPException
from database import get_db
from auth import require_auth, log_activity

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/rahaza", tags=["wizard"])


def _uid() -> str: return str(uuid.uuid4())
def _now(): return datetime.now(timezone.utc)


async def _require_ppic(request: Request):
    user = await require_auth(request)
    role = (user.get("role") or "").lower()
    perms = user.get("_permissions") or []
    if role in ("superadmin", "admin") or "*" in perms or "wo.manage" in perms or "order.manage" in perms:
        return user
    raise HTTPException(403, "Hanya PPIC/Admin yang bisa menggunakan Production Wizard.")


async def _gen_order_number(db) -> str:
    year = datetime.now(timezone.utc).year
    last = await db.rahaza_orders.find_one(
        {"order_number": {"$regex": f"^ORD-{year}-"}},
        sort=[("order_number", -1)]
    )
    seq = 1
    if last:
        try:
            seq = int(last["order_number"].split("-")[-1]) + 1
        except Exception:
            seq = 1
    return f"ORD-{year}-{seq:04d}"


async def _gen_wo_number(db) -> str:
    year = datetime.now(timezone.utc).year
    last = await db.rahaza_work_orders.find_one(
        {"wo_number": {"$regex": f"^WO-{year}-"}},
        sort=[("wo_number", -1)]
    )
    seq = 1
    if last:
        try:
            seq = int(last["wo_number"].split("-")[-1]) + 1
        except Exception:
            seq = 1
    return f"WO-{year}-{seq:04d}"


async def _next_bundle_number(db) -> str:
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    last = await db.rahaza_bundles.find_one(
        {"bundle_number": {"$regex": f"^BDL-{today}-"}},
        sort=[("bundle_number", -1)]
    )
    seq = 1
    if last:
        try:
            seq = int(last["bundle_number"].split("-")[-1]) + 1
        except Exception:
            seq = 1
    return f"BDL-{today}-{seq:04d}"


async def _active_processes(db):
    return await db.rahaza_processes.find(
        {"active": True, "is_rework": {"$ne": True}},
        {"_id": 0}
    ).sort("order_seq", 1).to_list(500)


async def _get_bom_snapshot(db, model_id: str, size_id: str) -> dict:
    from routes.rahaza_bom import _get_bom_snapshot_for_wo
    try:
        return await _get_bom_snapshot_for_wo(db, model_id, size_id)
    except Exception:
        return {}


async def _generate_wo_bundles_internal(db, wo: dict, user: dict) -> list:
    """Generate bundles for a WO (internal, no HTTP)."""
    wo_id  = wo["id"]
    wo_qty = int(wo.get("qty") or 0)
    if wo_qty <= 0:
        return []

    model = await db.rahaza_models.find_one({"id": wo.get("model_id")}, {"_id": 0}) or {}
    bundle_size = int(model.get("bundle_size") or 0) or 30
    procs = await _active_processes(db)
    if not procs:
        return []
    process_sequence = [{"id": p["id"], "code": p["code"], "name": p["name"], "order_seq": p.get("order_seq", 0)} for p in procs]
    first_proc = procs[0]
    size  = await db.rahaza_sizes.find_one({"id": wo.get("size_id")}, {"_id": 0}) or {}

    num_bundles = max(1, math.ceil(wo_qty / bundle_size))
    created = []
    remaining = wo_qty
    for i in range(num_bundles):
        bqty = min(bundle_size, remaining)
        remaining -= bqty
        doc = {
            "id": _uid(), "bundle_number": await _next_bundle_number(db),
            "work_order_id": wo_id, "wo_number_snapshot": wo.get("wo_number"),
            "model_id": wo.get("model_id"), "model_code": model.get("code"), "model_name": model.get("name"),
            "size_id": wo.get("size_id"), "size_code": size.get("code"),
            "qty": bqty, "qty_pass": 0, "qty_fail": 0, "qty_remaining": bqty,
            "status": "created",
            "process_sequence": process_sequence,
            "current_process_id": first_proc["id"], "current_process_code": first_proc["code"],
            "current_process_name": first_proc["name"], "current_line_id": None,
            "parent_bundle_id": None, "split_from_qc_event_id": None,
            "history": [{"event": "created", "by": user.get("name") or user.get("email"),
                         "by_id": user.get("id"), "at": _now(), "qty": bqty,
                         "notes": f"Generated bundle {i+1}/{num_bundles} via Wizard dari WO {wo.get('wo_number')}"}],
            "created_at": _now(), "updated_at": _now(),
            "created_by": user.get("email") or user.get("name"),
        }
        await db.rahaza_bundles.insert_one(doc)
        doc.pop("_id", None)
        created.append(doc)
    return created


async def _auto_reserve_for_wo_quiet(db, wo_id: str, wo: dict, user: dict):
    """Material reservation on WO release — same as production route but silently."""
    try:
        from routes.rahaza_work_orders import _auto_reserve_materials_for_wo
        await _auto_reserve_materials_for_wo(db, wo_id, wo, user)
    except Exception as e:
        logger.warning(f"Wizard material reservation failed for {wo_id}: {e}")


# ─── Preview endpoint (dry-run) ──────────────────────────────────────────
@router.post("/wizard/preview-production")
async def wizard_preview(request: Request):
    """
    Dry-run: hitung berapa WO dan bundle yang akan dibuat.
    Tidak menyimpan ke database.
    """
    await _require_ppic(request)
    db   = get_db()
    body = await request.json()
    items = body.get("items") or []

    preview_wos = []
    total_bundles = 0
    # Batch prefetch all referenced models & sizes
    m_ids = [r.get("model_id") for r in items if r.get("model_id")]
    s_ids = [r.get("size_id")  for r in items if r.get("size_id")]
    model_map = {}
    if m_ids:
        async for d in db.rahaza_models.find({"id": {"$in": m_ids}}, {"_id": 0}):
            model_map[d["id"]] = d
    size_map = {}
    if s_ids:
        async for d in db.rahaza_sizes.find({"id": {"$in": s_ids}}, {"_id": 0}):
            size_map[d["id"]] = d
    for raw in items:
        qty = int(raw.get("qty") or 0)
        if qty <= 0:
            continue
        model = model_map.get(raw.get("model_id")) or {}
        size  = size_map.get(raw.get("size_id")) or {}
        bundle_size = int(model.get("bundle_size") or 0) or 30
        num_bundles = math.ceil(qty / bundle_size)
        total_bundles += num_bundles
        preview_wos.append({
            "model_code": model.get("code") or raw.get("model_id"),
            "model_name": model.get("name"),
            "size_code":  size.get("code") or raw.get("size_id"),
            "qty": qty,
            "bundle_size": bundle_size,
            "num_bundles": num_bundles,
            "bom_available": False,  # will be enriched in next version
        })
    return {
        "wo_count": len(preview_wos),
        "total_bundles": total_bundles,
        "items": preview_wos,
    }


# ─── Main Wizard endpoint ──────────────────────────────────────────────
@router.post("/wizard/start-production")
async def wizard_start(request: Request):
    """
    One-shot endpoint: Order → WO (per item) → Release → Bundle.
    Steps:
      1. Validate input
      2. Create Order (draft → confirmed)
      3. Create WO per item with BOM snapshot
      4. Release WO (if auto_release_wo=True, default True)
      5. Generate bundles (if auto_generate_bundles=True, default True)
      6. Return summary
    """
    user = await _require_ppic(request)
    db   = get_db()
    body = await request.json()

    # ── Validate ────────────────────────────────────────────────
    is_internal = bool(body.get("is_internal"))
    customer_id = body.get("customer_id") or None
    if not is_internal and not customer_id:
        raise HTTPException(400, "Pilih pelanggan atau centang 'Produksi Internal'.")

    customer_name_snapshot = ""
    if customer_id:
        cust = await db.rahaza_customers.find_one({"id": customer_id}, {"_id": 0})
        if not cust:
            raise HTTPException(404, "Pelanggan tidak ditemukan.")
        customer_name_snapshot = cust["name"]

    items = body.get("items") or []
    cleaned_items = []
    for raw in items:
        if not raw.get("model_id") or not raw.get("size_id"):
            continue
        q = int(raw.get("qty") or 0)
        if q <= 0:
            continue
        cleaned_items.append({
            "id": _uid(),
            "model_id": raw["model_id"],
            "size_id":  raw["size_id"],
            "qty": q,
            "notes": raw.get("notes") or "",
        })
    if not cleaned_items:
        raise HTTPException(400, "Tidak ada item yang valid (model+size+qty wajib, qty>0).")

    priority = (body.get("priority") or "normal").lower()
    auto_release  = bool(body.get("auto_release_wo", True))
    auto_bundles  = bool(body.get("auto_generate_bundles", True))
    due_date      = body.get("due_date") or None
    order_date    = body.get("order_date") or date.today().isoformat()
    target_start  = body.get("target_start_date") or date.today().isoformat()
    target_end    = body.get("target_end_date") or due_date

    # ── Step 1: Create Order ─────────────────────────────────────────
    order = {
        "id": _uid(),
        "order_number": await _gen_order_number(db),
        "order_date": order_date,
        "due_date": due_date,
        "customer_id": customer_id,
        "customer_name_snapshot": customer_name_snapshot,
        "is_internal": is_internal,
        "status": "confirmed",  # wizard always starts at confirmed
        "items": cleaned_items,
        "notes": body.get("notes") or f"Dibuat via Production Wizard oleh {user.get('name', 'sistem')}",
        "confirmed_at": _now(),
        "created_by": user["id"], "created_by_name": user.get("name", ""),
        "created_at": _now(), "updated_at": _now(),
        "created_via": "wizard",
    }
    await db.rahaza_orders.insert_one(order)
    await log_activity(user["id"], user.get("name", ""), "wizard:create-order", "rahaza.order", order["order_number"])

    # ── Step 2: Create WOs per item ────────────────────────────────────
    created_wos = []
    # Batch prefetch all models & sizes for cleaned_items
    m_ids2 = [it["model_id"] for it in cleaned_items if it.get("model_id")]
    s_ids2 = [it["size_id"]  for it in cleaned_items if it.get("size_id")]
    model_map2 = {}
    if m_ids2:
        async for d in db.rahaza_models.find({"id": {"$in": m_ids2}}, {"_id": 0}):
            model_map2[d["id"]] = d
    size_map2 = {}
    if s_ids2:
        async for d in db.rahaza_sizes.find({"id": {"$in": s_ids2}}, {"_id": 0}):
            size_map2[d["id"]] = d
    for it in cleaned_items:
        try:
            bom_snap = await _get_bom_snapshot(db, it["model_id"], it["size_id"])
        except Exception:
            bom_snap = {}
        model = model_map2.get(it["model_id"]) or {}
        size  = size_map2.get(it["size_id"]) or {}
        wo = {
            "id": _uid(),
            "wo_number": await _gen_wo_number(db),
            "order_id": order["id"],
            "order_number_snapshot": order["order_number"],
            "order_item_id": it["id"],
            "model_id": it["model_id"],
            "model_name": model.get("name") or "",
            "size_id":  it["size_id"],
            "size_code": size.get("code") or "",
            "qty": int(it["qty"]),
            "customer_snapshot": customer_name_snapshot,
            "is_internal": is_internal,
            "priority": priority,
            "target_start_date": target_start,
            "target_end_date": target_end,
            "bom_snapshot": bom_snap,
            "status": "draft",
            "notes": it.get("notes") or "",
            "created_by": user["id"], "created_by_name": user.get("name", ""),
            "created_at": _now(), "updated_at": _now(),
            "created_via": "wizard",
        }
        await db.rahaza_work_orders.insert_one(wo)
        created_wos.append(wo)

    # ── Step 3: Release WOs ───────────────────────────────────────────
    if auto_release:
        for wo in created_wos:
            await db.rahaza_work_orders.update_one(
                {"id": wo["id"]},
                {"$set": {"status": "released", "released_at": _now(), "updated_at": _now()}}
            )
            wo["status"] = "released"
            # Auto-reserve materials silently
            await _auto_reserve_for_wo_quiet(db, wo["id"], wo, user)

    # ── Step 4: Generate Bundles ────────────────────────────────────────
    bundle_counts = {}
    if auto_bundles:
        for wo in created_wos:
            try:
                bundles = await _generate_wo_bundles_internal(db, wo, user)
                bundle_counts[wo["id"]] = len(bundles)
            except Exception as e:
                logger.warning(f"Wizard bundle gen failed for WO {wo['wo_number']}: {e}")
                bundle_counts[wo["id"]] = 0

    await log_activity(user["id"], user.get("name", ""),
                       f"wizard:done {len(created_wos)}WO/{sum(bundle_counts.values())}bundle",
                       "rahaza.order", order["order_number"])

    return {
        "ok": True,
        "order_id": order["id"],
        "order_number": order["order_number"],
        "due_date": due_date,
        "wos_created": len(created_wos),
        "bundles_created": sum(bundle_counts.values()),
        "wos": [
            {
                "id": w["id"],
                "wo_number": w["wo_number"],
                "model_id": w["model_id"],
                "model_name": w.get("model_name"),
                "size_id": w["size_id"],
                "size_code": w.get("size_code"),
                "qty": w["qty"],
                "status": w["status"],
                "bundles": bundle_counts.get(w["id"], 0),
            }
            for w in created_wos
        ],
    }


# ─── Auto-Complete WO helper (used by execution module) ─────────────────────
async def maybe_auto_complete_wo(db, work_order_id: str, user: dict):
    """
    After a Packing or Rework-Pass event, check if WO should auto-complete.
    WO is auto-completed when packing output + rework_pass >= WO target qty.
    Respects existing rule: cannot complete if bundles still in rework.
    """
    if not work_order_id:
        return
    try:
        wo = await db.rahaza_work_orders.find_one(
            {"id": work_order_id, "status": {"$in": ["released", "in_production"]}},
            {"_id": 0}
        )
        if not wo:
            return

        wo_qty = int(wo.get("qty") or 0)
        if wo_qty <= 0:
            return

        # Sum packing output + rework_pass for this WO
        packing_proc = await db.rahaza_processes.find_one({"code": "PACKING", "active": True}, {"_id": 0})
        match_q = {
            "work_order_id": work_order_id,
            "$or": [
                {"event_type": "rework_pass"},
            ]
        }
        if packing_proc:
            match_q["$or"].append({"process_id": packing_proc["id"], "event_type": "output"})
        pipe = [{"$match": match_q}, {"$group": {"_id": None, "total": {"$sum": "$qty"}}}]
        res = await db.rahaza_wip_events.aggregate(pipe).to_list(500)
        completed_qty = res[0]["total"] if res else 0

        if completed_qty < wo_qty:
            return

        # Respect bundle rework blocking rule
        blocked = await db.rahaza_bundles.count_documents({"work_order_id": work_order_id, "status": "reworking"})
        if blocked > 0:
            return

        # Auto-complete WO
        await db.rahaza_work_orders.update_one(
            {"id": work_order_id, "status": {"$in": ["released", "in_production"]}},
            {"$set": {
                "status": "completed",
                "completed_at": _now(),
                "completed_qty": completed_qty,
                "auto_completed": True,
                "updated_at": _now(),
            }}
        )
        logger.info(f"[AUTO-COMPLETE] WO {wo.get('wo_number')} auto-completed ({completed_qty}/{wo_qty} pcs)")

        # Auto-complete parent Order if ALL WOs are completed/cancelled
        order_id = wo.get("order_id")
        if order_id:
            all_wos = await db.rahaza_work_orders.find(
                {"order_id": order_id, "status": {"$ne": "cancelled"}}, {"_id": 0, "status": 1}
            ).to_list(500)
            if all_wos and all(w["status"] == "completed" for w in all_wos):
                await db.rahaza_orders.update_one(
                    {"id": order_id, "status": {"$nin": ["completed", "closed"]}},
                    {"$set": {"status": "completed", "completed_at": _now(), "updated_at": _now()}}
                )
                logger.info(f"[AUTO-COMPLETE] Order {order_id} auto-completed (all WOs done)")
    except Exception as e:
        logger.warning(f"maybe_auto_complete_wo error: {e}")
