#!/usr/bin/env python3
"""
Seed the metrics/ directory with realistic fake simulation data.

Usage:
    python scripts/seed_fake_data.py [--rounds 20] [--nodes 3] [--out ./metrics]

This writes one .jsonl file per node and also sets the simulation service
state to "finished" via a sidecar JSON so the UI shows a completed run.
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


# ── Accuracy / loss curves ─────────────────────────────────────────────────────

def sigmoid_accuracy(round_num: int, total_rounds: int, noise: float = 0.02) -> float:
    """Sigmoid-shaped learning curve from ~0.45 to ~0.88."""
    x = (round_num / max(total_rounds - 1, 1)) * 10 - 5
    base = 0.45 + 0.43 / (1 + math.exp(-x))
    return min(1.0, max(0.0, base + random.gauss(0, noise)))


def cross_entropy_loss(accuracy: float) -> float:
    """Approximate CE loss from accuracy."""
    p = max(0.01, min(0.99, accuracy))
    return -math.log(p) + random.gauss(0, 0.05)


# ── Record builder ─────────────────────────────────────────────────────────────

def make_record(
    node_id: str,
    round_num: int,
    total_rounds: int,
    timestamp: float,
    node_idx: int,
) -> dict:
    # Per-node slight offset so nodes don't all converge identically
    offset = node_idx * 0.02

    eval_accuracy = sigmoid_accuracy(round_num, total_rounds, noise=0.015) + offset * (
        1 - round_num / total_rounds
    )
    eval_accuracy = min(1.0, max(0.0, eval_accuracy))
    train_loss = cross_entropy_loss(eval_accuracy * 0.97)
    eval_loss = cross_entropy_loss(eval_accuracy)

    # Battery drains slowly; plugged in on even nodes
    is_plugged = node_idx % 2 == 0
    battery = (
        None
        if is_plugged
        else max(5.0, 95.0 - round_num * 3.0 + random.gauss(0, 2))
    )
    battery_pct = 100.0 if is_plugged else battery

    # CPU heats up under training and cools during gossip-only rounds
    training_intensity = 0.7 + 0.3 * random.random()
    cpu_temp = 55.0 + 20.0 * training_intensity + random.gauss(0, 3)
    cpu_pct = 40.0 + 45.0 * training_intensity + random.gauss(0, 5)
    cpu_freq_ratio = 0.6 + 0.4 * training_intensity + random.gauss(0, 0.05)

    # Gossip — occasionally fails
    gossip_success = random.random() > 0.08
    gossip_peer = f"sim-node-{(node_idx + 1) % 3:03d}" if gossip_success else None
    gossip_latency = (
        max(1.0, random.gauss(25, 8)) if gossip_success else None
    )
    bytes_exchanged = (
        random.randint(500_000, 5_000_000) if gossip_success else 0
    )

    # YOLO detection metrics (improve alongside accuracy)
    detection_map50 = eval_accuracy * 0.92 + random.gauss(0, 0.01)
    detection_precision = eval_accuracy * 0.95 + random.gauss(0, 0.01)

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
        "peer_count": 2,
        "is_running": True,
        "train_loss": round(train_loss, 6),
        "eval_loss": round(eval_loss, 6),
        "eval_accuracy": round(eval_accuracy, 6),
        "train_epochs": round_num,
        "gossip_enabled": True,
        "gossip_success": gossip_success,
        "gossip_peer": gossip_peer,
        "gossip_latency_ms": round(gossip_latency, 3) if gossip_latency else None,
        "bytes_exchanged": bytes_exchanged,
        "detection_precision": round(min(1.0, max(0.0, detection_precision)), 6),
        "detection_map50": round(min(1.0, max(0.0, detection_map50)), 6),
    }


# ── Sidecar simulation state ───────────────────────────────────────────────────

def write_sim_state(out_dir: Path, num_nodes: int, rounds: int, wall_time: float) -> None:
    """Write a JSON sidecar that simulation_service reads for GET /api/simulation/status."""
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
            "convergence_stats": {
                "convergence_round": rounds - 3,
                "final_mean_accuracy": 0.8721,
                "final_std_accuracy": 0.0118,
                "total_bytes_mb": 47.3,
                "gossip_success_rate": 0.921,
                "mean_gossip_latency_ms": 24.7,
            },
        },
    }
    sidecar = out_dir / "_sim_state.json"
    sidecar.write_text(json.dumps(state, indent=2))
    print(f"  Wrote sidecar → {sidecar}")


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Seed BloomFL fake metrics data")
    parser.add_argument("--rounds", type=int, default=20, help="Number of training rounds")
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

    # Simulate a run that started 5 minutes ago
    base_ts = time.time() - rounds * 15  # ~15 s per round

    print(f"\nSeeding fake data: {num_nodes} nodes × {rounds} rounds → {out_dir}\n")

    for node_idx in range(num_nodes):
        node_id = f"sim-node-{node_idx:03d}"
        records: list[dict] = []

        for r in range(1, rounds + 1):
            ts = base_ts + r * 15 + random.gauss(0, 1)
            rec = make_record(node_id, r, rounds, ts, node_idx)
            records.append(rec)

        out_file = out_dir / f"{node_id}.jsonl"
        with out_file.open("w") as f:
            for rec in records:
                f.write(json.dumps(rec) + "\n")

        final_acc = records[-1]["eval_accuracy"]
        print(f"  {node_id}  →  {out_file.name}  ({rounds} records, final_acc={final_acc:.4f})")

    wall_time = rounds * 15 + random.uniform(2, 8)
    write_sim_state(out_dir, num_nodes, rounds, wall_time)

    print(f"\nDone. {num_nodes * rounds} total metric records written.")
    print("Restart the API server (or it will auto-pick up the files) and open the UI.\n")


if __name__ == "__main__":
    main()
