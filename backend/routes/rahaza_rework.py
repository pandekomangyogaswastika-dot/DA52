"""
PT Rahaza — Phase 20B: Closed-Loop Rework Enforcement

Adds enforcement on top of existing bundle-level rework routing:
  - WO completion guard: cannot mark WO 'completed' while any child bundle
    is still in status='reworking'.
  - Rework analytics: cycle time, open count, top offenders per line/model.
  - Rework SLA settings + breach detection (reuse background loop pattern).
  - Manual rework close with reason (when bundle cycle was recovered outside scan flow).

Endpoints (prefix /api/rahaza):
  GET  /rework/summary?from=&to=                  → KPI + top offenders
  GET  /rework/open                               → open rework tasks (alias of bundles-rework + SLA flags)
  GET  /rework/work-order/{wo_id}/guard           → {can_complete: bool, blocked_bundles: [...]}
  POST /rework/bundle/{bid}/close-manual          → mark bundle reworking → back to its must_return flow with audit
  GET  /rework/settings                           → {sla_minutes: int, enabled: bool}
  PUT  /rework/settings                           → update SLA (admin)

Collections:
  rahaza_rework_settings  (id='rework_default')
  rahaza_rework_close_log (optional audit trail when manual close is used)
"""
from fastapi import APIRouter, Request, HTTPException, Query
from database import get_db
from auth import require_auth, serialize_doc
from datetime import datetime, timezone, date, timedelta
from typing import Optional
import uuid

router = APIRouter(prefix="/api/rahaza/rework", tags=["rahaza-rework"])

REWORK_SETTINGS_ID = "rework_default"
DEFAULT_REWORK_SETTINGS = {
    "id": REWORK_SETTINGS_ID,
    "sla_minutes": 120,      # alert if a bundle stays in 'reworking' > 2 hours
    "enabled": True,
}


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


async def _require_supervisor(request: Request):
    user = await require_auth(request)
    role = (user.get("role") or "").lower()
    if role in ("admin", "superadmin", "owner", "manager_production", "manager", "supervisor"):
        return user
    perms = user.get("_permissions") or []
    if "*" in perms or "prod.line.manage" in perms or "rework.manage" in perms:
        return user
    raise HTTPException(403, "Butuh role Supervisor / Manager / Admin.")


async def _require_admin(request: Request):
    user = await require_auth(request)
    role = (user.get("role") or "").lower()
    if role in ("admin", "superadmin", "owner", "manager_production"):
        return user
    perms = user.get("_permissions") or []
    if "*" in perms:
        return user
    raise HTTPException(403, "Butuh role Admin / Manager.")


# ─── Settings ───────────────────────────────────────────────────────────────
async def _get_settings(db) -> dict:
    doc = await db.rahaza_rework_settings.find_one({"id": REWORK_SETTINGS_ID}, {"_id": 0})
    if not doc:
        doc = {**DEFAULT_REWORK_SETTINGS}
        await db.rahaza_rework_settings.insert_one(doc)
        doc.pop("_id", None)
    return {**DEFAULT_REWORK_SETTINGS, **doc}


@router.get("/settings")
async def get_settings(request: Request):
    await require_auth(request)
    db = get_db()
    return serialize_doc(await _get_settings(db))


@router.put("/settings")
async def update_settings(request: Request):
    user = await _require_admin(request)
    db = get_db()
    body = await request.json() or {}
    update = {}
    if "sla_minutes" in body:
        try:
            v = int(body["sla_minutes"])
        except Exception:
            raise HTTPException(400, "sla_minutes harus integer.")
        if v < 5 or v > 24 * 60:
            raise HTTPException(400, "sla_minutes harus 5–1440.")
        update["sla_minutes"] = v
    if "enabled" in body:
        update["enabled"] = bool(body["enabled"])
    if not update:
        raise HTTPException(400, "Tidak ada field untuk diupdate.")
    update["updated_at"] = _now()
    update["updated_by"] = user.get("id")
    update["updated_by_name"] = user.get("name")
    await db.rahaza_rework_settings.update_one(
        {"id": REWORK_SETTINGS_ID},
        {"$set": update, "$setOnInsert": {"id": REWORK_SETTINGS_ID}},
        upsert=True,
    )
    return serialize_doc(await _get_settings(db))


# ─── Helpers ────────────────────────────────────────────────────────────────
async def _open_reworking_bundles(db, *, work_order_id: Optional[str] = None):
    filt = {"status": "reworking"}
    if work_order_id:
        filt["work_order_id"] = work_order_id
    return await db.rahaza_bundles.find(filt, {"_id": 0}).to_list(500)


def _age_minutes(iso_or_dt) -> int:
    if not iso_or_dt:
        return 0
    try:
        if isinstance(iso_or_dt, datetime):
            d = iso_or_dt
        else:
            d = datetime.fromisoformat(str(iso_or_dt).replace("Z", "+00:00"))
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return max(0, int((_now() - d).total_seconds() // 60))
    except Exception:
        return 0


# ─── Endpoints ──────────────────────────────────────────────────────────────
@router.get("/open")
async def open_rework(request: Request):
    """Open rework tasks (bundles in 'reworking' status) with SLA flags."""
    await require_auth(request)
    db = get_db()
    settings = await _get_settings(db)
    sla = int(settings.get("sla_minutes") or 120)

    bundles = await _open_reworking_bundles(db)

    items = []
    breach_count = 0
    for b in bundles:
        age = _age_minutes(b.get("updated_at"))
        is_breach = age > sla
        if is_breach:
            breach_count += 1

        last_fail = None
        for h in reversed(b.get("history") or []):
            if h.get("event") == "qc_fail":
                last_fail = h
                break

        items.append({
            "bundle_id": b.get("id"),
            "bundle_number": b.get("bundle_number"),
            "work_order_id": b.get("work_order_id"),
            "work_order_number": b.get("work_order_number"),
            "current_process_code": b.get("current_process_code"),
            "must_return_process": b.get("must_return_process"),
            "qty_fail": int(b.get("qty_fail") or 0),
            "qty_remaining": int(b.get("qty_remaining") or 0),
            "updated_at": b.get("updated_at"),
            "age_minutes": age,
            "sla_minutes": sla,
            "is_breach": is_breach,
            "last_fail": last_fail,
        })
    # sort by age desc (oldest first)
    items.sort(key=lambda x: -x["age_minutes"])
    return serialize_doc({
        "items": items,
        "total_open": len(items),
        "breach_count": breach_count,
        "sla_minutes": sla,
    })


@router.get("/summary")
async def rework_summary(
    request: Request,
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = None,
):
    """
    Rework KPIs over [from, to]:
      - open_now, breach_now
      - qc_fail_total_pcs (in window), qc_pass_total_pcs
      - fail_rate_pct
      - avg_cycle_minutes (resolved rework loops — from qc_fail → next qc_pass or completion)
      - top_offenders: per line + per model (by fail pcs)
    """
    await require_auth(request)
    db = get_db()
    today = date.today()
    from_d = _parse_iso(from_, today - timedelta(days=6))
    to_d = _parse_iso(to, today)
    if to_d < from_d:
        raise HTTPException(400, "Rentang tanggal tidak valid (to < from).")

    from_ts = datetime(from_d.year, from_d.month, from_d.day, tzinfo=timezone.utc)
    to_ts = datetime(to_d.year, to_d.month, to_d.day, tzinfo=timezone.utc) + timedelta(days=1)

    settings = await _get_settings(db)
    sla = int(settings.get("sla_minutes") or 120)

    # Open counts
    open_bundles = await _open_reworking_bundles(db)
    open_now = len(open_bundles)
    breach_now = 0
    open_total_fail_pcs = 0
    for b in open_bundles:
        if _age_minutes(b.get("updated_at")) > sla:
            breach_now += 1
        open_total_fail_pcs += int(b.get("qty_fail") or 0)

    # QC aggregate from wip_events
    pipe = [
        {"$match": {
            "event_type": {"$in": ["qc_pass", "qc_fail"]},
            "timestamp": {"$gte": from_ts, "$lt": to_ts},
        }},
        {"$group": {"_id": "$event_type", "qty": {"$sum": "$qty"}}},
    ]
    rows = await db.rahaza_wip_events.aggregate(pipe).to_list(500)
    qc_pass = 0
    qc_fail = 0
    for r in rows:
        if r["_id"] == "qc_pass":
            qc_pass += int(r.get("qty") or 0)
        elif r["_id"] == "qc_fail":
            qc_fail += int(r.get("qty") or 0)
    total_inspected = qc_pass + qc_fail
    fail_rate = (qc_fail / total_inspected * 100.0) if total_inspected > 0 else 0.0

    # Top offenders per line
    pipe_line = [
        {"$match": {
            "event_type": "qc_fail",
            "timestamp": {"$gte": from_ts, "$lt": to_ts},
        }},
        {"$group": {"_id": "$line_id", "fail_pcs": {"$sum": "$qty"}}},
        {"$sort": {"fail_pcs": -1}},
        {"$limit": 5},
    ]
    line_rows = await db.rahaza_wip_events.aggregate(pipe_line).to_list(500)
    line_ids = [r["_id"] for r in line_rows if r.get("_id")]
    lines = await db.rahaza_lines.find({"id": {"$in": line_ids}}, {"_id": 0}).to_list(500) if line_ids else []
    line_map = {ln["id"]: ln for ln in lines}
    top_lines = [{
        "line_id": r["_id"],
        "line_code": (line_map.get(r["_id"]) or {}).get("code"),
        "line_name": (line_map.get(r["_id"]) or {}).get("name"),
        "fail_pcs": int(r.get("fail_pcs") or 0),
    } for r in line_rows]

    # Top offenders per model
    pipe_model = [
        {"$match": {
            "event_type": "qc_fail",
            "timestamp": {"$gte": from_ts, "$lt": to_ts},
        }},
        {"$group": {"_id": "$model_id", "fail_pcs": {"$sum": "$qty"}}},
        {"$sort": {"fail_pcs": -1}},
        {"$limit": 5},
    ]
    model_rows = await db.rahaza_wip_events.aggregate(pipe_model).to_list(500)
    model_ids = [r["_id"] for r in model_rows if r.get("_id")]
    models = await db.rahaza_models.find({"id": {"$in": model_ids}}, {"_id": 0}).to_list(500) if model_ids else []
    model_map = {m["id"]: m for m in models}
    top_models = [{
        "model_id": r["_id"],
        "model_code": (model_map.get(r["_id"]) or {}).get("code"),
        "model_name": (model_map.get(r["_id"]) or {}).get("name"),
        "fail_pcs": int(r.get("fail_pcs") or 0),
    } for r in model_rows]

    # Avg cycle minutes (MVP): use bundles that left 'reworking' status in window.
    # Approximate by checking rework_resolved_at if present; else skip.
    cycle_samples = []
    cursor = db.rahaza_bundles.find({
        "history.event": "qc_fail",
    }, {"_id": 0}).limit(200)
    async for b in cursor:
        fails = [h for h in (b.get("history") or []) if h.get("event") == "qc_fail"]
        passes = [h for h in (b.get("history") or []) if h.get("event") == "qc_pass"]
        if not fails:
            continue
        fail_at = fails[-1].get("at")
        next_pass = None
        for p in passes:
            pa = p.get("at")
            if pa and fail_at and pa > fail_at:
                next_pass = pa
                break
        if fail_at and next_pass:
            try:
                t1 = datetime.fromisoformat(fail_at.replace("Z", "+00:00"))
                t2 = datetime.fromisoformat(next_pass.replace("Z", "+00:00"))
                if t1.tzinfo is None:
                    t1 = t1.replace(tzinfo=timezone.utc)
                if t2.tzinfo is None:
                    t2 = t2.replace(tzinfo=timezone.utc)
                # window filter
                if t1 >= from_ts and t1 < to_ts:
                    cycle_samples.append((t2 - t1).total_seconds() / 60.0)
            except Exception:
                pass
    avg_cycle = round(sum(cycle_samples) / len(cycle_samples), 1) if cycle_samples else None

    return serialize_doc({
        "meta": {
            "from": from_d.isoformat(), "to": to_d.isoformat(),
            "sla_minutes": sla,
        },
        "kpis": {
            "open_now": open_now,
            "breach_now": breach_now,
            "open_total_fail_pcs": int(open_total_fail_pcs),
            "qc_pass": qc_pass,
            "qc_fail": qc_fail,
            "fail_rate_pct": round(fail_rate, 2),
            "avg_cycle_minutes": avg_cycle,
            "cycle_sample_size": len(cycle_samples),
        },
        "top_offenders": {
            "by_line": top_lines,
            "by_model": top_models,
        },
    })


@router.get("/work-order/{wo_id}/guard")
async def wo_completion_guard(wo_id: str, request: Request):
    """
    Check whether a Work Order can be safely marked 'completed':
      - can_complete: True when no child bundle is in 'reworking' status.
      - blocked_bundles: list of bundles preventing completion.
    """
    await require_auth(request)
    db = get_db()
    wo = await db.rahaza_work_orders.find_one({"id": wo_id}, {"_id": 0})
    if not wo:
        raise HTTPException(404, "Work Order tidak ditemukan.")
    blocked = await db.rahaza_bundles.find(
        {"work_order_id": wo_id, "status": "reworking"},
        {"_id": 0},
    ).to_list(500)
    settings = await _get_settings(db)
    sla = int(settings.get("sla_minutes") or 120)
    items = [{
        "bundle_id": b.get("id"),
        "bundle_number": b.get("bundle_number"),
        "qty_fail": int(b.get("qty_fail") or 0),
        "age_minutes": _age_minutes(b.get("updated_at")),
        "sla_breach": _age_minutes(b.get("updated_at")) > sla,
    } for b in blocked]
    return serialize_doc({
        "work_order_id": wo_id,
        "wo_number": wo.get("wo_number"),
        "status": wo.get("status"),
        "can_complete": len(items) == 0,
        "blocked_bundles": items,
        "blocked_count": len(items),
    })


@router.post("/bundle/{bid}/close-manual")
async def close_bundle_rework_manual(bid: str, request: Request):
    """
    Manually close a reworking bundle — used when scan flow couldn't be used
    (e.g. defective pcs written off). Logs a close record for audit.

    Body: { reason: str, notes?: str, writeoff_qty?: int }
    Effect:
      - Adjusts bundle qty_fail by writeoff_qty (bounded 0..qty_fail).
      - If remaining qty_fail becomes 0: moves bundle forward along process_sequence
        (advance from must_return_process to the next non-rework step) and status='in_process'.
      - Appends history entry + records a rahaza_rework_close_log.
    """
    user = await _require_supervisor(request)
    db = get_db()

    body = await request.json() or {}
    reason = (body.get("reason") or "").strip()
    notes = (body.get("notes") or "").strip()
    writeoff_qty = int(body.get("writeoff_qty") or 0)
    if not reason:
        raise HTTPException(400, "Alasan (reason) wajib diisi.")

    b = await db.rahaza_bundles.find_one({"id": bid}, {"_id": 0})
    if not b:
        raise HTTPException(404, "Bundle tidak ditemukan.")
    if b.get("status") != "reworking":
        raise HTTPException(400, f"Bundle tidak sedang reworking (status={b.get('status')}).")

    cur_fail = int(b.get("qty_fail") or 0)
    writeoff_qty = max(0, min(writeoff_qty, cur_fail))
    new_fail = cur_fail - writeoff_qty
    new_qty_remaining = max(0, int(b.get("qty_remaining") or 0) - writeoff_qty)

    update = {
        "qty_fail": new_fail,
        "qty_remaining": new_qty_remaining,
        "updated_at": _now(),
    }

    hist = {
        "event": "rework_close_manual",
        "by": user.get("name") or user.get("email"),
        "by_id": user.get("id"),
        "at": _now(),
        "qty": writeoff_qty,
        "reason": reason,
        "notes": notes,
    }

    # If no more fails remain, advance bundle past rework (to must_return_process next step)
    if new_fail == 0:
        seq = b.get("process_sequence") or []
        mr_pid = b.get("must_return_process")
        next_step = None
        if mr_pid:
            for i, p in enumerate(seq):
                if p.get("id") == mr_pid and i + 1 < len(seq):
                    next_step = seq[i + 1]
                    break
        if next_step:
            update.update({
                "current_process_id": next_step.get("id"),
                "current_process_code": next_step.get("code"),
                "current_process_name": next_step.get("name"),
                "status": "in_process",
                "must_return_process": None,
                "rework_resolved_at": _now(),
            })
            hist["to_process_code"] = next_step.get("code")
        else:
            # Fall back: just mark in_process
            update["status"] = "in_process"

    await db.rahaza_bundles.update_one(
        {"id": bid},
        {"$set": update, "$push": {"history": hist}},
    )

    await db.rahaza_rework_close_log.insert_one({
        "id": _uid(),
        "bundle_id": bid,
        "bundle_number": b.get("bundle_number"),
        "work_order_id": b.get("work_order_id"),
        "reason": reason,
        "notes": notes,
        "writeoff_qty": writeoff_qty,
        "prior_qty_fail": cur_fail,
        "new_qty_fail": new_fail,
        "closed_by": user.get("id"),
        "closed_by_name": user.get("name"),
        "closed_at": _now(),
    })

    out = await db.rahaza_bundles.find_one({"id": bid}, {"_id": 0})
    return serialize_doc({"ok": True, "bundle": out, "writeoff_qty": writeoff_qty})
