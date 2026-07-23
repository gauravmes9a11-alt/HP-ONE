"""
Project UDAAN — Module 3: Predictive Tank Monitoring
Forecasting: ARIMA (always-available baseline) with an optional LSTM
upgrade path (used when torch is installed and enough history exists).

Design notes:
  - ARIMA(p,d,q) on the volume series is the primary, dependency-light
    forecaster — it runs anywhere statsmodels is installed and needs no
    GPU or training data beyond the tank's own recent history.
  - An LSTM variant is included for when longer multi-season history is
    available (captures daily/weekly demand cycles ARIMA can miss). It's
    optional at import time so the module still works without torch.
  - Alerts are simple, explainable threshold rules layered on top of the
    forecast: reorder alert (predicted volume crosses a safety threshold
    within the forecast horizon) and contamination alert (water level
    trend exceeds a rate-of-rise threshold).
"""

from __future__ import annotations

import warnings

import numpy as np

warnings.filterwarnings("ignore")

try:
    from statsmodels.tsa.arima.model import ARIMA

    STATSMODELS_AVAILABLE = True
except Exception:  # pragma: no cover
    STATSMODELS_AVAILABLE = False

try:
    import torch
    import torch.nn as nn

    TORCH_AVAILABLE = True
except Exception:  # pragma: no cover
    TORCH_AVAILABLE = False


REORDER_THRESHOLD_FRACTION = 0.15  # alert when forecast volume < 15% capacity
WATER_RATE_ALERT_MM_PER_HR = 0.15  # alert when water level rising this fast


def forecast_volume_arima(history: list[float], horizon: int = 12) -> list[float]:
    """
    Forecasts the next `horizon` steps of tank volume using ARIMA(2,1,1).
    Falls back to a simple linear trend extrapolation if statsmodels isn't
    available or there isn't enough history to fit ARIMA meaningfully.
    """
    history = np.asarray(history, dtype=float)

    if not STATSMODELS_AVAILABLE or len(history) < 10:
        return _linear_fallback(history, horizon)

    try:
        model = ARIMA(history, order=(2, 1, 1))
        fit = model.fit()
        forecast = fit.forecast(steps=horizon)
        return [float(max(0.0, v)) for v in forecast]
    except Exception:
        return _linear_fallback(history, horizon)


def _linear_fallback(history: np.ndarray, horizon: int) -> list[float]:
    if len(history) < 2:
        last = float(history[-1]) if len(history) else 0.0
        return [last] * horizon
    x = np.arange(len(history))
    slope, intercept = np.polyfit(x, history, 1)
    future_x = np.arange(len(history), len(history) + horizon)
    forecast = slope * future_x + intercept
    return [float(max(0.0, v)) for v in forecast]


def reorder_alert(forecast: list[float], capacity: float) -> dict | None:
    threshold = capacity * REORDER_THRESHOLD_FRACTION
    for i, v in enumerate(forecast):
        if v < threshold:
            return {
                "type": "REORDER_ALERT",
                "message": f"Forecast volume drops below {int(threshold)} L "
                f"in ~{i + 1} hour(s). Schedule tanker replenishment.",
                "hours_to_threshold": i + 1,
                "forecast_volume": round(v, 1),
            }
    return None


def contamination_alert(water_levels: list[float]) -> dict | None:
    if len(water_levels) < 3:
        return None
    rate = (water_levels[-1] - water_levels[0]) / max(1, len(water_levels) - 1)
    if rate > WATER_RATE_ALERT_MM_PER_HR:
        return {
            "type": "CONTAMINATION_ALERT",
            "message": (
                f"Water level rising at {rate:.2f} mm/hr — possible rainwater "
                "ingress. Recommend inspection / dispensing shutoff."
            ),
            "rate_mm_per_hr": round(rate, 3),
            "current_level_mm": round(water_levels[-1], 1),
        }
    return None


# ---------------------------------------------------------------------------
# Optional LSTM forecaster (used automatically when torch + enough history
# are available; otherwise ARIMA above is the production-facing forecaster)
# ---------------------------------------------------------------------------
if TORCH_AVAILABLE:

    class TankLSTM(nn.Module):
        def __init__(self, hidden_size: int = 32):
            super().__init__()
            self.lstm = nn.LSTM(input_size=1, hidden_size=hidden_size, batch_first=True)
            self.fc = nn.Linear(hidden_size, 1)

        def forward(self, x):
            out, _ = self.lstm(x)
            return self.fc(out[:, -1, :])

    def forecast_volume_lstm(
        history: list[float], horizon: int = 12, lookback: int = 24, epochs: int = 30
    ) -> list[float]:
        """
        Lightweight LSTM trained on-the-fly on the tank's own recent history.
        Intended for when weeks of hourly history are available (captures
        daily demand cycles). Falls back to ARIMA if there isn't enough
        history to form even one training window.
        """
        history = np.asarray(history, dtype=float)
        if len(history) < lookback + 1:
            return forecast_volume_arima(history.tolist(), horizon)

        mean, std = history.mean(), history.std() + 1e-6
        norm = (history - mean) / std

        X, y = [], []
        for i in range(len(norm) - lookback):
            X.append(norm[i : i + lookback])
            y.append(norm[i + lookback])
        X = torch.tensor(np.array(X), dtype=torch.float32).unsqueeze(-1)
        y = torch.tensor(np.array(y), dtype=torch.float32).unsqueeze(-1)

        model = TankLSTM()
        optim = torch.optim.Adam(model.parameters(), lr=0.01)
        loss_fn = nn.MSELoss()

        model.train()
        for _ in range(epochs):
            optim.zero_grad()
            pred = model(X)
            loss = loss_fn(pred, y)
            loss.backward()
            optim.step()

        model.eval()
        seq = list(norm[-lookback:])
        preds = []
        with torch.no_grad():
            for _ in range(horizon):
                inp = torch.tensor(seq[-lookback:], dtype=torch.float32).view(1, lookback, 1)
                next_norm = model(inp).item()
                preds.append(next_norm)
                seq.append(next_norm)

        forecast = [max(0.0, p * std + mean) for p in preds]
        return forecast

else:

    def forecast_volume_lstm(history: list[float], horizon: int = 12, **_) -> list[float]:
        """torch not installed — transparently defers to ARIMA."""
        return forecast_volume_arima(history, horizon)
