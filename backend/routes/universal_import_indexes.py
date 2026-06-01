"""
DB Indexes for Universal Smart Import Engine
Run once on startup via server.py
"""
from database import get_db
import logging

logger = logging.getLogger(__name__)


async def ensure_import_indexes():
    db = get_db()
    try:
        await db.marketing_import_sessions.create_index("id", unique=True)
        await db.marketing_import_sessions.create_index("status")
        await db.marketing_import_sessions.create_index("source_type")
        await db.marketing_import_sessions.create_index("file_hash")
        await db.marketing_import_sessions.create_index("created_at")
        await db.marketing_import_sessions.create_index("created_by_id")

        await db.marketing_import_templates.create_index("id", unique=True)
        await db.marketing_import_templates.create_index("source_type")
        await db.marketing_import_templates.create_index("use_count")

        # Target collections
        for coll in ["marketing_orders", "marketing_complaints", "marketing_reviews",
                     "marketing_ads_data", "marketing_account_health",
                     "marketing_live_sessions", "marketing_content_calendar",
                     "marketing_product_launches"]:
            await db[coll].create_index("id", unique=True, sparse=True)
            await db[coll].create_index("_import_session_id")

        logger.info("Import indexes created")
    except Exception as e:
        logger.warning(f"Import index creation: {e}")
