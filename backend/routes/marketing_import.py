"""
Marketing Smart Excel Import — Phase 4

Endpoints (prefix /api/marketing):
  POST /import/upload                  — multipart upload (CSV/XLSX)
  POST /import/{upload_id}/analyze     — AI column mapping (Emergent LLM)
  PUT  /import/{upload_id}/mapping     — save user-edited mapping
  GET  /import/{upload_id}/preview     — apply mapping + validate (paged)
  POST /import/{upload_id}/execute     — commit data to marketing_sales_data
  POST /import/{import_id}/rollback    — revert import (within 24h)
  GET  /import/history                 — list past imports

Key collections:
  - marketing_import_uploads (file metadata + AI mapping draft + final mapping)
  - marketing_import_history (committed imports + rollback metadata)
"""
from fastapi import APIRouter, Request, HTTPException, UploadFile, File, Form
from database import get_db
from auth import require_auth, serialize_doc, log_activity
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
import uuid
import os
import logging
import io

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/marketing", tags=["marketing-import"])

UPLOAD_DIR = "/app/uploads/marketing-imports"
os.makedirs(UPLOAD_DIR, exist_ok=True)

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
MAX_ROWS = 50_000
ROLLBACK_WINDOW_HOURS = 24

# Target schema fields for sales data import
SYSTEM_FIELDS = {
    "date":             {"label": "Tanggal", "type": "date", "required": True, "desc": "Tanggal transaksi (YYYY-MM-DD)"},
    "revenue":          {"label": "Revenue / Total Penjualan", "type": "number", "required": True, "desc": "Nilai revenue dalam Rupiah"},
    "orders":           {"label": "Jumlah Order", "type": "integer", "required": False, "desc": "Jumlah order/transaksi"},
    "quantity":         {"label": "Jumlah Item / Qty", "type": "integer", "required": False, "desc": "Jumlah item terjual"},
    "aov":              {"label": "Average Order Value", "type": "number", "required": False, "desc": "Rata-rata nilai per order (auto-compute jika kosong)"},
    "gmv":              {"label": "GMV (Gross Merchandise Value)", "type": "number", "required": False, "desc": "GMV"},
    "conversion_rate":  {"label": "Conversion Rate (0-1)", "type": "number", "required": False, "desc": "Conversion rate (decimal 0-1)"},
    "rating":           {"label": "Rating (0-5)", "type": "number", "required": False, "desc": "Rating produk"},
    "product_name":     {"label": "Nama Produk", "type": "string", "required": False, "desc": "Nama produk (untuk order-level)"},
    "sku":              {"label": "SKU", "type": "string", "required": False, "desc": "SKU produk"},
}


def _uid():
    return str(uuid.uuid4())


def _now():
    return datetime.now(timezone.utc)


def _now_iso():
    return _now().isoformat()


def _get_user(request):
    return getattr(request.state, 'user', {"id": "system", "email": "system", "role": "admin"})


def _is_admin_role(user) -> bool:
    role = (user.get("role") or "").lower()
    return role in {"admin", "owner", "superadmin"} or role.startswith("manager_") or role in {"pic_marketing", "pic_toko"}


def _get_llm_key():
    key = os.environ.get("EMERGENT_LLM_KEY")
    if key:
        return key
    raise HTTPException(503, "AI service tidak tersedia. EMERGENT_LLM_KEY belum dikonfigurasi.")


# ─── Pydantic Models ──────────────────────────────────────────────────────────
class MappingItem(BaseModel):
    source_column: str
    target_field: Optional[str] = None  # null = unmapped/skip
    transform: Optional[str] = None      # e.g., "to_decimal", "parse_date"
    confidence: Optional[float] = None   # 0-1


class MappingUpdate(BaseModel):
    mapping: List[MappingItem]
    revenue_type: str = "total"          # "total" or "live"
    aggregation: str = "by_date"         # "by_date" (sum revenue per date) or "row_per_row" (1 row = 1 daily entry)


# ─── Helpers ──────────────────────────────────────────────────────────────────
def _parse_file_to_dataframe(file_bytes: bytes, filename: str):
    """Parse uploaded CSV/XLSX bytes to a pandas DataFrame. Returns (df, file_type)."""
    import pandas as pd
    name = filename.lower()
    try:
        if name.endswith('.csv') or name.endswith('.txt'):
            # try common encodings + delimiters
            for enc in ('utf-8', 'utf-8-sig', 'latin-1'):
                try:
                    df = pd.read_csv(io.BytesIO(file_bytes), encoding=enc, low_memory=False)
                    return df, 'csv'
                except UnicodeDecodeError:
                    continue
            raise ValueError("Tidak dapat membaca CSV (encoding tidak dikenali)")
        elif name.endswith('.xlsx') or name.endswith('.xls'):
            df = pd.read_excel(io.BytesIO(file_bytes), engine='openpyxl' if name.endswith('.xlsx') else None)
            return df, 'xlsx'
        else:
            raise ValueError(f"Format file tidak didukung: {filename}. Gunakan .csv atau .xlsx")
    except Exception as e:
        raise HTTPException(400, f"Gagal membaca file: {str(e)}")


def _df_to_sample(df, max_rows: int = 5):
    """Return dict with headers list + sample row dicts (limited)."""
    headers = [str(c).strip() for c in df.columns.tolist()]
    sample = df.head(max_rows).fillna('').astype(str).to_dict(orient='records')
    return {
        "headers": headers,
        "sample_rows": sample,
        "total_rows": int(len(df)),
    }


async def _llm_column_mapping(headers: List[str], sample_rows: List[dict], system_fields: dict, key: str) -> dict:
    """Call Emergent LLM to suggest column mapping. Returns {mapping, unmapped, confidence}."""
    import json as _json
    from emergentintegrations.llm.chat import LlmChat, UserMessage

    fields_desc = "\n".join([f"- {k}: {v['label']} ({v['type']}, required={v['required']}) — {v['desc']}" for k, v in system_fields.items()])
    headers_str = "\n".join([f"  {i+1}. {h}" for i, h in enumerate(headers)])
    sample_preview = _json.dumps(sample_rows[:3], ensure_ascii=False, indent=2)

    prompt = f"""Anda adalah AI mapper untuk import data penjualan e-commerce (Shopee/TikTok/Tokopedia) ke ERP.

TARGET SYSTEM FIELDS (skema sistem):
{fields_desc}

KOLOM SUMBER (dari file upload user):
{headers_str}

SAMPLE 3 BARIS DATA SUMBER:
{sample_preview}

TUGAS ANDA:
Petakan setiap kolom sumber ke field sistem yang paling sesuai. Berikan confidence score 0-1.
- Jika kolom tidak relevan untuk import sales (misal kolom internal marketplace), set target_field=null.
- "tanggal_pesan" / "order date" / "Tanggal Pesanan" → date
- "total" / "harga total" / "amount" / "grand_total" → revenue
- "jumlah_pesanan" / "order count" → orders
- "qty" / "jumlah" / "quantity" → quantity

Jawab HANYA dalam JSON valid (tanpa markdown ```json), format persis:
{{
  "mapping": [
    {{"source_column": "Nama Kolom Asli", "target_field": "date|revenue|orders|...|null", "confidence": 0.95}},
    ...
  ],
  "overall_confidence": 0.85,
  "notes": "catatan singkat 1 kalimat"
}}
"""

    try:
        chat = LlmChat(
            api_key=key,
            session_id=f"import-mapping-{_uid()[:8]}",
            system_message="Anda adalah AI yang mengembalikan JSON valid saja, tanpa penjelasan tambahan, tanpa markdown."
        ).with_model("anthropic", "claude-sonnet-4-5-20250929")
        response = await chat.send_message(UserMessage(text=prompt))
        text = response if isinstance(response, str) else str(response)

        # try to extract JSON (strip markdown if present)
        text = text.strip()
        if text.startswith('```'):
            # remove first line and trailing ```
            lines = text.split('\n')
            text = '\n'.join(lines[1:-1] if lines[-1].strip() == '```' else lines[1:])

        parsed = _json.loads(text)
        # normalise mapping list — ensure each header is present
        mapping_by_source = {m['source_column']: m for m in parsed.get('mapping', [])}
        normalized = []
        for h in headers:
            if h in mapping_by_source:
                normalized.append({
                    "source_column": h,
                    "target_field": mapping_by_source[h].get('target_field') or None,
                    "confidence": mapping_by_source[h].get('confidence') or 0,
                })
            else:
                normalized.append({"source_column": h, "target_field": None, "confidence": 0})

        return {
            "mapping": normalized,
            "overall_confidence": parsed.get('overall_confidence', 0),
            "notes": parsed.get('notes', ''),
            "_raw": text[:500],
        }
    except Exception:
        logger.exception("LLM column mapping failed")
        # Heuristic fallback
        return _heuristic_mapping(headers, system_fields)


def _heuristic_mapping(headers: List[str], system_fields: dict) -> dict:
    """Keyword-based fallback when LLM fails."""
    rules = {
        "date":     ['tanggal', 'date', 'order date', 'order_date', 'created', 'tgl'],
        "revenue":  ['total', 'revenue', 'penjualan', 'amount', 'harga', 'grand', 'gmv'],
        "orders":   ['order', 'pesanan', 'transaksi', 'jumlah_order', 'qty_order'],
        "quantity": ['qty', 'jumlah', 'quantity', 'kuantitas'],
        "product_name": ['product', 'produk', 'nama_produk', 'item'],
        "sku":      ['sku', 'kode', 'product_code', 'item_code'],
        "rating":   ['rating', 'rate', 'score'],
    }
    mapping = []
    for h in headers:
        h_low = h.lower().strip()
        target = None
        confidence = 0
        for field, keywords in rules.items():
            for kw in keywords:
                if kw in h_low:
                    target = field
                    confidence = 0.6
                    break
            if target:
                break
        mapping.append({"source_column": h, "target_field": target, "confidence": confidence})

    return {
        "mapping": mapping,
        "overall_confidence": 0.6,
        "notes": "Heuristik fallback (LLM tidak tersedia)",
        "_raw": None,
    }


def _convert_value(value, target_type: str):
    """Convert source value to target type. Returns (value, error_msg or None)."""
    import pandas as pd
    if value is None or (isinstance(value, float) and pd.isna(value)) or value == '' or value == 'nan':
        return None, None
    try:
        s = str(value).strip()
        if target_type == 'number':
            # remove currency symbols, thousand separators
            s = s.replace('Rp', '').replace('IDR', '').replace(',', '').replace('.', '', s.count('.') - 1) if s.count('.') > 1 else s.replace('Rp', '').replace('IDR', '').replace(',', '')
            return float(s), None
        elif target_type == 'integer':
            s = s.replace(',', '').replace('.', '')
            return int(float(s)), None
        elif target_type == 'date':
            # try multiple formats
            for fmt in ('%Y-%m-%d', '%d/%m/%Y', '%d-%m-%Y', '%Y/%m/%d', '%d %B %Y', '%d-%b-%Y', '%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M:%S'):
                try:
                    return datetime.strptime(s[:19], fmt).date().isoformat(), None
                except ValueError:
                    continue
            # try pandas parse
            try:
                return pd.to_datetime(s).date().isoformat(), None
            except Exception:
                return None, f"format tanggal '{s}' tidak dikenali"
        else:
            return s, None
    except Exception as e:
        return None, f"konversi gagal: {str(e)[:60]}"


def _apply_mapping(df, mapping_items: List[dict]):
    """Apply mapping to DataFrame. Returns list of mapped rows + per-row errors."""
    src_to_target = {m['source_column']: m['target_field'] for m in mapping_items if m.get('target_field')}
    mapped_rows = []
    errors_per_row = []

    for idx, row in df.iterrows():
        out = {}
        row_errors = []
        for src_col, target_field in src_to_target.items():
            if src_col not in df.columns or target_field is None:
                continue
            target_type = SYSTEM_FIELDS.get(target_field, {}).get('type', 'string')
            val, err = _convert_value(row[src_col], target_type)
            if err:
                row_errors.append({"field": target_field, "source_column": src_col, "error": err})
            else:
                out[target_field] = val

        # Check required fields
        for field, meta in SYSTEM_FIELDS.items():
            if meta['required'] and field not in out:
                row_errors.append({"field": field, "error": f"Required field '{field}' belum di-map atau kosong"})

        out['_row_index'] = int(idx)
        out['_errors'] = row_errors
        mapped_rows.append(out)
        if row_errors:
            errors_per_row.append({"row_index": int(idx), "errors": row_errors})

    return mapped_rows, errors_per_row


def _aggregate_by_date(rows: List[dict]) -> List[dict]:
    """Aggregate row-level data into daily summary rows."""
    by_date: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        if r.get('_errors'):
            continue
        d = r.get('date')
        if not d:
            continue
        if d not in by_date:
            by_date[d] = {"date": d, "revenue": 0, "orders": 0, "quantity": 0, "_count": 0}
        by_date[d]['revenue'] += float(r.get('revenue') or 0)
        by_date[d]['orders'] += int(r.get('orders') or 1)  # if not specified, count rows
        by_date[d]['quantity'] += int(r.get('quantity') or 0)
        by_date[d]['_count'] += 1

    # Compute AOV
    out = []
    for d, agg in by_date.items():
        if agg['orders'] > 0:
            agg['aov'] = round(agg['revenue'] / agg['orders'], 2)
        out.append(agg)
    out.sort(key=lambda x: x['date'])
    return out


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/import/upload")
async def import_upload(
    request: Request,
    file: UploadFile = File(...),
    account_id: str = Form(...),
    revenue_type: str = Form("total"),
):
    """Upload CSV/XLSX, parse headers + sample rows."""
    user = await require_auth(request)
    db = get_db()

    # Validate account
    account = await db.marketing_platform_accounts.find_one({"id": account_id}, {"_id": 0})
    if not account:
        raise HTTPException(404, "Account tidak ditemukan")

    if revenue_type not in ('total', 'live'):
        raise HTTPException(400, "revenue_type harus 'total' atau 'live'")

    # Read file
    file_bytes = await file.read()
    if len(file_bytes) > MAX_FILE_SIZE:
        raise HTTPException(400, f"File terlalu besar (max {MAX_FILE_SIZE // 1024 // 1024}MB)")

    if not file.filename:
        raise HTTPException(400, "Filename tidak valid")

    # Parse
    df, file_type = _parse_file_to_dataframe(file_bytes, file.filename)
    if len(df) > MAX_ROWS:
        raise HTTPException(400, f"Terlalu banyak baris ({len(df)}, max {MAX_ROWS})")
    if len(df) == 0:
        raise HTTPException(400, "File kosong")

    sample = _df_to_sample(df, max_rows=5)

    # Save file to disk
    upload_id = _uid()
    safe_name = f"{upload_id}_{file.filename.replace('/', '_')}"
    file_path = os.path.join(UPLOAD_DIR, safe_name)
    with open(file_path, 'wb') as f:
        f.write(file_bytes)

    # Persist upload metadata
    upload_doc = {
        "id": upload_id,
        "account_id": account_id,
        "account_name": account.get('account_name'),
        "platform": account.get('platform'),
        "filename": file.filename,
        "file_path": file_path,
        "file_type": file_type,
        "file_size": len(file_bytes),
        "headers": sample['headers'],
        "sample_rows": sample['sample_rows'],
        "total_rows": sample['total_rows'],
        "revenue_type": revenue_type,
        "ai_mapping": None,
        "mapping_final": None,
        "aggregation": "by_date",
        "status": "uploaded",
        "created_by": user.get('id', 'system'),
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    await db.marketing_import_uploads.insert_one(upload_doc)

    await log_activity(
        user.get("id", "system"),
        user.get("name") or user.get("email", "system"),
        "import_upload",
        "marketing_import",
        f"Uploaded {file.filename} ({sample['total_rows']} rows) for {account.get('account_name')}"
    )

    return {
        "ok": True,
        "upload_id": upload_id,
        "filename": file.filename,
        "headers": sample['headers'],
        "sample_rows": sample['sample_rows'],
        "total_rows": sample['total_rows'],
        "system_fields": SYSTEM_FIELDS,
        "status": "uploaded",
    }


@router.post("/import/{upload_id}/analyze")
async def import_analyze(upload_id: str, request: Request):
    """Run AI column mapping using Emergent LLM."""
    await require_auth(request)
    db = get_db()

    upload = await db.marketing_import_uploads.find_one({"id": upload_id}, {"_id": 0})
    if not upload:
        raise HTTPException(404, "Upload tidak ditemukan")

    headers = upload.get('headers', [])
    sample = upload.get('sample_rows', [])

    try:
        key = _get_llm_key()
        result = await _llm_column_mapping(headers, sample, SYSTEM_FIELDS, key)
        mapping_source = "llm"
    except HTTPException:
        # No key — heuristic fallback
        result = _heuristic_mapping(headers, SYSTEM_FIELDS)
        mapping_source = "heuristic"

    await db.marketing_import_uploads.update_one(
        {"id": upload_id},
        {"$set": {
            "ai_mapping": result,
            "mapping_source": mapping_source,
            "status": "analyzed",
            "updated_at": _now_iso(),
        }}
    )

    return {
        "ok": True,
        "upload_id": upload_id,
        "mapping_source": mapping_source,
        "ai_mapping": result['mapping'],
        "overall_confidence": result.get('overall_confidence', 0),
        "notes": result.get('notes', ''),
        "system_fields": SYSTEM_FIELDS,
    }


@router.put("/import/{upload_id}/mapping")
async def import_save_mapping(upload_id: str, data: MappingUpdate, request: Request):
    """Save user-edited mapping."""
    await require_auth(request)
    db = get_db()

    upload = await db.marketing_import_uploads.find_one({"id": upload_id}, {"_id": 0})
    if not upload:
        raise HTTPException(404, "Upload tidak ditemukan")

    if upload['status'] == 'executed':
        raise HTTPException(400, "Upload sudah di-execute, tidak bisa diubah")

    if data.revenue_type not in ('total', 'live'):
        raise HTTPException(400, "revenue_type harus 'total' atau 'live'")

    if data.aggregation not in ('by_date', 'row_per_row'):
        raise HTTPException(400, "aggregation harus 'by_date' atau 'row_per_row'")

    mapping_dicts = [m.dict() for m in data.mapping]

    await db.marketing_import_uploads.update_one(
        {"id": upload_id},
        {"$set": {
            "mapping_final": mapping_dicts,
            "revenue_type": data.revenue_type,
            "aggregation": data.aggregation,
            "status": "mapped",
            "updated_at": _now_iso(),
        }}
    )

    return {"ok": True, "upload_id": upload_id, "status": "mapped"}


@router.get("/import/{upload_id}/preview")
async def import_preview(upload_id: str, request: Request, limit: int = 100):
    """Apply mapping + show preview with validation errors."""
    await require_auth(request)
    db = get_db()

    upload = await db.marketing_import_uploads.find_one({"id": upload_id}, {"_id": 0})
    if not upload:
        raise HTTPException(404, "Upload tidak ditemukan")

    mapping = upload.get('mapping_final') or [m for m in (upload.get('ai_mapping') or {}).get('mapping', [])]
    if not mapping:
        raise HTTPException(400, "Belum ada mapping. Jalankan analyze atau save mapping terlebih dahulu.")

    # Reload file
    file_path = upload.get('file_path')
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(404, "File upload tidak ditemukan di disk")

    with open(file_path, 'rb') as f:
        file_bytes = f.read()

    df, _ = _parse_file_to_dataframe(file_bytes, upload['filename'])
    mapped_rows, errors = _apply_mapping(df, mapping)

    # Aggregate if by_date
    aggregation = upload.get('aggregation', 'by_date')
    if aggregation == 'by_date':
        aggregated = _aggregate_by_date(mapped_rows)
        preview_rows = aggregated[:limit]
        total_target_rows = len(aggregated)
    else:
        preview_rows = [{k: v for k, v in r.items() if not k.startswith('_')} for r in mapped_rows[:limit] if not r.get('_errors')]
        total_target_rows = len([r for r in mapped_rows if not r.get('_errors')])

    return {
        "ok": True,
        "upload_id": upload_id,
        "aggregation": aggregation,
        "revenue_type": upload.get('revenue_type'),
        "total_source_rows": int(len(df)),
        "valid_rows": len([r for r in mapped_rows if not r.get('_errors')]),
        "error_rows": len(errors),
        "errors_sample": errors[:20],
        "preview_rows": preview_rows,
        "total_target_rows": total_target_rows,
    }


@router.post("/import/{upload_id}/execute")
async def import_execute(upload_id: str, request: Request):
    """Commit mapped data to marketing_sales_data."""
    user = await require_auth(request)
    db = get_db()

    upload = await db.marketing_import_uploads.find_one({"id": upload_id}, {"_id": 0})
    if not upload:
        raise HTTPException(404, "Upload tidak ditemukan")

    if upload['status'] == 'executed':
        raise HTTPException(400, "Upload sudah di-execute")

    mapping = upload.get('mapping_final') or [m for m in (upload.get('ai_mapping') or {}).get('mapping', [])]
    if not mapping:
        raise HTTPException(400, "Belum ada mapping")

    # Reload file
    file_path = upload.get('file_path')
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(404, "File tidak ditemukan")

    with open(file_path, 'rb') as f:
        file_bytes = f.read()

    df, _ = _parse_file_to_dataframe(file_bytes, upload['filename'])
    mapped_rows, errors = _apply_mapping(df, mapping)

    aggregation = upload.get('aggregation', 'by_date')
    revenue_type = upload.get('revenue_type', 'total')
    account_id = upload['account_id']

    # Build documents to insert
    if aggregation == 'by_date':
        target_rows = _aggregate_by_date(mapped_rows)
    else:
        target_rows = [r for r in mapped_rows if not r.get('_errors') and r.get('date')]

    if not target_rows:
        raise HTTPException(400, "Tidak ada baris valid untuk di-import")

    inserted_ids = []
    success_count = 0
    error_count = 0
    import_id = _uid()

    for row in target_rows:
        try:
            d = row.get('date')
            if not d:
                error_count += 1
                continue

            metrics = {
                "revenue": float(row.get('revenue') or 0),
                "orders": int(row.get('orders') or 0),
                "aov": float(row.get('aov') or 0),
                "gmv": float(row.get('gmv') or 0),
                "conversion_rate": float(row.get('conversion_rate') or 0) if row.get('conversion_rate') else None,
                "quantity": int(row.get('quantity') or 0),
                "rating": float(row.get('rating') or 0) if row.get('rating') else None,
            }

            sales_doc = {
                "id": _uid(),
                "account_id": account_id,
                "date": d,
                "revenue_type": revenue_type,
                "metrics": metrics,
                "_imported_from": import_id,
                "_imported_at": _now_iso(),
                "created_by": user.get('id', 'system'),
                "created_at": _now_iso(),
            }
            # Upsert: same account+date+type → replace
            await db.marketing_sales_data.update_one(
                {"account_id": account_id, "date": d, "revenue_type": revenue_type},
                {"$set": sales_doc},
                upsert=True
            )
            inserted_ids.append(sales_doc['id'])
            success_count += 1
        except Exception as e:
            logger.warning(f"Import row failed: {e}")
            error_count += 1

    # Persist import history
    history_doc = {
        "id": import_id,
        "upload_id": upload_id,
        "account_id": account_id,
        "account_name": upload.get('account_name'),
        "filename": upload['filename'],
        "import_type": revenue_type,
        "aggregation": aggregation,
        "row_count": len(target_rows),
        "success_count": success_count,
        "error_count": error_count,
        "sales_doc_ids": inserted_ids,
        "can_rollback": True,
        "rollback_deadline": (_now() + timedelta(hours=ROLLBACK_WINDOW_HOURS)).isoformat(),
        "rolled_back": False,
        "created_by": user.get('id', 'system'),
        "created_at": _now_iso(),
    }
    await db.marketing_import_history.insert_one(history_doc)

    # Update upload status
    await db.marketing_import_uploads.update_one(
        {"id": upload_id},
        {"$set": {
            "status": "executed",
            "import_id": import_id,
            "executed_at": _now_iso(),
            "success_count": success_count,
            "error_count": error_count,
        }}
    )

    await log_activity(
        user.get("id", "system"),
        user.get("name") or user.get("email", "system"),
        "import_execute",
        "marketing_import",
        f"Imported {success_count} rows from {upload['filename']} (account: {upload.get('account_name')})"
    )

    return {
        "ok": True,
        "import_id": import_id,
        "success_count": success_count,
        "error_count": error_count,
        "rollback_deadline": history_doc['rollback_deadline'],
        "summary": f"{success_count} baris berhasil di-import, {error_count} gagal",
    }


@router.post("/import/{import_id}/rollback")
async def import_rollback(import_id: str, request: Request):
    """Rollback import (only within 24h window). Removes inserted sales docs."""
    user = await require_auth(request)
    db = get_db()

    if not _is_admin_role(user):
        raise HTTPException(403, "Hanya admin/owner/manager_marketing yang dapat rollback")

    history = await db.marketing_import_history.find_one({"id": import_id}, {"_id": 0})
    if not history:
        raise HTTPException(404, "Import history tidak ditemukan")

    if history.get('rolled_back'):
        raise HTTPException(400, "Import ini sudah di-rollback sebelumnya")

    # Check deadline
    deadline_str = history.get('rollback_deadline')
    if deadline_str:
        deadline = datetime.fromisoformat(deadline_str.replace('Z', '+00:00')) if 'Z' in deadline_str else datetime.fromisoformat(deadline_str)
        if deadline.tzinfo is None:
            deadline = deadline.replace(tzinfo=timezone.utc)
        if _now() > deadline:
            raise HTTPException(400, f"Rollback window ({ROLLBACK_WINDOW_HOURS}h) sudah lewat")

    # Delete inserted docs
    sales_doc_ids = history.get('sales_doc_ids', [])
    deleted = 0
    if sales_doc_ids:
        result = await db.marketing_sales_data.delete_many({"id": {"$in": sales_doc_ids}})
        deleted = result.deleted_count

    # Mark as rolled back
    await db.marketing_import_history.update_one(
        {"id": import_id},
        {"$set": {
            "rolled_back": True,
            "rolled_back_at": _now_iso(),
            "rolled_back_by": user.get('id', 'system'),
            "deleted_count": deleted,
            "can_rollback": False,
        }}
    )

    await log_activity(
        user.get("id", "system"),
        user.get("name") or user.get("email", "system"),
        "import_rollback",
        "marketing_import",
        f"Rolled back import {import_id} ({deleted} rows removed)"
    )

    return {
        "ok": True,
        "import_id": import_id,
        "deleted_count": deleted,
        "message": f"Rollback berhasil. {deleted} baris sales dihapus.",
    }


@router.get("/import/history")
async def import_history(
    request: Request,
    account_id: Optional[str] = None,
    limit: int = 50,
):
    """List past imports with rollback status."""
    await require_auth(request)
    db = get_db()

    q: Dict[str, Any] = {}
    if account_id:
        q['account_id'] = account_id

    cursor = db.marketing_import_history.find(q, {"_id": 0}).sort("created_at", -1).limit(limit)
    items = await cursor.to_list(500)

    # Refresh `can_rollback` flag based on deadline
    now = _now()
    for it in items:
        if it.get('rolled_back'):
            it['can_rollback'] = False
            continue
        deadline_str = it.get('rollback_deadline')
        if deadline_str:
            try:
                deadline = datetime.fromisoformat(deadline_str.replace('Z', '+00:00')) if 'Z' in deadline_str else datetime.fromisoformat(deadline_str)
                if deadline.tzinfo is None:
                    deadline = deadline.replace(tzinfo=timezone.utc)
                it['can_rollback'] = now <= deadline
            except Exception:
                it['can_rollback'] = False

    return [serialize_doc(it) for it in items]


@router.get("/import/{upload_id}")
async def import_get_upload(upload_id: str, request: Request):
    """Get full upload info (used by frontend wizard)."""
    await require_auth(request)
    db = get_db()
    upload = await db.marketing_import_uploads.find_one({"id": upload_id}, {"_id": 0})
    if not upload:
        raise HTTPException(404, "Upload tidak ditemukan")
    return serialize_doc(upload)


# ══════════════════════════════════════════════════════════════════════════════
# MAPPING TEMPLATES (Phase 4.5)
# ══════════════════════════════════════════════════════════════════════════════

class TemplateSaveIn(BaseModel):
    template_name: str = Field(..., min_length=1, max_length=80)
    account_id: str
    mapping: List[MappingItem]
    revenue_type: str = "total"
    aggregation: str = "by_date"


@router.get("/import-templates")
async def list_templates(
    request: Request,
    account_id: Optional[str] = None,
):
    """List saved mapping templates, optionally filtered by account."""
    await require_auth(request)
    db = get_db()
    q: Dict[str, Any] = {}
    if account_id:
        q['account_id'] = account_id
    templates = await db.marketing_import_templates.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return serialize_doc(templates)


@router.post("/import-templates")
async def save_template(data: TemplateSaveIn, request: Request):
    """Save a mapping as a reusable template for an account."""
    user = await require_auth(request)
    db = get_db()

    # Validate account
    account = await db.marketing_platform_accounts.find_one({"id": data.account_id}, {"_id": 0})
    if not account:
        raise HTTPException(404, "Account tidak ditemukan")

    # Check name uniqueness per account
    existing = await db.marketing_import_templates.find_one(
        {"account_id": data.account_id, "template_name": data.template_name}
    )
    if existing:
        raise HTTPException(400, f"Template '{data.template_name}' sudah ada untuk akun ini. Gunakan nama lain.")

    template = {
        "id": _uid(),
        "account_id": data.account_id,
        "account_name": account.get("account_name", ""),
        "template_name": data.template_name,
        "mapping": [m.dict() for m in data.mapping],
        "revenue_type": data.revenue_type,
        "aggregation": data.aggregation,
        "usage_count": 0,
        "created_by": user.get("email", "system"),
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }

    await db.marketing_import_templates.insert_one(template)

    await log_activity(
        user.get("id", "system"),
        user.get("name") or user.get("email", "system"),
        "save_template",
        "marketing_import",
        f"Saved import template '{data.template_name}' for {account.get('account_name')}"
    )

    return serialize_doc({"message": "Template disimpan", "template": template})


@router.put("/import-templates/{template_id}")
async def update_template(template_id: str, data: TemplateSaveIn, request: Request):
    """Rename / update a mapping template."""
    await require_auth(request)
    db = get_db()

    tmpl = await db.marketing_import_templates.find_one({"id": template_id}, {"_id": 0})
    if not tmpl:
        raise HTTPException(404, "Template tidak ditemukan")

    # Check name conflict (different id, same name+account)
    conflict = await db.marketing_import_templates.find_one({
        "account_id": data.account_id,
        "template_name": data.template_name,
        "id": {"$ne": template_id}
    })
    if conflict:
        raise HTTPException(400, f"Nama template '{data.template_name}' sudah dipakai")

    await db.marketing_import_templates.update_one(
        {"id": template_id},
        {"$set": {
            "template_name": data.template_name,
            "mapping": [m.dict() for m in data.mapping],
            "revenue_type": data.revenue_type,
            "aggregation": data.aggregation,
            "updated_at": _now_iso(),
        }}
    )
    updated = await db.marketing_import_templates.find_one({"id": template_id}, {"_id": 0})
    return serialize_doc({"message": "Template diupdate", "template": updated})


@router.delete("/import-templates/{template_id}")
async def delete_template(template_id: str, request: Request):
    """Delete a mapping template."""
    await require_auth(request)
    db = get_db()

    tmpl = await db.marketing_import_templates.find_one({"id": template_id}, {"_id": 0})
    if not tmpl:
        raise HTTPException(404, "Template tidak ditemukan")

    await db.marketing_import_templates.delete_one({"id": template_id})
    return {"message": "Template dihapus"}


@router.post("/import/{upload_id}/apply-template/{template_id}")
async def apply_template_to_upload(upload_id: str, template_id: str, request: Request):
    """Apply a saved template mapping to an existing upload (replaces current mapping)."""
    await require_auth(request)
    db = get_db()

    upload = await db.marketing_import_uploads.find_one({"id": upload_id}, {"_id": 0})
    if not upload:
        raise HTTPException(404, "Upload tidak ditemukan")

    tmpl = await db.marketing_import_templates.find_one({"id": template_id}, {"_id": 0})
    if not tmpl:
        raise HTTPException(404, "Template tidak ditemukan")

    # Increment usage count
    await db.marketing_import_templates.update_one(
        {"id": template_id},
        {"$inc": {"usage_count": 1}, "$set": {"last_used_at": _now_iso()}}
    )

    # Apply template mapping to upload
    await db.marketing_import_uploads.update_one(
        {"id": upload_id},
        {"$set": {
            "mapping_final": tmpl["mapping"],
            "revenue_type": tmpl.get("revenue_type", "total"),
            "aggregation": tmpl.get("aggregation", "by_date"),
            "status": "mapped",
            "applied_template_id": template_id,
            "applied_template_name": tmpl["template_name"],
            "updated_at": _now_iso(),
        }}
    )

    return serialize_doc({
        "ok": True,
        "template_name": tmpl["template_name"],
        "mapping": tmpl["mapping"],
        "revenue_type": tmpl.get("revenue_type", "total"),
        "aggregation": tmpl.get("aggregation", "by_date"),
    })

