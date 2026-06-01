"""
CV. Dewi Aditya / Rahaza — AP Invoice from GR + 3-way Match Dashboard
Phase 27 — P2P Flow Completion

Endpoints:
- GET  /api/rahaza/grs/available-for-invoice  — list GRs received but not yet invoiced
- POST /api/rahaza/ap-invoices/from-gr        — create AP Invoice from one or more GRs
- GET  /api/rahaza/3way-match                 — dashboard PO ↔ GR ↔ AP Invoice reconciliation
- GET  /api/rahaza/3way-match/{po_id}         — detail view for one PO

3-way Match Logic:
- For each PO: compute ordered_qty/value, received_qty/value (from GR), invoiced_qty/value (from AP Invoice linked via po_id/gr_id).
- Variance = invoiced - received (qty), or invoiced_amount - (received_qty * po_price).
- Status:
    matched    → all 3 align within tolerance (default 0.5%)
    variance   → variance > tolerance
    over       → invoiced > received (over-billing)
    under      → invoiced < received (under-billing)
    pending    → no invoice yet
"""

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone, date
from database import get_db
from auth import require_auth, serialize_doc, log_activity
from utils.counters import next_counter
import uuid
import logging

log = logging.getLogger(__name__)
router = APIRouter(prefix='/api/rahaza', tags=['rahaza-ap-from-gr'])

VARIANCE_TOLERANCE_PCT = 0.5  # ± 0.5% considered matched


def _uid(): return str(uuid.uuid4())
def _now(): return datetime.now(timezone.utc)
def _today_iso(): return date.today().isoformat()


async def _require_finance(request: Request):
    user = await require_auth(request)
    role = (user.get('role') or '').lower()
    if role in ('superadmin', 'admin', 'owner', 'finance', 'manager', 'accountant'):
        return user
    perms = user.get('_permissions') or []
    if '*' in perms or 'finance.manage' in perms or 'accounting.manage' in perms:
        return user
    raise HTTPException(403, 'Forbidden: butuh permission finance/accounting/manager.')


# ─────────────────────────────────────────────────────────────────────────────
# Number generators
# ─────────────────────────────────────────────────────────────────────────────
async def _gen_ap_number(db) -> str:
    """Generate AP-YYMM-NNNN style number via unified counters SSOT."""
    today = date.today()
    yymm = today.strftime('%y%m')
    seq = await next_counter(db, f'ap_invoice_{yymm}', namespace='rahaza')
    return f'AP-{yymm}-{seq:04d}'


# ─────────────────────────────────────────────────────────────────────────────
# GRs Available for Invoice
# ─────────────────────────────────────────────────────────────────────────────
@router.get('/grs/available-for-invoice')
async def grs_available_for_invoice(
    vendor_name: Optional[str] = None,
    po_id: Optional[str] = None,
    request: Request = None,
):
    """
    List GRs that are received but NOT yet invoiced.
    
    Criteria:
    - status in ('received', 'completed', 'partial_received') — GR sudah dikerjakan
    - At least one item has received_qty > 0
    - GR doc has no `ap_invoice_id` field yet (not yet invoiced)
    
    Filters: vendor_name, po_id.
    """
    await _require_finance(request)
    db = get_db()
    q: Dict[str, Any] = {
        'status': {'$in': ['received', 'completed', 'partial_received']},
        '$or': [
            {'ap_invoice_id': {'$exists': False}},
            {'ap_invoice_id': None},
            {'ap_invoice_id': ''},
        ]
    }
    if vendor_name:
        q['supplier_name'] = {'$regex': vendor_name, '$options': 'i'}
    if po_id:
        q['po_id'] = po_id

    grs = await db.warehouse_receiving.find(q, {'_id': 0}).sort('created_at', -1).limit(200).to_list(200)

    out = []
    for gr in grs:
        items = gr.get('items') or []
        total_received = sum(float(i.get('received_qty', 0) or 0) for i in items)
        if total_received <= 0:
            # Skip GR with no actual received qty (might still be a draft)
            continue
        total_rejected = sum(float(i.get('rejected_qty', 0) or 0) for i in items)
        total_net = total_received - total_rejected
        # Compute receivable amount = sum(received_qty * unit_cost) for net items
        receivable_amount = sum(
            float(i.get('received_qty', 0) or 0) * float(i.get('unit_cost', 0) or 0)
            - float(i.get('rejected_qty', 0) or 0) * float(i.get('unit_cost', 0) or 0)
            for i in items
        )
        out.append({
            'id': gr['id'],
            'receipt_number': gr.get('receipt_number'),
            'po_id': gr.get('po_id'),
            'po_number': gr.get('po_number'),
            'supplier_name': gr.get('supplier_name'),
            'status': gr.get('status'),
            'received_at': gr.get('received_at') or gr.get('completed_at') or gr.get('updated_at'),
            'items_count': len(items),
            'total_expected': sum(float(i.get('expected_qty', 0) or 0) for i in items),
            'total_received': total_received,
            'total_rejected': total_rejected,
            'total_net': total_net,
            'receivable_amount': round(receivable_amount, 2),
        })
    return {'total': len(out), 'items': serialize_doc(out)}


# ─────────────────────────────────────────────────────────────────────────────
# Create AP Invoice from GR(s)
# ─────────────────────────────────────────────────────────────────────────────
class CreateAPFromGRItem(BaseModel):
    gr_item_id: str
    invoiced_qty: float = Field(..., gt=0)
    unit_price: Optional[float] = None  # Override price; default = GR unit_cost
    description: Optional[str] = None


class CreateAPFromGRPayload(BaseModel):
    gr_ids: List[str] = Field(..., min_length=1)
    items_override: Optional[List[CreateAPFromGRItem]] = None  # optional partial invoicing
    tax_pct: Optional[float] = 0.0
    issue_date: Optional[str] = None
    due_date: Optional[str] = None
    notes: Optional[str] = None
    payment_terms: Optional[str] = None


@router.post('/ap-invoices/from-gr', status_code=201)
async def create_ap_invoice_from_gr(payload: CreateAPFromGRPayload, request: Request):
    """
    Create AP Invoice from one or more Goods Receipts.

    Workflow:
    1. Validate all GRs exist, status received/completed, not yet invoiced, same vendor.
    2. Build invoice lines from GR.items (received_qty - rejected_qty) × unit_cost.
    3. If `items_override` provided, only invoice those specific lines with custom qty/price.
    4. Create AP Invoice in `rahaza_ap_invoices` with status='draft', linkages to PO + GR(s).
    5. Mark all GRs with ap_invoice_id, ap_invoice_number, invoiced_at.

    Returns the new AP invoice doc.
    """
    user = await _require_finance(request)
    db = get_db()

    grs = await db.warehouse_receiving.find(
        {'id': {'$in': payload.gr_ids}}, {'_id': 0}
    ).to_list(length=len(payload.gr_ids))
    found_ids = {g['id'] for g in grs}
    missing = set(payload.gr_ids) - found_ids
    if missing:
        raise HTTPException(404, f'GR tidak ditemukan: {sorted(missing)}')

    # Validate all GRs: status, not yet invoiced, same vendor
    vendor_name = None
    po_ids = set()
    po_numbers = set()
    for gr in grs:
        if gr.get('status') not in ('received', 'completed', 'partial_received'):
            raise HTTPException(400, f"GR {gr.get('receipt_number')} status '{gr.get('status')}' belum siap di-invoice.")
        if gr.get('ap_invoice_id'):
            raise HTTPException(400, f"GR {gr.get('receipt_number')} sudah memiliki AP Invoice {gr.get('ap_invoice_number')}.")
        gr_vendor = (gr.get('supplier_name') or '').strip()
        if not gr_vendor:
            raise HTTPException(400, f"GR {gr.get('receipt_number')} tidak ada supplier_name.")
        if vendor_name is None:
            vendor_name = gr_vendor
        elif vendor_name.lower() != gr_vendor.lower():
            raise HTTPException(400, f'GRs harus dari supplier yang sama. Mismatch: {vendor_name} vs {gr_vendor}.')
        if gr.get('po_id'):
            po_ids.add(gr['po_id'])
        if gr.get('po_number'):
            po_numbers.add(gr['po_number'])

    if not vendor_name:
        raise HTTPException(400, 'Vendor tidak teridentifikasi dari GRs.')

    # Build override map if provided
    override_map = {it.gr_item_id: it for it in (payload.items_override or [])}

    # Build invoice items
    inv_items: List[Dict[str, Any]] = []
    for gr in grs:
        for li in (gr.get('items') or []):
            li_id = li.get('id') or li.get('po_item_id')
            received_qty = float(li.get('received_qty', 0) or 0)
            rejected_qty = float(li.get('rejected_qty', 0) or 0)
            net_qty = received_qty - rejected_qty
            unit_cost = float(li.get('unit_cost', 0) or 0)

            if override_map:
                # Only invoice items in override map
                if li_id not in override_map:
                    continue
                ov = override_map[li_id]
                inv_qty = ov.invoiced_qty
                inv_price = ov.unit_price if ov.unit_price is not None else unit_cost
                inv_desc = ov.description or li.get('material_name') or li.get('product_name') or ''
            else:
                if net_qty <= 0:
                    continue
                inv_qty = net_qty
                inv_price = unit_cost
                inv_desc = li.get('material_name') or li.get('product_name') or 'Item'

            amt = round(inv_qty * inv_price, 2)
            inv_items.append({
                'id': _uid(),
                'gr_id': gr['id'],
                'gr_number': gr.get('receipt_number'),
                'gr_item_id': li_id,
                'po_item_id': li.get('po_item_id'),
                'material_id': li.get('material_id'),
                'material_name': li.get('material_name') or li.get('product_name'),
                'description': inv_desc,
                'unit': li.get('unit') or 'pcs',
                'qty': inv_qty,
                'price': inv_price,
                'amount': amt,
            })

    if not inv_items:
        raise HTTPException(400, 'Tidak ada item yang bisa di-invoice (semua sudah di-invoice / quantity 0).')

    subtotal = sum(it['amount'] for it in inv_items)
    tax_pct = float(payload.tax_pct or 0)
    tax_amount = round(subtotal * tax_pct / 100, 2)
    total = round(subtotal + tax_amount, 2)

    # Determine vendor_code from PO if available
    vendor_code = ''
    if po_ids:
        po_doc = await db.rahaza_purchase_orders.find_one({'id': {'$in': list(po_ids)}}, {'_id': 0, 'vendor_code': 1})
        if po_doc:
            vendor_code = po_doc.get('vendor_code', '')

    invoice_number = await _gen_ap_number(db)
    doc = {
        'id': _uid(),
        'invoice_number': invoice_number,
        'vendor_name': vendor_name,
        'vendor_code': vendor_code,
        'issue_date': payload.issue_date or _today_iso(),
        'due_date': payload.due_date or _today_iso(),
        'items': inv_items,
        'subtotal': round(subtotal, 2),
        'tax_pct': tax_pct,
        'tax_amount': tax_amount,
        'total': total,
        'paid_amount': 0,
        'balance': total,
        'status': 'draft',
        'notes': payload.notes or f'Auto-created from GR(s) {", ".join(sorted(gr.get("receipt_number","") for gr in grs))}',
        'payment_terms': payload.payment_terms,
        # P2P 3-way match linkage
        'source': 'gr',
        'gr_ids': sorted([gr['id'] for gr in grs]),
        'gr_numbers': sorted([gr.get('receipt_number', '') for gr in grs]),
        'po_ids': sorted(po_ids),
        'po_numbers': sorted(po_numbers),
        'created_at': _now(),
        'updated_at': _now(),
        'created_by': user['id'],
        'created_by_name': user.get('name', ''),
    }
    await db.rahaza_ap_invoices.insert_one(doc)

    # Stamp ap_invoice_id on all GRs
    await db.warehouse_receiving.update_many(
        {'id': {'$in': payload.gr_ids}},
        {'$set': {
            'ap_invoice_id': doc['id'],
            'ap_invoice_number': invoice_number,
            'invoiced_at': _now(),
            'updated_at': _now(),
        }}
    )

    await log_activity(
        user['id'], user.get('name', ''),
        'create_from_gr', 'rahaza_ap_invoices',
        f'Buat AP Invoice {invoice_number} dari {len(grs)} GR. Total Rp {int(total):,}',
    )
    return serialize_doc(doc)


# ─────────────────────────────────────────────────────────────────────────────
# 3-way Match Dashboard
# ─────────────────────────────────────────────────────────────────────────────
@router.get('/3way-match')
async def three_way_match_dashboard(
    request: Request,
    status: Optional[str] = Query(None, description='Filter: matched|variance|over|under|pending'),
    vendor_name: Optional[str] = None,
    limit: int = Query(100, le=500),
):
    """
    PO ↔ GR ↔ AP Invoice reconciliation dashboard.
    
    Returns one row per PO with:
    - po_id, po_number, vendor_name, total_value (ordered)
    - gr_count, total_received_qty, total_received_value
    - invoice_count, total_invoiced_value, total_paid
    - qty_variance, value_variance, variance_pct
    - status (matched / variance / over / under / pending)
    """
    await _require_finance(request)
    db = get_db()

    po_query: Dict[str, Any] = {
        'status': {'$in': ['approved', 'partially_received', 'fully_received']}
    }
    if vendor_name:
        po_query['vendor_name'] = {'$regex': vendor_name, '$options': 'i'}

    pos = await db.rahaza_purchase_orders.find(
        po_query, {'_id': 0}
    ).sort('po_date', -1).limit(limit).to_list(limit)

    rows = []
    for po in pos:
        po_id = po['id']
        items = po.get('items', []) or []
        total_ordered_qty = sum(float(it.get('qty_ordered', 0) or 0) for it in items)
        # Compute ordered_value: prefer doc field, fallback to summed line subtotals (handles older POs without total_value)
        total_ordered_value = float(po.get('total_value', 0) or 0)
        if total_ordered_value <= 0 and items:
            total_ordered_value = sum(
                float(it.get('subtotal', 0) or 0) or (float(it.get('qty_ordered', 0) or 0) * float(it.get('unit_cost', 0) or 0))
                for it in items
            )

        # GRs
        grs = await db.warehouse_receiving.find(
            {'po_id': po_id, 'status': {'$in': ['received', 'completed', 'partial_received']}},
            {'_id': 0}
        ).to_list(length=200)
        gr_count = len(grs)
        total_received_qty = 0.0
        total_received_value = 0.0
        for gr in grs:
            for li in (gr.get('items') or []):
                rq = float(li.get('received_qty', 0) or 0)
                rj = float(li.get('rejected_qty', 0) or 0)
                uc = float(li.get('unit_cost', 0) or 0)
                total_received_qty += rq - rj
                total_received_value += (rq - rj) * uc

        # AP Invoices linked
        invoices = await db.rahaza_ap_invoices.find(
            {'po_ids': po_id, 'status': {'$ne': 'cancelled'}},
            {'_id': 0}
        ).to_list(length=200)
        invoice_count = len(invoices)
        total_invoiced_qty = 0.0
        total_invoiced_value = 0.0
        total_paid = 0.0
        for inv in invoices:
            total_invoiced_value += float(inv.get('total', 0) or 0)
            total_paid += float(inv.get('paid_amount', 0) or 0)
            for li in (inv.get('items') or []):
                total_invoiced_qty += float(li.get('qty', 0) or 0)

        # Variance
        qty_variance = round(total_invoiced_qty - total_received_qty, 4)
        value_variance = round(total_invoiced_value - total_received_value, 2)
        variance_pct = (
            (value_variance / total_received_value * 100) if total_received_value > 0 else 0
        )

        if invoice_count == 0:
            match_status = 'pending'
        elif abs(variance_pct) <= VARIANCE_TOLERANCE_PCT:
            match_status = 'matched'
        elif value_variance > 0:
            match_status = 'over'
        else:
            match_status = 'under'

        if status and status != match_status:
            continue

        rows.append({
            'po_id': po_id,
            'po_number': po.get('po_number'),
            'po_date': po.get('po_date'),
            'vendor_name': po.get('vendor_name'),
            'vendor_code': po.get('vendor_code', ''),
            'po_status': po.get('status'),
            'total_ordered_qty': round(total_ordered_qty, 4),
            'total_ordered_value': round(total_ordered_value, 2),
            'gr_count': gr_count,
            'total_received_qty': round(total_received_qty, 4),
            'total_received_value': round(total_received_value, 2),
            'invoice_count': invoice_count,
            'total_invoiced_qty': round(total_invoiced_qty, 4),
            'total_invoiced_value': round(total_invoiced_value, 2),
            'total_paid': round(total_paid, 2),
            'qty_variance': qty_variance,
            'value_variance': value_variance,
            'variance_pct': round(variance_pct, 2),
            'match_status': match_status,
        })

    # Summary KPIs
    kpis = {
        'total_pos': len(rows),
        'matched': sum(1 for r in rows if r['match_status'] == 'matched'),
        'pending': sum(1 for r in rows if r['match_status'] == 'pending'),
        'variance': sum(1 for r in rows if r['match_status'] in ('over', 'under')),
        'over': sum(1 for r in rows if r['match_status'] == 'over'),
        'under': sum(1 for r in rows if r['match_status'] == 'under'),
        'total_ordered_value': round(sum(r['total_ordered_value'] for r in rows), 2),
        'total_received_value': round(sum(r['total_received_value'] for r in rows), 2),
        'total_invoiced_value': round(sum(r['total_invoiced_value'] for r in rows), 2),
        'total_paid': round(sum(r['total_paid'] for r in rows), 2),
    }

    return {'kpis': kpis, 'rows': rows, 'tolerance_pct': VARIANCE_TOLERANCE_PCT}


@router.get('/3way-match/{po_id}')
async def three_way_match_detail(po_id: str, request: Request):
    """Detail line-by-line PO ↔ GR ↔ AP Invoice reconciliation for one PO."""
    await _require_finance(request)
    db = get_db()

    po = await db.rahaza_purchase_orders.find_one({'id': po_id}, {'_id': 0})
    if not po:
        raise HTTPException(404, 'PO tidak ditemukan')

    grs = await db.warehouse_receiving.find({'po_id': po_id}, {'_id': 0}).to_list(length=200)
    invoices = await db.rahaza_ap_invoices.find(
        {'po_ids': po_id, 'status': {'$ne': 'cancelled'}}, {'_id': 0}
    ).to_list(length=200)

    # Per-line breakdown using material_id as key
    po_items = po.get('items') or []
    line_map: Dict[str, Dict[str, Any]] = {}
    for it in po_items:
        key = it.get('material_id') or it.get('id') or it.get('material_code')
        if not key:
            continue
        line_map[key] = {
            'material_id': it.get('material_id'),
            'material_code': it.get('material_code'),
            'material_name': it.get('material_name'),
            'unit': it.get('unit', 'pcs'),
            'po_qty': float(it.get('qty_ordered', 0) or 0),
            'po_unit_cost': float(it.get('unit_cost', 0) or 0),
            'po_subtotal': float(it.get('subtotal', 0) or 0),
            'received_qty': 0,
            'rejected_qty': 0,
            'net_qty': 0,
            'received_value': 0,
            'invoiced_qty': 0,
            'invoiced_amount': 0,
        }

    for gr in grs:
        for li in (gr.get('items') or []):
            key = li.get('material_id') or li.get('po_item_id') or li.get('id')
            if key not in line_map:
                continue
            rq = float(li.get('received_qty', 0) or 0)
            rj = float(li.get('rejected_qty', 0) or 0)
            uc = float(li.get('unit_cost', 0) or 0)
            line_map[key]['received_qty'] += rq
            line_map[key]['rejected_qty'] += rj
            line_map[key]['net_qty'] += rq - rj
            line_map[key]['received_value'] += (rq - rj) * uc

    for inv in invoices:
        for li in (inv.get('items') or []):
            key = li.get('material_id') or li.get('po_item_id')
            if key not in line_map:
                continue
            line_map[key]['invoiced_qty'] += float(li.get('qty', 0) or 0)
            line_map[key]['invoiced_amount'] += float(li.get('amount', 0) or 0)

    # Compute variance + status per line
    lines = []
    for key, ld in line_map.items():
        qty_variance = round(ld['invoiced_qty'] - ld['net_qty'], 4)
        value_variance = round(ld['invoiced_amount'] - ld['received_value'], 2)
        variance_pct = (value_variance / ld['received_value'] * 100) if ld['received_value'] > 0 else 0
        if ld['invoiced_qty'] == 0:
            status = 'pending'
        elif abs(variance_pct) <= VARIANCE_TOLERANCE_PCT:
            status = 'matched'
        elif value_variance > 0:
            status = 'over'
        else:
            status = 'under'
        ld.update({
            'qty_variance': qty_variance,
            'value_variance': value_variance,
            'variance_pct': round(variance_pct, 2),
            'match_status': status,
            'po_subtotal': round(ld['po_subtotal'], 2),
            'received_value': round(ld['received_value'], 2),
            'invoiced_amount': round(ld['invoiced_amount'], 2),
        })
        lines.append(ld)

    return {
        'po': serialize_doc(po),
        'grs': serialize_doc(grs),
        'invoices': serialize_doc(invoices),
        'lines': lines,
        'tolerance_pct': VARIANCE_TOLERANCE_PCT,
    }
