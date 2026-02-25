"""
Thermal monitoring for BloomFL (Linux-focused).

Reads CPU temperature via:
1. ``psutil.sensors_temperatures()`` — preferred (handles multiple sensor types).
2. Linux sysfs ``/sys/class/thermal/thermal_zone*/temp`` — fallback.

On platforms where neither is available (macOS, Windows) returns
``ThermalState.NORMAL`` so the node continues operating at full capacity.
"""
from __future__ import annotations

import logging
import pathlib
from enum import Enum, auto
from typing import Optional

import psutil

logger = logging.getLogger(__name__)

# Ordered list of sensor names to try from psutil.sensors_temperatures()
_SENSOR_PRIORITY = ["coretemp", "k10temp", "cpu_thermal", "acpitz", "cpu-thermal", "soc-thermal"]
_SYSFS_THERMAL = pathlib.Path("/sys/class/thermal")


class ThermalState(Enum):
    """CPU thermal state enumeration."""
    NORMAL = auto()    # < 70 °C  — run at full speed
    WARM = auto()      # 70–79 °C — mild throttling
    HOT = auto()       # 80–89 °C — reduce batch size / training frequency
    CRITICAL = auto()  # ≥ 90 °C  — suspend training immediately
    UNKNOWN = auto()   # sensors not available — treat as NORMAL


class ThermalMonitor:
    """Monitors CPU temperature and returns a :class:`ThermalState`.

    Args:
        warm_threshold:     °C above which state becomes ``WARM``.
        hot_threshold:      °C above which state becomes ``HOT``.
        critical_threshold: °C above which state becomes ``CRITICAL``.
        sensor_key:         Preferred psutil sensor key.  ``None`` = auto-detect.
    """

    def __init__(
        self,
        warm_threshold: float = 70.0,
        hot_threshold: float = 80.0,
        critical_threshold: float = 90.0,
        sensor_key: Optional[str] = None,
    ) -> None:
        if not (warm_threshold < hot_threshold < critical_threshold):
            raise ValueError(
                "Thresholds must satisfy warm < hot < critical."
            )
        self._warm = warm_threshold
        self._hot = hot_threshold
        self._critical = critical_threshold
        self._sensor_key = sensor_key  # None = auto-detect on first call
        self._detected_sensor: Optional[str] = None

    # ── Public interface ──────────────────────────────────────────────────────

    def get_state(self) -> ThermalState:
        """Return the current thermal state."""
        temp = self.cpu_temperature()
        if temp is None:
            return ThermalState.UNKNOWN
        if temp >= self._critical:
            return ThermalState.CRITICAL
        elif temp >= self._hot:
            return ThermalState.HOT
        elif temp >= self._warm:
            return ThermalState.WARM
        return ThermalState.NORMAL

    def cpu_temperature(self) -> Optional[float]:
        """Return the maximum CPU temperature in °C, or ``None`` if unavailable."""
        temp = self._read_psutil()
        if temp is not None:
            return temp
        return self._read_sysfs()

    def all_temperatures(self) -> dict[str, list[dict]]:
        """Return all available sensor readings as a nested dict.

        Structure: ``{sensor_name: [{label, current, high, critical}, ...]}``.
        """
        temps = psutil.sensors_temperatures()
        if not temps:
            return {}
        result: dict[str, list[dict]] = {}
        for sensor_name, entries in temps.items():
            result[sensor_name] = [
                {
                    "label": e.label or sensor_name,
                    "current": e.current,
                    "high": e.high,
                    "critical": e.critical,
                }
                for e in entries
            ]
        return result

    def summary(self) -> dict:
        """Return a dict of thermal metrics for logging."""
        temp = self.cpu_temperature()
        return {
            "thermal_state": self.get_state().name,
            "cpu_temperature_c": temp,
            "sensor": self._detected_sensor or self._sensor_key or "unknown",
        }

    # ── Private helpers ───────────────────────────────────────────────────────

    def _read_psutil(self) -> Optional[float]:
        """Read max CPU temperature via psutil."""
        try:
            temps = psutil.sensors_temperatures()
        except AttributeError:
            # Platform not supported (e.g. macOS, Windows)
            return None

        if not temps:
            return None

        # Use explicit key if provided
        if self._sensor_key:
            entries = temps.get(self._sensor_key)
            if entries:
                return max(e.current for e in entries)
            return None

        # Auto-detect: try priority list, then anything with "cpu" in the name
        for key in _SENSOR_PRIORITY:
            entries = temps.get(key)
            if entries:
                self._detected_sensor = key
                return max(e.current for e in entries)

        for key, entries in temps.items():
            if "cpu" in key.lower() and entries:
                self._detected_sensor = key
                return max(e.current for e in entries)

        # Fallback: take global max across all sensors
        all_vals: list[float] = [
            e.current for entries in temps.values() for e in entries
        ]
        if all_vals:
            self._detected_sensor = "global_max"
            return max(all_vals)

        return None

    def _read_sysfs(self) -> Optional[float]:
        """Read maximum CPU temperature from Linux sysfs thermal zones."""
        if not _SYSFS_THERMAL.exists():
            return None
        max_temp: Optional[float] = None
        for zone_dir in sorted(_SYSFS_THERMAL.glob("thermal_zone*")):
            try:
                zone_type = (zone_dir / "type").read_text().strip().lower()
                # Focus on zones likely to be CPU
                if not any(kw in zone_type for kw in ("cpu", "acpi", "pkg", "x86", "soc")):
                    continue
                raw = int((zone_dir / "temp").read_text().strip())
                temp_c = raw / 1000.0
                if max_temp is None or temp_c > max_temp:
                    max_temp = temp_c
            except (OSError, ValueError):
                continue

        if max_temp is None:
            # Try all zones if none matched the keyword filter
            for zone_dir in sorted(_SYSFS_THERMAL.glob("thermal_zone*")):
                try:
                    raw = int((zone_dir / "temp").read_text().strip())
                    temp_c = raw / 1000.0
                    if max_temp is None or temp_c > max_temp:
                        max_temp = temp_c
                except (OSError, ValueError):
                    continue

        return max_temp
