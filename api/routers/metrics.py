"""Metrics router — aggregated training/convergence metrics."""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, Response

from api.models.schemas import RoundStatsSchema, SummarySchema
from api.services.metrics_service import get_per_round_stats, get_summary
from api.dependencies import get_metrics_dir

router = APIRouter(prefix="/api/metrics", tags=["metrics"])


@router.get("/summary", response_model=SummarySchema)
async def summary(metrics_dir: str = Depends(get_metrics_dir)):
    return await get_summary(metrics_dir)


@router.get("/per-round", response_model=list[RoundStatsSchema])
async def per_round(metrics_dir: str = Depends(get_metrics_dir)):
    return await get_per_round_stats(metrics_dir)


@router.get("/export")
async def export(metrics_dir: str = Depends(get_metrics_dir)):
    stats = await get_per_round_stats(metrics_dir)
    content = json.dumps([s.model_dump() for s in stats], indent=2)
    return Response(
        content=content,
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=bloomfl_metrics.json"},
    )
