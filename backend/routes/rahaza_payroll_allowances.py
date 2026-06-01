# ruff: noqa: F401
"""
rahaza_payroll_allowances.py — Payroll Allowance Templates
Extracted from rahaza_payroll.py (1539 LOC monolith)

Refactored: Session #11.19 Phase 3.2 Batch #4
Endpoints: GET /payroll-allowances, POST /payroll-allowances, PUT /payroll-allowances/{id}, DELETE /payroll-allowances/{id}
"""
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse
from database import get_db
from auth import require_auth, serialize_doc, log_activity
from routes.rahaza_payroll_shared import (
    _uid, _now, VALID_SCHEMES, VALID_PERIOD_TYPES, VALID_RUN_STATUS,
    _get_applicable_allowances
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

router = APIRouter(prefix="/api/rahaza", tags=["rahaza-payroll-allowances"])

@router.get("/payroll-allowances")
async def list_allowances(request: Request):
    await require_auth(request)
    db = get_db()
    docs = await db.da_payroll_allowances.find({}, {"_id": 0}).sort("created_at", 1).to_list(500)
    return {"ok": True, "allowances": [serialize_doc(d) for d in docs]}


@router.post("/payroll-allowances")
async def create_allowance(request: Request):
    user = await require_auth(request)
    db = get_db()
    body = await request.json()

    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name wajib diisi.")

    doc = {
        "allowance_id": _uid(),
        "name": name,
        "amount": float(body.get("amount") or 0),
        "calc_type": body.get("calc_type") or "fixed",   # fixed | percentage_gross
        "applicable_to": body.get("applicable_to") or "all",  # all | department | employee
        "department": body.get("department") or "",
        "employee_ids": body.get("employee_ids") or [],
        "description": body.get("description") or "",
        "is_active": True,
        "created_by": user["id"],
        "created_at": _now(),
        "updated_at": _now(),
    }
    await db.da_payroll_allowances.insert_one(doc)
    return {"ok": True, "allowance": serialize_doc(doc)}


@router.put("/payroll-allowances/{allowance_id}")
async def update_allowance(allowance_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    body = await request.json()
    allowed_keys = ["name", "amount", "calc_type", "applicable_to", "department",
                    "employee_ids", "description", "is_active"]
    upd = {k: body[k] for k in allowed_keys if k in body}
    upd["updated_at"] = _now()
    res = await db.da_payroll_allowances.update_one({"allowance_id": allowance_id}, {"$set": upd})
    if res.matched_count == 0:
        raise HTTPException(404, "Tunjangan tidak ditemukan.")
    doc = await db.da_payroll_allowances.find_one({"allowance_id": allowance_id}, {"_id": 0})
    return {"ok": True, "allowance": serialize_doc(doc)}


@router.delete("/payroll-allowances/{allowance_id}")
async def delete_allowance(allowance_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    await db.da_payroll_allowances.delete_one({"allowance_id": allowance_id})
    return {"ok": True}


# ╔══════════════════════════════════════════════════════════════════════════╗
# ║ FASE 8b — PAYROLL PROFILES (extracted to rahaza_payroll_profiles.py)     ║
# ╚══════════════════════════════════════════════════════════════════════════╝

