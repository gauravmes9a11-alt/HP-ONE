"""
Project UDAAN — backend test suite.

Run with:
    cd backend
    python -m pytest tests/ -v

Covers the three AI/ML modules independently (no server needed) plus a
smoke test of the aggregated FastAPI app via TestClient.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from modules.smart_bay.anpr_detector import SimulatedANPRDetector
from modules.smart_bay.bay_allocator import BayAllocator
from modules.invisible_auditor.fcc_simulator import FCCSimulator
from modules.invisible_auditor.anomaly_model import NozzleAuditor, classify_anomaly
from modules.tank_monitoring.atg_simulator import ATGSimulator
from modules.tank_monitoring.forecast_model import (
    forecast_volume_arima,
    reorder_alert,
    contamination_alert,
)


def test_anpr_detector_produces_valid_detection():
    detector = SimulatedANPRDetector(seed=1)
    d = detector.detect_next()
    assert d.vehicle_type in {"Car", "Bike", "Auto", "Truck", "Bus"}
    assert 0 <= d.vehicle_confidence <= 1
    assert len(d.plate_number) >= 8


def test_bay_allocator_assigns_and_frees_bays():
    allocator = BayAllocator()
    detector = SimulatedANPRDetector(seed=2, violation_rate=0.0)
    d = detector.detect_next()
    record = allocator.allocate(d)
    assert record is not None
    assert record["bay_id"].startswith("Bay-")

    bay_id = record["bay_id"]
    before = next(b.queue_length for b in allocator.bays if b.bay_id == bay_id)
    allocator.complete_service(bay_id)
    after = next(b.queue_length for b in allocator.bays if b.bay_id == bay_id)
    assert after == before - 1


def test_bay_allocator_holds_violating_vehicles():
    allocator = BayAllocator()
    detector = SimulatedANPRDetector(seed=3, violation_rate=1.0)  # force a violation
    d = detector.detect_next()
    assert d.violation is not None
    record = allocator.allocate(d)
    assert record is None  # held, not routed to a bay


def test_fcc_simulator_produces_all_nozzles():
    sim = FCCSimulator(seed=4)
    readings = sim.step()
    assert len(readings) == 8
    assert all(r.pulse_rate >= 0 for r in readings)


def test_anomaly_model_flags_air_delivery_pattern():
    from modules.invisible_auditor.fcc_simulator import FCCReading

    fraud_reading = FCCReading(
        nozzle_id="N-01", timestamp=0, pulse_rate=1.5, flow_rate=4.8, k_factor=100, voltage=24
    )
    assert classify_anomaly(fraud_reading) == "Air Delivery Fraud"


def test_nozzle_auditor_trains_and_scores():
    auditor = NozzleAuditor(window_size=100, retrain_every=20)
    sim = FCCSimulator(anomaly_rate=0.3, seed=5)
    results = []
    for _ in range(60):
        for reading in sim.step():
            results.append(auditor.observe(reading))
    assert any(r["is_anomaly"] for r in results), "expected at least one anomaly over 60 ticks"


def test_atg_simulator_keeps_volume_in_bounds():
    sim = ATGSimulator(seed=6)
    for _ in range(20):
        readings = sim.step()
        for r in readings:
            assert 0 <= r.volume_litres


def test_arima_forecast_returns_correct_horizon():
    history = [20000 - 100 * i for i in range(30)]
    forecast = forecast_volume_arima(history, horizon=12)
    assert len(forecast) == 12
    assert all(v >= 0 for v in forecast)


def test_reorder_alert_triggers_below_threshold():
    forecast = [1000, 900, 800]
    alert = reorder_alert(forecast, capacity=20000)
    assert alert is not None
    assert alert["type"] == "REORDER_ALERT"


def test_reorder_alert_silent_when_healthy():
    forecast = [15000, 14800, 14600]
    alert = reorder_alert(forecast, capacity=20000)
    assert alert is None


def test_contamination_alert_triggers_on_rising_water():
    levels = [2, 4, 7, 10, 13]
    alert = contamination_alert(levels)
    assert alert is not None
    assert alert["type"] == "CONTAMINATION_ALERT"


def test_app_endpoints_smoke():
    from fastapi.testclient import TestClient
    from main import app

    client = TestClient(app)
    assert client.get("/").status_code == 200
    assert client.get("/api/bays").status_code == 200
    assert client.get("/api/auditor/alerts").status_code == 200
    assert client.get("/api/tanks").status_code == 200
    assert client.get("/api/summary").status_code == 200
