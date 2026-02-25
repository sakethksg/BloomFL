"""
Abstract transport interface and shared wire-format types for BloomFL.

Every transport implementation must expose:
- ``send_parameters``  — send own encrypted payload to a peer and receive theirs
- ``start_server``     — accept incoming exchange requests in a background thread
- ``stop_server``      — clean shutdown
- ``ping``             — liveness probe

Wire format is transport-agnostic: callers always deal with
:class:`WirePayload` dataclasses.
"""
from __future__ import annotations

import abc
from dataclasses import dataclass, field
from typing import Callable


# ── Wire-format dataclasses ───────────────────────────────────────────────────

@dataclass
class WirePayload:
    """Encrypted parameter payload as exchanged over the wire.

    Attributes:
        node_id:    Sender's node identifier.
        payload:    AES-256-GCM ciphertext of serialised weight list.
        nonce:      12-byte GCM nonce.
        public_key: Sender's ephemeral ECDH public key (PEM, bytes).
        round:      Sender's gossip round counter.
        weight:     Number of training samples (for weighted averaging).
        data_hash:  SHA-256 of the plaintext payload (checked after decryption).
    """
    node_id: str
    payload: bytes
    nonce: bytes
    public_key: bytes      # PEM-encoded ephemeral EC public key
    round: int = 0
    weight: float = 1.0
    data_hash: bytes = field(default=b"")


# Type alias for the server-side handler function.
# Called once per incoming exchange; must return this node's WirePayload.
ExchangeHandler = Callable[[WirePayload], WirePayload]


# ── Abstract base ─────────────────────────────────────────────────────────────

class BaseTransport(abc.ABC):
    """Abstract P2P transport for gossip parameter exchange.

    Subclasses implement TCP and gRPC variants.  Both are used identically
    by :class:`~bloomfl.gossip.engine.GossipEngine`.
    """

    # ── Server lifecycle ──────────────────────────────────────────────────────

    @abc.abstractmethod
    def start_server(
        self,
        host: str,
        port: int,
        handler: ExchangeHandler,
    ) -> None:
        """Start the transport server in a background thread/process.

        Args:
            host:    Bind address (e.g. ``"0.0.0.0"``).
            port:    TCP/gRPC port to listen on.
            handler: Callback invoked for each incoming exchange.
                     Receives the peer's :class:`WirePayload`, must return
                     own :class:`WirePayload`.
        """

    @abc.abstractmethod
    def stop_server(self) -> None:
        """Gracefully stop the transport server."""

    # ── Client operations ─────────────────────────────────────────────────────

    @abc.abstractmethod
    def send_parameters(
        self,
        peer_host: str,
        peer_port: int,
        payload: WirePayload,
        timeout: float = 15.0,
    ) -> WirePayload:
        """Send ``payload`` to a peer and return the peer's response.

        Args:
            peer_host: Peer's hostname or IP address.
            peer_port: Peer's listening port.
            payload:   This node's encrypted parameter payload.
            timeout:   Connection + read timeout in seconds.

        Returns:
            Peer's :class:`WirePayload`.

        Raises:
            TransportError: On connection failure, timeout, or protocol error.
        """

    @abc.abstractmethod
    def ping(
        self,
        peer_host: str,
        peer_port: int,
        node_id: str,
        timeout: float = 5.0,
    ) -> bool:
        """Return True if the peer is alive."""

    # ── Convenience ───────────────────────────────────────────────────────────

    @property
    @abc.abstractmethod
    def is_running(self) -> bool:
        """True when the server is actively listening."""


# ── Custom exceptions ─────────────────────────────────────────────────────────

class TransportError(RuntimeError):
    """Raised when a transport-level error occurs (connection, timeout, etc.)."""
