"""
PT Rahaza ERP — Andon Panel (Phase 18B)

Memungkinkan operator request bantuan dengan 1 tap dari OperatorView;
supervisor / manager punya Andon Board + SLA escalation otomatis.

Data model (collection `rahaza_andon_events`):
  id, created_at, employee_id, employee_name, line_id, line_code,
  process_id, process_code, type, severity, message,
  status (active/acknowledged/resolved/cancelled),
  acknowledged_at, acknowledged_by, resolved_at, resolved_by,
  notes_resolve, sla_supervisor_min, sla_manager_min,
  escalation_state (none / supervisor_notified / manager_notified)

Endpoints:
  POST /api/rahaza/andon                  — create event (operator)
  GET  /api/rahaza/andon/active           — active events (supervisor+)
  GET  /api/rahaza/andon/history          — all history (manager+)
  GET  /api/rahaza/andon/settings         — get SLA settings
  PUT  /api/rahaza/andon/settings         — update SLA settings (admin)
  POST /api/rahaza/andon/{id}/ack         — acknowledge (supervisor)
  POST /api/rahaza/andon/{id}/resolve     — resolve (supervisor/manager)
  POST /api/rahaza/andon/{id}/cancel      — cancel (operator / admin)

Background task: SLA escalation checker (shared with alerts bg loop).
"""
from fastapi import APIRouter, Request, HTTPException, WebSocket, WebSocketDisconnect, Query
from database import get_db
from auth import require_auth, verify_token_str
from datetime import datetime, timezone
from routes.rahaza_notifications import publish_notification
import uuid
import logging
import asyncio
import json

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/rahaza/andon", tags=["Andon"])

# ─── WebSocket Connection Manager ────────────────────────────────────────────
class AndonConnectionManager:
    """Broadcasts Andon events to all connected WebSocket clients."""
    def __init__(self):
        self.connections: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.connections.append(ws)
        logger.info(f"[AndonWS] Client connected. Total: {len(self.connections)}")

    def disconnect(self, ws: WebSocket):
        if ws in self.connections:
            self.connections.remove(ws)
        logger.info(f"[AndonWS] Client disconnected. Total: {len(self.connections)}")

    async def broadcast(self, event_type: str, data: dict = None):
        """Send JSON message to all connected clients."""
        msg = json.dumps({"type": event_type, "data": data or {}, "ts": datetime.now(timezone.utc).isoformat()})
        dead = []
        for ws in self.connections[:]:
            try:
                await ws.send_text(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

andon_manager = AndonConnectionManager()

# ─── Constants ───────────────────────────────────────────────────────────────
ANDON_SETTINGS_ID = "andon_default"

DEFAULT_ANDON_SETTINGS = {
    "id": ANDON_SETTINGS_ID,
    "sla_supervisor_min": 10,
    "sla_manager_min": 20,
    "enabled": True,
}

ANDON_TYPES = {
    "machine_breakdown": {"label": "Mesin Rusak", "severity": "urgent", "emoji": "🔧"},
    "material_shortage": {"label": "Material Habis", "severity": "warning", "emoji": "📦"},
    "quality_issue":     {"label": "Defect Banyak", "severity": "warning", "emoji": "❌"},
    "help":              {"label": "Minta Bantuan", "severity": "info",    "emoji": "🙋"},
}


# ─── Settings helpers ────────────────────────────────────────────────────────
async def _get_andon_settings(db) -> dict:
    doc = await db.rahaza_andon_settings.find_one({"id": ANDON_SETTINGS_ID}, {"_id": 0})
    if not doc:
        doc = {**DEFAULT_ANDON_SETTINGS}
        await db.rahaza_andon_settings.insert_one(doc)
        doc.pop("_id", None)
    return {**DEFAULT_ANDON_SETTINGS, **doc}


async def _require_supervisor_or_above(request: Request):
    user = await require_auth(request)
    role = (user.get("role") or "").lower()
    allowed = ("admin", "superadmin", "owner", "manager_production", "supervisor")
    if role not in allowed:
        raise HTTPException(403, "Butuh role Supervisor / Manager / Admin")
    return user


async def _require_manager_or_above(request: Request):
    user = await require_auth(request)
    role = (user.get("role") or "").lower()
    allowed = ("admin", "superadmin", "owner", "manager_production")
    if role not in allowed:
        raise HTTPException(403, "Butuh role Manager / Admin")
    return user


# ─── Helper: serialize doc ────────────────────────────────────────────────────
def _ser(doc: dict) -> dict:
    doc = {k: v for k, v in doc.items() if k != "_id"}
    for k, v in list(doc.items()):
        if isinstance(v, datetime):
            doc[k] = v.isoformat()
    return doc


# ─── Routes ──────────────────────────────────────────────────────────────────

@router.get("/settings")
async def get_andon_settings(request: Request):
    """Get current SLA settings."""
    await require_auth(request)
    db = get_db()
    settings = await _get_andon_settings(db)
    return settings


@router.put("/settings")
async def update_andon_settings(request: Request):
    """Update SLA settings (admin only)."""
    await _require_manager_or_above(request)
    body = await request.json()
    db = get_db()
    update = {}
    if "sla_supervisor_min" in body:
        update["sla_supervisor_min"] = max(1, min(120, int(body["sla_supervisor_min"])))
    if "sla_manager_min" in body:
        update["sla_manager_min"] = max(2, min(240, int(body["sla_manager_min"])))
    if "enabled" in body:
        update["enabled"] = bool(body["enabled"])
    if not update:
        raise HTTPException(400, "Tidak ada field yang valid untuk diupdate")
    await db.rahaza_andon_settings.update_one(
        {"id": ANDON_SETTINGS_ID},
        {"$set": update},
        upsert=True,
    )
    return await _get_andon_settings(db)


@router.post("")
async def create_andon_event(request: Request):
    """
    Operator creates an Andon event.
    Body: { type, employee_id, line_id?, process_id?, message? }
    """
    user = await require_auth(request)
    body = await request.json()
    db = get_db()

    andon_type = body.get("type")
    if andon_type not in ANDON_TYPES:
        raise HTTPException(400, f"type harus salah satu: {list(ANDON_TYPES.keys())}")

    employee_id = body.get("employee_id")
    line_id = body.get("line_id")
    process_id = body.get("process_id")
    message = (body.get("message") or "").strip()[:500]
    settings = await _get_andon_settings(db)

    # Look up employee/line/process names for enrichment
    emp_name = ""
    if employee_id:
        emp = await db.rahaza_employees.find_one({"id": employee_id}, {"_id": 0, "name": 1})
        emp_name = emp.get("name", "") if emp else ""

    line_code = ""
    if line_id:
        line = await db.rahaza_lines.find_one({"id": line_id}, {"_id": 0, "code": 1})
        line_code = line.get("code", "") if line else ""

    process_code = ""
    if process_id:
        proc = await db.rahaza_processes.find_one({"id": process_id}, {"_id": 0, "code": 1})
        process_code = proc.get("code", "") if proc else ""

    type_meta = ANDON_TYPES[andon_type]
    now = datetime.now(timezone.utc)
    event = {
        "id": str(uuid.uuid4()),
        "created_at": now,
        "created_by_user_id": user.get("id") or user.get("user_id") or "",
        "employee_id": employee_id or "",
        "employee_name": emp_name,
        "line_id": line_id or "",
        "line_code": line_code,
        "process_id": process_id or "",
        "process_code": process_code,
        "type": andon_type,
        "type_label": type_meta["label"],
        "severity": type_meta["severity"],
        "emoji": type_meta["emoji"],
        "message": message,
        "status": "active",
        "acknowledged_at": None,
        "acknowledged_by": None,
        "acknowledged_by_name": None,
        "resolved_at": None,
        "resolved_by": None,
        "resolved_by_name": None,
        "notes_resolve": "",
        "sla_supervisor_min": settings["sla_supervisor_min"],
        "sla_manager_min": settings["sla_manager_min"],
        "escalation_state": "none",
    }
    await db.rahaza_andon_events.insert_one(event)
    event.pop("_id", None)

    # Publish notification to supervisors immediately
    loc_parts = [p for p in [line_code, process_code] if p]
    location_str = " · ".join(loc_parts) or "lantai"
    operator_str = emp_name or user.get("name") or "Operator"
    await publish_notification(
        db=db,
        type_="andon",
        severity="urgent" if andon_type == "machine_breakdown" else "warning",
        title=f"{type_meta['emoji']} {type_meta['label']} — {location_str}",
        message=f"{operator_str} melaporkan: {message or type_meta['label']}",
        link_module="prod-andon-board",
        link_id=event["id"],
        target_roles=["superadmin", "manager_production", "supervisor", "admin"],
        dedup_key=f"andon_{event['id']}_created",
    )

    logger.info(f"[andon] event created id={event['id']} type={andon_type} by={emp_name}")
    await andon_manager.broadcast("andon_update", {"event_id": event["id"], "action": "create"})
    return {**_ser(event), "success_message": f"Andon '{type_meta['label']}' telah dikirim ke supervisor"}


@router.get("/active")
async def list_active_andon(request: Request):
    """List active (unresolved) Andon events."""
    await require_auth(request)
    db = get_db()
    events = await db.rahaza_andon_events.find(
        {"status": "active"},
        {"_id": 0},
    ).sort("created_at", -1).to_list(100)

    now = datetime.now(timezone.utc)
    result = []
    for ev in events:
        ev = _ser(ev)
        if ev.get("created_at"):
            try:
                created = datetime.fromisoformat(ev["created_at"].replace("Z", "+00:00"))
                age_min = (now - created).total_seconds() / 60
            except Exception:
                age_min = 0
        else:
            age_min = 0
        ev["age_minutes"] = round(age_min, 1)
        ev["sla_supervisor_overdue"] = age_min > ev.get("sla_supervisor_min", 10) and not ev.get("acknowledged_at")
        ev["sla_manager_overdue"] = age_min > ev.get("sla_manager_min", 20)
        result.append(ev)

    total_fail = sum(1 for e in result if e["sla_supervisor_overdue"])
    return {
        "events": result,
        "total": len(result),
        "total_overdue_supervisor": total_fail,
        "total_overdue_manager": sum(1 for e in result if e["sla_manager_overdue"]),
    }


@router.get("/history")
async def andon_history(request: Request, limit: int = 50, skip: int = 0):
    """List all Andon events (history)."""
    await require_auth(request)
    db = get_db()
    events = await db.rahaza_andon_events.find(
        {},
        {"_id": 0},
    ).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    total = await db.rahaza_andon_events.count_documents({})
    return {"events": [_ser(e) for e in events], "total": total}


@router.post("/{event_id}/ack")
async def acknowledge_andon(event_id: str, request: Request):
    """Supervisor acknowledges Andon event."""
    user = await _require_supervisor_or_above(request)
    db = get_db()
    ev = await db.rahaza_andon_events.find_one({"id": event_id}, {"_id": 0})
    if not ev:
        raise HTTPException(404, "Andon event tidak ditemukan")
    if ev["status"] != "active":
        raise HTTPException(400, f"Event sudah berstatus '{ev['status']}'")
    now = datetime.now(timezone.utc)
    await db.rahaza_andon_events.update_one(
        {"id": event_id},
        {"$set": {
            "status": "acknowledged",
            "acknowledged_at": now,
            "acknowledged_by": user.get("id") or user.get("user_id") or "",
            "acknowledged_by_name": user.get("name") or "",
        }},
    )
    ev = await db.rahaza_andon_events.find_one({"id": event_id}, {"_id": 0})
    logger.info(f"[andon] ack id={event_id} by={user.get('name')}")
    await andon_manager.broadcast("andon_update", {"event_id": event_id, "action": "ack"})
    return _ser(ev)


@router.post("/{event_id}/resolve")
async def resolve_andon(event_id: str, request: Request):
    """Supervisor/Manager resolves Andon event."""
    user = await _require_supervisor_or_above(request)
    body = await request.json()
    notes = (body.get("notes") or "").strip()[:500]
    db = get_db()
    ev = await db.rahaza_andon_events.find_one({"id": event_id}, {"_id": 0})
    if not ev:
        raise HTTPException(404, "Andon event tidak ditemukan")
    if ev["status"] in ("resolved", "cancelled"):
        raise HTTPException(400, f"Event sudah berstatus '{ev['status']}'")
    now = datetime.now(timezone.utc)
    await db.rahaza_andon_events.update_one(
        {"id": event_id},
        {"$set": {
            "status": "resolved",
            "resolved_at": now,
            "resolved_by": user.get("id") or user.get("user_id") or "",
            "resolved_by_name": user.get("name") or "",
            "notes_resolve": notes,
        }},
    )
    ev = await db.rahaza_andon_events.find_one({"id": event_id}, {"_id": 0})
    logger.info(f"[andon] resolved id={event_id} by={user.get('name')}")
    await andon_manager.broadcast("andon_update", {"event_id": event_id, "action": "resolve"})
    return _ser(ev)


@router.post("/{event_id}/cancel")
async def cancel_andon(event_id: str, request: Request):
    """Cancel Andon event (operator / admin)."""
    await require_auth(request)
    db = get_db()
    ev = await db.rahaza_andon_events.find_one({"id": event_id}, {"_id": 0})
    if not ev:
        raise HTTPException(404, "Andon event tidak ditemukan")
    if ev["status"] in ("resolved", "cancelled"):
        raise HTTPException(400, f"Event sudah berstatus '{ev['status']}'")
    await db.rahaza_andon_events.update_one(
        {"id": event_id},
        {"$set": {"status": "cancelled"}},
    )
    await andon_manager.broadcast("andon_update", {"event_id": event_id, "action": "cancel"})
    return {"message": "Andon dibatalkan"}


# ─── SLA Escalation (called from background loop) ─────────────────────────────
async def check_andon_sla_escalation():
    """
    Check active Andon events and publish escalation notifications
    if SLA deadlines are breached.  Called by rahaza_alerts background loop.
    """
    try:
        db = get_db()
        settings = await _get_andon_settings(db)
        if not settings.get("enabled", True):
            return

        now = datetime.now(timezone.utc)
        active_events = await db.rahaza_andon_events.find(
            {"status": "active"},
            {"_id": 0},
        ).to_list(500)

        for ev in active_events:
            ev_id = ev["id"]
            created_at = ev.get("created_at")
            if not created_at:
                continue
            if isinstance(created_at, str):
                try:
                    created_at = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
                except Exception:
                    continue

            age_min = (now - created_at).total_seconds() / 60
            escalation_state = ev.get("escalation_state", "none")
            sla_sup = ev.get("sla_supervisor_min", settings["sla_supervisor_min"])
            sla_mgr = ev.get("sla_manager_min", settings["sla_manager_min"])

            type_label = ev.get("type_label", "Andon")
            line_code = ev.get("line_code") or ev.get("process_code") or "lantai"

            # Manager escalation (if still not acked after manager SLA)
            if age_min >= sla_mgr and escalation_state != "manager_notified":
                await publish_notification(
                    db=db,
                    type_="andon_escalated",
                    severity="urgent",
                    title=f"⚠️ ESKALASI MANAGER — {type_label} @ {line_code}",
                    message=f"Andon belum diselesaikan selama {round(age_min)} menit. Butuh perhatian manager segera.",
                    link_module="prod-andon-board",
                    link_id=ev_id,
                    target_roles=["superadmin", "manager_production", "admin"],
                    dedup_key=f"andon_{ev_id}_mgr_esc",
                )
                await db.rahaza_andon_events.update_one(
                    {"id": ev_id},
                    {"$set": {"escalation_state": "manager_notified"}},
                )
                logger.info(f"[andon] manager escalation sent for event {ev_id}")

            # Supervisor escalation (first reminder)
            elif age_min >= sla_sup and escalation_state == "none":
                await publish_notification(
                    db=db,
                    type_="andon_escalated",
                    severity="warning",
                    title=f"⏰ Andon belum di-acknowledge — {type_label} @ {line_code}",
                    message=f"Sudah {round(age_min)} menit. Supervisor segera tindak lanjuti.",
                    link_module="prod-andon-board",
                    link_id=ev_id,
                    target_roles=["superadmin", "manager_production", "supervisor"],
                    dedup_key=f"andon_{ev_id}_sup_esc",
                )
                await db.rahaza_andon_events.update_one(
                    {"id": ev_id},
                    {"$set": {"escalation_state": "supervisor_notified"}},
                )
                logger.info(f"[andon] supervisor escalation sent for event {ev_id}")
    except Exception as e:
        logger.error(f"[andon] SLA check error: {e}")


# ─── WebSocket Endpoint ───────────────────────────────────────────────────────
@router.websocket("/ws")
async def andon_websocket(ws: WebSocket, token: str = Query(None)):
    """
    Real-time WebSocket feed for Andon Board.
    Connect with: wss://<host>/api/rahaza/andon/ws?token=<jwt>
    Messages:
      Server→Client: {"type": "init"|"andon_update"|"ping", "data": {...}, "ts": "..."}
      Client→Server: anything (keep-alive / ignored)
    """
    if not token:
        await ws.close(code=4001, reason="Token required")
        return

    user = verify_token_str(token)
    if not user:
        await ws.close(code=4001, reason="Invalid token")
        return

    await andon_manager.connect(ws)
    db = get_db()
    try:
        # Send current active events on connect
        events = await db.rahaza_andon_events.find({"status": "active"}, {"_id": 0}).sort("created_at", -1).to_list(50)
        events = [_ser(e) for e in events]
        await ws.send_text(json.dumps({"type": "init", "data": {"events": events}, "ts": datetime.now(timezone.utc).isoformat()}))

        # Keep alive — wait for client messages or timeout
        while True:
            try:
                await asyncio.wait_for(ws.receive_text(), timeout=30.0)
            except asyncio.TimeoutError:
                await ws.send_text(json.dumps({"type": "ping"}))
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning(f"[AndonWS] Error: {e}")
    finally:
        andon_manager.disconnect(ws)
