"""
Marketing Account Monthly Targets
==================================
Manajemen target bulanan per akun platform & KOL/Creator.
"""
# ruff: noqa: E402
from fastapi import APIRouter, HTTPException, Request, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime, timezone
import uuid

from database import get_db
from auth import require_auth, serialize_doc

router = APIRouter(prefix="/api/marketing/targets", tags=["marketing-targets"])


def _now(): return datetime.now(timezone.utc)
def _uid():  return str(uuid.uuid4())


class TargetUpsert(BaseModel):
    account_id:          str
    year:                int = Field(..., ge=2020, le=2100)
    month:               int = Field(..., ge=1,    le=12)
    revenue_target:      float = Field(0, ge=0)
    orders_target:       int   = Field(0, ge=0)
    health_score_target: int   = Field(80, ge=0, le=100)
    notes:               Optional[str] = None


# ── UPSERT ────────────────────────────────────────────────────────────────────
@router.post("", status_code=200)
async def upsert_target(data: TargetUpsert, request: Request):
    """Set/update monthly target untuk sebuah akun. Upsert by (account_id, year, month)."""
    user = await require_auth(request)
    db   = get_db()

    acc = await db.marketing_platform_accounts.find_one({"id": data.account_id}, {"_id": 0})
    if not acc:
        raise HTTPException(404, "Akun tidak ditemukan")

    existing = await db.marketing_account_targets.find_one(
        {"account_id": data.account_id, "year": data.year, "month": data.month},
        {"_id": 0}
    )

    if existing:
        await db.marketing_account_targets.update_one(
            {"id": existing["id"]},
            {"$set": {
                "revenue_target":      data.revenue_target,
                "orders_target":       data.orders_target,
                "health_score_target": data.health_score_target,
                "notes":               data.notes,
                "updated_by":          user.get("id"),
                "updated_at":          _now(),
            }}
        )
        doc = await db.marketing_account_targets.find_one({"id": existing["id"]}, {"_id": 0})
        return serialize_doc({"message": "Target diupdate", "target": doc})

    doc = {
        "id":                  _uid(),
        "account_id":          data.account_id,
        "account_name":        acc.get("account_name", ""),
        "platform":            acc.get("platform", ""),
        "year":                data.year,
        "month":               data.month,
        "revenue_target":      data.revenue_target,
        "orders_target":       data.orders_target,
        "health_score_target": data.health_score_target,
        "notes":               data.notes,
        "created_by":          user.get("id"),
        "created_at":          _now(),
        "updated_at":          _now(),
    }
    await db.marketing_account_targets.insert_one(doc)
    return serialize_doc({"message": "Target disimpan", "target": doc})


# ── LIST ──────────────────────────────────────────────────────────────────────
@router.get("")
async def list_targets(
    request: Request,
    year:       Optional[int] = Query(None),
    month:      Optional[int] = Query(None),
    account_id: Optional[str] = Query(None),
):
    """List target. Default: bulan & tahun berjalan."""
    await require_auth(request)
    db = get_db()
    now = _now()
    q: dict = {
        "year":  year  or now.year,
        "month": month or now.month,
    }
    if account_id:
        q["account_id"] = account_id
    rows = await db.marketing_account_targets.find(q, {"_id": 0}).sort("account_name", 1).to_list(200)
    return serialize_doc(rows)


# ── MONTHLY SUMMARY (target vs actual) ───────────────────────────────────────
@router.get("/monthly-summary")
async def monthly_summary(
    request: Request,
    year:  int = Query(None),
    month: int = Query(None),
):
    """
    Semua akun aktif + target vs actual untuk bulan tertentu.
    Default: bulan & tahun berjalan.
    """
    await require_auth(request)
    db  = get_db()
    now = _now()
    y   = year  or now.year
    m   = month or now.month

    month_start = datetime(y, m, 1,  0, 0, 0, tzinfo=timezone.utc)
    if m == 12:
        month_end = datetime(y + 1, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    else:
        month_end = datetime(y, m + 1, 1, 0, 0, 0, tzinfo=timezone.utc)

    date_from = f"{y:04d}-{m:02d}-01"
    import calendar
    last_day  = calendar.monthrange(y, m)[1]
    date_to   = f"{y:04d}-{m:02d}-{last_day:02d}"

    accounts = await db.marketing_platform_accounts.find(
        {"status": "active"}, {"_id": 0}
    ).to_list(200)

    result = []
    total_rev_target = 0.0
    total_rev_actual = 0.0
    total_ord_target = 0
    total_ord_actual = 0

    for acc in accounts:
        acc_id = acc["id"]

        # Target
        tgt = await db.marketing_account_targets.find_one(
            {"account_id": acc_id, "year": y, "month": m}, {"_id": 0}
        )

        # Actual sales (total type only)
        sales = await db.marketing_sales_data.find(
            {"account_id": acc_id, "date": {"$gte": date_from, "$lte": date_to}, "revenue_type": "total"},
            {"_id": 0, "metrics": 1, "date": 1}
        ).to_list(500)

        rev_actual = sum(s.get("metrics", {}).get("revenue", 0) for s in sales)
        ord_actual = sum(s.get("metrics", {}).get("orders",  0) for s in sales)
        sales_days = len({s["date"] for s in sales})

        # Task stats for month
        task_count = await db.marketing_tasks.count_documents({
            "account_id": acc_id,
            "created_at": {"$gte": month_start, "$lt": month_end},
            "status": {"$ne": "cancelled"},
        })
        task_done = await db.marketing_tasks.count_documents({
            "account_id": acc_id,
            "created_at": {"$gte": month_start, "$lt": month_end},
            "status": "done",
        })

        rev_tgt = tgt["revenue_target"] if tgt else None
        ord_tgt = tgt["orders_target"]  if tgt else None

        rev_pct = round((rev_actual / rev_tgt * 100), 1) if rev_tgt and rev_tgt > 0 else None
        ord_pct = round((ord_actual / ord_tgt * 100), 1) if ord_tgt and ord_tgt > 0 else None

        result.append({
            "account_id":            acc_id,
            "account_name":          acc.get("account_name", ""),
            "account_code":          acc.get("account_code", ""),
            "platform":              acc.get("platform", ""),
            "health_score":          acc.get("health_score"),
            "target": {
                "revenue":      rev_tgt,
                "orders":       ord_tgt,
                "health_score": tgt["health_score_target"] if tgt else None,
                "notes":        tgt["notes"] if tgt else None,
            },
            "actual": {
                "revenue":    rev_actual,
                "orders":     ord_actual,
                "sales_days": sales_days,
            },
            "achievement": {
                "revenue_pct": rev_pct,
                "orders_pct":  ord_pct,
            },
            "task_stats": {
                "total":           task_count,
                "done":            task_done,
                "completion_rate": round(task_done / task_count * 100, 1) if task_count > 0 else None,
            },
        })

        total_rev_target += rev_tgt or 0
        total_rev_actual += rev_actual
        total_ord_target += ord_tgt or 0
        total_ord_actual += ord_actual

    return serialize_doc({
        "period":  {"year": y, "month": m, "date_from": date_from, "date_to": date_to},
        "summary": {
            "total_accounts":  len(accounts),
            "rev_target":      total_rev_target,
            "rev_actual":      total_rev_actual,
            "rev_pct":         round(total_rev_actual / total_rev_target * 100, 1) if total_rev_target > 0 else None,
            "ord_target":      total_ord_target,
            "ord_actual":      total_ord_actual,
        },
        "accounts": result,
    })


# ══════════════════════════════════════════════════════════════════════════════
# CREATOR TARGETS (KOL / Creator per-bulan)
# Collection: marketing_creator_targets
# Schema: { id, creator_id, creator_name, year, month,
#           revenue_target, sessions_target, viewers_target, notes }
# ══════════════════════════════════════════════════════════════════════════════

import calendar as _calendar


class CreatorTargetUpsert(BaseModel):
    creator_id:      str
    year:            int = Field(..., ge=2020, le=2100)
    month:           int = Field(..., ge=1,    le=12)
    revenue_target:  float = Field(0, ge=0)
    sessions_target: int   = Field(0, ge=0)
    viewers_target:  int   = Field(0, ge=0)
    notes:           Optional[str] = None


@router.post("/creator", status_code=200)
async def upsert_creator_target(data: CreatorTargetUpsert, request: Request):
    """Set/update monthly target untuk KOL Creator. Upsert by (creator_id, year, month)."""
    user = await require_auth(request)
    db   = get_db()

    creator = await db.marketing_kol_creators.find_one({"id": data.creator_id}, {"_id": 0})
    if not creator:
        raise HTTPException(404, "Creator tidak ditemukan")

    existing = await db.marketing_creator_targets.find_one(
        {"creator_id": data.creator_id, "year": data.year, "month": data.month},
        {"_id": 0}
    )

    if existing:
        await db.marketing_creator_targets.update_one(
            {"id": existing["id"]},
            {"$set": {
                "revenue_target":  data.revenue_target,
                "sessions_target": data.sessions_target,
                "viewers_target":  data.viewers_target,
                "notes":           data.notes,
                "updated_by":      user.get("id"),
                "updated_at":      _now(),
            }}
        )
        doc = await db.marketing_creator_targets.find_one({"id": existing["id"]}, {"_id": 0})
        return serialize_doc({"message": "Target creator diupdate", "target": doc})

    doc = {
        "id":              _uid(),
        "creator_id":      data.creator_id,
        "creator_name":    creator.get("name", ""),
        "creator_code":    creator.get("creator_code", ""),
        "year":            data.year,
        "month":           data.month,
        "revenue_target":  data.revenue_target,
        "sessions_target": data.sessions_target,
        "viewers_target":  data.viewers_target,
        "notes":           data.notes,
        "created_by":      user.get("id"),
        "created_at":      _now(),
        "updated_at":      _now(),
    }
    await db.marketing_creator_targets.insert_one(doc)
    return serialize_doc({"message": "Target creator disimpan", "target": doc})


@router.get("/creator")
async def list_creator_targets(
    request: Request,
    year:       Optional[int] = Query(None),
    month:      Optional[int] = Query(None),
    creator_id: Optional[str] = Query(None),
):
    """List target creator. Default: bulan & tahun berjalan."""
    await require_auth(request)
    db = get_db()
    now = _now()
    q: dict = {"year": year or now.year, "month": month or now.month}
    if creator_id:
        q["creator_id"] = creator_id
    rows = await db.marketing_creator_targets.find(q, {"_id": 0}).sort("creator_name", 1).to_list(200)
    return serialize_doc(rows)


@router.get("/creator/monthly-summary")
async def creator_monthly_summary(
    request: Request,
    year:  int = Query(None),
    month: int = Query(None),
):
    """Semua creator aktif + target vs aktual sessions bulan ini."""
    await require_auth(request)
    db  = get_db()
    now = _now()
    y   = year  or now.year
    m   = month or now.month

    date_from = f"{y:04d}-{m:02d}-01"
    last_day  = _calendar.monthrange(y, m)[1]
    date_to   = f"{y:04d}-{m:02d}-{last_day:02d}"

    creators = await db.marketing_kol_creators.find(
        {"status": "active"}, {"_id": 0}
    ).to_list(500)

    result = []
    total_rev_tgt = 0.0
    total_rev_act = 0.0

    for c in creators:
        cid = c["id"]

        # Target per bulan ini
        tgt = await db.marketing_creator_targets.find_one(
            {"creator_id": cid, "year": y, "month": m}, {"_id": 0}
        )

        # Aktual dari sessions bulan ini
        sessions = await db.marketing_creator_sessions.find(
            {"creator_id": cid, "date": {"$gte": date_from, "$lte": date_to}},
            {"_id": 0, "revenue": 1, "viewers": 1, "orders": 1}
        ).to_list(500)

        rev_actual  = sum(s.get("revenue",  0) for s in sessions)
        sess_actual = len(sessions)
        view_actual = sum(s.get("viewers",  0) for s in sessions)

        rev_tgt  = tgt["revenue_target"]  if tgt else None
        sess_tgt = tgt["sessions_target"] if tgt else None
        view_tgt = tgt["viewers_target"]  if tgt else None

        rev_pct  = round(rev_actual  / rev_tgt  * 100, 1) if rev_tgt  and rev_tgt  > 0 else None
        sess_pct = round(sess_actual / sess_tgt * 100, 1) if sess_tgt and sess_tgt > 0 else None
        view_pct = round(view_actual / view_tgt * 100, 1) if view_tgt and view_tgt > 0 else None

        def _status(pct):
            if pct is None:
                return "no_target"
            if pct >= 90:
                return "on_track"
            if pct >= 70:
                return "warning"
            return "behind"

        result.append({
            "creator_id":   cid,
            "creator_name": c.get("name", ""),
            "creator_code": c.get("creator_code", ""),
            "status":       c.get("status", ""),
            "target": {
                "revenue":  rev_tgt,
                "sessions": sess_tgt,
                "viewers":  view_tgt,
                "notes":    tgt["notes"] if tgt else None,
            },
            "actual": {
                "revenue":  round(rev_actual),
                "sessions": sess_actual,
                "viewers":  view_actual,
            },
            "achievement": {
                "revenue_pct":    rev_pct,
                "sessions_pct":   sess_pct,
                "viewers_pct":    view_pct,
                "revenue_status": _status(rev_pct),
            },
        })

        total_rev_tgt += rev_tgt or 0
        total_rev_act += rev_actual

    return serialize_doc({
        "period": {"year": y, "month": m, "date_from": date_from, "date_to": date_to},
        "summary": {
            "total_creators": len(creators),
            "rev_target":     total_rev_tgt,
            "rev_actual":     round(total_rev_act),
            "rev_pct":        round(total_rev_act / total_rev_tgt * 100, 1) if total_rev_tgt > 0 else None,
        },
        "creators": result,
    })


@router.get("/creator/export-pdf")
async def export_creator_targets_pdf(
    request: Request,
    year:  Optional[int] = Query(None),
    month: Optional[int] = Query(None),
):
    """Export PDF Target KOL/Creator untuk bulan tertentu."""
    await require_auth(request)
    db  = get_db()
    now = _now()
    y   = year  or now.year
    m   = month or now.month

    date_from = f"{y:04d}-{m:02d}-01"
    last_day  = _calendar.monthrange(y, m)[1]
    date_to   = f"{y:04d}-{m:02d}-{last_day:02d}"

    creators = await db.marketing_kol_creators.find({"status": "active"}, {"_id": 0}).to_list(500)
    result = []
    total_rev_tgt = 0.0
    total_rev_act = 0.0

    for c in creators:
        cid = c["id"]
        tgt = await db.marketing_creator_targets.find_one(
            {"creator_id": cid, "year": y, "month": m}, {"_id": 0}
        )
        sessions = await db.marketing_creator_sessions.find(
            {"creator_id": cid, "date": {"$gte": date_from, "$lte": date_to}},
            {"_id": 0, "revenue": 1, "viewers": 1}
        ).to_list(500)

        rev_actual  = sum(s.get("revenue",  0) for s in sessions)
        sess_actual = len(sessions)
        view_actual = sum(s.get("viewers",  0) for s in sessions)

        rev_tgt  = tgt["revenue_target"]  if tgt else None
        sess_tgt = tgt["sessions_target"] if tgt else None
        view_tgt = tgt["viewers_target"]  if tgt else None

        def _pct(a, t): return round(a / t * 100, 1) if t and t > 0 else None
        def _st(p):
            if p is None:
                return "no_target"
            return "on_track" if p >= 90 else ("warning" if p >= 70 else "behind")

        result.append({
            "creator_id":   cid,
            "creator_name": c.get("name", ""),
            "creator_code": c.get("creator_code", ""),
            "target": {"revenue": rev_tgt, "sessions": sess_tgt, "viewers": view_tgt},
            "actual": {"revenue": round(rev_actual), "sessions": sess_actual, "viewers": view_actual},
            "achievement": {
                "revenue_pct":    _pct(rev_actual,  rev_tgt),
                "sessions_pct":   _pct(sess_actual, sess_tgt),
                "revenue_status": _st(_pct(rev_actual, rev_tgt)),
            },
        })
        total_rev_tgt += rev_tgt or 0
        total_rev_act += rev_actual

    summary_payload = {
        "period":  {"year": y, "month": m, "date_from": date_from, "date_to": date_to},
        "summary": {
            "total_creators": len(creators),
            "rev_target":     total_rev_tgt,
            "rev_actual":     round(total_rev_act),
            "rev_pct":        round(total_rev_act / total_rev_tgt * 100, 1) if total_rev_tgt > 0 else None,
        },
        "creators": result,
    }

    from utils.monthly_report_pdf import build_creator_target_pdf
    pdf_bytes = build_creator_target_pdf(summary_payload)

    month_names = ['','Jan','Feb','Mar','Apr','Mei','Jun','Jul','Ags','Sep','Okt','Nov','Des']
    filename = f"target-creator-{month_names[m]}-{y}.pdf"

    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
