"""In-memory telemetry cache and history for charts."""
import time
from collections import deque
from typing import Any

from . import config


class TelemetryStore:
    def __init__(self) -> None:
        self.latest: dict[str, Any] | None = None
        self.latest_at: float = 0.0
        # (wall_ts, sample) at ~1 Hz regardless of incoming rate
        self._history: deque[tuple[float, dict[str, Any]]] = deque(
            maxlen=config.TELEMETRY_HISTORY_SECONDS
        )
        self._last_stored: float = 0.0

    def add(self, sample: dict[str, Any]) -> None:
        now = time.time()
        self.latest = sample
        self.latest_at = now
        if now - self._last_stored >= 1.0:
            self._last_stored = now
            self._history.append((now, sample))

    def history(self, seconds: int = 900, max_points: int = 400) -> list[dict[str, Any]]:
        cutoff = time.time() - seconds
        points = [(ts, s) for ts, s in self._history if ts >= cutoff]
        if len(points) > max_points:
            step = len(points) / max_points
            points = [points[int(i * step)] for i in range(max_points)]
        out = []
        for ts, sample in points:
            vessel = sample.get("vessel") or {}
            orbit = vessel.get("orbit") or {}
            out.append(
                {
                    "ts": ts,
                    "ut": sample.get("ut"),
                    "alt_m": vessel.get("alt_sealevel_m"),
                    "apoapsis_m": orbit.get("apoapsis_m"),
                    "periapsis_m": orbit.get("periapsis_m"),
                    "surface_speed_ms": vessel.get("surface_speed_ms"),
                    "vertical_speed_ms": vessel.get("vertical_speed_ms"),
                    "mass_t": vessel.get("mass_t"),
                    "throttle": vessel.get("throttle"),
                }
            )
        return out
