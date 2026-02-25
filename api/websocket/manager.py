"""WebSocket connection manager — fan-out broadcast to all connected clients."""
from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)

    async def connect(self, channel: str, ws: WebSocket) -> None:
        await ws.accept()
        self._connections[channel].add(ws)
        logger.debug("WS connected channel=%s total=%d", channel, len(self._connections[channel]))

    def disconnect(self, channel: str, ws: WebSocket) -> None:
        self._connections[channel].discard(ws)
        logger.debug("WS disconnected channel=%s total=%d", channel, len(self._connections[channel]))

    async def broadcast(self, channel: str, payload: Any) -> None:
        if not self._connections[channel]:
            return
        message = json.dumps(payload) if not isinstance(payload, str) else payload
        dead: list[WebSocket] = []
        for ws in list(self._connections[channel]):
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(channel, ws)

    def connection_count(self, channel: str) -> int:
        return len(self._connections[channel])


# Module-level singleton
manager = ConnectionManager()
