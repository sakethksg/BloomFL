"""
MNIST CNN model, weight helpers, and data loading utilities.

Improvements over the baseline:
- BatchNorm after every conv layer for faster, more stable convergence.
- Kaiming He weight initialisation for ReLU networks.
- Training-time data augmentation (rotation + affine) for better generalisation.
- Non-IID data partitioning via Dirichlet distribution — mirrors real-world
  heterogeneous edge deployments.
- Gradient clipping in train_one_epoch to prevent exploding gradients.
- Label smoothing in CrossEntropyLoss for regularisation.
- Per-epoch training accuracy tracking.
- save_checkpoint / load_checkpoint helpers.
- evaluate_per_class for per-class accuracy breakdown.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch import Tensor
import torch.utils.data as data_utils
from torch.utils.data import DataLoader, Subset, random_split
from torchvision import datasets, transforms

logger = logging.getLogger(__name__)


# ── Synthetic offline dataset ─────────────────────────────────────────────────

class SyntheticMNISTDataset(data_utils.Dataset):
    """Offline surrogate with the same interface as torchvision MNIST.

    Each class *k* (0–9) has a distinctive prototype: a bright column at
    x = k × 2 + 4 (width 3 pixels, full height) against a dark background,
    plus per-sample Gaussian noise (σ=0.15).  This gives the CNN a learnable
    signal without downloading anything.

    The ``.targets`` property (LongTensor) mirrors the MNIST API so that
    Dirichlet partitioning and other helpers work without modification.
    """

    NUM_CLASSES: int = 10
    IMG_SIZE: int = 28

    def __init__(
        self,
        num_samples: int,
        transform=None,
        seed: int = 0,
    ) -> None:
        self.transform = transform
        self.num_samples = num_samples
        rng = np.random.default_rng(seed)

        # Assign balanced labels
        labels = np.tile(
            np.arange(self.NUM_CLASSES),
            int(np.ceil(num_samples / self.NUM_CLASSES)),
        )[:num_samples]
        rng.shuffle(labels)
        self.targets = torch.tensor(labels, dtype=torch.long)

        # Build prototype images (deterministic, per class)
        self._prototypes = np.zeros(
            (self.NUM_CLASSES, self.IMG_SIZE, self.IMG_SIZE), dtype=np.float32
        )
        for k in range(self.NUM_CLASSES):
            col = k * 2 + 4           # Column anchor (0-based)
            self._prototypes[k, :, max(0, col - 1): col + 2] = 1.0

        # Pre-generate all noise
        self._noise = rng.normal(0, 0.15, (num_samples, self.IMG_SIZE, self.IMG_SIZE)).astype(np.float32)

    # ------------------------------------------------------------------
    def __len__(self) -> int:
        return self.num_samples

    def __getitem__(self, idx: int):
        label = int(self.targets[idx])
        img = np.clip(self._prototypes[label] + self._noise[idx], 0.0, 1.0)
        # Convert to PIL-like float32 tensor [1, H, W] in [0,1]
        img_tensor = torch.from_numpy(img).unsqueeze(0)  # shape [1, 28, 28]
        if self.transform is not None:
            # transforms expect PIL; skip them and apply normalisation manually
            mean, std = 0.1307, 0.3081
            img_tensor = (img_tensor - mean) / std
        return img_tensor, label


# ── Architecture ──────────────────────────────────────────────────────────────

class MNISTModel(nn.Module):
    """MNIST CNN with BatchNorm after every conv layer.

    Architecture::

        Conv(1→32, k=5) → BN → ReLU → MaxPool(2)   [→ 32×12×12]
        Conv(32→64, k=5) → BN → ReLU → MaxPool(2)  [→ 64×4×4]
        FC(1024→512) → BN1d → ReLU → Dropout(0.5)
        FC(512→10)

    BatchNorm accelerates convergence, reduces sensitivity to LR and weight
    init, and acts as a regulariser — especially valuable with small local
    datasets at each edge node.
    """

    def __init__(self) -> None:
        super().__init__()
        # ── Conv block 1 ──────────────────────────────────────────────────────
        self.conv1 = nn.Conv2d(1, 32, kernel_size=5, padding=0)   # → 32×24×24
        self.bn1   = nn.BatchNorm2d(32)
        self.pool1 = nn.MaxPool2d(2, 2)                            # → 32×12×12
        # ── Conv block 2 ──────────────────────────────────────────────────────
        self.conv2 = nn.Conv2d(32, 64, kernel_size=5, padding=0)  # → 64×8×8
        self.bn2   = nn.BatchNorm2d(64)
        self.pool2 = nn.MaxPool2d(2, 2)                            # → 64×4×4
        # ── Fully connected ───────────────────────────────────────────────────
        self.fc1     = nn.Linear(64 * 4 * 4, 512)
        self.bn3     = nn.BatchNorm1d(512)
        self.dropout = nn.Dropout(0.5)
        self.fc2     = nn.Linear(512, 10)

        self._init_weights()

    def _init_weights(self) -> None:
        """Kaiming He (fan-out) initialisation for conv/linear layers."""
        for m in self.modules():
            if isinstance(m, nn.Conv2d):
                nn.init.kaiming_normal_(m.weight, mode="fan_out", nonlinearity="relu")
                if m.bias is not None:
                    nn.init.zeros_(m.bias)
            elif isinstance(m, nn.Linear):
                nn.init.kaiming_normal_(m.weight, mode="fan_out", nonlinearity="relu")
                nn.init.zeros_(m.bias)
            elif isinstance(m, (nn.BatchNorm2d, nn.BatchNorm1d)):
                nn.init.ones_(m.weight)
                nn.init.zeros_(m.bias)

    def forward(self, x: Tensor) -> Tensor:
        x = self.pool1(F.relu(self.bn1(self.conv1(x))))
        x = self.pool2(F.relu(self.bn2(self.conv2(x))))
        x = x.view(x.size(0), -1)
        x = F.relu(self.bn3(self.fc1(x)))
        x = self.dropout(x)
        return self.fc2(x)   # raw logits — use CrossEntropyLoss


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
    """Save model state-dict + optional metadata to disk.

    Args:
        model:    Model to serialise.
        path:     Destination ``.pt`` file.
        metadata: Arbitrary dict stored alongside the state-dict (round, loss…).
    """
    ckpt = {"state_dict": model.state_dict(), "metadata": metadata or {}}
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    torch.save(ckpt, path)
    logger.info("Checkpoint saved → %s", path)


def load_checkpoint(model: nn.Module, path: str) -> dict:
    """Load checkpoint from disk into ``model`` in-place.

    Returns:
        The metadata dict from the checkpoint (may be empty).
    """
    ckpt = torch.load(path, map_location="cpu", weights_only=True)
    model.load_state_dict(ckpt["state_dict"])
    logger.info("Checkpoint loaded ← %s", path)
    return ckpt.get("metadata", {})


# ── Transforms ────────────────────────────────────────────────────────────────

_MNIST_MEAN = (0.1307,)
_MNIST_STD  = (0.3081,)

# Training: light geometric augmentation improves generalisation on small shards
_train_transform = transforms.Compose([
    transforms.RandomRotation(degrees=10),
    transforms.RandomAffine(degrees=0, translate=(0.05, 0.05), scale=(0.95, 1.05)),
    transforms.ToTensor(),
    transforms.Normalize(_MNIST_MEAN, _MNIST_STD),
])

# Inference: deterministic pipeline only
_eval_transform = transforms.Compose([
    transforms.ToTensor(),
    transforms.Normalize(_MNIST_MEAN, _MNIST_STD),
])


# ── Non-IID (Dirichlet) partitioning ─────────────────────────────────────────

def _dirichlet_partition(
    targets: np.ndarray,
    num_nodes: int,
    node_index: int,
    alpha: float,
    seed: int = 42,
    min_samples_per_class: int = 1,
) -> list[int]:
    """Return training indices for ``node_index`` using Dirichlet partitioning.

    Dirichlet(α) controls class heterogeneity across nodes:
    - α=0.1 → very heterogeneous (each node mostly one class).
    - α=100 → nearly IID.

    ``min_samples_per_class`` guarantees each node receives at least that many
    samples from each class, preventing data-starved nodes at extreme α values.

    This is the standard Non-IID benchmark in federated learning literature
    (Li et al., 2022; Hsieh et al., 2020).
    """
    rng = np.random.default_rng(seed)
    num_classes = int(targets.max()) + 1
    class_indices: dict[int, np.ndarray] = {
        c: np.where(targets == c)[0] for c in range(num_classes)
    }

    node_indices: list[list[int]] = [[] for _ in range(num_nodes)]
    for c in range(num_classes):
        clen = len(class_indices[c])
        # Clamp floor so we never allocate more samples than exist for this class
        floor = min(min_samples_per_class, max(0, clen // num_nodes))
        reserved = num_nodes * floor
        free = clen - reserved          # always >= 0

        proportions = rng.dirichlet(np.full(num_nodes, alpha))
        counts = (proportions * free).astype(int)
        # Fix rounding so free portion sums exactly to `free`
        diff = free - counts.sum()
        for _ in range(abs(diff)):
            counts[rng.integers(0, num_nodes)] += int(np.sign(diff))
        # Add the guaranteed floor back
        counts = counts + floor

        idx = class_indices[c].copy()
        rng.shuffle(idx)
        start = 0
        for n_i, count in enumerate(counts):
            node_indices[n_i].extend(idx[start : start + count].tolist())
            start += count

    return sorted(node_indices[node_index])


# ── Data loading ──────────────────────────────────────────────────────────────

def get_dataloaders(
    data_dir: str,
    batch_size: int,
    num_workers: int = 0,
    val_fraction: float = 0.1,
    node_id: Optional[str] = None,
    num_nodes: int = 1,
    node_index: int = 0,
    partition: str = "iid",
    dirichlet_alpha: float = 0.5,
) -> tuple[DataLoader, DataLoader, DataLoader]:
    """Return ``(train_loader, val_loader, test_loader)`` for MNIST.

    Partitioning modes:

    * ``"iid"``   — contiguous equal shards (standard IID baseline).
    * ``"noniid"`` — Dirichlet(alpha) class-heterogeneous shards.

    The training set uses augmented transforms; test set uses deterministic
    normalisation only.  Each node gets a reproducible but distinct validation
    split seeded by ``node_index``.

    Args:
        data_dir:        Directory to download / cache MNIST.
        batch_size:      Mini-batch size for all loaders.
        num_workers:     DataLoader worker processes (0 = main thread).
        val_fraction:    Fraction of training shard to reserve for validation.
        node_id:         Node identifier used in log messages.
        num_nodes:       Total number of nodes.
        node_index:      0-based shard index for this node.
        partition:       ``"iid"`` or ``"noniid"``.
        dirichlet_alpha: Dirichlet α for non-IID (smaller = more skewed).

    Returns:
        ``(train_loader, val_loader, test_loader)``
    """
    root = Path(data_dir)
    root.mkdir(parents=True, exist_ok=True)

    def _load_mnist(train: bool):
        transform = _train_transform if train else _eval_transform
        try:
            return datasets.MNIST(
                root=str(root), train=train, download=True, transform=transform
            )
        except Exception as exc:  # network/disk failure → synthetic fallback
            n = 60_000 if train else 10_000
            logger.warning(
                "MNIST download failed (%s). Using synthetic dataset (%d samples).",
                exc, n,
            )
            return SyntheticMNISTDataset(
                num_samples=n,
                transform=transform,
                seed=0 if train else 1,
            )

    full_train = _load_mnist(train=True)
    full_test  = _load_mnist(train=False)

    # ── Partition ─────────────────────────────────────────────────────────────
    label = node_id or f"node_{node_index}"
    if partition == "noniid":
        targets = np.array(full_train.targets)
        indices = _dirichlet_partition(
            targets, num_nodes, node_index, dirichlet_alpha
        )
        node_train: Subset = Subset(full_train, indices)
        logger.info(
            "[%s] Non-IID Dirichlet(α=%.2f) shard: %d samples",
            label, dirichlet_alpha, len(node_train),
        )
    else:
        shard_size = len(full_train) // num_nodes
        start = node_index * shard_size
        end = start + shard_size if node_index < num_nodes - 1 else len(full_train)
        node_train = Subset(full_train, list(range(start, end)))
        logger.info(
            "[%s] IID shard [%d:%d] = %d samples",
            label, start, end, len(node_train),
        )

    # ── Validation split ──────────────────────────────────────────────────────
    val_len = max(1, int(len(node_train) * val_fraction))
    train_len = len(node_train) - val_len
    train_set, val_set = random_split(
        node_train, [train_len, val_len],
        generator=torch.Generator().manual_seed(42 + node_index),
    )

    logger.info(
        "[%s] Final split → train: %d  val: %d  test: %d",
        label, len(train_set), len(val_set), len(full_test),
    )

    loader_kwargs: dict = dict(
        batch_size=batch_size,
        num_workers=num_workers,
        pin_memory=torch.cuda.is_available(),
        persistent_workers=(num_workers > 0),
    )

    return (
        DataLoader(train_set, shuffle=True,  **loader_kwargs),
        DataLoader(val_set,   shuffle=False, **loader_kwargs),
        DataLoader(full_test, shuffle=False, **loader_kwargs),
    )


# ── Per-epoch training result ─────────────────────────────────────────────────

@dataclass
class EpochResult:
    """Statistics for a single training epoch."""
    loss: float
    accuracy: float


# ── Training / evaluation utilities ──────────────────────────────────────────

def train_one_epoch(
    model: nn.Module,
    loader: DataLoader,
    optimizer: torch.optim.Optimizer,
    device: torch.device,
    max_grad_norm: float = 1.0,
    label_smoothing: float = 0.05,
    global_params: Optional[list[torch.Tensor]] = None,
    fedprox_mu: float = 0.0,
) -> EpochResult:
    """Run one full epoch of supervised training.

    Improvements over baseline:

    - **Gradient clipping** (``max_grad_norm``) prevents gradient explosion.
    - **Label smoothing** (``label_smoothing=0.05``) acts as a regulariser.
    - **FedProx proximal term**: when ``fedprox_mu > 0`` and ``global_params``
      are provided, adds ``½mu‖w − w_global‖²`` to the loss *before* the backward
      pass.  This is the mathematically correct FedProx implementation — the
      proximal penalty influences the gradient, pulling local parameters toward
      the global model and reducing client drift under Non-IID data.
    - **Training accuracy** is tracked and returned alongside loss.

    Args:
        model:          Model to train.
        loader:         Training DataLoader.
        optimizer:      Pre-configured optimizer.
        device:         Torch device.
        max_grad_norm:  Gradient clip threshold (0 disables clipping).
        label_smoothing: CrossEntropyLoss label smoothing ε.
        global_params:  Optional list of global parameter tensors (for FedProx).
        fedprox_mu:     FedProx proximal coefficient µ (≥0).  0 = disabled.

    Returns:
        :class:`EpochResult` with mean loss and accuracy for the epoch.
    """
    model.train()
    criterion = nn.CrossEntropyLoss(label_smoothing=label_smoothing)
    total_loss = 0.0
    correct = 0
    total = 0

    for images, labels in loader:
        images, labels = images.to(device), labels.to(device)
        optimizer.zero_grad(set_to_none=True)

        outputs = model(images)
        loss = criterion(outputs, labels)

        # FedProx proximal term: ½µ‖w − w_global‖²  (added to loss before backward)
        if fedprox_mu > 0.0 and global_params is not None:
            prox = torch.tensor(0.0, device=device)
            for p, g in zip(model.parameters(), global_params):
                prox = prox + ((p - g.to(device)) ** 2).sum()
            loss = loss + (fedprox_mu / 2.0) * prox

        loss.backward()

        if max_grad_norm > 0:
            nn.utils.clip_grad_norm_(model.parameters(), max_grad_norm)

        optimizer.step()

        total_loss += loss.item()
        preds = outputs.argmax(dim=1)
        correct += (preds == labels).sum().item()
        total += labels.size(0)

    n_batches = max(len(loader), 1)
    return EpochResult(
        loss=total_loss / n_batches,
        accuracy=correct / max(total, 1),
    )


def evaluate_model(
    model: nn.Module,
    loader: DataLoader,
    device: torch.device,
) -> tuple[float, float]:
    """Evaluate model. Returns ``(mean_loss, accuracy)``."""
    model.eval()
    criterion = nn.CrossEntropyLoss()
    total_loss = 0.0
    correct = 0
    total = 0

    with torch.no_grad():
        for images, labels in loader:
            images, labels = images.to(device), labels.to(device)
            outputs = model(images)
            loss = criterion(outputs, labels)
            total_loss += loss.item() * labels.size(0)
            preds = outputs.argmax(dim=1)
            correct += (preds == labels).sum().item()
            total += labels.size(0)

    return total_loss / max(total, 1), correct / max(total, 1)


def evaluate_per_class(
    model: nn.Module,
    loader: DataLoader,
    device: torch.device,
    num_classes: int = 10,
) -> dict[int, float]:
    """Compute per-class accuracy.

    Useful for diagnosing Non-IID class imbalance: nodes with skewed shards
    should show higher accuracy on their dominant classes.

    Returns:
        Dict mapping ``class_index → accuracy_fraction``.
    """
    model.eval()
    correct = np.zeros(num_classes, dtype=np.int64)
    total   = np.zeros(num_classes, dtype=np.int64)

    with torch.no_grad():
        for images, labels in loader:
            images, labels = images.to(device), labels.to(device)
            preds = model(images).argmax(dim=1)
            for c in range(num_classes):
                mask = labels == c
                total[c]   += mask.sum().item()
                correct[c] += (preds[mask] == c).sum().item()

    return {c: int(correct[c]) / max(int(total[c]), 1) for c in range(num_classes)}
