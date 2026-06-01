"""
Line Monitoring Service — Real-time production line aggregation.

Phase 2 Task 2.2 — Real-time Line Monitoring Dashboard.

Aggregates state per line with status rules:
  - 🟢 running   : any output event ≤ 30 min ago AND no open downtime
  - 🔴 downtime  : any rahaza_machine_downtime with status='open'
  - 🟡 idle      : no output ≤ 30 min ago AND no open downtime
  - ⚠️ behind    : achievement_pct < expected_progress_pct - 20

All datetimes are timezone-aware UTC. Output / qc events come from
`rahaza_wip_events`. Downtime comes from `rahaza_machine_downtime`. Lines come
from `rahaza_lines` and assignments (target + operator) from
`rahaza_line_assignments`.

This module is read-only (aggregator) — NO writes.
"""
from datetime import datetime, timezone, timedelta


DEFAULT_SHIFT_MINUTES = 8 * 60  # 8-hour shift baseline
RUNNING_WINDOW_MIN = 30  # if output within last 30 min → running
BEHIND_THRESHOLD_PCT = 20  # achievement < expected - 20 → behind
DOWNTIME_ALERT_MIN = 30  # downtime > 30 min triggers alert
FPY_ALERT_THRESHOLD = 0.90  # FPY < 90% triggers alert
SPARKLINE_HOURS = 8  # hours of history for mini chart


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _today_bounds_utc() -> tuple[datetime, datetime]:
    """Return [start_of_today_utc, now_utc]."""
    now = _now_utc()
    start = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
    return start, now


def _today_iso() -> str:
    return _now_utc().date().isoformat()


def _safe_pct(num: float, denom: float) -> float:
    if not denom or denom <= 0:
        return 0.0
    return round(min(100.0, max(0.0, (num / denom) * 100)), 1)


class LineMonitoringService:
    def __init__(self, db):
        self.db = db

    async def get_live_status(self) -> dict:
        """
        Snapshot all active lines with live metrics.
        Returns dict {meta, kpis, lines: []}.
        """
        now = _now_utc()
        today_start, _ = _today_bounds_utc()
        today_iso = _today_iso()
        running_cutoff = now - timedelta(minutes=RUNNING_WINDOW_MIN)
        sparkline_cutoff = now - timedelta(hours=SPARKLINE_HOURS)

        # 1) Active lines
        lines = await self.db.rahaza_lines.find(
            {"active": True}, {"_id": 0}
        ).sort("code", 1).to_list(500)

        if not lines:
            return {
                "meta": {
                    "as_of": now.isoformat(),
                    "today": today_iso,
                    "total_lines": 0,
                },
                "kpis": self._empty_kpis(),
                "lines": [],
            }

        line_ids = [ln["id"] for ln in lines]

        # 2) Today's assignments (target_qty + operator)
        assigns = await self.db.rahaza_line_assignments.find({
            "line_id": {"$in": line_ids},
            "assign_date": today_iso,
            "active": True,
        }, {"_id": 0}).to_list(500)

        assign_by_line: dict[str, dict] = {}
        target_by_line: dict[str, int] = {}
        for a in assigns:
            lid = a.get("line_id")
            if not lid:
                continue
            target_by_line[lid] = target_by_line.get(lid, 0) + int(a.get("target_qty") or 0)
            # keep first/primary assignment for display
            if lid not in assign_by_line:
                assign_by_line[lid] = a

        # Enrich assignment with operator + model name
        op_ids = list({a.get("operator_id") for a in assign_by_line.values() if a.get("operator_id")})
        op_map = {}
        if op_ids:
            ops = await self.db.rahaza_employees.find(
                {"id": {"$in": op_ids}}, {"_id": 0, "id": 1, "name": 1, "code": 1}
            ).to_list(500)
            op_map = {o["id"]: o for o in ops}

        model_ids = list({a.get("model_id") for a in assign_by_line.values() if a.get("model_id")})
        model_map = {}
        if model_ids:
            mods = await self.db.rahaza_models.find(
                {"id": {"$in": model_ids}}, {"_id": 0, "id": 1, "name": 1, "code": 1}
            ).to_list(500)
            model_map = {m["id"]: m for m in mods}

        # 3) Today's output / qc per line (aggregate)
        today_pipe = [
            {"$match": {
                "line_id": {"$in": line_ids},
                "event_type": {"$in": ["output", "qc_pass", "qc_fail"]},
                "timestamp": {"$gte": today_start, "$lte": now},
            }},
            {"$group": {
                "_id": {"line_id": "$line_id", "event_type": "$event_type"},
                "qty": {"$sum": "$qty"},
            }},
        ]
        today_rows = await self.db.rahaza_wip_events.aggregate(today_pipe).to_list(2000)
        today_output: dict[str, int] = {}
        today_qc_pass: dict[str, int] = {}
        today_qc_fail: dict[str, int] = {}
        for r in today_rows:
            lid = r["_id"]["line_id"]
            et = r["_id"]["event_type"]
            q = int(r.get("qty") or 0)
            if et == "output":
                today_output[lid] = today_output.get(lid, 0) + q
            elif et == "qc_pass":
                today_qc_pass[lid] = today_qc_pass.get(lid, 0) + q
            elif et == "qc_fail":
                today_qc_fail[lid] = today_qc_fail.get(lid, 0) + q

        # 4) Last 30 min output per line (for running detection)
        recent_pipe = [
            {"$match": {
                "line_id": {"$in": line_ids},
                "event_type": "output",
                "timestamp": {"$gte": running_cutoff, "$lte": now},
            }},
            {"$group": {
                "_id": "$line_id",
                "qty": {"$sum": "$qty"},
                "last_ts": {"$max": "$timestamp"},
            }},
        ]
        recent_rows = await self.db.rahaza_wip_events.aggregate(recent_pipe).to_list(500)
        recent_output: dict[str, dict] = {
            r["_id"]: {"qty": int(r.get("qty") or 0), "last_ts": r.get("last_ts")}
            for r in recent_rows
        }

        # 5) Hourly sparkline (last 8 hours) per line
        sparkline_pipe = [
            {"$match": {
                "line_id": {"$in": line_ids},
                "event_type": "output",
                "timestamp": {"$gte": sparkline_cutoff, "$lte": now},
            }},
            {"$project": {
                "line_id": 1,
                "qty": 1,
                "hour": {"$dateToString": {"format": "%Y-%m-%dT%H", "date": "$timestamp"}},
            }},
            {"$group": {
                "_id": {"line_id": "$line_id", "hour": "$hour"},
                "qty": {"$sum": "$qty"},
            }},
        ]
        sparkline_rows = await self.db.rahaza_wip_events.aggregate(sparkline_pipe).to_list(5000)
        sparkline_map: dict[str, dict[str, int]] = {}
        for r in sparkline_rows:
            lid = r["_id"]["line_id"]
            hr = r["_id"]["hour"]
            sparkline_map.setdefault(lid, {})[hr] = int(r.get("qty") or 0)

        # Build hour buckets array (rounded down to hour)
        cur_hour = now.replace(minute=0, second=0, microsecond=0)
        hour_buckets = [
            (cur_hour - timedelta(hours=SPARKLINE_HOURS - 1 - i))
            for i in range(SPARKLINE_HOURS)
        ]
        hour_keys = [h.strftime("%Y-%m-%dT%H") for h in hour_buckets]

        # 6) Open downtime per line
        open_dt = await self.db.rahaza_machine_downtime.find(
            {"line_id": {"$in": line_ids}, "status": "open"},
            {"_id": 0},
        ).to_list(500)
        open_dt_by_line: dict[str, dict] = {}
        for d in open_dt:
            lid = d.get("line_id")
            if not lid:
                continue
            # If multiple open events, keep the earliest (most concerning)
            existing = open_dt_by_line.get(lid)
            if not existing or (d.get("start_at") or "") < (existing.get("start_at") or ""):
                open_dt_by_line[lid] = d

        # 7) Total downtime minutes today per line (sum of resolved + open elapsed)
        today_dt = await self.db.rahaza_machine_downtime.find(
            {
                "line_id": {"$in": line_ids},
                "start_at": {"$gte": today_iso, "$lte": today_iso + "T23:59:59Z"},
            },
            {"_id": 0},
        ).to_list(1000)
        downtime_min_today: dict[str, float] = {}
        for d in today_dt:
            lid = d.get("line_id")
            if not lid:
                continue
            try:
                start_dt = datetime.fromisoformat(d["start_at"].replace("Z", "+00:00"))
                end_str = d.get("end_at")
                if end_str:
                    end_dt = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
                else:
                    end_dt = now  # still open
                minutes = max(0, (end_dt - start_dt).total_seconds() / 60.0)
                downtime_min_today[lid] = downtime_min_today.get(lid, 0.0) + minutes
            except Exception:
                continue

        # 8) Build per-line snapshot
        line_rows = []
        elapsed_min_today = (now - today_start).total_seconds() / 60.0
        expected_progress_pct = _safe_pct(elapsed_min_today, DEFAULT_SHIFT_MINUTES)

        for ln in lines:
            lid = ln["id"]
            target = target_by_line.get(lid, 0)
            output = today_output.get(lid, 0)
            qc_p = today_qc_pass.get(lid, 0)
            qc_f = today_qc_fail.get(lid, 0)
            recent = recent_output.get(lid, {"qty": 0, "last_ts": None})
            dt_open = open_dt_by_line.get(lid)
            dt_min = downtime_min_today.get(lid, 0.0)

            # Achievement %
            achievement = _safe_pct(output, target) if target > 0 else 0.0

            # FPY (today)
            qc_total = qc_p + qc_f
            fpy = round((qc_p / qc_total) * 100, 1) if qc_total > 0 else (100.0 if output > 0 else 0.0)

            # Hourly rate (last 60 min)
            hour_cutoff = now - timedelta(minutes=60)
            hour_qty = 0
            for hr_key, qty in sparkline_map.get(lid, {}).items():
                try:
                    hr_dt = datetime.strptime(hr_key, "%Y-%m-%dT%H").replace(tzinfo=timezone.utc)
                    if hr_dt >= hour_cutoff:
                        hour_qty += qty
                except Exception:
                    pass
            hourly_rate = hour_qty  # last 60 min approx

            # Sparkline 8h
            sparkline = [sparkline_map.get(lid, {}).get(k, 0) for k in hour_keys]

            # Status determination
            if dt_open:
                status = "downtime"
            elif recent["qty"] > 0:
                # has output in last 30 min
                if target > 0 and achievement < (expected_progress_pct - BEHIND_THRESHOLD_PCT):
                    status = "behind"
                else:
                    status = "running"
            else:
                if target > 0 and achievement < (expected_progress_pct - BEHIND_THRESHOLD_PCT) and output > 0:
                    status = "behind"
                else:
                    status = "idle"

            # Active downtime details
            active_downtime = None
            if dt_open:
                try:
                    start_dt = datetime.fromisoformat(dt_open["start_at"].replace("Z", "+00:00"))
                    elapsed_min = max(0, (now - start_dt).total_seconds() / 60.0)
                except Exception:
                    elapsed_min = 0
                active_downtime = {
                    "id": dt_open.get("id"),
                    "reason_code": dt_open.get("reason_code"),
                    "reason_name": dt_open.get("reason_name") or dt_open.get("notes") or "Downtime",
                    "machine_id": dt_open.get("machine_id"),
                    "start_at": dt_open.get("start_at"),
                    "elapsed_min": round(elapsed_min, 1),
                }

            # Operator + model display
            assign = assign_by_line.get(lid, {})
            op = op_map.get(assign.get("operator_id", ""), {})
            model = model_map.get(assign.get("model_id", ""), {})

            line_rows.append({
                "line_id": lid,
                "line_code": ln.get("code"),
                "line_name": ln.get("name"),
                "location_name": ln.get("location_name"),
                "capacity_per_hour": ln.get("capacity_per_hour") or 0,
                "status": status,
                "operator_name": op.get("name") or assign.get("operator_name") or "",
                "shift_name": assign.get("shift_name") or "",
                "model_name": model.get("name") or assign.get("model_name") or "",
                "target_qty": target,
                "output_qty": output,
                "achievement_pct": achievement,
                "hourly_rate": hourly_rate,
                "fpy_pct": fpy,
                "qc_pass": qc_p,
                "qc_fail": qc_f,
                "last_output_at": recent["last_ts"].isoformat() if isinstance(recent["last_ts"], datetime) else None,
                "downtime_min_today": round(dt_min, 1),
                "active_downtime": active_downtime,
                "sparkline_8h": sparkline,
                "sparkline_hours": hour_keys,
            })

        # 9) Aggregate KPIs
        kpis = self._build_kpis(line_rows, expected_progress_pct)

        return {
            "meta": {
                "as_of": now.isoformat(),
                "today": today_iso,
                "total_lines": len(line_rows),
                "expected_progress_pct": expected_progress_pct,
                "running_window_min": RUNNING_WINDOW_MIN,
                "sparkline_hours": SPARKLINE_HOURS,
            },
            "kpis": kpis,
            "lines": line_rows,
        }

    async def get_alerts(self) -> dict:
        """
        Active production alerts:
          - downtime_long: open downtime > DOWNTIME_ALERT_MIN
          - fpy_low: today's FPY < FPY_ALERT_THRESHOLD (lines with qc data)
          - behind_schedule: lines tagged 'behind' in live status
        """
        snapshot = await self.get_live_status()
        alerts = []
        now = _now_utc()
        for ln in snapshot["lines"]:
            # Downtime > threshold
            ad = ln.get("active_downtime")
            if ad and ad.get("elapsed_min", 0) >= DOWNTIME_ALERT_MIN:
                alerts.append({
                    "type": "downtime_long",
                    "severity": "critical",
                    "line_id": ln["line_id"],
                    "line_code": ln["line_code"],
                    "line_name": ln["line_name"],
                    "message": f"Downtime aktif {ad['elapsed_min']:.0f} menit · {ad.get('reason_name', 'Downtime')}",
                    "elapsed_min": ad["elapsed_min"],
                    "since": ad.get("start_at"),
                })
            # FPY drop
            qc_total = ln["qc_pass"] + ln["qc_fail"]
            if qc_total >= 10 and (ln["fpy_pct"] / 100.0) < FPY_ALERT_THRESHOLD:
                alerts.append({
                    "type": "fpy_low",
                    "severity": "warning",
                    "line_id": ln["line_id"],
                    "line_code": ln["line_code"],
                    "line_name": ln["line_name"],
                    "message": f"FPY rendah {ln['fpy_pct']:.1f}% ({ln['qc_fail']}/{qc_total} defect)",
                    "fpy_pct": ln["fpy_pct"],
                    "qc_total": qc_total,
                    "since": ln.get("last_output_at"),
                })
            # Behind schedule
            if ln["status"] == "behind":
                alerts.append({
                    "type": "behind_schedule",
                    "severity": "warning",
                    "line_id": ln["line_id"],
                    "line_code": ln["line_code"],
                    "line_name": ln["line_name"],
                    "message": (
                        f"Tertinggal target · {ln['achievement_pct']:.1f}% "
                        f"vs expected {snapshot['meta']['expected_progress_pct']:.1f}%"
                    ),
                    "achievement_pct": ln["achievement_pct"],
                    "expected_pct": snapshot["meta"]["expected_progress_pct"],
                })

        # Sort: critical first, then by elapsed/severity
        sev_rank = {"critical": 0, "warning": 1, "info": 2}
        alerts.sort(key=lambda a: (sev_rank.get(a.get("severity", "info"), 9), -(a.get("elapsed_min", 0) or 0)))
        return {
            "as_of": now.isoformat(),
            "total_alerts": len(alerts),
            "critical_count": sum(1 for a in alerts if a["severity"] == "critical"),
            "warning_count": sum(1 for a in alerts if a["severity"] == "warning"),
            "alerts": alerts,
        }

    async def get_line_detail(self, line_id: str) -> dict:
        """Drill-down detail for a specific line — last 2 hours events."""
        now = _now_utc()
        cutoff = now - timedelta(hours=2)
        today_iso = _today_iso()

        line = await self.db.rahaza_lines.find_one({"id": line_id}, {"_id": 0})
        if not line:
            return {"error": f"Line {line_id} not found"}

        # Recent wip events
        events = await self.db.rahaza_wip_events.find(
            {"line_id": line_id, "timestamp": {"$gte": cutoff}},
            {"_id": 0},
        ).sort("timestamp", -1).limit(50).to_list(50)

        # Serialize timestamps
        for e in events:
            ts = e.get("timestamp")
            if isinstance(ts, datetime):
                e["timestamp"] = ts.isoformat()

        # Recent downtime (today)
        downtimes = await self.db.rahaza_machine_downtime.find(
            {
                "line_id": line_id,
                "start_at": {"$gte": today_iso},
            },
            {"_id": 0},
        ).sort("start_at", -1).limit(20).to_list(20)

        # Compute elapsed for open ones
        for d in downtimes:
            if d.get("status") == "open" and d.get("start_at"):
                try:
                    s = datetime.fromisoformat(d["start_at"].replace("Z", "+00:00"))
                    d["elapsed_min"] = round(max(0, (now - s).total_seconds() / 60.0), 1)
                except Exception:
                    d["elapsed_min"] = 0

        # Today's assignment
        assigns = await self.db.rahaza_line_assignments.find({
            "line_id": line_id,
            "assign_date": today_iso,
            "active": True,
        }, {"_id": 0}).to_list(20)

        return {
            "as_of": now.isoformat(),
            "line": {
                "id": line["id"],
                "code": line.get("code"),
                "name": line.get("name"),
                "location_name": line.get("location_name"),
                "capacity_per_hour": line.get("capacity_per_hour") or 0,
                "active": line.get("active", True),
            },
            "assignments_today": assigns,
            "wip_events_recent": events,
            "downtime_events_today": downtimes,
        }

    # ── Helpers ──────────────────────────────────────────────────────────
    @staticmethod
    def _empty_kpis() -> dict:
        return {
            "lines_total": 0, "lines_running": 0, "lines_idle": 0,
            "lines_downtime": 0, "lines_behind": 0,
            "output_total": 0, "target_total": 0,
            "achievement_avg_pct": 0.0,
            "fpy_avg_pct": 0.0,
            "downtime_min_total": 0.0,
            "alerts_active": 0,
        }

    def _build_kpis(self, lines: list, expected_progress_pct: float) -> dict:
        kpis = self._empty_kpis()
        kpis["lines_total"] = len(lines)
        if not lines:
            return kpis

        status_counts = {"running": 0, "idle": 0, "downtime": 0, "behind": 0}
        total_out, total_tgt, total_dt, fpy_sum, fpy_cnt, ach_sum, ach_cnt = 0, 0, 0.0, 0.0, 0, 0.0, 0
        alerts_active = 0

        for ln in lines:
            status_counts[ln["status"]] = status_counts.get(ln["status"], 0) + 1
            total_out += ln["output_qty"]
            total_tgt += ln["target_qty"]
            total_dt += ln["downtime_min_today"]
            if ln["target_qty"] > 0:
                ach_sum += ln["achievement_pct"]
                ach_cnt += 1
            if (ln["qc_pass"] + ln["qc_fail"]) > 0:
                fpy_sum += ln["fpy_pct"]
                fpy_cnt += 1
            if ln.get("active_downtime") and ln["active_downtime"].get("elapsed_min", 0) >= DOWNTIME_ALERT_MIN:
                alerts_active += 1
            if (ln["qc_pass"] + ln["qc_fail"]) >= 10 and (ln["fpy_pct"] / 100.0) < FPY_ALERT_THRESHOLD:
                alerts_active += 1
            if ln["status"] == "behind":
                alerts_active += 1

        kpis["lines_running"] = status_counts["running"]
        kpis["lines_idle"] = status_counts["idle"]
        kpis["lines_downtime"] = status_counts["downtime"]
        kpis["lines_behind"] = status_counts["behind"]
        kpis["output_total"] = total_out
        kpis["target_total"] = total_tgt
        kpis["achievement_avg_pct"] = round(ach_sum / ach_cnt, 1) if ach_cnt else 0.0
        kpis["fpy_avg_pct"] = round(fpy_sum / fpy_cnt, 1) if fpy_cnt else (100.0 if total_out > 0 else 0.0)
        kpis["downtime_min_total"] = round(total_dt, 1)
        kpis["alerts_active"] = alerts_active
        return kpis
