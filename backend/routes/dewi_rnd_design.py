"""dewi_rnd — Dashboard + Variants + Patterns & Marking."""
from datetime import datetime
from fastapi import Depends, HTTPException
from database import get_db
from auth import require_auth
from routes.dewi_rnd_shared import router, now_utc, sid, serialize

# ──────────────────────────────────────────────────────────────────────────────
# DASHBOARD (Portal RnD)
# ──────────────────────────────────────────────────────────────────────────────

@router.get('/dashboard')
async def get_rnd_dashboard(user: dict = Depends(require_auth)):
    """Comprehensive RnD Portal dashboard stats + recent activity"""
    db = get_db()

    total_styles    = await db.dewi_rnd_styles.count_documents({})
    active_styles   = await db.dewi_rnd_styles.count_documents({'status': 'active'})
    draft_styles    = await db.dewi_rnd_styles.count_documents({'status': 'draft'})
    review_styles   = await db.dewi_rnd_styles.count_documents({'status': 'review'})

    total_samples    = await db.dewi_rnd_sample_requests.count_documents({})
    pending_samples  = await db.dewi_rnd_sample_requests.count_documents({'status': 'submitted'})
    approved_samples = await db.dewi_rnd_sample_requests.count_documents({'status': 'approved'})
    rejected_samples = await db.dewi_rnd_sample_requests.count_documents({'status': 'rejected'})

    total_materials = await db.dewi_rnd_materials.count_documents({})
    total_revisions = await db.dewi_rnd_revisions.count_documents({})
    total_patterns  = await db.dewi_rnd_patterns.count_documents({})
    total_hpp       = await db.dewi_rnd_hpp.count_documents({})
    total_variants  = await db.dewi_rnd_variants.count_documents({})

    recent_samples = await db.dewi_rnd_sample_requests.find(
        {}, {'_id': 0}
    ).sort('created_at', -1).limit(5).to_list(5)

    recent_styles = await db.dewi_rnd_styles.find(
        {}, {'_id': 0}
    ).sort('created_at', -1).limit(5).to_list(5)

    recent_hpp = await db.dewi_rnd_hpp.find(
        {}, {'_id': 0}
    ).sort('created_at', -1).limit(5).to_list(5)

    def fmt(docs):
        result = []
        for d in docs:
            d2 = dict(d)
            for k, v in d2.items():
                if isinstance(v, datetime):
                    d2[k] = v.isoformat()
            result.append(d2)
        return result

    return {
        'kpi': {
            'total_styles':    total_styles,
            'active_styles':   active_styles,
            'draft_styles':    draft_styles,
            'review_styles':   review_styles,
            'pending_samples': pending_samples,
            'approved_samples':approved_samples,
            'rejected_samples':rejected_samples,
            'total_samples':   total_samples,
            'total_materials': total_materials,
            'total_revisions': total_revisions,
            'total_patterns':  total_patterns,
            'total_hpp':       total_hpp,
            'total_variants':  total_variants,
        },
        'recent_samples': fmt(recent_samples),
        'recent_styles':  fmt(recent_styles),
        'recent_hpp':     fmt(recent_hpp),
    }


# ──────────────────────────────────────────────────────────────────────────────
# VARIANTS (Color × Size per Style)
# ──────────────────────────────────────────────────────────────────────────────

@router.get('/variants')
async def list_variants(
    style_id: str = None,
    user: dict = Depends(require_auth),
):
    db = get_db()
    q = {}
    if style_id:
        q['style_id'] = style_id
    docs = await db.dewi_rnd_variants.find(q, {'_id': 0}).sort('created_at', -1).to_list(500)
    return [serialize(d) for d in docs]


@router.post('/variants')
async def create_variant(body: dict, user: dict = Depends(require_auth)):
    db = get_db()
    doc = {
        'id':         sid(),
        'style_id':   body.get('style_id', ''),
        'style_code': body.get('style_code', ''),
        'style_name': body.get('style_name', ''),
        'color':      body.get('color', ''),
        'color_code': body.get('color_code', ''),
        'sizes':      body.get('sizes', []),
        'status':     body.get('status', 'active'),
        'notes':      body.get('notes', ''),
        'created_by':      user['id'],
        'created_by_name': user.get('name', ''),
        'created_at': now_utc(),
        'updated_at': now_utc(),
    }
    await db.dewi_rnd_variants.insert_one(doc)
    return serialize(doc)


@router.put('/variants/{variant_id}')
async def update_variant(variant_id: str, body: dict, user: dict = Depends(require_auth)):
    db = get_db()
    upd = {k: v for k, v in body.items() if k not in ('id', '_id', 'created_at', 'created_by')}
    upd['updated_at'] = now_utc()
    await db.dewi_rnd_variants.update_one({'id': variant_id}, {'$set': upd})
    return {'ok': True}


@router.delete('/variants/{variant_id}')
async def delete_variant(variant_id: str, user: dict = Depends(require_auth)):
    db = get_db()
    await db.dewi_rnd_variants.delete_one({'id': variant_id})
    return {'ok': True}


# ──────────────────────────────────────────────────────────────────────────────
# PATTERNS & MARKING (Dokumentasi Pola)
# ──────────────────────────────────────────────────────────────────────────────

@router.get('/patterns')
async def list_patterns(
    style_id: str = None,
    search: str = None,
    user: dict = Depends(require_auth),
):
    db = get_db()
    q: dict = {}
    if style_id:
        q['style_id'] = style_id
    if search:
        q['$or'] = [
            {'pattern_code':  {'$regex': search, '$options': 'i'}},
            {'style_name':    {'$regex': search, '$options': 'i'}},
        ]
    docs = await db.dewi_rnd_patterns.find(q, {'_id': 0}).sort('created_at', -1).to_list(500)
    return [serialize(d) for d in docs]


@router.post('/patterns')
async def create_pattern(body: dict, user: dict = Depends(require_auth)):
    db = get_db()
    doc = {
        'id':            sid(),
        'pattern_code':  body.get('pattern_code', ''),
        'style_id':      body.get('style_id', ''),
        'style_code':    body.get('style_code', ''),
        'style_name':    body.get('style_name', ''),
        'size_range':    body.get('size_range', ''),
        'total_pieces':  body.get('total_pieces', 0),
        'fabric_width':  body.get('fabric_width', 150),
        'fabric_usage_per_pcs': body.get('fabric_usage_per_pcs', 0.0),
        'hpp_fabric_per_pcs':   body.get('hpp_fabric_per_pcs', 0.0),
        'efficiency_pct':       body.get('efficiency_pct', 0.0),
        'marking_photo_url':    body.get('marking_photo_url', None),
        'pattern_file_url':     body.get('pattern_file_url', None),
        'notes':         body.get('notes', ''),
        'status':        body.get('status', 'draft'),
        'approved_by':   None,
        'approved_at':   None,
        'created_by':      user['id'],
        'created_by_name': user.get('name', ''),
        'created_at': now_utc(),
        'updated_at': now_utc(),
    }
    await db.dewi_rnd_patterns.insert_one(doc)
    return serialize(doc)


@router.put('/patterns/{pattern_id}')
async def update_pattern(pattern_id: str, body: dict, user: dict = Depends(require_auth)):
    db = get_db()
    upd = {k: v for k, v in body.items() if k not in ('id', '_id', 'created_at', 'created_by')}
    upd['updated_at'] = now_utc()
    await db.dewi_rnd_patterns.update_one({'id': pattern_id}, {'$set': upd})
    return {'ok': True}


@router.post('/patterns/{pattern_id}/approve')
async def approve_pattern(pattern_id: str, user: dict = Depends(require_auth)):
    db = get_db()
    await db.dewi_rnd_patterns.update_one(
        {'id': pattern_id},
        {'$set': {
            'status': 'approved',
            'approved_by': user.get('name', ''),
            'approved_at': now_utc(),
            'updated_at': now_utc(),
        }},
    )
    return {'ok': True}


@router.delete('/patterns/{pattern_id}')
async def delete_pattern(pattern_id: str, user: dict = Depends(require_auth)):
    db = get_db()
    await db.dewi_rnd_patterns.delete_one({'id': pattern_id})
    return {'ok': True}


# ── Marking Media Attachments (GAP-R4) ───────────────────────────────────────

@router.post('/patterns/{pattern_id}/attach-media')
async def attach_pattern_media(pattern_id: str, body: dict, user: dict = Depends(require_auth)):
    """Attach uploaded media (foto/video marking) to a pattern."""
    db = get_db()
    pat = await db.dewi_rnd_patterns.find_one({'id': pattern_id})
    if not pat:
        raise HTTPException(404, 'Pattern not found')

    media_item = {
        'attachment_id': body.get('attachment_id') or '',
        'storage_path':  body.get('storage_path') or '',
        'url':           body.get('url') or '',
        'content_type':  body.get('content_type') or '',
        'original_filename': body.get('original_filename') or '',
        'size':          int(body.get('size') or 0),
        'kind':          'video' if (body.get('content_type') or '').startswith('video') else 'photo',
        'uploaded_by':   user.get('name', ''),
        'uploaded_by_id': user.get('id', ''),
        'uploaded_at':   now_utc(),
    }
    media_list = pat.get('marking_media') or []
    media_list.append(media_item)
    await db.dewi_rnd_patterns.update_one(
        {'id': pattern_id},
        {'$set': {'marking_media': media_list, 'updated_at': now_utc()}},
    )
    media_item_resp = {**media_item, 'uploaded_at': media_item['uploaded_at'].isoformat()}
    return {'ok': True, 'media': media_item_resp, 'total_media': len(media_list)}


@router.delete('/patterns/{pattern_id}/media/{attachment_id}')
async def remove_pattern_media(
    pattern_id: str,
    attachment_id: str,
    user: dict = Depends(require_auth),
):
    db = get_db()
    pat = await db.dewi_rnd_patterns.find_one({'id': pattern_id})
    if not pat:
        raise HTTPException(404, 'Pattern not found')

    media_list = [m for m in (pat.get('marking_media') or []) if m.get('attachment_id') != attachment_id]
    await db.dewi_rnd_patterns.update_one(
        {'id': pattern_id},
        {'$set': {'marking_media': media_list, 'updated_at': now_utc()}},
    )
    return {'ok': True, 'total_media': len(media_list)}
