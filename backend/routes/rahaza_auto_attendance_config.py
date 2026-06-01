"""
Rahaza Auto-Attendance - Config
Status & Configuration endpoints
"""
import uuid
import math
import json
import os
from datetime import datetime, timezone, date
from typing import Optional
from fastapi import APIRouter, Request, HTTPException
from database import get_db
from auth import require_auth, serialize_doc
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

router = APIRouter(tags=["rahaza-auto-attendance-config"])

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

@router.get("/attendance/my-status")
async def get_my_attendance_status(request: Request, employee_id: Optional[str] = None):
    """
    Ambil status kehadiran hari ini untuk karyawan (untuk /absen page).
    """
    user = await require_auth(request)
    db = get_db()

    # Determine employee_id to use
    if employee_id:
        emp_id = employee_id
    else:
        # Find by user email
        emp = await db.rahaza_employees.find_one({"email": user.get("email")}, {"_id": 0})
        if not emp:
            emp = await db.rahaza_employees.find_one(
                {}, {"_id": 0}
            )
        emp_id = emp["id"] if emp else None

    if not emp_id:
        return {"today": None, "employee": None}

    today = _today_iso()
    rec = await db.rahaza_attendance_events.find_one({"employee_id": emp_id, "date": today}, {"_id": 0})
    emp = await db.rahaza_employees.find_one({"id": emp_id}, {"_id": 0})

    # Check WebAuthn credentials
    has_webauthn = await db.rahaza_webauthn_credentials.count_documents({"employee_id": emp_id, "revoked_at": None}) > 0

    return serialize_doc({
        "today": rec,
        "employee": emp,
        "has_webauthn": has_webauthn,
        "date": today,
    })


# ═══════════════════════════════════════════════════════════════════════════════
# 5) OFFICE CONFIG — Face threshold + Geofence
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/attendance/auto-config")
async def get_auto_config(request: Request):
    """Ambil konfigurasi absen otomatis (threshold, geofence, dll)."""
    await require_auth(request)
    db = get_db()
    office = await db.rahaza_office_locations.find_one({"is_primary": True}, {"_id": 0})
    if not office:
        office = {}
    return serialize_doc({
        "face_match_threshold": office.get("face_match_threshold", DEFAULT_FACE_THRESHOLD),
        "geofence_radius_m": office.get("geofence_radius_m", DEFAULT_GEOFENCE_RADIUS),
        "allow_out_of_range": office.get("allow_out_of_range", True),
        "office_name": office.get("name", "Kantor Utama"),
        "office_lat": office.get("lat"),
        "office_lng": office.get("lng"),
    })


@router.put("/attendance/auto-config")
async def update_auto_config(request: Request):
    """Update konfigurasi absen otomatis."""
    user = await require_auth(request)
    if user.get("role") not in ("superadmin", "admin", "owner", "hr"):
        raise HTTPException(403, "Hanya HR/Admin.")
    db = get_db()
    body = await request.json()

    updates = {}
    if body.get("face_match_threshold") is not None:
        val = float(body["face_match_threshold"])
        if not (0 <= val <= 1):
            raise HTTPException(400, "face_match_threshold harus 0.0-1.0")
        updates["face_match_threshold"] = val
    if body.get("geofence_radius_m") is not None:
        updates["geofence_radius_m"] = max(10, int(body["geofence_radius_m"]))
    if body.get("allow_out_of_range") is not None:
        updates["allow_out_of_range"] = bool(body["allow_out_of_range"])
    if body.get("name"):
        updates["name"] = body["name"]
    if body.get("lat") is not None:
        updates["lat"] = float(body["lat"])
    if body.get("lng") is not None:
        updates["lng"] = float(body["lng"])

    if updates:
        updates["updated_at"] = _now()
        await db.rahaza_office_locations.update_one(
            {"is_primary": True}, {"$set": updates}, upsert=True
        )
    return {"ok": True, "updated": list(updates.keys())}
