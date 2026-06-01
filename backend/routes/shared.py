"""
Shared utilities for all route modules.
Common helpers, constants, and imports.
"""
import uuid
from datetime import datetime, timezone

# Valid PO statuses (staged lifecycle)
PO_STATUSES = [
    "Draft", "Confirmed", "Distributed", "In Production", 
    "Production Complete", "Variance Review", "Return Review",
    "Ready to Close", "Closed"
]

def new_id():
    return str(uuid.uuid4())

def now():
    return datetime.now(timezone.utc)

def parse_date(d):
    if not d:
        return None
    if isinstance(d, datetime):
        return d
    try:
        return datetime.fromisoformat(str(d).replace('Z', '+00:00'))
    except Exception:
        return None

def to_end_of_day(d):
    if isinstance(d, str):
        d = parse_date(d)
    if d:
        return d.replace(hour=23, minute=59, second=59, microsecond=999999)
    return None

async def enrich_with_product_photos(items, db):
    """Add product photo_url to items that have a product_name. Single batch query."""
    if not items:
        return items
    pnames = list({(it.get('product_name') or '').strip() for it in items if it.get('product_name')})
    photos = {}
    if pnames:
        async for prod in db.products.find(
            {'product_name': {'$in': pnames}}, {'_id': 0, 'product_name': 1, 'photo_url': 1}
        ):
            photos[prod['product_name']] = prod.get('photo_url', '')
    for item in items:
        pname = item.get('product_name', '')
        if pname:
            item['product_photo'] = photos.get(pname, '')
    return items

def _fmt_date(v):
    if not v:
        return '-'
    s = str(v)[:10]
    return s if s != 'None' else '-'

def _fmt_num(v):
    try:
        return f"{int(v):,}".replace(',', '.')
    except (ValueError, TypeError):
        return str(v or 0)

def _fmt_money(v):
    try:
        return f"Rp {int(v):,}".replace(',', '.')
    except (ValueError, TypeError):
        return 'Rp 0'


# ═══════════════════════════════════════════════════════════════════════════════
# PAGINATION HELPER
# ═══════════════════════════════════════════════════════════════════════════════

def get_pagination_params(request, default_limit=50, max_limit=200):
    """Extract pagination parameters from query string."""
    try:
        page = max(1, int(request.query_params.get("page", 1)))
        limit = min(max_limit, max(1, int(request.query_params.get("limit", default_limit))))
    except (ValueError, TypeError):
        page = 1
        limit = default_limit
    skip = (page - 1) * limit
    return page, limit, skip

def paginated_response(items, total, page, limit):
    """Create a standard paginated response."""
    total_pages = max(1, -(-total // limit))  # Ceiling division
    return {
        "items": items,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": total_pages,
            "has_next": page < total_pages,
            "has_prev": page > 1,
        }
    }


# ═══════════════════════════════════════════════════════════════════════════════
# PORTAL RBAC HELPER
# ═══════════════════════════════════════════════════════════════════════════════

PORTAL_ACCESS = {
    "management": ["superadmin", "admin"],
    "production": ["superadmin", "admin", "vendor"],
    "warehouse": ["superadmin", "admin"],
    "marketing": ["superadmin", "admin", "buyer"],
    "finance": ["superadmin", "admin"],
    "rnd": ["superadmin", "admin"],
}

def check_portal_access(user, portal_id):
    """Check if a user role has access to a given portal."""
    role = user.get("role", "")
    if role == "superadmin":
        return True
    allowed = PORTAL_ACCESS.get(portal_id, [])
    return role in allowed

def get_user_portals(user):
    """Get list of portal IDs the user can access."""
    role = user.get("role", "")
    if role == "superadmin":
        return list(PORTAL_ACCESS.keys())
    return [pid for pid, roles in PORTAL_ACCESS.items() if role in roles]
