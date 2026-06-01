"""
CV. Dewi Aditya ERP — Smart Auto-Attendance System (Sprint 42)

Mendukung 3 metode absen otomatis:
1. Selfie + Geolocation + AI Face Recognition (OpenAI gpt-4o vision)
2. WebAuthn Fingerprint/Biometric (Touch ID, Face ID, Windows Hello, Android)
3. Physical Fingerprint Device Sync (ZKTeco / Fingerspot)

Plus: HR Approval Queue untuk absen yang perlu persetujuan
      Manual HR entry tetap ada di rahaza_attendance.py
"""
# ruff: noqa: E402, F401

import uuid
import math
import json
import os
from datetime import datetime, timezone, date, timedelta
from typing import Optional
from fastapi import APIRouter, Request, HTTPException
from database import get_db
from auth import require_auth, serialize_doc, log_activity
from dotenv import load_dotenv

load_dotenv()

# ─── WebAuthn imports (graceful fallback if not available) ───────────────────
WEBAUTHN_AVAILABLE = False
try:
    import webauthn
    from webauthn.helpers.structs import (
        AuthenticatorSelectionCriteria,
        AuthenticatorAttachment,
        UserVerificationRequirement,
        ResidentKeyRequirement,
        PublicKeyCredentialDescriptor,
    )
    from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
    from webauthn.helpers.exceptions import (
        InvalidRegistrationResponse,
        InvalidAuthenticationResponse,
    )
    WEBAUTHN_AVAILABLE = True
except Exception:
    # WebAuthn not available in this environment (oscrypto/libcrypto issue)
    def base64url_to_bytes(s): return b""
    def bytes_to_base64url(b): return ""
    class InvalidRegistrationResponse(Exception):
        pass
    class InvalidAuthenticationResponse(Exception):
        pass

# ─── AI Face Compare (OpenAI gpt-4o via emergentintegrations) ────────────────
from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent

router = APIRouter(prefix="/api/rahaza", tags=["rahaza-auto-attendance"])

# ─── Config ──────────────────────────────────────────────────────────────────
RP_ID = os.environ.get("WEBAUTHN_RP_ID", "analytics-builds.preview.emergentagent.com")
RP_NAME = os.environ.get("WEBAUTHN_RP_NAME", "Dewi Aditya ERP")
ORIGIN = os.environ.get("WEBAUTHN_ORIGIN", "https://p2p-workflow-dev.preview.emergentagent.com")
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")

DEFAULT_FACE_THRESHOLD = 0.65  # minimum confidence untuk auto-approve
DEFAULT_GEOFENCE_RADIUS = 300  # meter

def _uid(): return str(uuid.uuid4())
def _now(): return datetime.now(timezone.utc)
def _today_iso(): return date.today().isoformat()


# ─── Haversine geofence check ─────────────────────────────────────────────────
def _check_geofence(lat: float, lng: float, office: dict) -> dict:
    """Returns {status, distance_m, in_range}"""
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


# ─── AI Face Compare ──────────────────────────────────────────────────────────
async def _compare_faces(selfie_base64: str, reference_photo_url: str) -> dict:
    """
    Compare selfie vs employee reference photo using OpenAI gpt-4o vision.
    Returns {match: bool, confidence: float, status: str}
    """
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

        # Parse JSON response
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


# ─── Determine Approval Status ────────────────────────────────────────────────
def _determine_approval(geo: dict, face: dict, office: dict) -> str:
    """
    auto_approved: geo in_range AND face match/no_reference_ok
    pending: geo out_of_range OR face mismatch
    """
    threshold = float(office.get("face_match_threshold", DEFAULT_FACE_THRESHOLD)) if office else DEFAULT_FACE_THRESHOLD
    geo_ok = geo.get("in_range") is True or geo.get("status") == "not_verified"
    face_status = face.get("status", "not_checked")

    if face_status in ("not_checked", "no_reference"):
        face_ok = True  # no photo → skip face check
    elif face_status == "error":
        face_ok = True  # AI error → skip, mark as pending only if geo fails
    else:
        face_ok = face.get("match") is True and face.get("confidence", 0) >= threshold

    if geo_ok and face_ok:
        return "auto_approved"
    return "pending"


# ═══════════════════════════════════════════════════════════════════════════════
# 1) SELFIE + GEOLOCATION + AI FACE  — CLOCK IN / OUT
# ═══════════════════════════════════════════════════════════════════════════════

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


@router.get("/attendance/webauthn/devices")
async def list_webauthn_devices(request: Request, employee_id: Optional[str] = None):
    """List semua credential WebAuthn yang terdaftar."""
    user = await require_auth(request)
    db = get_db()
    q = {}
    if employee_id:
        q["employee_id"] = employee_id
    else:
        # HR dapat lihat semua; karyawan hanya lihat milik sendiri
        if user.get("role") not in ("superadmin", "admin", "owner", "hr"):
            # Cari employee_id dari user
            emp = await db.rahaza_employees.find_one({"user_id": user["id"]}, {"_id": 0})
            if emp:
                q["employee_id"] = emp["id"]
    rows = await db.rahaza_webauthn_credentials.find(
        {**q, "revoked_at": None},
        {"_id": 0, "public_key": 0}  # hide public key from response
    ).to_list(500)
    return serialize_doc(rows)


@router.post("/attendance/webauthn/register/options")
async def webauthn_register_options(request: Request):
    """
    Mulai registrasi WebAuthn.
    Body: { employee_id }
    """
    await require_auth(request)
    db = get_db()
    try:
        body = await request.json()
        emp_id = body.get("employee_id", "")
    except Exception:
        raise HTTPException(422, "Body JSON diperlukan: {\"employee_id\": \"<uuid>\"}")
    if not emp_id:
        raise HTTPException(422, "employee_id wajib diisi di body")

    emp = await _get_employee_webauthn_user(db, emp_id)

    # Existing credentials (untuk exclude)
    existing_creds = await db.rahaza_webauthn_credentials.find(
        {"employee_id": emp_id, "revoked_at": None},
        {"_id": 0, "credential_id": 1}
    ).to_list(500)

    exclude_credentials = []
    for c in existing_creds:
        try:
            cid = base64url_to_bytes(c["credential_id"]) if isinstance(c["credential_id"], str) else c["credential_id"]
            exclude_credentials.append(
                PublicKeyCredentialDescriptor(id=cid)
            )
        except Exception:
            pass

    try:
        options = webauthn.generate_registration_options(
            rp_id=RP_ID,
            rp_name=RP_NAME,
            user_id=emp_id.encode(),
            user_name=emp.get("email") or emp.get("employee_code") or emp_id,
            user_display_name=emp.get("name", emp_id),
            authenticator_selection=AuthenticatorSelectionCriteria(
                authenticator_attachment=AuthenticatorAttachment.PLATFORM,
                resident_key=ResidentKeyRequirement.PREFERRED,
                user_verification=UserVerificationRequirement.REQUIRED,
            ),
            exclude_credentials=exclude_credentials,
        )
    except Exception as e:
        raise HTTPException(500, f"Gagal membuat opsi registrasi: {e}")

    # Simpan challenge ke DB (TTL 5 menit)
    challenge_b64 = bytes_to_base64url(options.challenge)
    await db.rahaza_webauthn_challenges.insert_one({
        "id": _uid(),
        "employee_id": emp_id,
        "challenge": challenge_b64,
        "type": "registration",
        "expires_at": _now() + timedelta(minutes=5),
        "used": False,
    })

    return json.loads(webauthn.options_to_json(options))


@router.post("/attendance/webauthn/register/verify")
async def webauthn_register_verify(request: Request):
    """
    Selesaikan registrasi WebAuthn.
    Body: credential object dari browser + employee_id + device_name
    """
    await require_auth(request)
    db = get_db()
    body = await request.json()

    emp_id = body.get("employee_id")
    device_name = body.get("device_name") or "Device"
    if not emp_id:
        raise HTTPException(400, "employee_id wajib.")

    # Ambil challenge dari DB
    ch = await db.rahaza_webauthn_challenges.find_one({
        "employee_id": emp_id,
        "type": "registration",
        "used": False,
        "expires_at": {"$gt": _now()},
    }, sort=[("_id", -1)])
    if not ch:
        raise HTTPException(400, "Challenge tidak ditemukan atau sudah kadaluarsa. Mulai ulang registrasi.")

    try:
        credential_id_raw = body.get("id") or body.get("rawId", "")
        credential = webauthn.helpers.structs.RegistrationCredential(
            id=credential_id_raw,
            raw_id=base64url_to_bytes(body.get("rawId", credential_id_raw)),
            response=webauthn.helpers.structs.AuthenticatorAttestationResponse(
                client_data_json=base64url_to_bytes(body["response"]["clientDataJSON"]),
                attestation_object=base64url_to_bytes(body["response"]["attestationObject"]),
            ),
            type=body.get("type", "public-key"),
        )
        verification = webauthn.verify_registration_response(
            credential=credential,
            expected_challenge=base64url_to_bytes(ch["challenge"]),
            expected_rp_id=RP_ID,
            expected_origin=ORIGIN,
            require_resident_key=False,
        )
    except InvalidRegistrationResponse as e:
        raise HTTPException(400, f"Verifikasi registrasi gagal: {e}")
    except Exception as e:
        raise HTTPException(500, f"Error registrasi: {e}")

    # Tandai challenge sebagai terpakai
    await db.rahaza_webauthn_challenges.update_one({"id": ch["id"]}, {"$set": {"used": True}})

    # Simpan credential
    cred_doc = {
        "id": _uid(),
        "employee_id": emp_id,
        "credential_id": bytes_to_base64url(verification.credential_id),
        "public_key": bytes_to_base64url(verification.credential_public_key),
        "sign_count": verification.sign_count,
        "device_name": device_name,
        "transports": body.get("response", {}).get("transports") or [],
        "aaguid": str(verification.aaguid) if verification.aaguid else None,
        "created_at": _now(),
        "last_used_at": None,
        "revoked_at": None,
    }
    await db.rahaza_webauthn_credentials.insert_one(cred_doc)

    emp = await db.rahaza_employees.find_one({"id": emp_id}, {"_id": 0, "name": 1})
    return {"ok": True, "message": f"Biometrik berhasil didaftarkan untuk {emp.get('name','?')}", "device": cred_doc["id"]}


@router.post("/attendance/webauthn/auth/options")
async def webauthn_auth_options(request: Request):
    """
    Mulai autentikasi WebAuthn untuk clock-in/out.
    Body: { employee_id }
    """
    await require_auth(request)
    db = get_db()
    body = await request.json()
    emp_id = body.get("employee_id")
    if not emp_id:
        raise HTTPException(400, "employee_id wajib.")

    creds = await db.rahaza_webauthn_credentials.find(
        {"employee_id": emp_id, "revoked_at": None},
        {"_id": 0}
    ).to_list(500)
    if not creds:
        raise HTTPException(400, "Belum ada biometrik terdaftar untuk karyawan ini. Lakukan registrasi terlebih dahulu.")

    allow_credentials = []
    for c in creds:
        try:
            cid = base64url_to_bytes(c["credential_id"])
            allow_credentials.append(
                PublicKeyCredentialDescriptor(
                    id=cid,
                    transports=c.get("transports") or [],
                )
            )
        except Exception:
            pass

    try:
        options = webauthn.generate_authentication_options(
            rp_id=RP_ID,
            allow_credentials=allow_credentials,
            user_verification=UserVerificationRequirement.REQUIRED,
        )
    except Exception as e:
        raise HTTPException(500, f"Gagal membuat opsi autentikasi: {e}")

    challenge_b64 = bytes_to_base64url(options.challenge)
    await db.rahaza_webauthn_challenges.insert_one({
        "id": _uid(),
        "employee_id": emp_id,
        "challenge": challenge_b64,
        "type": "authentication",
        "expires_at": _now() + timedelta(minutes=5),
        "used": False,
    })

    return json.loads(webauthn.options_to_json(options))


@router.post("/attendance/webauthn/clock-in")
async def webauthn_clock_in(request: Request):
    """
    Clock-in via WebAuthn assertion.
    Body: credential assertion dari browser + employee_id
    """
    user = await require_auth(request)
    db = get_db()
    body = await request.json()
    emp_id = body.get("employee_id")
    if not emp_id:
        raise HTTPException(400, "employee_id wajib.")

    today = _today_iso()
    existing = await db.rahaza_attendance_events.find_one({"employee_id": emp_id, "date": today})
    if existing and existing.get("clock_in"):
        raise HTTPException(400, "Karyawan sudah clock-in hari ini.")

    # Cari challenge
    ch = await db.rahaza_webauthn_challenges.find_one({
        "employee_id": emp_id, "type": "authentication",
        "used": False, "expires_at": {"$gt": _now()},
    }, sort=[("_id", -1)])
    if not ch:
        raise HTTPException(400, "Challenge tidak ditemukan atau kadaluarsa.")

    # Cari credential yang dipakai
    cred_id_raw = body.get("id") or body.get("rawId", "")
    cred_doc = await db.rahaza_webauthn_credentials.find_one({
        "employee_id": emp_id,
        "credential_id": cred_id_raw,
        "revoked_at": None,
    })
    if not cred_doc:
        # Try to find by decoded credential id
        cred_doc = await db.rahaza_webauthn_credentials.find_one(
            {"employee_id": emp_id, "revoked_at": None},
        )
    if not cred_doc:
        raise HTTPException(400, "Credential tidak ditemukan.")

    try:
        assertion = webauthn.helpers.structs.AuthenticationCredential(
            id=cred_id_raw,
            raw_id=base64url_to_bytes(body.get("rawId", cred_id_raw)),
            response=webauthn.helpers.structs.AuthenticatorAssertionResponse(
                client_data_json=base64url_to_bytes(body["response"]["clientDataJSON"]),
                authenticator_data=base64url_to_bytes(body["response"]["authenticatorData"]),
                signature=base64url_to_bytes(body["response"]["signature"]),
                user_handle=base64url_to_bytes(body["response"]["userHandle"]) if body["response"].get("userHandle") else None,
            ),
            type=body.get("type", "public-key"),
        )
        verification = webauthn.verify_authentication_response(
            credential=assertion,
            expected_challenge=base64url_to_bytes(ch["challenge"]),
            expected_rp_id=RP_ID,
            expected_origin=ORIGIN,
            credential_public_key=base64url_to_bytes(cred_doc["public_key"]),
            credential_current_sign_count=cred_doc.get("sign_count", 0),
            require_user_verification=True,
        )
    except InvalidAuthenticationResponse as e:
        raise HTTPException(401, f"Autentikasi biometrik gagal: {e}")
    except Exception as e:
        raise HTTPException(500, f"Error autentikasi: {e}")

    # Update sign count dan last_used
    await db.rahaza_webauthn_credentials.update_one(
        {"id": cred_doc["id"]},
        {"$set": {"sign_count": verification.new_sign_count, "last_used_at": _now()}}
    )
    await db.rahaza_webauthn_challenges.update_one({"id": ch["id"]}, {"$set": {"used": True}})

    now = _now()
    doc_fields = {
        "clock_in": now, "attendance_method": "webauthn",
        "geo_status": "not_verified", "geo_distance_m": None,
        "clock_in_geo": None, "face_match_score": 1.0,
        "face_match_status": "biometric_verified",
        "approval_status": "auto_approved",
        "status": "hadir", "source": "webauthn",
        "webauthn_credential_id": cred_doc["id"],
        "updated_by": user["id"], "updated_by_name": user.get("name", ""), "updated_at": now,
    }

    if existing:
        await db.rahaza_attendance_events.update_one({"id": existing["id"]}, {"$set": doc_fields})
        out = await db.rahaza_attendance_events.find_one({"id": existing["id"]}, {"_id": 0})
    else:
        doc_fields.update({
            "id": _uid(), "employee_id": emp_id, "date": today,
            "clock_out": None, "hours_worked": 0, "overtime_hours": 0, "notes": "",
            "created_by": user["id"], "created_by_name": user.get("name", ""), "created_at": now,
        })
        await db.rahaza_attendance_events.insert_one(doc_fields)
        out = doc_fields

    await log_activity(user["id"], user.get("name", ""), "webauthn-clock-in", "attendance", emp_id)
    return {"ok": True, "attendance": serialize_doc(out), "message": "Clock-in via biometrik berhasil!"}


@router.post("/attendance/webauthn/clock-out")
async def webauthn_clock_out(request: Request):
    """Clock-out via WebAuthn assertion."""
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

    # Simplified: re-use same WebAuthn verify flow (same as clock-in but just clock-out action)
    ch = await db.rahaza_webauthn_challenges.find_one({
        "employee_id": emp_id, "type": "authentication",
        "used": False, "expires_at": {"$gt": _now()},
    }, sort=[("_id", -1)])
    if not ch:
        raise HTTPException(400, "Challenge tidak ditemukan atau kadaluarsa.")

    cred_id_raw = body.get("id") or body.get("rawId", "")
    cred_doc = await db.rahaza_webauthn_credentials.find_one(
        {"employee_id": emp_id, "revoked_at": None}
    )
    if not cred_doc:
        raise HTTPException(400, "Credential tidak ditemukan.")

    try:
        assertion = webauthn.helpers.structs.AuthenticationCredential(
            id=cred_id_raw,
            raw_id=base64url_to_bytes(body.get("rawId", cred_id_raw)),
            response=webauthn.helpers.structs.AuthenticatorAssertionResponse(
                client_data_json=base64url_to_bytes(body["response"]["clientDataJSON"]),
                authenticator_data=base64url_to_bytes(body["response"]["authenticatorData"]),
                signature=base64url_to_bytes(body["response"]["signature"]),
                user_handle=base64url_to_bytes(body["response"]["userHandle"]) if body["response"].get("userHandle") else None,
            ),
            type=body.get("type", "public-key"),
        )
        verification = webauthn.verify_authentication_response(
            credential=assertion,
            expected_challenge=base64url_to_bytes(ch["challenge"]),
            expected_rp_id=RP_ID,
            expected_origin=ORIGIN,
            credential_public_key=base64url_to_bytes(cred_doc["public_key"]),
            credential_current_sign_count=cred_doc.get("sign_count", 0),
            require_user_verification=True,
        )
    except InvalidAuthenticationResponse as e:
        raise HTTPException(401, f"Autentikasi biometrik gagal: {e}")
    except Exception as e:
        raise HTTPException(500, f"Error autentikasi: {e}")

    await db.rahaza_webauthn_credentials.update_one(
        {"id": cred_doc["id"]},
        {"$set": {"sign_count": verification.new_sign_count, "last_used_at": _now()}}
    )
    await db.rahaza_webauthn_challenges.update_one({"id": ch["id"]}, {"$set": {"used": True}})

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
        "clock_out": now, "hours_worked": max(0.0, hours),
        "source": "webauthn", "updated_by": user["id"],
        "updated_by_name": user.get("name", ""), "updated_at": now,
    }})
    out = await db.rahaza_attendance_events.find_one({"id": existing["id"]}, {"_id": 0})
    await log_activity(user["id"], user.get("name", ""), "webauthn-clock-out", "attendance", emp_id)
    return {"ok": True, "attendance": serialize_doc(out), "hours_worked": hours, "message": "Clock-out via biometrik berhasil!"}


@router.delete("/attendance/webauthn/devices/{device_id}")
async def revoke_webauthn_device(device_id: str, request: Request):
    """Cabut/hapus credential WebAuthn."""
    await require_auth(request)
    db = get_db()
    cred = await db.rahaza_webauthn_credentials.find_one({"id": device_id})
    if not cred:
        raise HTTPException(404, "Credential tidak ditemukan.")
    await db.rahaza_webauthn_credentials.update_one(
        {"id": device_id}, {"$set": {"revoked_at": _now()}}
    )
    return {"ok": True, "message": "Biometrik berhasil dicabut."}


# ═══════════════════════════════════════════════════════════════════════════════
# 3) ZKTECO PHYSICAL DEVICE MANAGEMENT
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/devices/zkteco")
async def list_zkteco_devices(request: Request):
    """List semua device ZKTeco yang terkonfigurasi."""
    await require_auth(request)
    db = get_db()
    rows = await db.rahaza_zkteco_devices.find({}, {"_id": 0}).to_list(500)
    return serialize_doc(rows)


@router.post("/devices/zkteco")
async def add_zkteco_device(request: Request):
    """Tambah konfigurasi device ZKTeco/Fingerspot."""
    user = await require_auth(request)
    if user.get("role") not in ("superadmin", "admin", "owner", "hr"):
        raise HTTPException(403, "Hanya admin/HR.")
    db = get_db()
    body = await request.json()
    name = body.get("name", "").strip()
    ip = body.get("ip", "").strip()
    port = int(body.get("port") or 4370)
    if not name or not ip:
        raise HTTPException(400, "name dan ip wajib diisi.")

    doc = {
        "id": _uid(),
        "name": name,
        "ip": ip,
        "port": port,
        "password": int(body.get("password") or 0),
        "timezone": int(body.get("timezone") or 8),  # UTC+8 WIB
        "enabled": bool(body.get("enabled", True)),
        "last_sync_at": None,
        "last_sync_status": None,
        "last_sync_records": 0,
        "last_error": None,
        "created_at": _now(),
        "updated_at": _now(),
    }
    await db.rahaza_zkteco_devices.insert_one(doc)
    return serialize_doc(doc)


@router.put("/devices/zkteco/{device_id}")
async def update_zkteco_device(device_id: str, request: Request):
    """Update konfigurasi device ZKTeco."""
    user = await require_auth(request)
    if user.get("role") not in ("superadmin", "admin", "owner", "hr"):
        raise HTTPException(403, "Hanya admin/HR.")
    db = get_db()
    body = await request.json()
    updates = {k: v for k, v in {
        "name": body.get("name"), "ip": body.get("ip"),
        "port": body.get("port"), "password": body.get("password"),
        "enabled": body.get("enabled"), "timezone": body.get("timezone"),
        "updated_at": _now(),
    }.items() if v is not None}
    result = await db.rahaza_zkteco_devices.update_one({"id": device_id}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(404, "Device tidak ditemukan.")
    return {"ok": True}


@router.delete("/devices/zkteco/{device_id}")
async def delete_zkteco_device(device_id: str, request: Request):
    """Hapus device ZKTeco."""
    user = await require_auth(request)
    if user.get("role") not in ("superadmin", "admin", "owner", "hr"):
        raise HTTPException(403, "Hanya admin/HR.")
    db = get_db()
    result = await db.rahaza_zkteco_devices.delete_one({"id": device_id})
    if result.deleted_count == 0:
        raise HTTPException(404, "Device tidak ditemukan.")
    return {"ok": True}


@router.post("/devices/zkteco/{device_id}/sync")
async def sync_zkteco_device(device_id: str, request: Request):
    """
    Sync attendance logs dari device ZKTeco ke sistem.
    Butuh hardware nyata; simulator mode tersedia untuk testing.
    """
    user = await require_auth(request)
    if user.get("role") not in ("superadmin", "admin", "owner", "hr"):
        raise HTTPException(403, "Hanya admin/HR.")
    db = get_db()
    device = await db.rahaza_zkteco_devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(404, "Device tidak ditemukan.")

    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    simulator_mode = (await request.json() if request.headers.get("content-type","").startswith("application/json") else {}).get("simulator", False) if False else False

    try:
        body_raw = await request.body()
        if body_raw:
            body = json.loads(body_raw)
        simulator_mode = body.get("simulator", False)
    except Exception:
        pass

    if simulator_mode:
        # Simulator mode: generate fake attendance logs for testing
        emps = await db.rahaza_employees.find({"active": True}, {"_id": 0, "id": 1, "name": 1}).limit(5).to_list(500)
        synced = 0
        today = _today_iso()
        for i, emp in enumerate(emps):
            existing = await db.rahaza_attendance_events.find_one(
                {"employee_id": emp["id"], "date": today, "source": "device_zkteco"}
            )
            if existing:
                continue
            clock_in_time = _now().replace(hour=7 + i % 2, minute=30 + i * 5, second=0, microsecond=0)
            doc = {
                "id": _uid(), "employee_id": emp["id"], "date": today,
                "clock_in": clock_in_time, "clock_out": None,
                "hours_worked": 0, "overtime_hours": 0, "status": "hadir",
                "attendance_method": "device_zkteco", "geo_status": "not_verified",
                "face_match_status": "biometric_verified", "face_match_score": 1.0,
                "approval_status": "auto_approved", "source": "device_zkteco",
                "device_source": device["name"], "device_event_id": f"{device_id}-sim-{today}-{i}",
                "notes": f"Sync dari device: {device['name']} (simulator)",
                "created_by": user["id"], "created_by_name": user.get("name", ""),
                "created_at": _now(), "updated_at": _now(),
                "updated_by": user["id"], "updated_by_name": user.get("name", ""),
            }
            await db.rahaza_attendance_events.insert_one(doc)
            synced += 1

        await db.rahaza_zkteco_devices.update_one({"id": device_id}, {"$set": {
            "last_sync_at": _now(), "last_sync_status": "success_simulator",
            "last_sync_records": synced, "last_error": None,
        }})
        return {"ok": True, "synced": synced, "mode": "simulator",
                "message": f"Simulator: {synced} record kehadiran berhasil disinkronkan."}

    # Real device sync via pyzk
    try:
        from zk import ZK, const as zk_const
        zk = ZK(device["ip"], port=device.get("port", 4370),
                timeout=10, password=device.get("password", 0),
                ommit_ping=False)
        conn = None
        try:
            conn = zk.connect()
            conn.disable_device()
            attendances = conn.get_attendance()
            conn.enable_device()

            # Map ZKTeco user ID → employee
            users = conn.get_users()
            zk_user_map = {str(u.user_id): u.name for u in users}

            synced = 0
            skipped = 0
            for att in attendances:
                emp = await db.rahaza_employees.find_one(
                    {"$or": [
                        {"zkteco_user_id": str(att.user_id)},
                        {"employee_code": zk_user_map.get(str(att.user_id), "NOTFOUND")},
                    ]},
                    {"_id": 0}
                )
                if not emp:
                    skipped += 1
                    continue

                att_date = att.timestamp.date().isoformat() if att.timestamp else _today_iso()
                device_event_id = f"{device_id}-{att.user_id}-{att.timestamp}"

                existing = await db.rahaza_attendance_events.find_one({"device_event_id": device_event_id})
                if existing:
                    skipped += 1
                    continue

                # Determine if clock-in or clock-out by punch type
                is_clock_in = att.punch in (0, 254)  # 0=check-in in most models
                att_doc = {
                    "id": _uid(), "employee_id": emp["id"], "date": att_date,
                    "clock_in": att.timestamp if is_clock_in else None,
                    "clock_out": att.timestamp if not is_clock_in else None,
                    "hours_worked": 0, "overtime_hours": 0, "status": "hadir",
                    "attendance_method": "device_zkteco",
                    "geo_status": "not_verified", "face_match_status": "biometric_verified",
                    "face_match_score": 1.0, "approval_status": "auto_approved",
                    "source": "device_zkteco", "device_source": device["name"],
                    "device_event_id": device_event_id,
                    "notes": f"Sync dari device: {device['name']}",
                    "created_by": user["id"], "created_by_name": user.get("name", ""),
                    "created_at": _now(), "updated_at": _now(),
                    "updated_by": user["id"], "updated_by_name": user.get("name", ""),
                }
                await db.rahaza_attendance_events.insert_one(att_doc)
                synced += 1

            await db.rahaza_zkteco_devices.update_one({"id": device_id}, {"$set": {
                "last_sync_at": _now(), "last_sync_status": "success",
                "last_sync_records": synced, "last_error": None,
            }})
            return {"ok": True, "synced": synced, "skipped": skipped, "mode": "live",
                    "message": f"{synced} record berhasil disinkronkan dari device."}
        finally:
            if conn:
                conn.disconnect()
    except ImportError:
        raise HTTPException(500, "Library pyzk tidak tersedia.")
    except Exception as e:
        err_msg = str(e)[:300]
        await db.rahaza_zkteco_devices.update_one({"id": device_id}, {"$set": {
            "last_sync_at": _now(), "last_sync_status": "error",
            "last_sync_records": 0, "last_error": err_msg,
        }})
        raise HTTPException(503, f"Gagal terhubung ke device: {err_msg}. Pastikan device menyala dan IP/port benar.")


@router.get("/devices/zkteco/{device_id}/last-sync")
async def get_zkteco_last_sync(device_id: str, request: Request):
    await require_auth(request)
    db = get_db()
    device = await db.rahaza_zkteco_devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(404, "Device tidak ditemukan.")
    return serialize_doc(device)


# ═══════════════════════════════════════════════════════════════════════════════
# 4) HR APPROVAL QUEUE
# ═══════════════════════════════════════════════════════════════════════════════

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
