"""dewi_rnd — Style Master + Design Selection Approval Workflow (GAP-R2)."""
from fastapi import Depends, HTTPException
from database import get_db
from auth import require_auth
from routes.dewi_rnd_shared import router, now_utc, sid, serialize

# ──────────────────────────────────────────────────────────────────────────────
# STYLE MASTER (Master Style & Tech Pack)
# ──────────────────────────────────────────────────────────────────────────────

@router.get('/styles')
async def list_styles(
    status: str = None,
    category: str = None,
    buyer: str = None,
    rnd_type: str = None,
    search: str = None,
    limit: int = 200,
    user: dict = Depends(require_auth),
):
    """List semua styles"""
    db = get_db()
    q = {}
    if status:
        q['status'] = status
    if category:
        q['category'] = category
    if buyer:
        q['buyer'] = buyer
    if rnd_type:
        q['rnd_type'] = rnd_type
    if search:
        import re
        q['$or'] = [
            {'style_code': {'$regex': re.escape(search), '$options': 'i'}},
            {'style_name': {'$regex': re.escape(search), '$options': 'i'}},
        ]

    styles = await db.dewi_rnd_styles.find(q).sort('created_at', -1).limit(limit).to_list(length=limit)
    return [serialize(s) for s in styles]


@router.get('/styles/pending-review')
async def list_styles_pending_review(user: dict = Depends(require_auth)):
    """List styles yang menunggu review owner"""
    db = get_db()
    styles = await db.dewi_rnd_styles.find(
        {'status': 'pending_owner_review'}, {'_id': 0}
    ).sort('submitted_for_review_at', -1).to_list(100)
    return [serialize(s) for s in styles]


@router.post('/styles')
async def create_style(body: dict, user: dict = Depends(require_auth)):
    """Create new style"""
    db = get_db()
    code = (body.get('style_code') or '').strip().upper()
    name = (body.get('style_name') or '').strip()

    if not code or not name:
        raise HTTPException(400, 'style_code dan style_name wajib diisi')

    existing = await db.dewi_rnd_styles.find_one({'style_code': code})
    if existing:
        raise HTTPException(409, f'Style code {code} sudah ada')

    doc = {
        'id': sid(),
        'style_code': code,
        'style_name': name,
        'category': body.get('category', ''),
        'buyer': body.get('buyer', ''),
        'fabric_type': body.get('fabric_type', ''),
        'season': body.get('season', ''),
        'description': body.get('description', ''),
        'status': body.get('status', 'draft'),
        'rnd_type': body.get('rnd_type', 'internal_product'),
        'client_id': body.get('client_id', None),
        'client_name': body.get('client_name', ''),
        'promoted_to_model_id': None,
        'techpack_url': None,
        'techpack_name': None,
        'design_images': [],
        'variants': [],
        'created_by': user['id'],
        'created_by_name': user.get('name', ''),
        'created_at': now_utc(),
        'updated_at': now_utc(),
    }
    await db.dewi_rnd_styles.insert_one(doc)
    return serialize(doc)


@router.get('/styles/{style_id}')
async def get_style(style_id: str, user: dict = Depends(require_auth)):
    """Get style by ID"""
    db = get_db()
    s = await db.dewi_rnd_styles.find_one({'id': style_id})
    if not s:
        raise HTTPException(404, 'Style tidak ditemukan')
    return serialize(s)


@router.put('/styles/{style_id}')
async def update_style(style_id: str, body: dict, user: dict = Depends(require_auth)):
    """Update style"""
    db = get_db()
    body.pop('_id', None)
    body.pop('id', None)
    body.pop('created_at', None)
    body.pop('created_by', None)
    body['updated_at'] = now_utc()

    if 'style_code' in body:
        body['style_code'] = body['style_code'].strip().upper()

    res = await db.dewi_rnd_styles.update_one({'id': style_id}, {'$set': body})
    if res.matched_count == 0:
        raise HTTPException(404, 'Style tidak ditemukan')

    updated = await db.dewi_rnd_styles.find_one({'id': style_id})
    return serialize(updated)


@router.delete('/styles/{style_id}')
async def delete_style(style_id: str, user: dict = Depends(require_auth)):
    """Delete style"""
    db = get_db()
    res = await db.dewi_rnd_styles.delete_one({'id': style_id})
    if res.deleted_count == 0:
        raise HTTPException(404, 'Style tidak ditemukan')
    return {'success': True}


# ── GAP-R2: Design Selection Approval Workflow ────────────────────────────────

@router.post('/styles/{style_id}/submit-for-review')
async def submit_style_for_review(
    style_id: str,
    body: dict = {},
    user: dict = Depends(require_auth),
):
    """RnD staff submits style for Owner review."""
    db = get_db()
    style = await db.dewi_rnd_styles.find_one({'id': style_id})
    if not style:
        raise HTTPException(404, 'Style tidak ditemukan')
    if style.get('status') not in ('draft', 'active'):
        raise HTTPException(
            400,
            f"Hanya style berstatus draft/active yang bisa diajukan review "
            f"(saat ini: {style.get('status')})",
        )

    now = now_utc()
    await db.dewi_rnd_styles.update_one(
        {'id': style_id},
        {'$set': {
            'status': 'pending_owner_review',
            'submitted_for_review_by': user.get('name', ''),
            'submitted_for_review_by_id': user.get('id', ''),
            'submitted_for_review_at': now,
            'review_notes': body.get('notes', ''),
            'owner_review_result': None,
            'owner_reviewed_by': None,
            'owner_reviewed_at': None,
            'owner_review_notes': None,
            'updated_at': now,
        }},
    )
    updated = await db.dewi_rnd_styles.find_one({'id': style_id})
    return serialize(updated)


@router.post('/styles/{style_id}/owner-approve')
async def owner_approve_style(
    style_id: str,
    body: dict = {},
    user: dict = Depends(require_auth),
):
    """Owner/SuperAdmin approves a style design."""
    db = get_db()
    style = await db.dewi_rnd_styles.find_one({'id': style_id})
    if not style:
        raise HTTPException(404, 'Style tidak ditemukan')
    if style.get('status') != 'pending_owner_review':
        raise HTTPException(
            400,
            f"Style harus berstatus pending_owner_review untuk disetujui "
            f"(saat ini: {style.get('status')})",
        )

    now = now_utc()
    await db.dewi_rnd_styles.update_one(
        {'id': style_id},
        {'$set': {
            'status': 'approved_for_launch',
            'owner_review_result': 'approved',
            'owner_reviewed_by': user.get('name', ''),
            'owner_reviewed_by_id': user.get('id', ''),
            'owner_reviewed_at': now,
            'owner_review_notes': body.get('notes', ''),
            'updated_at': now,
        }},
    )
    updated = await db.dewi_rnd_styles.find_one({'id': style_id})
    return serialize(updated)


@router.post('/styles/{style_id}/promote-to-production')
async def promote_style_to_production(
    style_id: str,
    body: dict = {},
    user: dict = Depends(require_auth),
):
    """Promote approved RnD Internal Style ke Production Model."""
    db = get_db()
    style = await db.dewi_rnd_styles.find_one({'id': style_id})
    if not style:
        raise HTTPException(404, 'Style tidak ditemukan')
    if style.get('rnd_type') == 'maklon_product':
        raise HTTPException(400, 'Style maklon tidak di-promote ke Production Model (produk milik buyer)')
    if style.get('status') != 'approved_for_launch':
        raise HTTPException(
            400,
            f"Style harus berstatus approved_for_launch untuk di-promote "
            f"(saat ini: {style.get('status')})",
        )
    if style.get('promoted_to_model_id'):
        raise HTTPException(400, 'Style sudah pernah di-promote ke Production Model')

    model_id = sid()
    model_code = body.get('model_code') or style['style_code']
    model_doc = {
        'id': model_id,
        'code': model_code,
        'name': style['style_name'],
        'category': style.get('category', ''),
        'fabric_type': style.get('fabric_type', ''),
        'description': style.get('description', ''),
        'rnd_style_id': style_id,
        'rnd_style_code': style['style_code'],
        'status': 'active',
        'created_by': user['id'],
        'created_by_name': user.get('name', ''),
        'created_at': now_utc(),
        'updated_at': now_utc(),
    }
    await db.rahaza_models.insert_one(model_doc)
    await db.dewi_rnd_styles.update_one(
        {'id': style_id},
        {'$set': {
            'promoted_to_model_id': model_id,
            'promoted_at': now_utc(),
            'promoted_by': user['id'],
            'updated_at': now_utc(),
        }},
    )
    return {
        'status': 'promoted',
        'model_id': model_id,
        'model_code': model_code,
        'message': f'Style {style["style_code"]} berhasil di-promote ke Production Model {model_code}',
    }


@router.post('/styles/{style_id}/owner-reject')
async def owner_reject_style(
    style_id: str,
    body: dict = {},
    user: dict = Depends(require_auth),
):
    """Owner/SuperAdmin rejects a style design."""
    db = get_db()
    style = await db.dewi_rnd_styles.find_one({'id': style_id})
    if not style:
        raise HTTPException(404, 'Style tidak ditemukan')
    if style.get('status') != 'pending_owner_review':
        raise HTTPException(
            400,
            f"Style harus berstatus pending_owner_review untuk ditolak "
            f"(saat ini: {style.get('status')})",
        )
    if not body.get('notes'):
        raise HTTPException(400, 'Catatan penolakan wajib diisi')

    now = now_utc()
    await db.dewi_rnd_styles.update_one(
        {'id': style_id},
        {'$set': {
            'status': 'draft',
            'owner_review_result': 'rejected',
            'owner_reviewed_by': user.get('name', ''),
            'owner_reviewed_by_id': user.get('id', ''),
            'owner_reviewed_at': now,
            'owner_review_notes': body.get('notes', ''),
            'updated_at': now,
        }},
    )
    updated = await db.dewi_rnd_styles.find_one({'id': style_id})
    return serialize(updated)
