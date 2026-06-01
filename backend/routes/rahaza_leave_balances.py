"""
CV. Dewi Aditya / PT Rahaza — Leave Balance Tracking (Phase 8.9 P0.3)

Per-employee annual leave quota tracking.

Collection:
  rahaza_leave_balances
    - id (UUID), employee_id, leave_type_id, year
    - allocated: default dari leave_type.quota_default, atau manual override
    - used: auto-incremented saat leave approved
    - remaining: allocated - used (computed)
    - adjustments: [{date, by, delta, reason}]
"""
# ruff: noqa: E741
import uuid
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Request, HTTPException
from database import get_db
from auth import require_auth

router = APIRouter(prefix="/api/rahaza/leave-balances", tags=["rahaza-leave-balances"])


def _uid(): return str(uuid.uuid4())
def _now(): return datetime.now(timezone.utc)
def _s(d):
    if not d:
        return None
    d = dict(d)
    d.pop("_id", None)
    for k, v in d.items():
        if isinstance(v, datetime):
            d[k] = v.isoformat()
    return d


async def _require_admin(request: Request):
    user = await require_auth(request)
    role = user.get("role", "")
    if role not in ("superadmin", "admin", "owner", "hr", "manager"):
        raise HTTPException(403, "Hanya HR/Manager yang dapat mengelola saldo cuti.")
    return user


async def get_or_create_balance(db, employee_id: str, leave_type_id: str, year: int) -> dict:
    """Ensure balance record exists for (employee, leave_type, year)."""
    existing = await db.rahaza_leave_balances.find_one(
        {"employee_id": employee_id, "leave_type_id": leave_type_id, "year": year},
        {"_id": 0},
    )
    if existing:
        return existing

    lt = await db.rahaza_leave_types.find_one({"id": leave_type_id}, {"_id": 0})
    allocated = int(lt.get("quota_default", 12)) if lt else 12

    doc = {
        "id": _uid(),
        "employee_id": employee_id,
        "leave_type_id": leave_type_id,
        "year": year,
        "allocated": allocated,
        "used": 0,
        "adjustments": [],
        "created_at": _now(),
        "updated_at": _now(),
    }
    await db.rahaza_leave_balances.insert_one(doc)
    return doc


async def consume_balance(db, employee_id: str, leave_type_id: str, year: int, days: float):
    """Deduct from balance when leave approved. Returns updated doc."""
    doc = await get_or_create_balance(db, employee_id, leave_type_id, year)
    new_used = (doc.get("used", 0) or 0) + days
    await db.rahaza_leave_balances.update_one(
        {"id": doc["id"]},
        {"$set": {"used": new_used, "updated_at": _now()}}
    )


async def restore_balance(db, employee_id: str, leave_type_id: str, year: int, days: float):
    """Restore balance (e.g., when leave is cancelled after approval)."""
    doc = await db.rahaza_leave_balances.find_one(
        {"employee_id": employee_id, "leave_type_id": leave_type_id, "year": year},
        {"_id": 0},
    )
    if doc:
        new_used = max(0, (doc.get("used", 0) or 0) - days)
        await db.rahaza_leave_balances.update_one(
            {"id": doc["id"]},
            {"$set": {"used": new_used, "updated_at": _now()}}
        )


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.get("")
async def list_balances(
    request: Request,
    employee_id: Optional[str] = None,
    year: Optional[int] = None,
    leave_type_id: Optional[str] = None,
):
    await require_auth(request)
    db = get_db()
    filt = {}
    if employee_id:
        filt["employee_id"] = employee_id
    if year:
        filt["year"] = year
    if leave_type_id:
        filt["leave_type_id"] = leave_type_id

    docs = await db.rahaza_leave_balances.find(filt, {"_id": 0}).to_list(500)

    # Enrich with employee + leave type info
    emp_ids = list({d["employee_id"] for d in docs})
    lt_ids = list({d["leave_type_id"] for d in docs})
    emps = await db.rahaza_employees.find({"id": {"$in": emp_ids}}, {"_id": 0, "id": 1, "name": 1, "employee_code": 1}).to_list(500) if emp_ids else []
    lts = await db.rahaza_leave_types.find({"id": {"$in": lt_ids}}, {"_id": 0, "id": 1, "name": 1, "code": 1, "color": 1}).to_list(500) if lt_ids else []
    emp_map = {e["id"]: e for e in emps}
    lt_map = {l["id"]: l for l in lts}

    result = []
    for d in docs:
        d2 = _s(d)
        d2["remaining"] = d2.get("allocated", 0) - d2.get("used", 0)
        d2["employee"] = emp_map.get(d2["employee_id"])
        d2["leave_type"] = lt_map.get(d2["leave_type_id"])
        result.append(d2)

    return {"ok": True, "balances": result}


@router.get("/my")
async def my_balances(request: Request, year: Optional[int] = None):
    """Balance for current logged-in employee (linked via user.employee_id)."""
    user = await require_auth(request)
    emp_id = user.get("employee_id")
    if not emp_id:
        raise HTTPException(409, "User belum ter-link ke karyawan. Hubungi HR.")
    db = get_db()
    target_year = year or datetime.now().year
    filt = {"employee_id": emp_id, "year": target_year}
    docs = await db.rahaza_leave_balances.find(filt, {"_id": 0}).to_list(500)

    lt_ids = [d["leave_type_id"] for d in docs]
    # Also include leave types the employee hasn't used yet (for completeness)
    all_lts = await db.rahaza_leave_types.find({"active": True}, {"_id": 0}).to_list(500)
    lt_map = {l["id"]: l for l in all_lts}
    existing_lt_ids = set(lt_ids)

    # Auto-create missing balances
    for lt in all_lts:
        if lt["id"] not in existing_lt_ids:
            nd = await get_or_create_balance(db, emp_id, lt["id"], target_year)
            docs.append(nd)

    result = []
    for d in docs:
        d2 = _s(d)
        d2["remaining"] = d2.get("allocated", 0) - d2.get("used", 0)
        d2["leave_type"] = lt_map.get(d2["leave_type_id"])
        result.append(d2)
    return {"ok": True, "year": target_year, "balances": result}


@router.post("/allocate-year")
async def allocate_year(request: Request):
    """Admin: bulk allocate annual quota for all active employees, for all leave types."""
    await _require_admin(request)
    db = get_db()
    body = await request.json()
    year = int(body.get("year") or datetime.now().year)
    force_reset = bool(body.get("force_reset", False))

    employees = await db.rahaza_employees.find({"active": True}, {"_id": 0, "id": 1}).to_list(500)
    leave_types = await db.rahaza_leave_types.find({"active": True}, {"_id": 0, "id": 1, "quota_default": 1}).to_list(500)

    created = 0
    updated = 0
    for emp in employees:
        for lt in leave_types:
            existing = await db.rahaza_leave_balances.find_one(
                {"employee_id": emp["id"], "leave_type_id": lt["id"], "year": year}
            )
            if existing and not force_reset:
                continue
            allocated = int(lt.get("quota_default", 12))
            if existing:
                await db.rahaza_leave_balances.update_one(
                    {"id": existing["id"]},
                    {"$set": {"allocated": allocated, "used": 0, "updated_at": _now()}}
                )
                updated += 1
            else:
                doc = {
                    "id": _uid(),
                    "employee_id": emp["id"],
                    "leave_type_id": lt["id"],
                    "year": year,
                    "allocated": allocated,
                    "used": 0,
                    "adjustments": [],
                    "created_at": _now(),
                    "updated_at": _now(),
                }
                await db.rahaza_leave_balances.insert_one(doc)
                created += 1

    return {"ok": True, "year": year, "created": created, "updated": updated,
            "total_employees": len(employees), "total_leave_types": len(leave_types)}


@router.put("/{balance_id}")
async def update_balance(balance_id: str, request: Request):
    """Admin manual adjust: set new allocated, or add/subtract via adjustment."""
    user = await _require_admin(request)
    db = get_db()
    body = await request.json()

    doc = await db.rahaza_leave_balances.find_one({"id": balance_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Balance tidak ditemukan.")

    upd = {"updated_at": _now()}
    if "allocated" in body:
        upd["allocated"] = int(body["allocated"])
    if "used" in body:
        upd["used"] = float(body["used"])

    # Adjustment log
    if "adjust_delta" in body:
        delta = float(body["adjust_delta"])
        new_alloc = (doc.get("allocated", 0) or 0) + delta
        upd["allocated"] = new_alloc
        adj = {
            "date": _now().isoformat(),
            "by": user.get("name", ""),
            "by_id": user["id"],
            "delta": delta,
            "reason": body.get("reason", ""),
        }
        upd["adjustments"] = (doc.get("adjustments") or []) + [adj]

    await db.rahaza_leave_balances.update_one({"id": balance_id}, {"$set": upd})
    out = await db.rahaza_leave_balances.find_one({"id": balance_id}, {"_id": 0})
    return {"ok": True, "balance": _s(out)}
