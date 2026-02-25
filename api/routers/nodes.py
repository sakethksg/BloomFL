"""Nodes router — live node state endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from api.models.schemas import NodeStateSchema
from api.services.metrics_service import get_node_latest, get_node_history
from api.dependencies import get_metrics_dir

router = APIRouter(prefix="/api/nodes", tags=["nodes"])


@router.get("", response_model=list[NodeStateSchema])
async def list_nodes(metrics_dir: str = Depends(get_metrics_dir)):
    return await get_node_latest(metrics_dir)


@router.get("/{node_id}", response_model=NodeStateSchema)
async def get_node(node_id: str, metrics_dir: str = Depends(get_metrics_dir)):
    history = await get_node_history(metrics_dir, node_id)
    if not history:
        raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")
    return history[-1]


@router.get("/{node_id}/history", response_model=list[NodeStateSchema])
async def get_node_history_endpoint(
    node_id: str, metrics_dir: str = Depends(get_metrics_dir)
):
    history = await get_node_history(metrics_dir, node_id)
    if not history:
        raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")
    return history
