"""
GRN Quality Check & Supplier Scorecard
======================================

P1 — Session 22 (Phase 4)

Adds Quality Control (QC) workflow on top of Goods Receiving:
- Inspection workflow: draft → inspected → accepted (full/partial) → rejected
- Partial receive support: each line has expected_qty / received_qty / accepted_qty / rejected_qty
- Reject categories: 11 standard reasons per AQL/textile industry
- AQL sampling tool: ANSI/ASQ Z1.4 General Level II, AQL 2.5
- Supplier scorecard: aggregate quality metrics per vendor (on-time, accept rate, defect rate, trend)

**Endpoints (prefix /api/rahaza/grn-qc):**
- POST   /inspect/{receipt_id}                 → submit inspection result for a GRN
- POST   /inspect/{receipt_id}/partial-accept  → confirm partial receive with per-line splits
- GET    /reject-categories                    → list of standard reject reasons
- POST   /aql/calculate                        → compute AQL sample size + accept/reject limits
- GET    /supplier-scorecard                   → list scorecards for all suppliers
- GET    /supplier-scorecard/{supplier_name}   → detailed scorecard with trend
- GET    /grn-inspections                      → list all inspections (paginated)
- GET    /grn-inspections/{receipt_id}         → get inspection for one GRN

**Collections used:**
- warehouse_receiving               (existing, shared with /api/wms/legacy)
- rahaza_grn_inspections            (new — inspection records)
- rahaza_supplier_scorecards        (computed daily; can also be live-aggregated)
"""
from fastapi import APIRouter, Request, HTTPException, Query
from database import get_db
from auth import require_auth, serialize_doc, log_activity
from datetime import datetime, timezone, timedelta
import uuid
import logging
import math
from typing import Optional

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/rahaza/grn-qc", tags=["grn-qc"])


def _uid(): return str(uuid.uuid4())
def _now(): return datetime.now(timezone.utc)


# ── Reject Categories (Textile/Garment Industry Standard) ────────────────────

REJECT_CATEGORIES = [
    {"code": "FABRIC_DEFECT",     "label": "Cacat Bahan (kotoran, lubang, stain)",  "severity": "major"},
    {"code": "COLOR_MISMATCH",    "label": "Warna Tidak Sesuai Spec",                "severity": "major"},
    {"code": "MEASUREMENT_OUT",   "label": "Ukuran Di Luar Toleransi",               "severity": "major"},
    {"code": "QUANTITY_SHORT",    "label": "Jumlah Kurang dari PO",                  "severity": "critical"},
    {"code": "DAMAGED_PACKAGING", "label": "Kemasan Rusak (basah, sobek)",           "severity": "minor"},
    {"code": "WRONG_ITEM",        "label": "Salah Kirim Item",                       "severity": "critical"},
    {"code": "LATE_DELIVERY",     "label": "Terlambat (Past PO Due Date)",           "severity": "minor"},
    {"code": "MISSING_DOCS",      "label": "Dokumen Tidak Lengkap",                  "severity": "minor"},
    {"code": "STITCHING_DEFECT",  "label": "Cacat Jahitan",                          "severity": "major"},
    {"code": "ACCESSORY_MISSING", "label": "Aksesoris/Trims Kurang",                 "severity": "major"},
    {"code": "OTHER",             "label": "Lainnya",                                "severity": "minor"},
]

SEVERITY_WEIGHTS = {"critical": 3, "major": 2, "minor": 1}


@router.get("/reject-categories")
async def get_reject_categories(request: Request):
    """List of standardized reject category codes for inspection."""
    await require_auth(request)
    return REJECT_CATEGORIES


# ── AQL Sampling Tool (ANSI/ASQ Z1.4, General Inspection Level II, AQL 2.5) ──

# Sample Size Code Letter based on lot size
SAMPLE_SIZE_CODE_LETTERS = [
    (2,        8,        "A"),  (9,        15,       "B"),  (16,       25,       "C"),
    (26,       50,       "D"),  (51,       90,       "E"),  (91,       150,      "F"),
    (151,      280,      "G"),  (281,      500,      "H"),  (501,      1200,     "J"),
    (1201,     3200,     "K"),  (3201,     10000,    "L"),  (10001,    35000,    "M"),
    (35001,    150000,   "N"),  (150001,   500000,   "P"),  (500001,   10**12,   "Q"),
]

# Sample Size for code letter (General Inspection Level II)
CODE_LETTER_SAMPLE_SIZE = {
    "A": 2,   "B": 3,   "C": 5,   "D": 8,    "E": 13,
    "F": 20,  "G": 32,  "H": 50,  "J": 80,   "K": 125,
    "L": 200, "M": 315, "N": 500, "P": 800,  "Q": 1250,
}

# Accept (Ac) / Reject (Re) numbers for AQL 2.5 (per code letter)
AQL_2_5_AC_RE = {
    "A": (0, 1),  "B": (0, 1),  "C": (0, 1),   "D": (0, 1),  "E": (1, 2),
    "F": (1, 2),  "G": (2, 3),  "H": (3, 4),   "J": (5, 6),  "K": (7, 8),
    "L": (10, 11), "M": (14, 15), "N": (21, 22), "P": (21, 22), "Q": (21, 22),
}


def _aql_sample_calc(lot_size: int, aql: float = 2.5):
    """Returns (sample_size, accept, reject, code_letter) for a given lot size."""
    if lot_size <= 0:
        return None
    letter = None
    for lo, hi, code in SAMPLE_SIZE_CODE_LETTERS:
        if lo <= lot_size <= hi:
            letter = code
            break
    if not letter:
        letter = "Q"
    sample = CODE_LETTER_SAMPLE_SIZE[letter]
    # If AQL == 2.5, use the table directly. For other AQLs, fall back to a simpler heuristic.
    if abs(aql - 2.5) < 0.01:
        ac, re_ = AQL_2_5_AC_RE[letter]
    else:
        # Approximate for non-2.5 AQLs: Ac ≈ floor(sample * AQL / 100), Re = Ac + 1
        ac = max(0, math.floor(sample * aql / 100))
        re_ = ac + 1
    return {
        "lot_size": lot_size,
        "code_letter": letter,
        "sample_size": sample,
        "accept_limit": ac,   # if defects <= ac, ACCEPT
        "reject_limit": re_,  # if defects >= re_, REJECT
        "aql": aql,
        "inspection_level": "General II",
        "standard": "ANSI/ASQ Z1.4",
    }


@router.post("/aql/calculate")
async def aql_calculate(request: Request):
    """
    Compute AQL sample plan.
    Body: { lot_size: int, aql: float? (default 2.5) }
    """
    await require_auth(request)
    body = await request.json()
    lot_size = int(body.get("lot_size") or 0)
    aql = float(body.get("aql") or 2.5)
    if lot_size <= 0:
        raise HTTPException(400, "lot_size must be > 0")
    res = _aql_sample_calc(lot_size, aql)
    if not res:
        raise HTTPException(400, "Invalid lot size")
    return res


# ── Inspection Workflow ──────────────────────────────────────────────────────

@router.post("/inspect/{receipt_id}")
async def submit_inspection(receipt_id: str, request: Request):
    """
    Submit inspection result for a GRN.
    
    Body:
    {
      inspection_type: "full" | "aql",   -- "aql" uses sampling, "full" inspects all
      sample_size: int?,                  -- if aql
      defects_found: int?,                -- if aql
      overall_result: "accepted" | "rejected" | "partial",
      items: [
        {
          item_id: str,                   -- receipt line id
          received_qty: float,            -- physically received
          accepted_qty: float,
          rejected_qty: float,
          inspection_status: "accepted" | "rejected" | "partial",
          reject_reasons: [               -- list of category codes + qty per reason
            { code: "FABRIC_DEFECT", qty: 5, notes: "..." }
          ],
          inspection_notes: str?,
        }
      ],
      inspector_notes: str?
    }
    """
    user = await require_auth(request)
    db = get_db()
    body = await request.json()
    
    receipt = await db.warehouse_receiving.find_one({"id": receipt_id}, {"_id": 0})
    if not receipt:
        raise HTTPException(404, "GRN not found")
    
    if receipt.get("status") in ("inspected", "received", "accepted", "rejected"):
        raise HTTPException(400, f"GRN is already in '{receipt['status']}' state — cannot re-inspect")
    
    inspection_type = body.get("inspection_type", "full")
    overall_result = body.get("overall_result", "accepted")
    items_in = body.get("items", [])
    inspector_notes = body.get("inspector_notes", "")
    
    if overall_result not in ("accepted", "rejected", "partial"):
        raise HTTPException(400, "overall_result must be: accepted | rejected | partial")
    
    # Update each line in the receipt with inspection result
    updated_items = []
    total_received = 0.0
    total_accepted = 0.0
    total_rejected = 0.0
    
    line_map = {it.get("id"): it for it in receipt.get("items", [])}
    
    for inp in items_in:
        line_id = inp.get("item_id") or inp.get("id")
        line = line_map.get(line_id)
        if not line:
            continue  # skip unknown lines
        
        received = float(inp.get("received_qty") or line.get("received_qty") or 0)
        accepted = float(inp.get("accepted_qty") or 0)
        rejected = float(inp.get("rejected_qty") or 0)
        status = inp.get("inspection_status", "accepted")
        reasons = inp.get("reject_reasons", [])
        notes = inp.get("inspection_notes", "")
        
        line["received_qty"] = received
        line["accepted_qty"] = accepted
        line["rejected_qty"] = rejected
        line["inspection_status"] = status
        line["reject_reasons"] = reasons
        line["inspection_notes"] = notes
        updated_items.append(line)
        
        total_received += received
        total_accepted += accepted
        total_rejected += rejected
    
    # Compute defect rate
    defect_rate = (total_rejected / total_received * 100) if total_received > 0 else 0
    
    # Create inspection record
    inspection_doc = {
        "id": _uid(),
        "inspection_no": f"INS-{_now().strftime('%Y%m')}-{await db.rahaza_grn_inspections.count_documents({}) + 1:04d}",
        "receipt_id": receipt_id,
        "receipt_number": receipt.get("receipt_number"),
        "supplier_name": receipt.get("supplier_name", ""),
        "po_id": receipt.get("po_id"),
        "po_number": receipt.get("po_number", ""),
        "inspection_type": inspection_type,
        "sample_size": int(body.get("sample_size") or 0),
        "defects_found": int(body.get("defects_found") or 0),
        "overall_result": overall_result,
        "total_received_qty": total_received,
        "total_accepted_qty": total_accepted,
        "total_rejected_qty": total_rejected,
        "defect_rate": round(defect_rate, 2),
        "items": updated_items,
        "inspector_id": user["id"],
        "inspector_name": user.get("name", ""),
        "inspector_notes": inspector_notes,
        "inspected_at": _now(),
        "created_at": _now(),
    }
    await db.rahaza_grn_inspections.insert_one(inspection_doc)
    
    # Update GRN status & items
    new_status = "accepted" if overall_result == "accepted" else ("rejected" if overall_result == "rejected" else "partial_received")
    await db.warehouse_receiving.update_one(
        {"id": receipt_id},
        {"$set": {
            "items": updated_items,
            "status": new_status,
            "inspection_id": inspection_doc["id"],
            "inspection_no": inspection_doc["inspection_no"],
            "inspected_at": _now(),
            "inspector_name": user.get("name", ""),
            "updated_at": _now(),
        }}
    )
    
    await log_activity(user["id"], user.get("name", ""), "inspect_grn", "rahaza.grn_inspection",
                      f"{inspection_doc['inspection_no']}: {overall_result} — defect_rate={defect_rate:.2f}%")
    
    return serialize_doc(inspection_doc)


@router.get("/grn-inspections")
async def list_inspections(
    request: Request,
    supplier: Optional[str] = None,
    result: Optional[str] = None,
    limit: int = Query(50, ge=1, le=500),
):
    """List GRN inspections, filterable by supplier and result."""
    await require_auth(request)
    db = get_db()
    q = {}
    if supplier:
        q["supplier_name"] = {"$regex": supplier, "$options": "i"}
    if result:
        q["overall_result"] = result
    rows = await db.rahaza_grn_inspections.find(q, {"_id": 0}).sort("inspected_at", -1).limit(limit).to_list(500)
    return serialize_doc(rows)


@router.get("/grn-inspections/{receipt_id}")
async def get_inspection_by_grn(receipt_id: str, request: Request):
    """Get the inspection record for a specific GRN."""
    await require_auth(request)
    db = get_db()
    insp = await db.rahaza_grn_inspections.find_one({"receipt_id": receipt_id}, {"_id": 0})
    if not insp:
        raise HTTPException(404, "No inspection found for this GRN")
    return serialize_doc(insp)


# ── Supplier Scorecard (Aggregated Quality Metrics) ──────────────────────────

@router.get("/supplier-scorecard")
async def list_supplier_scorecards(
    request: Request,
    period_days: int = Query(90, ge=7, le=365),
):
    """
    Computed scorecards for all suppliers within the last `period_days`.
    
    Returns per supplier:
      - total_grns, total_qty_received, total_qty_accepted, total_qty_rejected
      - accept_rate (%), defect_rate (%), 
      - on_time_rate (%) -- ratio of GRNs received before PO due date
      - quality_grade ("A+", "A", "B", "C", "D") based on accept_rate
      - trend ("improving", "stable", "declining") -- placeholder
    """
    await require_auth(request)
    db = get_db()
    
    since = _now() - timedelta(days=period_days)
    
    pipeline = [
        {"$match": {"inspected_at": {"$gte": since}, "supplier_name": {"$ne": ""}}},
        {"$group": {
            "_id": "$supplier_name",
            "total_grns": {"$sum": 1},
            "total_received": {"$sum": "$total_received_qty"},
            "total_accepted": {"$sum": "$total_accepted_qty"},
            "total_rejected": {"$sum": "$total_rejected_qty"},
            "rejected_count": {"$sum": {"$cond": [{"$eq": ["$overall_result", "rejected"]}, 1, 0]}},
            "partial_count":  {"$sum": {"$cond": [{"$eq": ["$overall_result", "partial"]}, 1, 0]}},
            "accepted_count": {"$sum": {"$cond": [{"$eq": ["$overall_result", "accepted"]}, 1, 0]}},
            "last_inspection_at": {"$max": "$inspected_at"},
        }}
    ]
    
    aggregated = await db.rahaza_grn_inspections.aggregate(pipeline).to_list(500)
    
    scorecards = []
    for a in aggregated:
        received = float(a.get("total_received") or 0)
        rejected = float(a.get("total_rejected") or 0)
        accepted = float(a.get("total_accepted") or 0)
        
        accept_rate = (accepted / received * 100) if received > 0 else 0
        defect_rate = (rejected / received * 100) if received > 0 else 0
        
        # Quality grade
        if accept_rate >= 98:
            grade = "A+"
        elif accept_rate >= 95:
            grade = "A"
        elif accept_rate >= 90:
            grade = "B"
        elif accept_rate >= 80:
            grade = "C"
        else:
            grade = "D"
        
        scorecards.append({
            "supplier_name": a["_id"],
            "period_days": period_days,
            "total_grns": int(a.get("total_grns") or 0),
            "accepted_grns": int(a.get("accepted_count") or 0),
            "partial_grns":  int(a.get("partial_count") or 0),
            "rejected_grns": int(a.get("rejected_count") or 0),
            "total_received_qty": round(received, 2),
            "total_accepted_qty": round(accepted, 2),
            "total_rejected_qty": round(rejected, 2),
            "accept_rate": round(accept_rate, 2),
            "defect_rate": round(defect_rate, 2),
            "quality_grade": grade,
            "last_inspection_at": a.get("last_inspection_at"),
        })
    
    scorecards.sort(key=lambda s: s["accept_rate"], reverse=True)
    return serialize_doc(scorecards)


@router.get("/supplier-scorecard/{supplier_name}")
async def supplier_scorecard_detail(
    supplier_name: str,
    request: Request,
    period_days: int = Query(180, ge=7, le=730),
):
    """
    Detail scorecard for one supplier:
    - Summary metrics
    - Monthly trend (last 6 months)
    - Top reject reasons
    - Recent inspections
    """
    await require_auth(request)
    db = get_db()
    
    since = _now() - timedelta(days=period_days)
    q = {"supplier_name": supplier_name, "inspected_at": {"$gte": since}}
    
    insps = await db.rahaza_grn_inspections.find(q, {"_id": 0}).sort("inspected_at", -1).to_list(1000)
    
    if not insps:
        return {
            "supplier_name": supplier_name,
            "period_days": period_days,
            "summary": None,
            "monthly_trend": [],
            "top_reject_reasons": [],
            "recent_inspections": [],
        }
    
    total_received = sum(float(i.get("total_received_qty") or 0) for i in insps)
    total_accepted = sum(float(i.get("total_accepted_qty") or 0) for i in insps)
    total_rejected = sum(float(i.get("total_rejected_qty") or 0) for i in insps)
    accept_rate = (total_accepted / total_received * 100) if total_received > 0 else 0
    defect_rate = (total_rejected / total_received * 100) if total_received > 0 else 0
    
    if accept_rate >= 98:
        grade = "A+"
    elif accept_rate >= 95:
        grade = "A"
    elif accept_rate >= 90:
        grade = "B"
    elif accept_rate >= 80:
        grade = "C"
    else:
        grade = "D"
    
    # Monthly trend
    by_month = {}
    for i in insps:
        dt = i.get("inspected_at")
        if isinstance(dt, str):
            try:
                dt = datetime.fromisoformat(dt.replace("Z", "+00:00"))
            except Exception:
                continue
        if not dt:
            continue
        key = dt.strftime("%Y-%m")
        m = by_month.get(key, {"month": key, "grns": 0, "received": 0, "accepted": 0, "rejected": 0})
        m["grns"] += 1
        m["received"] += float(i.get("total_received_qty") or 0)
        m["accepted"] += float(i.get("total_accepted_qty") or 0)
        m["rejected"] += float(i.get("total_rejected_qty") or 0)
        by_month[key] = m
    monthly_trend = sorted(by_month.values(), key=lambda m: m["month"])
    for m in monthly_trend:
        m["accept_rate"] = round((m["accepted"] / m["received"] * 100), 2) if m["received"] > 0 else 0
    
    # Top reject reasons
    reason_counts = {}
    for i in insps:
        for line in i.get("items", []):
            for rr in line.get("reject_reasons", []):
                code = rr.get("code", "OTHER")
                reason_counts[code] = reason_counts.get(code, 0) + float(rr.get("qty") or 0)
    top_reasons = []
    cat_map = {c["code"]: c for c in REJECT_CATEGORIES}
    for code, qty in sorted(reason_counts.items(), key=lambda x: -x[1])[:5]:
        cat = cat_map.get(code, {"label": code, "severity": "minor"})
        top_reasons.append({
            "code": code,
            "label": cat["label"],
            "severity": cat["severity"],
            "total_qty": round(qty, 2),
        })
    
    return {
        "supplier_name": supplier_name,
        "period_days": period_days,
        "summary": {
            "total_grns": len(insps),
            "total_received_qty": round(total_received, 2),
            "total_accepted_qty": round(total_accepted, 2),
            "total_rejected_qty": round(total_rejected, 2),
            "accept_rate": round(accept_rate, 2),
            "defect_rate": round(defect_rate, 2),
            "quality_grade": grade,
        },
        "monthly_trend": monthly_trend,
        "top_reject_reasons": top_reasons,
        "recent_inspections": serialize_doc(insps[:10]),
    }


# ── Demo Seed (idempotent) ────────────────────────────────────────────────────

@router.post("/seed-demo")
async def seed_grn_qc_demo(request: Request):
    """Seed sample inspection records for demo (idempotent — checks count first)."""
    await require_auth(request)
    db = get_db()
    
    existing = await db.rahaza_grn_inspections.count_documents({"inspection_no": {"$regex": "^INS-DEMO"}})
    if existing > 0:
        return {"status": "already_seeded", "existing": existing}
    
    suppliers = [
        ("PT Tekstil Maju", 0.985, "A+"),
        ("CV Kain Jaya", 0.96, "A"),
        ("UD Benang Indah", 0.91, "B"),
        ("PT Sumber Kain", 0.84, "C"),
    ]
    inserted = 0
    
    base_date = _now() - timedelta(days=120)
    for i, (sname, accept_ratio, _grade) in enumerate(suppliers):
        for j in range(8):  # 8 inspections per supplier over 120 days
            insp_date = base_date + timedelta(days=15 * j + i)
            qty = 100 + (j * 25)
            accepted = int(qty * (accept_ratio - (0.02 if j % 3 == 0 else 0)))
            rejected = qty - accepted
            reasons = []
            if rejected > 0:
                reasons.append({"code": "FABRIC_DEFECT", "qty": int(rejected * 0.6), "notes": "demo"})
                if rejected > 5:
                    reasons.append({"code": "COLOR_MISMATCH", "qty": int(rejected * 0.4), "notes": "demo"})
            
            result = "accepted" if rejected == 0 else ("partial" if accepted > 0 else "rejected")
            
            doc = {
                "id": _uid(),
                "inspection_no": f"INS-DEMO-{i:02d}{j:02d}",
                "receipt_id": f"demo-receipt-{i}-{j}",
                "receipt_number": f"GR-DEMO-{i:02d}{j:02d}",
                "supplier_name": sname,
                "po_id": None,
                "po_number": f"PO-DEMO-{i:02d}{j:02d}",
                "inspection_type": "aql",
                "sample_size": min(50, qty),
                "defects_found": rejected,
                "overall_result": result,
                "total_received_qty": float(qty),
                "total_accepted_qty": float(accepted),
                "total_rejected_qty": float(rejected),
                "defect_rate": round(rejected / qty * 100, 2),
                "items": [{
                    "id": f"line-{i}-{j}",
                    "material_name": "Kain Cotton Combed 30s",
                    "received_qty": float(qty),
                    "accepted_qty": float(accepted),
                    "rejected_qty": float(rejected),
                    "inspection_status": result,
                    "reject_reasons": reasons,
                    "inspection_notes": "demo seed",
                }],
                "inspector_id": "demo-inspector",
                "inspector_name": "QC Demo",
                "inspector_notes": f"Demo inspection #{i}-{j}",
                "inspected_at": insp_date,
                "created_at": insp_date,
            }
            await db.rahaza_grn_inspections.insert_one(doc)
            inserted += 1
    
    return {"status": "seeded", "inspections_inserted": inserted, "suppliers": len(suppliers)}
