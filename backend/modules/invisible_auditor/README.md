# Module 2 — The Invisible Auditor

**Problem Statement:** Transition from a reactive, quarterly manual
inspection model to a proactive, real-time monitoring system that
instantly detects "air delivery" fraud and predicts mechanical hardware
failures weeks before they require an emergency technician dispatch.

## How it works

```
FCC serial data (pulse rate, flow rate, K-factor, voltage)
   → per-nozzle rolling window
   → Isolation Forest (unsupervised anomaly scoring)
   → rule-based classification layer (fraud vs. mechanical drift)
   → alert
```

### Files

| File | Purpose |
|---|---|
| `fcc_simulator.py` | Generates FCC-serial-shaped readings per nozzle, with injectable "air delivery" fraud episodes and slow mechanical-drift patterns, for development/demo without a physical dispenser. |
| `anomaly_model.py` | `NozzleAuditor` — one Isolation Forest per nozzle, retrained on a rolling window so the "normal" baseline adapts as equipment ages. `classify_anomaly()` turns a raw outlier flag into an actionable label. |

### Why Isolation Forest

No labelled fraud/failure dataset exists at rollout — that's the exact
problem this module solves. Isolation Forest only needs a window of
"mostly normal" operation to learn the shape of typical readings, and
isolates points that don't fit — no labels required. It is also cheap
enough to retrain per-nozzle in real time as calibration drifts with
weather, load, and equipment age.

### Alert types

- **Air Delivery Fraud** — flow rate stays high while pulse rate collapses
  toward zero (the meter reports dispensing without real product moving
  through it — the classic "air delivery" tamper signature).
- **Mechanical Pre-Failure Drift** — K-factor or solenoid voltage drifts
  outside its calibrated band over many cycles, flagging wear weeks
  before a hard failure would force an emergency technician dispatch.

### Retraining cadence

Each nozzle keeps its own rolling window (`window_size`, default 300
readings) and retrains its Isolation Forest every `retrain_every` ticks
(default 50) — frequent enough to track slow drift, infrequent enough to
stay cheap to run continuously per outlet.
