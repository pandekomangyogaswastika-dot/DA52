"""Finance aggregates for AI endpoints.

Replaces fetch-and-sum-in-Python patterns with MongoDB aggregation pipelines.
All functions return small, AI-ready dicts.
"""
from __future__ import annotations

from datetime import datetime, timezone


async def daily_finance_metrics(db, *, since_iso: str) -> dict:
    """Return invoice rollup since `since_iso`.

    Output keys: invoice_count, paid_count, total_invoiced_rp.
    Uses single aggregation; previous implementation fetched up to 100 docs.
    """
    pipeline = [
        {"$match": {"date": {"$gte": since_iso}}},
        {"$group": {
            "_id": None,
            "invoice_count": {"$sum": 1},
            "paid_count": {
                "$sum": {"$cond": [{"$eq": ["$status", "paid"]}, 1, 0]},
            },
            "total_invoiced_rp": {"$sum": {"$toDouble": {"$ifNull": ["$total", 0]}}},
        }},
    ]
    rows = await db.rahaza_invoices.aggregate(pipeline).to_list(1)
    if not rows:
        return {"invoice_count": 0, "paid_count": 0, "total_invoiced_rp": 0.0}
    r = rows[0]
    return {
        "invoice_count": int(r.get("invoice_count") or 0),
        "paid_count": int(r.get("paid_count") or 0),
        "total_invoiced_rp": float(r.get("total_invoiced_rp") or 0.0),
    }


async def daily_live_session_revenue(db, *, since: datetime) -> dict:
    """Aggregate marketing live session revenue since timestamp."""
    pipeline = [
        {"$match": {"session_date": {"$gte": since}}},
        {"$group": {
            "_id": None,
            "session_count": {"$sum": 1},
            "revenue_rp": {"$sum": {"$toDouble": {"$ifNull": ["$revenue", 0]}}},
        }},
    ]
    rows = await db.marketing_live_sessions.aggregate(pipeline).to_list(1)
    if not rows:
        return {"session_count": 0, "revenue_rp": 0.0}
    r = rows[0]
    return {
        "session_count": int(r.get("session_count") or 0),
        "revenue_rp": float(r.get("revenue_rp") or 0.0),
    }


async def monthly_revenue_rollup(
    db, *, since_iso: str, lmo_adapter, since_datetime: datetime,
) -> list[dict]:
    """Return monthly revenue rollup combining invoices, maklon, and live sessions.

    Args:
        db: motor Database.
        since_iso: ISO 8601 string for invoice/maklon date filter.
        lmo_adapter: callable producing the maklon view (`_lmo(db)`).
        since_datetime: datetime for `marketing_live_sessions.session_date`.

    Returns: list[{month, invoice_rp, maklon_rp, live_rp, total_rp}] sorted asc.
    """
    # Invoice monthly
    inv_pipeline = [
        {"$match": {"date": {"$gte": since_iso}}},
        {"$project": {
            "_id": 0,
            "month": {"$substr": ["$date", 0, 7]},
            "total": {"$toDouble": {"$ifNull": ["$total", 0]}},
        }},
        {"$group": {"_id": "$month", "total": {"$sum": "$total"}}},
    ]
    inv_rows = await db.rahaza_invoices.aggregate(inv_pipeline).to_list(60)

    # Maklon monthly (via SSOT view)
    mak_pipeline = [
        {"$match": {"stage": "invoiced", "updated_at": {"$gte": since_iso}}},
        {"$project": {
            "_id": 0,
            "month": {"$substr": ["$updated_at", 0, 7]},
            "total": {"$toDouble": {"$ifNull": ["$total_price", 0]}},
        }},
        {"$group": {"_id": "$month", "total": {"$sum": "$total"}}},
    ]
    mak_rows = await lmo_adapter(db).aggregate(mak_pipeline).to_list(60)

    # Live sessions monthly
    live_pipeline = [
        {"$match": {"session_date": {"$gte": since_datetime}}},
        {"$project": {
            "_id": 0,
            "month": {"$dateToString": {"format": "%Y-%m", "date": "$session_date"}},
            "revenue": {"$toDouble": {"$ifNull": ["$revenue", 0]}},
        }},
        {"$group": {"_id": "$month", "total": {"$sum": "$revenue"}}},
    ]
    live_rows = await db.marketing_live_sessions.aggregate(live_pipeline).to_list(60)

    monthly: dict[str, dict[str, float]] = {}
    for r in inv_rows:
        m = r.get("_id") or ""
        if m:
            monthly.setdefault(m, {"invoice": 0.0, "maklon": 0.0, "live": 0.0})
            monthly[m]["invoice"] = float(r.get("total") or 0)
    for r in mak_rows:
        m = r.get("_id") or ""
        if m:
            monthly.setdefault(m, {"invoice": 0.0, "maklon": 0.0, "live": 0.0})
            monthly[m]["maklon"] = float(r.get("total") or 0)
    for r in live_rows:
        m = r.get("_id") or ""
        if m:
            monthly.setdefault(m, {"invoice": 0.0, "maklon": 0.0, "live": 0.0})
            monthly[m]["live"] = float(r.get("total") or 0)

    return [
        {
            "month": m,
            "invoice_rp": round(v["invoice"]),
            "maklon_rp": round(v["maklon"]),
            "live_rp": round(v["live"]),
            "total_rp": round(v["invoice"] + v["maklon"] + v["live"]),
        }
        for m, v in sorted(monthly.items())
    ]


async def fraud_detection_signals(db, *, since_iso: str, since_dt: datetime) -> dict:
    """Compute statistical signals for fraud detection (no full-doc fetch).

    Returns:
        dict with invoice_stats (avg, std, count, top_outliers list),
        payment_count, large_adjustments list.
    """
    # Invoice basic stats via aggregation
    inv_stats_pipeline = [
        {"$match": {"date": {"$gte": since_iso}}},
        {"$group": {
            "_id": None,
            "count": {"$sum": 1},
            "avg": {"$avg": {"$toDouble": {"$ifNull": ["$total", 0]}}},
            "stdDev": {"$stdDevPop": {"$toDouble": {"$ifNull": ["$total", 0]}}},
        }},
    ]
    inv_stats_rows = await db.rahaza_invoices.aggregate(inv_stats_pipeline).to_list(1)
    stats = inv_stats_rows[0] if inv_stats_rows else {"count": 0, "avg": 0.0, "stdDev": 0.0}
    avg = float(stats.get("avg") or 0)
    std = float(stats.get("stdDev") or 0)

    # Outlier invoices (>= 3 sigma) — server-side filter, hard limit
    outliers: list[dict] = []
    if std > 0:
        threshold_low = avg - 3 * std
        threshold_high = avg + 3 * std
        cursor = db.rahaza_invoices.find(
            {
                "date": {"$gte": since_iso},
                "$or": [
                    {"total": {"$lt": threshold_low}},
                    {"total": {"$gt": threshold_high}},
                ],
            },
            {"_id": 0, "id": 1, "date": 1, "total": 1, "status": 1, "type": 1},
        ).limit(20)
        async for inv in cursor:
            outliers.append({
                "type": "invoice_anomaly",
                "id": inv.get("id"),
                "total": float(inv.get("total") or 0),
                "expected_range": f"{round(avg - 2 * std):,} - {round(avg + 2 * std):,}",
            })

    payment_count = await db.rahaza_payments.count_documents({"date": {"$gte": since_iso}})

    # Large stock adjustments — only field projections + DB sort
    adj_pipeline = [
        {"$match": {
            "created_at": {"$gte": since_dt},
            "movement_type": {"$in": ["adjustment", "reset", "outbound_rm", "inbound_rm"]},
        }},
        {"$project": {
            "_id": 0,
            "id": 1, "sku": 1, "material_code": 1,
            "qty": 1, "movement_type": 1,
            "abs_qty": {"$abs": {"$toDouble": {"$ifNull": ["$qty", 0]}}},
        }},
        {"$sort": {"abs_qty": -1}},
        {"$limit": 20},
    ]
    adj_rows = await db.rahaza_material_movements.aggregate(adj_pipeline).to_list(20)

    return {
        "invoice_stats": {
            "count": int(stats.get("count") or 0),
            "avg": round(avg),
            "std": round(std),
        },
        "top_invoice_outliers": outliers,
        "payment_count": payment_count,
        "top_stock_adjustments": [
            {
                "id": a.get("id"),
                "sku": a.get("sku") or a.get("material_code"),
                "qty": float(a.get("qty") or 0),
                "movement_type": a.get("movement_type"),
            }
            for a in adj_rows
        ],
    }


def now_utc() -> datetime:
    return datetime.now(timezone.utc)
