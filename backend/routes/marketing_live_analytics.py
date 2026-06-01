"""Live Session Analytics — Phase 3 P1.

Endpoints:
  GET  /api/marketing/live/analytics/overview        — KPI snapshot + platform share
  GET  /api/marketing/live/analytics/platform-breakdown — per-platform deep-dive
  GET  /api/marketing/live/analytics/sessions-comparison — top N sessions
  GET  /api/marketing/live/analytics/host-leaderboard   — host ranking
  GET  /api/marketing/live/analytics/revenue-trend      — daily/weekly revenue trend
  GET  /api/marketing/live/analytics/product-performance — top products sold on live
  GET  /api/marketing/live/analytics/account-health    — per-account health score

All endpoints require auth, return JSON with ok:true.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Query, Request

from auth import require_auth
from database import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/marketing/live/analytics", tags=["live-analytics"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _date_range(days: int) -> tuple[str, str]:
    end = _now()
    start = end - timedelta(days=days)
    return start.isoformat(), end.isoformat()


# ---------------------------------------------------------------------------
# Helper: aggregate sessions
# ---------------------------------------------------------------------------
async def _sessions_in_range(db, start_iso: str, end_iso: str, platform: Optional[str] = None) -> list:
    match: dict = {"session_date": {"$gte": start_iso[:10], "$lte": end_iso[:10]}}
    if platform:
        match["platform"] = platform
    pipeline = [
        {"$match": match},
        {"$project": {
            "_id": 0,
            "id": 1, "session_date": 1, "platform": 1, "host_name": 1,
            "account_name": 1, "duration_minutes": {"$ifNull": ["$duration_minutes", 0]},
            "peak_viewers": {"$ifNull": ["$peak_viewers", 0]},
            "total_revenue": {"$ifNull": ["$total_revenue", 0]},
            "orders_count": {"$ifNull": ["$orders_count", 0]},
            "units_sold": {"$ifNull": ["$units_sold", 0]},
            "conversion_rate": {"$ifNull": ["$conversion_rate", 0]},
            "avg_order_value": {"$ifNull": ["$avg_order_value", 0]},
        }},
    ]
    return await db.marketing_live_sessions.aggregate(pipeline).to_list(2000)


# ---------------------------------------------------------------------------
# 1. Overview KPI
# ---------------------------------------------------------------------------
@router.get("/overview")
async def analytics_overview(
    request: Request,
    days: int = Query(30, ge=1, le=365),
    platform: Optional[str] = None,
):
    await require_auth(request)
    db = get_db()
    start, end = _date_range(days)
    sessions = await _sessions_in_range(db, start, end, platform)

    if not sessions:
        return {
            "ok": True, "days": days, "platform_filter": platform,
            "kpi": {"total_sessions": 0, "total_revenue_rp": 0, "total_orders": 0,
                    "total_units": 0, "avg_revenue_per_session": 0, "avg_viewers": 0,
                    "avg_conversion_rate": 0, "top_platform": None},
            "platform_share": [], "daily_trend": [],
        }

    total_rev = sum(s["total_revenue"] for s in sessions)
    total_orders = sum(s["orders_count"] for s in sessions)
    total_units = sum(s["units_sold"] for s in sessions)
    total_viewers = sum(s["peak_viewers"] for s in sessions)
    n = len(sessions)
    avg_conv = sum(s["conversion_rate"] for s in sessions) / max(n, 1)

    # Previous period for delta calculation
    prev_start, prev_end = _date_range(days * 2)
    prev_sessions = await _sessions_in_range(
        db,
        (datetime.fromisoformat(start) - timedelta(days=days)).isoformat(),
        start,
        platform,
    )
    prev_rev = sum(s["total_revenue"] for s in prev_sessions)
    rev_delta_pct = (
        round((total_rev - prev_rev) / max(prev_rev, 1) * 100, 1)
        if prev_rev else None
    )

    # Platform breakdown for share
    plat_agg: dict[str, dict] = {}
    for s in sessions:
        p = s["platform"] or "unknown"
        if p not in plat_agg:
            plat_agg[p] = {"sessions": 0, "revenue": 0, "orders": 0}
        plat_agg[p]["sessions"] += 1
        plat_agg[p]["revenue"] += s["total_revenue"]
        plat_agg[p]["orders"] += s["orders_count"]

    platform_share = sorted(
        [
            {
                "platform": k,
                "sessions": v["sessions"],
                "revenue": v["revenue"],
                "orders": v["orders"],
                "revenue_share_pct": round(v["revenue"] / max(total_rev, 1) * 100, 1),
            }
            for k, v in plat_agg.items()
        ],
        key=lambda x: x["revenue"],
        reverse=True,
    )
    top_platform = platform_share[0]["platform"] if platform_share else None

    # Daily trend (last 30 days)
    day_agg: dict[str, dict] = {}
    for s in sessions:
        day = s["session_date"][:10]
        if day not in day_agg:
            day_agg[day] = {"sessions": 0, "revenue": 0, "orders": 0}
        day_agg[day]["sessions"] += 1
        day_agg[day]["revenue"] += s["total_revenue"]
        day_agg[day]["orders"] += s["orders_count"]
    daily_trend = [
        {"date": d, **v}
        for d, v in sorted(day_agg.items())
    ]

    return {
        "ok": True,
        "days": days,
        "platform_filter": platform,
        "kpi": {
            "total_sessions": n,
            "total_revenue_rp": total_rev,
            "total_orders": total_orders,
            "total_units": total_units,
            "avg_revenue_per_session": round(total_rev / max(n, 1), 0),
            "avg_viewers": round(total_viewers / max(n, 1), 0),
            "avg_conversion_rate": round(avg_conv, 2),
            "top_platform": top_platform,
            "revenue_delta_vs_prev_period_pct": rev_delta_pct,
        },
        "platform_share": platform_share,
        "daily_trend": daily_trend,
    }


# ---------------------------------------------------------------------------
# 2. Platform Breakdown
# ---------------------------------------------------------------------------
@router.get("/platform-breakdown")
async def platform_breakdown(
    request: Request,
    days: int = Query(30, ge=1, le=365),
    platform: str = Query("shopee"),
):
    await require_auth(request)
    db = get_db()
    start, end = _date_range(days)
    sessions = await _sessions_in_range(db, start, end, platform)

    if not sessions:
        return {"ok": True, "platform": platform, "days": days, "data": {}}

    n = len(sessions)
    total_rev = sum(s["total_revenue"] for s in sessions)
    total_orders = sum(s["orders_count"] for s in sessions)
    total_units = sum(s["units_sold"] for s in sessions)
    avg_viewers = sum(s["peak_viewers"] for s in sessions) / max(n, 1)
    avg_duration = sum(s["duration_minutes"] for s in sessions) / max(n, 1)
    avg_conv = sum(s["conversion_rate"] for s in sessions) / max(n, 1)
    avg_aov = sum(s["avg_order_value"] for s in sessions) / max(n, 1)

    # Revenue per duration (productivity metric)
    total_duration = sum(s["duration_minutes"] for s in sessions)
    rev_per_min = total_rev / max(total_duration, 1)

    # Weekly breakdown
    week_agg: dict[str, dict] = {}
    for s in sessions:
        try:
            d = datetime.fromisoformat(s["session_date"][:10])
        except (ValueError, TypeError):
            continue
        week_label = f"W{d.isocalendar()[1]}-{d.year}"
        if week_label not in week_agg:
            week_agg[week_label] = {"revenue": 0, "sessions": 0, "orders": 0}
        week_agg[week_label]["revenue"] += s["total_revenue"]
        week_agg[week_label]["sessions"] += 1
        week_agg[week_label]["orders"] += s["orders_count"]
    weekly = [{"week": w, **v} for w, v in sorted(week_agg.items())]

    return {
        "ok": True,
        "platform": platform,
        "days": days,
        "data": {
            "total_sessions": n,
            "total_revenue_rp": total_rev,
            "total_orders": total_orders,
            "total_units": total_units,
            "avg_peak_viewers": round(avg_viewers, 0),
            "avg_duration_min": round(avg_duration, 0),
            "avg_conversion_rate": round(avg_conv, 2),
            "avg_order_value": round(avg_aov, 0),
            "revenue_per_minute": round(rev_per_min, 0),
        },
        "weekly_trend": weekly,
    }


# ---------------------------------------------------------------------------
# 3. Sessions Comparison (Top N)
# ---------------------------------------------------------------------------
@router.get("/sessions-comparison")
async def sessions_comparison(
    request: Request,
    days: int = Query(30, ge=1, le=180),
    platform: Optional[str] = None,
    sort_by: str = Query("total_revenue", regex="^(total_revenue|orders_count|peak_viewers|conversion_rate|units_sold)$"),
    limit: int = Query(10, ge=1, le=50),
):
    await require_auth(request)
    db = get_db()
    start, end = _date_range(days)
    sessions = await _sessions_in_range(db, start, end, platform)
    if not sessions:
        return {"ok": True, "data": [], "total": 0}

    sorted_sessions = sorted(sessions, key=lambda x: x.get(sort_by, 0), reverse=True)
    top = sorted_sessions[:limit]
    avg_rev = sum(s["total_revenue"] for s in sessions) / max(len(sessions), 1)

    result = [
        {
            "rank": i + 1,
            "id": s["id"],
            "session_date": s["session_date"],
            "platform": s["platform"],
            "host_name": s.get("host_name", ""),
            "account_name": s.get("account_name", ""),
            "duration_min": s["duration_minutes"],
            "peak_viewers": s["peak_viewers"],
            "total_revenue": s["total_revenue"],
            "orders_count": s["orders_count"],
            "units_sold": s["units_sold"],
            "conversion_rate": s["conversion_rate"],
            "avg_order_value": s["avg_order_value"],
            "vs_avg_pct": round((s["total_revenue"] - avg_rev) / max(avg_rev, 1) * 100, 1),
        }
        for i, s in enumerate(top)
    ]
    return {"ok": True, "data": result, "total": len(sessions), "avg_revenue": round(avg_rev, 0)}


# ---------------------------------------------------------------------------
# 4. Host Leaderboard
# ---------------------------------------------------------------------------
@router.get("/host-leaderboard")
async def host_leaderboard(
    request: Request,
    days: int = Query(30, ge=1, le=180),
    platform: Optional[str] = None,
    limit: int = Query(10, ge=1, le=30),
):
    await require_auth(request)
    db = get_db()
    start, end = _date_range(days)
    sessions = await _sessions_in_range(db, start, end, platform)
    if not sessions:
        return {"ok": True, "data": []}

    host_agg: dict[str, dict] = {}
    for s in sessions:
        host = s.get("host_name") or "Unknown"
        if host not in host_agg:
            host_agg[host] = {
                "sessions": 0, "revenue": 0, "orders": 0, "units": 0,
                "total_viewers": 0, "total_duration": 0, "total_conv": 0.0,
            }
        host_agg[host]["sessions"] += 1
        host_agg[host]["revenue"] += s["total_revenue"]
        host_agg[host]["orders"] += s["orders_count"]
        host_agg[host]["units"] += s["units_sold"]
        host_agg[host]["total_viewers"] += s["peak_viewers"]
        host_agg[host]["total_duration"] += s["duration_minutes"]
        host_agg[host]["total_conv"] += s["conversion_rate"]

    leaderboard = sorted(
        [
            {
                "rank": 0,
                "host_name": host,
                "total_sessions": v["sessions"],
                "total_revenue": v["revenue"],
                "total_orders": v["orders"],
                "total_units": v["units"],
                "avg_revenue_per_session": round(v["revenue"] / max(v["sessions"], 1), 0),
                "avg_viewers": round(v["total_viewers"] / max(v["sessions"], 1), 0),
                "avg_duration_min": round(v["total_duration"] / max(v["sessions"], 1), 0),
                "avg_conversion_rate": round(v["total_conv"] / max(v["sessions"], 1), 2),
            }
            for host, v in host_agg.items()
        ],
        key=lambda x: x["total_revenue"],
        reverse=True,
    )[:limit]

    for i, h in enumerate(leaderboard):
        h["rank"] = i + 1

    return {"ok": True, "data": leaderboard, "days": days}


# ---------------------------------------------------------------------------
# 5. Revenue Trend
# ---------------------------------------------------------------------------
@router.get("/revenue-trend")
async def revenue_trend(
    request: Request,
    days: int = Query(90, ge=7, le=365),
    granularity: str = Query("weekly", regex="^(daily|weekly|monthly)$"),
    platform: Optional[str] = None,
):
    await require_auth(request)
    db = get_db()
    start, end = _date_range(days)
    sessions = await _sessions_in_range(db, start, end, platform)
    if not sessions:
        return {"ok": True, "granularity": granularity, "data": []}

    bucket_agg: dict[str, dict] = {}

    for s in sessions:
        try:
            d = datetime.fromisoformat(s["session_date"][:10])
        except (ValueError, TypeError):
            continue
        if granularity == "daily":
            key = d.strftime("%Y-%m-%d")
        elif granularity == "weekly":
            key = f"{d.year}-W{d.isocalendar()[1]:02d}"
        else:
            key = d.strftime("%Y-%m")

        if key not in bucket_agg:
            bucket_agg[key] = {"revenue": 0, "orders": 0, "sessions": 0, "units": 0}
        bucket_agg[key]["revenue"] += s["total_revenue"]
        bucket_agg[key]["orders"] += s["orders_count"]
        bucket_agg[key]["sessions"] += 1
        bucket_agg[key]["units"] += s["units_sold"]

    trend = [
        {"period": k, **v, "avg_revenue_per_session": round(v["revenue"] / max(v["sessions"], 1), 0)}
        for k, v in sorted(bucket_agg.items())
    ]

    # Growth rate (MoM / WoW)
    growth = None
    if len(trend) >= 2:
        last = trend[-1]["revenue"]
        prev = trend[-2]["revenue"]
        growth = round((last - prev) / max(prev, 1) * 100, 1)

    return {
        "ok": True,
        "granularity": granularity,
        "days": days,
        "platform_filter": platform,
        "growth_rate_pct": growth,
        "data": trend,
    }


# ---------------------------------------------------------------------------
# 6. Product Performance on Live
# ---------------------------------------------------------------------------
@router.get("/product-performance")
async def product_performance(
    request: Request,
    days: int = Query(30, ge=1, le=180),
    platform: Optional[str] = None,
    limit: int = Query(15, ge=1, le=50),
):
    await require_auth(request)
    db = get_db()
    start, end = _date_range(days)

    match: dict = {"session_date": {"$gte": start[:10], "$lte": end[:10]}}
    if platform:
        match["platform"] = platform

    # Aggregate from sessions items array if exists, otherwise from live_session_products collection
    pipeline = [
        {"$match": match},
        {"$unwind": {"path": "$products", "preserveNullAndEmptyArrays": False}},
        {"$group": {
            "_id": {"sku": "$products.sku", "name": "$products.name"},
            "total_units_sold": {"$sum": {"$ifNull": ["$products.units_sold", 0]}},
            "total_revenue": {"$sum": {"$ifNull": ["$products.revenue", 0]}},
            "sessions_featured": {"$sum": 1},
        }},
        {"$sort": {"total_revenue": -1}},
        {"$limit": limit},
    ]
    rows = await db.marketing_live_sessions.aggregate(pipeline).to_list(limit)

    # If no products embedded in sessions, fallback to aggregating by total units
    if not rows:
        sessions = await _sessions_in_range(db, start, end, platform)
        if not sessions:
            return {"ok": True, "data": [], "note": "No product-level data available"}
        # Return session-level products placeholder
        return {"ok": True, "data": [], "note": "Product-level data not embedded in sessions yet"}

    return {
        "ok": True,
        "data": [
            {
                "rank": i + 1,
                "sku": r["_id"].get("sku", ""),
                "name": r["_id"].get("name", ""),
                "total_units_sold": r["total_units_sold"],
                "total_revenue": r["total_revenue"],
                "sessions_featured": r["sessions_featured"],
                "revenue_per_session": round(r["total_revenue"] / max(r["sessions_featured"], 1), 0),
            }
            for i, r in enumerate(rows)
        ],
        "days": days,
        "platform_filter": platform,
    }


# ---------------------------------------------------------------------------
# 7. Account Health Score
# ---------------------------------------------------------------------------
@router.get("/account-health")
async def account_health(
    request: Request,
    days: int = Query(30, ge=7, le=180),
):
    await require_auth(request)
    db = get_db()
    start, end = _date_range(days)
    sessions = await _sessions_in_range(db, start, end)
    if not sessions:
        return {"ok": True, "data": []}

    acct_agg: dict[str, dict] = {}
    for s in sessions:
        acct = s.get("account_name") or "Unknown"
        plat = s.get("platform") or "unknown"
        key = f"{acct}|{plat}"
        if key not in acct_agg:
            acct_agg[key] = {
                "account_name": acct, "platform": plat,
                "sessions": 0, "revenue": 0, "orders": 0,
                "total_conv": 0.0, "total_viewers": 0,
            }
        acct_agg[key]["sessions"] += 1
        acct_agg[key]["revenue"] += s["total_revenue"]
        acct_agg[key]["orders"] += s["orders_count"]
        acct_agg[key]["total_conv"] += s["conversion_rate"]
        acct_agg[key]["total_viewers"] += s["peak_viewers"]

    # Global averages for scoring
    all_revs = [v["revenue"] for v in acct_agg.values()]
    all_convs = [v["total_conv"] / max(v["sessions"], 1) for v in acct_agg.values()]
    avg_rev = sum(all_revs) / max(len(all_revs), 1)
    avg_conv = sum(all_convs) / max(len(all_convs), 1)

    def _health_score(rev: float, conv: float, sessions: int) -> int:
        """0-100 score: 50% revenue vs avg, 30% conversion vs avg, 20% frequency."""
        rev_score = min(100, round((rev / max(avg_rev, 1)) * 50))
        conv_score = min(100, round((conv / max(avg_conv, 0.01)) * 30))
        freq_score = min(20, sessions * 2)
        return min(100, rev_score + conv_score + freq_score)

    result = sorted(
        [
            {
                "account_name": v["account_name"],
                "platform": v["platform"],
                "sessions": v["sessions"],
                "total_revenue": v["revenue"],
                "total_orders": v["orders"],
                "avg_conversion_rate": round(v["total_conv"] / max(v["sessions"], 1), 2),
                "avg_viewers": round(v["total_viewers"] / max(v["sessions"], 1), 0),
                "health_score": _health_score(
                    v["revenue"],
                    v["total_conv"] / max(v["sessions"], 1),
                    v["sessions"],
                ),
            }
            for v in acct_agg.values()
        ],
        key=lambda x: x["health_score"],
        reverse=True,
    )

    for item in result:
        hs = item["health_score"]
        item["health_status"] = "excellent" if hs >= 80 else "good" if hs >= 60 else "fair" if hs >= 40 else "poor"

    return {"ok": True, "data": result, "days": days}
