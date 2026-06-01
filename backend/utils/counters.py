"""
P3 TD-010 Part A — Shared Counter Helper
========================================
Single Source Of Truth (SSOT) for atomic sequence counters across the ERP.

Before consolidation:
  - `counters`         (generic; rahaza_lkp, rahaza_ap_from_gr, warehouse, rahaza_po)
  - `dewi_counters`    (dewi_maklon_billing, dewi_maklon_pos, dewi_cmt_progress)
  - `rahaza_counters`  (rahaza_sprint22 — `{name: ..., seq: ...}` schema variant)

After consolidation:
  - `counters` (SSOT)  with `{_id, seq, namespace}` shape
    - `_id`: counter key (e.g., "lkp_2026", "mkl_BUY01_2026", "mi_number")
    - `namespace`: discriminator (`generic` | `dewi` | `rahaza` | …)
    - `seq`: atomic sequence integer

Pattern:
    from utils.counters import next_counter, next_counter_batch

    n = await next_counter(db, "lkp_2026", namespace="rahaza")
    # → returns increment-by-1, upsert behavior preserved

    start_seq = await next_counter_batch(db, "mi_number", count=5, namespace="rahaza")
    # → returns the FIRST seq of the reserved range (atomic batch)

Migration script: /app/backend/migrations/migrate_counters_unification.py
"""
from __future__ import annotations
from pymongo import ReturnDocument
from typing import Optional


async def next_counter(db, key: str, *, namespace: str = 'generic') -> int:
    """Atomically increment counter for `key` by 1 and return new seq.

    Uses upsert + ReturnDocument.AFTER. `namespace` is recorded on first
    insert for traceability but does NOT participate in uniqueness — `_id`
    (the key) is globally unique across the unified `counters` collection.
    """
    doc = await db.counters.find_one_and_update(
        {'_id': key},
        {
            '$inc': {'seq': 1},
            '$setOnInsert': {'namespace': namespace},
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return int(doc['seq'])


async def next_counter_batch(
    db, key: str, *, count: int, namespace: str = 'generic',
) -> int:
    """Atomically reserve `count` consecutive seq values; return FIRST in range.

    Example: if current seq=10 and count=3, returns 11 (range 11..13 reserved).
    Useful for batch creation (e.g., multiple work orders in one mutation).
    """
    if count < 1:
        raise ValueError('count must be >= 1')
    doc = await db.counters.find_one_and_update(
        {'_id': key},
        {
            '$inc': {'seq': count},
            '$setOnInsert': {'namespace': namespace},
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return int(doc['seq']) - count + 1


async def peek_counter(db, key: str) -> Optional[int]:
    """Read current seq without incrementing (returns None if counter absent)."""
    doc = await db.counters.find_one({'_id': key}, {'seq': 1})
    return int(doc['seq']) if doc else None
