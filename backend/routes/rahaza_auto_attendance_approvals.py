"""
Rahaza Auto-Attendance - Approvals
HR Approval Queue for pending attendance
"""
import uuid
import math
import json
import os
from datetime import datetime, timezone, date
from typing import Optional
from fastapi import APIRouter, Request, HTTPException
from database import get_db
from auth import require_auth, serialize_doc, log_activity
from dotenv import load_dotenv

load_dotenv()

# WebAuthn imports (graceful fallback)
WEBAUTHN_AVAILABLE = False
try:
    from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
    from webauthn.helpers.exceptions import (
        InvalidRegistrationResponse,
        InvalidAuthenticationResponse,
    )
    WEBAUTHN_AVAILABLE = True
except Exception:
    def base64url_to_bytes(s): return b""
    def bytes_to_base64url(b): return ""
    class InvalidRegistrationResponse(Exception):
        pass
    class InvalidAuthenticationResponse(Exception):
        pass

# AI Face Compare
from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent

router = APIRouter(tags=["rahaza-auto-attendance-approvals"])

# Config
RP_ID = os.environ.get("WEBAUTHN_RP_ID", "analytics-builds.preview.emergentagent.com")
RP_NAME = os.environ.get("WEBAUTHN_RP_NAME", "Dewi Aditya ERP")
ORIGIN = os.environ.get("WEBAUTHN_ORIGIN", "https://p2p-workflow-dev.preview.emergentagent.com")
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")

DEFAULT_FACE_THRESHOLD = 0.65
DEFAULT_GEOFENCE_RADIUS = 300

def _uid(): return str(uuid.uuid4())
def _now(): return datetime.now(timezone.utc)
def _today_iso(): return date.today().isoformat()

def _check_geofence(lat: float, lng: float, office: dict) -> dict:
    if not office or office.get("lat") is None or office.get("lng") is None:
        return {"status": "not_verified", "distance_m": None, "in_range": None}
    R = 6371000
    lat1 = math.radians(float(office["lat"]))
    lon1 = math.radians(float(office["lng"]))
    lat2 = math.radians(float(lat))
    lon2 = math.radians(float(lng))
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    dist = 2 * R * math.asin(math.sqrt(a))
    radius = float(office.get("geofence_radius_m", DEFAULT_GEOFENCE_RADIUS))
    in_range = dist <= radius
    return {
        "status": "in_range" if in_range else "out_of_range",
        "distance_m": round(dist),
        "in_range": in_range,
    }

async def _compare_faces(selfie_base64: str, reference_photo_url: str) -> dict:
    if not EMERGENT_LLM_KEY:
        return {"match": False, "confidence": 0, "status": "error", "error": "AI key tidak dikonfigurasi"}
    if not reference_photo_url:
        return {"match": False, "confidence": 0, "status": "no_reference", "error": "Foto profil karyawan belum diset"}
    
    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"face-compare-{_uid()}",
            system_message=(
                "Kamu adalah sistem verifikasi identitas. "
                "Tugasmu membandingkan dua foto wajah dan menentukan apakah orang yang sama."
                "Jawab HANYA dalam format JSON: {\"match\": true/false, \"confidence\": 0.0-1.0, \"reason\": \"...\"}"
            )
        ).with_model("openai", "gpt-4o")
        
        selfie_content = ImageContent(image_base64=selfie_base64)
        
        msg = UserMessage(
            text=(
                "Bandingkan dua foto ini:\n"
                "- Foto 1 (lampiran): adalah SELFIE yang baru diambil karyawan\n"
                f"- Foto 2 (URL): {reference_photo_url} — adalah FOTO PROFIL karyawan di sistem\n\n"
                "Apakah kedua foto ini adalah orang yang SAMA? "
                "Perhatikan fitur wajah: bentuk muka, mata, hidung, bibir. "
                "Abaikan perbedaan pencahayaan/sudut kecil.\n"
                "JAWAB HANYA JSON: {\"match\": true/false, \"confidence\": 0.0-1.0, \"reason\": \"alasan singkat\"}"
            ),
            file_contents=[selfie_content]
        )
        
        response = await chat.send_message(msg)
        
        response_clean = response.strip()
        if "```" in response_clean:
            response_clean = response_clean.split("```")[1]
            if response_clean.startswith("json"):
                response_clean = response_clean[4:]
        result = json.loads(response_clean)
        
        return {
            "match": bool(result.get("match", False)),
            "confidence": float(result.get("confidence", 0.0)),
            "reason": result.get("reason", ""),
            "status": "checked",
        }
    except Exception as e:
        return {
            "match": False,
            "confidence": 0.0,
            "status": "error",
            "error": str(e)[:200],
        }

def _determine_approval(geo: dict, face: dict, office: dict) -> str:
    threshold = float(office.get("face_match_threshold", DEFAULT_FACE_THRESHOLD)) if office else DEFAULT_FACE_THRESHOLD
    geo_ok = geo.get("in_range") is True or geo.get("status") == "not_verified"
    face_status = face.get("status", "not_checked")
    
    if face_status in ("not_checked", "no_reference"):
        face_ok = True
    elif face_status == "error":
        face_ok = True
    else:
        face_ok = face.get("match") is True and face.get("confidence", 0) >= threshold
    
    if geo_ok and face_ok:
        return "auto_approved"
    return "pending"

@router.get("/attendance/approvals")
async def list_approval_queue(
    request: Request,
    status: Optional[str] = "pending",
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    employee_id: Optional[str] = None,
):
    """Daftar absen yang perlu persetujuan HR."""
    user = await require_auth(request)
    if user.get("role") not in ("superadmin", "admin", "owner", "hr"):
        raise HTTPException(403, "Hanya HR/Admin.")
    db = get_db()

    q = {}
    if status and status != "all":
        q["approval_status"] = status
    if employee_id:
        q["employee_id"] = employee_id
    if from_date or to_date:
        q["date"] = {}
        if from_date:
            q["date"]["$gte"] = from_date
        if to_date:
            q["date"]["$lte"] = to_date

    rows = await db.rahaza_attendance_events.find(q, {"_id": 0}).sort("date", -1).to_list(500)

    # Enrich with employee info
    emp_ids = list({r["employee_id"] for r in rows if r.get("employee_id")})
    emps = await db.rahaza_employees.find({"id": {"$in": emp_ids}}, {"_id": 0, "id": 1, "name": 1, "employee_code": 1, "department": 1}).to_list(500)
    e_map = {e["id"]: e for e in emps}
    for r in rows:
        e = e_map.get(r.get("employee_id")) or {}
        r["employee_name"] = e.get("name", "?")
        r["employee_code"] = e.get("employee_code", "-")
        r["department"] = e.get("department", "-")

    return serialize_doc(rows)


@router.post("/attendance/approvals/{event_id}/approve")
async def approve_attendance(event_id: str, request: Request):
    """HR menyetujui absen yang pending."""
    user = await require_auth(request)
    if user.get("role") not in ("superadmin", "admin", "owner", "hr"):
        raise HTTPException(403, "Hanya HR/Admin.")
    db = get_db()
    body = await request.json()
    notes = body.get("notes", "")

    ev = await db.rahaza_attendance_events.find_one({"id": event_id})
    if not ev:
        raise HTTPException(404, "Record absen tidak ditemukan.")

    now = _now()
    await db.rahaza_attendance_events.update_one({"id": event_id}, {"$set": {
        "approval_status": "approved",
        "approval_by": user["id"],
        "approval_by_name": user.get("name", ""),
        "approval_notes": notes,
        "approval_at": now,
        "status": "hadir",
        "updated_by": user["id"], "updated_by_name": user.get("name", ""), "updated_at": now,
    }})
    await log_activity(user["id"], user.get("name", ""), "approve-attendance", "attendance", event_id)
    return {"ok": True, "message": "Absen disetujui."}


@router.post("/attendance/approvals/{event_id}/reject")
async def reject_attendance(event_id: str, request: Request):
    """HR menolak absen yang pending."""
    user = await require_auth(request)
    if user.get("role") not in ("superadmin", "admin", "owner", "hr"):
        raise HTTPException(403, "Hanya HR/Admin.")
    db = get_db()
    body = await request.json()
    notes = body.get("notes", "")

    ev = await db.rahaza_attendance_events.find_one({"id": event_id})
    if not ev:
        raise HTTPException(404, "Record absen tidak ditemukan.")

    now = _now()
    await db.rahaza_attendance_events.update_one({"id": event_id}, {"$set": {
        "approval_status": "rejected",
        "approval_by": user["id"],
        "approval_by_name": user.get("name", ""),
        "approval_notes": notes,
        "approval_at": now,
        "status": "alfa",
        "updated_by": user["id"], "updated_by_name": user.get("name", ""), "updated_at": now,
    }})
    await log_activity(user["id"], user.get("name", ""), "reject-attendance", "attendance", event_id)
    return {"ok": True, "message": "Absen ditolak."}


