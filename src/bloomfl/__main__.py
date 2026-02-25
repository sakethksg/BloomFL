"""
BloomFL entry point.

Commands
--------
python -m bloomfl node       — start a gossip federated learning node
python -m bloomfl webcam     — real-time person detection from webcam / video
"""
from __future__ import annotations

import logging
import os
import sys

import click
from rich.logging import RichHandler

from bloomfl.config import Config, reset_config


def _setup_logging(level: str = "INFO") -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(message)s",
        datefmt="[%X]",
        handlers=[RichHandler(rich_tracebacks=True)],
    )


@click.group()
def main() -> None:
    """BloomFL — Decentralised Federated Learning on Edge Devices."""


# ── node subcommand ───────────────────────────────────────────────────────────

@main.command("node")
@click.option("--node-id", default="", help="Node identifier (auto-generated if empty).")
@click.option("--port", default=50051, help="Port to listen on.", show_default=True)
@click.option("--transport", default="tcp", type=click.Choice(["tcp", "grpc"]), show_default=True)
@click.option("--log-level", default="INFO", show_default=True)
@click.option("--num-nodes", default=1, help="Total nodes for dataset partitioning.", show_default=True)
@click.option("--node-index", default=0, help="0-based index of this node.", show_default=True)
def node_cmd(
    node_id: str,
    port: int,
    transport: str,
    log_level: str,
    num_nodes: int,
    node_index: int,
) -> None:
    """Start a BloomFL decentralised edge learning node."""
    from bloomfl.node.controller import NodeController

    _setup_logging(log_level)
    logger = logging.getLogger(__name__)

    if node_index >= num_nodes:
        logger.error(
            "--node-index (%d) must be less than --num-nodes (%d)", node_index, num_nodes
        )
        sys.exit(1)

    if node_id and not os.environ.get("BLOOMFL_NODE_ID"):
        os.environ["BLOOMFL_NODE_ID"] = node_id
    if not os.environ.get("BLOOMFL_LISTEN_PORT"):
        os.environ["BLOOMFL_LISTEN_PORT"] = str(port)
    if not os.environ.get("BLOOMFL_TRANSPORT"):
        os.environ["BLOOMFL_TRANSPORT"] = transport

    reset_config()
    config = Config()
    config.ensure_dirs()
    logger.info("Starting BloomFL node: %s", config.node_id)

    ctrl = NodeController(config=config, node_index=node_index, num_nodes=num_nodes)
    ctrl.start_and_run()


# ── webcam subcommand ─────────────────────────────────────────────────────────

@main.command("webcam")
@click.option(
    "--source", default="0",
    help="Capture source: webcam index (e.g. 0) or path to video file / RTSP URL.",
    show_default=True,
)
@click.option(
    "--checkpoint", default=None,
    help="Path to a BloomFL gossip-trained or ultralytics .pt checkpoint. "
         "If omitted the pretrained yolo12n COCO weights are used.",
)
@click.option(
    "--conf", default=0.35, type=float,
    help="Minimum detection confidence threshold (0–1).", show_default=True,
)
@click.option(
    "--img-size", default=320, type=int,
    help="Inference image size (shorter side, pixels).", show_default=True,
)
@click.option(
    "--device", default="cpu", type=click.Choice(["cpu", "cuda", "mps"]),
    help="Torch inference device.", show_default=True,
)
@click.option(
    "--no-display", is_flag=True, default=False,
    help="Disable the OpenCV display window (headless / server mode).",
)
@click.option(
    "--save", default=None, metavar="OUTPUT.mp4",
    help="Write annotated video to this file.",
)
@click.option(
    "--person-only", is_flag=True, default=False,
    help="Show only person detections; hide all other COCO classes.",
)
@click.option(
    "--node-id", default="bloomfl-node",
    help="Node identifier shown in the HUD overlay.", show_default=True,
)
@click.option("--log-level", default="INFO", show_default=True)
def webcam_cmd(
    source: str,
    checkpoint: str | None,
    conf: float,
    img_size: int,
    device: str,
    no_display: bool,
    save: str | None,
    person_only: bool,
    node_id: str,
    log_level: str,
) -> None:
    """Real-time person detection from webcam, video file, or RTSP stream.

    \b
    Examples
    --------
    # Default webcam (index 0), pretrained weights, live display
    python -m bloomfl webcam

    # Specific camera, gossip-trained checkpoint, confidence 0.45
    python -m bloomfl webcam --source 1 --checkpoint ./keys/node-0.pt --conf 0.45

    # Video file input, headless, save annotated output
    python -m bloomfl webcam --source video.mp4 --no-display --save out.mp4

    # RTSP network camera stream
    python -m bloomfl webcam --source rtsp://192.168.1.100:554/stream
    """
    from bloomfl.inference.webcam import run_webcam

    _setup_logging(log_level)

    # Convert source to int if it looks like a webcam index
    parsed_source: int | str = source
    try:
        parsed_source = int(source)
    except ValueError:
        pass   # keep as string path / URL

    run_webcam(
        source=parsed_source,
        checkpoint=checkpoint,
        conf=conf,
        img_size=img_size,
        device=device,
        show_display=not no_display,
        save_path=save,
        person_only=person_only,
        node_id=node_id,
    )


if __name__ == "__main__":
    main()
