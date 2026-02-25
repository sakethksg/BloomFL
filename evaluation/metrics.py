"""
MetricsCollector and per-round statistics aggregator for BloomFL.

Reads ``.jsonl`` metric files produced by ``NodeController`` and exposes
structured summaries suitable for reporting and plotting.
"""
from __future__ import annotations

import json
import statistics
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Optional


# ── Per-round aggregate ────────────────────────────────────────────────────────

@dataclass
class RoundStats:
    """Aggregated statistics across all nodes for a single round."""
    round_num: int
    mean_accuracy: float
    std_accuracy: float
    min_accuracy: float
    max_accuracy: float
    mean_loss: float
    gossip_success_rate: float       # fraction of rounds with successful gossip
    mean_gossip_latency_ms: float
    total_bytes_exchanged: int
    nodes_reporting: int


# ── MetricsCollector ───────────────────────────────────────────────────────────

class MetricsCollector:
    """Load, aggregate and summarise BloomFL node metrics.

    Args:
        metrics_dir: Directory containing ``<node_id>.jsonl`` files.
    """

    def __init__(self, metrics_dir: str) -> None:
        self._dir = Path(metrics_dir)

    # ── Loading ────────────────────────────────────────────────────────────────

    def load_raw(self) -> dict[str, list[dict]]:
        """Load all node metric files.

        Returns:
            Dict mapping ``node_id`` → list of raw metric dicts.
        """
        result: dict[str, list[dict]] = {}
        for path in sorted(self._dir.glob("*.jsonl")):
            records: list[dict] = []
            with path.open() as f:
                for line in f:
                    line = line.strip()
                    if line:
                        try:
                            records.append(json.loads(line))
                        except json.JSONDecodeError:
                            pass
            result[path.stem] = records
        return result

    # ── Aggregation ────────────────────────────────────────────────────────────

    def per_round_stats(self) -> list[RoundStats]:
        """Compute per-round statistics aggregated across all nodes.

        Returns:
            List of :class:`RoundStats` sorted by ``round_num``.
        """
        raw = self.load_raw()

        # Bucket records by round
        round_data: dict[int, list[dict]] = {}
        for node_id, records in raw.items():
            for rec in records:
                r = int(rec.get("round", 0))
                round_data.setdefault(r, []).append(rec)

        stats: list[RoundStats] = []
        for r in sorted(round_data):
            records = round_data[r]
            accs = [rec["eval_accuracy"] for rec in records if rec.get("eval_accuracy") is not None]
            losses = [rec["eval_loss"] for rec in records if rec.get("eval_loss") is not None]
            gossip_ok = [1 if rec.get("gossip_success") else 0 for rec in records]
            latencies = [rec["gossip_latency_ms"] for rec in records if rec.get("gossip_latency_ms") is not None]
            bytes_ex = [rec.get("bytes_exchanged", 0) for rec in records]

            stats.append(RoundStats(
                round_num=r,
                mean_accuracy=statistics.mean(accs) if accs else 0.0,
                std_accuracy=statistics.stdev(accs) if len(accs) > 1 else 0.0,
                min_accuracy=min(accs) if accs else 0.0,
                max_accuracy=max(accs) if accs else 0.0,
                mean_loss=statistics.mean(losses) if losses else 0.0,
                gossip_success_rate=statistics.mean(gossip_ok) if gossip_ok else 0.0,
                mean_gossip_latency_ms=statistics.mean(latencies) if latencies else 0.0,
                total_bytes_exchanged=sum(bytes_ex),
                nodes_reporting=len(records),
            ))

        return stats

    # ── Summary report ─────────────────────────────────────────────────────────

    def summary_report(self) -> dict:
        """Produce a high-level summary dictionary.

        Returns:
            Dict with keys: ``final_mean_accuracy``, ``final_std_accuracy``,
            ``total_rounds``, ``total_bytes_mb``, ``gossip_success_rate``,
            ``convergence_round`` (first round where std < 0.05 and mean > 0.5).
        """
        rounds_stats = self.per_round_stats()
        if not rounds_stats:
            return {"error": "no data"}

        last = rounds_stats[-1]
        total_bytes = sum(s.total_bytes_exchanged for s in rounds_stats)

        convergence_round: Optional[int] = None
        for s in rounds_stats:
            if s.std_accuracy < 0.05 and s.mean_accuracy > 0.50:
                convergence_round = s.round_num
                break

        return {
            "total_rounds": len(rounds_stats),
            "final_mean_accuracy": last.mean_accuracy,
            "final_std_accuracy": last.std_accuracy,
            "final_min_accuracy": last.min_accuracy,
            "final_max_accuracy": last.max_accuracy,
            "total_bytes_mb": total_bytes / (1024 * 1024),
            "gossip_success_rate": statistics.mean(s.gossip_success_rate for s in rounds_stats),
            "mean_gossip_latency_ms": statistics.mean(
                s.mean_gossip_latency_ms for s in rounds_stats if s.mean_gossip_latency_ms > 0
            ) if any(s.mean_gossip_latency_ms > 0 for s in rounds_stats) else 0.0,
            "convergence_round": convergence_round,
            "nodes_reporting": last.nodes_reporting,
        }

    def print_report(self) -> None:
        """Print a human-readable summary to stdout."""
        report = self.summary_report()
        print("\n" + "=" * 65)
        print("BloomFL Evaluation Summary")
        print("=" * 65)
        for k, v in report.items():
            if isinstance(v, float):
                print(f"  {k:35s}: {v:.4f}")
            elif v is None:
                print(f"  {k:35s}: N/A (not converged)")
            else:
                print(f"  {k:35s}: {v}")
        print("=" * 65)

    def save_json(self, output_path: str) -> None:
        """Save per-round stats to a JSON file."""
        rounds_stats = self.per_round_stats()
        data = [asdict(s) for s in rounds_stats]
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w") as f:
            json.dump(data, f, indent=2)
        print(f"Per-round metrics saved to {output_path}")
