"""Simulation router — start / stop / monitor simulation runs."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from api.models.schemas import (
    SimulationStartRequest,
    SimulationStatusSchema,
    SimulationResultSchema,
)
from api.services.simulation_service import get_simulation_service

router = APIRouter(prefix="/api/simulation", tags=["simulation"])


@router.get("/status", response_model=SimulationStatusSchema)
async def status():
    return get_simulation_service().get_status()


@router.post("/start", response_model=SimulationStatusSchema)
async def start(req: SimulationStartRequest):
    svc = get_simulation_service()
    try:
        await svc.start(req)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return svc.get_status()


@router.post("/stop", response_model=SimulationStatusSchema)
async def stop():
    await get_simulation_service().stop()
    return get_simulation_service().get_status()


@router.get("/results")
async def results():
    result = get_simulation_service().get_result()
    if result is None:
        raise HTTPException(status_code=404, detail="No completed simulation results available.")
    return result
