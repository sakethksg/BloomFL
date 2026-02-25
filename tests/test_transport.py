"""Tests for the TCP transport layer (loopback)."""
from __future__ import annotations

import os
import socket
import threading
import time

import pytest

from bloomfl.transport.base import TransportError, WirePayload
from bloomfl.transport.tcp_transport import TCPTransport


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        return s.getsockname()[1]


def _make_payload(node_id: str = "test-node") -> WirePayload:
    return WirePayload(
        node_id=node_id,
        payload=b"dummy-ciphertext",
        nonce=b"\x00" * 12,
        public_key=b"dummy-pubkey",
        round=1,
        weight=100.0,
        data_hash=b"\x00" * 32,
    )


class TestTCPTransport:
    @pytest.fixture(autouse=True)
    def transport_pair(self):
        """Create server + client transport, yield, then clean up."""
        self.server_transport = TCPTransport()
        self.client_transport = TCPTransport()
        yield
        self.server_transport.stop_server()
        # Client has no persistent server to stop

    def test_server_starts_and_stops(self):
        port = _free_port()

        def handler(payload: WirePayload) -> WirePayload:
            return _make_payload("server-echo")

        self.server_transport.start_server("127.0.0.1", port, handler)
        time.sleep(0.1)
        assert self.server_transport.is_running
        self.server_transport.stop_server()
        assert not self.server_transport.is_running

    def test_loopback_exchange(self):
        port = _free_port()
        received: list[WirePayload] = []

        def handler(payload: WirePayload) -> WirePayload:
            received.append(payload)
            return _make_payload("server-response")

        self.server_transport.start_server("127.0.0.1", port, handler)
        time.sleep(0.1)

        response = self.client_transport.send_parameters(
            "127.0.0.1", port, _make_payload("client-node")
        )

        assert len(received) == 1
        assert received[0].node_id == "client-node"
        assert response.node_id == "server-response"

    def test_multiple_concurrent_clients(self):
        """Server should handle multiple concurrent connections."""
        port = _free_port()
        results: list = []
        lock = threading.Lock()

        def handler(payload: WirePayload) -> WirePayload:
            time.sleep(0.05)  # simulate slow handler
            return _make_payload(f"echo-{payload.node_id}")

        self.server_transport.start_server("127.0.0.1", port, handler)
        time.sleep(0.1)

        def client_task(idx: int):
            t = TCPTransport()
            resp = t.send_parameters("127.0.0.1", port, _make_payload(f"client-{idx}"))
            with lock:
                results.append(resp.node_id)

        threads = [threading.Thread(target=client_task, args=(i,)) for i in range(5)]
        for th in threads:
            th.start()
        for th in threads:
            th.join(timeout=10)

        assert len(results) == 5
        for r in results:
            assert r.startswith("echo-client-")

    def test_connection_refused_raises_transport_error(self):
        port = _free_port()
        with pytest.raises(TransportError):
            self.client_transport.send_parameters(
                "127.0.0.1", port, _make_payload(), timeout=1.0
            )

    def test_ping_alive(self):
        port = _free_port()

        def handler(p: WirePayload) -> WirePayload:
            return _make_payload()

        self.server_transport.start_server("127.0.0.1", port, handler)
        time.sleep(0.1)
        assert self.client_transport.ping("127.0.0.1", port, "test", timeout=2.0)

    def test_ping_dead(self):
        port = _free_port()
        assert not self.client_transport.ping("127.0.0.1", port, "test", timeout=0.5)

    def test_payload_roundtrip_preserves_all_fields(self):
        port = _free_port()
        original = WirePayload(
            node_id="node-xyz",
            payload=os.urandom(1024),
            nonce=os.urandom(12),
            public_key=os.urandom(200),
            round=42,
            weight=1234.5,
            data_hash=os.urandom(32),
        )

        def handler(p: WirePayload) -> WirePayload:
            return original  # echo the expected response

        self.server_transport.start_server("127.0.0.1", port, handler)
        time.sleep(0.1)

        response = self.client_transport.send_parameters(
            "127.0.0.1", port, _make_payload()
        )

        assert response.node_id == original.node_id
        assert response.payload == original.payload
        assert response.nonce == original.nonce
        assert response.round == original.round
        assert abs(response.weight - original.weight) < 1e-5
        assert response.data_hash == original.data_hash
