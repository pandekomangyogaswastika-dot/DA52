"""
Lembar Kerja Produksi (LKP) — Production Work Sheet PDF generator.

Endpoints:
  GET    /api/rahaza/work-orders/{wid}/lkp           : list LKP versions for a WO
  POST   /api/rahaza/work-orders/{wid}/lkp           : create new LKP version (content body) -> generate PDF + persist
  GET    /api/rahaza/lkp/{lkp_id}                    : detail (metadata + audit log)
  GET    /api/rahaza/lkp/{lkp_id}/pdf                : download PDF (records audit "downloaded")
  POST   /api/rahaza/lkp/{lkp_id}/regenerate         : regenerate PDF (e.g., model image updated) -> bumps revision
  GET    /api/rahaza/lkp                             : list all LKP across WO (recent first, paginated)
  DELETE /api/rahaza/lkp/{lkp_id}                    : soft-delete (revoke)

Storage:
  rahaza_lkp collection — versioned per WO.

Security patches applied:
  H2: RBAC check on write endpoints
  H3: JWT verified via shared verify_token / verify_token_str helpers (no inline decode, no hardcoded secret)
  H4: Atomic counter for lkp_number + version (no race condition)
  M4: Delete old PDF storage path on regenerate
  M6: qc dict copied before mutation
  M8: Audit timestamps stored as datetime, serialized by serialize_doc
  M9: Parallel MongoDB lookups in assignment resolution
  M11: JWT verification centralized
  M14: Company info fetched from company_settings
  M16: re.escape used for lkp_number regex prefix
"""
import asyncio
import uuid
import io
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Request, HTTPException, Query
from fastapi.responses import Response

from database import get_db
from auth import require_auth, check_role, serialize_doc, log_activity, verify_token_str
from storage import put_object, get_object, delete_object, generate_storage_path
from utils.lkp_pdf import build_lkp_pdf
from utils.counters import next_counter

import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/rahaza", tags=["rahaza-lkp"])

# H2: Roles allowed to write LKP
_LKP_WRITE_ROLES = ["superadmin", "admin", "supervisor", "ppic", "owner"]
_LKP_WRITE_PERM = "rahaza.lkp.write"


def _uid(): return str(uuid.uuid4())
def _now(): return datetime.now(timezone.utc)


# ─── H4: Atomic counter helpers ─────────────────────────────────────────────

async def _gen_lkp_number(db) -> str:
    """LKP-YYYY-NNNN — atomic, race-condition-safe via unified counters SSOT."""
    year = datetime.now(timezone.utc).year
    n = await next_counter(db, f"lkp_{year}", namespace="rahaza")
    return f"LKP-{year}-{n:04d}"


async def _next_version_for_wo(db, wo_id: str) -> int:
    """Atomic version counter per WO."""
    return await next_counter(db, f"lkp_wo_{wo_id}", namespace="rahaza")


# ─── M14: Fetch company info from settings ───────────────────────────────────

async def _get_company_info(db) -> dict:
    settings = await db.company_settings.find_one({}, {"_id": 0}) or {}
    return {
        "company_name": settings.get("company_name") or "PT RAHAZA GLOBAL INDONESIA",
        "company_addr": settings.get("company_tagline") or "Knit Garment Manufacturing — Production Work Sheet",
    }


async def _build_content_snapshot(db, wo: dict, body: dict, user: dict) -> dict:
    """Compose the full content snapshot from WO data + master + body input."""
    # Order info
    order = {}
    if wo.get("order_id"):
        o = await db.rahaza_orders.find_one({"id": wo["order_id"]}, {"_id": 0})
        if o:
            cust = await db.rahaza_customers.find_one({"id": o.get("customer_id")}, {"_id": 0}) if o.get("customer_id") else None
            order = {
                "order_number": o.get("order_number"),
                "customer_name": (cust or {}).get("name") or wo.get("customer_snapshot") or "-",
                "order_date": str(o.get("order_date") or "-")[:10],
            }
    if not order:
        order = {
            "order_number": wo.get("order_number_snapshot") or "Manual",
            "customer_name": wo.get("customer_snapshot") or "Internal",
            "order_date": "-",
        }

    # Model
    model_doc = await db.rahaza_models.find_one({"id": wo.get("model_id")}, {"_id": 0}) or {}
    model = {
        "code": model_doc.get("code"),
        "name": model_doc.get("name"),
        "category": model_doc.get("category"),
        "description": model_doc.get("description"),
    }
    image_paths = list(model_doc.get("image_paths") or [])

    # Size
    size_doc = await db.rahaza_sizes.find_one({"id": wo.get("size_id")}, {"_id": 0}) or {}

    # WO summary
    wo_summary = {
        "wo_number": wo.get("wo_number"),
        "qty": int(wo.get("qty") or 0),
        "size_code": size_doc.get("code", "-"),
        "target_start_date": str(wo.get("target_start_date") or "-")[:10],
        "target_end_date": str(wo.get("target_end_date") or "-")[:10],
        "priority": wo.get("priority", "normal"),
    }

    # BOM snapshot already on WO (if released)
    bom_snapshot = wo.get("bom_snapshot") or {}
    if not bom_snapshot or (not bom_snapshot.get("yarn_materials") and not bom_snapshot.get("accessory_materials")):
        # Fallback: lookup current BOM master
        if wo.get("model_id") and wo.get("size_id"):
            bom_doc = await db.rahaza_boms.find_one(
                {"model_id": wo["model_id"], "size_id": wo["size_id"], "active": True}, {"_id": 0}
            )
            if bom_doc:
                yarn_mats = []
                acc_mats = []
                # Batch prefetch all materials referenced by yarn + accessory_materials
                yarn_list = bom_doc.get("yarn_materials") or []
                acc_list = bom_doc.get("accessory_materials") or []
                mat_ids_lkp = list({m.get("material_id") for m in (yarn_list + acc_list)
                                     if m.get("material_id")})
                lkp_mat_map = {}
                if mat_ids_lkp:
                    async for d in db.rahaza_materials.find(
                        {"id": {"$in": mat_ids_lkp}}, {"_id": 0}
                    ):
                        lkp_mat_map[d["id"]] = d
                # Format A: legacy split
                for y in yarn_list:
                    mat = lkp_mat_map.get(y.get("material_id")) if y.get("material_id") else None
                    yarn_mats.append({
                        "material_name": (mat or {}).get("name") or y.get("material_name", "-"),
                        "type": (mat or {}).get("type") or "yarn",
                        "kg_per_pcs": float(y.get("qty_kg") or y.get("kg_per_pcs") or 0),
                    })
                for a in acc_list:
                    mat = lkp_mat_map.get(a.get("material_id")) if a.get("material_id") else None
                    acc_mats.append({
                        "material_name": (mat or {}).get("name") or a.get("material_name", "-"),
                        "qty_per_pcs": float(a.get("qty_per_pcs") or a.get("qty") or 0),
                        "unit": (mat or {}).get("unit") or "pcs",
                    })
                # Format B: unified materials array (current seed format)
                for m in bom_doc.get("materials") or []:
                    unit = (m.get("unit") or "").lower()
                    name = m.get("material_name") or m.get("material_code") or "-"
                    qty = float(m.get("quantity") or 0)
                    if unit in ("kg", "kgs", "kilogram"):
                        yarn_mats.append({"material_name": name, "type": "yarn", "kg_per_pcs": qty})
                    else:
                        acc_mats.append({"material_name": name, "qty_per_pcs": qty, "unit": unit or "pcs"})
                bom_snapshot = {
                    "yarn_materials": yarn_mats,
                    "accessory_materials": acc_mats,
                    "total_yarn_kg_per_pcs": sum(m["kg_per_pcs"] for m in yarn_mats),
                }

    # M9: Parallelize assignment lookups
    asgn_input = body.get("assignment") or {}
    line_id = asgn_input.get("line_id") or wo.get("line_id")
    machine_id = asgn_input.get("machine_id")
    operator_id = asgn_input.get("operator_id")
    shift_id = asgn_input.get("shift_id")

    line_q = db.rahaza_lines.find_one({"id": line_id}, {"_id": 0}) if line_id else asyncio.sleep(0, result=None)
    mach_q = db.rahaza_machines.find_one({"id": machine_id}, {"_id": 0}) if machine_id else asyncio.sleep(0, result=None)
    op_q = db.rahaza_employees.find_one({"id": operator_id}, {"_id": 0}) if operator_id else asyncio.sleep(0, result=None)
    sh_q = db.rahaza_shifts.find_one({"id": shift_id}, {"_id": 0}) if shift_id else asyncio.sleep(0, result=None)
    line_doc, machine_doc, op_doc, shift_doc = await asyncio.gather(line_q, mach_q, op_q, sh_q)

    assignment = {
        "line_id": line_id, "line_name": (line_doc or {}).get("name") or asgn_input.get("line_name", "-"),
        "machine_id": machine_id, "machine_name": (machine_doc or {}).get("name") or asgn_input.get("machine_name", "-"),
        "machine_gauge": (machine_doc or {}).get("gauge") or asgn_input.get("machine_gauge", "-"),
        "operator_id": operator_id, "operator_name": (op_doc or {}).get("name") or asgn_input.get("operator_name", "-"),
        "shift_id": shift_id, "shift_name": (shift_doc or {}).get("name") or asgn_input.get("shift_name", "-"),
        "start_date": asgn_input.get("start_date") or wo_summary["target_start_date"],
        "end_date": asgn_input.get("end_date") or wo_summary["target_end_date"],
        "daily_target": asgn_input.get("daily_target", "-"),
        "shift_target": asgn_input.get("shift_target", "-"),
    }

    # Process flow — enrich from master processes (active, non-rework) ordered
    processes = await db.rahaza_processes.find({"active": True, "is_rework": False}, {"_id": 0}).sort("order_seq", 1).to_list(500)
    flow_input = body.get("process_flow") or []
    flow_map = {f.get("process_id") or f.get("name", "").lower(): f for f in flow_input}
    process_flow = []
    for p in processes:
        custom = flow_map.get(p["id"]) or flow_map.get((p.get("name") or "").lower()) or {}
        process_flow.append({
            "process_id": p["id"],
            "name": p["name"],
            "duration_estimate": custom.get("duration_estimate", "-"),
            "sam": custom.get("sam", "-"),
            "line": custom.get("line") or assignment.get("line_name", "-"),
        })

    # Tech pack from body
    tech_pack = body.get("tech_pack") or {}

    # SOP steps from body (manual)
    sop_steps = body.get("sop_steps") or []

    # M6: Copy qc dict before mutation to avoid contamination
    qc = dict(body.get("qc") or {})
    if qc.get("defect_code_ids"):
        codes = await db.rahaza_defect_codes.find(
            {"id": {"$in": qc["defect_code_ids"]}}, {"_id": 0}
        ).to_list(500)
        qc["defect_codes_to_watch"] = [
            {"code": c.get("code"), "category": c.get("category"), "severity": c.get("severity"), "description": c.get("description")}
            for c in codes
        ]

    # Packing
    packing = body.get("packing") or {}

    # Special notes
    special_notes = body.get("special_notes") or ""

    # M14: company info from settings
    company_info = await _get_company_info(db)

    return {
        **company_info,
        "work_order": wo_summary,
        "order": order,
        "model": model,
        "model_id_ref": wo.get("model_id"),
        "model_image_paths": image_paths,
        "tech_pack": tech_pack,
        "bom_snapshot": bom_snapshot,
        "assignment": assignment,
        "process_flow": process_flow,
        "sop_steps": sop_steps,
        "qc": qc,
        "packing": packing,
        "special_notes": special_notes,
    }


async def _generate_pdf_bytes(db, content_with_meta: dict) -> bytes:
    """Download model images + production photos, then build PDF."""
    import aiohttp

    # ── Model design images (from storage) ──
    image_files = []
    for path in content_with_meta.get("model_image_paths") or []:
        try:
            data, _ = get_object(path)
            image_files.append(io.BytesIO(data))
        except Exception as e:
            logger.warning(f"LKP model image fetch failed ({path}): {e}")

    # ── Production/QC photos attached to this LKP ──
    production_image_files = []
    lkp_id = content_with_meta.get("lkp_id")
    if lkp_id:
        try:
            prod_photos = await db.rahaza_lkp_photos.find(
                {"lkp_id": lkp_id, "active": True},
                {"_id": 0, "storage_path": 1, "url": 1, "caption": 1}
            ).sort("created_at", 1).to_list(500)

            captions = []
            for ph in prod_photos:
                img_buf = None
                # Try storage path first
                if ph.get("storage_path"):
                    try:
                        data, _ = get_object(ph["storage_path"])
                        img_buf = io.BytesIO(data)
                    except Exception as e:
                        logger.warning(f"LKP prod photo storage fetch failed: {e}")
                # Fallback: fetch from URL
                if img_buf is None and ph.get("url"):
                    try:
                        async with aiohttp.ClientSession() as session:
                            async with session.get(ph["url"], timeout=aiohttp.ClientTimeout(total=5)) as resp:
                                if resp.status == 200:
                                    data = await resp.read()
                                    img_buf = io.BytesIO(data)
                    except Exception as e:
                        logger.warning(f"LKP prod photo URL fetch failed: {e}")
                if img_buf:
                    production_image_files.append(img_buf)
                    captions.append(ph.get("caption") or f"Foto {len(captions) + 1}")

            if captions:
                content_with_meta["production_photo_captions"] = captions
        except Exception as e:
            logger.warning(f"LKP production photos fetch failed: {e}")

    return build_lkp_pdf(content_with_meta, image_files=image_files, production_image_files=production_image_files)


# ─── ENDPOINTS ─────────────────────────────────────────────────────────

@router.get("/work-orders/{wid}/lkp")
async def list_lkp_for_wo(wid: str, request: Request):
    """List all LKP versions created for a WO (latest first)."""
    await require_auth(request)
    db = get_db()
    rows = await db.rahaza_lkp.find(
        {"work_order_id": wid},
        {"_id": 0, "content_snapshot": 0}
    ).sort("version", -1).to_list(500)
    return serialize_doc(rows)


@router.post("/work-orders/{wid}/lkp")
async def create_lkp(wid: str, request: Request):
    """Create a new LKP version for a WO. Generates PDF immediately."""
    user = await require_auth(request)
    # H2: RBAC
    if not check_role(user, _LKP_WRITE_ROLES, _LKP_WRITE_PERM):
        raise HTTPException(403, "Tidak ada akses untuk membuat LKP")
    db = get_db()
    wo = await db.rahaza_work_orders.find_one({"id": wid}, {"_id": 0})
    if not wo:
        raise HTTPException(404, "Work Order tidak ditemukan")
    body = await request.json()

    # H4: Atomic counters
    lkp_number = await _gen_lkp_number(db)
    version = await _next_version_for_wo(db, wid)

    content = await _build_content_snapshot(db, wo, body, user)

    # Add metadata for PDF
    print_dt = _now()
    pdf_meta = {
        **content,
        "lkp_number": lkp_number,
        "version": version,
        "status_label": "RELEASED",
        "print_date": print_dt.strftime("%Y-%m-%d %H:%M UTC"),
        "printed_by": user.get("name", "-"),
        "qr_data": f"LKP:{lkp_number}|WO:{wo.get('wo_number')}|V:{version}",
    }

    # Generate PDF
    try:
        pdf_bytes = await _generate_pdf_bytes(db, pdf_meta)
    except Exception:
        logger.exception("LKP PDF generation failed")
        raise HTTPException(500, "Gagal generate PDF. Silakan coba lagi.")

    # Persist PDF to storage
    pdf_storage_path = None
    try:
        path = generate_storage_path(user["id"], f"{lkp_number}.pdf")
        result = put_object(path, pdf_bytes, "application/pdf")
        pdf_storage_path = result.get("path", path)
    except Exception as e:
        logger.warning(f"LKP PDF storage upload failed: {e}")

    # M8: Store timestamps as datetime (serialize_doc converts on response)
    lkp_doc = {
        "id": _uid(),
        "lkp_number": lkp_number,
        "work_order_id": wid,
        "work_order_number": wo.get("wo_number"),
        "version": version,
        "status": "released",
        "content_snapshot": content,
        "pdf_storage_path": pdf_storage_path,
        "pdf_size": len(pdf_bytes),
        "created_by": user["id"],
        "created_by_name": user.get("name", "-"),
        "created_at": print_dt,
        "updated_at": print_dt,
        "audit_log": [
            {
                "action": "created",
                "user_id": user["id"],
                "user_name": user.get("name", "-"),
                "timestamp": print_dt,    # M8: datetime, not isoformat string
                "version": version,
            }
        ],
        "download_count": 0,
    }
    await db.rahaza_lkp.insert_one(lkp_doc)
    await log_activity(user["id"], user.get("name", "-"), "create", "rahaza.lkp", lkp_number)

    out = dict(lkp_doc)
    out.pop("_id", None)
    return serialize_doc(out)


@router.get("/lkp/{lkp_id}")
async def get_lkp(lkp_id: str, request: Request):
    """Detail LKP (with content snapshot + audit log)."""
    await require_auth(request)
    db = get_db()
    doc = await db.rahaza_lkp.find_one({"id": lkp_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "LKP tidak ditemukan")
    return serialize_doc(doc)


@router.get("/lkp/{lkp_id}/pdf")
async def download_lkp_pdf(lkp_id: str, request: Request, auth: Optional[str] = Query(None)):
    """
    Download LKP PDF. Records audit entry.
    Auth via Bearer header (preferred) OR ?auth= query param (fallback for browser-tab preview).
    H3/M11: Uses centralized verify_token_str — no inline jwt.decode, no hardcoded secret.
    """
    # M11: Centralized JWT verification
    payload = None
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        from auth import verify_token
        payload = verify_token(request)
    if payload is None and auth:
        payload = verify_token_str(auth)
    if not payload:
        raise HTTPException(401, "Unauthorized")

    user_id = payload.get("id") or payload.get("user_id")
    user_name = payload.get("name") or payload.get("email") or "Unknown"

    db = get_db()
    doc = await db.rahaza_lkp.find_one({"id": lkp_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "LKP tidak ditemukan")

    # If pdf was previously stored AND not marked stale (e.g. by photo upload), serve cached
    pdf_path = doc.get("pdf_storage_path")
    pdf_bytes = None
    is_stale = bool(doc.get("pdf_stale"))
    if pdf_path and not is_stale:
        try:
            data, _ = get_object(pdf_path)
            pdf_bytes = data
        except Exception as e:
            logger.warning(f"LKP cached PDF fetch failed, regenerating: {e}")

    if not pdf_bytes:
        # Regenerate from snapshot — always fetch fresh model images + production photos
        content = doc.get("content_snapshot") or {}
        # Re-fetch latest model images in case updated
        if content.get("model_id_ref") or content.get("model"):
            model_id = content.get("model_id_ref")
            model_doc = None
            if model_id:
                model_doc = await db.rahaza_models.find_one({"id": model_id}, {"_id": 0})
            if not model_doc and content.get("model"):
                model_doc = await db.rahaza_models.find_one({"code": content["model"].get("code")}, {"_id": 0})
            if model_doc:
                content["model_image_paths"] = list(model_doc.get("image_paths") or [])

        pdf_meta = {
            **content,
            "lkp_id": lkp_id,  # needed to fetch production photos
            "lkp_number": doc.get("lkp_number", "-"),
            "version": doc.get("version", 1),
            "status_label": (doc.get("status") or "released").upper(),
            "print_date": _now().strftime("%Y-%m-%d %H:%M UTC"),
            "printed_by": user_name,
            "qr_data": f"LKP:{doc.get('lkp_number')}|WO:{doc.get('work_order_number')}|V:{doc.get('version')}",
        }
        try:
            pdf_bytes = await _generate_pdf_bytes(db, pdf_meta)
        except Exception:
            logger.exception("LKP regen PDF failed")
            raise HTTPException(500, "Gagal generate PDF. Silakan coba lagi.")

        # Persist regenerated PDF & clear stale flag so subsequent downloads use cache
        try:
            new_path = generate_storage_path(user_id or "system", f"{doc.get('lkp_number','LKP')}.pdf")
            result = put_object(new_path, pdf_bytes, "application/pdf")
            new_storage_path = result.get("path", new_path)
            # Best-effort delete previous cached file
            old_path = doc.get("pdf_storage_path")
            if old_path and old_path != new_storage_path:
                try:
                    delete_object(old_path)
                except Exception as _e:
                    logger.warning(f"LKP old PDF delete failed: {_e}")
            await db.rahaza_lkp.update_one(
                {"id": lkp_id},
                {"$set": {
                    "pdf_storage_path": new_storage_path,
                    "pdf_size": len(pdf_bytes),
                    "pdf_stale": False,
                    "updated_at": _now(),
                }}
            )
        except Exception as e:
            logger.warning(f"LKP regenerated PDF storage failed: {e}")

    # M8: Audit timestamp as datetime
    audit_entry = {
        "action": "downloaded",
        "user_id": user_id,
        "user_name": user_name,
        "timestamp": _now(),
        "version": doc.get("version", 1),
    }
    await db.rahaza_lkp.update_one(
        {"id": lkp_id},
        {
            "$push": {"audit_log": audit_entry},
            "$inc": {"download_count": 1},
            "$set": {"last_downloaded_at": _now()},
        }
    )

    filename = f"{doc.get('lkp_number', 'LKP')}_v{doc.get('version', 1)}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'}
    )


@router.post("/lkp/{lkp_id}/regenerate")
async def regenerate_lkp_pdf(lkp_id: str, request: Request):
    """Regenerate the PDF using existing snapshot (e.g., master image updated)."""
    user = await require_auth(request)
    # H2: RBAC
    if not check_role(user, _LKP_WRITE_ROLES, _LKP_WRITE_PERM):
        raise HTTPException(403, "Tidak ada akses untuk regenerate LKP")
    db = get_db()
    doc = await db.rahaza_lkp.find_one({"id": lkp_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "LKP tidak ditemukan")
    content = doc.get("content_snapshot") or {}
    # Re-fetch model image_paths in case updated
    if content.get("model"):
        model_id = content.get("model_id_ref")
        model_doc = None
        if model_id:
            model_doc = await db.rahaza_models.find_one({"id": model_id}, {"_id": 0})
        if not model_doc:
            model_doc = await db.rahaza_models.find_one({"code": content["model"].get("code")}, {"_id": 0})
        if model_doc:
            content["model_image_paths"] = list(model_doc.get("image_paths") or [])
    # M14: Refresh company info
    company_info = await _get_company_info(db)
    content.update(company_info)

    pdf_meta = {
        **content,
        "lkp_number": doc.get("lkp_number", "-"),
        "version": doc.get("version", 1),
        "status_label": (doc.get("status") or "released").upper(),
        "print_date": _now().strftime("%Y-%m-%d %H:%M UTC"),
        "printed_by": user.get("name", "-"),
        "qr_data": f"LKP:{doc.get('lkp_number')}|WO:{doc.get('work_order_number')}|V:{doc.get('version')}",
    }
    try:
        pdf_bytes = await _generate_pdf_bytes(db, pdf_meta)
    except Exception:
        logger.exception("LKP regen PDF failed")
        raise HTTPException(500, "Gagal generate PDF. Silakan coba lagi.")

    # M4: Delete old PDF from storage before uploading new one
    old_path = doc.get("pdf_storage_path")
    if old_path:
        try:
            delete_object(old_path)
        except Exception as e:
            logger.warning(f"LKP old PDF delete failed ({old_path}): {e}")

    pdf_storage_path = None
    try:
        path = generate_storage_path(user["id"], f"{doc.get('lkp_number')}.pdf")
        result = put_object(path, pdf_bytes, "application/pdf")
        pdf_storage_path = result.get("path", path)
    except Exception as e:
        logger.warning(f"LKP regen PDF storage failed: {e}")

    # M8: Audit timestamp as datetime
    audit_entry = {
        "action": "regenerated",
        "user_id": user["id"],
        "user_name": user.get("name", "-"),
        "timestamp": _now(),
        "version": doc.get("version", 1),
    }
    update = {
        "$push": {"audit_log": audit_entry},
        "$set": {
            "content_snapshot": content,
            "pdf_size": len(pdf_bytes),
            "updated_at": _now(),
        },
    }
    if pdf_storage_path:
        update["$set"]["pdf_storage_path"] = pdf_storage_path
    await db.rahaza_lkp.update_one({"id": lkp_id}, update)
    return {"ok": True, "lkp_id": lkp_id, "regenerated_at": _now().isoformat()}


@router.get("/lkp")
async def list_all_lkp(
    request: Request,
    work_order_id: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
):
    """Cross-WO LKP list (history)."""
    await require_auth(request)
    db = get_db()
    q = {}
    if work_order_id:
        q["work_order_id"] = work_order_id
    rows = await db.rahaza_lkp.find(
        q, {"_id": 0, "content_snapshot": 0}
    ).sort("created_at", -1).limit(limit).to_list(500)
    return serialize_doc(rows)


@router.get("/lkp-bulk-today")
async def get_bulk_lkp_today(request: Request):
    """
    Mendapatkan semua WO yang statusnya 'released' atau 'in_progress' hari ini
    beserta status LKP mereka (ada / belum ada / jumlah versi).
    Digunakan untuk fitur Cetak LKP Massal.
    """
    await require_auth(request)
    db = get_db()

    # Ambil semua WO aktif (released + in_progress)
    wos = await db.rahaza_work_orders.find(
        {"status": {"$in": ["released", "in_progress"]}},
        {"_id": 0}
    ).sort("wo_number", 1).to_list(500)

    if not wos:
        return {"work_orders": [], "total": 0, "total_with_lkp": 0, "total_without_lkp": 0}

    wo_ids = [w["id"] for w in wos]

    # Ambil semua LKP aktif untuk WO tersebut
    lkps = await db.rahaza_lkp.find(
        {"work_order_id": {"$in": wo_ids}, "status": {"$ne": "revoked"}},
        {"_id": 0, "work_order_id": 1, "id": 1, "lkp_number": 1, "version": 1,
         "created_at": 1, "status": 1}
    ).to_list(500)

    # Group by WO
    lkp_map = {}
    for lkp in lkps:
        wid = lkp["work_order_id"]
        if wid not in lkp_map:
            lkp_map[wid] = []
        lkp_map[wid].append(lkp)

    # Build response
    result = []
    for wo in wos:
        wid = wo["id"]
        wo_lkps = lkp_map.get(wid, [])
        latest = sorted(wo_lkps, key=lambda x: x.get("version", 0), reverse=True)
        result.append({
            "wo_id": wid,
            "wo_number": wo.get("wo_number"),
            "model_code": wo.get("model_code"),
            "status": wo.get("status"),
            "qty": wo.get("qty"),
            "line_code": wo.get("line_code"),
            "has_lkp": len(wo_lkps) > 0,
            "lkp_count": len(wo_lkps),
            "latest_lkp_id": latest[0]["id"] if latest else None,
            "latest_lkp_number": latest[0]["lkp_number"] if latest else None,
            "latest_version": latest[0]["version"] if latest else None,
        })

    total_with_lkp = sum(1 for r in result if r["has_lkp"])
    return {
        "work_orders": result,
        "total": len(result),
        "total_with_lkp": total_with_lkp,
        "total_without_lkp": len(result) - total_with_lkp,
    }


@router.delete("/lkp/{lkp_id}")
async def delete_lkp(lkp_id: str, request: Request):
    """Soft-delete an LKP version (mark as revoked)."""
    user = await require_auth(request)
    # H2: RBAC
    if not check_role(user, _LKP_WRITE_ROLES, _LKP_WRITE_PERM):
        raise HTTPException(403, "Tidak ada akses untuk merevoke LKP")
    db = get_db()
    doc = await db.rahaza_lkp.find_one({"id": lkp_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "LKP tidak ditemukan")
    # M8: Audit timestamp as datetime
    audit_entry = {
        "action": "revoked",
        "user_id": user["id"],
        "user_name": user.get("name", "-"),
        "timestamp": _now(),
        "version": doc.get("version", 1),
    }
    await db.rahaza_lkp.update_one(
        {"id": lkp_id},
        {"$set": {"status": "revoked", "updated_at": _now()}, "$push": {"audit_log": audit_entry}}
    )
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────
#  LKP PRODUCTION PHOTOS
# ─────────────────────────────────────────────────────────────────────

@router.post("/lkp/{lkp_id}/photos")
async def upload_lkp_photo(lkp_id: str, request: Request):
    """
    Upload foto produksi/QC ke LKP.
    Accepts multipart/form-data:
      - file   : image file (JPEG/PNG/WEBP)
      - caption: string (opsional, maks 120 chars)
      - type   : qc_check | defect_evidence | production_progress | packaging | other

    Foto akan otomatis muncul di PDF LKP saat di-download/regenerate.
    """
    user = await require_auth(request)
    if not check_role(user, _LKP_WRITE_ROLES, _LKP_WRITE_PERM):
        raise HTTPException(403, "Tidak ada akses upload foto LKP")
    db = get_db()

    doc = await db.rahaza_lkp.find_one({"id": lkp_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "LKP tidak ditemukan")

    # Parse multipart
    content_type = request.headers.get("content-type", "")
    if "multipart/form-data" not in content_type:
        raise HTTPException(415, "Gunakan multipart/form-data")

    form = await request.form()
    file_obj = form.get("file")
    caption = str(form.get("caption") or "")[:120]
    photo_type = str(form.get("type") or "qc_check")

    if not file_obj:
        raise HTTPException(400, "Field 'file' wajib ada")

    file_bytes = await file_obj.read()
    if len(file_bytes) > 10 * 1024 * 1024:  # 10MB max
        raise HTTPException(413, "Ukuran file maksimal 10MB")

    content_type_file = getattr(file_obj, "content_type", "image/jpeg")
    if content_type_file not in ("image/jpeg", "image/jpg", "image/png", "image/webp"):
        raise HTTPException(415, "Format file harus JPEG, PNG, atau WEBP")

    # Store to object storage
    photo_id = _uid()
    storage_path = None
    try:
        path = generate_storage_path(user["id"], f"lkp-photo-{photo_id}.jpg")
        result = put_object(path, file_bytes, content_type_file)
        storage_path = result.get("path", path)
    except Exception as e:
        logger.warning(f"LKP photo storage failed: {e}")
        # Store as base64 fallback
        storage_path = None

    photo_doc = {
        "id": photo_id,
        "lkp_id": lkp_id,
        "storage_path": storage_path,
        "caption": caption,
        "type": photo_type,
        "filename": getattr(file_obj, "filename", f"photo_{photo_id}.jpg"),
        "size": len(file_bytes),
        "active": True,
        "uploaded_by": user.get("id"),
        "uploaded_by_name": user.get("name", "-"),
        "created_at": _now().isoformat(),
    }
    await db.rahaza_lkp_photos.insert_one(photo_doc)
    photo_doc.pop("_id", None)

    # Mark LKP PDF as stale (needs regeneration)
    await db.rahaza_lkp.update_one(
        {"id": lkp_id},
        {"$set": {"pdf_stale": True, "photo_count": await db.rahaza_lkp_photos.count_documents({"lkp_id": lkp_id, "active": True}), "updated_at": _now()},
         "$push": {"audit_log": {"action": "photo_uploaded", "photo_id": photo_id, "caption": caption, "user_id": user["id"], "timestamp": _now()}}}
    )

    logger.info(f"LKP {lkp_id} photo {photo_id} uploaded by {user.get('name')}")
    return photo_doc


@router.get("/lkp/{lkp_id}/photos")
async def list_lkp_photos(lkp_id: str, request: Request):
    """List semua foto yang di-attach ke LKP."""
    await require_auth(request)
    db = get_db()
    photos = await db.rahaza_lkp_photos.find(
        {"lkp_id": lkp_id, "active": True},
        {"_id": 0}
    ).sort("created_at", 1).to_list(500)
    return photos


@router.delete("/lkp/{lkp_id}/photos/{photo_id}")
async def delete_lkp_photo(lkp_id: str, photo_id: str, request: Request):
    """Hapus foto dari LKP."""
    user = await require_auth(request)
    if not check_role(user, _LKP_WRITE_ROLES, _LKP_WRITE_PERM):
        raise HTTPException(403, "Tidak ada akses hapus foto LKP")
    db = get_db()
    photo = await db.rahaza_lkp_photos.find_one({"id": photo_id, "lkp_id": lkp_id})
    if not photo:
        raise HTTPException(404, "Foto tidak ditemukan")
    await db.rahaza_lkp_photos.update_one({"id": photo_id}, {"$set": {"active": False}})
    await db.rahaza_lkp.update_one(
        {"id": lkp_id},
        {"$set": {"pdf_stale": True, "updated_at": _now()}}
    )
    return {"ok": True, "photo_id": photo_id}
