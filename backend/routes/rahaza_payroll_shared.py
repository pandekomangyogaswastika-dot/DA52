# ruff: noqa: F401
"""
rahaza_payroll_shared.py — Shared Helpers & Constants
Extracted from rahaza_payroll.py refactoring

Created: Session #11.19 Phase 3.2 Batch #4
Expanded: Session #11.20 — added _require_hr, _to_date, _date_range_filter,
          _generate_run_number, _compute_payslip_for_employee,
          _get_applicable_allowances (proper async versions)
"""
import uuid
from datetime import datetime, timezone, date, timedelta
from fastapi import Request, HTTPException
from auth import require_auth

# ═══════════════════════════════════════════════════════════════════════════════
# CONSTANTS
# ═══════════════════════════════════════════════════════════════════════════════
VALID_SCHEMES = ["pcs", "hourly", "weekly", "monthly"]
VALID_PERIOD_TYPES = ["weekly", "monthly"]
VALID_RUN_STATUS = ["draft", "finalized", "cancelled"]


# ═══════════════════════════════════════════════════════════════════════════════
# BASIC HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

def _uid():
    """Generate UUID"""
    return str(uuid.uuid4())


def _now():
    """Get current UTC timestamp"""
    return datetime.now(timezone.utc)


def _to_date(s: str) -> date:
    """Parse YYYY-MM-DD string into date object"""
    return datetime.strptime(s, "%Y-%m-%d").date()


def _date_range_filter(from_iso: str, to_iso: str) -> dict:
    """MongoDB $gte/$lte filter for ISO date range"""
    return {"$gte": from_iso, "$lte": to_iso}


# ═══════════════════════════════════════════════════════════════════════════════
# RBAC
# ═══════════════════════════════════════════════════════════════════════════════

async def _require_hr(request: Request):
    """Authorization: only HR/Manager/Admin/Owner roles can access payroll runs."""
    user = await require_auth(request)
    role = (user.get("role") or "").lower()
    if role in ("superadmin", "admin", "owner", "hr", "manager"):
        return user
    perms = user.get("_permissions") or []
    if "*" in perms or "hr.manage" in perms or "payroll.manage" in perms:
        return user
    raise HTTPException(403, "Forbidden: butuh permission HR/payroll.")


# ═══════════════════════════════════════════════════════════════════════════════
# RUN NUMBER GENERATION
# ═══════════════════════════════════════════════════════════════════════════════

async def _generate_run_number(db) -> str:
    """Generate unique run number: PR-YYYYMMDD-NNN"""
    today = date.today().strftime("%Y%m%d")
    prefix = f"PR-{today}-"
    count = await db.rahaza_payroll_runs.count_documents({"run_number": {"$regex": f"^{prefix}"}})
    return f"{prefix}{count + 1:03d}"


# ═══════════════════════════════════════════════════════════════════════════════
# ALLOWANCE HELPER (PROPER ASYNC VERSION)
# ═══════════════════════════════════════════════════════════════════════════════

async def _get_applicable_allowances(db, employee: dict) -> list:
    """
    Ambil semua tunjangan tetap yang berlaku untuk karyawan ini.
    applicable_to: 'all' | 'department' | 'employee'
    """
    emp_id = employee.get("id") or employee.get("employee_id")
    dept = employee.get("department") or ""

    all_templates = await db.da_payroll_allowances.find(
        {"is_active": True}, {"_id": 0}
    ).to_list(500)

    applicable = []
    for t in all_templates:
        scope = t.get("applicable_to", "all")
        if scope == "all":
            applicable.append(t)
        elif scope == "department" and dept and t.get("department") == dept:
            applicable.append(t)
        elif scope == "employee":
            if emp_id in (t.get("employee_ids") or []):
                applicable.append(t)

    return applicable


# ═══════════════════════════════════════════════════════════════════════════════
# PAYSLIP COMPUTATION (PROPER FULL VERSION)
# Re-extracted from original rahaza_payroll.py (lines 311-560)
# ═══════════════════════════════════════════════════════════════════════════════

async def _compute_payslip_for_employee(db, profile: dict, period_from: str, period_to: str, emp: dict) -> dict:
    """Hitung slip payroll untuk 1 pegawai berdasarkan profile + window."""
    scheme = profile["pay_scheme"]
    base_rate = float(profile.get("base_rate") or 0)
    ot_rate = float(profile.get("overtime_rate") or 0)
    emp_id = profile["employee_id"]

    earnings = []
    source_refs = {"wip_event_count": 0, "attendance_event_count": 0, "process_breakdown": {}}

    # Query attendance untuk periode
    att_rows = await db.rahaza_attendance_events.find({
        "employee_id": emp_id,
        "date": _date_range_filter(period_from, period_to),
    }, {"_id": 0}).to_list(500)
    source_refs["attendance_event_count"] = len(att_rows)
    total_hours = sum(float(r.get("hours_worked") or 0) for r in att_rows)
    total_ot = sum(float(r.get("overtime_hours") or 0) for r in att_rows)
    days_hadir = sum(1 for r in att_rows if r.get("status") == "hadir")

    # ─── Include Approved Overtime Requests (P1.1) ────────────────────────────
    # Approved overtime requests are stored in rahaza_overtime_requests with
    # hours + rate_multiplier. We normalize to base-rate-equivalent hours.
    try:
        ot_approved = await db.rahaza_overtime_requests.find({
            "employee_id": emp_id,
            "status": "approved",
            "date": _date_range_filter(period_from, period_to),
        }, {"_id": 0}).to_list(500)
        for ot in ot_approved:
            hours = float(ot.get("hours") or 0)
            multiplier = float(ot.get("rate_multiplier") or 1.5)
            # Normalize to base 1.5x: effective_hours = hours * (mult / 1.5)
            effective_hours = hours * (multiplier / 1.5) if multiplier else hours
            total_ot += effective_hours
            source_refs.setdefault("overtime_request_count", 0)
            source_refs["overtime_request_count"] += 1
    except Exception:
        pass

    # ─── Compute earnings by pay_scheme ───────────────────────────────────────
    if scheme == "pcs":
        # Hitung WIP completion events untuk periode
        wip_events = await db.rahaza_wip_events.find({
            "employee_id": emp_id,
            "event_type": "complete",
            "event_date": _date_range_filter(period_from, period_to),
        }, {"_id": 0}).to_list(2000)
        source_refs["wip_event_count"] = len(wip_events)

        # Group per process
        process_pay: dict = {}
        process_qty: dict = {}
        for ev in wip_events:
            proc = ev.get("process_code") or "UNKNOWN"
            qty = int(ev.get("qty_done") or 0)
            rate = float(ev.get("rate_per_pcs") or 0)
            amount = qty * rate
            process_pay[proc] = process_pay.get(proc, 0) + amount
            process_qty[proc] = process_qty.get(proc, 0) + qty

        for proc, amount in process_pay.items():
            qty = process_qty.get(proc, 0)
            earnings.append({
                "type": "pcs",
                "process_code": proc,
                "qty": qty,
                "amount": amount,
            })
            source_refs["process_breakdown"][proc] = {"qty": qty, "amount": amount}

    elif scheme == "hourly":
        amount = total_hours * base_rate
        earnings.append({
            "type": "hourly",
            "hours": round(total_hours, 2),
            "rate": base_rate,
            "amount": amount,
        })

    elif scheme in ("weekly", "monthly"):
        earnings.append({
            "type": scheme,
            "base": base_rate,
            "amount": base_rate,
        })

    earnings_total = sum(e["amount"] for e in earnings)

    # Overtime amount
    overtime_amount = total_ot * ot_rate if total_ot > 0 else 0

    # ─── Allowances ───────────────────────────────────────────────────────────
    allowance_items: list = []
    allowance_total = 0.0
    allowances = await _get_applicable_allowances(db, emp)
    for al in allowances:
        amt = float(al.get("amount") or 0)
        calc_type = al.get("calc_type") or "fixed"
        if calc_type == "percentage_gross":
            base_for_pct = earnings_total + overtime_amount
            amt = base_for_pct * (amt / 100.0)
        allowance_items.append({
            "allowance_id": al.get("allowance_id"),
            "name": al.get("name"),
            "amount": round(amt, 2),
            "calc_type": calc_type,
        })
        allowance_total += amt

    # ─── Gross & Deductions ───────────────────────────────────────────────────
    gross = earnings_total + overtime_amount + allowance_total

    deductions: list = []
    deductions_total = 0.0
    # BPJS, PPh, dll. (placeholder — disconnect from rahaza_tax for now)

    net_pay = gross - deductions_total

    # ─── Payslip Output ───────────────────────────────────────────────────────
    payslip = {
        "id": _uid(),
        "employee_id": emp_id,
        "employee_name": emp.get("name") or emp.get("full_name") or "",
        "employee_code": emp.get("employee_code") or "",
        "period_from": period_from,
        "period_to": period_to,
        "pay_scheme": scheme,
        "earnings": earnings,
        "earnings_total": earnings_total,
        "overtime_hours": round(total_ot, 2),
        "overtime_rate": ot_rate,
        "overtime_amount": overtime_amount,
        "allowances": allowance_items,
        "allowance_total": allowance_total,
        "total_hours_worked": round(total_hours, 2),
        "days_hadir": days_hadir,
        "gross_pay": gross,
        "deductions": deductions,
        "deductions_total": deductions_total,
        "net_pay": net_pay,
        "source_refs": source_refs,
        "notes": "",
    }
    return payslip
