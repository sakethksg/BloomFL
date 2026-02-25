"""
BloomFL benchmark CLI — orchestrates a simulation and produces an evaluation report.

Usage::

    python -m evaluation.benchmark --num-nodes 10 --rounds 50 --transport tcp

Or directly::

    python evaluation/benchmark.py --num-nodes 5 --rounds 20
"""
from __future__ import annotations

import json
import logging
import shutil
import sys
import time
from pathlib import Path

import click

logger = logging.getLogger(__name__)

# Clean working directories for a fresh benchmark run
SIM_ROOT = Path("/tmp/bloomfl_bench")


def _clean_sim_dirs() -> None:
    if SIM_ROOT.exists():
        shutil.rmtree(SIM_ROOT)
    (SIM_ROOT / "data").mkdir(parents=True, exist_ok=True)
    (SIM_ROOT / "metrics").mkdir(parents=True, exist_ok=True)
    (SIM_ROOT / "keys").mkdir(parents=True, exist_ok=True)


@click.command()
@click.option("--num-nodes", default=5, show_default=True, help="Number of simulated nodes")
@click.option("--rounds", default=30, show_default=True, help="Training rounds per node")
@click.option("--transport", default="tcp", type=click.Choice(["tcp", "grpc"]), show_default=True)
@click.option("--base-port", default=55200, show_default=True, help="Starting port for node 0")
@click.option("--mean-delay-ms", default=0.0, show_default=True, help="Mean simulated network latency (ms)")
@click.option("--std-delay-ms", default=0.0, show_default=True, help="Latency stddev (ms)")
@click.option("--failure-prob", default=0.0, show_default=True, help="Message drop probability (0–1)")
@click.option("--convergence-threshold", default=0.05, show_default=True, help="Accuracy stddev convergence criterion")
@click.option("--output-dir", default="./results", show_default=True, help="Directory for output files")
@click.option("--log-level", default="INFO", show_default=True)
def main(
    num_nodes: int,
    rounds: int,
    transport: str,
    base_port: int,
    mean_delay_ms: float,
    std_delay_ms: float,
    failure_prob: float,
    convergence_threshold: float,
    output_dir: str,
    log_level: str,
) -> None:
    """Run a BloomFL benchmark: simulation + evaluation report."""
    logging.basicConfig(
        level=getattr(logging, log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    import multiprocessing
    multiprocessing.set_start_method("spawn", force=True)

    _clean_sim_dirs()

    from simulation.runner import SimulationRunner
    runner = SimulationRunner(
        num_nodes=num_nodes,
        rounds=rounds,
        transport=transport,
        base_port=base_port,
        mean_delay_ms=mean_delay_ms,
        std_delay_ms=std_delay_ms,
        failure_prob=failure_prob,
        convergence_threshold=convergence_threshold,
        data_dir=SIM_ROOT / "data",
        metrics_dir=SIM_ROOT / "metrics",
        keys_dir=SIM_ROOT / "keys",
    )

    logger.info("=== BloomFL Benchmark Starting ===")
    logger.info(
        "Config: nodes=%d, rounds=%d, transport=%s, delay_ms=%.1f±%.1f, fail_p=%.2f",
        num_nodes, rounds, transport, mean_delay_ms, std_delay_ms, failure_prob,
    )

    t0 = time.monotonic()
    sim_result = runner.run()
    wall_time = time.monotonic() - t0

    # ── Evaluation ─────────────────────────────────────────────────────────────
    from evaluation.metrics import MetricsCollector
    collector = MetricsCollector(metrics_dir=str(SIM_ROOT / "metrics"))
    collector.print_report()
    summary = collector.summary_report()

    # Merge simulation result into summary
    summary["num_nodes"] = num_nodes
    summary["rounds_requested"] = rounds
    summary["wall_time_seconds"] = wall_time
    summary["converged"] = sim_result.converged
    summary["transport"] = transport

    # ── Save outputs ──────────────────────────────────────────────────────────
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    ts = int(time.time())
    summary_path = out_dir / f"benchmark_summary_{ts}.json"
    metrics_path = out_dir / f"per_round_metrics_{ts}.json"

    with open(summary_path, "w") as f:
        json.dump(summary, f, indent=2)
    logger.info("Summary saved to %s", summary_path)

    collector.save_json(str(metrics_path))

    print(f"\nBenchmark complete in {wall_time:.1f}s — "
          f"{'CONVERGED' if sim_result.converged else 'NOT CONVERGED'}")
    print(f"Results in: {out_dir}")

    sys.exit(0 if sim_result.converged else 1)


if __name__ == "__main__":
    main()
