"""
Project UDAAN — Module 2: The Invisible Auditor
FCC (Fuel Control Computer / Flow Control Computer) serial data simulator.

Real deployments read this stream directly off the dispenser's FCC serial
port (pulse rate, flow rate, K-factor, solenoid voltage). For local
development / demo without a physical dispenser, this simulator produces
the same schema with realistic baseline behaviour plus injected anomalies:

  - "Air delivery" fraud: flow rate stays nonzero while pulse rate drops
    toward zero (device dispenses "fuel" readings without real product
    moving through the meter — the classic tamper pattern).
  - Mechanical pre-failure drift: K-factor and voltage slowly drift out
    of their calibrated band over many cycles, weeks before a hard fault.
"""

from __future__ import annotations

import random
import time
from dataclasses import dataclass


@dataclass
class FCCReading:
    nozzle_id: str
    timestamp: float
    pulse_rate: float      # pulses/sec
    flow_rate: float       # litres/min
    k_factor: float        # pulses/litre (calibration constant, nominal ~ 100)
    voltage: float         # solenoid voltage, nominal ~ 24V

    def to_dict(self) -> dict:
        return {
            "nozzle_id": self.nozzle_id,
            "timestamp": self.timestamp,
            "pulse_rate": round(self.pulse_rate, 2),
            "flow_rate": round(self.flow_rate, 2),
            "k_factor": round(self.k_factor, 2),
            "voltage": round(self.voltage, 2),
        }

    def as_feature_vector(self) -> list[float]:
        return [self.pulse_rate, self.flow_rate, self.k_factor, self.voltage]


NOZZLE_IDS = [f"N-{i:02d}" for i in range(1, 9)]


class FCCSimulator:
    """
    Stateful per-nozzle simulator. Call `.step()` once per tick to get a
    fresh reading for every nozzle, with a small, controllable chance of
    injecting one of the two anomaly patterns onto a random nozzle.
    """

    def __init__(self, anomaly_rate: float = 0.05, seed: int | None = None):
        self.anomaly_rate = anomaly_rate
        self.rng = random.Random(seed)
        # drift state per nozzle, used for slow mechanical-failure pattern
        self._drift = {nid: 0.0 for nid in NOZZLE_IDS}
        self._active_air_fraud = set()

    def _nominal_reading(self, nozzle_id: str) -> FCCReading:
        drift = self._drift[nozzle_id]
        pulse_rate = self.rng.gauss(50, 2)
        flow_rate = pulse_rate / 20 + self.rng.gauss(0, 0.1)
        k_factor = 100 + drift + self.rng.gauss(0, 0.5)
        voltage = 24 + drift * 0.3 + self.rng.gauss(0, 0.2)
        return FCCReading(nozzle_id, time.time(), pulse_rate, flow_rate, k_factor, voltage)

    def step(self) -> list[FCCReading]:
        readings = []
        for nid in NOZZLE_IDS:
            # slow mechanical drift accumulates over time on a few nozzles
            if self.rng.random() < 0.01:
                self._drift[nid] += self.rng.uniform(0.5, 2.0)

            reading = self._nominal_reading(nid)

            # randomly start/continue an "air delivery" fraud episode
            if nid in self._active_air_fraud:
                reading.flow_rate = self.rng.gauss(4.5, 0.3)  # meter still "reads" flow
                reading.pulse_rate = self.rng.gauss(2, 0.5)   # but almost no real pulses
                if self.rng.random() < 0.2:
                    self._active_air_fraud.discard(nid)
            elif self.rng.random() < self.anomaly_rate / len(NOZZLE_IDS):
                self._active_air_fraud.add(nid)

            readings.append(reading)
        return readings
