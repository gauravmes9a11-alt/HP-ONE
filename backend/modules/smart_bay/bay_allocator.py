"""
Project UDAAN — Module 1: Smart Bay Allocation System
Allocator: assigns each detected vehicle to the optimal fuel dispenser bay.

Allocation logic (greedy, real-time):
  1. Filter bays that are OPEN (not OUT_OF_SERVICE) and match the fuel
     type the vehicle most likely needs (heuristic from vehicle class —
     e.g. Bike/Auto -> Petrol-only bays are preferred if available).
  2. Among eligible bays, pick the one with the shortest current queue.
  3. Ties are broken by physical proximity (bay index distance from the
     entry gate), so vehicles aren't routed across the whole forecourt.
  4. If a bay has an active safety violation, it is temporarily suspended
     from allocation until cleared.

This is intentionally a transparent, explainable greedy heuristic rather
than a black-box model — forecourt attendants need to be able to reason
about *why* a vehicle was sent to a particular bay.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class BayStatus(str, Enum):
    OPEN = "OPEN"
    BUSY = "BUSY"
    SUSPENDED = "SUSPENDED"  # active safety violation
    OUT_OF_SERVICE = "OUT_OF_SERVICE"


FUEL_PREFERENCE = {
    "Bike": "Petrol",
    "Auto": "Petrol",
    "Car": "Petrol",
    "Truck": "Diesel",
    "Bus": "Diesel",
}


@dataclass
class Bay:
    bay_id: str
    fuel_type: str  # "Petrol" | "Diesel" | "Both"
    status: BayStatus = BayStatus.OPEN
    queue_length: int = 0
    current_vehicle: Optional[str] = None
    last_updated: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return {
            "bay_id": self.bay_id,
            "fuel_type": self.fuel_type,
            "status": self.status.value,
            "queue_length": self.queue_length,
            "current_vehicle": self.current_vehicle,
        }


class BayAllocator:
    def __init__(self, bays: Optional[list[Bay]] = None):
        self.bays = bays or self._default_bays()
        self.allocation_log: list[dict] = []

    @staticmethod
    def _default_bays() -> list[Bay]:
        layout = [
            ("Bay-1", "Petrol"),
            ("Bay-2", "Petrol"),
            ("Bay-3", "Both"),
            ("Bay-4", "Diesel"),
            ("Bay-5", "Diesel"),
            ("Bay-6", "Both"),
        ]
        return [Bay(bay_id=bid, fuel_type=ft) for bid, ft in layout]

    def _eligible_bays(self, vehicle_type: str) -> list[Bay]:
        preferred_fuel = FUEL_PREFERENCE.get(vehicle_type, "Petrol")
        eligible = [
            b
            for b in self.bays
            if b.status in (BayStatus.OPEN, BayStatus.BUSY)
            and b.fuel_type in (preferred_fuel, "Both")
        ]
        return eligible

    def allocate(self, detection) -> Optional[dict]:
        """Allocate a bay for a Detection object (from anpr_detector.py)."""
        if detection.violation:
            # Vehicle flagged for a violation is held, not routed to a bay.
            return None

        eligible = self._eligible_bays(detection.vehicle_type)
        if not eligible:
            return None

        # Greedy: shortest queue, tie-broken by lowest bay index (proximity)
        chosen = min(eligible, key=lambda b: (b.queue_length, b.bay_id))
        chosen.queue_length += 1
        chosen.status = BayStatus.BUSY if chosen.queue_length > 0 else BayStatus.OPEN
        chosen.current_vehicle = detection.plate_number
        chosen.last_updated = time.time()

        record = {
            "bay_id": chosen.bay_id,
            "plate_number": detection.plate_number,
            "vehicle_type": detection.vehicle_type,
            "timestamp": detection.timestamp,
        }
        self.allocation_log.append(record)
        self.allocation_log = self.allocation_log[-50:]  # keep last 50
        return record

    def complete_service(self, bay_id: str):
        """Marks a bay's current vehicle as done, freeing capacity."""
        for b in self.bays:
            if b.bay_id == bay_id and b.queue_length > 0:
                b.queue_length -= 1
                b.current_vehicle = None
                b.status = BayStatus.OPEN if b.queue_length == 0 else BayStatus.BUSY
                b.last_updated = time.time()

    def suspend_bay(self, bay_id: str):
        for b in self.bays:
            if b.bay_id == bay_id:
                b.status = BayStatus.SUSPENDED

    def clear_suspension(self, bay_id: str):
        for b in self.bays:
            if b.bay_id == bay_id and b.status == BayStatus.SUSPENDED:
                b.status = BayStatus.OPEN if b.queue_length == 0 else BayStatus.BUSY

    def snapshot(self) -> list[dict]:
        return [b.to_dict() for b in self.bays]
