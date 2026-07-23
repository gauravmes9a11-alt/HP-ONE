# Module 1 — Smart Bay Allocation System

**Problem Statement:** Develop an AI-powered Smart Forecourt Management
System that uses CCTV analytics and Automatic Number Plate Recognition
(ANPR) to detect safety violations, identify vehicle types, and
intelligently guide vehicles to the optimal fuel dispenser — reducing
congestion, improving customer experience, and enhancing safety at HPCL
retail outlets.

## How it works

```
CCTV frame → YOLOv8 (vehicle class + safety-violation detection)
           → ANPR (plate localisation + OCR)
           → Bay Allocator (greedy, explainable heuristic)
           → Smart Bay assignment / hold for violation review
```

### Files

| File | Purpose |
|---|---|
| `anpr_detector.py` | Vehicle + plate detection. Runs in **live mode** (real YOLOv8 inference via `ultralytics` + OpenCV) when weights and a video source are supplied, and transparently falls back to a **simulation mode** otherwise so the pipeline can always be demoed. |
| `bay_allocator.py` | Assigns each detected vehicle to a bay using a transparent greedy heuristic: filter bays by fuel-type match → pick the shortest queue → tie-break by proximity. Vehicles with an active safety violation are held, not routed. |

### Allocation logic

1. Match vehicle type to expected fuel type (two-wheelers/cars → Petrol,
   trucks/buses → Diesel; "Both" bays serve everyone).
2. Filter to bays that are `OPEN` or `BUSY` (not suspended/out-of-service).
3. Pick the bay with the shortest queue; ties broken by bay index
   (physical proximity to the entry gate).
4. A bay with an active violation is `SUSPENDED` and excluded from
   allocation until cleared.

This is a deliberate choice over a black-box optimizer: forecourt
attendants need to be able to explain *why* a vehicle was routed
somewhere, not just trust an opaque score.

### Running the live CV pipeline

The simulation mode requires nothing extra. To run against a real camera
or recorded video:

```bash
pip install ultralytics opencv-python
```

```python
from modules.smart_bay.anpr_detector import get_detector

detector = get_detector(weights_path="best.pt", video_source="forecourt.mp4")
detection = detector.detect_next()
```

Plate OCR is left pluggable (`EasyOCR` / `Tesseract` slot in the marked
spot in `LiveANPRDetector.detect_next`) so the team can swap OCR engines
without touching the rest of the pipeline.
