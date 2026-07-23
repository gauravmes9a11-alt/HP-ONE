# Project UDAAN — HP ONE: Unified Forecourt Command Dashboard

**Hackathon – The Innovation Fest | HP AI Fuel Stations**
**Submitted by:** Gaurav Shivakumar
**© Hindustan Petroleum Corporation Limited | 2026**

An AI-powered Smart Forecourt Management System for HPCL retail outlets,
built around three independent AI/ML modules unified into a single
real-time operations dashboard, **HP ONE**.

---

## The problem

HPCL retail outlets face three separate operational blind spots:

1. **Congestion & safety** — no intelligent way to route vehicles to the
   right dispenser bay, or catch safety violations, in real time.
2. **Invisible fraud & wear** — dispenser hardware faults and "air
   delivery" fraud are only caught during quarterly manual inspections,
   long after revenue or safety impact has already occurred.
3. **Unpredictable tank behaviour** — fuel run-outs, slow micro-leaks,
   and rainwater contamination in underground tanks are typically
   detected too late to prevent loss or environmental risk.

## The solution — three modules, one dashboard

| # | Module | Data source | AI/ML approach | Output |
|---|---|---|---|---|
| 1 | **Smart Bay Allocation System** | CCTV + ANPR | YOLOv8 vehicle/violation detection | Real-time dispenser guidance |
| 2 | **The Invisible Auditor** | FCC serial data (pulse rate, flow rate, K-factor, voltage) | Isolation Forest (unsupervised anomaly detection) | Nozzle-level fraud & failure alerts |
| 3 | **Predictive Tank Monitoring** | ATG console (Veeder-Root) | ARIMA / LSTM time-series forecasting | Reorder & contamination alerts |

All three feed into **HP ONE**, a single real-time command dashboard
giving forecourt managers unified visibility across safety, fraud, and
inventory — instead of three disconnected systems.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full technical
architecture diagram and how it maps onto this codebase.

---

## Repository structure

```
Project_UDAAN_HP_ONE/
├── README.md                     ← you are here
├── run.sh / run.bat               ← one-command quick start
├── docs/
│   └── ARCHITECTURE.md            ← full technical architecture
├── backend/                       ← FastAPI service + all 3 AI/ML modules
│   ├── main.py                    ← API entrypoint, aggregates all modules
│   ├── requirements.txt
│   ├── tests/
│   │   └── test_modules.py        ← unit tests (12 tests, all passing)
│   └── modules/
│       ├── smart_bay/             ← Module 1: ANPR + bay allocation
│       │   ├── anpr_detector.py
│       │   ├── bay_allocator.py
│       │   └── README.md
│       ├── invisible_auditor/     ← Module 2: FCC anomaly detection
│       │   ├── fcc_simulator.py
│       │   ├── anomaly_model.py
│       │   └── README.md
│       └── tank_monitoring/       ← Module 3: ATG forecasting
│           ├── atg_simulator.py
│           ├── forecast_model.py
│           └── README.md
└── frontend/                      ← HP ONE dashboard (no build step needed)
    ├── index.html
    ├── style.css
    └── app.js
```

---

## Quick start

### Option A — one command (recommended)

**macOS / Linux:**
```bash
chmod +x run.sh
./run.sh
```

**Windows:**
```
run.bat
```

This creates a virtual environment, installs `backend/requirements.txt`,
and starts the API at `http://localhost:8000`.

Then open `frontend/index.html` directly in your browser (double-click
it, or drag it into a browser tab). It will automatically connect to the
backend at `localhost:8000` and start showing live data.

### Option B — manual

```bash
cd backend
python3 -m venv venv
source venv/bin/activate        # venv\Scripts\activate.bat on Windows
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Then open `frontend/index.html` in a browser, or serve it:

```bash
cd frontend
python3 -m http.server 5500
# visit http://localhost:5500
```

### Running the tests

```bash
cd backend
pip install pytest
python -m pytest tests/ -v
```

All 12 tests should pass — they cover detection, allocation, anomaly
scoring, forecasting, and alert logic independently, plus a smoke test
of every API endpoint.

> **Note:** The dashboard runs fully self-contained with simulated
> sensor/camera data out of the box — no camera, dispenser, or ATG
> hardware connection is required to see it working end-to-end. Each
> module is written so a real data source (CCTV feed, FCC serial port,
> Veeder-Root console) can be swapped in without touching the model or
> API code — see each module's own README for the swap-in interface.

---

## What the dashboard shows

**Module 1 — Smart Bay Allocation:** a live forecourt layout of all
dispenser bays (open / busy / suspended for a violation), fed by
simulated ANPR detections with vehicle type, plate number, and detection
confidence — mirroring the CV demo behaviour shown in the pitch deck
("Car 0.77", "Person 0.41" style approximate confidences).

**Module 2 — The Invisible Auditor:** a per-nozzle health grid (8
nozzles) plus a live alert feed distinguishing "Air Delivery Fraud" from
"Mechanical Pre-Failure Drift," with an overall auditor health score.

**Module 3 — Predictive Tank Monitoring:** live fill-level gauges for
three tanks (Petrol, Diesel, Premium Petrol), a 12-hour ARIMA volume
forecast chart, and reorder / contamination alerts.

---

## Tech stack

- **Backend:** Python, FastAPI, scikit-learn (Isolation Forest),
  statsmodels (ARIMA), optional PyTorch (LSTM upgrade path)
- **Frontend:** vanilla HTML/CSS/JS + Chart.js (no build step —
  double-click `index.html` to preview)
- **CV pipeline (production path):** YOLOv8 (`ultralytics`) + OpenCV,
  pluggable OCR for plate reading

## Authors

**Gaurav Shivakumar** — 2nd-year B.Tech CSE (AI/ML), PES University,
Bengaluru. Summer Intern, HPCL Bengaluru Retail Zone (June–July 2026).
