"""
Project UDAAN — HP ONE: Unified Forecourt Command Dashboard
Backend API

Aggregates all three AI/ML modules into one real-time API consumed by the
frontend dashboard (frontend/index.html):

  1. Smart Bay Allocation System   -> /api/bays, /api/bays/detections
  2. The Invisible Auditor         -> /api/auditor/alerts, /api/auditor/summary
  3. Predictive Tank Monitoring    -> /api/tanks, /api/tanks/{id}/forecast

Run:
    pip install -r requirements.txt
    uvicorn main:app --reload --port 8000

Then open frontend/index.html (it points at http://localhost:8000 by
default — see frontend/app.js API_BASE) or serve the frontend folder with
any static file server.
"""

from __future__ import annotations

import os
import time
from collections import deque
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Literal

from modules.smart_bay.anpr_detector import get_detector
from modules.smart_bay.bay_allocator import BayAllocator, BayStatus
from modules.invisible_auditor.fcc_simulator import FCCSimulator
from modules.invisible_auditor.anomaly_model import NozzleAuditor
from modules.tank_monitoring.atg_simulator import ATGSimulator, TANKS
from modules.tank_monitoring.forecast_model import (
    forecast_volume_arima,
    reorder_alert,
    contamination_alert,
)

# ---------------------------------------------------------------------------
# In-memory state (fine for a hackathon demo / single-outlet dashboard;
# swap for a proper DB such as PostgreSQL/Timescale for production)
# ---------------------------------------------------------------------------

detector = get_detector()
allocator = BayAllocator()
detection_log: deque = deque(maxlen=100)

fcc_sim = FCCSimulator(anomaly_rate=0.35, seed=7)
auditor = NozzleAuditor(window_size=200, retrain_every=40)
alert_log: deque = deque(maxlen=100)

atg_sim = ATGSimulator(seed=11)
tank_history: dict[str, deque] = {t["tank_id"]: deque(maxlen=500) for t in TANKS}
tank_water_history: dict[str, deque] = {t["tank_id"]: deque(maxlen=500) for t in TANKS}

# Warm up simulators with some history so forecasts/models have data from
# the very first request instead of an empty-state dashboard.
for _ in range(60):
    for r in atg_sim.step(dt_hours=1):
        tank_history[r.tank_id].append(r.volume_litres)
        tank_water_history[r.tank_id].append(r.water_level_mm)
for _ in range(80):
    for reading in fcc_sim.step():
        auditor.observe(reading)
for _ in range(15):
    d = detector.detect_next()
    if d:
        detection_log.appendleft(d.to_dict())
        allocator.allocate(d)


app = FastAPI(title="HP ONE — Unified Forecourt Command Dashboard", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # demo/dev only — restrict in production
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/status")
def root():
    return {
        "service": "HP ONE — Unified Forecourt Command Dashboard",
        "project": "Project UDAAN",
        "modules": ["smart_bay_allocation", "invisible_auditor", "tank_monitoring"],
        "status": "ok",
    }


# ---------------------------------------------------------------------------
# Module 1 — Smart Bay Allocation System
# ---------------------------------------------------------------------------

@app.get("/api/bays")
def get_bays():
    """Tick the detector once, allocate, and return current bay + detection state."""
    d = detector.detect_next()
    if d:
        detection_log.appendleft(d.to_dict())
        allocated = allocator.allocate(d)
        # simulate service completion so bays don't monotonically fill up
        if allocated and len(allocator.allocation_log) > 3:
            oldest = allocator.allocation_log[0]
            allocator.complete_service(oldest["bay_id"])

    return {
        "bays": allocator.snapshot(),
        "recent_detections": list(detection_log)[:10],
        "recent_allocations": allocator.allocation_log[-10:],
    }


# ---------------------------------------------------------------------------
# Module 2 — The Invisible Auditor
# ---------------------------------------------------------------------------

@app.get("/api/auditor/alerts")
def get_auditor_alerts():
    """Tick the FCC simulator, run anomaly detection, log + return alerts."""
    new_alerts = []
    for reading in fcc_sim.step():
        result = auditor.observe(reading)
        if result["is_anomaly"]:
            alert_log.appendleft(result)
            new_alerts.append(result)

    total_nozzles = len(fcc_sim._active_air_fraud) if hasattr(fcc_sim, "_active_air_fraud") else 0
    healthy_ratio = 1.0 - (len(new_alerts) / 8.0)

    return {
        "new_alerts": new_alerts,
        "recent_alerts": list(alert_log)[:20],
        "health_score": round(max(0.0, min(1.0, healthy_ratio)) * 100, 1),
    }


# ---------------------------------------------------------------------------
# Module 3 — Predictive Tank Monitoring
# ---------------------------------------------------------------------------

@app.get("/api/tanks")
def get_tanks():
    readings = atg_sim.step(dt_hours=1)
    response = []

    for r in readings:
        tank_history[r.tank_id].append(r.volume_litres)
        tank_water_history[r.tank_id].append(r.water_level_mm)

        capacity = next(t["capacity"] for t in TANKS if t["tank_id"] == r.tank_id)
        history_list = list(tank_history[r.tank_id])
        water_list = list(tank_water_history[r.tank_id])

        forecast = forecast_volume_arima(history_list, horizon=12)
        alerts = []
        ro = reorder_alert(forecast, capacity)
        if ro:
            alerts.append(ro)
        ca = contamination_alert(water_list[-6:])
        if ca:
            alerts.append(ca)

        response.append(
            {
                **r.to_dict(),
                "capacity": capacity,
                "fill_percent": round(100 * r.volume_litres / capacity, 1),
                "forecast_next_12h": [round(v, 1) for v in forecast],
                "alerts": alerts,
            }
        )

    return {"tanks": response, "timestamp": time.time()}


@app.get("/api/tanks/{tank_id}/history")
def get_tank_history(tank_id: str):
    if tank_id not in tank_history:
        return {"error": "unknown tank_id"}
    return {
        "tank_id": tank_id,
        "volume_history": list(tank_history[tank_id]),
        "water_level_history": list(tank_water_history[tank_id]),
    }


# ---------------------------------------------------------------------------
# Combined summary for the dashboard header / KPI strip
# ---------------------------------------------------------------------------

@app.get("/api/summary")
def get_summary():
    bays = allocator.snapshot()
    busy = sum(1 for b in bays if b["status"] == "BUSY")
    return {
        "timestamp": time.time(),
        "bays_busy": busy,
        "bays_total": len(bays),
        "active_alerts": sum(1 for a in alert_log if a["is_anomaly"]),
        "tanks_monitored": len(TANKS),
    }


class TriggerPayload(BaseModel):
    module: Literal["smart_bay", "auditor", "tank_monitoring"]
    type: str
    target_id: str


@app.post("/api/simulator/trigger")
def trigger_anomaly(payload: TriggerPayload):
    if payload.module == "smart_bay":
        if payload.type == "violation":
            detector.next_violation = payload.target_id  # the violation type string
        elif payload.type == "suspend_bay":
            allocator.suspend_bay(payload.target_id)
        elif payload.type == "clear_bay":
            allocator.clear_suspension(payload.target_id)
            allocator.complete_service(payload.target_id)

    elif payload.module == "auditor":
        nid = payload.target_id
        if payload.type == "air_fraud":
            fcc_sim._active_air_fraud.add(nid)
        elif payload.type == "mechanical_drift":
            fcc_sim._drift[nid] = 6.5
        elif payload.type == "clear_nozzle":
            fcc_sim._active_air_fraud.discard(nid)
            fcc_sim._drift[nid] = 0.0
            if nid in auditor._windows:
                auditor._windows[nid].clear()
                auditor._since_retrain[nid] = 0
            if nid in auditor._models:
                del auditor._models[nid]

    elif payload.module == "tank_monitoring":
        tid = payload.target_id
        if payload.type == "leak":
            atg_sim.leak_tank = tid
            capacity = next(t["capacity"] for t in TANKS if t["tank_id"] == tid)
            # drop to 12% to trigger reorder forecast alert
            atg_sim.state[tid]["volume"] = capacity * 0.12
        elif payload.type == "water_ingress":
            atg_sim.leak_tank = tid
            # immediately raise water level
            atg_sim.state[tid]["water_level"] += 3.0
            # load some water ingress history to trigger rate-of-rise check
            for i in range(10):
                tank_water_history[tid].append(atg_sim.state[tid]["water_level"] - 3.0 + i * 0.4)
        elif payload.type == "refill":
            capacity = next(t["capacity"] for t in TANKS if t["tank_id"] == tid)
            atg_sim.state[tid]["volume"] = capacity * 0.85
            atg_sim.state[tid]["water_level"] = 3.0
            if atg_sim.leak_tank == tid:
                atg_sim.leak_tank = None

    return {"status": "triggered", "payload": payload.dict()}


@app.post("/api/simulator/reset")
def reset_simulator():
    detector.next_violation = None

    for b in allocator.bays:
        b.status = BayStatus.OPEN
        b.queue_length = 0
        b.current_vehicle = None
    allocator.allocation_log.clear()
    detection_log.clear()

    fcc_sim._active_air_fraud.clear()
    for nid in fcc_sim._drift:
        fcc_sim._drift[nid] = 0.0
    alert_log.clear()
    for nid in list(auditor._windows.keys()):
        auditor._windows[nid].clear()
        auditor._since_retrain[nid] = 0
        if nid in auditor._models:
            del auditor._models[nid]

    atg_sim.leak_tank = None
    for tid in atg_sim.state:
        capacity = next(t["capacity"] for t in TANKS if t["tank_id"] == tid)
        atg_sim.state[tid]["volume"] = capacity * 0.7
        atg_sim.state[tid]["water_level"] = 4.0
        tank_history[tid].clear()
        tank_water_history[tid].clear()
        for _ in range(60):
            tank_history[tid].append(capacity * 0.7)
            tank_water_history[tid].append(4.0)

    return {"status": "reset"}


# ---------------------------------------------------------------------------
# Serve the frontend (index.html, app.js, style.css) from the same service.
# Must be mounted LAST so it doesn't shadow the /api/* routes above.
#
# Resolved relative to THIS FILE's location (not the process's working
# directory) so it works no matter how/where the host launches uvicorn
# (locally from backend/, or from a host like Render that may launch from
# the repo root).
# ---------------------------------------------------------------------------

FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend")
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")


if __name__ == "__main__":
    # Allows `python main.py` to work directly on hosts (like Render) that
    # set a PORT env var, in addition to the usual `uvicorn main:app`.
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))