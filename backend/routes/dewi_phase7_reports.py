"""
CV. Dewi Aditya — Phase 7: Reporting & Dashboard

Modul laporan unifikasi untuk:
  • Laporan Harian (Daily): produksi CMT + delivery + fulfillment + stok bergerak
  • Laporan Bulanan (Monthly): aggregated metrics per vendor & per klien
  • Laporan per PO Maklon: progress, dispatched, remaining, AR & GL status
  • Comparison Actual vs Target: realisasi vs target per akun/vendor/PO

Sumber data:
  - dewi_cmt_progress_reports   → produksi per process_step per hari
  - dewi_cmt_jobs               → master CMT job (qty target)
  - dewi_cmt_delivery_orders    → DO IN/OUT
  - dewi_maklon_pos             → PO Maklon header + items
  - dewi_maklon_dispatches      → realisasi pengiriman ke klien
  - marketing_orders            → order online + fulfillment_status
  - rahaza_material_stock       → stok WIP/FG

Endpoints (prefix /api/dewi/reports):
  - GET /daily?date=YYYY-MM-DD
  - GET /monthly?year=&month=
  - GET /po/{po_id}
  - GET /actual-vs-target?period=YYYY-MM
  - GET /production-trend?days=30
  - GET /export/daily.csv?date=
  - GET /export/monthly.csv?year=&month=
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from typing import Optional, Dict
from datetime import datetime, date, timedelta
import logging
import csv
import io

from database import get_db
from auth import require_auth, serialize_doc

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/dewi/reports", tags=["dewi-reports"])


def _today_str() -> str:
    return date.today().isoformat()


def _date_range(start: date, end: date):
    cur = start
    while cur <= end:
        yield cur
        cur += timedelta(days=1)


# ── DAILY REPORT ───────────────────────────────────────────────────────────────

@router.get("/daily")
async def daily_report(
    report_date: Optional[str] = Query(None, alias="date", description="YYYY-MM-DD; default hari ini"),
    user: dict = Depends(require_auth)
):
    """
    Laporan harian: produksi CMT, DO, fulfillment online, dan adjustment stok.
    """
    db = get_db()
    target = report_date or _today_str()

    # Validasi format
    try:
        datetime.strptime(target, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, "Format tanggal harus YYYY-MM-DD")

    # 1. Produksi CMT
    prod_reports = await db.dewi_cmt_progress_reports.find({"report_date": target}).to_list(length=None)
    prod_by_vendor: Dict[str, dict] = {}
    prod_by_step: Dict[str, int] = {}
    total_processed = 0
    total_passed = 0
    total_failed = 0
    for r in prod_reports:
        vid = r.get("cmt_partner_id") or "internal"
        if vid not in prod_by_vendor:
            prod_by_vendor[vid] = {
                "cmt_partner_id": vid,
                "cmt_name": r.get("cmt_name", "Internal"),
                "qty_processed": 0,
                "qty_passed": 0,
                "qty_failed": 0,
                "jobs": set(),
            }
        prod_by_vendor[vid]["qty_processed"] += int(r.get("qty_processed", 0) or 0)
        prod_by_vendor[vid]["qty_passed"] += int(r.get("qty_passed", 0) or 0)
        prod_by_vendor[vid]["qty_failed"] += int(r.get("qty_failed", 0) or 0)
        prod_by_vendor[vid]["jobs"].add(r.get("cmt_job_id"))
        total_processed += int(r.get("qty_processed", 0) or 0)
        total_passed += int(r.get("qty_passed", 0) or 0)
        total_failed += int(r.get("qty_failed", 0) or 0)
        step = r.get("process_step", "unknown")
        prod_by_step[step] = prod_by_step.get(step, 0) + int(r.get("qty_processed", 0) or 0)

    production_vendors = [
        {**v, "jobs_count": len(v.pop("jobs"))}
        for v in prod_by_vendor.values()
    ]

    # 2. Delivery Orders (DO) yang issued/received hari ini
    do_issued = await db.dewi_cmt_delivery_orders.count_documents({
        "$or": [
            {"issued_at": {"$regex": f"^{target}"}},
            {"do_date": target, "status": "issued"},
        ]
    })
    do_received = await db.dewi_cmt_delivery_orders.count_documents({
        "$or": [
            {"received_at": {"$regex": f"^{target}"}},
            {"do_date": target, "status": "received"},
        ]
    })

    # 3. Fulfillment online (marketing orders dispatched)
    fulfillment_dispatched = 0
    fulfillment_total_qty = 0
    try:
        # Use string match on dispatched_at for robustness with various types
        f_cursor = db.marketing_orders.find({
            "fulfillment_status": "dispatched",
        })
        async for o in f_cursor:
            disp_at = o.get("dispatched_at")
            disp_str = ""
            if isinstance(disp_at, datetime):
                disp_str = disp_at.isoformat()
            elif isinstance(disp_at, str):
                disp_str = disp_at
            if disp_str.startswith(target):
                fulfillment_dispatched += 1
                fulfillment_total_qty += sum(
                    int(it.get("qty_allocated", it.get("quantity", 0)) or 0)
                    for it in (o.get("fulfillment_items") or o.get("items") or [])
                )
    except Exception as e:
        logger.warning(f"fulfillment count error: {e}")

    # 4. Stock adjustments hari ini
    try:
        adj_count = await db.rahaza_material_movements.count_documents({
            "movement_type": "ADJUST",
            "$expr": {
                "$eq": [
                    {"$dateToString": {"format": "%Y-%m-%d", "date": "$created_at"}},
                    target
                ]
            }
        })
    except Exception:
        adj_count = 0

    return {
        "date": target,
        "production": {
            "total_processed": total_processed,
            "total_passed": total_passed,
            "total_failed": total_failed,
            "pass_rate_pct": round(total_passed / total_processed * 100, 1) if total_processed > 0 else 0,
            "by_vendor": production_vendors,
            "by_step": [{"step": k, "qty": v} for k, v in prod_by_step.items()],
        },
        "delivery_orders": {
            "issued": do_issued,
            "received": do_received,
        },
        "fulfillment": {
            "dispatched_orders": fulfillment_dispatched,
            "dispatched_qty": fulfillment_total_qty,
        },
        "stock_adjustments": adj_count,
    }


# ── MONTHLY REPORT ─────────────────────────────────────────────────────────────

@router.get("/monthly")
async def monthly_report(
    year: int = Query(..., ge=2020, le=2100),
    month: int = Query(..., ge=1, le=12),
    user: dict = Depends(require_auth)
):
    """
    Laporan bulanan agregat per vendor CMT, per klien Maklon, dan ringkasan produksi.
    """
    db = get_db()
    month_str = f"{year:04d}-{month:02d}"

    # 1. Production per vendor (full month)
    pipe_prod = [
        {"$match": {"report_date": {"$regex": f"^{month_str}"}}},
        {"$group": {
            "_id": {"partner_id": "$cmt_partner_id", "cmt_name": "$cmt_name"},
            "total_processed": {"$sum": "$qty_processed"},
            "total_passed": {"$sum": "$qty_passed"},
            "total_failed": {"$sum": "$qty_failed"},
            "active_days": {"$addToSet": "$report_date"},
            "jobs": {"$addToSet": "$cmt_job_id"},
        }}
    ]
    prod_result = await db.dewi_cmt_progress_reports.aggregate(pipe_prod).to_list(length=None)
    production_by_vendor = [
        {
            "cmt_partner_id": r["_id"]["partner_id"],
            "cmt_name": r["_id"].get("cmt_name", "Internal"),
            "total_processed": r["total_processed"],
            "total_passed": r["total_passed"],
            "total_failed": r["total_failed"],
            "pass_rate_pct": round(r["total_passed"] / r["total_processed"] * 100, 1) if r["total_processed"] > 0 else 0,
            "active_days": len(r["active_days"]),
            "jobs_count": len(r["jobs"]),
        }
        for r in prod_result
    ]

    # 2. Maklon revenue per client (from PO `total_value` for POs in this month)
    pipe_maklon = [
        {"$match": {"po_date": {"$regex": f"^{month_str}"}}},
        {"$group": {
            "_id": {"client_id": "$client_id", "client_name": "$client_name"},
            "po_count": {"$sum": 1},
            "total_qty": {"$sum": "$total_qty"},
            "total_value": {"$sum": "$total_value"},
            "amount_paid": {"$sum": "$amount_paid"},
        }}
    ]
    maklon_result = await db.dewi_maklon_pos.aggregate(pipe_maklon).to_list(length=None)
    maklon_by_client = [
        {
            "client_id": r["_id"].get("client_id"),
            "client_name": r["_id"].get("client_name", "Unknown"),
            "po_count": r["po_count"],
            "total_qty": r["total_qty"],
            "total_value": r["total_value"],
            "amount_paid": r["amount_paid"],
            "outstanding": r["total_value"] - r["amount_paid"],
        }
        for r in maklon_result
    ]

    # 3. DO summary per month
    do_issued = await db.dewi_cmt_delivery_orders.count_documents({"do_date": {"$regex": f"^{month_str}"}, "status": {"$ne": "draft"}})
    do_received = await db.dewi_cmt_delivery_orders.count_documents({"do_date": {"$regex": f"^{month_str}"}, "status": "received"})

    # Totals
    total_processed = sum(v["total_processed"] for v in production_by_vendor)
    total_passed = sum(v["total_passed"] for v in production_by_vendor)
    total_failed = sum(v["total_failed"] for v in production_by_vendor)
    total_maklon_value = sum(m["total_value"] for m in maklon_by_client)

    return {
        "period": month_str,
        "summary": {
            "total_processed": total_processed,
            "total_passed": total_passed,
            "total_failed": total_failed,
            "pass_rate_pct": round(total_passed / total_processed * 100, 1) if total_processed > 0 else 0,
            "vendor_count": len(production_by_vendor),
            "maklon_po_count": sum(m["po_count"] for m in maklon_by_client),
            "maklon_total_value": total_maklon_value,
            "do_issued": do_issued,
            "do_received": do_received,
        },
        "production_by_vendor": production_by_vendor,
        "maklon_by_client": maklon_by_client,
    }


# ── PER-PO REPORT ──────────────────────────────────────────────────────────────

@router.get("/po/{po_id}")
async def po_report(po_id: str, user: dict = Depends(require_auth)):
    """
    Detail report per PO Maklon: items, dispatch progress, AR/GL status.
    """
    db = get_db()
    po = await db.dewi_maklon_pos.find_one({"id": po_id}, {"_id": 0})
    if not po:
        raise HTTPException(404, f"PO {po_id} tidak ditemukan")

    # Dispatch details
    dispatches = await db.dewi_maklon_dispatches.find(
        {"po_id": po_id, "status": {"$ne": "cancelled"}},
        {"_id": 0}
    ).sort("dispatched_at", -1).to_list(length=None)

    qty_dispatched_total = 0
    dispatch_summary = []
    for d in dispatches:
        d_qty = sum(int(it.get("qty_dispatched", 0) or 0) for it in (d.get("items") or []))
        qty_dispatched_total += d_qty
        dispatch_summary.append({
            "id": d.get("id"),
            "dispatch_number": d.get("dispatch_number"),
            "dispatch_date": d.get("dispatch_date") or d.get("dispatched_at"),
            "qty": d_qty,
            "status": d.get("status"),
            "destination": d.get("destination") or d.get("delivery_address"),
        })

    # Production progress (from items qty_produced)
    qty_produced_total = sum(int(it.get("qty_produced", 0) or 0) for it in (po.get("items") or []))
    target_qty = int(po.get("total_qty", 0) or 0)

    # AR Invoice info
    if po.get("ar_invoice_id"):
        try:
            ar = await db.rahaza_ar_invoices.find_one({"id": po["ar_invoice_id"]}, {"_id": 0}) or \
                 await db.dewi_invoices.find_one({"id": po["ar_invoice_id"]}, {"_id": 0})
            if ar:
                serialize_doc(ar)  # touch
        except Exception:
            pass

    return {
        "po": serialize_doc(po),
        "progress": {
            "target_qty": target_qty,
            "qty_produced": qty_produced_total,
            "qty_dispatched": qty_dispatched_total,
            "qty_remaining": max(0, target_qty - qty_dispatched_total),
            "production_pct": round(qty_produced_total / target_qty * 100, 1) if target_qty > 0 else 0,
            "dispatch_pct": round(qty_dispatched_total / target_qty * 100, 1) if target_qty > 0 else 0,
        },
        "dispatches": dispatch_summary,
        "finance": {
            "ar_invoice_id": po.get("ar_invoice_id"),
            "ar_invoice_number": po.get("ar_invoice_number"),
            "payment_status": po.get("payment_status", "unpaid"),
            "advance_payment": po.get("advance_payment", 0),
            "amount_paid": po.get("amount_paid", 0),
            "outstanding": float(po.get("total_value", 0)) - float(po.get("amount_paid", 0)),
            "gl_posted": bool(po.get("gl_posted_at")),
            "gl_je_id": po.get("gl_je_id"),
        }
    }


# ── ACTUAL VS TARGET ───────────────────────────────────────────────────────────

@router.get("/actual-vs-target")
async def actual_vs_target(
    period: str = Query(..., description="Format YYYY-MM untuk monthly"),
    user: dict = Depends(require_auth)
):
    """
    Comparison realisasi vs target per CMT job & per Maklon PO untuk bulan tertentu.
    """
    db = get_db()

    # Validate
    try:
        datetime.strptime(period, "%Y-%m")
    except ValueError:
        raise HTTPException(400, "Format period harus YYYY-MM")

    # 1. CMT Jobs target vs produksi
    jobs = await db.dewi_cmt_jobs.find(
        {"$or": [
            {"created_at": {"$regex": f"^{period}"}},
            {"deadline_date": {"$regex": f"^{period}"}},
        ]},
        {"_id": 0}
    ).to_list(length=None)

    cmt_comparison = []
    for j in jobs:
        # Sum actual processed
        prog_pipe = [
            {"$match": {"cmt_job_id": j.get("id")}},
            {"$group": {"_id": None, "total": {"$sum": "$qty_processed"}}}
        ]
        prog = await db.dewi_cmt_progress_reports.aggregate(prog_pipe).to_list(length=1)
        actual = prog[0]["total"] if prog else 0
        target = int(j.get("qty", 0) or 0)
        cmt_comparison.append({
            "job_id": j.get("id"),
            "job_code": j.get("job_code"),
            "product_name": j.get("product_name"),
            "cmt_partner_id": j.get("cmt_partner_id"),
            "cmt_name": j.get("cmt_name"),
            "target": target,
            "actual": actual,
            "variance": actual - target,
            "achievement_pct": round(actual / target * 100, 1) if target > 0 else 0,
            "status": j.get("status"),
            "deadline_date": j.get("deadline_date"),
        })

    # 2. Maklon POs target vs dispatched
    pos = await db.dewi_maklon_pos.find(
        {"po_date": {"$regex": f"^{period}"}},
        {"_id": 0}
    ).to_list(length=None)

    maklon_comparison = []
    for p in pos:
        target = int(p.get("total_qty", 0) or 0)
        # actual = sum dispatched
        disp = await db.dewi_maklon_dispatches.find(
            {"po_id": p.get("id"), "status": {"$ne": "cancelled"}}
        ).to_list(length=None)
        actual = sum(
            int(it.get("qty_dispatched", 0) or 0)
            for d in disp for it in (d.get("items") or [])
        )
        maklon_comparison.append({
            "po_id": p.get("id"),
            "po_number": p.get("po_number"),
            "client_name": p.get("client_name"),
            "target_qty": target,
            "dispatched_qty": actual,
            "remaining_qty": max(0, target - actual),
            "achievement_pct": round(actual / target * 100, 1) if target > 0 else 0,
            "status": p.get("status"),
            "deadline": p.get("deadline"),
        })

    return {
        "period": period,
        "cmt_jobs": cmt_comparison,
        "maklon_pos": maklon_comparison,
        "summary": {
            "cmt_job_count": len(cmt_comparison),
            "cmt_total_target": sum(c["target"] for c in cmt_comparison),
            "cmt_total_actual": sum(c["actual"] for c in cmt_comparison),
            "maklon_po_count": len(maklon_comparison),
            "maklon_total_target": sum(m["target_qty"] for m in maklon_comparison),
            "maklon_total_dispatched": sum(m["dispatched_qty"] for m in maklon_comparison),
        }
    }


# ── PRODUCTION TREND ───────────────────────────────────────────────────────────

@router.get("/production-trend")
async def production_trend(
    days: int = Query(30, ge=1, le=365),
    user: dict = Depends(require_auth)
):
    """
    Trend produksi N hari terakhir untuk chart line.
    """
    db = get_db()
    end_date = date.today()
    start_date = end_date - timedelta(days=days - 1)

    pipe = [
        {"$match": {"report_date": {"$gte": start_date.isoformat(), "$lte": end_date.isoformat()}}},
        {"$group": {
            "_id": "$report_date",
            "total_processed": {"$sum": "$qty_processed"},
            "total_passed": {"$sum": "$qty_passed"},
            "total_failed": {"$sum": "$qty_failed"},
        }},
        {"$sort": {"_id": 1}},
    ]
    rows = await db.dewi_cmt_progress_reports.aggregate(pipe).to_list(length=None)
    by_date = {r["_id"]: r for r in rows}

    # Fill gaps
    trend = []
    for d in _date_range(start_date, end_date):
        ds = d.isoformat()
        r = by_date.get(ds)
        trend.append({
            "date": ds,
            "total_processed": r["total_processed"] if r else 0,
            "total_passed": r["total_passed"] if r else 0,
            "total_failed": r["total_failed"] if r else 0,
        })

    # Maklon dispatch trend (count dispatches per day)
    try:
        disp_rows = await db.dewi_maklon_dispatches.find(
            {"dispatch_date": {"$gte": start_date.isoformat(), "$lte": end_date.isoformat()}},
            {"_id": 0}
        ).to_list(length=None)
        disp_by_date: Dict[str, int] = {}
        for d in disp_rows:
            ds = d.get("dispatch_date") or ""
            qty = sum(int(it.get("qty_dispatched", 0) or 0) for it in (d.get("items") or []))
            disp_by_date[ds] = disp_by_date.get(ds, 0) + qty
        # Attach to trend
        for t in trend:
            t["dispatched_qty"] = disp_by_date.get(t["date"], 0)
    except Exception as e:
        logger.warning(f"dispatch trend error: {e}")
        for t in trend:
            t["dispatched_qty"] = 0

    return {
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "trend": trend,
    }


# ── CSV EXPORT ─────────────────────────────────────────────────────────────────

@router.get("/export/daily.csv")
async def export_daily_csv(
    report_date: Optional[str] = Query(None, alias="date"),
    user: dict = Depends(require_auth)
):
    data = await daily_report(report_date=report_date, user=user)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Laporan Harian Produksi"])
    w.writerow(["Tanggal", data["date"]])
    w.writerow([])
    w.writerow(["RINGKASAN PRODUKSI"])
    w.writerow(["Total Diproses", data["production"]["total_processed"]])
    w.writerow(["Total Lolos QC", data["production"]["total_passed"]])
    w.writerow(["Total Gagal QC", data["production"]["total_failed"]])
    w.writerow(["Pass Rate (%)", data["production"]["pass_rate_pct"]])
    w.writerow([])
    w.writerow(["PER VENDOR"])
    w.writerow(["Vendor", "Diproses", "Lolos", "Gagal", "Jumlah Jobs"])
    for v in data["production"]["by_vendor"]:
        w.writerow([v["cmt_name"], v["qty_processed"], v["qty_passed"], v["qty_failed"], v["jobs_count"]])
    w.writerow([])
    w.writerow(["PER PROCESS STEP"])
    w.writerow(["Step", "Qty"])
    for s in data["production"]["by_step"]:
        w.writerow([s["step"], s["qty"]])
    w.writerow([])
    w.writerow(["DELIVERY ORDERS"])
    w.writerow(["DO Diterbitkan", data["delivery_orders"]["issued"]])
    w.writerow(["DO Diterima", data["delivery_orders"]["received"]])
    w.writerow([])
    w.writerow(["FULFILLMENT ONLINE"])
    w.writerow(["Order Dikirim", data["fulfillment"]["dispatched_orders"]])
    w.writerow(["Qty Dikirim", data["fulfillment"]["dispatched_qty"]])

    csv_data = buf.getvalue()
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="laporan-harian-{data["date"]}.csv"'}
    )


@router.get("/export/monthly.csv")
async def export_monthly_csv(
    year: int = Query(...),
    month: int = Query(...),
    user: dict = Depends(require_auth)
):
    data = await monthly_report(year=year, month=month, user=user)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([f"Laporan Bulanan — {data['period']}"])
    w.writerow([])
    w.writerow(["RINGKASAN"])
    for k, v in data["summary"].items():
        w.writerow([k, v])
    w.writerow([])
    w.writerow(["PRODUKSI PER VENDOR"])
    w.writerow(["Vendor", "Diproses", "Lolos", "Gagal", "Pass Rate %", "Active Days", "Jobs"])
    for v in data["production_by_vendor"]:
        w.writerow([v["cmt_name"], v["total_processed"], v["total_passed"], v["total_failed"],
                    v["pass_rate_pct"], v["active_days"], v["jobs_count"]])
    w.writerow([])
    w.writerow(["MAKLON PER KLIEN"])
    w.writerow(["Klien", "PO Count", "Total Qty", "Total Value", "Paid", "Outstanding"])
    for m in data["maklon_by_client"]:
        w.writerow([m["client_name"], m["po_count"], m["total_qty"], m["total_value"],
                    m["amount_paid"], m["outstanding"]])

    csv_data = buf.getvalue()
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="laporan-bulanan-{data["period"]}.csv"'}
    )
