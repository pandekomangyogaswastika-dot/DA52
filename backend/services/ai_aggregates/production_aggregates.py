"""Production & maklon aggregates for AI endpoints."""
from __future__ import annotations

from datetime import datetime, timezone


async def production_summary(db, *, since_iso: str) -> dict:
    """Counts of WOs created and completed since timestamp."""
    new_count = await db.production_work_orders.count_documents(
        {"created_at": {"$gte": since_iso}}
    )
    done_count = await db.production_work_orders.count_documents(
        {"status": "completed", "updated_at": {"$gte": since_iso}}
    )
    return {"work_order_baru": new_count, "work_order_selesai": done_count}


async def maklon_summary(db, *, since_iso: str, lmo_adapter) -> dict:
    """Counts of maklon orders entered and completed via SSOT view."""
    new_count = await lmo_adapter(db).count_documents({"order_date": {"$gte": since_iso}})
    done_count = await lmo_adapter(db).count_documents({
        "stage": {"$in": ["completed", "invoiced"]},
        "updated_at": {"$gte": since_iso},
    })
    return {"order_masuk": new_count, "order_selesai": done_count}


async def active_workorders(db, *, limit: int = 10) -> list[dict]:
    """Top active work orders (projection only)."""
    return await db.production_work_orders.find(
        {"status": {"$in": ["in_progress", "pending", "not_started"]}},
        {
            "_id": 0, "id": 1, "order_code": 1, "product_name": 1,
            "quantity": 1, "priority": 1, "target_date": 1,
            "status": 1, "stage": 1,
        },
    ).sort("target_date", 1).limit(limit).to_list(limit)


async def active_maklon(db, *, lmo_adapter, limit: int = 10) -> list[dict]:
    return await lmo_adapter(db).find(
        {"stage": {"$in": ["confirmed", "material_ready", "cutting", "sewing", "qc"]}},
        {
            "_id": 0, "order_code": 1, "garment_type": 1,
            "quantity": 1, "deadline_date": 1, "stage": 1,
        },
    ).sort("deadline_date", 1).limit(limit).to_list(limit)


async def production_counts(db, *, lmo_adapter) -> dict:
    """Counts of active WOs/maklon for optimizer overview."""
    wo_active = await db.production_work_orders.count_documents(
        {"status": {"$in": ["in_progress", "pending", "not_started"]}}
    )
    maklon_active = await lmo_adapter(db).count_documents(
        {"stage": {"$in": ["confirmed", "material_ready", "cutting", "sewing", "qc"]}}
    )
    return {"wo_active": wo_active, "maklon_active": maklon_active}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)
