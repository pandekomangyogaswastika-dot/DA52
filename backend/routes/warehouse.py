"""
⛔ ARCHIVED — warehouse.py (Legacy Warehouse Module)

STATUS: DEAD CODE — Router REMOVED from server.py (Session #25 Hard Unification).
  - `/api/warehouse/*` endpoints: NOT registered — no live traffic
  - Collections (warehouse_locations, warehouse_stock, warehouse_movements, warehouse_opname):
    DROPPED in Session #11.16 Phase A. All empty.
  - SSOT Replacement:
    * Locations/Racks → wh_racks + wh_positions (wms_receiving.py)
    * Stock           → rahaza_material_stock (wms_receiving.py bridge)
    * Movements       → rahaza_material_movements + wh_pending_movements
    * Opname          → wh_opname_sessions2 (wms_opname2.py — SSOT)
    * Receiving       → warehouse_receiving (still active via wms_receiving.py)

DO NOT re-include this router without a full migration plan.
See: FORENSIC_12_CURRENT_STATE_AUDIT.md GAP-01 + FORENSIC_12 P1 Fix Log.
"""
# ruff: noqa: ERA001
from fastapi import APIRouter, Request, HTTPException
from database import get_db
from auth import require_auth, serialize_doc, log_activity
from utils.counters import next_counter
from datetime import datetime, timezone
import uuid
import logging
import re

logger = logging.getLogger(__name__)

# ⚠️  DEPRECATION NOTICE (Phase 3 — Dual API Conflict Resolution)
# This router is preserved for backward-compatibility only.
# All NEW frontend code MUST call the canonical mirror at /api/wms/legacy/*
# (see routes/wms_legacy.py — same handlers, same DB collections).
# Frontend migration completed for: LocationsModule, PutAwayModule,
# OpnameModule, ReceivingModule, WarehouseDashboard, MaklonMaterialIssuePanel.
# Once external clients (if any) finish migration, this entire file can
# be safely removed.
router = APIRouter(prefix="/api/warehouse", tags=["warehouse-legacy-deprecated"])


def new_id(): return str(uuid.uuid4())
def now(): return datetime.now(timezone.utc)


# ── Sprint 1.1: Sync bridge helper ────────────────────────────────────────────
async def _sync_to_material_stock(db, material_id: str, location_id: str, qty: float):
    """
    Upsert qty into rahaza_material_stock so that the Inventory portal
    (Material Issue, BOM stock check, low-stock alert) sees the correct total.
    This is the sync bridge that resolves the dual-ledger issue (I-1 / W-1).
    """
    existing = await db.rahaza_material_stock.find_one(
        {"material_id": material_id, "location_id": location_id}
    )
    if existing:
        await db.rahaza_material_stock.update_one(
            {"material_id": material_id, "location_id": location_id},
            {"$inc": {"qty": float(qty)}, "$set": {"updated_at": now()}},
        )
    else:
        await db.rahaza_material_stock.insert_one({
            "id": new_id(),
            "material_id": material_id,
            "location_id": location_id,
            "qty": float(qty),
            "updated_at": now(),
        })


async def _record_material_movement(db, material_id: str, location_id: str, location_name: str,
                                     qty: float, unit: str, reference_type: str,
                                     reference_id: str, reference_number: str,
                                     notes: str, user: dict):
    """Record a rahaza_material_movement for audit trail + stock module."""
    await db.rahaza_material_movements.insert_one({
        "id": new_id(),
        "material_id": material_id,
        "location_id": location_id,
        "location_name": location_name,
        "type": "receive",
        "qty": float(qty),
        "unit": unit,
        "reference_type": reference_type,
        "reference_id": reference_id,
        "reference_number": reference_number,
        "notes": notes,
        "created_by": user["id"],
        "created_by_name": user.get("name", "-"),
        "created_at": now(),
    })


# ── Locations / Bin ───────────────────────────────────────────────────────────

@router.get("/locations")
async def get_locations(request: Request):
    await require_auth(request)
    db = get_db()
    locations = await db.warehouse_locations.find({}, {"_id": 0}).sort("code", 1).to_list(500)
    return serialize_doc(locations)


@router.post("/locations")
async def create_location(request: Request):
    user = await require_auth(request)
    db = get_db()
    body = await request.json()
    
    code = body.get("code", "").strip().upper()
    if not code:
        raise HTTPException(400, "Location code required")
    
    existing = await db.warehouse_locations.find_one({"code": code})
    if existing:
        raise HTTPException(400, f"Location {code} already exists")
    
    location = {
        "id": new_id(),
        "code": code,
        "name": body.get("name", code),
        "type": body.get("type", "storage"),  # storage, staging, shipping, receiving
        "zone": body.get("zone", ""),
        "aisle": body.get("aisle", ""),
        "bay": body.get("bay", ""),
        "level": body.get("level", ""),
        "capacity": body.get("capacity", 0),
        "active": True,
        "created_at": now(),
        "updated_at": now(),
    }
    
    await db.warehouse_locations.insert_one(location)
    await log_activity(user["id"], user["name"], "create", "warehouse_locations", f"Created location {code}")
    return serialize_doc(location)


@router.put("/locations/{location_id}")
async def update_location(location_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    
    location = await db.warehouse_locations.find_one({"id": location_id})
    if not location:
        raise HTTPException(404, "Location not found")
    
    body = await request.json()
    updates = {k: v for k, v in body.items() if k not in ("id", "_id", "created_at")}
    updates["updated_at"] = now()
    
    await db.warehouse_locations.update_one({"id": location_id}, {"$set": updates})
    updated = await db.warehouse_locations.find_one({"id": location_id}, {"_id": 0})
    return serialize_doc(updated)


@router.delete("/locations/{location_id}")
async def delete_location(location_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    
    stock_count = await db.warehouse_stock.count_documents({"location_id": location_id, "quantity": {"$gt": 0}})
    if stock_count > 0:
        raise HTTPException(400, f"Cannot delete location with {stock_count} active stock records")
    
    await db.warehouse_locations.delete_one({"id": location_id})
    return {"status": "deleted"}


# ── Goods Receiving ─────────────────────────────────────────────────────────

@router.get("/receiving")
async def get_receiving(request: Request):
    await require_auth(request)
    db = get_db()
    receipts = await db.warehouse_receiving.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return serialize_doc(receipts)


@router.get("/receiving/{receipt_id}")
async def get_receipt(receipt_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    receipt = await db.warehouse_receiving.find_one({"id": receipt_id}, {"_id": 0})
    if not receipt:
        raise HTTPException(404, "Receipt not found")
    return serialize_doc(receipt)


@router.post("/receiving")
async def create_receiving(request: Request):
    user = await require_auth(request)
    body = await request.json()
    db = get_db()
    
    # W-4: Atomic counter for receipt_number (unified counters SSOT)
    seq = await next_counter(db, "gr_number", namespace="generic")
    receipt_number = f"GR-{seq:05d}"
    
    # Sprint 2.1: PO reference for 3-way matching (optional but recommended)
    po_id = body.get("po_id") or None
    po_number = body.get("po_number") or ""
    
    receipt = {
        "id": new_id(),
        "receipt_number": receipt_number,
        "source_type": body.get("source_type", "supplier"),
        "source_ref": body.get("source_ref", ""),
        "supplier_name": body.get("supplier_name", ""),
        "location_id": body.get("location_id", ""),
        "location_name": body.get("location_name", ""),
        "status": "draft",
        "items": [],
        "notes": body.get("notes", ""),
        "received_by": user["name"],
        "received_by_id": user["id"],
        # Sprint 2.1: Link to Purchase Order
        "po_id": po_id,
        "po_number": po_number,
        "created_at": now(),
        "updated_at": now(),
    }
    
    for item in body.get("items", []):
        receipt_item = {
            "id": new_id(),
            "product_name": item.get("product_name", ""),
            "sku": item.get("sku", ""),
            # Sprint 1.1: material_id links to rahaza_materials for sync bridge
            "material_id": item.get("material_id") or None,
            "material_name": item.get("material_name") or item.get("product_name", ""),
            "expected_qty": float(item.get("expected_qty", 0)),
            "received_qty": float(item.get("received_qty", 0)),
            "rejected_qty": float(item.get("rejected_qty", 0)),
            "unit": item.get("unit", "pcs"),
            "inspection_status": "pending",
            "inspection_notes": "",
            # Phase 8A: Asset vs Material differentiation
            "item_type": item.get("item_type", "material"),  # "material" or "asset"
            "unit_price": float(item.get("unit_price", 0)),  # For asset capitalization
            "asset_category": item.get("asset_category") or None,  # For auto-create fixed asset
        }
        receipt["items"].append(receipt_item)
    
    await db.warehouse_receiving.insert_one(receipt)
    await log_activity(user["id"], user["name"], "create", "warehouse_receiving", f"Created GR {receipt_number}")
    return serialize_doc(receipt)


@router.put("/receiving/{receipt_id}")
async def update_receiving(receipt_id: str, request: Request):
    user = await require_auth(request)
    db = get_db()
    
    existing = await db.warehouse_receiving.find_one({"id": receipt_id})
    if not existing:
        raise HTTPException(404, "Receipt not found")
    
    body = await request.json()
    updates = {}
    
    if "status" in body:
        updates["status"] = body["status"]
    if "items" in body:
        updates["items"] = body["items"]
    if "notes" in body:
        updates["notes"] = body["notes"]
    updates["updated_at"] = now()
    
    # ── Sprint 1.1: Dual-ledger sync bridge ────────────────────────────────
    # When transitioning to 'received', update BOTH ledgers:
    #   1. warehouse_stock (bin-level, used by put-away / dashboard)
    #   2. rahaza_material_stock (material-level, used by Material Issue / BOM)
    if body.get("status") == "received" and existing.get("status") != "received":
        items_to_process = body.get("items") or existing.get("items", [])
        loc_name = existing.get("location_name", "")
        loc_id   = existing.get("location_id", "")

        # ── P1.C: Anti over-receive validation ─────────────────────────────
        # Jika GR linked ke PO dan enforce_po_qty=True, validasi bahwa net_qty
        # (received - rejected) untuk tiap material_id tidak melebihi qty
        # remaining di PO.
        po_id_link = existing.get("po_id")
        enforce_po = bool(existing.get("enforce_po_qty", bool(po_id_link)))
        if po_id_link and enforce_po:
            po_doc = await db.rahaza_purchase_orders.find_one({"id": po_id_link}, {"_id": 0})
            if po_doc:
                # Build remaining map per material_id
                remaining_map: dict = {}
                for po_it in (po_doc.get("items") or []):
                    mid = po_it.get("material_id")
                    if not mid:
                        continue
                    remaining = max(
                        0.0,
                        float(po_it.get("qty_ordered") or 0) - float(po_it.get("qty_received") or 0),
                    )
                    remaining_map[mid] = remaining_map.get(mid, 0.0) + remaining

                # Sum net_qty per material_id in this GR
                net_per_material: dict = {}
                for it in items_to_process:
                    mid = it.get("material_id")
                    if not mid:
                        continue
                    net = float(it.get("received_qty", 0)) - float(it.get("rejected_qty", 0))
                    if net <= 0:
                        continue
                    net_per_material[mid] = net_per_material.get(mid, 0.0) + net

                # Validate
                for mid, net in net_per_material.items():
                    remaining = remaining_map.get(mid, 0.0)
                    if net - remaining > 0.0001:  # small epsilon for float
                        # Find name for friendlier error
                        mat = await db.rahaza_materials.find_one({"id": mid}, {"_id": 0, "name": 1, "code": 1})
                        nm = (mat and (mat.get("name") or mat.get("code"))) or mid
                        raise HTTPException(
                            400,
                            f"Over-receive ditolak untuk {nm}: net qty {net} melebihi sisa PO {remaining} "
                            f"(PO {existing.get('po_number')}).",
                        )
        
        # Batch prefetch existing warehouse_stock rows for all (sku, product_name)
        # at this single location to avoid N+1
        item_keys = []
        skus_w = []
        for it in items_to_process:
            net = float(it.get("received_qty", 0)) - float(it.get("rejected_qty", 0))
            if net <= 0:
                continue
            sku_v = it.get("sku", "")
            pname_v = it.get("product_name", "")
            item_keys.append((sku_v, pname_v))
            if sku_v:
                skus_w.append(sku_v)
        ws_lookup = {}
        if skus_w:
            async for d in db.warehouse_stock.find(
                {"location_id": loc_id, "sku": {"$in": list(set(skus_w))}}
            ):
                ws_lookup[(d.get("sku", ""), d.get("product_name", ""))] = d

        for item in items_to_process:
            net_qty = float(item.get("received_qty", 0)) - float(item.get("rejected_qty", 0))
            if net_qty <= 0:
                continue
            
            sku  = item.get("sku", "")
            pname = item.get("product_name", "")
            unit  = item.get("unit", "pcs")
            lot_number  = item.get("lot_number") or ""
            expiry_date = item.get("expiry_date") or None
            
            # ── Ledger 1: warehouse_stock (existing, unchanged) ──────────────
            material_id = item.get("material_id")
            stock_key = {"location_id": loc_id, "sku": sku, "product_name": pname}
            existing_stock = ws_lookup.get((sku, pname))
            if existing_stock:
                set_fields = {"updated_at": now()}
                # Backfill material_id if missing
                if material_id and not existing_stock.get("material_id"):
                    set_fields["material_id"] = material_id
                await db.warehouse_stock.update_one(
                    {"id": existing_stock["id"]},
                    {"$inc": {"quantity": net_qty, "total_received": net_qty}, "$set": set_fields}
                )
            else:
                await db.warehouse_stock.insert_one({
                    **stock_key, "id": new_id(),
                    "material_id": material_id,  # B4 Fix: store material_id so putaway can sync
                    "quantity": net_qty, "reserved": 0, "available": net_qty,
                    "total_received": net_qty, "unit": unit,
                    "lot_number": lot_number,   # U7: lot tracking
                    "expiry_date": expiry_date, # U7: expiry date tracking
                    "created_at": now(), "updated_at": now(),
                })
            
            # warehouse movement log
            await db.warehouse_movements.insert_one({
                "id": new_id(), "type": "receive",
                "receipt_id": receipt_id,
                "receipt_number": existing.get("receipt_number", ""),
                "location_id": loc_id, "location_name": loc_name,
                "sku": sku, "product_name": pname,
                "quantity": net_qty, "unit": unit,
                "performed_by": user["name"], "performed_by_id": user["id"],
                "notes": f"GR {existing.get('receipt_number', '')}",
                "created_at": now(),
            })
            
            # ── Ledger 2: rahaza_material_stock (NEW — sync bridge) ──────────
            # material_id already resolved above (line ~277)
            if material_id:
                try:
                    await _sync_to_material_stock(db, material_id, loc_id, net_qty)
                    await _record_material_movement(
                        db, material_id, loc_id, loc_name, net_qty, unit,
                        "goods_receipt", receipt_id,
                        existing.get("receipt_number", ""),
                        f"GR {existing.get('receipt_number', '')} — {pname} dari {existing.get('supplier_name', existing.get('source_type', ''))}",
                        user,
                    )
                    logger.info(f"GR sync: material_id={material_id} +{net_qty} {unit} @ loc={loc_id}")
                except Exception as e:
                    logger.error(f"GR sync to rahaza_material_stock failed: {e}")
                    # Non-fatal: don't break the receive flow
        
        # ── Sprint 2.1: Update PO received qty (3-way matching) ───────────────
        po_id = existing.get("po_id")
        if po_id:
            try:
                from routes.rahaza_po import update_po_received_qty
                # Build items list with material_id and qty for PO update
                items_for_po = []
                for item in items_to_process:
                    net_qty = float(item.get("received_qty", 0)) - float(item.get("rejected_qty", 0))
                    if net_qty > 0 and item.get("material_id"):
                        items_for_po.append({
                            "material_id": item["material_id"],
                            "qty": net_qty,
                        })
                if items_for_po:
                    await update_po_received_qty(db, po_id, items_for_po)
                    logger.info(f"GR {existing.get('receipt_number')} updated PO {existing.get('po_number')} received qty")
            except Exception as e:
                logger.error(f"Failed to update PO received qty: {e}")
                # Non-fatal: don't break the receive flow
        
        # ── Phase 8A: Asset Capitalization (Auto-create Fixed Asset + GL Posting) ───
        try:
            await _capitalize_assets_from_grn(db, receipt_id, existing, items_to_process, user)
        except Exception as e:
            logger.error(f"Failed to capitalize assets from GR: {e}")
            # Non-fatal: log warning but don't break the receive flow
    
    await db.warehouse_receiving.update_one({"id": receipt_id}, {"$set": updates})
    await log_activity(user["id"], user["name"], "update", "warehouse_receiving",
                       f"{existing.get('receipt_number', '')} → {body.get('status', 'updated')}")
    
    updated = await db.warehouse_receiving.find_one({"id": receipt_id}, {"_id": 0})
    return serialize_doc(updated)


@router.delete("/receiving/{receipt_id}")
async def delete_receiving(receipt_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    receipt = await db.warehouse_receiving.find_one({"id": receipt_id})
    if not receipt:
        raise HTTPException(404, "Receipt not found")
    if receipt.get("status") == "received":
        raise HTTPException(400, "Tidak bisa hapus GR yang sudah 'received'")
    await db.warehouse_receiving.delete_one({"id": receipt_id})
    return {"status": "deleted"}


# ── Stock Summary & Movements ─────────────────────────────────────────────────

@router.get("/stock")
async def get_stock(request: Request, location_id: str = None, sku: str = None):
    await require_auth(request)
    db = get_db()
    query = {"quantity": {"$gt": 0}}
    if location_id:
        query["location_id"] = location_id
    if sku:
        query["sku"] = {"$regex": re.escape(sku), "$options": "i"}
    stock = await db.warehouse_stock.find(query, {"_id": 0}).sort("product_name", 1).to_list(500)
    return serialize_doc(stock)


@router.get("/stock/summary")
async def get_stock_summary(request: Request):
    await require_auth(request)
    db = get_db()
    pipeline = [
        {"$match": {"quantity": {"$gt": 0}}},
        {"$group": {
            "_id": None,
            "total_skus": {"$sum": 1},
            "total_qty": {"$sum": "$quantity"},
            "total_value": {"$sum": {"$multiply": ["$quantity", {"$ifNull": ["$unit_cost", 0]}]}}
        }}
    ]
    results = await db.warehouse_stock.aggregate(pipeline).to_list(1)
    return serialize_doc(results[0] if results else {"total_skus": 0, "total_qty": 0, "total_value": 0})


@router.get("/movements")
async def get_movements(request: Request, location_id: str = None, sku: str = None, limit: int = 100):
    await require_auth(request)
    db = get_db()
    query = {}
    if location_id:
        query["location_id"] = location_id
    if sku:
        query["sku"] = {"$regex": re.escape(sku), "$options": "i"}
    movements = await db.warehouse_movements.find(query, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(500)
    return serialize_doc(movements)


# ── Dashboard ──────────────────────────────────────────────────────────────────

@router.get("/dashboard-kpi")
async def warehouse_dashboard_kpi(request: Request):
    """Sprint 3.4: Dashboard KPI endpoint for WarehouseDashboard.jsx"""
    await require_auth(request)
    db = get_db()
    
    total_locations = await db.warehouse_locations.count_documents({"active": True})
    total_items = await db.warehouse_stock.count_documents({"quantity": {"$gt": 0}})
    pending_gr = await db.warehouse_receiving.count_documents({"status": {"$in": ["draft", "inspecting"]}})
    
    pipeline = [
        {"$match": {"quantity": {"$gt": 0}}},
        {"$group": {"_id": None, "total_qty": {"$sum": "$quantity"}}}
    ]
    stock_agg = await db.warehouse_stock.aggregate(pipeline).to_list(1)
    total_qty = (stock_agg[0]["total_qty"] if stock_agg else 0)
    
    return serialize_doc({
        "total_items": total_items,
        "total_locations": total_locations,
        "pending_gr": pending_gr,
        "total_qty": round(total_qty, 2),
    })


@router.get("/dashboard")
async def warehouse_dashboard(request: Request):
    await require_auth(request)
    db = get_db()
    
    total_locations = await db.warehouse_locations.count_documents({"active": True})
    total_skus      = await db.warehouse_stock.count_documents({"quantity": {"$gt": 0}})
    pending_receipts = await db.warehouse_receiving.count_documents({"status": {"$in": ["draft", "inspecting"]}})
    
    pipeline = [
        {"$match": {"quantity": {"$gt": 0}}},
        {"$group": {"_id": None, "total_qty": {"$sum": "$quantity"}}}
    ]
    stock_agg = await db.warehouse_stock.aggregate(pipeline).to_list(1)
    total_qty = (stock_agg[0]["total_qty"] if stock_agg else 0)
    
    recent_movements = await db.warehouse_movements.find({}, {"_id": 0}).sort("created_at", -1).limit(5).to_list(500)
    
    return serialize_doc({
        "total_locations": total_locations,
        "total_skus": total_skus,
        "total_qty": total_qty,
        "pending_receipts": pending_receipts,
        "recent_movements": recent_movements,
    })


# ── Put-Away ──────────────────────────────────────────────────────────────────

@router.get("/putaway")
async def get_putaways(request: Request):
    await require_auth(request)
    db = get_db()
    putaways = await db.warehouse_putaway.find({}, {"_id": 0}).sort("created_at", -1).limit(100).to_list(500)
    return serialize_doc(putaways)


@router.post("/putaway")
async def create_putaway(request: Request):
    user = await require_auth(request)
    db = get_db()
    body = await request.json()
    
    source_stock_id = body.get("source_stock_id")
    target_location_id = body.get("target_location_id")
    quantity = float(body.get("quantity", 0))
    
    if not all([source_stock_id, target_location_id, quantity > 0]):
        raise HTTPException(400, "source_stock_id, target_location_id, and quantity > 0 required")
    
    source = await db.warehouse_stock.find_one({"id": source_stock_id})
    if not source:
        raise HTTPException(404, "Source stock not found")
    if source.get("available", source.get("quantity", 0)) < quantity:
        raise HTTPException(400, f"Insufficient stock. Available: {source.get('available', source.get('quantity', 0))}")
    
    target_location = await db.warehouse_locations.find_one({"id": target_location_id}, {"_id": 0})
    if not target_location:
        raise HTTPException(404, "Target location not found")
    
    # Move from source to target
    await db.warehouse_stock.update_one(
        {"id": source_stock_id},
        {"$inc": {"quantity": -quantity, "available": -quantity}, "$set": {"updated_at": now()}}
    )
    
    target_key = {"location_id": target_location_id, "sku": source["sku"], "product_name": source["product_name"]}
    existing_target = await db.warehouse_stock.find_one(target_key)
    if existing_target:
        await db.warehouse_stock.update_one(
            {"id": existing_target["id"]},
            {"$inc": {"quantity": quantity, "available": quantity}, "$set": {"updated_at": now()}}
        )
    else:
        await db.warehouse_stock.insert_one({
            **target_key, "id": new_id(),
            "quantity": quantity, "reserved": 0, "available": quantity,
            "unit": source.get("unit", "pcs"),
            "created_at": now(), "updated_at": now(),
        })
    
    putaway = {
        "id": new_id(),
        "source_location_id": source["location_id"],
        "target_location_id": target_location_id,
        "target_location_name": target_location.get("name", ""),
        "sku": source["sku"],
        "product_name": source["product_name"],
        "quantity": quantity,
        "unit": source.get("unit", "pcs"),
        "performed_by": user["name"],
        "performed_by_id": user["id"],
        "created_at": now(),
    }
    await db.warehouse_putaway.insert_one(putaway)
    
    # B4 Fix: sync putaway movement to rahaza_material_stock (the canonical stock ledger)
    material_id = source.get("material_id")
    if material_id:
        source_loc = source["location_id"]
        await _sync_to_material_stock(db, material_id, source_loc, -quantity)
        await _sync_to_material_stock(db, material_id, target_location_id, quantity)
    
    await db.warehouse_movements.insert_one({
        "id": new_id(), "type": "putaway",
        "source_location_id": source["location_id"],
        "location_id": target_location_id, "location_name": target_location.get("name", ""),
        "sku": source["sku"], "product_name": source["product_name"],
        "quantity": quantity, "unit": source.get("unit", "pcs"),
        "performed_by": user["name"], "performed_by_id": user["id"],
        "created_at": now(),
    })
    
    await log_activity(user["id"], user["name"], "putaway", "warehouse_stock", f"Put-away {quantity} {source['sku']} → {target_location.get('name', target_location_id)}")
    return serialize_doc(putaway)


# ── Stock Opname (Cycle Count) ─────────────────────────────────────────────────

@router.get("/opname")
async def get_opnames(request: Request):
    await require_auth(request)
    db = get_db()
    opnames = await db.warehouse_opname.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return serialize_doc(opnames)


@router.post("/opname")
async def create_opname(request: Request):
    user = await require_auth(request)
    db = get_db()
    body = await request.json()
    
    seq = await next_counter(db, "opname_number", namespace="generic")
    opname_number = f"OP-{seq:05d}"
    
    location_id = body.get("location_id", "")
    location = await db.warehouse_locations.find_one({"id": location_id}, {"_id": 0}) if location_id else None
    
    opname = {
        "id": new_id(),
        "opname_number": opname_number,
        "location_id": location_id,
        "location_name": (location or {}).get("name", ""),
        "status": "draft",
        "items": [],
        "notes": body.get("notes", ""),
        "created_by": user["name"],
        "created_by_id": user["id"],
        "created_at": now(),
        "updated_at": now(),
    }
    
    existing_stock = await db.warehouse_stock.find(
        {"location_id": location_id, "quantity": {"$gt": 0}}, {"_id": 0}
    ).to_list(500) if location_id else []
    
    for stock in existing_stock:
        opname["items"].append({
            "id": new_id(),
            "sku": stock.get("sku", ""),
            "product_name": stock.get("product_name", ""),
            "material_id": stock.get("material_id") or None,
            "system_qty": stock.get("quantity", 0),
            "counted_qty": 0,
            "variance": 0,
            "unit": stock.get("unit", "pcs"),
        })
    
    await db.warehouse_opname.insert_one(opname)
    await log_activity(user["id"], user["name"], "create", "warehouse_opname", f"Opname {opname_number}")
    return serialize_doc(opname)


@router.put("/opname/{opname_id}")
async def update_opname(opname_id: str, request: Request):
    user = await require_auth(request)
    db = get_db()
    
    existing = await db.warehouse_opname.find_one({"id": opname_id})
    if not existing:
        raise HTTPException(404, "Opname not found")
    
    body = await request.json()
    updates = {}
    
    if "items" in body:
        items = body["items"]
        for item in items:
            # B3 Fix: accept physical_qty (frontend field) as alias for counted_qty (backend field)
            if "physical_qty" in item and "counted_qty" not in item:
                item["counted_qty"] = float(item.get("physical_qty") or 0)
            elif "physical_qty" in item:
                item["counted_qty"] = float(item.get("physical_qty") or item.get("counted_qty") or 0)
            item["variance"] = float(item.get("counted_qty", 0)) - float(item.get("system_qty", 0))
            # Also keep discrepancy in sync (frontend uses this field name)
            item["discrepancy"] = item["variance"]
        updates["items"] = items
    
    if "status" in body:
        new_status = body["status"]
        updates["status"] = new_status
        # B3 Fix: treat "adjusted" or "approved" as completion trigger (frontend never sends "completed")
        trigger_completion = new_status in ("completed", "adjusted", "approved")
        
        if trigger_completion and existing.get("status") not in ("completed", "adjusted", "approved"):
            items = updates.get("items") or existing.get("items", [])
            # Batch prefetch warehouse_stock rows for all (loc, sku) pairs with variance
            opname_loc_id = existing.get("location_id", "")
            opname_skus = list({i.get("sku", "") for i in items
                                  if float(i.get("variance", 0)) != 0 and i.get("sku")})
            opname_stock_map = {}
            if opname_skus:
                async for d in db.warehouse_stock.find(
                    {"location_id": opname_loc_id, "sku": {"$in": opname_skus}}
                ):
                    opname_stock_map[d.get("sku")] = d
            for item in items:
                variance = float(item.get("variance", 0))
                if variance != 0:
                    sku = item.get("sku", "")
                    loc_id = existing.get("location_id", "")
                    pname = item.get("product_name", "")
                    unit = item.get("unit", "pcs")
                    material_id = item.get("material_id")
                    
                    stock = opname_stock_map.get(sku)
                    if stock:
                        new_qty = max(0, float(stock.get("quantity", 0)) + variance)
                        await db.warehouse_stock.update_one(
                            {"id": stock["id"]},
                            {"$set": {"quantity": new_qty, "available": new_qty, "updated_at": now()}}
                        )
                    
                    await db.warehouse_movements.insert_one({
                        "id": new_id(), "type": "adjustment",
                        "opname_id": opname_id, "opname_number": existing.get("opname_number", ""),
                        "location_id": loc_id, "location_name": existing.get("location_name", ""),
                        "sku": sku, "product_name": pname,
                        "quantity": variance, "unit": unit,
                        "performed_by": user["name"], "performed_by_id": user["id"],
                        "notes": f"Opname adjustment {existing.get('opname_number', '')}",
                        "created_at": now(),
                    })
                    
                    # ── Sprint 2.4: Post opname variance to GL (if material_id exists) ──
                    if material_id:
                        try:
                            # Sync to material stock
                            await _sync_to_material_stock(db, material_id, loc_id, variance)
                            
                            # Create material movement for audit trail
                            mv = await _record_material_movement(
                                db, material_id, loc_id, existing.get("location_name", ""),
                                variance, unit, "opname_adjustment",
                                opname_id, existing.get("opname_number", ""),
                                f"Stock Opname {existing.get('opname_number', '')} - Variance: {variance:+.2f}",
                                user,
                            )
                            
                            # Post to GL (Dr/Cr Inventory vs Adjustment Expense)
                            from routes.rahaza_posting import post_inventory_adjust
                            posting_result = await post_inventory_adjust(db, mv, user)
                            
                            logger.info(f"Opname {existing.get('opname_number')} posted to GL: material_id={material_id}, variance={variance}, result={posting_result.get('ok')}")
                        except Exception as e:
                            logger.error(f"Failed to post opname variance to GL: {e}")
                            # Non-fatal: opname tetap completed, GL bisa di-retry manual
                    else:
                        logger.warning(f"Opname item {sku} tidak punya material_id, skip GL posting")
        
        if new_status in ("completed", "adjusted", "approved"):
            updates["completed_at"] = now()
            updates["completed_by"] = user["name"]
    
    updates["updated_at"] = now()
    await db.warehouse_opname.update_one({"id": opname_id}, {"$set": updates})
    updated = await db.warehouse_opname.find_one({"id": opname_id}, {"_id": 0})
    return serialize_doc(updated)


@router.get("/opname/{opname_id}")
async def get_opname(opname_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    opname = await db.warehouse_opname.find_one({"id": opname_id}, {"_id": 0})
    if not opname:
        raise HTTPException(404, "Opname not found")
    return serialize_doc(opname)



# ══════════════════════════════════════════════════════════════════════════════
# PHASE 8A: ASSET CAPITALIZATION DARI GRN
# ══════════════════════════════════════════════════════════════════════════════

async def _capitalize_assets_from_grn(db, receipt_id: str, grn: dict, items: list, user: dict):
    """
    Phase 8A: Auto-create Fixed Assets + GL Posting untuk GRN items dengan item_type='asset'.
    
    Logic:
    1. Detect items dengan item_type='asset'
    2. Create fixed asset record di rahaza_fixed_assets
    3. Auto-post GL: Dr. Fixed Asset / Cr. AP Clearing
    4. Link GRN item dengan asset_id
    """
    from routes.rahaza_posting import post_asset_acquisition
    
    assets_created = []
    
    for item in items:
        # Check if this is an asset item
        if item.get("item_type", "material") != "asset":
            continue
        
        net_qty = float(item.get("received_qty", 0)) - float(item.get("rejected_qty", 0))
        if net_qty <= 0:
            continue
        
        # Get asset parameters
        unit_price = float(item.get("unit_price", 0))
        if unit_price <= 0:
            logger.warning(f"GRN item {item.get('product_name')} is asset but unit_price=0, skipping capitalization")
            continue
        
        total_cost = round(unit_price * net_qty, 2)
        asset_category = item.get("asset_category", "lain-lain")
        
        # Generate asset code
        asset_seq = await db.rahaza_fixed_assets.count_documents({}) + 1
        asset_code = f"FA-{asset_seq:05d}"
        
        # Default useful life per category (months)
        useful_life_map = {
            "tanah": 0,  # No depreciation
            "bangunan": 240,  # 20 years
            "mesin": 120,  # 10 years
            "kendaraan": 60,  # 5 years
            "peralatan": 60,  # 5 years
            "it": 36,  # 3 years
            "furnitur": 60,  # 5 years
            "lain-lain": 60,  # 5 years default
        }
        useful_life = useful_life_map.get(asset_category, 60)
        
        # Create fixed asset
        asset_doc = {
            "id": _uid(),
            "code": asset_code,
            "name": item.get("product_name", "Unnamed Asset"),
            "category": asset_category,
            "serial_number": item.get("serial_number", ""),
            "purchase_date": date.today().isoformat(),
            "purchase_cost": total_cost,
            "residual_value": 0,  # Default: no residual
            "useful_life_months": useful_life,
            "depreciation_method": "straight_line" if useful_life > 0 else "none",
            "status": "active",
            "location": grn.get("location_name", ""),
            "notes": f"Auto-created from GR {grn.get('receipt_number', '')} - {item.get('product_name', '')}",
            "grn_id": receipt_id,
            "grn_number": grn.get("receipt_number", ""),
            "grn_item_id": item.get("id", ""),
            "po_id": grn.get("po_id"),
            "po_number": grn.get("po_number", ""),
            "supplier_name": grn.get("supplier_name", ""),
            "qty_received": net_qty,
            "unit": item.get("unit", "pcs"),
            "created_at": _now(),
            "updated_at": _now(),
            "created_by": user.get("id", "system"),
            "created_by_name": user.get("name", "system"),
        }
        
        await db.rahaza_fixed_assets.insert_one(asset_doc)
        logger.info(f"✅ Fixed asset created: {asset_code} - {asset_doc['name']} (Rp {total_cost:,.0f})")
        
        # Auto-post GL: Dr. Fixed Asset / Cr. AP Clearing
        posting_result = None
        try:
            asset_refresh = await db.rahaza_fixed_assets.find_one({"id": asset_doc["id"]}, {"_id": 0})
            posting_result = await post_asset_acquisition(db, asset_refresh, user)
            logger.info(f"✅ Asset GL posted: {asset_code} - JE {posting_result.get('je_number', 'N/A')}")
        except Exception as e:
            logger.exception(f"Asset GL posting failed for {asset_code}")
            posting_result = {"ok": False, "error": str(e)}
        
        # Update GRN item dengan asset_id
        await db.warehouse_receiving.update_one(
            {"id": receipt_id, "items.id": item.get("id")},
            {"$set": {
                "items.$.asset_id": asset_doc["id"],
                "items.$.asset_code": asset_code,
                "items.$.capitalized": True,
                "items.$.capitalized_at": _now(),
            }}
        )
        
        assets_created.append({
            "asset_id": asset_doc["id"],
            "asset_code": asset_code,
            "asset_name": asset_doc["name"],
            "total_cost": total_cost,
            "posting_result": posting_result,
        })
    
    if assets_created:
        logger.info(f"🎯 Phase 8A: {len(assets_created)} fixed assets capitalized from GR {grn.get('receipt_number', '')}")
    
    return assets_created

