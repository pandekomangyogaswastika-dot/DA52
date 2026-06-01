# ruff: noqa: F401
"""
rahaza_payroll_profiles.py — Payroll Profile Management
Extracted from rahaza_payroll.py (1539 LOC monolith)

Refactored: Session #11.19 Phase 3.2 Batch #4
Endpoints: GET /payroll-profiles, GET /payroll-profiles/{id}, POST /payroll-profiles, PUT /payroll-profiles/{id}, DELETE /payroll-profiles/{id}
"""
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse
from database import get_db
from auth import require_auth, serialize_doc, log_activity
from routes.rahaza_payroll_shared import (
    _uid, _now, VALID_SCHEMES, VALID_PERIOD_TYPES, VALID_RUN_STATUS,
    _get_applicable_allowances, _require_hr,
)
from routes.rahaza_posting import post_payroll_run
from utils.saga import SagaExecutor
import uuid
import io
import csv
import logging
from datetime import datetime, timezone, date, timedelta
from typing import Optional

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/rahaza", tags=["rahaza-payroll-profiles"])

@router.get("/payroll-profiles")
async def list_profiles(request: Request, employee_id: Optional[str] = None, active_only: bool = True):
    await require_auth(request)
    db = get_db()
    q = {}
    if active_only:
        q["active"] = True
    if employee_id:
        q["employee_id"] = employee_id
    rows = await db.rahaza_payroll_profiles.find(q, {"_id": 0}).to_list(500)
    # Enrich with employee info
    emp_ids = list({r.get("employee_id") for r in rows if r.get("employee_id")})
    emps = await db.rahaza_employees.find({"id": {"$in": emp_ids}}, {"_id": 0}).to_list(500) if emp_ids else []
    e_map = {e["id"]: e for e in emps}
    for r in rows:
        e = e_map.get(r.get("employee_id")) or {}
        r["employee_code"] = e.get("employee_code")
        r["employee_name"] = e.get("name")
    rows.sort(key=lambda r: r.get("employee_code") or "")
    return serialize_doc(rows)


@router.get("/payroll-profiles/{employee_id}")
async def get_profile(employee_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    row = await db.rahaza_payroll_profiles.find_one({"employee_id": employee_id, "active": True}, {"_id": 0})
    if not row:
        raise HTTPException(404, "Profile payroll belum dibuat untuk pegawai ini.")
    emp = await db.rahaza_employees.find_one({"id": employee_id}, {"_id": 0}) or {}
    row["employee_code"] = emp.get("employee_code")
    row["employee_name"] = emp.get("name")
    return serialize_doc(row)


def _normalize_profile(body: dict) -> dict:
    pay_scheme = (body.get("pay_scheme") or "monthly").lower()
    period_type = (body.get("period_type") or "monthly").lower()
    if pay_scheme not in VALID_SCHEMES:
        raise HTTPException(400, f"pay_scheme harus salah satu: {VALID_SCHEMES}")
    if period_type not in VALID_PERIOD_TYPES:
        raise HTTPException(400, f"period_type harus salah satu: {VALID_PERIOD_TYPES}")
    cutoff = body.get("cutoff_config") or {}
    # Defaults
    if period_type == "weekly" and "week_start_day" not in cutoff:
        cutoff["week_start_day"] = 1  # Monday
    if period_type == "monthly" and "start_day" not in cutoff:
        cutoff["start_day"] = 1  # 1st of month
    # Validate ranges
    wsd = cutoff.get("week_start_day")
    if wsd is not None and (not isinstance(wsd, int) or not (0 <= wsd <= 6)):
        raise HTTPException(400, "week_start_day harus 0..6 (0=Senin..6=Minggu)")
    sd = cutoff.get("start_day")
    if sd is not None and (not isinstance(sd, int) or not (1 <= sd <= 28)):
        raise HTTPException(400, "start_day harus 1..28")
    pcs_rates = body.get("pcs_process_rates") or []
    norm_pcs_rates = []
    for r in pcs_rates:
        if not r.get("process_id"):
            continue
        norm_pcs_rates.append({
            "process_id": r["process_id"],
            "process_code": (r.get("process_code") or "").upper(),
            "rate": float(r.get("rate") or 0),
        })
    return {
        "employee_id": body.get("employee_id"),
        "pay_scheme": pay_scheme,
        "period_type": period_type,
        "cutoff_config": cutoff,
        "base_rate": float(body.get("base_rate") or 0),
        "overtime_rate": float(body.get("overtime_rate") or 0),
        "pcs_process_rates": norm_pcs_rates,
        "notes": body.get("notes") or "",
    }


@router.post("/payroll-profiles")
async def upsert_profile(request: Request):
    user = await _require_hr(request)
    db = get_db()
    body = await request.json()
    emp_id = body.get("employee_id")
    if not emp_id:
        raise HTTPException(400, "employee_id wajib.")
    emp = await db.rahaza_employees.find_one({"id": emp_id}, {"_id": 0})
    if not emp:
        raise HTTPException(404, f"Pegawai dengan id={emp_id} tidak ditemukan.")
    doc = _normalize_profile(body)
    existing = await db.rahaza_payroll_profiles.find_one({"employee_id": emp_id, "active": True}, {"_id": 0})
    now = _now()
    doc.update({
        "active": True,
        "updated_at": now,
        "updated_by": user["id"],
        "updated_by_name": user.get("name", ""),
    })
    if existing:
        await db.rahaza_payroll_profiles.update_one({"id": existing["id"]}, {"$set": doc})
        out = await db.rahaza_payroll_profiles.find_one({"id": existing["id"]}, {"_id": 0})
    else:
        doc["id"] = _uid()
        doc["created_at"] = now
        doc["created_by"] = user["id"]
        doc["created_by_name"] = user.get("name", "")
        await db.rahaza_payroll_profiles.insert_one(doc)
        out = await db.rahaza_payroll_profiles.find_one({"id": doc["id"]}, {"_id": 0})
    await log_activity(user["id"], user.get("name", ""), "upsert", "rahaza.payroll_profile", emp_id)
    out["employee_code"] = emp.get("employee_code")
    out["employee_name"] = emp.get("name")
    return serialize_doc(out)


@router.put("/payroll-profiles/{pid}")
async def update_profile(pid: str, request: Request):
    user = await _require_hr(request)
    db = get_db()
    existing = await db.rahaza_payroll_profiles.find_one({"id": pid}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Profile tidak ditemukan.")
    body = await request.json()
    body["employee_id"] = existing["employee_id"]  # cannot change
    doc = _normalize_profile(body)
    doc.update({
        "updated_at": _now(),
        "updated_by": user["id"],
        "updated_by_name": user.get("name", ""),
    })
    await db.rahaza_payroll_profiles.update_one({"id": pid}, {"$set": doc})
    out = await db.rahaza_payroll_profiles.find_one({"id": pid}, {"_id": 0})
    return serialize_doc(out)


@router.delete("/payroll-profiles/{pid}")
async def delete_profile(pid: str, request: Request):
    user = await _require_hr(request)
    db = get_db()
    res = await db.rahaza_payroll_profiles.update_one({"id": pid, "active": True}, {"$set": {"active": False, "updated_at": _now(), "updated_by": user["id"]}})
    if res.matched_count == 0:
        raise HTTPException(404, "Profile tidak ditemukan atau sudah nonaktif.")
    return {"status": "deleted"}


# ╔══════════════════════════════════════════════════════════════════════════╗
# ║ FASE 8c — PAYROLL RUN & PAYSLIP                                           ║
# ╚══════════════════════════════════════════════════════════════════════════╝

def _to_date(s: str) -> date:
    return datetime.strptime(s, "%Y-%m-%d").date()


def _date_range_filter(from_iso: str, to_iso: str) -> dict:
    return {"$gte": from_iso, "$lte": to_iso}


async def _generate_run_number(db) -> str:
    today = date.today().strftime("%Y%m%d")
    prefix = f"PR-{today}-"
    count = await db.rahaza_payroll_runs.count_documents({"run_number": {"$regex": f"^{prefix}"}})
    return f"{prefix}{count+1:03d}"


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
    # hours + rate_multiplier. We normalize to base-rate-equivalent hours by
    # scaling (rate_multiplier / base_ot_rate_multiplier=1.5) so the fixed
    # ot_rate below still produces the correct pay. Example: 2 hours × 2.0 tier
    # = 2.67 effective hours at 1.5× tier.
    try:
        ot_approved = await db.rahaza_overtime_requests.find({
            "employee_id": emp_id,
            "status": "approved",
            "date": _date_range_filter(period_from, period_to),
        }, {"_id": 0}).to_list(500)
        for ot in ot_approved:
            # weighted by rate_multiplier
            total_ot += float(ot.get("hours") or 0) * float(ot.get("rate_multiplier") or 1.5) / 1.5
            # We keep the base multiplier as 1.5 in ot_rate; effectively we boost hours
        source_refs["overtime_request_count"] = len(ot_approved)
    except Exception as e:
        log.warning(f"Overtime request aggregation failed: {e}")

    if scheme == "pcs":
        # Sum WIP events output oleh operator ini dalam periode
        # Event date bisa dicompare via string ISO karena format ISO cocok lexicographic
        wip_rows = await db.rahaza_wip_events.find({
            "operator_id": emp_id,
            "event_type": "output",
            "event_date": _date_range_filter(period_from, period_to),
        }, {"_id": 0}).to_list(500)
        source_refs["wip_event_count"] = len(wip_rows)
        # Group by process_id
        proc_map = {}
        for ev in wip_rows:
            pid = ev.get("process_id") or "unknown"
            if pid not in proc_map:
                proc_map[pid] = {"qty": 0, "events": 0, "process_code": ev.get("process_code") or ""}
            proc_map[pid]["qty"] += int(ev.get("qty") or 0)
            proc_map[pid]["events"] += 1
            if ev.get("process_code"):
                proc_map[pid]["process_code"] = ev["process_code"]
        # Cari rate per process (override) atau base_rate
        rate_overrides = {r["process_id"]: r["rate"] for r in (profile.get("pcs_process_rates") or [])}
        for pid, info in proc_map.items():
            rate = float(rate_overrides.get(pid, base_rate))
            amount = round(info["qty"] * rate)
            label = f"Borongan pcs · {info.get('process_code') or 'Proses'}"
            earnings.append({
                "label": label,
                "qty": info["qty"],
                "unit": "pcs",
                "rate": rate,
                "amount": amount,
            })
            source_refs["process_breakdown"][info.get("process_code") or pid] = {
                "qty": info["qty"],
                "rate": rate,
                "amount": amount,
            }
    elif scheme == "hourly":
        amount = round(total_hours * base_rate)
        earnings.append({
            "label": "Borongan jam",
            "qty": round(total_hours, 2),
            "unit": "jam",
            "rate": base_rate,
            "amount": amount,
        })
    elif scheme == "weekly":
        try:
            d_from = _to_date(period_from)
            d_to = _to_date(period_to)
            days = (d_to - d_from).days + 1
            weeks = max(1, round(days / 7))
        except Exception:
            weeks = 1
        amount = round(weeks * base_rate)
        earnings.append({
            "label": "Gaji mingguan",
            "qty": weeks,
            "unit": "minggu",
            "rate": base_rate,
            "amount": amount,
        })
    elif scheme == "monthly":
        amount = round(base_rate)
        earnings.append({
            "label": "Gaji bulanan",
            "qty": 1,
            "unit": "bulan",
            "rate": base_rate,
            "amount": amount,
        })

    earnings_total = sum(e["amount"] for e in earnings)
    overtime_amount = round(total_ot * ot_rate)
    gross = earnings_total + overtime_amount

    # ─── Tambahkan Tunjangan Tetap (DA Allowances) ────────────────────────────
    allowances = await _get_applicable_allowances(db, emp)
    allowance_items = []
    for alw in allowances:
        if alw.get("calc_type") == "percentage_gross":
            amount = round(gross * float(alw.get("amount") or 0) / 100)
        else:
            amount = round(float(alw.get("amount") or 0))
        if amount > 0:
            allowance_items.append({
                "label": alw.get("name", "Tunjangan"),
                "allowance_id": alw.get("allowance_id"),
                "amount": amount,
                "calc_type": alw.get("calc_type", "fixed"),
            })
    allowance_total = sum(a["amount"] for a in allowance_items)
    gross += allowance_total

    # ─── PPh21 + BPJS Auto-Deduction (P0.4 + P0.5) ────────────────────────────
    deductions = []
    deductions_total = 0

    # ─── LWOP (Leave Without Pay) Potongan ────────────────────────────────────
    try:
        # Fetch leave types yang unpaid (LWOP)
        lwop_type_ids = set()
        async for lt in db.rahaza_leave_types.find({"unpaid": True, "active": True}, {"_id": 0, "id": 1}):
            lwop_type_ids.add(lt["id"])

        if lwop_type_ids and scheme == "monthly" and base_rate > 0:
            # Fetch approved LWOP leaves dalam payroll period
            lwop_leaves = await db.rahaza_leave_requests.find({
                "employee_id":  emp_id,
                "status":       "approved",
                "leave_type_id": {"$in": list(lwop_type_ids)},
                "from_date":    {"$lte": period_to},
                "to_date":      {"$gte": period_from},
            }, {"_id": 0}).to_list(100)

            if lwop_leaves:
                # Hitung total hari LWOP dalam period (pakai duration_working_days jika ada)
                lwop_days = sum(
                    float(lv.get("duration_working_days") or lv.get("duration_days") or 0)
                    for lv in lwop_leaves
                )

                if lwop_days > 0:
                    # Hitung working days dalam periode dari production calendar
                    try:
                        pf = date.fromisoformat(period_from[:10])
                        pt = date.fromisoformat(period_to[:10])
                        hol_docs = await db.rahaza_production_calendar.find(
                            {"date": {"$gte": period_from[:10], "$lte": period_to[:10]}, "type": "holiday"},
                            {"_id": 0, "date": 1}
                        ).to_list(50)
                        holiday_set = {h["date"] for h in hol_docs}
                        working_days_in_period = 0
                        cur = pf
                        while cur <= pt:
                            if cur.weekday() < 5 and cur.isoformat() not in holiday_set:
                                working_days_in_period += 1
                            cur += timedelta(days=1)
                        if working_days_in_period == 0:
                            working_days_in_period = 22  # fallback
                    except Exception:
                        working_days_in_period = 22

                    daily_rate   = round(base_rate / working_days_in_period)
                    lwop_amount  = round(daily_rate * lwop_days)

                    deductions.append({
                        "label":       f"Potongan LWOP / Cuti Tanpa Gaji ({lwop_days:.1f} hari)",
                        "type":        "lwop",
                        "days":        lwop_days,
                        "daily_rate":  daily_rate,
                        "amount":      lwop_amount,
                    })
                    deductions_total += lwop_amount
                    source_refs["lwop_days"]   = lwop_days
                    source_refs["lwop_amount"] = lwop_amount
    except Exception as e:
        log.warning(f"LWOP deduction calculation failed for {emp_id}: {e}")
    try:
        from routes.rahaza_payroll_tax import compute_full_tax_and_bpjs
        apply_bpjs   = bool(emp.get("bpjs_kesehatan_number") or emp.get("bpjs_ketenagakerjaan_number"))
        apply_pph21  = bool(emp.get("npwp_number") or emp.get("tax_ptkp"))
        if scheme in ("monthly", "bulanan") and (apply_bpjs or apply_pph21):
            # PPh21 dihitung dari gross SETELAH LWOP dipotong
            gross_after_lwop = gross - (source_refs.get("lwop_amount") or 0)
            tax_calc = compute_full_tax_and_bpjs(
                monthly_gross=max(0, gross_after_lwop),
                ptkp_code=emp.get("tax_ptkp") or "TK/0",
                apply_bpjs=apply_bpjs,
                apply_pph21=apply_pph21,
                include_ketenagakerjaan=bool(emp.get("bpjs_ketenagakerjaan_number")),
                jkk_risk_tier="very_low",
            )
            # Merge: LWOP deductions sudah di list + tambah tax deductions
            deductions = deductions + tax_calc["deductions"]
            deductions_total += tax_calc["total_deductions"]
    except Exception as e:
        log.warning(f"PPh21/BPJS calculation failed for {emp_id}: {e}")

    net_pay = gross - deductions_total

    payslip = {
        "id": _uid(),
        "employee_id": emp_id,
        "employee_code": emp.get("employee_code"),
        "employee_name": emp.get("name"),
        "department": emp.get("department") or "",
        "pay_scheme": scheme,
        "period_from": period_from,
        "period_to": period_to,
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


