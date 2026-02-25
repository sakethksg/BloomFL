"""
Long-term node identity key manager.

Each node has a persistent P-256 identity key-pair stored on disk.
This key is used for *identity* (e.g., signing service discovery
announcements) — NOT for encrypting gossip parameters.  Encryption uses
fresh ephemeral ECDHE keys generated in :mod:`bloomfl.security.crypto`.
"""
from __future__ import annotations

import logging
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.ec import (
    EllipticCurvePrivateKey,
    EllipticCurvePublicKey,
)

from bloomfl.security.crypto import public_key_to_pem

logger = logging.getLogger(__name__)

_CURVE = ec.SECP256R1()


class KeyManager:
    """Loads or creates a persistent P-256 identity key pair for a node.

    Key files are stored in ``key_dir`` as:
    - ``identity.pem``  — PKCS8 PEM private key (no password)
    - ``identity_pub.pem``  — SubjectPublicKeyInfo PEM public key

    Args:
        key_dir: Directory to store / load key files.
        node_id: Node identifier (used in log messages).
    """

    def __init__(self, key_dir: str, node_id: str = "unknown") -> None:
        self._dir = Path(key_dir)
        self._dir.mkdir(parents=True, exist_ok=True)
        self._node_id = node_id
        self._private_key: EllipticCurvePrivateKey = self._load_or_create()

    # ── Public interface ──────────────────────────────────────────────────────

    @property
    def private_key(self) -> EllipticCurvePrivateKey:
        """Node's long-term private key."""
        return self._private_key

    @property
    def public_key(self) -> EllipticCurvePublicKey:
        """Node's long-term public key."""
        return self._private_key.public_key()

    @property
    def public_key_pem(self) -> bytes:
        """PEM-encoded long-term public key (safe to share)."""
        return public_key_to_pem(self.public_key)

    # ── Private helpers ───────────────────────────────────────────────────────

    def _private_key_path(self) -> Path:
        return self._dir / "identity.pem"

    def _public_key_path(self) -> Path:
        return self._dir / "identity_pub.pem"

    def _load_or_create(self) -> EllipticCurvePrivateKey:
        priv_path = self._private_key_path()
        if priv_path.exists():
            logger.info("[%s] Loading identity key from %s", self._node_id, priv_path)
            return self._load(priv_path)
        logger.info("[%s] Generating new identity key in %s", self._node_id, self._dir)
        return self._generate_and_save()

    def _load(self, path: Path) -> EllipticCurvePrivateKey:
        pem = path.read_bytes()
        key = serialization.load_pem_private_key(pem, password=None)
        if not isinstance(key, EllipticCurvePrivateKey):
            raise TypeError(f"Expected EC private key, got {type(key).__name__}")
        return key

    def _generate_and_save(self) -> EllipticCurvePrivateKey:
        key = ec.generate_private_key(_CURVE)
        # Save private key
        priv_pem = key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        self._private_key_path().write_bytes(priv_pem)
        self._private_key_path().chmod(0o600)  # owner read-only
        # Save public key (convenience copy)
        self._public_key_path().write_bytes(public_key_to_pem(key.public_key()))
        return key
