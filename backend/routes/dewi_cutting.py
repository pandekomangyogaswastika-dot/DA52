"""
CV. Dewi Aditya Official — Cutting Process Management

Collections:
  - dewi_cutting_requests — Request cutting dari SPV Packing / Admin
  - dewi_cutting_batches  — Batch cutting yang sudah dieksekusi

Endpoints (all under /api/dewi/cutting):
  GET  /requests              — list cutting requests
  POST /requests              — buat request baru (Pydantic-validated)
  PUT  /requests/{id}/approve — approve request (owner/admin)
  PUT  /requests/{id}/reject  — reject request
  GET  /batches               — list cutting batches
  POST /batches               — buat batch dari approved request (Pydantic-validated)
  PUT  /batches/{id}/status   — update status batch
  POST /batches/{id}/reject-roll — tambah reject roll ke batch
  GET  /summary               — stats untuk dashboard
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional, List, Any, Dict
from datetime import date
from database import get_db
from auth import require_auth, serialize_doc, log_activity
from utils.helpers import _uid, _now, _next_code, user_display_name

router = APIRouter(prefix="/api/dewi/cutting", tags=["dewi-cutting"])

# ══════════════════════════════════════════════════════════════════════════════
# PYDANTIC MODELS
# ══════════════════════════════════════════════════════════════════════════════

class CuttingRequestIn(BaseModel):
    product_model_name: str = Field(..., min_length=1, description="Nama produk")
    product_category: str = Field(default='', description="Kategori: Rok/Blouse/Dress/dll")
    qty_requested: int = Field(..., ge=1, description="Qty minimal 1 pcs")
    colors: List[str] = Field(default_factory=list)
    priority: str = Field(default='normal', description='low|normal|high|urgent')
    notes: str = Field(default='')


class RejectReasonIn(BaseModel):
    reason: str = Field(default='', description="Alasan penolakan")


class CuttingBatchIn(BaseModel):
    product_model_name: str = Field(..., min_length=1)
    product_category: str = Field(default='')
    total_cut_pcs: int = Field(..., ge=1, description="Total pcs yang dipotong minimal 1")
    qty_per_color: List[Dict[str, Any]] = Field(default_factory=list, description="[{color, qty}]")
    fabric_rolls_used: List[Dict[str, Any]] = Field(default_factory=list)
    request_id: str = Field(default='')
    request_code: str = Field(default='')
    cutting_date: Optional[str] = None
    operator_name: str = Field(default='')
    spv_name: str = Field(default='')
    notes: str = Field(default='')
    # PHASE 2: Production tracking
    wo_id: str = Field(default='', description="Work Order ID (if from WO)")
    production_order_id: str = Field(default='', description="Production Order ID (if from PO)")


class BatchStatusIn(BaseModel):
    status: str = Field(..., description="in_cutting|cut_done|assigned_to_cmt|cancelled")


class RejectRollIn(BaseModel):
    roll_code: str = Field(default='')
    fabric_name: str = Field(default='')
    reason: str = Field(default='')
    action: str = Field(default='klaim_supplier', description='klaim_supplier|lanjut_potong|buang')


class BatchUpdateIn(BaseModel):
    operator_name: Optional[str] = None
    spv_name: Optional[str] = None
    cutting_date: Optional[str] = None
    fabric_rolls_used: Optional[List[Dict[str, Any]]] = None
    total_cut_pcs: Optional[int] = None
    qty_per_color: Optional[List[Dict[str, Any]]] = None
    notes: Optional[str] = None


# ══════════════════════════════════════════════════════════════════════════════
# REQUEST CUTTING
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/requests")
async def list_cutting_requests(status: str = None, skip: int = 0, limit: int = 100, user: dict = Depends(require_auth)):
    db = get_db()
    filt = {}
    if status and status != 'all':
        filt['status'] = status
    cursor = db.dewi_cutting_requests.find(filt).sort('created_at', -1).skip(skip).limit(limit)
    return [serialize_doc(d) async for d in cursor]


@router.post("/requests")
async def create_cutting_request(payload: CuttingRequestIn, user: dict = Depends(require_auth)):
    db = get_db()
    code = await _next_code(db, 'CUT', 'dewi_cutting_requests', 'request_code')
    doc = {
        'id': _uid(),
        'request_code': code,
        'request_date': _now(),
        'requested_by': user_display_name(user),
        'requested_by_id': user.get('id', ''),
        **payload.dict(),
        'status': 'pending_approval',
        'approved_by': None,
        'approved_at': None,
        'rejected_by': None,
        'rejected_reason': '',
        'created_at': _now(),
        'updated_at': _now(),
    }
    await db.dewi_cutting_requests.insert_one(doc)
    await log_activity(user.get('id', ''), user_display_name(user), 'create', 'dewi_cutting_requests', f"Buat request cutting {code} — {doc['product_model_name']} {doc['qty_requested']} pcs")
    return serialize_doc(doc)


@router.put("/requests/{req_id}/approve")
async def approve_cutting_request(req_id: str, user: dict = Depends(require_auth)):
    db = get_db()
    doc = await db.dewi_cutting_requests.find_one({'id': req_id})
    if not doc:
        raise HTTPException(404, 'Request tidak ditemukan')
    if doc['status'] not in ('pending_approval',):
        raise HTTPException(400, f"Tidak bisa approve status: {doc['status']}")

    update = {
        'status': 'approved',
        'approved_by': user_display_name(user),
        'approved_at': _now(),
        'updated_at': _now(),
    }
    await db.dewi_cutting_requests.update_one({'id': req_id}, {'$set': update})
    await log_activity(user.get('id', ''), user_display_name(user), 'approve', 'dewi_cutting_requests', f"Approve request cutting {doc['request_code']}")
    return {'status': 'approved'}


@router.put("/requests/{req_id}/reject")
async def reject_cutting_request(req_id: str, payload: RejectReasonIn, user: dict = Depends(require_auth)):
    db = get_db()
    doc = await db.dewi_cutting_requests.find_one({'id': req_id})
    if not doc:
        raise HTTPException(404, 'Request tidak ditemukan')

    await db.dewi_cutting_requests.update_one({'id': req_id}, {'$set': {
        'status': 'rejected',
        'rejected_by': user_display_name(user),
        'rejected_reason': payload.reason,
        'updated_at': _now(),
    }})
    await log_activity(user.get('id', ''), user_display_name(user), 'reject', 'dewi_cutting_requests', f"Reject request cutting {doc['request_code']}")
    return {'status': 'rejected'}


# ══════════════════════════════════════════════════════════════════════════════
# BATCH CUTTING
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/batches")
async def list_cutting_batches(status: str = None, skip: int = 0, limit: int = 100, user: dict = Depends(require_auth)):
    db = get_db()
    filt = {}
    if status and status != 'all':
        filt['status'] = status
    cursor = db.dewi_cutting_batches.find(filt).sort('created_at', -1).skip(skip).limit(limit)
    return [serialize_doc(d) async for d in cursor]


@router.post("/batches")
async def create_cutting_batch(payload: CuttingBatchIn, user: dict = Depends(require_auth)):
    db = get_db()
    code = await _next_code(db, 'BCH', 'dewi_cutting_batches', 'batch_code')

    # If linked to a request, update request status
    if payload.request_id:
        await db.dewi_cutting_requests.update_one(
            {'id': payload.request_id},
            {'$set': {'status': 'in_cutting', 'updated_at': _now()}}
        )

    body = payload.dict()
    body['spv_name'] = body.get('spv_name') or user_display_name(user)
    body['cutting_date'] = body.get('cutting_date') or date.today().isoformat()

    doc = {
        'id': _uid(),
        'batch_code': code,
        **body,
        'rejected_rolls': [],
        'cmt_assignments': [],
        'status': 'in_cutting',
        'created_at': _now(),
        'updated_at': _now(),
    }
    await db.dewi_cutting_batches.insert_one(doc)
    await log_activity(user.get('id', ''), user_display_name(user), 'create', 'dewi_cutting_batches', f"Buat batch cutting {code} — {doc['product_model_name']} {doc['total_cut_pcs']} pcs")
    return serialize_doc(doc)


@router.put("/batches/{batch_id}/status")
async def update_batch_status(batch_id: str, payload: BatchStatusIn, user: dict = Depends(require_auth)):
    db = get_db()
    doc = await db.dewi_cutting_batches.find_one({'id': batch_id})
    if not doc:
        raise HTTPException(404, 'Batch tidak ditemukan')

    VALID = ['in_cutting', 'cut_done', 'assigned_to_cmt', 'cancelled']
    if payload.status not in VALID:
        raise HTTPException(400, f"Status tidak valid. Pilihan: {VALID}")

    update = {'status': payload.status, 'updated_at': _now()}
    
    # PHASE 2: If marking cut_done → create WIP in rahaza_material_stock
    if payload.status == 'cut_done':
        # Update linked request status
        if doc.get('request_id'):
            await db.dewi_cutting_requests.update_one(
                {'id': doc['request_id']},
                {'$set': {'status': 'done', 'updated_at': _now()}}
            )
        
        # Create WIP entry in unified inventory (rahaza_material_stock)
        total_pcs = doc.get('total_cut_pcs', 0)
        if total_pcs > 0:
            material_id = f"WIP-{doc['batch_code']}"
            product_name = doc.get('product_model_name', 'Unknown')
            category = doc.get('product_category', '')
            
            # Check if WIP already exists (idempotency)
            existing_wip = await db.rahaza_material_stock.find_one({
                "material_id": material_id,
                "ownership": "cv_da",
                "inventory_category": "wip_internal"
            })
            
            if not existing_wip:
                await db.rahaza_material_stock.insert_one({
                    "id": _uid(),
                    "material_id": material_id,
                    "material_name": f"WIP - {product_name} ({category})",
                    "material_code": doc.get('batch_code', ''),
                    "type": "wip",
                    "category": "wip_internal",
                    "inventory_category": "wip_internal",
                    "ownership": "cv_da",
                    "maklon_client_id": None,
                    "quantity": total_pcs,
                    "available_quantity": total_pcs,
                    "reserved_quantity": 0,
                    "unit": "pcs",
                    "location": "wip_cutting",
                    "wo_id": doc.get('wo_id', ''),
                    "production_order_id": doc.get('production_order_id', ''),
                    "batch_code": doc['batch_code'],
                    "notes": f"WIP from cutting batch {doc['batch_code']} - {total_pcs} pcs",
                    "created_at": _now(),
                    "updated_at": _now(),
                    "created_by": user.get('name', 'system')
                })
                
                # Log material movement for audit trail
                await log_activity(
                    user.get('id', ''), 
                    user_display_name(user), 
                    'wip_created', 
                    'rahaza_material_stock', 
                    f"WIP created from cutting batch {doc['batch_code']} - {total_pcs} pcs → rahaza_material_stock"
                )
    await db.dewi_cutting_batches.update_one({'id': batch_id}, {'$set': update})
    await log_activity(user.get('id', ''), user_display_name(user), 'update_status', 'dewi_cutting_batches', f"Update status batch {doc['batch_code']} → {payload.status}")
    return {'status': payload.status}


@router.post("/batches/{batch_id}/reject-roll")
async def add_reject_roll(batch_id: str, payload: RejectRollIn, user: dict = Depends(require_auth)):
    db = get_db()
    doc = await db.dewi_cutting_batches.find_one({'id': batch_id})
    if not doc:
        raise HTTPException(404, 'Batch tidak ditemukan')

    reject_entry = {
        'id': _uid(),
        **payload.dict(),
        'reported_by': user_display_name(user),
        'reported_at': _now().isoformat(),
    }
    await db.dewi_cutting_batches.update_one(
        {'id': batch_id},
        {'$push': {'rejected_rolls': reject_entry}, '$set': {'updated_at': _now()}}
    )
    await log_activity(user.get('id', ''), user_display_name(user), 'reject_roll', 'dewi_cutting_batches', f"Lapor reject roll pada batch {doc['batch_code']}")
    return reject_entry


@router.put("/batches/{batch_id}")
async def update_cutting_batch(batch_id: str, payload: BatchUpdateIn, user: dict = Depends(require_auth)):
    db = get_db()
    doc = await db.dewi_cutting_batches.find_one({'id': batch_id})
    if not doc:
        raise HTTPException(404, 'Batch tidak ditemukan')

    update = {k: v for k, v in payload.dict(exclude_unset=True).items() if v is not None}
    update['updated_at'] = _now()
    await db.dewi_cutting_batches.update_one({'id': batch_id}, {'$set': update})
    return {'status': 'updated'}


# ══════════════════════════════════════════════════════════════════════════════
# SUMMARY
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/summary")
async def cutting_summary(user: dict = Depends(require_auth)):
    db = get_db()
    total_req   = await db.dewi_cutting_requests.count_documents({})
    pending_app = await db.dewi_cutting_requests.count_documents({'status': 'pending_approval'})
    approved    = await db.dewi_cutting_requests.count_documents({'status': 'approved'})
    in_cutting  = await db.dewi_cutting_batches.count_documents({'status': 'in_cutting'})
    cut_done    = await db.dewi_cutting_batches.count_documents({'status': 'cut_done'})
    assigned    = await db.dewi_cutting_batches.count_documents({'status': 'assigned_to_cmt'})
    return {
        'total_requests': total_req,
        'pending_approval': pending_app,
        'approved_requests': approved,
        'in_cutting': in_cutting,
        'cut_done': cut_done,
        'assigned_to_cmt': assigned,
    }
