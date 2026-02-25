"""
BloomFL Dashboard API — FastAPI application entry point.

Run with:
    uvicorn api.main:app --reload --host 0.0.0.0 --port 8000
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from api.routers import nodes, metrics, simulation, config as config_router, inference as inference_router
from api.websocket.manager import manager
from api.websocket.broadcaster import tail_metrics
from api.dependencies import get_metrics_dir

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start JSONL tail broadcaster
    metrics_dir = get_metrics_dir()
    broadcast_task = asyncio.create_task(
        tail_metrics(metrics_dir, manager),
        name="metrics-broadcaster",
    )
    logger.info("BloomFL API started — metrics_dir=%s", metrics_dir)
    yield
    broadcast_task.cancel()
    try:
        await broadcast_task
    except asyncio.CancelledError:
        pass
    logger.info("BloomFL API shutdown complete")


app = FastAPI(
    title="BloomFL Dashboard API",
    description="REST + WebSocket API for the BloomFL decentralised federated learning system.",
    version="0.1.0",
    lifespan=lifespan,
)

# ── CORS ───────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000", "http://127.0.0.1:3000",
        "http://localhost:3001", "http://127.0.0.1:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── REST Routers ──────────────────────────────────────────────────────────────
app.include_router(nodes.router)
app.include_router(metrics.router)
app.include_router(simulation.router)
app.include_router(config_router.router)
app.include_router(inference_router.router)


# ── WebSocket endpoints ────────────────────────────────────────────────────────

@app.websocket("/ws/nodes")
async def ws_nodes(websocket: WebSocket):
    await manager.connect("nodes", websocket)
    try:
        while True:
            # Keep connection alive; server pushes data via broadcaster
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect("nodes", websocket)


@app.websocket("/ws/simulation")
async def ws_simulation(websocket: WebSocket):
    await manager.connect("simulation", websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect("simulation", websocket)


# ── Health check ──────────────────────────────────────────────────────────────

@app.get("/health", tags=["health"])
async def health():
    return {"status": "ok"}
