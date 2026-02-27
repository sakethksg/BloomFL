"""
FastSAM Router — Segmentation detection endpoints.

Single-checkpoint endpoints
---------------------------
  GET  /api/fastsam/status              → model status
  POST /api/fastsam/detect              → DetectionResult JSON
  POST /api/fastsam/detect/annotated    → annotated JPEG bytes

Multi-checkpoint endpoints
----------------------------------------
  GET  /api/fastsam/checkpoints         → list of discovered .pt checkpoints
  POST /api/fastsam/detect/multi        → list[NodeDetectionResult] JSON
  POST /api/fastsam/detect/multi/annotated → list[NodeDetectionResult] + base64 annotated JPEGs
"""
from __future__ import annotations

import logging
from typing import List

from fastapi import APIRouter, File, Query, UploadFile, HTTPException
from fastapi.responses import Response

from api.models.schemas import (
    CheckpointInfoSchema,
    DetectionResultSchema,
    InferenceStatusSchema,
    NodeDetectionResultSchema,
)
from api.services.inference_service import discover_checkpoints
from api.services.fastsam_service import (
    detect as svc_detect,
    detect_annotated as svc_detect_annotated,
    detect_multi,
    detect_multi_annotated,
    get_fastsam_service,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/fastsam", tags=["fastsam"])


# ── Status ────────────────────────────────────────────────────────────────────

@router.get("/status", response_model=InferenceStatusSchema)
async def fastsam_status():
    """Return whether the default FastSAM model is loaded, its checkpoint path, and device."""
    svc = get_fastsam_service()
    return InferenceStatusSchema(
        model_loaded=svc.is_loaded,
        checkpoint_path=svc._checkpoint,
        device=svc._device,
    )


# ── Checkpoint discovery ──────────────────────────────────────────────────────

@router.get("/checkpoints", response_model=List[CheckpointInfoSchema])
async def list_fastsam_checkpoints(detection_type: str | None = Query("fastsam", description="Filter by detection type (always fastsam for this endpoint)")):
    """Scan directories for FastSAM `.pt` checkpoints.

    Returns the pretrained ``FastSAM-s.pt`` baseline entry first,
    followed by any fine-tuned node checkpoints found in ``./keys/``,
    ``./checkpoints/``, etc.
    """
    return discover_checkpoints(detection_type="fastsam")


# ── Single-checkpoint endpoints ───────────────────────────────────────────────

@router.post("/detect", response_model=DetectionResultSchema)
async def detect(
    file: UploadFile = File(..., description="Image file (JPEG, PNG, WebP, BMP)"),
    conf: float = Query(0.35, ge=0.01, le=1.0, description="Confidence threshold"),
    checkpoint: str = Query("", description="Checkpoint path (empty = default FastSAM-s.pt)"),
):
    """Upload an image and receive segmentation result as JSON.

    Pass an optional ``checkpoint`` query parameter to use a specific model;
    omit it (or pass empty string) for the pretrained baseline.
    """
    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    try:
        result = svc_detect(image_bytes, checkpoint=checkpoint or "FastSAM-s.pt", conf=conf)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("FastSAM inference error")
        raise HTTPException(status_code=500, detail=f"FastSAM inference failed: {exc}") from exc
    return DetectionResultSchema(**result)


@router.post(
    "/detect/annotated",
    responses={200: {"content": {"image/jpeg": {}}, "description": "Annotated JPEG image"}},
)
async def detect_annotated(
    file: UploadFile = File(..., description="Image file (JPEG, PNG, WebP, BMP)"),
    conf: float = Query(0.35, ge=0.01, le=1.0, description="Confidence threshold"),
    checkpoint: str = Query("", description="Checkpoint path (empty = default)"),
):
    """Upload an image; receive it back as an annotated JPEG with segmentations."""
    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    try:
        annotated = svc_detect_annotated(image_bytes, checkpoint=checkpoint or "FastSAM-s.pt", conf=conf)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("FastSAM annotated inference error")
        raise HTTPException(status_code=500, detail=f"FastSAM inference failed: {exc}") from exc
    return Response(content=annotated, media_type="image/jpeg")


# ── Multi-checkpoint endpoints ────────────────────────────────────────────────

@router.post("/detect/multi", response_model=List[NodeDetectionResultSchema])
async def detect_multi_endpoint(
    file: UploadFile = File(..., description="Image file (JPEG, PNG, WebP, BMP)"),
    conf: float = Query(0.35, ge=0.01, le=1.0, description="Confidence threshold"),
    checkpoints: str = Query(
        "",
        description="Comma-separated list of checkpoint paths. Empty = use all discovered.",
    ),
):
    """Run FastSAM inference through **multiple checkpoints** in one request.

    Returns a list of NodeDetectionResult — one per checkpoint.
    """
    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    ckpt_list = _parse_checkpoints(checkpoints)

    try:
        results = detect_multi(image_bytes, ckpt_list, conf=conf)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("FastSAM multi-inference error")
        raise HTTPException(status_code=500, detail=f"FastSAM multi-inference failed: {exc}") from exc

    return [NodeDetectionResultSchema(**r) for r in results]


@router.post("/detect/multi/annotated", response_model=List[NodeDetectionResultSchema])
async def detect_multi_annotated_endpoint(
    file: UploadFile = File(..., description="Image file (JPEG, PNG, WebP, BMP)"),
    conf: float = Query(0.35, ge=0.01, le=1.0, description="Confidence threshold"),
    checkpoints: str = Query(
        "",
        description="Comma-separated checkpoint paths; empty = all discovered.",
    ),
):
    """Run FastSAM through multiple checkpoints and return annotated images.

    Each result contains all NodeDetectionResult fields **plus**
    an ``annotated_jpeg_b64`` — a base64-encoded JPEG with segmentations.
    """
    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    ckpt_list = _parse_checkpoints(checkpoints)

    try:
        results = detect_multi_annotated(image_bytes, ckpt_list, conf=conf)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("FastSAM multi-annotated inference error")
        raise HTTPException(status_code=500, detail=f"FastSAM multi-annotated inference failed: {exc}") from exc

    return [NodeDetectionResultSchema(**r) for r in results]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _parse_checkpoints(raw: str) -> list[str]:
    """Parse comma-separated checkpoint param; fall back to fastsam checkpoints."""
    if raw.strip():
        return [c.strip() for c in raw.split(",") if c.strip()]
    # No explicit list → use all discovered fastsam checkpoints
    return [entry["path"] for entry in discover_checkpoints(detection_type="fastsam")]
