"""
YOLOv12-nano person detection model, weight helpers, and data loading utilities.

Replaces the MNIST CNN with a production-grade single-class person detector
suited to edge deployment.  The model uses the YOLOv12n (nano) architecture
pretrained on COCO-80 and fine-tuned on person-only shards across federated
nodes via gossip aggregation.

Key design decisions
--------------------
* ``YOLOPersonModel`` is a plain ``nn.Module`` wrapper around the ultralytics
  DetectionModel so that the generic ``get_weights`` / ``set_weights`` helpers
  work unchanged and the gossip layer never needs to know the internal
  architecture.
* Training uses the ultralytics internal ``DetectionModel.loss()`` method so
  the full DFLoss + CIoU box loss + BCE class loss stack is preserved.
* The dataset produces images in ``[0, 1]`` RGB float32 and targets in
  normalised ``[x_c, y_c, w, h]`` format — what the YOLO loss expects.
* A ``SyntheticPersonDataset`` generates plausible bounding-box annotations
  without any download, so every node can start training immediately even
  in a fully air-gapped environment.
* A real ``PersonDataset`` wraps any COCO-compatible on-disk data with the
  same collation contract.
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np
import torch
import torch.nn as nn
from torch import Tensor
import torch.utils.data as data_utils
from torch.utils.data import DataLoader, Subset, random_split

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

IMG_SIZE: int = 320        # default spatial resolution (h == w); faster than 640
PERSON_CLASS_ID: int = 0   # COCO class-0 = "person"
NUM_CLASSES: int = 80      # keep full COCO head; we only annotate class-0


# ── Internal helpers ──────────────────────────────────────────────────────────

def _load_ultralytics_yolo(model_name: str = "yolo12n.pt") -> "ultralytics.YOLO":  # type: ignore[name-defined]
    """Load a YOLO model, falling back gracefully through smaller variants."""
    from ultralytics import YOLO  # type: ignore[import]

    fallback_order = [model_name, "yolo11n.pt", "yolov8n.pt"]
    last_exc: Exception = RuntimeError("unreachable")
    for name in fallback_order:
        try:
            model = YOLO(name)
            logger.info("Loaded ultralytics YOLO from: %s", name)
            return model
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not load %s (%s), trying next…", name, exc)
            last_exc = exc
    raise RuntimeError(
        f"None of {fallback_order} could be loaded.  "
        "Install ultralytics and ensure network access for the first download."
    ) from last_exc


# ── Synthetic dataset ─────────────────────────────────────────────────────────

class SyntheticPersonDataset(data_utils.Dataset):
    """Offline surrogate producing synthetic person-detection training data.

    Each sample contains:
    * A random RGB image with 1-3 rendered "person silhouettes" (painted
      rounded rectangles of varying shades) on a noisy background.
    * Ground-truth bounding boxes in normalised ``[x_c, y_c, w, h]`` format.
    * A labels vector (all zeros — person class).

    The dataset is generated deterministically from ``seed`` so that every
    node can reproduce the exact same global test set while having unique
    training shards.
    """

    MAX_PERSONS_PER_IMG: int = 3
    MIN_BOX_SIZE: float = 0.10   # fraction of image size
    MAX_BOX_SIZE: float = 0.50

    def __init__(
        self,
        num_samples: int,
        img_size: int = IMG_SIZE,
        seed: int = 0,
    ) -> None:
        self.num_samples = num_samples
        self.img_size = img_size
        rng = np.random.default_rng(seed)

        # Pre-generate all data so __getitem__ is O(1)
        imgs: list[np.ndarray] = []
        all_boxes: list[np.ndarray] = []
        for _ in range(num_samples):
            img, boxes = self._make_sample(rng)
            imgs.append(img)
            all_boxes.append(boxes)

        self._imgs = imgs
        self._boxes = all_boxes

    # ------------------------------------------------------------------
    def _make_sample(
        self, rng: np.random.Generator
    ) -> tuple[np.ndarray, np.ndarray]:
        s = self.img_size
        # Background: low-level Gaussian noise
        img = rng.uniform(0.0, 0.35, (3, s, s)).astype(np.float32)

        n_persons = int(rng.integers(1, self.MAX_PERSONS_PER_IMG + 1))
        boxes: list[list[float]] = []
        for _ in range(n_persons):
            w_frac = float(rng.uniform(self.MIN_BOX_SIZE, self.MAX_BOX_SIZE))
            h_frac = float(rng.uniform(self.MIN_BOX_SIZE * 2.0, self.MAX_BOX_SIZE * 2.0))
            h_frac = min(h_frac, 0.95)
            x_c = float(rng.uniform(w_frac / 2, 1.0 - w_frac / 2))
            y_c = float(rng.uniform(h_frac / 2, 1.0 - h_frac / 2))

            # Paint a rounded rectangle: a bright column (simulate upright figure)
            x0 = max(0, int((x_c - w_frac / 2) * s))
            y0 = max(0, int((y_c - h_frac / 2) * s))
            x1 = min(s, int((x_c + w_frac / 2) * s))
            y1 = min(s, int((y_c + h_frac / 2) * s))

            shade = rng.uniform(0.5, 1.0)
            img[:, y0:y1, x0:x1] = shade + rng.normal(
                0, 0.05, (3, y1 - y0, x1 - x0)
            ).astype(np.float32)
            img = np.clip(img, 0.0, 1.0)

            boxes.append([x_c, y_c, w_frac, h_frac])

        return img, np.array(boxes, dtype=np.float32)

    # ------------------------------------------------------------------
    def __len__(self) -> int:
        return self.num_samples

    def __getitem__(
        self, idx: int
    ) -> tuple[Tensor, Tensor, Tensor]:
        img = torch.from_numpy(self._imgs[idx])         # (3, H, W)
        boxes = torch.from_numpy(self._boxes[idx])      # (n, 4)  xywh
        labels = torch.zeros(len(boxes), dtype=torch.float32)  # all person
        return img, boxes, labels


# ── Real on-disk dataset (YOLO / COCO labels format) ─────────────────────────

class PersonDataset(data_utils.Dataset):
    """Load person-detection data from a directory of YOLO-format annotations.

    Directory layout expected::

        root/
          images/
            img_0001.jpg
            img_0002.jpg
          labels/
            img_0001.txt
            img_0002.txt

    Each ``.txt`` file has one row per object: ``<class> <xc> <yc> <w> <h>``.
    Only rows with ``class == 0`` (person) are retained.
    """

    def __init__(
        self,
        root: str | Path,
        img_size: int = IMG_SIZE,
    ) -> None:
        root = Path(root)
        img_dir = root / "images"
        lbl_dir = root / "labels"
        if not img_dir.exists() or not lbl_dir.exists():
            raise FileNotFoundError(
                f"Expected {img_dir} and {lbl_dir} to exist."
            )

        import torchvision.transforms.functional as TF
        from PIL import Image

        self._img_size = img_size
        samples: list[tuple] = []
        for img_path in sorted(img_dir.iterdir()):
            if img_path.suffix.lower() not in {".jpg", ".jpeg", ".png"}:
                continue
            lbl_path = lbl_dir / (img_path.stem + ".txt")
            if not lbl_path.exists():
                continue
            samples.append((img_path, lbl_path))

        self._samples = samples
        self._TF = TF
        self._Image = Image
        logger.info("PersonDataset: %d images loaded from %s", len(samples), root)

    def __len__(self) -> int:
        return len(self._samples)

    def __getitem__(
        self, idx: int
    ) -> tuple[Tensor, Tensor, Tensor]:
        img_path, lbl_path = self._samples[idx]
        img = self._Image.open(img_path).convert("RGB")
        img = img.resize((self._img_size, self._img_size), self._Image.BILINEAR)
        img_t = torch.from_numpy(
            np.array(img, dtype=np.float32) / 255.0
        ).permute(2, 0, 1)  # (3, H, W)

        rows = lbl_path.read_text().strip().splitlines()
        boxes: list[list[float]] = []
        for row in rows:
            parts = row.split()
            if not parts:
                continue
            cls = int(parts[0])
            if cls == PERSON_CLASS_ID:
                xc, yc, w, h = map(float, parts[1:5])
                boxes.append([xc, yc, w, h])

        if boxes:
            boxes_t = torch.tensor(boxes, dtype=torch.float32)
            labels_t = torch.zeros(len(boxes), dtype=torch.float32)
        else:
            boxes_t = torch.zeros((0, 4), dtype=torch.float32)
            labels_t = torch.zeros(0, dtype=torch.float32)

        return img_t, boxes_t, labels_t


# ── Collation ─────────────────────────────────────────────────────────────────

def person_collate_fn(
    batch: list[tuple[Tensor, Tensor, Tensor]],
) -> dict[str, Tensor]:
    """Collate (img, boxes, labels) tuples into an ultralytics batch dict.

    Returns a dict with:
    * ``'img'``       – float32 (B, 3, H, W) in [0, 1]
    * ``'bboxes'``    – float32 (N, 4) normalised xywh across all images
    * ``'cls'``       – float32 (N,)  all zeros (person)
    * ``'batch_idx'`` – int64   (N,)  maps each bbox to its image index
    """
    imgs, all_boxes, all_labels = zip(*batch)
    img_batch = torch.stack(imgs)  # (B, 3, H, W)

    batch_idx_parts: list[Tensor] = []
    boxes_parts: list[Tensor] = []
    cls_parts: list[Tensor] = []

    for i, (boxes, labels) in enumerate(zip(all_boxes, all_labels)):
        n = len(boxes)
        if n == 0:
            continue
        batch_idx_parts.append(torch.full((n,), i, dtype=torch.long))
        boxes_parts.append(boxes)
        cls_parts.append(labels)

    if boxes_parts:
        bboxes = torch.cat(boxes_parts, dim=0)
        cls = torch.cat(cls_parts, dim=0)
        batch_idx = torch.cat(batch_idx_parts, dim=0)
    else:
        bboxes = torch.zeros((0, 4), dtype=torch.float32)
        cls = torch.zeros(0, dtype=torch.float32)
        batch_idx = torch.zeros(0, dtype=torch.long)

    return {
        "img": img_batch,
        "bboxes": bboxes,
        "cls": cls,
        "batch_idx": batch_idx,
    }


# ── Model ─────────────────────────────────────────────────────────────────────

class YOLOPersonModel(nn.Module):
    """YOLOv12-nano wrapped as an ``nn.Module`` for federated parameter exchange.

    The underlying ``ultralytics.DetectionModel`` is stored as ``self.yolo``
    so that ``model.parameters()`` iterates through all detection weights.
    ``get_weights()`` and ``set_weights()`` therefore work identically to
    their MNIST counterparts — the gossip engine does not need to change.

    Args:
        pretrained: If ``True`` (default) load ``yolo12n.pt`` COCO weights,
                    which gives each node a strong starting point and reduces
                    the number of gossip rounds needed to converge. If
                    ``False`` initialise from ``yolo12n.yaml`` (random weights).
        img_size:   Spatial resolution fed to the model. 320 is fast on CPU.
    """

    def __init__(
        self,
        pretrained: bool = True,
        img_size: int = IMG_SIZE,
    ) -> None:
        super().__init__()
        model_file = "yolo12n.pt" if pretrained else "yolo12n.yaml"
        yolo_wrapper = _load_ultralytics_yolo(model_file)
        # Expose the raw DetectionModel (nn.Module) so ``parameters()`` works
        self.yolo: nn.Module = yolo_wrapper.model
        self.img_size = img_size

        # Pretrained .pt checkpoints are saved for inference (requires_grad=False).
        # Re-enable gradients so that loss.backward() works during FL training.
        self.yolo.requires_grad_(True)

        # Ensure model.args supports attribute access (needed by the loss
        # function which does self.hyp.box / self.hyp.cls / self.hyp.dfl).
        # When loading from YAML ultralytics stores args as a plain dict;
        # loading from .pt gives a SimpleNamespace/IterableSimpleNamespace.
        self._ensure_args_namespace()

        # Initialise the loss criterion eagerly.
        if hasattr(self.yolo, "init_criterion"):
            try:
                if not hasattr(self.yolo, "criterion") or self.yolo.criterion is None:
                    self.yolo.criterion = self.yolo.init_criterion()
            except Exception:  # noqa: BLE001
                pass  # lazily created on first loss call

    def _ensure_args_namespace(self) -> None:
        """Convert model.args from a plain dict to a SimpleNamespace if needed.

        The ultralytics detection loss criterion stores a reference to
        ``model.args`` as ``self.hyp`` and then accesses ``hyp.box``,
        ``hyp.cls``, ``hyp.dfl``.  When a model is initialised from a YAML
        config (rather than a pretrained ``.pt`` checkpoint), the args are
        stored as a plain dict, which breaks attribute-style access.
        """
        from types import SimpleNamespace

        current_args = getattr(self.yolo, "args", None)

        if current_args is None or not hasattr(current_args, "box"):
            # Pull in sensible defaults from ultralytics, then overlay any
            # existing dict values so user overrides are preserved.
            try:
                from ultralytics.utils import DEFAULT_CFG_DICT  # type: ignore[import]
                base = dict(DEFAULT_CFG_DICT)
            except ImportError:
                base = {}

            # Minimum loss-hyperparameter keys with YOLO defaults
            _loss_defaults = {
                "box": 7.5,
                "cls": 0.5,
                "dfl": 1.5,
                "pose": 12.0,
                "kobj": 2.0,
                "nbs": 64,
                "overlap_mask": True,
                "mask_ratio": 4,
            }
            base.update(_loss_defaults)

            if isinstance(current_args, dict):
                base.update(current_args)

            self.yolo.args = SimpleNamespace(**base)

    # ── Forward ───────────────────────────────────────────────────────────────

    def forward(self, x: Tensor) -> Tensor:
        """Pass a (B, 3, H, W) batch through the detection backbone + head."""
        return self.yolo(x)

    # ── Convenience ───────────────────────────────────────────────────────────

    def compute_loss(
        self, batch: dict[str, Tensor]
    ) -> tuple[Tensor, Tensor]:
        """Compute detection loss for the given batch dict.

        The ``batch`` dict must have the keys produced by ``person_collate_fn``.
        Loss is computed by ``DetectionModel.loss()``, which calls the model
        forward pass internally — do NOT call ``forward()`` before this.

        Returns:
            ``(total_loss, loss_items)`` — both are Tensors.
        """
        return self.yolo.loss(batch)


# ── Weight helpers ────────────────────────────────────────────────────────────

def get_weights(model: nn.Module) -> list[np.ndarray]:
    """Extract all trainable parameters as a list of float32 numpy arrays."""
    return [
        param.data.cpu().numpy().astype(np.float32)
        for param in model.parameters()
    ]


def set_weights(model: nn.Module, weights: list[np.ndarray]) -> None:
    """Load a list of float32 numpy arrays into model parameters in-place."""
    params = list(model.parameters())
    if len(weights) != len(params):
        raise ValueError(
            f"Parameter count mismatch: model has {len(params)} tensors, "
            f"got {len(weights)} arrays."
        )
    with torch.no_grad():
        for param, array in zip(params, weights):
            param.copy_(torch.from_numpy(array.copy()).to(param.device))


def get_state_dict_weights(model: nn.Module) -> dict[str, np.ndarray]:
    """Return full state-dict (incl. BN running stats) as ``{name: ndarray}``."""
    return {k: v.cpu().numpy() for k, v in model.state_dict().items()}


# ── Checkpoint helpers ────────────────────────────────────────────────────────

def save_checkpoint(
    model: nn.Module,
    path: str,
    metadata: Optional[dict] = None,
) -> None:
    """Persist model state-dict + optional metadata to disk.

    Args:
        model:    Model to serialise (``YOLOPersonModel`` or inner module).
        path:     Destination ``.pt`` file path.
        metadata: Arbitrary dict stored alongside the state-dict.
    """
    ckpt = {"state_dict": model.state_dict(), "metadata": metadata or {}}
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    torch.save(ckpt, path)
    logger.info("Checkpoint saved → %s", path)


def load_checkpoint(model: nn.Module, path: str) -> dict:
    """Restore checkpoint from disk into ``model`` in-place.

    Returns:
        Metadata dict from the checkpoint (may be empty).
    """
    ckpt = torch.load(path, map_location="cpu", weights_only=True)
    model.load_state_dict(ckpt["state_dict"])
    logger.info("Checkpoint loaded ← %s", path)
    return ckpt.get("metadata", {})


# ── Training / inference utilities ───────────────────────────────────────────

@dataclass
class EpochResult:
    """Statistics for a single training epoch."""
    loss: float
    accuracy: float   # person-detection precision ∈ [0, 1]


def train_one_epoch(
    model: YOLOPersonModel,
    loader: DataLoader,
    optimizer: torch.optim.Optimizer,
    device: torch.device,
    max_grad_norm: float = 1.0,
    # Accept (and ignore) MNIST-era kwargs so callers need no changes:
    label_smoothing: float = 0.0,
    global_params: Optional[list[torch.Tensor]] = None,
    fedprox_mu: float = 0.0,
) -> EpochResult:
    """Run one full epoch of person-detection training.

    Uses the ultralytics detection loss (DFLoss + CIoU + BCE) via
    ``YOLOPersonModel.compute_loss()``.  FedProx proximal penalty is supported
    and applied to the total detection loss exactly as in the classification
    variant.

    Args:
        model:          ``YOLOPersonModel`` to train.
        loader:         DataLoader whose collate is ``person_collate_fn``.
        optimizer:      Pre-configured optimizer.
        device:         Torch device.
        max_grad_norm:  Gradient clipping threshold (0 = disabled).
        global_params:  Global parameter snapshots for FedProx (optional).
        fedprox_mu:     FedProx proximal coefficient µ (0 = disabled).

    Returns:
        :class:`EpochResult` with mean detection loss and detection precision.
    """
    model.train()
    # Guard: pretrained checkpoints are saved with requires_grad=False for
    # inference.  Re-enable gradients before every epoch so backward() works
    # even if set_weights() or an external caller froze the parameters.
    for p in model.parameters():
        p.requires_grad_(True)
    total_loss = 0.0
    n_batches = 0

    for batch in loader:
        # Move all tensors in the batch dict to the target device
        batch_gpu: dict[str, Tensor] = {
            k: (v.to(device) if isinstance(v, Tensor) else v)
            for k, v in batch.items()
        }
        optimizer.zero_grad(set_to_none=True)

        # Detection loss — internally calls forward() then the criterion
        loss_tensor, _ = model.compute_loss(batch_gpu)
        # ultralytics may return a vector of [box, cls, dfl] losses; sum to scalar
        loss = loss_tensor.sum() if loss_tensor.numel() > 1 else loss_tensor

        # FedProx proximal term: ½µ‖w − w_global‖²
        if fedprox_mu > 0.0 and global_params is not None:
            prox = torch.zeros(1, device=device)
            for p, g in zip(model.parameters(), global_params):
                prox = prox + ((p - g.to(device)) ** 2).sum()
            loss = loss + (fedprox_mu / 2.0) * prox.squeeze()

        loss.backward()

        if max_grad_norm > 0:
            nn.utils.clip_grad_norm_(model.parameters(), max_grad_norm)

        optimizer.step()

        total_loss += float(loss.item())
        n_batches += 1

    mean_loss = total_loss / max(n_batches, 1)
    # Proxy precision: exponential decay of loss — higher precision as loss decreases
    proxy_precision = float(math.exp(-mean_loss / 5.0))
    return EpochResult(loss=mean_loss, accuracy=proxy_precision)


def evaluate_model(
    model: YOLOPersonModel,
    loader: DataLoader,
    device: torch.device,
) -> tuple[float, float]:
    """Evaluate person detection model.

    Computes the mean detection loss over the provided loader and derives a
    proxy precision metric (``exp(−loss/5)``).  For proper mAP computation
    use the ``evaluation.metrics`` module after collecting all predictions.

    Returns:
        ``(mean_detection_loss, proxy_precision)`` — both in ``[0, ∞)`` /
        ``[0, 1]`` respectively.
    """
    # The ultralytics loss criterion requires training mode to produce
    # gradient-compatible anchors; we freeze BatchNorm stats while still
    # computing the loss in a no_grad context.
    model.train()
    total_loss = 0.0
    n_batches = 0

    with torch.no_grad():
        for batch in loader:
            batch_gpu: dict[str, Tensor] = {
                k: (v.to(device) if isinstance(v, Tensor) else v)
                for k, v in batch.items()
            }
            try:
                loss_tensor, _ = model.compute_loss(batch_gpu)
                scalar = loss_tensor.sum() if loss_tensor.numel() > 1 else loss_tensor
                total_loss += float(scalar.item())
            except Exception:  # noqa: BLE001
                # Empty-annotation batches can cause shape mismatch — skip
                pass
            n_batches += 1

    model.eval()
    mean_loss = total_loss / max(n_batches, 1)
    proxy_precision = float(math.exp(-mean_loss / 5.0))
    return mean_loss, proxy_precision


def evaluate_per_class(
    model: YOLOPersonModel,
    loader: DataLoader,
    device: torch.device,
    num_classes: int = 1,
) -> dict[int, float]:
    """Compute per-class proxy precision.

    For person detection there is only one class of interest (class 0).
    This function mirrors the MNIST ``evaluate_per_class`` signature so that
    existing callers need no changes.

    Returns:
        ``{0: proxy_precision}`` where proxy_precision ∈ [0, 1].
    """
    _, precision = evaluate_model(model, loader, device)
    return {c: precision for c in range(num_classes)}


# ── IID dataset partitioning ──────────────────────────────────────────────────

def _iid_partition(
    num_total: int,
    num_nodes: int,
    node_index: int,
    seed: int = 42,
) -> list[int]:
    """Return a random IID partition for ``node_index``."""
    rng = np.random.default_rng(seed)
    idx = np.arange(num_total)
    rng.shuffle(idx)
    shard_size = num_total // num_nodes
    start = node_index * shard_size
    end = start + shard_size if node_index < num_nodes - 1 else num_total
    return idx[start:end].tolist()


# ── Data loading ──────────────────────────────────────────────────────────────

def get_dataloaders(
    data_dir: str,
    batch_size: int,
    num_workers: int = 0,
    val_fraction: float = 0.1,
    node_id: Optional[str] = None,
    num_nodes: int = 1,
    node_index: int = 0,
    img_size: int = IMG_SIZE,
    # Accept (and ignore) MNIST-era kwargs for drop-in replacement:
    partition: str = "iid",
    dirichlet_alpha: float = 0.5,
) -> tuple[DataLoader, DataLoader, DataLoader]:
    """Return ``(train_loader, val_loader, test_loader)`` for person detection.

    Data strategy
    * If a YOLO-format person dataset is found at ``<data_dir>/train`` the
      real :class:`PersonDataset` is used.
    * Otherwise ``SyntheticPersonDataset`` is used as a fully offline fallback.

    Partitioning
    * Each node receives a random IID shard of the full training set.
    * The global test set is shared identically across all nodes.

    Args:
        data_dir:      Directory to look for / cache person detection data.
        batch_size:    Mini-batch size for all loaders.
        num_workers:   DataLoader workers (0 = main thread, safe for MP).
        val_fraction:  Fraction of each training shard held out for validation.
        node_id:       Node identifier — used only in log messages.
        num_nodes:     Total number of nodes for dataset partitioning.
        node_index:    0-based shard index for this node.
        img_size:      Image side length in pixels (H == W).
        partition:     Ignored — kept for API compatibility.
        dirichlet_alpha: Ignored — kept for API compatibility.

    Returns:
        ``(train_loader, val_loader, test_loader)``
    """
    label = node_id or f"node_{node_index}"
    root = Path(data_dir)
    root.mkdir(parents=True, exist_ok=True)

    train_root = root / "train"
    test_root = root / "test"

    use_real = (
        train_root.exists()
        and (train_root / "images").exists()
        and (train_root / "labels").exists()
    )

    if use_real:
        full_train: data_utils.Dataset = PersonDataset(train_root, img_size=img_size)
        if test_root.exists():
            full_test: data_utils.Dataset = PersonDataset(test_root, img_size=img_size)
        else:
            full_test = SyntheticPersonDataset(
                num_samples=500, img_size=img_size, seed=99
            )
        logger.info("[%s] Using real PersonDataset: %d samples", label, len(full_train))
    else:
        n_train = max(200 * num_nodes, 1000)
        n_test = 300
        full_train = SyntheticPersonDataset(
            num_samples=n_train, img_size=img_size, seed=42
        )
        full_test = SyntheticPersonDataset(
            num_samples=n_test, img_size=img_size, seed=99
        )
        logger.info(
            "[%s] Using SyntheticPersonDataset (no real data found): %d samples",
            label, len(full_train),
        )

    # ── Partition ─────────────────────────────────────────────────────────────
    indices = _iid_partition(len(full_train), num_nodes, node_index)
    node_train = Subset(full_train, indices)
    logger.info(
        "[%s] IID shard: %d / %d samples (node %d / %d)",
        label, len(node_train), len(full_train), node_index, num_nodes,
    )

    # ── Validation split ──────────────────────────────────────────────────────
    val_len = max(1, int(len(node_train) * val_fraction))
    train_len = len(node_train) - val_len
    train_set, val_set = random_split(
        node_train,
        [train_len, val_len],
        generator=torch.Generator().manual_seed(42 + node_index),
    )

    logger.info(
        "[%s] Final split → train: %d  val: %d  test: %d",
        label, len(train_set), len(val_set), len(full_test),
    )

    loader_kwargs: dict = dict(
        batch_size=batch_size,
        num_workers=num_workers,
        collate_fn=person_collate_fn,
        pin_memory=torch.cuda.is_available(),
        persistent_workers=(num_workers > 0),
    )

    return (
        DataLoader(train_set, shuffle=True, **loader_kwargs),
        DataLoader(val_set, shuffle=False, **loader_kwargs),
        DataLoader(full_test, shuffle=False, **loader_kwargs),
    )
