"""
Multi-node local simulation runner for BloomFL.

Spawns ``num_nodes`` independent processes, each running a full
``NodeController``.  Ports are assigned sequentially starting from
``sim_base_port``.  All static peers are pre-configured via
``BLOOMFL_PEER_ADDRS`` so mDNS is not required for local tests.

Usage (from repo root)::

    python -m simulation.runner --num-nodes 5 --rounds 20

Or from Python::

    from simulation.runner import SimulationRunner
    runner = SimulationRunner(num_nodes=5, rounds=20)
    runner.run()
"""
from __future__ import annotations

import logging
import multiprocessing
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import click

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────
SIM_BASE_PORT = 55100
SIM_DATA_DIR = Path("/tmp/bloomfl_sim/data")
SIM_METRICS_DIR = Path("/tmp/bloomfl_sim/metrics")
SIM_KEYS_DIR = Path("/tmp/bloomfl_sim/keys")
SIM_DEFAULT_ROUNDS = 30


# ── Per-node process entry point ───────────────────────────────────────────────

def _node_process(
    node_index: int,
    num_nodes: int,
    port: int,
    all_ports: list[int],
    transport: str,
    max_rounds: int,
    data_dir: str,
    metrics_dir: str,
    keys_dir: str,
    mean_delay_ms: float,
    std_delay_ms: float,
    failure_prob: float,
) -> None:
    """Entry point for each simulation node process."""
    import json as _json
    # Must set env vars before importing bloomfl (pydantic-settings reads them at
    # class load time if we're not careful, so set before any import).
    node_id = f"sim-node-{node_index:03d}"
    # pydantic-settings v2 requires JSON-encoded arrays for list fields
    peer_addrs = _json.dumps([
        f"127.0.0.1:{p}" for i, p in enumerate(all_ports) if i != node_index
    ])

    os.environ["BLOOMFL_NODE_ID"] = node_id
    os.environ["BLOOMFL_LISTEN_PORT"] = str(port)
    os.environ["BLOOMFL_TRANSPORT"] = transport
    os.environ["BLOOMFL_PEER_ADDRS"] = peer_addrs
    os.environ["BLOOMFL_KEY_STORAGE_DIR"] = str(Path(keys_dir) / node_id)
    os.environ["BLOOMFL_METRICS_DIR"] = metrics_dir
    os.environ["BLOOMFL_DATA_DIR"] = data_dir
    # Keep gossip interval tight for simulation
    os.environ["BLOOMFL_GOSSIP_INTERVAL_SECONDS"] = "0"
    os.environ["BLOOMFL_TRAIN_EPOCHS_PER_ROUND"] = "1"
    os.environ["BLOOMFL_ADAPTATION_ENABLED"] = "false"

    # Remove cached config singleton so new env vars take effect
    for mod_name in list(sys.modules):
        if "bloomfl" in mod_name:
            del sys.modules[mod_name]

    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

    from bloomfl.config import reset_config, get_config
    reset_config()
    cfg = get_config()

    from bloomfl.node.controller import NodeController

    logging.basicConfig(
        level=logging.INFO,
        format=f"[{node_id}] %(levelname)s %(name)s: %(message)s",
    )

    controller = NodeController(
        config=cfg,
        node_index=node_index,
        num_nodes=num_nodes,
    )

    if mean_delay_ms > 0 or failure_prob > 0:
        from simulation.network_delay import NoisyTransport
        controller._transport = NoisyTransport(
            controller._transport,
            mean_ms=mean_delay_ms,
            std_ms=std_delay_ms,
            failure_prob=failure_prob,
            seed=node_index,
        )

    try:
        controller.start()
        logger.info("Node %s started on port %d", node_id, port)

        for round_num in range(1, max_rounds + 1):
            controller._run_round(round_num)
    except Exception as exc:
        logger.exception("Node %s crashed: %s", node_id, exc)
    finally:
        controller.stop()


# ── SimulationRunner ───────────────────────────────────────────────────────────

@dataclass
class SimulationResult:
    """Result summary returned by :meth:`SimulationRunner.run`."""
    num_nodes: int
    rounds: int
    wall_time_seconds: float
    converged: bool
    convergence_stats: dict = field(default_factory=dict)


class SimulationRunner:
    """Orchestrates a local multi-node BloomFL simulation.

    Args:
        num_nodes:      Number of simulated edge nodes.
        rounds:         Training rounds each node executes.
        transport:      ``"tcp"`` or ``"grpc"``.
        base_port:      Starting TCP port for node 0.
        mean_delay_ms:  Mean artificial network latency injected.
        std_delay_ms:   Stddev of artificial network latency.
        failure_prob:   Probability of simulated message drop (0–1).
        convergence_threshold: Accuracy stddev threshold for convergence check.
        data_dir:       Directory for training data.
        metrics_dir:    Directory for per-node metric JSONL files.
        keys_dir:       Directory for per-node key material.
    """

    def __init__(
        self,
        num_nodes: int = 5,
        rounds: int = SIM_DEFAULT_ROUNDS,
        transport: str = "tcp",
        base_port: int = SIM_BASE_PORT,
        mean_delay_ms: float = 0.0,
        std_delay_ms: float = 0.0,
        failure_prob: float = 0.0,
        convergence_threshold: float = 0.05,
        data_dir: Optional[Path] = None,
        metrics_dir: Optional[Path] = None,
        keys_dir: Optional[Path] = None,
    ) -> None:
        self._num_nodes = num_nodes
        self._rounds = rounds
        self._transport = transport
        self._base_port = base_port
        self._mean_delay_ms = mean_delay_ms
        self._std_delay_ms = std_delay_ms
        self._failure_prob = failure_prob
        self._convergence_threshold = convergence_threshold
        self._data_dir = Path(data_dir) if data_dir else SIM_DATA_DIR
        self._metrics_dir = Path(metrics_dir) if metrics_dir else SIM_METRICS_DIR
        self._keys_dir = Path(keys_dir) if keys_dir else SIM_KEYS_DIR

        # Ensure directories exist
        self._data_dir.mkdir(parents=True, exist_ok=True)
        self._metrics_dir.mkdir(parents=True, exist_ok=True)
        self._keys_dir.mkdir(parents=True, exist_ok=True)

        # Tracked so stop() can terminate them
        self._active_processes: list[multiprocessing.Process] = []

    # ── Stop support ───────────────────────────────────────────────────────────

    def stop(self) -> None:
        """Terminate all active node processes immediately."""
        for p in self._active_processes:
            if p.is_alive():
                logger.info("Terminating process %s", p.name)
                p.terminate()
        for p in self._active_processes:
            p.join(timeout=5)
            if p.is_alive():
                p.kill()
        self._active_processes.clear()

    # ── Public ─────────────────────────────────────────────────────────────────

    def run(self) -> SimulationResult:
        """Spawn all node processes, wait for completion, check convergence.

        Returns:
            :class:`SimulationResult` with timing + convergence information.
        """
        all_ports = [self._base_port + i for i in range(self._num_nodes)]
        processes: list[multiprocessing.Process] = []
        self._active_processes.clear()

        logger.info(
            "Starting simulation: %d nodes, %d rounds, transport=%s",
            self._num_nodes, self._rounds, self._transport,
        )
        t0 = time.monotonic()

        for i in range(self._num_nodes):
            p = multiprocessing.Process(
                target=_node_process,
                name=f"bloomfl-node-{i:03d}",
                kwargs=dict(
                    node_index=i,
                    num_nodes=self._num_nodes,
                    port=all_ports[i],
                    all_ports=all_ports,
                    transport=self._transport,
                    max_rounds=self._rounds,
                    data_dir=str(self._data_dir),
                    metrics_dir=str(self._metrics_dir),
                    keys_dir=str(self._keys_dir),
                    mean_delay_ms=self._mean_delay_ms,
                    std_delay_ms=self._std_delay_ms,
                    failure_prob=self._failure_prob,
                ),
                daemon=False,
            )
            p.start()
            processes.append(p)
            self._active_processes.append(p)
            # Brief stagger to avoid port collision during TCP startup
            time.sleep(0.15)

        logger.info("All %d node processes started", self._num_nodes)

        # Wait for all processes
        for p in processes:
            p.join(timeout=600)
            if p.exitcode is None:
                logger.warning("Process %s timed out, terminating", p.name)
                p.terminate()
                p.join(timeout=10)

        # Reap any lingering children
        for p in multiprocessing.active_children():
            if p.name.startswith("bloomfl-"):
                p.join(timeout=10)

        self._active_processes.clear()
        wall_time = time.monotonic() - t0
        logger.info("All nodes finished in %.1f seconds", wall_time)

        # Check convergence
        from simulation.convergence import ConvergenceChecker
        checker = ConvergenceChecker(
            metrics_dir=str(self._metrics_dir),
            threshold=self._convergence_threshold,
            window=5,
            min_rounds=max(5, self._rounds // 3),
        )
        converged, stats = checker.is_converged()
        checker.print_summary()

        return SimulationResult(
            num_nodes=self._num_nodes,
            rounds=self._rounds,
            wall_time_seconds=wall_time,
            converged=converged,
            convergence_stats=stats,
        )


# ── CLI ────────────────────────────────────────────────────────────────────────

@click.command()
@click.option("--num-nodes", default=5, show_default=True, help="Number of nodes")
@click.option("--rounds", default=SIM_DEFAULT_ROUNDS, show_default=True, help="Rounds per node")
@click.option("--transport", default="tcp", type=click.Choice(["tcp", "grpc"]), show_default=True)
@click.option("--base-port", default=SIM_BASE_PORT, show_default=True)
@click.option("--mean-delay-ms", default=0.0, show_default=True, help="Mean latency (ms)")
@click.option("--std-delay-ms", default=0.0, show_default=True, help="Latency stddev (ms)")
@click.option("--failure-prob", default=0.0, show_default=True, help="Message drop probability")
@click.option("--threshold", default=0.05, show_default=True, help="Convergence accuracy stddev threshold")
@click.option("--log-level", default="INFO", show_default=True)
def main(
    num_nodes: int,
    rounds: int,
    transport: str,
    base_port: int,
    mean_delay_ms: float,
    std_delay_ms: float,
    failure_prob: float,
    threshold: float,
    log_level: str,
) -> None:
    """Run a local multi-node BloomFL simulation."""
    logging.basicConfig(
        level=getattr(logging, log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    multiprocessing.set_start_method("spawn", force=True)
    runner = SimulationRunner(
        num_nodes=num_nodes,
        rounds=rounds,
        transport=transport,
        base_port=base_port,
        mean_delay_ms=mean_delay_ms,
        std_delay_ms=std_delay_ms,
        failure_prob=failure_prob,
        convergence_threshold=threshold,
    )
    result = runner.run()
    sys.exit(0 if result.converged else 1)


if __name__ == "__main__":
    main()
