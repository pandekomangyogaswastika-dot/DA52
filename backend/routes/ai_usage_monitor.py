"""
Session 19 — E-3: AI Cost Monitoring API

Endpoints (prefix: /api/ai/usage)
- GET  /summary              — aggregated stats (period configurable)
- GET  /logs                 — recent log entries
- GET  /budgets              — current budget configuration
- GET  /today                — today's usage status (real-time)

Access: superadmin / admin / manager / owner only.
"""
from fastapi import APIRouter, Request, Query, HTTPException
from datetime import datetime, timezone
from auth import require_auth
from ai_cost_tracker import (
    get_usage_summary,
    get_recent_logs,
    DEFAULT_DAILY_BUDGET_USD,
    DEFAULT_MONTHLY_BUDGET_USD,
    DEFAULT_PER_FEATURE_DAILY_USD,
)
from database import get_db

router = APIRouter(prefix="/api/ai/usage", tags=["ai-usage-monitor"])


async def _check_admin(request: Request):
    user = await require_auth(request)
    if user.get("role") not in ["superadmin", "admin", "manager", "owner"]:
        raise HTTPException(403, "Admin access required")
    return user


@router.get("/summary")
async def usage_summary(request: Request, days: int = Query(7, ge=1, le=90)):
    await _check_admin(request)
    summary = await get_usage_summary(days)
    return {"success": True, "data": summary}


@router.get("/logs")
async def usage_logs(
    request: Request,
    limit: int = Query(50, ge=1, le=500),
    feature: str = Query(None),
):
    await _check_admin(request)
    logs = await get_recent_logs(limit, feature)
    return {"success": True, "data": logs}


@router.get("/budgets")
async def get_budgets(request: Request):
    await _check_admin(request)
    return {
        "success": True,
        "data": {
            "daily_usd": DEFAULT_DAILY_BUDGET_USD,
            "monthly_usd": DEFAULT_MONTHLY_BUDGET_USD,
            "per_feature_daily_usd": DEFAULT_PER_FEATURE_DAILY_USD,
            "info": "Configurable via env vars: LLM_DAILY_BUDGET_USD / LLM_MONTHLY_BUDGET_USD / LLM_PER_FEATURE_DAILY_USD",
        },
    }


@router.get("/today")
async def today_status(request: Request):
    await _check_admin(request)
    db = get_db()
    today = datetime.now(timezone.utc).date().isoformat()

    # Total today
    overall = await db.rahaza_ai_usage_logs.aggregate([
        {"$match": {"date": today}},
        {"$group": {
            "_id": None,
            "calls": {"$sum": 1},
            "successful": {"$sum": {"$cond": ["$success", 1, 0]}},
            "failed": {"$sum": {"$cond": ["$success", 0, 1]}},
            "cost_usd": {"$sum": "$cost_usd"},
            "tokens": {"$sum": "$tokens_total"},
        }},
    ]).to_list(length=1)
    stats = overall[0] if overall else {
        "calls": 0, "successful": 0, "failed": 0, "cost_usd": 0, "tokens": 0
    }
    stats.pop("_id", None)
    cost = round(stats.get("cost_usd", 0), 4)

    # Top features today
    top_features = await db.rahaza_ai_usage_logs.aggregate([
        {"$match": {"date": today}},
        {"$group": {
            "_id": "$feature",
            "calls": {"$sum": 1},
            "cost_usd": {"$sum": "$cost_usd"},
        }},
        {"$project": {
            "_id": 0, "feature": "$_id", "calls": 1,
            "cost_usd": {"$round": ["$cost_usd", 4]},
        }},
        {"$sort": {"cost_usd": -1}},
        {"$limit": 10},
    ]).to_list(length=10)

    pct_daily = (cost / DEFAULT_DAILY_BUDGET_USD * 100) if DEFAULT_DAILY_BUDGET_USD > 0 else 0
    health = (
        "critical" if pct_daily >= 100 else
        "warning" if pct_daily >= 80 else
        "monitor" if pct_daily >= 50 else
        "healthy"
    )

    return {
        "success": True,
        "data": {
            "date": today,
            "total_calls": stats.get("calls", 0),
            "successful_calls": stats.get("successful", 0),
            "failed_calls": stats.get("failed", 0),
            "total_cost_usd": cost,
            "total_tokens": stats.get("tokens", 0),
            "daily_budget_usd": DEFAULT_DAILY_BUDGET_USD,
            "budget_used_pct": round(pct_daily, 1),
            "health": health,
            "top_features": top_features,
        },
    }
