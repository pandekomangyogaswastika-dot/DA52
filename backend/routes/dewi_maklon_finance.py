"""
CV. Dewi Aditya — Finance Integration untuk Maklon
Phase Production-Maklon Overhaul — Phase 4

Menutup gap kritis: Maklon Billing harus masuk Finance GL.

Fungsi:
  post_maklon_ar_invoice(db, po, user)    → Dr AR / Cr Pendapatan Jasa Maklon
  post_cmt_ap_invoice(db, payment, user)  → Dr Biaya CMT / Cr AP Vendor
  post_maklon_ar_payment(db, invoice, movement, user) → Dr Bank / Cr AR

Endpoints:
  POST /api/dewi/maklon/pos/{po_id}/post-ar      → Manual trigger post AR
  POST /api/dewi/maklon/pos/{po_id}/advance-payment → Input DP klien
  POST /api/dewi/cmt/payments/{payment_id}/post-ap   → Post CMT AP ke GL
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime, timezone, date
from database import get_db
from auth import require_auth, serialize_doc, log_activity
from routes.rahaza_posting import _create_posted_je, _find_existing_je
from routes.rahaza_posting_profiles import get_mapping
import uuid
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix='/api/dewi/maklon/finance', tags=['Dewi-Maklon-Finance'])


def _uid(): return str(uuid.uuid4())
def _now(): return datetime.now(timezone.utc)


# ──────────────────────────────────────────────────────────────────────────────
# POSTING HELPERS (shared functions)
# ──────────────────────────────────────────────────────────────────────────────

async def post_maklon_ar_invoice(db, po: dict, user: dict) -> dict:
    """
    Post AR Invoice untuk Maklon PO ke Finance GL.
    Dr Piutang Usaha (AR) / Cr Pendapatan Jasa Maklon
    Idempotent: cek existing JE dulu.
    """
    po_id = po.get('id')
    ar_invoice_id = po.get('ar_invoice_id')
    if not ar_invoice_id:
        return {'ok': False, 'error': 'PO belum punya AR Invoice. Confirm dulu.'}

    source_ref = f'maklon_ar:{ar_invoice_id}'
    existing = await _find_existing_je(db, 'maklon_ar_invoice', source_ref)
    if existing:
        return {'ok': True, 'je_id': existing['id'], 'je_number': existing.get('je_number'), 'already_posted': True}

    mapping = await get_mapping(db, 'maklon_ar_invoice')
    if not mapping:
        # Fallback ke ar_invoice mapping jika maklon_ar_invoice belum ada
        mapping = await get_mapping(db, 'ar_invoice')
    if not mapping:
        return {'ok': False, 'error': 'Posting profile maklon_ar_invoice tidak ditemukan'}

    total = po.get('total_value', 0)
    tax_pct = 0.0  # bisa dikonfigurasi nanti
    tax_amount = round(total * tax_pct / 100, 2)
    revenue_amount = round(total - tax_amount, 2)

    lines = [
        {
            'account_code': mapping.get('debit_ar', '1-1301'),
            'debit': total,
            'credit': 0,
            'description': f'AR Jasa Maklon — {po.get("po_number","")} — {po.get("client_name","")}',
        },
        {
            'account_code': mapping.get('credit_revenue_maklon', mapping.get('credit_revenue', '4-1100')),
            'debit': 0,
            'credit': revenue_amount,
            'description': f'Pendapatan Jasa Maklon — {po.get("po_number","")}',
        },
    ]
    if tax_amount > 0:
        lines.append({
            'account_code': mapping.get('credit_tax_output', '2-1400'),
            'debit': 0,
            'credit': tax_amount,
            'description': f'PPN Keluaran — {po.get("po_number","")}',
        })

    je_date = date.fromisoformat(po.get('po_date') or date.today().isoformat())
    result = await _create_posted_je(
        db,
        je_date=je_date,
        memo=f'AR Jasa Maklon — {po.get("po_number","")} — {po.get("client_name","")}',
        source_module='maklon_ar_invoice',
        source_ref=source_ref,
        lines_raw=lines,
        user=user,
    )
    # Save result to AR Invoice
    if result.get('ok'):
        await db.rahaza_ar_invoices.update_one(
            {'id': ar_invoice_id},
            {'$set': {
                'gl_posted_at': _now(),
                'gl_je_id': result['je_id'],
                'gl_je_number': result['je_number'],
                'status': 'issued',
                'post_error': None,
            }}
        )
        await db.dewi_maklon_pos.update_one(
            {'id': po_id},
            {'$set': {
                'gl_posted_at': _now(),
                'gl_je_id': result['je_id'],
                'gl_je_number': result.get('je_number'),
                'post_error': None,
            }}
        )
    else:
        await db.dewi_maklon_pos.update_one(
            {'id': po_id},
            {'$set': {'post_error': result.get('error'), 'post_error_at': _now()}}
        )
    return result


async def post_cmt_ap_invoice(db, cmt_payment: dict, user: dict) -> dict:
    """
    Post AP Invoice untuk CMT Payment ke Finance GL.
    Dr Biaya Jasa CMT / Cr Hutang Usaha (AP Vendor)
    """
    payment_id = cmt_payment.get('id')
    source_ref = f'cmt_ap:{payment_id}'
    existing = await _find_existing_je(db, 'cmt_ap_invoice', source_ref)
    if existing:
        return {'ok': True, 'je_id': existing['id'], 'je_number': existing.get('je_number'), 'already_posted': True}

    mapping = await get_mapping(db, 'cmt_ap_invoice')
    if not mapping:
        # Fallback
        mapping = await get_mapping(db, 'ap_invoice')
    if not mapping:
        return {'ok': False, 'error': 'Posting profile cmt_ap_invoice tidak ditemukan'}

    total = float(cmt_payment.get('subtotal', 0))
    if total <= 0:
        return {'ok': False, 'error': 'Total CMT payment = 0, tidak bisa di-post'}

    lines = [
        {
            'account_code': mapping.get('debit_cmt_expense', mapping.get('debit_expense_default', '6-2200')),
            'debit': total,
            'credit': 0,
            'description': f'Biaya Jasa CMT — {cmt_payment.get("cmt_name","")} — {cmt_payment.get("payment_number","")}',
        },
        {
            'account_code': mapping.get('credit_ap', '2-1100'),
            'debit': 0,
            'credit': total,
            'description': f'AP CMT Vendor — {cmt_payment.get("cmt_name","")}',
        },
    ]

    # Penalty reduction
    penalty = float(cmt_payment.get('total_penalty', 0))
    if penalty > 0:
        lines[1]['credit'] = round(total - penalty, 2)
        lines.append({
            'account_code': mapping.get('debit_penalty_income', '4-2000'),
            'debit': 0,
            'credit': penalty,
            'description': f'Penalti keterlambatan CMT — {cmt_payment.get("cmt_name","")}',
        })

    je_date = date.fromisoformat(cmt_payment.get('payment_date') or date.today().isoformat())
    result = await _create_posted_je(
        db,
        je_date=je_date,
        memo=f'Biaya CMT — {cmt_payment.get("cmt_name","")} — {cmt_payment.get("payment_number","")}',
        source_module='cmt_ap_invoice',
        source_ref=source_ref,
        lines_raw=lines,
        user=user,
    )
    if result.get('ok'):
        await db.dewi_cmt_payments.update_one(
            {'id': payment_id},
            {'$set': {
                'gl_posted_at': _now(),
                'gl_je_id': result['je_id'],
                'gl_je_number': result.get('je_number'),
                'post_error': None,
            }}
        )
    else:
        await db.dewi_cmt_payments.update_one(
            {'id': payment_id},
            {'$set': {'post_error': result.get('error'), 'post_error_at': _now()}}
        )
    return result


# ──────────────────────────────────────────────────────────────────────────────
# API ENDPOINTS
# ──────────────────────────────────────────────────────────────────────────────

@router.post('/pos/{po_id}/post-ar')
async def post_ar_for_po(po_id: str, user: dict = Depends(require_auth)):
    """Trigger manual post AR Invoice ke Finance GL untuk Maklon PO."""
    db = get_db()
    po = await db.dewi_maklon_pos.find_one({'id': po_id})
    if not po:
        raise HTTPException(404, 'PO tidak ditemukan')
    if po.get('status') == 'draft':
        raise HTTPException(400, 'PO harus di-confirm dulu sebelum post ke Finance')

    result = await post_maklon_ar_invoice(db, po, user)
    if not result.get('ok'):
        raise HTTPException(400, result.get('error', 'Posting gagal'))
    return {
        'status': 'posted',
        'je_id': result.get('je_id'),
        'je_number': result.get('je_number'),
        'already_posted': result.get('already_posted', False),
    }


class AdvancePaymentIn(BaseModel):
    amount: float = Field(..., gt=0)
    payment_date: Optional[str] = None
    notes: Optional[str] = None
    bank_account: Optional[str] = None


@router.post('/pos/{po_id}/advance-payment')
async def record_advance_payment(po_id: str, payload: AdvancePaymentIn, user: dict = Depends(require_auth)):
    """Input DP/Uang Muka dari klien maklon."""
    db = get_db()
    po = await db.dewi_maklon_pos.find_one({'id': po_id})
    if not po:
        raise HTTPException(404, 'PO tidak ditemukan')

    payment_date = payload.payment_date or date.today().isoformat()

    # Finance GL: Dr Bank / Cr Uang Muka Pelanggan (Advance)
    mapping = await get_mapping(db, 'ar_payment')
    if mapping:
        lines = [
            {
                'account_code': mapping.get('debit_cash_default', '1-1101'),
                'debit': payload.amount,
                'credit': 0,
                'description': f'DP Maklon — {po.get("po_number","")} — {po.get("client_name","")}',
            },
            {
                'account_code': '2-1300',  # Uang Muka Pelanggan
                'debit': 0,
                'credit': payload.amount,
                'description': f'Uang Muka Klien Maklon — {po.get("po_number","")}',
            },
        ]
        je_date = date.fromisoformat(payment_date)
        dp_id = _uid()
        je_result = await _create_posted_je(
            db,
            je_date=je_date,
            memo=f'DP Maklon — {po.get("po_number","")} — {po.get("client_name","")}',
            source_module='maklon_advance_payment',
            source_ref=f'dp:{po_id}:{dp_id}',
            lines_raw=lines,
            user=user,
        )
    else:
        je_result = {'ok': False, 'error': 'Posting profile tidak ada'}

    # Update PO advance payment
    await db.dewi_maklon_pos.update_one(
        {'id': po_id},
        {'$inc': {'advance_payment': payload.amount}, '$set': {'updated_at': _now()}}
    )

    # Save DP record
    dp_doc = {
        'id': _uid(),
        'po_id': po_id,
        'po_number': po['po_number'],
        'client_id': po['client_id'],
        'client_name': po['client_name'],
        'amount': payload.amount,
        'payment_date': payment_date,
        'notes': payload.notes or '',
        'bank_account': payload.bank_account or '',
        'gl_je_id': je_result.get('je_id'),
        'gl_je_number': je_result.get('je_number'),
        'post_error': je_result.get('error') if not je_result.get('ok') else None,
        'created_at': _now(),
        'created_by': user.get('id'),
    }
    await db.dewi_maklon_advance_payments.insert_one(dp_doc)
    await log_activity(user.get('id', ''), user.get('name', ''), 'advance_payment', 'dewi_maklon_advance_payments',
                       f'DP Maklon {po.get("po_number")} — Rp {payload.amount:,.0f}')
    return serialize_doc(dp_doc)


@router.post('/cmt-payments/{payment_id}/post-ap')
async def post_ap_for_cmt_payment(payment_id: str, user: dict = Depends(require_auth)):
    """Post AP Invoice untuk pembayaran CMT Vendor ke Finance GL."""
    db = get_db()
    payment = await db.dewi_cmt_payments.find_one({'id': payment_id})
    if not payment:
        raise HTTPException(404, 'CMT Payment tidak ditemukan')

    result = await post_cmt_ap_invoice(db, payment, user)
    if not result.get('ok'):
        raise HTTPException(400, result.get('error', 'Posting gagal'))
    return {
        'status': 'posted',
        'je_id': result.get('je_id'),
        'je_number': result.get('je_number'),
        'already_posted': result.get('already_posted', False),
    }
