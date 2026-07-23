"""
Project UDAAN — Module 3: Predictive Tank Monitoring
ATG (Automatic Tank Gauge / Veeder-Root console) data simulator.

Schema mirrors a real Veeder-Root ATG feed: volume (litres), product
temperature (deg C), and water-level (mm, at the tank bottom — a proxy
for rainwater ingress / contamination).

Simulated behaviour:
  - Volume decreases through the day as fuel is dispensed, with periodic
    step increases representing tanker replenishment.
  - Slow micro-leak mode: volume drifts down faster than dispensing alone
    would explain (small constant negative bias).
  - Water contamination mode: water-level rises steadily (rainwater
    ingress through a compromised seal / manhole).
"""

from __future__ import annotations

import random
import time
from dataclasses import dataclass


@dataclass
class ATGReading:
    tank_id: str
    product: str
    timestamp: float
    volume_litres: float
    temperature_c: float
    water_level_mm: float

    def to_dict(self) -> dict:
        return {
            "tank_id": self.tank_id,
            "product": self.product,
            "timestamp": self.timestamp,
            "volume_litres": round(self.volume_litres, 1),
            "temperature_c": round(self.temperature_c, 1),
            "water_level_mm": round(self.water_level_mm, 1),
        }


TANKS = [
    {"tank_id": "T-1", "product": "Petrol", "capacity": 20000},
    {"tank_id": "T-2", "product": "Diesel", "capacity": 25000},
    {"tank_id": "T-3", "product": "Premium Petrol", "capacity": 12000},
]


class ATGSimulator:
    def __init__(self, seed: int | None = None, leak_tank: str | None = "T-2"):
        self.rng = random.Random(seed)
        self.state = {
            t["tank_id"]: {
                "volume": t["capacity"] * self.rng.uniform(0.55, 0.85),
                "capacity": t["capacity"],
                "product": t["product"],
                "water_level": self.rng.uniform(2, 8),
            }
            for t in TANKS
        }
        self.leak_tank = leak_tank  # tank_id exhibiting a slow micro-leak, for demo purposes

    def step(self, dt_hours: float = 1.0) -> list[ATGReading]:
        readings = []
        for tank_id, s in self.state.items():
            # normal dispensing draw-down, scaled by time of day (rough demand curve)
            hour = time.localtime().tm_hour
            demand_factor = 1.4 if 7 <= hour <= 10 or 17 <= hour <= 20 else 0.8
            dispensed = self.rng.uniform(150, 400) * demand_factor * dt_hours

            leak_bias = 0.0
            if tank_id == self.leak_tank:
                leak_bias = self.rng.uniform(20, 45) * dt_hours  # slow micro-leak

            s["volume"] -= dispensed + leak_bias

            # tanker replenishment when low
            if s["volume"] < 0.15 * s["capacity"] and self.rng.random() < 0.3:
                s["volume"] += s["capacity"] * self.rng.uniform(0.5, 0.9)

            s["volume"] = max(0.0, min(s["capacity"], s["volume"]))

            # water ingress on the leaking tank, to demo contamination alerts too
            if tank_id == self.leak_tank:
                s["water_level"] += self.rng.uniform(0.05, 0.3) * dt_hours
            else:
                s["water_level"] += self.rng.uniform(-0.05, 0.05) * dt_hours
                s["water_level"] = max(0.0, s["water_level"])

            temperature = 28 + 4 * self.rng.random() - 2

            readings.append(
                ATGReading(
                    tank_id=tank_id,
                    product=s["product"],
                    timestamp=time.time(),
                    volume_litres=s["volume"],
                    temperature_c=temperature,
                    water_level_mm=s["water_level"],
                )
            )
        return readings
