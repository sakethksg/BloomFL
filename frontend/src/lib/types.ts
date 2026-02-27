// Shared TypeScript types matching backend Pydantic schemas

export interface NodeState {
  node_id: string;
  round: number;
  timestamp: number;
  energy_state: "HIGH" | "MEDIUM" | "LOW" | "CRITICAL" | "UNKNOWN";
  thermal_state: "NORMAL" | "WARM" | "HOT" | "CRITICAL" | "UNKNOWN";
  cpu_temperature_c: number | null;
  battery_percent: number | null;
  is_plugged: boolean | null;
  cpu_percent: number | null;
  cpu_freq_ratio: number | null;
  peer_count: number;
  is_running: boolean;
  train_loss: number | null;
  eval_loss: number | null;
  eval_accuracy: number | null;
  train_epochs: number;
  gossip_enabled: boolean;
  gossip_success: boolean | null;
  gossip_peer: string | null;
  gossip_latency_ms: number | null;
  bytes_exchanged: number | null;
  // YOLO-specific metrics
  detection_precision: number | null;
  detection_map50: number | null;
}

export interface RoundStats {
  round_num: number;
  mean_accuracy: number | null;
  std_accuracy: number | null;
  min_accuracy: number | null;
  max_accuracy: number | null;
  mean_loss: number | null;
  gossip_success_rate: number | null;
  mean_gossip_latency_ms: number | null;
  total_bytes_exchanged: number | null;
  nodes_reporting: number;
}

export interface Summary {
  final_mean_accuracy: number | null;
  final_std_accuracy: number | null;
  total_bytes_mb: number | null;
  gossip_success_rate: number | null;
  mean_gossip_latency_ms: number | null;
  convergence_round: number | null;
  total_rounds: number;
  nodes_reporting: number;
}

export interface SimulationStatus {
  status: "idle" | "running" | "finished" | "error";
  progress_rounds: number;
  total_rounds: number;
  num_nodes: number;
  wall_time_seconds: number | null;
  error: string | null;
}

export interface SimulationStartRequest {
  num_nodes: number;
  rounds: number;
  transport: "tcp" | "grpc";
  base_port: number;
  mean_delay_ms: number;
  std_delay_ms: number;
  failure_prob: number;
  convergence_threshold: number;
}

export interface SimulationResult {
  num_nodes: number;
  rounds: number;
  wall_time_seconds: number;
  converged: boolean;
  convergence_stats: Record<string, unknown>;
}

export interface BloomFLConfig {
  node_id: string;
  listen_host: string;
  listen_port: number;
  transport: string;
  mdns_service_type: string;
  peer_addrs: string[];
  train_epochs_per_round: number;
  batch_size: number;
  learning_rate: number;
  data_dir: string;
  num_workers: number;
  gossip_interval_seconds: number;
  gossip_fan_out: number;
  gossip_timeout_seconds: number;
  max_payload_bytes: number;
  aggregation_strategy: string;
  momentum_alpha: number;
  partial_merge_fraction: number;
  adaptation_enabled: boolean;
  thermal_high_threshold: number;
  thermal_critical_threshold: number;
  battery_low_threshold: number;
  battery_critical_threshold: number;
  battery_high_threshold: number;
  adaptation_hysteresis_rounds: number;
  eval_every_n_rounds: number;
  grpc_use_tls: boolean;
  key_storage_dir: string;
  metrics_dir: string;
  sim_base_port: number;
  sim_network_delay_mean_ms: number;
  sim_network_delay_std_ms: number;
  sim_failure_probability: number;
  // YOLO inference config
  yolo_checkpoint: string;
  yolo_conf: number;
  yolo_img_size: number;
  yolo_device: string;
}

// ── Inference ─────────────────────────────────────────────────────────────────

export interface BoundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  conf: number;
  class_id: number;
  class_name: string;
}

export interface DetectionResult {
  boxes: BoundingBox[];
  person_count: number;
  inference_time_ms: number;
  model_path: string;
}

export interface NodeDetectionResult extends DetectionResult {
  node_label: string;
  annotated_jpeg_b64?: string;
  error?: string;
}

export interface CheckpointInfo {
  label: string;
  path: string;
  exists: boolean;
  is_pretrained: boolean;
  detection_type: "yolo" | "fastsam" | "unknown";
}

export interface InferenceStatus {
  model_loaded: boolean;
  checkpoint_path: string;
  device: string;
}
