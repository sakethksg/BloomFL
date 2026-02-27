"""
BloomFL FastSAM Inference Service
==================================

FastSAM-based segmentation inference with multi-checkpoint support.
Follows the same architecture as inference_service.py for consistency.
"""
from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

# ── Model cache (keyed by resolved checkpoint path / name) ────────────────────

_model_cache: dict[str, object] = {}  # checkpoint_key → FastSAM model
_default_device: str = "cpu"

MASK_COLOUR = (0, 220, 0)      # bright green — masks
OTHER_COLOUR = (120, 120, 120)  # grey — other objects


# ── Internal helpers ──────────────────────────────────────────────────────────

def _get_device() -> str:
    global _default_device
    try:
        from api.dependencies import get_config  # type: ignore[import]
        return getattr(get_config(), "fastsam_device", "cpu")
    except Exception:  # noqa: BLE001
        return _default_device


def _load_fastsam(checkpoint: str = "FastSAM-s.pt") -> object:
    """Return a cached FastSAM model for *checkpoint*, lazily loading on first call.
    
    Loads from fastsam package or compatible wrapper.
    """
    key = str(checkpoint)
    if key not in _model_cache:
        try:
            # Try to import from fastsam
            from fastsam import FastSAM
            
            model = FastSAM(checkpoint if checkpoint else "FastSAM-s.pt")
            device = _get_device()
            if device != "cpu":
                try:
                    model.to(device)
                except Exception:  # noqa: BLE001
                    pass
            _model_cache[key] = model
            logger.info("Loaded FastSAM model into cache: %s", key)
        except ImportError:
            logger.error("FastSAM package not installed. Install with: pip install fastsam")
            raise ValueError("FastSAM not available")
    return _model_cache[key]


def _decode_image(image_bytes: bytes):
    import cv2
    nparr = np.frombuffer(image_bytes, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if frame is None:
        raise ValueError("Could not decode image — unsupported format or corrupt file")
    return frame


def _run_fastsam(model, frame, conf: float, ckpt_label: str = "") -> dict:
    """Run a loaded FastSAM model on a BGR numpy frame; return raw result dict."""
    t0 = time.perf_counter()
    
    try:
        # FastSAM inference
        results = model(frame, conf=conf, verbose=False)
        elapsed_ms = (time.perf_counter() - t0) * 1000
        
        # Extract detection info from results
        # FastSAM returns masks and bounding boxes
        boxes = []
        person_count = 0
        
        if results and len(results) > 0:
            result = results[0]
            
            # Extract boxes if available
            if hasattr(result, 'boxes') and result.boxes is not None:
                for box in result.boxes:
                    x1, y1, x2, y2 = box.xyxy[0].tolist() if hasattr(box, 'xyxy') else [0, 0, 0, 0]
                    conf_score = float(box.conf[0].item()) if hasattr(box, 'conf') else 0.0
                    
                    boxes.append({
                        "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                        "conf": conf_score,
                        "class_id": 0,  # FastSAM primarily detects objects
                        "class_name": "object",
                    })
                    person_count += 1
            
            # If no boxes but masks exist, create bounding boxes from masks
            if not boxes and hasattr(result, 'masks') and result.masks is not None:
                masks = result.masks
                if hasattr(masks, 'xy'):
                    for i, mask in enumerate(masks.xy):
                        if len(mask) > 0:
                            x_coords = mask[:, 0]
                            y_coords = mask[:, 1]
                            x1, x2 = x_coords.min(), x_coords.max()
                            y1, y2 = y_coords.min(), y_coords.max()
                            
                            boxes.append({
                                "x1": float(x1), "y1": float(y1), "x2": float(x2), "y2": float(y2),
                                "conf": conf,
                                "class_id": 0,
                                "class_name": "segmentation",
                            })
                            person_count += 1
        
        return {
            "boxes": boxes,
            "person_count": person_count,
            "inference_time_ms": round(elapsed_ms, 2),
            "model_path": ckpt_label,
            "_fastsam_results": results,  # internal; stripped before returning to caller
        }
    except Exception as exc:
        logger.error("FastSAM inference error: %s", exc)
        raise ValueError(f"FastSAM inference failed: {exc}") from exc


def _annotate_frame_fastsam(frame, fastsam_results) -> bytes:
    """Annotate frame with FastSAM masks/boxes."""
    import cv2
    font = cv2.FONT_HERSHEY_SIMPLEX
    
    try:
        if fastsam_results and len(fastsam_results) > 0:
            result = fastsam_results[0]
            
            # Draw boxes if available
            if hasattr(result, 'boxes') and result.boxes is not None:
                for box in result.boxes:
                    x1, y1, x2, y2 = [int(v) for v in box.xyxy[0].tolist()]
                    conf_score = float(box.conf[0].item()) if hasattr(box, 'conf') else 0.0
                    
                    cv2.rectangle(frame, (x1, y1), (x2, y2), MASK_COLOUR, 2)
                    label = f"object {conf_score:.2f}"
                    cv2.putText(frame, label, (x1, max(y1 - 8, 12)), font, 0.55, MASK_COLOUR, 2)
            
            # Draw masks if available
            if hasattr(result, 'masks') and result.masks is not None:
                masks = result.masks
                if hasattr(masks, 'xy'):
                    for mask_points in masks.xy:
                        if len(mask_points) > 2:
                            points = np.array(mask_points, dtype=np.int32)
                            cv2.polylines(frame, [points], True, MASK_COLOUR, 2)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Annotation error: %s", exc)
    
    _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
    return buf.tobytes()


# ── Public single-checkpoint API ──────────────────────────────────────────────

def detect(image_bytes: bytes, checkpoint: str = "FastSAM-s.pt", conf: float = 0.35) -> dict:
    """Run FastSAM inference with *one* checkpoint; returns a DetectionResult dict."""
    model = _load_fastsam(checkpoint)
    frame = _decode_image(image_bytes)
    result = _run_fastsam(model, frame, conf, ckpt_label=checkpoint or "FastSAM-s.pt")
    result.pop("_fastsam_results", None)
    return result


def detect_annotated(image_bytes: bytes, checkpoint: str = "FastSAM-s.pt", conf: float = 0.35) -> bytes:
    """Run FastSAM inference and return an annotated JPEG."""
    model = _load_fastsam(checkpoint)
    frame = _decode_image(image_bytes)
    fastsam_results = model(frame, conf=conf, verbose=False)
    return _annotate_frame_fastsam(frame.copy(), fastsam_results)


# ── Public multi-checkpoint API ───────────────────────────────────────────────

def detect_multi(
    image_bytes: bytes,
    checkpoints: list[str],
    conf: float = 0.35,
) -> list[dict]:
    """Run the same image through each FastSAM checkpoint.

    Returns a list of NodeDetectionResult dicts — one per checkpoint.
    """
    from api.services.inference_service import checkpoint_label_for
    
    frame_orig = _decode_image(image_bytes)
    results = []
    for ckpt in checkpoints:
        label = checkpoint_label_for(ckpt or "FastSAM-s.pt")
        try:
            model = _load_fastsam(ckpt)
            result = _run_fastsam(model, frame_orig.copy(), conf, ckpt_label=ckpt or "FastSAM-s.pt")
            result.pop("_fastsam_results", None)
            result["node_label"] = label
        except Exception as exc:  # noqa: BLE001
            logger.warning("Multi-detect skipping %s: %s", ckpt, exc)
            result = {
                "boxes": [], "person_count": 0, "inference_time_ms": 0,
                "model_path": ckpt or "FastSAM-s.pt",
                "node_label": label,
                "error": str(exc),
            }
        results.append(result)
    return results


def detect_multi_annotated(
    image_bytes: bytes,
    checkpoints: list[str],
    conf: float = 0.35,
) -> list[dict]:
    """Same as detect_multi but each result also carries a base64-encoded annotated JPEG."""
    import base64
    from api.services.inference_service import checkpoint_label_for
    
    frame_orig = _decode_image(image_bytes)
    results = []
    for ckpt in checkpoints:
        label = checkpoint_label_for(ckpt or "FastSAM-s.pt")
        try:
            model = _load_fastsam(ckpt)
            t0 = time.perf_counter()
            fastsam_results = model(frame_orig.copy(), conf=conf, verbose=False)
            elapsed = (time.perf_counter() - t0) * 1000
            
            boxes = []
            person_count = 0
            if fastsam_results and len(fastsam_results) > 0:
                result = fastsam_results[0]
                
                if hasattr(result, 'boxes') and result.boxes is not None:
                    for box in result.boxes:
                        x1, y1, x2, y2 = box.xyxy[0].tolist() if hasattr(box, 'xyxy') else [0, 0, 0, 0]
                        conf_score = float(box.conf[0].item()) if hasattr(box, 'conf') else 0.0
                        
                        boxes.append({
                            "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                            "conf": conf_score,
                            "class_id": 0,
                            "class_name": "object",
                        })
                        person_count += 1
            
            annotated_bytes = _annotate_frame_fastsam(frame_orig.copy(), fastsam_results)
            results.append({
                "boxes": boxes,
                "person_count": person_count,
                "inference_time_ms": round(elapsed, 2),
                "model_path": ckpt or "FastSAM-s.pt",
                "node_label": label,
                "annotated_jpeg_b64": base64.b64encode(annotated_bytes).decode(),
            })
        except Exception as exc:  # noqa: BLE001
            logger.warning("Multi-annotate skipping %s: %s", ckpt, exc)
            results.append({
                "boxes": [], "person_count": 0, "inference_time_ms": 0,
                "model_path": ckpt or "FastSAM-s.pt",
                "node_label": label,
                "annotated_jpeg_b64": "",
                "error": str(exc),
            })
    return results


# ── Legacy singleton shim ─────────────────────────────────────────────────────

class FastSAMService:
    """Compatibility wrapper for single FastSAM inference."""

    def __init__(self, checkpoint: str = "FastSAM-s.pt", device: str = "cpu") -> None:
        self._checkpoint = checkpoint
        self._device = device
        global _default_device
        _default_device = device
        try:
            _load_fastsam(checkpoint)
        except Exception as exc:  # noqa: BLE001
            logger.error("Eagerly loading %s failed: %s", checkpoint, exc)

    @property
    def is_loaded(self) -> bool:
        return str(self._checkpoint) in _model_cache

    def detect(self, image_bytes: bytes, conf: float = 0.35) -> dict:
        return detect(image_bytes, self._checkpoint, conf)

    def detect_annotated(self, image_bytes: bytes, conf: float = 0.35) -> bytes:
        return detect_annotated(image_bytes, self._checkpoint, conf)


_fastsam_service: Optional[FastSAMService] = None


def get_fastsam_service() -> FastSAMService:
    global _fastsam_service
    if _fastsam_service is None:
        checkpoint = "FastSAM-s.pt"
        device = "cpu"
        try:
            from api.dependencies import get_config  # type: ignore[import]
            cfg = get_config()
            checkpoint = getattr(cfg, "fastsam_checkpoint", "FastSAM-s.pt")
            device = getattr(cfg, "fastsam_device", "cpu")
        except Exception:  # noqa: BLE001
            pass
        _fastsam_service = FastSAMService(checkpoint=checkpoint, device=device)
    return _fastsam_service


def reset_fastsam_service() -> None:
    global _fastsam_service, _model_cache
    _fastsam_service = None
    _model_cache = {}
