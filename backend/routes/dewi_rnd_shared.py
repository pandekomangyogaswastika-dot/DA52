"""dewi_rnd — shared router instance + helper utilities.
Di-import oleh semua sub-modul dewi_rnd_*.py.
"""
from fastapi import APIRouter
from datetime import datetime, timezone
import uuid

router = APIRouter(prefix="/api/dewi/rnd", tags=["RnD"])


def now_utc():
    return datetime.now(timezone.utc)


def sid():
    return str(uuid.uuid4())


def serialize(doc):
    if doc is None:
        return None
    doc = dict(doc)
    doc.pop('_id', None)
    for k, v in doc.items():
        if isinstance(v, datetime):
            doc[k] = v.isoformat()
    return doc
