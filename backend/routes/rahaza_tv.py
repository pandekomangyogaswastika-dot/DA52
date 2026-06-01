"""
PT Rahaza ERP — Shop-Floor TV Mode (Phase 18C)

Public read-only endpoints untuk tampilan TV mode di lantai pabrik.

⚠️  Auth-by-design: Endpoint TV adalah PUBLIC karena dipasang di kiosk/TV
display yang tidak mendukung login interaktif. Endpoint hanya menampilkan
agregat lantai (output, target, andon, alert) — tidak ada data finansial,
gaji, atau identitas pribadi karyawan. Dilist sebagai "Routes without auth"
oleh audit script — itu memang disengaja, bukan bug.

Endpoints:
  GET /api/tv/floor      — data semua line untuk floor view
  GET /api/tv/line/{id}  — detail satu line
  GET /api/tv/alerts     — alert/notification terbaru untuk ticker
  GET /api/tv/clock      — server time + shift aktif
"""
from fastapi import APIRouter
from database import get_db
from datetime import datetime, timezone, date
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/tv", tags=["TV Mode"])


def _ser(doc: dict) -> dict:
    doc = {k: v for k, v in doc.items() if k != "_id"}
    for k, v in list(doc.items()):
        if isinstance(v, datetime):
            doc[k] = v.isoformat()
    return doc


@router.get("/clock")
async def tv_clock():
    """Server clock + today date."""
    now = datetime.now(timezone.utc)
    return {
        "server_time": now.isoformat(),
        "today": date.today().isoformat(),
    }


@router.get("/floor")
async def tv_floor():
    """
    Aggregated floor data for TV: per-line today summary.
    Returns list of line cards with KPIs.
    """
    db = get_db()
    today = date.today().isoformat()

    # Fetch lines
    lines = await db.rahaza_lines.find({"active": True}, {"_id": 0}).to_list(500)

    # Fetch today's assignments
    assignments = await db.rahaza_line_assignments.find(
        {"assign_date": today, "active": True}, {"_id": 0}
    ).to_list(500)

    # Aggregate output by line from wip_events
    agg_cursor = db.rahaza_wip_events.aggregate([
        {"$match": {"date": today, "event_type": "output"}},
        {"$group": {"_id": "$line_id", "total_output": {"$sum": "$qty"}}},
    ])
    line_outputs = {d["_id"]: d["total_output"] async for d in agg_cursor}

    # Aggregate QC events by line
    qc_cursor = db.rahaza_wip_events.aggregate([
        {"$match": {"date": today, "event_type": {"$in": ["qc_pass", "qc_fail"]}}},
        {"$group": {
            "_id": "$line_id",
            "total_pass": {"$sum": {"$cond": [{"$eq": ["$event_type", "qc_pass"]}, "$qty", 0]}},
            "total_fail": {"$sum": {"$cond": [{"$eq": ["$event_type", "qc_fail"]}, "$qty", 0]}},
        }},
    ])
    line_qc = {d["_id"]: d async for d in qc_cursor}

    # Aggregate target by line
    line_targets = {}
    for a in assignments:
        lid = a.get("line_id", "")
        if lid not in line_targets:
            line_targets[lid] = 0
        line_targets[lid] += a.get("target_qty", 0)

    # Active andon events by line
    andon_events = await db.rahaza_andon_events.find(
        {"status": "active"}, {"_id": 0, "line_id": 1, "type": 1, "type_label": 1}
    ).to_list(500)
    line_andons = {}
    for ae in andon_events:
        lid = ae.get("line_id", "")
        line_andons.setdefault(lid, []).append(ae)

    # Build line cards
    cards = []
    for line in lines:
        lid = line["id"]
        total_out = line_outputs.get(lid, 0)
        target = line_targets.get(lid, 0)
        pct = round(total_out / target * 100) if target > 0 else 0
        qc_data = line_qc.get(lid, {})
        qc_pass = qc_data.get("total_pass", 0)
        qc_fail = qc_data.get("total_fail", 0)
        qc_total = qc_pass + qc_fail
        fail_rate = round(qc_fail / qc_total * 100, 1) if qc_total > 0 else 0
        active_andons = line_andons.get(lid, [])

        cards.append({
            "line_id": lid,
            "line_code": line.get("code", ""),
            "line_name": line.get("name", ""),
            "output_today": total_out,
            "target_today": target,
            "pct_target": pct,
            "behind_target": target > 0 and pct < 70,
            "qc_pass": qc_pass,
            "qc_fail": qc_fail,
            "qc_fail_rate_pct": fail_rate,
            "qc_spike": fail_rate > 15 and qc_total >= 5,
            "active_andons": len(active_andons),
            "andon_types": [a["type_label"] for a in active_andons],
            "has_assignments": lid in line_targets,
        })

    # Sort: andons first, then behind-target, then by line code
    cards.sort(key=lambda c: (
        -(c["active_andons"] > 0),
        -(c["behind_target"]),
        c["line_code"]
    ))

    # Summary KPIs
    total_output = sum(c["output_today"] for c in cards)
    total_target = sum(c["target_today"] for c in cards)
    total_pct = round(total_output / total_target * 100) if total_target > 0 else 0

    return {
        "today": today,
        "server_time": datetime.now(timezone.utc).isoformat(),
        "kpi": {
            "total_output": total_output,
            "total_target": total_target,
            "pct_target": total_pct,
            "total_behind": sum(1 for c in cards if c["behind_target"]),
            "total_andon": sum(c["active_andons"] for c in cards),
            "active_lines": len([c for c in cards if c["has_assignments"]]),
        },
        "lines": cards,
    }


@router.get("/line/{line_id}")
async def tv_line_detail(line_id: str):
    """Detail data for one line (TV per-line mode)."""
    db = get_db()
    today = date.today().isoformat()

    line = await db.rahaza_lines.find_one({"id": line_id}, {"_id": 0})
    if not line:
        return {"error": "Line tidak ditemukan"}

    # Assignments today for this line
    assignments = await db.rahaza_line_assignments.find(
        {"assign_date": today, "active": True, "line_id": line_id},
        {"_id": 0},
    ).to_list(500)

    # Recent wip events (last 20)
    events = await db.rahaza_wip_events.find(
        {"line_id": line_id, "date": today},
        {"_id": 0, "event_type": 1, "qty": 1, "timestamp": 1, "process_code": 1},
    ).sort("timestamp", -1).limit(20).to_list(500)
    events = [_ser(e) for e in events]

    # Totals
    output_today = sum(e["qty"] for e in events if e["event_type"] == "output")
    qc_pass = sum(e["qty"] for e in events if e["event_type"] == "qc_pass")
    qc_fail = sum(e["qty"] for e in events if e["event_type"] == "qc_fail")
    target_today = sum(a.get("target_qty", 0) for a in assignments)
    pct = round(output_today / target_today * 100) if target_today > 0 else 0

    # Active andons
    andons = await db.rahaza_andon_events.find(
        {"status": "active", "line_id": line_id}, {"_id": 0}
    ).to_list(500)

    return {
        "line": _ser(line),
        "today": today,
        "server_time": datetime.now(timezone.utc).isoformat(),
        "output_today": output_today,
        "target_today": target_today,
        "pct_target": pct,
        "behind_target": target_today > 0 and pct < 70,
        "qc_pass": qc_pass,
        "qc_fail": qc_fail,
        "assignments": assignments,
        "recent_events": events,
        "active_andons": [_ser(a) for a in andons],
    }


@router.get("/alerts")
async def tv_alerts(limit: int = 10):
    """Recent alerts/notifications for ticker bar (reads SSOT type='rahaza')."""
    db = get_db()
    cursor = db.notifications.find(
        {"type": "rahaza", "meta.dismissed": {"$ne": True}},
        {"_id": 0, "subtype": 1, "title": 1, "body": 1, "severity": 1, "created_at": 1},
    ).sort("created_at", -1).limit(limit)
    out = []
    async for n in cursor:
        out.append(_ser({
            "type": n.get("subtype"),
            "title": n.get("title"),
            "message": n.get("body"),
            "severity": n.get("severity"),
            "created_at": n.get("created_at"),
        }))
    return {"alerts": out}
