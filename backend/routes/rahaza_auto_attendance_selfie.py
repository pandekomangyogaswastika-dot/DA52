"""
Rahaza Auto-Attendance - Selfie Attendance
Selfie + Geolocation + AI Face Recognition
"""
import uuid
import math
import json
import os
from datetime import datetime, timezone, date
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

router = APIRouter(tags=["rahaza-auto-attendance-selfie"])

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

@router.post("/attendance/selfie/clock-in")
async def selfie_clock_in(request: Request):
    """
    Absen masuk via selfie + GPS + AI face recognition.
    Body: { employee_id, lat, lng, photo_base64, do_face_check? }
    """
    user = await require_auth(request)
    db = get_db()
    body = await request.json()

    emp_id = body.get("employee_id")
    if not emp_id:
        raise HTTPException(400, "employee_id wajib.")

    lat = body.get("lat")
    lng = body.get("lng")
    photo_b64 = body.get("photo_base64", "")
    do_face = body.get("do_face_check", True)

    today = _today_iso()
    existing = await db.rahaza_attendance_events.find_one({"employee_id": emp_id, "date": today})
    if existing and existing.get("clock_in"):
        raise HTTPException(400, "Karyawan sudah clock-in hari ini.")

    # ── Get employee + office ──────────────────────────────────────────────
    emp = await db.rahaza_employees.find_one({"id": emp_id}, {"_id": 0})
    if not emp:
        raise HTTPException(404, "Karyawan tidak ditemukan.")

    office = await db.rahaza_office_locations.find_one({"is_primary": True}, {"_id": 0})

    # ── Geofence ──────────────────────────────────────────────────────────
    geo = {"status": "not_verified", "distance_m": None, "in_range": None}
    if lat is not None and lng is not None:
        geo = _check_geofence(float(lat), float(lng), office or {})

    # ── Face Compare ──────────────────────────────────────────────────────
    face = {"status": "not_checked", "match": None, "confidence": 0}
    if do_face and photo_b64 and emp.get("photo_url"):
        face = await _compare_faces(photo_b64, emp["photo_url"])
    elif do_face and photo_b64 and not emp.get("photo_url"):
        face = {"status": "no_reference", "match": None, "confidence": 0,
                "error": "Foto profil karyawan belum ada"}

    # ── Determine approval ────────────────────────────────────────────────
    approval_status = _determine_approval(geo, face, office)

    now = _now()
    doc_fields = {
        "clock_in": now,
        "attendance_method": "selfie_geo_ai",
        "geo_status": geo.get("status"),
        "geo_distance_m": geo.get("distance_m"),
        "clock_in_geo": {"lat": lat, "lng": lng, "status": geo.get("status"), "distance_m": geo.get("distance_m")},
        "face_match_score": face.get("confidence", 0),
        "face_match_status": face.get("status", "not_checked"),
        "face_match_reason": face.get("reason", ""),
        "photo_selfie_url": f"data:image/jpeg;base64,{photo_b64[:20]}..." if photo_b64 else None,
        "approval_status": approval_status,
        "approval_by": None, "approval_by_name": None, "approval_notes": None, "approval_at": None,
        "status": "hadir",
        "source": "selfie_geo_ai",
        "updated_by": user["id"], "updated_by_name": user.get("name", ""), "updated_at": now,
    }

    if existing:
        await db.rahaza_attendance_events.update_one({"id": existing["id"]}, {"$set": doc_fields})
        out = await db.rahaza_attendance_events.find_one({"id": existing["id"]}, {"_id": 0})
    else:
        doc_fields.update({
            "id": _uid(), "employee_id": emp_id, "date": today,
            "clock_out": None, "clock_out_geo": None,
            "hours_worked": 0, "overtime_hours": 0, "notes": "",
            "created_by": user["id"], "created_by_name": user.get("name", ""), "created_at": now,
        })
        await db.rahaza_attendance_events.insert_one(doc_fields)
        out = doc_fields

    await log_activity(user["id"], user.get("name", ""), "selfie-clock-in", "attendance", emp_id)
    return {
        "ok": True,
        "attendance": serialize_doc(out),
        "geo": geo,
        "face": {k: v for k, v in face.items() if k != "error"},
        "approval_status": approval_status,
        "message": "Clock-in berhasil!" if approval_status == "auto_approved"
                   else "Clock-in dicatat, menunggu persetujuan HR (lokasi/wajah tidak sesuai).",
    }


@router.post("/attendance/selfie/clock-out")
async def selfie_clock_out(request: Request):
    """
    Absen pulang via selfie + GPS.
    Body: { employee_id, lat, lng, photo_base64 }
    """
    user = await require_auth(request)
    db = get_db()
    body = await request.json()

    emp_id = body.get("employee_id")
    if not emp_id:
        raise HTTPException(400, "employee_id wajib.")

    today = _today_iso()
    existing = await db.rahaza_attendance_events.find_one({"employee_id": emp_id, "date": today})
    if not existing or not existing.get("clock_in"):
        raise HTTPException(400, "Belum clock-in hari ini.")
    if existing.get("clock_out"):
        raise HTTPException(400, "Sudah clock-out hari ini.")

    lat = body.get("lat")
    lng = body.get("lng")
    body.get("photo_base64", "")

    office = await db.rahaza_office_locations.find_one({"is_primary": True}, {"_id": 0})
    geo = {"status": "not_verified", "distance_m": None}
    if lat is not None and lng is not None:
        geo = _check_geofence(float(lat), float(lng), office or {})

    now = _now()
    cin = existing.get("clock_in")
    if isinstance(cin, str):
        try:
            cin = datetime.fromisoformat(cin.replace("Z", "+00:00"))
        except Exception:
            cin = None
    elif isinstance(cin, datetime):
        # Make timezone-aware if naive
        if cin.tzinfo is None:
            cin = cin.replace(tzinfo=timezone.utc)
    hours = round((now - cin).total_seconds() / 3600, 2) if cin else 0

    await db.rahaza_attendance_events.update_one({"id": existing["id"]}, {"$set": {
        "clock_out": now,
        "clock_out_geo": {"lat": lat, "lng": lng, "status": geo.get("status"), "distance_m": geo.get("distance_m")},
        "hours_worked": max(0.0, hours),
        "source": "selfie_geo_ai",
        "updated_by": user["id"], "updated_by_name": user.get("name", ""), "updated_at": now,
    }})
    out = await db.rahaza_attendance_events.find_one({"id": existing["id"]}, {"_id": 0})
    await log_activity(user["id"], user.get("name", ""), "selfie-clock-out", "attendance", emp_id)
    return {"ok": True, "attendance": serialize_doc(out), "geo": geo, "hours_worked": hours}


# ═══════════════════════════════════════════════════════════════════════════════
# 2) WEBAUTHN — REGISTRATION + AUTHENTICATION
# ═══════════════════════════════════════════════════════════════════════════════

async def _get_employee_webauthn_user(db, emp_id: str):
    emp = await db.rahaza_employees.find_one({"id": emp_id}, {"_id": 0})
    if not emp:
        raise HTTPException(404, "Karyawan tidak ditemukan.")
    return emp
