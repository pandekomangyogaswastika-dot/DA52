# ruff: noqa: F401
"""
rahaza_payroll_runs.py — Payroll Run Operations
Extracted from rahaza_payroll.py (1539 LOC monolith)

Refactored: Session #11.19 Phase 3.2 Batch #4
Endpoints: GET /payroll-runs, POST /payroll-runs, GET /payroll-runs/{id}, POST finalize/post-to-gl/retry-post/pay/void-payment, DELETE, POST pay-bpjs/pay-pph21, GET export/pdf
"""
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse
from database import get_db
from auth import require_auth, serialize_doc, log_activity
from routes.rahaza_payroll_shared import (
    _uid, _now, VALID_SCHEMES, VALID_PERIOD_TYPES, VALID_RUN_STATUS,
    _get_applicable_allowances,
    _require_hr, _to_date, _date_range_filter,
    _generate_run_number, _compute_payslip_for_employee,
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

router = APIRouter(prefix="/api/rahaza", tags=["rahaza-payroll-runs"])

@router.get("/payroll-runs")
async def list_runs(request: Request, status: Optional[str] = None, limit: int = 50, skip: int = 0):
    await require_auth(request)
    db = get_db()
    q = {}
    if status:
        q["status"] = status
    rows = await db.rahaza_payroll_runs.find(q, {"_id": 0}).sort("created_at", -1).skip(skip).limit(limit).to_list(500)
    return serialize_doc(rows)


@router.post("/payroll-runs")
async def create_run(request: Request):
    user = await _require_hr(request)
    db = get_db()
    body = await request.json()
    period_from = (body.get("period_from") or "").strip()
    period_to = (body.get("period_to") or "").strip()
    if not (period_from and period_to):
        raise HTTPException(400, "period_from & period_to wajib (YYYY-MM-DD).")
    try:
        _to_date(period_from)
        _to_date(period_to)
    except Exception:
        raise HTTPException(400, "Format tanggal harus YYYY-MM-DD.")
    if period_from > period_to:
        raise HTTPException(400, "period_from tidak boleh > period_to.")

    # Ambil profile aktif
    employee_ids = body.get("employee_ids") or []
    q = {"active": True}
    if employee_ids:
        q["employee_id"] = {"$in": employee_ids}
    profiles = await db.rahaza_payroll_profiles.find(q, {"_id": 0}).to_list(500)
    if not profiles:
        raise HTTPException(400, "Tidak ada payroll profile aktif untuk diproses. Buat profile dulu di menu Payroll Profiles.")

    emp_ids = [p["employee_id"] for p in profiles]
    emps = await db.rahaza_employees.find({"id": {"$in": emp_ids}}, {"_id": 0}).to_list(500)
    e_map = {e["id"]: e for e in emps}

    # Create run header
    run_number = await _generate_run_number(db)
    run_id = _uid()
    now = _now()

    # Generate payslips
    payslips = []
    for p in profiles:
        emp = e_map.get(p["employee_id"])
        if not emp:
            continue
        slip = await _compute_payslip_for_employee(db, p, period_from, period_to, emp)
        slip.update({
            "run_id": run_id,
            "run_number": run_number,
            "created_at": now,
            "updated_at": now,
        })
        payslips.append(slip)

    # ── Saga pattern: atomic payslip insert + run header insert ─────────────────
    # Since MongoDB standalone doesn't support multi-document transactions,
    # we use a compensation saga: if run header insert fails, payslips are deleted.
    payslips_inserted = False

    total_gross = sum(s["gross_pay"] for s in payslips)
    total_ded = sum(s["deductions_total"] for s in payslips)
    total_net = sum(s["net_pay"] for s in payslips)

    run_doc = {
        "id": run_id,
        "run_number": run_number,
        "period_from": period_from,
        "period_to": period_to,
        "status": "draft",
        "total_employees": len(payslips),
        "total_gross": total_gross,
        "total_deductions": total_ded,
        "total_net": total_net,
        "notes": body.get("notes") or "",
        "created_at": now,
        "created_by": user["id"],
        "created_by_name": user.get("name", ""),
        "updated_at": now,
    }

    async def _insert_payslips():
        nonlocal payslips_inserted
        if payslips:
            await db.rahaza_payslips.insert_many(payslips)
        payslips_inserted = True

    async def _compensate_payslips():
        await db.rahaza_payslips.delete_many({"run_id": run_id})

    async def _insert_run_header():
        await db.rahaza_payroll_runs.insert_one(run_doc)

    saga = SagaExecutor(name="create_payroll_run")
    saga.add_step(
        name="insert_payslips",
        action=_insert_payslips,
        compensate=_compensate_payslips,
    )
    saga.add_step(
        name="insert_run_header",
        action=_insert_run_header,
        compensate=lambda: db.rahaza_payroll_runs.delete_one({"id": run_id}),
    )
    saga_result = await saga.execute()
    if not saga_result.success:
        log.error(f"Saga failed creating payroll run {run_number}: {saga_result.error_detail}")
        raise HTTPException(500, f"Gagal membuat payroll run: {saga_result.error_detail}")

    await log_activity(user["id"], user.get("name", ""), "create", "rahaza.payroll_run", run_number)
    out = await db.rahaza_payroll_runs.find_one({"id": run_id}, {"_id": 0})
    return serialize_doc(out)


@router.get("/payroll-runs/{run_id}")
async def get_run(run_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    run = await db.rahaza_payroll_runs.find_one({"id": run_id}, {"_id": 0})
    if not run:
        raise HTTPException(404, "Payroll run tidak ditemukan.")
    payslips = await db.rahaza_payslips.find({"run_id": run_id}, {"_id": 0}).sort("employee_code", 1).to_list(500)
    return serialize_doc({"run": run, "payslips": payslips})


@router.post("/payroll-runs/{run_id}/finalize")
async def finalize_run(run_id: str, request: Request):
    user = await _require_hr(request)
    db = get_db()
    run = await db.rahaza_payroll_runs.find_one({"id": run_id}, {"_id": 0})
    if not run:
        raise HTTPException(404, "Payroll run tidak ditemukan.")
    if run.get("status") != "draft":
        raise HTTPException(400, f"Run sudah ber-status '{run.get('status')}', tidak bisa finalize.")
    # Recalc totals dari payslips (in case deductions diubah)
    payslips = await db.rahaza_payslips.find({"run_id": run_id}, {"_id": 0}).to_list(500)
    total_gross = sum(s.get("gross_pay", 0) for s in payslips)
    total_ded = sum(s.get("deductions_total", 0) for s in payslips)
    total_net = sum(s.get("net_pay", 0) for s in payslips)
    await db.rahaza_payroll_runs.update_one({"id": run_id}, {"$set": {
        "status": "finalized",
        "total_gross": total_gross,
        "total_deductions": total_ded,
        "total_net": total_net,
        "finalized_at": _now(),
        "finalized_by": user["id"],
        "finalized_by_name": user.get("name", ""),
        "updated_at": _now(),
    }})
    await log_activity(user["id"], user.get("name", ""), "finalize", "rahaza.payroll_run", run.get("run_number"))
    out = await db.rahaza_payroll_runs.find_one({"id": run_id}, {"_id": 0})

    # ── F3 Auto-post Payroll JE
    posting_result = None
    try:
        posting_result = await post_payroll_run(db, out, user)
    except Exception as e:
        log.exception("Payroll auto-post failed")
        posting_result = {"ok": False, "error": str(e)}
    out = await db.rahaza_payroll_runs.find_one({"id": run_id}, {"_id": 0})

    # ── Notifikasi payslip siap ke semua karyawan dalam run ini ──────────────
    try:
        from routes.rahaza_notifications import publish_notification
        # Kumpulkan user_id dari employees dalam run
        payslip_emps = await db.rahaza_payslips.find(
            {"run_id": run_id}, {"_id": 0, "employee_id": 1, "net_pay": 1}
        ).to_list(500)
        emp_ids_in_run = [s["employee_id"] for s in payslip_emps]
        if emp_ids_in_run:
            linked_emps = await db.rahaza_employees.find(
                {"id": {"$in": emp_ids_in_run}, "user_id": {"$exists": True, "$ne": None}},
                {"_id": 0, "user_id": 1, "name": 1}
            ).to_list(500)
            for le in linked_emps:
                net = next((s["net_pay"] for s in payslip_emps if s["employee_id"] == le.get("id")), 0)
                await publish_notification(
                    db,
                    type_="payslip_ready",
                    severity="info",
                    title="Slip Gaji Tersedia",
                    message=(
                        f"Slip gaji periode {out.get('period_from','')[:7]} sudah tersedia. "
                        f"Take-home: Rp {net:,.0f}."
                    ),
                    link_module="self-dashboard",
                    target_user_ids=[le["user_id"]],
                    dedup_key=f"payslip_ready_{run_id}_{le['user_id']}",
                )
    except Exception as ne:
        log.warning(f"[payroll] payslip notif failed: {ne}")

    out["_posting_result"] = posting_result
    return serialize_doc(out)


@router.post("/payroll-runs/{run_id}/post-to-gl")
async def retry_post_payroll(run_id: str, request: Request):
    """F3: manual retry post payroll run to GL (idempotent)."""
    user = await _require_hr(request)
    db = get_db()
    run = await db.rahaza_payroll_runs.find_one({"id": run_id}, {"_id": 0})
    if not run:
        raise HTTPException(404, "Payroll run tidak ditemukan.")
    if run.get("status") != "finalized":
        raise HTTPException(400, "Hanya run yang sudah finalized yang bisa di-post.")
    result = await post_payroll_run(db, run, user)
    out = await db.rahaza_payroll_runs.find_one({"id": run_id}, {"_id": 0})
    out["_posting_result"] = result
    return serialize_doc(out)


@router.post("/payroll-runs/{run_id}/retry-post")
async def retry_post_alias(run_id: str, request: Request):
    """Alias untuk /post-to-gl (backward compat frontend)."""
    return await retry_post_payroll(run_id, request)


@router.post("/payroll-runs/{run_id}/pay")
async def pay_payroll_run(run_id: str, request: Request):
    """
    Tandai gaji sebagai sudah dibayar dan buat Payment JE.
    Dr 2-1200 Hutang Gaji / Cr [bank_account_code].
    Body: { payment_date, bank_account_code, payment_method, notes }
    """
    user = await _require_hr(request)
    db   = get_db()
    body = await request.json()

    run = await db.rahaza_payroll_runs.find_one({"id": run_id}, {"_id": 0})
    if not run:
        raise HTTPException(404, "Payroll run tidak ditemukan.")
    if run.get("status") != "finalized":
        raise HTTPException(400, "Hanya run FINALIZED yang bisa dibayar.")
    if run.get("payment_status") == "paid":
        raise HTTPException(400,
            f"Penggajian {run.get('run_number')} sudah dibayar "
            f"({run.get('payment_gl_je_number')}). "
            "Gunakan void-payment untuk membatalkan.")

    payment_date   = (body.get("payment_date") or str(date.today()))[:10]
    bank_code      = (body.get("bank_account_code") or "1-1201").strip()
    payment_method = body.get("payment_method") or "bank_transfer"
    notes          = (body.get("notes") or "").strip()

    # Validate bank CoA exists
    bank_acc = await db.rahaza_coa_accounts.find_one(
        {"code": bank_code, "active": True}, {"_id": 0, "name": 1}
    )
    if not bank_acc:
        raise HTTPException(400, f"Akun GL '{bank_code}' tidak ditemukan atau tidak aktif.")

    from routes.rahaza_posting import post_payroll_payment
    result = await post_payroll_payment(db, run, payment_date, bank_code, user)

    update = {
        "payment_status":       "paid" if result.get("ok") else "payment_error",
        "payment_method":       payment_method,
        "payment_date":         payment_date,
        "payment_bank_code":    bank_code,
        "payment_bank_name":    bank_acc.get("name", ""),
        "payment_notes":        notes,
        "payment_gl_je_id":     result.get("je_id"),
        "payment_gl_je_number": result.get("je_number"),
        "payment_error":        result.get("error"),
        "paid_at":              _now(),
        "paid_by":              user["id"],
        "paid_by_name":         user.get("name", ""),
        "updated_at":           _now(),
    }
    await db.rahaza_payroll_runs.update_one({"id": run_id}, {"$set": update})
    await log_activity(user["id"], user.get("name", ""), "pay_payroll", "rahaza.payroll_run",
                       f"{run.get('run_number')} → {bank_code} {payment_date}")
    out = await db.rahaza_payroll_runs.find_one({"id": run_id}, {"_id": 0})
    out["_payment_result"] = result
    return serialize_doc(out)


@router.post("/payroll-runs/{run_id}/void-payment")
async def void_payroll_payment_endpoint(run_id: str, request: Request):
    """
    Batalkan jurnal pembayaran gaji (void payment JE).
    Hanya bisa dilakukan jika payment JE masih aktif.
    Body: { reason }
    """
    user = await _require_hr(request)
    db   = get_db()
    body = await request.json()
    reason = body.get("reason") or "Pembatalan pembayaran gaji"

    run = await db.rahaza_payroll_runs.find_one({"id": run_id}, {"_id": 0})
    if not run:
        raise HTTPException(404, "Payroll run tidak ditemukan.")
    if run.get("payment_status") != "paid":
        raise HTTPException(400, "Tidak ada pembayaran aktif yang bisa dibatalkan.")

    from routes.rahaza_posting import void_payroll_payment
    await void_payroll_payment(db, run_id, user, reason)
    await db.rahaza_payroll_runs.update_one(
        {"id": run_id},
        {"$set": {"payment_status": "void", "updated_at": _now()}}
    )
    await log_activity(user["id"], user.get("name", ""), "void_payment", "rahaza.payroll_run",
                       f"{run.get('run_number')} — {reason}")
    out = await db.rahaza_payroll_runs.find_one({"id": run_id}, {"_id": 0})
    return serialize_doc(out)


@router.delete("/payroll-runs/{run_id}")
async def delete_run(run_id: str, request: Request):
    await _require_hr(request)
    db = get_db()
    run = await db.rahaza_payroll_runs.find_one({"id": run_id}, {"_id": 0})
    if not run:
        raise HTTPException(404, "Payroll run tidak ditemukan.")
    if run.get("status") == "finalized":
        raise HTTPException(400, "Run yang sudah finalized tidak bisa dihapus. Gunakan cancel atau buat run baru.")
    await db.rahaza_payslips.delete_many({"run_id": run_id})
    await db.rahaza_payroll_runs.delete_one({"id": run_id})
    return {"status": "deleted"}


@router.post("/payroll-runs/{run_id}/pay-bpjs")
async def pay_bpjs(run_id: str, request: Request):
    """
    Bayar BPJS dari payroll run ini.
    Dr 2-1500 Hutang BPJS / Cr [bank_code].
    Body: { payment_date, bank_account_code, notes }
    """
    user = await _require_hr(request)
    db   = get_db()
    body = await request.json()
    run  = await db.rahaza_payroll_runs.find_one({"id": run_id}, {"_id": 0})
    if not run:
        raise HTTPException(404, "Run tidak ditemukan.")
    if run.get("status") != "finalized":
        raise HTTPException(400, "Hanya run FINALIZED.")
    if run.get("bpjs_payment_status") == "paid":
        raise HTTPException(400, "BPJS run ini sudah dibayar.")

    payment_date = (body.get("payment_date") or str(date.today()))[:10]
    bank_code    = (body.get("bank_account_code") or "1-1201").strip()
    body.get("notes") or ""

    # Calculate BPJS total from payslips
    slips  = await db.rahaza_payslips.find({"run_id": run_id}, {"_id": 0, "deductions": 1}).to_list(500)
    bpjs_total = 0.0
    for s in slips:
        for d in (s.get("deductions") or []):
            if "bpjs" in (d.get("label") or "").lower() or d.get("type") == "bpjs":
                bpjs_total += float(d.get("amount") or 0)

    if bpjs_total <= 0:
        raise HTTPException(400, "Tidak ada potongan BPJS di run ini.")

    # Build JE: Dr Hutang BPJS / Cr Bank
    bank_acc = await db.rahaza_coa_accounts.find_one({"code": bank_code, "active": True}, {"_id": 0, "name": 1})
    if not bank_acc:
        raise HTTPException(400, f"Akun GL '{bank_code}' tidak ditemukan.")

    from routes.rahaza_posting import _create_posted_je
    run_id_ref = f"bpjspay:{run_id}"
    try:
        je_date = date.fromisoformat(payment_date)
    except Exception:
        je_date = date.today()
    memo  = f"Bayar BPJS {run.get('run_number')} · {run.get('period_from')}–{run.get('period_to')}"
    lines = [
        {"account_code": "2-1500", "debit": bpjs_total, "credit": 0, "description": memo},
        {"account_code": bank_code, "debit": 0, "credit": bpjs_total, "description": memo},
    ]
    result = await _create_posted_je(db, je_date, memo, "bpjs_payment", run_id_ref, lines, user)
    update = {
        "bpjs_payment_status":  "paid" if result.get("ok") else "error",
        "bpjs_payment_date":    payment_date,
        "bpjs_payment_amount":  bpjs_total,
        "bpjs_payment_je":      result.get("je_number"),
        "bpjs_payment_error":   result.get("error"),
        "updated_at":           _now(),
    }
    await db.rahaza_payroll_runs.update_one({"id": run_id}, {"$set": update})
    await log_activity(user["id"], user.get("name",""), "pay_bpjs", "rahaza.payroll_run",
                       f"{run.get('run_number')} BPJS Rp {bpjs_total:,.0f}")
    out = await db.rahaza_payroll_runs.find_one({"id": run_id}, {"_id": 0})
    out["_payment_result"] = result
    return serialize_doc(out)


@router.post("/payroll-runs/{run_id}/pay-pph21")
async def pay_pph21(run_id: str, request: Request):
    """
    Bayar PPh21 dari payroll run ini ke DJP.
    Dr 2-1301 Hutang PPh21 / Cr [bank_code].
    Body: { payment_date, bank_account_code, notes }
    """
    user = await _require_hr(request)
    db   = get_db()
    body = await request.json()
    run  = await db.rahaza_payroll_runs.find_one({"id": run_id}, {"_id": 0})
    if not run:
        raise HTTPException(404, "Run tidak ditemukan.")
    if run.get("status") != "finalized":
        raise HTTPException(400, "Hanya run FINALIZED.")
    if run.get("pph21_payment_status") == "paid":
        raise HTTPException(400, "PPh21 run ini sudah dibayar.")

    payment_date = (body.get("payment_date") or str(date.today()))[:10]
    bank_code    = (body.get("bank_account_code") or "1-1201").strip()

    slips = await db.rahaza_payslips.find({"run_id": run_id}, {"_id": 0, "deductions": 1}).to_list(500)
    pph_total = 0.0
    for s in slips:
        for d in (s.get("deductions") or []):
            if "pph" in (d.get("label") or "").lower() or d.get("type") == "pph21":
                pph_total += float(d.get("amount") or 0)

    if pph_total <= 0:
        raise HTTPException(400, "Tidak ada potongan PPh21 di run ini.")

    bank_acc = await db.rahaza_coa_accounts.find_one({"code": bank_code, "active": True}, {"_id": 0, "name": 1})
    if not bank_acc:
        raise HTTPException(400, f"Akun GL '{bank_code}' tidak ditemukan.")

    from routes.rahaza_posting import _create_posted_je
    run_id_ref = f"pph21pay:{run_id}"
    try:
        je_date = date.fromisoformat(payment_date)
    except Exception:
        je_date = date.today()
    memo  = f"Bayar PPh21 {run.get('run_number')} · {run.get('period_from')}–{run.get('period_to')}"
    lines = [
        {"account_code": "2-1301", "debit": pph_total, "credit": 0, "description": memo},
        {"account_code": bank_code, "debit": 0, "credit": pph_total, "description": memo},
    ]
    result = await _create_posted_je(db, je_date, memo, "pph21_payment", run_id_ref, lines, user)
    update = {
        "pph21_payment_status": "paid" if result.get("ok") else "error",
        "pph21_payment_date":   payment_date,
        "pph21_payment_amount": pph_total,
        "pph21_payment_je":     result.get("je_number"),
        "pph21_payment_error":  result.get("error"),
        "updated_at":           _now(),
    }
    await db.rahaza_payroll_runs.update_one({"id": run_id}, {"$set": update})
    await log_activity(user["id"], user.get("name",""), "pay_pph21", "rahaza.payroll_run",
                       f"{run.get('run_number')} PPh21 Rp {pph_total:,.0f}")
    out = await db.rahaza_payroll_runs.find_one({"id": run_id}, {"_id": 0})
    out["_payment_result"] = result
    return serialize_doc(out)


@router.get("/payroll-runs/{run_id}/export")
async def export_run_csv(run_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    run = await db.rahaza_payroll_runs.find_one({"id": run_id}, {"_id": 0})
    if not run:
        raise HTTPException(404, "Payroll run tidak ditemukan.")
    payslips = await db.rahaza_payslips.find({"run_id": run_id}, {"_id": 0}).sort("employee_code", 1).to_list(500)

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([
        "run_number", "period_from", "period_to",
        "employee_code", "employee_name", "pay_scheme",
        "earnings_total", "overtime_hours", "overtime_amount",
        "gross_pay", "deductions_total", "net_pay",
        "days_hadir", "total_hours_worked",
    ])
    for s in payslips:
        w.writerow([
            run.get("run_number"), run.get("period_from"), run.get("period_to"),
            s.get("employee_code"), s.get("employee_name"), s.get("pay_scheme"),
            s.get("earnings_total", 0), s.get("overtime_hours", 0), s.get("overtime_amount", 0),
            s.get("gross_pay", 0), s.get("deductions_total", 0), s.get("net_pay", 0),
            s.get("days_hadir", 0), s.get("total_hours_worked", 0),
        ])
    buf.seek(0)
    filename = f"payroll_{run.get('run_number')}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


