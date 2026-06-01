"""
PT Rahaza Global Indonesia — Production Execution (Fase 4+)

Endpoints (all under /api/rahaza):
  - /models             : Model produk (Sweater V-Neck, dsb)  [CRUD]
  - /sizes              : Size (S/M/L/XL)                     [CRUD]
  - /line-assignments   : Assign operator+shift+target ke Line [CRUD]
  - /wip/events         : WIP event ledger (POST to record; GET to query)
  - /wip/summary        : Aggregated WIP per proses (computed)

WIP semantics (MVP):
  - Event type 'output' = operator line menghasilkan X pcs pada proses P
  - WIP di proses P = Σ output(P) − Σ output(next_of_P)
  - Urutan proses ditentukan oleh field `order_seq` pada rahaza_processes
  - Proses rework (is_rework=True) diperlakukan sebagai side-stream untuk
    perhitungan lanjut (akan diperluas di Fase 6).
"""
# ruff: noqa: E741
from fastapi import APIRouter, Request, HTTPException, UploadFile, File
from database import get_db
from auth import require_auth, serialize_doc, log_activity
from storage import put_object, delete_object, generate_storage_path
import uuid
import io
from datetime import datetime, timezone, date
from typing import Optional

router = APIRouter(prefix="/api/rahaza", tags=["rahaza-production"])


def _uid(): return str(uuid.uuid4())
def _now(): return datetime.now(timezone.utc)


# ── Seed defaults for sizes ─────────────────────────────────────────────────
DEFAULT_SIZES = [
    {"code": "S",   "name": "S",   "order_seq": 1},
    {"code": "M",   "name": "M",   "order_seq": 2},
    {"code": "L",   "name": "L",   "order_seq": 3},
    {"code": "XL",  "name": "XL",  "order_seq": 4},
    {"code": "XXL", "name": "XXL", "order_seq": 5},
]


async def seed_rahaza_production_data():
    db = get_db()
    seeded_size = 0
    size_codes = [s["code"] for s in DEFAULT_SIZES]
    existing_size_codes = set()
    if size_codes:
        async for d in db.rahaza_sizes.find(
            {"code": {"$in": size_codes}}, {"_id": 0, "code": 1}
        ):
            existing_size_codes.add(d["code"])
    for s in DEFAULT_SIZES:
        if s["code"] in existing_size_codes:
            continue
        await db.rahaza_sizes.insert_one({
            "id": _uid(), **s, "active": True,
            "created_at": _now(), "updated_at": _now(),
        })
        seeded_size += 1
    if seeded_size:
        print(f"  · Rahaza sizes seeded ({seeded_size} baru)")


async def _require_admin(request: Request):
    user = await require_auth(request)
    role = (user.get("role") or "").lower()
    if role in ("superadmin", "admin"):
        return user
    perms = user.get("_permissions") or []
    if "*" in perms or "prod.master.manage" in perms or "prod.line.manage" in perms or "prod.process.input" in perms:
        return user
    raise HTTPException(403, "Forbidden: butuh permission produksi")


# ── MODELS (Model Produk) ───────────────────────────────────────────────────
@router.get("/models")
async def list_models(request: Request):
    await require_auth(request)
    db = get_db()
    rows = await db.rahaza_models.find({}, {"_id": 0}).sort("code", 1).to_list(500)
    return serialize_doc(rows)


@router.post("/models")
async def create_model(request: Request):
    user = await _require_admin(request)
    db = get_db()
    body = await request.json()
    code = (body.get("code") or "").strip().upper()
    name = (body.get("name") or "").strip()
    if not code or not name:
        raise HTTPException(400, "code & name required")
    if await db.rahaza_models.find_one({"code": code, "active": True}):
        raise HTTPException(409, f"Kode '{code}' sudah terpakai (aktif). Gunakan kode lain.")
    doc = {
        "id": _uid(),
        "code": code,
        "name": name,
        "category": body.get("category") or "Sweater",
        "yarn_kg_per_pcs": float(body.get("yarn_kg_per_pcs") or 0),
        "bundle_size": int(body.get("bundle_size") or 30),  # Phase 17A: default 30 pcs per bundle
        "description": body.get("description") or "",
        "active": True,
        "created_at": _now(), "updated_at": _now(),
    }
    await db.rahaza_models.insert_one(doc)
    await log_activity(user["id"], user.get("name", ""), "create", "rahaza.model", code)
    return serialize_doc(doc)


@router.put("/models/{mid}")
async def update_model(mid: str, request: Request):
    user = await _require_admin(request)
    db = get_db()
    body = await request.json()
    body.pop("_id", None)
    body.pop("id", None)
    body.pop("created_at", None)
    body["updated_at"] = _now()
    if "code" in body:
        body["code"] = body["code"].strip().upper()
    # Phase 17A: sanitize bundle_size
    if "bundle_size" in body:
        try:
            body["bundle_size"] = max(1, int(body["bundle_size"]))
        except (TypeError, ValueError):
            body.pop("bundle_size")
    res = await db.rahaza_models.update_one({"id": mid}, {"$set": body})
    if res.matched_count == 0:
        raise HTTPException(404, "Not found")
    await log_activity(user["id"], user.get("name", ""), "update", "rahaza.model", mid)
    return serialize_doc(await db.rahaza_models.find_one({"id": mid}, {"_id": 0}))


@router.delete("/models/{mid}")
async def deactivate_model(mid: str, request: Request):
    user = await _require_admin(request)
    db = get_db()
    await db.rahaza_models.update_one({"id": mid}, {"$set": {"active": False, "updated_at": _now()}})
    await log_activity(user["id"], user.get("name", ""), "deactivate", "rahaza.model", mid)
    return {"status": "deactivated"}


# ── MODEL IMAGES (max 3 photos per model) ──────────────────────────────────
@router.post("/models/{mid}/images")
async def upload_model_image(mid: str, request: Request, file: UploadFile = File(...)):
    """Upload foto referensi untuk model (max 3 foto per model)."""
    user = await _require_admin(request)
    db = get_db()
    mod = await db.rahaza_models.find_one({"id": mid}, {"_id": 0})
    if not mod:
        raise HTTPException(404, "Model tidak ditemukan")
    images = list(mod.get("image_paths") or [])
    if len(images) >= 3:
        raise HTTPException(400, "Maksimal 3 foto per model. Hapus salah satu dulu.")
    # Validate content type (header check)
    ctype = (file.content_type or "").lower()
    if not ctype.startswith("image/"):
        raise HTTPException(400, "File harus berupa gambar (jpg/png/webp)")
    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(400, "Ukuran gambar maksimal 5MB")
    # M1: Validate magic bytes via Pillow (prevents header spoofing)
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(data))
        if img.format not in ('JPEG', 'PNG', 'WEBP', 'GIF', 'BMP'):
            raise HTTPException(400, "Format gambar tidak didukung (gunakan JPG/PNG/WEBP)")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(400, "File bukan gambar yang valid")
    try:
        path = generate_storage_path(user["id"], file.filename or "model.jpg")
        result = put_object(path, data, ctype)
        storage_path = result.get("path", path)
    except RuntimeError:
        raise HTTPException(503, "Storage tidak tersedia")
    except Exception as e:
        raise HTTPException(500, f"Upload gagal: {str(e)}")
    images.append(storage_path)
    await db.rahaza_models.update_one({"id": mid}, {"$set": {"image_paths": images, "updated_at": _now()}})
    # Track in attachments collection for unified file tracking
    await db.attachments.insert_one({
        "id": _uid(), "storage_path": storage_path,
        "original_filename": file.filename, "content_type": ctype,
        "size": len(data), "entity_type": "rahaza_model", "entity_id": mid,
        "uploaded_by": user.get("name", ""), "uploaded_by_id": user["id"],
        "is_deleted": False, "created_at": _now(),
    })
    await log_activity(user["id"], user.get("name", ""), "upload_image", "rahaza.model", mid)
    return {"image_paths": images, "added": storage_path}


@router.delete("/models/{mid}/images")
async def delete_model_image(mid: str, request: Request):
    """Hapus 1 foto. Body: {storage_path: '...'}"""
    user = await _require_admin(request)
    db = get_db()
    body = await request.json()
    target = body.get("storage_path")
    if not target:
        raise HTTPException(400, "storage_path required")
    mod = await db.rahaza_models.find_one({"id": mid}, {"_id": 0})
    if not mod:
        raise HTTPException(404, "Model tidak ditemukan")
    images = [p for p in (mod.get("image_paths") or []) if p != target]
    await db.rahaza_models.update_one({"id": mid}, {"$set": {"image_paths": images, "updated_at": _now()}})
    # M10: Actually delete the object from storage (not just soft-delete)
    try:
        delete_object(target)
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"delete_model_image storage delete failed ({target}): {e}")
    await db.attachments.update_one(
        {"storage_path": target},
        {"$set": {"is_deleted": True, "deleted_at": _now()}}
    )
    await log_activity(user["id"], user.get("name", ""), "delete_image", "rahaza.model", mid)
    return {"image_paths": images}


# ── SIZES ────────────────────────────────────────────────────────────────────
@router.get("/sizes")
async def list_sizes(request: Request):
    await require_auth(request)
    db = get_db()
    rows = await db.rahaza_sizes.find({}, {"_id": 0}).sort("order_seq", 1).to_list(500)
    return serialize_doc(rows)


@router.post("/sizes")
async def create_size(request: Request):
    user = await _require_admin(request)
    db = get_db()
    body = await request.json()
    code = (body.get("code") or "").strip().upper()
    name = (body.get("name") or "").strip() or code
    if not code:
        raise HTTPException(400, "code required")
    if await db.rahaza_sizes.find_one({"code": code, "active": True}):
        raise HTTPException(409, f"Kode '{code}' sudah terpakai (aktif). Gunakan kode lain.")
    doc = {
        "id": _uid(),
        "code": code,
        "name": name,
        "order_seq": int(body.get("order_seq") or 0),
        "active": True,
        "created_at": _now(), "updated_at": _now(),
    }
    await db.rahaza_sizes.insert_one(doc)
    await log_activity(user["id"], user.get("name", ""), "create", "rahaza.size", code)
    return serialize_doc(doc)


@router.put("/sizes/{sid}")
async def update_size(sid: str, request: Request):
    await _require_admin(request)
    db = get_db()
    body = await request.json()
    body.pop("_id", None)
    body.pop("id", None)
    body.pop("created_at", None)
    body["updated_at"] = _now()
    if "code" in body:
        body["code"] = body["code"].strip().upper()
    res = await db.rahaza_sizes.update_one({"id": sid}, {"$set": body})
    if res.matched_count == 0:
        raise HTTPException(404, "Not found")
    return serialize_doc(await db.rahaza_sizes.find_one({"id": sid}, {"_id": 0}))


@router.delete("/sizes/{sid}")
async def deactivate_size(sid: str, request: Request):
    await _require_admin(request)
    db = get_db()
    await db.rahaza_sizes.update_one({"id": sid}, {"$set": {"active": False, "updated_at": _now()}})
    return {"status": "deactivated"}


# ── LINE ASSIGNMENTS ────────────────────────────────────────────────────────
@router.get("/line-assignments")
async def list_assignments(request: Request, line_id: Optional[str] = None, assign_date: Optional[str] = None):
    await require_auth(request)
    db = get_db()
    q = {}
    if line_id:
        q["line_id"] = line_id
    if assign_date:
        q["assign_date"] = assign_date  # YYYY-MM-DD
    rows = await db.rahaza_line_assignments.find(q, {"_id": 0}).sort([("assign_date", -1), ("line_id", 1)]).to_list(500)
    # Enrich with joined names
    line_ids = list({r["line_id"] for r in rows if r.get("line_id")})
    emp_ids  = list({r["operator_id"] for r in rows if r.get("operator_id")})
    shift_ids= list({r["shift_id"] for r in rows if r.get("shift_id")})
    model_ids= list({r["model_id"] for r in rows if r.get("model_id")})
    size_ids = list({r["size_id"] for r in rows if r.get("size_id")})

    async def _name_map(col, ids, id_field="id", name_field="name"):
        if not ids:
            return {}
        docs = await db[col].find({id_field: {"$in": ids}}, {"_id": 0}).to_list(500)
        return {d[id_field]: d.get(name_field) for d in docs}

    ln_map    = await _name_map("rahaza_lines", line_ids)
    emp_map   = await _name_map("rahaza_employees", emp_ids)
    sh_map    = await _name_map("rahaza_shifts", shift_ids)
    mod_map   = await _name_map("rahaza_models", model_ids)
    sz_map    = await _name_map("rahaza_sizes", size_ids)

    for r in rows:
        r["line_name"]     = ln_map.get(r.get("line_id"))
        r["operator_name"] = emp_map.get(r.get("operator_id"))
        r["shift_name"]    = sh_map.get(r.get("shift_id"))
        r["model_name"]    = mod_map.get(r.get("model_id"))
        r["size_name"]     = sz_map.get(r.get("size_id"))
    return serialize_doc(rows)


@router.post("/line-assignments")
async def create_assignment(request: Request):
    user = await _require_admin(request)
    db = get_db()
    body = await request.json()
    line_id = body.get("line_id")
    if not line_id:
        raise HTTPException(400, "line_id required")
    assign_date = body.get("assign_date") or date.today().isoformat()
    process_id   = body.get("process_id") or None
    process_code = body.get("process_code") or None

    # If process_id given but process_code missing, resolve it
    if process_id and not process_code:
        proc_doc = await db.rahaza_processes.find_one({"id": process_id}, {"_id": 0})
        if proc_doc:
            process_code = proc_doc.get("code")
    # If process_code given but process_id missing, resolve it
    if process_code and not process_id:
        proc_doc = await db.rahaza_processes.find_one({"code": process_code.upper(), "active": True}, {"_id": 0})
        if proc_doc:
            process_id = proc_doc.get("id")
            process_code = proc_doc.get("code")

    # Check collision on line+date+shift+process (same line can work different processes on same shift)
    q_collision = {
        "line_id": line_id, "assign_date": assign_date,
        "shift_id": body.get("shift_id"), "active": True,
    }
    if process_id:
        q_collision["process_id"] = process_id
    existing = await db.rahaza_line_assignments.find_one(q_collision)
    if existing:
        raise HTTPException(409, "Line sudah di-assign untuk tanggal, shift, dan proses tersebut.")
    doc = {
        "id": _uid(),
        "line_id": line_id,
        "operator_id": body.get("operator_id") or None,
        "shift_id": body.get("shift_id") or None,
        "model_id": body.get("model_id") or None,
        "size_id":  body.get("size_id") or None,
        "target_qty": int(body.get("target_qty") or 0),
        "assign_date": assign_date,
        "process_id": process_id,
        "process_code": process_code,
        "work_order_id": body.get("work_order_id") or None,
        "notes": body.get("notes") or "",
        "active": True,
        "created_at": _now(), "updated_at": _now(),
    }
    await db.rahaza_line_assignments.insert_one(doc)
    await log_activity(user["id"], user.get("name", ""), "create", "rahaza.line_assignment", doc["id"])
    return serialize_doc(doc)


# ─── Bulk assignment (copy from yesterday / template) ────────────────────────
@router.get("/supervisor/assignments/yesterday")
async def get_yesterday_assignments(request: Request):
    """Get yesterday's assignments as a template for today."""
    await require_auth(request)
    db = get_db()
    import datetime as _dt
    yesterday = (_dt.date.today() - _dt.timedelta(days=1)).isoformat()
    assignments = await db.rahaza_line_assignments.find(
        {"assign_date": yesterday, "active": True}, {"_id": 0}
    ).to_list(500)
    line_ids = [a["line_id"] for a in assignments]
    emp_ids  = [a.get("operator_id") for a in assignments if a.get("operator_id")]
    lines_map = {l["id"]: l for l in await db.rahaza_lines.find({"id": {"$in": line_ids}}, {"_id": 0}).to_list(500)} if line_ids else {}
    emps_map  = {e["id"]: e for e in await db.rahaza_employees.find({"id": {"$in": emp_ids}}, {"_id": 0}).to_list(500)} if emp_ids else {}
    preview = []
    for a in assignments:
        line = lines_map.get(a["line_id"])
        emp  = emps_map.get(a.get("operator_id"))
        preview.append({
            "line_id": a["line_id"],
            "line_name": line.get("name") if line else a["line_id"],
            "employee_id": a.get("operator_id"),
            "employee_name": emp.get("name") if emp else "-",
            "shift_id": a.get("shift_id"),
            "model_id": a.get("model_id"),
            "size_id": a.get("size_id"),
            "target_qty": a.get("target_qty") or 0,
            "process_id": a.get("process_id"),
            "process_code": a.get("process_code"),
            "work_order_id": a.get("work_order_id"),
            "notes": a.get("notes") or "",
        })
    return {"date": yesterday, "count": len(preview), "assignments": preview}


@router.post("/supervisor/assignments/bulk")
async def bulk_create_assignments(request: Request):
    """Bulk create assignments (for copy-yesterday feature)."""
    await require_auth(request)
    db = get_db()
    body = await request.json()
    assign_date = body.get("assign_date") or date.today().isoformat()
    overwrite   = bool(body.get("overwrite", False))
    assignments_list = body.get("assignments") or []
    created = 0
    skipped = 0
    # Batch prefetch existing assignments matching the bulk filter
    line_ids_b = list({a["line_id"] for a in assignments_list if a.get("line_id")})
    shift_ids_b = list({a.get("shift_id") for a in assignments_list if a.get("shift_id")})
    list({a.get("process_id") for a in assignments_list if a.get("process_id")})
    existing_assigns_lookup = {}
    if line_ids_b:
        q_batch = {
            "line_id": {"$in": line_ids_b},
            "assign_date": assign_date,
            "active": True,
        }
        if shift_ids_b:
            q_batch["shift_id"] = {"$in": shift_ids_b}
        async for d in db.rahaza_line_assignments.find(q_batch, {"_id": 0}):
            key = (d.get("line_id"), d.get("shift_id"), d.get("process_id") or None)
            existing_assigns_lookup[key] = d
    for a in assignments_list:
        # No DB call here — use lookup
        key = (a["line_id"], a.get("shift_id"), a.get("process_id") or None)
        existing = existing_assigns_lookup.get(key)
        if existing:
            if overwrite:
                await db.rahaza_line_assignments.update_one({"id": existing["id"]}, {"$set": {
                    "operator_id": a.get("employee_id") or a.get("operator_id"),
                    "model_id": a.get("model_id"), "size_id": a.get("size_id"),
                    "target_qty": a.get("target_qty") or 0,
                    "process_id": a.get("process_id"), "process_code": a.get("process_code"),
                    "work_order_id": a.get("work_order_id"), "notes": a.get("notes") or "",
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }})
                created += 1
            else:
                skipped += 1
            continue
        doc = {
            "id": _uid(), "line_id": a["line_id"],
            "operator_id": a.get("employee_id") or a.get("operator_id"),
            "shift_id": a.get("shift_id"), "model_id": a.get("model_id"), "size_id": a.get("size_id"),
            "target_qty": a.get("target_qty") or 0, "assign_date": assign_date,
            "process_id": a.get("process_id"), "process_code": a.get("process_code"),
            "work_order_id": a.get("work_order_id"), "notes": a.get("notes") or "",
            "active": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.rahaza_line_assignments.insert_one(doc)
        created += 1
    return {"ok": True, "created": created, "skipped": skipped}
async def update_assignment(aid: str, request: Request):
    await _require_admin(request)
    db = get_db()
    body = await request.json()
    body.pop("_id", None)
    body.pop("id", None)
    body.pop("created_at", None)
    body["updated_at"] = _now()
    res = await db.rahaza_line_assignments.update_one({"id": aid}, {"$set": body})
    if res.matched_count == 0:
        raise HTTPException(404, "Not found")
    return serialize_doc(await db.rahaza_line_assignments.find_one({"id": aid}, {"_id": 0}))


@router.delete("/line-assignments/{aid}")
async def deactivate_assignment(aid: str, request: Request):
    await _require_admin(request)
    db = get_db()
    await db.rahaza_line_assignments.update_one({"id": aid}, {"$set": {"active": False, "updated_at": _now()}})
    return {"status": "deactivated"}


# ── WIP EVENTS ──────────────────────────────────────────────────────────────
@router.post("/wip/events")
async def record_wip_event(request: Request):
    user = await _require_admin(request)
    db = get_db()
    body = await request.json()
    line_id = body.get("line_id")
    process_id = body.get("process_id")
    qty = int(body.get("qty") or 0)
    if not (line_id and process_id and qty > 0):
        raise HTTPException(400, "line_id, process_id, qty(>0) required")

    # Look up context
    line = await db.rahaza_lines.find_one({"id": line_id}, {"_id": 0})
    if not line:
        raise HTTPException(404, "Line not found")
    proc = await db.rahaza_processes.find_one({"id": process_id}, {"_id": 0})  # FIX: fetch process

    event = {
        "id": _uid(),
        "timestamp": _now(),
        "event_date": _now().date().isoformat(),                        # FIX: date string for reports
        "line_id": line_id,
        "process_id": process_id,
        "process_code": proc.get("code") if proc else "",          # FIX: Pareto reports
        "location_id": line.get("location_id"),
        "model_id": body.get("model_id") or None,
        "size_id": body.get("size_id") or None,
        "line_assignment_id": body.get("line_assignment_id") or None,
        "work_order_id": body.get("work_order_id") or None,
        "event_type": body.get("event_type") or "output",
        "qty": qty,
        "notes": body.get("notes") or "",
        "operator_id": user.get("employee_id") or user["id"],      # FIX: payroll PCS
        "created_by": user["id"],
        "created_by_name": user.get("name", ""),
    }
    await db.rahaza_wip_events.insert_one(event)

    # ─── PACKING output → create PENDING INBOUND (WMS) ─────────────────────
    # Stok FG TIDAK langsung bertambah; butuh Scan-In oleh gudang.
    if proc and proc.get("code") == "PACKING" and event["event_type"] == "output":
        model_id = body.get("model_id")
        size_id  = body.get("size_id")
        if model_id and size_id:
            model_doc = await db.rahaza_models.find_one({"id": model_id}, {"_id": 0})
            size_doc  = await db.rahaza_sizes.find_one({"id": size_id}, {"_id": 0})
            if model_doc and size_doc:
                fg_code = f"FG-{model_doc['code']}-{size_doc['code']}"
                fg_name = f"{model_doc['name']} [{size_doc['code']}]"
                existing = await db.rahaza_materials.find_one({"code": fg_code}, {"_id": 0})
                if not existing:
                    mat_id = _uid()
                    await db.rahaza_materials.insert_one({
                        "id": mat_id, "code": fg_code, "name": fg_name,
                        "type": "fg", "unit": "pcs", "active": True,
                        "model_id": model_id, "size_id": size_id,
                        "notes": "Auto-created dari output Packing",
                        "min_stock_qty": 0,
                    })
                else:
                    mat_id = existing["id"]

                try:
                    from routes.wms_receiving import helper_create_pending_inbound_fg
                    await helper_create_pending_inbound_fg(
                        db,
                        material_id=mat_id,
                        material_code=fg_code,
                        material_name=fg_name,
                        qty=float(qty),
                        unit="pcs",
                        source_type="production_packing",
                        source_id=event["id"],
                        source_ref=body.get("work_order_id", ""),
                        notes=f"Output Packing {qty} pcs — scan-in diperlukan",
                        created_by="packing_event",
                    )
                except Exception as e:
                    import logging
                    logging.getLogger(__name__).warning(f"WMS pending inbound (packing) failed: {e}")
    # ────────────────────────────────────────────────────────────────────────

    return serialize_doc(event)


@router.get("/wip/events")
async def list_wip_events(request: Request, line_id: Optional[str] = None, process_id: Optional[str] = None, limit: int = 100):
    await require_auth(request)
    db = get_db()
    q = {}
    if line_id:
        q["line_id"] = line_id
    if process_id:
        q["process_id"] = process_id
    rows = await db.rahaza_wip_events.find(q, {"_id": 0}).sort("timestamp", -1).limit(limit).to_list(500)
    return serialize_doc(rows)


@router.get("/wip/summary")
async def wip_summary(request: Request):
    """
    Return WIP per proses: qty yang masih berada di proses tsb.
    WIP at process P = Σ output(P) − Σ output(next_of_P)
    """
    await require_auth(request)
    db = get_db()

    processes = await db.rahaza_processes.find(
        {"active": True, "is_rework": False}, {"_id": 0}
    ).sort("order_seq", 1).to_list(500)

    # Aggregate total output per process (event_type=output)
    pipeline = [
        {"$match": {"event_type": "output"}},
        {"$group": {"_id": "$process_id", "total": {"$sum": "$qty"}}},
    ]
    raw = await db.rahaza_wip_events.aggregate(pipeline).to_list(500)
    total_by_proc = {r["_id"]: r["total"] for r in raw}

    # WIP = output(P) - output(P+1) ; for last process WIP = output(P)
    summary = []
    for idx, p in enumerate(processes):
        out_p = total_by_proc.get(p["id"], 0)
        out_next = 0
        if idx + 1 < len(processes):
            out_next = total_by_proc.get(processes[idx + 1]["id"], 0)
        wip = max(0, out_p - out_next)
        summary.append({
            "process_id": p["id"],
            "process_code": p["code"],
            "process_name": p["name"],
            "order_seq": p["order_seq"],
            "total_output": out_p,
            "wip_qty": wip,
        })
    return {"processes": summary, "updated_at": _now().isoformat()}


@router.get("/line-board")
async def line_board(request: Request, assign_date: Optional[str] = None):
    """
    Line Board per proses (non-rework) untuk tanggal tertentu (default hari ini).
    Struktur: { process: [{line, assignment, output_today, target}] }
    """
    await require_auth(request)
    db = get_db()
    today = assign_date or date.today().isoformat()

    lines = await db.rahaza_lines.find({"active": True}, {"_id": 0}).to_list(500)
    procs = await db.rahaza_processes.find({"active": True, "is_rework": False}, {"_id": 0}).sort("order_seq", 1).to_list(500)
    assignments = await db.rahaza_line_assignments.find({"assign_date": today, "active": True}, {"_id": 0}).to_list(500)

    # Enrich helper
    async def _name_map(col, ids, id_field="id"):
        if not ids:
            return {}
        docs = await db[col].find({id_field: {"$in": list(ids)}}, {"_id": 0}).to_list(500)
        return {d[id_field]: d for d in docs}

    emp_map = await _name_map("rahaza_employees", {a.get("operator_id") for a in assignments if a.get("operator_id")})
    sh_map  = await _name_map("rahaza_shifts",    {a.get("shift_id") for a in assignments if a.get("shift_id")})
    mod_map = await _name_map("rahaza_models",    {a.get("model_id") for a in assignments if a.get("model_id")})
    sz_map  = await _name_map("rahaza_sizes",     {a.get("size_id") for a in assignments if a.get("size_id")})
    loc_map = await _name_map("rahaza_locations", {l.get("location_id") for l in lines if l.get("location_id")})

    # Output today per line (event_type=output)
    start = datetime.combine(date.fromisoformat(today), datetime.min.time()).replace(tzinfo=timezone.utc)
    end   = datetime.combine(date.fromisoformat(today), datetime.max.time()).replace(tzinfo=timezone.utc)
    pipe = [
        {"$match": {"event_type": "output", "timestamp": {"$gte": start, "$lte": end}}},
        {"$group": {"_id": "$line_id", "total": {"$sum": "$qty"}}},
    ]
    out_agg = await db.rahaza_wip_events.aggregate(pipe).to_list(500)
    out_today = {r["_id"]: r["total"] for r in out_agg}

    # Group lines by process using ASSIGNMENTS (not line.process_id)
    by_proc = {p["id"]: [] for p in procs}
    assign_by_line = {}
    for a in assignments:
        assign_by_line.setdefault(a["line_id"], []).append(a)

    for ln in lines:
        loc = loc_map.get(ln.get("location_id"))
        line_assigns = []
        proc_ids_for_line = set()
        for a in assign_by_line.get(ln["id"], []):
            op  = emp_map.get(a.get("operator_id"))
            sh  = sh_map.get(a.get("shift_id"))
            mod = mod_map.get(a.get("model_id"))
            sz  = sz_map.get(a.get("size_id"))
            proc_id = a.get("process_id")
            if proc_id:
                proc_ids_for_line.add(proc_id)
            line_assigns.append({
                "id": a["id"],
                "operator_id": a.get("operator_id"),
                "operator_name": op.get("name") if op else None,
                "shift_id": a.get("shift_id"),
                "shift_name": sh.get("name") if sh else None,
                "model_id": a.get("model_id"),
                "model_name": mod.get("name") if mod else None,
                "size_id": a.get("size_id"),
                "size_code": sz.get("code") if sz else None,
                "target_qty": a.get("target_qty") or 0,
                "process_id": proc_id,
                "process_code": a.get("process_code"),
                "work_order_id": a.get("work_order_id"),
            })
        # Add line to each process it's assigned to
        for pid in proc_ids_for_line:
            if pid in by_proc:
                proc_assigns = [a for a in line_assigns if a.get("process_id") == pid]
                by_proc[pid].append({
                    "line_id": ln["id"],
                    "line_code": ln["code"],
                    "line_name": ln["name"],
                    "location_id": ln.get("location_id"),
                    "location_name": loc.get("name") if loc else None,
                    "capacity_per_hour": ln.get("capacity_per_hour") or 0,
                    "output_today": out_today.get(ln["id"], 0),
                    "assignments": proc_assigns,
                })
        # Fallback: if line has no process assignments, still add once using line.process_id
        if not proc_ids_for_line:
            pid = ln.get("process_id")
            if pid and pid in by_proc:
                by_proc[pid].append({
                    "line_id": ln["id"],
                    "line_code": ln["code"],
                    "line_name": ln["name"],
                    "location_id": ln.get("location_id"),
                    "location_name": loc.get("name") if loc else None,
                    "capacity_per_hour": ln.get("capacity_per_hour") or 0,
                    "output_today": out_today.get(ln["id"], 0),
                    "assignments": line_assigns,
                })

    board = []
    for p in procs:
        board.append({
            "process_id": p["id"],
            "process_code": p["code"],
            "process_name": p["name"],
            "order_seq": p["order_seq"],
            "lines": by_proc[p["id"]],
        })
    return {"date": today, "board": board}
