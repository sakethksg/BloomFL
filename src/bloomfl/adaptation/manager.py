"""
Adaptive training schedule manager for BloomFL.

Combines energy state and thermal state into an :class:`AdaptationSchedule`
that tells the node controller how aggressively to train and gossip.

The decision matrix is:

+----------+---------+---------------------------------------------+
| Energy   | Thermal | Behaviour                                   |
+==========+=========+=============================================+
| HIGH     | NORMAL  | Full speed (use config defaults)            |
| HIGH     | WARM    | Reduce batch size slightly                  |
| HIGH     | HOT     | Halve epochs; double sleep                  |
| HIGH     | CRIT    | Skip training; gossip only                  |
| MEDIUM   | NORMAL  | Reduce epochs by 25 %                       |
| MEDIUM   | WARM    | Reduce epochs by 50 %                       |
| MEDIUM   | HOT     | Skip training; gossip only                  |
| MEDIUM   | CRIT    | Skip training and gossip; long sleep        |
| LOW      | ANY     | Skip training; gossip at reduced frequency  |
| CRITICAL | ANY     | Suspend all activity; very long sleep       |
+----------+---------+---------------------------------------------+

All numeric parameters default to the values configured in :class:`Config`.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

from bloomfl.monitoring.energy import EnergyState
from bloomfl.monitoring.thermal import ThermalState

logger = logging.getLogger(__name__)


# ── Schedule ──────────────────────────────────────────────────────────────────

@dataclass
class AdaptationSchedule:
    """Describes how aggressively the node should operate this round.

    Attributes:
        train_epochs:    Number of local training epochs (0 = skip training).
        gossip_enabled:  Whether to attempt a gossip exchange this round.
        sleep_seconds:   How long to sleep after the round.
        batch_size:      Mini-batch size for training.
        learning_rate:   LR for the SGD optimizer this round.
    """
    train_epochs: int
    gossip_enabled: bool
    sleep_seconds: float
    batch_size: int
    learning_rate: float

    def __str__(self) -> str:
        return (
            f"Schedule(epochs={self.train_epochs}, gossip={self.gossip_enabled}, "
            f"sleep={self.sleep_seconds:.1f}s, bs={self.batch_size}, lr={self.learning_rate:.4f})"
        )


# ── Manager ───────────────────────────────────────────────────────────────────

class AdaptationManager:
    """Computes the :class:`AdaptationSchedule` from energy + thermal state.

    Args:
        default_epochs:          Nominal training epochs per round (from config).
        default_batch_size:      Nominal batch size.
        default_learning_rate:   Nominal learning rate.
        default_gossip_interval: Nominal sleep between rounds (seconds).
        hysteresis_rounds:       Minimum consecutive rounds a new state must be
                                 observed before a transition is accepted.  This
                                 prevents schedule flapping on transient readings.
    """

    def __init__(
        self,
        default_epochs: int = 1,
        default_batch_size: int = 64,
        default_learning_rate: float = 0.01,
        default_gossip_interval: float = 10.0,
        hysteresis_rounds: int = 2,
    ) -> None:
        self._epochs = default_epochs
        self._batch = default_batch_size
        self._lr = default_learning_rate
        self._interval = default_gossip_interval
        self._hysteresis = max(1, hysteresis_rounds)
        # ── Hysteresis state ──────────────────────────────────────────────────
        self._committed_energy: EnergyState = EnergyState.HIGH
        self._committed_thermal: ThermalState = ThermalState.NORMAL
        self._candidate_energy: EnergyState = EnergyState.HIGH
        self._candidate_thermal: ThermalState = ThermalState.NORMAL
        self._candidate_count: int = 0

    # ── Public interface ──────────────────────────────────────────────────────

    def compute_schedule(
        self,
        energy: EnergyState,
        thermal: ThermalState,
    ) -> AdaptationSchedule:
        """Return the schedule for the current energy + thermal conditions.

        State transitions are debounced by ``hysteresis_rounds`` to avoid
        flapping on momentary sensor readings.  The last *committed* state is
        used until the new candidate has been observed for the required number
        of consecutive rounds.

        Args:
            energy:  Current :class:`EnergyState`.
            thermal: Current :class:`ThermalState`.

        Returns:
            :class:`AdaptationSchedule` with adjusted parameters.
        """
        # Normalise UNKNOWN thermal → NORMAL (safe assumption)
        if thermal == ThermalState.UNKNOWN:
            thermal = ThermalState.NORMAL

        # ── Hysteresis gate ───────────────────────────────────────────────────
        if energy == self._candidate_energy and thermal == self._candidate_thermal:
            self._candidate_count += 1
        else:
            # New candidate; reset counter
            self._candidate_energy = energy
            self._candidate_thermal = thermal
            self._candidate_count = 1

        if self._candidate_count >= self._hysteresis:
            # Candidate has been stable long enough — commit transition
            if (
                energy != self._committed_energy
                or thermal != self._committed_thermal
            ):
                logger.info(
                    "Adaptation state transition: energy %s→%s, thermal %s→%s",
                    self._committed_energy.name, energy.name,
                    self._committed_thermal.name, thermal.name,
                )
                self._committed_energy = energy
                self._committed_thermal = thermal

        effective_energy = self._committed_energy
        effective_thermal = self._committed_thermal

        schedule = self._decide(effective_energy, effective_thermal)
        logger.debug(
            "Adaptation: energy=%s thermal=%s (committed) → %s",
            effective_energy.name, effective_thermal.name, schedule,
        )
        return schedule

    # ── Decision logic ────────────────────────────────────────────────────────

    def _decide(self, energy: EnergyState, thermal: ThermalState) -> AdaptationSchedule:
        e, t = energy, thermal

        # CRITICAL energy — suspend everything
        if e == EnergyState.CRITICAL:
            return AdaptationSchedule(
                train_epochs=0,
                gossip_enabled=False,
                sleep_seconds=self._interval * 6,
                batch_size=self._batch,
                learning_rate=self._lr,
            )

        # CRITICAL thermal — skip training regardless of energy
        if t == ThermalState.CRITICAL:
            return AdaptationSchedule(
                train_epochs=0,
                gossip_enabled=(e != EnergyState.LOW),
                sleep_seconds=self._interval * 4,
                batch_size=self._batch,
                learning_rate=self._lr,
            )

        # LOW energy — skip training, reduced gossip
        if e == EnergyState.LOW:
            return AdaptationSchedule(
                train_epochs=0,
                gossip_enabled=True,
                sleep_seconds=self._interval * 3,
                batch_size=self._batch,
                learning_rate=self._lr,
            )

        # HOT thermal — halve epochs, double sleep
        if t == ThermalState.HOT:
            epochs = max(0, self._epochs // 2)
            gossip = e in (EnergyState.HIGH, EnergyState.MEDIUM)
            return AdaptationSchedule(
                train_epochs=epochs,
                gossip_enabled=gossip,
                sleep_seconds=self._interval * 2,
                batch_size=max(16, self._batch // 2),
                learning_rate=self._lr,
            )

        # MEDIUM energy — reduce by 25 %
        if e == EnergyState.MEDIUM:
            epochs = max(1, int(self._epochs * 0.75))
            if t == ThermalState.WARM:
                epochs = max(1, self._epochs // 2)
                sleep = self._interval * 1.5
            else:
                sleep = self._interval * 1.25
            return AdaptationSchedule(
                train_epochs=epochs,
                gossip_enabled=True,
                sleep_seconds=sleep,
                batch_size=self._batch,
                learning_rate=self._lr,
            )

        # HIGH energy, WARM thermal — slight batch reduction
        if t == ThermalState.WARM:
            return AdaptationSchedule(
                train_epochs=self._epochs,
                gossip_enabled=True,
                sleep_seconds=self._interval * 1.1,
                batch_size=max(16, int(self._batch * 0.75)),
                learning_rate=self._lr,
            )

        # HIGH energy, NORMAL thermal — full speed
        return AdaptationSchedule(
            train_epochs=self._epochs,
            gossip_enabled=True,
            sleep_seconds=self._interval,
            batch_size=self._batch,
            learning_rate=self._lr,
        )
