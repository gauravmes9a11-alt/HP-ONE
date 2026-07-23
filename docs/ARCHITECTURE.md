# Technical Architecture — Project UDAAN / HP ONE

This mirrors the architecture slide from the hackathon pitch deck
(*HP AI Fuel Stations*), and maps it directly onto this repository's code.

```
┌─────────────────────────────┬─────────────────────────────┬──────────────────────────────┐
│        DATA SOURCES          │        AI / ML MODELS        │            OUTPUT             │
├─────────────────────────────┼─────────────────────────────┼──────────────────────────────┤
│ CCTV Cameras + ANPR           │ Computer Vision Model        │ Smart Bay Allocation           │
│ Vehicle & violation detection │ Vehicle type & safety-       │ Real-time dispenser guidance   │
│                                │ violation detection (YOLOv8) │                                │
├─────────────────────────────┼─────────────────────────────┼──────────────────────────────┤
│ FCC Serial Data                │ Isolation Forest             │ Nozzle-Level Alerts            │
│ Pulse rate, flow rate,         │ Unsupervised anomaly         │ Fraud & failure warnings       │
│ K-factor, voltage              │ detection                    │                                │
├─────────────────────────────┼─────────────────────────────┼──────────────────────────────┤
│ ATG Console (Veeder-Root)      │ ARIMA / LSTM                  │ Reorder & Contamination Alerts │
│ Volume, temperature,           │ Time-series forecasting      │ Tank health monitoring         │
│ water-level                    │                              │                                │
└─────────────────────────────┴─────────────────────────────┴──────────────────────────────┘
                                          │
                                          ▼
                 Unified Forecourt Command Dashboard — HP ONE
                 Real-time visibility for HPCL retail outlet operations
```

## Repository mapping

| Architecture layer | Code |
|---|---|
| CCTV + ANPR data source & CV model | `backend/modules/smart_bay/anpr_detector.py` |
| Smart Bay Allocation output | `backend/modules/smart_bay/bay_allocator.py` |
| FCC serial data source | `backend/modules/invisible_auditor/fcc_simulator.py` |
| Isolation Forest model | `backend/modules/invisible_auditor/anomaly_model.py` |
| ATG console data source | `backend/modules/tank_monitoring/atg_simulator.py` |
| ARIMA / LSTM model | `backend/modules/tank_monitoring/forecast_model.py` |
| HP ONE dashboard (aggregation layer) | `backend/main.py` (API) + `frontend/` (UI) |

## Request flow (dashboard → data)

1. `frontend/app.js` polls the FastAPI backend every 4 seconds:
   `/api/bays`, `/api/auditor/alerts`, `/api/tanks`, `/api/summary`.
2. Each endpoint "ticks" its module's simulator/detector once per call,
   runs it through the corresponding model, and returns structured JSON.
3. The frontend renders three module panels (Smart Bay, Invisible
   Auditor, Tank Monitoring) plus a KPI strip, all from that JSON — no
   business logic lives in the frontend beyond rendering.
4. If the backend isn't reachable, the frontend transparently switches to
   a lightweight in-browser simulation so the UI is still demonstrable
   (clearly flagged as "offline demo mode" in the header).

## Swapping simulation for production data sources

Every module's simulator (`*_simulator.py`) exists purely so this can be
run, tested, and demoed without a live HPCL retail outlet connection.
Each one defines the exact data shape (`Detection`, `FCCReading`,
`ATGReading`) that a production data source would need to produce —
swap the simulator for a real CCTV/FCC/ATG reader and the model + API
layers require no changes.

## Why three separate models instead of one

Each data source has a fundamentally different structure and failure
mode:
- CCTV/ANPR is a **perception** problem (object detection + OCR) →
  computer vision model.
- FCC serial data is **low-dimensional, high-frequency, unlabeled**
  sensor data where the "abnormal" pattern isn't known in advance →
  unsupervised anomaly detection (Isolation Forest).
- ATG data is a **univariate time series** with a fairly stable
  seasonal/trend structure → classical time-series forecasting (ARIMA),
  upgradeable to a sequence model (LSTM) once enough history exists.

Using the model best suited to each data source's structure kept each
module explainable to forecourt operations staff, which mattered more
for a hackathon judged partly on real-world deployability than squeezing
every module into a single end-to-end deep model.
