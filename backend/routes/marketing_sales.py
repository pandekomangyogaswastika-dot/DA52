# ruff: noqa: F401
"""
marketing_sales.py — Sales Data Management
Extracted from marketing.py (1757 LOC monolith)

Refactored: Session #11.19 Phase 3.2 Batch #3
Endpoints: POST /sales-data, GET /accounts/{account_id}/sales
"""
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Request, Query
from pydantic import BaseModel, Field
from database import get_db
from auth import require_auth, serialize_doc, log_activity
from routes.marketing_shared import _uid, _now, _get_user, _sanitize, SalesDataEntry, _recalculate_health_score

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/api/marketing', tags=['Marketing-Sales'])

@router.post("/sales-data")
async def create_sales_data(data: SalesDataEntry, request: Request):
    """
    Manual sales data entry for Phase 1.
    Phase 4 will replace this with smart import.
    
    IMPORTANT: revenue_type must be 'total' OR 'live' (separated)
    """
    await require_auth(request)
    db = get_db()
    
    # Validate account exists
    account = await db.marketing_platform_accounts.find_one({"id": data.account_id}, {"_id": 0})
    if not account:
        raise HTTPException(404, "Account not found")
    
    # Validate revenue_type
    if data.revenue_type not in ["total", "live"]:
        raise HTTPException(400, "revenue_type must be 'total' or 'live'")
    
    # Check duplicate entry (same account + date + revenue_type)
    existing = await db.marketing_sales_data.find_one({
        "account_id": data.account_id,
        "date": data.date,
        "revenue_type": data.revenue_type
    }, {"_id": 0})
    
    if existing:
        raise HTTPException(400, f"Sales data for {data.date} ({data.revenue_type}) already exists for this account")
    
    # Calculate AOV if not provided
    aov = data.aov
    if aov is None and data.orders > 0:
        aov = data.revenue / data.orders
    
    # Build sales entry with complete metrics
    sales_entry = {
        "id": _uid(),
        "account_id": data.account_id,
        "account_code": account["account_code"],
        "platform": account["platform"],
        "date": data.date,
        "revenue_type": data.revenue_type,
        "metrics": {
            "revenue": data.revenue,
            "orders": data.orders,
            "aov": aov or 0,
            "gmv": data.gmv or data.revenue,
            "conversion_rate": data.conversion_rate or 0
        },
        "fulfillment": {
            "fulfillment_rate": data.fulfillment_rate or 0,
            "cancellation_rate": data.cancellation_rate or 0,
            "return_rate": data.return_rate or 0,
            "late_shipment_rate": data.late_shipment_rate or 0
        },
        "customer_satisfaction": {
            "rating": data.rating or 0,
            "review_count": data.review_count or 0,
            "response_rate": data.response_rate or 0,
            "response_time_hours": data.response_time_hours or 0
        },
        "live_metrics": {
            "viewers": data.viewers or 0,
            "avg_viewers": data.avg_viewers or 0,
            "likes": data.likes or 0,
            "shares": data.shares or 0,
            "comments": data.comments or 0,
            "new_followers": data.new_followers or 0,
            "live_sessions": data.live_sessions or 0
        } if data.revenue_type == "live" else {},
        "import_history_id": None,  # Manual entry, no import
        "created_at": _now(),
        "created_by": _get_user(request).get("email", "system")
    }
    
    await db.marketing_sales_data.insert_one(sales_entry)
    
    # Update account health score after new data
    await _recalculate_health_score(db, data.account_id)
    
    await log_activity(
        (_get_user(request)).get("id", "system"),
        (_get_user(request)).get("name") or (_get_user(request)).get("email", "system"),
        "create",
        "marketing_sales_data",
        f"Added sales data: {account['account_name']} - {data.date} ({data.revenue_type})"
    )
    
    return serialize_doc({"message": "Sales data created", "entry": sales_entry})


@router.get("/accounts/{account_id}/sales")
async def get_account_sales_data(
    account_id: str,
    request: Request,
    date_from: Optional[str] = Query(None, description="YYYY-MM-DD"),
    date_to: Optional[str] = Query(None, description="YYYY-MM-DD"),
    revenue_type: Optional[str] = Query(None, description="total | live | all")
):
    """
    Get sales data for an account with date range filter.
    revenue_type='all' returns both total and live data.
    """
    await require_auth(request)
    db = get_db()
    
    account = await db.marketing_platform_accounts.find_one({"id": account_id}, {"_id": 0})
    if not account:
        raise HTTPException(404, "Account not found")
    
    query = {"account_id": account_id}
    
    # Date range filter
    if date_from or date_to:
        query["date"] = {}
        if date_from:
            query["date"]["$gte"] = date_from
        if date_to:
            query["date"]["$lte"] = date_to
    
    # Revenue type filter
    if revenue_type and revenue_type != "all":
        if revenue_type not in ["total", "live"]:
            raise HTTPException(400, "revenue_type must be 'total', 'live', or 'all'")
        query["revenue_type"] = revenue_type
    
    sales_data = await db.marketing_sales_data.find(query, {"_id": 0}).sort("date", -1).to_list(500)
    
    return serialize_doc(sales_data)



# ══════════════════════════════════════════════════════════════════════════════
# PHASE 7A: MARKETING SALES → AR INVOICE BATCH GENERATION
# ══════════════════════════════════════════════════════════════════════════════

class ARBatchRequest(BaseModel):
    date_from: str = Field(..., description="YYYY-MM-DD")
    date_to: str = Field(..., description="YYYY-MM-DD")
    account_id: Optional[str] = None
    platform: Optional[str] = None
    revenue_type: str = Field(default="total", description="total | live")
    grouping: str = Field(default="daily", description="daily | weekly | monthly | platform")
    customer_id: Optional[str] = None  # Default: generic "Marketplace Customer"
    notes: Optional[str] = ""


@router.post("/sales-data/generate-ar-batch")
async def generate_ar_batch_from_sales(data: ARBatchRequest, request: Request):
    """
    Phase 7A: Generate AR Invoices dari marketing sales data dalam batch.
    
    Grouping strategy:
    - daily: 1 invoice per hari per platform
    - weekly: 1 invoice per minggu per platform
    - monthly: 1 invoice per bulan per platform
    - platform: 1 invoice per platform untuk seluruh periode
    
    Returns: list AR invoices created + posting status
    """
    user = await require_auth(request)
    db = get_db()
    
    # Validate dates
    try:
        date_from = datetime.fromisoformat(data.date_from).date()
        date_to = datetime.fromisoformat(data.date_to).date()
    except Exception:
        raise HTTPException(400, "Invalid date format. Use YYYY-MM-DD")
    
    if date_from > date_to:
        raise HTTPException(400, "date_from must be <= date_to")
    
    # Build query
    query = {
        "date": {"$gte": data.date_from, "$lte": data.date_to},
        "revenue_type": data.revenue_type,
    }
    if data.account_id:
        query["account_id"] = data.account_id
    if data.platform:
        query["platform"] = data.platform
    
    # Fetch sales data
    sales_data = await db.marketing_sales_data.find(query, {"_id": 0}).sort("date", 1).to_list(1000)
    
    if not sales_data:
        return serialize_doc({"message": "Tidak ada sales data ditemukan untuk periode ini", "invoices": []})
    
    # Ensure customer exists (default: Marketplace Customer)
    customer_id = data.customer_id
    if not customer_id:
        # Get or create default marketplace customer
        default_customer = await db.rahaza_customers.find_one({"code": "MARKETPLACE"}, {"_id": 0})
        if not default_customer:
            customer_id = _uid()
            default_customer = {
                "id": customer_id,
                "code": "MARKETPLACE",
                "name": "Marketplace Customer",
                "type": "marketplace",
                "email": "",
                "phone": "",
                "address": "",
                "active": True,
                "created_at": _now(),
            }
            await db.rahaza_customers.insert_one(default_customer)
        else:
            customer_id = default_customer["id"]
    else:
        # Validate customer exists
        customer = await db.rahaza_customers.find_one({"id": customer_id}, {"_id": 0})
        if not customer:
            raise HTTPException(404, "Customer tidak ditemukan")
    
    # Group sales data based on strategy
    grouped = {}
    for entry in sales_data:
        if data.grouping == "daily":
            key = f"{entry['date']}_{entry['platform']}"
        elif data.grouping == "weekly":
            week = datetime.fromisoformat(entry['date']).isocalendar()[1]
            year = datetime.fromisoformat(entry['date']).year
            key = f"{year}_W{week:02d}_{entry['platform']}"
        elif data.grouping == "monthly":
            key = f"{entry['date'][:7]}_{entry['platform']}"  # YYYY-MM
        else:  # platform
            key = entry['platform']
        
        if key not in grouped:
            grouped[key] = []
        grouped[key].append(entry)
    
    # Generate AR invoices for each group
    invoices_created = []
    
    for group_key, entries in grouped.items():
        total_revenue = sum(e.get("metrics", {}).get("revenue", 0) for e in entries)
        total_orders = sum(e.get("metrics", {}).get("orders", 0) for e in entries)
        
        if total_revenue <= 0:
            continue
        
        # Generate invoice number
        invoice_number = await _gen_ar_number(db)
        
        # Get platform info
        platform = entries[0]["platform"]
        account_name = entries[0].get("account_code", platform)
        
        # Determine dates
        dates = [e["date"] for e in entries]
        issue_date = max(dates)  # Last date in group
        due_date = issue_date  # Same day for marketplace
        
        # Build invoice items
        items = []
        for e in entries:
            rev = e.get("metrics", {}).get("revenue", 0)
            orders = e.get("metrics", {}).get("orders", 0)
            if rev > 0:
                items.append({
                    "description": f"Penjualan {platform.upper()} - {e['date']} ({orders} orders)",
                    "qty": orders,
                    "unit": "orders",
                    "price": round(rev / orders if orders > 0 else rev),
                    "amount": round(rev),
                })
        
        # Create AR invoice
        invoice_doc = {
            "id": _uid(),
            "invoice_number": invoice_number,
            "customer_id": customer_id,
            "order_id": None,
            "issue_date": issue_date,
            "due_date": due_date,
            "items": items,
            "subtotal": round(total_revenue),
            "tax_pct": 0,  # No tax for marketplace sales by default
            "tax_amount": 0,
            "total": round(total_revenue),
            "paid_amount": 0,
            "balance": round(total_revenue),
            "status": "draft",  # Will be sent below
            "notes": f"Generated from marketing sales data ({data.date_from} to {data.date_to}). {data.notes}",
            "source_module": "marketing_sales_batch",
            "source_metadata": {
                "platform": platform,
                "account_name": account_name,
                "grouping": data.grouping,
                "group_key": group_key,
                "entries_count": len(entries),
                "revenue_type": data.revenue_type,
            },
            "created_at": _now(),
            "updated_at": _now(),
            "created_by": user.get("id", "system"),
            "created_by_name": user.get("name") or user.get("email", "system"),
        }
        
        await db.rahaza_ar_invoices.insert_one(invoice_doc)
        
        # Auto-send and post
        await db.rahaza_ar_invoices.update_one({"id": invoice_doc["id"]}, {"$set": {"status": "sent", "updated_at": _now()}})
        
        # Trigger auto-posting
        posting_result = None
        try:
            from routes.rahaza_posting import post_ar_invoice
            invoice_refresh = await db.rahaza_ar_invoices.find_one({"id": invoice_doc["id"]}, {"_id": 0})
            posting_result = await post_ar_invoice(db, invoice_refresh, user)
        except Exception as e:
            logger.exception("AR auto-post failed for batch invoice")
            posting_result = {"ok": False, "error": str(e)}
        
        # Get final state
        final_invoice = await db.rahaza_ar_invoices.find_one({"id": invoice_doc["id"]}, {"_id": 0})
        final_invoice["_posting_result"] = posting_result
        invoices_created.append(final_invoice)
    
    await log_activity(
        user.get("id", "system"),
        user.get("name") or user.get("email", "system"),
        "generate_ar_batch",
        "marketing_ar_bridge",
        f"Generated {len(invoices_created)} AR invoices from sales data ({data.date_from} to {data.date_to})"
    )
    
    return serialize_doc({
        "message": f"Berhasil membuat {len(invoices_created)} AR invoice dari sales data",
        "count": len(invoices_created),
        "invoices": invoices_created,
    })


async def _gen_ar_number(db):
    """Generate AR invoice number with date prefix"""
    today = datetime.now(timezone.utc).date().strftime("%Y%m%d")
    prefix = f"AR-{today}-"
    count = await db.rahaza_ar_invoices.count_documents({"invoice_number": {"$regex": f"^{prefix}"}})
    return f"{prefix}{count + 1:03d}"


# ══════════════════════════════════════════════════════════════════════════════
# DASHBOARD (Basic for Phase 1)
