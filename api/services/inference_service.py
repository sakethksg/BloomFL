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
    """Return a cached YOLO model for *checkpoint*, lazily loading on first call."""
    key = str(checkpoint)
    if key not in _model_cache:
        from src.bloomfl.inference.webcam import _load_yolo  # type: ignore[import]
        yolo = _load_yolo(checkpoint if checkpoint else None)
        device = _get_device()
        if device != "cpu":
            try:
                yolo.to(device)
            except Exception:  # noqa: BLE001
                pass
        _model_cache[key] = yolo
        logger.info("Loaded model into cache: %s", key)
    return _model_cache[key]


def _decode_image(image_bytes: bytes):
    import cv2
    nparr = np.frombuffer(image_bytes, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if frame is None:
        raise ValueError("Could not decode image — unsupported format or corrupt file")
    return frame


def _run_yolo(yolo, frame, conf: float, ckpt_label: str = "") -> dict:
    """Run a loaded YOLO model on a BGR numpy frame; return raw result dict."""
    t0 = time.perf_counter()
    results = yolo(frame, conf=conf, verbose=False)
    elapsed_ms = (time.perf_counter() - t0) * 1000

    boxes = []
    person_count = 0
    for r in results:
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
            if class_id == 0:
                person_count += 1

    return {
        "boxes": boxes,
        "person_count": person_count,
        "inference_time_ms": round(elapsed_ms, 2),
        "model_path": ckpt_label,
        "_yolo_results": results,  # internal; stripped before returning to caller
    }


def _annotate_frame(frame, yolo_results) -> bytes:
    import cv2
    font = cv2.FONT_HERSHEY_SIMPLEX
    for r in yolo_results:
        for box in r.boxes:
            x1, y1, x2, y2 = [int(v) for v in box.xyxy[0].tolist()]
            class_id = int(box.cls[0].item())
            class_name = r.names.get(class_id, str(class_id))
            conf_score = float(box.conf[0].item())
            colour = PERSON_COLOUR if class_id == 0 else OTHER_COLOUR
            cv2.rectangle(frame, (x1, y1), (x2, y2), colour, 2)
            label = f"{class_name} {conf_score:.2f}"
            cv2.putText(frame, label, (x1, max(y1 - 8, 12)), font, 0.55, colour, 2)
    _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
    return buf.tobytes()


def checkpoint_label_for(ckpt: str) -> str:
    """Short human-readable label for a checkpoint path."""
    p = Path(ckpt)
    if not p.exists():
        return ckpt  # pretrained name like "yolo12n.pt"
    return p.stem  # e.g. "node-abc1" from ./keys/node-abc1.pt


# ── Public single-checkpoint API ──────────────────────────────────────────────

def detect(image_bytes: bytes, checkpoint: str = "", conf: float = 0.35) -> dict:
    """Run inference with *one* checkpoint; returns a DetectionResult dict."""
    yolo = _load(checkpoint)
    frame = _decode_image(image_bytes)
    result = _run_yolo(yolo, frame, conf, ckpt_label=checkpoint or "yolo12n.pt")
    result.pop("_yolo_results", None)
    return result


def detect_annotated(image_bytes: bytes, checkpoint: str = "", conf: float = 0.35) -> bytes:
    """Run inference and return an annotated JPEG."""
    yolo = _load(checkpoint)
    frame = _decode_image(image_bytes)
    yolo_results = yolo(frame, conf=conf, verbose=False)
    return _annotate_frame(frame.copy(), yolo_results)


# ── Public multi-checkpoint API ───────────────────────────────────────────────

def detect_multi(
    image_bytes: bytes,
    checkpoints: list[str],
    conf: float = 0.35,
) -> list[dict]:
    """Run the same image through each checkpoint.

    Returns a list of NodeDetectionResult dicts — one per checkpoint — in the
    same order as the input list.  Failures are recorded as entries with an
    ``error`` field so the caller always gets len(checkpoints) results.
    """
    frame_orig = _decode_image(image_bytes)
    results = []
    for ckpt in checkpoints:
        label = checkpoint_label_for(ckpt or "yolo12n.pt")
        try:
            yolo = _load(ckpt)
            result = _run_yolo(yolo, frame_orig.copy(), conf, ckpt_label=ckpt or "yolo12n.pt")
            result.pop("_yolo_results", None)
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
    ``annotated_jpeg_b64`` field.
    """
    import base64

    frame_orig = _decode_image(image_bytes)
    results = []
    for ckpt in checkpoints:
        label = checkpoint_label_for(ckpt or "yolo12n.pt")
        try:
            yolo = _load(ckpt)
            t0 = time.perf_counter()
            yolo_results = yolo(frame_orig.copy(), conf=conf, verbose=False)
            elapsed = (time.perf_counter() - t0) * 1000

            boxes = []
            person_count = 0
            for r in yolo_results:
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

            annotated_bytes = _annotate_frame(frame_orig.copy(), yolo_results)
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

def discover_checkpoints(extra_dirs: list[str] | None = None) -> list[dict]:
    """Scan well-known directories for BloomFL node `.pt` checkpoints.

    Always returns the pretrained ``yolo12n.pt`` baseline as the first entry.
    Returns a list of ``{label, path, exists, is_pretrained}`` dicts.
    """
    search_dirs: list[Path] = [Path("."), Path("./keys"), Path("./checkpoints")]
    if extra_dirs:
        search_dirs.extend(Path(d) for d in extra_dirs)

    try:
        from api.dependencies import get_config  # type: ignore[import]
        cfg = get_config()
        search_dirs.append(Path(getattr(cfg, "key_storage_dir", "./keys")))
        search_dirs.append(Path(getattr(cfg, "data_dir", "./data")))
    except Exception:  # noqa: BLE001
        pass

    # Pretrained baseline always first
    entries: list[dict] = [{
        "label": "yolo12n (pretrained)",
        "path": "yolo12n.pt",
        "exists": Path("yolo12n.pt").exists(),
        "is_pretrained": True,
    }]

    seen: set[str] = set()
    for d in search_dirs:
        if not d.exists():
            continue
        for pt_file in sorted(d.glob("*.pt")):
            key = str(pt_file.resolve())
            if key in seen:
                continue
            # Skip pretrained roots already listed
            if pt_file.name in ("yolo12n.pt", "yolo11n.pt", "yolov8n.pt") and d == Path("."):
                continue
            seen.add(key)
            entries.append({
                "label": pt_file.stem,
                "path": str(pt_file),
                "exists": True,
                "is_pretrained": False,
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
