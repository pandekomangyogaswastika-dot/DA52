"""
Rahaza Bundles - Documents
QR PNG, ticket PDF, bulk tickets PDF

Bundle = batch granular pcs yang berpindah antar-proses sebagai unit traceable.
Bundle dibuat manual dari WO yang released.
"""
from fastapi import APIRouter, Request, HTTPException, Query
from fastapi.responses import Response
from database import get_db
from auth import require_auth, log_activity
from typing import Optional
import logging

from utils.qrcode_generator import (
    generate_qr_png,
    render_bundle_ticket_pdf,
    render_bundle_tickets_bulk_pdf,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["bundles-docs"])

async def _require_admin_or_manager(request: Request):
    user = await require_auth(request)
    role = (user.get("role") or "").lower()
    if role not in ("admin", "superadmin", "owner", "manager_production", "supervisor"):
        raise HTTPException(403, "Only admin/manager/supervisor can perform this action")
    return user

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