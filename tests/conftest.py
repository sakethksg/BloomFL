"""
BloomFL conftest.py — shared pytest fixtures and configuration.
"""
from __future__ import annotations

import os
import socket
import sys
from pathlib import Path
from typing import Generator

import pytest
import torch
from torch.utils.data import DataLoader

# Ensure src/ is on the Python path when running pytest from the repo root
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))


# ── Helpers ───────────────────────────────────────────────────────────────────

def _free_port() -> int:
    """Return an ephemeral TCP port that is free at call time."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        return s.getsockname()[1]


# ── Model fixtures ────────────────────────────────────────────────────────────

@pytest.fixture()
def small_model():
    """Return a freshly initialised YOLOPersonModel (no pretrained weights)."""
    from bloomfl.models.yolo_person import YOLOPersonModel
    return YOLOPersonModel(pretrained=False, img_size=64)


@pytest.fixture()
def synthetic_loader() -> DataLoader:
    """Return a DataLoader backed by 16 synthetic person-detection samples."""
    from bloomfl.models.yolo_person import SyntheticPersonDataset, person_collate_fn
    ds = SyntheticPersonDataset(num_samples=16, img_size=64, seed=0)
    return DataLoader(ds, batch_size=4, collate_fn=person_collate_fn, num_workers=0)


# ── Config fixtures ───────────────────────────────────────────────────────────

@pytest.fixture()
def tmp_config(tmp_path: Path):
    """Return a Config instance pointing at tmp_path sub-directories.

    Resets the singleton before and after the test so no state leaks.
    """
    from bloomfl.config import Config, reset_config

    reset_config()
    os.environ["BLOOMFL_KEY_STORAGE_DIR"] = str(tmp_path / "keys")
    os.environ["BLOOMFL_METRICS_DIR"] = str(tmp_path / "metrics")
    os.environ["BLOOMFL_DATA_DIR"] = str(tmp_path / "data")
    os.environ["BLOOMFL_NODE_ID"] = "test-node"
    os.environ.setdefault("BLOOMFL_NUM_NODES", "2")

    cfg = Config()
    cfg.ensure_dirs()
    yield cfg

    # Cleanup env vars so they don't pollute other tests
    for k in ("BLOOMFL_KEY_STORAGE_DIR", "BLOOMFL_METRICS_DIR",
              "BLOOMFL_DATA_DIR", "BLOOMFL_NODE_ID", "BLOOMFL_NUM_NODES"):
        os.environ.pop(k, None)
    reset_config()


# ── Security fixtures ─────────────────────────────────────────────────────────

@pytest.fixture()
def key_manager(tmp_path: Path):
    """Return a KeyManager backed by ``tmp_path``."""
    from bloomfl.security.key_manager import KeyManager
    km = KeyManager(storage_dir=str(tmp_path / "keys"))
    km.initialize()
    return km


# ── Port fixture ──────────────────────────────────────────────────────────────

@pytest.fixture()
def free_port() -> int:
    """Return one ephemeral port."""
    return _free_port()


@pytest.fixture()
def free_port_pair() -> tuple[int, int]:
    """Return two distinct ephemeral ports."""
    return _free_port(), _free_port()
