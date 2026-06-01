"""
CV. Dewi Aditya ERP — Procurement Request (Request Pengadaan)

Workflow pengadaan aset/barang internal dengan approval multi-level:
  Draft → Submitted → Dept Approval → Finance Approval → Approved / Rejected

Collections:
  dewi_procurement_requests — request utama
  dewi_procurement_items    — item detail per request
  dewi_procurement_approvals — log approval per request

Endpoints:
  GET    /api/procurement/dashboard         — summary stats
  GET    /api/procurement/requests          — list requests (paginated)
  POST   /api/procurement/requests          — buat request baru
  GET    /api/procurement/requests/{id}     — detail request
  PUT    /api/procurement/requests/{id}     — update (only draft)
  POST   /api/procurement/requests/{id}/submit   — submit ke approval
  POST   /api/procurement/requests/{id}/approve  — approve (dept/finance)
  POST   /api/procurement/requests/{id}/reject   — reject
  POST   /api/procurement/requests/{id}/cancel   — cancel (by requester)
  POST   /api/procurement/requests/{id}/complete — mark completed + optional link asset
  GET    /api/procurement/inbox             — items awaiting my approval
  GET    /api/procurement/requests/{id}/timeline — approval timeline
"""
from fastapi import APIRouter, Request, HTTPException, Query
from database import get_db
from auth import require_auth
from datetime import datetime, timezone, date
from typing import Optional
import uuid
import math
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/procurement", tags=["procurement"])


def _uid(): return str(uuid.uuid4())
def _now(): return datetime.now(timezone.utc)


# ─── Communication Hub Notification Helper ────────────────────────────────
PROCUREMENT_CHANNEL_NAME = "procurement-notifications"


async def _get_or_create_procurement_channel(db) -> dict:
    """Lazily create the system channel for procurement notifications.

    Channel ini bersifat public (semua user dapat join/lihat). Initial members
    diisi user yang berperan sebagai dept_head/finance/admin/manager.
    """
    ch = await db.comm_channels.find_one({"name": PROCUREMENT_CHANNEL_NAME})
    if ch:
        return ch
    # Auto-populate members with privileged roles (best-effort)
    initial_members = []
    try:
        users_cursor = db.users.find(
            {"$or": [
                {"role": {"$in": ["admin", "manager", "dept_head", "finance"]}},
                {"is_admin": True},
            ]},
            {"_id": 0, "id": 1},
        )
        async for u in users_cursor:
            if u.get("id"):
                initial_members.append(u["id"])
    except Exception:
        pass
    # Also add ALL active users so everyone gets procurement notifications
    try:
        all_users_cursor = db.users.find({"is_active": {"$ne": False}}, {"_id": 0, "id": 1})
        async for u in all_users_cursor:
            if u.get("id"):
                initial_members.append(u["id"])
    except Exception:
        pass
    initial_members = list(set(initial_members))
    doc = {
        "id": _uid(),
        "name": PROCUREMENT_CHANNEL_NAME,
        "description": "Notifikasi otomatis approval/penolakan permintaan pengadaan.",
        "type": "public",
        "members": initial_members,
        "department": None,
        "created_by": "system",
        "created_by_name": "System",
        "archived": False,
        "created_at": _now(),
        "updated_at": _now(),
        "last_message": None,
        "last_message_at": None,
        "is_system": True,
    }
    await db.comm_channels.insert_one(doc)
    return doc


async def _notify_procurement_event(
    db,
    pr: dict,
    actor: dict,
    action: str,            # "approved" | "rejected" | "final_approved"
    new_status: str,
    comment: str = "",
):
    """Post system message ke channel #procurement-notifications dan DM ke requester.

    Best-effort: error apapun di-log tapi tidak mem-block flow approval utama.
    """
    try:
        # Lazy import untuk hindari circular dependency
        from routes.dewi_communication import comm_manager  # type: ignore

        req_no = pr.get("request_number", "")
        title = pr.get("title", "")
        requester_id = pr.get("requested_by")
        status_label = STATUS_LABELS.get(new_status, new_status)
        action_label = {
            "approved": "✅ Disetujui",
            "rejected": "❌ Ditolak",
            "final_approved": "🎉 Disetujui (Final)",
        }.get(action, action.capitalize())

        body_lines = [
            f"{action_label} — Permintaan Pengadaan",
            f"No: {req_no}",
            f"Judul: {title}",
            f"Status: {status_label}",
            f"Oleh: {actor.get('name', '') or actor.get('email', '')}",
        ]
        if comment:
            body_lines.append(f"Catatan: {comment}")
        content = "\n".join(body_lines)

        # 1) Post ke channel #procurement-notifications
        try:
            ch = await _get_or_create_procurement_channel(db)
            ch_msg = {
                "id": _uid(),
                "channel_id": ch["id"],
                "conversation_id": None,
                "sender_id": "system",
                "sender_name": "System",
                "sender_email": "",
                "content": content,
                "message_type": "system_procurement",
                "file_url": None,
                "file_name": None,
                "file_size": None,
                "reply_to_id": None,
                "reply_to_preview": None,
                "reactions": {},
                "edited": False,
                "deleted": False,
                "meta": {
                    "pr_id": pr.get("id"),
                    "request_number": req_no,
                    "action": action,
                    "new_status": new_status,
                },
                "created_at": _now(),
                "updated_at": _now(),
            }
            await db.comm_messages.insert_one(ch_msg)
            await db.comm_channels.update_one(
                {"id": ch["id"]},
                {"$set": {
                    "last_message": content.split("\n", 1)[0],
                    "last_message_at": _now(),
                    "updated_at": _now(),
                }},
            )
            # Pastikan requester ada di channel agar bisa melihat
            if requester_id and requester_id not in (ch.get("members") or []):
                await db.comm_channels.update_one(
                    {"id": ch["id"]},
                    {"$addToSet": {"members": requester_id}},
                )
            members = list(set((ch.get("members") or []) + ([requester_id] if requester_id else [])))
            msg_out = {k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in ch_msg.items() if k != "_id"}
            await comm_manager.broadcast_to_users(members, {
                "type": "new_message",
                "data": {"message": msg_out, "channel_id": ch["id"], "scope": "channel"},
            })
        except Exception as e:
            logger.warning(f"[procurement-notif] gagal post ke channel: {e}")

        # 2) DM ke requester (jika bukan dirinya sendiri)
        if requester_id and requester_id != actor.get("id"):
            try:
                from routes.dewi_communication import _get_or_create_conversation  # type: ignore
                conv = await _get_or_create_conversation(db, "system", requester_id)
                dm_msg = {
                    "id": _uid(),
                    "channel_id": None,
                    "conversation_id": conv["id"],
                    "sender_id": "system",
                    "sender_name": "System",
                    "sender_email": "",
                    "content": content,
                    "message_type": "system_procurement",
                    "file_url": None,
                    "file_name": None,
                    "file_size": None,
                    "reply_to_id": None,
                    "reply_to_preview": None,
                    "reactions": {},
                    "edited": False,
                    "deleted": False,
                    "meta": {
                        "pr_id": pr.get("id"),
                        "request_number": req_no,
                        "action": action,
                        "new_status": new_status,
                    },
                    "created_at": _now(),
                    "updated_at": _now(),
                }
                await db.comm_messages.insert_one(dm_msg)
                await db.comm_conversations.update_one(
                    {"id": conv["id"]},
                    {"$set": {
                        "last_message": content.split("\n", 1)[0],
                        "last_message_at": _now(),
                        "updated_at": _now(),
                    }},
                )
                dm_out = {k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in dm_msg.items() if k != "_id"}
                await comm_manager.send_to_user(requester_id, {
                    "type": "new_message",
                    "data": {"message": dm_out, "conv_id": conv["id"], "scope": "dm"},
                })
            except Exception as e:
                logger.warning(f"[procurement-notif] gagal DM requester: {e}")
    except Exception as e:
        # Top-level safety net — jangan pernah mem-block flow approval karena notif
        logger.warning(f"[procurement-notif] error tak terduga: {e}")


def _ser(doc):
    if not doc:
        return doc
    doc = {k: v for k, v in doc.items() if k != '_id'}
    for k, v in doc.items():
        if isinstance(v, datetime):
            doc[k] = v.isoformat()
        elif isinstance(v, list):
            doc[k] = [_ser(i) if isinstance(i, dict) else i for i in v]
    return doc


STATUS_FLOW = {
    "draft":            ["submitted", "cancelled"],
    "submitted":        ["dept_approved", "rejected", "cancelled"],
    "dept_approved":    ["finance_approved", "rejected"],
    "finance_approved": ["approved"],
    "approved":         ["in_procurement", "completed"],
    "in_procurement":   ["completed"],
    "rejected":         [],
    "completed":        [],
    "cancelled":        [],
}

STATUS_LABELS = {
    "draft":            "Draft",
    "submitted":        "Menunggu Persetujuan Dept",
    "dept_approved":    "Menunggu Persetujuan Finance",
    "finance_approved": "Menunggu Final Approval",
    "approved":         "Disetujui",
    "in_procurement":   "Sedang Pengadaan",
    "completed":        "Selesai",
    "rejected":         "Ditolak",
    "cancelled":        "Dibatalkan",
}


async def _gen_pr_number(db) -> str:
    year = date.today().year
    month = date.today().strftime("%m")
    prefix = f"PR-{year}{month}-"
    cnt = await db.dewi_procurement_requests.count_documents(
        {"request_number": {"$regex": f"^{prefix}"}}
    )
    return f"{prefix}{str(cnt + 1).zfill(4)}"


# ─── Dashboard ────────────────────────────────────────────────────────────

@router.get("/dashboard")
async def procurement_dashboard(request: Request):
    user = await require_auth(request)
    db = get_db()
    total = await db.dewi_procurement_requests.count_documents({})
    pending = await db.dewi_procurement_requests.count_documents(
        {"status": {"$in": ["submitted", "dept_approved", "finance_approved"]}}
    )
    approved = await db.dewi_procurement_requests.count_documents({"status": "approved"})
    completed = await db.dewi_procurement_requests.count_documents({"status": "completed"})
    rejected = await db.dewi_procurement_requests.count_documents({"status": "rejected"})
    my_requests = await db.dewi_procurement_requests.count_documents({"requested_by": user["id"]})
    my_pending_approval = await db.dewi_procurement_requests.count_documents({
        "status": {"$in": ["submitted", "dept_approved"]},
    })

    # Total value approved this month
    month_start = f"{date.today().strftime('%Y-%m')}-01"
    agg = await db.dewi_procurement_requests.aggregate([
        {"$match": {"status": {"$in": ["approved", "completed"]}, "submitted_at": {"$gte": month_start}}},
        {"$group": {"_id": None, "total": {"$sum": "$total_estimated"}}}
    ]).to_list(1)
    total_value_approved = agg[0]["total"] if agg else 0

    recent = await db.dewi_procurement_requests.find(
        {}, {"_id": 0, "id": 1, "request_number": 1, "title": 1, "status": 1, "total_estimated": 1,
             "created_at": 1, "requested_by_name": 1}
    ).sort("created_at", -1).limit(5).to_list(5)

    return {
        "summary": {"total": total, "pending": pending, "approved": approved,
                    "completed": completed, "rejected": rejected,
                    "my_requests": my_requests, "my_pending_approval": my_pending_approval,
                    "total_value_approved_this_month": round(total_value_approved, 2)},
        "recent": [_ser(r) for r in recent],
    }


# ─── Requests CRUD ────────────────────────────────────────────────────────

@router.get("/requests")
async def list_requests(
    request: Request,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    status: Optional[str] = None,
    my_only: bool = Query(False),
    search: Optional[str] = None,
    priority: Optional[str] = None,
):
    user = await require_auth(request)
    db = get_db()
    query = {}
    if status:
        query["status"] = status
    if my_only:
        query["requested_by"] = user["id"]
    if priority:
        query["priority"] = priority
    if search:
        query["$or"] = [
            {"title": {"$regex": search, "$options": "i"}},
            {"request_number": {"$regex": search, "$options": "i"}},
        ]
    total = await db.dewi_procurement_requests.count_documents(query)
    skip = (page - 1) * limit
    items = await db.dewi_procurement_requests.find(
        query, {"_id": 0}
    ).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    return {
        "items": [_ser(i) for i in items],
        "pagination": {"page": page, "page_size": limit, "total": total,
                       "total_pages": math.ceil(total / limit) if total else 1}
    }


@router.post("/requests")
async def create_request(request: Request):
    user = await require_auth(request)
    db = get_db()
    body = await request.json()
    title = (body.get("title") or "").strip()
    if not title:
        raise HTTPException(400, "Judul permintaan wajib diisi.")
    items = body.get("items", [])
    if not items:
        raise HTTPException(400, "Minimal 1 item harus diisi.")

    total_est = sum(float(i.get("estimated_price", 0)) * float(i.get("qty", 1)) for i in items)
    pr_number = await _gen_pr_number(db)
    doc = {
        "id": _uid(),
        "request_number": pr_number,
        "title": title,
        "description": (body.get("description") or "").strip(),
        "items": [
            {
                "id": _uid(),
                "name": i.get("name", ""),
                "specification": i.get("specification", ""),
                "qty": float(i.get("qty", 1)),
                "unit": i.get("unit", "pcs"),
                "estimated_price": float(i.get("estimated_price", 0)),
                "total_price": float(i.get("estimated_price", 0)) * float(i.get("qty", 1)),
                "notes": i.get("notes", ""),
            } for i in items
        ],
        "total_estimated": round(total_est, 2),
        "justification": (body.get("justification") or "").strip(),
        "priority": body.get("priority", "medium"),  # low | medium | high | urgent
        "request_type": body.get("request_type", "asset"),  # asset | consumable | service | other
        "department": (body.get("department") or user.get("department", "")).strip(),
        "requested_by": user["id"],
        "requested_by_name": user.get("name", ""),
        "status": "draft",
        "approval_steps": [],
        "current_approver_role": None,
        "submitted_at": None,
        "approved_at": None,
        "rejected_at": None,
        "rejection_reason": None,
        "linked_asset_ids": [],
        "created_at": _now(),
        "updated_at": _now(),
    }
    await db.dewi_procurement_requests.insert_one(doc)
    return _ser(doc)


@router.get("/requests/{req_id}")
async def get_request(req_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    req = await db.dewi_procurement_requests.find_one({"id": req_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Request tidak ditemukan.")
    return _ser(req)


@router.put("/requests/{req_id}")
async def update_request(req_id: str, request: Request):
    user = await require_auth(request)
    db = get_db()
    req = await db.dewi_procurement_requests.find_one({"id": req_id})
    if not req:
        raise HTTPException(404, "Request tidak ditemukan.")
    if req["status"] != "draft":
        raise HTTPException(400, "Hanya request berstatus draft yang bisa diubah.")
    if req["requested_by"] != user["id"] and user.get("role") not in ("superadmin", "admin"):
        raise HTTPException(403, "Tidak diizinkan.")
    body = await request.json()
    update = {}
    if "title" in body:
        update["title"] = body["title"]
    if "description" in body:
        update["description"] = body["description"]
    if "justification" in body:
        update["justification"] = body["justification"]
    if "priority" in body:
        update["priority"] = body["priority"]
    if "department" in body:
        update["department"] = body["department"]
    if "items" in body:
        items = body["items"]
        for i in items:
            if "id" not in i:
                i["id"] = _uid()
        total_est = sum(float(i.get("estimated_price", 0)) * float(i.get("qty", 1)) for i in items)
        update["items"] = items
        update["total_estimated"] = round(total_est, 2)
    if update:
        update["updated_at"] = _now()
        await db.dewi_procurement_requests.update_one({"id": req_id}, {"$set": update})
    return {"ok": True}


# ─── Workflow Actions ─────────────────────────────────────────────────────

@router.post("/requests/{req_id}/submit")
async def submit_request(req_id: str, request: Request):
    user = await require_auth(request)
    db = get_db()
    req = await db.dewi_procurement_requests.find_one({"id": req_id})
    if not req:
        raise HTTPException(404, "Request tidak ditemukan.")
    if req["status"] != "draft":
        raise HTTPException(400, "Hanya request draft yang bisa disubmit.")
    if req["requested_by"] != user["id"] and user.get("role") not in ("superadmin", "admin"):
        raise HTTPException(403, "Tidak diizinkan.")

    step = {
        "id": _uid(),
        "step": "submit",
        "actor_id": user["id"],
        "actor_name": user.get("name", ""),
        "action": "submitted",
        "action_label": "Diajukan",
        "comment": "",
        "timestamp": _now().isoformat(),
    }
    await db.dewi_procurement_requests.update_one(
        {"id": req_id},
        {"$set": {"status": "submitted", "submitted_at": _now(), "current_approver_role": "dept_head", "updated_at": _now()},
         "$push": {"approval_steps": step}}
    )
    return {"ok": True, "new_status": "submitted"}


@router.post("/requests/{req_id}/approve")
async def approve_request(req_id: str, request: Request):
    user = await require_auth(request)
    db = get_db()
    req = await db.dewi_procurement_requests.find_one({"id": req_id})
    if not req:
        raise HTTPException(404, "Request tidak ditemukan.")
    if req["status"] not in ("submitted", "dept_approved", "finance_approved"):
        raise HTTPException(400, f"Status '{req['status']}' tidak bisa diapprove.")
    body = await request.json()
    comment = (body.get("comment") or "").strip()

    # Determine next status
    next_status_map = {
        "submitted":        "dept_approved",
        "dept_approved":    "finance_approved",
        "finance_approved": "approved",
    }
    next_status = next_status_map[req["status"]]
    next_approver_role_map = {
        "dept_approved": "finance",
        "finance_approved": None,
        "approved": None,
    }
    action_label_map = {
        "submitted":        "Disetujui (Dept)",
        "dept_approved":    "Disetujui (Finance)",
        "finance_approved": "Disetujui (Final)",
    }

    step = {
        "id": _uid(),
        "step": req["status"],
        "actor_id": user["id"],
        "actor_name": user.get("name", ""),
        "action": "approved",
        "action_label": action_label_map.get(req["status"], "Disetujui"),
        "comment": comment,
        "timestamp": _now().isoformat(),
    }
    update_fields = {
        "status": next_status,
        "current_approver_role": next_approver_role_map.get(next_status),
        "updated_at": _now(),
    }
    if next_status == "approved":
        update_fields["approved_at"] = _now()
    await db.dewi_procurement_requests.update_one(
        {"id": req_id},
        {"$set": update_fields, "$push": {"approval_steps": step}}
    )
    # Notifikasi ke Communication Hub (best-effort)
    pr_after = {**req, **update_fields}
    await _notify_procurement_event(
        db,
        pr_after,
        actor=user,
        action=("final_approved" if next_status == "approved" else "approved"),
        new_status=next_status,
        comment=comment,
    )
    return {"ok": True, "new_status": next_status}


@router.post("/requests/{req_id}/reject")
async def reject_request(req_id: str, request: Request):
    user = await require_auth(request)
    db = get_db()
    req = await db.dewi_procurement_requests.find_one({"id": req_id})
    if not req:
        raise HTTPException(404, "Request tidak ditemukan.")
    if req["status"] not in ("submitted", "dept_approved", "finance_approved"):
        raise HTTPException(400, "Tidak bisa ditolak pada status ini.")
    body = await request.json()
    reason = (body.get("reason") or "").strip()
    step = {
        "id": _uid(),
        "step": req["status"],
        "actor_id": user["id"],
        "actor_name": user.get("name", ""),
        "action": "rejected",
        "action_label": "Ditolak",
        "comment": reason,
        "timestamp": _now().isoformat(),
    }
    await db.dewi_procurement_requests.update_one(
        {"id": req_id},
        {"$set": {"status": "rejected", "rejected_at": _now(), "rejection_reason": reason, "updated_at": _now()},
         "$push": {"approval_steps": step}}
    )
    # Notifikasi ke Communication Hub (best-effort)
    pr_after = {**req, "status": "rejected", "rejection_reason": reason}
    await _notify_procurement_event(
        db,
        pr_after,
        actor=user,
        action="rejected",
        new_status="rejected",
        comment=reason,
    )
    return {"ok": True, "new_status": "rejected"}


@router.post("/requests/{req_id}/cancel")
async def cancel_request(req_id: str, request: Request):
    user = await require_auth(request)
    db = get_db()
    req = await db.dewi_procurement_requests.find_one({"id": req_id})
    if not req:
        raise HTTPException(404, "Request tidak ditemukan.")
    if req["status"] not in ("draft", "submitted"):
        raise HTTPException(400, "Hanya request draft/submitted yang bisa dibatalkan.")
    if req["requested_by"] != user["id"] and user.get("role") not in ("superadmin", "admin"):
        raise HTTPException(403, "Tidak diizinkan.")
    await db.dewi_procurement_requests.update_one(
        {"id": req_id},
        {"$set": {"status": "cancelled", "updated_at": _now()}}
    )
    return {"ok": True}


@router.post("/requests/{req_id}/complete")
async def complete_request(req_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    req = await db.dewi_procurement_requests.find_one({"id": req_id})
    if not req:
        raise HTTPException(404, "Request tidak ditemukan.")
    if req["status"] not in ("approved", "in_procurement"):
        raise HTTPException(400, "Request harus berstatus approved atau in_procurement.")
    body = await request.json()
    linked_asset_ids = body.get("linked_asset_ids", [])
    await db.dewi_procurement_requests.update_one(
        {"id": req_id},
        {"$set": {"status": "completed", "linked_asset_ids": linked_asset_ids, "updated_at": _now()}}
    )
    return {"ok": True}


@router.get("/inbox")
async def get_approval_inbox(
    request: Request,
    scope: str = Query("relevant", description="relevant | all | mine"),
    department: Optional[str] = Query(None),
):
    """Inbox approval procurement dengan filter role/department.

    Query params:
    - scope=relevant (default): hanya item yang BISA disetujui user berdasarkan role
        - dept_head/manager/superadmin/admin: lihat status 'submitted'
            * dept_head/manager: hanya departemen sendiri (kecuali admin)
        - finance/superadmin/admin: lihat status 'dept_approved'
        - cfo/director/superadmin/admin: lihat status 'finance_approved'
    - scope=all: semua pending (superadmin/admin only)
    - scope=mine: pending request milik sendiri (utk requester tracking)
    - department=<name>: paksa filter berdasarkan departemen (admin only)
    """
    user = await require_auth(request)
    db = get_db()
    role = (user.get("role") or "").lower()
    user_dept = (user.get("department") or "").strip()
    is_admin = role in ("admin", "superadmin")

    pending_statuses = ["submitted", "dept_approved", "finance_approved"]

    if scope == "mine":
        query = {
            "status": {"$in": pending_statuses},
            "requested_by": user["id"],
        }
    elif scope == "all":
        # Admin/superadmin only — fallback to relevant for others
        if not is_admin:
            scope = "relevant"
        else:
            query = {"status": {"$in": pending_statuses}}

    if scope == "relevant":
        # Status yang bisa diapprove user berdasarkan role
        approvable_statuses = []
        # Dept-level approval
        if is_admin or role in ("manager", "dept_head", "supervisor"):
            approvable_statuses.append("submitted")
        # Finance-level approval
        if is_admin or role in ("finance", "finance_manager", "accountant"):
            approvable_statuses.append("dept_approved")
        # Final approval (CFO/Director)
        if is_admin or role in ("director", "cfo", "ceo"):
            approvable_statuses.append("finance_approved")

        if not approvable_statuses:
            # User bukan approver — return empty (UI tampil empty state)
            return []

        query = {"status": {"$in": approvable_statuses}}

        # Untuk dept-level (non-admin), batasi ke departemen sendiri kecuali admin
        # Admin / finance / final approvers tidak dibatasi departemen
        if not is_admin and "submitted" in approvable_statuses and role in ("manager", "dept_head", "supervisor"):
            # Hanya filter dept untuk status submitted (status finance+ tidak dept-gated)
            if approvable_statuses == ["submitted"]:
                if user_dept:
                    query["department"] = user_dept
                else:
                    # Tidak punya dept → tidak ada yang bisa diapprove
                    return []

    # Override department filter dari query param (admin only)
    if department and is_admin:
        query["department"] = department

    items = await db.dewi_procurement_requests.find(
        query, {"_id": 0}
    ).sort("submitted_at", 1).to_list(200)

    # Enrich dengan flag `can_approve` untuk UI gating
    result = []
    for i in items:
        out = _ser(i)
        st = i.get("status")
        can_approve = False
        if is_admin:
            can_approve = st in pending_statuses
        elif st == "submitted" and role in ("manager", "dept_head", "supervisor"):
            can_approve = (not user_dept) or (i.get("department") == user_dept)
        elif st == "dept_approved" and role in ("finance", "finance_manager", "accountant"):
            can_approve = True
        elif st == "finance_approved" and role in ("director", "cfo", "ceo"):
            can_approve = True
        out["can_approve"] = can_approve
        result.append(out)
    return result


@router.get("/requests/{req_id}/timeline")
async def get_request_timeline(req_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    req = await db.dewi_procurement_requests.find_one({"id": req_id}, {"_id": 0, "approval_steps": 1, "status": 1})
    if not req:
        raise HTTPException(404, "Request tidak ditemukan.")
    return {"steps": req.get("approval_steps", []), "current_status": req["status"]}


# ─── Create PO from Approved PR ──────────────────────────────────────────────

async def _gen_po_number_proc(db) -> str:
    from datetime import date as _date
    prefix = f"PO-{_date.today().strftime('%Y%m%d')}-"
    cnt = await db.rahaza_purchase_orders.count_documents(
        {"po_number": {"$regex": f"^{prefix}"}}
    )
    return f"{prefix}{str(cnt + 1).zfill(3)}"


@router.post("/requests/{req_id}/create-po")
async def create_po_from_pr(req_id: str, request: Request):
    """Buat Purchase Order (PO) dari PR yang sudah Approved.

    Body:
        vendor_name          (str, wajib)
        vendor_contact       (str, optional)
        vendor_address       (str, optional)
        expected_delivery_date (str YYYY-MM-DD, optional)
        notes                (str, optional)
    """
    user = await require_auth(request)
    db = get_db()

    pr = await db.dewi_procurement_requests.find_one({"id": req_id})
    if not pr:
        raise HTTPException(404, "PR tidak ditemukan.")
    if pr["status"] != "approved":
        raise HTTPException(400, f"PR harus berstatus 'approved' untuk dibuat PO. Status saat ini: {pr['status']}")
    if pr.get("linked_po_id"):
        raise HTTPException(400, f"PR ini sudah memiliki PO terhubung: {pr.get('linked_po_number', pr['linked_po_id'])}")

    body = await request.json()
    vendor_name = (body.get("vendor_name") or "").strip()
    if not vendor_name:
        raise HTTPException(400, "vendor_name wajib diisi.")

    from datetime import date as _date
    po_items = []
    for it in (pr.get("items") or []):
        po_items.append({
            "id": _uid(),
            "description": it.get("name", ""),
            "specification": it.get("specification", ""),
            "qty_ordered": float(it.get("qty", 1)),
            "qty_received": 0.0,
            "unit": it.get("unit", "pcs"),
            "unit_cost": float(it.get("estimated_price", 0)),
            "notes": it.get("notes", ""),
            # No material_id — free-form item from PR
        })

    po_number = await _gen_po_number_proc(db)
    po_doc = {
        "id": _uid(),
        "po_number": po_number,
        "from_pr_id": pr["id"],
        "from_pr_number": pr.get("request_number", ""),
        "vendor_name": vendor_name,
        "vendor_contact": (body.get("vendor_contact") or "").strip(),
        "vendor_address": (body.get("vendor_address") or "").strip(),
        "po_date": _date.today().isoformat(),
        "expected_delivery_date": body.get("expected_delivery_date") or None,
        "items": po_items,
        "status": "draft",
        "notes": (body.get("notes") or "").strip(),
        "approval_flow_key": "single_step",
        "approvals": [],
        "created_by": user["id"],
        "created_by_name": user.get("name", ""),
        "created_at": _now(),
        "updated_at": _now(),
    }
    await db.rahaza_purchase_orders.insert_one(po_doc)

    # Update PR: set in_procurement + link
    await db.dewi_procurement_requests.update_one(
        {"id": req_id},
        {"$set": {
            "status": "in_procurement",
            "linked_po_id": po_doc["id"],
            "linked_po_number": po_number,
            "updated_at": _now(),
        }}
    )

    return _ser(po_doc)



# ─── Supporting Data: Request Types ─────────────────────────────────────────
# Extended request_type list (Phase 5B)
PROCUREMENT_REQUEST_TYPES = [
    {'value': 'asset',        'label': 'Aset Tetap',          'description': 'Pembelian aset tetap (mesin, peralatan, furnitur, elektronik)'},
    {'value': 'consumable',   'label': 'Barang Habis Pakai',  'description': 'Bahan habis pakai (ATK, bahan baku minor, supplies)'},
    {'value': 'service',      'label': 'Jasa',                'description': 'Pengadaan jasa atau tenaga ahli'},
    {'value': 'subscription', 'label': 'Langganan / SaaS',    'description': 'Langganan software, SaaS, atau layanan berulang'},
    {'value': 'maintenance',  'label': 'Kontrak Maintenance',  'description': 'Kontrak maintenance/servis peralatan atau fasilitas'},
    {'value': 'rental',       'label': 'Sewa Alat/Fasilitas', 'description': 'Sewa alat, kendaraan, atau fasilitas operasional'},
    {'value': 'project',      'label': 'Berbasis Proyek',     'description': 'Pengadaan untuk kebutuhan proyek tertentu'},
    {'value': 'other',        'label': 'Lainnya',             'description': 'Jenis pengadaan lainnya yang tidak termasuk kategori di atas'},
]


@router.get('/request-types')
async def get_request_types(request: Request):
    """
    Daftar jenis pengadaan (request_type) yang tersedia.
    Digunakan untuk dropdown di form buat PR. Auth optional.
    """
    try:
        await require_auth(request)
    except Exception:
        pass  # allow unauthenticated read for dropdown population
    return {'items': PROCUREMENT_REQUEST_TYPES}