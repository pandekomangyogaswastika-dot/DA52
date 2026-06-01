"""
Live Session Module — Backend Routes
Phase 3 Week 7: Manage live streaming session performance data
"""
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, Request, Query
from database import get_db
from auth import require_auth
import random

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/marketing/live", tags=["marketing-live"])

# ── Standardized Response Helper ──
def success_response(data=None, pagination=None, metadata=None):
    response = {"success": True}
    if data is not None:
        response["data"] = data
    if pagination is not None:
        response["pagination"] = pagination
    if metadata is not None:
        response["metadata"] = metadata
    return response

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

# ── Seed Demo Data ──
async def seed_live_if_empty():
    """Auto-seed realistic live session data if collection is empty."""
    db = get_db()
    if await db.marketing_live_sessions.count_documents({}) > 0:
        return
    
    platforms = ["shopee", "tiktok", "instagram"]
    hosts = ["Bella Fashion", "Rini Style", "Dina Trendy", "Mega Boutique"]
    
    live_records = []
    for i in range(18):  # 18 live sessions
        platform = random.choice(platforms)
        host = random.choice(hosts)
        date = _now() - timedelta(days=random.randint(1, 45))
        
        duration_min = random.randint(30, 180)
        peak_viewers = random.randint(100, 3000)
        total_viewers = int(peak_viewers * random.uniform(1.5, 4))
        likes = int(total_viewers * random.uniform(0.3, 0.8))
        comments = int(total_viewers * random.uniform(0.1, 0.4))
        shares = int(total_viewers * random.uniform(0.02, 0.1))
        
        orders = int(peak_viewers * random.uniform(0.05, 0.2))
        revenue = orders * random.uniform(50000, 250000)
        
        engagement_rate = ((likes + comments + shares) / total_viewers * 100) if total_viewers > 0 else 0
        conversion_rate = (orders / total_viewers * 100) if total_viewers > 0 else 0
        
        live_records.append({
            "id": str(uuid.uuid4()),
            "platform": platform,
            "host_name": host,
            "title": f"Live Shopping {random.choice(['Fashion', 'Beauty', 'Accessories'])} - {date.strftime('%b %d')}",
            "session_date": date,
            "duration_minutes": duration_min,
            "peak_viewers": peak_viewers,
            "total_viewers": total_viewers,
            "likes": likes,
            "comments": comments,
            "shares": shares,
            "orders": orders,
            "revenue": round(revenue, 2),
            "engagement_rate": round(engagement_rate, 2),
            "conversion_rate": round(conversion_rate, 2),
            "products_featured": random.randint(5, 20),
            "status": "completed",
            "notes": [],
            "created_at": date,
            "updated_at": date
        })
    
    if live_records:
        await db.marketing_live_sessions.insert_many(live_records)
        try:
            await db.marketing_live_sessions.create_index("id", unique=True, sparse=True)
        except Exception:
            pass
        try:
            await db.marketing_live_sessions.create_index("platform")
            await db.marketing_live_sessions.create_index("host_name")
            await db.marketing_live_sessions.create_index("session_date")
            await db.marketing_live_sessions.create_index("status")
        except Exception:
            pass
        logger.info(f"[seed] Inserted {len(live_records)} live session records")

# ── Endpoints ──

@router.get("/summary")
async def live_summary(request: Request):
    await require_auth(request)
    db = get_db()
    await seed_live_if_empty()
    
    # Overall stats
    pipeline = [
        {"$group": {
            "_id": None,
            "total_sessions": {"$sum": 1},
            "total_revenue": {"$sum": "$revenue"},
            "total_orders": {"$sum": "$orders"},
            "total_viewers": {"$sum": "$total_viewers"},
            "avg_engagement": {"$avg": "$engagement_rate"},
            "avg_conversion": {"$avg": "$conversion_rate"}
        }}
    ]
    
    result = await db.marketing_live_sessions.aggregate(pipeline).to_list(1)
    stats = result[0] if result else {
        "total_sessions": 0, "total_revenue": 0, "total_orders": 0,
        "total_viewers": 0, "avg_engagement": 0, "avg_conversion": 0
    }
    
    # By platform
    platform_pipeline = [
        {"$group": {
            "_id": "$platform",
            "sessions": {"$sum": 1},
            "revenue": {"$sum": "$revenue"},
            "viewers": {"$sum": "$total_viewers"}
        }}
    ]
    by_platform = {}
    async for doc in db.marketing_live_sessions.aggregate(platform_pipeline):
        by_platform[doc["_id"]] = {
            "sessions": doc["sessions"],
            "revenue": doc["revenue"],
            "viewers": doc["viewers"]
        }
    
    # Top hosts
    host_pipeline = [
        {"$group": {
            "_id": "$host_name",
            "sessions": {"$sum": 1},
            "revenue": {"$sum": "$revenue"}
        }},
        {"$sort": {"revenue": -1}},
        {"$limit": 5}
    ]
    top_hosts = []
    async for doc in db.marketing_live_sessions.aggregate(host_pipeline):
        top_hosts.append({"host": doc["_id"], "sessions": doc["sessions"], "revenue": doc["revenue"]})
    
    return success_response(data={
        "total_sessions": stats["total_sessions"],
        "total_revenue": stats["total_revenue"],
        "total_orders": stats["total_orders"],
        "total_viewers": stats["total_viewers"],
        "avg_engagement_rate": round(stats["avg_engagement"], 2),
        "avg_conversion_rate": round(stats["avg_conversion"], 2),
        "by_platform": by_platform,
        "top_hosts": top_hosts
    })

@router.get("/sessions")
async def list_sessions(
    request: Request,
    platform: Optional[str] = Query(None),
    host: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=10, le=100)
):
    await require_auth(request)
    db = get_db()
    await seed_live_if_empty()
    
    query = {}
    if platform:
        query["platform"] = platform
    if host:
        query["host_name"] = host
    
    total = await db.marketing_live_sessions.count_documents(query)
    skip = (page - 1) * page_size
    
    sessions = await db.marketing_live_sessions.find(query).sort("session_date", -1).skip(skip).limit(page_size).to_list(page_size)
    
    return success_response(
        data={"sessions": serialize(sessions)},
        pagination={
            "page": page,
            "page_size": page_size,
            "total": total,
            "total_pages": (total + page_size - 1) // page_size
        }
    )

@router.get("/performance-trend")
async def performance_trend(
    request: Request,
    days: int = Query(30, ge=7, le=90)
):
    await require_auth(request)
    db = get_db()
    await seed_live_if_empty()
    
    start_dt = _now() - timedelta(days=days)
    
    pipeline = [
        {"$match": {"session_date": {"$gte": start_dt}}},
        {"$group": {
            "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$session_date"}},
            "sessions": {"$sum": 1},
            "revenue": {"$sum": "$revenue"},
            "viewers": {"$sum": "$total_viewers"}
        }},
        {"$sort": {"_id": 1}}
    ]
    
    trend = []
    async for doc in db.marketing_live_sessions.aggregate(pipeline):
        trend.append({
            "date": doc["_id"],
            "sessions": doc["sessions"],
            "revenue": doc["revenue"],
            "viewers": doc["viewers"]
        })
    
    return success_response(data={"trend": trend}, metadata={"days": days})
