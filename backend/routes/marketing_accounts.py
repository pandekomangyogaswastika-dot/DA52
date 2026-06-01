# ruff: noqa: F401
"""
marketing_accounts.py — Platform Account Management
Extracted from marketing.py (1757 LOC monolith)

Refactored: Session #11.19 Phase 3.2 Batch #3
Endpoints: POST /accounts, GET /accounts, GET /accounts/{id}, PUT /accounts/{id}, DELETE /accounts/{id}
"""
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Request, Query
from pydantic import BaseModel, Field
from database import get_db
from auth import require_auth, serialize_doc, log_activity
from routes.marketing_shared import _uid, _now, _get_user, _sanitize, PlatformAccountCreate, PlatformAccountUpdate, SalesDataEntry

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/api/marketing', tags=['Marketing-Accounts'])

@router.post("/accounts")
async def create_platform_account(data: PlatformAccountCreate, request: Request):
    """
    Create new platform account.
    PIC Marketing can create unlimited accounts per platform.
    """
    await require_auth(request)
    db = get_db()
    
    # Validate platform
    valid_platforms = ["shopee", "tiktokshop", "tokopedia"]
    if data.platform not in valid_platforms:
        raise HTTPException(400, f"Platform must be one of: {', '.join(valid_platforms)}")
    
    # Check duplicate account_code
    existing = await db.marketing_platform_accounts.find_one({"account_code": data.account_code}, {"_id": 0})
    if existing:
        raise HTTPException(400, f"Account code '{data.account_code}' already exists")
    
    account = {
        "id": _uid(),
        "account_code": _sanitize(data.account_code, 100),
        "account_name": _sanitize(data.account_name, 200),
        "platform": data.platform,
        "username": _sanitize(data.username or "", 100),
        "status": "active",
        "group": data.group or "other",
        "credentials": {
            "api_key": "",
            "api_secret": "",
            "has_api_integration": data.has_api_integration
        },
        "import_config": {
            "saved_templates": []
        },
        "assigned_staff": [],
        "pic_id": getattr(request.state, 'user', {}).get("id", "system"),
        "health_score": None,  # None = belum ada data (UI tampilkan "N/A")
        "created_at": _now(),
        "created_by": getattr(request.state, 'user', {}).get("email", "system"),
        "updated_at": _now()
    }
    
    await db.marketing_platform_accounts.insert_one(account)
    
    await log_activity(
        getattr(request.state, 'user', {}).get("id", "system"),
        getattr(request.state, 'user', {}).get("name") or getattr(request.state, 'user', {}).get("email", "system"),
        "create",
        "marketing_account",
        f"Created platform account: {data.account_name} ({data.platform})"
    )
    
    return serialize_doc({"message": "Platform account created", "account": account})


@router.get("/accounts")
async def list_platform_accounts(
    request: Request,
    platform: Optional[str] = Query(None, description="Filter by platform"),
    status: Optional[str] = Query(None, description="Filter by status"),
    group: Optional[str] = Query(None, description="Filter by group")
):
    """
    List all platform accounts with optional filters.
    PIC Marketing sees all, Staff sees assigned only.
    """
    await require_auth(request)
    db = get_db()
    
    query = {}
    
    # Build query filters
    if platform:
        query["platform"] = platform
    if status:
        query["status"] = status
    if group:
        query["group"] = group
    
    # Role-based filtering — Phase 2: implement proper staff-only view
    # Currently showing all accounts to all authenticated users
    # Future: if user_role == "staff": query["assigned_staff"] = user_id
    
    accounts = await db.marketing_platform_accounts.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    
    return serialize_doc(accounts)


@router.get("/accounts/{account_id}")
async def get_platform_account(account_id: str, request: Request):
    """Get platform account detail"""
    await require_auth(request)
    db = get_db()
    
    account = await db.marketing_platform_accounts.find_one({"id": account_id}, {"_id": 0})
    if not account:
        raise HTTPException(404, "Account not found")
    
    return serialize_doc(account)


@router.put("/accounts/{account_id}")
async def update_platform_account(account_id: str, data: PlatformAccountUpdate, request: Request):
    """Update platform account"""
    await require_auth(request)
    db = get_db()
    
    account = await db.marketing_platform_accounts.find_one({"id": account_id}, {"_id": 0})
    if not account:
        raise HTTPException(404, "Account not found")
    
    # Build update dict
    update_data = {}
    if data.account_name is not None:
        update_data["account_name"] = data.account_name
    if data.username is not None:
        update_data["username"] = data.username
    if data.group is not None:
        update_data["group"] = data.group
    if data.status is not None:
        valid_status = ["active", "inactive", "suspended"]
        if data.status not in valid_status:
            raise HTTPException(400, f"Status must be one of: {', '.join(valid_status)}")
        update_data["status"] = data.status
    if data.has_api_integration is not None:
        update_data["credentials.has_api_integration"] = data.has_api_integration
    if data.pic_user_id is not None:
        update_data["pic_user_id"] = data.pic_user_id
        # Denormalize nama PIC untuk tampilan
        if data.pic_user_id:
            pic_user = await db.users.find_one({"id": data.pic_user_id}, {"_id": 0, "name": 1, "email": 1})
            update_data["pic_user_name"] = (pic_user.get("name") or pic_user.get("email")) if pic_user else None
        else:
            update_data["pic_user_name"] = None
    
    update_data["updated_at"] = _now()
    
    await db.marketing_platform_accounts.update_one(
        {"id": account_id},
        {"$set": update_data}
    )
    
    await log_activity(
        (_get_user(request)).get("id", "system"),
        (_get_user(request)).get("name") or (_get_user(request)).get("email", "system"),
        "update",
        "marketing_account",
        f"Updated platform account: {account['account_name']}"
    )
    
    # Get updated account
    updated = await db.marketing_platform_accounts.find_one({"id": account_id}, {"_id": 0})
    return serialize_doc({"message": "Platform account updated", "account": updated})


@router.delete("/accounts/{account_id}")
async def archive_platform_account(account_id: str, request: Request):
    """
    Archive (soft delete) platform account.
    Sets status to 'inactive' instead of hard delete.
    """
    await require_auth(request)
    db = get_db()
    
    account = await db.marketing_platform_accounts.find_one({"id": account_id}, {"_id": 0})
    if not account:
        raise HTTPException(404, "Account not found")
    
    await db.marketing_platform_accounts.update_one(
        {"id": account_id},
        {"$set": {"status": "inactive", "updated_at": _now()}}
    )
    
    await log_activity(
        (_get_user(request)).get("id", "system"),
        (_get_user(request)).get("name") or (_get_user(request)).get("email", "system"),
        "archive",
        "marketing_account",
        f"Archived platform account: {account['account_name']}"
    )
    
    return serialize_doc({"message": "Platform account archived"})


# ══════════════════════════════════════════════════════════════════════════════
# SALES DATA ENTRY (Manual for Phase 1)
# ══════════════════════════════════════════════════════════════════════════════
