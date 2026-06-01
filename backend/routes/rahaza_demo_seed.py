"""
CV. Dewi Aditya Official — Demo Seed Endpoint
POST /api/rahaza/seed-demo — seed semua demo data (idempotent)
"""
# ruff: noqa: E741
from fastapi import APIRouter, Request, HTTPException
from database import get_db
from auth import require_auth
from datetime import datetime, timezone, date, timedelta
import uuid
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/rahaza", tags=["rahaza-demo-seed"])


def _uid(): return str(uuid.uuid4())
def _now(): return datetime.now(timezone.utc)
def _today(): return date.today().isoformat()


DEMO_LINES = [
    {"code": "LINE-C1", "name": "Line Cutting 1",  "location_code": "ZNA-CUTTING", "capacity_per_shift": 200},
    {"code": "LINE-C2", "name": "Line Cutting 2",  "location_code": "ZNA-CUTTING", "capacity_per_shift": 180},
    {"code": "LINE-S1", "name": "CMT Sewing 1 (Pak Heru)",   "location_code": "ZNA-SEWING",  "capacity_per_shift": 300},
    {"code": "LINE-S2", "name": "CMT Sewing 2 (Bu Warsini)", "location_code": "ZNA-SEWING",  "capacity_per_shift": 250},
    {"code": "LINE-S3", "name": "CMT Sewing 3 (Mas Joko)",   "location_code": "ZNA-SEWING",  "capacity_per_shift": 280},
    {"code": "LINE-QC", "name": "Tim QC",          "location_code": "ZNA-QC",      "capacity_per_shift": 500},
    {"code": "LINE-PK", "name": "Tim Packing",     "location_code": "ZNA-PACKING", "capacity_per_shift": 400},
]

DEMO_MACHINES = [
    {"code": "M-CUT-001", "name": "Mesin Cutting Straight 1",  "type": "Cutting",  "model": "Eastman CBL-600",   "gauge": "-"},
    {"code": "M-CUT-002", "name": "Mesin Cutting Straight 2",  "type": "Cutting",  "model": "Eastman CBL-600",   "gauge": "-"},
    {"code": "M-SEW-001", "name": "Mesin Jahit Lockstitch 1",  "type": "Jahit",    "model": "Juki DDL-8700",     "gauge": "-"},
    {"code": "M-SEW-002", "name": "Mesin Jahit Lockstitch 2",  "type": "Jahit",    "model": "Juki DDL-8700",     "gauge": "-"},
    {"code": "M-SEW-003", "name": "Mesin Jahit Lockstitch 3",  "type": "Jahit",    "model": "Juki DDL-8700",     "gauge": "-"},
    {"code": "M-SEW-004", "name": "Mesin Obras 1",             "type": "Obras",    "model": "Pegasus W600",      "gauge": "-"},
    {"code": "M-SEW-005", "name": "Mesin Obras 2",             "type": "Obras",    "model": "Pegasus W600",      "gauge": "-"},
    {"code": "M-PRE-001", "name": "Setrika Steam",             "type": "Finishing","model": "Reliable I600",     "gauge": "-"},
    {"code": "M-BCR-001", "name": "Scanner Barcode Packing",   "type": "Packing",  "model": "Zebra DS2208",      "gauge": "-"},
    {"code": "M-PRN-001", "name": "Printer Resi Thermal",      "type": "Packing",  "model": "TSC TE200",         "gauge": "-"},
]

DEMO_EMPLOYEES = [
    {"nik": "EMP001", "name": "Sari Dewi",         "position": "Supervisor Produksi",       "department": "Produksi",  "shift_code": "S1"},
    {"nik": "EMP002", "name": "Agus Sutrisno",     "position": "Supervisor Cutting",        "department": "Produksi",  "shift_code": "S1"},
    {"nik": "EMP003", "name": "Rina Wati",         "position": "Operator Cutting",          "department": "Produksi",  "shift_code": "S1"},
    {"nik": "EMP004", "name": "Budi Hartono",      "position": "Operator Cutting",          "department": "Produksi",  "shift_code": "S2"},
    {"nik": "EMP005", "name": "Yuni Astuti",       "position": "Staff RnD & Desain",        "department": "RnD",       "shift_code": "S1"},
    {"nik": "EMP006", "name": "Fitri Handayani",   "position": "Supervisor Packing",        "department": "Gudang",    "shift_code": "S1"},
    {"nik": "EMP007", "name": "Lestari Wahyu",     "position": "Tim Packing",               "department": "Gudang",    "shift_code": "S1"},
    {"nik": "EMP008", "name": "Heri Setiawan",     "position": "Tim Packing",               "department": "Gudang",    "shift_code": "S1"},
    {"nik": "EMP009", "name": "Nita Sari",         "position": "Admin Aksesoris",           "department": "Gudang",    "shift_code": "S1"},
    {"nik": "EMP010", "name": "Dino Prasetyo",     "position": "Admin Gudang",              "department": "Gudang",    "shift_code": "S1"},
    {"nik": "EMP011", "name": "Winda Kusuma",      "position": "PIC Toko & Marketplace",   "department": "Marketing", "shift_code": "S1"},
    {"nik": "EMP012", "name": "Rizky Amalia",      "position": "Marketing & KOL Specialist","department": "Marketing", "shift_code": "S1"},
    {"nik": "EMP013", "name": "Putri Rahayu",      "position": "Admin Maklon",              "department": "Maklon",    "shift_code": "S1"},
    {"nik": "EMP014", "name": "Joko Santoso",      "position": "Staff Keuangan",            "department": "Keuangan",  "shift_code": "S1"},
    {"nik": "EMP015", "name": "Arinda Sari",       "position": "Staff SDM",                 "department": "SDM",       "shift_code": "S1"},
]

DEMO_MATERIALS = [
    # Kain (fabric rolls) — CV. Dewi Aditya
    {"code": "KAI-RAY-001", "name": "Kain Rayon Twill Hitam",     "type": "fabric",    "unit": "meter", "color": "Hitam",   "stock_qty": 350.0, "min_stock_qty": 50},
    {"code": "KAI-RAY-002", "name": "Kain Rayon Twill Putih",     "type": "fabric",    "unit": "meter", "color": "Putih",   "stock_qty": 280.0, "min_stock_qty": 50},
    {"code": "KAI-CTN-001", "name": "Kain Cotton Combed 24s Navy","type": "fabric",    "unit": "meter", "color": "Navy",    "stock_qty": 200.0, "min_stock_qty": 30},
    {"code": "KAI-CTN-002", "name": "Kain Cotton Combed 24s Abu", "type": "fabric",    "unit": "meter", "color": "Abu-abu", "stock_qty": 150.0, "min_stock_qty": 30},
    {"code": "KAI-JSY-001", "name": "Kain Jersey Kaos Hitam",     "type": "fabric",    "unit": "kg",    "color": "Hitam",   "stock_qty": 80.0,  "min_stock_qty": 20},
    # Aksesoris
    {"code": "ACC-LBL-001", "name": "Label Merek Woven Dewi Aditya",     "type": "accessory", "unit": "pcs", "color": "-",     "stock_qty": 5000,  "min_stock_qty": 500},
    {"code": "ACC-LBL-002", "name": "Label Size (S/M/L/XL/XXL)",         "type": "accessory", "unit": "pcs", "color": "-",     "stock_qty": 3000,  "min_stock_qty": 300},
    {"code": "ACC-ZPR-001", "name": "Ritsleting YKK 20cm",               "type": "accessory", "unit": "pcs", "color": "Hitam", "stock_qty": 500,   "min_stock_qty": 100},
    {"code": "ACC-KNC-001", "name": "Kancing Bungkus Kain",               "type": "accessory", "unit": "pcs", "color": "-",     "stock_qty": 2000,  "min_stock_qty": 200},
    # Packaging
    {"code": "PKG-OPP-001", "name": "Plastik OPP 35x50",                 "type": "packaging", "unit": "pcs", "color": "-",     "stock_qty": 15000, "min_stock_qty": 2000},
    {"code": "PKG-PLM-001", "name": "Polymailer 30x40 (Silver)",         "type": "packaging", "unit": "pcs", "color": "Silver","stock_qty": 10000, "min_stock_qty": 1500},
]

DEMO_MODELS = [
    {"code": "MDL-001", "name": "Rok Midi Rayon Twill",   "category": "Rok",    "yarn_kg_per_pcs": 0.0, "bundle_size": 50},
    {"code": "MDL-002", "name": "Blouse Casual V-Neck",   "category": "Blouse", "yarn_kg_per_pcs": 0.0, "bundle_size": 40},
    {"code": "MDL-003", "name": "Dress Polos Casual",     "category": "Dress",  "yarn_kg_per_pcs": 0.0, "bundle_size": 30},
    {"code": "MDL-004", "name": "Celana Kulot Rayon",     "category": "Celana", "yarn_kg_per_pcs": 0.0, "bundle_size": 40},
    {"code": "MDL-005", "name": "Set Setelan Wanita",     "category": "Set",    "yarn_kg_per_pcs": 0.0, "bundle_size": 25},
    {"code": "MDL-006", "name": "Baju Anak Motif 1-7 Th", "category": "Anak",   "yarn_kg_per_pcs": 0.0, "bundle_size": 50},
    {"code": "MDL-007", "name": "Hijab Segiempat Premium","category": "Hijab",  "yarn_kg_per_pcs": 0.0, "bundle_size": 100},
]

DEMO_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "1-2th", "3-4th", "5-6th", "7th"]

DEMO_CUSTOMERS = [
    {"code": "KLN-001", "name": "Da Grosir Sragen (Internal)",    "country": "Indonesia", "contact_person": "Owner"},
    {"code": "KLN-002", "name": "Brand Lokal A - Jakarta",        "country": "Indonesia", "contact_person": "Ibu Rina"},
    {"code": "KLN-003", "name": "Brand Lokal B - Surabaya",       "country": "Indonesia", "contact_person": "Pak Hendra"},
    {"code": "KLN-004", "name": "Reseller Grosir - Sragen",       "country": "Indonesia", "contact_person": "Bu Sari"},
]


@router.post("/seed-demo")
async def seed_demo_data(request: Request):
    """
    Seed semua demo data CV. Dewi Aditya Official (idempotent).
    Hanya bisa dijalankan oleh superadmin / admin.
    """
    user = await require_auth(request)
    if user.get("role") not in ("superadmin", "admin"):
        raise HTTPException(403, "Hanya superadmin/admin yang bisa seed demo data")

    db = get_db()
    results = {}

    # ─── LINES ──────────────────────────────────────────────────────────────
    line_seeded = 0
    line_map = {}  # code → id
    existing_lines = await db.rahaza_lines.find({}, {"_id": 0}).to_list(500)
    for l in existing_lines:
        line_map[l["code"]] = l["id"]

    # Prefetch existing locations for line lookups
    line_loc_codes = list({line["location_code"] for line in DEMO_LINES if line.get("location_code")})
    locs_for_lines = {}
    if line_loc_codes:
        async for d in db.rahaza_locations.find({"code": {"$in": line_loc_codes}}, {"_id": 0}):
            locs_for_lines[d["code"]] = d
    for line in DEMO_LINES:
        if line["code"] in line_map:
            continue
        loc = locs_for_lines.get(line["location_code"])
        loc_id = loc["id"] if loc else None
        doc = {
            "id": _uid(), "code": line["code"], "name": line["name"],
            "location_id": loc_id, "capacity_per_shift": line["capacity_per_shift"],
            "active": True, "created_at": _now(), "updated_at": _now(),
        }
        await db.rahaza_lines.insert_one(doc)
        line_map[line["code"]] = doc["id"]
        line_seeded += 1
    results["lines"] = line_seeded

    # ─── MACHINES ───────────────────────────────────────────────────────────
    mach_seeded = 0
    mach_codes = [m["code"] for m in DEMO_MACHINES]
    existing_mach_codes = set()
    if mach_codes:
        async for d in db.rahaza_machines.find({"code": {"$in": mach_codes}}, {"_id": 0, "code": 1}):
            existing_mach_codes.add(d["code"])
    for m in DEMO_MACHINES:
        if m["code"] in existing_mach_codes:
            continue
        doc = {
            "id": _uid(), "code": m["code"], "name": m["name"],
            "type": m["type"], "model": m["model"], "gauge": m["gauge"],
            "active": True, "created_at": _now(), "updated_at": _now(),
        }
        await db.rahaza_machines.insert_one(doc)
        mach_seeded += 1
    results["machines"] = mach_seeded

    # ─── SHIFTS (should already exist from startup seed) ────────────────────
    shift_map = {}
    shifts = await db.rahaza_shifts.find({}, {"_id": 0}).to_list(500)
    for s in shifts:
        shift_map[s.get("code")] = s["id"]
    results["shifts_found"] = len(shifts)

    # ─── EMPLOYEES ──────────────────────────────────────────────────────────
    emp_seeded = 0
    emp_map = {}  # nik → id
    emp_niks = [emp["nik"] for emp in DEMO_EMPLOYEES]
    existing_emps_by_nik = {}
    if emp_niks:
        async for d in db.rahaza_employees.find({"nik": {"$in": emp_niks}}, {"_id": 0}):
            existing_emps_by_nik[d["nik"]] = d
    for emp in DEMO_EMPLOYEES:
        existing = existing_emps_by_nik.get(emp["nik"])
        if existing:
            emp_map[emp["nik"]] = existing["id"]
            continue
        shift_id = shift_map.get(emp["shift_code"])
        doc = {
            "id": _uid(), "nik": emp["nik"], "name": emp["name"],
            "employee_code": emp["nik"],
            "position": emp["position"], "department": emp["department"],
            "shift_id": shift_id, "shift_code": emp["shift_code"],
            "join_date": "2023-01-01", "active": True,
            "created_at": _now(), "updated_at": _now(),
        }
        await db.rahaza_employees.insert_one(doc)
        emp_map[emp["nik"]] = doc["id"]
        emp_seeded += 1
    results["employees"] = emp_seeded

    # ─── MATERIALS ──────────────────────────────────────────────────────────
    mat_seeded = 0
    mat_map = {}  # code → id
    mat_codes = [mat["code"] for mat in DEMO_MATERIALS]
    existing_mats_by_code = {}
    if mat_codes:
        async for d in db.rahaza_materials.find({"code": {"$in": mat_codes}}, {"_id": 0}):
            existing_mats_by_code[d["code"]] = d
    # Single fetch default warehouse location (was inside loop)
    default_wh_loc = await db.warehouse_locations.find_one({"active": True}, {"_id": 0})
    default_loc_id = default_wh_loc["id"] if default_wh_loc else None
    for mat in DEMO_MATERIALS:
        existing = existing_mats_by_code.get(mat["code"])
        if existing:
            mat_map[mat["code"]] = existing["id"]
            continue
        doc = {
            "id": _uid(), "code": mat["code"], "name": mat["name"],
            "type": mat["type"], "unit": mat["unit"],
            "yarn_type": mat.get("yarn_type"), "color": mat.get("color"),
            "stock_qty": mat.get("stock_qty", 0),
            "min_stock_qty": mat.get("min_stock_qty"),
            "active": True, "created_at": _now(), "updated_at": _now(),
        }
        await db.rahaza_materials.insert_one(doc)
        mat_map[mat["code"]] = doc["id"]
        await db.rahaza_material_stock.update_one(
            {"material_id": doc["id"]},
            {"$set": {
                "material_id": doc["id"],
                "qty": float(mat.get("stock_qty", 0)),  # Fixed: use "qty" not "quantity"
                "location_id": default_loc_id,
                "updated_at": _now(),
            }},
            upsert=True
        )
        mat_seeded += 1
    results["materials"] = mat_seeded

    # ─── MODELS ─────────────────────────────────────────────────────────────
    mdl_seeded = 0
    mdl_map = {}  # code → id
    mdl_codes = [mdl["code"] for mdl in DEMO_MODELS]
    existing_mdls = {}
    if mdl_codes:
        async for d in db.rahaza_models.find({"code": {"$in": mdl_codes}}, {"_id": 0}):
            existing_mdls[d["code"]] = d
    for mdl in DEMO_MODELS:
        existing = existing_mdls.get(mdl["code"])
        if existing:
            mdl_map[mdl["code"]] = existing["id"]
            continue
        doc = {
            "id": _uid(), "code": mdl["code"], "name": mdl["name"],
            "category": mdl["category"], "yarn_kg_per_pcs": mdl["yarn_kg_per_pcs"],
            "bundle_size": mdl["bundle_size"], "active": True,
            "images": [],
            "created_at": _now(), "updated_at": _now(),
        }
        await db.rahaza_models.insert_one(doc)
        mdl_map[mdl["code"]] = doc["id"]
        mdl_seeded += 1
    results["models"] = mdl_seeded

    # ─── CUSTOMERS ──────────────────────────────────────────────────────────
    cust_seeded = 0
    cust_map = {}
    cust_codes = [c["code"] for c in DEMO_CUSTOMERS]
    existing_custs = {}
    if cust_codes:
        async for d in db.rahaza_customers.find({"code": {"$in": cust_codes}}, {"_id": 0}):
            existing_custs[d["code"]] = d
    for c in DEMO_CUSTOMERS:
        existing = existing_custs.get(c["code"])
        if existing:
            cust_map[c["code"]] = existing["id"]
            continue
        doc = {
            "id": _uid(), "code": c["code"], "name": c["name"],
            "country": c.get("country"), "contact_person": c.get("contact_person"),
            "active": True, "created_at": _now(), "updated_at": _now(),
        }
        await db.rahaza_customers.insert_one(doc)
        cust_map[c["code"]] = doc["id"]
        cust_seeded += 1
    results["customers"] = cust_seeded

    # ─── ORDERS ─────────────────────────────────────────────────────────────
    order_seeded = 0
    order_map = {}  # order_number → id
    demo_orders = [
        {"order_number": "ORD-2026-001", "customer_code": "CUST-001", "model_code": "MDL-001",
         "qty": 500, "size": "M", "delivery_date": "2026-06-30", "status": "in_progress"},
        {"order_number": "ORD-2026-002", "customer_code": "CUST-002", "model_code": "MDL-002",
         "qty": 200, "size": "L", "delivery_date": "2026-07-15", "status": "in_progress"},
        {"order_number": "ORD-2026-003", "customer_code": "CUST-003", "model_code": "MDL-003",
         "qty": 1000, "size": "S", "delivery_date": "2026-08-01", "status": "draft"},
    ]
    order_nums = [o["order_number"] for o in demo_orders]
    existing_orders = {}
    if order_nums:
        async for d in db.rahaza_orders.find({"order_number": {"$in": order_nums}}, {"_id": 0}):
            existing_orders[d["order_number"]] = d
    for o in demo_orders:
        existing = existing_orders.get(o["order_number"])
        if existing:
            order_map[o["order_number"]] = existing["id"]
            continue
        cust_id = cust_map.get(o["customer_code"])
        mdl_id = mdl_map.get(o["model_code"])
        doc = {
            "id": _uid(), "order_number": o["order_number"],
            "customer_id": cust_id, "customer_code": o["customer_code"],
            "model_id": mdl_id, "model_code": o["model_code"],
            "qty": o["qty"], "size": o["size"],
            "delivery_date": o["delivery_date"], "status": o["status"],
            "created_at": _now(), "updated_at": _now(),
        }
        await db.rahaza_orders.insert_one(doc)
        order_map[o["order_number"]] = doc["id"]
        order_seeded += 1
    results["orders"] = order_seeded

    # ─── WORK ORDERS ────────────────────────────────────────────────────────
    wo_seeded = 0
    demo_wos = [
        {"wo_number": "WO-2026-0001", "order_number": "ORD-2026-001", "model_code": "MDL-001",
         "qty": 200, "status": "in_progress", "line_code": "LINE-A",
         "start_date": "2026-04-20", "due_date": "2026-05-10"},
        {"wo_number": "WO-2026-0002", "order_number": "ORD-2026-001", "model_code": "MDL-001",
         "qty": 200, "status": "released", "line_code": "LINE-B",
         "start_date": "2026-04-22", "due_date": "2026-05-15"},
        {"wo_number": "WO-2026-0003", "order_number": "ORD-2026-002", "model_code": "MDL-002",
         "qty": 100, "status": "in_progress", "line_code": "LINE-C",
         "start_date": "2026-04-25", "due_date": "2026-05-20"},
        {"wo_number": "WO-2026-0004", "order_number": "ORD-2026-002", "model_code": "MDL-002",
         "qty": 100, "status": "released", "line_code": "LINE-D",
         "start_date": "2026-04-28", "due_date": "2026-05-25"},
        {"wo_number": "WO-2026-0005", "order_number": "ORD-2026-003", "model_code": "MDL-003",
         "qty": 500, "status": "draft", "line_code": "LINE-E",
         "start_date": "2026-05-01", "due_date": "2026-06-01"},
    ]
    wo_nums = [wo["wo_number"] for wo in demo_wos]
    existing_wo_nums = set()
    if wo_nums:
        async for d in db.rahaza_work_orders.find(
            {"wo_number": {"$in": wo_nums}}, {"_id": 0, "wo_number": 1}
        ):
            existing_wo_nums.add(d["wo_number"])
    for wo in demo_wos:
        if wo["wo_number"] in existing_wo_nums:
            continue
        order_id = order_map.get(wo["order_number"])
        mdl_id = mdl_map.get(wo["model_code"])
        line_id = line_map.get(wo["line_code"])
        doc = {
            "id": _uid(), "wo_number": wo["wo_number"],
            "order_id": order_id, "order_number": wo["order_number"],
            "model_id": mdl_id, "model_code": wo["model_code"],
            "line_id": line_id, "line_code": wo["line_code"],
            "qty": wo["qty"], "qty_produced": 0, "qty_passed_qc": 0,
            "status": wo["status"],
            "start_date": wo["start_date"], "due_date": wo["due_date"],
            "bom_snapshot": {
                "yarn_materials": [
                    {"material_id": list(mat_map.values())[0] if mat_map else None,
                     "material_code": "YRN-W-001", "material_name": "Benang Wol Putih 2/32",
                     "qty_per_pcs": 0.45, "unit": "kg"}
                ],
                "accessory_materials": [],
                "total_yarn_kg_per_pcs": 0.45
            },
            "created_at": _now(), "updated_at": _now(),
        }
        await db.rahaza_work_orders.insert_one(doc)
        wo_seeded += 1
    results["work_orders"] = wo_seeded

    # ─── SOP DATA ───────────────────────────────────────────────────────────
    sop_seeded = 0
    processes = await db.rahaza_processes.find({"active": True}, {"_id": 0}).sort("order_seq", 1).to_list(500)
    model_id_demo = mdl_map.get("MDL-001")
    if model_id_demo:
        # Prefetch existing SOPs for this model + 4 process_ids
        proc_ids_to_check = [p["id"] for p in processes[:4]]
        existing_sops = set()
        if proc_ids_to_check:
            async for d in db.rahaza_sop.find(
                {"model_id": model_id_demo, "process_id": {"$in": proc_ids_to_check}},
                {"_id": 0, "process_id": 1}
            ):
                existing_sops.add(d["process_id"])
        for proc in processes[:4]:  # Seed SOP untuk 4 proses pertama
            if proc["id"] in existing_sops:
                continue
            doc = {
                "id": _uid(), "model_id": model_id_demo, "model_code": "MDL-001",
                "model_name": "Sweater Klasik V-Neck",
                "process_id": proc["id"], "process_code": proc["code"], "process_name": proc["name"],
                "steps": [
                    f"Persiapkan alat dan bahan untuk proses {proc['name']}.",
                    f"Lakukan pengecekan kualitas sesuai standar {proc['name']}.",
                    "Catat hasil di form tracking produksi.",
                ],
                "sam_minutes": round(2.5 + proc.get("order_seq", 1) * 0.3, 1),
                "target_pcs_per_operator": max(5, 30 - proc.get("order_seq", 1) * 3),
                "attachments": [],
                "active": True,
                "created_at": _now(), "updated_at": _now(),
            }
            await db.rahaza_sop.insert_one(doc)
            sop_seeded += 1
    results["sop"] = sop_seeded

    # ─── ATTENDANCE (sample 7 hari terakhir) ────────────────────────────────
    att_seeded = 0
    emp_ids = list(emp_map.values())[:5]  # seed untuk 5 karyawan pertama
    # Build all (emp_id, date) pairs we'll seed; prefetch existing keys in single query
    target_dates = []
    for i in range(7):
        att_date_i = (date.today() - timedelta(days=i)).isoformat()
        if date.fromisoformat(att_date_i).weekday() >= 6:
            continue
        target_dates.append(att_date_i)
    existing_att = set()
    if emp_ids and target_dates:
        async for d in db.rahaza_attendance_events.find(
            {"employee_id": {"$in": emp_ids}, "date": {"$in": target_dates}},
            {"_id": 0, "employee_id": 1, "date": 1}
        ):
            existing_att.add((d["employee_id"], d["date"]))
    for att_date in target_dates:
        for eid in emp_ids:
            if (eid, att_date) in existing_att:
                continue
            doc = {
                "id": _uid(), "employee_id": eid, "date": att_date,
                "check_in": f"{att_date}T07:05:00+07:00",
                "check_out": f"{att_date}T15:10:00+07:00",
                "status": "present", "shift_id": list(shift_map.values())[0] if shift_map else None,
                "created_at": _now(),
            }
            await db.rahaza_attendance_events.insert_one(doc)
            att_seeded += 1
    results["attendance"] = att_seeded

    logger.info(f"Demo seed completed: {results}")
    
    # B5 Fix: Migrate existing rahaza_material_stock NULL rows
    await _migrate_material_stock_nulls(db)
    
    return {"ok": True, "message": "Demo data seeded successfully", "results": results}


async def _migrate_material_stock_nulls(db):
    """
    B5 Fix: Migrate existing rahaza_material_stock rows that have:
    - location_id = None
    - qty = None (or stored as "quantity" field instead of "qty")
    """
    default_wh_loc = await db.warehouse_locations.find_one({"active": True}, {"_id": 0})
    default_loc_id = default_wh_loc["id"] if default_wh_loc else None
    
    migrated = 0
    bad_rows = await db.rahaza_material_stock.find(
        {"$or": [{"location_id": None}, {"qty": None}]},
        {"_id": 0}
    ).to_list(500)
    
    for row in bad_rows:
        mat_id = row["material_id"]
        row_loc_id = row.get("location_id")
        # Fix qty value
        row_qty = float(row.get("qty") or row.get("quantity") or 0)

        # Fix location_id if null
        if not row_loc_id and default_loc_id:
            # Check if target (mat_id, default_loc_id) already exists
            existing_target = await db.rahaza_material_stock.find_one(
                {"material_id": mat_id, "location_id": default_loc_id}
            )
            if existing_target:
                # Merge: add qty into existing target row, delete the null-location row
                await db.rahaza_material_stock.update_one(
                    {"material_id": mat_id, "location_id": default_loc_id},
                    {"$inc": {"qty": row_qty}, "$set": {"updated_at": _now()}, "$unset": {"quantity": ""}}
                )
                await db.rahaza_material_stock.delete_one(
                    {"material_id": mat_id, "location_id": None}
                )
            else:
                # Update: change location_id from None to default
                await db.rahaza_material_stock.update_one(
                    {"material_id": mat_id, "location_id": None},
                    {"$set": {"location_id": default_loc_id, "qty": row_qty, "updated_at": _now()},
                     "$unset": {"quantity": ""}}
                )
        else:
            # Just fix qty if null, no location change needed
            if row.get("qty") is None:
                await db.rahaza_material_stock.update_one(
                    {"material_id": mat_id, "location_id": row_loc_id},
                    {"$set": {"qty": row_qty, "updated_at": _now()}, "$unset": {"quantity": ""}}
                )
        migrated += 1
    
    if migrated:
        logger.info(f"B5 migration: fixed {migrated} NULL rows in rahaza_material_stock")
    return migrated


@router.post("/admin/migrate-stock-nulls")
async def migrate_stock_nulls(request: Request):
    """Fix existing rahaza_material_stock NULL rows (B5 migration endpoint)."""
    user = await require_auth(request)
    if user.get("role") not in ("superadmin", "admin"):
        raise HTTPException(403, "Admin only")
    db = get_db()
    migrated = await _migrate_material_stock_nulls(db)
    return {"ok": True, "migrated": migrated}
