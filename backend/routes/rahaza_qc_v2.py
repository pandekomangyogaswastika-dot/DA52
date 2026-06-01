"""
PT Rahaza — Phase 21A/B/C: Defect Codes + QC v2 + Pareto + FPY

Endpoints (prefix /api/rahaza):
  Defect Codes:
    GET  /defect-codes              — list aktif
    POST /defect-codes              — create
    PUT  /defect-codes/{id}         — update
    DELETE /defect-codes/{id}       — deactivate
    POST /defect-codes/seed         — seed 20 kode cacat standar

  QC Events v2:
    POST /qc-events                 — tambah QC event (field defect_code_ids[])
    GET  /qc-events?bundle_id=&from=&to=&line_id=

  Analytics:
    GET  /qc/pareto?from=&to=&line_id=&employee_id=&model_id=  — Pareto top defects
    GET  /qc/fpy?from=&to=&line_id=&model_id=                  — FPY per group
    GET  /qc/summary?from=&to=                                  — QC summary stats
"""
from fastapi import APIRouter, Request, HTTPException, Query
from database import get_db
from auth import require_auth, serialize_doc
from datetime import datetime, timezone, date, timedelta
from typing import Optional
import uuid
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/rahaza", tags=["rahaza-qc-v2"])


def _uid() -> str:
    return str(uuid.uuid4())


def _now():
    return datetime.now(timezone.utc)


DEFAULT_DEFECT_CODES = [
    {"code": "DC-001", "name": "Lubang (Hole)",          "category": "Struktur Rajut",  "severity": "major"},
    {"code": "DC-002", "name": "Benang Putus",            "category": "Struktur Rajut",  "severity": "major"},
    {"code": "DC-003", "name": "Rajutan Kendur",          "category": "Struktur Rajut",  "severity": "minor"},
    {"code": "DC-004", "name": "Rajutan Ketat",           "category": "Struktur Rajut",  "severity": "minor"},
    {"code": "DC-005", "name": "Drop Stitch",             "category": "Struktur Rajut",  "severity": "major"},
    {"code": "DC-006", "name": "Warna Salah",             "category": "Warna & Tampilan","severity": "major"},
    {"code": "DC-007", "name": "Bercak / Noda",           "category": "Warna & Tampilan","severity": "major"},
    {"code": "DC-008", "name": "Fading (Pudar)",          "category": "Warna & Tampilan","severity": "minor"},
    {"code": "DC-009", "name": "Jahitan Loncat",          "category": "Jahit & Linking", "severity": "major"},
    {"code": "DC-010", "name": "Linking Tidak Rata",      "category": "Jahit & Linking", "severity": "minor"},
    {"code": "DC-011", "name": "Benang Keluar",           "category": "Jahit & Linking", "severity": "minor"},
    {"code": "DC-012", "name": "Ukuran Di Luar Spec",     "category": "Dimensi & Ukuran","severity": "major"},
    {"code": "DC-013", "name": "Bahu Tidak Simetris",     "category": "Dimensi & Ukuran","severity": "minor"},
    {"code": "DC-014", "name": "Panjang Lengan Beda",     "category": "Dimensi & Ukuran","severity": "minor"},
    {"code": "DC-015", "name": "Kontaminasi Asing",       "category": "Kebersihan",       "severity": "critical"},
    {"code": "DC-016", "name": "Noda Oli / Mesin",        "category": "Kebersihan",       "severity": "major"},
    {"code": "DC-017", "name": "Label Salah",             "category": "Label & Packing",  "severity": "major"},
    {"code": "DC-018", "name": "Kemasan Rusak",           "category": "Label & Packing",  "severity": "minor"},
    {"code": "DC-019", "name": "Kancing Kurang / Lepas",  "category": "Aksesori",         "severity": "major"},
    {"code": "DC-020", "name": "Resleting Macet",         "category": "Aksesori",         "severity": "major"},
]


# ─── DEFECT CODES ──────────────────────────────────────────────────────────
@router.post("/defect-codes/seed")
async def seed_defect_codes(request: Request):
    await require_auth(request)
    db = get_db()
    created = 0
    codes = [dc["code"] for dc in DEFAULT_DEFECT_CODES]
    existing_codes = set()
    if codes:
        async for d in db.rahaza_defect_codes.find(
            {"code": {"$in": codes}}, {"_id": 0, "code": 1}
        ):
            existing_codes.add(d["code"])
    for dc in DEFAULT_DEFECT_CODES:
        if dc["code"] not in existing_codes:
            await db.rahaza_defect_codes.insert_one({
                "id": _uid(), "code": dc["code"], "name": dc["name"],
                "category": dc["category"], "severity": dc["severity"],
                "active": True, "created_at": _now().isoformat(),
            })
            created += 1
    return {"ok": True, "created": created, "total": len(DEFAULT_DEFECT_CODES)}


@router.get("/defect-codes")
async def list_defect_codes(request: Request, active_only: bool = True):
    await require_auth(request)
    db = get_db()
    q = {"active": True} if active_only else {}
    rows = await db.rahaza_defect_codes.find(q, {"_id": 0}).sort("code", 1).to_list(500)
    return rows


@router.post("/defect-codes")
async def create_defect_code(request: Request):
    await require_auth(request)
    db = get_db()
    body = await request.json()
    code = (body.get("code") or "").strip().upper()
    name = (body.get("name") or "").strip()
    if not code or not name:
        raise HTTPException(400, "code & name wajib diisi.")
    if await db.rahaza_defect_codes.find_one({"code": code, "active": True}):
        raise HTTPException(409, f"Kode '{code}' sudah ada.")
    doc = {
        "id": _uid(), "code": code, "name": name,
        "category": body.get("category") or "Lainnya",
        "severity": body.get("severity") or "minor",
        "active": True, "created_at": _now().isoformat(),
    }
    await db.rahaza_defect_codes.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/defect-codes/{dc_id}")
async def update_defect_code(dc_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    body = await request.json()
    body.pop("_id", None)
    body.pop("id", None)
    body.pop("created_at", None)
    body["updated_at"] = _now().isoformat()
    res = await db.rahaza_defect_codes.update_one({"id": dc_id}, {"$set": body})
    if res.matched_count == 0:
        raise HTTPException(404, "Kode cacat tidak ditemukan.")
    return serialize_doc(await db.rahaza_defect_codes.find_one({"id": dc_id}, {"_id": 0}))


@router.delete("/defect-codes/{dc_id}")
async def delete_defect_code(dc_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    await db.rahaza_defect_codes.update_one({"id": dc_id}, {"$set": {"active": False}})
    return {"ok": True}


# ─── QC EVENTS V2 ──────────────────────────────────────────────────────────
@router.post("/qc-events")
async def create_qc_event(request: Request):
    user = await require_auth(request)
    db = get_db()
    body = await request.json()
    if not body.get("bundle_id"):
        raise HTTPException(400, "bundle_id wajib diisi.")
    doc = {
        "id": _uid(),
        "bundle_id": body.get("bundle_id"),
        "work_order_id": body.get("work_order_id"),
        "line_id": body.get("line_id"),
        "employee_id": body.get("employee_id") or user.get("id"),
        "model_id": body.get("model_id"),
        "shift_id": body.get("shift_id"),
        "checked_qty": body.get("checked_qty") or 0,
        "pass_qty": body.get("pass_qty") or 0,
        "fail_qty": body.get("fail_qty") or 0,
        "defect_code_ids": body.get("defect_code_ids") or [],  # NEW: list of defect code ids
        "defect_details": body.get("defect_details") or [],   # [{defect_code_id, qty, notes}]
        "notes": body.get("notes") or "",
        "verdict": body.get("verdict") or "pass",  # pass | fail
        "created_at": _now().isoformat(),
        "created_by": user.get("id"),
    }
    await db.rahaza_qc_events.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.get("/qc-events")
async def list_qc_events(
    request: Request,
    bundle_id: Optional[str] = None,
    line_id: Optional[str] = None,
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = None,
    limit: int = 100,
):
    await require_auth(request)
    db = get_db()
    q = {}
    if bundle_id:
        q["bundle_id"] = bundle_id
    if line_id:
        q["line_id"] = line_id
    if from_ or to:
        q["created_at"] = {}
        if from_:
            q["created_at"]["$gte"] = from_
        if to:
            q["created_at"]["$lte"] = to + "T23:59:59Z"
    rows = await db.rahaza_qc_events.find(q, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(500)
    return rows


# ─── PARETO ANALYSIS ──────────────────────────────────────────────────────
@router.get("/qc/pareto")
async def qc_pareto(
    request: Request,
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = None,
    line_id: Optional[str] = None,
    employee_id: Optional[str] = None,
    model_id: Optional[str] = None,
    shift_id: Optional[str] = None,
    top_n: int = 10,
):
    await require_auth(request)
    db = get_db()
    # Default: last 30 days
    if not from_:
        from_ = (date.today() - timedelta(days=30)).isoformat()
    if not to:
        to = date.today().isoformat()

    q = {"created_at": {"$gte": from_, "$lte": to + "T23:59:59Z"}}
    if line_id:
        q["line_id"] = line_id
    if employee_id:
        q["employee_id"] = employee_id
    if model_id:
        q["model_id"] = model_id
    if shift_id:
        q["shift_id"] = shift_id

    # P1.1: Query both rahaza_qc_events AND rahaza_wip_events (Phase 21 integration)
    events = await db.rahaza_qc_events.find(q, {"_id": 0}).to_list(500)
    
    # Also fetch from wip_events where event_type=qc_fail and defect_code_ids exists
    wip_q = {
        "timestamp": {"$gte": datetime.fromisoformat(from_), "$lte": datetime.fromisoformat(to + "T23:59:59Z")},
        "event_type": "qc_fail",
        "defect_code_ids": {"$exists": True, "$ne": []},
    }
    if line_id:
        wip_q["line_id"] = line_id
    if model_id:
        wip_q["model_id"] = model_id
    # Note: wip_events doesn't have employee_id or shift_id, so we skip those filters for wip
    
    wip_events = await db.rahaza_wip_events.find(wip_q, {"_id": 0}).to_list(500)

    # Count defects by code (from both qc_events and wip_events)
    defect_counts: dict = {}
    total_checked = 0
    total_fail = 0
    
    # Process rahaza_qc_events
    for ev in events:
        total_checked += ev.get("checked_qty", 0)
        total_fail += ev.get("fail_qty", 0)
        for dd in (ev.get("defect_details") or []):
            dc_id = dd.get("defect_code_id") or ""
            if dc_id:
                defect_counts[dc_id] = defect_counts.get(dc_id, 0) + (dd.get("qty") or 1)
        # Also count from defect_code_ids (simple list without qty)
        for dc_id in (ev.get("defect_code_ids") or []):
            if dc_id:
                defect_counts[dc_id] = defect_counts.get(dc_id, 0) + (ev.get("fail_qty") or 1)
    
    # Process rahaza_wip_events (P1.1: Phase 21 integration)
    for wip in wip_events:
        qty_fail = wip.get("qty", 0)
        total_fail += qty_fail
        # Distribute qty_fail across all defect_code_ids evenly (or assume 1 per defect)
        dc_ids = wip.get("defect_code_ids") or []
        if dc_ids and qty_fail > 0:
            qty_per_defect = max(1, qty_fail // len(dc_ids))
            for dc_id in dc_ids:
                if dc_id:
                    defect_counts[dc_id] = defect_counts.get(dc_id, 0) + qty_per_defect

    # Enrich with defect code info
    if defect_counts:
        dc_ids = list(defect_counts.keys())
        dc_docs = await db.rahaza_defect_codes.find({"id": {"$in": dc_ids}}, {"_id": 0}).to_list(500)
        dc_map = {d["id"]: d for d in dc_docs}
    else:
        dc_map = {}

    sorted_defects = sorted(defect_counts.items(), key=lambda x: x[1], reverse=True)[:top_n]
    total_defects = sum(defect_counts.values()) or 1
    cumulative = 0
    pareto = []
    for dc_id, count in sorted_defects:
        dc_info = dc_map.get(dc_id, {})
        cumulative += count
        pareto.append({
            "defect_code_id": dc_id,
            "code": dc_info.get("code", dc_id),
            "name": dc_info.get("name", dc_id),
            "category": dc_info.get("category", ""),
            "severity": dc_info.get("severity", "minor"),
            "count": count,
            "percentage": round(count / total_defects * 100, 1),
            "cumulative_pct": round(cumulative / total_defects * 100, 1),
        })

    return {
        "from": from_, "to": to,
        "total_events": len(events),
        "total_checked": total_checked,
        "total_fail": total_fail,
        "fail_rate_pct": round(total_fail / max(total_checked, 1) * 100, 1),
        "pareto": pareto,
        "others_count": sum(v for k, v in defect_counts.items() if k not in dict(sorted_defects[:top_n])),
    }


# ─── FPY DASHBOARD ───────────────────────────────────────────────────────
@router.get("/qc/fpy")
async def qc_fpy(
    request: Request,
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = None,
    line_id: Optional[str] = None,
    model_id: Optional[str] = None,
    group_by: str = "line",  # line | model | employee | shift
):
    await require_auth(request)
    db = get_db()
    if not from_:
        from_ = (date.today() - timedelta(days=30)).isoformat()
    if not to:
        to = date.today().isoformat()

    q = {"created_at": {"$gte": from_, "$lte": to + "T23:59:59Z"}}
    if line_id:
        q["line_id"] = line_id
    if model_id:
        q["model_id"] = model_id

    events = await db.rahaza_qc_events.find(q, {"_id": 0}).to_list(500)

    # Aggregate by group_by field
    groups: dict = {}
    for ev in events:
        key = ev.get(f"{group_by}_id") or "unknown"
        if key not in groups:
            groups[key] = {"checked": 0, "pass": 0, "fail": 0}
        groups[key]["checked"] += ev.get("checked_qty", 0)
        groups[key]["pass"]    += ev.get("pass_qty", 0)
        groups[key]["fail"]    += ev.get("fail_qty", 0)

    # Enrich names
    col_map = {"line": "rahaza_lines", "model": "rahaza_models", "employee": "rahaza_employees", "shift": "rahaza_shifts"}
    col = col_map.get(group_by)
    name_map = {}
    if col and groups:
        docs = await db[col].find({"id": {"$in": list(groups.keys())}}, {"_id": 0}).to_list(500)
        for d in docs:
            name_map[d["id"]] = d.get("name") or d.get("employee_code") or d.get("code", "")

    result = []
    for key, g in sorted(groups.items(), key=lambda x: x[1]["checked"], reverse=True):
        checked = g["checked"]
        pass_q = g["pass"]
        fpy = round(pass_q / checked * 100, 1) if checked else 0
        result.append({
            "group_id": key,
            "group_name": name_map.get(key, key),
            "group_by": group_by,
            "checked_qty": checked,
            "pass_qty": pass_q,
            "fail_qty": g["fail"],
            "fpy_pct": fpy,
            "target_fpy_pct": 95.0,  # default target
            "status": "good" if fpy >= 95 else ("warning" if fpy >= 85 else "critical"),
        })
    return {
        "from": from_, "to": to,
        "group_by": group_by,
        "total_groups": len(result),
        "overall_fpy_pct": round(
            sum(r["pass_qty"] for r in result) / max(sum(r["checked_qty"] for r in result), 1) * 100, 1
        ),
        "data": result,
    }


@router.get("/qc/summary")
async def qc_summary(
    request: Request,
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = None,
):
    await require_auth(request)
    db = get_db()
    if not from_:
        from_ = date.today().isoformat()
    if not to:
        to = date.today().isoformat()
    q = {"created_at": {"$gte": from_, "$lte": to + "T23:59:59Z"}}
    events = await db.rahaza_qc_events.find(q, {"_id": 0}).to_list(500)
    total_checked = sum(e.get("checked_qty", 0) for e in events)
    total_pass    = sum(e.get("pass_qty", 0) for e in events)
    total_fail    = sum(e.get("fail_qty", 0) for e in events)
    return {
        "from": from_, "to": to,
        "total_events": len(events),
        "total_checked": total_checked,
        "total_pass": total_pass,
        "total_fail": total_fail,
        "fpy_pct": round(total_pass / max(total_checked, 1) * 100, 1),
        "fail_rate_pct": round(total_fail / max(total_checked, 1) * 100, 1),
    }
