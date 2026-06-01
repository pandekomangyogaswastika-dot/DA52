"""
Rahaza Bundles - Management
CRUD: generate, list, detail, lookup, delete, statuses, summary

Bundle = batch granular pcs yang berpindah antar-proses sebagai unit traceable.
Bundle dibuat manual dari WO yang released.
"""
from fastapi import APIRouter, Request, HTTPException, Query
from database import get_db
from auth import require_auth, log_activity
from routes.shared import get_pagination_params, paginated_response
from utils.counters import next_counter
from datetime import datetime, timezone, date
from typing import Optional
import math
import uuid
import logging
import re

logger = logging.getLogger(__name__)
router = APIRouter(tags=["bundles-mgmt"])

# ─── Utils ───────────────────────────────────────────────────────────────────
def _uid() -> str:
    return str(uuid.uuid4())

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

def _normalize_size_code(code: str) -> str:
    if not code:
        return ""
    s = str(code).strip().upper()
    if not s:
        return ""
    s = re.sub(r"\s+", "", s)
    if re.match(r"^\d+$", s):
        return s
    s = s.replace("SIZE", "").replace("SZ", "").strip()
    return s

_STATUS_ORDER = {
    "created": 0, "in_process": 10, "qc": 20, "pass": 30,
    "fail": 40, "reworking": 50, "packed": 60, "shipped": 70, "closed": 80,
}

def _serialize_bundle(doc: dict) -> dict:
    if not doc:
        return {}
    out = dict(doc)
    out.pop("_id", None)
    for k, v in out.items():
        if isinstance(v, datetime):
            out[k] = v.isoformat()
    return out

def _today_ymd() -> str:
    return date.today().strftime("%Y%m%d")

async def _require_admin_or_manager(request: Request):
    user = await require_auth(request)
    role = (user.get("role") or "").lower()
    if role not in ("admin", "superadmin", "owner", "manager_production", "supervisor"):
        raise HTTPException(403, "Only admin/manager/supervisor can perform this action")
    return user

async def _next_bundle_number(db) -> str:
    """Atomic daily counter → BDL-YYYYMMDD-NNNN (unified counters SSOT)."""
    day = _today_ymd()
    seq = await next_counter(db, f"BDL_{day}", namespace="rahaza")
    return f"BDL-{day}-{seq:04d}"

async def _active_processes(db):
    """Active non-rework processes (urutan proses utama)."""
    rows = await db.rahaza_processes.find(
        {"active": {"$ne": False}, "is_rework": {"$ne": True}},
        {"_id": 0}
    ).sort("order_seq", 1).to_list(500)
    return rows

def _bundle_status_defs():
    return [
        {"value": "created",    "label": "Dibuat",       "color": "slate",   "description": "Bundle baru, belum masuk proses"},
        {"value": "in_process", "label": "Dalam Proses", "color": "primary", "description": "Sedang dikerjakan di salah satu proses"},
        {"value": "qc",         "label": "Menunggu QC",  "color": "amber",   "description": "Menunggu inspeksi QC"},
        {"value": "reworking",  "label": "Rework",       "color": "orange",  "description": "Gagal QC, dikerjakan ulang via proses Rework"},
        {"value": "packed",     "label": "Selesai Pack", "color": "emerald", "description": "Lulus packing, siap kirim"},
        {"value": "shipped",    "label": "Terkirim",     "color": "emerald", "description": "Sudah dikirim via Shipment"},
        {"value": "closed",     "label": "Ditutup",      "color": "foreground", "description": "Ditutup manual (misal batal / retur)"},
    ]

@router.post("/work-orders/{wo_id}/generate-bundles")
async def generate_bundles(wo_id: str, request: Request):
    """
    Generate bundles untuk WO. Idempotent — error 409 jika sudah ada bundle,
    kecuali ?force=true (admin only, akan hapus bundle yang belum di-proses).

    Logika:
    - Ambil model.bundle_size (fallback 30)
    - num_bundles = ceil(wo.qty / bundle_size)
    - Bundle terakhir bisa qty < bundle_size (sisa)
    """
    user = await _require_admin_or_manager(request)
    db = get_db()

    wo = await db.rahaza_work_orders.find_one({"id": wo_id}, {"_id": 0})
    if not wo:
        raise HTTPException(404, "Work Order tidak ditemukan")

    if wo.get("status") in ("cancelled",):
        raise HTTPException(400, "WO sudah cancelled, tidak bisa generate bundle")

    wo_qty = int(wo.get("qty") or 0)
    if wo_qty <= 0:
        raise HTTPException(400, "WO qty harus > 0")

    sp = request.query_params
    force = (sp.get("force") or "").lower() in ("true", "1", "yes")

    existing = await db.rahaza_bundles.count_documents({"work_order_id": wo_id})
    if existing > 0 and not force:
        raise HTTPException(409, f"WO ini sudah punya {existing} bundle. Pakai ?force=true untuk regenerate (akan hapus bundle yang belum diproses).")

    # Regenerate guard: only delete bundles dengan status='created' dan history hanya 'created'
    if existing > 0 and force:
        role = (user.get("role") or "").lower()
        if role not in ("admin", "superadmin", "owner"):
            raise HTTPException(403, "Regenerate hanya boleh admin")
        removed = 0
        async for b in db.rahaza_bundles.find({"work_order_id": wo_id}, {"_id": 0}):
            events = [e for e in (b.get("history") or []) if e.get("event") != "created"]
            if b.get("status") == "created" and not events:
                await db.rahaza_bundles.delete_one({"id": b["id"]})
                removed += 1
        if removed < existing:
            raise HTTPException(409, f"Hanya {removed}/{existing} bundle yang bisa dihapus (sisanya sudah dalam proses). Regenerate dibatalkan untuk keamanan data.")
        # log
        await log_activity(user.get("id"), user.get("name", ""), "regenerate-bundles",
                           "rahaza.work_order", wo.get("wo_number"))

    # Bundle size resolver: model.bundle_size > default 30
    model = await db.rahaza_models.find_one({"id": wo.get("model_id")}, {"_id": 0}) or {}
    bundle_size = int(model.get("bundle_size") or 0) or 30
    # Per-call override (body.bundle_size), admin only
    try:
        body = await request.json()
    except Exception:
        body = {}
    if body and body.get("bundle_size"):
        try:
            bundle_size = max(1, int(body["bundle_size"]))
        except Exception:
            pass

    # Processes snapshot (urutan utama, exclude rework)
    procs = await _active_processes(db)
    if not procs:
        raise HTTPException(400, "Tidak ada master proses aktif. Definisikan proses terlebih dahulu.")
    process_sequence = [
        {"id": p["id"], "code": p["code"], "name": p["name"], "order_seq": p.get("order_seq", 0)}
        for p in procs
    ]
    first_proc = procs[0]

    # Sizes for snapshot
    size = await db.rahaza_sizes.find_one({"id": wo.get("size_id")}, {"_id": 0}) or {}

    # Compute bundles
    num_bundles = max(1, math.ceil(wo_qty / bundle_size))
    created = []
    remaining_qty = wo_qty
    for i in range(num_bundles):
        bqty = min(bundle_size, remaining_qty)
        remaining_qty -= bqty
        bundle_number = await _next_bundle_number(db)
        doc = {
            "id": _uid(),
            "bundle_number": bundle_number,
            "work_order_id": wo_id,
            "wo_number_snapshot": wo.get("wo_number"),
            "model_id": wo.get("model_id"),
            "model_code": model.get("code") or wo.get("model_code"),
            "model_name": model.get("name") or wo.get("model_name"),
            "size_id": wo.get("size_id"),
            "size_code": size.get("code") or wo.get("size_code"),
            "qty": bqty,
            "qty_pass": 0,
            "qty_fail": 0,
            "qty_remaining": bqty,  # berapa pcs masih harus diproses di current_process
            "status": "created",
            "process_sequence": process_sequence,
            "current_process_id": first_proc["id"],
            "current_process_code": first_proc["code"],
            "current_process_name": first_proc["name"],
            "current_line_id": None,
            "parent_bundle_id": None,
            "split_from_qc_event_id": None,
            "history": [{
                "event": "created",
                "by": user.get("name") or user.get("email"),
                "by_id": user.get("id"),
                "at": _now(),
                "qty": bqty,
                "notes": f"Generated bundle {i+1}/{num_bundles} dari WO {wo.get('wo_number')}",
            }],
            "created_at": _now(),
            "updated_at": _now(),
            "created_by": user.get("email") or user.get("name"),
        }
        await db.rahaza_bundles.insert_one(doc)
        doc.pop("_id", None)
        created.append(doc)

    # Log
    await log_activity(user.get("id"), user.get("name", ""), "generate-bundles",
                       "rahaza.work_order", wo.get("wo_number"))

    return {
        "generated": len(created),
        "bundle_size": bundle_size,
        "total_qty": wo_qty,
        "wo_number": wo.get("wo_number"),
        "bundles": created,
    }


# ─── LIST ────────────────────────────────────────────────────────────────────
@router.get("/bundles")
async def list_bundles(
    request: Request,
    work_order_id: Optional[str] = None,
    status: Optional[str] = None,
    current_process_id: Optional[str] = None,
    current_line_id: Optional[str] = None,
    model_id: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = Query(200, le=500),
):
    """
    List bundles dengan filter. Default sort: created_at desc.
    Pagination: ?page=1&limit=50 → {items, pagination}. Tanpa page → {items, total} (legacy)
    """
    await require_auth(request)
    db = get_db()
    filt: dict = {}
    if work_order_id:
        filt["work_order_id"] = work_order_id
    if status:
        filt["status"] = status
    if current_process_id:
        filt["current_process_id"] = current_process_id
    if current_line_id:
        filt["current_line_id"] = current_line_id
    if model_id:
        filt["model_id"] = model_id
    if q:
        qq = q.strip()
        filt["$or"] = [
            {"bundle_number": {"$regex": re.escape(qq), "$options": "i"}},
            {"wo_number_snapshot": {"$regex": re.escape(qq), "$options": "i"}},
            {"model_code": {"$regex": re.escape(qq), "$options": "i"}},
        ]

    use_pagination = "page" in request.query_params
    if use_pagination:
        page, pg_limit, pg_skip = get_pagination_params(request, default_limit=50)
        total = await db.rahaza_bundles.count_documents(filt)
        rows = await db.rahaza_bundles.find(filt, {"_id": 0}).sort("created_at", -1).skip(pg_skip).limit(pg_limit).to_list(length=10000)
        return paginated_response(rows, total, page, pg_limit)

    rows = await db.rahaza_bundles.find(filt, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(500)
    return {"items": rows, "total": len(rows)}


# ─── DETAIL ──────────────────────────────────────────────────────────────────
@router.get("/bundles/{bid}")
async def get_bundle(bid: str, request: Request):
    await require_auth(request)
    db = get_db()
    b = await db.rahaza_bundles.find_one({"id": bid}, {"_id": 0})
    if not b:
        raise HTTPException(404, "Bundle tidak ditemukan")
    return b


# ─── LOOKUP by number (for scan prep Phase 17C) ──────────────────────────────
@router.get("/bundles/by-number/{bundle_number}")
async def get_bundle_by_number(bundle_number: str, request: Request):
    await require_auth(request)
    db = get_db()
    b = await db.rahaza_bundles.find_one(
        {"bundle_number": bundle_number.strip().upper()},
        {"_id": 0}
    )
    if not b:
        raise HTTPException(404, "Bundle number tidak ditemukan")
    return b


# ─── DELETE (hanya kalau masih created tanpa event) ──────────────────────────
@router.delete("/bundles/{bid}")
async def delete_bundle(bid: str, request: Request):
    user = await _require_admin_or_manager(request)
    db = get_db()
    b = await db.rahaza_bundles.find_one({"id": bid}, {"_id": 0})
    if not b:
        raise HTTPException(404, "Bundle tidak ditemukan")
    events = [e for e in (b.get("history") or []) if e.get("event") != "created"]
    if b.get("status") != "created" or events:
        raise HTTPException(400, "Hanya bundle status 'created' tanpa event produksi yang bisa dihapus")
    await db.rahaza_bundles.delete_one({"id": bid})
    await log_activity(user.get("id"), user.get("name", ""), "delete", "rahaza.bundle", b.get("bundle_number"))
    return {"ok": True}


# ─── STATUSES metadata ───────────────────────────────────────────────────────
@router.get("/bundles-statuses")
async def bundle_statuses(request: Request):
    await require_auth(request)
    return {"statuses": _bundle_status_defs()}


# ─── WO Summary (buat UI list WO) ────────────────────────────────────────────
@router.get("/work-orders/{wo_id}/bundles-summary")
async def wo_bundles_summary(wo_id: str, request: Request):
    """Ringkasan bundle per WO: total, per-status, per-current-process."""
    await require_auth(request)
    db = get_db()
    wo = await db.rahaza_work_orders.find_one({"id": wo_id}, {"_id": 0})
    if not wo:
        raise HTTPException(404, "WO tidak ditemukan")

    total = await db.rahaza_bundles.count_documents({"work_order_id": wo_id})
    if total == 0:
        return {"total": 0, "by_status": [], "by_process": [], "total_qty": 0}

    pipe_status = [
        {"$match": {"work_order_id": wo_id}},
        {"$group": {"_id": "$status", "count": {"$sum": 1}, "qty": {"$sum": "$qty"}}},
    ]
    by_status = [
        {"status": r["_id"], "count": r["count"], "qty": r["qty"]}
        async for r in db.rahaza_bundles.aggregate(pipe_status)
    ]

    pipe_proc = [
        {"$match": {"work_order_id": wo_id}},
        {"$group": {"_id": {"pid": "$current_process_id", "pcode": "$current_process_code"},
                    "count": {"$sum": 1}, "qty": {"$sum": "$qty"}}},
    ]
    by_process = [
        {"process_id": r["_id"]["pid"], "process_code": r["_id"]["pcode"],
         "count": r["count"], "qty": r["qty"]}
        async for r in db.rahaza_bundles.aggregate(pipe_proc)
    ]

    total_qty_doc = await db.rahaza_bundles.aggregate([
        {"$match": {"work_order_id": wo_id}},
        {"$group": {"_id": None, "total_qty": {"$sum": "$qty"}}}
    ]).to_list(1)
    total_qty = (total_qty_doc[0]["total_qty"] if total_qty_doc else 0)

    return {
        "wo_id": wo_id,
        "wo_number": wo.get("wo_number"),
        "total": total,
        "total_qty": total_qty,
        "wo_qty": int(wo.get("qty") or 0),
        "by_status": by_status,
        "by_process": by_process,
    }
