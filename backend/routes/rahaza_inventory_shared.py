"""rahaza_inventory — shared router, constants, utility helpers, MI helpers."""
# ruff: noqa: E741
from fastapi import APIRouter, Request, HTTPException
from auth import require_auth
import uuid
import logging
from datetime import datetime, timezone, date
from routes.shared import get_pagination_params, paginated_response  # noqa: F401

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/rahaza", tags=["rahaza-inventory"])


def _uid(): return str(uuid.uuid4())
def _now(): return datetime.now(timezone.utc)


MATERIAL_TYPES = ["yarn", "accessory", "fg", "packaging"]
MATERIAL_UNITS = [
    "m", "cm", "yard", "inch",
    "kg", "gram", "ton",
    "pcs", "lusin", "kodi", "gross", "helai", "set", "pair",
    "rol", "gulung", "bal", "karton", "pak", "sak",
    "liter", "ml",
]


async def _require_admin(request: Request):
    user = await require_auth(request)
    role = (user.get("role") or "").lower()
    if role in ("superadmin", "admin", "owner"):
        return user
    perms = user.get("_permissions") or []
    if "*" in perms or "inventory.manage" in perms or "warehouse.manage" in perms:
        return user
    raise HTTPException(403, "Forbidden: butuh permission inventory / warehouse.")


async def _ensure_stock_row(db, material_id: str, location_id: str):
    existing = await db.rahaza_material_stock.find_one({"material_id": material_id, "location_id": location_id})
    if existing:
        return existing
    doc = {"id": _uid(), "material_id": material_id, "location_id": location_id, "qty": 0.0, "updated_at": _now()}
    await db.rahaza_material_stock.insert_one(doc)
    return doc


async def _add_stock(db, material_id: str, location_id: str, delta: float):
    await _ensure_stock_row(db, material_id, location_id)
    await db.rahaza_material_stock.update_one(
        {"material_id": material_id, "location_id": location_id},
        {"$inc": {"qty": float(delta)}, "$set": {"updated_at": _now()}},
    )
    if delta < 0:
        try:
            await _check_low_stock_alert(db, material_id)
        except Exception as e:
            import logging as _l
            _l.getLogger(__name__).warning(f"Low-stock alert check failed: {e}")


async def _check_low_stock_alert(db, material_id: str):
    mat = await db.rahaza_materials.find_one({"id": material_id}, {"_id": 0})
    if not mat:
        return
    min_stock = float(mat.get("min_stock") or 0)
    if min_stock <= 0:
        return
    rows = await db.rahaza_material_stock.find(
        {"material_id": material_id}, {"_id": 0, "qty": 1}
    ).to_list(500)
    total = sum(float(r.get("qty") or 0) for r in rows)
    if total < min_stock:
        from routes.rahaza_notifications import publish_notification
        await publish_notification(
            db, type_="low_stock",
            severity="warning" if total > min_stock * 0.5 else "error",
            title=f"Stok {mat.get('name', '')} di bawah minimum",
            message=f"Stok total {total:.1f} {mat.get('unit', '')} < min {min_stock:.1f}. Segera reorder.",
            link_module="wh-stock", link_id=material_id,
            target_roles=["warehouse_manager", "production_manager", "superadmin"],
            dedup_key=f"low_stock::{material_id}",
        )


async def _log_movement(db, user, **fields):
    ts = _now()
    doc = {"id": _uid(), "created_at": ts, "timestamp": ts,
           "created_by": user["id"], "created_by_name": user.get("name", ""), **fields}
    await db.rahaza_material_movements.insert_one(doc)
    return doc


# ── MI helpers ────────────────────────────────────────────────────────────────────────

async def _gen_mi_number(db):
    today = date.today().strftime("%Y%m%d")
    prefix = f"MI-{today}"
    count = await db.rahaza_material_issues.count_documents({"mi_number": {"$regex": f"^{prefix}"}})
    return f"{prefix}-{count+1:03d}"


async def _enrich_mi(db, mi):
    if not mi:
        return mi
    m_ids = list({it["material_id"] for it in (mi.get("items") or []) if it.get("material_id")})
    loc_ids = list({it["location_id"] for it in (mi.get("items") or []) if it.get("location_id")})
    mats = await db.rahaza_materials.find({"id": {"$in": m_ids}}, {"_id": 0}).to_list(500) if m_ids else []
    locs = await db.rahaza_locations.find({"id": {"$in": loc_ids}}, {"_id": 0}).to_list(500) if loc_ids else []
    m_map = {m["id"]: m for m in mats}
    l_map = {l["id"]: l for l in locs}
    for it in (mi.get("items") or []):
        m = m_map.get(it.get("material_id")) or {}
        l = l_map.get(it.get("location_id")) or {}
        it["material_code"] = m.get("code")
        it["material_name"] = m.get("name")
        it["unit"] = m.get("unit")
        it["material_type"] = m.get("type")
        it["location_code"] = l.get("code")
        it["location_name"] = l.get("name")
    return mi


def _norm_mi_items(raw_items):
    cleaned = []
    for it in raw_items or []:
        mid = it.get("material_id")
        qty_req = float(it.get("qty_required") or 0)
        if not mid or qty_req <= 0:
            continue
        cleaned.append({
            "id": it.get("id") or _uid(),
            "material_id": mid,
            "qty_required": round(qty_req, 4),
            "qty_issued":   round(float(it.get("qty_issued") or 0), 4),
            "location_id":  it.get("location_id") or None,
            "notes":        it.get("notes") or "",
        })
    return cleaned


async def _require_mi_approver(request: Request):
    user = await require_auth(request)
    role = (user.get("role") or "").lower()
    if role in ("superadmin", "owner", "manager", "ppic", "warehouse_manager", "production_manager"):
        return user
    perms = user.get("_permissions") or []
    if "*" in perms or "inventory.approve" in perms or "warehouse.approve" in perms:
        return user
    raise HTTPException(403, "Forbidden: hanya Manager/PPIC/Warehouse Manager yang boleh approve MI.")
