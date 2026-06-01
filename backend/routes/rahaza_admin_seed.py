"""rahaza_admin — seed_demo_data endpoint (3-month integrated demo)."""
# ruff: noqa: E741
from fastapi import Request
from database import get_db
from auth import log_activity
from routes.rahaza_admin_shared import router, _uid, _now, MATERIAL_SEED
from routes.rahaza_admin_helpers import (
    _require_super, _ensure_period, _seed_coa, _seed_posting_profiles, _seed_master_data,
    _gen_order_number, _gen_inv_number,
)
from routes.rahaza_posting import (
    post_ar_invoice, post_ar_payment,
    post_ap_invoice, post_ap_payment,
    post_expense, post_inventory_receive, post_payroll_run, post_cogs_shipment,
)
import random
import logging
from datetime import datetime, timezone, timedelta, date

logger = logging.getLogger(__name__)


@router.post("/seed-demo-data")
async def seed_demo_data(request: Request):  # noqa: C901
    """
    Generate realistic 3-month demo data. Safe to call multiple times if
    purge was called first. Otherwise will error on duplicates.
    """
    user = await _require_super(request)
    db = get_db()
    random.seed(42)

    log = {"steps": []}

    def _step(name, data=None):
        log["steps"].append({"name": name, **(data or {})})

    # ── 1. CoA + Posting Profiles + Periods for last 4 months ───────────────
    coa_count = await _seed_coa(db, user)
    _step("coa_seed", {"inserted": coa_count})
    pp_count = await _seed_posting_profiles(db, user)
    _step("posting_profiles", {"inserted": pp_count})

    today = date.today()

    def _first_of_prev_month(d: date) -> date:
        if d.month == 1:
            return date(d.year - 1, 12, 1)
        return date(d.year, d.month - 1, 1)

    cursor = today.replace(day=1)
    for _ in range(5):
        await _ensure_period(db, cursor)
        cursor = _first_of_prev_month(cursor)
    _step("periods_ensured")

    # ── 2. Master Data ───────────────────────────────────────────────────────────
    maps = await _seed_master_data(db, user)
    _step("master_data", {
        "customers": len(maps["customers"]),
        "models": len(maps["models"]),
        "employees": len(maps["employees"]),
        "lines": len(maps["lines"]),
        "machines": len(maps["machines"]),
        "materials": len(maps["materials"]),
    })

    # ── 3. Material Receives (weekly over 90 days) ───────────────────────────
    receive_count = 0
    default_loc_id = maps["locations"].get("ZNA-GDG-A") or list(maps["locations"].values())[0]
    for week in range(12):
        d = today - timedelta(days=90 - week * 7)
        yarns = [m for m in MATERIAL_SEED if m["type"] == "yarn"]
        chosen = random.sample(yarns, 2)
        for mat in chosen:
            qty = round(random.uniform(30, 80), 1)
            mv = {
                "id": _uid(),
                "material_id": maps["materials"][mat["code"]],
                "location_id": default_loc_id,
                "movement_type": "receive",
                "quantity": qty,
                "unit_cost": mat["unit_cost"],
                "total_cost": round(qty * mat["unit_cost"]),
                "reference": f"PO-YARN-{week:03d}",
                "notes": f"Receive weekly yarn {mat['code']}",
                "timestamp": datetime.combine(d, datetime.min.time()).replace(tzinfo=timezone.utc),
            }
            await db.rahaza_material_movements.insert_one(mv)
            await db.rahaza_material_stock.update_one(
                {"material_id": mv["material_id"], "location_id": mv["location_id"]},
                {"$inc": {"qty": qty}, "$set": {"updated_at": _now()}},
            )
            try:
                await post_inventory_receive(db, mv, user)
            except Exception as e:
                logger.warning(f"Post receive err: {e}")
            receive_count += 1
    _step("material_receives", {"count": receive_count})

    # ── 4. Orders + Work Orders + AR Invoices ────────────────────────────
    orders = []
    order_idx = 1
    customer_ids = list(maps["customers"].values())
    model_ids = list(maps["models"].values())
    size_ids  = list(maps["sizes"].values())

    customer_map = {}
    async for c in db.rahaza_customers.find({"id": {"$in": customer_ids}}, {"_id": 0}):
        customer_map[c["id"]] = c
    model_map = {}
    async for m in db.rahaza_models.find({"id": {"$in": model_ids}}, {"_id": 0}):
        model_map[m["id"]] = m

    for i in range(15):
        order_date = today - timedelta(days=random.randint(10, 88))
        due_date   = order_date + timedelta(days=random.randint(30, 60))
        customer_id = random.choice(customer_ids)
        customer = customer_map.get(customer_id)
        num_items = random.randint(2, 4)
        items = []
        order_total_value = 0
        for _ in range(num_items):
            mid = random.choice(model_ids)
            sid = random.choice(size_ids)
            qty = random.choice([50, 100, 150, 200, 300])
            model = model_map.get(mid)
            unit_price = model["retail_price"]
            items.append({
                "id": _uid(),
                "model_id": mid, "size_id": sid,
                "qty": qty, "unit_price": unit_price, "notes": "",
            })
            order_total_value += qty * unit_price

        order_doc = {
            "id": _uid(),
            "order_number": await _gen_order_number(db, order_idx),
            "order_date": order_date.isoformat(),
            "due_date": due_date.isoformat(),
            "customer_id": customer_id,
            "customer_name_snapshot": customer["name"],
            "is_internal": False,
            "status": random.choice(["confirmed", "in_production", "completed", "completed", "completed"]),
            "items": items, "notes": "",
            "total_value_snapshot": order_total_value,
            "created_by": user["id"], "created_by_name": user.get("name", ""),
            "created_at": datetime.combine(order_date, datetime.min.time()).replace(tzinfo=timezone.utc),
            "updated_at": _now(),
        }
        await db.rahaza_orders.insert_one(order_doc)
        orders.append(order_doc)
        order_idx += 1

        # Work Orders (1 per item)
        wo_idx = 1
        for item in items:
            target_end = order_date + timedelta(days=random.randint(14, 28))
            if order_doc["status"] == "completed":
                wo_status = "completed"
            elif order_doc["status"] == "in_production":
                wo_status = random.choice(["in_progress", "in_progress", "completed"])
            else:
                wo_status = random.choice(["draft", "released"])

            wo_doc = {
                "id": _uid(),
                "wo_number": f"{order_doc['order_number']}-WO{wo_idx:02d}",
                "order_id": order_doc["id"],
                "order_number_snapshot": order_doc["order_number"],
                "order_item_id": item["id"],
                "model_id": item["model_id"], "size_id": item["size_id"],
                "qty": item["qty"],
                "customer_snapshot": customer["name"],
                "is_internal": False,
                "priority": random.choice(["normal", "normal", "high"]),
                "target_start_date": order_date.isoformat(),
                "target_end_date": target_end.isoformat(),
                "bom_snapshot": None,
                "status": wo_status, "notes": "",
                "created_by": user["id"], "created_by_name": user.get("name", ""),
                "created_at": datetime.combine(order_date, datetime.min.time()).replace(tzinfo=timezone.utc),
                "updated_at": _now(),
            }
            await db.rahaza_work_orders.insert_one(wo_doc)
            wo_idx += 1

        # AR Invoice
        if order_doc["status"] in ("confirmed", "in_production", "completed"):
            subtotal = order_total_value
            tax_pct = 11
            tax = round(subtotal * tax_pct / 100)
            total = subtotal + tax
            issue_date = (order_date + timedelta(days=random.randint(1, 7))).isoformat()
            due_ar = (order_date + timedelta(days=30)).isoformat()
            inv = {
                "id": _uid(),
                "invoice_number": await _gen_inv_number(db, "AR", order_idx - 1),
                "customer_id": customer_id, "order_id": order_doc["id"],
                "issue_date": issue_date, "due_date": due_ar,
                "items": [{
                    "description": f"{item['qty']} pcs {(model_map.get(item['model_id']) or {}).get('name', '')}",
                    "qty": item["qty"], "unit": "pcs",
                    "price": item["unit_price"],
                    "amount": item["qty"] * item["unit_price"],
                } for item in items],
                "subtotal": subtotal, "tax_pct": tax_pct,
                "tax_amount": tax, "total": total,
                "paid_amount": 0, "balance": total,
                "status": "sent", "notes": "",
                "created_at": datetime.combine(order_date, datetime.min.time()).replace(tzinfo=timezone.utc),
                "updated_at": _now(),
                "created_by": user["id"], "created_by_name": user.get("name", ""),
            }
            await db.rahaza_ar_invoices.insert_one(inv)
            try:
                await post_ar_invoice(db, inv, user)
            except Exception as e:
                logger.warning(f"Post ar inv err: {e}")

            if order_doc["status"] == "completed" and random.random() < 0.8:
                paid_date = (order_date + timedelta(days=random.randint(15, 40)))
                bank_id = maps["cash_accounts"]["BANK-BCA"]
                await db.rahaza_ar_invoices.update_one(
                    {"id": inv["id"]},
                    {"$set": {"paid_amount": total, "balance": 0, "status": "paid", "updated_at": _now()}},
                )
                cm = {
                    "id": _uid(), "account_id": bank_id,
                    "direction": "in", "amount": total,
                    "reference": inv["invoice_number"],
                    "source_module": "ar_payment", "source_ref": inv["id"],
                    "notes": f"Pelunasan {inv['invoice_number']}",
                    "timestamp": datetime.combine(paid_date, datetime.min.time()).replace(tzinfo=timezone.utc),
                }
                await db.rahaza_cash_movements.insert_one(cm)
                await db.rahaza_cash_accounts.update_one(
                    {"id": bank_id}, {"$inc": {"current_balance": total}}
                )
                try:
                    await post_ar_payment(db, inv, total, bank_id, paid_date.isoformat(), user, movement_id=cm["id"])
                except Exception as e:
                    logger.warning(f"Post ar pay err: {e}")

    _step("orders_wos_arinvoices", {"orders": len(orders)})

    # ── 5. AP Invoices ───────────────────────────────────────────────────────────
    ap_vendors = [
        {"name": "PT Supplier Benang Nusantara", "desc": "Pembelian benang bulanan"},
        {"name": "CV Aksesoris Bersama",         "desc": "Pembelian aksesoris"},
        {"name": "PT Listrik Negara",            "desc": "Tagihan listrik pabrik"},
        {"name": "CV Percetakan Label Cepat",    "desc": "Cetak label produk"},
        {"name": "PT Jasa Kurir Kilat",          "desc": "Jasa ekspedisi pengiriman"},
    ]
    ap_count = 0
    for i in range(10):
        inv_date = today - timedelta(days=random.randint(5, 85))
        vendor = random.choice(ap_vendors)
        subtotal = random.choice([8_500_000, 12_500_000, 22_000_000, 6_200_000, 18_900_000, 35_000_000])
        tax = round(subtotal * 0.11)
        total = subtotal + tax
        ap = {
            "id": _uid(),
            "invoice_number": f"AP-{inv_date.year}{inv_date.month:02d}-{i:03d}",
            "vendor_name": vendor["name"],
            "issue_date": inv_date.isoformat(),
            "due_date": (inv_date + timedelta(days=30)).isoformat(),
            "items": [{"description": vendor["desc"], "qty": 1, "unit": "lot", "price": subtotal, "amount": subtotal}],
            "subtotal": subtotal, "tax_pct": 11, "tax_amount": tax, "total": total,
            "paid_amount": 0, "balance": total, "status": "sent", "notes": "",
            "created_at": datetime.combine(inv_date, datetime.min.time()).replace(tzinfo=timezone.utc),
            "updated_at": _now(),
        }
        await db.rahaza_ap_invoices.insert_one(ap)
        try:
            await post_ap_invoice(db, ap, user)
        except Exception as e:
            logger.warning(f"Post ap inv err: {e}")

        if random.random() < 0.6:
            pay_date = inv_date + timedelta(days=random.randint(10, 28))
            bank_id = maps["cash_accounts"]["BANK-MDR"]
            await db.rahaza_ap_invoices.update_one(
                {"id": ap["id"]},
                {"$set": {"paid_amount": total, "balance": 0, "status": "paid", "updated_at": _now()}},
            )
            cm = {
                "id": _uid(), "account_id": bank_id, "direction": "out", "amount": total,
                "reference": ap["invoice_number"], "source_module": "ap_payment", "source_ref": ap["id"],
                "notes": f"Bayar {ap['invoice_number']}",
                "timestamp": datetime.combine(pay_date, datetime.min.time()).replace(tzinfo=timezone.utc),
            }
            await db.rahaza_cash_movements.insert_one(cm)
            await db.rahaza_cash_accounts.update_one({"id": bank_id}, {"$inc": {"current_balance": -total}})
            try:
                await post_ap_payment(db, ap, total, bank_id, pay_date.isoformat(), user, movement_id=cm["id"])
            except Exception as e:
                logger.warning(f"Post ap pay err: {e}")
        ap_count += 1
    _step("ap_invoices", {"count": ap_count})

    # ── 6. Expenses (operational OPEX) ─────────────────────────────────────────────
    expense_types = [
        {"desc": "Biaya listrik pabrik",     "cc": "CC-PROD", "amount_range": (8_500_000, 12_000_000), "gl": "6-2100"},
        {"desc": "Biaya air & limbah",       "cc": "CC-PROD", "amount_range": (1_500_000,  2_500_000), "gl": "6-2200"},
        {"desc": "Biaya telepon & internet", "cc": "CC-ADM",  "amount_range":   (800_000,  1_200_000), "gl": "6-3100"},
        {"desc": "ATK & office supplies",    "cc": "CC-ADM",  "amount_range":   (500_000,  1_500_000), "gl": "6-3200"},
        {"desc": "Biaya transportasi sales", "cc": "CC-MKT",  "amount_range": (1_000_000,  3_500_000), "gl": "6-4100"},
        {"desc": "Biaya marketing digital",  "cc": "CC-MKT",  "amount_range": (2_500_000,  5_000_000), "gl": "6-4200"},
    ]
    exp_count = 0
    for i in range(18):
        exp_date = today - timedelta(days=random.randint(1, 89))
        t = random.choice(expense_types)
        amount = random.randint(*t["amount_range"])
        bank_id = maps["cash_accounts"]["BANK-BCA"]
        exp = {
            "id": _uid(), "date": exp_date.isoformat(),
            "description": t["desc"],
            "category": t["desc"].split()[0],
            "amount": amount,
            "cost_center_id": maps["cost_centers"][t["cc"]],
            "gl_debit_code": t["gl"],
            "payment_account_id": bank_id,
            "reference": f"EXP-{exp_date.year}{exp_date.month:02d}-{i:03d}",
            "notes": "",
            "created_at": datetime.combine(exp_date, datetime.min.time()).replace(tzinfo=timezone.utc),
            "updated_at": _now(),
            "created_by": user["id"], "created_by_name": user.get("name", ""),
        }
        await db.rahaza_expenses.insert_one(exp)
        cm = {
            "id": _uid(), "account_id": bank_id, "direction": "out", "amount": amount,
            "reference": exp["reference"], "source_module": "expense", "source_ref": exp["id"],
            "notes": t["desc"],
            "timestamp": datetime.combine(exp_date, datetime.min.time()).replace(tzinfo=timezone.utc),
        }
        await db.rahaza_cash_movements.insert_one(cm)
        await db.rahaza_cash_accounts.update_one({"id": bank_id}, {"$inc": {"current_balance": -amount}})
        try:
            await post_expense(db, exp, user)
        except Exception as e:
            logger.warning(f"Post exp err: {e}")
        exp_count += 1
    _step("expenses", {"count": exp_count})

    # ── 7. Attendance (daily for all active employees over 90 days) ─────────────
    att_count = 0
    employee_docs = await db.rahaza_employees.find({"active": True}, {"_id": 0}).to_list(500)
    for emp in employee_docs:
        for day_off in range(90):
            d = today - timedelta(days=day_off)
            if d.weekday() == 6:
                continue
            r = random.random()
            status = "hadir" if r < 0.95 else ("sakit" if r < 0.97 else "alfa")
            shift_id = maps["shifts"].get("S1")
            clock_in  = "07:00" if status == "hadir" else None
            clock_out = "16:00" if status == "hadir" else None
            await db.rahaza_attendance_events.insert_one({
                "id": _uid(), "employee_id": emp["id"],
                "date": d.isoformat(), "shift_id": shift_id,
                "status": status, "clock_in": clock_in, "clock_out": clock_out,
                "hours_worked": 8.0 if status == "hadir" else 0,
                "overtime_hours": 0, "notes": "",
                "created_at": datetime.combine(d, datetime.min.time()).replace(tzinfo=timezone.utc),
                "updated_at": _now(),
            })
            att_count += 1
    _step("attendance", {"count": att_count})

    # ── 8. Payroll Runs (monthly for 3 months) ──────────────────────────────────
    payroll_count = 0
    pr_run_numbers = []
    for month_off in range(3, 0, -1):
        d_end_pf = today.replace(day=1) - timedelta(days=(month_off - 1) * 30)
        d_end_pf = d_end_pf.replace(day=1) - timedelta(days=1)
        pr_run_numbers.append(f"PR-{d_end_pf.year}{d_end_pf.month:02d}")
    existing_run_numbers = set()
    if pr_run_numbers:
        async for d in db.rahaza_payroll_runs.find(
            {"run_number": {"$in": pr_run_numbers}}, {"_id": 0, "run_number": 1}
        ):
            existing_run_numbers.add(d["run_number"])
    for month_off in range(3, 0, -1):
        d_end = today.replace(day=1) - timedelta(days=(month_off - 1) * 30)
        d_end = d_end.replace(day=1) - timedelta(days=1)
        d_start = d_end.replace(day=1)
        run_number = f"PR-{d_end.year}{d_end.month:02d}"
        if run_number in existing_run_numbers:
            continue
        total_gross = 0
        payslips = []
        for emp in employee_docs:
            scheme = emp.get("wage_scheme", "bulanan")
            base_rate = emp.get("base_rate", 0)
            if scheme == "bulanan":
                gross = base_rate
            elif scheme == "mingguan":
                gross = base_rate * 4
            elif scheme == "borongan_pcs":
                pcs_done = random.randint(800, 1500)
                gross = pcs_done * base_rate
            elif scheme == "borongan_jam":
                hours = random.randint(160, 200)
                gross = hours * base_rate
            else:
                gross = base_rate
            gross = int(gross)
            bpjs = int(gross * 0.02)
            pph = int(gross * 0.025) if gross > 5_000_000 else 0
            ded_total = bpjs + pph
            net = gross - ded_total
            total_gross += gross
            payslips.append({
                "id": _uid(), "run_id": None,
                "employee_id": emp["id"],
                "employee_code": emp["employee_code"],
                "employee_name": emp["name"],
                "pay_scheme": scheme, "wage_scheme": scheme,
                "base_rate": base_rate,
                "gross_pay": gross, "gross_salary": gross,
                "deductions": [
                    {"label": "BPJS Tenaga Kerja", "amount": bpjs},
                    *([{"label": "PPh 21", "amount": pph}] if pph > 0 else []),
                ],
                "deductions_total": ded_total, "total_deductions": ded_total,
                "net_pay": net, "net_salary": net,
                "period_from": d_start.isoformat(),
                "period_to": d_end.isoformat(),
                "created_at": datetime.combine(d_end, datetime.min.time()).replace(tzinfo=timezone.utc),
            })
        run_doc = {
            "id": _uid(), "run_number": run_number,
            "period_from": d_start.isoformat(), "period_to": d_end.isoformat(),
            "status": "finalized",
            "total_gross": total_gross,
            "total_net": total_gross - int(total_gross * 0.045),
            "total_deductions": int(total_gross * 0.045),
            "total_employees": len(payslips), "employee_count": len(payslips),
            "notes": "",
            "finalized_at": datetime.combine(d_end, datetime.min.time()).replace(tzinfo=timezone.utc),
            "finalized_by": user["id"],
            "created_at": datetime.combine(d_end, datetime.min.time()).replace(tzinfo=timezone.utc),
            "updated_at": _now(),
        }
        await db.rahaza_payroll_runs.insert_one(run_doc)
        for slip in payslips:
            slip["run_id"] = run_doc["id"]
            await db.rahaza_payslips.insert_one(slip)
        try:
            await post_payroll_run(db, run_doc, user)
        except Exception as e:
            logger.warning(f"Post payroll err: {e}")
        payroll_count += 1
    _step("payroll_runs", {"count": payroll_count})

    # ── 9. Bundles ───────────────────────────────────────────────────────────────
    bundle_count = 0
    wos_in_prog = await db.rahaza_work_orders.find(
        {"status": {"$in": ["in_progress", "completed"]}}, {"_id": 0}
    ).to_list(500)
    for wo in wos_in_prog[:30]:
        num_bundles = random.randint(3, 5)
        bundle_qty = wo["qty"] // num_bundles
        for b_idx in range(num_bundles):
            process_code = random.choice(["RAJUT", "LINKING", "SEWING", "QC", "STEAM", "PACKING"])
            status_options = {
                "in_progress": ["open", "in_process", "in_process", "complete"],
                "completed": ["complete"],
            }
            bundle = {
                "id": _uid(),
                "bundle_number": f"B-{wo['wo_number']}-{b_idx+1:02d}",
                "work_order_id": wo["id"],
                "wo_number_snapshot": wo["wo_number"],
                "model_id": wo["model_id"], "size_id": wo["size_id"],
                "qty": bundle_qty,
                "status": random.choice(status_options[wo["status"]]),
                "current_process_id": maps["processes"].get(process_code),
                "current_line_id": random.choice(list(maps["lines"].values())),
                "parent_bundle_id": None, "notes": "",
                "created_at": _now() - timedelta(days=random.randint(1, 30)),
                "updated_at": _now(),
            }
            await db.rahaza_bundles.insert_one(bundle)
            bundle_count += 1
    _step("bundles", {"count": bundle_count})

    # ── 10. Shipments ───────────────────────────────────────────────────────────
    ship_count = 0
    completed_wos = await db.rahaza_work_orders.find({"status": "completed"}, {"_id": 0}).limit(15).to_list(500)
    cw_order_ids = list({wo.get("order_id") for wo in completed_wos if wo.get("order_id")})
    cw_order_map = {}
    if cw_order_ids:
        async for o in db.rahaza_orders.find({"id": {"$in": cw_order_ids}}, {"_id": 0}):
            cw_order_map[o["id"]] = o
    for idx, wo in enumerate(completed_wos):
        order = cw_order_map.get(wo.get("order_id")) if wo.get("order_id") else None
        if not order:
            continue
        ship_date = today - timedelta(days=random.randint(5, 60))
        ship = {
            "id": _uid(),
            "shipment_number": f"SJ-{ship_date.year}{ship_date.month:02d}-{idx:04d}",
            "work_order_id": wo["id"], "wo_number_snapshot": wo["wo_number"],
            "order_id": order["id"], "order_number_snapshot": order["order_number"],
            "customer_id": order["customer_id"],
            "customer_name_snapshot": order.get("customer_name_snapshot", ""),
            "ship_date": ship_date.isoformat(), "qty": wo["qty"],
            "status": "dispatched", "notes": "",
            "created_at": datetime.combine(ship_date, datetime.min.time()).replace(tzinfo=timezone.utc),
            "updated_at": _now(), "created_by": user["id"],
        }
        await db.rahaza_shipments.insert_one(ship)
        try:
            await post_cogs_shipment(db, ship, user)
        except Exception as e:
            logger.warning(f"Post cogs ship err: {e}")
        ship_count += 1
    _step("shipments", {"count": ship_count})

    # ── 11. Line Assignments (daily for each line, 90 days) ───────────────────
    assign_count = 0
    rajut_emp_ids   = [maps["employees"][c] for c in maps["employees"] if c.startswith("EMP-R")]
    linking_emp_ids = [maps["employees"][c] for c in maps["employees"] if c.startswith("EMP-L")]
    for day_off in range(90):
        d = today - timedelta(days=day_off)
        if d.weekday() == 6:
            continue
        for line_code, line_id in maps["lines"].items():
            emp_pool = linking_emp_ids if line_code == "LINE-C" else rajut_emp_ids
            if not emp_pool:
                continue
            emp_ids = random.sample(emp_pool, min(2, len(emp_pool)))
            target = random.randint(80, 200)
            actual = int(target * random.uniform(0.75, 1.05))
            await db.rahaza_line_assignments.insert_one({
                "id": _uid(), "line_id": line_id,
                "assign_date": d.isoformat(),
                "shift_id": maps["shifts"].get("S1"),
                "employee_ids": emp_ids,
                "target_qty": target, "actual_qty": actual,
                "notes": "",
                "created_at": datetime.combine(d, datetime.min.time()).replace(tzinfo=timezone.utc),
                "updated_at": _now(),
            })
            assign_count += 1
    _step("line_assignments", {"count": assign_count})

    # ── 12. WIP Events ────────────────────────────────────────────────────────────
    wip_count = 0
    all_assignments = await db.rahaza_line_assignments.find({}, {"_id": 0}).to_list(500)
    process_map = {p["id"]: p for p in await db.rahaza_processes.find({"active": True}, {"_id": 0}).to_list(500)}
    line_map = {ln["id"]: ln for ln in await db.rahaza_lines.find({}, {"_id": 0}).to_list(500)}
    employee_docs_list = await db.rahaza_employees.find({"active": True}, {"_id": 0}).to_list(500)
    for assignment in all_assignments:
        line_id = assignment.get("line_id")
        line = line_map.get(line_id) or {}
        process_id = line.get("process_id")
        process = process_map.get(process_id) or {}
        proc_code = process.get("code") or "RAJUT"
        assign_date = assignment.get("assign_date")
        if not assign_date:
            continue
        actual_qty = assignment.get("actual_qty") or 0
        emp_ids = assignment.get("employee_ids") or []
        if not emp_ids and employee_docs_list:
            emp_ids = [random.choice(employee_docs_list)["id"]]
        for emp_id in emp_ids:
            op_qty = actual_qty // max(1, len(emp_ids))
            if op_qty <= 0:
                continue
            ev = {
                "id": _uid(),
                "timestamp": datetime.combine(
                    datetime.fromisoformat(assign_date).date(), datetime.min.time()
                ).replace(tzinfo=timezone.utc),
                "event_date": assign_date,
                "line_id": line_id, "process_id": process_id, "process_code": proc_code,
                "location_id": line.get("location_id"),
                "model_id": None, "size_id": None, "work_order_id": None,
                "event_type": "output", "qty": op_qty,
                "notes": "Seed data", "operator_id": emp_id,
                "created_by": user["id"], "created_by_name": user.get("name", ""),
            }
            await db.rahaza_wip_events.insert_one(ev)
            wip_count += 1
        total_qty = actual_qty
        qc_pass_qty = int(total_qty * 0.10)
        qc_fail_qty = int(total_qty * 0.05)
        ts_base = datetime.combine(
            datetime.fromisoformat(assign_date).date(), datetime.min.time()
        ).replace(tzinfo=timezone.utc)
        if qc_pass_qty > 0:
            await db.rahaza_wip_events.insert_one({
                "id": _uid(), "timestamp": ts_base, "event_date": assign_date,
                "line_id": line_id, "process_id": process_id, "process_code": proc_code,
                "location_id": line.get("location_id"),
                "model_id": None, "work_order_id": None,
                "event_type": "qc_pass", "qty": qc_pass_qty,
                "notes": "Seed QC data", "operator_id": user["id"],
                "created_by": user["id"], "created_by_name": user.get("name", ""),
            })
            wip_count += 1
        if qc_fail_qty > 0:
            await db.rahaza_wip_events.insert_one({
                "id": _uid(), "timestamp": ts_base, "event_date": assign_date,
                "line_id": line_id, "process_id": process_id, "process_code": proc_code,
                "location_id": line.get("location_id"),
                "model_id": None, "work_order_id": None,
                "event_type": "qc_fail", "qty": qc_fail_qty,
                "notes": "Seed QC data", "operator_id": user["id"],
                "created_by": user["id"], "created_by_name": user.get("name", ""),
            })
            wip_count += 1
    _step("wip_events", {"count": wip_count})

    # ── 13. QC Events ────────────────────────────────────────────────────────────
    qc_event_count = 0
    all_bundles = await db.rahaza_bundles.find(
        {"status": {"$in": ["complete", "completed", "qc_pass"]}}, {"_id": 0}
    ).to_list(500)
    for b in all_bundles[:100]:
        total_qty = b.get("quantity") or b.get("qty") or 20
        pass_qty = int(total_qty * random.uniform(0.85, 0.98))
        fail_qty = total_qty - pass_qty
        created_at = b.get("created_at") or b.get("updated_at")
        if created_at and hasattr(created_at, "isoformat"):
            ev_date = created_at.isoformat()
        elif isinstance(created_at, str):
            ev_date = created_at
        else:
            days_ago = random.randint(0, 30)
            ev_date = (date.today() - timedelta(days=days_ago)).isoformat() + "T08:00:00Z"
        qc_doc = {
            "id": _uid(), "bundle_id": b.get("id"),
            "work_order_id": b.get("work_order_id"),
            "line_id": b.get("current_line_id") or b.get("line_id"),
            "employee_id": user["id"], "model_id": b.get("model_id"),
            "shift_id": None, "checked_qty": total_qty,
            "pass_qty": pass_qty, "fail_qty": fail_qty,
            "defect_code_ids": [], "defect_details": [],
            "notes": "Seed QC inspection",
            "verdict": "pass" if fail_qty == 0 else "fail",
            "created_at": ev_date, "created_by": user["id"],
        }
        await db.rahaza_qc_events.insert_one(qc_doc)
        qc_event_count += 1
    _step("qc_events", {"count": qc_event_count})

    _step("complete")
    await log_activity(user["id"], user.get("name", ""), "seed_demo", "admin", f"ok steps={len(log['steps'])}")
    return {"ok": True, **log}
