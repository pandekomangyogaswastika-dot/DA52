"""
PT Rahaza — Management Dashboard & Reports (Fase 10)

Endpoints (prefix /api/rahaza):
  - GET /management/overview         : KPI lengkap utk dashboard management
  - GET /management/daily-output     : output harian per proses (untuk chart 7 hari terakhir)
  - GET /management/top-models       : top model by output (30 hari)
  - GET /management/top-customers    : top customer by order value
  - GET /management/on-time-delivery : % WO completed tepat waktu
  - GET /management/payroll-summary  : ringkasan run payroll terakhir
  - GET /reports/{report_type}       : laporan bisnis (production|progress|financial|shipment|rework|material-issue)
                                       Pagination: ?page=1&limit=50 → {items, pagination}
                                       Backward compat: tanpa page → array response

Session 9 — Pagination added to /reports/{report_type}
"""
from fastapi import APIRouter, Request, HTTPException
from database import get_db
from auth import require_auth, serialize_doc
from datetime import date, timedelta
from routes.shared import get_pagination_params, paginated_response

router = APIRouter(prefix="/api/rahaza", tags=["rahaza-reports"])


def _today(): return date.today()


@router.get("/management/overview")
async def overview(request: Request):
    """
    KPI overview. Phase 13 — support date_from/date_to query params.
    Jika keduanya disupply, window analitis 7-hari akan direplace rentang
    custom. Semua metric tetap relatif (start7/start30 = from/to).
    """
    await require_auth(request)
    db = get_db()
    today = _today()
    t_iso = today.isoformat()

    # Phase 13.3 — custom period support
    sp = request.query_params
    date_from = sp.get("date_from") or None
    date_to = sp.get("date_to") or None
    if date_from and date_to:
        # Validate date format
        try:
            from datetime import datetime as _dt
            _dt.fromisoformat(date_from)
            _dt.fromisoformat(date_to)
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Format tanggal tidak valid. Gunakan YYYY-MM-DD.")
        if date_to < date_from:
            raise HTTPException(status_code=400, detail="date_to tidak boleh lebih awal dari date_from.")
        start7 = date_from
        t_iso = date_to
    else:
        start7 = (today - timedelta(days=7)).isoformat()
        (today - timedelta(days=30)).isoformat()

    # Produksi: total output pada window
    wip_7d = await db.rahaza_wip_events.aggregate([
        {"$match": {"event_type": "output", "event_date": {"$gte": start7, "$lte": t_iso}}},
        {"$group": {"_id": None, "total": {"$sum": "$qty"}, "count": {"$sum": 1}}}
    ]).to_list(500)
    output_7d = (wip_7d[0] if wip_7d else {}).get("total", 0) or 0

    # WO: active & completed counts
    wo_active = await db.rahaza_work_orders.count_documents({"status": {"$in": ["draft", "released", "in_production"]}})
    wo_completed = await db.rahaza_work_orders.count_documents({"status": "completed"})

    # Orders: in_production
    orders_active = await db.rahaza_orders.count_documents({"status": {"$in": ["confirmed", "in_production"]}})

    # Employees active
    emp_active = await db.rahaza_employees.count_documents({"active": True})

    # Attendance today
    att_today = await db.rahaza_attendance_events.aggregate([
        {"$match": {"date": t_iso}},
        {"$group": {"_id": "$status", "count": {"$sum": 1}}}
    ]).to_list(500)
    att_summary = {a["_id"]: a["count"] for a in att_today}

    # QC stats (7d)
    qc_pass = await db.rahaza_wip_events.aggregate([
        {"$match": {"event_type": "qc_pass", "event_date": {"$gte": start7}}},
        {"$group": {"_id": None, "total": {"$sum": "$qty"}}}
    ]).to_list(500)
    qc_fail = await db.rahaza_wip_events.aggregate([
        {"$match": {"event_type": "qc_fail", "event_date": {"$gte": start7}}},
        {"$group": {"_id": None, "total": {"$sum": "$qty"}}}
    ]).to_list(500)
    qc_pass_qty = (qc_pass[0] if qc_pass else {}).get("total", 0) or 0
    qc_fail_qty = (qc_fail[0] if qc_fail else {}).get("total", 0) or 0
    qc_rate = (qc_pass_qty / (qc_pass_qty + qc_fail_qty) * 100) if (qc_pass_qty + qc_fail_qty) > 0 else 0

    # Finance
    ar = await db.rahaza_ar_invoices.aggregate([
        {"$match": {"status": {"$in": ["sent", "partial_paid", "overdue"]}}},
        {"$group": {"_id": None, "total": {"$sum": "$balance"}}}
    ]).to_list(500)
    ap = await db.rahaza_ap_invoices.aggregate([
        {"$match": {"status": {"$in": ["sent", "partial_paid"]}}},
        {"$group": {"_id": None, "total": {"$sum": "$balance"}}}
    ]).to_list(500)
    cash = await db.rahaza_cash_accounts.aggregate([
        {"$match": {"active": True}},
        {"$group": {"_id": None, "total": {"$sum": "$balance"}}}
    ]).to_list(500)

    # Low stock materials
    low_stock = await db.rahaza_material_stock.aggregate([
        {"$lookup": {"from": "rahaza_materials", "localField": "material_id", "foreignField": "id", "as": "m"}},
        {"$unwind": "$m"},
        {"$match": {"$expr": {"$lt": ["$qty_available", "$m.min_stock"]}}},
        {"$count": "n"}
    ]).to_list(500)
    low_count = (low_stock[0] if low_stock else {}).get("n", 0)

    return {
        "production": {
            "output_7d": output_7d,
            "wo_active": wo_active,
            "wo_completed": wo_completed,
            "orders_active": orders_active,
            "qc_pass_7d": qc_pass_qty,
            "qc_fail_7d": qc_fail_qty,
            "qc_rate_pct": round(qc_rate, 1),
        },
        "hr": {
            "employees_active": emp_active,
            "attendance_today": att_summary,
        },
        "finance": {
            "ar_outstanding": round((ar[0] if ar else {}).get("total", 0) or 0),
            "ap_outstanding": round((ap[0] if ap else {}).get("total", 0) or 0),
            "cash_balance": round((cash[0] if cash else {}).get("total", 0) or 0),
        },
        "warehouse": {
            "low_stock_materials": low_count,
        },
    }


@router.get("/management/daily-output")
async def daily_output(request: Request, days: int = 7):
    """
    Output per hari per proses. Phase 13 — accepts date_from/date_to
    to override the days window.
    """
    await require_auth(request)
    db = get_db()
    today = _today()
    sp = request.query_params
    date_from = sp.get("date_from") or None
    date_to = sp.get("date_to") or None
    if date_from and date_to:
        start = date_from
        end = date_to
    else:
        start = (today - timedelta(days=days-1)).isoformat()
        end = today.isoformat()
    rows = await db.rahaza_wip_events.aggregate([
        {"$match": {"event_type": "output", "event_date": {"$gte": start, "$lte": end}}},
        {"$group": {"_id": {"date": "$event_date", "process_code": "$process_code"}, "qty": {"$sum": "$qty"}}},
        {"$sort": {"_id.date": 1}}
    ]).to_list(500)
    # Build timeline per date from [start..end]
    from datetime import datetime as _dt
    try:
        sd = _dt.fromisoformat(start).date()
        ed = _dt.fromisoformat(end).date()
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Format tanggal tidak valid. Gunakan YYYY-MM-DD.")
    if ed < sd:
        raise HTTPException(status_code=400, detail="date_to tidak boleh lebih awal dari date_from.")
    span = max(1, (ed - sd).days + 1)
    # Batas aman 365 hari untuk performa
    if span > 365:
        raise HTTPException(status_code=400, detail="Rentang maksimal 365 hari.")
    dates = [(sd + timedelta(days=i)).isoformat() for i in range(span)]
    timeline = {d: {"date": d, "total": 0, "by_process": {}} for d in dates}
    for r in rows:
        d = r["_id"]["date"]
        p = r["_id"]["process_code"] or "UNK"
        qty = r["qty"]
        if d in timeline:
            timeline[d]["total"] += qty
            timeline[d]["by_process"][p] = qty
    return {"days": span, "timeline": list(timeline.values()), "date_from": start, "date_to": end}


@router.get("/management/top-models")
async def top_models(request: Request, days: int = 30, limit: int = 10):
    await require_auth(request)
    db = get_db()
    start = (_today() - timedelta(days=days)).isoformat()
    rows = await db.rahaza_wip_events.aggregate([
        {"$match": {"event_type": "output", "event_date": {"$gte": start}}},
        {"$group": {"_id": "$model_id", "qty": {"$sum": "$qty"}}},
        {"$sort": {"qty": -1}}, {"$limit": limit},
    ]).to_list(500)
    mids = [r["_id"] for r in rows if r.get("_id")]
    models = await db.rahaza_models.find({"id": {"$in": mids}}, {"_id": 0}).to_list(500) if mids else []
    mmap = {m["id"]: m for m in models}
    out = []
    for r in rows:
        m = mmap.get(r["_id"]) or {}
        out.append({"model_id": r["_id"], "code": m.get("code"), "name": m.get("name"), "qty": r["qty"]})
    return {"days": days, "items": out}


@router.get("/management/top-customers")
async def top_customers(request: Request, limit: int = 10):
    await require_auth(request)
    db = get_db()
    rows = await db.rahaza_orders.aggregate([
        {"$match": {"status": {"$ne": "cancelled"}}},
        {"$group": {"_id": "$customer_id", "total_qty": {"$sum": "$total_qty"}, "orders": {"$sum": 1}}},
        {"$sort": {"total_qty": -1}}, {"$limit": limit},
    ]).to_list(500)
    cids = [r["_id"] for r in rows if r.get("_id")]
    cs = await db.rahaza_customers.find({"id": {"$in": cids}}, {"_id": 0}).to_list(500) if cids else []
    cmap = {c["id"]: c for c in cs}
    out = []
    for r in rows:
        c = cmap.get(r["_id"]) or {}
        out.append({"customer_id": r["_id"], "code": c.get("code"), "name": c.get("name"), "orders": r["orders"], "total_qty": r["total_qty"]})
    return {"items": out}


@router.get("/management/on-time-delivery")
async def on_time_delivery(request: Request, days: int = 30):
    await require_auth(request)
    db = get_db()
    start = (_today() - timedelta(days=days)).isoformat()
    rows = await db.rahaza_work_orders.find({"status": "completed", "end_date": {"$gte": start}}, {"_id": 0}).to_list(500)
    total = len(rows)
    on_time = 0
    for r in rows:
        due = r.get("target_date") or r.get("due_date")
        completed = r.get("end_date") or r.get("completed_at")
        if due and completed and completed <= due:
            on_time += 1
    rate = (on_time / total * 100) if total > 0 else 0
    return {"days": days, "total_wo": total, "on_time": on_time, "rate_pct": round(rate, 1)}


@router.get("/management/payroll-summary")
async def payroll_summary(request: Request):
    await require_auth(request)
    db = get_db()
    latest = await db.rahaza_payroll_runs.find_one({}, {"_id": 0}, sort=[("created_at", -1)])
    return {"latest_run": serialize_doc(latest) if latest else None}



# ─────────────────────────────────────────────────────────────────────────────
# LAPORAN BISNIS (Rahaza-based, digunakan oleh ReportsModule)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/reports/{report_type}")
async def get_rahaza_report(report_type: str, request: Request):
    """
    Endpoint laporan bisnis berbasis data Rahaza.
    Types: production | progress | financial | shipment | rework | material-issue

    Pagination (backward-compatible):
      - Dengan ?page=1&limit=50 → returns {items, pagination}
      - Tanpa page param → returns legacy array (backward compat)
    """
    await require_auth(request)
    db = get_db()
    sp = request.query_params
    date_from = sp.get("date_from", "")
    date_to = sp.get("date_to", "")

    # Pagination support (backward compatible)
    use_pagination = "page" in sp or "limit" in sp
    if use_pagination:
        page, limit, skip = get_pagination_params(request, default_limit=50)

    def _date_filter(field: str):
        f = {}
        if date_from:
            f["$gte"] = date_from
        if date_to:
            f["$lte"] = date_to
        return {field: f} if f else {}

    if report_type == "production":
        # Pesanan + Work Orders
        query = {}
        if date_from or date_to:
            query.update(_date_filter("order_date"))

        if use_pagination:
            # Paginated: paginate at order level
            total_orders = await db.rahaza_orders.count_documents(query)
            orders = await db.rahaza_orders.find(query, {"_id": 0}).sort("order_date", -1).skip(skip).limit(limit).to_list(length=10000)
        else:
            orders = await db.rahaza_orders.find(query, {"_id": 0}).sort("order_date", -1).to_list(500)

        # Pre-load model and size lookups
        model_cache = {m["id"]: m.get("name", m.get("code", "?")) for m in await db.rahaza_models.find({}, {"id": 1, "name": 1, "code": 1, "_id": 0}).to_list(500)}
        size_cache = {s["id"]: s.get("name", s.get("code", "?")) for s in await db.rahaza_sizes.find({}, {"id": 1, "name": 1, "code": 1, "_id": 0}).to_list(500)}
        rows = []
        for o in orders:
            # Ambil semua WO terkait
            wo_list = await db.rahaza_work_orders.find(
                {"order_id": o["id"]}, {"_id": 0}
            ).to_list(500)
            if wo_list:
                for wo in wo_list:
                    # Ambil progress WIP
                    qty_done = sum(ev.get("qty", 0) for ev in await db.rahaza_wip_events.find(
                        {"work_order_id": wo["id"], "process_code": "PACKING"}, {"qty": 1, "_id": 0}
                    ).to_list(500))
                    # QC pass
                    qc_pass = sum(ev.get("pass_qty", 0) for ev in await db.rahaza_qc_events.find(
                        {"work_order_id": wo["id"]}, {"pass_qty": 1, "_id": 0}
                    ).to_list(500))
                    model_name = model_cache.get(wo.get("model_id", ""), wo.get("model_snapshot", wo.get("model_id", "-")))
                    size_name = size_cache.get(wo.get("size_id", ""), wo.get("size_snapshot", wo.get("size_id", "-")))
                    rows.append({
                        "tanggal": o.get("order_date", ""),
                        "no_order": o.get("order_number", ""),
                        "no_wo": wo.get("wo_number", ""),
                        "pelanggan": o.get("customer_name_snapshot", wo.get("customer_snapshot", "")),
                        "model": model_name,
                        "ukuran": size_name,
                        "qty_order": wo.get("qty", 0),
                        "qty_selesai": qty_done,
                        "qty_qc_pass": qc_pass,
                        "pct_selesai": round((qty_done / wo["qty"] * 100) if wo.get("qty", 0) > 0 else 0, 1),
                        "status_wo": wo.get("status", ""),
                        "target_mulai": wo.get("target_start_date", ""),
                        "target_selesai": wo.get("target_end_date", ""),
                        "status_order": o.get("status", ""),
                    })
            else:
                rows.append({
                    "tanggal": o.get("order_date", ""),
                    "no_order": o.get("order_number", ""),
                    "no_wo": "-",
                    "pelanggan": o.get("customer_name_snapshot", ""),
                    "model": "",
                    "ukuran": "",
                    "qty_order": 0,
                    "qty_selesai": 0,
                    "qty_qc_pass": 0,
                    "pct_selesai": 0,
                    "status_wo": "-",
                    "target_mulai": "",
                    "target_selesai": "",
                    "status_order": o.get("status", ""),
                })

        if use_pagination:
            return paginated_response(serialize_doc(rows), total_orders, page, limit)
        return serialize_doc(rows)

    elif report_type == "progress":
        # Progress WIP events per hari per proses
        query = {}
        if date_from or date_to:
            query.update(_date_filter("event_date"))

        if use_pagination:
            total_count = await db.rahaza_wip_events.count_documents(query)
            events = await db.rahaza_wip_events.find(query, {"_id": 0}).sort("event_date", -1).skip(skip).limit(limit).to_list(length=10000)
        else:
            events = await db.rahaza_wip_events.find(query, {"_id": 0}).sort("event_date", -1).to_list(500)

        # Batch prefetch WO info for all unique work_order_ids
        wo_ids_uniq = list({ev.get("work_order_id", "") for ev in events if ev.get("work_order_id")})
        wo_cache = {}
        if wo_ids_uniq:
            async for d in db.rahaza_work_orders.find(
                {"id": {"$in": wo_ids_uniq}},
                {"_id": 0, "id": 1, "wo_number": 1, "status": 1, "qty": 1, "model_snapshot": 1, "customer_snapshot": 1}
            ):
                wo_cache[d["id"]] = d
        rows = []
        for ev in events:
            wid = ev.get("work_order_id", "")
            wo = wo_cache.get(wid, {})
            rows.append({
                "tanggal": str(ev.get("event_date", str(ev.get("timestamp", ""))[:10] if ev.get("timestamp") else "")),
                "no_wo": wo.get("wo_number", (wid[:8] + "...") if wid else ""),
                "pelanggan": wo.get("customer_snapshot", ""),
                "model": wo.get("model_snapshot", ev.get("model_id", "")),
                "proses": ev.get("process_code", ev.get("process_id", "")),
                "qty": ev.get("qty", 0),
                "jenis": ev.get("event_type", "output"),
                "notes": ev.get("notes", ""),
            })

        if use_pagination:
            return paginated_response(serialize_doc(rows), total_count, page, limit)
        return serialize_doc(rows)

    elif report_type == "financial":
        # AR Invoices
        query = {}
        if date_from or date_to:
            query.update(_date_filter("issue_date"))

        if use_pagination:
            total_count = await db.rahaza_ar_invoices.count_documents(query)
            invoices = await db.rahaza_ar_invoices.find(query, {"_id": 0}).sort("issue_date", -1).skip(skip).limit(limit).to_list(length=10000)
        else:
            invoices = await db.rahaza_ar_invoices.find(query, {"_id": 0}).sort("issue_date", -1).to_list(500)

        # Batch fetch customer names
        cust_ids_uniq = list({inv.get("customer_id", "") for inv in invoices if inv.get("customer_id")})
        cust_name_map = {}
        if cust_ids_uniq:
            async for d in db.rahaza_customers.find(
                {"id": {"$in": cust_ids_uniq}}, {"_id": 0, "id": 1, "name": 1}
            ):
                cust_name_map[d["id"]] = d.get("name", "")
        rows = []
        for inv in invoices:
            cust_id = inv.get("customer_id", "")
            cust_name = cust_name_map.get(cust_id) if cust_id else None
            rows.append({
                "tanggal": inv.get("issue_date", ""),
                "no_invoice": inv.get("invoice_number", ""),
                "pelanggan": (cust_name if cust_name else inv.get("customer_snapshot", "")),
                "subtotal": inv.get("subtotal", 0),
                "pajak": inv.get("tax_amount", 0),
                "total": inv.get("total", 0),
                "terbayar": inv.get("paid_amount", 0),
                "sisa": inv.get("balance", inv.get("total", 0) - inv.get("paid_amount", 0)),
                "status": inv.get("status", ""),
                "jatuh_tempo": inv.get("due_date", ""),
            })

        if use_pagination:
            return paginated_response(serialize_doc(rows), total_count, page, limit)
        return serialize_doc(rows)

    elif report_type == "shipment":
        # Pengiriman ke buyer
        query = {}
        if date_from or date_to:
            query.update(_date_filter("ship_date"))

        if use_pagination:
            total_count = await db.rahaza_shipments.count_documents(query)
            shipments = await db.rahaza_shipments.find(query, {"_id": 0}).sort("ship_date", -1).skip(skip).limit(limit).to_list(length=10000)
        else:
            shipments = await db.rahaza_shipments.find(query, {"_id": 0}).sort("ship_date", -1).to_list(500)

        rows = []
        for s in shipments:
            rows.append({
                "tanggal": s.get("ship_date", ""),
                "no_pengiriman": s.get("shipment_number", ""),
                "no_wo": s.get("wo_number_snapshot", ""),
                "no_order": s.get("order_number_snapshot", ""),
                "pelanggan": s.get("customer_name_snapshot", ""),
                "qty": s.get("qty", 0),
                "status": s.get("status", ""),
                "notes": s.get("notes", ""),
            })

        if use_pagination:
            return paginated_response(serialize_doc(rows), total_count, page, limit)
        return serialize_doc(rows)

    elif report_type == "rework":
        # QC events yang fail
        query = {"verdict": "fail"}
        if date_from or date_to:
            query.update(_date_filter("created_at"))

        if use_pagination:
            total_count = await db.rahaza_qc_events.count_documents(query)
            qc_fails = await db.rahaza_qc_events.find(query, {"_id": 0}).sort("created_at", -1).skip(skip).limit(limit).to_list(length=10000)
        else:
            qc_fails = await db.rahaza_qc_events.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)

        # Batch fetch WO info
        rw_wo_ids = list({ev.get("work_order_id", "") for ev in qc_fails if ev.get("work_order_id")})
        rw_wo_map = {}
        if rw_wo_ids:
            async for d in db.rahaza_work_orders.find(
                {"id": {"$in": rw_wo_ids}}, {"_id": 0, "id": 1, "wo_number": 1, "model_snapshot": 1}
            ):
                rw_wo_map[d["id"]] = d
        rows = []
        for ev in qc_fails:
            wid = ev.get("work_order_id", "")
            wo = rw_wo_map.get(wid)
            rows.append({
                "tanggal": str(ev.get("created_at", ""))[:10],
                "no_wo": (wo["wo_number"] if wo else wid[:12]),
                "model": (wo["model_snapshot"] if wo else ""),
                "qty_periksa": ev.get("checked_qty", 0),
                "qty_pass": ev.get("pass_qty", 0),
                "qty_fail": ev.get("fail_qty", 0),
                "kode_defect": ", ".join([d.get("code", "") for d in ev.get("defect_details", [])]),
                "verdict": ev.get("verdict", ""),
                "notes": ev.get("notes", ""),
            })

        if use_pagination:
            return paginated_response(serialize_doc(rows), total_count, page, limit)
        return serialize_doc(rows)

    elif report_type == "material-issue":
        # Material Issues
        query = {}
        if date_from or date_to:
            query.update(_date_filter("created_at"))

        if use_pagination:
            total_count = await db.rahaza_material_issues.count_documents(query)
            mis = await db.rahaza_material_issues.find(query, {"_id": 0}).sort("created_at", -1).skip(skip).limit(limit).to_list(length=10000)
        else:
            mis = await db.rahaza_material_issues.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)

        rows = []
        for mi in mis:
            rows.append({
                "tanggal": str(mi.get("created_at", ""))[:10],
                "no_mi": mi.get("mi_number", mi.get("id", "")[:8]),
                "no_wo": mi.get("wo_number_snapshot", mi.get("work_order_id", "")),
                "material": mi.get("material_name", mi.get("material_id", "")),
                "qty_diminta": mi.get("qty_requested", 0),
                "qty_issued": mi.get("qty_issued", 0),
                "satuan": mi.get("unit", "pcs"),
                "status": mi.get("status", ""),
                "notes": mi.get("notes", ""),
            })

        if use_pagination:
            return paginated_response(serialize_doc(rows), total_count, page, limit)
        return serialize_doc(rows)

    else:
        return []
