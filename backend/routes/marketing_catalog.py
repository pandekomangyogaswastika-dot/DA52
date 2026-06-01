"""
Marketing Catalog - Orchestrator
"""
from fastapi import APIRouter
from routes import (
    marketing_catalog_mgmt,
    marketing_catalog_items,
    marketing_catalog_stock
)

router = APIRouter(tags=['Marketing-Catalog'])

router.include_router(marketing_catalog_mgmt.router)
router.include_router(marketing_catalog_items.router)
router.include_router(marketing_catalog_stock.router)
