"""Tests for Config validators (pydantic field validation)."""
from __future__ import annotations

import os
from pathlib import Path

import pytest
from pydantic import ValidationError


class TestConfigValidators:
    """Verify that Config raises ValidationError for invalid field values."""

    def _make_config(self, tmp_path: Path, **overrides):
        """Return a Config with defaults pointing at tmp_path."""
        from bloomfl.config import Config, reset_config
        reset_config()
        env = {
            "BLOOMFL_KEY_STORAGE_DIR": str(tmp_path / "keys"),
            "BLOOMFL_METRICS_DIR": str(tmp_path / "metrics"),
            "BLOOMFL_DATA_DIR": str(tmp_path / "data"),
            "BLOOMFL_NODE_ID": "cfg-test-node",
            "BLOOMFL_NUM_NODES": "2",
        }
        old = {k: os.environ.pop(k, None) for k in env}
        os.environ.update(env)
        try:
            cfg = Config(**overrides)
        finally:
            for k, v in old.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
            reset_config()
        return cfg

    def test_valid_config_creates_ok(self, tmp_path):
        cfg = self._make_config(tmp_path)
        assert cfg.node_id == "cfg-test-node"

    def test_train_epochs_zero_raises(self, tmp_path):
        with pytest.raises(ValidationError, match="train_epochs_per_round"):
            self._make_config(tmp_path, train_epochs_per_round=0)

    def test_gossip_fan_out_zero_raises(self, tmp_path):
        with pytest.raises(ValidationError, match="gossip_fan_out"):
            self._make_config(tmp_path, gossip_fan_out=0)

    def test_partial_merge_above_one_raises(self, tmp_path):
        with pytest.raises(ValidationError, match="partial_merge_fraction"):
            self._make_config(tmp_path, partial_merge_fraction=1.5)

    def test_partial_merge_negative_raises(self, tmp_path):
        with pytest.raises(ValidationError, match="partial_merge_fraction"):
            self._make_config(tmp_path, partial_merge_fraction=-0.1)

    def test_momentum_above_one_raises(self, tmp_path):
        with pytest.raises(ValidationError, match="momentum_alpha"):
            self._make_config(tmp_path, momentum_alpha=1.1)

    def test_eval_every_n_rounds_zero_raises(self, tmp_path):
        with pytest.raises(ValidationError, match="eval_every_n_rounds"):
            self._make_config(tmp_path, eval_every_n_rounds=0)

    def test_adaptation_hysteresis_zero_raises(self, tmp_path):
        with pytest.raises(ValidationError, match="adaptation_hysteresis_rounds"):
            self._make_config(tmp_path, adaptation_hysteresis_rounds=0)

    def test_ensure_dirs_creates_directories(self, tmp_path):
        cfg = self._make_config(tmp_path)
        cfg.ensure_dirs()
        assert Path(cfg.key_storage_dir).is_dir()
        assert Path(cfg.metrics_dir).is_dir()
        assert Path(cfg.data_dir).is_dir()
