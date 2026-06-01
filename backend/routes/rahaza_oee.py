"""
PT Rahaza — Phase 20A: OEE (Overall Equipment Effectiveness)

Compute OEE per line per day (additive, read-only aggregator).

OEE = Availability × Performance × Quality

MVP data sources:
  - planned_minutes:
      sum(DEFAULT_SHIFT_MINUTES per assignment per day) for active, non-draft
      assignments. Optional: if shift_id is present, use rahaza_shifts.start_time
      / end_time (not required for MVP).
  - downtime_minutes:
      sum((resolved_at - created_at) for rahaza_andon_events where
      type='machine_breakdown' AND status='resolved' per line per day).
  - actual_output:
      sum(rahaza_wip_events.qty where event_type='output' for (line_id, day)).
  - target_output:
      sum(rahaza_line_assignments.target_qty for (line_id, assign_date=day)).
  - quality:
      qc_pass / (qc_pass + qc_fail) from rahaza_wip_events per (line_id, day).
      Fallback to 1.0 when no QC events.

Endpoints (prefix /api/rahaza):
  - GET /oee/daily?from=YYYY-MM-DD&to=YYYY-MM-DD&line_id= → per (line, day)
  - GET /oee/summary?date=YYYY-MM-DD → single-day KPI snapshot
  - GET /oee/line/{line_id}?date=YYYY-MM-DD → drilldown: downtime list +
        output events for a specific line/day.
"""
from fastapi import APIRouter, Request, HTTPException, Query
from database import get_db
from auth import require_auth, serialize_doc
from datetime import datetime, timezone, date, timedelta
from typing import Optional

router = APIRouter(prefix="/api/rahaza", tags=["rahaza-oee"])

DEFAULT_SHIFT_MINUTES = 8 * 60  # 480
MAX_DAYS_PER_QUERY = 45


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


def _day_bounds_utc(d: date):
    start = datetime(d.year, d.month, d.day, tzinfo=timezone.utc)
    end = start + timedelta(days=1)
    return start, end


def _clip(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, v))


# ─── Core aggregator ────────────────────────────────────────────────────────
async def _compute_oee(db, *, from_d: date, to_d: date, line_id_filter: Optional[str] = None):
    """
    Returns dict:
      {
        meta: { from, to, lines: [lineRow] },
        days: [iso...],
        rows: [{
           line_id, date,
           planned_min, downtime_min,
           target_qty, output_qty, qc_pass, qc_fail,
           availability, performance, quality, oee,
           has_data (bool)
        }, ...],
        by_line: [{
           line_id, line_code, line_name,
           avg_availability, avg_performance, avg_quality, avg_oee,
           planned_min, downtime_min, output_qty, target_qty, qc_pass, qc_fail
        }],
        kpis: { avg_availability, avg_performance, avg_quality, avg_oee,
                total_planned_min, total_downtime_min, total_output, total_target }
      }
    """
    # 1) Lines
    q_line = {"active": True}
    if line_id_filter:
        q_line["id"] = line_id_filter
    lines = await db.rahaza_lines.find(q_line, {"_id": 0}).sort("code", 1).to_list(500)
    line_ids = [ln["id"] for ln in lines]
    if not line_ids:
        return {
            "meta": {"from": from_d.isoformat(), "to": to_d.isoformat(), "lines": []},
            "days": [d.isoformat() for d in _d_iter(from_d, to_d)],
            "rows": [], "by_line": [], "kpis": _empty_kpis(),
        }

    from_iso = from_d.isoformat()
    to_iso = to_d.isoformat()
    from_ts, _ = _day_bounds_utc(from_d)
    _, to_ts = _day_bounds_utc(to_d)

    # 2) Assignments in range (planned + target)
    assigns = await db.rahaza_line_assignments.find({
        "line_id": {"$in": line_ids},
        "assign_date": {"$gte": from_iso, "$lte": to_iso},
        "active": True,
    }, {"_id": 0}).to_list(500)

    planned_min = {}  # (line_id, iso) -> minutes
    target_qty  = {}  # (line_id, iso) -> qty
    for a in assigns:
        lid = a.get("line_id")
        ad = a.get("assign_date")
        if not (lid and ad):
            continue
        k = (lid, ad)
        planned_min[k] = planned_min.get(k, 0) + DEFAULT_SHIFT_MINUTES
        target_qty[k] = target_qty.get(k, 0) + int(a.get("target_qty") or 0)

    # 3) Downtime: andon machine_breakdown resolved events that overlap [from_ts, to_ts]
    andons = await db.rahaza_andon_events.find({
        "type": "machine_breakdown",
        "status": "resolved",
        "line_id": {"$in": line_ids},
        "resolved_at": {"$ne": None},
        "created_at": {"$lt": to_ts},
    }, {"_id": 0}).to_list(500)

    downtime_min = {}  # (line_id, iso) -> minutes

    def _attr_dt(line_id, start_dt: datetime, end_dt: datetime):
        # Distribute minutes across calendar-day boundaries.
        if not (line_id and start_dt and end_dt):
            return
        if end_dt <= start_dt:
            return
        cur = start_dt
        while cur < end_dt:
            day = cur.astimezone(timezone.utc).date()
            day_end = datetime(day.year, day.month, day.day, tzinfo=timezone.utc) + timedelta(days=1)
            seg_end = min(end_dt, day_end)
            minutes = (seg_end - cur).total_seconds() / 60.0
            iso = day.isoformat()
            if iso >= from_iso and iso <= to_iso:
                downtime_min[(line_id, iso)] = downtime_min.get((line_id, iso), 0.0) + minutes
            cur = seg_end

    for e in andons:
        c = e.get("created_at")
        r = e.get("resolved_at")
        # Some docs may store strings; normalize
        if isinstance(c, str):
            try:
                c = datetime.fromisoformat(c.replace("Z", "+00:00"))
            except Exception:
                c = None
        if isinstance(r, str):
            try:
                r = datetime.fromisoformat(r.replace("Z", "+00:00"))
            except Exception:
                r = None
        if not (c and r):
            continue
        if c.tzinfo is None:
            c = c.replace(tzinfo=timezone.utc)
        if r.tzinfo is None:
            r = r.replace(tzinfo=timezone.utc)
        _attr_dt(e.get("line_id"), c, r)

    # 4) Output qty per (line, day)
    output_qty = {}
    qc_pass = {}
    qc_fail = {}
    pipe = [
        {"$match": {
            "line_id": {"$in": line_ids},
            "event_type": {"$in": ["output", "qc_pass", "qc_fail"]},
            "timestamp": {"$gte": from_ts, "$lte": to_ts},
        }},
        {"$project": {
            "line_id": 1, "event_type": 1, "qty": 1,
            "date": {"$dateToString": {"format": "%Y-%m-%d", "date": "$timestamp"}},
        }},
        {"$group": {
            "_id": {"line_id": "$line_id", "event_type": "$event_type", "date": "$date"},
            "qty": {"$sum": "$qty"},
        }},
    ]
    rows_ev = await db.rahaza_wip_events.aggregate(pipe).to_list(500)
    for r in rows_ev:
        k = (r["_id"]["line_id"], r["_id"]["date"])
        et = r["_id"]["event_type"]
        q = int(r.get("qty") or 0)
        if et == "output":
            output_qty[k] = output_qty.get(k, 0) + q
        elif et == "qc_pass":
            qc_pass[k] = qc_pass.get(k, 0) + q
        elif et == "qc_fail":
            qc_fail[k] = qc_fail.get(k, 0) + q

    # 5) Build row per (line, day)
    rows = []
    per_line_agg = {lid: {
        "planned_min": 0.0, "downtime_min": 0.0,
        "target_qty": 0, "output_qty": 0, "qc_pass": 0, "qc_fail": 0,
        "a_sum": 0.0, "p_sum": 0.0, "qlty_sum": 0.0, "oee_sum": 0.0,
        "a_cnt": 0, "p_cnt": 0, "q_cnt": 0, "oee_cnt": 0,
    } for lid in line_ids}

    for ln in lines:
        lid = ln["id"]
        for d in _d_iter(from_d, to_d):
            iso = d.isoformat()
            pm = planned_min.get((lid, iso), 0.0)
            dm = min(downtime_min.get((lid, iso), 0.0), pm if pm > 0 else downtime_min.get((lid, iso), 0.0))
            tq = int(target_qty.get((lid, iso), 0))
            oq = int(output_qty.get((lid, iso), 0))
            qp = int(qc_pass.get((lid, iso), 0))
            qf = int(qc_fail.get((lid, iso), 0))

            availability = None
            performance = None
            quality = None
            oee = None
            has_data = bool(pm > 0 or oq > 0 or qp > 0 or qf > 0 or tq > 0)

            if pm > 0:
                availability = _clip((pm - dm) / pm)
            if tq > 0:
                performance = _clip(oq / tq, 0.0, 2.0)  # can exceed 1.0 if over-performed, cap at 2
                performance = min(performance, 1.0)     # OEE convention: cap at 1.0
            # quality
            total_qc = qp + qf
            if total_qc > 0:
                quality = _clip(qp / total_qc)
            elif oq > 0:
                quality = 1.0

            if availability is not None and performance is not None and quality is not None:
                oee = availability * performance * quality

            rows.append({
                "line_id": lid,
                "line_code": ln.get("code"),
                "line_name": ln.get("name"),
                "date": iso,
                "planned_min": round(pm, 1),
                "downtime_min": round(dm, 1),
                "target_qty": tq,
                "output_qty": oq,
                "qc_pass": qp,
                "qc_fail": qf,
                "availability": round(availability, 4) if availability is not None else None,
                "performance": round(performance, 4) if performance is not None else None,
                "quality": round(quality, 4) if quality is not None else None,
                "oee": round(oee, 4) if oee is not None else None,
                "has_data": has_data,
            })

            agg = per_line_agg[lid]
            agg["planned_min"]  += pm
            agg["downtime_min"] += dm
            agg["target_qty"]   += tq
            agg["output_qty"]   += oq
            agg["qc_pass"]      += qp
            agg["qc_fail"]      += qf
            if availability is not None:
                agg["a_sum"] += availability
                agg["a_cnt"] += 1
            if performance is not None:
                agg["p_sum"] += performance
                agg["p_cnt"] += 1
            if quality is not None:
                agg["qlty_sum"] += quality
                agg["q_cnt"] += 1
            if oee is not None:
                agg["oee_sum"] += oee
                agg["oee_cnt"] += 1

    # 6) Per-line summary
    by_line = []
    for ln in lines:
        lid = ln["id"]
        a = per_line_agg[lid]
        by_line.append({
            "line_id": lid,
            "line_code": ln.get("code"),
            "line_name": ln.get("name"),
            "process_id": ln.get("process_id"),
            "avg_availability": round(a["a_sum"] / a["a_cnt"], 4) if a["a_cnt"] else None,
            "avg_performance":  round(a["p_sum"] / a["p_cnt"], 4) if a["p_cnt"] else None,
            "avg_quality":      round(a["qlty_sum"] / a["q_cnt"], 4) if a["q_cnt"] else None,
            "avg_oee":          round(a["oee_sum"] / a["oee_cnt"], 4) if a["oee_cnt"] else None,
            "planned_min":  round(a["planned_min"], 1),
            "downtime_min": round(a["downtime_min"], 1),
            "target_qty": a["target_qty"],
            "output_qty": a["output_qty"],
            "qc_pass": a["qc_pass"],
            "qc_fail": a["qc_fail"],
        })

    # 7) Global KPIs (weighted/average)
    total_planned = sum(a["planned_min"] for a in per_line_agg.values())
    total_downtime = sum(a["downtime_min"] for a in per_line_agg.values())
    total_output = sum(a["output_qty"] for a in per_line_agg.values())
    total_target = sum(a["target_qty"] for a in per_line_agg.values())
    total_qc_pass = sum(a["qc_pass"] for a in per_line_agg.values())
    total_qc_fail = sum(a["qc_fail"] for a in per_line_agg.values())

    avail = ((total_planned - total_downtime) / total_planned) if total_planned > 0 else None
    perf  = min(total_output / total_target, 1.0) if total_target > 0 else None
    if (total_qc_pass + total_qc_fail) > 0:
        qlty = total_qc_pass / (total_qc_pass + total_qc_fail)
    elif total_output > 0:
        qlty = 1.0
    else:
        qlty = None
    oee = (avail * perf * qlty) if (avail is not None and perf is not None and qlty is not None) else None

    kpis = {
        "avg_availability": round(avail, 4) if avail is not None else None,
        "avg_performance":  round(perf, 4)  if perf  is not None else None,
        "avg_quality":      round(qlty, 4)  if qlty  is not None else None,
        "avg_oee":          round(oee, 4)   if oee   is not None else None,
        "total_planned_min":  round(total_planned, 1),
        "total_downtime_min": round(total_downtime, 1),
        "total_output":       int(total_output),
        "total_target":       int(total_target),
        "total_qc_pass":      int(total_qc_pass),
        "total_qc_fail":      int(total_qc_fail),
    }

    return {
        "meta": {
            "from": from_d.isoformat(),
            "to": to_d.isoformat(),
            "lines": [{"id": ln["id"], "code": ln.get("code"), "name": ln.get("name")} for ln in lines],
        },
        "days": [d.isoformat() for d in _d_iter(from_d, to_d)],
        "rows": rows,
        "by_line": by_line,
        "kpis": kpis,
    }


def _empty_kpis():
    return {
        "avg_availability": None, "avg_performance": None,
        "avg_quality": None, "avg_oee": None,
        "total_planned_min": 0, "total_downtime_min": 0,
        "total_output": 0, "total_target": 0,
        "total_qc_pass": 0, "total_qc_fail": 0,
    }


# ─── Endpoints ──────────────────────────────────────────────────────────────
@router.get("/oee/daily")
async def oee_daily(
    request: Request,
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = None,
    line_id: Optional[str] = None,
):
    await require_auth(request)
    db = get_db()
    today = date.today()
    from_d = _parse_iso(from_, today - timedelta(days=6))
    to_d = _parse_iso(to, today)
    if to_d < from_d:
        raise HTTPException(400, "Rentang tanggal tidak valid (to < from).")
    if (to_d - from_d).days > MAX_DAYS_PER_QUERY:
        raise HTTPException(400, f"Rentang terlalu besar (max {MAX_DAYS_PER_QUERY} hari).")
    data = await _compute_oee(db, from_d=from_d, to_d=to_d, line_id_filter=line_id)
    return serialize_doc(data)


@router.get("/oee/summary")
async def oee_summary(
    request: Request,
    day: Optional[str] = Query(None, alias="date"),
):
    await require_auth(request)
    db = get_db()
    d = _parse_iso(day, date.today())
    data = await _compute_oee(db, from_d=d, to_d=d)
    # Add top_losses snapshot: lowest OEE lines
    lines_sorted = sorted(
        [ln for ln in data["by_line"] if ln.get("avg_oee") is not None],
        key=lambda x: x["avg_oee"],
    )
    top_losses = lines_sorted[:5]
    data["top_losses"] = top_losses
    return serialize_doc(data)


@router.get("/oee/line/{line_id}")
async def oee_line_drill(
    line_id: str,
    request: Request,
    day: Optional[str] = Query(None, alias="date"),
):
    """Drilldown detail for a specific (line, day): downtime events + recent output events."""
    await require_auth(request)
    db = get_db()
    d = _parse_iso(day, date.today())
    from_ts, to_ts = _day_bounds_utc(d)

    ln = await db.rahaza_lines.find_one({"id": line_id}, {"_id": 0})
    if not ln:
        raise HTTPException(404, "Line tidak ditemukan.")

    data = await _compute_oee(db, from_d=d, to_d=d, line_id_filter=line_id)
    row = next((r for r in data["rows"] if r["line_id"] == line_id), None)

    # Downtime events
    andons = await db.rahaza_andon_events.find({
        "line_id": line_id,
        "type": "machine_breakdown",
        "status": "resolved",
        "created_at": {"$gte": from_ts - timedelta(days=1), "$lt": to_ts + timedelta(days=1)},
    }, {"_id": 0}).sort("created_at", -1).to_list(50)

    # Output events (last 100)
    events = await db.rahaza_wip_events.find({
        "line_id": line_id,
        "timestamp": {"$gte": from_ts, "$lt": to_ts},
    }, {"_id": 0}).sort("timestamp", -1).to_list(100)

    return serialize_doc({
        "line": {"id": ln["id"], "code": ln.get("code"), "name": ln.get("name")},
        "date": d.isoformat(),
        "metrics": row,
        "downtime_events": andons,
        "events": events,
    })
