"""Shared FastAPI dependency functions."""
from __future__ import annotations

import functools
from src.bloomfl.config import Config

_config_instance: Config | None = None


def get_config() -> Config:
    global _config_instance
    if _config_instance is None:
        _config_instance = Config()
    return _config_instance


def get_metrics_dir() -> str:
    return get_config().metrics_dir
