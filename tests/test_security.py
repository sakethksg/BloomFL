"""Tests for the security layer (ECDHE + AES-256-GCM)."""
from __future__ import annotations

import os

import pytest
from cryptography.exceptions import InvalidTag

from bloomfl.security.crypto import (
    EncryptedBlob,
    decrypt,
    derive_shared_key,
    encrypt,
    generate_ephemeral_keypair,
    pem_to_public_key,
    public_key_to_pem,
    sha256_digest,
)
from bloomfl.security.key_manager import KeyManager


class TestECDHE:
    def test_keygen_returns_pem_bytes(self):
        priv, pub_pem = generate_ephemeral_keypair()
        assert isinstance(pub_pem, bytes)
        assert b"PUBLIC KEY" in pub_pem

    def test_pem_roundtrip(self):
        priv, pub_pem = generate_ephemeral_keypair()
        pub_key = pem_to_public_key(pub_pem)
        roundtripped = public_key_to_pem(pub_key)
        assert roundtripped == pub_pem

    def test_shared_key_agreement(self):
        """Both sides of ECDH must derive the same 32-byte key."""
        priv_a, pub_a = generate_ephemeral_keypair()
        priv_b, pub_b = generate_ephemeral_keypair()

        key_a = derive_shared_key(priv_a, pub_b)
        key_b = derive_shared_key(priv_b, pub_a)

        assert key_a == key_b, "ECDH shared keys must be equal"
        assert len(key_a) == 32, "AES-256 key must be 32 bytes"

    def test_different_keypairs_different_keys(self):
        priv_a, pub_a = generate_ephemeral_keypair()
        priv_b, pub_b = generate_ephemeral_keypair()
        priv_c, pub_c = generate_ephemeral_keypair()

        key_ab = derive_shared_key(priv_a, pub_b)
        key_ac = derive_shared_key(priv_a, pub_c)
        assert key_ab != key_ac, "Different peer keys should yield different shared keys"

    def test_fresh_keypairs_per_call(self):
        _, pub_1 = generate_ephemeral_keypair()
        _, pub_2 = generate_ephemeral_keypair()
        assert pub_1 != pub_2, "Each call should generate a unique key pair"


class TestAESGCM:
    @pytest.fixture
    def key(self):
        return os.urandom(32)

    def test_encrypt_decrypt_roundtrip(self, key):
        plaintext = b"Hello, BloomFL gossip parameters!"
        blob = encrypt(key, plaintext)
        recovered = decrypt(key, blob)
        assert recovered == plaintext

    def test_encrypt_with_aad(self, key):
        plaintext = b"model weights here"
        aad = b"node-abc123"
        blob = encrypt(key, plaintext, aad)
        recovered = decrypt(key, blob)
        assert recovered == plaintext

    def test_wrong_key_raises_invalid_tag(self, key):
        plaintext = b"secret data"
        blob = encrypt(key, plaintext)
        wrong_key = os.urandom(32)
        with pytest.raises(InvalidTag):
            decrypt(wrong_key, blob)

    def test_tampered_ciphertext_raises_invalid_tag(self, key):
        plaintext = b"tamper me"
        blob = encrypt(key, plaintext)
        # Flip a byte in the ciphertext
        tampered = bytearray(blob.ciphertext)
        tampered[0] ^= 0xFF
        bad_blob = EncryptedBlob(
            ciphertext=bytes(tampered), nonce=blob.nonce, aad=blob.aad
        )
        with pytest.raises(InvalidTag):
            decrypt(key, bad_blob)

    def test_wrong_aad_raises_invalid_tag(self, key):
        plaintext = b"authenticated data"
        blob = encrypt(key, plaintext, b"correct-aad")
        bad_blob = EncryptedBlob(
            ciphertext=blob.ciphertext,
            nonce=blob.nonce,
            aad=b"wrong-aad",
        )
        with pytest.raises(InvalidTag):
            decrypt(key, bad_blob)

    def test_nonces_are_unique(self, key):
        blobs = [encrypt(key, b"data") for _ in range(100)]
        nonces = {b.nonce for b in blobs}
        assert len(nonces) == 100, "All nonces should be unique"

    def test_wrong_key_length_raises(self):
        with pytest.raises(ValueError, match="Key must be 32 bytes"):
            encrypt(b"tooshort", b"data")


class TestSHA256:
    def test_digest_length(self):
        assert len(sha256_digest(b"hello")) == 32

    def test_digest_deterministic(self):
        assert sha256_digest(b"abc") == sha256_digest(b"abc")

    def test_different_inputs_different_digest(self):
        assert sha256_digest(b"abc") != sha256_digest(b"abd")


class TestKeyManager:
    def test_creates_key_file(self, tmp_path):
        km = KeyManager(str(tmp_path), "test-node")
        assert (tmp_path / "identity.pem").exists()
        assert (tmp_path / "identity_pub.pem").exists()

    def test_loads_existing_key(self, tmp_path):
        km1 = KeyManager(str(tmp_path), "test-node")
        pub1 = km1.public_key_pem

        km2 = KeyManager(str(tmp_path), "test-node")
        pub2 = km2.public_key_pem

        assert pub1 == pub2, "Should load the same key on second instantiation"

    def test_public_key_pem_format(self, tmp_path):
        km = KeyManager(str(tmp_path), "test-node")
        assert b"PUBLIC KEY" in km.public_key_pem
