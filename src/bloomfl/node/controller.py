"""
Node Controller — the top-level orchestrator for a BloomFL edge node.

Assembles all components from configuration and runs the continuous learning
loop:

    while running:
        1.  Monitor energy + thermal state.
        2.  Compute adaptation schedule.
        3.  (If scheduled) Train locally via Flower client.
        4.  (If enabled)   Pick a random peer from discovery.
        5.                 Execute gossip round (exchange + aggregate).
        6.                 Apply merged weights to local model.
        7.  Log metrics.
        8.  Sleep for the scheduled interval.

Usage:
    ctrl = NodeController(config)
    ctrl.start()   # non-blocking; starts background services
    ctrl.run()     # blocking; runs the learning loop until ctrl.stop()

Or as a single call (blocks forever):
    NodeController(config).start_and_run()
"""
from __future__ import annotations

import json
import logging
import random
import signal
import threading
import time
from pathlib import Path
from typing import Optional

import torch

from bloomfl.adaptation.manager import AdaptationManager, AdaptationSchedule
from bloomfl.config import Config
from bloomfl.discovery.mdns import MDNSDiscovery
from bloomfl.flower_client.client import BloomFLClient, EvalResult, TrainResult
from bloomfl.gossip.engine import GossipEngine, make_incoming_handler
from bloomfl.gossip.aggregation import aggregate
from bloomfl.models.yolo_person import YOLOPersonModel, get_weights, set_weights, get_dataloaders
from bloomfl.monitoring.energy import EnergyMonitor, EnergyState
from bloomfl.monitoring.thermal import ThermalMonitor, ThermalState
from bloomfl.security.key_manager import KeyManager
from bloomfl.transport.base import BaseTransport
from bloomfl.transport.factory import get_transport

logger = logging.getLogger(__name__)


class NodeMetrics:
    """Buffered metrics collector for a single node.

    Writes are batched in-memory and flushed to disk every ``flush_every``
    records or when :meth:`flush` is called explicitly (e.g. at shutdown).
    """

    def __init__(self, node_id: str, metrics_dir: str, flush_every: int = 10) -> None:
        self._node_id = node_id
        self._path = Path(metrics_dir) / f"{node_id}.jsonl"
        self._lock = threading.Lock()
        self._buffer: list[str] = []
        self._flush_every = flush_every

    def record(self, data: dict) -> None:
        """Buffer one record; flush to disk if the buffer threshold is reached."""
        data["node_id"] = self._node_id
        data["timestamp"] = time.time()
        line = json.dumps(data, separators=(",", ":"))
        with self._lock:
            self._buffer.append(line)
            if len(self._buffer) >= self._flush_every:
                self._write_and_clear()

    def flush(self) -> None:
        """Write all buffered records to disk immediately."""
        with self._lock:
            if self._buffer:
                self._write_and_clear()

    def _write_and_clear(self) -> None:
        """Append buffered lines to disk; MUST be called with ``self._lock`` held."""
        try:
            with self._path.open("a") as f:
                f.write("\n".join(self._buffer) + "\n")
        except OSError:
            logger.exception("Failed to write metrics to %s", self._path)
        finally:
            self._buffer.clear()


class NodeController:
    """Top-level controller for one BloomFL edge node.

    Args:
        config: Fully initialised :class:`~bloomfl.config.Config` object.
        node_index: 0-based index within a multi-node simulation (used for
                    dataset partitioning).
        num_nodes:  Total number of nodes (used for dataset partitioning).
    """

    def __init__(
        self,
        config: Config,
        node_index: int = 0,
        num_nodes: int = 1,
    ) -> None:
        self._config = config
        self._node_id = config.node_id
        self._running = False
        self._stop_event = threading.Event()

        # ── Ensure storage directories exist ──────────────────────────────────
        config.ensure_dirs()

        logger.info("Initialising BloomFL node: %s", self._node_id)

        # ── Device ────────────────────────────────────────────────────────────
        self._device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        logger.info("Compute device: %s", self._device)

        # ── Identity key manager ──────────────────────────────────────────────
        self._key_manager = KeyManager(
            key_dir=config.key_storage_dir,
            node_id=self._node_id,
        )

        # ── Model + data ──────────────────────────────────────────────────────
        self._model = YOLOPersonModel().to(self._device)
        train_loader, val_loader, test_loader = get_dataloaders(
            data_dir=config.data_dir,
            batch_size=config.batch_size,
            num_workers=config.num_workers,
            node_id=self._node_id,
            num_nodes=num_nodes,
            node_index=node_index,
        )
        self._train_loader = train_loader
        self._local_samples = len(train_loader.dataset)

        # ── Flower client ─────────────────────────────────────────────────────
        self._fl_client = BloomFLClient(
            model=self._model,
            train_loader=train_loader,
            val_loader=val_loader,
            test_loader=test_loader,
            device=self._device,
        )

        # ── Transport ─────────────────────────────────────────────────────────
        self._transport: BaseTransport = get_transport(config.transport)

        # ── Discovery ─────────────────────────────────────────────────────────
        self._discovery = MDNSDiscovery(
            node_id=self._node_id,
            port=config.listen_port,
            service_type=config.mdns_service_type,
            static_peers=config.peer_addrs,
            key_manager=self._key_manager,
        )

        # ── Gossip engine ─────────────────────────────────────────────────────
        self._gossip = GossipEngine(
            node_id=self._node_id,
            transport=self._transport,
            aggregation_strategy=config.aggregation_strategy,
            momentum=config.momentum_alpha,
            merge_fraction=config.partial_merge_fraction,
            gossip_timeout=config.gossip_timeout_seconds,
        )

        # ── Monitoring ────────────────────────────────────────────────────────
        self._energy_monitor = EnergyMonitor(
            low_threshold=config.battery_low_threshold,
            critical_threshold=config.battery_critical_threshold,
            high_threshold=config.battery_high_threshold,
        )
        self._thermal_monitor = ThermalMonitor(
            warm_threshold=70.0,
            hot_threshold=config.thermal_high_threshold,
            critical_threshold=config.thermal_critical_threshold,
        )

        # ── Adaptation ────────────────────────────────────────────────────────
        self._adaptation = AdaptationManager(
            default_epochs=config.train_epochs_per_round,
            default_batch_size=config.batch_size,
            default_learning_rate=config.learning_rate,
            default_gossip_interval=config.gossip_interval_seconds,
            hysteresis_rounds=config.adaptation_hysteresis_rounds,
        )

        # ── Current batch size (may change with adaptation) ────────────────────
        self._current_batch_size: int = config.batch_size

        # ── Metrics ───────────────────────────────────────────────────────────
        self._metrics = NodeMetrics(self._node_id, config.metrics_dir)

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def start(self) -> None:
        """Start background services (transport server + mDNS discovery)."""
        if self._running:
            raise RuntimeError("NodeController is already running.")

        # Start transport server — pass key_manager for ECIES decryption and
        # on_received_fn for server-side model aggregation
        incoming_handler = make_incoming_handler(
            node_id=self._node_id,
            get_weights_fn=lambda: get_weights(self._model),
            get_sample_count_fn=lambda: self._local_samples,
            on_received_fn=self._on_gossip_received,
            key_manager=self._key_manager,
        )
        self._transport.start_server(
            host=self._config.listen_host,
            port=self._config.listen_port,
            handler=incoming_handler,
        )
        logger.info("Transport server started on port %d", self._config.listen_port)

        # Start mDNS discovery
        self._discovery.start()

        self._running = True
        logger.info("Node %s started.", self._node_id)

    def stop(self) -> None:
        """Signal the learning loop to stop and clean up resources."""
        self._stop_event.set()
        self._running = False
        try:
            self._transport.stop_server()
        except Exception:
            logger.exception("Error stopping transport server")
        try:
            self._discovery.stop()
        except Exception:
            logger.exception("Error stopping mDNS discovery")
        # Flush any buffered metrics before exit
        try:
            self._metrics.flush()
        except Exception:
            logger.exception("Error flushing metrics")
        logger.info("Node %s stopped.", self._node_id)

    def start_and_run(self) -> None:
        """Convenience: start services and run the blocking learning loop."""
        self.start()
        self._setup_signal_handlers()
        self.run()

    # ── Server-side aggregation callback ──────────────────────────────────────

    def _on_gossip_received(
        self,
        peer_weights: list,
        peer_samples: float,
        peer_id: str,
    ) -> None:
        """Called by IncomingHandlerV2 when a peer's weights are successfully
        decrypted and verified.  Aggregates the received weights into the local
        model so the server node also benefits from each gossip exchange."""
        try:
            current_weights = get_weights(self._model)
            merged = aggregate(
                local_weights=current_weights,
                peer_weights=peer_weights,
                local_samples=float(self._local_samples),
                peer_samples=peer_samples,
                strategy=self._config.aggregation_strategy,
                momentum=self._config.momentum_alpha,
                merge_fraction=self._config.partial_merge_fraction,
            )
            set_weights(self._model, merged)
            logger.info(
                "Server-side aggregation from peer %s (%.0f samples) applied.",
                peer_id, peer_samples,
            )
        except Exception:
            logger.exception("Error in server-side aggregation from peer %s", peer_id)

    # ── Learning loop ─────────────────────────────────────────────────────────

    def run(self) -> None:
        """Run the continuous learning loop (blocks until stop() is called)."""
        logger.info("Node %s entering learning loop.", self._node_id)
        round_num = 0

        while not self._stop_event.is_set():
            round_num += 1
            t_round_start = time.monotonic()

            try:
                self._run_round(round_num)
            except Exception:
                logger.exception("Unexpected error in round %d", round_num)

            elapsed = time.monotonic() - t_round_start
            logger.debug("Round %d completed in %.2f s", round_num, elapsed)

        logger.info("Node %s exiting learning loop after %d rounds.", self._node_id, round_num)

    def _run_round(self, round_num: int) -> None:
        """Execute one round of the learning loop."""

        # ── 1. Monitor ────────────────────────────────────────────────────────
        energy_state: EnergyState = self._energy_monitor.get_state()
        thermal_state: ThermalState = self._thermal_monitor.get_state()

        energy_summary = self._energy_monitor.summary()
        thermal_summary = self._thermal_monitor.summary()

        logger.info(
            "Round %d: energy=%s thermal=%s",
            round_num, energy_state.name, thermal_state.name,
        )

        # ── 2. Adaptation schedule ────────────────────────────────────────────
        if self._config.adaptation_enabled:
            schedule = self._adaptation.compute_schedule(energy_state, thermal_state)
        else:
            from bloomfl.adaptation.manager import AdaptationSchedule
            schedule = AdaptationSchedule(
                train_epochs=self._config.train_epochs_per_round,
                gossip_enabled=True,
                sleep_seconds=self._config.gossip_interval_seconds,
                batch_size=self._config.batch_size,
                learning_rate=self._config.learning_rate,
            )

        logger.info("Schedule: %s", schedule)

        # ── 3. Local training ─────────────────────────────────────────────────
        train_result: Optional[TrainResult] = None
        if schedule.train_epochs > 0:
            # Rebuild DataLoader if batch_size changed
            if schedule.batch_size != self._current_batch_size:
                logger.info(
                    "Round %d: batch_size changed %d → %d, rebuilding DataLoader.",
                    round_num, self._current_batch_size, schedule.batch_size,
                )
                self._fl_client.train_loader = torch.utils.data.DataLoader(
                    self._train_loader.dataset,
                    batch_size=schedule.batch_size,
                    shuffle=True,
                    num_workers=self._config.num_workers,
                    pin_memory=torch.cuda.is_available(),
                    persistent_workers=(self._config.num_workers > 0),
                )
                self._current_batch_size = schedule.batch_size

            train_result = self._fl_client.train_one_round(
                epochs=schedule.train_epochs,
                learning_rate=schedule.learning_rate,
            )

        # ── 4. Peer selection ─────────────────────────────────────────────────
        gossip_result = None
        gossip_latency_ms: float = 0.0
        gossip_bytes: int = 0
        if schedule.gossip_enabled:
            peers = self._discovery.get_peers()
            if not peers:
                logger.info("Round %d: no peers available for gossip.", round_num)
            else:
                # Select up to gossip_fan_out random peers
                fan_out = min(self._config.gossip_fan_out, len(peers))
                selected_peers = random.sample(peers, fan_out)

                for peer in selected_peers:
                    try:
                        current_weights = get_weights(self._model)
                        t_gossip = time.monotonic()
                        result = self._gossip.run_round(
                            peer=peer,
                            local_weights=current_weights,
                            local_samples=float(self._local_samples),
                        )
                        gossip_latency_ms = (time.monotonic() - t_gossip) * 1000.0
                        gossip_result = result

                        # ── 5. Apply merged weights ───────────────────────────
                        if result.success and result.merged_weights is not None:
                            set_weights(self._model, result.merged_weights)
                            gossip_bytes += result.bytes_exchanged
                            logger.info(
                                "Round %d: applied merged weights from %s",
                                round_num, peer.node_id,
                            )
                        else:
                            logger.warning(
                                "Round %d: gossip with %s failed: %s",
                                round_num, peer.node_id, result.error,
                            )
                    except Exception:
                        logger.exception(
                            "Round %d: error during gossip with %s", round_num, peer
                        )

        # ── 6. Evaluation (every N rounds, configurable) ────────────────────
        eval_result: Optional[EvalResult] = None
        if round_num % self._config.eval_every_n_rounds == 0:
            eval_result = self._fl_client.evaluate(use_test=False)
            logger.info(
                "Round %d EVAL: loss=%.4f accuracy=%.4f",
                round_num, eval_result.loss, eval_result.accuracy,
            )

        # ── 7. Log metrics ────────────────────────────────────────────────────
        metric_data: dict = {
            "round": round_num,
            "energy_state": energy_state.name,
            "thermal_state": thermal_state.name,
            "train_loss": train_result.loss if train_result else None,
            "train_epochs": schedule.train_epochs,
            "gossip_enabled": schedule.gossip_enabled,
            "gossip_success": gossip_result.success if gossip_result else None,
            "gossip_peer": gossip_result.peer_id if gossip_result else None,
            "gossip_latency_ms": round(gossip_latency_ms, 2) if gossip_result else None,
            "bytes_exchanged": gossip_bytes,
            "eval_loss": eval_result.loss if eval_result else None,
            "eval_accuracy": eval_result.accuracy if eval_result else None,
            "peer_count": self._discovery.peer_count(),
            **energy_summary,
            **{f"thermal_{k}": v for k, v in thermal_summary.items()},
        }
        self._metrics.record(metric_data)

        # ── 8. Sleep ──────────────────────────────────────────────────────────
        sleep_time = schedule.sleep_seconds
        logger.debug("Round %d sleeping for %.1f s", round_num, sleep_time)
        self._stop_event.wait(timeout=sleep_time)

    # ── Signal handling ───────────────────────────────────────────────────────

    def _setup_signal_handlers(self) -> None:
        """Register SIGINT / SIGTERM handlers for graceful shutdown."""
        def _handler(signum, frame):
            logger.info("Signal %d received — stopping node.", signum)
            self.stop()

        signal.signal(signal.SIGINT, _handler)
        signal.signal(signal.SIGTERM, _handler)

    # ── Properties ────────────────────────────────────────────────────────────

    @property
    def node_id(self) -> str:
        return self._node_id

    @property
    def model(self) -> YOLOPersonModel:
        return self._model

    @property
    def is_running(self) -> bool:
        return self._running
