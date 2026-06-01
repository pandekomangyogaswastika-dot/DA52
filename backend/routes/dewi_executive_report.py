"""Executive Report Hub — Phase 3 P1.

Consolidated cross-module KPI dashboard for management.

Endpoints:
  GET  /api/reports/executive/summary          — full executive snapshot
  GET  /api/reports/executive/kpi-comparison   — month-on-month KPI comparison
  GET  /api/reports/executive/finance-snapshot — finance KPIs (AR, revenue, cash)
  GET  /api/reports/executive/production-snapshot — production KPIs
  GET  /api/reports/executive/hr-snapshot      — HR KPIs
  GET  /api/reports/executive/marketing-snapshot — marketing KPIs
  GET  /api/reports/executive/trend            — multi-KPI trend (last N months)
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Query, Request

from auth import require_auth
from database import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/reports/executive", tags=["executive-report"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _month_range(year: int, month: int) -> tuple[str, str]:
    start = date(year, month, 1).isoformat()
    if month == 12:
        end = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        end = date(year, month + 1, 1) - timedelta(days=1)
    return start, end.isoformat()


def _prev_month(year: int, month: int) -> tuple[int, int]:
    if month == 1:
        return year - 1, 12
    return year, month - 1


def _delta_pct(curr: float, prev: float) -> Optional[float]:
    if not prev:
        return None
    return round((curr - prev) / prev * 100, 1)


# ---------------------------------------------------------------------------
# Finance aggregations
# ---------------------------------------------------------------------------
async def _finance_kpis(db, year: int, month: int) -> dict:
    start, end = _month_range(year, month)

    # Revenue (finalized invoices)
    rev_pipeline = [
        {"$match": {
            "invoice_date": {"$gte": start, "$lte": end},
            "status": {"$in": ["paid", "partial", "sent", "overdue"]},
        }},
        {"$group": {"_id": None,
                    "total_revenue": {"$sum": {"$ifNull": ["$total_amount", 0]}},
                    "total_paid": {"$sum": {"$cond": [{"$eq": ["$status", "paid"]}, "$total_amount", 0]}},
                    "invoice_count": {"$sum": 1}}},
    ]
    rev_rows = await db.invoices.aggregate(rev_pipeline).to_list(1)
    rev_data = rev_rows[0] if rev_rows else {}

    # Expenses (journal debit entries to expense accounts)
    exp_pipeline = [
        {"$match": {"date": {"$gte": start, "$lte": end}, "entries.type": "debit"}},
        {"$unwind": "$entries"},
        {"$match": {"entries.type": "debit", "entries.account_code": {"$regex": "^[56]"}}},
        {"$group": {"_id": None, "total": {"$sum": {"$ifNull": ["$entries.amount", 0]}}}},
    ]
    exp_rows = await db.journal_entries.aggregate(exp_pipeline).to_list(1)
    total_expenses = exp_rows[0]["total"] if exp_rows else 0

    # AR overdue
    today = date.today().isoformat()
    ar_overdue_pipeline = [
        {"$match": {"status": "overdue", "due_date": {"$lte": today}}},
        {"$group": {"_id": None, "total": {"$sum": {"$ifNull": ["$balance_due", 0]}}, "count": {"$sum": 1}}},
    ]
    ar_rows = await db.invoices.aggregate(ar_overdue_pipeline).to_list(1)
    ar_data = ar_rows[0] if ar_rows else {}

    revenue = float(rev_data.get("total_revenue") or 0)
    net_income = revenue - total_expenses

    return {
        "revenue_rp": revenue,
        "paid_revenue_rp": float(rev_data.get("total_paid") or 0),
        "invoice_count": int(rev_data.get("invoice_count") or 0),
        "total_expenses_rp": total_expenses,
        "net_income_rp": net_income,
        "profit_margin_pct": round(net_income / max(revenue, 1) * 100, 1),
        "ar_overdue_rp": float(ar_data.get("total") or 0),
        "ar_overdue_count": int(ar_data.get("count") or 0),
    }


# ---------------------------------------------------------------------------
# Production aggregations
# ---------------------------------------------------------------------------
async def _production_kpis(db, year: int, month: int) -> dict:
    start, end = _month_range(year, month)
    wo_pipeline = [
        {"$match": {"created_at": {"$gte": start, "$lte": end}}},
        {"$group": {
            "_id": "$status",
            "count": {"$sum": 1},
            "total_qty": {"$sum": {"$ifNull": ["$quantity", 0]}},
            "total_completed": {"$sum": {"$ifNull": ["$qty_completed", 0]}},
        }},
    ]
    wo_rows = await db.production_work_orders.aggregate(wo_pipeline).to_list(20)
    wo_by_status: dict = {}
    for r in wo_rows:
        wo_by_status[r["_id"] or "unknown"] = {"count": r["count"], "qty": r["total_qty"], "completed": r["total_completed"]}

    total_wo = sum(v["count"] for v in wo_by_status.values())
    completed_wo = wo_by_status.get("completed", {}).get("count", 0)
    active_wo = sum(v["count"] for k, v in wo_by_status.items() if k in ("in_progress", "pending"))
    total_qty = sum(v["qty"] for v in wo_by_status.values())
    total_completed = sum(v["completed"] for v in wo_by_status.values())

    # CMT orders
    cmt_count = await db.dewi_cmt_orders.count_documents(
        {"created_at": {"$gte": start, "$lte": end}}
    )

    # QC defect rate (from last WO QC records)
    qc_pipeline = [
        {"$match": {"inspected_at": {"$gte": start, "$lte": end}}},
        {"$group": {
            "_id": None,
            "total_inspected": {"$sum": {"$ifNull": ["$inspected_qty", 0]}},
            "total_defects": {"$sum": {"$ifNull": ["$defect_qty", 0]}},
        }},
    ]
    qc_rows = await db.rahaza_qc_records.aggregate(qc_pipeline).to_list(1)
    qc_data = qc_rows[0] if qc_rows else {}
    total_inspected = float(qc_data.get("total_inspected") or 0)
    total_defects = float(qc_data.get("total_defects") or 0)
    defect_rate = round(total_defects / max(total_inspected, 1) * 100, 2)

    return {
        "total_wo": total_wo,
        "completed_wo": completed_wo,
        "active_wo": active_wo,
        "completion_rate_pct": round(completed_wo / max(total_wo, 1) * 100, 1),
        "total_qty_ordered": total_qty,
        "total_qty_completed": total_completed,
        "fulfillment_rate_pct": round(total_completed / max(total_qty, 1) * 100, 1),
        "cmt_orders": cmt_count,
        "defect_rate_pct": defect_rate,
    }


# ---------------------------------------------------------------------------
# HR aggregations
# ---------------------------------------------------------------------------
async def _hr_kpis(db, year: int, month: int) -> dict:
    start, end = _month_range(year, month)

    total_active = await db.rahaza_employees.count_documents({"employment_status": "active"})

    # Attendance rate
    att_pipeline = [
        {"$match": {"date": {"$gte": start, "$lte": end}}},
        {"$group": {
            "_id": "$status",
            "count": {"$sum": 1},
        }},
    ]
    att_rows = await db.rahaza_attendance.aggregate(att_pipeline).to_list(20)
    att_by_status: dict = {s["_id"]: s["count"] for s in att_rows}
    present = sum(v for k, v in att_by_status.items() if k in ("present", "hadir", "H"))
    absent = att_by_status.get("absent", 0) + att_by_status.get("alpha", 0)
    total_att = sum(att_by_status.values())
    attendance_rate = round(present / max(total_att, 1) * 100, 1)

    # Overtime hours
    ot_pipeline = [
        {"$match": {"date": {"$gte": start, "$lte": end}, "status": "approved"}},
        {"$group": {"_id": None, "total_hours": {"$sum": {"$ifNull": ["$hours", 0]}}}},
    ]
    ot_rows = await db.rahaza_overtime.aggregate(ot_pipeline).to_list(1)
    ot_hours = ot_rows[0]["total_hours"] if ot_rows else 0

    # New hires this month
    new_hires = await db.rahaza_employees.count_documents(
        {"join_date": {"$gte": start, "$lte": end}}
    )

    # Payroll total (finalized runs this month)
    payroll_pipeline = [
        {"$match": {"status": "finalized", "created_at": {"$gte": start, "$lte": end}}},
        {"$group": {"_id": None, "total": {"$sum": {"$ifNull": ["$total_net_pay", 0]}}}},
    ]
    pr_rows = await db.rahaza_payroll_runs.aggregate(payroll_pipeline).to_list(1)
    payroll_total = pr_rows[0]["total"] if pr_rows else 0

    return {
        "total_active_employees": total_active,
        "new_hires": new_hires,
        "attendance_rate_pct": attendance_rate,
        "absent_count": absent,
        "overtime_hours": round(float(ot_hours), 1),
        "payroll_total_rp": payroll_total,
    }


# ---------------------------------------------------------------------------
# Marketing aggregations
# ---------------------------------------------------------------------------
async def _marketing_kpis(db, year: int, month: int) -> dict:
    start, end = _month_range(year, month)

    # Live sessions
    live_pipeline = [
        {"$match": {"session_date": {"$gte": start[:7], "$lte": end[:7]}}},
        {"$group": {
            "_id": None,
            "total_sessions": {"$sum": 1},
            "total_revenue": {"$sum": {"$ifNull": ["$total_revenue", 0]}},
            "total_orders": {"$sum": {"$ifNull": ["$orders_count", 0]}},
        }},
    ]
    live_rows = await db.marketing_live_sessions.aggregate(live_pipeline).to_list(1)
    live_data = live_rows[0] if live_rows else {}

    # Webhook orders (from marketplace)
    webhook_orders = await db.marketing_orders.count_documents(
        {"created_at": {"$gte": start, "$lte": end}, "source": "webhook"}
    )

    # KOL campaigns (safe — collection may not exist)
    try:
        await db.marketing_kol_campaigns.count_documents(
            {"created_at": {"$gte": start, "$lte": end}}
        )
    except Exception:
        pass

    return {
        "live_sessions": int(live_data.get("total_sessions") or 0),
        "live_revenue_rp": float(live_data.get("total_revenue") or 0),
        "live_orders": int(live_data.get("total_orders") or 0),
        "marketplace_orders_via_webhook": webhook_orders,
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.get("/summary")
async def executive_summary(
    request: Request,
    year: int = Query(default=None),
    month: int = Query(default=None),
):
    """Full cross-module executive snapshot for given year/month (default: current month)."""
    await require_auth(request)
    db = get_db()
    now = _now()
    y = year or now.year
    m = month or now.month

    prev_y, prev_m = _prev_month(y, m)
    start, end = _month_range(y, m)

    # Parallel fetch all domains
    import asyncio
    finance, production, hr = await asyncio.gather(
        _finance_kpis(db, y, m),
        _production_kpis(db, y, m),
        _hr_kpis(db, y, m),
    )

    # Marketing (sequential to avoid db.list_collection_names issues)
    try:
        marketing = await _marketing_kpis(db, y, m)
    except Exception as e:
        logger.warning("Marketing KPI error: %s", e)
        marketing = {"live_sessions": 0, "live_revenue_rp": 0, "live_orders": 0, "marketplace_orders_via_webhook": 0}

    # Prev period finance for delta
    try:
        prev_finance = await _finance_kpis(db, prev_y, prev_m)
    except Exception:
        prev_finance = {"revenue_rp": 0}

    return {
        "ok": True,
        "period": {"year": y, "month": m, "label": f"{y}-{m:02d}", "range": {"from": start, "to": end}},
        "finance": {
            **finance,
            "revenue_delta_vs_prev_pct": _delta_pct(finance["revenue_rp"], prev_finance["revenue_rp"]),
        },
        "production": production,
        "hr": hr,
        "marketing": marketing,
        "generated_at": now.isoformat(),
    }


@router.get("/kpi-comparison")
async def kpi_comparison(
    request: Request,
    months: int = Query(6, ge=2, le=24),
):
    """Month-on-month KPI comparison across the last N months."""
    await require_auth(request)
    db = get_db()
    now = _now()
    results = []

    for i in range(months - 1, -1, -1):
        target = now - timedelta(days=i * 30)
        y, m = target.year, target.month
        try:
            finance = await _finance_kpis(db, y, m)
            production = await _production_kpis(db, y, m)
        except Exception as e:
            logger.warning("KPI comparison error for %d-%02d: %s", y, m, e)
            continue
        results.append({
            "period": f"{y}-{m:02d}",
            "revenue_rp": finance["revenue_rp"],
            "net_income_rp": finance["net_income_rp"],
            "wo_completed": production["completed_wo"],
            "defect_rate_pct": production["defect_rate_pct"],
            "ar_overdue_rp": finance["ar_overdue_rp"],
        })

    return {"ok": True, "months": months, "data": results}


@router.get("/finance-snapshot")
async def finance_snapshot(
    request: Request,
    year: Optional[int] = None,
    month: Optional[int] = None,
):
    await require_auth(request)
    db = get_db()
    now = _now()
    y, m = (year or now.year), (month or now.month)
    data = await _finance_kpis(db, y, m)
    prev_y, prev_m = _prev_month(y, m)
    prev = await _finance_kpis(db, prev_y, prev_m)
    return {
        "ok": True,
        "period": f"{y}-{m:02d}",
        "current": data,
        "previous": prev,
        "deltas": {
            "revenue_pct": _delta_pct(data["revenue_rp"], prev["revenue_rp"]),
            "net_income_pct": _delta_pct(data["net_income_rp"], prev["net_income_rp"]),
            "ar_overdue_pct": _delta_pct(data["ar_overdue_rp"], prev["ar_overdue_rp"]),
        },
    }


@router.get("/production-snapshot")
async def production_snapshot(
    request: Request,
    year: Optional[int] = None,
    month: Optional[int] = None,
):
    await require_auth(request)
    db = get_db()
    now = _now()
    y, m = (year or now.year), (month or now.month)
    data = await _production_kpis(db, y, m)
    prev_y, prev_m = _prev_month(y, m)
    prev = await _production_kpis(db, prev_y, prev_m)
    return {
        "ok": True,
        "period": f"{y}-{m:02d}",
        "current": data,
        "previous": prev,
        "deltas": {
            "completion_rate_pct": _delta_pct(data["completion_rate_pct"], prev["completion_rate_pct"]),
            "defect_rate_pct": _delta_pct(data["defect_rate_pct"], prev["defect_rate_pct"]),
        },
    }


@router.get("/hr-snapshot")
async def hr_snapshot(
    request: Request,
    year: Optional[int] = None,
    month: Optional[int] = None,
):
    await require_auth(request)
    db = get_db()
    now = _now()
    y, m = (year or now.year), (month or now.month)
    data = await _hr_kpis(db, y, m)
    return {"ok": True, "period": f"{y}-{m:02d}", "data": data}


@router.get("/marketing-snapshot")
async def marketing_snapshot(
    request: Request,
    year: Optional[int] = None,
    month: Optional[int] = None,
):
    await require_auth(request)
    db = get_db()
    now = _now()
    y, m = (year or now.year), (month or now.month)
    try:
        data = await _marketing_kpis(db, y, m)
    except Exception as e:
        data = {"error": str(e)}
    return {"ok": True, "period": f"{y}-{m:02d}", "data": data}


@router.get("/trend")
async def executive_trend(
    request: Request,
    months: int = Query(6, ge=2, le=12),
):
    """Multi-KPI revenue + production + HR trend for last N months."""
    await require_auth(request)
    db = get_db()
    now = _now()
    data = []
    for i in range(months - 1, -1, -1):
        target = now - timedelta(days=i * 30)
        y, m = target.year, target.month
        label = f"{y}-{m:02d}"
        try:
            fin = await _finance_kpis(db, y, m)
            prod = await _production_kpis(db, y, m)
            hr = await _hr_kpis(db, y, m)
        except Exception:
            continue
        data.append({
            "period": label,
            "revenue_rp": fin["revenue_rp"],
            "net_income_rp": fin["net_income_rp"],
            "ar_overdue_rp": fin["ar_overdue_rp"],
            "wo_completed": prod["completed_wo"],
            "defect_rate_pct": prod["defect_rate_pct"],
            "attendance_rate_pct": hr["attendance_rate_pct"],
            "payroll_total_rp": hr["payroll_total_rp"],
        })
    return {"ok": True, "months": months, "data": data}
