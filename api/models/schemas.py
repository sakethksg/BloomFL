from __future__ import annotations

from typing import Optional
from pydantic import BaseModel


class NodeStateSchema(BaseModel):
    node_id: str
    round: int
    timestamp: float
    energy_state: str
    thermal_state: str
    cpu_temperature_c: Optional[float] = None
    battery_percent: Optional[float] = None
    is_plugged: Optional[bool] = None
    cpu_percent: Optional[float] = None
    cpu_freq_ratio: Optional[float] = None
    peer_count: int = 0
    is_running: bool = True
    train_loss: Optional[float] = None
    eval_loss: Optional[float] = None
    eval_accuracy: Optional[float] = None
    train_epochs: int = 0
    gossip_enabled: bool = True
    gossip_success: Optional[bool] = None
    gossip_peer: Optional[str] = None
    gossip_latency_ms: Optional[float] = None
    bytes_exchanged: Optional[int] = None
    # YOLO-specific metrics (real mAP / detection loss from ultralytics val)
    detection_precision: Optional[float] = None
    detection_map50: Optional[float] = None


class RoundStatsSchema(BaseModel):
    round_num: int
    mean_accuracy: Optional[float] = None
    std_accuracy: Optional[float] = None
    min_accuracy: Optional[float] = None
    max_accuracy: Optional[float] = None
    mean_loss: Optional[float] = None
    gossip_success_rate: Optional[float] = None
    mean_gossip_latency_ms: Optional[float] = None
    total_bytes_exchanged: Optional[int] = None
    nodes_reporting: int = 0


class SummarySchema(BaseModel):
    final_mean_accuracy: Optional[float] = None
    final_std_accuracy: Optional[float] = None
    total_bytes_mb: Optional[float] = None
    gossip_success_rate: Optional[float] = None
    mean_gossip_latency_ms: Optional[float] = None
    convergence_round: Optional[int] = None
    total_rounds: int = 0
    nodes_reporting: int = 0


class SimulationStartRequest(BaseModel):
    num_nodes: int = 3
    rounds: int = 20
    transport: str = "tcp"
    base_port: int = 50100
    mean_delay_ms: float = 0.0
    std_delay_ms: float = 0.0
    failure_prob: float = 0.0
    convergence_threshold: float = 0.02


class SimulationStatusSchema(BaseModel):
    status: str  # idle | running | finished | error
    progress_rounds: int = 0
    total_rounds: int = 0
    num_nodes: int = 0
    wall_time_seconds: Optional[float] = None
    error: Optional[str] = None


class SimulationResultSchema(BaseModel):
    num_nodes: int
    rounds: int
    wall_time_seconds: float
    converged: bool
    convergence_stats: dict


class ConfigSchema(BaseModel):
    node_id: str
    listen_host: str
    listen_port: int
    transport: str
    mdns_service_type: str
    peer_addrs: list[str]
    train_epochs_per_round: int
    batch_size: int
    learning_rate: float
    data_dir: str
    num_workers: int
    gossip_interval_seconds: float
    gossip_fan_out: int
    gossip_timeout_seconds: float
    max_payload_bytes: int
    aggregation_strategy: str
    momentum_alpha: float
    partial_merge_fraction: float
    adaptation_enabled: bool
    thermal_high_threshold: float
    thermal_critical_threshold: float
    battery_low_threshold: float
    battery_critical_threshold: float
    battery_high_threshold: float
    adaptation_hysteresis_rounds: int
    eval_every_n_rounds: int
    grpc_use_tls: bool
    key_storage_dir: str
    metrics_dir: str
    sim_base_port: int
    sim_network_delay_mean_ms: float
    sim_network_delay_std_ms: float
    sim_failure_probability: float
    # YOLO inference settings
    yolo_checkpoint: str
    yolo_conf: float
    yolo_img_size: int
    yolo_device: str


class ConfigPatchRequest(BaseModel):
    changes: dict[str, str | int | float | bool | list]


# ── Inference ─────────────────────────────────────────────────────────────────

class BoundingBoxSchema(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float
    conf: float
    class_id: int
    class_name: str


class DetectionResultSchema(BaseModel):
    boxes: list[BoundingBoxSchema]
    person_count: int
    inference_time_ms: float
    model_path: str


class NodeDetectionResultSchema(DetectionResultSchema):
    """DetectionResult extended with per-node identity fields.

    Used by the multi-checkpoint endpoints so callers know which node / checkpoint
    produced each result.  ``annotated_jpeg_b64`` is populated by the
    ``/detect/multi/annotated`` endpoint.
    """
    node_label: str
    annotated_jpeg_b64: Optional[str] = None
    error: Optional[str] = None


class CheckpointInfoSchema(BaseModel):
    label: str
    path: str
    exists: bool
    is_pretrained: bool
    detection_type: str = "unknown"  # "yolo", "fastsam", or "unknown"


class InferenceStatusSchema(BaseModel):
    model_loaded: bool
    checkpoint_path: str
    device: str
