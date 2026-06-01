"""
PT Rahaza — Production Execution (Navigation Refinement)

Endpoints (prefix /api/rahaza):
  - GET  /execution/process/{code}/board?date=YYYY-MM-DD
      Board khusus 1 proses: stats, lines, output per line, recent events.
      NEW: Filter berdasarkan assignment.process_code, bukan line.process_id.
           Satu line bisa muncul di proses berbeda tergantung assignment.
  - POST /execution/quick-output
      Input output cepat. Sekarang menerima work_order_id dari body.
  - POST /execution/qc-event
      Entry QC: pass & fail dalam 1 call → 2 event (qc_pass / qc_fail).
  - POST /execution/rework-event  (NEW)
      Entry Rework: qty_in, qty_out (→ packing), qty_fail (→ scrap).
  - GET  /execution/my-work?operator_id=X
      Daftar assignment operator hari ini + output terkini.
  - GET  /execution/flow-summary
      Ringkasan alur main + rework (WIP + throughput per proses).
  - GET  /execution/recent-events?process_id=X
      20 event terakhir (untuk log board).

Line Architecture (Navigation Refinement):
  - Line = tim/kelompok yang mengerjakan semua proses secara berurutan.
  - Line tidak lagi terikat pada satu proses (process_id di line menjadi opsional).
  - Proses ditentukan DARI ASSIGNMENT, bukan dari Line.
  - Satu line bisa punya assignment untuk proses berbeda pada hari yang sama.
  - Collision check: (line_id, date, shift_id, process_id) — unik per kombinasi ini.

Event type contract:
  - 'output'       : umum (Rajut/Linking/Sewing/Steam/Packing)
  - 'qc_pass'      : lolos QC → lanjut Packing
  - 'qc_fail'      : gagal QC → masuk Rework
  - 'rework_pass'  : lolos Rework → lanjut Packing
  - 'rework_fail'  : gagal Rework → scrap/waste
"""
# ruff: noqa: E741
from fastapi import APIRouter, Request, HTTPException
from database import get_db
from auth import require_auth, serialize_doc, log_activity
import uuid
from datetime import datetime, timezone, date, timedelta
from typing import Optional

router = APIRouter(prefix="/api/rahaza", tags=["rahaza-execution"])


def _uid(): return str(uuid.uuid4())
def _now(): return datetime.now(timezone.utc)


async def _require_input(request: Request):
    user = await require_auth(request)
    role = (user.get("role") or "").lower()
    if role in ("superadmin", "admin", "owner", "supervisor", "operator"):
        return user
    perms = user.get("_permissions") or []
    if "*" in perms or "prod.process.input" in perms or "prod.line.manage" in perms:
        return user
    raise HTTPException(403, "Forbidden: butuh permission input produksi.")


async def _day_range(day_iso: Optional[str]):
    d = date.fromisoformat(day_iso) if day_iso else date.today()
    start = datetime.combine(d, datetime.min.time()).replace(tzinfo=timezone.utc)
    end   = datetime.combine(d, datetime.max.time()).replace(tzinfo=timezone.utc)
    return d.isoformat(), start, end


# ─── Process Board ─────────────────────────────────────────────────────
@router.get("/execution/process/{code}/board")
async def process_board(code: str, request: Request, date: Optional[str] = None):
    """
    Board untuk satu proses.
    NEW ARCHITECTURE: Filter berdasarkan assignment.process_code (bukan line.process_id).
    Satu line bisa muncul di board proses berbeda tergantung assignmentnya.
    """
    await require_auth(request)
    db = get_db()
    code_up = (code or "").strip().upper()
    proc = await db.rahaza_processes.find_one({"code": code_up, "active": True}, {"_id": 0})
    if not proc:
        raise HTTPException(404, f"Proses '{code_up}' tidak ditemukan atau non-aktif.")
    today_iso, start, end = await _day_range(date)

    # NEW: Query assignments by process_code (not by line's process_id)
    assignments = await db.rahaza_line_assignments.find(
        {"process_code": code_up, "assign_date": today_iso, "active": True}, {"_id": 0}
    ).to_list(500)

    # Get unique line_ids from those assignments
    line_ids = list({a["line_id"] for a in assignments if a.get("line_id")})
    lines = await db.rahaza_lines.find({"id": {"$in": line_ids}, "active": True}, {"_id": 0}).sort("code", 1).to_list(500) if line_ids else []

    # Maps
    async def _name_map(col, ids, id_field="id"):
        if not ids:
            return {}
        docs = await db[col].find({id_field: {"$in": list(ids)}}, {"_id": 0}).to_list(500)
        return {d[id_field]: d for d in docs}
    emp_map = await _name_map("rahaza_employees", {a.get("operator_id") for a in assignments if a.get("operator_id")})
    sh_map  = await _name_map("rahaza_shifts",    {a.get("shift_id") for a in assignments if a.get("shift_id")})
    mod_map = await _name_map("rahaza_models",    {a.get("model_id") for a in assignments if a.get("model_id")})
    sz_map  = await _name_map("rahaza_sizes",     {a.get("size_id") for a in assignments if a.get("size_id")})
    loc_map = await _name_map("rahaza_locations", {l.get("location_id") for l in lines if l.get("location_id")})
    wo_map  = await _name_map("rahaza_work_orders", {a.get("work_order_id") for a in assignments if a.get("work_order_id")})

    assign_by_line = {}
    for a in assignments:
        assign_by_line.setdefault(a["line_id"], []).append(a)

    # Output today at this process (by line)
    pipe = [
        {"$match": {"process_id": proc["id"], "timestamp": {"$gte": start, "$lte": end}}},
        {"$group": {"_id": {"line_id": "$line_id", "event_type": "$event_type"}, "total": {"$sum": "$qty"}}},
    ]
    out_agg = await db.rahaza_wip_events.aggregate(pipe).to_list(500)
    out_by_line = {}
    for r in out_agg:
        lid = r["_id"].get("line_id")
        et = r["_id"].get("event_type") or "output"
        out_by_line.setdefault(lid, {}).setdefault(et, 0)
        out_by_line[lid][et] += r["total"]

    # Build lines output
    line_rows = []
    for ln in lines:
        loc = loc_map.get(ln.get("location_id"))
        agg = out_by_line.get(ln["id"], {})
        output_today = sum(agg.values())
        a_list = []
        for a in assign_by_line.get(ln["id"], []):
            op  = emp_map.get(a.get("operator_id"))
            sh  = sh_map.get(a.get("shift_id"))
            mod = mod_map.get(a.get("model_id"))
            sz  = sz_map.get(a.get("size_id"))
            wo  = wo_map.get(a.get("work_order_id"))
            a_list.append({
                "id": a["id"], "shift_id": a.get("shift_id"), "shift_name": sh.get("name") if sh else None,
                "operator_id": a.get("operator_id"), "operator_name": op.get("name") if op else None,
                "model_id": a.get("model_id"), "model_code": mod.get("code") if mod else None, "model_name": mod.get("name") if mod else None,
                "size_id": a.get("size_id"), "size_code": sz.get("code") if sz else None,
                "target_qty": a.get("target_qty") or 0,
                "work_order_id": a.get("work_order_id") or None,
                "work_order_no": wo.get("wo_number") if wo else None,
                "process_code": a.get("process_code") or code_up,
            })
        target = sum((x["target_qty"] for x in a_list), 0)
        line_rows.append({
            "line_id": ln["id"], "line_code": ln["code"], "line_name": ln["name"],
            "location_name": loc.get("name") if loc else None,
            "capacity_per_hour": ln.get("capacity_per_hour") or 0,
            "output_today": output_today, "output_breakdown": agg, "target_today": target,
            "assignments": a_list,
        })

    # Stats totals
    totals = {"output_today": sum(r["output_today"] for r in line_rows),
              "target_today": sum(r["target_today"] for r in line_rows),
              "active_lines": len(line_rows),
              "active_assignments": sum(len(r["assignments"]) for r in line_rows)}

    # Recent events (20)
    evs = await db.rahaza_wip_events.find({"process_id": proc["id"]}, {"_id": 0}).sort("timestamp", -1).limit(20).to_list(500)

    return {
        "date": today_iso,
        "process": {"id": proc["id"], "code": proc["code"], "name": proc["name"], "order_seq": proc.get("order_seq", 0), "is_rework": bool(proc.get("is_rework"))},
        "totals": totals,
        "lines": line_rows,
        "recent_events": serialize_doc(evs),
    }


# ─── Simple Daily Input (tanpa line/bundle, hanya WO + proses + qty) ────────
@router.post("/execution/simple-input")
async def simple_daily_input(request: Request):
    """
    Input Harian Sederhana — tidak butuh line_id maupun bundle scan.
    Cocok untuk factory yang cukup track output per WO per tahap per hari.
    Data disimpan di rahaza_wip_events dengan source='simple_input'.
    Untuk QC: kirim qty (total) + qty_fail; sistem buat 2 events (qc_pass + qc_fail).
    """
    user = await _require_input(request)
    db   = get_db()
    body = await request.json()

    process_code  = (body.get("process_code") or "").upper().strip()
    qty           = int(body.get("qty") or 0)
    qty_fail      = int(body.get("qty_fail") or 0)
    work_order_id = body.get("work_order_id") or None
    notes         = body.get("notes") or ""
    input_date    = body.get("input_date") or _now().date().isoformat()

    VALID_CODES = {"SEWING", "FINISHING", "QC", "PACKING"}
    if process_code not in VALID_CODES:
        raise HTTPException(400, f"process_code harus salah satu: {', '.join(VALID_CODES)}")
    if qty <= 0:
        raise HTTPException(400, "qty harus lebih dari 0.")
    if process_code == "QC" and qty_fail > qty:
        raise HTTPException(400, f"qty_fail ({qty_fail}) tidak boleh melebihi qty ({qty}).")

    # Lookup process_id dari code
    proc = await db.rahaza_processes.find_one({"code": process_code}, {"_id": 0})
    process_id = proc["id"] if proc else None

    # Lookup WO info untuk denormalisasi
    wo_number = None
    model_id  = None
    size_id   = None
    if work_order_id:
        wo = await db.rahaza_work_orders.find_one({"id": work_order_id}, {"_id": 0})
        if wo:
            wo_number = wo.get("wo_number")
            model_id  = wo.get("model_id")
            size_id   = wo.get("size_id")

    base = {
        "event_date":     input_date,
        "timestamp":      _now(),
        "line_id":        None,
        "process_id":     process_id,
        "process_code":   process_code,
        "location_id":    None,
        "model_id":       model_id,
        "size_id":        size_id,
        "line_assignment_id": None,
        "work_order_id":  work_order_id,
        "wo_number":      wo_number,
        "operator_id":    user.get("employee_id") or user["id"],
        "created_by":     user["id"],
        "created_by_name": user.get("name", ""),
        "notes":          notes,
        "source":         "simple_input",   # ← tag pembeda, tidak mempengaruhi existing queries
    }

    created = []

    if process_code == "QC":
        # QC: buat 2 events (qc_pass + qc_fail) seperti /qc-event
        qty_pass = qty - qty_fail
        if qty_pass > 0:
            ev_pass = {**base, "id": _uid(), "event_type": "qc_pass", "qty": qty_pass}
            await db.rahaza_wip_events.insert_one(ev_pass)
            created.append(ev_pass)
        if qty_fail > 0:
            ev_fail = {**base, "id": _uid(), "event_type": "qc_fail", "qty": qty_fail}
            await db.rahaza_wip_events.insert_one(ev_fail)
            created.append(ev_fail)
    else:
        # Non-QC: 1 event type 'output'
        ev = {**base, "id": _uid(), "event_type": "output", "qty": qty}
        await db.rahaza_wip_events.insert_one(ev)
        # Auto-complete WO jika PACKING
        if process_code == "PACKING" and work_order_id:
            try:
                from routes.rahaza_wizard import maybe_auto_complete_wo
                await maybe_auto_complete_wo(db, work_order_id, user)
            except Exception as e:
                import logging
                logging.getLogger(__name__).warning(f"Auto-complete WO failed: {e}")
        created.append(ev)

    await log_activity(
        user["id"], user.get("name", ""),
        f"simple_input:{process_code}:qty={qty}",
        "rahaza.simple_input", work_order_id or "no-wo"
    )
    return {"created": serialize_doc(created), "count": len(created)}


@router.get("/execution/simple-input/history")
async def simple_input_history(request: Request):
    """Riwayat Input Harian Sederhana untuk tanggal tertentu."""
    user = await _require_input(request)
    db   = get_db()
    date_str = request.query_params.get("date") or _now().date().isoformat()

    cursor = db.rahaza_wip_events.find(
        {"source": "simple_input", "event_date": date_str},
        {"_id": 0}
    ).sort("timestamp", -1)
    events = await cursor.to_list(200)

    # Enrich dengan WO number dan process name
    wo_ids   = {e["work_order_id"] for e in events if e.get("work_order_id")}
    proc_ids = {e["process_id"] for e in events if e.get("process_id")}

    wo_map   = {}
    proc_map = {}
    if wo_ids:
        async for wo in db.rahaza_work_orders.find({"id": {"$in": list(wo_ids)}}, {"_id": 0, "id": 1, "wo_number": 1}):
            wo_map[wo["id"]] = wo.get("wo_number", "—")
    if proc_ids:
        async for p in db.rahaza_processes.find({"id": {"$in": list(proc_ids)}}, {"_id": 0, "id": 1, "name": 1}):
            proc_map[p["id"]] = p.get("name", "—")

    for e in events:
        e["wo_number_display"]   = wo_map.get(e.get("work_order_id"), e.get("wo_number") or "Tanpa WO")
        e["process_name_display"] = proc_map.get(e.get("process_id"), e.get("process_code", "—"))

    return serialize_doc(events)


@router.delete("/execution/simple-input/{event_id}")
async def delete_simple_input(event_id: str, request: Request):
    """Hapus 1 entry Input Harian Sederhana (hanya source=simple_input)."""
    user = await _require_input(request)
    db   = get_db()
    ev   = await db.rahaza_wip_events.find_one({"id": event_id, "source": "simple_input"}, {"_id": 0})
    if not ev:
        raise HTTPException(404, "Entry tidak ditemukan atau bukan simple_input.")
    await db.rahaza_wip_events.delete_one({"id": event_id})
    await log_activity(user["id"], user.get("name", ""), f"delete_simple_input:{event_id}", "rahaza.simple_input", event_id)
    return {"ok": True, "deleted_id": event_id}


# ─── Quick output (generic) ─────────────────────────────────────────────────
@router.post("/execution/quick-output")
async def quick_output(request: Request):
    user = await _require_input(request)
    db = get_db()
    body = await request.json()
    line_id = body.get("line_id")
    process_id = body.get("process_id")
    qty = int(body.get("qty") or 0)
    if not (line_id and process_id and qty > 0):
        raise HTTPException(400, "line_id, process_id, dan qty(>0) wajib diisi.")
    line = await db.rahaza_lines.find_one({"id": line_id}, {"_id": 0})
    if not line:
        raise HTTPException(404, "Line tidak ditemukan.")
    # NEW: Line is process-agnostic. No longer validate line.process_id == process_id.
    # Disallow QC via generic quick-output (use /qc-event instead)
    proc = await db.rahaza_processes.find_one({"id": process_id}, {"_id": 0})
    if proc and (proc.get("code") == "QC"):
        raise HTTPException(400, "Gunakan /execution/qc-event untuk input QC (pass/fail).")
    # Auto-fill context from assignment if not provided
    assignment_id = body.get("line_assignment_id") or None
    model_id = body.get("model_id") or None
    size_id  = body.get("size_id") or None
    work_order_id = body.get("work_order_id") or None
    if assignment_id:
        a = await db.rahaza_line_assignments.find_one({"id": assignment_id}, {"_id": 0})
        if a:
            model_id = model_id or a.get("model_id")
            size_id  = size_id  or a.get("size_id")
            work_order_id = work_order_id or a.get("work_order_id")
    event = {
        "id": _uid(), "timestamp": _now(),
        "event_date": _now().date().isoformat(),                   # FIX: date string for reports
        "line_id": line_id, "process_id": process_id,
        "process_code": proc.get("code") if proc else "",          # FIX: for Pareto reports
        "location_id": line.get("location_id"),
        "model_id": model_id, "size_id": size_id,
        "line_assignment_id": assignment_id,
        "work_order_id": work_order_id,
        "event_type": "output",
        "qty": qty, "notes": body.get("notes") or "",
        "operator_id": user.get("employee_id") or user["id"],      # FIX: for payroll PCS
        "created_by": user["id"], "created_by_name": user.get("name", ""),
    }
    await db.rahaza_wip_events.insert_one(event)
    await log_activity(user["id"], user.get("name", ""), f"output:{qty}", "rahaza.process", proc["code"] if proc else process_id)
    
    # Auto-complete WO if Packing process
    if proc and proc.get("code") == "PACKING" and work_order_id:
        try:
            from routes.rahaza_wizard import maybe_auto_complete_wo
            await maybe_auto_complete_wo(db, work_order_id, user)
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Auto-complete WO failed: {e}")
    
    return serialize_doc(event)


# ─── QC event (pass/fail) ─────────────────────────────────────────────────────
@router.post("/execution/qc-event")
async def qc_event(request: Request):
    user = await _require_input(request)
    db = get_db()
    body = await request.json()
    line_id = body.get("line_id")
    qty_pass = int(body.get("qty_pass") or 0)
    qty_fail = int(body.get("qty_fail") or 0)
    if not line_id or (qty_pass <= 0 and qty_fail <= 0):
        raise HTTPException(400, "line_id dan minimal salah satu qty_pass/qty_fail > 0 wajib diisi.")
    line = await db.rahaza_lines.find_one({"id": line_id}, {"_id": 0})
    if not line:
        raise HTTPException(404, "Line tidak ditemukan.")
    qc_proc = await db.rahaza_processes.find_one({"code": "QC", "active": True}, {"_id": 0})
    if not qc_proc:
        raise HTTPException(500, "Proses QC tidak ditemukan di master data.")
    if line.get("process_id") and line.get("process_id") != qc_proc["id"]:
        # Soft warning only — line may be process-agnostic in new architecture
        pass

    assignment_id = body.get("line_assignment_id") or None
    model_id = body.get("model_id")
    size_id = body.get("size_id")
    work_order_id = body.get("work_order_id")
    if assignment_id:
        a = await db.rahaza_line_assignments.find_one({"id": assignment_id}, {"_id": 0})
        if a:
            model_id = model_id or a.get("model_id")
            size_id  = size_id  or a.get("size_id")
            work_order_id = work_order_id or a.get("work_order_id")

    created = []
    for (q, et) in ((qty_pass, "qc_pass"), (qty_fail, "qc_fail")):
        if q <= 0:
            continue
        ev = {
            "id": _uid(), "timestamp": _now(),
            "event_date": _now().date().isoformat(),                   # FIX: date string
            "line_id": line_id, "process_id": qc_proc["id"],
            "process_code": "QC",                                      # FIX: Pareto reports
            "location_id": line.get("location_id"),
            "model_id": model_id, "size_id": size_id,
            "line_assignment_id": assignment_id,
            "work_order_id": work_order_id,
            "event_type": et,
            "qty": q, "notes": body.get("notes") or "",
            "operator_id": user.get("employee_id") or user["id"],      # FIX: payroll PCS
            "created_by": user["id"], "created_by_name": user.get("name", ""),
        }
        await db.rahaza_wip_events.insert_one(ev)
        created.append(serialize_doc(ev))
    await log_activity(user["id"], user.get("name", ""), f"qc:{qty_pass}/{qty_fail}", "rahaza.process", "QC")
    
    # Auto-complete WO if QC pass (yang langsung ke Packing)
    if qty_pass > 0 and work_order_id:
        try:
            from routes.rahaza_wizard import maybe_auto_complete_wo
            await maybe_auto_complete_wo(db, work_order_id, user)
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Auto-complete WO after QC pass failed: {e}")

    # Phase 12.2 — QC fail rate alert (check only when there was fail)
    if qty_fail > 0:
        try:
            await _check_qc_fail_rate_alert(db, line_id, line.get("code", ""))
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"QC fail-rate alert failed: {e}")

    return {"created": created, "qty_pass": qty_pass, "qty_fail": qty_fail}


# ─── Rework event (NEW — Navigation Refinement) ──────────────────────────────
@router.post("/execution/rework-event")
async def rework_event(request: Request):
    """
    Input rework: material dari QC fail masuk ke proses rework terpisah.
    - qty_in  : jumlah pieces yang masuk rework (dari QC fail)
    - qty_out : jumlah pieces yang berhasil → lanjut ke Packing (event: rework_pass)
    - qty_fail: jumlah pieces yang tidak bisa diperbaiki → scrap (event: rework_fail)
    Syarat: qty_out + qty_fail <= qty_in
    """
    user = await _require_input(request)
    db = get_db()
    body = await request.json()
    line_id   = body.get("line_id")
    qty_in    = int(body.get("qty_in") or 0)
    qty_out   = int(body.get("qty_out") or 0)
    qty_fail  = int(body.get("qty_fail") or 0)

    if not line_id:
        raise HTTPException(400, "line_id wajib diisi.")
    if qty_in <= 0:
        raise HTTPException(400, "qty_in (jumlah masuk rework) harus lebih dari 0.")
    if qty_out < 0 or qty_fail < 0:
        raise HTTPException(400, "qty_out dan qty_fail tidak boleh negatif.")
    if (qty_out + qty_fail) > qty_in:
        raise HTTPException(400, f"qty_out ({qty_out}) + qty_fail ({qty_fail}) tidak boleh melebihi qty_in ({qty_in}).")
    if qty_out <= 0 and qty_fail <= 0:
        raise HTTPException(400, "Minimal qty_out atau qty_fail harus > 0.")

    line = await db.rahaza_lines.find_one({"id": line_id}, {"_id": 0})
    if not line:
        raise HTTPException(404, "Line tidak ditemukan.")
    rework_proc = await db.rahaza_processes.find_one({"code": "REWORK", "active": True}, {"_id": 0})
    if not rework_proc:
        # Auto-create REWORK process if missing
        rework_proc = {
            "id": str(uuid.uuid4()),
            "code": "REWORK",
            "name": "Rework",
            "order_seq": 99,
            "is_rework": True,
            "active": True,
            "created_at": _now().isoformat(),
        }
        await db.rahaza_processes.insert_one(rework_proc)

    assignment_id = body.get("line_assignment_id") or None
    model_id = body.get("model_id")
    size_id = body.get("size_id")
    work_order_id = body.get("work_order_id")
    if assignment_id:
        a = await db.rahaza_line_assignments.find_one({"id": assignment_id}, {"_id": 0})
        if a:
            model_id = model_id or a.get("model_id")
            size_id  = size_id  or a.get("size_id")
            work_order_id = work_order_id or a.get("work_order_id")

    now = _now()
    today_iso = now.date().isoformat()
    created = []

    def make_ev(qty: int, event_type: str):
        return {
            "id": _uid(), "timestamp": now,
            "event_date": today_iso,
            "line_id": line_id,
            "process_id": rework_proc["id"],
            "process_code": "REWORK",
            "location_id": line.get("location_id"),
            "model_id": model_id, "size_id": size_id,
            "line_assignment_id": assignment_id,
            "work_order_id": work_order_id,
            "event_type": event_type,
            "qty": qty,
            "qty_in": qty_in,  # store original qty_in for traceability
            "notes": body.get("notes") or "",
            "operator_id": user.get("employee_id") or user["id"],
            "created_by": user["id"], "created_by_name": user.get("name", ""),
        }

    if qty_out > 0:
        ev = make_ev(qty_out, "rework_pass")
        await db.rahaza_wip_events.insert_one(ev)
        created.append(serialize_doc(ev))
    if qty_fail > 0:
        ev = make_ev(qty_fail, "rework_fail")
        await db.rahaza_wip_events.insert_one(ev)
        created.append(serialize_doc(ev))

    await log_activity(user["id"], user.get("name", ""), f"rework:{qty_in}in/{qty_out}pass/{qty_fail}fail", "rahaza.process", "REWORK")
    
    # Auto-complete WO if rework pass (yang langsung ke Packing)
    if qty_out > 0 and work_order_id:
        try:
            from routes.rahaza_wizard import maybe_auto_complete_wo
            await maybe_auto_complete_wo(db, work_order_id, user)
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Auto-complete WO after rework pass failed: {e}")
    
    return {
        "ok": True,
        "created": created,
        "qty_in": qty_in,
        "qty_out": qty_out,
        "qty_fail": qty_fail,
        "pending": qty_in - qty_out - qty_fail,
    }


async def _check_qc_fail_rate_alert(db, line_id: str, line_code: str):
    """
    Cek fail rate di line QC pada 30 menit terakhir.
    Jika total events ≥ 10 dan fail_rate > 10 %, publish alert.
    """
    since = (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat()
    events = await db.rahaza_wip_events.find(
        {"line_id": line_id, "event_type": {"$in": ["qc_pass", "qc_fail"]},
         "timestamp": {"$gte": since}},
        {"_id": 0, "event_type": 1, "qty": 1}
    ).to_list(500)
    total = sum(int(e.get("qty") or 0) for e in events)
    fail = sum(int(e.get("qty") or 0) for e in events if e.get("event_type") == "qc_fail")
    if total < 10:
        return  # sample terlalu kecil
    fail_rate = (fail / total) * 100 if total else 0
    if fail_rate > 10:
        from routes.rahaza_notifications import publish_notification
        await publish_notification(
            db,
            type_="qc_fail_spike",
            severity="error" if fail_rate > 20 else "warning",
            title=f"Fail rate tinggi di {line_code}",
            message=f"Fail rate {fail_rate:.1f}% ({fail}/{total}) dalam 30 menit terakhir. Perlu investigasi operator/mesin/model.",
            link_module="prod-line-board",
            link_id=line_id,
            target_roles=["supervisor", "production_manager", "qc_lead", "superadmin"],
            dedup_key=f"qc_fail::{line_id}::{int(datetime.now(timezone.utc).timestamp() // 1800)}",  # 30-min window
        )


# ─── Operator "my work" ──────────────────────────────────────────────────────
@router.get("/execution/my-work")
async def my_work(request: Request, operator_id: Optional[str] = None, date: Optional[str] = None):
    await require_auth(request)
    db = get_db()
    if not operator_id:
        raise HTTPException(400, "operator_id wajib dipilih.")
    today_iso, start, end = await _day_range(date)
    assignments = await db.rahaza_line_assignments.find(
        {"operator_id": operator_id, "assign_date": today_iso, "active": True}, {"_id": 0}
    ).to_list(500)
    if not assignments:
        return {"date": today_iso, "operator_id": operator_id, "assignments": [], "recent_events": []}

    line_ids = list({a["line_id"] for a in assignments if a.get("line_id")})
    lines = await db.rahaza_lines.find({"id": {"$in": line_ids}}, {"_id": 0}).to_list(500)
    ln_map = {l["id"]: l for l in lines}
    proc_ids = list({l.get("process_id") for l in lines if l.get("process_id")})
    procs = await db.rahaza_processes.find({"id": {"$in": proc_ids}}, {"_id": 0}).to_list(500)
    p_map = {p["id"]: p for p in procs}
    mod_ids = list({a.get("model_id") for a in assignments if a.get("model_id")})
    sz_ids  = list({a.get("size_id") for a in assignments if a.get("size_id")})
    mods = await db.rahaza_models.find({"id": {"$in": mod_ids}}, {"_id": 0}).to_list(500) if mod_ids else []
    szs  = await db.rahaza_sizes.find({"id":  {"$in": sz_ids}},  {"_id": 0}).to_list(500) if sz_ids else []
    m_map = {m["id"]: m for m in mods}
    s_map = {s["id"]: s for s in szs}
    sh_ids = list({a.get("shift_id") for a in assignments if a.get("shift_id")})
    shs = await db.rahaza_shifts.find({"id": {"$in": sh_ids}}, {"_id": 0}).to_list(500) if sh_ids else []
    sh_map = {s["id"]: s for s in shs}

    # Output today per line_assignment for this operator
    asg_ids = [a["id"] for a in assignments]
    pipe = [
        {"$match": {"line_assignment_id": {"$in": asg_ids}, "timestamp": {"$gte": start, "$lte": end}}},
        {"$group": {"_id": {"aid": "$line_assignment_id", "et": "$event_type"}, "total": {"$sum": "$qty"}}},
    ]
    agg = await db.rahaza_wip_events.aggregate(pipe).to_list(500)
    out_by_asg = {}
    for r in agg:
        aid = r["_id"].get("aid")
        et = r["_id"].get("et") or "output"
        out_by_asg.setdefault(aid, {}).setdefault(et, 0)
        out_by_asg[aid][et] += r["total"]

    rows = []
    for a in assignments:
        ln = ln_map.get(a["line_id"]) or {}
        pr = p_map.get(ln.get("process_id")) or {}
        mod = m_map.get(a.get("model_id"))
        sz  = s_map.get(a.get("size_id"))
        sh  = sh_map.get(a.get("shift_id"))
        agg_a = out_by_asg.get(a["id"], {})
        out_today = sum(agg_a.values())
        rows.append({
            "assignment_id": a["id"],
            "line_id": ln.get("id"), "line_code": ln.get("code"), "line_name": ln.get("name"),
            "process_id": pr.get("id"), "process_code": pr.get("code"), "process_name": pr.get("name"), "is_qc": pr.get("code") == "QC",
            "shift_id": a.get("shift_id"), "shift_name": sh.get("name") if sh else None,
            "model_id": a.get("model_id"), "model_code": mod.get("code") if mod else None, "model_name": mod.get("name") if mod else None,
            "size_id": a.get("size_id"), "size_code": sz.get("code") if sz else None,
            "target_qty": a.get("target_qty") or 0,
            "output_today": out_today,
            "output_breakdown": agg_a,
            "progress_pct": round((out_today / a["target_qty"]) * 100, 1) if a.get("target_qty") else 0,
        })

    # Recent events for this operator today
    recent = await db.rahaza_wip_events.find(
        {"line_assignment_id": {"$in": asg_ids}, "timestamp": {"$gte": start, "$lte": end}}, {"_id": 0}
    ).sort("timestamp", -1).limit(15).to_list(500)

    return {
        "date": today_iso, "operator_id": operator_id,
        "assignments": rows,
        "recent_events": serialize_doc(recent),
    }


# ─── Flow summary (enhanced) ───────────────────────────────────────────────────
@router.get("/execution/flow-summary")
async def flow_summary(request: Request):
    """
    WIP per proses dengan awareness rework:
      Main : Rajut → Linking → Sewing → Steam → QC → Packing
      Rework: QC(fail) → REWORK → kembali ke QC

    WIP di setiap proses P = incoming(P) − outgoing(P).
    Untuk QC, outgoing = qc_pass + qc_fail.
    """
    await require_auth(request)
    db = get_db()
    procs = await db.rahaza_processes.find({"active": True}, {"_id": 0}).sort("order_seq", 1).to_list(500)
    p_by_code = {p["code"]: p for p in procs}

    pipe = [
        {"$group": {"_id": {"pid": "$process_id", "et": "$event_type"}, "total": {"$sum": "$qty"}}}
    ]
    raw = await db.rahaza_wip_events.aggregate(pipe).to_list(500)
    totals = {}  # totals[process_id][event_type] = qty
    for r in raw:
        pid = r["_id"].get("pid")
        et = r["_id"].get("et") or "output"
        totals.setdefault(pid, {}).setdefault(et, 0)
        totals[pid][et] += r["total"]

    def out(pcode, et="output"):
        p = p_by_code.get(pcode)
        if not p:
            return 0
        return int(totals.get(p["id"], {}).get(et, 0))

    # Outputs
    rajut    = out("RAJUT")
    linking  = out("LINKING")
    sewing   = out("SEWING")
    steam    = out("STEAM")
    qc_pass  = out("QC", "qc_pass")
    qc_fail  = out("QC", "qc_fail")
    packing  = out("PACKING")
    rework   = out("REWORK")

    # WIP per proses (updated for new flow: Steam before QC)
    def wip(incoming, outgoing):
        return max(0, incoming - outgoing)

    wip_rajut   = max(0, rajut - linking)
    wip_linking = max(0, linking - sewing)
    wip_sewing  = max(0, sewing - steam)
    wip_steam   = max(0, steam - (qc_pass + qc_fail))
    # QC queue = input(QC) - (qc_pass+qc_fail); input = steam + rework
    wip_qc      = max(0, (steam + rework) - (qc_pass + qc_fail))
    wip_packing = max(0, qc_pass - packing)
    wip_rework  = max(0, qc_fail - rework)

    def pack(code, throughput, wip_qty, is_rework=False, extra=None):
        p = p_by_code.get(code) or {}
        item = {
            "code": code, "name": p.get("name", code),
            "order_seq": p.get("order_seq", 0), "is_rework": bool(is_rework),
            "throughput": throughput, "wip": wip_qty,
        }
        if extra:
            item.update(extra)
        return item

    main = [
        pack("RAJUT",   rajut,   wip_rajut),
        pack("LINKING", linking, wip_linking),
        pack("SEWING",  sewing,  wip_sewing),
        pack("STEAM",   steam,   wip_steam),
        pack("QC",      qc_pass + qc_fail, wip_qc, extra={"qc_pass": qc_pass, "qc_fail": qc_fail}),
        pack("PACKING", packing, wip_packing),
    ]
    rework_list = [
        pack("REWORK",  rework,  wip_rework, is_rework=True),
    ]
    # Bottleneck: proses non-rework dengan WIP tertinggi
    btl = max(main, key=lambda r: r["wip"], default=None)
    return {
        "main_flow": main,
        "rework_flow": rework_list,
        "bottleneck": btl["code"] if btl and btl["wip"] > 0 else None,
        "bottleneck_wip": btl["wip"] if btl else 0,
        "qc_pass": qc_pass, "qc_fail": qc_fail,
        "updated_at": _now().isoformat(),
    }


# ─── Recent events per proses ──────────────────────────────────────────────────
@router.get("/execution/recent-events")
async def recent_events(request: Request, process_id: Optional[str] = None, limit: int = 30):
    """Return recent events enriched with model_name, wo_number, line_name, line_code."""
    await require_auth(request)
    db = get_db()
    q = {}
    if process_id:
        q["process_id"] = process_id
    evs = await db.rahaza_wip_events.find(q, {"_id": 0}).sort("timestamp", -1).limit(int(limit)).to_list(500)

    # Gather IDs for enrichment
    model_ids = {e["model_id"] for e in evs if e.get("model_id")}
    wo_ids    = {e["work_order_id"] for e in evs if e.get("work_order_id")}
    line_ids  = {e["line_id"] for e in evs if e.get("line_id")}

    models = {d["id"]: d for d in await db.rahaza_models.find({"id": {"$in": list(model_ids)}}, {"_id": 0}).to_list(500)} if model_ids else {}
    wos    = {d["id"]: d for d in await db.rahaza_work_orders.find({"id": {"$in": list(wo_ids)}}, {"_id": 0}).to_list(500)} if wo_ids else {}
    lines  = {d["id"]: d for d in await db.rahaza_lines.find({"id": {"$in": list(line_ids)}}, {"_id": 0}).to_list(500)} if line_ids else {}

    enriched = []
    for e in evs:
        ev = dict(e)
        m   = models.get(ev.get("model_id"))
        wo  = wos.get(ev.get("work_order_id"))
        ln  = lines.get(ev.get("line_id"))
        ev["model_code"]  = m.get("code")  if m  else None
        ev["model_name"]  = m.get("name")  if m  else None
        ev["wo_number"]   = wo.get("wo_number") if wo else None
        ev["wo_id"]       = wo.get("id")        if wo else None
        ev["line_code"]   = ln.get("code")  if ln else None
        ev["line_name"]   = ln.get("name")  if ln else None
        enriched.append(ev)

    return serialize_doc(enriched)
