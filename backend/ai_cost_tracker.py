"""
AI Cost Tracker — central layer untuk monitor LLM usage di seluruh aplikasi.

Features:
- Tracks every LLM call: feature, user, model, tokens (estimate), latency, success/failure
- Cost estimation based on token count + model pricing
- Budget alert ketika cumulative cost mendekati limit
- Aggregation per-feature, per-day, per-user

Usage:
    from ai_cost_tracker import tracked_llm_call
    
    result = await tracked_llm_call(
        feature="daily_summary",
        user_id=user["id"],
        model=("openai", "gpt-5.1"),
        system_message="...",
        user_message="...",
        api_key=LLM_KEY,
    )
    # result.text — the LLM response
    # result.tokens_in / tokens_out — token counts
    # result.cost_usd — estimated cost
    # result.error — error if any (None if success)

Collection: rahaza_ai_usage_logs
"""
import os
import time
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Tuple
from dataclasses import dataclass
from database import get_db

logger = logging.getLogger(__name__)

# Approximate pricing per 1M tokens (USD)
# Updated 2026 — these are estimates for Emergent LLM routing
MODEL_PRICING = {
    # OpenAI
    ("openai", "gpt-5.1"): {"input": 5.0, "output": 15.0},
    ("openai", "gpt-5"): {"input": 5.0, "output": 15.0},
    ("openai", "gpt-4o"): {"input": 2.5, "output": 10.0},
    ("openai", "gpt-4o-mini"): {"input": 0.15, "output": 0.60},
    # Anthropic
    ("anthropic", "claude-sonnet-4.5"): {"input": 3.0, "output": 15.0},
    ("anthropic", "claude-sonnet-4"): {"input": 3.0, "output": 15.0},
    ("anthropic", "claude-haiku-4"): {"input": 0.25, "output": 1.25},
    # Google
    ("google", "gemini-2.0-flash"): {"input": 0.10, "output": 0.40},
    ("google", "gemini-2.5-pro"): {"input": 1.25, "output": 5.0},
    # Default fallback
    ("default", "default"): {"input": 3.0, "output": 10.0},
}

# Budget limits (configurable via env, default values)
DEFAULT_DAILY_BUDGET_USD = float(os.environ.get("LLM_DAILY_BUDGET_USD", "5.0"))
DEFAULT_MONTHLY_BUDGET_USD = float(os.environ.get("LLM_MONTHLY_BUDGET_USD", "100.0"))
DEFAULT_PER_FEATURE_DAILY_USD = float(os.environ.get("LLM_PER_FEATURE_DAILY_USD", "2.0"))


@dataclass
class TrackedResult:
    text: str = ""
    tokens_in: int = 0
    tokens_out: int = 0
    cost_usd: float = 0.0
    latency_ms: float = 0.0
    model: str = ""
    success: bool = False
    error: Optional[str] = None
    over_budget: bool = False
    budget_warning: Optional[str] = None


def _approx_tokens(text: str) -> int:
    """Rough heuristic: ~4 chars per token English, ~3 for Indonesian."""
    if not text:
        return 0
    return max(1, len(text) // 3)


def _calc_cost(model: Tuple[str, str], tokens_in: int, tokens_out: int) -> float:
    pricing = MODEL_PRICING.get(model, MODEL_PRICING[("default", "default")])
    return (tokens_in * pricing["input"] + tokens_out * pricing["output"]) / 1_000_000


async def _check_budget(db, feature: str) -> Tuple[bool, Optional[str]]:
    """Check if we're approaching budget. Returns (over_budget, warning_message)."""
    today = datetime.now(timezone.utc).date()
    month_start = today.replace(day=1)

    # Daily total
    daily_pipeline = [
        {"$match": {"date": today.isoformat(), "success": True}},
        {"$group": {"_id": None, "total": {"$sum": "$cost_usd"}}},
    ]
    daily_total_doc = await db.rahaza_ai_usage_logs.aggregate(daily_pipeline).to_list(length=1)
    daily_total = daily_total_doc[0]["total"] if daily_total_doc else 0.0

    if daily_total >= DEFAULT_DAILY_BUDGET_USD:
        return True, f"Daily budget exceeded: ${daily_total:.4f} / ${DEFAULT_DAILY_BUDGET_USD}"

    # Feature daily
    feat_pipeline = [
        {"$match": {"date": today.isoformat(), "feature": feature, "success": True}},
        {"$group": {"_id": None, "total": {"$sum": "$cost_usd"}}},
    ]
    feat_total_doc = await db.rahaza_ai_usage_logs.aggregate(feat_pipeline).to_list(length=1)
    feat_total = feat_total_doc[0]["total"] if feat_total_doc else 0.0
    if feat_total >= DEFAULT_PER_FEATURE_DAILY_USD:
        return True, f"Feature {feature} daily budget exceeded: ${feat_total:.4f} / ${DEFAULT_PER_FEATURE_DAILY_USD}"

    # Monthly total
    monthly_pipeline = [
        {"$match": {"date": {"$gte": month_start.isoformat()}, "success": True}},
        {"$group": {"_id": None, "total": {"$sum": "$cost_usd"}}},
    ]
    monthly_total_doc = await db.rahaza_ai_usage_logs.aggregate(monthly_pipeline).to_list(length=1)
    monthly_total = monthly_total_doc[0]["total"] if monthly_total_doc else 0.0
    if monthly_total >= DEFAULT_MONTHLY_BUDGET_USD:
        return True, f"Monthly budget exceeded: ${monthly_total:.4f} / ${DEFAULT_MONTHLY_BUDGET_USD}"

    # Warning thresholds
    if daily_total >= DEFAULT_DAILY_BUDGET_USD * 0.8:
        return False, f"⚠️ Daily budget 80% reached: ${daily_total:.4f} / ${DEFAULT_DAILY_BUDGET_USD}"
    if monthly_total >= DEFAULT_MONTHLY_BUDGET_USD * 0.8:
        return False, f"⚠️ Monthly budget 80% reached: ${monthly_total:.4f} / ${DEFAULT_MONTHLY_BUDGET_USD}"

    return False, None


async def log_usage(
    feature: str,
    user_id: Optional[str],
    model: Tuple[str, str],
    tokens_in: int,
    tokens_out: int,
    cost_usd: float,
    latency_ms: float,
    success: bool,
    error: Optional[str] = None,
):
    """Insert usage log into rahaza_ai_usage_logs."""
    try:
        db = get_db()
        await db.rahaza_ai_usage_logs.insert_one({
            "id": str(uuid.uuid4()),
            "feature": feature,
            "user_id": user_id,
            "model_provider": model[0] if isinstance(model, tuple) else "unknown",
            "model_name": model[1] if isinstance(model, tuple) else str(model),
            "tokens_in": int(tokens_in),
            "tokens_out": int(tokens_out),
            "tokens_total": int(tokens_in + tokens_out),
            "cost_usd": round(float(cost_usd), 6),
            "latency_ms": round(float(latency_ms), 2),
            "success": bool(success),
            "error": error,
            "date": datetime.now(timezone.utc).date().isoformat(),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as e:
        logger.warning(f"Failed to log AI usage: {e}")


async def tracked_llm_call(
    feature: str,
    user_id: Optional[str],
    model: Tuple[str, str],
    system_message: str,
    user_message: str,
    api_key: str,
    session_id: Optional[str] = None,
    skip_budget_check: bool = False,
) -> TrackedResult:
    """Wrapper that tracks LLM cost.
    
    Returns TrackedResult with .text on success, .error on failure.
    If budget exceeded, returns over_budget=True and error message.
    """
    result = TrackedResult(model=f"{model[0]}/{model[1]}")
    db = get_db()

    # Budget check
    if not skip_budget_check:
        try:
            over, warning = await _check_budget(db, feature)
            if over:
                result.over_budget = True
                result.error = warning
                result.budget_warning = warning
                return result
            if warning:
                result.budget_warning = warning
        except Exception as e:
            logger.warning(f"Budget check failed (continuing): {e}")

    # Approximate input tokens (system + user)
    tokens_in_approx = _approx_tokens(system_message) + _approx_tokens(user_message)

    start = time.time()
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(
            api_key=api_key,
            session_id=session_id or f"{feature}-{uuid.uuid4().hex[:8]}",
            system_message=system_message,
        ).with_model(*model)
        response = await chat.send_message(UserMessage(text=user_message))
        elapsed_ms = (time.time() - start) * 1000

        tokens_out_approx = _approx_tokens(response)
        cost = _calc_cost(model, tokens_in_approx, tokens_out_approx)

        result.text = response
        result.tokens_in = tokens_in_approx
        result.tokens_out = tokens_out_approx
        result.cost_usd = cost
        result.latency_ms = elapsed_ms
        result.success = True

        await log_usage(feature, user_id, model, tokens_in_approx, tokens_out_approx, cost, elapsed_ms, True)
        return result
    except Exception as e:
        elapsed_ms = (time.time() - start) * 1000
        result.error = str(e)
        result.latency_ms = elapsed_ms
        result.success = False
        await log_usage(feature, user_id, model, tokens_in_approx, 0, 0.0, elapsed_ms, False, str(e))
        return result


async def get_usage_summary(days: int = 7) -> dict:
    """Get aggregated usage stats for last N days."""
    db = get_db()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).date().isoformat()
    
    # Overall totals
    overall = await db.rahaza_ai_usage_logs.aggregate([
        {"$match": {"date": {"$gte": cutoff}}},
        {"$group": {
            "_id": None,
            "total_calls": {"$sum": 1},
            "successful_calls": {"$sum": {"$cond": ["$success", 1, 0]}},
            "failed_calls": {"$sum": {"$cond": ["$success", 0, 1]}},
            "total_cost_usd": {"$sum": "$cost_usd"},
            "total_tokens": {"$sum": "$tokens_total"},
            "avg_latency_ms": {"$avg": "$latency_ms"},
        }},
    ]).to_list(length=1)
    
    overall_stats = overall[0] if overall else {
        "total_calls": 0, "successful_calls": 0, "failed_calls": 0,
        "total_cost_usd": 0, "total_tokens": 0, "avg_latency_ms": 0,
    }
    overall_stats.pop("_id", None)

    # By feature
    by_feature = await db.rahaza_ai_usage_logs.aggregate([
        {"$match": {"date": {"$gte": cutoff}}},
        {"$group": {
            "_id": "$feature",
            "calls": {"$sum": 1},
            "successful": {"$sum": {"$cond": ["$success", 1, 0]}},
            "failed": {"$sum": {"$cond": ["$success", 0, 1]}},
            "cost_usd": {"$sum": "$cost_usd"},
            "tokens": {"$sum": "$tokens_total"},
            "avg_latency_ms": {"$avg": "$latency_ms"},
        }},
        {"$project": {
            "_id": 0, "feature": "$_id", "calls": 1, "successful": 1, "failed": 1,
            "cost_usd": {"$round": ["$cost_usd", 4]},
            "tokens": 1,
            "avg_latency_ms": {"$round": ["$avg_latency_ms", 0]},
        }},
        {"$sort": {"cost_usd": -1}},
    ]).to_list(length=100)
    
    # By day
    by_day = await db.rahaza_ai_usage_logs.aggregate([
        {"$match": {"date": {"$gte": cutoff}}},
        {"$group": {
            "_id": "$date",
            "calls": {"$sum": 1},
            "cost_usd": {"$sum": "$cost_usd"},
            "tokens": {"$sum": "$tokens_total"},
        }},
        {"$project": {
            "_id": 0, "date": "$_id", "calls": 1,
            "cost_usd": {"$round": ["$cost_usd", 4]},
            "tokens": 1,
        }},
        {"$sort": {"date": 1}},
    ]).to_list(length=days + 5)

    return {
        "period_days": days,
        "from_date": cutoff,
        "to_date": datetime.now(timezone.utc).date().isoformat(),
        "overall": {
            **overall_stats,
            "total_cost_usd": round(overall_stats.get("total_cost_usd", 0), 4),
            "avg_latency_ms": round(overall_stats.get("avg_latency_ms", 0) or 0, 0),
        },
        "by_feature": by_feature,
        "by_day": by_day,
        "budgets": {
            "daily_usd": DEFAULT_DAILY_BUDGET_USD,
            "monthly_usd": DEFAULT_MONTHLY_BUDGET_USD,
            "per_feature_daily_usd": DEFAULT_PER_FEATURE_DAILY_USD,
        },
    }


async def get_recent_logs(limit: int = 50, feature: Optional[str] = None) -> list:
    """Get recent usage log entries."""
    db = get_db()
    q = {}
    if feature:
        q["feature"] = feature
    logs = await db.rahaza_ai_usage_logs.find(q).sort("created_at", -1).to_list(length=limit)
    for log in logs:
        log.pop("_id", None)
    return logs
