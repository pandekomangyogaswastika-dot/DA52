"""
Rahaza Bundles - Orchestrator
Bundle tracking system for production floor
"""
from fastapi import APIRouter
from routes import (
    rahaza_bundles_mgmt,
    rahaza_bundles_docs,
    rahaza_bundles_rework
)

router = APIRouter(prefix="/api/rahaza", tags=["bundles"])

router.include_router(rahaza_bundles_mgmt.router, prefix="")
router.include_router(rahaza_bundles_docs.router, prefix="")
router.include_router(rahaza_bundles_rework.router, prefix="")
