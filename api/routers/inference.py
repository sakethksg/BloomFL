"""
Inference router — YOLO image detection endpoints.

Single-checkpoint endpoints
---------------------------
  GET  /api/inference/status              → model status
  POST /api/inference/detect              → DetectionResult JSON
  POST /api/inference/detect/annotated    → annotated JPEG bytes

Multi-checkpoint (multi-node) endpoints
----------------------------------------
  GET  /api/inference/checkpoints         → list of discovered .pt checkpoints
  POST /api/inference/detect/multi        → list[NodeDetectionResult] JSON
  POST /api/inference/detect/multi/annotated → list[NodeDetectionResult] + base64 annotated JPEGs
"""
from __future__ import annotations

import logging
from typing import List

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response

from api.models.schemas import (
    CheckpointInfoSchema,
    DetectionResultSchema,
    InferenceStatusSchema,
    NodeDetectionResultSchema,
)
from api.services.inference_service import (
    detect as svc_detect,
    detect_annotated as svc_detect_annotated,
    detect_multi,
    detect_multi_annotated,
    discover_checkpoints,
    get_inference_service,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/inference", tags=["inference"])


# ── Status ────────────────────────────────────────────────────────────────────

@router.get("/status", response_model=InferenceStatusSchema)
async def inference_status():
    """Return whether the default YOLO model is loaded, its checkpoint path, and device."""
    svc = get_inference_service()
    return InferenceStatusSchema(
        model_loaded=svc.is_loaded,
        checkpoint_path=svc._checkpoint,
        device=svc._device,
    )


# ── Checkpoint discovery ──────────────────────────────────────────────────────

@router.get("/checkpoints", response_model=List[CheckpointInfoSchema])
async def list_checkpoints():
    """Scan well-known directories for BloomFL node `.pt` checkpoints.

    Always returns the pretrained ``yolo12n.pt`` baseline entry first,
    followed by any gossip-trained node checkpoints found in ``./keys/``,
    ``./checkpoints/``, and the configured ``key_storage_dir``.
    """
    return discover_checkpoints()


# ── Single-checkpoint endpoints ───────────────────────────────────────────────

@router.post("/detect", response_model=DetectionResultSchema)
async def detect(
    file: UploadFile = File(..., description="Image file (JPEG, PNG, WebP, BMP)"),
    conf: float = Query(0.35, ge=0.01, le=1.0, description="Confidence threshold"),
    checkpoint: str = Query("", description="Checkpoint path (empty = default yolo12n.pt)"),
):
    """Upload an image and receive bounding-box detections as JSON.

    Pass an optional ``checkpoint`` query parameter to use a specific node's
    gossip-trained model; omit it (or pass empty string) for the pretrained baseline.
    """
    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    try:
        result = svc_detect(image_bytes, checkpoint=checkpoint, conf=conf)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Inference error")
        raise HTTPException(status_code=500, detail=f"Inference failed: {exc}") from exc
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
    """Upload an image; receive it back as an annotated JPEG.

    Persons are highlighted in bright green, all other COCO classes in grey.
    """
    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    try:
        annotated = svc_detect_annotated(image_bytes, checkpoint=checkpoint, conf=conf)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Annotated inference error")
        raise HTTPException(status_code=500, detail=f"Inference failed: {exc}") from exc
    return Response(content=annotated, media_type="image/jpeg")


# ── Multi-checkpoint (multi-node) endpoints ───────────────────────────────────

@router.post("/detect/multi", response_model=List[NodeDetectionResultSchema])
async def detect_multi_endpoint(
    file: UploadFile = File(..., description="Image file (JPEG, PNG, WebP, BMP)"),
    conf: float = Query(0.35, ge=0.01, le=1.0, description="Confidence threshold"),
    checkpoints: str = Query(
        "",
        description=(
            "Comma-separated list of checkpoint paths to compare. "
            "Empty string means: use all discovered checkpoints."
        ),
    ),
):
    """Run the same image through **multiple node checkpoints** in one request.

    Returns a list of :class:`NodeDetectionResult` — one per checkpoint — so
    you can compare how each node's gossip-trained model performs on the same image.

    * Pass ``checkpoints=`` empty (default) to run all discovered checkpoints.
    * Pass ``checkpoints=yolo12n.pt,./keys/node-abc1.pt`` to select specific ones.
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
        logger.exception("Multi-inference error")
        raise HTTPException(status_code=500, detail=f"Multi-inference failed: {exc}") from exc

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
    """Run the image through multiple checkpoints and return annotated images.

    Each result contains all :class:`NodeDetectionResult` fields **plus**
    an ``annotated_jpeg_b64`` — a base64-encoded JPEG with bounding boxes drawn.
    The frontend can render it directly as ``<img src="data:image/jpeg;base64,...">``.
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
        logger.exception("Multi-annotated inference error")
        raise HTTPException(status_code=500, detail=f"Multi-annotated inference failed: {exc}") from exc

    return [NodeDetectionResultSchema(**r) for r in results]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _parse_checkpoints(raw: str) -> list[str]:
    """Parse comma-separated checkpoint param; fall back to all discovered."""
    if raw.strip():
        return [c.strip() for c in raw.split(",") if c.strip()]
    # No explicit list → use everything discovered
    return [entry["path"] for entry in discover_checkpoints()]
