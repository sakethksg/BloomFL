#!/usr/bin/env python3
"""
Seed the metrics/ directory with realistic fake simulation data for YOLO11n.

Usage:
    python scripts/seed_fake_data.py [--rounds 50] [--nodes 3] [--out ./metrics]

This writes one .jsonl file per node and also sets the simulation service
state to "finished" via a sidecar JSON so the UI shows a completed run.

YOLO11n metrics are based on realistic federated learning convergence patterns.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import time
from pathlib import Path

# ── Reproducible randomness ────────────────────────────────────────────────────
SEED = 42
random.seed(SEED)

# ── Energy / thermal state helpers ────────────────────────────────────────────

ENERGY_STATES = ["HIGH", "MEDIUM", "LOW", "CRITICAL"]
THERMAL_STATES = ["NORMAL", "WARM", "HOT", "CRITICAL"]


def energy_state(battery: float) -> str:
    if battery >= 50:
        return "HIGH"
    if battery >= 20:
        return "MEDIUM"
    if battery >= 10:
        return "LOW"
    return "CRITICAL"


def thermal_state(temp: float) -> str:
    if temp < 70:
        return "NORMAL"
    if temp < 80:
        return "WARM"
    if temp < 90:
        return "HOT"
    return "CRITICAL"


# ── YOLO11n-specific metrics ──────────────────────────────────────────────────

def yolo_map50(round_num: int, total_rounds: int, node_offset: float = 0.0) -> float:
    """Realistic mAP@0.5 curve for YOLO11n: starts ~0.20, converges to ~0.78-0.82."""
    x = (round_num / max(total_rounds - 1, 1)) * 8 - 2
    base = 0.20 + 0.60 / (1 + math.exp(-x))
    noise = random.gauss(0, 0.012)
    return min(0.85, max(0.15, base + noise + node_offset))


def yolo_map50_95(map50: float) -> float:
    """mAP@0.5:0.95 is typically 0.45-0.55x of mAP@0.5 for YOLO models."""
    ratio = 0.48 + random.gauss(0, 0.02)
    return min(0.65, max(0.10, map50 * ratio))


def yolo_precision(map50: float, round_num: int) -> float:
    """Precision improves with training, correlates with mAP."""
    base = map50 * 0.95 + random.gauss(0, 0.015)
    # Early rounds have more variance
    if round_num < 5:
        base += random.gauss(0, 0.05)
    return min(0.90, max(0.20, base))


def yolo_recall(map50: float) -> float:
    """Recall typically slightly lower than precision in YOLO."""
    base = map50 * 0.88 + random.gauss(0, 0.02)
    return min(0.85, max(0.18, base))


def yolo_box_loss(round_num: int, total_rounds: int) -> float:
    """Box regression loss (exponential decay from ~2.5 to ~0.4)."""
    progress = round_num / max(total_rounds - 1, 1)
    base = 2.5 * math.exp(-3.5 * progress) + 0.35
    return max(0.30, base + random.gauss(0, 0.08))


def yolo_cls_loss(round_num: int, total_rounds: int) -> float:
    """Classification loss (exponential decay from ~1.8 to ~0.3)."""
    progress = round_num / max(total_rounds - 1, 1)
    base = 1.8 * math.exp(-3.2 * progress) + 0.28
    return max(0.25, base + random.gauss(0, 0.06))


def yolo_dfl_loss(round_num: int, total_rounds: int) -> float:
    """Distribution Focal Loss (exponential decay from ~1.2 to ~0.25)."""
    progress = round_num / max(total_rounds - 1, 1)
    base = 1.2 * math.exp(-3.0 * progress) + 0.22
    return max(0.20, base + random.gauss(0, 0.04))


def inference_time_ms(cpu_pct: float, thermal_throttle: bool = False) -> float:
    """YOLO11n inference time on edge device (8-25ms typically)."""
    base_time = 12.0  # Base inference time for YOLO11n
    cpu_factor = 1.0 + (100 - cpu_pct) / 200  # Slower when CPU is busy
    thermal_factor = 1.3 if thermal_throttle else 1.0
    
    time_ms = base_time * cpu_factor * thermal_factor + random.gauss(0, 1.5)
    return max(8.0, min(35.0, time_ms))


# ── Record builder ─────────────────────────────────────────────────────────────

def make_record(
    node_id: str,
    round_num: int,
    total_rounds: int,
    timestamp: float,
    node_idx: int,
) -> dict:
    # Per-node heterogeneity: different data distributions lead to different convergence
    node_offset = (node_idx - 1) * 0.015  # Nodes converge to slightly different mAPs
    
    # YOLO11n detection metrics
    map50 = yolo_map50(round_num, total_rounds, node_offset)
    map50_95 = yolo_map50_95(map50)
    precision = yolo_precision(map50, round_num)
    recall = yolo_recall(map50)
    
    # F1 score
    f1_score = 2 * (precision * recall) / max(precision + recall, 0.01)
    
    # YOLO training losses
    box_loss = yolo_box_loss(round_num, total_rounds)
    cls_loss = yolo_cls_loss(round_num, total_rounds)
    dfl_loss = yolo_dfl_loss(round_num, total_rounds)
    train_loss = box_loss + cls_loss + dfl_loss
    
    # Validation loss slightly higher than training
    eval_loss = train_loss * 1.08 + random.gauss(0, 0.05)
    
    # For compatibility, use mAP50 as eval_accuracy
    eval_accuracy = map50

    # Battery drains realistically; some nodes are plugged in
    is_plugged = node_idx % 2 == 0
    battery = (
        None
        if is_plugged
        else max(5.0, 95.0 - round_num * 2.5 + random.gauss(0, 2))
    )
    battery_pct = 100.0 if is_plugged else battery

    # YOLO11n is lightweight but still CPU-intensive during training
    # Training intensity varies by round (some rounds do more augmentation)
    training_intensity = 0.65 + 0.25 * random.random()
    
    # Thermal throttling can occur on edge devices
    thermal_throttle = round_num > total_rounds * 0.7 and not is_plugged and battery_pct < 30
    
    cpu_temp = 52.0 + 22.0 * training_intensity + random.gauss(0, 3.5)
    if thermal_throttle:
        cpu_temp += 8.0  # Overheating on low battery
    
    cpu_pct = 35.0 + 50.0 * training_intensity + random.gauss(0, 6)
    cpu_freq_ratio = 0.65 + 0.35 * training_intensity + random.gauss(0, 0.05)
    
    if thermal_throttle:
        cpu_freq_ratio *= 0.75  # Throttled frequency
    
    # Inference metrics
    infer_time = inference_time_ms(cpu_pct, thermal_throttle)
    fps = 1000.0 / infer_time

    # Gossip — occasionally fails due to network issues or peer unavailability
    gossip_success = random.random() > 0.06
    num_total_nodes = 3  # Adjust based on args.nodes if needed
    gossip_peer = f"sim-node-{(node_idx + 1) % num_total_nodes:03d}" if gossip_success else None
    
    # Gossip latency varies by network conditions
    if gossip_success:
        # Federated learning gossip involves exchanging model weights (~1-5 MB for YOLO11n)
        base_latency = 20.0 + random.gauss(0, 6)
        network_congestion = random.random() < 0.15  # 15% chance of congestion
        gossip_latency = base_latency * (2.5 if network_congestion else 1.0)
        gossip_latency = max(5.0, gossip_latency)
    else:
        gossip_latency = None
    
    # YOLO11n model size: ~4-6 MB of weights being exchanged
    # Includes gradients/updates in federated setting
    base_model_bytes = 4_500_000  # ~4.5 MB base
    bytes_exchanged = (
        int(base_model_bytes * (0.85 + random.random() * 0.30)) if gossip_success else 0
    )
    
    # Number of detected objects varies by dataset and model performance
    num_detections = int(max(0, round_num * 2 + random.gauss(15, 5)))

    return {
        "node_id": node_id,
        "round": round_num,
        "timestamp": timestamp,
        "energy_state": energy_state(battery_pct or 100.0),
        "thermal_state": thermal_state(cpu_temp),
        "cpu_temperature_c": round(cpu_temp, 2),
        "battery_percent": round(battery_pct, 2) if battery_pct is not None else None,
        "is_plugged": is_plugged,
        "cpu_percent": round(cpu_pct, 2),
        "cpu_freq_ratio": round(min(1.0, max(0.0, cpu_freq_ratio)), 4),
        "peer_count": num_total_nodes - 1,
        "is_running": True,
        # Training losses
        "train_loss": round(train_loss, 6),
        "eval_loss": round(eval_loss, 6),
        "box_loss": round(box_loss, 6),
        "cls_loss": round(cls_loss, 6),
        "dfl_loss": round(dfl_loss, 6),
        # Detection metrics (YOLO11n specific)
        "eval_accuracy": round(eval_accuracy, 6),  # Using mAP50 as primary accuracy
        "detection_map50": round(map50, 6),
        "detection_map50_95": round(map50_95, 6),
        "detection_precision": round(precision, 6),
        "detection_recall": round(recall, 6),
        "detection_f1": round(f1_score, 6),
        "num_detections": num_detections,
        # Inference performance
        "inference_time_ms": round(infer_time, 3),
        "fps": round(fps, 2),
        # Training metadata
        "train_epochs": round_num,
        "model_name": "yolo11n",
        "model_size_mb": 4.8,
        # Gossip/Federation
        "gossip_enabled": True,
        "gossip_success": gossip_success,
        "gossip_peer": gossip_peer,
        "gossip_latency_ms": round(gossip_latency, 3) if gossip_latency else None,
        "bytes_exchanged": bytes_exchanged,
    }


# ── Sidecar simulation state ───────────────────────────────────────────────────

def write_sim_state(out_dir: Path, num_nodes: int, rounds: int, wall_time: float) -> None:
    """Write a JSON sidecar that simulation_service reads for GET /api/simulation/status."""
    # More realistic YOLO11n convergence stats
    convergence_round = max(int(rounds * 0.75), rounds - 5)
    final_map50 = 0.78 + random.gauss(0, 0.02)
    final_std = 0.015 + random.gauss(0, 0.003)
    
    # Total data exchanged: ~4.5 MB per node per round for YOLO11n
    total_bytes_mb = (num_nodes * rounds * 4.5 * 0.94) / 1.0  # 94% success rate
    
    state = {
        "status": "finished",
        "progress_rounds": rounds,
        "total_rounds": rounds,
        "num_nodes": num_nodes,
        "wall_time_seconds": wall_time,
        "error": None,
        # Result sub-key
        "result": {
            "num_nodes": num_nodes,
            "rounds": rounds,
            "wall_time_seconds": wall_time,
            "converged": True,
            "model_name": "yolo11n",
            "convergence_stats": {
                "convergence_round": convergence_round,
                "final_mean_accuracy": round(final_map50, 6),
                "final_std_accuracy": round(final_std, 6),
                "final_map50_95": round(final_map50 * 0.48, 6),
                "total_bytes_mb": round(total_bytes_mb, 2),
                "gossip_success_rate": 0.94,
                "mean_gossip_latency_ms": 22.3,
                "mean_inference_ms": 13.5,
                "mean_fps": 74.1,
            },
        },
    }
    sidecar = out_dir / "_sim_state.json"
    sidecar.write_text(json.dumps(state, indent=2))
    print(f"  Wrote sidecar → {sidecar}")


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Seed BloomFL fake metrics data with realistic YOLO11n performance"
    )
    parser.add_argument(
        "--rounds", type=int, default=50, 
        help="Number of training rounds (YOLO typically needs 50-100 for convergence)"
    )
    parser.add_argument("--nodes", type=int, default=3, help="Number of simulated nodes")
    parser.add_argument("--out", type=str, default="./metrics", help="Output directory")
    parser.add_argument("--clear", action="store_true", help="Clear existing .jsonl files first")
    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.clear:
        for f in out_dir.glob("*.jsonl"):
            f.unlink()
        print(f"  Cleared existing .jsonl files in {out_dir}")

    num_nodes = args.nodes
    rounds = args.rounds

    # Simulate a run that started recently
    # YOLO11n training takes ~18-25s per round on edge devices in federated setting
    seconds_per_round = 20
    base_ts = time.time() - rounds * seconds_per_round

    print(f"\nSeeding realistic YOLO11n federated learning data:")
    print(f"  Nodes: {num_nodes}")
    print(f"  Rounds: {rounds}")
    print(f"  Output: {out_dir}")
    print(f"  Model: YOLO11n (4.8 MB)\n")

    for node_idx in range(num_nodes):
        node_id = f"sim-node-{node_idx:03d}"
        records: list[dict] = []

        for r in range(1, rounds + 1):
            ts = base_ts + r * seconds_per_round + random.gauss(0, 2.5)
            rec = make_record(node_id, r, rounds, ts, node_idx)
            records.append(rec)

        out_file = out_dir / f"{node_id}.jsonl"
        with out_file.open("w") as f:
            for rec in records:
                f.write(json.dumps(rec) + "\n")

        final_map50 = records[-1]["detection_map50"]
        final_map50_95 = records[-1]["detection_map50_95"]
        final_loss = records[-1]["train_loss"]
        print(f"  {node_id}  →  {out_file.name}")
        print(f"      mAP50: {final_map50:.4f} | mAP50-95: {final_map50_95:.4f} | Loss: {final_loss:.4f}")

    wall_time = rounds * seconds_per_round + random.uniform(5, 15)
    write_sim_state(out_dir, num_nodes, rounds, wall_time)

    print(f"\n✓ Done! Generated {num_nodes * rounds} metric records.")
    print(f"  Total training time: {wall_time:.1f}s (~{wall_time/60:.1f} minutes)")
    print(f"  Model: YOLO11n with realistic federated learning convergence")
    print("\nRestart the API server to load the data, then open the dashboard.\n")


if __name__ == "__main__":
    main()
