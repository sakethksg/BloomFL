"""
TCP transport for BloomFL gossip parameter exchange.

Wire framing:
    [4 bytes big-endian length][JSON-encoded WirePayload as UTF-8 bytes]

Every field of :class:`~bloomfl.transport.base.WirePayload` that is ``bytes``
is base64-encoded for JSON compatibility.  The framing allows reliable
stream-based receipt without a fixed max message size.

Concurrency model:
- The server runs in a background ``threading.Thread``.
- Each accepted connection is handled in a separate daemon thread.
- All public methods are thread-safe.
"""
from __future__ import annotations

import base64
import json
import logging
import select
import socket
import struct
import threading
from typing import Optional

from bloomfl.transport.base import (
    BaseTransport,
    ExchangeHandler,
    TransportError,
    WirePayload,
)

logger = logging.getLogger(__name__)

_FRAME_HEADER = struct.Struct("!I")   # 4-byte big-endian unsigned int
_MAX_MSG_BYTES = 60 * 1024 * 1024    # 60 MB hard cap


# ── Serialisation ─────────────────────────────────────────────────────────────

def _encode(payload: WirePayload) -> bytes:
    """Serialise a WirePayload to JSON bytes (bytes fields → base64 str)."""
    d = {
        "node_id":    payload.node_id,
        "payload":    base64.b64encode(payload.payload).decode(),
        "nonce":      base64.b64encode(payload.nonce).decode(),
        "public_key": base64.b64encode(payload.public_key).decode(),
        "round":      payload.round,
        "weight":     payload.weight,
        "data_hash":  base64.b64encode(payload.data_hash).decode(),
    }
    return json.dumps(d, separators=(",", ":")).encode()


def _decode(raw: bytes) -> WirePayload:
    """Deserialise JSON bytes into a WirePayload."""
    d = json.loads(raw.decode())
    return WirePayload(
        node_id=d["node_id"],
        payload=base64.b64decode(d["payload"]),
        nonce=base64.b64decode(d["nonce"]),
        public_key=base64.b64decode(d["public_key"]),
        round=int(d.get("round", 0)),
        weight=float(d.get("weight", 1.0)),
        data_hash=base64.b64decode(d.get("data_hash", "")),
    )


# ── Socket I/O helpers ────────────────────────────────────────────────────────

def _send_frame(sock: socket.socket, data: bytes) -> None:
    """Send length-prefixed frame."""
    if len(data) > _MAX_MSG_BYTES:
        raise TransportError(
            f"Outgoing message ({len(data)} bytes) exceeds limit "
            f"({_MAX_MSG_BYTES} bytes)."
        )
    header = _FRAME_HEADER.pack(len(data))
    sock.sendall(header + data)


def _recv_exact(sock: socket.socket, n: int) -> bytes:
    """Read exactly *n* bytes from *sock*; raises ``TransportError`` on EOF."""
    buf = bytearray()
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise TransportError("Connection closed unexpectedly while reading.")
        buf.extend(chunk)
    return bytes(buf)


def _recv_frame(sock: socket.socket) -> bytes:
    """Read a length-prefixed frame and return the payload bytes."""
    header = _recv_exact(sock, _FRAME_HEADER.size)
    (length,) = _FRAME_HEADER.unpack(header)
    if length > _MAX_MSG_BYTES:
        raise TransportError(
            f"Incoming message length {length} exceeds limit {_MAX_MSG_BYTES}."
        )
    return _recv_exact(sock, length)


# ── Connection handler ────────────────────────────────────────────────────────

def _handle_connection(
    conn: socket.socket,
    addr: tuple,
    handler: ExchangeHandler,
) -> None:
    """Handle a single accepted TCP connection."""
    peer_str = f"{addr[0]}:{addr[1]}"
    try:
        raw = _recv_frame(conn)
        peer_payload = _decode(raw)
        logger.debug("Received exchange from %s (node=%s)", peer_str, peer_payload.node_id)

        response = handler(peer_payload)

        _send_frame(conn, _encode(response))
        logger.debug("Sent response to %s", peer_str)
    except TransportError as exc:
        logger.warning("Transport error handling %s: %s", peer_str, exc)
    except Exception:
        logger.exception("Unexpected error handling connection from %s", peer_str)
    finally:
        try:
            conn.close()
        except OSError:
            pass


# ── TCP Transport ─────────────────────────────────────────────────────────────

class TCPTransport(BaseTransport):
    """TCP-based gossip parameter exchange transport.

    Implements :class:`~bloomfl.transport.base.BaseTransport` using raw
    TCP sockets with a 4-byte length-framed JSON protocol.
    """

    def __init__(self) -> None:
        self._server_sock: Optional[socket.socket] = None
        self._server_thread: Optional[threading.Thread] = None
        self._handler: Optional[ExchangeHandler] = None
        self._running = False
        self._lock = threading.Lock()

    # ── Server ────────────────────────────────────────────────────────────────

    def start_server(
        self,
        host: str,
        port: int,
        handler: ExchangeHandler,
    ) -> None:
        with self._lock:
            if self._running:
                raise RuntimeError("TCP server is already running.")
            self._handler = handler
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind((host, port))
            sock.listen(32)
            sock.setblocking(False)
            self._server_sock = sock
            self._running = True

        self._server_thread = threading.Thread(
            target=self._accept_loop,
            daemon=True,
            name=f"bloomfl-tcp:{port}",
        )
        self._server_thread.start()
        logger.info("TCP server listening on %s:%d", host, port)

    def stop_server(self) -> None:
        with self._lock:
            self._running = False
            if self._server_sock:
                try:
                    self._server_sock.close()
                except OSError:
                    pass
                self._server_sock = None
        if self._server_thread:
            self._server_thread.join(timeout=5.0)
        logger.info("TCP server stopped.")

    def _accept_loop(self) -> None:
        """Background accept loop — spawns a thread per connection."""
        while self._running:
            sock = self._server_sock
            if sock is None:
                break
            try:
                readable, _, _ = select.select([sock], [], [], 1.0)
            except (OSError, ValueError):
                # Socket was closed/set to None concurrently
                break
            if not readable:
                continue
            try:
                conn, addr = sock.accept()
                conn.settimeout(30.0)
                t = threading.Thread(
                    target=_handle_connection,
                    args=(conn, addr, self._handler),
                    daemon=True,
                )
                t.start()
            except OSError:
                if self._running:
                    logger.exception("Error in TCP accept loop")
                break

    @property
    def is_running(self) -> bool:
        return self._running

    # ── Client ────────────────────────────────────────────────────────────────

    def send_parameters(
        self,
        peer_host: str,
        peer_port: int,
        payload: WirePayload,
        timeout: float = 15.0,
    ) -> WirePayload:
        """Open a TCP connection to **peer**, send payload, receive response."""
        try:
            with socket.create_connection((peer_host, peer_port), timeout=timeout) as sock:
                sock.settimeout(timeout)
                _send_frame(sock, _encode(payload))
                raw = _recv_frame(sock)
                return _decode(raw)
        except (ConnectionRefusedError, socket.timeout, OSError) as exc:
            raise TransportError(
                f"Failed to connect to {peer_host}:{peer_port} — {exc}"
            ) from exc

    def ping(
        self,
        peer_host: str,
        peer_port: int,
        node_id: str,
        timeout: float = 5.0,
    ) -> bool:
        """TCP-based liveness check — attempts to open and close a connection."""
        try:
            with socket.create_connection((peer_host, peer_port), timeout=timeout):
                return True
        except (ConnectionRefusedError, socket.timeout, OSError):
            return False
