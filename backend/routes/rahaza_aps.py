"""
PT Rahaza — Advanced Planning & Scheduling (Phase 19A)

Read/aggregate endpoints for the APS Gantt view + lightweight reschedule.

Endpoints (prefix /api/rahaza):
  - GET  /aps/gantt?from=YYYY-MM-DD&to=YYYY-MM-DD&process_id=&line_id=&status=&priority=&model_id=
      Returns: { meta, kpis, lines[], days[], work_orders[], bars[], capacity[] }
      Phase 19A pemetaan line → WO (MVP) memakai heuristik:
        - Jika line_assignments punya entry dengan work_order_id di rentang → assign bar ke line tsb.
        - Jika tidak ada assignment, fallback: pilih line pertama dengan process_id cocok
          (line.process_id == last process of workflow) dan status aktif.
        - Jika tidak ada line match, masukkan ke virtual 'unassigned' row di frontend.

  - GET  /aps/wo/{wo_id}
      Detail untuk side panel (enrich progress + breakdown).

  - PATCH /aps/wo/{wo_id}/reschedule
      Body: { target_start_date: 'YYYY-MM-DD', target_end_date: 'YYYY-MM-DD' }
      Update kedua kolom di rahaza_work_orders (draft/released/in_production).

Semua operasi non-destructive terhadap eksekusi (tidak menulis line_assignments
atau wip_events). Commit ke assignment akan ditangani di Phase 19B.
"""
from fastapi import APIRouter, Request, HTTPException, Query
from database import get_db
from auth import require_auth, serialize_doc
from routes.rahaza_audit import log_audit
from datetime import datetime, timezone, date, timedelta
from typing import Optional

router = APIRouter(prefix="/api/rahaza", tags=["rahaza-aps"])


def _now():
    return datetime.now(timezone.utc)


def _parse_date(s: Optional[str], default: Optional[date] = None) -> date:
    if not s:
        return default or date.today()
    try:
        return date.fromisoformat(s)
    except Exception:
        raise HTTPException(400, f"Tanggal tidak valid: {s} (harus YYYY-MM-DD)")


def _d_iter(start: date, end: date):
    d = start
    while d <= end:
        yield d
        d = d + timedelta(days=1)


async def _require_planner(request: Request):
    """Planner = admin/manager/supervisor untuk aksi reschedule."""
    user = await require_auth(request)
    role = (user.get("role") or "").lower()
    if role in ("superadmin", "admin", "owner", "manager", "supervisor"):
        return user
    perms = user.get("_permissions") or []
    if "*" in perms or "wo.manage" in perms or "production.manage" in perms:
        return user
    raise HTTPException(403, "Forbidden: butuh permission Planning/Work Order.")


# ─── Helpers ─────────────────────────────────────────────────────────────────
def _risk_of(wo: dict, today: date) -> str:
    """Compute risk from WO (already has progress_pct & target_end_date)."""
    end = wo.get("target_end_date")
    try:
        end_d = date.fromisoformat(end) if isinstance(end, str) else end
    except Exception:
        end_d = None
    progress = float(wo.get("progress_pct") or 0)
    status = (wo.get("status") or "").lower()

    if status == "completed":
        return "on_track"
    if end_d and today > end_d and progress < 100:
        return "overdue"
    # rough "at_risk" heuristic: remaining progress velocity vs remaining days
    if end_d:
        remaining_days = (end_d - today).days
        if remaining_days < 0:
            return "overdue"
        if remaining_days == 0 and progress < 100:
            return "at_risk"
        if remaining_days > 0:
            # Rough heuristic: if > 70% of timeline elapsed but < 50% progress => at_risk
            try:
                start_d = date.fromisoformat(wo.get("target_start_date")) if wo.get("target_start_date") else None
            except Exception:
                start_d = None
            if start_d and end_d > start_d:
                total_days = (end_d - start_d).days
                elapsed = (today - start_d).days
                if total_days > 0 and elapsed > 0:
                    time_used_pct = max(0.0, min(1.0, elapsed / total_days)) * 100
                    if time_used_pct > 70 and progress < 50:
                        return "at_risk"
    return "on_track"


async def _compute_wo_progress_batch(db, wo_ids: list) -> dict:
    """Returns { wo_id: completed_qty } using last non-rework process."""
    if not wo_ids:
        return {}
    procs = await db.rahaza_processes.find(
        {"active": True, "is_rework": False}, {"_id": 0}
    ).sort("order_seq", 1).to_list(500)
    if not procs:
        return {}
    last_pid = procs[-1]["id"]
    pipe = [
        {"$match": {"event_type": "output", "work_order_id": {"$in": wo_ids}, "process_id": last_pid}},
        {"$group": {"_id": "$work_order_id", "total": {"$sum": "$qty"}}},
    ]
    rows = await db.rahaza_wip_events.aggregate(pipe).to_list(500)
    return {r["_id"]: int(r.get("total") or 0) for r in rows}


async def _resolve_line_map(db, wos: list) -> dict:
    """Map wo_id -> line_id.
    Priority:
      1) line_assignments.work_order_id (most recent active entry)
      2) First active line whose process_id == last_pid (fallback).
    """
    wo_ids = [w["id"] for w in wos]
    by_wo = {}
    if wo_ids:
        # Aggregate: pick the most-recent line_assignment per work_order_id (if any)
        pipe = [
            {"$match": {"work_order_id": {"$in": wo_ids}, "active": True}},
            {"$sort": {"assign_date": -1, "created_at": -1}},
            {"$group": {"_id": "$work_order_id", "line_id": {"$first": "$line_id"}}},
        ]
        rows = await db.rahaza_line_assignments.aggregate(pipe).to_list(500)
        by_wo = {r["_id"]: r.get("line_id") for r in rows if r.get("line_id")}
    # Fallback: map by final process
    procs = await db.rahaza_processes.find(
        {"active": True, "is_rework": False}, {"_id": 0}
    ).sort("order_seq", 1).to_list(500)
    last_pid = procs[-1]["id"] if procs else None
    fallback_line = None
    if last_pid:
        fb = await db.rahaza_lines.find_one(
            {"process_id": last_pid, "active": True}, {"_id": 0}
        )
        fallback_line = fb["id"] if fb else None
    for w in wos:
        if w["id"] not in by_wo and fallback_line:
            by_wo[w["id"]] = fallback_line
    return by_wo


# ─── GET /aps/gantt ──────────────────────────────────────────────────────────
@router.get("/aps/gantt")
async def gantt(
    request: Request,
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = None,
    process_id: Optional[str] = None,
    line_id: Optional[str] = None,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    model_id: Optional[str] = None,
):
    await require_auth(request)
    db = get_db()

    today = date.today()
    start_d = _parse_date(from_, today - timedelta(days=3))
    end_d = _parse_date(to, today + timedelta(days=21))
    if end_d < start_d:
        raise HTTPException(400, "Rentang tanggal tidak valid (to < from).")

    # ── Lines ────────────────────────────────────────────────────────────────
    q_line = {"active": True}
    if process_id:
        q_line["process_id"] = process_id
    if line_id:
        q_line["id"] = line_id
    lines = await db.rahaza_lines.find(q_line, {"_id": 0}).sort("code", 1).to_list(500)

    # Enrich lines with process + location name
    proc_ids = list({ln.get("process_id") for ln in lines if ln.get("process_id")})
    procs = await db.rahaza_processes.find({"id": {"$in": proc_ids}}, {"_id": 0}).to_list(500) if proc_ids else []
    proc_map = {p["id"]: p for p in procs}

    line_rows = []
    for ln in lines:
        pr = proc_map.get(ln.get("process_id"))
        line_rows.append({
            "id": ln["id"],
            "code": ln.get("code"),
            "name": ln.get("name"),
            "process_id": ln.get("process_id"),
            "process_code": pr.get("code") if pr else None,
            "process_name": pr.get("name") if pr else None,
            "capacity_per_hour": int(ln.get("capacity_per_hour") or 0),
            # Default shift hours (MVP: 8h); real calendar handled in 19B.
            "shift_hours_default": 8,
        })    # ── Work Orders in range ─────────────────────────────────────────────────
    q_wo = {}
    q_wo["status"] = status if status else {"$in": ["draft", "released", "in_production", "completed"]}
    if priority:
        q_wo["priority"] = priority
    if model_id:
        q_wo["model_id"] = model_id
    # Any WO whose window intersects [start_d, end_d]
    # target_start_date <= end_d AND target_end_date >= start_d
    q_wo["$or"] = [
        {
            "target_start_date": {"$lte": end_d.isoformat()},
            "target_end_date": {"$gte": start_d.isoformat()},
        },
        # Also include WO without target dates for visibility
        {"target_start_date": None},
        {"target_end_date": None},
    ]
    wos = await db.rahaza_work_orders.find(q_wo, {"_id": 0}).sort("created_at", -1).to_list(500)

    # Filter those lacking target dates from Gantt geometry but keep list for KPI
    # MVP: assign them a small 2-day dummy window starting today if missing.
    for w in wos:
        if not w.get("target_start_date"):
            w["target_start_date"] = today.isoformat()
            w["__synthetic_start__"] = True
        if not w.get("target_end_date"):
            try:
                s_d = date.fromisoformat(w["target_start_date"])
            except Exception:
                s_d = today
            w["target_end_date"] = (s_d + timedelta(days=2)).isoformat()
            w["__synthetic_end__"] = True

    # Compute progress for each WO
    wo_ids = [w["id"] for w in wos]
    completed_map = await _compute_wo_progress_batch(db, wo_ids)
    for w in wos:
        qty = int(w.get("qty") or 0)
        c = int(completed_map.get(w["id"], w.get("completed_qty") or 0))
        w["completed_qty"] = c
        w["progress_pct"] = round((c / qty) * 100, 1) if qty > 0 else 0

    # Enrich with model code/name
    mod_ids = list({w.get("model_id") for w in wos if w.get("model_id")})
    models = await db.rahaza_models.find({"id": {"$in": mod_ids}}, {"_id": 0}).to_list(500) if mod_ids else []
    mod_map = {m["id"]: m for m in models}
    for w in wos:
        m = mod_map.get(w.get("model_id"))
        w["model_code"] = m.get("code") if m else None
        w["model_name"] = m.get("name") if m else None

    # Resolve each WO → line_id (for Gantt rows)
    wo_line_map = await _resolve_line_map(db, wos)

    # ── Build bars ───────────────────────────────────────────────────────────
    bars = []
    for w in wos:
        lid = wo_line_map.get(w["id"])
        try:
            sd = date.fromisoformat(w["target_start_date"])
            ed = date.fromisoformat(w["target_end_date"])
        except Exception:
            continue
        # Clip to visible range for frontend positioning convenience
        vstart = max(sd, start_d)
        vend = min(ed, end_d)
        if vend < vstart:
            # Bar entirely outside range; skip drawing (but WO remains in list)
            continue
        risk = _risk_of(w, today)
        bars.append({
            "wo_id": w["id"],
            "wo_number": w.get("wo_number"),
            "line_id": lid,                # may be None (unassigned)
            "model_code": w.get("model_code"),
            "model_name": w.get("model_name"),
            "qty": int(w.get("qty") or 0),
            "completed_qty": int(w.get("completed_qty") or 0),
            "progress_pct": float(w.get("progress_pct") or 0),
            "status": w.get("status") or "draft",
            "priority": w.get("priority") or "normal",
            "start_date": sd.isoformat(),
            "end_date": ed.isoformat(),
            "visible_start": vstart.isoformat(),
            "visible_end": vend.isoformat(),
            "risk": risk,
            "is_synthetic_range": bool(w.get("__synthetic_start__") or w.get("__synthetic_end__")),
        })

    # ── Capacity heatmap ────────────────────────────────────────────────────
    # MVP: allocate qty linearly across bar span; sum per (line, day); compare to daily capacity.
    daily_capacity = {ln["id"]: int(ln.get("capacity_per_hour") or 0) * int(ln.get("shift_hours_default") or 8) for ln in line_rows}

    capacity_list = []
    load_by_line_day = {}  # key: (line_id, iso_date) -> qty

    for bar in bars:
        if not bar.get("line_id"):
            continue
        try:
            sd = date.fromisoformat(bar["start_date"])
            ed = date.fromisoformat(bar["end_date"])
        except Exception:
            continue
        span_days = (ed - sd).days + 1
        if span_days <= 0:
            continue
        per_day = float(bar["qty"] or 0) / span_days
        cur = max(sd, start_d)
        last = min(ed, end_d)
        while cur <= last:
            key = (bar["line_id"], cur.isoformat())
            load_by_line_day[key] = load_by_line_day.get(key, 0.0) + per_day
            cur = cur + timedelta(days=1)

    for (lid, dstr), load_qty in load_by_line_day.items():
        cap = max(1, daily_capacity.get(lid, 0))
        pct = round((load_qty / cap) * 100, 1)
        capacity_list.append({
            "line_id": lid,
            "date": dstr,
            "load_qty": round(load_qty, 2),
            "capacity_qty": cap,
            "load_pct": pct,
            "is_overload": pct > 110,
        })

    # ── Days axis ───────────────────────────────────────────────────────────
    days = [d.isoformat() for d in _d_iter(start_d, end_d)]

    # ── KPIs ────────────────────────────────────────────────────────────────
    total_wo = len(wos)
    overdue_count = sum(1 for b in bars if b["risk"] == "overdue")
    at_risk_count = sum(1 for b in bars if b["risk"] == "at_risk")
    if capacity_list:
        load_values = [c["load_pct"] for c in capacity_list]
        load_avg = round(sum(load_values) / len(load_values), 1)
    else:
        load_avg = 0.0

    kpis = {
        "total_wo": total_wo,
        "overdue_count": overdue_count,
        "at_risk_count": at_risk_count,
        "load_avg_pct": load_avg,
    }

    return serialize_doc({
        "meta": {
            "from": start_d.isoformat(),
            "to": end_d.isoformat(),
            "today": today.isoformat(),
            "filters": {
                "process_id": process_id,
                "line_id": line_id,
                "status": status,
                "priority": priority,
                "model_id": model_id,
            },
        },
        "days": days,
        "lines": line_rows,
        "work_orders": wos,
        "bars": bars,
        "capacity": capacity_list,
        "kpis": kpis,
        # Production Calendar integration — holidays in range for Gantt highlight
        "holidays": await _get_holidays_in_range(db, start_d, end_d),
    })


async def _get_holidays_in_range(db, start_d: date, end_d: date) -> list:
    """Fetch production calendar holidays within the given date range."""
    try:
        docs = await db.rahaza_production_calendar.find(
            {
                "type": "holiday",
                "date": {"$gte": start_d.isoformat(), "$lte": end_d.isoformat()},
            },
            {"_id": 0, "date": 1, "name": 1, "type": 1},
        ).to_list(500)
        return docs
    except Exception:
        return []


# ─── GET /aps/wo/{wo_id} ─────────────────────────────────────────────────────
@router.get("/aps/wo/{wo_id}")
async def wo_detail(wo_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    wo = await db.rahaza_work_orders.find_one({"id": wo_id}, {"_id": 0})
    if not wo:
        raise HTTPException(404, "Work Order tidak ditemukan.")

    # progress
    cmap = await _compute_wo_progress_batch(db, [wo_id])
    qty = int(wo.get("qty") or 0)
    c = int(cmap.get(wo_id, wo.get("completed_qty") or 0))
    wo["completed_qty"] = c
    wo["progress_pct"] = round((c / qty) * 100, 1) if qty > 0 else 0

    # per-process breakdown
    procs = await db.rahaza_processes.find(
        {"active": True}, {"_id": 0}
    ).sort("order_seq", 1).to_list(500)
    pipe = [
        {"$match": {"event_type": "output", "work_order_id": wo_id}},
        {"$group": {"_id": "$process_id", "total": {"$sum": "$qty"}}},
    ]
    rows = await db.rahaza_wip_events.aggregate(pipe).to_list(500)
    by_proc = {r["_id"]: int(r.get("total") or 0) for r in rows}
    breakdown = [
        {"process_id": p["id"], "process_code": p["code"], "process_name": p["name"],
         "order_seq": p["order_seq"], "total_output": by_proc.get(p["id"], 0),
         "is_rework": bool(p.get("is_rework"))}
        for p in procs
    ]

    # resolve line
    wo_line_map = await _resolve_line_map(db, [wo])
    line_id = wo_line_map.get(wo_id)
    line = None
    if line_id:
        line = await db.rahaza_lines.find_one({"id": line_id}, {"_id": 0})

    # model
    mod = None
    if wo.get("model_id"):
        mod = await db.rahaza_models.find_one({"id": wo["model_id"]}, {"_id": 0})

    risk = _risk_of(wo, date.today())

    return serialize_doc({
        "work_order": wo,
        "model": mod,
        "line": line,
        "progress_breakdown": breakdown,
        "risk": risk,
    })


# ─── PATCH /aps/wo/{wo_id}/reschedule ───────────────────────────────────────
@router.patch("/aps/wo/{wo_id}/reschedule")
async def reschedule_wo(wo_id: str, request: Request):
    user = await _require_planner(request)
    db = get_db()

    try:
        body = await request.json()
    except Exception:
        body = {}
    ts = (body or {}).get("target_start_date")
    te = (body or {}).get("target_end_date")
    if not ts or not te:
        raise HTTPException(400, "target_start_date & target_end_date wajib (YYYY-MM-DD).")
    try:
        sd = date.fromisoformat(ts)
        ed = date.fromisoformat(te)
    except Exception:
        raise HTTPException(400, "Tanggal tidak valid (format YYYY-MM-DD).")
    if ed < sd:
        raise HTTPException(400, "target_end_date tidak boleh sebelum target_start_date.")

    wo = await db.rahaza_work_orders.find_one({"id": wo_id}, {"_id": 0})
    if not wo:
        raise HTTPException(404, "Work Order tidak ditemukan.")
    if (wo.get("status") or "").lower() in ("cancelled",):
        raise HTTPException(400, "WO sudah cancelled, tidak bisa dijadwal ulang.")
    if (wo.get("status") or "").lower() in ("completed",):
        raise HTTPException(400, "WO sudah completed, tidak bisa dijadwal ulang.")

    await db.rahaza_work_orders.update_one(
        {"id": wo_id},
        {"$set": {
            "target_start_date": sd.isoformat(),
            "target_end_date": ed.isoformat(),
            "updated_at": _now(),
        }}
    )
    try:
        await log_audit(
            db,
            user=user,
            action="status_change",
            entity_type="rahaza_work_orders",
            entity_id=wo_id,
            before={"target_start_date": wo.get("target_start_date"), "target_end_date": wo.get("target_end_date")},
            after={"target_start_date": sd.isoformat(), "target_end_date": ed.isoformat()},
            request=request,
        )
    except Exception:
        pass
    updated = await db.rahaza_work_orders.find_one({"id": wo_id}, {"_id": 0})
    return serialize_doc({"ok": True, "work_order": updated})
