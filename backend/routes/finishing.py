"""
Finishing / Pressing / Labeling Routes
Domain: Track units through finishing stages before QC-ready.

Aligned with blueprint:
- Mark units as finished, pressed, and labeled
- Separate finished but not QC-approved output
- Show handoff points clearly
"""
from fastapi import APIRouter, Request, HTTPException
from database import get_db
from auth import require_auth, check_role, log_activity, serialize_doc
from routes.shared import new_id, now, get_pagination_params, paginated_response
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/finishing", tags=["finishing"])


# ═══════════════════════════════════════════════════════════════════════════════
# FINISHING BATCHES
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/batches")
async def list_finishing_batches(request: Request):
    await require_auth(request)
    db = get_db()
    page, limit, skip = get_pagination_params(request, default_limit=50)
    status = request.query_params.get("status")
    stage = request.query_params.get("stage")
    q = {}
    if status:
        q["status"] = status
    if stage:
        q["stage"] = stage
    total = await db.finishing_batches.count_documents(q)
    items = await db.finishing_batches.find(q, {"_id": 0}).sort("created_at", -1).skip(skip).limit(limit).to_list(500)
    return paginated_response(serialize_doc(items), total, page, limit)


@router.post("/batches")
async def create_finishing_batch(request: Request):
    user = await require_auth(request)
    body = await request.json()
    db = get_db()
    count = await db.finishing_batches.count_documents({}) + 1
    batch_no = body.get("batch_no") or f"FIN-{now().strftime('%Y%m')}-{count:04d}"

    doc = {
        "id": new_id(),
        "batch_no": batch_no,
        "source_type": body.get("source_type", "production"),  # production | work_order
        "source_id": body.get("source_id"),
        "source_ref": body.get("source_ref", ""),
        "product_name": body.get("product_name", ""),
        "size_breakdown": body.get("size_breakdown", []),
        "input_qty": int(body.get("input_qty", 0) or 0),
        "stage": body.get("stage", "finishing"),  # finishing | pressing | labeling | packed_ready
        "stages_done": body.get("stages_done", []),  # e.g., ['finishing']
        "finished_qty": 0,
        "pressed_qty": 0,
        "labeled_qty": 0,
        "status": "in_progress",  # in_progress | qc_ready | completed | rejected
        "operator_name": body.get("operator_name", ""),
        "line": body.get("line", ""),
        "notes": body.get("notes", ""),
        "created_by": user.get("id"),
        "created_by_name": user.get("name"),
        "created_at": now(),
        "updated_at": now(),
    }
    await db.finishing_batches.insert_one(doc)
    doc.pop("_id", None)
    await log_activity(user["id"], user["name"], "Create", "FinishingBatch", f"Finishing batch {batch_no}")
    return serialize_doc(doc)


@router.get("/batches/{batch_id}")
async def get_finishing_batch(batch_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    b = await db.finishing_batches.find_one({"id": batch_id}, {"_id": 0})
    if not b:
        raise HTTPException(404, "Finishing batch not found")
    events = await db.finishing_events.find({"batch_id": batch_id}, {"_id": 0}).sort("recorded_at", -1).to_list(500)
    b["events"] = serialize_doc(events)
    return serialize_doc(b)


@router.post("/batches/{batch_id}/progress")
async def record_finishing_progress(batch_id: str, request: Request):
    """Record progress of a finishing stage.
    body: { stage: finishing|pressing|labeling, qty, operator_name, notes }
    """
    user = await require_auth(request)
    body = await request.json()
    db = get_db()
    batch = await db.finishing_batches.find_one({"id": batch_id}, {"_id": 0})
    if not batch:
        raise HTTPException(404, "Finishing batch not found")

    stage = body.get("stage", "finishing")
    if stage not in ["finishing", "pressing", "labeling"]:
        raise HTTPException(400, "Invalid stage")
    qty = int(body.get("qty", 0) or 0)

    event = {
        "id": new_id(),
        "batch_id": batch_id,
        "batch_no": batch.get("batch_no", ""),
        "stage": stage,
        "qty": qty,
        "operator_name": body.get("operator_name", ""),
        "notes": body.get("notes", ""),
        "recorded_at": now(),
        "recorded_by": user.get("id"),
        "recorded_by_name": user.get("name"),
    }
    await db.finishing_events.insert_one(event)
    event.pop("_id", None)

    # Update parent batch
    field_map = {"finishing": "finished_qty", "pressing": "pressed_qty", "labeling": "labeled_qty"}
    agg = await db.finishing_events.aggregate([
        {"$match": {"batch_id": batch_id, "stage": stage}},
        {"$group": {"_id": None, "sum": {"$sum": "$qty"}}}
    ]).to_list(1)
    stage_total = agg[0]["sum"] if agg else 0
    update = {field_map[stage]: stage_total, "stage": stage, "updated_at": now()}

    stages_done = list(batch.get("stages_done") or [])
    if stage_total >= batch.get("input_qty", 0) and batch.get("input_qty", 0) > 0:
        if stage not in stages_done:
            stages_done.append(stage)
        update["stages_done"] = stages_done

    # If all 3 stages done and qty >= input -> QC ready (except for rework batches: must pass re-QC explicitly)
    if all(s in stages_done for s in ["finishing", "pressing", "labeling"]):
        if batch.get("source_type") == "qc_rework":
            update["rework_status"] = "pending_reqc"
            update["status"] = "qc_ready"
        else:
            update["status"] = "qc_ready"

    await db.finishing_batches.update_one({"id": batch_id}, {"$set": update})

    await log_activity(user["id"], user["name"], "Progress", "FinishingBatch",
                       f"{stage} +{qty} on {batch.get('batch_no')}")
    return serialize_doc(event)


@router.put("/batches/{batch_id}")
async def update_finishing_batch(batch_id: str, request: Request):
    await require_auth(request)
    body = await request.json()
    db = get_db()
    allowed = {k: v for k, v in body.items() if k in [
        "status", "operator_name", "line", "notes", "stage", "input_qty", "size_breakdown"
    ]}
    allowed["updated_at"] = now()
    r = await db.finishing_batches.update_one({"id": batch_id}, {"$set": allowed})
    if r.matched_count == 0:
        raise HTTPException(404, "Finishing batch not found")
    updated = await db.finishing_batches.find_one({"id": batch_id}, {"_id": 0})
    return serialize_doc(updated)


@router.delete("/batches/{batch_id}")
async def delete_finishing_batch(batch_id: str, request: Request):
    user = await require_auth(request)
    if not check_role(user, ["superadmin", "admin"]):
        raise HTTPException(403, "Not authorized")
    db = get_db()
    await db.finishing_batches.delete_one({"id": batch_id})
    await db.finishing_events.delete_many({"batch_id": batch_id})
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════════════════════
# SHIPMENT READY LIST (Packing Guardrail)
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/ready-for-shipment")
async def list_ready_for_shipment(request: Request):
    """List completed finishing batches that are ready for packing/shipment.
    Excludes batches already referenced by a dispatched shipment.
    """
    await require_auth(request)
    db = get_db()
    # Find all batches with status='completed' and not already shipped
    batches = await db.finishing_batches.find(
        {"status": "completed", "shipped_at": {"$exists": False}},
        {"_id": 0}
    ).sort("updated_at", -1).to_list(500)
    return serialize_doc(batches)


@router.post("/batches/{batch_id}/mark-shipped")
async def mark_batch_shipped(batch_id: str, request: Request):
    """Record that this finishing batch has been handed to packing/shipment.
    Rejects if batch status is not 'completed' (packing guardrail).
    """
    user = await require_auth(request)
    db = get_db()
    batch = await db.finishing_batches.find_one({"id": batch_id})
    if not batch:
        raise HTTPException(404, "Finishing batch not found")
    if batch.get("status") != "completed":
        raise HTTPException(400, f"Batch must be 'completed' before packing. Current status: {batch.get('status')}")

    body = {}
    try:
        body = await request.json()
    except Exception:
        pass
    shipment_ref = body.get("shipment_ref", "")
    await db.finishing_batches.update_one(
        {"id": batch_id},
        {"$set": {
            "shipped_at": now(),
            "shipment_ref": shipment_ref,
            "shipped_by": user.get("id"),
            "shipped_by_name": user.get("name"),
            "updated_at": now(),
        }}
    )
    await log_activity(user["id"], user["name"], "Ship", "FinishingBatch",
                       f"Batch {batch.get('batch_no')} marked shipped → {shipment_ref}")
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════════════════════
# DASHBOARD
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/dashboard")
async def finishing_dashboard(request: Request):
    await require_auth(request)
    db = get_db()
    total = await db.finishing_batches.count_documents({})
    in_progress = await db.finishing_batches.count_documents({"status": "in_progress"})
    qc_ready = await db.finishing_batches.count_documents({"status": "qc_ready"})
    completed = await db.finishing_batches.count_documents({"status": "completed"})
    ready_for_shipment = await db.finishing_batches.count_documents({"status": "completed", "shipped_at": {"$exists": False}})

    agg = await db.finishing_batches.aggregate([
        {"$group": {"_id": None,
                    "input": {"$sum": "$input_qty"},
                    "finished": {"$sum": "$finished_qty"},
                    "pressed": {"$sum": "$pressed_qty"},
                    "labeled": {"$sum": "$labeled_qty"}}}
    ]).to_list(1)
    totals = agg[0] if agg else {"input": 0, "finished": 0, "pressed": 0, "labeled": 0}

    recent = await db.finishing_batches.find({}, {"_id": 0}).sort("created_at", -1).to_list(5)

    return {
        "total_batches": total,
        "in_progress": in_progress,
        "qc_ready": qc_ready,
        "completed": completed,
        "ready_for_shipment": ready_for_shipment,
        "total_input": totals.get("input", 0),
        "total_finished": totals.get("finished", 0),
        "total_pressed": totals.get("pressed", 0),
        "total_labeled": totals.get("labeled", 0),
        "recent_batches": serialize_doc(recent),
    }
