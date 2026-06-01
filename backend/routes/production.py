"""
Production - Main orchestrator
Aggregates all production sub-routers
"""
from fastapi import APIRouter
from routes import (
    production_jobs,
    production_progress,
    production_work_orders,
    production_returns,
    production_variances
)

router = APIRouter(prefix="/api", tags=["production"])

# Include all sub-routers (remove prefix since sub-routers already have /api)
router.include_router(production_jobs.router, prefix="", tags=["production-jobs"])
router.include_router(production_progress.router, prefix="", tags=["production-progress"])
router.include_router(production_work_orders.router, prefix="", tags=["production-work-orders"])
router.include_router(production_returns.router, prefix="", tags=["production-returns"])
router.include_router(production_variances.router, prefix="", tags=["production-variances"])
