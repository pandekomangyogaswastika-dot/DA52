"""
PT Rahaza ERP — Bundles Module (Phase 17A)

Bundle = batch granular pcs yang berpindah antar-proses sebagai unit traceable.
Bundle dibuat manual dari WO yang released (tombol "Generate Bundles").

Data model:
  bundles = {
    id, bundle_number, work_order_id, wo_number_snapshot,
    model_id, model_code, size_id, size_code,
    qty, qty_pass, qty_fail, qty_remaining,
    status, current_process_id, current_process_code, current_line_id,
    process_sequence: [{id, code, name, order_seq}],
    parent_bundle_id, split_from_qc_event_id,
    history: [{event, by, at, qty, notes}],
    created_at, updated_at, created_by
  }

Endpoints:
  POST /api/rahaza/work-orders/{wo_id}/generate-bundles   → generate bundles
  GET  /api/rahaza/bundles                                → list + filter
  GET  /api/rahaza/bundles/{bid}                          → detail
  GET  /api/rahaza/bundles/by-number/{bundle_number}      → lookup (scan prep)
  DELETE /api/rahaza/bundles/{bid}                        → only if no events
  GET  /api/rahaza/bundles-statuses                       → metadata UI

Status machine (Phase 17A minimal; diperluas di Phase 17C/D):
  created → in_process → qc → {pass, fail} → packed → shipped
  fail    → reworking  → (via split di Phase 17D, back to in_process pada proses tertentu)
  closed  (terminal — ditutup manual atau via WO completion)
"""
from fastapi import APIRouter, Request, HTTPException, Query
from fastapi.responses import Response
from database import get_db
from auth import require_auth, log_activity
from routes.shared import get_pagination_params, paginated_response
from utils.counters import next_counter
from datetime import datetime, timezone, date
from typing import Optional
import math
import uuid
import logging

from utils.qrcode_generator import (
    generate_qr_png,
    render_bundle_ticket_pdf,
    render_bundle_tickets_bulk_pdf,
)
import re

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/rahaza", tags=["Bundles"])


# ─── Utils ───────────────────────────────────────────────────────────────────
def _uid() -> str:
    return str(uuid.uuid4())


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


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


# ─── Generate Bundles dari WO ────────────────────────────────────────────────
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


# ─── QR + Ticket PDF (Phase 17B) ─────────────────────────────────────────────
@router.get("/bundles/{bid}/qr.png")
async def bundle_qr_png(bid: str, request: Request):
    """Raw QR PNG for a bundle (payload = bundle_number).

    Useful for preview thumbnails or embedding elsewhere.
    """
    await require_auth(request)
    db = get_db()
    b = await db.rahaza_bundles.find_one({"id": bid}, {"_id": 0})
    if not b:
        raise HTTPException(404, "Bundle tidak ditemukan")
    png = generate_qr_png(b.get("bundle_number") or bid, box_size=8, border=2)
    return Response(
        content=png,
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=300"},
    )


@router.get("/bundles/{bid}/ticket.pdf")
async def bundle_ticket_pdf(bid: str, request: Request):
    """Printable bundle ticket PDF (A5, 1 page) with QR + metadata + stamp bar."""
    await require_auth(request)
    db = get_db()
    b = await db.rahaza_bundles.find_one({"id": bid}, {"_id": 0})
    if not b:
        raise HTTPException(404, "Bundle tidak ditemukan")
    pdf_bytes = render_bundle_ticket_pdf(b)
    filename = f"bundle-ticket-{b.get('bundle_number') or bid}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{filename}"',
            "Cache-Control": "private, max-age=60",
        },
    )


@router.get("/work-orders/{wo_id}/bundle-tickets.pdf")
async def wo_bundle_tickets_pdf(
    wo_id: str,
    request: Request,
    status: Optional[str] = Query(None, description="Filter by bundle status"),
    limit: int = Query(500, le=2000),
):
    """Bulk-print all bundle tickets of a WO as a single multi-page PDF.

    Optional `status` filter (e.g., only `created` bundles for first-time print).
    """
    user = await _require_admin_or_manager(request)
    db = get_db()
    wo = await db.rahaza_work_orders.find_one({"id": wo_id}, {"_id": 0})
    if not wo:
        raise HTTPException(404, "Work Order tidak ditemukan")

    filt: dict = {"work_order_id": wo_id}
    if status:
        filt["status"] = status

    bundles = await db.rahaza_bundles.find(filt, {"_id": 0}).sort("bundle_number", 1).limit(limit).to_list(500)
    if not bundles:
        raise HTTPException(404, "Tidak ada bundle pada WO ini untuk filter yang diberikan")

    pdf_bytes = render_bundle_tickets_bulk_pdf(bundles)

    # Log bulk print
    await log_activity(
        user.get("id"),
        user.get("name", ""),
        "bulk-print-bundle-tickets",
        "rahaza.work_order",
        wo.get("wo_number"),
    )

    filename = f"bundle-tickets-{wo.get('wo_number') or wo_id}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{filename}"',
            "Cache-Control": "private, max-age=60",
            "X-Total-Bundles": str(len(bundles)),
        },
    )



# ─── Rework Board endpoint (Phase 17E) ───────────────────────────────────────
@router.get("/bundles-rework")
async def list_rework_bundles(
    request: Request,
    work_order_id: Optional[str] = None,
    line_id: Optional[str] = None,
    limit: int = Query(200, le=500),
):
    """List bundles currently in `reworking` status, enriched with:
      - `last_qc_fail_event`: most recent QC fail event (operator, qty, notes, at)
      - `last_qc_fail_at`: iso timestamp
      - `rework_age_minutes`: how long (minutes) since bundle entered reworking status
      - `must_return_process_code` / `must_return_process_name`: resolved from process_sequence

    Also returns top-level aggregates in the response payload.
    """
    await require_auth(request)
    db = get_db()

    filt: dict = {"status": "reworking"}
    if work_order_id:
        filt["work_order_id"] = work_order_id
    if line_id:
        filt["current_line_id"] = line_id

    rows = await db.rahaza_bundles.find(filt, {"_id": 0}).sort("updated_at", 1).limit(limit).to_list(500)
    now_dt = datetime.now(timezone.utc)

    enriched = []
    total_fail_pcs = 0
    oldest_age_min = 0
    for b in rows:
        history = b.get("history") or []
        last_fail = None
        for h in reversed(history):
            if h.get("event") == "qc_fail":
                last_fail = h
                break
        # Resolve must_return_process codes
        mr_pid = b.get("must_return_process")
        mr_code = None
        mr_name = None
        for p in (b.get("process_sequence") or []):
            if p.get("id") == mr_pid:
                mr_code = p.get("code")
                mr_name = p.get("name")
                break
        # Age since last update (approximates rework entry)
        age_min = 0
        try:
            upd = b.get("updated_at")
            if upd:
                d = datetime.fromisoformat(upd.replace("Z", "+00:00"))
                age_min = max(0, int((now_dt - d).total_seconds() // 60))
        except Exception:
            age_min = 0
        oldest_age_min = max(oldest_age_min, age_min)
        total_fail_pcs += int(b.get("qty_fail") or 0)

        enriched.append({
            **b,
            "last_qc_fail_event": last_fail,
            "last_qc_fail_at": (last_fail or {}).get("at"),
            "rework_age_minutes": age_min,
            "must_return_process_code": mr_code,
            "must_return_process_name": mr_name,
        })

    return {
        "items": enriched,
        "total": len(enriched),
        "total_fail_pcs": total_fail_pcs,
        "oldest_rework_minutes": oldest_age_min,
    }



# ─── Scan-Submit (Phase 17C) ─────────────────────────────────────────────────
async def _require_operator_or_above(request: Request):
    """Operator, supervisor, manager, or admin can submit scan output."""
    user = await require_auth(request)
    role = (user.get("role") or "").lower()
    if role in ("admin", "superadmin", "owner", "manager_production", "supervisor", "operator"):
        return user
    perms = user.get("_permissions") or []
    if "*" in perms or "prod.process.input" in perms or "prod.line.manage" in perms:
        return user
    raise HTTPException(403, "Butuh role Operator atau lebih tinggi untuk submit output bundle")


def _find_process_in_sequence(seq, process_id):
    for i, p in enumerate(seq or []):
        if p.get("id") == process_id:
            return i, p
    return -1, None


async def _try_auto_complete_work_order(db, work_order_id: str):
    """
    P1.2: Auto-complete Work Order if all conditions met:
    - All bundles in WO are 'packed' or 'shipped' or 'closed'
    - Sum of bundle qty >= WO qty
    Also auto-updates FG material_stock when WO is completed.
    """
    if not work_order_id:
        return False
    
    wo = await db.rahaza_work_orders.find_one({"id": work_order_id}, {"_id": 0})
    if not wo:
        return False
    
    # Skip if already completed
    if wo.get("status") == "completed":
        return False
    
    # Get all bundles for this WO
    bundles = await db.rahaza_bundles.find({"work_order_id": work_order_id}, {"_id": 0}).to_list(500)
    if not bundles:
        return False
    
    # Check if all bundles are in terminal states
    terminal_states = {"packed", "shipped", "closed"}
    all_terminal = all(b.get("status") in terminal_states for b in bundles)
    if not all_terminal:
        return False
    
    # Check if total qty >= wo qty
    total_qty = sum(b.get("qty", 0) for b in bundles)
    wo_qty = wo.get("qty", 0)
    if total_qty < wo_qty:
        return False
    
    # All conditions met, mark WO as completed
    await db.rahaza_work_orders.update_one(
        {"id": work_order_id},
        {
            "$set": {
                "status": "completed",
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "completed_qty": total_qty,
                "progress_pct": 100,
            }
        }
    )
    logger.info(f"Auto-completed Work Order {wo.get('order_id')} (all bundles packed, {total_qty}/{wo_qty} pcs)")

    # ─── Auto-create PENDING INBOUND (WMS) ────────────────────────────────────
    # Stok FG TIDAK langsung bertambah — menunggu Scan-In oleh gudang.
    model_id = wo.get("model_id")
    size_id  = wo.get("size_id")
    if model_id and size_id and total_qty > 0:
        model_doc = await db.rahaza_models.find_one({"id": model_id}, {"_id": 0})
        size_doc  = await db.rahaza_sizes.find_one({"id": size_id}, {"_id": 0})
        if model_doc and size_doc:
            fg_code = f"FG-{model_doc['code']}-{size_doc['code']}"
            fg_name = f"{model_doc['name']} [{size_doc['code']}]"
            # Ensure FG material master exists (so Scan-In can find it)
            existing = await db.rahaza_materials.find_one({"code": fg_code}, {"_id": 0})
            if not existing:
                mat_id = _uid()
                await db.rahaza_materials.insert_one({
                    "id": mat_id, "code": fg_code, "name": fg_name,
                    "type": "fg", "unit": "pcs", "active": True,
                    "model_id": model_id, "size_id": size_id,
                    "notes": "Auto-created dari WO selesai",
                })
            else:
                mat_id = existing["id"]

            # Delegate to WMS: create pending inbound (stock NOT yet added)
            try:
                from routes.wms_receiving import helper_create_pending_inbound_fg
                is_internal = wo.get("is_internal", False)
                await helper_create_pending_inbound_fg(
                    db,
                    material_id=mat_id,
                    material_code=fg_code,
                    material_name=fg_name,
                    qty=float(total_qty),
                    unit="pcs",
                    source_type="production",
                    source_id=work_order_id,
                    source_ref=wo.get("wo_number", ""),
                    notes=f"WO selesai: {'Internal' if is_internal else 'Customer PO'} — scan-in diperlukan",
                    created_by="production_portal",
                )
                logger.info(f"Pending INBOUND created for {fg_code} ({total_qty} pcs) from WO {wo.get('wo_number')}")
            except Exception as e:
                logger.exception(f"Create pending inbound failed: {e}")
    # ─────────────────────────────────────────────────────────────────────────
    return True


@router.post("/bundles/{bid}/scan-submit")
async def bundle_scan_submit(bid: str, request: Request):
    """
    Unified scan-submit endpoint for bundle workflow (Phase 17C).

    Body (JSON):
      - line_id (required)            : line where work was done
      - process_id (optional)         : defaults to bundle.current_process_id
      - qty (optional, non-QC only)   : qty completed this submit (partial allowed; 1..qty_remaining)
      - qty_pass (optional, QC only)  : qty passed this QC submit
      - qty_fail (optional, QC only)  : qty failed this QC submit
      - defect_code_ids (optional, QC only): list of defect_code IDs when qty_fail > 0 (Phase 21 integration)
      - line_assignment_id (optional) : attach the active assignment (helpful for reporting)
      - notes (optional)

    Behavior
      * Validates bundle exists and is still workable (not closed/shipped).
      * Validates process_id matches bundle.current_process_id.
      * Validates line belongs to that process (line.process_id == process_id).
      * Non-QC: qty 1..qty_remaining; decrement qty_remaining; when it hits 0, advance to
        the next process in process_sequence; status transitions:
          created → in_process (first submit)
          in_process → qc (when next process is QC)
      * QC pass: moves pass qty forward (advance to next process, status in_process);
        when qty_fail > 0, bundle status becomes `reworking` (exact return-step routing
        is handled by Phase 17E; for now we stay on QC step and mark must_return_process).
      * Persists a `rahaza_wip_events` row that includes bundle_id + work_order_id linkage.
      * Appends a `history` entry on the bundle document.

    Returns
      updated bundle + created event id(s).
    """
    user = await _require_operator_or_above(request)
    db = get_db()

    b = await db.rahaza_bundles.find_one({"id": bid}, {"_id": 0})
    if not b:
        raise HTTPException(404, "Bundle tidak ditemukan")
    if b.get("status") in ("closed", "shipped"):
        raise HTTPException(400, f"Bundle sudah {b.get('status')}, tidak bisa input lagi")

    try:
        body = await request.json()
    except Exception:
        body = {}

    line_id = body.get("line_id")
    if not line_id:
        raise HTTPException(400, "line_id wajib diisi")

    # Resolve process_id (default = current_process_id on bundle)
    process_id = body.get("process_id") or b.get("current_process_id")
    if not process_id:
        raise HTTPException(400, "process_id tidak bisa ditentukan (bundle tidak punya current_process)")

    # Must equal bundle's current process (supervisor override: Phase 17E later)
    if process_id != b.get("current_process_id"):
        raise HTTPException(
            400,
            f"Bundle sedang di proses {b.get('current_process_code') or b.get('current_process_id')}, tidak bisa input untuk proses lain",
        )

    # Fetch line + process for validation and downstream context
    line = await db.rahaza_lines.find_one({"id": line_id}, {"_id": 0})
    if not line:
        raise HTTPException(404, "Line tidak ditemukan")
    if line.get("process_id") != process_id:
        raise HTTPException(400, "Line tidak cocok dengan proses yang sedang dikerjakan bundle ini")

    proc = await db.rahaza_processes.find_one({"id": process_id}, {"_id": 0}) or {}
    proc_code = (proc.get("code") or b.get("current_process_code") or "").upper()
    is_qc = proc_code == "QC"

    seq = b.get("process_sequence") or []
    cur_idx, _cur_step = _find_process_in_sequence(seq, process_id)

    qty_remaining = int(b.get("qty_remaining") or 0)
    bundle_qty = int(b.get("qty") or 0)
    qty_pass_total = int(b.get("qty_pass") or 0)
    qty_fail_total = int(b.get("qty_fail") or 0)
    notes = (body.get("notes") or "").strip()
    assignment_id = body.get("line_assignment_id") or None

    created_events = []
    history_entries = []
    advance_to_next = False
    new_status = b.get("status") or "created"
    must_return_process = b.get("must_return_process")

    # Default "next" pointers = current position; may be overridden by rework / advance
    next_process_id = b.get("current_process_id")
    next_process_code = b.get("current_process_code")
    next_process_name = b.get("current_process_name")

    now_dt = datetime.now(timezone.utc)
    user_label = user.get("name") or user.get("email")

    if is_qc:
        qty_pass = int(body.get("qty_pass") or 0)
        qty_fail = int(body.get("qty_fail") or 0)
        defect_code_ids = body.get("defect_code_ids") or []  # P1.1: Phase 21 integration
        if qty_pass < 0 or qty_fail < 0:
            raise HTTPException(400, "qty_pass / qty_fail tidak boleh negatif")
        if qty_pass == 0 and qty_fail == 0:
            raise HTTPException(400, "Isi minimal qty_pass atau qty_fail > 0")
        if qty_pass + qty_fail > qty_remaining:
            raise HTTPException(
                400,
                f"qty_pass + qty_fail ({qty_pass + qty_fail}) melebihi sisa qty di proses QC ({qty_remaining})",
            )

        # Insert QC events (pass / fail separate)
        for q, et in ((qty_pass, "qc_pass"), (qty_fail, "qc_fail")):
            if q <= 0:
                continue
            ev = {
                "id": _uid(),
                "timestamp": now_dt,
                "event_date": now_dt.strftime("%Y-%m-%d"),         # FIX: date string for queries
                "line_id": line_id,
                "process_id": process_id,
                "process_code": proc_code,                          # FIX: code for Pareto reports
                "location_id": line.get("location_id"),
                "model_id": b.get("model_id"),
                "size_id": b.get("size_id"),
                "line_assignment_id": assignment_id,
                "work_order_id": b.get("work_order_id"),
                "bundle_id": b.get("id"),
                "bundle_number": b.get("bundle_number"),
                "event_type": et,
                "qty": q,
                "notes": notes,
                "operator_id": user.get("employee_id") or user.get("id"),  # FIX: for payroll PCS
                "created_by": user.get("id"),
                "created_by_name": user_label,
            }
            # P1.1: Attach defect_code_ids to qc_fail events (Phase 21 integration)
            if et == "qc_fail" and defect_code_ids:
                ev["defect_code_ids"] = defect_code_ids
            await db.rahaza_wip_events.insert_one(ev)
            ev.pop("_id", None)
            ev["timestamp"] = now_dt.isoformat()
            created_events.append(ev)
            history_entries.append({
                "event": et,
                "by": user_label,
                "by_id": user.get("id"),
                "at": _now(),
                "qty": q,
                "line_id": line_id,
                "line_code": line.get("code"),
                "process_id": process_id,
                "process_code": proc_code,
                "notes": notes,
            })

        # ─── Phase 17E semantics ─────────────────────────────────────────────
        # Detect re-QC (we're re-inspecting previously failed pcs after a rework cycle).
        # Heuristic: bundle had outstanding qty_fail BEFORE this submit, and prior status was 'qc'
        # after a reworking → sewing → qc transition. Simplest detection: prior_status != 'created'
        # and existing qty_fail_total > 0 at entry means this submit consumes outstanding fail.
        prior_outstanding_fail = qty_fail_total  # snapshot before mutating
        is_requc = prior_outstanding_fail > 0

        if is_requc:
            # Passes in re-QC recover previously failed pcs; new fails add to outstanding.
            recovered = min(qty_pass, prior_outstanding_fail)
            qty_pass_total += qty_pass
            qty_fail_total = max(0, prior_outstanding_fail - recovered) + qty_fail
        else:
            # First-time QC for this batch: normal accumulation.
            qty_pass_total += qty_pass
            qty_fail_total += qty_fail

        qty_remaining -= (qty_pass + qty_fail)

        # Determine must_return_process (QC for new rework flow, cached for future cycles)
        if not must_return_process:
            target_return = None
            for p in seq:
                if (p.get("code") or "").upper() == "QC":
                    target_return = p
                    break
            if target_return is None and cur_idx > 0:
                target_return = seq[cur_idx - 1]
            if target_return is not None:
                must_return_process = target_return.get("id")

        # ─── Rework cycle trigger ────────────────────────────────────────────
        # Only route to rework when QC is complete for this batch (qty_remaining == 0)
        # AND there's outstanding fail. Partial QC submits stay at QC until done.
        if qty_remaining <= 0 and qty_fail_total > 0 and must_return_process:
            # Route to REWORK process (not back to Sewing/Washer/Sontek)
            # REWORK is not in main sequence (is_rework=True), so fetch from DB
            rework_proc = await db.rahaza_processes.find_one(
                {"code": "REWORK", "is_rework": True, "active": {"$ne": False}},
                {"_id": 0}
            )
            if rework_proc:
                next_process_id = rework_proc.get("id")
                next_process_code = rework_proc.get("code")
                next_process_name = rework_proc.get("name")
                qty_remaining = qty_fail_total  # only fail pcs need rework
                new_status = "reworking"
                history_entries.append({
                    "event": "rework",
                    "by": user_label,
                    "by_id": user.get("id"),
                    "at": _now(),
                    "qty": qty_fail_total,
                    "from_process_code": proc_code,
                    "to_process_code": next_process_code,
                    "notes": f"{qty_fail_total} pcs masih fail — bundle dikirim ke {next_process_code} untuk perbaikan",
                })
                advance_to_next = False
                qc_rework_handled = True
            else:
                # Fallback: if REWORK not found, stay at QC with error logged
                import logging
                logging.getLogger(__name__).error("REWORK process not found in database; cannot route QC fail")
                qc_rework_handled = False
        else:
            qc_rework_handled = False

        # All remaining items passed QC (outstanding fail resolved + qty_remaining = 0)
        if qty_remaining <= 0 and qty_fail_total == 0 and not qc_rework_handled:
            advance_to_next = True
            new_status = "in_process"

    else:
        qty = int(body.get("qty") or 0)
        if qty <= 0:
            raise HTTPException(400, "qty harus > 0")
        if qty > qty_remaining:
            raise HTTPException(
                400,
                f"qty ({qty}) melebihi sisa qty di proses {proc_code} ({qty_remaining}). Gunakan partial submit atau cek data bundle.",
            )

        ev = {
            "id": _uid(),
            "timestamp": now_dt,
            "event_date": now_dt.strftime("%Y-%m-%d"),         # FIX: date string for queries
            "line_id": line_id,
            "process_id": process_id,
            "process_code": proc_code,                          # FIX: for Pareto reports
            "location_id": line.get("location_id"),
            "model_id": b.get("model_id"),
            "size_id": b.get("size_id"),
            "line_assignment_id": assignment_id,
            "work_order_id": b.get("work_order_id"),
            "bundle_id": b.get("id"),
            "bundle_number": b.get("bundle_number"),
            "event_type": "output",
            "qty": qty,
            "notes": notes,
            "operator_id": user.get("employee_id") or user.get("id"),  # FIX: for payroll PCS
            "created_by": user.get("id"),
            "created_by_name": user_label,
        }
        await db.rahaza_wip_events.insert_one(ev)
        ev.pop("_id", None)
        ev["timestamp"] = now_dt.isoformat()
        created_events.append(ev)
        history_entries.append({
            "event": "output",
            "by": user_label,
            "by_id": user.get("id"),
            "at": _now(),
            "qty": qty,
            "line_id": line_id,
            "line_code": line.get("code"),
            "process_id": process_id,
            "process_code": proc_code,
            "notes": notes,
        })

        qty_remaining -= qty

        if qty_remaining <= 0:
            advance_to_next = True

        # Status rule: if bundle is in rework cycle and we're at must_return_process,
        # keep 'reworking' until advance kicks in (we transition to 'qc' when advancing back).
        if new_status == "created":
            new_status = "in_process"

    # Advance to next process if applicable
    if advance_to_next:
        # Special handling for REWORK process (not in main sequence)
        is_rework_process = (proc_code or "").upper() == "REWORK"
        
        if is_rework_process:
            # From REWORK, always return to must_return_process (QC)
            if must_return_process:
                target_step = next((p for p in seq if p.get("id") == must_return_process), None)
                if target_step:
                    next_process_id = target_step.get("id")
                    next_process_code = target_step.get("code")
                    next_process_name = target_step.get("name")
                    qty_remaining = qty_fail_total  # pcs to re-QC
                    new_status = "qc"
                    history_entries.append({
                        "event": "advance",
                        "by": user_label,
                        "by_id": user.get("id"),
                        "at": _now(),
                        "qty": None,
                        "from_process_code": proc_code,
                        "to_process_code": next_process_code,
                        "notes": f"Rework selesai — kembali ke {next_process_code} untuk re-inspeksi",
                    })
        elif cur_idx >= 0 and cur_idx + 1 < len(seq):
            nxt = seq[cur_idx + 1]
            next_process_id = nxt.get("id")
            next_process_code = nxt.get("code")
            next_process_name = nxt.get("name")

            # Normal advance: available qty = bundle_qty minus outstanding fail.
            qty_remaining = max(0, bundle_qty - qty_fail_total)
            if (next_process_code or "").upper() == "QC":
                new_status = "qc"
            elif new_status != "reworking":
                new_status = "in_process"

            history_entries.append({
                "event": "advance",
                "by": user_label,
                "by_id": user.get("id"),
                "at": _now(),
                "qty": None,
                "from_process_code": proc_code,
                "to_process_code": next_process_code,
                "notes": f"Auto-advance ke proses {next_process_code}",
            })
        else:
            # End of sequence → packed (per status defs) if no fails pending
            if new_status != "reworking" and qty_fail_total == 0:
                new_status = "packed"
            history_entries.append({
                "event": "packed" if new_status == "packed" else "advance",
                "by": user_label,
                "by_id": user.get("id"),
                "at": _now(),
                "qty": None,
                "notes": "Bundle menyelesaikan semua proses" if new_status == "packed" else "End of sequence (status: " + new_status + ")",
            })

    update_doc = {
        "qty_pass": qty_pass_total,
        "qty_fail": qty_fail_total,
        "qty_remaining": max(0, qty_remaining),
        "status": new_status,
        "current_process_id": next_process_id,
        "current_process_code": next_process_code,
        "current_process_name": next_process_name,
        "current_line_id": line_id,
        "updated_at": _now(),
    }
    if must_return_process:
        update_doc["must_return_process"] = must_return_process

    await db.rahaza_bundles.update_one(
        {"id": bid},
        {
            "$set": update_doc,
            "$push": {"history": {"$each": history_entries}},
        },
    )

    # P1.2: Try auto-complete WO if this bundle just became packed
    if new_status == "packed":
        await _try_auto_complete_work_order(db, b.get("work_order_id"))

    # Log
    await log_activity(
        user.get("id"),
        user.get("name", ""),
        "scan-submit",
        "rahaza.bundle",
        b.get("bundle_number"),
    )

    updated = await db.rahaza_bundles.find_one({"id": bid}, {"_id": 0})
    return {
        "ok": True,
        "bundle": updated,
        "events": created_events,
        "advanced": advance_to_next,
    }

