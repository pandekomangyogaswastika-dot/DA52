"""
PT Rahaza — Bill of Materials (Fase 5b — Multi-Version)

Endpoints (prefix /api/rahaza):
  - GET    /boms                       : List BOMs (filter by model_id)
  - GET    /boms/{id}                  : BOM detail
  - GET    /models/{model_id}/bom      : All BOMs for model (all sizes) dengan active version
  - GET    /boms/versions              : List versions per model_id+size_id
  - POST   /boms                       : Create new BOM version
  - PUT    /boms/{id}                  : Update BOM (untuk edit versi aktif)
  - POST   /boms/{id}/activate         : Activate versi (dan deactivate yang lain)
  - POST   /boms/{id}/requirements     : Preview kebutuhan material untuk X pcs
  - DELETE /boms/{id}                  : Soft-delete
  - POST   /boms/{id}/copy-to-sizes    : Copy this BOM to other sizes (same model)

Schema (rahaza_boms):
  {
    id, model_id, size_id, version (int), is_active (bool),
    yarn_materials:     [{name, code, yarn_type, qty_kg, notes, material_id?}],
    accessory_materials: [{name, code, qty, unit, notes, material_id?}],
    total_yarn_kg_per_pcs: <auto>,
    notes, active (soft delete), created_at, updated_at
  }

Versioning Rules:
  - Setiap model+size bisa punya multiple versions (version: 1,2,3,...)
  - Hanya 1 version yang is_active=true per model+size
  - Edit version aktif menggunakan PUT /boms/{id}
  - Create version baru menggunakan POST /boms (auto increment version number)
"""
from fastapi import APIRouter, Request, HTTPException
from database import get_db
from auth import require_auth, serialize_doc, log_activity
import uuid
from datetime import datetime, timezone
from typing import Optional

router = APIRouter(prefix="/api/rahaza", tags=["rahaza-bom"])


def _uid(): return str(uuid.uuid4())
def _now(): return datetime.now(timezone.utc)


def _parse_version(v) -> int:
    """Normalize version field: int, str '1', str 'v1' → int. Returns 0 on failure."""
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        return int(v)
    if isinstance(v, str):
        try:
            return int(v.lstrip('vV').strip())
        except (ValueError, AttributeError):
            return 0
    return 0


async def migrate_bom_data(db):
    """
    One-time-idempotent migration:
    1. Convert string versions ("v1","v2") → int
    2. Set is_active=True on the highest-version BOM per model+size that has is_active=None/missing,
       only if no other version for that model+size is already active.
    """
    # Step 1: Fix string versions
    bad_version_boms = await db.rahaza_boms.find(
        {"version": {"$type": "string"}, "active": True}, {"_id": 0, "id": 1, "version": 1}
    ).to_list(500)
    for b in bad_version_boms:
        new_v = _parse_version(b.get("version"))
        if new_v == 0:
            new_v = 1  # fallback
        await db.rahaza_boms.update_one({"id": b["id"]}, {"$set": {"version": new_v}})

    # Step 2: Fix missing is_active — collect model+size combos
    boms_no_active = await db.rahaza_boms.find(
        {"active": True, "is_active": {"$in": [None, False, True]}}, {"_id": 0}
    ).to_list(500)
    # Group by (model_id, size_id)
    from collections import defaultdict
    groups = defaultdict(list)
    for b in boms_no_active:
        groups[(b.get("model_id"), b.get("size_id"))].append(b)

    for (mid, sid), group in groups.items():
        already_active = any(b.get("is_active") is True for b in group)
        if not already_active:
            # Activate the highest version
            sorted_group = sorted(group, key=lambda b: _parse_version(b.get("version", 0)), reverse=True)
            winner = sorted_group[0]
            await db.rahaza_boms.update_one(
                {"id": winner["id"]},
                {"$set": {"is_active": True, "updated_at": _now()}}
            )
            # Deactivate the rest
            for b in sorted_group[1:]:
                if b.get("is_active") is not False:
                    await db.rahaza_boms.update_one(
                        {"id": b["id"]},
                        {"$set": {"is_active": False, "updated_at": _now()}}
                    )


async def _require_admin(request: Request):
    user = await require_auth(request)
    role = (user.get("role") or "").lower()
    if role in ("superadmin", "admin"):
        return user
    perms = user.get("_permissions") or []
    if "*" in perms or "prod.master.manage" in perms or "bom.manage" in perms:
        return user
    raise HTTPException(403, "Forbidden: butuh permission BOM / prod.master.")


def _clean_yarns(raw):
    cleaned = []
    for y in raw or []:
        name = (y.get("name") or "").strip()
        qty  = float(y.get("qty_kg") or 0)
        if not name or qty <= 0:
            continue
        item = {
            "name": name,
            "code": (y.get("code") or "").strip().upper(),
            "yarn_type": (y.get("yarn_type") or "").strip(),
            "qty_kg": round(qty, 4),
            "notes": y.get("notes") or "",
        }
        # Phase 22A: preserve material_id for auto-reservation
        if y.get("material_id"):
            item["material_id"] = y["material_id"]
        if y.get("qty_per_pcs"):
            item["qty_per_pcs"] = float(y["qty_per_pcs"])
        cleaned.append(item)
    return cleaned


def _clean_accessories(raw):
    cleaned = []
    for a in raw or []:
        name = (a.get("name") or "").strip()
        qty  = float(a.get("qty") or 0)
        if not name or qty <= 0:
            continue
        item = {
            "name": name,
            "code": (a.get("code") or "").strip().upper(),
            "qty": round(qty, 3),
            "unit": (a.get("unit") or "pcs").strip(),
            "notes": a.get("notes") or "",
        }
        # Phase 22A: preserve material_id for auto-reservation
        if a.get("material_id"):
            item["material_id"] = a["material_id"]
        if a.get("qty_per_pcs"):
            item["qty_per_pcs"] = float(a["qty_per_pcs"])
        cleaned.append(item)
    return cleaned


async def _enrich_bom(db, bom):
    if not bom:
        return bom
    mod = await db.rahaza_models.find_one({"id": bom.get("model_id")}, {"_id": 0})
    sz  = await db.rahaza_sizes.find_one({"id": bom.get("size_id")},  {"_id": 0})
    bom["model_code"] = mod["code"] if mod else None
    bom["model_name"] = mod["name"] if mod else None
    bom["size_code"]  = sz["code"]  if sz else None
    bom["size_name"]  = sz["name"]  if sz else None
    # Totals
    bom["total_yarn_kg_per_pcs"] = round(sum(float(y.get("qty_kg") or 0) for y in (bom.get("yarn_materials") or [])), 4)
    bom["yarn_count"]      = len(bom.get("yarn_materials") or [])
    bom["accessory_count"] = len(bom.get("accessory_materials") or [])
    return bom


@router.get("/boms")
async def list_boms(request: Request, model_id: Optional[str] = None):
    await require_auth(request)
    db = get_db()
    q = {"active": True}
    if model_id:
        q["model_id"] = model_id
    rows = await db.rahaza_boms.find(q, {"_id": 0}).sort("updated_at", -1).to_list(500)
    for r in rows:
        await _enrich_bom(db, r)
    return serialize_doc(rows)


@router.get("/boms/versions")
async def list_bom_versions(request: Request, model_id: str, size_id: str):
    """List all versions untuk model_id+size_id combination."""
    await require_auth(request)
    db = get_db()
    if not model_id or not size_id:
        raise HTTPException(400, "model_id dan size_id wajib diisi")
    # Get all versions (including inactive), sorted by version desc
    versions = await db.rahaza_boms.find(
        {"model_id": model_id, "size_id": size_id, "active": True},
        {"_id": 0}
    ).sort("version", -1).to_list(500)
    for v in versions:
        await _enrich_bom(db, v)
    return serialize_doc(versions)


@router.get("/boms/{bid}")
async def get_bom(bid: str, request: Request):
    await require_auth(request)
    db = get_db()
    bom = await db.rahaza_boms.find_one({"id": bid}, {"_id": 0})
    if not bom:
        raise HTTPException(404, "BOM tidak ditemukan")
    await _enrich_bom(db, bom)
    return serialize_doc(bom)


@router.get("/models/{model_id}/bom")
async def get_model_bom(model_id: str, request: Request):
    """Return BOM summary untuk all sizes of a given model (matrix view) dengan active version."""
    await require_auth(request)
    db = get_db()
    model = await db.rahaza_models.find_one({"id": model_id}, {"_id": 0})
    if not model:
        raise HTTPException(404, "Model tidak ditemukan")
    sizes = await db.rahaza_sizes.find({"active": True}, {"_id": 0}).sort("order_seq", 1).to_list(500)
    # Get active BOMs only
    boms = await db.rahaza_boms.find({"model_id": model_id, "active": True, "is_active": True}, {"_id": 0}).to_list(500)
    bom_by_size = {b["size_id"]: b for b in boms}
    matrix = []
    for s in sizes:
        b = bom_by_size.get(s["id"])
        matrix.append({
            "size_id": s["id"],
            "size_code": s["code"],
            "size_name": s["name"],
            "size_order_seq": s.get("order_seq", 0),
            "bom_id": b["id"] if b else None,
            "version": b.get("version", 1) if b else None,
            "total_yarn_kg_per_pcs": round(sum(float(y.get("qty_kg") or 0) for y in (b.get("yarn_materials") or [])), 4) if b else 0,
            "yarn_count":      len(b.get("yarn_materials") or []) if b else 0,
            "accessory_count": len(b.get("accessory_materials") or []) if b else 0,
            "notes":           b.get("notes", "") if b else "",
            "updated_at":      b.get("updated_at") if b else None,
        })
    return {
        "model": {"id": model["id"], "code": model["code"], "name": model["name"]},
        "matrix": matrix,
    }


@router.post("/boms")
async def create_bom(request: Request):
    """Create new BOM version."""
    user = await _require_admin(request)
    db = get_db()
    body = await request.json()
    model_id = body.get("model_id")
    size_id  = body.get("size_id")
    if not (model_id and size_id):
        raise HTTPException(400, "model_id & size_id wajib diisi.")
    # Ensure model + size exist
    if not await db.rahaza_models.find_one({"id": model_id}):
        raise HTTPException(404, "Model tidak ditemukan")
    if not await db.rahaza_sizes.find_one({"id": size_id}):
        raise HTTPException(404, "Size tidak ditemukan")
    yarns = _clean_yarns(body.get("yarn_materials"))
    accs  = _clean_accessories(body.get("accessory_materials"))
    if not yarns and not accs:
        raise HTTPException(400, "BOM harus berisi minimal 1 benang atau 1 aksesoris.")
    
    # Auto-increment version number — scan ALL active versions (including inactive ones)
    existing_versions = await db.rahaza_boms.find(
        {"model_id": model_id, "size_id": size_id, "active": True},
        {"_id": 0, "version": 1}
    ).to_list(500)
    max_version = 0
    for ev in existing_versions:
        v = _parse_version(ev.get("version", 0))
        if v > max_version:
            max_version = v
    new_version = max_version + 1
    
    # Check if create as active (default true for first version, false for subsequent)
    is_active = body.get("is_active", new_version == 1)
    
    # If creating as active, deactivate others
    if is_active:
        await db.rahaza_boms.update_many(
            {"model_id": model_id, "size_id": size_id, "active": True},
            {"$set": {"is_active": False, "updated_at": _now()}}
        )
    
    doc = {
        "id": _uid(),
        "model_id": model_id,
        "size_id": size_id,
        "version": new_version,
        "is_active": is_active,
        "yarn_materials": yarns,
        "accessory_materials": accs,
        "notes": body.get("notes") or "",
        "active": True,
        "created_at": _now(), "updated_at": _now(),
    }
    await db.rahaza_boms.insert_one(doc)
    await log_activity(user["id"], user.get("name", ""), "create", "rahaza.bom", doc["id"])
    await _enrich_bom(db, doc)
    return serialize_doc(doc)


@router.put("/boms/{bid}")
async def update_bom(bid: str, request: Request):
    """Update BOM (untuk edit versi aktif atau versi lainnya)."""
    user = await _require_admin(request)
    db = get_db()
    bom = await db.rahaza_boms.find_one({"id": bid})
    if not bom:
        raise HTTPException(404, "BOM tidak ditemukan")
    body = await request.json()
    upd = {"updated_at": _now()}
    if "yarn_materials" in body:
        upd["yarn_materials"] = _clean_yarns(body["yarn_materials"])
    if "accessory_materials" in body:
        upd["accessory_materials"] = _clean_accessories(body["accessory_materials"])
    if "notes" in body:
        upd["notes"] = body.get("notes") or ""
    # Validate after update that BOM still has at least one material
    final_yarns = upd.get("yarn_materials", bom.get("yarn_materials") or [])
    final_accs  = upd.get("accessory_materials", bom.get("accessory_materials") or [])
    if not final_yarns and not final_accs:
        raise HTTPException(400, "BOM harus berisi minimal 1 benang atau 1 aksesoris.")
    await db.rahaza_boms.update_one({"id": bid}, {"$set": upd})
    out = await db.rahaza_boms.find_one({"id": bid}, {"_id": 0})
    await _enrich_bom(db, out)
    await log_activity(user["id"], user.get("name", ""), "update", "rahaza.bom", bid)
    return serialize_doc(out)


@router.post("/boms/{bid}/activate")
async def activate_bom_version(bid: str, request: Request):
    """Activate a specific BOM version (and deactivate others for same model+size)."""
    user = await _require_admin(request)
    db = get_db()
    bom = await db.rahaza_boms.find_one({"id": bid, "active": True}, {"_id": 0})
    if not bom:
        raise HTTPException(404, "BOM tidak ditemukan")
    
    # Deactivate all other versions for this model+size
    await db.rahaza_boms.update_many(
        {"model_id": bom["model_id"], "size_id": bom["size_id"], "active": True},
        {"$set": {"is_active": False, "updated_at": _now()}}
    )
    
    # Activate this version
    await db.rahaza_boms.update_one(
        {"id": bid},
        {"$set": {"is_active": True, "updated_at": _now()}}
    )
    
    await log_activity(user["id"], user.get("name", ""), "activate_version", "rahaza.bom", bid)
    out = await db.rahaza_boms.find_one({"id": bid}, {"_id": 0})
    await _enrich_bom(db, out)
    return serialize_doc(out)


@router.post("/boms/{bid}/requirements")
async def preview_requirements(bid: str, request: Request):
    """Preview kebutuhan material untuk X pcs."""
    await require_auth(request)
    db = get_db()
    bom = await db.rahaza_boms.find_one({"id": bid, "active": True}, {"_id": 0})
    if not bom:
        raise HTTPException(404, "BOM tidak ditemukan")
    
    body = await request.json()
    qty_pcs = float(body.get("qty_pcs", 0))
    if qty_pcs <= 0:
        raise HTTPException(400, "qty_pcs harus lebih dari 0")
    
    rounding = body.get("rounding", "none")  # none|ceil|floor
    
    # Calculate yarn requirements
    yarns = []
    total_yarn_kg = 0
    for y in bom.get("yarn_materials") or []:
        qty_per_pcs = float(y.get("qty_kg") or 0)
        qty_total = qty_per_pcs * qty_pcs
        if rounding == "ceil":
            import math
            qty_total = math.ceil(qty_total * 1000) / 1000  # Round up to 3 decimals
        elif rounding == "floor":
            import math
            qty_total = math.floor(qty_total * 1000) / 1000
        yarns.append({
            "material_id": y.get("material_id"),
            "name": y.get("name"),
            "code": y.get("code"),
            "yarn_type": y.get("yarn_type"),
            "qty_per_pcs": round(qty_per_pcs, 4),
            "qty_total_kg": round(qty_total, 4),
            "notes": y.get("notes", "")
        })
        total_yarn_kg += qty_total
    
    # Calculate accessory requirements
    accessories = []
    for a in bom.get("accessory_materials") or []:
        qty_per_pcs = float(a.get("qty") or 0)
        qty_total = qty_per_pcs * qty_pcs
        if rounding == "ceil":
            import math
            qty_total = math.ceil(qty_total)
        elif rounding == "floor":
            import math
            qty_total = math.floor(qty_total)
        accessories.append({
            "material_id": a.get("material_id"),
            "name": a.get("name"),
            "code": a.get("code"),
            "qty_per_pcs": round(qty_per_pcs, 3),
            "qty_total": round(qty_total, 3),
            "unit": a.get("unit"),
            "notes": a.get("notes", "")
        })
    
    await _enrich_bom(db, bom)
    
    return serialize_doc({
        "bom_id": bom["id"],
        "model_code": bom.get("model_code"),
        "model_name": bom.get("model_name"),
        "size_code": bom.get("size_code"),
        "version": bom.get("version"),
        "qty_pcs": qty_pcs,
        "rounding": rounding,
        "yarns": yarns,
        "accessories": accessories,
        "total_yarn_kg": round(total_yarn_kg, 4),
        "total_accessory_count": len(accessories),
    })


@router.delete("/boms/{bid}")
async def delete_bom(bid: str, request: Request):
    user = await _require_admin(request)
    db = get_db()
    res = await db.rahaza_boms.update_one({"id": bid}, {"$set": {"active": False, "updated_at": _now()}})
    if res.matched_count == 0:
        raise HTTPException(404, "BOM tidak ditemukan")
    await log_activity(user["id"], user.get("name", ""), "deactivate", "rahaza.bom", bid)
    return {"status": "deactivated"}


@router.post("/boms/{bid}/copy-to-sizes")
async def copy_bom_to_sizes(bid: str, request: Request):
    """
    Copy BOM (materials) dari source BOM ke target_size_ids pada model yang sama.
    Body: { target_size_ids: [..], overwrite: bool, copy_as_new_version: bool }
    """
    user = await _require_admin(request)
    db = get_db()
    src = await db.rahaza_boms.find_one({"id": bid, "active": True}, {"_id": 0})
    if not src:
        raise HTTPException(404, "BOM sumber tidak ditemukan")
    body = await request.json()
    target_size_ids = body.get("target_size_ids") or []
    overwrite = bool(body.get("overwrite"))
    copy_as_new_version = bool(body.get("copy_as_new_version", False))
    if not target_size_ids:
        raise HTTPException(400, "target_size_ids wajib diisi.")

    # Batch prefetch existing active BOMs & all versions for all target_size_ids
    existing_active_map: dict = {}
    all_versions_by_size: dict = {}
    if target_size_ids:
        async for d in db.rahaza_boms.find(
            {"model_id": src["model_id"], "size_id": {"$in": target_size_ids},
             "active": True, "is_active": True},
            {"_id": 0}
        ):
            existing_active_map[d["size_id"]] = d
        async for d in db.rahaza_boms.find(
            {"model_id": src["model_id"], "size_id": {"$in": target_size_ids}, "active": True},
            {"_id": 0, "size_id": 1, "version": 1}
        ):
            all_versions_by_size.setdefault(d["size_id"], []).append(d)

    created, skipped, overwritten = [], [], []
    for sid in target_size_ids:
        if sid == src["size_id"]:
            skipped.append({"size_id": sid, "reason": "sama dengan sumber"})
            continue

        existing = existing_active_map.get(sid)
        payload = {
            "yarn_materials": src.get("yarn_materials") or [],
            "accessory_materials": src.get("accessory_materials") or [],
            "notes": src.get("notes") or "",
            "updated_at": _now(),
        }

        if existing:
            if copy_as_new_version:
                # Use prefetched versions list
                existing_vers = all_versions_by_size.get(sid, [])
                max_v = max((_parse_version(ev.get("version", 0)) for ev in existing_vers), default=0)
                new_version = max_v + 1

                doc = {
                    "id": _uid(),
                    "model_id": src["model_id"],
                    "size_id": sid,
                    "version": new_version,
                    "is_active": False,
                    **payload,
                    "active": True,
                    "created_at": _now(),
                }
                await db.rahaza_boms.insert_one(doc)
                created.append(sid)
            elif not overwrite:
                skipped.append({"size_id": sid, "reason": "sudah ada BOM aktif (pakai overwrite=true atau copy_as_new_version=true)"})
                continue
            else:
                await db.rahaza_boms.update_one({"id": existing["id"]}, {"$set": payload})
                overwritten.append(sid)
        else:
            # No existing active BOM, create version 1
            doc = {
                "id": _uid(),
                "model_id": src["model_id"],
                "size_id": sid,
                "version": 1,
                "is_active": True,
                **payload,
                "active": True,
                "created_at": _now(),
            }
            await db.rahaza_boms.insert_one(doc)
            created.append(sid)
    await log_activity(user["id"], user.get("name", ""), "copy", "rahaza.bom", bid)
    return {"created": created, "overwritten": overwritten, "skipped": skipped}
