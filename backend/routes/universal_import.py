"""
Universal Smart Import Engine — Backend Routes
Phase 1: AI schema detection, draft sessions, WebSocket collaboration
"""
# ruff: noqa: E402
import os
import io
import csv
import json
import uuid
import base64
import hashlib
import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Request, HTTPException, UploadFile, File, Form, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

from database import get_db
from auth import require_auth
from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/marketing/import", tags=["marketing-import"])

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")

# ── WebSocket Connection Manager ──────────────────────────────────────────────

class ImportSessionManager:
    def __init__(self):
        self.connections: Dict[str, List[WebSocket]] = {}  # session_id → [ws]
        self.row_locks: Dict[str, Dict[int, str]] = {}  # session_id → {row_id → user_email}

    async def connect(self, session_id: str, ws: WebSocket):
        await ws.accept()
        if session_id not in self.connections:
            self.connections[session_id] = []
        self.connections[session_id].append(ws)

    def disconnect(self, session_id: str, ws: WebSocket):
        if session_id in self.connections:
            self.connections[session_id] = [c for c in self.connections[session_id] if c != ws]

    async def broadcast(self, session_id: str, data: dict, exclude: WebSocket = None):
        if session_id not in self.connections:
            return
        dead = []
        for ws in self.connections[session_id]:
            if ws == exclude:
                continue
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(session_id, ws)

    def lock_row(self, session_id: str, row_id: int, user_email: str) -> bool:
        if session_id not in self.row_locks:
            self.row_locks[session_id] = {}
        existing = self.row_locks[session_id].get(row_id)
        if existing and existing != user_email:
            return False  # locked by someone else
        self.row_locks[session_id][row_id] = user_email
        return True

    def unlock_row(self, session_id: str, row_id: int, user_email: str):
        if session_id in self.row_locks:
            if self.row_locks[session_id].get(row_id) == user_email:
                del self.row_locks[session_id][row_id]

    def get_locks(self, session_id: str) -> dict:
        return self.row_locks.get(session_id, {})


session_manager = ImportSessionManager()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


def serialize(obj):
    if isinstance(obj, list):
        return [serialize(i) for i in obj]
    if isinstance(obj, dict):
        return {k: serialize(v) for k, v in obj.items() if k != "_id"}
    if isinstance(obj, datetime):
        return obj.isoformat()
    return obj


def _get_user(request: Request) -> dict:
    return getattr(request.state, "user", {}) or {}


async def _parse_file_content(file: UploadFile) -> tuple[str, str, bytes]:
    """Returns (text_content, file_type, raw_bytes)"""
    raw = await file.read()
    filename = file.filename or "unknown"
    fname_lower = filename.lower()

    if fname_lower.endswith(".csv"):
        text = raw.decode("utf-8", errors="replace")
        return text, "csv", raw

    elif fname_lower.endswith(".xlsx") or fname_lower.endswith(".xls"):
        try:
            import openpyxl
            wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
            ws = wb.active
            rows = []
            for i, row in enumerate(ws.iter_rows(values_only=True)):
                if i > 200:  # limit for AI detection
                    break
                rows.append(",".join([str(c) if c is not None else "" for c in row]))
            text = "\n".join(rows)
            return text, "xlsx", raw
        except Exception as e:
            logger.error(f"Excel parse error: {e}")
            return "", "xlsx", raw

    elif fname_lower.endswith(".pdf"):
        try:
            import pdfplumber
            text_parts = []
            with pdfplumber.open(io.BytesIO(raw)) as pdf:
                for page in pdf.pages[:5]:  # first 5 pages
                    t = page.extract_text()
                    if t:
                        text_parts.append(t)
            return "\n".join(text_parts), "pdf", raw
        except Exception as e:
            logger.error(f"PDF parse error: {e}")
            return "", "pdf", raw

    elif any(fname_lower.endswith(ext) for ext in [".png", ".jpg", ".jpeg", ".webp"]):
        b64 = base64.b64encode(raw).decode()
        return b64, "image", raw

    return "", "unknown", raw


SOURCE_TYPES = [
    "shopee_orders", "tiktok_orders", "tokopedia_orders",
    "complaints", "ratings_reviews", "ads_report",
    "account_health", "live_session_report",
    "content_calendar", "discount_campaign",
    "sample_shipping", "new_products", "returns_refunds",
    "unknown"
]

CANONICAL_FIELDS = [
    "order_id", "sku_id", "product_name", "quantity",
    "price_original", "price_final", "discount_seller", "discount_platform",
    "shipping_cost", "customer_name", "customer_phone", "address", "city",
    "status", "order_date", "payment_method", "tracking_number", "courier",
    "return_reason", "rating", "review_text",
    "complaint_category", "complaint_text", "resolution_status",
    "revenue", "orders_count", "budget", "roas", "cpa", "impressions", "clicks",
    "account_name", "platform", "health_score", "ses_point", "chat_response_rate",
    "late_shipment_rate", "cancellation_rate",
    "live_date", "live_duration", "live_viewers", "live_orders", "live_revenue",
    "content_date", "content_type", "hook_text", "caption", "hashtags",
    "discount_name", "discount_percent", "discount_start", "discount_end",
    "product_launch_date", "brand", "description",
    "unknown"
]


async def _ai_detect_schema(text_content: str, filename: str, file_type: str, is_image: bool = False) -> dict:
    """Call AI to detect schema. Returns mapping dict."""
    if not EMERGENT_LLM_KEY:
        return {"detected_source": "unknown", "platform": "unknown",
                "overall_confidence": 0.3, "warnings": ["No LLM key"], "column_mappings": []}

    session_id = f"import-detect-{uuid.uuid4().hex[:8]}"

    system_msg = ("You are a data analyst specializing in Indonesian marketplace data "
                  "(Shopee, TikTok, Tokopedia). Always respond with valid JSON only, no markdown.")

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=session_id,
        system_message=system_msg
    ).with_model("openai", "gpt-4o-mini")

    source_list = ", ".join(SOURCE_TYPES)
    canonical_list = ", ".join(CANONICAL_FIELDS[:30])  # first 30

    if is_image:
        user_msg = UserMessage(
            text=(
                "This is a screenshot from an Indonesian marketplace (Shopee/TikTok) dashboard.\n"
                "Extract all visible metrics and return JSON with structure:\n"
                '{"detected_source":"account_health","platform":"shopee or tiktok",'
                '"overall_confidence":0.9,"warnings":[],"ocr_data":{},"column_mappings":[]}\n'
                "Put extracted metrics in ocr_data as key-value pairs."
            ),
            file_contents=[ImageContent(image_base64=text_content)]
        )
    else:
        sample = text_content[:2000] if len(text_content) > 2000 else text_content
        prompt = (
            f"Analisis file export marketplace Indonesia.\nFilename: {filename}\n"
            f"Sample data:\n{sample}\n\n"
            f"Return JSON persis:\n"
            f'{{"detected_source":"<one of: {source_list}>","platform":"shopee|tiktok|tokopedia|unknown",'
            f'"overall_confidence":0.95,"warnings":[],"column_mappings":['
            f'{{"source_column":"...","canonical_field":"<one of: {canonical_list}>",'
            f'"confidence":0.95,"normalization_note":null}}]}}'
        )
        user_msg = UserMessage(text=prompt)

    try:
        response = await chat.send_message(user_msg)
        clean = response.strip()
        if clean.startswith("```"):
            parts = clean.split("```")
            clean = parts[1] if len(parts) > 1 else clean
            if clean.startswith("json"):
                clean = clean[4:]
        return json.loads(clean.strip())
    except Exception as e:
        logger.error(f"AI schema detection failed: {e}")
        raise


async def _ai_normalize_rows(rows: list, column_mappings: list, source_type: str) -> list:
    """Normalize raw rows to canonical schema using AI."""
    if not EMERGENT_LLM_KEY or not rows:
        return [{"row_id": i, "original_data": r, "ai_parsed_data": r,
                 "user_edited_data": None, "confidence": 0.5,
                 "validation_status": "warning", "validation_messages": ["No AI normalization"],
                 "edit_history": []} for i, r in enumerate(rows)]

    session_id = f"import-normalize-{uuid.uuid4().hex[:8]}"
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=session_id,
        system_message="Data normalization expert. Respond only with valid JSON."
    ).with_model("openai", "gpt-4o-mini")

    # Process in batches of 10
    all_results = []
    batch_size = 10
    for batch_start in range(0, len(rows), batch_size):
        batch = rows[batch_start: batch_start + batch_size]
        batch_with_ids = [{"_row_id": batch_start + i, **r} for i, r in enumerate(batch)]

        # Build mapping summary
        mapping_hint = "; ".join([
            f"'{m.get('source_column', '')}' -> {m.get('canonical_field', 'unknown')}"
            for m in (column_mappings or [])[:20]
        ])

        prompt = (
            f"Normalize {len(batch)} baris data marketplace Indonesia ke canonical schema.\n"
            f"Source: {source_type}\nColumn mapping: {mapping_hint}\n"
            f"PERHATIKAN MISLABELING Shopee: 'Voucher Ditanggung Penjual' bisa berisi BERAT (tidak berlaku)."
            f"'Catatan dari Pembeli' bisa berisi username.\n"
            f"Data:\n{json.dumps(batch_with_ids, ensure_ascii=False)[:3000]}\n\n"
            f"Return JSON array PERSIS (satu entry per baris):\n"
            f'[{{"row_id":0,"canonical":{{"order_id":"...","order_date":"YYYY-MM-DD",...}},'
            f'"confidence":0.9,"anomaly_flags":[],"validation_status":"valid|warning|error"}}]'
        )

        try:
            response = await chat.send_message(UserMessage(text=prompt))
            clean = response.strip()
            if clean.startswith("```"):
                parts = clean.split("```")
                clean = parts[1] if len(parts) > 1 else clean
                if clean.startswith("json"):
                    clean = clean[4:]
            batch_results = json.loads(clean.strip())
            if isinstance(batch_results, list):
                for item in batch_results:
                    row_id = item.get("row_id", batch_start)
                    original = rows[row_id] if row_id < len(rows) else {}
                    all_results.append({
                        "row_id": row_id,
                        "original_data": original,
                        "ai_parsed_data": item.get("canonical", original),
                        "user_edited_data": None,
                        "confidence": item.get("confidence", 0.7),
                        "validation_status": item.get("validation_status", "warning"),
                        "validation_messages": item.get("anomaly_flags", []),
                        "edit_history": []
                    })
        except Exception as e:
            logger.error(f"Row normalization batch failed: {e}")
            # Fallback: add raw rows
            for i, r in enumerate(batch):
                all_results.append({
                    "row_id": batch_start + i,
                    "original_data": r,
                    "ai_parsed_data": r,
                    "user_edited_data": None,
                    "confidence": 0.5,
                    "validation_status": "warning",
                    "validation_messages": ["AI normalization failed"],
                    "edit_history": []
                })

    return all_results


async def _process_session_async(session_id: str, db):
    """Background task: run AI parsing and update session status."""
    try:
        session = await db.marketing_import_sessions.find_one({"id": session_id})
        if not session:
            return

        file_type = session.get("file_type", "csv")
        file_content = session.get("_file_content", "")
        filename = session.get("filename", "")
        is_image = file_type == "image"

        # AI schema detection
        schema = await _ai_detect_schema(file_content, filename, file_type, is_image)

        # Update template library (shared global)
        detected_source = schema.get("detected_source", "unknown")
        column_mappings = schema.get("column_mappings", [])

        if detected_source != "unknown" and column_mappings:
            existing_tpl = await db.marketing_import_templates.find_one({
                "source_type": detected_source,
                "platform": schema.get("platform", "unknown")
            })
            if not existing_tpl:
                await db.marketing_import_templates.insert_one({
                    "id": str(uuid.uuid4()),
                    "source_type": detected_source,
                    "platform": schema.get("platform", "unknown"),
                    "column_mappings": column_mappings,
                    "sample_filename": filename,
                    "use_count": 1,
                    "created_at": _now()
                })
            else:
                await db.marketing_import_templates.update_one(
                    {"id": existing_tpl["id"]},
                    {"$inc": {"use_count": 1}}
                )

        # Parse raw rows from text
        raw_rows = []
        if not is_image and file_content:
            try:
                lines = file_content.strip().split("\n")
                if lines:
                    reader = csv.DictReader(io.StringIO(file_content))
                    raw_rows = list(reader)[:500]  # max 500 rows
            except Exception:
                pass

        # Normalize rows (if orders/complaints/etc)
        draft_rows = []
        if raw_rows and detected_source not in ["account_health", "unknown"]:
            draft_rows = await _ai_normalize_rows(raw_rows, column_mappings, detected_source)
        elif is_image:
            # OCR result stored as single "row"
            ocr_data = schema.get("ocr_data", {})
            draft_rows = [{
                "row_id": 0,
                "original_data": {"screenshot": "[image]"},
                "ai_parsed_data": ocr_data,
                "user_edited_data": None,
                "confidence": schema.get("overall_confidence", 0.8),
                "validation_status": "warning" if not ocr_data else "valid",
                "validation_messages": [],
                "edit_history": []
            }]

        # Confidence summary
        high = sum(1 for r in draft_rows if r.get("confidence", 0) >= 0.9)
        med = sum(1 for r in draft_rows if 0.7 <= r.get("confidence", 0) < 0.9)
        low = sum(1 for r in draft_rows if r.get("confidence", 0) < 0.7)

        # Update session
        await db.marketing_import_sessions.update_one(
            {"id": session_id},
            {"$set": {
                "status": "ready_review",
                "source_type": detected_source,
                "detected_platform": schema.get("platform", "unknown"),
                "overall_confidence": schema.get("overall_confidence", 0.5),
                "schema_warnings": schema.get("warnings", []),
                "column_mappings": column_mappings,
                "draft_rows": draft_rows,
                "total_rows": len(draft_rows),
                "confidence_summary": {"high": high, "medium": med, "low": low},
                "updated_at": _now(),
                "_file_content": None  # clear to save space
            }}
        )

        # Broadcast to WebSocket clients
        await session_manager.broadcast(session_id, {
            "type": "session_updated",
            "session_id": session_id,
            "status": "ready_review",
            "total_rows": len(draft_rows),
            "confidence_summary": {"high": high, "medium": med, "low": low}
        })

    except Exception as e:
        logger.error(f"Session processing failed for {session_id}: {e}")
        # Auto-queue for retry
        retry_count = (await db.marketing_import_sessions.find_one({"id": session_id}) or {}).get("retry_count", 0)
        new_status = "queued" if retry_count < 3 else "failed"
        await db.marketing_import_sessions.update_one(
            {"id": session_id},
            {"$set": {
                "status": new_status,
                "last_error": str(e),
                "updated_at": _now()
            },
             "$inc": {"retry_count": 1}}
        )
        await session_manager.broadcast(session_id, {
            "type": "session_error",
            "session_id": session_id,
            "status": new_status,
            "error": str(e)
        })


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/sessions")
async def create_import_session(
    request: Request,
    file: UploadFile = File(...),
    brand_context: Optional[str] = Form(None)
):
    """Upload file → create import session → start AI parsing async"""
    await require_auth(request)
    user = _get_user(request)
    db = get_db()

    text_content, file_type, raw_bytes = await _parse_file_content(file)

    # Deduplication via file hash
    file_hash = hashlib.md5(raw_bytes).hexdigest()
    existing = await db.marketing_import_sessions.find_one({"file_hash": file_hash, "status": {"$ne": "rolled_back"}})
    if existing:
        return serialize({"session": existing, "duplicate": True,
                          "message": "File ini sudah pernah diupload"})

    session_id = str(uuid.uuid4())
    session = {
        "id": session_id,
        "filename": file.filename,
        "file_type": file_type,
        "file_hash": file_hash,
        "file_size_kb": round(len(raw_bytes) / 1024, 1),
        "status": "parsing",
        "source_type": None,
        "detected_platform": None,
        "overall_confidence": None,
        "schema_warnings": [],
        "column_mappings": [],
        "draft_rows": [],
        "total_rows": 0,
        "confidence_summary": {"high": 0, "medium": 0, "low": 0},
        "committed_ids": [],
        "retry_count": 0,
        "last_error": None,
        "brand_context": brand_context,
        "created_by": user.get("email", "system"),
        "created_by_id": user.get("id", "system"),
        "created_at": _now(),
        "updated_at": _now(),
        "committed_at": None,
        "_file_content": text_content  # temp, cleared after processing
    }

    await db.marketing_import_sessions.insert_one(session)

    # Start async processing
    asyncio.create_task(_process_session_async(session_id, db))

    session.pop("_id", None)
    session.pop("_file_content", None)
    return serialize({"session": session, "message": "Upload berhasil, AI sedang memproses..."})


@router.get("/sessions")
async def list_import_sessions(
    request: Request,
    status: Optional[str] = Query(None),
    source_type: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, le=100)
):
    await require_auth(request)
    db = get_db()

    query = {}
    if status:
        query["status"] = status
    if source_type:
        query["source_type"] = source_type

    total = await db.marketing_import_sessions.count_documents(query)
    sessions = await db.marketing_import_sessions.find(
        query, {"_id": 0, "_file_content": 0, "draft_rows": 0}
    ).sort("created_at", -1).skip((page - 1) * page_size).limit(page_size).to_list(500)

    # Count by status
    pipeline = [{"$group": {"_id": "$status", "count": {"$sum": 1}}}]
    status_counts = {}
    async for doc in db.marketing_import_sessions.aggregate(pipeline):
        status_counts[doc["_id"]] = doc["count"]

    return serialize({
        "sessions": sessions,
        "pagination": {
            "page": page, "page_size": page_size, "total": total,
            "total_pages": (total + page_size - 1) // page_size
        },
        "status_counts": status_counts
    })


@router.get("/sessions/{session_id}")
async def get_import_session(
    session_id: str,
    request: Request,
    include_rows: bool = Query(True)
):
    await require_auth(request)
    db = get_db()

    projection = {"_id": 0, "_file_content": 0}
    if not include_rows:
        projection["draft_rows"] = 0

    session = await db.marketing_import_sessions.find_one({"id": session_id}, projection)
    if not session:
        raise HTTPException(404, "Session not found")

    # Attach current row locks
    session["row_locks"] = {
        str(k): v for k, v in session_manager.get_locks(session_id).items()
    }
    return serialize(session)


class CellEditRequest(BaseModel):
    row_id: int
    column: str
    new_value: Any
    user_email: Optional[str] = None


@router.patch("/sessions/{session_id}/cells")
async def edit_cell(
    session_id: str,
    body: CellEditRequest,
    request: Request
):
    await require_auth(request)
    user = _get_user(request)
    db = get_db()

    session = await db.marketing_import_sessions.find_one(
        {"id": session_id}, {"draft_rows": 1, "status": 1}
    )
    if not session:
        raise HTTPException(404, "Session not found")
    if session.get("status") in ["committed", "rolled_back"]:
        raise HTTPException(400, "Cannot edit committed/rolled_back session")

    user_email = user.get("email", "unknown")

    # Find and update the row in draft_rows array
    draft_rows = session.get("draft_rows", [])
    target_row = next((r for r in draft_rows if r["row_id"] == body.row_id), None)
    if not target_row:
        raise HTTPException(404, f"Row {body.row_id} not found")

    # Build edit entry
    edit_entry = {
        "user": user_email,
        "field": body.column,
        "old": (target_row.get("user_edited_data") or target_row.get("ai_parsed_data", {})).get(body.column),
        "new": body.new_value,
        "at": _now().isoformat()
    }

    # Update the specific row
    updated = False
    for i, row in enumerate(draft_rows):
        if row["row_id"] == body.row_id:
            if not draft_rows[i].get("user_edited_data"):
                draft_rows[i]["user_edited_data"] = dict(draft_rows[i].get("ai_parsed_data") or {})
            draft_rows[i]["user_edited_data"][body.column] = body.new_value
            if not draft_rows[i].get("edit_history"):
                draft_rows[i]["edit_history"] = []
            draft_rows[i]["edit_history"].append(edit_entry)
            updated = True
            break

    if not updated:
        raise HTTPException(404, f"Row {body.row_id} not found in draft")

    await db.marketing_import_sessions.update_one(
        {"id": session_id},
        {"$set": {"draft_rows": draft_rows, "updated_at": _now(), "status": "draft"}}
    )

    # Broadcast change to collaborators
    await session_manager.broadcast(session_id, {
        "type": "cell_edited",
        "row_id": body.row_id,
        "column": body.column,
        "new_value": body.new_value,
        "edited_by": user_email
    })

    return {"ok": True, "edit": serialize(edit_entry)}


class BulkEditRequest(BaseModel):
    filter_confidence: Optional[str] = None  # "low", "medium", "high", "all"
    column: str
    new_value: Any
    row_ids: Optional[List[int]] = None  # if None, apply to all filtered


@router.post("/sessions/{session_id}/bulk-edit")
async def bulk_edit(
    session_id: str,
    body: BulkEditRequest,
    request: Request
):
    await require_auth(request)
    user = _get_user(request)
    db = get_db()

    session = await db.marketing_import_sessions.find_one(
        {"id": session_id}, {"draft_rows": 1, "status": 1}
    )
    if not session:
        raise HTTPException(404, "Session not found")

    draft_rows = session.get("draft_rows", [])
    user_email = user.get("email", "system")
    updated_count = 0

    for i, row in enumerate(draft_rows):
        # Filter by confidence if specified
        conf = row.get("confidence", 0)
        if body.filter_confidence == "high" and conf < 0.9:
            continue
        if body.filter_confidence == "medium" and not (0.7 <= conf < 0.9):
            continue
        if body.filter_confidence == "low" and conf >= 0.7:
            continue
        if body.row_ids and row["row_id"] not in body.row_ids:
            continue

        if not draft_rows[i].get("user_edited_data"):
            draft_rows[i]["user_edited_data"] = dict(draft_rows[i].get("ai_parsed_data") or {})
        draft_rows[i]["user_edited_data"][body.column] = body.new_value
        if not draft_rows[i].get("edit_history"):
            draft_rows[i]["edit_history"] = []
        draft_rows[i]["edit_history"].append({
            "user": user_email, "field": body.column,
            "old": None, "new": body.new_value,
            "at": _now().isoformat(), "bulk": True
        })
        updated_count += 1

    await db.marketing_import_sessions.update_one(
        {"id": session_id},
        {"$set": {"draft_rows": draft_rows, "updated_at": _now(), "status": "draft"}}
    )

    return {"ok": True, "updated_count": updated_count}


class AiAssistRequest(BaseModel):
    row_id: int
    question: Optional[str] = "Suggest fixes for this row"


@router.post("/sessions/{session_id}/ai-assist")
async def ai_assist(
    session_id: str,
    body: AiAssistRequest,
    request: Request
):
    await require_auth(request)
    db = get_db()

    session = await db.marketing_import_sessions.find_one(
        {"id": session_id}, {"draft_rows": 1, "source_type": 1, "column_mappings": 1}
    )
    if not session:
        raise HTTPException(404, "Session not found")

    row = next((r for r in session.get("draft_rows", []) if r["row_id"] == body.row_id), None)
    if not row:
        raise HTTPException(404, "Row not found")

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"assist-{session_id}-{body.row_id}",
        system_message="You are a helpful data correction assistant. Respond in Bahasa Indonesia when possible. Return JSON."
    ).with_model("openai", "gpt-4o-mini")

    current_data = row.get("user_edited_data") or row.get("ai_parsed_data") or {}
    prompt = (
        f"Baris data dari {session.get('source_type', 'marketplace')}:\n"
        f"{json.dumps(current_data, ensure_ascii=False)}\n\n"
        f"Pertanyaan: {body.question}\n\n"
        f"Berikan saran perbaikan. Return JSON: {{\"suggestion\": \"...\", \"field_fixes\": {{\"field\": \"suggested_value\"}}, \"confidence\": 0.9}}"
    )

    try:
        response = await chat.send_message(UserMessage(text=prompt))
        clean = response.strip()
        if clean.startswith("```"):
            parts = clean.split("```")
            clean = parts[1] if len(parts) > 1 else clean
            if clean.startswith("json"):
                clean = clean[4:]
        result = json.loads(clean.strip())
        return {"ok": True, "suggestion": result}
    except Exception as e:
        return {"ok": False, "suggestion": {"suggestion": f"AI error: {e}", "field_fixes": {}, "confidence": 0}}


@router.post("/sessions/{session_id}/commit")
async def commit_session(
    session_id: str,
    request: Request
):
    """Commit valid rows to the appropriate collection."""
    await require_auth(request)
    user = _get_user(request)
    db = get_db()

    session = await db.marketing_import_sessions.find_one({"id": session_id})
    if not session:
        raise HTTPException(404, "Session not found")
    if session.get("status") == "committed":
        raise HTTPException(400, "Already committed")
    if session.get("status") not in ["ready_review", "draft"]:
        raise HTTPException(400, f"Cannot commit from status: {session.get('status')}")

    draft_rows = session.get("draft_rows", [])
    source_type = session.get("source_type", "unknown")
    committed_ids = []
    committed_count = 0
    rejected_count = 0

    # Determine target collection
    collection_map = {
        "shopee_orders": "marketing_orders",
        "tiktok_orders": "marketing_orders",
        "tokopedia_orders": "marketing_orders",
        "complaints": "marketing_complaints",
        "ratings_reviews": "marketing_reviews",
        "ads_report": "marketing_ads_data",
        "account_health": "marketing_account_health",
        "live_session_report": "marketing_live_sessions",
        "content_calendar": "marketing_content_calendar",
        "new_products": "marketing_product_launches",
        "discount_campaign": "marketing_discount_campaigns",
        "sample_shipping": "marketing_sample_shipments",
        "returns_refunds": "marketing_returns",
    }
    target_collection = collection_map.get(source_type, f"marketing_import_{source_type}")

    for row in draft_rows:
        if row.get("validation_status") == "error":
            rejected_count += 1
            continue

        committed_data = row.get("user_edited_data") or row.get("ai_parsed_data") or row.get("original_data") or {}
        doc_id = str(uuid.uuid4())
        doc = {
            "id": doc_id,
            "_import_session_id": session_id,
            "_source_type": source_type,
            "_platform": session.get("detected_platform"),
            "_confidence": row.get("confidence", 0),
            "_committed_by": user.get("email", "system"),
            "_committed_at": _now(),
            **committed_data
        }
        await db[target_collection].insert_one(doc)
        committed_ids.append(doc_id)
        committed_count += 1

    await db.marketing_import_sessions.update_one(
        {"id": session_id},
        {"$set": {
            "status": "committed",
            "committed_ids": committed_ids,
            "committed_at": _now(),
            "updated_at": _now()
        }}
    )

    await session_manager.broadcast(session_id, {
        "type": "session_committed",
        "session_id": session_id,
        "committed_count": committed_count,
        "rejected_count": rejected_count
    })

    return {
        "ok": True,
        "committed_count": committed_count,
        "rejected_count": rejected_count,
        "target_collection": target_collection,
        "committed_ids": committed_ids
    }


@router.post("/sessions/{session_id}/rollback")
async def rollback_session(
    session_id: str,
    request: Request
):
    await require_auth(request)
    db = get_db()

    session = await db.marketing_import_sessions.find_one({"id": session_id})
    if not session:
        raise HTTPException(404, "Session not found")

    committed_ids = session.get("committed_ids", [])
    source_type = session.get("source_type", "unknown")

    collection_map = {
        "shopee_orders": "marketing_orders",
        "tiktok_orders": "marketing_orders",
        "tokopedia_orders": "marketing_orders",
        "complaints": "marketing_complaints",
        "ratings_reviews": "marketing_reviews",
        "ads_report": "marketing_ads_data",
        "account_health": "marketing_account_health",
        "live_session_report": "marketing_live_sessions",
        "content_calendar": "marketing_content_calendar",
        "new_products": "marketing_product_launches",
        "discount_campaign": "marketing_discount_campaigns",
        "sample_shipping": "marketing_sample_shipments",
        "returns_refunds": "marketing_returns",
    }
    target_collection = collection_map.get(source_type, f"marketing_import_{source_type}")

    deleted = 0
    if committed_ids:
        result = await db[target_collection].delete_many({"id": {"$in": committed_ids}})
        deleted = result.deleted_count

    await db.marketing_import_sessions.update_one(
        {"id": session_id},
        {"$set": {
            "status": "rolled_back",
            "updated_at": _now(),
            "committed_ids": []
        }}
    )

    return {"ok": True, "rolled_back_count": deleted}


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    result = await db.marketing_import_sessions.delete_one({"id": session_id})
    if result.deleted_count == 0:
        raise HTTPException(404, "Session not found")
    return {"ok": True}


@router.get("/templates")
async def list_templates(request: Request):
    await require_auth(request)
    db = get_db()
    templates = await db.marketing_import_templates.find(
        {}, {"_id": 0}
    ).sort("use_count", -1).to_list(100)
    return serialize(templates)


@router.post("/sessions/{session_id}/lock")
async def lock_row_endpoint(
    session_id: str,
    request: Request
):
    await require_auth(request)
    user = _get_user(request)
    body = await request.json()
    row_id = body.get("row_id")
    action = body.get("action", "lock")  # "lock" or "unlock"

    user_email = user.get("email", "unknown")
    if action == "lock":
        ok = session_manager.lock_row(session_id, row_id, user_email)
        return {"ok": ok, "locked_by": user_email if ok else None}
    else:
        session_manager.unlock_row(session_id, row_id, user_email)
        return {"ok": True}


# ── WebSocket ─────────────────────────────────────────────────────────────────

@router.websocket("/sessions/{session_id}/ws")
async def websocket_session(
    session_id: str,
    websocket: WebSocket
):
    await session_manager.connect(session_id, websocket)
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})

            elif msg_type == "lock_row":
                row_id = data.get("row_id")
                user_email = data.get("user_email", "unknown")
                ok = session_manager.lock_row(session_id, row_id, user_email)
                await websocket.send_json({"type": "lock_response", "row_id": row_id, "ok": ok, "locked_by": user_email if ok else None})
                if ok:
                    await session_manager.broadcast(session_id, {
                        "type": "row_locked",
                        "row_id": row_id,
                        "locked_by": user_email
                    }, exclude=websocket)

            elif msg_type == "unlock_row":
                row_id = data.get("row_id")
                user_email = data.get("user_email", "unknown")
                session_manager.unlock_row(session_id, row_id, user_email)
                await session_manager.broadcast(session_id, {
                    "type": "row_unlocked",
                    "row_id": row_id
                }, exclude=websocket)

            elif msg_type == "presence":
                await session_manager.broadcast(session_id, {
                    "type": "collaborator_present",
                    "user_email": data.get("user_email"),
                    "cursor_row": data.get("cursor_row")
                }, exclude=websocket)

    except WebSocketDisconnect:
        session_manager.disconnect(session_id, websocket)
    except Exception as e:
        logger.error(f"WebSocket error in session {session_id}: {e}")
        session_manager.disconnect(session_id, websocket)


# ── Queue Retry Job ───────────────────────────────────────────────────────────

async def retry_queued_sessions():
    """Called by APScheduler every 5 minutes to retry queued sessions."""
    db = get_db()
    queued = await db.marketing_import_sessions.find(
        {"status": "queued", "retry_count": {"$lt": 3}},
        {"id": 1}
    ).to_list(10)
    for session in queued:
        logger.info(f"[queue-retry] Retrying session {session['id']}")
        await db.marketing_import_sessions.update_one(
            {"id": session["id"]},
            {"$set": {"status": "parsing", "updated_at": _now()}}
        )
        asyncio.create_task(_process_session_async(session["id"], db))
