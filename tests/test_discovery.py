"""Tests for mDNS peer discovery (Zeroconf mocked)."""
from __future__ import annotations

import base64
import socket
from typing import Optional
from unittest.mock import MagicMock, patch

import pytest

from bloomfl.discovery.mdns import MDNSDiscovery, PeerInfo


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


class TestPeerInfo:
    """PeerInfo dataclass basics."""

    def test_equality_by_node_id_and_addr(self):
        a = PeerInfo(node_id="n1", address="127.0.0.1", port=9000)
        b = PeerInfo(node_id="n1", address="127.0.0.1", port=9000)
        assert a == b

    def test_inequality_different_port(self):
        a = PeerInfo(node_id="n1", address="127.0.0.1", port=9000)
        b = PeerInfo(node_id="n1", address="127.0.0.1", port=9001)
        assert a != b

    def test_frozen(self):
        peer = PeerInfo(node_id="n1", address="127.0.0.1", port=9000)
        with pytest.raises((AttributeError, TypeError)):
            peer.port = 1234  # type: ignore[misc]


class TestMDNSDiscovery:
    """MDNSDiscovery with Zeroconf mocked out."""

    @pytest.fixture()
    def discovery(self):
        with patch("bloomfl.discovery.mdns.Zeroconf"), \
             patch("bloomfl.discovery.mdns.ServiceBrowser"), \
             patch("bloomfl.discovery.mdns.ServiceInfo"):
            d = MDNSDiscovery(
                node_id="local-node",
                port=9000,
                service_type="_bloomfl._tcp.local.",
                static_peers=["127.0.0.1:9100"],
                key_manager=None,
            )
            yield d

    def test_static_peers_preloaded(self, discovery):
        """Static peer addrs should be offered as initial peers."""
        peers = discovery.get_peers()
        assert len(peers) >= 1
        addrs = {(p.address, p.port) for p in peers}
        assert ("127.0.0.1", 9100) in addrs

    def test_peer_count_reflects_static(self, discovery):
        assert discovery.peer_count() >= 1

    def test_add_peer_increments_count(self, discovery):
        before = discovery.peer_count()
        peer = PeerInfo(node_id="extra-node", address="10.0.0.5", port=9200)
        discovery._peers["extra-node"] = peer
        assert discovery.peer_count() == before + 1

    def test_get_peers_excludes_self(self, discovery):
        """get_peers() must not return the local node itself."""
        # plant self-entry
        discovery._peers["local-node"] = PeerInfo(
            node_id="local-node", address="127.0.0.1", port=9000
        )
        peers = discovery.get_peers()
        node_ids = {p.node_id for p in peers}
        assert "local-node" not in node_ids

    def test_add_service_ignores_missing_node_id(self, discovery):
        """add_service should skip services whose TXT lacks 'node_id'."""
        before = discovery.peer_count()
        mock_zc = MagicMock()
        mock_info = MagicMock()
        mock_info.decoded_properties = {"port": "9300"}  # no node_id key
        mock_info.parsed_addresses.return_value = ["10.0.0.9"]
        mock_zc.get_service_info.return_value = mock_info

        discovery._listener.add_service(mock_zc, "_bloomfl._tcp.local.", "some._bloomfl._tcp.local.")
        assert discovery.peer_count() == before  # nothing added

    def test_add_service_registers_valid_peer(self, discovery):
        """add_service should add peer when TXT has valid node_id."""
        mock_zc = MagicMock()
        mock_info = MagicMock()
        mock_info.decoded_properties = {
            "node_id": "remote-node",
            "port": "9400",
        }
        mock_info.parsed_addresses.return_value = ["10.0.0.11"]
        mock_info.port = 9400
        mock_zc.get_service_info.return_value = mock_info

        discovery._listener.add_service(mock_zc, "_bloomfl._tcp.local.", "remote-node._bloomfl._tcp.local.")
        peers = discovery.get_peers()
        assert any(p.node_id == "remote-node" for p in peers)

    def test_remove_service_removes_peer(self, discovery):
        """remove_service should drop the peer from the registry."""
        discovery._peers["gone-node"] = PeerInfo(
            node_id="gone-node", address="10.0.0.20", port=9500
        )
        assert "gone-node" in discovery._peers

        discovery._listener.remove_service(MagicMock(), "_bloomfl._tcp.local.", "gone-node._bloomfl._tcp.local.")
        assert "gone-node" not in discovery._peers
