# Module 3 — Predictive Tank Monitoring

**Problem Statement:** Fuel retailers face revenue loss and liability
from unpredictable fuel run-outs and undetected underground tank
anomalies — including slow-bleeding micro-leaks and rainwater
contamination that traditional monitoring misses until they become
severe. This module turns real-time Automatic Tank Gauge (ATG) data into
actionable inventory alerts and early-warning contamination shutoffs.

## How it works

```
ATG console (Veeder-Root): volume, temperature, water-level
   → ARIMA(2,1,1) forecast of volume, next 12 hours   [always available]
   → optional LSTM forecast                            [when torch + enough history is available]
   → threshold rules: reorder alert / contamination alert
```

### Files

| File | Purpose |
|---|---|
| `atg_simulator.py` | Generates ATG-shaped readings per tank — dispensing draw-down with a daily demand curve, periodic tanker replenishment, and an injectable slow micro-leak + water-ingress scenario for demoing alerts. |
| `forecast_model.py` | `forecast_volume_arima()` (primary, dependency-light forecaster), an optional `forecast_volume_lstm()` upgrade path, and the `reorder_alert()` / `contamination_alert()` rule layer. |

### Why ARIMA + optional LSTM, not just one model

- **ARIMA(2,1,1)** needs only the tank's own recent history, runs
  anywhere `statsmodels` is installed, and needs no GPU or training data
  beyond the series itself — the right default for a per-outlet
  dashboard with no dedicated ML infra.
- **LSTM** is included as an upgrade path for outlets with weeks of
  hourly history, since it can learn the daily/weekly demand cycle
  (morning/evening rush) more explicitly than ARIMA's linear structure.
  It's optional at import time — the module works identically without
  `torch` installed, transparently deferring to ARIMA.

### Alerts

- **Reorder alert** — fires when the volume forecast crosses 15% of tank
  capacity within the 12-hour forecast horizon, with the estimated hours
  remaining so a tanker can be scheduled ahead of a stock-out.
- **Contamination alert** — fires when the water level at the tank
  bottom rises faster than a threshold rate (mm/hour), flagging probable
  rainwater ingress before it becomes an environmental or equipment
  hazard.

### Swapping in real ATG data

Replace `ATGSimulator.step()` with a reader for your Veeder-Root serial
feed / OPC-UA gateway that returns the same `ATGReading` shape
(`tank_id`, `product`, `timestamp`, `volume_litres`, `temperature_c`,
`water_level_mm`) — `forecast_model.py` and the alert functions need no
changes.
