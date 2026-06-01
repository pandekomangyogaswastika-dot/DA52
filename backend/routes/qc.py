"""
Quality Control Routes
Domain: QC inspections at input / in-line / finishing / final output stages.

Aligned with blueprint:
- Inspect input, in-line, finishing, and final output
- Record defect type, quantity, and reason
- Trigger hold, rework, replace, or approve
- Create QC history for audit and improvement
"""
from fastapi import APIRouter, Request, HTTPException
from database import get_db
from auth import require_auth, check_role, log_activity, serialize_doc
from routes.shared import new_id, now, get_pagination_params, paginated_response
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/qc", tags=["qc"])


QC_STAGES = ["input", "inline", "finishing", "final"]
QC_OUTCOMES = ["approved", "hold", "rework", "replace", "rejected"]
DEFAULT_DEFECT_TAXONOMY = [
    "broken_stitch", "skipped_stitch", "open_seam", "fabric_defect", "shade_mismatch",
    "stain", "hole_tear", "misaligned_trim", "size_issue", "label_error",
    "pressing_mark", "measurement_out_of_spec", "other"
]


# ═══════════════════════════════════════════════════════════════════════════════
# INSPECTIONS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/inspections")
async def list_inspections(request: Request):
    await require_auth(request)
    db = get_db()
    page, limit, skip = get_pagination_params(request, default_limit=50)
    stage = request.query_params.get("stage")
    outcome = request.query_params.get("outcome")
    q = {}
    if stage:
        q["stage"] = stage
    if outcome:
        q["outcome"] = outcome
    total = await db.qc_inspections.count_documents(q)
    items = await db.qc_inspections.find(q, {"_id": 0}).sort("created_at", -1).skip(skip).limit(limit).to_list(500)
    return paginated_response(serialize_doc(items), total, page, limit)


@router.post("/inspections")
async def create_inspection(request: Request):
    user = await require_auth(request)
    body = await request.json()
    db = get_db()
    stage = body.get("stage", "inline")
    if stage not in QC_STAGES:
        raise HTTPException(400, f"Stage must be one of {QC_STAGES}")

    count = await db.qc_inspections.count_documents({}) + 1
    insp_no = body.get("inspection_no") or f"QC-{now().strftime('%Y%m')}-{count:04d}"

    inspected_qty = int(body.get("inspected_qty", 0) or 0)
    passed_qty = int(body.get("passed_qty", 0) or 0)
    defect_qty = int(body.get("defect_qty", 0) or 0)
    defects = body.get("defects") or []  # [{type, qty, reason}]

    outcome = body.get("outcome", "approved")
    if outcome not in QC_OUTCOMES:
        raise HTTPException(400, f"Outcome must be one of {QC_OUTCOMES}")

    doc = {
        "id": new_id(),
        "inspection_no": insp_no,
        "stage": stage,
        "source_type": body.get("source_type", "finishing_batch"),  # finishing_batch | cutting_order | production_job | receiving
        "source_id": body.get("source_id"),
        "source_ref": body.get("source_ref", ""),
        "product_name": body.get("product_name", ""),
        "inspected_qty": inspected_qty,
        "passed_qty": passed_qty,
        "defect_qty": defect_qty,
        "defects": defects,
        "outcome": outcome,  # approved | hold | rework | replace | rejected
        "inspector_name": body.get("inspector_name", user.get("name", "")),
        "notes": body.get("notes", ""),
        "created_by": user.get("id"),
        "created_by_name": user.get("name"),
        "created_at": now(),
        "updated_at": now(),
    }
    await db.qc_inspections.insert_one(doc)
    doc.pop("_id", None)

    # Side-effects by outcome
    if doc["source_type"] == "finishing_batch" and doc["source_id"]:
        fb = await db.finishing_batches.find_one({"id": doc["source_id"]})
        if fb:
            is_rework_batch = fb.get("source_type") == "qc_rework"

            if outcome == "approved":
                # Approved: complete this batch
                await db.finishing_batches.update_one(
                    {"id": doc["source_id"]},
                    {"$set": {"status": "completed", "updated_at": now()}}
                )
                # If this is a rework batch being approved, close its link on parent
                if is_rework_batch and fb.get("parent_batch_id"):
                    parent_id = fb["parent_batch_id"]
                    # Decrement parent rework_qty; if 0 → clear has_rework
                    parent = await db.finishing_batches.find_one({"id": parent_id})
                    if parent:
                        new_rework_qty = max(0, int(parent.get("rework_qty", 0)) - int(fb.get("input_qty", 0)))
                        parent_update = {"rework_qty": new_rework_qty, "updated_at": now()}
                        if new_rework_qty == 0:
                            parent_update["has_rework"] = False
                            # If parent was in_progress only due to rework and all stages done → completed
                            if all(s in (parent.get("stages_done") or []) for s in ["finishing", "pressing", "labeling"]):
                                parent_update["status"] = "completed"
                        await db.finishing_batches.update_one({"id": parent_id}, {"$set": parent_update})
                    # Also mark the bundles tied to this rework cutting_order clean
                    # Not typical but safe to clear needs_rework
                    await db.cutting_outputs.update_many(
                        {"rework_inspection_id": fb.get("source_id")},
                        {"$set": {"needs_rework": False, "rework_resolved_at": now()}}
                    )
            elif outcome == "rework":
                # Block rework batches from chaining another rework (guardrail)
                if is_rework_batch:
                    raise HTTPException(400, "Cannot create rework on an already-rework batch. Mark as rejected instead.")
                # Auto-create a rework finishing batch with reject qty
                rework_qty = max(defect_qty, inspected_qty - passed_qty)
                count_fb = await db.finishing_batches.count_documents({}) + 1
                rework_batch = {
                    "id": new_id(),
                    "batch_no": f"FIN-{now().strftime('%Y%m')}-R{count_fb:04d}",
                    "source_type": "qc_rework",
                    "source_id": doc["id"],
                    "source_ref": doc["inspection_no"],
                    "parent_batch_id": fb.get("id"),
                    "parent_batch_no": fb.get("batch_no", ""),
                    "product_name": fb.get("product_name", doc.get("product_name", "")),
                    "size_breakdown": fb.get("size_breakdown", []),
                    "input_qty": rework_qty,
                    "stage": "finishing",
                    "stages_done": [],
                    "finished_qty": 0,
                    "pressed_qty": 0,
                    "labeled_qty": 0,
                    "status": "in_progress",
                    "rework_status": "pending_reqc",
                    "operator_name": "",
                    "line": "",
                    "notes": f"Auto-rework from QC {doc['inspection_no']} — {rework_qty} pcs",
                    "created_by": user.get("id"),
                    "created_by_name": user.get("name"),
                    "created_at": now(),
                    "updated_at": now(),
                }
                await db.finishing_batches.insert_one(rework_batch)
                rework_batch.pop("_id", None)
                doc["rework_batch_id"] = rework_batch["id"]
                doc["rework_batch_no"] = rework_batch["batch_no"]
                # Flag parent batch as having rework but keep it in progress
                await db.finishing_batches.update_one(
                    {"id": doc["source_id"]},
                    {"$set": {"status": "in_progress", "has_rework": True, "updated_at": now()},
                     "$inc": {"rework_qty": rework_qty}}
                )
                await db.qc_inspections.update_one(
                    {"id": doc["id"]},
                    {"$set": {"rework_batch_id": rework_batch["id"], "rework_batch_no": rework_batch["batch_no"]}}
                )
                # ── Tag affected bundles if parent batch came from a cutting_order ──
                parent_cutting_id = fb.get("source_id") if fb.get("source_type") == "cutting_order" else None
                if parent_cutting_id:
                    await db.cutting_outputs.update_many(
                        {"cutting_order_id": parent_cutting_id},
                        {"$set": {
                            "needs_rework": True,
                            "rework_inspection_id": doc["id"],
                            "rework_inspection_no": doc["inspection_no"],
                            "rework_qty": rework_qty,
                            "rework_flagged_at": now(),
                        }}
                    )
            elif outcome in ["hold", "replace"]:
                await db.finishing_batches.update_one(
                    {"id": doc["source_id"]},
                    {"$set": {"status": "in_progress", "updated_at": now()}}
                )
            elif outcome == "rejected":
                await db.finishing_batches.update_one(
                    {"id": doc["source_id"]},
                    {"$set": {"status": "rejected", "updated_at": now()}}
                )

    await log_activity(user["id"], user["name"], "QC", "QCInspection",
                       f"{stage} inspection {insp_no} -> {outcome}")
    return serialize_doc(doc)


@router.get("/inspections/{insp_id}")
async def get_inspection(insp_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    doc = await db.qc_inspections.find_one({"id": insp_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Inspection not found")
    return serialize_doc(doc)


@router.put("/inspections/{insp_id}")
async def update_inspection(insp_id: str, request: Request):
    user = await require_auth(request)
    body = await request.json()
    db = get_db()
    allowed = {k: v for k, v in body.items() if k in [
        "inspector_name", "notes", "defects", "passed_qty", "defect_qty", "outcome", "inspected_qty"
    ]}
    if "outcome" in allowed and allowed["outcome"] not in QC_OUTCOMES:
        raise HTTPException(400, f"Outcome must be one of {QC_OUTCOMES}")
    allowed["updated_at"] = now()
    r = await db.qc_inspections.update_one({"id": insp_id}, {"$set": allowed})
    if r.matched_count == 0:
        raise HTTPException(404, "Inspection not found")
    updated = await db.qc_inspections.find_one({"id": insp_id}, {"_id": 0})
    await log_activity(user["id"], user["name"], "Update", "QCInspection", f"Updated {insp_id}")
    return serialize_doc(updated)


@router.delete("/inspections/{insp_id}")
async def delete_inspection(insp_id: str, request: Request):
    user = await require_auth(request)
    if not check_role(user, ["superadmin", "admin"]):
        raise HTTPException(403, "Not authorized")
    db = get_db()
    await db.qc_inspections.delete_one({"id": insp_id})
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════════════════════
# DEFECT TAXONOMY
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/defect-types")
async def list_defect_types(request: Request):
    await require_auth(request)
    db = get_db()
    custom = await db.qc_defect_types.find({}, {"_id": 0}).sort("name", 1).to_list(500)
    return {
        "defaults": DEFAULT_DEFECT_TAXONOMY,
        "custom": serialize_doc(custom),
    }


@router.post("/defect-types")
async def create_defect_type(request: Request):
    user = await require_auth(request)
    if not check_role(user, ["superadmin", "admin"]):
        raise HTTPException(403, "Not authorized")
    body = await request.json()
    db = get_db()
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Name required")
    doc = {
        "id": new_id(),
        "name": name,
        "category": body.get("category", "general"),
        "severity": body.get("severity", "minor"),  # minor | major | critical
        "created_at": now(),
    }
    await db.qc_defect_types.insert_one(doc)
    doc.pop("_id", None)
    return serialize_doc(doc)


# ═══════════════════════════════════════════════════════════════════════════════
# ANALYTICS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/analytics/rework-by-operator")
async def rework_rate_by_operator(request: Request):
    """Aggregate rework rate per operator (based on the finishing batch operator attached to each inspection).
    Returns: [{operator_name, inspections, approved, rework_count, defect_qty, rework_rate_pct, pass_rate_pct}, ...]
    """
    await require_auth(request)
    db = get_db()
    # Pull all inspections tied to finishing_batch source with operator info
    pipeline = [
        {"$match": {"source_type": "finishing_batch"}},
        {"$lookup": {
            "from": "finishing_batches",
            "localField": "source_id",
            "foreignField": "id",
            "as": "batch"
        }},
        {"$unwind": {"path": "$batch", "preserveNullAndEmptyArrays": True}},
        {"$group": {
            "_id": {"$ifNull": ["$batch.operator_name", "Unassigned"]},
            "inspections": {"$sum": 1},
            "approved": {"$sum": {"$cond": [{"$eq": ["$outcome", "approved"]}, 1, 0]}},
            "rework_count": {"$sum": {"$cond": [{"$eq": ["$outcome", "rework"]}, 1, 0]}},
            "rejected": {"$sum": {"$cond": [{"$eq": ["$outcome", "rejected"]}, 1, 0]}},
            "inspected_qty": {"$sum": "$inspected_qty"},
            "passed_qty": {"$sum": "$passed_qty"},
            "defect_qty": {"$sum": "$defect_qty"},
        }},
        {"$project": {
            "_id": 0,
            "operator_name": "$_id",
            "inspections": 1,
            "approved": 1,
            "rework_count": 1,
            "rejected": 1,
            "inspected_qty": 1,
            "passed_qty": 1,
            "defect_qty": 1,
        }},
        {"$sort": {"rework_count": -1, "inspections": -1}}
    ]
    rows = await db.qc_inspections.aggregate(pipeline).to_list(500)
    for r in rows:
        insp = max(1, r.get("inspections", 1))
        insp_qty = max(1, r.get("inspected_qty", 1))
        r["rework_rate_pct"] = round((r.get("rework_count", 0) / insp) * 100, 1)
        r["pass_rate_pct"] = round((r.get("passed_qty", 0) / insp_qty) * 100, 1)
    return rows


# ═══════════════════════════════════════════════════════════════════════════════
# DASHBOARD
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/dashboard")
async def qc_dashboard(request: Request):
    await require_auth(request)
    db = get_db()
    total = await db.qc_inspections.count_documents({})
    approved = await db.qc_inspections.count_documents({"outcome": "approved"})
    hold = await db.qc_inspections.count_documents({"outcome": "hold"})
    rework = await db.qc_inspections.count_documents({"outcome": "rework"})
    rejected = await db.qc_inspections.count_documents({"outcome": "rejected"})

    agg = await db.qc_inspections.aggregate([
        {"$group": {"_id": None,
                    "inspected": {"$sum": "$inspected_qty"},
                    "passed": {"$sum": "$passed_qty"},
                    "defects": {"$sum": "$defect_qty"}}}
    ]).to_list(1)
    totals = agg[0] if agg else {"inspected": 0, "passed": 0, "defects": 0}

    # Top defect types (unwind)
    top_defects = await db.qc_inspections.aggregate([
        {"$unwind": "$defects"},
        {"$group": {"_id": "$defects.type", "qty": {"$sum": "$defects.qty"}}},
        {"$sort": {"qty": -1}},
        {"$limit": 5}
    ]).to_list(5)
    top_defects_out = [{"type": d["_id"] or "unspecified", "qty": d["qty"]} for d in top_defects]

    recent = await db.qc_inspections.find({}, {"_id": 0}).sort("created_at", -1).to_list(5)

    pass_rate = 0.0
    if totals.get("inspected", 0) > 0:
        pass_rate = round((totals.get("passed", 0) / totals["inspected"]) * 100, 1)

    return {
        "total_inspections": total,
        "approved": approved,
        "hold": hold,
        "rework": rework,
        "rejected": rejected,
        "total_inspected": totals.get("inspected", 0),
        "total_passed": totals.get("passed", 0),
        "total_defects": totals.get("defects", 0),
        "pass_rate": pass_rate,
        "top_defects": top_defects_out,
        "recent_inspections": serialize_doc(recent),
    }
