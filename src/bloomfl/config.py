"""
BloomFL Configuration — all values readable from environment variables.
"""
from __future__ import annotations

import os
import secrets
from pathlib import Path
from typing import Literal

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Config(BaseSettings):
    """Central configuration for a BloomFL node.

    All fields can be overridden via environment variables with the
    ``BLOOMFL_`` prefix (e.g. ``BLOOMFL_NODE_ID=node-001``).
    """

    model_config = SettingsConfigDict(
        env_prefix="BLOOMFL_",
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # ── Node identity ────────────────────────────────────────────────────────
    node_id: str = ""  # auto-generated if empty

    # ── Network ──────────────────────────────────────────────────────────────
    listen_host: str = "0.0.0.0"
    listen_port: int = 50051
    transport: Literal["tcp", "grpc"] = "tcp"

    # ── mDNS discovery ───────────────────────────────────────────────────────
    mdns_service_type: str = "_bloomfl._tcp.local."
    peer_addrs: list[str] = []  # optional static bootstrap peers  "host:port"

    # ── Training ─────────────────────────────────────────────────────────────
    train_epochs_per_round: int = 1
    batch_size: int = 64
    learning_rate: float = 0.01
    data_dir: str = "./data"
    num_workers: int = 0  # DataLoader workers (0 = main thread, safe for multiprocessing)

    # ── Gossip ───────────────────────────────────────────────────────────────
    gossip_interval_seconds: float = 10.0
    gossip_fan_out: int = 1  # peers contacted per round
    gossip_timeout_seconds: float = 15.0
    max_payload_bytes: int = 50 * 1024 * 1024  # 50 MB safety limit

    # ── Aggregation ──────────────────────────────────────────────────────────
    aggregation_strategy: Literal["weighted_avg", "momentum", "partial"] = "weighted_avg"
    momentum_alpha: float = 0.9
    partial_merge_fraction: float = 0.5

    # ── Adaptation ───────────────────────────────────────────────────────────
    adaptation_enabled: bool = True
    thermal_high_threshold: float = 80.0   # °C — reduce training above this
    thermal_critical_threshold: float = 90.0  # °C — stop training above this
    battery_low_threshold: float = 20.0    # %  — reduce gossip below this
    battery_critical_threshold: float = 10.0  # % — stop gossip below this
    battery_high_threshold: float = 50.0   # %  — threshold for HIGH vs MEDIUM state
    adaptation_hysteresis_rounds: int = 2  # rounds before confirming a state change

    # ── Evaluation ────────────────────────────────────────────────────────────
    eval_every_n_rounds: int = 5           # run evaluation every N training rounds

    # ── Transport security ────────────────────────────────────────────────────
    grpc_use_tls: bool = False             # enable TLS on gRPC channel

    # ── Storage ───────────────────────────────────────────────────────────────
    key_storage_dir: str = "./keys"
    metrics_dir: str = "./metrics"

    # ── Simulation ────────────────────────────────────────────────────────────
    sim_base_port: int = 50051
    sim_network_delay_mean_ms: float = 0.0
    sim_network_delay_std_ms: float = 0.0
    sim_failure_probability: float = 0.0

    # ── YOLO Inference ────────────────────────────────────────────────────────
    yolo_checkpoint: str = "yolo12n.pt"
    yolo_conf: float = 0.35
    yolo_img_size: int = 320
    yolo_device: str = "cpu"

    # ── Field validators ──────────────────────────────────────────────────────

    @field_validator("train_epochs_per_round")
    @classmethod
    def _validate_epochs(cls, v: int) -> int:
        if v < 1:
            raise ValueError("train_epochs_per_round must be >= 1")
        return v

    @field_validator("gossip_fan_out")
    @classmethod
    def _validate_fan_out(cls, v: int) -> int:
        if v < 1:
            raise ValueError("gossip_fan_out must be >= 1")
        return v

    @field_validator("partial_merge_fraction")
    @classmethod
    def _validate_merge_fraction(cls, v: float) -> float:
        if not (0.0 <= v <= 1.0):
            raise ValueError("partial_merge_fraction must be in [0, 1]")
        return v

    @field_validator("momentum_alpha")
    @classmethod
    def _validate_momentum(cls, v: float) -> float:
        if not (0.0 <= v <= 1.0):
            raise ValueError("momentum_alpha must be in [0, 1]")
        return v

    @field_validator("eval_every_n_rounds")
    @classmethod
    def _validate_eval_freq(cls, v: int) -> int:
        if v < 1:
            raise ValueError("eval_every_n_rounds must be >= 1")
        return v

    @field_validator("adaptation_hysteresis_rounds")
    @classmethod
    def _validate_hysteresis(cls, v: int) -> int:
        if v < 1:
            raise ValueError("adaptation_hysteresis_rounds must be >= 1")
        return v

    def model_post_init(self, __context: object) -> None:
        # Auto-generate node_id if not provided
        if not self.node_id:
            object.__setattr__(self, "node_id", f"node-{secrets.token_hex(4)}")
        # NOTE: do NOT create directories here — that causes side effects on every
        # Config() instantiation (e.g. in tests).  Call ensure_dirs() explicitly
        # at node startup (in __main__.py or NodeController.start()).

    def ensure_dirs(self) -> None:
        """Create all required storage directories.  Call once at node startup."""
        Path(self.key_storage_dir).mkdir(parents=True, exist_ok=True)
        Path(self.metrics_dir).mkdir(parents=True, exist_ok=True)
        Path(self.data_dir).mkdir(parents=True, exist_ok=True)


# Module-level singleton (lazily initialised; tests can re-assign)
_config: Config | None = None


def get_config() -> Config:
    """Return the global Config singleton, creating it if necessary."""
    global _config
    if _config is None:
        _config = Config()
    return _config


def reset_config() -> None:
    """Reset the singleton — useful in tests."""
    global _config
    _config = None
