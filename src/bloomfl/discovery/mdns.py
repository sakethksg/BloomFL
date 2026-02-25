"""
mDNS/Zeroconf peer discovery for BloomFL.

Each node:
1. Registers itself as a ``_bloomfl._tcp.local.`` service.
2. Browses for other registered services in a background thread.
3. Maintains a thread-safe registry of known peers (excluding self).

Also supports static peer injection via ``BLOOMFL_PEER_ADDRS`` for
environments where mDNS multicast is unavailable (e.g. some Docker setups).
"""
from __future__ import annotations

import logging
import socket
import threading
from dataclasses import dataclass, field
from typing import Optional

from zeroconf import ServiceBrowser, ServiceInfo, ServiceListener, Zeroconf

logger = logging.getLogger(__name__)

_SERVICE_TYPE = "_bloomfl._tcp.local."


# ── Data ──────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class PeerInfo:
    """Describes a discovered BloomFL peer."""
    node_id: str
    address: str    # IPv4 string, e.g. "192.168.1.5"
    port: int
    identity_pubkey_pem: Optional[bytes] = None  # long-term EC public key (for ECIES)

    def __str__(self) -> str:
        return f"{self.node_id}@{self.address}:{self.port}"


# ── Service listener (runs in zeroconf's background thread) ───────────────────

class _BloomFLListener(ServiceListener):
    """Zeroconf ServiceListener that maintains the peer registry."""

    def __init__(self, registry: dict[str, PeerInfo], lock: threading.Lock, self_node_id: str) -> None:
        self._registry = registry
        self._lock = lock
        self._self_id = self_node_id

    def add_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        info = zc.get_service_info(type_, name)
        if info is None:
            return
        addrs = info.parsed_addresses()
        if not addrs:
            return
        props = info.decoded_properties or {}
        node_id = props.get("node_id", "")
        if not node_id:
            logger.debug("Ignoring mDNS service without node_id: %s", name)
            return
        if node_id == self._self_id:
            return  # ignore self
        # Decode identity public key if present
        identity_pem: Optional[bytes] = None
        identity_pem_str = props.get("identity_pub", "")
        if identity_pem_str:
            try:
                import base64
                identity_pem = base64.b64decode(identity_pem_str)
            except Exception:
                logger.debug("Could not decode identity_pub for peer %s", node_id)
        peer = PeerInfo(
            node_id=node_id,
            address=addrs[0],
            port=info.port,
            identity_pubkey_pem=identity_pem,
        )
        with self._lock:
            # Remove any static placeholder for this host:port
            static_key = f"static-{addrs[0]}-{info.port}"
            self._registry.pop(static_key, None)
            self._registry[node_id] = peer
        logger.info("Peer discovered: %s%s", peer, " (ECIES capable)" if identity_pem else "")

    def remove_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        # Extract node_id from the service name "node-xxx._bloomfl._tcp.local."
        short = name.replace(f".{type_}", "").replace(type_, "")
        with self._lock:
            removed = self._registry.pop(short, None)
        if removed:
            logger.info("Peer removed: %s", removed)

    def update_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        self.add_service(zc, type_, name)


# ── Discovery manager ─────────────────────────────────────────────────────────

class MDNSDiscovery:
    """Manages mDNS service registration and peer browsing.

    Args:
        node_id:      This node's unique identifier.
        port:         The port this node's transport server listens on.
        service_type: mDNS service type (default: ``_bloomfl._tcp.local.``).
        static_peers: Optional list of ``"host:port"`` strings for environments
                      where mDNS multicast is unavailable.
        key_manager:  Optional key manager.  When provided, the node's identity
                      public key is embedded in mDNS TXT records so other nodes
                      can use ECIES encryption (full forward secrecy).
    """

    def __init__(
        self,
        node_id: str,
        port: int,
        service_type: str = _SERVICE_TYPE,
        static_peers: Optional[list[str]] = None,
        key_manager=None,
    ) -> None:
        self._node_id = node_id
        self._port = port
        self._service_type = service_type
        self._static_peers = static_peers or []
        self._key_manager = key_manager

        self._peers: dict[str, PeerInfo] = {}
        self._lock = threading.Lock()

        self._zc: Optional[Zeroconf] = None
        self._browser: Optional[ServiceBrowser] = None
        self._my_info: Optional[ServiceInfo] = None

        # Listener is always available (also used by tests without starting mDNS)
        self._listener = _BloomFLListener(self._peers, self._lock, self._node_id)

        # Pre-populate static peers
        self._register_static_peers()

    # ── Public interface ──────────────────────────────────────────────────────

    def start(self) -> None:
        """Register on mDNS and start browsing for peers."""
        try:
            self._zc = Zeroconf()
            self._my_info = self._build_service_info()
            self._zc.register_service(self._my_info)
        except Exception:  # noqa: BLE001
            logger.exception("Failed to start mDNS — falling back to static peers only")
            return
        logger.info(
            "Registered mDNS service: %s on port %d",
            self._node_id, self._port,
        )

        listener = self._listener
        self._browser = ServiceBrowser(self._zc, self._service_type, listener)
        logger.info("Browsing for peers on %s", self._service_type)

    def stop(self) -> None:
        """Unregister and clean up mDNS resources."""
        if self._browser:
            self._browser.cancel()
            self._browser = None
        if self._zc and self._my_info:
            try:
                self._zc.unregister_service(self._my_info)
            except Exception:
                pass
        if self._zc:
            self._zc.close()
            self._zc = None
        logger.info("mDNS discovery stopped for %s", self._node_id)

    def get_peers(self) -> list[PeerInfo]:
        """Return a snapshot of currently known peers, excluding this node."""
        with self._lock:
            return [
                p for p in self._peers.values()
                if p.node_id != self._node_id
            ]

    def peer_count(self) -> int:
        """Return number of known peers (excluding self)."""
        return len(self.get_peers())

    # ── Private helpers ───────────────────────────────────────────────────────

    def _get_outbound_ip(self) -> str:
        """Detect the outbound LAN IP by probing a well-known external address."""
        try:
            with socket.create_connection(("8.8.8.8", 80), timeout=2.0) as s:
                return s.getsockname()[0]
        except OSError:
            pass
        # Fallback: gethostbyname
        try:
            return socket.gethostbyname(socket.gethostname())
        except socket.gaierror:
            return "127.0.0.1"

    def _build_service_info(self) -> ServiceInfo:
        """Build the Zeroconf ServiceInfo for this node."""
        local_ip = self._get_outbound_ip()

        props: dict[str, str] = {"node_id": self._node_id}
        # Embed identity public key so peers can use ECIES encryption
        if self._key_manager is not None:
            try:
                import base64
                pub_b64 = base64.b64encode(self._key_manager.public_key_pem).decode()
                # mDNS TXT values are limited; split only if > 255 bytes (PEM is ~178 chars)
                props["identity_pub"] = pub_b64
            except Exception:
                logger.debug("Could not embed identity key in mDNS TXT record")

        return ServiceInfo(
            type_=self._service_type,
            name=f"{self._node_id}.{self._service_type}",
            port=self._port,
            properties=props,
            addresses=[socket.inet_aton(local_ip)],
            server=f"{self._node_id}.local.",
        )

    def _register_static_peers(self) -> None:
        """Parse and register static ``"host:port"`` peer addresses."""
        for entry in self._static_peers:
            entry = entry.strip()
            if not entry:
                continue
            try:
                if ":" in entry:
                    host, port_str = entry.rsplit(":", 1)
                    port = int(port_str)
                else:
                    host, port = entry, 50051
                # Use host as node_id placeholder; will be updated via mDNS
                synthetic_id = f"static-{host}-{port}"
                peer = PeerInfo(node_id=synthetic_id, address=host, port=port)
                with self._lock:
                    self._peers[synthetic_id] = peer
                logger.info("Registered static peer: %s", peer)
            except (ValueError, IndexError) as exc:
                logger.warning("Could not parse static peer '%s': %s", entry, exc)
