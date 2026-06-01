"""/api/assets/scan-by-number/{asset_number} — LITERAL path lookup (must precede /{asset_id})."""
from fastapi import Request, HTTPException

from database import get_db
from auth import require_auth
from ._helpers import router, _ser


@router.get("/scan-by-number/{asset_number}")
async def get_asset_by_number(asset_number: str, request: Request):
    """Resolve asset by asset_number (untuk scanner apps)."""
    await require_auth(request)
    db = get_db()
    asset = await db.dewi_assets.find_one(
        {"asset_number": {"$regex": f"^{asset_number}$", "$options": "i"}},
        {"_id": 0},
    )
    if not asset:
        raise HTTPException(404, f"Aset dengan nomor '{asset_number}' tidak ditemukan.")
    return _ser(asset)
