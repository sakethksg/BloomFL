"""
BloomFL Inference Service
=========================

Multi-node aware inference: maintains a per-checkpoint model cache so the same
image can be run through every node's gossip-trained checkpoint in one call.

The ``detect_multi()`` / ``detect_multi_annotated()`` helpers are the primary
entry points for multi-node comparison.  The single-checkpoint helpers are kept
for the simple single-image flow.
"""
from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

# ── Model cache (keyed by resolved checkpoint path / name) ────────────────────

_model_cache: dict[str, object] = {}   # checkpoint_key → ultralytics.YOLO
_default_device: str = "cpu"

PERSON_COLOUR = (0, 220, 0)      # bright green — persons
OTHER_COLOUR  = (120, 120, 120)  # grey — other COCO classes


# ── Internal helpers ──────────────────────────────────────────────────────────

def _get_device() -> str:
    global _default_device
    try:
        from api.dependencies import get_config  # type: ignore[import]
        return getattr(get_config(), "yolo_device", "cpu")
    except Exception:  # noqa: BLE001
        return _default_device


def _load(checkpoint: str) -> object:
    """Return a cached model (YOLO or FastSAM) for *checkpoint*, lazily loading on first call.
    
    Automatically detects model type based on checkpoint filename.
    Falls back to YOLO if FastSAM is not available.
    """
    key = str(checkpoint)
    if key not in _model_cache:
        detection_type = get_detection_type(checkpoint)
        device = _get_device()
        
        if detection_type == "fastsam":
            # Try to load FastSAM model
            try:
                from fastsam import FastSAM
                model = FastSAM(checkpoint if checkpoint else "FastSAM-s.pt")
                logger.info("Loaded FastSAM model into cache: %s", key)
            except ImportError:
                logger.warning("FastSAM package not installed. Falling back to YOLO. Install with: pip install fastsam")
                # Fallback to YOLO for FastSAM checkpoints if library not available
                from src.bloomfl.inference.webcam import _load_yolo  # type: ignore[import]
                model = _load_yolo("yolo12n.pt")  # Use default YOLO as fallback
                logger.info("Loaded YOLO fallback for FastSAM checkpoint: %s", key)
            except Exception as e:  # noqa: BLE001
                logger.error("Failed to load FastSAM model %s: %s", checkpoint, e)
                # Fallback to YOLO
                from src.bloomfl.inference.webcam import _load_yolo  # type: ignore[import]
                model = _load_yolo("yolo12n.pt")
                logger.info("Loaded YOLO fallback due to FastSAM error: %s", key)
        else:
            # Load YOLO model (default)
            from src.bloomfl.inference.webcam import _load_yolo  # type: ignore[import]
            model = _load_yolo(checkpoint if checkpoint else None)
            logger.info("Loaded YOLO model into cache: %s", key)
        
        if device != "cpu":
            try:
                model.to(device)
            except Exception:  # noqa: BLE001
                pass
        
        _model_cache[key] = model
    return _model_cache[key]


def _decode_image(image_bytes: bytes):
    import cv2
    nparr = np.frombuffer(image_bytes, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if frame is None:
        raise ValueError("Could not decode image — unsupported format or corrupt file")
    return frame


def _run_model(model, frame, conf: float, ckpt_label: str = "") -> dict:
    """Run a loaded model (YOLO or FastSAM) on a BGR numpy frame; return raw result dict."""
    t0 = time.perf_counter()
    results = model(frame, conf=conf, verbose=False)
    elapsed_ms = (time.perf_counter() - t0) * 1000

    boxes = []
    person_count = 0
    
    for r in results:
        if hasattr(r, 'boxes') and r.boxes is not None:
            for box in r.boxes:
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                class_id = int(box.cls[0].item())
                class_name = r.names.get(class_id, str(class_id))
                conf_score = float(box.conf[0].item())
                boxes.append({
                    "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                    "conf": conf_score,
                    "class_id": class_id,
                    "class_name": class_name,
                })
                if class_id == 0:  # person class in COCO
                    person_count += 1
        
        # Handle FastSAM masks if no boxes found
        if not boxes and hasattr(r, 'masks') and r.masks is not None:
            masks = r.masks
            if hasattr(masks, 'xy'):
                for i, mask in enumerate(masks.xy):
                    if len(mask) > 0:
                        x_coords = mask[:, 0]
                        y_coords = mask[:, 1]
                        x1, x2 = float(x_coords.min()), float(x_coords.max())
                        y1, y2 = float(y_coords.min()), float(y_coords.max())
                        
                        boxes.append({
                            "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                            "conf": conf,
                            "class_id": 0,
                            "class_name": "object",
                        })
                        person_count += 1

    return {
        "boxes": boxes,
        "person_count": person_count,
        "inference_time_ms": round(elapsed_ms, 2),
        "model_path": ckpt_label,
        "_model_results": results,  # internal; stripped before returning to caller
    }


def _annotate_frame(frame, model_results, checkpoint: str = "") -> bytes:
    """Annotate frame with bounding boxes or masks based on model type."""
    import cv2
    font = cv2.FONT_HERSHEY_SIMPLEX
    detection_type = get_detection_type(checkpoint)
    
    for r in model_results:
        # Draw bounding boxes
        if hasattr(r, 'boxes') and r.boxes is not None:
            for box in r.boxes:
                x1, y1, x2, y2 = [int(v) for v in box.xyxy[0].tolist()]
                class_id = int(box.cls[0].item())
                class_name = r.names.get(class_id, str(class_id))
                conf_score = float(box.conf[0].item())
                colour = PERSON_COLOUR if class_id == 0 else OTHER_COLOUR
                cv2.rectangle(frame, (x1, y1), (x2, y2), colour, 2)
                label = f"{class_name} {conf_score:.2f}"
                cv2.putText(frame, label, (x1, max(y1 - 8, 12)), font, 0.55, colour, 2)
        
        # Draw FastSAM masks if available
        if detection_type == "fastsam" and hasattr(r, 'masks') and r.masks is not None:
            masks = r.masks
            if hasattr(masks, 'xy'):
                import numpy as np
                for mask_points in masks.xy:
                    if len(mask_points) > 2:
                        points = np.array(mask_points, dtype=np.int32)
                        cv2.polylines(frame, [points], True, PERSON_COLOUR, 2)
    
    _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
    return buf.tobytes()


def checkpoint_label_for(ckpt: str) -> str:
    """Short human-readable label for a checkpoint path."""
    p = Path(ckpt)
    if not p.exists():
        return ckpt  # pretrained name like "yolo12n.pt"
    return p.stem  # e.g. "node-abc1" from ./keys/node-abc1.pt


def get_detection_type(checkpoint: str) -> str:
    """Determine detection type from checkpoint filename.
    
    Returns "yolo", "fastsam", or "unknown" based on naming patterns.
    """
    name = Path(checkpoint).name.lower()
    if "fastsam" in name:
        return "fastsam"
    elif any(x in name for x in ["yolo", "yolov8", "yolov10", "yolo11", "yolo12"]):
        return "yolo"
    return "unknown"


# ── Public single-checkpoint API ──────────────────────────────────────────────

def detect(image_bytes: bytes, checkpoint: str = "", conf: float = 0.35) -> dict:
    """Run inference with *one* checkpoint (auto-detects YOLO or FastSAM); returns a DetectionResult dict."""
    model = _load(checkpoint)
    frame = _decode_image(image_bytes)
    result = _run_model(model, frame, conf, ckpt_label=checkpoint or "yolo12n.pt")
    result.pop("_model_results", None)
    return result


def detect_annotated(image_bytes: bytes, checkpoint: str = "", conf: float = 0.35) -> bytes:
    """Run inference and return an annotated JPEG (auto-detects YOLO or FastSAM)."""
    model = _load(checkpoint)
    frame = _decode_image(image_bytes)
    model_results = model(frame, conf=conf, verbose=False)
    return _annotate_frame(frame.copy(), model_results, checkpoint=checkpoint)


# ── Public multi-checkpoint API ───────────────────────────────────────────────

def detect_multi(
    image_bytes: bytes,
    checkpoints: list[str],
    conf: float = 0.35,
) -> list[dict]:
    """Run the same image through each checkpoint (auto-detects YOLO or FastSAM).

    Returns a list of NodeDetectionResult dicts — one per checkpoint — in the
    same order as the input list.  Failures are recorded as entries with an
    ``error`` field so the caller always gets len(checkpoints) results.
    """
    frame_orig = _decode_image(image_bytes)
    results = []
    for ckpt in checkpoints:
        label = checkpoint_label_for(ckpt or "yolo12n.pt")
        try:
            model = _load(ckpt)
            result = _run_model(model, frame_orig.copy(), conf, ckpt_label=ckpt or "yolo12n.pt")
            result.pop("_model_results", None)
            result["node_label"] = label
        except Exception as exc:  # noqa: BLE001
            logger.warning("Multi-detect skipping %s: %s", ckpt, exc)
            result = {
                "boxes": [], "person_count": 0, "inference_time_ms": 0,
                "model_path": ckpt or "yolo12n.pt",
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
    """Same as detect_multi but each result also carries a base64-encoded annotated JPEG.

    Returns list of NodeDetectionResult dicts, each with an
    ``annotated_jpeg_b64`` field. Auto-detects YOLO or FastSAM per checkpoint.
    """
    import base64

    frame_orig = _decode_image(image_bytes)
    results = []
    for ckpt in checkpoints:
        label = checkpoint_label_for(ckpt or "yolo12n.pt")
        try:
            model = _load(ckpt)
            t0 = time.perf_counter()
            model_results = model(frame_orig.copy(), conf=conf, verbose=False)
            elapsed = (time.perf_counter() - t0) * 1000

            boxes = []
            person_count = 0
            for r in model_results:
                if hasattr(r, 'boxes') and r.boxes is not None:
                    for box in r.boxes:
                        x1, y1, x2, y2 = box.xyxy[0].tolist()
                        class_id = int(box.cls[0].item())
                        class_name = r.names.get(class_id, str(class_id))
                        conf_score = float(box.conf[0].item())
                        boxes.append({
                            "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                            "conf": conf_score, "class_id": class_id, "class_name": class_name,
                        })
                        if class_id == 0:
                            person_count += 1
                
                # Handle FastSAM masks if no boxes
                if not boxes and hasattr(r, 'masks') and r.masks is not None:
                    masks = r.masks
                    if hasattr(masks, 'xy'):
                        for mask in masks.xy:
                            if len(mask) > 0:
                                x_coords = mask[:, 0]
                                y_coords = mask[:, 1]
                                x1, x2 = float(x_coords.min()), float(x_coords.max())
                                y1, y2 = float(y_coords.min()), float(y_coords.max())
                                boxes.append({
                                    "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                                    "conf": conf, "class_id": 0, "class_name": "object",
                                })
                                person_count += 1

            annotated_bytes = _annotate_frame(frame_orig.copy(), model_results, checkpoint=ckpt)
            results.append({
                "boxes": boxes,
                "person_count": person_count,
                "inference_time_ms": round(elapsed, 2),
                "model_path": ckpt or "yolo12n.pt",
                "node_label": label,
                "annotated_jpeg_b64": base64.b64encode(annotated_bytes).decode(),
            })
        except Exception as exc:  # noqa: BLE001
            logger.warning("Multi-annotate skipping %s: %s", ckpt, exc)
            results.append({
                "boxes": [], "person_count": 0, "inference_time_ms": 0,
                "model_path": ckpt or "yolo12n.pt",
                "node_label": label,
                "annotated_jpeg_b64": "",
                "error": str(exc),
            })
    return results


# ── Checkpoint discovery ──────────────────────────────────────────────────────

def discover_checkpoints(extra_dirs: list[str] | None = None, detection_type: str | None = None) -> list[dict]:
    """Scan well-known directories for BloomFL node `.pt` checkpoints.

    Always returns the pretrained baseline as the first entry (if detection_type matches).
    Returns a list of ``{label, path, exists, is_pretrained, detection_type}`` dicts.
    
    Args:
        extra_dirs: Additional directories to search
        detection_type: Filter by detection type ("yolo", "fastsam", or None for all)
    """
    search_dirs: list[Path] = [Path("."), Path("./keys"), Path("./checkpoints"), Path("./weights")]
    if extra_dirs:
        search_dirs.extend(Path(d) for d in extra_dirs)

    try:
        from api.dependencies import get_config  # type: ignore[import]
        cfg = get_config()
        search_dirs.append(Path(getattr(cfg, "key_storage_dir", "./keys")))
        search_dirs.append(Path(getattr(cfg, "data_dir", "./data")))
    except Exception:  # noqa: BLE001
        pass

    entries: list[dict] = []
    
    # Pretrained baselines
    yolo_baseline = {
        "label": "yolo12n (pretrained)",
        "path": "yolo12n.pt",
        "exists": Path("yolo12n.pt").exists(),
        "is_pretrained": True,
        "detection_type": "yolo",
    }
    fastsam_baseline = {
        "label": "FastSAM-s (pretrained)",
        "path": "FastSAM-s.pt",
        "exists": Path("FastSAM-s.pt").exists(),
        "is_pretrained": True,
        "detection_type": "fastsam",
    }
    
    # Add matching pretrained baselines
    if detection_type is None or detection_type == "yolo":
        entries.append(yolo_baseline)
    if detection_type is None or detection_type == "fastsam":
        entries.append(fastsam_baseline)

    seen: set[str] = set()
    for d in search_dirs:
        if not d.exists():
            continue
        for suffix in ("*.pt", "*.pth"):
            for pt_file in sorted(d.glob(suffix)):
                key = str(pt_file.resolve())
                if key in seen:
                    continue
                # Skip pretrained roots already listed
                if pt_file.name in ("yolo12n.pt", "yolo11n.pt", "yolov8n.pt", "FastSAM-s.pt") and d == Path("."):
                    continue

                det_type = get_detection_type(pt_file.name)

                # Filter by detection_type if specified
                if detection_type is not None and det_type != detection_type:
                    continue

                seen.add(key)
                entries.append({
                    "label": pt_file.stem,
                    "path": str(pt_file),
                    "exists": True,
                    "is_pretrained": False,
                    "detection_type": det_type,
                })

    return entries


# ── Legacy singleton shim ─────────────────────────────────────────────────────

class InferenceService:
    """Thin compatibility wrapper used by the single-inference router endpoints."""

    def __init__(self, checkpoint: str = "yolo12n.pt", device: str = "cpu") -> None:
        self._checkpoint = checkpoint
        self._device = device
        global _default_device
        _default_device = device
        try:
            _load(checkpoint)
        except Exception as exc:  # noqa: BLE001
            logger.error("Eagerly loading %s failed: %s", checkpoint, exc)

    @property
    def is_loaded(self) -> bool:
        return str(self._checkpoint) in _model_cache

    def detect(self, image_bytes: bytes, conf: float = 0.35) -> dict:
        return detect(image_bytes, self._checkpoint, conf)

    def detect_annotated(self, image_bytes: bytes, conf: float = 0.35) -> bytes:
        return detect_annotated(image_bytes, self._checkpoint, conf)


_inference_service: Optional[InferenceService] = None


def get_inference_service() -> InferenceService:
    global _inference_service
    if _inference_service is None:
        checkpoint = "yolo12n.pt"
        device = "cpu"
        try:
            from api.dependencies import get_config  # type: ignore[import]
            cfg = get_config()
            checkpoint = getattr(cfg, "yolo_checkpoint", "yolo12n.pt")
            device = getattr(cfg, "yolo_device", "cpu")
        except Exception:  # noqa: BLE001
            pass
        _inference_service = InferenceService(checkpoint=checkpoint, device=device)
    return _inference_service


def reset_inference_service() -> None:
    global _inference_service, _model_cache
    _inference_service = None
    _model_cache = {}
