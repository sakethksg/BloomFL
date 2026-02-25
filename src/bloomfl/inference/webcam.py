"""
BloomFL Webcam Person Detector
==============================

Real-time person detection from a webcam (or any video source) using a
YOLOv12-nano model whose weights may come from:

* The off-the-shelf pretrained COCO checkpoint (``yolo12n.pt``).
* A BloomFL gossip-trained checkpoint saved by
  :func:`bloomfl.models.yolo_person.save_checkpoint`.

Usage — library API
-------------------
::

    from bloomfl.inference.webcam import WebcamDetector

    with WebcamDetector(checkpoint="./my_node_ckpt.pt", conf=0.4) as det:
        det.run()          # blocks; press 'q' or Esc to quit

Usage — CLI (via ``python -m bloomfl webcam``)
----------------------------------------------
::

    python -m bloomfl webcam --help
    python -m bloomfl webcam --source 0 --conf 0.40 --checkpoint path/to/ckpt.pt
    python -m bloomfl webcam --source 0 --no-display --save webcam_out.mp4

Design notes
------------
* The **inference path** uses the high-level ``ultralytics.YOLO`` API which
  handles image preprocessing, NMS, and result parsing cleanly.
* The **overlay path** uses OpenCV (cv2) for zero-copy BGR frame manipulation
  and window display.
* When ``--no-display`` is set the code runs headlessly — useful on edge nodes
  without a monitor; combine with ``--save`` to record detections.
* FPS is computed with an exponential moving average for a stable readout.
* Persons are highlighted with a green bounding box and confidence score.
  All other COCO classes are drawn in grey so you can still see them but they
  are visually de-emphasised.
"""
from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# Colour constants (BGR)
_PERSON_COLOUR = (0, 220, 0)      # bright green — persons
_OTHER_COLOUR  = (120, 120, 120)  # grey — other COCO classes
_TEXT_COLOUR   = (255, 255, 255)  # white label text
_FPS_COLOUR    = (0, 200, 255)    # amber FPS counter

PERSON_CLASS_ID = 0               # COCO class-0 = "person"


def _load_yolo(checkpoint: Optional[str]) -> "ultralytics.YOLO":  # type: ignore[name-defined]
    """Load a YOLO model for inference.

    If ``checkpoint`` points to a BloomFL gossip-trained ``.pt`` file (i.e.
    it contains a ``state_dict`` key) the weights are injected into a freshly
    constructed ``yolo12n.yaml`` skeleton.  Otherwise the file is passed
    directly to ultralytics (which handles both ``.pt`` ultralytics checkpoints
    and ``.yaml`` configs).
    """
    from ultralytics import YOLO  # type: ignore[import]

    if checkpoint and Path(checkpoint).exists():
        ckpt = None
        try:
            import torch
            raw = torch.load(checkpoint, map_location="cpu", weights_only=True)
            if isinstance(raw, dict) and "state_dict" in raw:
                # BloomFL gossip checkpoint — load into fresh skeleton
                logger.info("Loading BloomFL gossip checkpoint: %s", checkpoint)
                yolo = YOLO("yolo12n.yaml")
                yolo.model.load_state_dict(raw["state_dict"], strict=False)
                meta = raw.get("metadata", {})
                if meta:
                    logger.info("Checkpoint metadata: %s", meta)
                return yolo
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not parse as BloomFL checkpoint (%s); trying direct load.", exc)

        # Might be a standard ultralytics .pt — let it handle
        try:
            yolo = YOLO(checkpoint)
            logger.info("Loaded ultralytics checkpoint: %s", checkpoint)
            return yolo
        except Exception as exc:  # noqa: BLE001
            logger.warning("Direct load of %s failed (%s); falling back to pretrained.", checkpoint, exc)

    # Default: pretrained yolo12n → yolo11n → yolov8n fallback chain
    for name in ("yolo12n.pt", "yolo11n.pt", "yolov8n.pt"):
        try:
            yolo = YOLO(name)
            logger.info("Using pretrained model: %s", name)
            return yolo
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not load %s: %s", name, exc)

    raise RuntimeError("No YOLO model could be loaded.")


def _draw_detections(
    frame: np.ndarray,
    result: "ultralytics.engine.results.Results",  # type: ignore[name-defined]
    show_all_classes: bool = True,
    person_only: bool = False,
) -> tuple[np.ndarray, int]:
    """Draw bounding boxes and labels onto ``frame`` in-place.

    Args:
        frame:           BGR uint8 image (modified in-place).
        result:          Single ultralytics ``Results`` object for this frame.
        show_all_classes: If True, draw non-person detections in grey.
        person_only:     If True, skip all non-person detections entirely.

    Returns:
        ``(frame, n_persons)`` — the annotated frame and person count.
    """
    n_persons = 0
    if result.boxes is None:
        return frame, n_persons

    boxes  = result.boxes.xyxy.cpu().numpy()   # (N, 4)  x1 y1 x2 y2
    confs  = result.boxes.conf.cpu().numpy()   # (N,)
    clsids = result.boxes.cls.cpu().numpy().astype(int)  # (N,)
    names  = result.names  # dict {id: name}

    for (x1, y1, x2, y2), conf, cls_id in zip(boxes, confs, clsids):
        is_person = cls_id == PERSON_CLASS_ID
        if person_only and not is_person:
            continue

        colour    = _PERSON_COLOUR if is_person else _OTHER_COLOUR
        thickness = 2 if is_person else 1
        n_persons += int(is_person)

        x1, y1, x2, y2 = int(x1), int(y1), int(x2), int(y2)
        cv2.rectangle(frame, (x1, y1), (x2, y2), colour, thickness)

        label = f"{'person' if is_person else names.get(cls_id, str(cls_id))} {conf:.2f}"
        (lw, lh), baseline = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 1)
        # Filled background for readability
        cv2.rectangle(
            frame,
            (x1, max(y1 - lh - baseline - 4, 0)),
            (x1 + lw + 4, max(y1, lh + baseline + 4)),
            colour,
            -1,
        )
        cv2.putText(
            frame, label,
            (x1 + 2, max(y1 - baseline - 2, lh + 2)),
            cv2.FONT_HERSHEY_SIMPLEX, 0.55, _TEXT_COLOUR, 1, cv2.LINE_AA,
        )

    return frame, n_persons


def _draw_hud(
    frame: np.ndarray,
    fps: float,
    n_persons: int,
    node_id: str = "",
) -> np.ndarray:
    """Overlay FPS counter, person count, and node identifier on top of frame."""
    h, w = frame.shape[:2]

    lines = [
        f"FPS: {fps:.1f}",
        f"Persons: {n_persons}",
    ]
    if node_id:
        lines.append(f"Node: {node_id}")

    for i, line in enumerate(lines):
        y = 28 + i * 26
        # Shadow for contrast on any background
        cv2.putText(
            frame, line, (11, y + 1),
            cv2.FONT_HERSHEY_SIMPLEX, 0.75, (0, 0, 0), 2, cv2.LINE_AA,
        )
        cv2.putText(
            frame, line, (10, y),
            cv2.FONT_HERSHEY_SIMPLEX, 0.75, _FPS_COLOUR, 2, cv2.LINE_AA,
        )
    return frame


class WebcamDetector:
    """Real-time person detector from a webcam or video file.

    Args:
        source:          OpenCV capture source.  ``0`` (or any int) = webcam
                         index; a file path string for a video file; an RTSP
                         URL for a network stream.
        checkpoint:      Optional path to a BloomFL or ultralytics ``.pt``
                         checkpoint.  Falls back to pretrained if not given.
        conf:            Minimum detection confidence threshold.
        img_size:        Inference image size (shorter side resized to this).
        device:          Torch device string: ``"cpu"``, ``"cuda"``, ``"mps"``.
        show_display:    If True open an OpenCV window with the live feed.
        save_path:       If set, write annotated frames to this video file.
        person_only:     If True skip all non-person detections in the overlay.
        node_id:         Optional node identifier shown in the HUD.
        fps_smoothing:   EMA coefficient for FPS display smoothing.
    """

    def __init__(
        self,
        source: int | str = 0,
        checkpoint: Optional[str] = None,
        conf: float = 0.35,
        img_size: int = 320,
        device: str = "cpu",
        show_display: bool = True,
        save_path: Optional[str] = None,
        person_only: bool = False,
        node_id: str = "bloomfl-node",
        fps_smoothing: float = 0.9,
    ) -> None:
        self.source       = source
        self.conf         = conf
        self.img_size     = img_size
        self.device       = device
        self.show_display = show_display
        self.save_path    = save_path
        self.person_only  = person_only
        self.node_id      = node_id
        self._fps_alpha   = fps_smoothing

        logger.info("Loading YOLO model (checkpoint=%s, device=%s)", checkpoint, device)
        self._yolo = _load_yolo(checkpoint)

        self._cap: Optional[cv2.VideoCapture] = None
        self._writer: Optional[cv2.VideoWriter] = None

    # ── Context manager ────────────────────────────────────────────────────────

    def __enter__(self) -> "WebcamDetector":
        self.open()
        return self

    def __exit__(self, *_) -> None:
        self.close()

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def open(self) -> None:
        """Open the capture device and (optionally) the output writer."""
        logger.info("Opening capture source: %s", self.source)
        self._cap = cv2.VideoCapture(self.source)
        if not self._cap.isOpened():
            raise RuntimeError(
                f"Cannot open capture source '{self.source}'.  "
                "Check that the webcam is plugged in and not in use by another app."
            )

        # Read frame dimensions from the capture (may differ from img_size)
        w = int(self._cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(self._cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        src_fps = self._cap.get(cv2.CAP_PROP_FPS) or 30.0
        logger.info("Capture: %dx%d @ %.1f fps", w, h, src_fps)

        if self.save_path:
            fourcc = cv2.VideoWriter_fourcc(*"mp4v")
            Path(self.save_path).parent.mkdir(parents=True, exist_ok=True)
            self._writer = cv2.VideoWriter(self.save_path, fourcc, src_fps, (w, h))
            logger.info("Saving annotated output to: %s", self.save_path)

    def close(self) -> None:
        """Release the capture device and flush the output writer."""
        if self._cap is not None:
            self._cap.release()
            self._cap = None
        if self._writer is not None:
            self._writer.release()
            self._writer = None
        if self.show_display:
            cv2.destroyAllWindows()
        logger.info("WebcamDetector closed.")

    # ── Main loop ─────────────────────────────────────────────────────────────

    def run(self) -> None:
        """Capture → detect → annotate → display loop.

        The loop runs until:
        * The user presses **q** or **Escape**.
        * The capture source is exhausted (video file ended).
        * :meth:`stop` is called from another thread.
        """
        if self._cap is None or not self._cap.isOpened():
            raise RuntimeError("Call open() or use as a context manager first.")

        self._running = True
        fps_ema: float = 0.0
        t_prev = time.perf_counter()

        window_name = "BloomFL — Person Detection (q / Esc to quit)"
        if self.show_display:
            cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)

        logger.info("Detection loop started. Press 'q' or Esc to stop.")

        try:
            while self._running:
                ret, frame = self._cap.read()
                if not ret:
                    logger.info("End of capture stream.")
                    break

                # ── Inference ─────────────────────────────────────────────────
                # Pass BGR frame directly — ultralytics handles BGR→RGB internally
                results = self._yolo.predict(
                    frame,
                    conf=self.conf,
                    imgsz=self.img_size,
                    device=self.device,
                    verbose=False,
                    stream=False,
                )
                result = results[0]  # single frame batch

                # ── Annotation ────────────────────────────────────────────────
                frame, n_persons = _draw_detections(
                    frame, result, person_only=self.person_only
                )

                # ── FPS ───────────────────────────────────────────────────────
                t_now = time.perf_counter()
                inst_fps = 1.0 / max(t_now - t_prev, 1e-6)
                fps_ema = (
                    inst_fps if fps_ema == 0.0
                    else self._fps_alpha * fps_ema + (1 - self._fps_alpha) * inst_fps
                )
                t_prev = t_now

                frame = _draw_hud(frame, fps_ema, n_persons, self.node_id)

                # ── Output ────────────────────────────────────────────────────
                if self._writer is not None:
                    self._writer.write(frame)

                if self.show_display:
                    cv2.imshow(window_name, frame)
                    key = cv2.waitKey(1) & 0xFF
                    if key in (ord("q"), ord("Q"), 27):  # q or Esc
                        logger.info("User quit.")
                        break
                else:
                    # Headless: log every ~30 frames
                    if int(t_now * 30) % 30 == 0:
                        logger.info(
                            "fps=%.1f  persons=%d", fps_ema, n_persons
                        )

        finally:
            self._running = False

    def stop(self) -> None:
        """Signal the run loop to stop (thread-safe)."""
        self._running = False

    # ── Convenience: detect a single frame ────────────────────────────────────

    def detect_frame(self, frame: np.ndarray) -> tuple[np.ndarray, int, list[dict]]:
        """Run detection on a single BGR numpy frame.

        This is useful when you want to integrate detection into your own
        capture loop rather than using :meth:`run`.

        Args:
            frame: BGR uint8 image from ``cv2.VideoCapture.read()``.

        Returns:
            ``(annotated_frame, n_persons, detections)`` where ``detections``
            is a list of dicts with keys ``x1, y1, x2, y2, conf, class_id,
            class_name``.
        """
        results = self._yolo.predict(
            frame,
            conf=self.conf,
            imgsz=self.img_size,
            device=self.device,
            verbose=False,
        )
        result = results[0]
        annotated, n_persons = _draw_detections(
            frame.copy(), result, person_only=self.person_only
        )

        detections: list[dict] = []
        if result.boxes is not None:
            boxes  = result.boxes.xyxy.cpu().numpy()
            confs  = result.boxes.conf.cpu().numpy()
            clsids = result.boxes.cls.cpu().numpy().astype(int)
            for (x1, y1, x2, y2), c, cid in zip(boxes, confs, clsids):
                detections.append(
                    {
                        "x1": float(x1), "y1": float(y1),
                        "x2": float(x2), "y2": float(y2),
                        "conf": float(c),
                        "class_id": int(cid),
                        "class_name": result.names.get(int(cid), str(cid)),
                    }
                )
        return annotated, n_persons, detections


# ── Module-level convenience function ─────────────────────────────────────────

def run_webcam(
    source: int | str = 0,
    checkpoint: Optional[str] = None,
    conf: float = 0.35,
    img_size: int = 320,
    device: str = "cpu",
    show_display: bool = True,
    save_path: Optional[str] = None,
    person_only: bool = False,
    node_id: str = "bloomfl-node",
) -> None:
    """One-call entry point for webcam person detection.

    Args:
        source:       Webcam index (int) or video file / RTSP URL (str).
        checkpoint:   Optional path to a BloomFL or ultralytics ``.pt`` file.
        conf:         Minimum confidence threshold (0–1).
        img_size:     Inference resolution (shorter side).
        device:       Torch device (``"cpu"``, ``"cuda"``, ``"mps"``).
        show_display: Show live OpenCV window (disable on headless servers).
        save_path:    Write annotated output here (e.g. ``"out.mp4"``).
        person_only:  Show only person detections in overlay.
        node_id:      Node identifier shown in HUD.
    """
    with WebcamDetector(
        source=source,
        checkpoint=checkpoint,
        conf=conf,
        img_size=img_size,
        device=device,
        show_display=show_display,
        save_path=save_path,
        person_only=person_only,
        node_id=node_id,
    ) as det:
        det.run()
