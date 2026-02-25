"""
Cryptographic primitives for BloomFL.

Provides:
- ECDHE ephemeral key-pair generation (P-256)
- Shared secret derivation via ECDH + HKDF-SHA256
- AES-256-GCM encrypt / decrypt
- Serialisation helpers for public keys

Design principles:
- Every gossip exchange uses a *fresh* ephemeral key-pair (forward secrecy).
- Nonces are random 96-bit values (NIST recommended for GCM).
- ``InvalidTag`` on decrypt → message silently discarded, caller decides.
"""
from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass

from cryptography.exceptions import InvalidTag  # re-exported for callers
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.ec import (
    EllipticCurvePrivateKey,
    EllipticCurvePublicKey,
)
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

__all__ = [
    "generate_ephemeral_keypair",
    "derive_shared_key",
    "encrypt",
    "decrypt",
    "public_key_to_pem",
    "pem_to_public_key",
    "sha256_digest",
    "InvalidTag",
    "EncryptedBlob",
]

_CURVE = ec.SECP256R1()
_AES_KEY_LEN = 32   # 256 bits
_NONCE_LEN = 12     # 96 bits — NIST recommended for GCM
_HKDF_INFO = b"bloomfl-gossip-v1"


# ── Key generation ────────────────────────────────────────────────────────────

def generate_ephemeral_keypair() -> tuple[EllipticCurvePrivateKey, bytes]:
    """Generate a fresh P-256 ephemeral key pair.

    Returns:
        (private_key, public_key_pem_bytes)
        The public key bytes are PEM-encoded and safe to transmit.
    """
    private_key = ec.generate_private_key(_CURVE)
    public_pem = public_key_to_pem(private_key.public_key())
    return private_key, public_pem


def public_key_to_pem(public_key: EllipticCurvePublicKey) -> bytes:
    """Serialise an EC public key to PEM bytes."""
    return public_key.public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )


def pem_to_public_key(pem: bytes) -> EllipticCurvePublicKey:
    """Deserialise a PEM-encoded EC public key."""
    return serialization.load_pem_public_key(pem)  # type: ignore[return-value]


# ── Key derivation ─────────────────────────────────────────────────────────────

def derive_shared_key(
    private_key: EllipticCurvePrivateKey,
    peer_public_pem: bytes,
    salt: bytes | None = None,
) -> bytes:
    """Derive a 32-byte AES-256 key via ECDH + HKDF-SHA256.

    Args:
        private_key:      Own ephemeral private key.
        peer_public_pem:  Peer's ephemeral public key (PEM bytes).
        salt:             Optional HKDF salt for additional domain separation.

    Returns:
        32-byte symmetric key suitable for AES-256-GCM.
    """
    peer_public_key = pem_to_public_key(peer_public_pem)
    shared_secret = private_key.exchange(ec.ECDH(), peer_public_key)
    return HKDF(
        algorithm=hashes.SHA256(),
        length=_AES_KEY_LEN,
        salt=salt,
        info=_HKDF_INFO,
    ).derive(shared_secret)


# ── Encryption / decryption ───────────────────────────────────────────────────

@dataclass
class EncryptedBlob:
    """Container for an AES-256-GCM ciphertext."""
    ciphertext: bytes   # includes 16-byte GCM auth tag (appended by AESGCM)
    nonce: bytes        # 12-byte random nonce
    aad: bytes          # additional authenticated data (not secret, authenticated)


def encrypt(
    key: bytes,
    plaintext: bytes,
    aad: bytes = b"",
) -> EncryptedBlob:
    """Encrypt plaintext with AES-256-GCM.

    Args:
        key:       32-byte symmetric key.
        plaintext: Data to encrypt.
        aad:       Additional authenticated data (authenticated but not encrypted).
                   Typically the sender node_id.

    Returns:
        :class:`EncryptedBlob` containing nonce + ciphertext.
    """
    if len(key) != _AES_KEY_LEN:
        raise ValueError(f"Key must be {_AES_KEY_LEN} bytes; got {len(key)}.")
    nonce = os.urandom(_NONCE_LEN)
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(nonce, plaintext, aad or None)
    return EncryptedBlob(ciphertext=ciphertext, nonce=nonce, aad=aad)


def decrypt(
    key: bytes,
    blob: EncryptedBlob,
) -> bytes:
    """Decrypt an :class:`EncryptedBlob` with AES-256-GCM.

    Raises:
        cryptography.exceptions.InvalidTag: If authentication fails
            (tampered ciphertext, wrong key, or nonce reuse).
    """
    if len(key) != _AES_KEY_LEN:
        raise ValueError(f"Key must be {_AES_KEY_LEN} bytes; got {len(key)}.")
    aesgcm = AESGCM(key)
    return aesgcm.decrypt(blob.nonce, blob.ciphertext, blob.aad or None)


# ── Integrity helpers ─────────────────────────────────────────────────────────

def sha256_digest(data: bytes) -> bytes:
    """Return the 32-byte SHA-256 digest of *data*."""
    return hashlib.sha256(data).digest()
