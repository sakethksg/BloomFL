"""
Metrics service — thin async wrapper around evaluation.MetricsCollector.
"""
from __future__ import annotations

import asyncio
from dataclasses import asdict
from pathlib import Path

from evaluation.metrics import MetricsCollector
from api.models.schemas import RoundStatsSchema, SummarySchema, NodeStateSchema


def _get_collector(metrics_dir: str) -> MetricsCollector:
    return MetricsCollector(metrics_dir)


async def get_per_round_stats(metrics_dir: str) -> list[RoundStatsSchema]:
    def _load():
        return _get_collector(metrics_dir).per_round_stats()

    stats = await asyncio.to_thread(_load)
    return [RoundStatsSchema(**asdict(s)) for s in stats]


async def get_summary(metrics_dir: str) -> SummarySchema:
    def _load():
        return _get_collector(metrics_dir).summary_report()

    report = await asyncio.to_thread(_load)
    return SummarySchema(**report)


async def get_raw_by_node(metrics_dir: str) -> dict[str, list[dict]]:
    def _load():
        return _get_collector(metrics_dir).load_raw()

    return await asyncio.to_thread(_load)


async def get_node_latest(metrics_dir: str) -> list[NodeStateSchema]:
    """Return the most recent metric record for every node."""
    raw = await get_raw_by_node(metrics_dir)
    result: list[NodeStateSchema] = []
    for node_id, records in raw.items():
        if not records:
            continue
        rec = records[-1]
        result.append(_record_to_schema(rec))
    return result


async def get_node_history(metrics_dir: str, node_id: str) -> list[NodeStateSchema]:
    raw = await get_raw_by_node(metrics_dir)
    records = raw.get(node_id, [])
    return [_record_to_schema(r) for r in records]


def _record_to_schema(rec: dict) -> NodeStateSchema:
    return NodeStateSchema(
        node_id=rec.get("node_id", "unknown"),
        round=int(rec.get("round", 0)),
        timestamp=float(rec.get("timestamp", 0.0)),
        energy_state=rec.get("energy_state", "UNKNOWN"),
        thermal_state=rec.get("thermal_state", "UNKNOWN"),
        cpu_temperature_c=rec.get("cpu_temperature_c"),
        battery_percent=rec.get("battery_percent"),
        is_plugged=rec.get("is_plugged"),
        cpu_percent=rec.get("cpu_percent"),
        cpu_freq_ratio=rec.get("cpu_freq_ratio"),
        peer_count=int(rec.get("peer_count", 0)),
        is_running=bool(rec.get("is_running", True)),
        train_loss=rec.get("train_loss"),
        eval_loss=rec.get("eval_loss"),
        eval_accuracy=rec.get("eval_accuracy"),
        train_epochs=int(rec.get("train_epochs", 0)),
        gossip_enabled=bool(rec.get("gossip_enabled", True)),
        gossip_success=rec.get("gossip_success"),
        gossip_peer=rec.get("gossip_peer"),
        gossip_latency_ms=rec.get("gossip_latency_ms"),
        bytes_exchanged=rec.get("bytes_exchanged"),
        detection_precision=rec.get("detection_precision"),
        detection_map50=rec.get("detection_map50"),
    )
