"""
Ads Performance Dashboard — Backend Routes
Phase 3 Week 7: Manage imported ads campaign data (Meta, TikTok, Google Ads)
Gap 3 (2026-05): AI recommendations endpoint
"""
import uuid
import logging
import os
import json
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, Request, Query, HTTPException
from database import get_db
from auth import require_auth
from emergentintegrations.llm.chat import LlmChat, UserMessage
import random

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/marketing/ads", tags=["marketing-ads"])

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
async def seed_ads_if_empty():
    """Auto-seed realistic ads campaign data if collection is empty."""
    db = get_db()
    if await db.marketing_ads_data.count_documents({}) > 0:
        return
    
    platforms = ["meta", "tiktok", "google"]
    campaign_names = [
        "Summer Fashion Collection",
        "Flash Sale Weekend",
        "New Arrival Promo",
        "Brand Awareness Q1",
        "Retargeting Campaign",
        "Lookalike Audience Test",
        "Product Launch - Kaos Premium"
    ]
    
    ads_records = []
    for i in range(25):  # 25 campaign snapshots
        platform = random.choice(platforms)
        campaign = random.choice(campaign_names)
        date = _now() - timedelta(days=random.randint(1, 60))
        
        spend = random.uniform(500000, 5000000)
        impressions = int(spend * random.uniform(50, 200))  # impressions per Rp
        clicks = int(impressions * random.uniform(0.01, 0.05))  # CTR 1-5%
        conversions = int(clicks * random.uniform(0.02, 0.10))  # CVR 2-10%
        revenue = conversions * random.uniform(50000, 200000)  # avg order value
        
        ctr = (clicks / impressions * 100) if impressions > 0 else 0
        cpa = (spend / conversions) if conversions > 0 else 0
        roas = (revenue / spend) if spend > 0 else 0
        
        ads_records.append({
            "id": str(uuid.uuid4()),
            "platform": platform,
            "campaign_name": f"{campaign} - {platform.upper()}",
            "campaign_id": f"CMP-{uuid.uuid4().hex[:8]}",
            "date": date,
            "spend": round(spend, 2),
            "impressions": impressions,
            "clicks": clicks,
            "conversions": conversions,
            "revenue": round(revenue, 2),
            "ctr": round(ctr, 2),
            "cpa": round(cpa, 2),
            "roas": round(roas, 2),
            "status": "active" if random.random() > 0.3 else "paused",
            "created_at": date,
            "updated_at": date
        })
    
    if ads_records:
        await db.marketing_ads_data.insert_many(ads_records)
        try:
            await db.marketing_ads_data.create_index("id", unique=True, sparse=True)
        except Exception:
            pass
        try:
            await db.marketing_ads_data.create_index("platform")
            await db.marketing_ads_data.create_index("campaign_id")
            await db.marketing_ads_data.create_index("date")
            await db.marketing_ads_data.create_index("status")
        except Exception:
            pass
        logger.info(f"[seed] Inserted {len(ads_records)} ads campaign records")

# ── Endpoints ──

@router.get("/summary")
async def ads_summary(request: Request):
    await require_auth(request)
    db = get_db()
    await seed_ads_if_empty()
    
    # Overall stats
    pipeline = [
        {"$group": {
            "_id": None,
            "total_spend": {"$sum": "$spend"},
            "total_revenue": {"$sum": "$revenue"},
            "total_impressions": {"$sum": "$impressions"},
            "total_clicks": {"$sum": "$clicks"},
            "total_conversions": {"$sum": "$conversions"},
            "campaigns": {"$sum": 1}
        }}
    ]
    
    result = await db.marketing_ads_data.aggregate(pipeline).to_list(1)
    stats = result[0] if result else {
        "total_spend": 0, "total_revenue": 0, "total_impressions": 0,
        "total_clicks": 0, "total_conversions": 0, "campaigns": 0
    }
    
    overall_roas = (stats["total_revenue"] / stats["total_spend"]) if stats["total_spend"] > 0 else 0
    overall_ctr = (stats["total_clicks"] / stats["total_impressions"] * 100) if stats["total_impressions"] > 0 else 0
    overall_cpa = (stats["total_spend"] / stats["total_conversions"]) if stats["total_conversions"] > 0 else 0
    
    # By platform
    platform_pipeline = [
        {"$group": {
            "_id": "$platform",
            "spend": {"$sum": "$spend"},
            "revenue": {"$sum": "$revenue"},
            "campaigns": {"$sum": 1}
        }}
    ]
    by_platform = {}
    async for doc in db.marketing_ads_data.aggregate(platform_pipeline):
        by_platform[doc["_id"]] = {
            "spend": doc["spend"],
            "revenue": doc["revenue"],
            "campaigns": doc["campaigns"],
            "roas": round((doc["revenue"] / doc["spend"]) if doc["spend"] > 0 else 0, 2)
        }
    
    return success_response(data={
        "total_spend": stats["total_spend"],
        "total_revenue": stats["total_revenue"],
        "total_campaigns": stats["campaigns"],
        "overall_roas": round(overall_roas, 2),
        "overall_ctr": round(overall_ctr, 2),
        "overall_cpa": round(overall_cpa, 2),
        "total_conversions": stats["total_conversions"],
        "by_platform": by_platform
    })

@router.get("/campaigns")
async def list_campaigns(
    request: Request,
    platform: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=10, le=100)
):
    await require_auth(request)
    db = get_db()
    await seed_ads_if_empty()
    
    query = {}
    if platform:
        query["platform"] = platform
    if status:
        query["status"] = status
    
    total = await db.marketing_ads_data.count_documents(query)
    skip = (page - 1) * page_size
    
    campaigns = await db.marketing_ads_data.find(query).sort("date", -1).skip(skip).limit(page_size).to_list(page_size)
    
    return success_response(
        data={"campaigns": serialize(campaigns)},
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
    await seed_ads_if_empty()
    
    start_dt = _now() - timedelta(days=days)
    
    pipeline = [
        {"$match": {"date": {"$gte": start_dt}}},
        {"$group": {
            "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$date"}},
            "spend": {"$sum": "$spend"},
            "revenue": {"$sum": "$revenue"},
            "conversions": {"$sum": "$conversions"}
        }},
        {"$sort": {"_id": 1}}
    ]
    
    trend = []
    async for doc in db.marketing_ads_data.aggregate(pipeline):
        roas = (doc["revenue"] / doc["spend"]) if doc["spend"] > 0 else 0
        trend.append({
            "date": doc["_id"],
            "spend": doc["spend"],
            "revenue": doc["revenue"],
            "conversions": doc["conversions"],
            "roas": round(roas, 2)
        })
    
    return success_response(data={"trend": trend}, metadata={"days": days})


@router.post("/ai-recommendations")
async def get_ai_recommendations(request: Request):
    """
    AI-generated recommendations untuk campaign optimization.
    Analisis ROAS, CTR, CPA dan berikan saran konkret per campaign.
    """
    await require_auth(request)
    db = get_db()
    await seed_ads_if_empty()

    if not EMERGENT_LLM_KEY:
        raise HTTPException(500, "AI tidak dikonfigurasi")

    # Ambil data campaign terakhir (max 20)
    campaigns = await db.marketing_ads_data.find({}).sort("date", -1).limit(20).to_list(20)

    if not campaigns:
        return success_response(data={"recommendations": [], "summary": "Belum ada data campaign."})

    # Build context
    camp_summary = []
    for c in campaigns:
        camp_summary.append({
            "nama": c.get("campaign_name", ""),
            "platform": c.get("platform", ""),
            "status": c.get("status", ""),
            "spend_rp": round(c.get("spend", 0)),
            "revenue_rp": round(c.get("revenue", 0)),
            "roas": c.get("roas", 0),
            "ctr_pct": c.get("ctr", 0),
            "cpa_rp": round(c.get("cpa", 0)),
            "conversions": c.get("conversions", 0)
        })

    # Aggregate platform stats
    platform_stats = {}
    for c in campaigns:
        p = c.get("platform", "unknown")
        if p not in platform_stats:
            platform_stats[p] = {"spend": 0, "revenue": 0, "campaigns": 0}
        platform_stats[p]["spend"] += c.get("spend", 0)
        platform_stats[p]["revenue"] += c.get("revenue", 0)
        platform_stats[p]["campaigns"] += 1
    for p in platform_stats:
        s = platform_stats[p]
        s["roas"] = round(s["revenue"] / s["spend"], 2) if s["spend"] > 0 else 0

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"ads-rec-{uuid.uuid4().hex[:8]}",
        system_message=(
            "Kamu adalah konsultan ads performance untuk brand fashion Indonesia. "
            "Berikan rekomendasi yang spesifik dan actionable per campaign. "
            "Respond only with valid JSON."
        )
    ).with_model("openai", "gpt-4o-mini")

    prompt = (
        f"Data ads campaign CV Dewi Aditya (fashion brand Indonesia):\n"
        f"Campaign list: {json.dumps(camp_summary, ensure_ascii=False)}\n"
        f"Platform summary: {json.dumps(platform_stats, ensure_ascii=False)}\n\n"
        f"Analisis dan berikan rekomendasi optimasi. Return JSON persis:\n"
        f"{{\"recommendations\": ["
        f"  {{\"type\": \"pause|scale_up|optimize|budget_shift|creative_refresh\", "
        f"  \"campaign\": \"nama campaign atau 'ALL'\", "
        f"  \"platform\": \"platform\", "
        f"  \"priority\": \"urgent|high|medium|low\", "
        f"  \"action\": \"aksi konkret yang harus dilakukan\", "
        f"  \"reason\": \"alasan berdasarkan data (ROAS/CTR/CPA)\", "
        f"  \"expected_impact\": \"dampak yang diharapkan\"}}], "
        f"\"best_platform\": \"platform terbaik\", "
        f"\"worst_platform\": \"platform terburuk\", "
        f"\"overall_roas\": 2.5, "
        f"\"summary\": \"ringkasan 2-3 kalimat Bahasa Indonesia\", "
        f"\"budget_advice\": \"saran alokasi budget\"}}"
    )

    try:
        response = await chat.send_message(UserMessage(text=prompt))
        clean = response.strip()
        if clean.startswith("```"):
            lines = clean.split("\n")
            clean = "\n".join(lines[1:-1])
        result = json.loads(clean)
        return success_response(data=result, metadata={"campaigns_analyzed": len(campaigns)})
    except Exception as e:
        logger.error(f"Ads AI recommendations error: {e}")
        raise HTTPException(500, f"Rekomendasi AI gagal: {e}")
