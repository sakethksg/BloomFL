"""Config router — read and patch BLOOMFL_* configuration."""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, HTTPException
from api.models.schemas import ConfigSchema, ConfigPatchRequest
from api.dependencies import get_config

router = APIRouter(prefix="/api/config", tags=["config"])

ENV_FILE = Path(".env")


@router.get("", response_model=ConfigSchema)
async def read_config():
    cfg = get_config()
    return ConfigSchema(**cfg.model_dump())


@router.patch("", response_model=ConfigSchema)
async def patch_config(req: ConfigPatchRequest):
    """Write changed values to .env and reload the config singleton."""
    # Read existing .env lines
    lines: list[str] = []
    if ENV_FILE.exists():
        lines = ENV_FILE.read_text().splitlines()

    existing: dict[str, int] = {}
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            key = stripped.split("=", 1)[0].strip().upper()
            existing[key] = i

    for field_name, value in req.changes.items():
        env_key = f"BLOOMFL_{field_name.upper()}"
        serialised = _serialise(value)
        if env_key in existing:
            lines[existing[env_key]] = f"{env_key}={serialised}"
        else:
            lines.append(f"{env_key}={serialised}")

    ENV_FILE.write_text("\n".join(lines) + "\n")

    # Reload by nuking the singleton
    from src.bloomfl.config import reset_config
    reset_config()

    return ConfigSchema(**get_config().model_dump())


def _serialise(value) -> str:
    if isinstance(value, list):
        import json
        return json.dumps(value)
    return str(value)
