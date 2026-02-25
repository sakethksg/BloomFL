"""
Network delay and failure simulation for BloomFL.

Wraps a :class:`~bloomfl.transport.base.BaseTransport` to inject:
- Random latency (Gaussian distribution) on send_parameters.
- Message drop with configurable probability.
- Per-node failure/recovery cycles.

Usage::

    base = TCPTransport()
    noisy = NoisyTransport(base, mean_ms=20, std_ms=5, failure_prob=0.02)
    # Use noisy wherever a BaseTransport is expected
"""
from __future__ import annotations

import logging
import random
import time
from typing import Callable

from bloomfl.transport.base import BaseTransport, ExchangeHandler, TransportError, WirePayload

logger = logging.getLogger(__name__)


class NoisyTransport(BaseTransport):
    """Wraps a :class:`BaseTransport` with simulated network impairment.

    Args:
        inner:          The underlying transport to wrap.
        mean_ms:        Mean additional latency in milliseconds.
        std_ms:         Standard deviation of latency.
        failure_prob:   Probability (0–1) of a message being dropped entirely.
        seed:           Optional RNG seed for reproducibility.
    """

    def __init__(
        self,
        inner: BaseTransport,
        mean_ms: float = 0.0,
        std_ms: float = 0.0,
        failure_prob: float = 0.0,
        seed: int | None = None,
    ) -> None:
        self._inner = inner
        self._mean_ms = mean_ms
        self._std_ms = std_ms
        self._failure_prob = failure_prob
        self._rng = random.Random(seed)

    # ── Delegation ────────────────────────────────────────────────────────────

    def start_server(self, host: str, port: int, handler: ExchangeHandler) -> None:
        self._inner.start_server(host, port, handler)

    def stop_server(self) -> None:
        self._inner.stop_server()

    @property
    def is_running(self) -> bool:
        return self._inner.is_running

    def ping(self, peer_host: str, peer_port: int, node_id: str, timeout: float = 5.0) -> bool:
        return self._inner.ping(peer_host, peer_port, node_id, timeout)

    # ── Impaired send ─────────────────────────────────────────────────────────

    def send_parameters(
        self,
        peer_host: str,
        peer_port: int,
        payload: WirePayload,
        timeout: float = 15.0,
    ) -> WirePayload:
        # Simulate message drop
        if self._failure_prob > 0 and self._rng.random() < self._failure_prob:
            raise TransportError(
                f"[NoisyTransport] Simulated message drop to {peer_host}:{peer_port}"
            )

        # Inject latency
        if self._mean_ms > 0 or self._std_ms > 0:
            delay_ms = self._rng.gauss(self._mean_ms, self._std_ms)
            delay_s = max(0.0, delay_ms / 1000.0)
            if delay_s > 0:
                time.sleep(delay_s)

        return self._inner.send_parameters(peer_host, peer_port, payload, timeout)
