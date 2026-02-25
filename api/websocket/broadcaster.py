"""Background task: tail JSONL metric files and push live updates via WebSocket."""
from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


async def tail_metrics(metrics_dir: str, manager) -> None:  # type: ignore[type-arg]
    """Watch metrics_dir for new JSONL lines and broadcast NodeState updates."""
    from api.services.metrics_service import _record_to_schema

    dir_path = Path(metrics_dir)
    dir_path.mkdir(parents=True, exist_ok=True)

    # Track file positions
    positions: dict[Path, int] = {}

    try:
        from watchfiles import awatch

        async for changes in awatch(str(dir_path)):
            for change_type, path_str in changes:
                path = Path(path_str)
                if path.suffix != ".jsonl":
                    continue
                await _process_new_lines(path, positions, manager)
    except ImportError:
        # Fallback: polling every second
        logger.warning("watchfiles not available — falling back to 1 s polling")
        while True:
            for path in sorted(dir_path.glob("*.jsonl")):
                await _process_new_lines(path, positions, manager)
            await asyncio.sleep(1.0)
    except asyncio.CancelledError:
        logger.info("Metrics broadcaster stopped")


async def _process_new_lines(path: Path, positions: dict, manager) -> None:
    from api.services.metrics_service import _record_to_schema

    try:
        pos = positions.get(path, 0)
        with path.open() as f:
            f.seek(pos)
            new_content = f.read()
            positions[path] = f.tell()

        for line in new_content.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            schema = _record_to_schema(record)
            await manager.broadcast("nodes", schema.model_dump())
    except OSError:
        pass
