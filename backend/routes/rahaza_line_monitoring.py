"""
PT Rahaza — Phase 2 Task 2.2: Real-time Line Monitoring Dashboard.

Read-only aggregator endpoints under /api/rahaza/monitoring.

Endpoints:
  - GET /api/rahaza/monitoring/live-status
        → snapshot all active lines: status, hourly_rate, achievement, FPY,
          active downtime, sparkline (8h).
  - GET /api/rahaza/monitoring/alerts
        → active alerts: downtime>30m, FPY<90%, behind schedule.
  - GET /api/rahaza/monitoring/line/{line_id}/detail
        → drill-down per line: recent WIP events + downtime today.

No writes. Backed by existing collections (rahaza_lines, rahaza_wip_events,
rahaza_line_assignments, rahaza_machine_downtime).
"""
from fastapi import APIRouter, Request, HTTPException

from database import get_db
from auth import require_auth
from services.line_monitoring_service import LineMonitoringService


router = APIRouter(prefix="/api/rahaza/monitoring", tags=["rahaza-monitoring"])


@router.get("/live-status")
async def live_status(request: Request):
    """
    Real-time snapshot of all active production lines.

    Returns:
        {
          "meta": {
            "as_of": "<iso>", "today": "YYYY-MM-DD",
            "total_lines": int, "expected_progress_pct": float,
            "running_window_min": 30, "sparkline_hours": 8,
          },
          "kpis": {
            "lines_total", "lines_running", "lines_idle",
            "lines_downtime", "lines_behind",
            "output_total", "target_total",
            "achievement_avg_pct", "fpy_avg_pct",
            "downtime_min_total", "alerts_active",
          },
          "lines": [
            {
              "line_id", "line_code", "line_name", "location_name",
              "capacity_per_hour",
              "status": "running|idle|downtime|behind",
              "operator_name", "shift_name", "model_name",
              "target_qty", "output_qty", "achievement_pct",
              "hourly_rate", "fpy_pct", "qc_pass", "qc_fail",
              "last_output_at", "downtime_min_today",
              "active_downtime": {id, reason_code, reason_name, machine_id, start_at, elapsed_min} | null,
              "sparkline_8h": [int x 8],
              "sparkline_hours": ["YYYY-MM-DDTHH" x 8]
            }, ...
          ]
        }
    """
    await require_auth(request)
    db = get_db()
    service = LineMonitoringService(db)
    return await service.get_live_status()


@router.get("/alerts")
async def list_alerts(request: Request):
    """
    Active production alerts (downtime long, FPY low, behind schedule).

    Returns:
        {
          "as_of": "<iso>",
          "total_alerts": int,
          "critical_count": int,
          "warning_count": int,
          "alerts": [
            {
              "type": "downtime_long|fpy_low|behind_schedule",
              "severity": "critical|warning",
              "line_id", "line_code", "line_name",
              "message",
              ... type-specific extras
            }, ...
          ]
        }
    """
    await require_auth(request)
    db = get_db()
    service = LineMonitoringService(db)
    return await service.get_alerts()


@router.get("/line/{line_id}/detail")
async def line_detail(line_id: str, request: Request):
    """
    Drill-down detail for a specific line.

    Returns:
        {
          "as_of": "<iso>",
          "line": {id, code, name, location_name, capacity_per_hour, active},
          "assignments_today": [...],
          "wip_events_recent": [last 50 events in last 2 hours],
          "downtime_events_today": [last 20 downtime events today]
        }
    """
    await require_auth(request)
    db = get_db()
    service = LineMonitoringService(db)
    result = await service.get_line_detail(line_id)
    if "error" in result:
        raise HTTPException(404, result["error"])
    return result
