"""
Portal Saya — Self-Service + My Workspace
Prefix: /api/portal

SELF-SERVICE HR:
  GET  /profile       - profil + data karyawan
  PUT  /profile       - update profil (nama_panggilan, no_hp, alamat, kontak_darurat)
  GET  /dashboard     - stat widget (cuti, payslip, kpi, absensi, training)
  GET  /leave         - riwayat cuti/izin milik saya
  POST /leave         - ajukan cuti/izin
  DELETE /leave/{id}  - batalkan (jika masih pending)
  GET  /overtime      - riwayat lembur milik saya
  POST /overtime      - ajukan lembur
  GET  /payslips      - list slip gaji saya
  GET  /training      - progres LMS saya
  GET  /notifications - inbox notifikasi personal

WORKSPACE:
  CRUD /notes         - notepad (dengan konten rich text HTML)
  CRUD /todos         - todo personal
  CRUD /reminders     - reminder personal
  CRUD /quick-links   - pinned shortcuts
  CRUD /calendar      - event kalender personal
  GET  /calendar/combined - gabungan event (personal + HR)
"""
from fastapi import APIRouter, Request, HTTPException, Query, UploadFile, File
from database import get_db
from auth import require_auth, serialize_doc
from datetime import datetime, timezone, date, timedelta
from typing import Optional
import uuid
import logging
from storage import put_object, generate_storage_path

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/portal", tags=["portal-saya"])

def _uid(): return str(uuid.uuid4())
def _now(): return datetime.now(timezone.utc)
def _now_iso(): return _now().isoformat()


async def _get_linked_employee(db, user_id: str):
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        return user, None
    emp_id = user.get("employee_id")
    emp = await db.rahaza_employees.find_one({"id": emp_id}, {"_id": 0}) if emp_id else None
    return user, emp


# ══════════════════════════════════════════════════════════════
# PROFIL
# ══════════════════════════════════════════════════════════════

@router.get("/profile")
async def get_profile(request: Request):
    user = await require_auth(request)
    db = get_db()
    u, emp = await _get_linked_employee(db, user["id"])
    return {
        "user_id": user["id"],
        "name": u.get("name") or u.get("full_name"),
        "email": u.get("email"),
        "role": u.get("role"),
        "no_hp": u.get("no_hp", ""),
        "alamat": u.get("alamat", ""),
        "nama_panggilan": u.get("nama_panggilan", ""),
        "kontak_darurat": u.get("kontak_darurat", {}),
        "foto_url": u.get("foto_url", ""),
        "employee_id": u.get("employee_id"),
        "employee": emp,
        "is_linked": emp is not None,
    }


@router.put("/profile")
async def update_profile(request: Request):
    user = await require_auth(request)
    db = get_db()
    body = await request.json()
    allowed = ["nama_panggilan", "no_hp", "alamat", "kontak_darurat", "foto_url"]
    upd = {k: v for k, v in body.items() if k in allowed}
    upd["updated_at"] = _now_iso()
    if upd:
        await db.users.update_one({"id": user["id"]}, {"$set": upd})
    out = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password": 0, "hashed_password": 0})
    return serialize_doc(out)


@router.post("/profile/photo")
async def upload_profile_photo(request: Request, file: UploadFile = File(...)):
    """Upload foto profil — replaces any previous photo."""
    user = await require_auth(request)
    db = get_db()
    data = await file.read()
    # Validate size and type
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(400, "File terlalu besar (max 5 MB)")
    ct = (file.content_type or "").lower()
    if not ct.startswith("image/"):
        raise HTTPException(400, "File harus berupa gambar (JPG, PNG, WEBP, dll)")
    # Store with unique path under profile/<user_id>/
    safe_name = file.filename or "photo.jpg"
    storage_path = generate_storage_path(f"profile/{user['id']}", safe_name)
    result = put_object(storage_path, data, ct)
    photo_url = result["url"]
    # Persist URL in user document
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"foto_url": photo_url, "updated_at": _now_iso()}}
    )
    return {"foto_url": photo_url, "message": "Foto profil berhasil diperbarui."}


# ══════════════════════════════════════════════════════════════
# DASHBOARD STATS
# ══════════════════════════════════════════════════════════════

@router.get("/dashboard")
async def get_dashboard(request: Request):
    user = await require_auth(request)
    db = get_db()
    u, emp = await _get_linked_employee(db, user["id"])
    uid = user["id"]
    emp_id = emp["id"] if emp else None
    today_str = date.today().isoformat()
    month_start = date.today().replace(day=1).isoformat()

    # --- Leave balance ---
    leave_balance = []
    if emp_id:
        bals = await db.rahaza_leave_balances.find(
            {"employee_id": emp_id, "year": date.today().year}, {"_id": 0}
        ).to_list(20)
        lt_ids = [b.get("leave_type_id") for b in bals]
        lts = await db.rahaza_leave_types.find({"id": {"$in": lt_ids}}, {"_id": 0}).to_list(500) if lt_ids else []
        lt_map = {lt["id"]: lt for lt in lts}
        for b in bals:
            lt = lt_map.get(b.get("leave_type_id"), {})
            leave_balance.append({
                "type_name": lt.get("name", "Cuti"),
                "code": lt.get("code", ""),
                "quota": b.get("quota", 0),
                "used": b.get("used", 0),
                "remaining": b.get("quota", 0) - b.get("used", 0),
            })

    # --- Last payslip ---
    last_payslip = None
    if emp_id:
        slip = await db.rahaza_payslips.find_one(
            {"employee_id": emp_id}, {"_id": 0}, sort=[("period_from", -1)]
        )
        if slip:
            last_payslip = {
                "period": slip.get("period_from", "")[:7],
                "net_pay": slip.get("net_pay", 0),
                "gross_pay": slip.get("gross_pay", 0),
            }

    # --- Absensi bulan ini ---
    absensi = {"hadir": 0, "izin": 0, "sakit": 0, "alfa": 0, "cuti": 0}
    if emp_id:
        att_rows = await db.rahaza_attendance_events.find(
            {"employee_id": emp_id, "date": {"$gte": month_start, "$lte": today_str}}, {"_id": 0, "status": 1}
        ).to_list(100)
        for r in att_rows:
            s = r.get("status", "hadir")
            if s in absensi:
                absensi[s] += 1

    # --- Pending leave requests ---
    pending_leave = 0
    if emp_id:
        pending_leave = await db.rahaza_leave_requests.count_documents(
            {"employee_id": emp_id, "status": "pending"}
        )

    # --- Training progress ---
    training_stats = {"enrolled": 0, "completed": 0, "pct": 0}
    if emp_id:
        enrollments = await db.dewi_lms_enrollments.find(
            {"employee_id": emp_id}, {"_id": 0, "status": 1}
        ).to_list(100)
        training_stats["enrolled"] = len(enrollments)
        training_stats["completed"] = sum(1 for e in enrollments if e.get("status") == "completed")
        if training_stats["enrolled"]:
            training_stats["pct"] = round(training_stats["completed"] / training_stats["enrolled"] * 100)

    # --- KPI bulan ini ---
    kpi_score = None
    if emp_id:
        kpi_doc = await db.dewi_kpi_submissions.find_one(
            {"employee_id": emp_id}, {"_id": 0, "final_score": 1, "grade": 1, "period_label": 1},
            sort=[("created_at", -1)]
        )
        if kpi_doc:
            kpi_score = {
                "score": kpi_doc.get("final_score", 0),
                "grade": kpi_doc.get("grade", "-"),
                "period": kpi_doc.get("period_label", ""),
            }

    # --- Todo stats ---
    todos_total = await db.portal_todos.count_documents({"user_id": uid})
    todos_done  = await db.portal_todos.count_documents({"user_id": uid, "done": True})
    todos_overdue = await db.portal_todos.count_documents({
        "user_id": uid, "done": False,
        "due_date": {"$lt": today_str, "$exists": True, "$ne": ""},
    })

    # --- Upcoming reminders ---
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    upcoming_reminders = await db.portal_reminders.find(
        {"user_id": uid, "is_done": False, "remind_at": {"$lte": tomorrow + "T23:59:59"}},
        {"_id": 0}
    ).sort("remind_at", 1).to_list(5)

    return {
        "is_linked": emp is not None,
        "employee_name": emp.get("name") if emp else None,
        "employee_code": emp.get("employee_code") if emp else None,
        "job_title": emp.get("job_title") if emp else None,
        "leave_balance": leave_balance,
        "last_payslip": last_payslip,
        "absensi_bulan_ini": absensi,
        "pending_leave": pending_leave,
        "training_stats": training_stats,
        "kpi_score": kpi_score,
        "todos": {"total": todos_total, "done": todos_done, "overdue": todos_overdue},
        "upcoming_reminders": [serialize_doc(r) for r in upcoming_reminders],
    }


# ══════════════════════════════════════════════════════════════
# CUTI & IZIN
# ══════════════════════════════════════════════════════════════

@router.get("/leave")
async def my_leave(request: Request, limit: int = 30, status: Optional[str] = None):
    user = await require_auth(request)
    db = get_db()
    _, emp = await _get_linked_employee(db, user["id"])
    if not emp:
        raise HTTPException(409, "Akun belum terhubung ke data karyawan. Hubungi HR Admin.")
    q = {"employee_id": emp["id"]}
    if status:
        q["status"] = status
    rows = await db.rahaza_leave_requests.find(q, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(500)
    # Enrich with leave type name
    lt_ids = list({r.get("leave_type_id") for r in rows if r.get("leave_type_id")})
    lts = await db.rahaza_leave_types.find({"id": {"$in": lt_ids}}, {"_id": 0}).to_list(500) if lt_ids else []
    lt_map = {lt["id"]: lt for lt in lts}
    for r in rows:
        lt = lt_map.get(r.get("leave_type_id"), {})
        r["leave_type_name"] = lt.get("name", "Cuti")
        r["leave_type_color"] = lt.get("color", "#6366f1")
    return {"total": len(rows), "items": rows}


@router.post("/leave")
async def create_leave(request: Request):
    user = await require_auth(request)
    db = get_db()
    _, emp = await _get_linked_employee(db, user["id"])
    if not emp:
        raise HTTPException(409, "Akun belum terhubung ke data karyawan.")
    body = await request.json()
    leave_type_id = body.get("leave_type_id")
    from_date = body.get("from_date")
    to_date = body.get("to_date", from_date)
    reason = body.get("reason", "")

    if not leave_type_id or not from_date:
        raise HTTPException(400, "leave_type_id dan from_date wajib diisi.")

    lt = await db.rahaza_leave_types.find_one({"id": leave_type_id, "active": True})
    if not lt:
        raise HTTPException(404, "Tipe cuti tidak ditemukan.")

    # Calculate days
    try:
        d1 = date.fromisoformat(from_date)
        d2 = date.fromisoformat(to_date)
        days = (d2 - d1).days + 1
    except Exception:
        raise HTTPException(400, "Format tanggal tidak valid (YYYY-MM-DD).")

    doc = {
        "id": _uid(),
        "employee_id": emp["id"],
        "employee_name": emp.get("name"),
        "leave_type_id": leave_type_id,
        "leave_type_name": lt.get("name"),
        "from_date": from_date,
        "to_date": to_date,
        "days": days,
        "reason": reason,
        "status": "pending",
        "submitted_by_self": True,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    await db.rahaza_leave_requests.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.delete("/leave/{leave_id}")
async def cancel_leave(leave_id: str, request: Request):
    user = await require_auth(request)
    db = get_db()
    _, emp = await _get_linked_employee(db, user["id"])
    if not emp:
        raise HTTPException(409, "Akun belum terhubung.")
    lr = await db.rahaza_leave_requests.find_one({"id": leave_id, "employee_id": emp["id"]}, {"_id": 0})
    if not lr:
        raise HTTPException(404, "Request tidak ditemukan.")
    if lr.get("status") != "pending":
        raise HTTPException(400, f"Tidak dapat membatalkan request dengan status '{lr.get('status')}'.")
    await db.rahaza_leave_requests.delete_one({"id": leave_id})
    return {"ok": True}


@router.get("/leave-types")
async def get_leave_types(request: Request):
    await require_auth(request)
    db = get_db()
    types = await db.rahaza_leave_types.find({"active": True}, {"_id": 0}).sort("name", 1).to_list(500)
    return {"items": types}


# ══════════════════════════════════════════════════════════════
# LEMBUR
# ══════════════════════════════════════════════════════════════

@router.get("/overtime")
async def my_overtime(request: Request, limit: int = 30):
    user = await require_auth(request)
    db = get_db()
    _, emp = await _get_linked_employee(db, user["id"])
    if not emp:
        raise HTTPException(409, "Akun belum terhubung ke data karyawan.")
    rows = await db.rahaza_overtime_requests.find(
        {"employee_id": emp["id"]}, {"_id": 0}
    ).sort("date", -1).limit(limit).to_list(500)
    return {"total": len(rows), "items": rows}


@router.post("/overtime")
async def create_overtime(request: Request):
    user = await require_auth(request)
    db = get_db()
    _, emp = await _get_linked_employee(db, user["id"])
    if not emp:
        raise HTTPException(409, "Akun belum terhubung ke data karyawan.")
    body = await request.json()
    ot_date = body.get("date")
    start_time = body.get("start_time")
    end_time = body.get("end_time")
    reason = body.get("reason", "")
    if not ot_date or not start_time or not end_time:
        raise HTTPException(400, "date, start_time, dan end_time wajib diisi.")

    # Calculate hours
    try:
        fmt = "%H:%M"
        st = datetime.strptime(start_time, fmt)
        et = datetime.strptime(end_time, fmt)
        hours = round((et - st).total_seconds() / 3600, 2)
        if hours <= 0:
            raise HTTPException(400, "end_time harus setelah start_time.")
    except ValueError:
        raise HTTPException(400, "Format waktu tidak valid (HH:MM).")

    doc = {
        "id": _uid(),
        "employee_id": emp["id"],
        "employee_name": emp.get("name"),
        "date": ot_date,
        "start_time": start_time,
        "end_time": end_time,
        "hours": hours,
        "reason": reason,
        "status": "pending",
        "submitted_by_self": True,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    await db.rahaza_overtime_requests.insert_one(doc)
    doc.pop("_id", None)
    return doc


# ══════════════════════════════════════════════════════════════
# PAYSLIP
# ══════════════════════════════════════════════════════════════

@router.get("/payslips")
async def my_payslips(request: Request):
    user = await require_auth(request)
    db = get_db()
    _, emp = await _get_linked_employee(db, user["id"])
    if not emp:
        raise HTTPException(409, "Akun belum terhubung ke data karyawan.")
    slips = await db.rahaza_payslips.find(
        {"employee_id": emp["id"]}, {"_id": 0}
    ).sort("period_from", -1).to_list(24)
    return {"employee": emp.get("name"), "items": slips}


# ══════════════════════════════════════════════════════════════
# TRAINING
# ══════════════════════════════════════════════════════════════

@router.get("/training")
async def my_training(request: Request):
    user = await require_auth(request)
    db = get_db()
    _, emp = await _get_linked_employee(db, user["id"])
    emp_id = emp["id"] if emp else None
    if not emp_id:
        raise HTTPException(409, "Akun belum terhubung ke data karyawan.")

    enrollments = await db.dewi_lms_enrollments.find(
        {"employee_id": emp_id}, {"_id": 0}
    ).sort("enrolled_at", -1).to_list(50)

    # Enrich with course info
    course_ids = list({e.get("course_id") for e in enrollments if e.get("course_id")})
    courses = await db.dewi_lms_courses.find({"course_id": {"$in": course_ids}}, {"_id": 0}).to_list(500) if course_ids else []
    course_map = {c["course_id"]: c for c in courses}

    items = []
    for e in enrollments:
        course = course_map.get(e.get("course_id"), {})
        items.append({
            **e,
            "course_title": course.get("title", ""),
            "course_category": course.get("category", ""),
            "total_modules": course.get("total_modules", 0),
        })

    return {"employee": emp.get("name"), "total": len(items), "items": items}


@router.get("/training/{enrollment_id}/certificate")
async def download_training_certificate(enrollment_id: str, request: Request):
    """Generate PDF sertifikat untuk kursus yang sudah selesai."""
    user = await require_auth(request)
    db = get_db()
    _, emp = await _get_linked_employee(db, user["id"])
    if not emp:
        raise HTTPException(409, "Akun belum terhubung ke data karyawan.")

    enroll = await db.dewi_lms_enrollments.find_one({"enrollment_id": enrollment_id, "employee_id": emp["id"]}, {"_id": 0})
    if not enroll:
        raise HTTPException(404, "Enrollment tidak ditemukan.")
    if enroll.get("status") != "completed":
        raise HTTPException(400, "Kursus belum selesai — sertifikat belum tersedia.")

    course = await db.dewi_lms_courses.find_one({"course_id": enroll.get("course_id")}, {"_id": 0})
    course_title = course.get("title", "Kursus") if course else "Kursus"
    completed_at_raw = enroll.get("completed_at")
    if completed_at_raw:
        if isinstance(completed_at_raw, str):
            completed_at = completed_at_raw[:10]
        else:
            # datetime object
            completed_at = completed_at_raw.strftime("%Y-%m-%d") if hasattr(completed_at_raw, 'strftime') else "N/A"
    else:
        completed_at = "N/A"
    emp_name = emp.get("name", emp.get("full_name", user.get("name", "Peserta")))

    # Generate PDF
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable
    from io import BytesIO

    buf = BytesIO()
    W, H = landscape(A4)
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4),
                            rightMargin=2*cm, leftMargin=2*cm, topMargin=2*cm, bottomMargin=2*cm)

    styles = getSampleStyleSheet()
    s_center = ParagraphStyle('center', parent=styles['Normal'], alignment=1, spaceAfter=6)
    s_title  = ParagraphStyle('title',  parent=s_center, fontSize=32, textColor=colors.HexColor('#4f46e5'), leading=38)
    s_sub    = ParagraphStyle('sub',    parent=s_center, fontSize=14, textColor=colors.HexColor('#64748b'), leading=18)
    s_name   = ParagraphStyle('name',   parent=s_center, fontSize=26, textColor=colors.HexColor('#1e293b'), leading=32)
    s_course = ParagraphStyle('course', parent=s_center, fontSize=20, textColor=colors.HexColor('#4f46e5'), leading=26)
    s_small  = ParagraphStyle('small',  parent=s_center, fontSize=11, textColor=colors.HexColor('#94a3b8'), leading=14)

    story = [
        Spacer(1, 0.5*cm),
        Paragraph("SERTIFIKAT PENYELESAIAN", s_title),
        Paragraph("CV. DEWI ADITYA", s_sub),
        Spacer(1, 0.6*cm),
        HRFlowable(width="80%", thickness=1, color=colors.HexColor('#e2e8f0'), spaceAfter=0.6*cm),
        Paragraph("Dengan bangga diberikan kepada:", s_small),
        Spacer(1, 0.3*cm),
        Paragraph(f"<b>{emp_name}</b>", s_name),
        Spacer(1, 0.3*cm),
        Paragraph("telah berhasil menyelesaikan kursus:", s_small),
        Spacer(1, 0.3*cm),
        Paragraph(f"<b>{course_title}</b>", s_course),
        Spacer(1, 0.5*cm),
        HRFlowable(width="60%", thickness=1, color=colors.HexColor('#e2e8f0'), spaceAfter=0.5*cm),
        Paragraph(f"Tanggal Selesai: <b>{completed_at}</b>", s_small),
        Spacer(1, 0.4*cm),
        Paragraph("CV. Dewi Aditya — ERP Training & Development", s_small),
    ]
    doc.build(story)
    buf.seek(0)

    safe = f"sertifikat_{emp_name.replace(' ', '_')}_{course_title.replace(' ', '_')[:20]}.pdf"
    from fastapi.responses import StreamingResponse
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={safe}"}
    )


# ══════════════════════════════════════════════════════════════
# NOTIFICATIONS
# ══════════════════════════════════════════════════════════════

@router.get("/notifications")
async def my_notifications(request: Request, skip: int = 0, limit: int = 30):
    user = await require_auth(request)
    db = get_db()
    uid = user["id"]
    role = (user.get("role") or "").lower()

    # Read from unified SSOT `notifications` (type='rahaza') with multi-recipient
    # matching via meta.target_user_ids / meta.target_roles, plus reshape back
    # to the legacy schema for frontend compatibility.
    flt: dict = {
        'type': 'rahaza',
        'meta.dismissed': {'$ne': True},
        '$or': [
            {'meta.target_user_ids': uid},
            {'user_id': uid},
        ],
    }
    if role:
        flt['$or'].append({'meta.target_roles': role})
    if role == 'superadmin':
        # Superadmin sees everything (broadcast)
        flt.pop('$or')
    total = await db.notifications.count_documents(flt)
    cursor = (
        db.notifications.find(flt, {'_id': 0})
        .sort('created_at', -1).skip(skip).limit(limit)
    )
    from utils.notif_unified import reshape_as_rahaza as _reshape_r
    rows = [_reshape_r(d, current_user_id=uid) async for d in cursor]
    unread = sum(1 for r in rows if not r.get("read"))
    return {"total": total, "skip": skip, "limit": limit, "has_more": (skip + limit) < total, "unread": unread, "items": rows}


@router.put("/notifications/{notif_id}/read")
async def mark_read(notif_id: str, request: Request):
    user = await require_auth(request)
    db = get_db()
    uid = user["id"]
    # Multi-recipient rahaza notifs: mark this user's id into meta.read_by[]
    await db.notifications.update_one(
        {"id": notif_id, "type": "rahaza"},
        {
            "$addToSet": {"meta.read_by": uid},
            "$set": {"read_at": _now_iso()},
        },
    )
    return {"ok": True}


# ══════════════════════════════════════════════════════════════
# WORKSPACE — NOTES (Rich text notepad)
# ══════════════════════════════════════════════════════════════

@router.get("/notes")
async def list_notes(request: Request, skip: int = 0, limit: int = 50):
    user = await require_auth(request)
    db = get_db()
    q = {"user_id": user["id"]}
    total = await db.portal_notes.count_documents(q)
    rows = await db.portal_notes.find(q, {"_id": 0}).sort(
        [("is_pinned", -1), ("updated_at", -1)]
    ).skip(skip).limit(limit).to_list(500)
    return {"total": total, "skip": skip, "limit": limit, "has_more": (skip + limit) < total, "items": rows}


@router.post("/notes")
async def create_note(request: Request):
    user = await require_auth(request)
    db = get_db()
    body = await request.json()
    doc = {
        "id": _uid(),
        "user_id": user["id"],
        "title": body.get("title", "Catatan Baru"),
        "content": body.get("content", ""),
        "color": body.get("color", "#ffffff"),
        "is_pinned": body.get("is_pinned", False),
        "tags": body.get("tags", []),
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    await db.portal_notes.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/notes/{note_id}")
async def update_note(note_id: str, request: Request):
    user = await require_auth(request)
    db = get_db()
    note = await db.portal_notes.find_one({"id": note_id, "user_id": user["id"]})
    if not note:
        raise HTTPException(404, "Catatan tidak ditemukan.")
    body = await request.json()
    allowed = ["title", "content", "color", "is_pinned", "tags"]
    upd = {k: v for k, v in body.items() if k in allowed}
    upd["updated_at"] = _now_iso()
    await db.portal_notes.update_one({"id": note_id}, {"$set": upd})
    out = await db.portal_notes.find_one({"id": note_id}, {"_id": 0})
    return serialize_doc(out)


@router.delete("/notes/{note_id}")
async def delete_note(note_id: str, request: Request):
    user = await require_auth(request)
    db = get_db()
    res = await db.portal_notes.delete_one({"id": note_id, "user_id": user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Catatan tidak ditemukan.")
    return {"ok": True}


# ══════════════════════════════════════════════════════════════
# WORKSPACE — TODOS
# ══════════════════════════════════════════════════════════════

@router.get("/todos")
async def list_todos(
    request: Request,
    done: Optional[bool] = None,
    priority: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
):
    user = await require_auth(request)
    db = get_db()
    q = {"user_id": user["id"]}
    if done is not None:
        q["done"] = done
    if priority:
        q["priority"] = priority
    total = await db.portal_todos.count_documents(q)
    rows = await db.portal_todos.find(q, {"_id": 0}).sort(
        [("done", 1), ("priority_order", 1), ("created_at", -1)]
    ).skip(skip).limit(limit).to_list(500)
    return {"total": total, "skip": skip, "limit": limit, "has_more": (skip + limit) < total, "items": rows}


@router.post("/todos")
async def create_todo(request: Request):
    user = await require_auth(request)
    db = get_db()
    body = await request.json()
    title = body.get("title", "").strip()
    if not title:
        raise HTTPException(400, "title wajib diisi.")
    priority = body.get("priority", "medium")
    priority_order = {"high": 1, "medium": 2, "low": 3}.get(priority, 2)
    doc = {
        "id": _uid(),
        "user_id": user["id"],
        "title": title,
        "notes": body.get("notes", ""),
        "done": False,
        "priority": priority,
        "priority_order": priority_order,
        "due_date": body.get("due_date", ""),
        "tags": body.get("tags", []),
        "done_at": None,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    await db.portal_todos.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/todos/{todo_id}")
async def update_todo(todo_id: str, request: Request):
    user = await require_auth(request)
    db = get_db()
    todo = await db.portal_todos.find_one({"id": todo_id, "user_id": user["id"]})
    if not todo:
        raise HTTPException(404, "Todo tidak ditemukan.")
    body = await request.json()
    allowed = ["title", "notes", "done", "priority", "due_date", "tags"]
    upd = {k: v for k, v in body.items() if k in allowed}
    if "priority" in upd:
        upd["priority_order"] = {"high": 1, "medium": 2, "low": 3}.get(upd["priority"], 2)
    if upd.get("done") is True and not todo.get("done"):
        upd["done_at"] = _now_iso()
    elif upd.get("done") is False:
        upd["done_at"] = None
    upd["updated_at"] = _now_iso()
    await db.portal_todos.update_one({"id": todo_id}, {"$set": upd})
    out = await db.portal_todos.find_one({"id": todo_id}, {"_id": 0})
    return serialize_doc(out)


@router.delete("/todos/{todo_id}")
async def delete_todo(todo_id: str, request: Request):
    user = await require_auth(request)
    db = get_db()
    res = await db.portal_todos.delete_one({"id": todo_id, "user_id": user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Todo tidak ditemukan.")
    return {"ok": True}


# ══════════════════════════════════════════════════════════════
# WORKSPACE — REMINDERS
# ══════════════════════════════════════════════════════════════

@router.get("/reminders")
async def list_reminders(request: Request, show_done: bool = False, skip: int = 0, limit: int = 50):
    user = await require_auth(request)
    db = get_db()
    q = {"user_id": user["id"]}
    if not show_done:
        q["is_done"] = False
    total = await db.portal_reminders.count_documents(q)
    rows = await db.portal_reminders.find(q, {"_id": 0}).sort("remind_at", 1).skip(skip).limit(limit).to_list(500)
    return {"total": total, "skip": skip, "limit": limit, "has_more": (skip + limit) < total, "items": rows}


@router.post("/reminders")
async def create_reminder(request: Request):
    user = await require_auth(request)
    db = get_db()
    body = await request.json()
    title = body.get("title", "").strip()
    remind_at = body.get("remind_at", "")
    if not title:
        raise HTTPException(400, "title wajib diisi.")
    doc = {
        "id": _uid(),
        "user_id": user["id"],
        "title": title,
        "description": body.get("description", ""),
        "remind_at": remind_at,
        "recurrence": body.get("recurrence", "once"),  # once/daily/weekly
        "is_done": False,
        "whatsapp_enabled": body.get("whatsapp_enabled", False),
        "whatsapp_number": body.get("whatsapp_number", ""),
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    await db.portal_reminders.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/reminders/{rem_id}")
async def update_reminder(rem_id: str, request: Request):
    user = await require_auth(request)
    db = get_db()
    rem = await db.portal_reminders.find_one({"id": rem_id, "user_id": user["id"]})
    if not rem:
        raise HTTPException(404, "Reminder tidak ditemukan.")
    body = await request.json()
    allowed = ["title", "description", "remind_at", "recurrence", "is_done", "whatsapp_enabled", "whatsapp_number"]
    upd = {k: v for k, v in body.items() if k in allowed}
    upd["updated_at"] = _now_iso()
    await db.portal_reminders.update_one({"id": rem_id}, {"$set": upd})
    out = await db.portal_reminders.find_one({"id": rem_id}, {"_id": 0})
    return serialize_doc(out)


@router.delete("/reminders/{rem_id}")
async def delete_reminder(rem_id: str, request: Request):
    user = await require_auth(request)
    db = get_db()
    res = await db.portal_reminders.delete_one({"id": rem_id, "user_id": user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Reminder tidak ditemukan.")
    return {"ok": True}


@router.get("/reminders/due")
async def get_due_reminders(request: Request):
    """Get reminders that are due (for notification polling)."""
    user = await require_auth(request)
    db = get_db()
    now_iso = _now_iso()
    rows = await db.portal_reminders.find(
        {"user_id": user["id"], "is_done": False, "remind_at": {"$lte": now_iso}},
        {"_id": 0}
    ).to_list(20)
    return {"items": rows}


# ══════════════════════════════════════════════════════════════
# WORKSPACE — QUICK LINKS
# ══════════════════════════════════════════════════════════════

@router.get("/quick-links")
async def list_quick_links(request: Request):
    user = await require_auth(request)
    db = get_db()
    rows = await db.portal_quick_links.find(
        {"user_id": user["id"]}, {"_id": 0}
    ).sort("order_seq", 1).to_list(50)
    return {"total": len(rows), "items": rows}


@router.post("/quick-links")
async def add_quick_link(request: Request):
    user = await require_auth(request)
    db = get_db()
    body = await request.json()
    label = body.get("label", "").strip()
    module_id = body.get("module_id", "").strip()
    if not label or not module_id:
        raise HTTPException(400, "label dan module_id wajib diisi.")
    # Get next order
    max_seq = await db.portal_quick_links.count_documents({"user_id": user["id"]})
    doc = {
        "id": _uid(),
        "user_id": user["id"],
        "module_id": module_id,
        "label": label,
        "icon": body.get("icon", "link"),
        "portal": body.get("portal", ""),
        "order_seq": max_seq,
        "created_at": _now_iso(),
    }
    await db.portal_quick_links.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/quick-links/reorder")
async def reorder_quick_links(request: Request):
    """Receives [{id, order_seq}] and bulk-updates all links for the user."""
    user = await require_auth(request)
    db = get_db()
    body = await request.json()   # list of {id, order_seq}
    items = body if isinstance(body, list) else body.get("items", [])
    for item in items:
        if item.get("id"):
            await db.portal_quick_links.update_one(
                {"id": item["id"], "user_id": user["id"]},
                {"$set": {"order_seq": int(item.get("order_seq", 0))}}
            )
    return {"ok": True, "updated": len(items)}


@router.put("/quick-links/{link_id}")
async def update_quick_link(link_id: str, request: Request):
    user = await require_auth(request)
    db = get_db()
    lnk = await db.portal_quick_links.find_one({"id": link_id, "user_id": user["id"]})
    if not lnk:
        raise HTTPException(404, "Quick link tidak ditemukan.")
    body = await request.json()
    allowed = ["label", "icon", "order_seq"]
    upd = {k: v for k, v in body.items() if k in allowed}
    await db.portal_quick_links.update_one({"id": link_id}, {"$set": upd})
    out = await db.portal_quick_links.find_one({"id": link_id}, {"_id": 0})
    return serialize_doc(out)


@router.delete("/quick-links/{link_id}")
async def delete_quick_link(link_id: str, request: Request):
    user = await require_auth(request)
    db = get_db()
    res = await db.portal_quick_links.delete_one({"id": link_id, "user_id": user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Quick link tidak ditemukan.")
    # Renumber remaining links to keep seq contiguous
    remaining = await db.portal_quick_links.find(
        {"user_id": user["id"]}, {"_id": 0, "id": 1}
    ).sort("order_seq", 1).to_list(50)
    for i, r in enumerate(remaining):
        await db.portal_quick_links.update_one({"id": r["id"]}, {"$set": {"order_seq": i}})
    return {"ok": True}


# ══════════════════════════════════════════════════════════════
# WORKSPACE — CALENDAR EVENTS
# ══════════════════════════════════════════════════════════════

@router.get("/calendar")
async def list_calendar_events(
    request: Request,
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = None,
):
    user = await require_auth(request)
    db = get_db()
    q = {"user_id": user["id"]}
    if from_:
        q["date"] = {"$gte": from_}
    if to:
        q.setdefault("date", {})["$lte"] = to
    rows = await db.portal_calendar_events.find(q, {"_id": 0}).sort("date", 1).to_list(200)
    return {"total": len(rows), "items": rows}


@router.post("/calendar")
async def create_calendar_event(request: Request):
    user = await require_auth(request)
    db = get_db()
    body = await request.json()
    title = body.get("title", "").strip()
    ev_date = body.get("date", "")
    if not title or not ev_date:
        raise HTTPException(400, "title dan date wajib diisi.")
    doc = {
        "id": _uid(),
        "user_id": user["id"],
        "title": title,
        "date": ev_date,
        "end_date": body.get("end_date", ev_date),
        "time": body.get("time", ""),
        "description": body.get("description", ""),
        "color": body.get("color", "#6366f1"),
        "type": "personal",
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    await db.portal_calendar_events.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/calendar/{event_id}")
async def update_calendar_event(event_id: str, request: Request):
    user = await require_auth(request)
    db = get_db()
    ev = await db.portal_calendar_events.find_one({"id": event_id, "user_id": user["id"]})
    if not ev:
        raise HTTPException(404, "Event tidak ditemukan.")
    body = await request.json()
    allowed = ["title", "date", "end_date", "time", "description", "color"]
    upd = {k: v for k, v in body.items() if k in allowed}
    upd["updated_at"] = _now_iso()
    await db.portal_calendar_events.update_one({"id": event_id}, {"$set": upd})
    out = await db.portal_calendar_events.find_one({"id": event_id}, {"_id": 0})
    return serialize_doc(out)


@router.delete("/calendar/{event_id}")
async def delete_calendar_event(event_id: str, request: Request):
    user = await require_auth(request)
    db = get_db()
    res = await db.portal_calendar_events.delete_one({"id": event_id, "user_id": user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Event tidak ditemukan.")
    return {"ok": True}


@router.get("/calendar/combined")
async def combined_calendar(
    request: Request,
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = None,
):
    """Gabungan kalender: personal events + HR (cuti/lembur) + reminders."""
    user = await require_auth(request)
    db = get_db()
    uid = user["id"]
    _, emp = await _get_linked_employee(db, uid)
    emp_id = emp["id"] if emp else None

    if not from_:
        from_ = date.today().replace(day=1).isoformat()
    if not to:
        # last day of month
        m = date.fromisoformat(from_)
        next_m = (m.replace(day=28) + timedelta(days=4)).replace(day=1)
        to = (next_m - timedelta(days=1)).isoformat()

    events = []

    # 1. Personal events
    p_events = await db.portal_calendar_events.find(
        {"user_id": uid, "date": {"$gte": from_, "$lte": to}}, {"_id": 0}
    ).to_list(200)
    events.extend(p_events)

    # 2. Reminders as events
    rems = await db.portal_reminders.find(
        {"user_id": uid, "is_done": False,
         "remind_at": {"$gte": from_ + "T00:00:00", "$lte": to + "T23:59:59"}},
        {"_id": 0}
    ).to_list(50)
    for r in rems:
        events.append({
            "id": r["id"],
            "title": f"Reminder: {r['title']}",
            "date": r.get("remind_at", "")[:10],
            "time": r.get("remind_at", "")[11:16],
            "color": "#f59e0b",
            "type": "reminder",
            "source": r,
        })

    # 3. Leave requests
    if emp_id:
        leaves = await db.rahaza_leave_requests.find(
            {"employee_id": emp_id,
             "status": {"$in": ["approved", "pending"]},
             "from_date": {"$lte": to},
             "to_date": {"$gte": from_}},
            {"_id": 0}
        ).to_list(50)
        for lv in leaves:
            color = "#22c55e" if lv.get("status") == "approved" else "#f59e0b"
            events.append({
                "id": lv["id"],
                "title": f"{lv.get('leave_type_name', 'Cuti')}: {lv.get('status', '')}",
                "date": lv.get("from_date", ""),
                "end_date": lv.get("to_date", lv.get("from_date", "")),
                "color": color,
                "type": "leave",
                "source": lv,
            })

    # 4. Overtime
    if emp_id:
        ots = await db.rahaza_overtime_requests.find(
            {"employee_id": emp_id,
             "date": {"$gte": from_, "$lte": to}},
            {"_id": 0}
        ).to_list(50)
        for ot in ots:
            events.append({
                "id": ot["id"],
                "title": f"Lembur ({ot.get('hours', 0)}j)",
                "date": ot.get("date", ""),
                "color": "#8b5cf6",
                "type": "overtime",
                "source": ot,
            })

    events.sort(key=lambda e: e.get("date", ""))
    return {"from": from_, "to": to, "total": len(events), "events": events}
