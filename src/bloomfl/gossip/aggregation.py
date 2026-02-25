"""
Gossip aggregation strategies for BloomFL.

Three strategies are supported:

1. **weighted_average** — standard weighted FedAvg-style merge.
2. **momentum_merge**   — exponential moving average of local and peer weights.
3. **partial_merge**    — update only a random fraction of parameter tensors.

All functions operate on lists of ``numpy.ndarray`` and are pure (no side
effects on the input arrays).
"""
from __future__ import annotations

import logging
import random
from typing import Sequence

import numpy as np

logger = logging.getLogger(__name__)


# ── Weighted average ──────────────────────────────────────────────────────────

def weighted_average(
    weights_list: Sequence[list[np.ndarray]],
    num_samples_list: Sequence[float],
) -> list[np.ndarray]:
    """Compute a sample-count-weighted average of model parameter lists.

    Args:
        weights_list:     Sequence of per-node weight lists (each list is a
                          list of ndarrays matching the model's parameter order).
        num_samples_list: Corresponding sample counts for each entry.

    Returns:
        A new list of averaged ndarrays.

    Raises:
        ValueError: If lists are empty or lengths do not match.
    """
    if not weights_list:
        raise ValueError("weights_list must not be empty.")
    if len(weights_list) != len(num_samples_list):
        raise ValueError(
            f"Length mismatch: {len(weights_list)} weight lists but "
            f"{len(num_samples_list)} sample counts."
        )

    total_samples = sum(num_samples_list)
    if total_samples <= 0:
        raise ValueError("Total sample count must be positive.")

    result: list[np.ndarray] = []
    for layer_idx in range(len(weights_list[0])):
        weighted_sum = np.zeros_like(weights_list[0][layer_idx], dtype=np.float64)
        for weights, n in zip(weights_list, num_samples_list):
            weighted_sum += weights[layer_idx].astype(np.float64) * n
        result.append((weighted_sum / total_samples).astype(np.float32))

    return result


# ── Momentum merge ────────────────────────────────────────────────────────────

def momentum_merge(
    local_weights: list[np.ndarray],
    peer_weights: list[np.ndarray],
    momentum: float = 0.9,
) -> list[np.ndarray]:
    """Merge peer weights into local weights using exponential moving average.

    Formula: ``merged = momentum * local + (1 - momentum) * peer``

    Args:
        local_weights: Current node's weight list.
        peer_weights:  Peer's weight list (same structure as local).
        momentum:      EMA coefficient (0 = take all peer; 1 = keep all local).
                       Typical value: 0.9.

    Returns:
        New merged weight list.
    """
    if not 0.0 <= momentum <= 1.0:
        raise ValueError(f"momentum must be in [0, 1]; got {momentum}.")
    if len(local_weights) != len(peer_weights):
        raise ValueError(
            f"Parameter list length mismatch: local={len(local_weights)}, "
            f"peer={len(peer_weights)}."
        )

    return [
        (momentum * loc.astype(np.float64) + (1.0 - momentum) * peer.astype(np.float64)).astype(np.float32)
        for loc, peer in zip(local_weights, peer_weights)
    ]


# ── Partial merge ─────────────────────────────────────────────────────────────

def partial_merge(
    local_weights: list[np.ndarray],
    peer_weights: list[np.ndarray],
    merge_fraction: float = 0.5,
    seed: int | None = None,
) -> list[np.ndarray]:
    """Update a random subset of parameter layers from the peer.

    Layers that are NOT selected keep the local weights unchanged.
    Layers that ARE selected are replaced with a 50/50 average of
    local and peer values.

    Args:
        local_weights:   Current node's weight list.
        peer_weights:    Peer's weight list.
        merge_fraction:  Fraction of layers to update (0 = none; 1 = all).
        seed:            Optional RNG seed for reproducible tests.

    Returns:
        New merged weight list (same length as input lists).
    """
    if not 0.0 <= merge_fraction <= 1.0:
        raise ValueError(f"merge_fraction must be in [0, 1]; got {merge_fraction}.")
    if len(local_weights) != len(peer_weights):
        raise ValueError(
            f"Parameter list length mismatch: local={len(local_weights)}, "
            f"peer={len(peer_weights)}."
        )

    n_layers = len(local_weights)
    n_to_merge = max(1, int(n_layers * merge_fraction))

    rng = random.Random(seed)
    selected = set(rng.sample(range(n_layers), n_to_merge))

    result: list[np.ndarray] = []
    for i, (loc, peer) in enumerate(zip(local_weights, peer_weights)):
        if i in selected:
            merged = (loc.astype(np.float64) + peer.astype(np.float64)) / 2.0
            result.append(merged.astype(np.float32))
        else:
            result.append(loc.copy())

    logger.debug("partial_merge: updated %d / %d layers", n_to_merge, n_layers)
    return result


# ── Strategy dispatcher ────────────────────────────────────────────────────────

def aggregate(
    local_weights: list[np.ndarray],
    peer_weights: list[np.ndarray],
    local_samples: float,
    peer_samples: float,
    strategy: str = "weighted_avg",
    momentum: float = 0.9,
    merge_fraction: float = 0.5,
) -> list[np.ndarray]:
    """Unified aggregation entry-point used by the gossip engine.

    Args:
        local_weights:   This node's current weights.
        peer_weights:    Received peer weights.
        local_samples:   This node's training sample count.
        peer_samples:    Peer's training sample count.
        strategy:        One of ``"weighted_avg"``, ``"momentum"``, ``"partial"``.
        momentum:        Used by the ``"momentum"`` strategy.
        merge_fraction:  Used by the ``"partial"`` strategy.

    Returns:
        Merged weight list.
    """
    if strategy == "weighted_avg":
        return weighted_average(
            [local_weights, peer_weights],
            [local_samples, peer_samples],
        )
    elif strategy == "momentum":
        return momentum_merge(local_weights, peer_weights, momentum=momentum)
    elif strategy == "partial":
        return partial_merge(local_weights, peer_weights, merge_fraction=merge_fraction)
    else:
        raise ValueError(
            f"Unknown aggregation strategy '{strategy}'. "
            "Choices: 'weighted_avg', 'momentum', 'partial'."
        )
