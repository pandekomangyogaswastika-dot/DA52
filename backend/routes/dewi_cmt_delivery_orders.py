"""
CV. Dewi Aditya — CMT Delivery Orders (DO/Surat Jalan)
Phase 2 Enhancement: DO Issue/Receive System

Purpose:
- Track pengiriman WIP (Work In Progress) dari CV DA ke vendor CMT
- Scan-out WIP dari inventory saat DO issued
- Link DO dengan cutting batches dan CMT jobs
- Generate DO number & surat jalan untuk dokumentasi

Flow:
1. Create DO: Admin pilih cutting batch + CMT partner → generate DO
2. Issue DO: Confirm pengiriman → WIP stock berkurang
3. Receive DO (vendor): Vendor terima barang (via vendor portal atau admin input)
4. Packing/Return: Vendor kirim FG kembali (sudah ada di dewi_cmt_packing)

Collections:
- dewi_cmt_delivery_orders: {do_number, cutting_batch_id, cmt_partner_id, items[], status, issued_at, received_at}
- rahaza_material_stock: Update qty saat DO issued (WIP scan-out)
- dewi_cutting_batches: Link DO via do_ids[]
- dewi_cmt_jobs: Link DO via do_ids[]
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, timezone, date
import uuid
import logging

from database import get_db
from auth import require_auth, serialize_doc, log_activity, check_role

logger = logging.getLogger(__name__)
router = APIRouter(prefix='/api/dewi/cmt/delivery-orders', tags=['Dewi-CMT-DO (DEPRECATED)'])

# ──────────────────────────────────────────────────────────────────────────────
# DEPRECATION NOTICE (P2 Consolidation #12, Session #11.8)
# ──────────────────────────────────────────────────────────────────────────────
# This module's collection `dewi_cmt_delivery_orders` has been superseded by
# `wh_cmt_dispatches` (CMT Dispatching SSOT). Endpoints below remain
# functional for backward compatibility (per TD-008 rule: 1-week monitor
# before deletion), but new integrations should target:
#
#     /api/wms/cmt-dispatches/*  →  wh_cmt_dispatches collection
#
# A migration script is available at:
#     scripts/migrate_shipping_consolidation.py
# ──────────────────────────────────────────────────────────────────────────────
logger.info(
    "[DEPRECATION] /api/dewi/cmt/delivery-orders/* is DEPRECATED — superseded by "
    "/api/wms/cmt-dispatches/* (wh_cmt_dispatches SSOT). See P2 Consolidation #12."
)

def _uid(): return str(uuid.uuid4())
def _now(): return datetime.now(timezone.utc)

# ── Pydantic Models ────────────────────────────────────────────────────────────

class DOItemIn(BaseModel):
    material_id: str = Field(..., description="Material ID dari WIP (rahaza_material_stock)")
    material_name: str = Field(default='', description="Nama material/product")
    qty: int = Field(..., ge=1, description="Qty yang dikirim")
    uom: str = Field(default='pcs', description="Unit of measure")

class DeliveryOrderIn(BaseModel):
    cutting_batch_id: Optional[str] = Field(default='', description="Cutting batch reference")
    cmt_partner_id: str = Field(..., description="CMT Partner/Vendor ID")
    cmt_job_id: Optional[str] = Field(default='', description="CMT Job reference (optional)")
    items: List[DOItemIn] = Field(..., min_items=1, description="Items to deliver")
    delivery_date: Optional[str] = Field(default=None, description="Planned delivery date")
    notes: str = Field(default='', description="Catatan DO")

class IssueDoIn(BaseModel):
    actual_delivery_date: Optional[str] = Field(default=None, description="Actual delivery date")
    driver_name: str = Field(default='', description="Nama driver/kurir")
    vehicle_number: str = Field(default='', description="Nomor kendaraan")
    notes: str = Field(default='', description="Catatan tambahan")

class ReceiveDoIn(BaseModel):
    received_date: Optional[str] = Field(default=None, description="Tanggal terima")
    received_by: str = Field(default='', description="Nama penerima di vendor")
    notes: str = Field(default='', description="Catatan penerimaan")

# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("")
async def list_delivery_orders(
    status: Optional[str] = None,
    cmt_partner_id: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
    user: dict = Depends(require_auth)
):
    """
    List delivery orders dengan filter.
    Status: draft | issued | received | completed | cancelled
    """
    db = get_db()
    
    query = {}
    if status:
        query["status"] = status
    if cmt_partner_id:
        query["cmt_partner_id"] = cmt_partner_id
    
    cursor = db.dewi_cmt_delivery_orders.find(query, {"_id": 0}).sort("created_at", -1).skip(skip).limit(limit)
    dos = [serialize_doc(d) async for d in cursor]
    
    total = await db.dewi_cmt_delivery_orders.count_documents(query)
    
    return {
        "delivery_orders": dos,
        "total": total,
        "skip": skip,
        "limit": limit
    }


@router.get("/{do_id}")
async def get_delivery_order_detail(do_id: str, user: dict = Depends(require_auth)):
    """Get delivery order detail by ID."""
    db = get_db()
    do = await db.dewi_cmt_delivery_orders.find_one({"id": do_id}, {"_id": 0})
    if not do:
        raise HTTPException(404, f"Delivery Order {do_id} tidak ditemukan")
    return serialize_doc(do)


@router.post("")
async def create_delivery_order(payload: DeliveryOrderIn, user: dict = Depends(require_auth)):
    """
    Create new delivery order (status: draft).
    Belum scan-out stock, hanya create record DO.
    """
    if not check_role(user, ['superadmin', 'admin', 'owner'], 'do.create'):
        raise HTTPException(403, 'Tidak ada akses untuk membuat DO')
    
    db = get_db()
    
    # Validate CMT partner
    partner = await db.dewi_cmt_partners.find_one({"id": payload.cmt_partner_id})
    if not partner:
        raise HTTPException(404, f"CMT Partner {payload.cmt_partner_id} tidak ditemukan")
    
    # Generate DO number
    today = date.today()
    count = await db.dewi_cmt_delivery_orders.count_documents({
        "created_at": {"$gte": datetime(today.year, today.month, today.day, tzinfo=timezone.utc)}
    })
    do_number = f"DO-CMT-{today.strftime('%Y%m%d')}-{count+1:04d}"
    
    # Create DO
    do_id = _uid()
    do_doc = {
        "id": do_id,
        "do_number": do_number,
        "cutting_batch_id": payload.cutting_batch_id or None,
        "cmt_partner_id": payload.cmt_partner_id,
        "cmt_partner_name": partner.get("name", ""),
        "cmt_job_id": payload.cmt_job_id or None,
        "items": [item.dict() for item in payload.items],
        "total_qty": sum(item.qty for item in payload.items),
        "status": "draft",
        "delivery_date": payload.delivery_date or today.isoformat(),
        "issued_at": None,
        "received_at": None,
        "notes": payload.notes,
        "created_by": user.get("name", ""),
        "created_at": _now(),
        "updated_at": _now()
    }
    
    await db.dewi_cmt_delivery_orders.insert_one(do_doc)
    
    # Link DO to cutting batch if provided
    if payload.cutting_batch_id:
        await db.dewi_cutting_batches.update_one(
            {"id": payload.cutting_batch_id},
            {"$addToSet": {"do_ids": do_id}, "$set": {"updated_at": _now()}}
        )
    
    # Link DO to CMT job if provided
    if payload.cmt_job_id:
        await db.dewi_cmt_jobs.update_one(
            {"id": payload.cmt_job_id},
            {"$addToSet": {"do_ids": do_id}, "$set": {"updated_at": _now()}}
        )
    
    await log_activity(
        user.get("id", ""),
        user.get("name", ""),
        "create_do",
        "dewi_cmt_delivery_orders",
        f"Create DO {do_number} untuk {partner.get('name')} - {len(payload.items)} items"
    )
    
    return {
        "status": "success",
        "message": f"Delivery Order {do_number} berhasil dibuat",
        "do_id": do_id,
        "do_number": do_number
    }


@router.post("/{do_id}/issue")
async def issue_delivery_order(do_id: str, payload: IssueDoIn, user: dict = Depends(require_auth)):
    """
    Issue delivery order: Confirm pengiriman & scan-out WIP stock.
    Status: draft → issued
    WIP stock berkurang dari rahaza_material_stock.
    """
    if not check_role(user, ['superadmin', 'admin', 'owner'], 'do.issue'):
        raise HTTPException(403, 'Tidak ada akses untuk issue DO')
    
    db = get_db()
    
    # Get DO
    do = await db.dewi_cmt_delivery_orders.find_one({"id": do_id})
    if not do:
        raise HTTPException(404, f"DO {do_id} tidak ditemukan")
    
    if do.get("status") != "draft":
        raise HTTPException(400, f"DO {do.get('do_number')} sudah di-issue (status: {do.get('status')})")
    
    # Scan-out WIP stock
    for item in do.get("items", []):
        material_id = item.get("material_id")
        qty = item.get("qty", 0)
        
        # Find WIP stock
        stock = await db.rahaza_material_stock.find_one({
            "material_id": material_id,
            "inventory_category": "wip_internal"
        })
        
        if not stock:
            raise HTTPException(404, f"WIP stock {material_id} tidak ditemukan")
        
        available = stock.get("available_quantity", 0)
        if available < qty:
            raise HTTPException(400, f"Stock WIP {material_id} tidak cukup. Available: {available}, diminta: {qty}")
        
        # Reduce WIP stock
        await db.rahaza_material_stock.update_one(
            {"id": stock["id"]},
            {
                "$inc": {"quantity": -qty, "available_quantity": -qty},
                "$set": {"updated_at": _now()}
            }
        )
        
        # Log material movement
        await db.rahaza_material_movements.insert_one({
            "id": _uid(),
            "material_id": material_id,
            "movement_type": "OUT",
            "quantity": -qty,
            "location_id": stock.get("location", ""),
            "source_module": "cmt_do",
            "source_ref": do_id,
            "notes": f"DO {do.get('do_number')} issued to {do.get('cmt_partner_name')} - WIP scan-out",
            "created_by": user.get("name", ""),
            "created_at": _now()
        })
    
    # Update DO status
    actual_date = payload.actual_delivery_date or date.today().isoformat()
    await db.dewi_cmt_delivery_orders.update_one(
        {"id": do_id},
        {
            "$set": {
                "status": "issued",
                "issued_at": _now(),
                "actual_delivery_date": actual_date,
                "driver_name": payload.driver_name,
                "vehicle_number": payload.vehicle_number,
                "issued_by": user.get("name", ""),
                "issue_notes": payload.notes,
                "updated_at": _now()
            }
        }
    )
    
    await log_activity(
        user.get("id", ""),
        user.get("name", ""),
        "issue_do",
        "dewi_cmt_delivery_orders",
        f"Issue DO {do.get('do_number')} - WIP scan-out {do.get('total_qty')} items"
    )
    
    return {
        "status": "success",
        "message": f"DO {do.get('do_number')} berhasil di-issue dan WIP stock ter-scan-out"
    }


@router.post("/{do_id}/receive")
async def receive_delivery_order(do_id: str, payload: ReceiveDoIn, user: dict = Depends(require_auth)):
    """
    Receive delivery order: Vendor konfirmasi penerimaan barang.
    Status: issued → received
    """
    db = get_db()
    
    # Get DO
    do = await db.dewi_cmt_delivery_orders.find_one({"id": do_id})
    if not do:
        raise HTTPException(404, f"DO {do_id} tidak ditemukan")
    
    if do.get("status") != "issued":
        raise HTTPException(400, f"DO {do.get('do_number')} belum di-issue atau sudah diterima (status: {do.get('status')})")
    
    # Update DO status
    received_date = payload.received_date or date.today().isoformat()
    await db.dewi_cmt_delivery_orders.update_one(
        {"id": do_id},
        {
            "$set": {
                "status": "received",
                "received_at": _now(),
                "received_date": received_date,
                "received_by": payload.received_by or user.get("name", ""),
                "receive_notes": payload.notes,
                "updated_at": _now()
            }
        }
    )
    
    await log_activity(
        user.get("id", ""),
        user.get("name", ""),
        "receive_do",
        "dewi_cmt_delivery_orders",
        f"Receive DO {do.get('do_number')} by {payload.received_by or user.get('name')}"
    )
    
    return {
        "status": "success",
        "message": f"DO {do.get('do_number')} berhasil diterima oleh vendor"
    }


@router.delete("/{do_id}")
async def cancel_delivery_order(do_id: str, user: dict = Depends(require_auth)):
    """
    Cancel delivery order (hanya bisa cancel jika status = draft).
    Jika sudah issued, tidak bisa cancel (harus reverse manual).
    """
    if not check_role(user, ['superadmin', 'admin', 'owner'], 'do.cancel'):
        raise HTTPException(403, 'Tidak ada akses untuk cancel DO')
    
    db = get_db()
    
    do = await db.dewi_cmt_delivery_orders.find_one({"id": do_id})
    if not do:
        raise HTTPException(404, f"DO {do_id} tidak ditemukan")
    
    if do.get("status") != "draft":
        raise HTTPException(400, f"DO {do.get('do_number')} tidak bisa dicancel (status: {do.get('status')}). Hanya DO draft yang bisa dicancel.")
    
    # Update status to cancelled
    await db.dewi_cmt_delivery_orders.update_one(
        {"id": do_id},
        {"$set": {"status": "cancelled", "cancelled_by": user.get("name", ""), "cancelled_at": _now(), "updated_at": _now()}}
    )
    
    await log_activity(
        user.get("id", ""),
        user.get("name", ""),
        "cancel_do",
        "dewi_cmt_delivery_orders",
        f"Cancel DO {do.get('do_number')}"
    )
    
    return {
        "status": "success",
        "message": f"DO {do.get('do_number')} berhasil dicancel"
    }


@router.get("/summary/stats")
async def get_do_summary(user: dict = Depends(require_auth)):
    """Dashboard summary untuk DO."""
    db = get_db()
    
    draft = await db.dewi_cmt_delivery_orders.count_documents({"status": "draft"})
    issued = await db.dewi_cmt_delivery_orders.count_documents({"status": "issued"})
    received = await db.dewi_cmt_delivery_orders.count_documents({"status": "received"})
    
    return {
        "draft": draft,
        "issued": issued,
        "received": received,
        "total": draft + issued + received
    }


# ── VENDOR PORTAL ENDPOINTS ────────────────────────────────────────────────────

@router.get("/vendor/my-dos")
async def vendor_get_my_delivery_orders(
    status: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
    user: dict = Depends(require_auth)
):
    """
    Vendor CMT Portal: Get delivery orders assigned to this vendor.
    Filter by vendor's cmt_partner_id from JWT token.
    """
    # Check if user is cmt_vendor role
    if user.get("role") != "cmt_vendor":
        raise HTTPException(403, "Endpoint ini hanya untuk vendor CMT")
    
    cmt_partner_id = user.get("cmt_partner_id")
    if not cmt_partner_id:
        raise HTTPException(400, "User tidak terhubung dengan CMT Partner")
    
    db = get_db()
    
    query = {"cmt_partner_id": cmt_partner_id}
    if status:
        query["status"] = status
    
    cursor = db.dewi_cmt_delivery_orders.find(query, {"_id": 0}).sort("created_at", -1).skip(skip).limit(limit)
    dos = [serialize_doc(d) async for d in cursor]
    
    total = await db.dewi_cmt_delivery_orders.count_documents(query)
    
    return {
        "delivery_orders": dos,
        "total": total,
        "skip": skip,
        "limit": limit
    }


@router.get("/vendor/my-dos/{do_id}")
async def vendor_get_do_detail(do_id: str, user: dict = Depends(require_auth)):
    """
    Vendor CMT Portal: Get DO detail (read-only).
    Vendor hanya bisa lihat DO yang assigned ke mereka.
    """
    if user.get("role") != "cmt_vendor":
        raise HTTPException(403, "Endpoint ini hanya untuk vendor CMT")
    
    cmt_partner_id = user.get("cmt_partner_id")
    if not cmt_partner_id:
        raise HTTPException(400, "User tidak terhubung dengan CMT Partner")
    
    db = get_db()
    
    do = await db.dewi_cmt_delivery_orders.find_one({
        "id": do_id,
        "cmt_partner_id": cmt_partner_id
    }, {"_id": 0})
    
    if not do:
        raise HTTPException(404, f"Delivery Order {do_id} tidak ditemukan atau bukan milik vendor Anda")
    
    return serialize_doc(do)


@router.post("/vendor/my-dos/{do_id}/confirm-receipt")
async def vendor_confirm_receipt(do_id: str, payload: ReceiveDoIn, user: dict = Depends(require_auth)):
    """
    Vendor CMT Portal: Confirm receipt of DO.
    Vendor bisa confirm DO yang assigned ke mereka sendiri.
    """
    if user.get("role") != "cmt_vendor":
        raise HTTPException(403, "Endpoint ini hanya untuk vendor CMT")
    
    cmt_partner_id = user.get("cmt_partner_id")
    if not cmt_partner_id:
        raise HTTPException(400, "User tidak terhubung dengan CMT Partner")
    
    db = get_db()
    
    # Get DO and verify ownership
    do = await db.dewi_cmt_delivery_orders.find_one({
        "id": do_id,
        "cmt_partner_id": cmt_partner_id
    })
    
    if not do:
        raise HTTPException(404, f"Delivery Order {do_id} tidak ditemukan atau bukan milik vendor Anda")
    
    if do.get("status") != "issued":
        raise HTTPException(400, f"DO {do.get('do_number')} tidak bisa dikonfirmasi (status: {do.get('status')})")
    
    # Update DO status
    received_date = payload.received_date or date.today().isoformat()
    await db.dewi_cmt_delivery_orders.update_one(
        {"id": do_id},
        {
            "$set": {
                "status": "received",
                "received_at": _now(),
                "received_date": received_date,
                "received_by": payload.received_by or user.get("name", ""),
                "receive_notes": payload.notes,
                "vendor_confirmed": True,
                "updated_at": _now()
            }
        }
    )
    
    await log_activity(
        user.get("id", ""),
        user.get("name", ""),
        "vendor_confirm_receipt",
        "dewi_cmt_delivery_orders",
        f"Vendor confirm receipt DO {do.get('do_number')}"
    )
    
    return {
        "status": "success",
        "message": f"Penerimaan DO {do.get('do_number')} berhasil dikonfirmasi"
    }
