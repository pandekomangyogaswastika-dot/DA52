"""
WMS — Enhanced Stock Opname (P1-WH-2)  ★ SSOT (P3 TD-008 — Session #11.9)
Upgrade dari wms_opname.py dengan:
  - Mode: full_count | cycle_count (by zone/rack)
  - Variance approval workflow
  - Count sheet PDF export
  - Scheduled opname support

Status: **CANONICAL SSOT** for stock opname operations. Absorbs:
  - GEN1 legacy: warehouse_opname (deprecated, migrated via
    /app/backend/migrations/migrate_opname_consolidation.py)
  - GEN2 scanner: wh_opname_sessions + wh_opname_lines
    (deprecated routes: /api/wms/opname/*)
  - Accessory opname: /api/acc/opname/* (Session #7) — uses
    same backing collection wh_opname_sessions2 with domain='accessory'.

Prefix: /api/wms/opname2

Collections:
  wh_opname_sessions2:
    id, session_no, mode, scope_type (all|building|zone|rack),
    scope_id, scope_label, status (open|counted|pending_approval|approved|cancelled),
    domain (warehouse|warehouse_scan|warehouse_legacy|accessory),
    count_items: [{position_barcode, material_code, material_name, system_qty,
                   counted_qty, variance, variance_pct, unit, notes}],
    total_items, total_variance_items, total_variance_value,
    created_by, counted_by, approved_by, approved_at, closed_at,
    [migrated_from, original_id, migrated_at — for migrated docs]
"""
import uuid
import io
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException, Request, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from database import get_db
from auth import require_auth, serialize_doc
import logging

try:
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    REPORTLAB_OK = True
except ImportError:
    REPORTLAB_OK = False

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/wms/opname2", tags=["wms-opname2"])


def _now(): return datetime.now(timezone.utc)
def _id(): return str(uuid.uuid4())


class StartOpnameIn(BaseModel):
    mode: str = Field("cycle_count", pattern="^(full_count|cycle_count)$")
    scope_type: str = Field("all", pattern="^(all|building|zone|rack)$")
    scope_id: str = ""          # building_id, zone_id, or rack_id
    scope_label: str = ""       # display name
    notes: str = ""
    blind_mode: bool = False    # Task 2.3: sembunyikan system_qty saat pencacahan


class ScanCountIn(BaseModel):
    position_barcode: str = ""
    position_id: str = ""
    counted_qty: float = Field(..., ge=0)
    material_code: str = ""
    notes: str = ""
    # NEW: Pack counter support
    pack_scan_count: Optional[int] = None  # Berapa kali scan (berapa pack)
    use_pack_mode: bool = False  # True jika pakai pack counter


class ApproveIn(BaseModel):
    notes: str = ""
    apply_adjustments: bool = True  # auto-create stock adjustments


async def _next_session_no(db) -> str:
    prefix = f"OPN/{_now().strftime('%Y/%m')}/"
    count = await db.wh_opname_sessions2.count_documents({"session_no": {"$regex": f"^{prefix}"}})
    return f"{prefix}{count + 1:04d}"


async def _load_scope_positions(db, scope_type: str, scope_id: str) -> list:
    """Load positions from WMS structure based on scope."""
    q = {}
    if scope_type == "building" and scope_id:
        q["building_id"] = scope_id
    elif scope_type == "zone" and scope_id:
        q["zone_id"] = scope_id
    elif scope_type == "rack" and scope_id:
        q["rack_id"] = scope_id
    positions = await db.wh_positions.find(q, {"_id": 0}).to_list(2000)
    return positions


@router.get("")
async def list_sessions(
    request: Request,
    status: Optional[str] = None,
    search: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
):
    await require_auth(request)
    db = get_db()
    # Exclude accessory-domain sessions (those are owned by /api/acc/opname/*).
    # Match warehouse-domain (no domain field OR domain != 'accessory') only.
    q = {"$or": [{"domain": {"$exists": False}}, {"domain": {"$ne": "accessory"}}]}
    if status:
        q["status"] = status
    if search:
        # Search by session_no or scope_label
        q["$and"] = [
            q.pop("$or"),
            {"$or": [
                {"session_no": {"$regex": search, "$options": "i"}},
                {"scope_label": {"$regex": search, "$options": "i"}},
            ]},
        ]
    total = await db.wh_opname_sessions2.count_documents(q)
    skip = (page - 1) * limit
    items = await db.wh_opname_sessions2.find(q, {"_id": 0}).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    return {
        "items": [serialize_doc(s) for s in items],
        "pagination": {"page": page, "limit": limit, "total": total,
                       "total_pages": max(1, (total + limit - 1) // limit)}
    }


# P3 TD-008 (Session #11.9): KPI/stats endpoint for WMSOpnameEnhancedModule.jsx.
# Returns aggregated counts across status buckets so the UI can render the
# stats strip without doing a separate roundtrip for each filter.
@router.get("/stats")
async def opname_stats(request: Request):
    """Aggregated opname KPIs for warehouse-domain sessions only."""
    await require_auth(request)
    db = get_db()
    base_filter = {"$or": [
        {"domain": {"$exists": False}},
        {"domain": {"$ne": "accessory"}},
    ]}

    pipeline = [
        {"$match": base_filter},
        {"$group": {
            "_id": "$status",
            "count": {"$sum": 1},
            "total_variance_items": {"$sum": {"$ifNull": ["$total_variance_items", 0]}},
        }}
    ]
    rows = await db.wh_opname_sessions2.aggregate(pipeline).to_list(20)

    by_status = {row["_id"] or "unknown": row for row in rows}
    total_sessions = sum(r["count"] for r in rows)
    total_variances = sum(r["total_variance_items"] for r in rows)

    return {
        "total_sessions": total_sessions,
        "total_variances": total_variances,
        "by_status": {
            "open":              by_status.get("open", {}).get("count", 0),
            "counted":           by_status.get("counted", {}).get("count", 0),
            "pending_approval":  by_status.get("pending_approval", {}).get("count", 0),
            "approved":          by_status.get("approved", {}).get("count", 0),
            "cancelled":         by_status.get("cancelled", {}).get("count", 0),
        },
        "active_count": by_status.get("open", {}).get("count", 0)
                         + by_status.get("counted", {}).get("count", 0)
                         + by_status.get("pending_approval", {}).get("count", 0),
        "approved_count":  by_status.get("approved", {}).get("count", 0),
        "cancelled_count": by_status.get("cancelled", {}).get("count", 0),
    }


@router.post("/start")
async def start_opname(data: StartOpnameIn, request: Request):
    user = await require_auth(request)
    db = get_db()
    # Check for open WAREHOUSE session (exclude accessory-domain sessions)
    open_count = await db.wh_opname_sessions2.count_documents({
        "status": "open",
        "$or": [{"domain": {"$exists": False}}, {"domain": {"$ne": "accessory"}}],
    })
    if open_count > 0:
        raise HTTPException(400, "Ada sesi opname yang masih open. Selesaikan atau batalkan dahulu.")
    positions = await _load_scope_positions(db, data.scope_type, data.scope_id)
    session_id = _id()
    session_no = await _next_session_no(db)
    # Build count items from positions
    count_items = []
    for pos in positions:
        count_items.append({
            "position_id": pos.get("id"),
            "position_barcode": pos.get("barcode", ""),
            "material_code": pos.get("material_code", ""),
            "material_name": pos.get("material_name", ""),
            "system_qty": float(pos.get("qty", 0)),
            "counted_qty": None,  # not yet counted
            "variance": None,
            "variance_pct": None,
            "unit": pos.get("unit", "pcs"),
            "notes": "",
            "counted": False,
        })
    session = {
        "id": session_id,
        "session_no": session_no,
        "mode": data.mode,
        "blind_mode": data.blind_mode,
        "scope_type": data.scope_type,
        "scope_id": data.scope_id,
        "scope_label": data.scope_label or data.scope_type,
        "status": "open",
        "count_items": count_items,
        "total_items": len(count_items),
        "counted_items": 0,
        "total_variance_items": 0,
        "total_variance_value": 0.0,
        "notes": data.notes,
        "created_at": _now(),
        "created_by": user.get("name", user["id"]),
        "counted_by": None,
        "approved_by": None,
        "approved_at": None,
        "closed_at": None,
    }
    await db.wh_opname_sessions2.insert_one(session)
    out = await db.wh_opname_sessions2.find_one({"id": session_id}, {"_id": 0})
    return {"ok": True, "session": serialize_doc(out)}


@router.get("/{session_id}")
async def get_session(session_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    s = await db.wh_opname_sessions2.find_one({"id": session_id}, {"_id": 0})
    if not s:
        raise HTTPException(404, "Sesi tidak ditemukan")
    result = serialize_doc(s)
    # Task 2.3 blind_mode: sembunyikan system_qty ketika sesi masih open
    if result.get("blind_mode") and result.get("status") == "open":
        for item in result.get("count_items", []):
            item["system_qty"] = None   # disembunyikan selama sesi belum selesai
    return result


@router.post("/{session_id}/scan")
async def scan_count(session_id: str, data: ScanCountIn, request: Request):
    await require_auth(request)
    db = get_db()
    s = await db.wh_opname_sessions2.find_one({"id": session_id})
    if not s:
        raise HTTPException(404, "Sesi tidak ditemukan")
    if s["status"] not in ("open",):
        raise HTTPException(400, "Sesi tidak dalam status open")
    
    # NEW: Pack mode conversion
    final_counted_qty = data.counted_qty
    pack_info = {}
    if data.use_pack_mode and data.pack_scan_count is not None:
        # Get material info for pack_size
        mat = await db.rahaza_materials.find_one({"code": data.material_code}, {"_id": 0})
        if mat and mat.get("pack_size"):
            pack_size = float(mat.get("pack_size", 1))
            final_counted_qty = data.pack_scan_count * pack_size
            pack_info = {
                "pack_scan_count": data.pack_scan_count,
                "pack_size": pack_size,
                "pack_unit": mat.get("pack_unit", "pack"),
            }
            log.info(f"Opname pack mode: {data.pack_scan_count} {pack_info['pack_unit']} × {pack_size} = {final_counted_qty}")
    
    items = s.get("count_items", [])
    updated = False
    for item in items:
        if (item.get("position_barcode") == data.position_barcode or
                item.get("position_id") == data.position_id or
                item.get("material_code") == data.material_code):
            item["counted_qty"] = final_counted_qty
            item["variance"] = final_counted_qty - item.get("system_qty", 0)
            item["variance_pct"] = (
                (item["variance"] / item["system_qty"] * 100) if item.get("system_qty", 0) > 0
                else (100.0 if final_counted_qty > 0 else 0.0)
            )
            item["notes"] = data.notes
            item["counted"] = True
            # NEW: Store pack info if applicable
            if pack_info:
                item["pack_info"] = pack_info
            updated = True
            break
    if not updated:
        # Add as new item (position not in original scope)
        new_item = {
            "position_barcode": data.position_barcode,
            "material_code": data.material_code,
            "material_name": "",
            "system_qty": 0,
            "counted_qty": final_counted_qty,
            "variance": final_counted_qty,
            "variance_pct": 100.0,
            "notes": data.notes,
            "counted": True,
        }
        if pack_info:
            new_item["pack_info"] = pack_info
        items.append(new_item)
    counted_items = sum(1 for i in items if i.get("counted"))
    variance_items = sum(1 for i in items if i.get("counted") and (i.get("variance", 0) or 0) != 0)
    await db.wh_opname_sessions2.update_one({"id": session_id}, {"$set": {
        "count_items": items,
        "counted_items": counted_items,
        "total_variance_items": variance_items,
    }})
    return {"ok": True, "counted_items": counted_items, "total_items": s["total_items"], "pack_info": pack_info if pack_info else None}


@router.post("/{session_id}/submit")
async def submit_for_approval(session_id: str, request: Request, body: dict = {}):
    """Submit completed count for supervisor approval."""
    user = await require_auth(request)
    db = get_db()
    s = await db.wh_opname_sessions2.find_one({"id": session_id})
    if not s:
        raise HTTPException(404, "Sesi tidak ditemukan")
    if s["status"] != "open":
        raise HTTPException(400, "Hanya sesi open yang dapat di-submit")
    items = s.get("count_items", [])
    if not any(i.get("counted") for i in items):
        raise HTTPException(400, "Minimal 1 item harus di-count")
    variance_val = sum(
        abs(i.get("variance", 0) or 0) * 1 for i in items if i.get("counted")
    )
    await db.wh_opname_sessions2.update_one({"id": session_id}, {"$set": {
        "status": "pending_approval",
        "total_variance_value": variance_val,
        "counted_by": user.get("name", user["id"]),
        "submitted_at": _now(),
    }})
    return {"ok": True, "pending_approval": True}


@router.post("/{session_id}/approve")
async def approve_opname(session_id: str, data: ApproveIn, request: Request):
    """Supervisor approves opname and optionally applies adjustments."""
    user = await require_auth(request)
    db = get_db()
    s = await db.wh_opname_sessions2.find_one({"id": session_id})
    if not s:
        raise HTTPException(404, "Sesi tidak ditemukan")
    if s["status"] != "pending_approval":
        raise HTTPException(400, "Hanya sesi pending_approval yang dapat disetujui")
    if data.apply_adjustments:
        # Apply adjustments: update wh_positions qty to counted_qty
        for item in s.get("count_items", []):
            if not item.get("counted"):
                continue
            variance = item.get("variance", 0) or 0
            if variance == 0:
                continue
            pos_id = item.get("position_id")
            pos_barcode = item.get("position_barcode")
            q = {}
            if pos_id:
                q["id"] = pos_id
            elif pos_barcode:
                q["barcode"] = pos_barcode
            if q:
                await db.wh_positions.update_one(q, {"$set": {
                    "qty": item["counted_qty"],
                    "last_updated": _now(),
                }})
                # Log to wh_fg_movements for audit
                try:
                    mov = {
                        "id": str(uuid.uuid4()),
                        "source": "opname_adjustment",
                        "position_barcode": pos_barcode or "",
                        "material_code": item.get("material_code", ""),
                        "material_name": item.get("material_name", ""),
                        "qty": variance,
                        "system_qty": item.get("system_qty", 0),
                        "counted_qty": item["counted_qty"],
                        "session_id": session_id,
                        "session_no": s.get("session_no", ""),
                        "notes": f"Opname approval by {user.get('name', '')}: variance {variance:+.2f}",
                        "created_at": _now(),
                        "created_by": user.get("name", user["id"]),
                    }
                    await db.wh_fg_movements.insert_one(mov)
                except Exception as e:
                    log.warning(f"Could not write opname movement: {e}")
    await db.wh_opname_sessions2.update_one({"id": session_id}, {"$set": {
        "status": "approved",
        "approved_by": user.get("name", user["id"]),
        "approved_at": _now(),
        "closed_at": _now(),
        "approval_notes": data.notes,
    }})
    return {"ok": True, "adjustments_applied": data.apply_adjustments}


@router.post("/{session_id}/cancel")
async def cancel_opname(session_id: str, request: Request, body: dict = {}):
    await require_auth(request)
    db = get_db()
    s = await db.wh_opname_sessions2.find_one({"id": session_id})
    if not s:
        raise HTTPException(404, "Sesi tidak ditemukan")
    if s["status"] == "approved":
        raise HTTPException(400, "Tidak dapat membatalkan sesi yang sudah approved")
    await db.wh_opname_sessions2.update_one({"id": session_id}, {"$set": {
        "status": "cancelled", "cancel_reason": body.get("reason", ""),
        "closed_at": _now(),
    }})
    return {"ok": True}


@router.get("/{session_id}/count-sheet-pdf")
async def count_sheet_pdf(session_id: str, request: Request, token: Optional[str] = None):
    from auth import verify_token_str
    if token:
        user = verify_token_str(token)
        if not user:
            raise HTTPException(401, "Invalid token")
    else:
        user = await require_auth(request)
    db = get_db()
    s = await db.wh_opname_sessions2.find_one({"id": session_id}, {"_id": 0})
    if not s:
        raise HTTPException(404, "Sesi tidak ditemukan")
    if not REPORTLAB_OK:
        raise HTTPException(500, "ReportLab tidak tersedia")
    buf = io.BytesIO()
    W, H = A4
    c = canvas.Canvas(buf, pagesize=A4)
    # Header
    c.setFont("Helvetica-Bold", 12)
    c.drawString(15 * mm, H - 15 * mm, "LEMBAR HITUNG OPNAME STOK")
    c.setFont("Helvetica", 8)
    c.drawString(15 * mm, H - 22 * mm, f"Sesi: {s.get('session_no', '')}  |  Scope: {s.get('scope_label', s.get('scope_type', ''))}  |  Mode: {s.get('mode', '')}")
    c.drawString(15 * mm, H - 27 * mm, f"Tanggal: {_now().strftime('%d/%m/%Y')}  |  Status: {s.get('status', '')}")
    # Table header
    y = H - 35 * mm
    c.setFont("Helvetica-Bold", 7)
    c.drawString(15 * mm, y, "No")
    c.drawString(22 * mm, y, "Posisi / Barcode")
    c.drawString(75 * mm, y, "Kode Material")
    c.drawString(115 * mm, y, "Nama Material")
    c.drawString(160 * mm, y, "Sistem")
    c.drawString(175 * mm, y, "Hitung Fisik")
    y -= 4 * mm
    c.setStrokeGray(0.5)
    c.line(15 * mm, y, W - 15 * mm, y)
    y -= 5 * mm
    c.setFont("Helvetica", 7)
    for i, item in enumerate(s.get("count_items", [])):
        if y < 20 * mm:
            c.showPage()
            y = H - 20 * mm
            c.setFont("Helvetica", 7)
        c.drawString(15 * mm, y, str(i + 1))
        c.drawString(22 * mm, y, str(item.get("position_barcode", ""))[:25])
        c.drawString(75 * mm, y, str(item.get("material_code", ""))[:20])
        c.drawString(115 * mm, y, str(item.get("material_name", ""))[:25])
        c.drawRightString(170 * mm, y, f"{item.get('system_qty', 0):,.1f}")
        # Empty box for physical count
        c.rect(175 * mm, y - 1 * mm, 18 * mm, 5 * mm)
        y -= 6 * mm
    c.setFont("Helvetica-Oblique", 7)
    c.drawString(15 * mm, 15 * mm, f"CV. Dewi Aditya | Dicetak: {_now().strftime('%d/%m/%Y %H:%M')} | Petugas: ___________________")
    c.save()
    buf.seek(0)
    return StreamingResponse(
        buf, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="count-sheet-{s.get("session_no", session_id).replace("/", "-")}.pdf"'},
    )
