"""
Convergence checker for BloomFL multi-node simulation.

Reads per-node metric JSON Lines files and analyses:
- Accuracy variance across nodes per round.
- Mean loss trajectory.
- Gossip success rate.

Declaration of convergence: stddev(accuracy) < threshold over last N rounds.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)


class ConvergenceChecker:
    """Analyses node metrics to determine if the federated system has converged.

    Args:
        metrics_dir:    Directory containing ``<node_id>.jsonl`` metric files.
        threshold:      Max acceptable stddev of accuracy across nodes.
        window:         Number of most recent rounds to average over.
        min_rounds:     Minimum rounds before convergence can be declared.
    """

    def __init__(
        self,
        metrics_dir: str,
        threshold: float = 0.02,
        window: int = 5,
        min_rounds: int = 10,
    ) -> None:
        self._dir = Path(metrics_dir)
        self._threshold = threshold
        self._window = window
        self._min_rounds = min_rounds

    # ── Public interface ──────────────────────────────────────────────────────

    def load_all_metrics(self) -> dict[str, list[dict]]:
        """Load all ``*.jsonl`` files from metrics_dir.

        Returns:
            Dict mapping ``node_id`` → list of metric dicts (sorted by round).
        """
        result: dict[str, list[dict]] = {}
        for path in sorted(self._dir.glob("*.jsonl")):
            node_id = path.stem
            records: list[dict] = []
            with path.open() as f:
                for line in f:
                    line = line.strip()
                    if line:
                        try:
                            records.append(json.loads(line))
                        except json.JSONDecodeError:
                            pass
            # Sort by round, keep eval records only
            eval_records = [r for r in records if r.get("eval_accuracy") is not None]
            eval_records.sort(key=lambda r: r.get("round", 0))
            result[node_id] = eval_records
        return result

    def is_converged(self) -> tuple[bool, dict]:
        """Check whether the system has converged.

        Returns:
            ``(converged: bool, stats: dict)`` where stats contains diagnostic info.
        """
        metrics = self.load_all_metrics()
        if not metrics:
            return False, {"reason": "no metric files found"}

        # Collect per-round accuracy across nodes
        round_accuracies: dict[int, list[float]] = {}
        for node_id, records in metrics.items():
            for rec in records:
                r = rec.get("round", 0)
                acc = rec.get("eval_accuracy")
                if acc is not None:
                    round_accuracies.setdefault(r, []).append(float(acc))

        if not round_accuracies:
            return False, {"reason": "no eval_accuracy records found"}

        max_round = max(round_accuracies.keys())
        if max_round < self._min_rounds:
            return False, {
                "reason": f"insufficient rounds: {max_round} < {self._min_rounds}",
                "max_round": max_round,
            }

        # Look at the last `window` rounds
        recent_rounds = sorted(round_accuracies.keys())[-self._window:]
        recent_accs: list[float] = []
        for r in recent_rounds:
            recent_accs.extend(round_accuracies[r])

        if not recent_accs:
            return False, {"reason": "no recent accuracy data"}

        mean_acc = float(np.mean(recent_accs))
        std_acc = float(np.std(recent_accs))
        min_acc = float(np.min(recent_accs))
        max_acc = float(np.max(recent_accs))

        stats = {
            "max_round": max_round,
            "recent_rounds": recent_rounds,
            "mean_accuracy": mean_acc,
            "std_accuracy": std_acc,
            "min_accuracy": min_acc,
            "max_accuracy": max_acc,
            "threshold": self._threshold,
            "num_nodes": len(metrics),
        }

        converged = std_acc < self._threshold and mean_acc > 0.5
        if converged:
            logger.info(
                "CONVERGED: std=%.4f < threshold=%.4f  mean_acc=%.4f",
                std_acc, self._threshold, mean_acc,
            )
        else:
            logger.debug(
                "Not converged: std=%.4f threshold=%.4f  mean_acc=%.4f",
                std_acc, self._threshold, mean_acc,
            )

        return converged, stats

    def print_summary(self) -> None:
        """Print a human-readable convergence summary to stdout."""
        converged, stats = self.is_converged()
        print("\n" + "=" * 60)
        print("BloomFL Convergence Summary")
        print("=" * 60)
        for k, v in stats.items():
            if isinstance(v, float):
                print(f"  {k:25s}: {v:.4f}")
            else:
                print(f"  {k:25s}: {v}")
        print(f"\n  STATUS: {'CONVERGED ✓' if converged else 'NOT CONVERGED ✗'}")
        print("=" * 60)
