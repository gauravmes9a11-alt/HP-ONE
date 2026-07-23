"""
Project UDAAN — Module 2: The Invisible Auditor
Model: unsupervised Isolation Forest over FCC serial-line features.

Why Isolation Forest:
  - No labelled fraud/failure data exists at rollout time (that's the
    whole problem this module solves) — Isolation Forest needs only
    "mostly normal" data to learn what an isolated / anomalous point
    looks like in feature space.
  - Cheap to retrain per-nozzle or per-outlet as baselines drift with
    seasonal temperature / equipment age.

Pipeline:
  1. Fit on a rolling window of recent "believed-normal" readings.
  2. Score every new reading; anomaly_score < 0 (per sklearn convention)
     flags an outlier.
  3. Classify the *type* of anomaly using simple, explainable rules on
     top of the raw features (air-delivery fraud vs mechanical
     pre-failure), because operators need an actionable label, not just
     "anomaly".
"""

from __future__ import annotations

from collections import deque

import numpy as np
from sklearn.ensemble import IsolationForest

from .fcc_simulator import FCCReading

FEATURE_NAMES = ["pulse_rate", "flow_rate", "k_factor", "voltage"]


def classify_anomaly(reading: FCCReading) -> str:
    """Rule-based labelling layer on top of the anomaly flag, so alerts are
    actionable ("air delivery fraud" vs "mechanical pre-failure") rather
    than a bare outlier score."""
    if reading.flow_rate > 2.0 and reading.pulse_rate < 10:
        return "Air Delivery Fraud"
    if abs(reading.k_factor - 100) > 5 or abs(reading.voltage - 24) > 2:
        return "Mechanical Pre-Failure Drift"
    return "Unclassified Anomaly"


class NozzleAuditor:
    """
    Maintains one Isolation Forest per nozzle (equipment ages and drifts
    independently), retrained periodically on a rolling window of recent
    readings so the "normal" baseline adapts over weeks, not just minutes.
    """

    def __init__(
        self,
        window_size: int = 300,
        retrain_every: int = 50,
        contamination: float = 0.05,
    ):
        self.window_size = window_size
        self.retrain_every = retrain_every
        self.contamination = contamination
        self._windows: dict[str, deque] = {}
        self._models: dict[str, IsolationForest] = {}
        self._since_retrain: dict[str, int] = {}

    def _ensure_nozzle(self, nozzle_id: str):
        if nozzle_id not in self._windows:
            self._windows[nozzle_id] = deque(maxlen=self.window_size)
            self._since_retrain[nozzle_id] = 0

    def _retrain(self, nozzle_id: str):
        data = np.array(list(self._windows[nozzle_id]))
        model = IsolationForest(
            n_estimators=100,
            contamination=self.contamination,
            random_state=42,
        )
        model.fit(data)
        self._models[nozzle_id] = model

    def observe(self, reading: FCCReading) -> dict:
        """Feed one reading; returns an alert dict (may be a 'normal' status)."""
        nid = reading.nozzle_id
        self._ensure_nozzle(nid)

        vec = reading.as_feature_vector()
        self._windows[nid].append(vec)
        self._since_retrain[nid] += 1

        is_anomaly = False
        score = 0.0

        have_model = nid in self._models
        enough_data = len(self._windows[nid]) >= max(30, self.window_size // 5)

        if enough_data and (not have_model or self._since_retrain[nid] >= self.retrain_every):
            self._retrain(nid)
            self._since_retrain[nid] = 0
            have_model = True

        if have_model:
            model = self._models[nid]
            pred = model.predict([vec])[0]  # -1 anomaly, 1 normal
            score = float(model.decision_function([vec])[0])
            is_anomaly = bool(pred == -1)

        label = classify_anomaly(reading) if is_anomaly else "Normal"

        return {
            "nozzle_id": nid,
            "timestamp": reading.timestamp,
            "is_anomaly": is_anomaly,
            "anomaly_score": round(score, 3),
            "label": label,
            "reading": reading.to_dict(),
        }
