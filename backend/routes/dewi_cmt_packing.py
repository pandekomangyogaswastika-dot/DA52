"""
CMT Packing & Stok Opname — Blueprint §2.7

Alur utama:
  1. CMT kirim barang → Tim Packing buat 'CMT Receipt'
  2. Tim Packing hitung fisik per SKU / warna / ukuran
  3. Admin Produksi verifikasi & approve → stock tercatat sebagai FG
  4. Barang lolos QC → tampil di Display Rak

Collections:
  cmt_receipts       — Header penerimaan dari CMT
  cmt_receipt_lines  — Baris detail per SKU/variant

Endpoints:
  GET    /api/prod/cmt-receipts                   — list (filter status, cmt_name)
  POST   /api/prod/cmt-receipts                   — buat penerimaan baru
  GET    /api/prod/cmt-receipts/{id}              — detail + lines
  PUT    /api/prod/cmt-receipts/{id}              — update header
  POST   /api/prod/cmt-receipts/{id}/lines        — tambah baris
  PUT    /api/prod/cmt-receipts/{id}/lines/{lid}  — update qty fisik sebuah baris
  DELETE /api/prod/cmt-receipts/{id}/lines/{lid}  — hapus baris
  POST   /api/prod/cmt-receipts/{id}/submit       — submit ke Admin (Pending→Submitted)
  POST   /api/prod/cmt-receipts/{id}/approve      — Admin approve → update FG stock
  POST   /api/prod/cmt-receipts/{id}/reject       — Admin reject
  GET    /api/prod/display-rak                    — tampilkan FG per kode/nama (approved+in_stock)
  GET    /api/prod/cmt-receipts/summary           — stats dashboard
"""
# ruff: noqa: E741

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
import uuid
import re
from datetime import datetime, timezone

from database import get_db
from auth import require_auth, serialize_doc

router = APIRouter(prefix="/api/prod", tags=["cmt-packing"])

def _id():  return str(uuid.uuid4())
def _now(): return datetime.now(timezone.utc).isoformat()


async def _seq(db, collection: str, prefix: str) -> str:
    n = await db[collection].count_documents({}) + 1
    return f"{prefix}-{str(n).zfill(5)}"


# ═══════════════════════════════════════════════════════
# DASHBOARD SUMMARY
# ═══════════════════════════════════════════════════════

@router.get("/cmt-receipts/summary")
async def receipt_summary(request: Request):
    await require_auth(request)
    db = get_db()
    total     = await db.cmt_receipts.count_documents({})
    pending   = await db.cmt_receipts.count_documents({"status": "Draft"})
    submitted = await db.cmt_receipts.count_documents({"status": "Submitted"})
    approved  = await db.cmt_receipts.count_documents({"status": "Approved"})
    rejected  = await db.cmt_receipts.count_documents({"status": "Rejected"})

    # Total pcs diterima hari ini
    today = _now()[:10]
    pipeline = [
        {"$match": {"status": "Approved", "approved_at": {"$gte": today}}},
        {"$lookup": {"from": "cmt_receipt_lines", "localField": "id",
                     "foreignField": "receipt_id", "as": "lines"}},
        {"$unwind": {"path": "$lines", "preserveNullAndEmptyArrays": True}},
        {"$group": {"_id": None, "total_pcs": {"$sum": "$lines.qty_actual"}}}
    ]
    res = await db.cmt_receipts.aggregate(pipeline).to_list(1)
    pcs_today = res[0]["total_pcs"] if res else 0

    # Unique CMTs active
    cmt_names = await db.cmt_receipts.distinct("cmt_name", {"status": {"$ne": "Rejected"}})

    return {
        "total": total, "pending": pending, "submitted": submitted,
        "approved": approved, "rejected": rejected,
        "pcs_approved_today": pcs_today,
        "active_cmt_count": len(cmt_names)
    }


# ═══════════════════════════════════════════════════════
# CMT RECEIPTS CRUD
# ═══════════════════════════════════════════════════════

@router.get("/cmt-receipts")
async def list_receipts(request: Request):
    await require_auth(request)
    db = get_db()
    sp = request.query_params
    query = {}
    if sp.get("status"):
        query["status"]   = sp["status"]
    if sp.get("cmt_name"):
        query["cmt_name"] = re.compile(re.escape(sp["cmt_name"]), re.IGNORECASE)
    if sp.get("wo_number"):
        query["wo_number"]= re.compile(re.escape(sp["wo_number"]), re.IGNORECASE)
    docs = await db.cmt_receipts.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    # Attach line summary
    for d in docs:
        lines = await db.cmt_receipt_lines.find({"receipt_id": d["id"]}, {"_id": 0}).to_list(500)
        d["line_count"] = len(lines)
        d["total_qty_expected"] = sum(l.get("qty_expected", 0) for l in lines)
        d["total_qty_actual"]   = sum(l.get("qty_actual", 0) for l in lines if l.get("qty_actual") is not None)
    return serialize_doc(docs)


@router.post("/cmt-receipts")
async def create_receipt(request: Request):
    user = await require_auth(request)
    db = get_db()
    body = await request.json()
    if not body.get("cmt_name"):
        raise HTTPException(400, "cmt_name wajib diisi")
    code = await _seq(db, "cmt_receipts", "CMT-RCV")
    doc = {
        "id": _id(), "receipt_code": code,
        "cmt_name": body["cmt_name"],
        "wo_number": body.get("wo_number", ""),
        "wo_id": body.get("wo_id", ""),
        "receipt_date": body.get("receipt_date", _now()[:10]),
        "delivery_note": body.get("delivery_note", ""),
        "notes": body.get("notes", ""),
        "status": "Draft",
        "submitted_at": "", "submitted_by": "",
        "approved_at": "", "approved_by": "",
        "reject_reason": "",
        "created_by": user["name"], "created_at": _now(), "updated_at": _now()
    }
    await db.cmt_receipts.insert_one(doc)
    return JSONResponse(serialize_doc(doc), status_code=201)


@router.get("/cmt-receipts/{receipt_id}")
async def get_receipt(receipt_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    doc = await db.cmt_receipts.find_one({"id": receipt_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Penerimaan tidak ditemukan")
    doc["lines"] = await db.cmt_receipt_lines.find({"receipt_id": receipt_id}, {"_id": 0}).to_list(500)
    return serialize_doc(doc)


@router.put("/cmt-receipts/{receipt_id}")
async def update_receipt(receipt_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    body = await request.json()
    doc = await db.cmt_receipts.find_one({"id": receipt_id})
    if not doc:
        raise HTTPException(404, "Penerimaan tidak ditemukan")
    if doc["status"] not in ("Draft",):
        raise HTTPException(400, "Hanya Draft yang bisa diedit")
    allowed = {k: v for k, v in body.items()
               if k in ("cmt_name", "wo_number", "wo_id", "receipt_date", "delivery_note", "notes")}
    allowed["updated_at"] = _now()
    await db.cmt_receipts.update_one({"id": receipt_id}, {"$set": allowed})
    result = await db.cmt_receipts.find_one({"id": receipt_id}, {"_id": 0})
    return serialize_doc(result)


# ═══════════════════════════════════════════════════════
# LINES (per-SKU detail)
# ═══════════════════════════════════════════════════════

@router.post("/cmt-receipts/{receipt_id}/lines")
async def add_line(receipt_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    receipt = await db.cmt_receipts.find_one({"id": receipt_id})
    if not receipt:
        raise HTTPException(404, "Penerimaan tidak ditemukan")
    if receipt["status"] not in ("Draft",):
        raise HTTPException(400, "Tidak bisa tambah baris — status sudah " + receipt["status"])
    body = await request.json()
    if not body.get("product_name") and not body.get("sku_code"):
        raise HTTPException(400, "product_name atau sku_code wajib diisi")
    line = {
        "id": _id(), "receipt_id": receipt_id,
        "sku_code": body.get("sku_code", ""),
        "product_name": body.get("product_name", ""),
        "color": body.get("color", ""),
        "size": body.get("size", ""),
        "qty_expected": int(body.get("qty_expected", 0)),
        "qty_actual": None,   # belum dihitung
        "notes": body.get("notes", ""),
        "created_at": _now()
    }
    await db.cmt_receipt_lines.insert_one(line)
    await db.cmt_receipts.update_one({"id": receipt_id}, {"$set": {"updated_at": _now()}})
    return JSONResponse(serialize_doc(line), status_code=201)


@router.put("/cmt-receipts/{receipt_id}/lines/{line_id}")
async def update_line(receipt_id: str, line_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    body = await request.json()
    await db.cmt_receipt_lines.update_one(
        {"id": line_id, "receipt_id": receipt_id},
        {"$set": {k: v for k, v in body.items() if k not in ("_id", "id", "receipt_id", "created_at")}}
    )
    result = await db.cmt_receipt_lines.find_one({"id": line_id}, {"_id": 0})
    return serialize_doc(result)


@router.delete("/cmt-receipts/{receipt_id}/lines/{line_id}")
async def delete_line(receipt_id: str, line_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    await db.cmt_receipt_lines.delete_one({"id": line_id, "receipt_id": receipt_id})
    return {"ok": True}


# ═══════════════════════════════════════════════════════
# WORKFLOW
# ═══════════════════════════════════════════════════════

@router.post("/cmt-receipts/{receipt_id}/submit")
async def submit_receipt(receipt_id: str, request: Request):
    """Tim Packing submit ke Admin Produksi untuk diverifikasi."""
    user = await require_auth(request)
    db = get_db()
    doc = await db.cmt_receipts.find_one({"id": receipt_id})
    if not doc:
        raise HTTPException(404, "Penerimaan tidak ditemukan")
    if doc["status"] != "Draft":
        raise HTTPException(400, f"Status saat ini '{doc['status']}' — harus Draft")
    # Cek minimal 1 baris sudah dihitung
    lines = await db.cmt_receipt_lines.find({"receipt_id": receipt_id}).to_list(500)
    if not lines:
        raise HTTPException(400, "Tambahkan minimal 1 item sebelum submit")
    counted = [l for l in lines if l.get("qty_actual") is not None]
    if not counted:
        raise HTTPException(400, "Hitung qty fisik minimal 1 item sebelum submit")
    await db.cmt_receipts.update_one({"id": receipt_id}, {"$set": {
        "status": "Submitted",
        "submitted_at": _now(), "submitted_by": user["name"], "updated_at": _now()
    }})
    result = await db.cmt_receipts.find_one({"id": receipt_id}, {"_id": 0})
    return serialize_doc(result)


@router.post("/cmt-receipts/{receipt_id}/approve")
async def approve_receipt(receipt_id: str, request: Request):
    """Admin Produksi approve → stok FG ditambah."""
    user = await require_auth(request)
    db = get_db()
    doc = await db.cmt_receipts.find_one({"id": receipt_id})
    if not doc:
        raise HTTPException(404, "Penerimaan tidak ditemukan")
    if doc["status"] != "Submitted":
        raise HTTPException(400, f"Status saat ini '{doc['status']}' — harus Submitted")
    lines = await db.cmt_receipt_lines.find({"receipt_id": receipt_id}).to_list(500)

    # Update FG inventory → UNIFIED ke rahaza_material_stock (Phase 2)
    for ln in lines:
        qty = ln.get("qty_actual")
        if qty is None or qty <= 0:
            continue
        sku = ln.get("sku_code", "")
        product_name = ln.get("product_name", "")
        color = ln.get("color", "")
        size = ln.get("size", "")
        
        # PHASE 2 FIX: Redirect FG ke rahaza_material_stock (bukan rahaza_fg_inventory)
        # Ownership: cv_da (internal), Category: fg_internal
        material_id = f"FG-{sku}" if sku else f"FG-{_id()[:8]}"
        
        # Cek apakah material sudah ada
        existing = await db.rahaza_material_stock.find_one({
            "material_id": material_id,
            "ownership": "cv_da",
            "inventory_category": "fg_internal"
        })
        
        if existing:
            # Update qty
            await db.rahaza_material_stock.update_one(
                {"id": existing["id"]},
                {
                    "$inc": {"quantity": qty, "available_quantity": qty},
                    "$set": {"updated_at": _now()}
                }
            )
        else:
            # Create new FG stock entry
            await db.rahaza_material_stock.insert_one({
                "id": _id(),
                "material_id": material_id,
                "material_name": f"{product_name} {color} {size}".strip(),
                "material_code": sku or "",
                "type": "finished_goods",
                "category": "fg_internal",
                "inventory_category": "fg_internal",
                "ownership": "cv_da",
                "maklon_client_id": None,
                "quantity": qty,
                "available_quantity": qty,
                "reserved_quantity": 0,
                "unit": "pcs",
                "location": "gudang_fg",
                "notes": f"FG dari CMT {doc['cmt_name']}",
                "created_at": _now(),
                "updated_at": _now(),
                "created_by": user.get("name", "system")
            })
        
        # Log FG movement (keep for audit trail)
        if sku:
            await db.rahaza_fg_movements.insert_one({
                "id": _id(), "sku_code": sku,
                "movement_type": "IN", "qty": qty,
                "source": "cmt_receipt", "ref_id": receipt_id,
                "ref_number": doc["receipt_code"],
                "notes": f"Terima dari CMT {doc['cmt_name']} — {product_name} {color} {size} [UNIFIED TO rahaza_material_stock]",
                "created_by": user["name"], "created_at": _now()
            })

    await db.cmt_receipts.update_one({"id": receipt_id}, {"$set": {
        "status": "Approved",
        "approved_at": _now(), "approved_by": user["name"], "updated_at": _now()
    }})
    result = await db.cmt_receipts.find_one({"id": receipt_id}, {"_id": 0})
    return serialize_doc(result)


@router.post("/cmt-receipts/{receipt_id}/reject")
async def reject_receipt(receipt_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    body = await request.json()
    doc = await db.cmt_receipts.find_one({"id": receipt_id})
    if not doc:
        raise HTTPException(404, "Penerimaan tidak ditemukan")
    if doc["status"] not in ("Submitted", "Draft"):
        raise HTTPException(400, "Tidak bisa reject — status sudah " + doc["status"])
    await db.cmt_receipts.update_one({"id": receipt_id}, {"$set": {
        "status": "Rejected",
        "reject_reason": body.get("reason", ""),
        "updated_at": _now()
    }})
    result = await db.cmt_receipts.find_one({"id": receipt_id}, {"_id": 0})
    return serialize_doc(result)


# ═══════════════════════════════════════════════════════
# DISPLAY RAK
# ═══════════════════════════════════════════════════════

@router.get("/display-rak")
async def display_rak(request: Request):
    """
    Tampilkan semua item FG yang sudah approved dari CMT.
    Grouped by sku_code → aggregated qty.
    """
    await require_auth(request)
    db = get_db()
    sp = request.query_params
    # Ambil semua approved receipts
    receipts_q = {"status": "Approved"}
    if sp.get("cmt_name"):
        receipts_q["cmt_name"] = re.compile(re.escape(sp["cmt_name"]), re.IGNORECASE)
    receipt_ids = await db.cmt_receipts.distinct("id", receipts_q)
    if not receipt_ids:
        return []
    # Aggregate lines
    lines_q = {"receipt_id": {"$in": receipt_ids}, "qty_actual": {"$gt": 0}}
    if sp.get("search"):
        rx = re.compile(re.escape(sp["search"]), re.IGNORECASE)
        lines_q["$or"] = [{"sku_code": rx}, {"product_name": rx}]
    pipeline = [
        {"$match": lines_q},
        {"$group": {
            "_id": {"sku_code": "$sku_code", "product_name": "$product_name",
                    "color": "$color", "size": "$size"},
            "total_qty": {"$sum": "$qty_actual"},
            "last_received": {"$max": "$created_at"}
        }},
        {"$sort": {"_id.product_name": 1, "_id.color": 1, "_id.size": 1}}
    ]
    res = await db.cmt_receipt_lines.aggregate(pipeline).to_list(500)
    out = []
    for r in res:
        g = r["_id"]
        out.append({
            "sku_code": g.get("sku_code", ""),
            "product_name": g.get("product_name", ""),
            "color": g.get("color", ""),
            "size": g.get("size", ""),
            "total_qty": r["total_qty"],
            "last_received": r.get("last_received", "")
        })
    return serialize_doc(out)


# ═══════════════════════════════════════════════════════
# PRODUCTION DASHBOARD — Material per Lokasi
# ═══════════════════════════════════════════════════════

@router.get("/material-summary-by-location")
async def material_summary_by_location(request: Request):
    """
    Material issue stats grouped by location (for production dashboard multi-warehouse filter).
    Returns per-location: pending_issues, approved_issues, total_qty_issued.
    """
    await require_auth(request)
    db = get_db()
    sp = request.query_params
    loc_id = sp.get("location_id")

    # Get all material issues
    mis_q = {}
    if loc_id:
        # Filter by location: find pending movements from that location
        pending_ids = await db.wh_pending_movements.distinct(
            "source_id",
            {"type": "outbound_rm", "source_type": "rahaza_material_issue", "building_id": loc_id}
        )
        # Also match by location_id in MI items (fallback)
        mi_direct = await db.rahaza_material_issues.distinct("id", {"items.location_id": loc_id})
        all_ids = list(set((pending_ids or []) + (mi_direct or [])))
        mis_q["id"] = {"$in": all_ids or ["__none__"]}

    mis = await db.rahaza_material_issues.find(mis_q, {"_id": 0, "id": 1, "status": 1, "work_order_id": 1, "created_at": 1}).to_list(500)

    status_counts = {}
    for mi in mis:
        st = mi.get("status", "unknown")
        status_counts[st] = status_counts.get(st, 0) + 1

    # Locations list
    locations = await db.rahaza_locations.find({"active": True}, {"_id": 0}).to_list(500)

    return {
        "location_id": loc_id,
        "total_mis": len(mis),
        "by_status": status_counts,
        "locations": locations
    }
