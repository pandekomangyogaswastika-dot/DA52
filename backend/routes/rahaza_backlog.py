"""
PT Rahaza — Phase 21E: Production Backlog + Order Completion Forecast

Endpoints (prefix /api/rahaza):
  GET /backlog                     — WO backlog with risk scoring
  GET /backlog/forecast/{wo_id}    — completion forecast for specific WO
  POST /backlog/escalate/{wo_id}   — create notification/alert for WO escalation
"""
# ruff: noqa: E741
from fastapi import APIRouter, Request, HTTPException, Query
from database import get_db
from auth import require_auth
from datetime import datetime, timezone, date, timedelta
from typing import Optional
import uuid
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/rahaza", tags=["rahaza-backlog"])


def _uid():
    return str(uuid.uuid4())


def _now():
    return datetime.now(timezone.utc)


def _parse_date(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    try:
        return date.fromisoformat(s[:10])
    except Exception:
        return None


async def _get_avg_daily_output(db, line_id: Optional[str] = None, days: int = 14) -> float:
    """Get average daily output (pcs) from wip_events in past N days."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    q = {"event_type": "output", "created_at": {"$gte": cutoff}}
    if line_id:
        q["line_id"] = line_id
    events = await db.rahaza_wip_events.find(q, {"_id": 0}).to_list(500)
    if not events:
        return 50.0  # fallback default
    # Sum by day
    by_day: dict = {}
    for e in events:
        d = (e.get("created_at") or "")[:10]
        by_day[d] = by_day.get(d, 0) + (e.get("qty") or 0)
    if not by_day:
        return 50.0
    return max(sum(by_day.values()) / len(by_day), 1.0)


@router.get("/backlog")
async def get_backlog(
    request: Request,
    status_filter: Optional[str] = Query(None, alias="status"),  # released | in_progress | all
    line_id: Optional[str] = None,
    show_completed: bool = False,
):
    await require_auth(request)
    db = get_db()
    today = date.today()

    # Build query for active WOs
    q = {"status": {"$nin": ["completed", "cancelled"]}} if not show_completed else {}
    if status_filter and status_filter != "all":
        q["status"] = status_filter

    wos = await db.rahaza_work_orders.find(q, {"_id": 0}).sort("due_date", 1).to_list(500)

    # Enrich with order, model, line info
    order_ids = list({w.get("order_id") for w in wos if w.get("order_id")})
    model_ids  = list({w.get("model_id") for w in wos if w.get("model_id")})
    size_ids   = list({w.get("size_id")  for w in wos if w.get("size_id")})
    line_ids   = list({w.get("line_id")  for w in wos if w.get("line_id")})

    orders  = await db.rahaza_orders.find({"id": {"$in": order_ids}}, {"_id": 0}).to_list(500) if order_ids else []
    models  = await db.rahaza_models.find({"id": {"$in": model_ids}}, {"_id": 0}).to_list(500) if model_ids else []
    sizes   = await db.rahaza_sizes.find({"id": {"$in": size_ids}},   {"_id": 0}).to_list(500) if size_ids else []
    lines   = await db.rahaza_lines.find({"id": {"$in": line_ids}},   {"_id": 0}).to_list(500) if line_ids else []

    order_map = {o["id"]: o for o in orders}
    model_map  = {m["id"]: m for m in models}
    size_map   = {s["id"]: s for s in sizes}
    line_map   = {l["id"]: l for l in lines}

    # Get avg daily output for forecasting
    await _get_avg_daily_output(db)

    result = []
    for wo in wos:
        due = _parse_date(wo.get("due_date"))
        qty_target   = wo.get("qty") or 0
        qty_produced = wo.get("qty_produced") or 0
        qty_remaining = max(0, qty_target - qty_produced)
        pct_complete  = round(qty_produced / max(qty_target, 1) * 100, 1)

        # Forecast
        order = order_map.get(wo.get("order_id"), {})
        wo_line = wo.get("line_id")
        avg = await _get_avg_daily_output(db, wo_line, 14)
        days_to_complete = int(qty_remaining / avg) + 1 if qty_remaining > 0 else 0
        forecast_date = today + timedelta(days=days_to_complete)

        # Risk scoring
        risk = "on_track"
        days_until_due = (due - today).days if due else None
        if due:
            if today > due:
                risk = "overdue"
            elif forecast_date > due:
                risk = "at_risk"
            elif days_until_due is not None and days_until_due <= 3:
                risk = "at_risk"

        result.append({
            "id": wo["id"],
            "wo_number": wo.get("wo_number", ""),
            "order_number": order.get("order_number", ""),
            "customer_name": order.get("customer_name", ""),
            "model_name": model_map.get(wo.get("model_id"), {}).get("name", ""),
            "size_name": size_map.get(wo.get("size_id"), {}).get("name", ""),
            "line_name": line_map.get(wo.get("line_id"), {}).get("name", ""),
            "status": wo.get("status", "draft"),
            "qty": qty_target,
            "qty_produced": qty_produced,
            "qty_remaining": qty_remaining,
            "pct_complete": pct_complete,
            "due_date": wo.get("due_date", ""),
            "days_until_due": days_until_due,
            "forecast_date": forecast_date.isoformat(),
            "days_to_complete": days_to_complete,
            "avg_daily_output": round(avg, 1),
            "risk": risk,  # on_track | at_risk | overdue
        })

    # Sort: overdue first, then at_risk, then on_track
    risk_order = {"overdue": 0, "at_risk": 1, "on_track": 2}
    result.sort(key=lambda x: (risk_order.get(x["risk"], 3), x.get("due_date") or "9999"))

    summary = {
        "total": len(result),
        "overdue": sum(1 for r in result if r["risk"] == "overdue"),
        "at_risk": sum(1 for r in result if r["risk"] == "at_risk"),
        "on_track": sum(1 for r in result if r["risk"] == "on_track"),
    }
    return {"summary": summary, "data": result}


@router.post("/backlog/escalate/{wo_id}")
async def escalate_wo(wo_id: str, request: Request):
    user = await require_auth(request)
    db = get_db()
    wo = await db.rahaza_work_orders.find_one({"id": wo_id}, {"_id": 0})
    if not wo:
        raise HTTPException(404, "Work Order tidak ditemukan.")
    # Create a notification via unified SSOT helper (type='rahaza')
    from routes.rahaza_notifications import publish_notification
    notif = await publish_notification(
        db,
        type_="escalation",
        severity="warning",
        title=f"Eskalasi WO: {wo.get('wo_number', wo_id)}",
        message=(
            f"WO {wo.get('wo_number', wo_id)} dieskalasi oleh "
            f"{user.get('name', 'user')}. Perlu perhatian segera."
        ),
        link_module="backlog",
        link_id=wo_id,
        target_roles=["production_manager", "supervisor", "superadmin"],
    )
    return {"ok": True, "notification_id": (notif or {}).get("id")}
