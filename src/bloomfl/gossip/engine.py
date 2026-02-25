"""
Gossip Engine — orchestrates one gossip round for a BloomFL node.

A single gossip round:
 1. Serialise local model weights (pickle → bytes).
 2. Hash the bytes (SHA-256) for integrity verification.
 3. Generate an ephemeral ECDHE key-pair (priv_i, pub_i).
 4. Encrypt the serialised weights.
    - If the peer's identity public key is known (via mDNS TXT record):
        Use ECIES: K = HKDF(ECDH(priv_i_ephemeral, peer_identity_pub)).
        The peer decrypts with K' = HKDF(ECDH(peer_identity_priv, pub_i_ephemeral)).
        K == K' by ECDH commutativity — full ECIES without pre-shared secrets.
    - Otherwise (no identity key in PeerInfo):
        Derive a PSK from both node IDs: K_psk = HKDF(sha256(sorted_node_ids)).
        Both parties compute the same K_psk independently — authenticated by
        node identity, not forward-secret, but confidential on the LAN.
 5. Build a WirePayload carrying:
        public_key = own ephemeral public key (PEM) — initiator's ephemeral pub
        payload    = AES-256-GCM ciphertext
        nonce, data_hash, weight, round (as usual)
 6. Send to peer, receive the peer's WirePayload.
 7. Decrypt peer response using ECDH(priv_i_ephemeral, peer_resp_ephemeral_pub):
        K_resp = HKDF(ECDH(priv_i, peer_resp_pub))
    The server encrypted its response using K_resp' = HKDF(ECDH(priv_r, pub_i))
    which equals K_resp because ECDH is commutative.
 8. Verify the SHA-256 hash.
 9. Aggregate local weights + peer weights.
10. Return the merged weights to the node controller.

The server side (IncomingHandlerV2):
 - Decrypts with K:
     * If identity key configured: K = HKDF(ECDH(identity_priv, pub_i_ephemeral)).
     * Otherwise: K = HKDF(sha256(sorted_node_ids)) — same PSK as initiator.
 - Calls on_received_fn(peer_weights, peer_samples, peer_id) → triggers
   server-side aggregation so the server also benefits from the exchange.
 - Generates own ephemeral (priv_r, pub_r).
 - Encrypts response: K_resp = HKDF(ECDH(priv_r, pub_i_ephemeral)).
 - Returns WirePayload with pub_r (PEM) in public_key field.

Production upgrade: add lt_pub to mDNS TXT records (MDNSDiscovery already does
this when key_manager is supplied) → full ECIES, drop PSK fallback.
"""
from __future__ import annotations

import hashlib
import io
import logging
import os
import pickle
from dataclasses import dataclass
from typing import Callable, Optional

import numpy as np

from bloomfl.discovery.mdns import PeerInfo
from bloomfl.gossip.aggregation import aggregate
from bloomfl.security.crypto import (
    EncryptedBlob,
    InvalidTag,
    decrypt,
    derive_shared_key,
    encrypt,
    generate_ephemeral_keypair,
    sha256_digest,
)
from bloomfl.transport.base import BaseTransport, TransportError, WirePayload

logger = logging.getLogger(__name__)

# Callback type: (peer_weights, peer_samples, peer_node_id) → None
OnReceivedFn = Callable[[list[np.ndarray], float, str], None]


# ── Weight serialisation ──────────────────────────────────────────────────────

def _serialise_weights(weights: list[np.ndarray]) -> bytes:
    """Pickle a list of numpy arrays into bytes."""
    buf = io.BytesIO()
    pickle.dump(weights, buf, protocol=pickle.HIGHEST_PROTOCOL)
    return buf.getvalue()


def _deserialise_weights(data: bytes) -> list[np.ndarray]:
    """Unpickle a list of numpy arrays from bytes."""
    return pickle.load(io.BytesIO(data))  # noqa: S301 — controlled internal use


# ── Key derivation helpers ────────────────────────────────────────────────────

def _psk_from_node_ids(node_id_a: str, node_id_b: str) -> bytes:
    """Derive a deterministic per-pair PSK from two node identifiers.

    Both sides compute the same 32-byte key by sorting the IDs before hashing,
    making the result independent of which node is the initiator.
    """
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF

    ids_sorted = sorted([node_id_a.encode(), node_id_b.encode()])
    material = ids_sorted[0] + b":" + ids_sorted[1]
    return HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=None,
        info=b"bloomfl-psk-v1",
    ).derive(hashlib.sha256(material).digest())


# ── Round result ──────────────────────────────────────────────────────────────

@dataclass
class GossipRoundResult:
    """Result of a single outgoing gossip round."""
    success: bool
    peer_id: str
    merged_weights: Optional[list[np.ndarray]]
    peer_samples: float
    bytes_exchanged: int = 0
    error: str = ""


# ── Gossip Engine (outgoing) ──────────────────────────────────────────────────

class GossipEngine:
    """Orchestrates outgoing gossip rounds (client side).

    Args:
        node_id:              This node's identifier.
        transport:            Active transport (TCP or gRPC).
        aggregation_strategy: One of ``"weighted_avg"``, ``"momentum"``, ``"partial"``.
        momentum:             EMA coefficient (for ``"momentum"`` strategy).
        merge_fraction:       Layer fraction (for ``"partial"`` strategy).
        gossip_timeout:       Per-round transport timeout in seconds.
    """

    def __init__(
        self,
        node_id: str,
        transport: BaseTransport,
        aggregation_strategy: str = "weighted_avg",
        momentum: float = 0.9,
        merge_fraction: float = 0.5,
        gossip_timeout: float = 15.0,
    ) -> None:
        self._node_id = node_id
        self._transport = transport
        self._strategy = aggregation_strategy
        self._momentum = momentum
        self._merge_fraction = merge_fraction
        self._timeout = gossip_timeout
        self._round = 0

    # ── Outgoing round ────────────────────────────────────────────────────────

    def run_round(
        self,
        peer: PeerInfo,
        local_weights: list[np.ndarray],
        local_samples: float,
    ) -> GossipRoundResult:
        """Execute one outgoing gossip exchange with ``peer``.

        Encryption uses ECIES when ``peer.identity_pubkey_pem`` is available,
        falling back to a node-ID–derived PSK otherwise.

        Args:
            peer:          Target peer (from discovery module).
            local_weights: This node's current model weights.
            local_samples: This node's training sample count.

        Returns:
            :class:`GossipRoundResult` — merged weights on success.
        """
        self._round += 1
        logger.info(
            "Gossip round %d → peer %s (%s:%d)",
            self._round, peer.node_id, peer.address, peer.port,
        )

        try:
            # ── 1. Serialise own weights ─────────────────────────────────
            plaintext = _serialise_weights(local_weights)
            own_hash = sha256_digest(plaintext)

            # ── 2. Generate ephemeral key-pair ───────────────────────────
            own_priv, own_pub_pem = generate_ephemeral_keypair()

            # ── 3. Derive encryption key ──────────────────────────────────
            if peer.identity_pubkey_pem:
                # ECIES: K = HKDF(ECDH(ephemeral_priv_i, peer_identity_pub))
                # Peer reverses with HKDF(ECDH(identity_priv, ephemeral_pub_i))
                session_key = derive_shared_key(own_priv, peer.identity_pubkey_pem)
                logger.debug("Gossip round %d: ECIES encryption", self._round)
            else:
                # PSK fallback: deterministic from both node IDs
                session_key = _psk_from_node_ids(self._node_id, peer.node_id)
                logger.debug("Gossip round %d: PSK fallback (no peer identity key)", self._round)

            # ── 4. Encrypt payload ────────────────────────────────────────
            blob = encrypt(session_key, plaintext, self._node_id.encode())

            out_payload = WirePayload(
                node_id=self._node_id,
                payload=blob.ciphertext,
                nonce=blob.nonce,
                public_key=own_pub_pem,  # pure PEM — no appended session key
                round=self._round,
                weight=float(local_samples),
                data_hash=own_hash,
            )
            out_bytes = len(blob.ciphertext) + len(own_pub_pem)

            # ── 5. Send to peer and receive response ─────────────────────
            response = self._transport.send_parameters(
                peer.address, peer.port, out_payload, timeout=self._timeout
            )
            in_bytes = len(response.payload) + len(response.public_key)

        except TransportError as exc:
            logger.warning(
                "Gossip round %d failed (transport): %s", self._round, exc
            )
            return GossipRoundResult(
                success=False,
                peer_id=peer.node_id,
                merged_weights=None,
                peer_samples=0.0,
                error=str(exc),
            )

        # ── 6. Decrypt peer response ──────────────────────────────────────
        try:
            if not response.payload:
                raise ValueError("Peer returned empty payload.")

            # Response key: ECDH(own_priv_ephemeral, peer_resp_ephemeral_pub)
            # Server used ECDH(priv_r, pub_i) — same key by ECDH commutativity
            response_key = derive_shared_key(own_priv, response.public_key)

            peer_blob = EncryptedBlob(
                ciphertext=response.payload,
                nonce=response.nonce,
                aad=response.node_id.encode(),
            )
            peer_plaintext = decrypt(response_key, peer_blob)

            # Verify hash
            if sha256_digest(peer_plaintext) != response.data_hash:
                raise ValueError("Data hash mismatch in peer response.")

            peer_weights = _deserialise_weights(peer_plaintext)
            peer_samples = float(response.weight)

        except (InvalidTag, ValueError, Exception) as exc:
            logger.warning(
                "Gossip round %d — decoding error from %s: %s",
                self._round, peer.node_id, exc,
            )
            return GossipRoundResult(
                success=False,
                peer_id=peer.node_id,
                merged_weights=None,
                peer_samples=0.0,
                error=str(exc),
            )

        # ── 7. Aggregate ──────────────────────────────────────────────────
        merged = aggregate(
            local_weights=local_weights,
            peer_weights=peer_weights,
            local_samples=local_samples,
            peer_samples=peer_samples,
            strategy=self._strategy,
            momentum=self._momentum,
            merge_fraction=self._merge_fraction,
        )

        total_bytes = out_bytes + in_bytes
        logger.info(
            "Gossip round %d complete — peer=%s samples=%.0f strategy=%s bytes=%d",
            self._round, peer.node_id, peer_samples, self._strategy, total_bytes,
        )

        return GossipRoundResult(
            success=True,
            peer_id=peer.node_id,
            merged_weights=merged,
            peer_samples=peer_samples,
            bytes_exchanged=total_bytes,
        )

    @property
    def round(self) -> int:
        return self._round


# ── Incoming handler (server-side) ────────────────────────────────────────────

class IncomingHandlerV2:
    """Handles incoming gossip exchanges (server-side).

    Security protocol (mirrors GossipEngine in reverse):

    Decryption of initiator's payload:
      - If identity private key known: HKDF(ECDH(identity_priv, ephemeral_pub_i)).
      - Otherwise: PSK = HKDF(sha256(sorted_node_ids)).

    Encryption of response:
      - Generate own ephemeral (priv_r, pub_r).
      - K_resp = HKDF(ECDH(priv_r, ephemeral_pub_i_from_request)).
      - Initiator decrypts with HKDF(ECDH(priv_i, pub_r)) — same key.

    Args:
        node_id:              This server node's identifier.
        get_weights_fn:       Callable returning current model weights.
        get_sample_count_fn:  Callable returning this node's sample count.
        on_received_fn:       Optional callback(weights, samples, peer_id) → None.
                              Triggered after successful decryption to enable
                              server-side model aggregation.
        identity_private_key: This node's long-term P-256 private key
                              (from KeyManager). Enables ECIES decryption.
    """

    def __init__(
        self,
        node_id: str,
        get_weights_fn: Callable[[], list[np.ndarray]],
        get_sample_count_fn: Callable[[], float],
        on_received_fn: Optional[OnReceivedFn] = None,
        identity_private_key=None,
    ) -> None:
        self._node_id = node_id
        self._get_weights = get_weights_fn
        self._get_samples = get_sample_count_fn
        self._on_received = on_received_fn
        self._identity_priv = identity_private_key

    def __call__(self, peer_payload: WirePayload) -> WirePayload:
        """Process an incoming exchange request and return encrypted response."""
        try:
            # ── 1. Derive decryption key ───────────────────────────────────
            if self._identity_priv is not None:
                # ECIES reverse: HKDF(ECDH(identity_priv, ephemeral_pub_i))
                session_key = derive_shared_key(self._identity_priv, peer_payload.public_key)
            else:
                # PSK fallback: same deterministic key as initiator
                session_key = _psk_from_node_ids(self._node_id, peer_payload.node_id)

            # ── 2. Decrypt peer payload ────────────────────────────────────
            blob = EncryptedBlob(
                ciphertext=peer_payload.payload,
                nonce=peer_payload.nonce,
                aad=peer_payload.node_id.encode(),
            )
            peer_plaintext = decrypt(session_key, blob)

            # ── 3. Verify integrity ────────────────────────────────────────
            if sha256_digest(peer_plaintext) == peer_payload.data_hash:
                peer_weights = _deserialise_weights(peer_plaintext)
                peer_samples = float(peer_payload.weight)

                # ── 4. Server-side aggregation callback ───────────────────
                if self._on_received is not None:
                    try:
                        self._on_received(peer_weights, peer_samples, peer_payload.node_id)
                    except Exception:
                        logger.exception(
                            "Server: on_received callback error for peer %s",
                            peer_payload.node_id,
                        )
            else:
                logger.warning(
                    "Server: hash mismatch from peer %s — skipping aggregation.",
                    peer_payload.node_id,
                )

        except InvalidTag:
            logger.warning(
                "Server: decryption failed (InvalidTag) for peer %s.",
                peer_payload.node_id,
            )
        except Exception:
            logger.exception(
                "Server: unexpected error decrypting from %s", peer_payload.node_id
            )

        # ── 5. Build encrypted response ───────────────────────────────────
        try:
            own_weights = self._get_weights()
            own_plaintext = _serialise_weights(own_weights)
            own_hash = sha256_digest(own_plaintext)

            # Generate own ephemeral key pair for response direction
            own_priv_r, own_pub_r_pem = generate_ephemeral_keypair()

            # K_resp = HKDF(ECDH(priv_r, ephemeral_pub_i_from_request))
            # Initiator decrypts: HKDF(ECDH(priv_i, pub_r)) — same by ECDH commutativity
            response_key = derive_shared_key(own_priv_r, peer_payload.public_key)

            own_blob = encrypt(response_key, own_plaintext, self._node_id.encode())

            return WirePayload(
                node_id=self._node_id,
                payload=own_blob.ciphertext,
                nonce=own_blob.nonce,
                public_key=own_pub_r_pem,
                round=peer_payload.round,
                weight=float(self._get_samples()),
                data_hash=own_hash,
            )
        except Exception:
            logger.exception("Server: error building response for %s", peer_payload.node_id)
            _, fallback_pub = generate_ephemeral_keypair()
            return WirePayload(
                node_id=self._node_id,
                payload=b"",
                nonce=b"\x00" * 12,
                public_key=fallback_pub,
                weight=0.0,
            )


# ── Factory ───────────────────────────────────────────────────────────────────

def make_incoming_handler(
    node_id: str,
    get_weights_fn: Callable[[], list[np.ndarray]],
    get_sample_count_fn: Callable[[], float],
    on_received_fn: Optional[OnReceivedFn] = None,
    key_manager=None,
) -> IncomingHandlerV2:
    """Create the server-side handler passed to ``transport.start_server``.

    Args:
        node_id:             This node's identifier.
        get_weights_fn:      Returns current model weight arrays.
        get_sample_count_fn: Returns current sample count.
        on_received_fn:      Callback triggered when peer weights arrive.
                             Used to trigger server-side model aggregation.
        key_manager:         Optional :class:`~bloomfl.security.key_manager.KeyManager`.
                             When provided, enables ECIES decryption of incoming payloads.

    Returns:
        :class:`IncomingHandlerV2` ready to pass to ``transport.start_server``.
    """
    identity_priv = key_manager.private_key if key_manager is not None else None
    return IncomingHandlerV2(
        node_id=node_id,
        get_weights_fn=get_weights_fn,
        get_sample_count_fn=get_sample_count_fn,
        on_received_fn=on_received_fn,
        identity_private_key=identity_priv,
    )
