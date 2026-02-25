"""
Energy monitoring for BloomFL.

Reads battery status and CPU frequency via ``psutil``.
On desktop systems with no battery, returns ``EnergyState.HIGH``
(always full power), which is the safe default.
"""
from __future__ import annotations

import logging
from enum import Enum, auto

import psutil

logger = logging.getLogger(__name__)


class EnergyState(Enum):
    """Node energy state enumeration (coarsest to finest throttle)."""
    HIGH = auto()       # Plugged-in or charge ≥ 50 % → full operation
    MEDIUM = auto()     # 20–50 % charge → mild throttling
    LOW = auto()        # 10–20 % charge → reduced gossip frequency
    CRITICAL = auto()   # < 10 % charge → suspend gossip, minimal training


class EnergyMonitor:
    """Monitors battery / power state.

    Provides:
    - :meth:`get_state` — returns the current :class:`EnergyState`.
    - :meth:`battery_percent` — raw battery percentage (0–100), or ``None``.
    - :meth:`is_plugged` — True if on AC power.
    - :meth:`cpu_freq_ratio` — current CPU freq as fraction of max (0–1).

    Args:
        low_threshold:       Battery % below which state becomes ``LOW``.
        critical_threshold:  Battery % below which state becomes ``CRITICAL``.
        high_threshold:      Battery % above which state is ``HIGH`` (not
                             just ``MEDIUM``).  Defaults to 50.0 %.
    """

    def __init__(
        self,
        low_threshold: float = 20.0,
        critical_threshold: float = 10.0,
        high_threshold: float = 50.0,
    ) -> None:
        if not (0 <= critical_threshold < low_threshold < high_threshold <= 100):
            raise ValueError(
                "Thresholds must satisfy 0 ≤ critical < low < high ≤ 100."
            )
        self._low = low_threshold
        self._critical = critical_threshold
        self._high = high_threshold

    # ── Public interface ──────────────────────────────────────────────────────

    def get_state(self) -> EnergyState:
        """Return the current energy state.

        Returns ``EnergyState.HIGH`` when no battery is detected (desktop /
        server / always-on device).
        """
        battery = psutil.sensors_battery()
        if battery is None:
            return EnergyState.HIGH

        if battery.power_plugged:
            return EnergyState.HIGH

        pct = battery.percent
        if pct >= self._high:
            return EnergyState.HIGH
        elif pct >= self._low:
            return EnergyState.MEDIUM
        elif pct >= self._critical:
            return EnergyState.LOW
        else:
            return EnergyState.CRITICAL

    def battery_percent(self) -> float | None:
        """Return battery charge percentage, or ``None`` if unavailable."""
        batt = psutil.sensors_battery()
        return batt.percent if batt is not None else None

    def is_plugged(self) -> bool | None:
        """Return True if on AC power; None if no battery sensor found."""
        batt = psutil.sensors_battery()
        return batt.power_plugged if batt is not None else None

    def cpu_freq_ratio(self) -> float:
        """Return current CPU frequency as a fraction of max (0.0–1.0).

        Returns ``1.0`` if frequency data is unavailable.
        """
        freq = psutil.cpu_freq()
        if freq is None or freq.max == 0:
            return 1.0
        return min(1.0, max(0.0, freq.current / freq.max))

    def cpu_percent(self) -> float:
        """Return instantaneous CPU usage % (non-blocking, 0–100)."""
        return psutil.cpu_percent(interval=None)

    def summary(self) -> dict:
        """Return a dict of all energy metrics for logging."""
        state = self.get_state()
        batt_pct = self.battery_percent()
        return {
            "energy_state": state.name,
            "battery_percent": batt_pct,
            "is_plugged": self.is_plugged(),
            "cpu_freq_ratio": self.cpu_freq_ratio(),
            "cpu_percent": self.cpu_percent(),
        }
