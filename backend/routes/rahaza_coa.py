"""
PT Rahaza — Phase F1 Accounting Core
Chart of Accounts (PSAK / SAK-ETAP compliant) — Garment Manufacturing Template

Collection: rahaza_coa_accounts
Fields:
  id (uuid), code (unique string), name, type (ASSET/LIABILITY/EQUITY/REVENUE/COGS/EXPENSE/OTHER),
  parent_code (nullable), normal_balance (DEBIT|CREDIT), is_group (bool, non-postable header),
  flags (dict for integration hooks: is_cash, is_ar, is_ap, is_inventory_rm, ...),
  active (bool), created_at, updated_at, created_by, created_by_name
"""
from fastapi import APIRouter, Request, HTTPException
from database import get_db
from auth import require_auth, serialize_doc, log_activity
import uuid
from datetime import datetime, timezone
import re

router = APIRouter(prefix="/api/rahaza/coa", tags=["rahaza-coa"])

ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "COGS", "EXPENSE", "OTHER_INCOME", "OTHER_EXPENSE"]
NORMAL_DEBIT = {"ASSET", "COGS", "EXPENSE", "OTHER_EXPENSE"}
NORMAL_CREDIT = {"LIABILITY", "EQUITY", "REVENUE", "OTHER_INCOME"}


def _uid(): return str(uuid.uuid4())
def _now(): return datetime.now(timezone.utc)


async def _require_fin(request: Request):
    user = await require_auth(request)
    role = (user.get("role") or "").lower()
    if role in ("superadmin", "admin", "owner", "accounting", "finance", "manager"):
        return user
    perms = user.get("_permissions") or []
    if "*" in perms or "finance.manage" in perms:
        return user
    raise HTTPException(403, "Forbidden: butuh permission finance.")


def _normal_balance_for(acc_type: str) -> str:
    return "DEBIT" if acc_type in NORMAL_DEBIT else "CREDIT"


# ─────────────── CoA Seed Template (Garment Manufacturing, PSAK) ─────────────
# Format: (code, name, type, is_group, flags)
# is_group=True means header/non-postable (you post to child leaf accounts)
SEED_TEMPLATE = [
    # ASSETS ───────────────────────────────────────────────────────────────
    ("1-0000", "ASET", "ASSET", True, {}),
    ("1-1000", "ASET LANCAR", "ASSET", True, {}),
    ("1-1100", "Kas", "ASSET", True, {"is_cash": True}),
    ("1-1101", "Kas Kecil", "ASSET", False, {"is_cash": True}),
    ("1-1102", "Kas Besar", "ASSET", False, {"is_cash": True}),
    ("1-1200", "Bank", "ASSET", True, {"is_bank": True}),
    ("1-1201", "Bank BCA", "ASSET", False, {"is_bank": True}),
    ("1-1202", "Bank Mandiri", "ASSET", False, {"is_bank": True}),
    ("1-1300", "Piutang Usaha", "ASSET", True, {"is_ar": True}),
    ("1-1301", "Piutang Usaha — Dagang", "ASSET", False, {"is_ar": True}),
    ("1-1302", "Cadangan Piutang Ragu-Ragu", "ASSET", False, {"is_contra": True}),
    ("1-1400", "Persediaan", "ASSET", True, {}),
    ("1-1401", "Persediaan Bahan Baku (Benang/Kain)", "ASSET", False, {"is_inventory_rm": True}),
    ("1-1402", "Persediaan Bahan Pembantu (Aksesoris)", "ASSET", False, {"is_inventory_rm": True}),
    ("1-1403", "Persediaan Barang Dalam Proses (WIP)", "ASSET", False, {"is_inventory_wip": True}),
    ("1-1404", "Persediaan Barang Jadi (FG)", "ASSET", False, {"is_inventory_fg": True}),
    ("1-1500", "Pajak Dibayar Dimuka", "ASSET", True, {}),
    ("1-1501", "PPN Masukan", "ASSET", False, {"is_tax_input": True}),
    ("1-1502", "PPh 22/23 Dibayar Dimuka", "ASSET", False, {"is_tax_prepaid": True}),
    ("1-1600", "Uang Muka & Biaya Dibayar Dimuka", "ASSET", True, {}),
    ("1-1610", "Uang Muka Karyawan (Cash Advance)", "ASSET", False, {"is_employee_advance": True}),
    ("1-1620", "Uang Muka Lain-Lain", "ASSET", False, {}),
    ("1-2000", "ASET TETAP", "ASSET", True, {}),
    ("1-2100", "Tanah", "ASSET", False, {"is_fixed_asset": True}),
    ("1-2200", "Bangunan", "ASSET", False, {"is_fixed_asset": True}),
    ("1-2201", "Akum. Penyusutan Bangunan", "ASSET", False, {"is_contra": True, "is_accum_dep": True}),
    ("1-2300", "Mesin & Peralatan Produksi", "ASSET", False, {"is_fixed_asset": True}),
    ("1-2301", "Akum. Penyusutan Mesin", "ASSET", False, {"is_contra": True, "is_accum_dep": True}),
    ("1-2400", "Kendaraan", "ASSET", False, {"is_fixed_asset": True}),
    ("1-2401", "Akum. Penyusutan Kendaraan", "ASSET", False, {"is_contra": True, "is_accum_dep": True}),
    ("1-2500", "Inventaris Kantor", "ASSET", False, {"is_fixed_asset": True}),
    ("1-2501", "Akum. Penyusutan Inventaris", "ASSET", False, {"is_contra": True, "is_accum_dep": True}),

    # LIABILITIES ──────────────────────────────────────────────────────────
    ("2-0000", "LIABILITAS", "LIABILITY", True, {}),
    ("2-1000", "LIABILITAS JANGKA PENDEK", "LIABILITY", True, {}),
    ("2-1100", "Hutang Usaha", "LIABILITY", False, {"is_ap": True}),
    ("2-1200", "Hutang Gaji & Upah", "LIABILITY", False, {"is_payroll_payable": True}),
    ("2-1300", "Hutang Pajak", "LIABILITY", True, {}),
    ("2-1301", "Hutang PPh 21", "LIABILITY", False, {"is_tax_payable": True}),
    ("2-1302", "Hutang PPh 23", "LIABILITY", False, {"is_tax_payable": True}),
    ("2-1303", "Hutang PPh 25/29", "LIABILITY", False, {"is_tax_payable": True}),
    ("2-1400", "Hutang PPN Keluaran", "LIABILITY", False, {"is_tax_output": True}),
    ("2-1500", "Hutang BPJS", "LIABILITY", False, {"is_bpjs_payable": True}),
    ("2-1600", "Hutang Jangka Pendek Lainnya", "LIABILITY", False, {}),
    ("2-2000", "LIABILITAS JANGKA PANJANG", "LIABILITY", True, {}),
    ("2-2100", "Hutang Bank Jangka Panjang", "LIABILITY", False, {"is_long_term": True}),

    # EQUITY ───────────────────────────────────────────────────────────────
    ("3-0000", "EKUITAS", "EQUITY", True, {}),
    ("3-1000", "Modal Disetor", "EQUITY", False, {"is_capital": True}),
    ("3-2000", "Laba Ditahan", "EQUITY", False, {"is_retained_earnings": True}),
    ("3-3000", "Laba/Rugi Tahun Berjalan", "EQUITY", False, {"is_current_earnings": True}),
    ("3-4000", "Prive / Dividen", "EQUITY", False, {"is_contra": True}),

    # REVENUE ──────────────────────────────────────────────────────────────
    ("4-0000", "PENDAPATAN", "REVENUE", True, {}),
    ("4-1000", "Penjualan", "REVENUE", True, {}),
    ("4-1100", "Penjualan Garment", "REVENUE", False, {"is_sales": True}),
    ("4-1200", "Retur Penjualan", "REVENUE", False, {"is_contra": True}),
    ("4-1300", "Diskon Penjualan", "REVENUE", False, {"is_contra": True}),
    ("4-9000", "Pendapatan Lain-Lain", "OTHER_INCOME", False, {}),

    # COGS ─────────────────────────────────────────────────────────────────
    ("5-0000", "HARGA POKOK PENJUALAN", "COGS", True, {}),
    ("5-1000", "HPP Bahan Baku", "COGS", False, {"is_cogs_material": True}),
    ("5-2000", "HPP Tenaga Kerja Langsung", "COGS", False, {"is_cogs_labor": True}),
    ("5-3000", "HPP Overhead Pabrik", "COGS", True, {}),
    ("5-3100", "Listrik Pabrik", "COGS", False, {"is_cogs_overhead": True}),
    ("5-3200", "Penyusutan Mesin Produksi", "COGS", False, {"is_cogs_overhead": True}),
    ("5-3300", "Maintenance Mesin", "COGS", False, {"is_cogs_overhead": True}),
    ("5-3400", "Bahan Pembantu Produksi", "COGS", False, {"is_cogs_overhead": True}),

    # EXPENSE ──────────────────────────────────────────────────────────────
    ("6-0000", "BEBAN OPERASIONAL", "EXPENSE", True, {}),
    ("6-1000", "Beban Penjualan & Pemasaran", "EXPENSE", True, {}),
    ("6-1100", "Biaya Iklan & Promosi", "EXPENSE", False, {}),
    ("6-1200", "Biaya Pengiriman", "EXPENSE", False, {}),
    ("6-2000", "Beban Administrasi & Umum", "EXPENSE", True, {}),
    ("6-2100", "Gaji Staff Kantor", "EXPENSE", False, {"is_salary_expense": True}),
    ("6-2200", "Listrik & Air Kantor", "EXPENSE", False, {}),
    ("6-2300", "Telepon & Internet", "EXPENSE", False, {}),
    ("6-2400", "ATK & Supplies", "EXPENSE", False, {}),
    ("6-2500", "Sewa Kantor", "EXPENSE", False, {}),
    ("6-2600", "Asuransi", "EXPENSE", False, {}),
    ("6-2700", "Penyusutan Bangunan & Inventaris", "EXPENSE", False, {"is_depreciation": True}),
    ("6-2800", "Biaya Bank & Administrasi", "EXPENSE", False, {}),
    ("6-3000", "Beban Karyawan Non-Produksi", "EXPENSE", True, {}),
    ("6-3100", "Tunjangan & Bonus", "EXPENSE", False, {}),
    ("6-3200", "BPJS Kesehatan (Employer)", "EXPENSE", False, {}),
    ("6-3300", "BPJS Ketenagakerjaan (Employer)", "EXPENSE", False, {}),
    ("6-3400", "Biaya Perjalanan Dinas", "EXPENSE", False, {"is_travel_expense": True}),
    ("6-3500", "Biaya Reimbursement Karyawan", "EXPENSE", False, {"is_reimbursement": True}),

    # OTHER ────────────────────────────────────────────────────────────────
    ("7-0000", "PENDAPATAN & BEBAN LAIN-LAIN", "OTHER", True, {}),
    ("7-1000", "Pendapatan Bunga", "OTHER_INCOME", False, {}),
    ("7-2000", "Beban Bunga Pinjaman", "OTHER_EXPENSE", False, {}),
    ("7-3000", "Laba/Rugi Selisih Kurs", "OTHER_INCOME", False, {}),
    ("7-4000", "Pendapatan/Beban Lain-Lain", "OTHER_INCOME", False, {}),
    
    # Phase 9B: Bank Reconciliation Accounts ──────────────────────────────
    ("4-2100", "Pendapatan Bunga Bank", "REVENUE", False, {"is_interest_income": True}),
    ("6-4100", "Biaya Bank & Admin Bank", "EXPENSE", False, {"is_bank_charge": True}),
    ("6-4101", "Biaya Layanan Bank", "EXPENSE", False, {"is_service_fee": True}),
    
    # Phase 9A: Bad Debt Expense ──────────────────────────────────────────────
    ("6-4400", "Beban Kerugian Piutang (Bad Debt Expense)", "EXPENSE", False, {"is_bad_debt_expense": True}),

    # Phase 10A: Asset Disposal Accounts ───────────────────────────────────────
    ("4-2200", "Keuntungan Penjualan Aset Tetap", "REVENUE", False, {"is_gain_on_disposal": True}),
    ("6-4200", "Kerugian Penjualan Aset Tetap", "EXPENSE", False, {"is_loss_on_disposal": True}),
    
    # Phase 10B: Purchase Discount Account ─────────────────────────────────────
    
    # Phase 11A & 11B: Employee Loan Accounts ──────────────────────────────────
    ("1-1320", "Piutang Pinjaman Karyawan", "CURRENT_ASSET", False, {"is_employee_loan_receivable": True}),
    
    # Phase 11C: Scrap/Waste Expense Account ───────────────────────────────────
    ("6-4300", "Biaya Scrap & Material Rusak", "EXPENSE", False, {"is_scrap_expense": True}),

    ("4-2300", "Potongan Pembelian (Purchase Discount)", "REVENUE", False, {"is_purchase_discount": True}),

]


# ─────────────────────── ENDPOINTS ────────────────────────────────────────
@router.get("/accounts")
async def list_accounts(request: Request, active_only: bool = True, search: str = "", type: str = ""):
    await require_auth(request)
    db = get_db()
    q = {}
    if active_only:
        q["active"] = True
    if type:
        q["type"] = type.upper()
    if search:
        q["$or"] = [
            {"code": {"$regex": re.escape(search), "$options": "i"}},
            {"name": {"$regex": re.escape(search), "$options": "i"}},
        ]
    rows = await db.rahaza_coa_accounts.find(q, {"_id": 0}).sort("code", 1).to_list(500)
    return serialize_doc(rows)


@router.get("/tree")
async def coa_tree(request: Request, active_only: bool = True):
    """Return accounts as tree structure based on parent_code."""
    await require_auth(request)
    db = get_db()
    q = {"active": True} if active_only else {}
    rows = await db.rahaza_coa_accounts.find(q, {"_id": 0}).sort("code", 1).to_list(500)
    by_code = {r["code"]: {**r, "children": []} for r in rows}
    roots = []
    for r in rows:
        parent = r.get("parent_code")
        if parent and parent in by_code:
            by_code[parent]["children"].append(by_code[r["code"]])
        else:
            roots.append(by_code[r["code"]])
    return serialize_doc(roots)


@router.post("/accounts")
async def create_account(request: Request):
    user = await _require_fin(request)
    db = get_db()
    body = await request.json()
    code = (body.get("code") or "").strip()
    name = (body.get("name") or "").strip()
    acc_type = (body.get("type") or "").strip().upper()

    if not code or not name:
        raise HTTPException(400, "code & name wajib.")
    if acc_type not in ACCOUNT_TYPES:
        raise HTTPException(400, f"type harus salah satu dari {ACCOUNT_TYPES}")
    if await db.rahaza_coa_accounts.find_one({"code": code}):
        raise HTTPException(409, f"Kode akun '{code}' sudah ada.")

    parent_code = body.get("parent_code") or None
    if parent_code:
        parent = await db.rahaza_coa_accounts.find_one({"code": parent_code})
        if not parent:
            raise HTTPException(400, f"Parent '{parent_code}' tidak ditemukan.")

    doc = {
        "id": _uid(),
        "code": code,
        "name": name,
        "type": acc_type,
        "parent_code": parent_code,
        "is_group": bool(body.get("is_group", False)),
        "normal_balance": _normal_balance_for(acc_type),
        "flags": body.get("flags") or {},
        "active": True,
        "created_at": _now(),
        "updated_at": _now(),
        "created_by": user["id"],
        "created_by_name": user.get("name", ""),
    }
    await db.rahaza_coa_accounts.insert_one(doc)
    await log_activity(user["id"], user.get("name", ""), "create_account", "coa", f"{code} {name}")
    return serialize_doc(doc)


@router.put("/accounts/{aid}")
async def update_account(aid: str, request: Request):
    user = await _require_fin(request)
    db = get_db()
    body = await request.json()
    acc = await db.rahaza_coa_accounts.find_one({"id": aid})
    if not acc:
        raise HTTPException(404, "Akun tidak ditemukan.")
    update = {"updated_at": _now()}
    if "name" in body:
        update["name"] = (body["name"] or "").strip() or acc["name"]
    if "parent_code" in body:
        update["parent_code"] = body["parent_code"] or None
    if "is_group" in body:
        update["is_group"] = bool(body["is_group"])
    if "flags" in body:
        update["flags"] = body["flags"] or {}
    if "active" in body:
        update["active"] = bool(body["active"])
    # note: type & code tidak bisa diubah agar tidak merusak jurnal historis
    await db.rahaza_coa_accounts.update_one({"id": aid}, {"$set": update})
    acc = await db.rahaza_coa_accounts.find_one({"id": aid}, {"_id": 0})
    await log_activity(user["id"], user.get("name", ""), "update_account", "coa", aid)
    return serialize_doc(acc)


@router.delete("/accounts/{aid}")
async def deactivate_account(aid: str, request: Request):
    user = await _require_fin(request)
    db = get_db()
    acc = await db.rahaza_coa_accounts.find_one({"id": aid})
    if not acc:
        raise HTTPException(404, "Akun tidak ditemukan.")
    # cek apakah pernah dipakai di jurnal (soft disable)
    used = await db.rahaza_journal_lines.count_documents({"account_code": acc["code"]})
    if used > 0:
        await db.rahaza_coa_accounts.update_one({"id": aid}, {"$set": {"active": False, "updated_at": _now()}})
        await log_activity(user["id"], user.get("name", ""), "deactivate_account", "coa", acc["code"])
        return {"ok": True, "soft_disabled": True, "used_count": used}
    await db.rahaza_coa_accounts.delete_one({"id": aid})
    await log_activity(user["id"], user.get("name", ""), "delete_account", "coa", acc["code"])
    return {"ok": True, "deleted": True}


@router.post("/seed")
async def seed_template(request: Request):
    """Seed CoA template garment manufacturing (PSAK). Skip akun yang sudah ada."""
    user = await _require_fin(request)
    db = get_db()
    inserted = 0
    skipped = 0
    template_codes = [c for c, *_ in SEED_TEMPLATE]
    existing_coa_codes = set()
    if template_codes:
        async for d in db.rahaza_coa_accounts.find(
            {"code": {"$in": template_codes}}, {"_id": 0, "code": 1}
        ):
            existing_coa_codes.add(d["code"])
    for code, name, acc_type, is_group, flags in SEED_TEMPLATE:
        if code in existing_coa_codes:
            skipped += 1
            continue
        # infer parent_code: strip trailing 0s / hierarchical
        parent_code = _infer_parent_code(code, template_codes)
        doc = {
            "id": _uid(),
            "code": code,
            "name": name,
            "type": acc_type,
            "parent_code": parent_code,
            "is_group": is_group,
            "normal_balance": _normal_balance_for(acc_type),
            "flags": flags,
            "active": True,
            "created_at": _now(),
            "updated_at": _now(),
            "created_by": user["id"],
            "created_by_name": user.get("name", ""),
        }
        await db.rahaza_coa_accounts.insert_one(doc)
        inserted += 1
    await log_activity(user["id"], user.get("name", ""), "seed_coa", "coa", f"inserted={inserted} skipped={skipped}")
    return {"ok": True, "inserted": inserted, "skipped": skipped, "total_template": len(SEED_TEMPLATE)}


def _infer_parent_code(code: str, all_codes: list) -> str | None:
    """For code '1-1101' → parent '1-1100'; for '1-1100' → '1-1000'; for '1-1000' → '1-0000'; for '1-0000' → None."""
    # garment code format: x-abcd where each digit level
    try:
        root, rest = code.split("-")
        if len(rest) != 4 or not rest.isdigit():
            return None
        # find parent by zero-filling from least significant non-zero digit
        digits = list(rest)
        # Move from right: change first non-zero digit to 0
        for i in range(3, -1, -1):
            if digits[i] != "0":
                digits[i] = "0"
                candidate = f"{root}-{''.join(digits)}"
                if candidate != code and candidate in all_codes:
                    return candidate
                # continue to zero out higher
        return None
    except Exception:
        return None
