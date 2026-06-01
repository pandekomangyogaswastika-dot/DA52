"""
PT Rahaza — Sprint 2.1: Purchase Order (PO) Module

Endpoints (prefix /api/rahaza):
  - GET  /purchase-orders?status=&vendor=&date_from=&date_to=
  - GET  /purchase-orders/{po_id}
  - POST /purchase-orders            → create draft PO
  - PUT  /purchase-orders/{po_id}    → update draft PO
  - POST /purchase-orders/{po_id}/submit     → submit for approval
  - POST /purchase-orders/{po_id}/approve    → approve PO (single-step default)
  - POST /purchase-orders/{po_id}/reject     → reject PO
  - POST /purchase-orders/{po_id}/cancel     → cancel PO (before received)
  - DELETE /purchase-orders/{po_id}          → delete draft PO

Status flow:
  draft → pending_approval → approved → (partially_received | fully_received)
  draft → rejected (bisa re-submit)
  any → cancelled

Sprint 2.1 Goal:
  - Receiving (GR) wajib referensi ke PO valid untuk 3-way matching
  - Approval workflow configurable (default: single-step manager approval)
"""
from fastapi import APIRouter, Request, HTTPException
from database import get_db
from auth import require_auth, serialize_doc, log_activity
from utils.counters import next_counter
import uuid
import logging
from datetime import datetime, timezone, date
from typing import Optional
import re

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/rahaza", tags=["rahaza-po"])


def _uid(): return str(uuid.uuid4())
def _now(): return datetime.now(timezone.utc)


PO_STATUSES = ["draft", "pending_approval", "approved", "partially_received", "fully_received", "rejected", "cancelled"]


async def _require_admin(request: Request):
    """Require admin, warehouse, purchasing, manager, or owner role."""
    user = await require_auth(request)
    role = (user.get("role") or "").lower()
    if role in ("superadmin", "admin", "owner", "manager"):
        return user
    perms = user.get("_permissions") or []
    if "*" in perms or "purchasing.manage" in perms or "warehouse.manage" in perms:
        return user
    raise HTTPException(403, "Forbidden: butuh permission purchasing / warehouse / manager.")


async def _require_approver(request: Request):
    """Require manager, owner, or superadmin for approval."""
    user = await require_auth(request)
    role = (user.get("role") or "").lower()
    if role in ("superadmin", "owner", "manager", "production_manager", "warehouse_manager"):
        return user
    perms = user.get("_permissions") or []
    if "*" in perms or "purchasing.approve" in perms:
        return user
    raise HTTPException(403, "Forbidden: hanya Manager/Owner yang boleh approve PO.")


async def _gen_po_number(db) -> str:
    """Generate atomic PO number: PO-YYYYMMDD-001 via unified counters SSOT."""
    today = date.today().strftime("%Y%m%d")
    seq = await next_counter(db, f"po_number_{today}", namespace="rahaza")
    return f"PO-{today}-{seq:03d}"


async def _enrich_po(db, po):
    """Enrich PO dengan material names & vendor info."""
    if not po:
        return po
    
    # Material names
    m_ids = list({it["material_id"] for it in (po.get("items") or []) if it.get("material_id")})
    mats = await db.rahaza_materials.find({"id": {"$in": m_ids}}, {"_id": 0}).to_list(500) if m_ids else []
    m_map = {m["id"]: m for m in mats}
    
    for it in (po.get("items") or []):
        m = m_map.get(it.get("material_id")) or {}
        it["material_code"] = m.get("code")
        it["material_name"] = m.get("name")
        it["material_type"] = m.get("type")
        it["unit"] = m.get("unit")
    
    return po


def _norm_po_items(raw_items):
    """Normalize and validate PO items."""
    cleaned = []
    for it in raw_items or []:
        mid = it.get("material_id")
        qty = float(it.get("qty_ordered") or 0)
        unit_cost = float(it.get("unit_cost") or 0)
        if not mid or qty <= 0:
            continue
        cleaned.append({
            "id": it.get("id") or _uid(),
            "material_id": mid,
            "qty_ordered": round(qty, 4),
            "qty_received": round(float(it.get("qty_received") or 0), 4),
            "unit_cost": round(unit_cost, 2),
            "notes": it.get("notes") or "",
        })
    return cleaned


# ── PO CRUD ────────────────────────────────────────────────────────────────────

@router.get("/purchase-orders")
async def list_pos(
    request: Request,
    status: Optional[str] = None,
    vendor: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    await require_auth(request)
    db = get_db()
    q = {}
    if status:
        if status not in PO_STATUSES:
            raise HTTPException(400, f"Status harus salah satu: {PO_STATUSES}")
        q["status"] = status
    if vendor:
        q["vendor_name"] = {"$regex": re.escape(vendor), "$options": "i"}
    if date_from:
        q["po_date"] = q.get("po_date", {})
        q["po_date"]["$gte"] = date_from
    if date_to:
        q["po_date"] = q.get("po_date", {})
        q["po_date"]["$lte"] = date_to
    
    rows = await db.rahaza_purchase_orders.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    for po in rows:
        await _enrich_po(db, po)
        po["item_count"] = len(po.get("items") or [])
        po["total_value"] = round(sum(float(i.get("qty_ordered") or 0) * float(i.get("unit_cost") or 0) for i in (po.get("items") or [])), 2)
        po["total_received"] = round(sum(float(i.get("qty_received") or 0) for i in (po.get("items") or [])), 4)
    return serialize_doc(rows)


@router.get("/purchase-orders/{po_id}")
async def get_po(po_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    po = await db.rahaza_purchase_orders.find_one({"id": po_id}, {"_id": 0})
    if not po:
        raise HTTPException(404, "PO tidak ditemukan.")
    await _enrich_po(db, po)
    return serialize_doc(po)


@router.post("/purchase-orders")
async def create_po(request: Request):
    """Create draft PO."""
    user = await _require_admin(request)
    db = get_db()
    body = await request.json()
    
    vendor_name = (body.get("vendor_name") or "").strip()
    if not vendor_name:
        raise HTTPException(400, "vendor_name wajib diisi.")
    
    items = _norm_po_items(body.get("items"))
    if not items:
        raise HTTPException(400, "Minimal 1 item material.")
    
    # Validate semua material_id exist
    m_ids = [it["material_id"] for it in items]
    existing_mats = await db.rahaza_materials.find({"id": {"$in": m_ids}, "active": True}, {"_id": 0, "id": 1}).to_list(500)
    existing_ids = {m["id"] for m in existing_mats}
    missing = [mid for mid in m_ids if mid not in existing_ids]
    if missing:
        raise HTTPException(400, f"Material ID tidak ditemukan: {missing}")
    
    doc = {
        "id": _uid(),
        "po_number": await _gen_po_number(db),
        "vendor_name": vendor_name,
        "vendor_contact": body.get("vendor_contact") or "",
        "vendor_address": body.get("vendor_address") or "",
        "po_date": body.get("po_date") or date.today().isoformat(),
        "expected_delivery_date": body.get("expected_delivery_date") or None,
        "items": items,
        "status": "draft",
        "notes": body.get("notes") or "",
        "approval_flow_key": body.get("approval_flow_key") or "single_step",  # configurable
        "approvals": [],  # list of {user_id, user_name, approved_at, step}
        "created_by": user["id"],
        "created_by_name": user.get("name", ""),
        "created_at": _now(),
        "updated_at": _now(),
    }
    await db.rahaza_purchase_orders.insert_one(doc)
    await log_activity(user["id"], user.get("name", ""), "create", "rahaza.po", doc["po_number"])
    await _enrich_po(db, doc)
    return serialize_doc(doc)


@router.put("/purchase-orders/{po_id}")
async def update_po(po_id: str, request: Request):
    """Update draft PO."""
    user = await _require_admin(request)
    db = get_db()
    po = await db.rahaza_purchase_orders.find_one({"id": po_id}, {"_id": 0})
    if not po:
        raise HTTPException(404, "PO tidak ditemukan.")
    if po.get("status") not in ("draft", "rejected"):
        raise HTTPException(400, f"Hanya PO Draft/Rejected yang bisa diedit. Status saat ini: {po.get('status')}")
    
    body = await request.json()
    upd = {"updated_at": _now()}
    
    if "vendor_name" in body:
        upd["vendor_name"] = body["vendor_name"].strip()
    if "vendor_contact" in body:
        upd["vendor_contact"] = body["vendor_contact"]
    if "vendor_address" in body:
        upd["vendor_address"] = body["vendor_address"]
    if "po_date" in body:
        upd["po_date"] = body["po_date"]
    if "expected_delivery_date" in body:
        upd["expected_delivery_date"] = body["expected_delivery_date"]
    if "notes" in body:
        upd["notes"] = body["notes"]
    if "items" in body:
        items = _norm_po_items(body["items"])
        if not items:
            raise HTTPException(400, "Minimal 1 item material.")
        upd["items"] = items
    
    await db.rahaza_purchase_orders.update_one({"id": po_id}, {"$set": upd})
    await log_activity(user["id"], user.get("name", ""), "update", "rahaza.po", po["po_number"])
    out = await db.rahaza_purchase_orders.find_one({"id": po_id}, {"_id": 0})
    await _enrich_po(db, out)
    return serialize_doc(out)


@router.delete("/purchase-orders/{po_id}")
async def delete_po(po_id: str, request: Request):
    """Delete draft PO."""
    user = await _require_admin(request)
    db = get_db()
    po = await db.rahaza_purchase_orders.find_one({"id": po_id}, {"_id": 0})
    if not po:
        raise HTTPException(404, "PO tidak ditemukan.")
    if po.get("status") not in ("draft", "rejected"):
        raise HTTPException(400, "Hanya PO Draft/Rejected yang bisa dihapus.")
    
    await db.rahaza_purchase_orders.delete_one({"id": po_id})
    await log_activity(user["id"], user.get("name", ""), "delete", "rahaza.po", po["po_number"])
    return {"status": "deleted"}


# ── PO Approval Workflow ───────────────────────────────────────────────────────

@router.post("/purchase-orders/{po_id}/submit")
async def submit_po(po_id: str, request: Request):
    """Submit PO for approval (draft → pending_approval)."""
    user = await _require_admin(request)
    db = get_db()
    po = await db.rahaza_purchase_orders.find_one({"id": po_id}, {"_id": 0})
    if not po:
        raise HTTPException(404, "PO tidak ditemukan.")
    if po.get("status") not in ("draft", "rejected"):
        raise HTTPException(400, f"Hanya PO Draft/Rejected yang bisa diajukan. Status: {po.get('status')}")
    
    await db.rahaza_purchase_orders.update_one(
        {"id": po_id},
        {
            "$set": {
                "status": "pending_approval",
                "submitted_at": _now(),
                "submitted_by": user["id"],
                "updated_at": _now(),
            }
        }
    )
    await log_activity(user["id"], user.get("name", ""), "submit", "rahaza.po", po["po_number"])
    out = await db.rahaza_purchase_orders.find_one({"id": po_id}, {"_id": 0})
    await _enrich_po(db, out)
    return serialize_doc(out)


@router.post("/purchase-orders/{po_id}/approve")
async def approve_po(po_id: str, request: Request):
    """Approve PO (pending_approval → approved).
    
    Untuk single-step workflow: langsung approved.
    Untuk multi-step: catat approval step (future enhancement).
    """
    user = await _require_approver(request)
    db = get_db()
    po = await db.rahaza_purchase_orders.find_one({"id": po_id}, {"_id": 0})
    if not po:
        raise HTTPException(404, "PO tidak ditemukan.")
    if po.get("status") != "pending_approval":
        raise HTTPException(400, f"Hanya PO Pending Approval yang bisa di-approve. Status: {po.get('status')}")
    
    # Record approval
    approval_record = {
        "user_id": user["id"],
        "user_name": user.get("name", ""),
        "approved_at": _now(),
        "step": "final",  # untuk single-step; multi-step bisa tambah logic
    }
    
    await db.rahaza_purchase_orders.update_one(
        {"id": po_id},
        {
            "$set": {
                "status": "approved",
                "approved_at": _now(),
                "approved_by": user["id"],
                "updated_at": _now(),
            },
            "$push": {"approvals": approval_record},
        }
    )
    await log_activity(user["id"], user.get("name", ""), "approve", "rahaza.po", po["po_number"])
    out = await db.rahaza_purchase_orders.find_one({"id": po_id}, {"_id": 0})
    await _enrich_po(db, out)
    return serialize_doc(out)


@router.post("/purchase-orders/{po_id}/reject")
async def reject_po(po_id: str, request: Request):
    """Reject PO (pending_approval → rejected)."""
    user = await _require_approver(request)
    db = get_db()
    body = await request.json()
    reason = body.get("reason") or "Tidak ada alasan"
    
    po = await db.rahaza_purchase_orders.find_one({"id": po_id}, {"_id": 0})
    if not po:
        raise HTTPException(404, "PO tidak ditemukan.")
    if po.get("status") != "pending_approval":
        raise HTTPException(400, f"Hanya PO Pending Approval yang bisa di-reject. Status: {po.get('status')}")
    
    await db.rahaza_purchase_orders.update_one(
        {"id": po_id},
        {
            "$set": {
                "status": "rejected",
                "rejected_at": _now(),
                "rejected_by": user["id"],
                "rejected_reason": reason,
                "updated_at": _now(),
            }
        }
    )
    await log_activity(user["id"], user.get("name", ""), f"reject:{reason}", "rahaza.po", po["po_number"])
    out = await db.rahaza_purchase_orders.find_one({"id": po_id}, {"_id": 0})
    await _enrich_po(db, out)
    return serialize_doc(out)


@router.post("/purchase-orders/{po_id}/cancel")
async def cancel_po(po_id: str, request: Request):
    """Cancel PO (any status except fully_received → cancelled)."""
    user = await _require_admin(request)
    db = get_db()
    body = await request.json()
    reason = body.get("reason") or "Tidak ada alasan"
    
    po = await db.rahaza_purchase_orders.find_one({"id": po_id}, {"_id": 0})
    if not po:
        raise HTTPException(404, "PO tidak ditemukan.")
    if po.get("status") == "fully_received":
        raise HTTPException(400, "PO yang sudah fully received tidak bisa di-cancel.")
    if po.get("status") == "cancelled":
        raise HTTPException(400, "PO sudah dibatalkan.")
    
    await db.rahaza_purchase_orders.update_one(
        {"id": po_id},
        {
            "$set": {
                "status": "cancelled",
                "cancelled_at": _now(),
                "cancelled_by": user["id"],
                "cancelled_reason": reason,
                "updated_at": _now(),
            }
        }
    )
    await log_activity(user["id"], user.get("name", ""), f"cancel:{reason}", "rahaza.po", po["po_number"])
    out = await db.rahaza_purchase_orders.find_one({"id": po_id}, {"_id": 0})
    await _enrich_po(db, out)
    return serialize_doc(out)


# ── Update PO received qty (called from warehouse GR) ────────────────────────

async def update_po_received_qty(db, po_id: str, items_received: list):
    """
    Called by warehouse.py saat GR received.
    items_received: [{"material_id": "...", "qty": ...}, ...]
    
    Update qty_received per item dan status PO.
    """
    po = await db.rahaza_purchase_orders.find_one({"id": po_id}, {"_id": 0})
    if not po:
        log.warning(f"PO {po_id} tidak ditemukan untuk update received qty")
        return
    
    # Build dict: material_id → total qty received dari GR
    received_map = {}
    for r in items_received:
        mid = r.get("material_id")
        qty = float(r.get("qty") or 0)
        if mid:
            received_map[mid] = received_map.get(mid, 0) + qty
    
    # Update PO items
    updated_items = []
    total_ordered = 0
    total_received = 0
    for it in (po.get("items") or []):
        mid = it["material_id"]
        qty_ordered = float(it.get("qty_ordered") or 0)
        current_received = float(it.get("qty_received") or 0)
        new_received = current_received + received_map.get(mid, 0)
        
        updated_items.append({
            **it,
            "qty_received": round(new_received, 4),
        })
        total_ordered += qty_ordered
        total_received += new_received
    
    # Determine new status
    new_status = po.get("status")
    if po.get("status") in ("approved", "partially_received"):
        if total_received >= total_ordered:
            new_status = "fully_received"
        elif total_received > 0:
            new_status = "partially_received"
    
    await db.rahaza_purchase_orders.update_one(
        {"id": po_id},
        {
            "$set": {
                "items": updated_items,
                "status": new_status,
                "updated_at": _now(),
            }
        }
    )
    log.info(f"PO {po.get('po_number')} updated: received {total_received}/{total_ordered}, status: {new_status}")


# ── PO → GR helpers (P1.C: Create GR from PO + audit trail) ──────────────────

async def compute_po_remaining(db, po_id: str) -> dict:
    """Compute remaining qty per material_id for a PO. Returns:
        {
            "po": {...},
            "items_remaining": [
                {
                    "po_item_id": str, "material_id": str, "material_name": str,
                    "unit": str, "qty_ordered": float, "qty_received": float,
                    "qty_remaining": float
                },
                ...
            ],
            "total_remaining": float
        }
    """
    po = await db.rahaza_purchase_orders.find_one({"id": po_id}, {"_id": 0})
    if not po:
        return {"po": None, "items_remaining": [], "total_remaining": 0.0}
    await _enrich_po(db, po)

    items_out = []
    total = 0.0
    for it in (po.get("items") or []):
        qty_ordered = float(it.get("qty_ordered") or 0)
        qty_received = float(it.get("qty_received") or 0)
        qty_remaining = max(0.0, round(qty_ordered - qty_received, 4))
        items_out.append({
            "po_item_id": it.get("id"),
            "material_id": it.get("material_id"),
            "material_code": it.get("material_code"),
            "material_name": it.get("material_name"),
            "material_type": it.get("material_type"),
            "unit": it.get("unit"),
            "qty_ordered": round(qty_ordered, 4),
            "qty_received": round(qty_received, 4),
            "qty_remaining": qty_remaining,
            "unit_cost": float(it.get("unit_cost") or 0),
            "notes": it.get("notes") or "",
        })
        total += qty_remaining
    return {"po": po, "items_remaining": items_out, "total_remaining": round(total, 4)}


@router.get("/purchase-orders/{po_id}/remaining")
async def get_po_remaining(po_id: str, request: Request):
    """P1.C: GET remaining qty per item untuk PO (untuk pre-fill GR di frontend)."""
    await require_auth(request)
    db = get_db()
    res = await compute_po_remaining(db, po_id)
    if not res["po"]:
        raise HTTPException(404, "PO tidak ditemukan.")
    return serialize_doc({
        "po_id": res["po"]["id"],
        "po_number": res["po"]["po_number"],
        "vendor_name": res["po"]["vendor_name"],
        "status": res["po"]["status"],
        "items_remaining": res["items_remaining"],
        "total_remaining": res["total_remaining"],
    })


@router.post("/purchase-orders/{po_id}/create-gr")
async def create_gr_from_po(po_id: str, request: Request):
    """P1.C: Create Goods Receipt (GR) draft dari PO.

    Workflow:
      - Validasi PO status ∈ {approved, partially_received}
      - Hitung remaining qty per item
      - Skip item yang fully received
      - Buat GR draft di warehouse_receiving dengan:
        * po_id, po_number, supplier_name = vendor_name
        * items[*].expected_qty = qty_remaining
        * items[*].material_id, material_name terisi
        * enforce_po_qty = True (default; mencegah over-receive)
      - Mengembalikan GR doc.

    Body (optional):
      - location_id, location_name: lokasi penerimaan default
      - notes: catatan tambahan
      - items_override: [{po_item_id, qty}] - jika hanya ingin partial GR
    """
    user = await _require_admin(request)
    db = get_db()
    body = await request.json() if (await request.body()) else {}

    res = await compute_po_remaining(db, po_id)
    po = res["po"]
    if not po:
        raise HTTPException(404, "PO tidak ditemukan.")
    if po.get("status") not in ("approved", "partially_received"):
        raise HTTPException(
            400,
            f"Hanya PO Approved/Partially Received yang bisa dibuatkan GR. Status saat ini: {po.get('status')}",
        )
    if res["total_remaining"] <= 0:
        raise HTTPException(400, "Tidak ada qty tersisa untuk diterima.")

    # Build override map (material_id -> qty) if provided
    override_map: dict = {}
    if isinstance(body.get("items_override"), list):
        for ov in body["items_override"]:
            po_item_id = ov.get("po_item_id")
            try:
                q = float(ov.get("qty") or 0)
            except Exception:
                q = 0.0
            if po_item_id and q > 0:
                override_map[po_item_id] = q

    # Build GR items from PO remaining (skip 0)
    gr_items = []
    for ir in res["items_remaining"]:
        if ir["qty_remaining"] <= 0:
            continue
        expected = ir["qty_remaining"]
        if override_map and ir["po_item_id"] in override_map:
            expected = min(override_map[ir["po_item_id"]], ir["qty_remaining"])
        if expected <= 0:
            continue
        gr_items.append({
            "id": _uid(),
            "po_item_id": ir["po_item_id"],
            "product_name": ir["material_name"] or ir["material_code"] or "Unknown",
            "sku": ir["material_code"] or "",
            "material_id": ir["material_id"],
            "material_name": ir["material_name"] or ir["material_code"] or "Unknown",
            "expected_qty": float(expected),
            "received_qty": 0.0,
            "rejected_qty": 0.0,
            "unit": ir["unit"] or "pcs",
            "unit_cost": float(ir["unit_cost"] or 0),
            "inspection_status": "pending",
            "inspection_notes": "",
        })
    if not gr_items:
        raise HTTPException(400, "Tidak ada item yang bisa dibuatkan GR (semua sudah fully received).")

    # Generate GR number via unified counters SSOT
    seq = await next_counter(db, "gr_number", namespace="generic")
    receipt_number = f"GR-{seq:05d}"

    location_id = body.get("location_id", "")
    location_name = body.get("location_name", "")
    receipt = {
        "id": _uid(),
        "receipt_number": receipt_number,
        "source_type": "supplier",
        "source_ref": po.get("po_number") or "",
        "supplier_name": po.get("vendor_name") or "",
        "location_id": location_id,
        "location_name": location_name,
        "status": "draft",
        "items": gr_items,
        "notes": body.get("notes") or f"Auto-created from PO {po.get('po_number')}",
        "received_by": user["name"],
        "received_by_id": user["id"],
        # PO linkage
        "po_id": po["id"],
        "po_number": po.get("po_number"),
        # P1.C: enforce_po_qty default true → anti over-receive
        "enforce_po_qty": True,
        # Audit
        "created_from": "po",
        "created_at": _now(),
        "updated_at": _now(),
    }
    await db.warehouse_receiving.insert_one(receipt)
    await log_activity(
        user["id"], user.get("name", ""),
        "create_from_po", "warehouse_receiving",
        f"Created GR {receipt_number} from PO {po.get('po_number')} ({len(gr_items)} items, {round(sum(i['expected_qty'] for i in gr_items),2)} total qty)",
    )
    return serialize_doc(receipt)


@router.get("/purchase-orders/{po_id}/grs")
async def list_grs_for_po(po_id: str, request: Request):
    """P1.C: List semua GR yang terkait ke PO (untuk audit trail di PO detail)."""
    await require_auth(request)
    db = get_db()
    po = await db.rahaza_purchase_orders.find_one({"id": po_id}, {"_id": 0, "po_number": 1, "id": 1})
    if not po:
        raise HTTPException(404, "PO tidak ditemukan.")

    grs = await db.warehouse_receiving.find(
        {"po_id": po_id},
        {"_id": 0},
    ).sort("created_at", -1).to_list(500)

    # Compute summary per GR
    summary = []
    for gr in grs:
        items = gr.get("items") or []
        total_expected = sum(float(i.get("expected_qty") or 0) for i in items)
        total_received = sum(float(i.get("received_qty") or 0) for i in items)
        total_rejected = sum(float(i.get("rejected_qty") or 0) for i in items)
        summary.append({
            "id": gr["id"],
            "receipt_number": gr.get("receipt_number"),
            "status": gr.get("status"),
            "created_at": gr.get("created_at"),
            "received_by": gr.get("received_by"),
            "location_name": gr.get("location_name"),
            "items_count": len(items),
            "total_expected": round(total_expected, 4),
            "total_received": round(total_received, 4),
            "total_rejected": round(total_rejected, 4),
            "total_net": round(total_received - total_rejected, 4),
            "enforce_po_qty": gr.get("enforce_po_qty", False),
        })
    return serialize_doc(summary)


# ─── BULK CSV IMPORT ────────────────────────────────────────────────────────────

@router.post("/purchase-orders/bulk-import")
async def bulk_import_po_csv(request: Request):
    """
    Import multiple PO items from CSV.
    Body: {vendor_name, rows: [{material_code, qty_ordered, unit_cost, unit?}], ...}
    Returns: list of created POs grouped by vendor.
    """
    user = await require_auth(request)
    db = get_db()
    body = await request.json()
    rows = body.get("rows", [])
    if not rows:
        raise HTTPException(400, "CSV kosong atau tidak ada baris valid.")

    # Batch prefetch all referenced materials by code (single $in query)
    mat_codes_csv = list({(row.get("material_code") or "").strip().upper()
                           for row in rows if (row.get("material_code") or "").strip()})
    mat_by_code: dict = {}
    if mat_codes_csv:
        async for m in db.rahaza_materials.find(
            {"code": {"$in": mat_codes_csv}, "active": True}, {"_id": 0}
        ):
            mat_by_code[m["code"]] = m

    # Group rows by vendor_name (allow per-row vendor override, default to body-level)
    default_vendor = (body.get("vendor_name") or "").strip()
    groups: dict = {}
    errors = []
    for i, row in enumerate(rows):
        vendor = (row.get("vendor_name") or default_vendor).strip()
        if not vendor:
            errors.append(f"Row {i+1}: vendor_name wajib.")
            continue
        mat_code = (row.get("material_code") or "").strip().upper()
        if not mat_code:
            errors.append(f"Row {i+1}: material_code wajib.")
            continue
        try:
            qty = float(row.get("qty_ordered") or 0)
            price = float(row.get("unit_cost") or 0)
        except (ValueError, TypeError):
            errors.append(f"Row {i+1}: qty_ordered/unit_cost harus angka.")
            continue
        if qty <= 0:
            errors.append(f"Row {i+1}: qty_ordered harus > 0.")
            continue
        mat = mat_by_code.get(mat_code)
        if not mat:
            errors.append(f"Row {i+1}: material '{mat_code}' tidak ditemukan.")
            continue
        groups.setdefault(vendor, []).append({
            "material_id": mat["id"],
            "material_code": mat["code"],
            "material_name": mat["name"],
            "qty_ordered": qty,
            "unit_cost": price,
            "unit": row.get("unit") or mat.get("unit") or "pcs",
            "qty_received": 0,
            "subtotal": round(qty * price, 2),
        })

    if errors and not groups:
        raise HTTPException(422, {"errors": errors})

    created = []
    for vendor, items in groups.items():
        doc = {
            "id": _uid(),
            "po_number": await _gen_po_number(db),
            "vendor_name": vendor,
            "vendor_contact": body.get("vendor_contact") or "",
            "vendor_address": body.get("vendor_address") or "",
            "po_date": body.get("po_date") or date.today().isoformat(),
            "expected_delivery_date": body.get("expected_delivery_date") or None,
            "items": items,
            "status": "draft",
            "notes": f"[Bulk Import] {body.get('notes') or ''}".strip(),
            "total_value": round(sum(it["subtotal"] for it in items), 2),
            "created_by": user["id"],
            "created_by_name": user.get("name", ""),
            "created_at": _now(),
            "updated_at": _now(),
        }
        await db.rahaza_purchase_orders.insert_one(doc)
        created.append(serialize_doc(doc))

    return {"ok": True, "created": len(created), "purchase_orders": created, "row_errors": errors}

