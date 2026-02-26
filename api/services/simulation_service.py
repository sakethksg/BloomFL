"""
Simulation service — wraps SimulationRunner + ConvergenceChecker.
Broadcasts real-time progress events over the "simulation" WebSocket channel.
"""
from __future__ import annotations

import asyncio
import json as _json
import logging
import os
import time
from pathlib import Path
from typing import Optional

from api.models.schemas import SimulationStartRequest, SimulationStatusSchema

logger = logging.getLogger(__name__)


class SimulationService:
    """Singleton managing one simulation run at a time."""

    def __init__(self) -> None:
        self._status: str = "idle"          # idle | running | finished | error
        self._progress: int = 0
        self._total: int = 0
        self._num_nodes: int = 0
        self._wall_time: Optional[float] = None
        self._result: Optional[dict] = None
        self._error: Optional[str] = None
        self._task: Optional[asyncio.Task] = None
        self._stop_event = asyncio.Event()
        # Mutable list so the background thread can hand us the runner reference
        self._runner_ref: list = []
        # Load persisted state from sidecar (written by seed_fake_data.py or a
        # completed real run) so the API reflects the last known state after a
        # server restart.
        self._load_sidecar()

    # ── Sidecar persistence ─────────────────────────────────────────────────

    def _sidecar_path(self) -> Path:
        try:
            from api.dependencies import get_metrics_dir
            return Path(get_metrics_dir()) / "_sim_state.json"
        except Exception:
            return Path("./metrics/_sim_state.json")

    def _load_sidecar(self) -> None:
        """Restore state from a previously saved sidecar (if present)."""
        try:
            sidecar = self._sidecar_path()
            if not sidecar.exists():
                return
            data = _json.loads(sidecar.read_text())
            self._status = data.get("status", "idle")
            self._progress = data.get("progress_rounds", 0)
            self._total = data.get("total_rounds", 0)
            self._num_nodes = data.get("num_nodes", 0)
            self._wall_time = data.get("wall_time_seconds")
            self._error = data.get("error")
            self._result = data.get("result")
            logger.info("Loaded simulation state from sidecar: status=%s", self._status)
        except Exception as exc:
            logger.debug("Could not load sim sidecar: %s", exc)

    def _save_sidecar(self) -> None:
        """Persist current state to sidecar so it survives server restarts."""
        try:
            data = {
                "status": self._status,
                "progress_rounds": self._progress,
                "total_rounds": self._total,
                "num_nodes": self._num_nodes,
                "wall_time_seconds": self._wall_time,
                "error": self._error,
                "result": self._result,
            }
            sidecar = self._sidecar_path()
            sidecar.parent.mkdir(parents=True, exist_ok=True)
            sidecar.write_text(_json.dumps(data, indent=2))
        except Exception as exc:
            logger.debug("Could not save sim sidecar: %s", exc)

    # ── Public API ─────────────────────────────────────────────────────────

    def get_status(self) -> SimulationStatusSchema:
        return SimulationStatusSchema(
            status=self._status,
            progress_rounds=self._progress,
            total_rounds=self._total,
            num_nodes=self._num_nodes,
            wall_time_seconds=self._wall_time,
            error=self._error,
        )

    def get_result(self) -> Optional[dict]:
        return self._result

    async def start(self, req: SimulationStartRequest) -> None:
        if self._status == "running":
            raise RuntimeError("A simulation is already running.")

        self._status = "running"
        self._progress = 0
        self._total = req.rounds
        self._num_nodes = req.num_nodes
        self._wall_time = None
        self._result = None
        self._error = None
        self._runner_ref.clear()
        self._stop_event.clear()

        self._task = asyncio.create_task(self._run(req))

    async def stop(self) -> None:
        self._stop_event.set()
        # Kill node sub-processes via runner if available
        if self._runner_ref:
            try:
                self._runner_ref[0].stop()
            except Exception as exc:
                logger.warning("Runner stop error: %s", exc)
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
        self._status = "idle"
        self._runner_ref.clear()

    # ── Internal ───────────────────────────────────────────────────────────

    async def _run(self, req: SimulationStartRequest) -> None:
        """Run simulation in a thread; monitor progress and broadcast WS events."""
        from api.websocket.manager import manager
        from api.dependencies import get_metrics_dir

        # Resolve to absolute paths so subprocesses write to the same location
        metrics_dir = str(Path(get_metrics_dir()).resolve())
        keys_dir = str(Path(_get_bloomfl_config().key_storage_dir).resolve())

        env_overrides = {
            "BLOOMFL_SIM_BASE_PORT": str(req.base_port),
            "BLOOMFL_SIM_NETWORK_DELAY_MEAN_MS": str(req.mean_delay_ms),
            "BLOOMFL_SIM_NETWORK_DELAY_STD_MS": str(req.std_delay_ms),
            "BLOOMFL_SIM_FAILURE_PROBABILITY": str(req.failure_prob),
            "BLOOMFL_TRANSPORT": req.transport,
        }

        runner_ref = self._runner_ref  # closure ref for the thread

        def _thread_run():
            for k, v in env_overrides.items():
                os.environ[k] = v

            from simulation.runner import SimulationRunner

            runner = SimulationRunner(
                num_nodes=req.num_nodes,
                rounds=req.rounds,
                convergence_threshold=req.convergence_threshold,
                base_port=req.base_port,
                mean_delay_ms=req.mean_delay_ms,
                std_delay_ms=req.std_delay_ms,
                failure_prob=req.failure_prob,
                metrics_dir=Path(metrics_dir),
                keys_dir=Path(keys_dir),
            )
            runner_ref.append(runner)
            t0 = time.time()
            result = runner.run()
            wall = time.time() - t0
            return result, wall

        await manager.broadcast("simulation", {
            "event": "started",
            "message": (
                f"Simulation starting — {req.num_nodes} nodes, "
                f"{req.rounds} rounds, transport={req.transport}"
            ),
        })

        thread_task = asyncio.create_task(asyncio.to_thread(_thread_run))
        monitor_task = asyncio.create_task(
            self._monitor_progress(manager, metrics_dir, req.rounds)
        )

        try:
            result, wall = await thread_task
            self._status = "finished"
            self._progress = req.rounds
            self._wall_time = wall
            self._result = {
                "num_nodes": req.num_nodes,
                "rounds": req.rounds,
                "wall_time_seconds": wall,
                "converged": result.converged,
                "convergence_stats": result.convergence_stats,
            }
            self._save_sidecar()
            await manager.broadcast("simulation", {
                "event": "finished",
                "round": req.rounds,
                "message": (
                    f"Simulation finished in {wall:.1f}s — "
                    f"converged: {result.converged}"
                ),
            })
        except asyncio.CancelledError:
            # Stop subprocesses, then let the thread drain
            if runner_ref:
                try:
                    runner_ref[0].stop()
                except Exception:
                    pass
            thread_task.cancel()
            self._status = "idle"
            try:
                await manager.broadcast("simulation", {
                    "event": "stopped",
                    "message": "Simulation stopped by user",
                })
            except Exception:
                pass
            raise
        except Exception as exc:
            self._status = "error"
            self._error = str(exc)
            self._save_sidecar()
            logger.exception("Simulation error: %s", exc)
            try:
                await manager.broadcast("simulation", {
                    "event": "error",
                    "message": f"Simulation error: {exc}",
                })
            except Exception:
                pass
        finally:
            monitor_task.cancel()
            try:
                await monitor_task
            except asyncio.CancelledError:
                pass
            self._runner_ref.clear()

    async def _monitor_progress(
        self,
        manager,
        metrics_dir: str,
        total_rounds: int,
    ) -> None:
        """Poll JSONL files every 2 s; push round-progress events to the WS channel."""
        last_emitted = 0
        metrics_path = Path(metrics_dir)

        while True:
            await asyncio.sleep(2.0)
            try:
                max_round = _scan_max_round(metrics_path)
                if max_round > last_emitted:
                    last_emitted = max_round
                    self._progress = max_round
                    await manager.broadcast("simulation", {
                        "event": "round_complete",
                        "round": max_round,
                        "message": f"Round {max_round}/{total_rounds} complete",
                    })
            except Exception as exc:
                logger.debug("Progress monitor error: %s", exc)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _scan_max_round(metrics_path: Path) -> int:
    """Return the highest round number seen across all JSONL metric files."""
    max_round = 0
    try:
        for path in metrics_path.glob("*.jsonl"):
            try:
                with path.open() as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            rec = _json.loads(line)
                            r = int(rec.get("round", 0))
                            if r > max_round:
                                max_round = r
                        except (ValueError, _json.JSONDecodeError):
                            pass
            except OSError:
                pass
    except OSError:
        pass
    return max_round


def _get_bloomfl_config():
    """Return the BloomFL singleton config."""
    from src.bloomfl.config import get_config
    return get_config()


# Module-level singleton
_service: Optional[SimulationService] = None


def get_simulation_service() -> SimulationService:
    global _service
    if _service is None:
        _service = SimulationService()
    return _service
