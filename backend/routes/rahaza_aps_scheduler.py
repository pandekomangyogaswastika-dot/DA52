"""
PT Rahaza — APS Phase 19B: Auto-Scheduling

Adds endpoints (prefix /api/rahaza) for:

  SMV (Standard Minute Value) — derived + admin override
    - GET    /aps/smv?model_id=&process_id=&size_id=
    - POST   /aps/smv/recompute
    - PUT    /aps/smv/override
    - DELETE /aps/smv/override

  Auto-Scheduling — hybrid (priority-first, then balance)
    - POST /aps/auto-schedule/preview
    - POST /aps/auto-schedule/commit
    - POST /aps/auto-schedule/rollback
    - GET  /aps/auto-schedule/runs
    - GET  /aps/auto-schedule/runs/{run_id}

Design:
  - SMV cache collection: rahaza_smv_cache
      { id, model_id, process_id, size_id?, smv_minutes_per_unit,
        source: 'derived'|'override', sample_size, updated_at, updated_by }
      Uniqueness per (model_id, process_id, size_id|None).
      Override takes precedence over derived values.

  - Schedule runs collection: rahaza_aps_schedule_runs
      { id, created_at, created_by, status: 'preview'|'committed'|'rolled_back',
        from, to, options, proposal:{ bars[], kpis{...}, summary{...} },
        snapshots:{
          work_orders: [{id, before:{target_start_date,target_end_date},
                         after:{target_start_date,target_end_date, line_id}}],
          line_assignments_created_ids: [ids],  # records inserted on commit
          line_assignments_prev_versions: [...] # for rollback (future)
        },
        committed_at?, committed_by?, rolled_back_at?, rolled_back_by? }

  - Assignment draft generation (commit):
      For every scheduled WO day, insert a record into rahaza_line_assignments with
      { source: 'aps', aps_run_id, draft: True, active: True, assign_date, line_id,
        model_id, size_id, work_order_id, target_qty (daily split), notes }
      Rollback sets active=False and marks rolled_back_by_run_id.

All writes are guarded by planner role (admin/manager/supervisor or wo.manage/production.manage).
"""
from fastapi import APIRouter, Request, HTTPException, Query
from database import get_db
from auth import require_auth, serialize_doc
from routes.rahaza_audit import log_audit
from datetime import datetime, timezone, date, timedelta
from typing import Optional, List
import uuid

router = APIRouter(prefix="/api/rahaza", tags=["rahaza-aps-19b"])


# ─── Helpers ────────────────────────────────────────────────────────────────
def _uid() -> str:
    return str(uuid.uuid4())


def _now():
    return datetime.now(timezone.utc)


def _parse_iso(s: Optional[str], default: Optional[date] = None) -> date:
    if not s:
        return default or date.today()
    try:
        return date.fromisoformat(s)
    except Exception:
        raise HTTPException(400, f"Tanggal tidak valid: {s} (YYYY-MM-DD).")


def _d_iter(start: date, end: date):
    d = start
    while d <= end:
        yield d
        d = d + timedelta(days=1)


PRIORITY_WEIGHT = {"urgent": 0, "high": 1, "normal": 2}


async def _require_planner(request: Request):
    user = await require_auth(request)
    role = (user.get("role") or "").lower()
    if role in ("superadmin", "admin", "owner", "manager", "supervisor"):
        return user
    perms = user.get("_permissions") or []
    if "*" in perms or "wo.manage" in perms or "production.manage" in perms:
        return user
    raise HTTPException(403, "Forbidden: butuh permission Planning/Work Order.")


# ─── SMV Derivation ─────────────────────────────────────────────────────────
DEFAULT_SMV_HISTORY_DAYS = 90
DEFAULT_SHIFT_MINUTES = 8 * 60  # 480


async def _derive_smv_for(db, model_id: str, process_id: str, size_id: Optional[str] = None) -> dict:
    """
    Derive SMV (minutes per unit) from historical output events.

    Approach (MVP):
      - Gather events (event_type='output') of the last N days matching
        {model_id, process_id [, size_id]}.
      - Count unique (line_id, date) pairs as "session slots" (each ~= DEFAULT_SHIFT_MINUTES).
      - SMV = (sessions * DEFAULT_SHIFT_MINUTES) / total_output_qty.
      - If insufficient data, fallback to 60 / line.capacity_per_hour (nominal)
        by picking any active line matching the process.

    Returns:
        { smv_minutes_per_unit, source: 'derived'|'nominal'|'none',
          sample_size, window_days }
    """
    window_end = _now()
    window_start = window_end - timedelta(days=DEFAULT_SMV_HISTORY_DAYS)

    match = {
        "event_type": "output",
        "model_id": model_id,
        "process_id": process_id,
        "timestamp": {"$gte": window_start, "$lte": window_end},
    }
    if size_id:
        match["size_id"] = size_id

    pipe = [
        {"$match": match},
        {"$project": {
            "line_id": 1, "qty": 1,
            "date": {
                "$dateToString": {"format": "%Y-%m-%d", "date": "$timestamp"}
            }
        }},
        {"$group": {
            "_id": None,
            "total_qty": {"$sum": "$qty"},
            "sessions": {"$addToSet": {"line_id": "$line_id", "date": "$date"}},
        }},
    ]
    rows = await db.rahaza_wip_events.aggregate(pipe).to_list(500)
    if rows:
        total_qty = int(rows[0].get("total_qty") or 0)
        sessions = len(rows[0].get("sessions") or [])
        if total_qty > 0 and sessions > 0:
            smv = round((sessions * DEFAULT_SHIFT_MINUTES) / total_qty, 3)
            return {
                "smv_minutes_per_unit": smv,
                "source": "derived",
                "sample_size": total_qty,
                "window_days": DEFAULT_SMV_HISTORY_DAYS,
                "sessions": sessions,
            }

    # Fallback nominal: based on any active line matching process
    ln = await db.rahaza_lines.find_one(
        {"process_id": process_id, "active": True}, {"_id": 0}
    )
    if ln and (ln.get("capacity_per_hour") or 0) > 0:
        cap = float(ln["capacity_per_hour"])
        smv = round(60.0 / cap, 3) if cap > 0 else 0.0
        return {
            "smv_minutes_per_unit": smv,
            "source": "nominal",
            "sample_size": 0,
            "window_days": DEFAULT_SMV_HISTORY_DAYS,
            "sessions": 0,
        }
    return {
        "smv_minutes_per_unit": 0.0,
        "source": "none",
        "sample_size": 0,
        "window_days": DEFAULT_SMV_HISTORY_DAYS,
        "sessions": 0,
    }


async def _upsert_cache(
    db, *, model_id: str, process_id: str, size_id: Optional[str],
    smv: float, source: str, sample_size: int, user: dict = None,
):
    q = {"model_id": model_id, "process_id": process_id, "size_id": size_id or None}
    now = _now()
    doc = {
        **q,
        "smv_minutes_per_unit": float(smv or 0),
        "source": source,
        "sample_size": int(sample_size or 0),
        "updated_at": now,
        "updated_by": (user or {}).get("id"),
        "updated_by_name": (user or {}).get("name"),
    }
    await db.rahaza_smv_cache.update_one(
        q, {"$set": doc, "$setOnInsert": {"id": _uid(), "created_at": now}}, upsert=True
    )
    return await db.rahaza_smv_cache.find_one(q, {"_id": 0})


async def _get_effective_smv(db, model_id: str, process_id: str, size_id: Optional[str] = None) -> dict:
    """
    Return the effective SMV record:
      - If an override exists for (m,p,s) → return it.
      - Else if derived cache exists → return it.
      - Else → derive on the fly (no write).
    """
    # 1) Override with size
    base_q = {"model_id": model_id, "process_id": process_id}
    if size_id:
        size_q = {**base_q, "size_id": size_id}
        o = await db.rahaza_smv_cache.find_one({**size_q, "source": "override"}, {"_id": 0})
        if o:
            return o
    # 2) Override without size (any size)
    o = await db.rahaza_smv_cache.find_one({**base_q, "size_id": None, "source": "override"}, {"_id": 0})
    if o:
        return o
    # 3) Derived cache
    if size_id:
        d = await db.rahaza_smv_cache.find_one({**base_q, "size_id": size_id, "source": "derived"}, {"_id": 0})
        if d:
            return d
    d = await db.rahaza_smv_cache.find_one({**base_q, "size_id": None, "source": "derived"}, {"_id": 0})
    if d:
        return d
    # 4) On-the-fly derive (no persist)
    derived = await _derive_smv_for(db, model_id, process_id, size_id)
    derived.update({
        "model_id": model_id, "process_id": process_id, "size_id": size_id or None,
        "updated_at": None, "id": None,
    })
    return derived


# ─── SMV Endpoints ──────────────────────────────────────────────────────────
@router.get("/aps/smv")
async def get_smv(
    request: Request,
    model_id: str = Query(...),
    process_id: str = Query(...),
    size_id: Optional[str] = Query(None),
):
    await require_auth(request)
    db = get_db()
    rec = await _get_effective_smv(db, model_id, process_id, size_id)
    return serialize_doc(rec)


@router.post("/aps/smv/recompute")
async def recompute_smv(request: Request):
    """
    Recompute derived SMV for all (model,process) pairs in the WO table.
    Body (optional): { model_id?: str, process_id?: str }
    """
    user = await _require_planner(request)
    db = get_db()
    try:
        body = await request.json()
    except Exception:
        body = {}
    m_filter = (body or {}).get("model_id")
    p_filter = (body or {}).get("process_id")

    # Build candidate pairs from active processes × active models (cap to reduce load)
    procs = await db.rahaza_processes.find(
        {"active": True, "is_rework": False}, {"_id": 0}
    ).to_list(500)
    models = await db.rahaza_models.find({"active": True}, {"_id": 0}).to_list(500)

    if m_filter:
        models = [m for m in models if m["id"] == m_filter]
    if p_filter:
        procs = [p for p in procs if p["id"] == p_filter]

    count = 0
    for m in models:
        for p in procs:
            res = await _derive_smv_for(db, m["id"], p["id"], None)
            if res["source"] in ("derived", "nominal"):
                await _upsert_cache(
                    db,
                    model_id=m["id"], process_id=p["id"], size_id=None,
                    smv=res["smv_minutes_per_unit"], source=res["source"],
                    sample_size=res.get("sample_size") or 0, user=user,
                )
                count += 1
    return {"ok": True, "pairs_updated": count}


@router.put("/aps/smv/override")
async def set_override_smv(request: Request):
    """Body: { model_id, process_id, size_id?, smv_minutes_per_unit }"""
    user = await _require_planner(request)
    db = get_db()
    body = await request.json()
    model_id = (body or {}).get("model_id")
    process_id = (body or {}).get("process_id")
    size_id = (body or {}).get("size_id") or None
    smv = (body or {}).get("smv_minutes_per_unit")
    if not (model_id and process_id) or smv is None:
        raise HTTPException(400, "model_id, process_id & smv_minutes_per_unit wajib.")
    try:
        smv = float(smv)
    except Exception:
        raise HTTPException(400, "smv_minutes_per_unit harus angka.")
    if smv <= 0:
        raise HTTPException(400, "smv_minutes_per_unit harus > 0.")

    # Find any existing record (override or derived) and replace with override.
    q = {"model_id": model_id, "process_id": process_id, "size_id": size_id}
    before = await db.rahaza_smv_cache.find_one(q, {"_id": 0})
    rec = await _upsert_cache(
        db, model_id=model_id, process_id=process_id, size_id=size_id,
        smv=smv, source="override", sample_size=(before or {}).get("sample_size") or 0,
        user=user,
    )
    try:
        await log_audit(
            db, user=user, action="update",
            entity_type="rahaza_smv_cache",
            entity_id=(rec or {}).get("id") or "unknown",
            before=before, after=rec, request=request,
        )
    except Exception:
        pass
    return serialize_doc(rec)


@router.delete("/aps/smv/override")
async def delete_override_smv(request: Request):
    """
    Body: { model_id, process_id, size_id? }
    Deletes the override record. Subsequent reads will fall back to derived.
    """
    user = await _require_planner(request)
    db = get_db()
    body = await request.json()
    model_id = (body or {}).get("model_id")
    process_id = (body or {}).get("process_id")
    size_id = (body or {}).get("size_id") or None
    if not (model_id and process_id):
        raise HTTPException(400, "model_id & process_id wajib.")
    q = {"model_id": model_id, "process_id": process_id, "size_id": size_id, "source": "override"}
    before = await db.rahaza_smv_cache.find_one(q, {"_id": 0})
    res = await db.rahaza_smv_cache.delete_one(q)
    if before:
        try:
            await log_audit(
                db, user=user, action="delete",
                entity_type="rahaza_smv_cache",
                entity_id=before.get("id") or "unknown",
                before=before, after=None, request=request,
            )
        except Exception:
            pass
    return {"ok": True, "deleted": res.deleted_count}


# ─── Scheduler Engine ───────────────────────────────────────────────────────
async def _final_process(db) -> Optional[dict]:
    procs = await db.rahaza_processes.find(
        {"active": True, "is_rework": False}, {"_id": 0}
    ).sort("order_seq", 1).to_list(500)
    return procs[-1] if procs else None


async def _load_eligible_lines(db, process_id: str, line_ids_filter: Optional[List[str]] = None) -> List[dict]:
    q = {"active": True, "process_id": process_id}
    if line_ids_filter:
        q["id"] = {"$in": line_ids_filter}
    lines = await db.rahaza_lines.find(q, {"_id": 0}).sort("code", 1).to_list(500)
    return lines


def _daily_capacity(ln: dict) -> int:
    return int(ln.get("capacity_per_hour") or 0) * 8  # MVP shift = 8h


def _sort_wo_key(wo: dict) -> tuple:
    pri = PRIORITY_WEIGHT.get((wo.get("priority") or "normal").lower(), 2)
    # earliest due first (None → far future)
    te = wo.get("target_end_date")
    try:
        te_d = date.fromisoformat(te) if te else date.max
    except Exception:
        te_d = date.max
    cr = wo.get("created_at")
    # older first
    cr_ts = cr if isinstance(cr, datetime) else datetime.min.replace(tzinfo=timezone.utc)
    return (pri, te_d, cr_ts)


async def _compute_completed_qty(db, wo_ids: List[str], final_proc_id: str) -> dict:
    if not wo_ids or not final_proc_id:
        return {}
    pipe = [
        {"$match": {"event_type": "output", "work_order_id": {"$in": wo_ids}, "process_id": final_proc_id}},
        {"$group": {"_id": "$work_order_id", "total": {"$sum": "$qty"}}},
    ]
    rows = await db.rahaza_wip_events.aggregate(pipe).to_list(500)
    return {r["_id"]: int(r.get("total") or 0) for r in rows}


async def _build_schedule(
    db,
    *,
    from_d: date,
    to_d: date,
    process_id: Optional[str] = None,
    line_ids: Optional[List[str]] = None,
    include_statuses: Optional[List[str]] = None,
    include_in_production: bool = False,
):
    """
    Core hybrid scheduler.

    Returns:
      {
        run_meta: { from, to, process_id, line_ids, include_statuses },
        lines: [{id, code, name, process_code, capacity_per_day}],
        proposals: [
          {
            wo_id, wo_number, model_id, model_code, qty_remaining,
            priority, previous_target_start_date, previous_target_end_date, previous_line_id,
            line_id, start_date, end_date,
            daily_plan: [{date, qty}],
            smv_minutes_per_unit, smv_source,
            note: str | None
          }
        ],
        unassigned: [ ... same shape with line_id=None, note='no_capacity'|'no_line_match' ]
        kpis: { total_wo, scheduled, unassigned, overload_days, avg_load_pct }
      }
    """
    # 1) Determine process to schedule: use 'final' process if not specified.
    if not process_id:
        fp = await _final_process(db)
        if not fp:
            raise HTTPException(400, "Tidak ada process non-rework aktif. Konfigurasi master dulu.")
        process_id = fp["id"]

    # 2) Eligible lines
    lines = await _load_eligible_lines(db, process_id, line_ids)
    if not lines:
        raise HTTPException(400, "Tidak ada line aktif yang cocok dengan process terpilih.")

    # Load proc name for output
    proc = await db.rahaza_processes.find_one({"id": process_id}, {"_id": 0})
    line_rows = [{
        "id": ln["id"], "code": ln.get("code"), "name": ln.get("name"),
        "process_id": ln.get("process_id"),
        "process_code": (proc or {}).get("code"),
        "capacity_per_hour": int(ln.get("capacity_per_hour") or 0),
        "capacity_per_day": _daily_capacity(ln),
    } for ln in lines]

    # 3) Candidate WOs
    if not include_statuses:
        statuses = ["draft", "released"] + (["in_production"] if include_in_production else [])
    else:
        statuses = include_statuses
    q_wo = {"status": {"$in": statuses}}
    wos = await db.rahaza_work_orders.find(q_wo, {"_id": 0}).to_list(500)

    # Compute completed qty for in_production WOs
    final_proc = await _final_process(db)
    final_pid = final_proc["id"] if final_proc else None
    completed_map = await _compute_completed_qty(db, [w["id"] for w in wos], final_pid) if final_pid else {}

    # 4) Sort WOs (priority-first, due date, age)
    wos_sorted = sorted(wos, key=_sort_wo_key)

    # 5) Load map capacity remaining per (line_id, date_iso)
    remaining = {}
    for ln in line_rows:
        for d in _d_iter(from_d, to_d):
            remaining[(ln["id"], d.isoformat())] = ln["capacity_per_day"]

    # Track existing in-window load from assignments (optional: MVP subtract existing active manual assignments)
    existing_assign = await db.rahaza_line_assignments.find(
        {"active": True, "assign_date": {"$gte": from_d.isoformat(), "$lte": to_d.isoformat()}},
        {"_id": 0}
    ).to_list(500)
    for a in existing_assign:
        # Only count non-draft manual assignments against capacity (avoid subtracting past preview drafts)
        if (a.get("source") == "aps") and a.get("draft"):
            continue
        k = (a.get("line_id"), a.get("assign_date"))
        if k in remaining:
            remaining[k] = max(0, remaining[k] - int(a.get("target_qty") or 0))

    # 6) For each WO, choose line (least-loaded among eligible) and fit to capacity
    proposals = []
    unassigned = []

    for wo in wos_sorted:
        qty = int(wo.get("qty") or 0)
        done = int(completed_map.get(wo["id"], wo.get("completed_qty") or 0))
        qty_remaining = max(0, qty - done)
        if qty_remaining <= 0:
            # WO already fully produced; skip
            continue

        # SMV (informational — used for daily rate sanity)
        smv_rec = await _get_effective_smv(db, wo.get("model_id"), process_id, wo.get("size_id"))
        smv = float((smv_rec or {}).get("smv_minutes_per_unit") or 0)
        smv_source = (smv_rec or {}).get("source") or "none"

        # Pick line with most remaining capacity in the earliest feasible window
        # Strategy: for each candidate line, greedily fill from `from_d`, counting days needed.
        best = None
        for ln in line_rows:
            daily_cap = ln["capacity_per_day"]
            if daily_cap <= 0:
                continue
            # Simulate without mutating
            need = qty_remaining
            plan = []
            for d in _d_iter(from_d, to_d):
                if need <= 0:
                    break
                k = (ln["id"], d.isoformat())
                avail = remaining.get(k, 0)
                if avail <= 0:
                    continue
                take = min(avail, need)
                plan.append({"date": d.isoformat(), "qty": int(take)})
                need -= take
            fulfilled = (need == 0)
            # Score: prefer (fulfilled=True, earliest_end, fewer days used, least overall load)
            if plan:
                end_idx = (date.fromisoformat(plan[-1]["date"]) - from_d).days
            else:
                end_idx = 10**9
            score = (
                0 if fulfilled else 1,
                end_idx,
                len(plan),
            )
            if best is None or score < best["score"]:
                best = {
                    "line": ln, "plan": plan, "fulfilled": fulfilled,
                    "score": score, "remaining_need": need,
                }

        if not best or not best["plan"]:
            unassigned.append({
                "wo_id": wo["id"],
                "wo_number": wo.get("wo_number"),
                "model_id": wo.get("model_id"),
                "qty": qty,
                "qty_remaining": qty_remaining,
                "priority": wo.get("priority") or "normal",
                "previous_target_start_date": wo.get("target_start_date"),
                "previous_target_end_date": wo.get("target_end_date"),
                "previous_line_id": None,
                "line_id": None,
                "start_date": None,
                "end_date": None,
                "daily_plan": [],
                "smv_minutes_per_unit": smv,
                "smv_source": smv_source,
                "note": "no_capacity_in_window",
            })
            continue

        # Consume capacity from the chosen line
        ln_chosen = best["line"]
        for row in best["plan"]:
            k = (ln_chosen["id"], row["date"])
            remaining[k] = max(0, remaining[k] - int(row["qty"]))

        start_d = best["plan"][0]["date"]
        end_d = best["plan"][-1]["date"]

        proposals.append({
            "wo_id": wo["id"],
            "wo_number": wo.get("wo_number"),
            "model_id": wo.get("model_id"),
            "size_id": wo.get("size_id"),
            "qty": qty,
            "qty_remaining": qty_remaining,
            "priority": wo.get("priority") or "normal",
            "previous_target_start_date": wo.get("target_start_date"),
            "previous_target_end_date": wo.get("target_end_date"),
            "previous_line_id": None,  # APS not currently tracking hard previous mapping
            "line_id": ln_chosen["id"],
            "line_code": ln_chosen.get("code"),
            "start_date": start_d,
            "end_date": end_d,
            "daily_plan": best["plan"],
            "smv_minutes_per_unit": smv,
            "smv_source": smv_source,
            "fulfilled": best["fulfilled"],
            "note": None if best["fulfilled"] else "partial_fit",
        })

    # 7) KPIs
    overload_days = 0
    load_values = []
    # cap total from line rows
    total_cap = 0
    total_load = 0
    for ln in line_rows:
        cap = ln["capacity_per_day"]
        for d in _d_iter(from_d, to_d):
            k = (ln["id"], d.isoformat())
            left = remaining.get(k, cap)
            used = max(0, cap - left)
            total_cap += cap
            total_load += used
            if cap > 0:
                pct = used / cap * 100
                load_values.append(pct)
                if pct > 110:
                    overload_days += 1

    kpis = {
        "total_wo_considered": len(wos_sorted),
        "scheduled": len(proposals),
        "unassigned": len(unassigned),
        "overload_days": overload_days,
        "avg_load_pct": round(sum(load_values) / len(load_values), 1) if load_values else 0.0,
        "utilization_pct": round(total_load / total_cap * 100, 1) if total_cap > 0 else 0.0,
    }

    return {
        "run_meta": {
            "from": from_d.isoformat(),
            "to": to_d.isoformat(),
            "process_id": process_id,
            "process_code": (proc or {}).get("code"),
            "process_name": (proc or {}).get("name"),
            "line_ids": [ln["id"] for ln in line_rows],
            "include_statuses": statuses,
            "include_in_production": include_in_production,
        },
        "lines": line_rows,
        "proposals": proposals,
        "unassigned": unassigned,
        "kpis": kpis,
    }


# ─── Auto-schedule Endpoints ────────────────────────────────────────────────
@router.post("/aps/auto-schedule/preview")
async def auto_schedule_preview(request: Request):
    """
    Body: {
      from, to, process_id?, line_ids?: [str], include_statuses?: [str],
      include_in_production?: bool
    }

    Creates a 'preview' run record (no WO/assignment writes) that can be committed later.
    """
    user = await _require_planner(request)
    db = get_db()
    try:
        body = await request.json()
    except Exception:
        body = {}

    from_d = _parse_iso((body or {}).get("from"), date.today())
    to_d = _parse_iso((body or {}).get("to"), date.today() + timedelta(days=21))
    if to_d < from_d:
        raise HTTPException(400, "Rentang tanggal tidak valid (to < from).")

    process_id = (body or {}).get("process_id")
    line_ids = (body or {}).get("line_ids") or None
    include_statuses = (body or {}).get("include_statuses") or None
    include_in_production = bool((body or {}).get("include_in_production"))

    schedule = await _build_schedule(
        db,
        from_d=from_d, to_d=to_d,
        process_id=process_id, line_ids=line_ids,
        include_statuses=include_statuses,
        include_in_production=include_in_production,
    )

    run_id = _uid()
    run_doc = {
        "id": run_id,
        "status": "preview",
        "from": from_d.isoformat(),
        "to": to_d.isoformat(),
        "options": {
            "process_id": process_id,
            "line_ids": line_ids,
            "include_statuses": include_statuses,
            "include_in_production": include_in_production,
        },
        "proposal": schedule,
        "created_at": _now(),
        "created_by": user.get("id"),
        "created_by_name": user.get("name"),
    }
    await db.rahaza_aps_schedule_runs.insert_one(run_doc)
    out = await db.rahaza_aps_schedule_runs.find_one({"id": run_id}, {"_id": 0})
    return serialize_doc(out)


@router.post("/aps/auto-schedule/commit")
async def auto_schedule_commit(request: Request):
    """
    Body: { run_id: str }

    Applies:
      - Update rahaza_work_orders target_start_date/target_end_date for each proposal.
      - Insert rahaza_line_assignments (draft, source='aps', aps_run_id=run_id) per daily plan row.
      - Insert audit logs.
      - Mark run as 'committed'.
    """
    user = await _require_planner(request)
    db = get_db()
    body = await request.json()
    run_id = (body or {}).get("run_id")
    if not run_id:
        raise HTTPException(400, "run_id wajib.")

    run = await db.rahaza_aps_schedule_runs.find_one({"id": run_id}, {"_id": 0})
    if not run:
        raise HTTPException(404, "Run tidak ditemukan.")
    if run.get("status") != "preview":
        raise HTTPException(400, f"Run sudah {run.get('status')}. Hanya preview yang dapat dicommit.")

    proposal = run.get("proposal") or {}
    proposals = proposal.get("proposals") or []

    wo_changes = []
    assign_created_ids = []
    errors = []

    # Batch prefetch all WOs referenced in proposals
    wo_ids_in_proposals = [p.get("wo_id") for p in proposals if p.get("wo_id")]
    wo_map_commit = {}
    if wo_ids_in_proposals:
        async for d in db.rahaza_work_orders.find(
            {"id": {"$in": wo_ids_in_proposals}}, {"_id": 0}
        ):
            wo_map_commit[d["id"]] = d

    # Collect assignment docs to insert in bulk at the end
    assigns_to_insert = []

    for p in proposals:
        wo_id = p.get("wo_id")
        wo = wo_map_commit.get(wo_id)
        if not wo:
            errors.append({"wo_id": wo_id, "error": "wo_not_found"})
            continue
        if (wo.get("status") or "").lower() in ("completed", "cancelled"):
            errors.append({"wo_id": wo_id, "error": f"wo_status_{wo.get('status')}"})
            continue

        before = {
            "target_start_date": wo.get("target_start_date"),
            "target_end_date": wo.get("target_end_date"),
        }
        after = {
            "target_start_date": p.get("start_date"),
            "target_end_date": p.get("end_date"),
        }
        await db.rahaza_work_orders.update_one(
            {"id": wo_id},
            {"$set": {**after, "updated_at": _now()}},
        )
        wo_changes.append({
            "wo_id": wo_id,
            "wo_number": wo.get("wo_number"),
            "before": before,
            "after": after,
            "line_id": p.get("line_id"),
        })
        try:
            await log_audit(
                db, user=user, action="update",
                entity_type="rahaza_work_orders",
                entity_id=wo_id,
                before=before, after=after, request=request,
            )
        except Exception:
            pass

        # Insert daily assignments (draft, source='aps') — batched at end
        for row in (p.get("daily_plan") or []):
            doc = {
                "id": _uid(),
                "line_id": p.get("line_id"),
                "operator_id": None,
                "shift_id": None,
                "model_id": wo.get("model_id"),
                "size_id": wo.get("size_id"),
                "work_order_id": wo_id,
                "target_qty": int(row.get("qty") or 0),
                "assign_date": row.get("date"),
                "notes": f"Draft APS run {run_id}",
                "active": True,
                "source": "aps",
                "draft": True,
                "aps_run_id": run_id,
                "created_at": _now(),
                "updated_at": _now(),
            }
            assigns_to_insert.append(doc)
            assign_created_ids.append(doc["id"])

    # Single bulk insert for all assignments (eliminates per-row insert)
    if assigns_to_insert:
        await db.rahaza_line_assignments.insert_many(assigns_to_insert)

    now = _now()
    await db.rahaza_aps_schedule_runs.update_one(
        {"id": run_id},
        {"$set": {
            "status": "committed",
            "committed_at": now,
            "committed_by": user.get("id"),
            "committed_by_name": user.get("name"),
            "snapshots": {
                "work_orders": wo_changes,
                "line_assignments_created_ids": assign_created_ids,
            },
            "errors": errors,
        }},
    )
    out = await db.rahaza_aps_schedule_runs.find_one({"id": run_id}, {"_id": 0})
    return serialize_doc({
        "ok": True,
        "run": out,
        "applied_wo_count": len(wo_changes),
        "created_assignment_count": len(assign_created_ids),
        "errors": errors,
    })


@router.post("/aps/auto-schedule/rollback")
async def auto_schedule_rollback(request: Request):
    """
    Body: { run_id: str }
    Rolls back a committed run:
      - Restores WO target dates (from snapshot.work_orders.before).
      - Deactivates assignments created by this run.
      - Marks run as 'rolled_back'.
    """
    user = await _require_planner(request)
    db = get_db()
    body = await request.json()
    run_id = (body or {}).get("run_id")
    if not run_id:
        raise HTTPException(400, "run_id wajib.")

    run = await db.rahaza_aps_schedule_runs.find_one({"id": run_id}, {"_id": 0})
    if not run:
        raise HTTPException(404, "Run tidak ditemukan.")
    if run.get("status") != "committed":
        raise HTTPException(400, f"Run berstatus {run.get('status')}, hanya committed yang bisa rollback.")

    snap = run.get("snapshots") or {}
    restored_wo = 0
    deactivated = 0

    # Batch prefetch all WOs referenced in snapshot for existence validation
    snap_wos = snap.get("work_orders") or []
    rb_wo_ids = [ch.get("wo_id") for ch in snap_wos if ch.get("wo_id")]
    rb_wo_exists = set()
    if rb_wo_ids:
        async for d in db.rahaza_work_orders.find(
            {"id": {"$in": rb_wo_ids}}, {"_id": 0, "id": 1}
        ):
            rb_wo_exists.add(d["id"])

    for ch in snap_wos:
        wo_id = ch.get("wo_id")
        before = ch.get("before") or {}
        after = ch.get("after") or {}
        if wo_id not in rb_wo_exists:
            continue
        await db.rahaza_work_orders.update_one(
            {"id": wo_id},
            {"$set": {
                "target_start_date": before.get("target_start_date"),
                "target_end_date": before.get("target_end_date"),
                "updated_at": _now(),
            }},
        )
        restored_wo += 1
        try:
            await log_audit(
                db, user=user, action="update",
                entity_type="rahaza_work_orders",
                entity_id=wo_id,
                before=after, after=before, request=request,
            )
        except Exception:
            pass

    ids = snap.get("line_assignments_created_ids") or []
    if ids:
        res = await db.rahaza_line_assignments.update_many(
            {"id": {"$in": ids}},
            {"$set": {
                "active": False,
                "rolled_back_by_run_id": run_id,
                "updated_at": _now(),
            }},
        )
        deactivated = res.modified_count

    await db.rahaza_aps_schedule_runs.update_one(
        {"id": run_id},
        {"$set": {
            "status": "rolled_back",
            "rolled_back_at": _now(),
            "rolled_back_by": user.get("id"),
            "rolled_back_by_name": user.get("name"),
        }},
    )
    out = await db.rahaza_aps_schedule_runs.find_one({"id": run_id}, {"_id": 0})
    return serialize_doc({
        "ok": True,
        "run": out,
        "restored_wo_count": restored_wo,
        "deactivated_assignments_count": deactivated,
    })


@router.get("/aps/auto-schedule/runs")
async def list_runs(
    request: Request,
    limit: int = Query(20, ge=1, le=100),
    status: Optional[str] = Query(None),
):
    await require_auth(request)
    db = get_db()
    q = {}
    if status:
        q["status"] = status
    rows = await db.rahaza_aps_schedule_runs.find(q, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(500)
    # Trim heavy `proposal` for list endpoint; keep summary KPIs.
    out = []
    for r in rows:
        proposal = r.get("proposal") or {}
        out.append({
            "id": r.get("id"),
            "status": r.get("status"),
            "from": r.get("from"),
            "to": r.get("to"),
            "options": r.get("options"),
            "kpis": (proposal.get("kpis") or {}),
            "created_at": r.get("created_at"),
            "created_by_name": r.get("created_by_name"),
            "committed_at": r.get("committed_at"),
            "rolled_back_at": r.get("rolled_back_at"),
        })
    return serialize_doc(out)


@router.get("/aps/auto-schedule/runs/{run_id}")
async def get_run(run_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    r = await db.rahaza_aps_schedule_runs.find_one({"id": run_id}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Run tidak ditemukan.")
    return serialize_doc(r)
