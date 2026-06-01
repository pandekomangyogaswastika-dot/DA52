"""
CV. Dewi Aditya — Portal Maklon PO (Purchase Order) Management
Phase Production-Maklon Overhaul

Arsitektur Baru:
- 1 PO = banyak items (seri_no, artikel, sku, color, size, qty, cmt_rate)
- 1 PO bisa punya banyak dispatch (partial, bebas urutan)
- PO confirmed → auto-generate WO per item + draft AR Invoice ke Finance

Collections:
- dewi_maklon_pos          : Header PO + embedded items[]
- dewi_maklon_dispatches   : History dispatch per PO (multiple dispatch support)
- dewi_maklon_material_receive : Penerimaan material dari klien
"""
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone, date
from database import get_db
from auth import require_auth, serialize_doc, log_activity
from utils.counters import next_counter
import uuid
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix='/api/dewi/maklon', tags=['Dewi-Maklon-PO'])


def _uid(): return str(uuid.uuid4())
def _now(): return datetime.now(timezone.utc)


# ──────────────────────────────────────────────────────────────────────────────
# COUNTER HELPERS (unified counters SSOT — P3 TD-010)
# ──────────────────────────────────────────────────────────────────────────────
async def _next_po_number(db, client_code: str) -> str:
    year = datetime.now(timezone.utc).year
    seq = await next_counter(db, f'MKL-PO-{client_code}-{year}', namespace='dewi')
    return f'MKL-{client_code}-{year}-{seq:04d}'


async def _next_dispatch_number(db, client_code: str) -> str:
    today = date.today().strftime('%Y%m%d')
    seq = await next_counter(db, f'MKL-DISP-{client_code}-{today}', namespace='dewi')
    return f'DISP-{client_code}-{today}-{seq:03d}'


async def _next_wo_number_maklon(db, po_number: str, idx: int) -> str:
    return f'{po_number}-WO{idx:03d}'


async def _next_ar_invoice_number(db) -> str:
    year = datetime.now(timezone.utc).year
    seq = await next_counter(db, f'AR-MKL-{year}', namespace='dewi')
    return f'INV-MKL-{year}-{seq:04d}'


# ──────────────────────────────────────────────────────────────────────────────
# PYDANTIC MODELS
# ──────────────────────────────────────────────────────────────────────────────
class MaklonPOItemIn(BaseModel):
    seri_no: str = Field(..., description="Nomor seri item (e.g. S01, S02). Bisa sama antar item berbeda.")
    artikel: str = Field(..., description="Kode artikel produk dari buyer")
    sku_code: Optional[str] = Field(None, description="SKU lengkap")
    color: Optional[str] = Field(None, description="Warna")
    size: Optional[str] = Field(None, description="Ukuran")
    qty: int = Field(..., gt=0, description="Quantity pcs")
    cmt_rate_per_pcs: float = Field(default=0, ge=0, description="Harga CMT per pcs (Rp)")
    product_description: Optional[str] = None
    notes: Optional[str] = None


class MaklonPOIn(BaseModel):
    client_id: str = Field(..., description="FK ke dewi_maklon_clients")
    po_date: Optional[str] = Field(None, description="YYYY-MM-DD, default today")
    deadline: Optional[str] = Field(None, description="Target selesai YYYY-MM-DD")
    payment_terms: Optional[str] = Field(default='net_30')
    notes: Optional[str] = None
    items: List[MaklonPOItemIn] = Field(default_factory=list)


class MaklonPOUpdateIn(BaseModel):
    deadline: Optional[str] = None
    payment_terms: Optional[str] = None
    notes: Optional[str] = None
    items: Optional[List[MaklonPOItemIn]] = None


class DispatchItemIn(BaseModel):
    item_id: str = Field(..., description="ID item dari PO.items[]")
    seri_no: str
    artikel: str
    color: Optional[str] = None
    size: Optional[str] = None
    qty_dispatched: int = Field(..., gt=0)


class MaklonDispatchIn(BaseModel):
    po_id: str
    dispatch_date: Optional[str] = None
    driver_name: Optional[str] = None
    vehicle_no: Optional[str] = None
    notes: Optional[str] = None
    items: List[DispatchItemIn] = Field(..., min_length=1)


class MaterialReceiveItemIn(BaseModel):
    material_name: str
    material_category: str = Field(default='fabric', description="fabric | accessories | packaging | other")
    qty: float
    unit: str = Field(default='pcs')
    notes: Optional[str] = None


class MaterialReceiveIn(BaseModel):
    po_id: str
    receive_date: Optional[str] = None
    items: List[MaterialReceiveItemIn] = Field(..., min_length=1)
    notes: Optional[str] = None


# ──────────────────────────────────────────────────────────────────────────────
# MAKLON PO — CRUD
# ──────────────────────────────────────────────────────────────────────────────

@router.get('/pos')
async def list_maklon_pos(
    status: Optional[str] = Query(None),
    client_id: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
    user: dict = Depends(require_auth),
):
    """List semua PO Maklon dengan summary dispatch progress."""
    db = get_db()
    filt = {}
    if status and status != 'all':
        filt['status'] = status
    if client_id:
        filt['client_id'] = client_id
    if search:
        filt['$or'] = [
            {'po_number': {'$regex': search, '$options': 'i'}},
            {'client_name': {'$regex': search, '$options': 'i'}},
        ]
    cursor = db.dewi_maklon_pos.find(filt).sort('created_at', -1).limit(limit)
    pos = [serialize_doc(d) async for d in cursor]

    # Enrich: compute dispatch summary from dewi_maklon_dispatches
    for po in pos:
        dispatches = await db.dewi_maklon_dispatches.find(
            {'po_id': po['id'], 'status': {'$ne': 'cancelled'}}
        ).to_list(length=None)
        qty_dispatched = sum(
            sum(i.get('qty_dispatched', 0) for i in d.get('items', []))
            for d in dispatches
        )
        po['qty_dispatched'] = qty_dispatched
        po['qty_remaining'] = max(0, po.get('total_qty', 0) - qty_dispatched)
        po['dispatch_count'] = len(dispatches)
    return pos


@router.post('/pos')
async def create_maklon_po(payload: MaklonPOIn, user: dict = Depends(require_auth)):
    """Buat PO Maklon baru dengan items/seri."""
    db = get_db()
    client = await db.dewi_maklon_clients.find_one({'id': payload.client_id})
    if not client:
        raise HTTPException(404, 'Klien maklon tidak ditemukan')

    client_code = client.get('code', 'CLT')
    po_number = await _next_po_number(db, client_code)

    # Build items dengan id unik per item
    items = []
    total_qty = 0
    total_value = 0.0
    for idx, it in enumerate(payload.items, start=1):
        item_id = _uid()
        subtotal = it.qty * it.cmt_rate_per_pcs
        items.append({
            'item_id': item_id,
            'idx': idx,
            'seri_no': it.seri_no,
            'artikel': it.artikel,
            'sku_code': it.sku_code or '',
            'color': it.color or '',
            'size': it.size or '',
            'qty': it.qty,
            'qty_produced': 0,
            'qty_dispatched': 0,
            'cmt_rate_per_pcs': it.cmt_rate_per_pcs,
            'subtotal': subtotal,
            'product_description': it.product_description or '',
            'notes': it.notes or '',
            'wo_id': None,
            'wo_number': None,
            'status': 'pending',  # pending|in_production|completed|dispatched
        })
        total_qty += it.qty
        total_value += subtotal

    doc = {
        'id': _uid(),
        'po_number': po_number,
        'client_id': payload.client_id,
        'client_name': client.get('name', ''),
        'client_code': client_code,
        'po_date': payload.po_date or date.today().isoformat(),
        'deadline': payload.deadline,
        'payment_terms': payload.payment_terms or 'net_30',
        'status': 'draft',  # draft|confirmed|in_production|partial_delivered|completed|invoiced|cancelled
        'items': items,
        'total_qty': total_qty,
        'total_value': total_value,
        'notes': payload.notes or '',
        # Finance tracking
        'ar_invoice_id': None,
        'ar_invoice_number': None,
        'payment_status': 'unpaid',
        'advance_payment': 0.0,
        'amount_paid': 0.0,
        # GL tracking
        'gl_posted_at': None,
        'gl_je_id': None,
        'post_error': None,
        'created_at': _now(),
        'updated_at': _now(),
        'created_by': user.get('id'),
        'created_by_name': user.get('name', ''),
    }
    await db.dewi_maklon_pos.insert_one(doc)
    await log_activity(user.get('id', ''), user.get('name', ''), 'create', 'dewi_maklon_pos',
                       f'Buat PO Maklon {po_number} — {client["name"]} — {total_qty} pcs')
    return serialize_doc(doc)


@router.get('/pos/{po_id}')
async def get_maklon_po(po_id: str, user: dict = Depends(require_auth)):
    """Detail PO Maklon termasuk dispatch history dan WO status."""
    db = get_db()
    po = await db.dewi_maklon_pos.find_one({'id': po_id})
    if not po:
        raise HTTPException(404, 'PO tidak ditemukan')
    po = serialize_doc(po)

    # Enrich dispatches
    dispatches = await db.dewi_maklon_dispatches.find(
        {'po_id': po_id}
    ).sort('created_at', -1).to_list(length=None)
    po['dispatches'] = [serialize_doc(d) for d in dispatches]

    # Enrich: qty dispatched per item
    item_dispatch_map = {}
    for d in dispatches:
        if d.get('status') == 'cancelled':
            continue
        for di in d.get('items', []):
            iid = di.get('item_id')
            if iid:
                item_dispatch_map[iid] = item_dispatch_map.get(iid, 0) + di.get('qty_dispatched', 0)
    for item in po.get('items', []):
        iid = item.get('item_id')
        item['qty_dispatched'] = item_dispatch_map.get(iid, 0)
        item['qty_remaining'] = max(0, item.get('qty', 0) - item['qty_dispatched'])

    # Enrich material receives
    receives = await db.dewi_maklon_material_receive.find(
        {'po_id': po_id}
    ).sort('created_at', -1).to_list(length=None)
    po['material_receives'] = [serialize_doc(r) for r in receives]

    # BOM Maklon
    bom = await db.dewi_maklon_bom.find_one({'po_id': po_id})
    po['bom'] = serialize_doc(bom) if bom else None

    # AR Invoice if exists
    if po.get('ar_invoice_id'):
        inv = await db.rahaza_ar_invoices.find_one({'id': po['ar_invoice_id']})
        po['ar_invoice_detail'] = serialize_doc(inv) if inv else None

    total_dispatched = sum(item_dispatch_map.values())
    po['qty_dispatched'] = total_dispatched
    po['qty_remaining'] = max(0, po.get('total_qty', 0) - total_dispatched)

    return po


@router.put('/pos/{po_id}')
async def update_maklon_po(po_id: str, payload: MaklonPOUpdateIn, user: dict = Depends(require_auth)):
    """Update PO (hanya boleh jika masih draft atau confirmed dan belum ada dispatch)."""
    db = get_db()
    po = await db.dewi_maklon_pos.find_one({'id': po_id})
    if not po:
        raise HTTPException(404, 'PO tidak ditemukan')
    if po.get('status') not in ('draft', 'confirmed'):
        raise HTTPException(400, 'PO hanya bisa diubah saat masih draft atau confirmed')

    upd: Dict[str, Any] = {'updated_at': _now()}
    if payload.deadline is not None:
        upd['deadline'] = payload.deadline
    if payload.payment_terms is not None:
        upd['payment_terms'] = payload.payment_terms
    if payload.notes is not None:
        upd['notes'] = payload.notes
    if payload.items is not None:
        # Rebuild items
        items = []
        total_qty = 0
        total_value = 0.0
        for idx, it in enumerate(payload.items, start=1):
            subtotal = it.qty * it.cmt_rate_per_pcs
            items.append({
                'item_id': _uid(),
                'idx': idx,
                'seri_no': it.seri_no,
                'artikel': it.artikel,
                'sku_code': it.sku_code or '',
                'color': it.color or '',
                'size': it.size or '',
                'qty': it.qty,
                'qty_produced': 0,
                'qty_dispatched': 0,
                'cmt_rate_per_pcs': it.cmt_rate_per_pcs,
                'subtotal': subtotal,
                'product_description': it.product_description or '',
                'notes': it.notes or '',
                'wo_id': None,
                'wo_number': None,
                'status': 'pending',
            })
            total_qty += it.qty
            total_value += subtotal
        upd['items'] = items
        upd['total_qty'] = total_qty
        upd['total_value'] = total_value

    await db.dewi_maklon_pos.update_one({'id': po_id}, {'$set': upd})
    return {'status': 'updated'}


@router.post('/pos/{po_id}/confirm')
async def confirm_maklon_po(po_id: str, user: dict = Depends(require_auth)):
    """
    Confirm PO Maklon:
    1. Status → confirmed
    2. Auto-generate Work Order per item
    3. Auto-create Draft AR Invoice di Finance
    """
    db = get_db()
    po = await db.dewi_maklon_pos.find_one({'id': po_id})
    if not po:
        raise HTTPException(404, 'PO tidak ditemukan')
    if po.get('status') != 'draft':
        raise HTTPException(400, f'PO status saat ini: {po["status"]}. Harus draft untuk di-confirm.')
    if not po.get('items'):
        raise HTTPException(400, 'PO harus memiliki minimal 1 item sebelum di-confirm')

    wo_results = []
    for idx, item in enumerate(po.get('items', []), start=1):
        wo_number = await _next_wo_number_maklon(db, po['po_number'], idx)
        wo_id = _uid()
        wo_doc = {
            'id': wo_id,
            'wo_number': wo_number,
            'source': 'maklon',
            'maklon_po_id': po_id,
            'maklon_po_number': po['po_number'],
            'maklon_item_id': item['item_id'],
            'maklon_seri_no': item['seri_no'],
            'artikel': item['artikel'],
            'sku_code': item.get('sku_code', ''),
            'color': item.get('color', ''),
            'size': item.get('size', ''),
            'product_name_snapshot': f"{item['artikel']} {item.get('color','')} {item.get('size','')}".strip(),
            'qty': item['qty'],
            'qty_produced': 0,
            'status': 'draft',
            'client_id': po['client_id'],
            'client_name': po['client_name'],
            'deadline': po.get('deadline'),
            'cmt_rate_per_pcs': item.get('cmt_rate_per_pcs', 0),
            'notes': item.get('notes', ''),
            'created_at': _now(),
            'updated_at': _now(),
            'created_by': user.get('id'),
        }
        await db.rahaza_work_orders.insert_one(wo_doc)
        wo_results.append({'item_id': item['item_id'], 'wo_id': wo_id, 'wo_number': wo_number})

        # Update item with WO reference
        await db.dewi_maklon_pos.update_one(
            {'id': po_id, 'items.item_id': item['item_id']},
            {'$set': {'items.$.wo_id': wo_id, 'items.$.wo_number': wo_number, 'items.$.status': 'in_production'}}
        )

    # Create Draft AR Invoice
    ar_invoice_number = await _next_ar_invoice_number(db)
    ar_invoice_id = _uid()

    lines = []
    for item in po.get('items', []):
        lines.append({
            'line_id': _uid(),
            'description': f"Jasa CMT — {item['artikel']} {item.get('color','')} {item.get('size','')} (Seri {item['seri_no']})".strip(),
            'qty': item['qty'],
            'unit_price': item.get('cmt_rate_per_pcs', 0),
            'subtotal': item['qty'] * item.get('cmt_rate_per_pcs', 0),
            'item_id': item['item_id'],
        })

    ar_doc = {
        'id': ar_invoice_id,
        'invoice_number': ar_invoice_number,
        'source_module': 'maklon_po',
        'linked_maklon_po_id': po_id,
        'linked_maklon_po_number': po['po_number'],
        'customer_id': po['client_id'],
        'customer_name': po['client_name'],
        'invoice_date': date.today().isoformat(),
        'due_date': None,
        'lines': lines,
        'subtotal': po['total_value'],
        'tax_pct': 0.0,
        'tax_amount': 0.0,
        'discount_amount': 0.0,
        'total_amount': po['total_value'],
        'amount_paid': 0.0,
        'amount_due': po['total_value'],
        'status': 'draft',
        'payment_terms': po.get('payment_terms', 'net_30'),
        'notes': f'Auto-generated dari PO {po["po_number"]}',
        'gl_posted_at': None,
        'gl_je_id': None,
        'post_error': None,
        'created_at': _now(),
        'updated_at': _now(),
        'created_by': user.get('id'),
    }
    await db.rahaza_ar_invoices.insert_one(ar_doc)

    # Update PO status
    await db.dewi_maklon_pos.update_one(
        {'id': po_id},
        {'$set': {
            'status': 'confirmed',
            'ar_invoice_id': ar_invoice_id,
            'ar_invoice_number': ar_invoice_number,
            'updated_at': _now(),
        }}
    )

    await log_activity(user.get('id', ''), user.get('name', ''), 'confirm', 'dewi_maklon_pos',
                       f'Confirm PO {po["po_number"]} — {len(wo_results)} WO dibuat, Invoice {ar_invoice_number}')

    return {
        'status': 'confirmed',
        'po_number': po['po_number'],
        'work_orders_created': wo_results,
        'ar_invoice_number': ar_invoice_number,
        'ar_invoice_id': ar_invoice_id,
    }


@router.post('/pos/{po_id}/cancel')
async def cancel_maklon_po(po_id: str, user: dict = Depends(require_auth)):
    """Cancel PO (hanya boleh jika belum ada dispatch terkonfirmasi)."""
    db = get_db()
    po = await db.dewi_maklon_pos.find_one({'id': po_id})
    if not po:
        raise HTTPException(404, 'PO tidak ditemukan')

    # Check dispatches
    dispatched_count = await db.dewi_maklon_dispatches.count_documents(
        {'po_id': po_id, 'status': 'dispatched'}
    )
    if dispatched_count > 0:
        raise HTTPException(400, 'PO sudah ada dispatch terkonfirmasi, tidak bisa di-cancel')

    await db.dewi_maklon_pos.update_one(
        {'id': po_id},
        {'$set': {'status': 'cancelled', 'updated_at': _now()}}
    )
    # Cancel associated WOs
    await db.rahaza_work_orders.update_many(
        {'maklon_po_id': po_id, 'status': 'draft'},
        {'$set': {'status': 'cancelled', 'updated_at': _now()}}
    )
    return {'status': 'cancelled'}


# ──────────────────────────────────────────────────────────────────────────────
# MULTI-DISPATCH
# ──────────────────────────────────────────────────────────────────────────────

@router.get('/pos/{po_id}/dispatches')
async def list_dispatches_by_po(po_id: str, user: dict = Depends(require_auth)):
    """Semua dispatch untuk 1 PO (history lengkap)."""
    db = get_db()
    po = await db.dewi_maklon_pos.find_one({'id': po_id})
    if not po:
        raise HTTPException(404, 'PO tidak ditemukan')
    dispatches = await db.dewi_maklon_dispatches.find(
        {'po_id': po_id}
    ).sort('created_at', -1).to_list(length=None)
    return [serialize_doc(d) for d in dispatches]


@router.post('/dispatches')
async def create_dispatch(payload: MaklonDispatchIn, user: dict = Depends(require_auth)):
    """Buat dispatch baru untuk PO. Bebas pilih item, bebas urutan, boleh partial."""
    db = get_db()
    po = await db.dewi_maklon_pos.find_one({'id': payload.po_id})
    if not po:
        raise HTTPException(404, 'PO tidak ditemukan')
    if po.get('status') not in ('confirmed', 'in_production', 'partial_delivered'):
        raise HTTPException(400, f'PO status {po["status"]} tidak bisa di-dispatch')

    # Validate dispatch qty tidak melebihi sisa
    # Build current dispatched per item
    existing_dispatches = await db.dewi_maklon_dispatches.find(
        {'po_id': payload.po_id, 'status': {'$ne': 'cancelled'}}
    ).to_list(length=None)
    item_dispatched_map = {}
    for d in existing_dispatches:
        for di in d.get('items', []):
            iid = di['item_id']
            item_dispatched_map[iid] = item_dispatched_map.get(iid, 0) + di.get('qty_dispatched', 0)

    po_items_map = {it['item_id']: it for it in po.get('items', [])}

    for di in payload.items:
        po_item = po_items_map.get(di.item_id)
        if not po_item:
            raise HTTPException(400, f'Item ID {di.item_id} tidak ada di PO')
        already_dispatched = item_dispatched_map.get(di.item_id, 0)
        remaining = po_item['qty'] - already_dispatched
        if di.qty_dispatched > remaining:
            raise HTTPException(
                400,
                f"Item {di.artikel} (seri {di.seri_no}): dispatch {di.qty_dispatched} melebihi sisa {remaining} pcs"
            )

    client_code = po.get('client_code', 'CLT')
    dispatch_number = await _next_dispatch_number(db, client_code)
    dispatch_id = _uid()

    dispatch_items = [{
        'item_id': di.item_id,
        'seri_no': di.seri_no,
        'artikel': di.artikel,
        'color': di.color or '',
        'size': di.size or '',
        'qty_dispatched': di.qty_dispatched,
    } for di in payload.items]

    doc = {
        'id': dispatch_id,
        'dispatch_number': dispatch_number,
        'po_id': payload.po_id,
        'po_number': po['po_number'],
        'client_id': po['client_id'],
        'client_name': po['client_name'],
        'dispatch_date': payload.dispatch_date or date.today().isoformat(),
        'driver_name': payload.driver_name or '',
        'vehicle_no': payload.vehicle_no or '',
        'notes': payload.notes or '',
        'items': dispatch_items,
        'total_qty_dispatched': sum(di.qty_dispatched for di in payload.items),
        'status': 'draft',  # draft|packed|dispatched|received_by_client|cancelled
        'do_number': None,
        'fg_scanned_out': False,
        'created_at': _now(),
        'updated_at': _now(),
        'created_by': user.get('id'),
        'created_by_name': user.get('name', ''),
    }
    await db.dewi_maklon_dispatches.insert_one(doc)
    await log_activity(user.get('id', ''), user.get('name', ''), 'create', 'dewi_maklon_dispatches',
                       f'Buat dispatch {dispatch_number} untuk PO {po["po_number"]}')
    return serialize_doc(doc)


@router.put('/dispatches/{dispatch_id}/confirm')
async def confirm_dispatch(dispatch_id: str, user: dict = Depends(require_auth)):
    """
    Konfirmasi dispatch:
    1. Status → dispatched
    2. Update qty_dispatched di PO items
    3. Update PO delivery_status
    4. Kurangi FG inventory (jika ada)
    """
    db = get_db()
    dispatch = await db.dewi_maklon_dispatches.find_one({'id': dispatch_id})
    if not dispatch:
        raise HTTPException(404, 'Dispatch tidak ditemukan')
    if dispatch.get('status') not in ('draft', 'packed'):
        raise HTTPException(400, f'Dispatch status {dispatch["status"]} tidak bisa di-konfirmasi')

    po_id = dispatch['po_id']

    # Update dispatch status
    await db.dewi_maklon_dispatches.update_one(
        {'id': dispatch_id},
        {'$set': {
            'status': 'dispatched',
            'dispatched_at': _now(),
            'dispatched_by': user.get('id'),
            'updated_at': _now(),
        }}
    )

    # Update qty_dispatched per item in PO
    for di in dispatch.get('items', []):
        await db.dewi_maklon_pos.update_one(
            {'id': po_id, 'items.item_id': di['item_id']},
            {'$inc': {'items.$.qty_dispatched': di['qty_dispatched']}}
        )

    # Recalculate PO delivery status
    po = await db.dewi_maklon_pos.find_one({'id': po_id})
    all_dispatches = await db.dewi_maklon_dispatches.find(
        {'po_id': po_id, 'status': 'dispatched'}
    ).to_list(length=None)
    total_dispatched = sum(
        sum(i.get('qty_dispatched', 0) for i in d.get('items', []))
        for d in all_dispatches
    )
    total_qty = po.get('total_qty', 0)
    new_delivery_status = 'completed' if total_dispatched >= total_qty else 'partial_delivered'

    po_update = {
        'updated_at': _now(),
        'status': new_delivery_status if po.get('status') not in ('invoiced', 'cancelled') else po['status'],
    }
    await db.dewi_maklon_pos.update_one({'id': po_id}, {'$set': po_update})

    await log_activity(user.get('id', ''), user.get('name', ''), 'dispatch', 'dewi_maklon_dispatches',
                       f'Konfirmasi dispatch {dispatch["dispatch_number"]} — {dispatch.get("total_qty_dispatched",0)} pcs')
    return {
        'status': 'dispatched',
        'dispatch_number': dispatch['dispatch_number'],
        'total_dispatched': total_dispatched,
        'total_qty': total_qty,
        'po_delivery_status': new_delivery_status,
    }


@router.put('/dispatches/{dispatch_id}/cancel')
async def cancel_dispatch(dispatch_id: str, user: dict = Depends(require_auth)):
    """Cancel dispatch (hanya boleh jika masih draft/packed)."""
    db = get_db()
    dispatch = await db.dewi_maklon_dispatches.find_one({'id': dispatch_id})
    if not dispatch:
        raise HTTPException(404, 'Dispatch tidak ditemukan')
    if dispatch.get('status') not in ('draft', 'packed'):
        raise HTTPException(400, 'Dispatch yang sudah dikirim tidak bisa di-cancel')

    await db.dewi_maklon_dispatches.update_one(
        {'id': dispatch_id},
        {'$set': {'status': 'cancelled', 'updated_at': _now(), 'cancelled_by': user.get('id')}}
    )
    return {'status': 'cancelled'}


@router.get('/dispatches')
async def list_all_dispatches(
    status: Optional[str] = Query(None),
    client_id: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
    user: dict = Depends(require_auth),
):
    """List semua dispatch (cross-PO)."""
    db = get_db()
    filt = {}
    if status and status != 'all':
        filt['status'] = status
    if client_id:
        filt['client_id'] = client_id
    cursor = db.dewi_maklon_dispatches.find(filt).sort('created_at', -1).limit(limit)
    return [serialize_doc(d) async for d in cursor]


# ──────────────────────────────────────────────────────────────────────────────
# MATERIAL RECEIVE DARI KLIEN
# ──────────────────────────────────────────────────────────────────────────────

@router.post('/material-receive')
async def receive_material_from_client(payload: MaterialReceiveIn, user: dict = Depends(require_auth)):
    """
    Terima material dari klien maklon.
    Material masuk ke inventory dengan ownership=maklon_client, category=rm_maklon/wip_maklon.
    """
    db = get_db()
    po = await db.dewi_maklon_pos.find_one({'id': payload.po_id})
    if not po:
        raise HTTPException(404, 'PO tidak ditemukan')

    receive_id = _uid()
    items_received = []
    for it in payload.items:
        _uid()
        # Insert to inventory as maklon_client ownership
        # Category: wip_maklon for fabric (already cut), rm_maklon for others
        category = 'wip_maklon' if it.material_category == 'fabric' else 'rm_maklon'
        inv_movement = {
            'id': _uid(),
            'movement_type': 'receive_maklon',
            'ownership': 'maklon_client',
            'maklon_client_id': po['client_id'],
            'maklon_po_ref': po['po_number'],
            'inventory_category': category,
            'material_name': it.material_name,
            'material_category': it.material_category,
            'qty': it.qty,
            'unit': it.unit,
            'receive_ref_id': receive_id,
            'notes': it.notes or '',
            'created_at': _now(),
            'created_by': user.get('id'),
        }
        await db.dewi_maklon_inventory.insert_one(inv_movement)
        items_received.append(inv_movement)

    receive_doc = {
        'id': receive_id,
        'po_id': payload.po_id,
        'po_number': po['po_number'],
        'client_id': po['client_id'],
        'client_name': po['client_name'],
        'receive_date': payload.receive_date or date.today().isoformat(),
        'items': [{
            'material_name': it.material_name,
            'material_category': it.material_category,
            'qty': it.qty,
            'unit': it.unit,
            'notes': it.notes or '',
        } for it in payload.items],
        'notes': payload.notes or '',
        'received_by': user.get('id'),
        'received_by_name': user.get('name', ''),
        'created_at': _now(),
    }
    await db.dewi_maklon_material_receive.insert_one(receive_doc)
    await log_activity(user.get('id', ''), user.get('name', ''), 'receive_material', 'dewi_maklon_material_receive',
                       f'Terima material maklon untuk PO {po["po_number"]} — {len(payload.items)} item')
    return serialize_doc(receive_doc)


@router.get('/material-receive/{po_id}')
async def list_material_receives(po_id: str, user: dict = Depends(require_auth)):
    """List semua penerimaan material untuk 1 PO."""
    db = get_db()
    docs = await db.dewi_maklon_material_receive.find({'po_id': po_id}).sort('created_at', -1).to_list(length=None)
    return [serialize_doc(d) for d in docs]


# ──────────────────────────────────────────────────────────────────────────────
# BOM MAKLON (DYNAMIC)
# ──────────────────────────────────────────────────────────────────────────────

class BOMItemIn(BaseModel):
    material_name: str
    material_category: str = Field(default='fabric', description="fabric | accessories | packaging | other")
    ownership: str = Field(default='client_provided', description="client_provided | cv_da_stock")
    unit: str = Field(default='pcs')
    qty_estimated: float = Field(..., gt=0)
    qty_actual: Optional[float] = None
    material_id: Optional[str] = None  # FK ke rahaza_materials jika dari stok CV.DA
    notes: Optional[str] = None


class MaklonBOMIn(BaseModel):
    po_id: str
    materials: List[BOMItemIn] = Field(..., min_length=1)
    notes: Optional[str] = None


class MaklonBOMUpdateIn(BaseModel):
    materials: Optional[List[BOMItemIn]] = None
    notes: Optional[str] = None


@router.post('/bom')
async def create_maklon_bom(payload: MaklonBOMIn, user: dict = Depends(require_auth)):
    """Buat BOM Maklon untuk 1 PO. Satu PO hanya 1 BOM aktif."""
    db = get_db()
    po = await db.dewi_maklon_pos.find_one({'id': payload.po_id})
    if not po:
        raise HTTPException(404, 'PO tidak ditemukan')

    existing = await db.dewi_maklon_bom.find_one({'po_id': payload.po_id})
    if existing:
        raise HTTPException(400, 'BOM untuk PO ini sudah ada. Gunakan endpoint update.')

    total_qty = po.get('total_qty', 1) or 1
    materials = []
    for it in payload.materials:
        qty_per_pcs = round(it.qty_estimated / total_qty, 6) if total_qty > 0 else 0
        materials.append({
            'item_id': _uid(),
            'material_name': it.material_name,
            'material_category': it.material_category,
            'ownership': it.ownership,
            'unit': it.unit,
            'qty_estimated': it.qty_estimated,
            'qty_actual': it.qty_actual,
            'qty_per_pcs': qty_per_pcs,
            'material_id': it.material_id,
            'notes': it.notes or '',
        })

    doc = {
        'id': _uid(),
        'po_id': payload.po_id,
        'po_number': po['po_number'],
        'client_id': po['client_id'],
        'total_qty': total_qty,
        'materials': materials,
        'notes': payload.notes or '',
        'created_at': _now(),
        'updated_at': _now(),
        'created_by': user.get('id'),
    }
    await db.dewi_maklon_bom.insert_one(doc)
    return serialize_doc(doc)


@router.get('/bom/{po_id}')
async def get_maklon_bom(po_id: str, user: dict = Depends(require_auth)):
    """Get BOM Maklon untuk 1 PO."""
    db = get_db()
    bom = await db.dewi_maklon_bom.find_one({'po_id': po_id})
    if not bom:
        raise HTTPException(404, 'BOM tidak ditemukan untuk PO ini')
    return serialize_doc(bom)


@router.put('/bom/{po_id}')
async def update_maklon_bom(po_id: str, payload: MaklonBOMUpdateIn, user: dict = Depends(require_auth)):
    """Update BOM Maklon (bisa update estimasi atau isi aktual)."""
    db = get_db()
    bom = await db.dewi_maklon_bom.find_one({'po_id': po_id})
    if not bom:
        raise HTTPException(404, 'BOM tidak ditemukan')

    po = await db.dewi_maklon_pos.find_one({'id': po_id})
    total_qty = (po.get('total_qty', 1) or 1) if po else 1

    upd: Dict[str, Any] = {'updated_at': _now(), 'updated_by': user.get('id')}
    if payload.notes is not None:
        upd['notes'] = payload.notes
    if payload.materials is not None:
        materials = []
        for it in payload.materials:
            qty_per_pcs = round(it.qty_estimated / total_qty, 6) if total_qty > 0 else 0
            materials.append({
                'item_id': _uid(),
                'material_name': it.material_name,
                'material_category': it.material_category,
                'ownership': it.ownership,
                'unit': it.unit,
                'qty_estimated': it.qty_estimated,
                'qty_actual': it.qty_actual,
                'qty_per_pcs': qty_per_pcs,
                'material_id': it.material_id,
                'notes': it.notes or '',
            })
        upd['materials'] = materials
    await db.dewi_maklon_bom.update_one({'po_id': po_id}, {'$set': upd})
    return {'status': 'updated'}


# ──────────────────────────────────────────────────────────────────────────────
# SUMMARY / ANALYTICS
# ──────────────────────────────────────────────────────────────────────────────

@router.get('/pos-summary')
async def maklon_pos_summary(user: dict = Depends(require_auth)):
    """Summary analytics untuk dashboard maklon."""
    db = get_db()
    pipeline = [
        {'$group': {
            '_id': '$status',
            'count': {'$sum': 1},
            'total_qty': {'$sum': '$total_qty'},
            'total_value': {'$sum': '$total_value'},
        }}
    ]
    result = await db.dewi_maklon_pos.aggregate(pipeline).to_list(length=None)
    summary = {
        'by_status': {r['_id']: {'count': r['count'], 'total_qty': r['total_qty'], 'total_value': r['total_value']} for r in result},
        'total_pos': await db.dewi_maklon_pos.count_documents({}),
        'active_pos': await db.dewi_maklon_pos.count_documents({'status': {'$in': ['confirmed', 'in_production', 'partial_delivered']}}),
    }
    return summary
