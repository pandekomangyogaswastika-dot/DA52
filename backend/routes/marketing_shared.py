# ruff: noqa: F401
"""
marketing_shared.py — Shared Helpers & Models
Extracted from marketing.py (1757 LOC monolith)

Refactored: Session #11.19 Phase 3.2 Batch #3
"""
import uuid
import html
from datetime import datetime, timezone, timedelta
from pydantic import BaseModel, Field
from typing import Optional, List

def _uid():
    return str(uuid.uuid4())

def _now():
    return datetime.now(timezone.utc)

def _get_user(request):
    """Helper to safely get user from request.state"""
    return getattr(request.state, 'user', {"id": "system", "email": "system", "role": "admin"})

def _sanitize(value: str, max_len: int = 500) -> str:
    """Sanitize user input"""
    if not value:
        return ''
    sanitized = html.escape(str(value)[:max_len])
    return sanitized

# ═══ PYDANTIC MODELS ═══

class PlatformAccountCreate(BaseModel):
    platform_name: str
    platform_type: str
    account_handle: str
    account_url: Optional[str] = None
    followers_count: int = 0
    manager_name: Optional[str] = None

class PlatformAccountUpdate(BaseModel):
    platform_name: Optional[str] = None
    platform_type: Optional[str] = None
    account_handle: Optional[str] = None
    account_url: Optional[str] = None
    followers_count: Optional[int] = None
    manager_name: Optional[str] = None
    status: Optional[str] = None

class SalesDataEntry(BaseModel):
    date: str
    gmv: float
    orders: int
    impressions: int
    clicks: int

class TaskCreate(BaseModel):
    account_id: str
    task_type: str
    title: str
    description: Optional[str] = None
    due_date: Optional[str] = None
    priority: str = "medium"
    assigned_to: Optional[str] = None

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    due_date: Optional[str] = None
    priority: Optional[str] = None
    assigned_to: Optional[str] = None
    completed_at: Optional[str] = None

class TaskCompleteAction(BaseModel):
    action_notes: Optional[str] = None

class TaskTemplateCreate(BaseModel):
    name: str
    description: Optional[str] = None
    task_type: str
    priority: str = "medium"
    duration_days: int = 7
    is_active: bool = True

class RecurrenceConfig(BaseModel):
    frequency: str
    interval: int = 1


# ═══════════════════════════════════════════════════════════════════════════════
# RBAC & TASK HELPERS
# (Re-extracted from original marketing.py — Session #11.20 recovery)
# ═══════════════════════════════════════════════════════════════════════════════

def _is_pic_role(user) -> bool:
    """
    Check if user has PIC Marketing-level role for approval workflow.
    Allowed roles: admin, owner, superadmin, manager_* (manager_marketing, manager_keuangan, dll), pic_marketing, pic_toko.
    """
    role = (user.get("role") or "").lower()
    if role in {"admin", "owner", "superadmin"}:
        return True
    if role.startswith("manager_") or role.startswith("manager-"):
        return True
    if role in {"pic_marketing", "pic_toko"}:
        return True
    return False


def _generate_task_code():
    """Generate unique task code: TSK-YYYYMMDD-XXXX"""
    now = _now()
    date_str = now.strftime("%Y%m%d")
    random_suffix = str(uuid.uuid4())[:8].upper()
    return f"TSK-{date_str}-{random_suffix}"


# ═══════════════════════════════════════════════════════════════════════════════
# HEALTH SCORE CALCULATION
# (Re-extracted from original marketing.py — Session #11.20 recovery)
# ═══════════════════════════════════════════════════════════════════════════════

async def _recalculate_health_score(db, account_id: str):
    """
    Calculate health score untuk account berdasarkan data 30 hari terakhir.

    Health Score = (
      Sales Performance (30%) +
      Fulfillment Quality (25%) +
      Customer Satisfaction (25%) +
      Engagement (10%) +
      Compliance (10%)
    ) / 5 × 100

    Score range: 0-100
    - 80-100: Excellent (green)
    - 60-79: Good (yellow)
    - <60: Needs Improvement (red)
    """
    date_to = _now().strftime("%Y-%m-%d")
    date_from = (_now() - timedelta(days=30)).strftime("%Y-%m-%d")

    sales_data = await db.marketing_sales_data.find({
        "account_id": account_id,
        "date": {"$gte": date_from, "$lte": date_to}
    }, {"_id": 0}).to_list(500)

    sales_data = [s for s in sales_data if s.get("revenue_type") in ("total", "live")]

    if not sales_data:
        await db.marketing_platform_accounts.update_one(
            {"id": account_id},
            {"$set": {"health_score": None, "updated_at": _now()}}
        )
        return None

    # 1. Sales Performance (30 points)
    total_revenue = sum(s.get("metrics", {}).get("revenue", 0) for s in sales_data if s.get("revenue_type") == "total")
    total_orders = sum(s.get("metrics", {}).get("orders", 0) for s in sales_data if s.get("revenue_type") == "total")
    avg_conversion = sum(s.get("metrics", {}).get("conversion_rate", 0) for s in sales_data) / len(sales_data) if sales_data else 0

    sales_score = 0
    if total_revenue > 0:
        sales_score += 15
    if total_orders > 100:
        sales_score += 10
    if avg_conversion > 0.02:
        sales_score += 5

    # 2. Fulfillment Quality (25 points)
    fulfillment_data = [s for s in sales_data if s.get("fulfillment")]
    if fulfillment_data:
        avg_fulfillment = sum(s["fulfillment"].get("fulfillment_rate", 0) for s in fulfillment_data) / len(fulfillment_data)
        avg_cancellation = sum(s["fulfillment"].get("cancellation_rate", 0) for s in fulfillment_data) / len(fulfillment_data)
        avg_return = sum(s["fulfillment"].get("return_rate", 0) for s in fulfillment_data) / len(fulfillment_data)
        avg_late = sum(s["fulfillment"].get("late_shipment_rate", 0) for s in fulfillment_data) / len(fulfillment_data)
        fulfillment_score = (avg_fulfillment * 10) + max(0, (1 - avg_cancellation) * 5) + max(0, (1 - avg_return) * 5) + max(0, (1 - avg_late) * 5)
    else:
        fulfillment_score = 0

    # 3. Customer Satisfaction (25 points)
    satisfaction_data = [s for s in sales_data if s.get("customer_satisfaction")]
    if satisfaction_data:
        avg_rating = sum(s["customer_satisfaction"].get("rating", 0) for s in satisfaction_data) / len(satisfaction_data)
        avg_response_rate = sum(s["customer_satisfaction"].get("response_rate", 0) for s in satisfaction_data) / len(satisfaction_data)
        avg_response_time = sum(s["customer_satisfaction"].get("response_time_hours", 0) for s in satisfaction_data) / len(satisfaction_data)
        rating_score = (avg_rating / 5) * 15
        response_score = avg_response_rate * 5
        time_score = max(0, 5 - (avg_response_time / 5))
        satisfaction_score = rating_score + response_score + time_score
    else:
        satisfaction_score = 0

    # 4. Engagement (10 points)
    live_data = [s for s in sales_data if s.get("revenue_type") == "live" and s.get("live_metrics")]
    if live_data:
        total_viewers = sum(s.get("live_metrics", {}).get("viewers", 0) for s in live_data)
        total_likes = sum(s.get("live_metrics", {}).get("likes", 0) for s in live_data)
        total_shares = sum(s.get("live_metrics", {}).get("shares", 0) for s in live_data)
        engagement_score = 0
        if total_viewers > 1000:
            engagement_score += 5
        if total_likes > 500:
            engagement_score += 3
        if total_shares > 50:
            engagement_score += 2
    else:
        engagement_score = 5

    # 5. Compliance (10 points)
    compliance_score = 10 if len(sales_data) >= 7 else 5

    total_score = sales_score + fulfillment_score + satisfaction_score + engagement_score + compliance_score
    health_score = min(100, max(0, round(total_score)))

    await db.marketing_platform_accounts.update_one(
        {"id": account_id},
        {"$set": {"health_score": health_score, "updated_at": _now()}}
    )

    return health_score
