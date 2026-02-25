"""
BloomFL Flower Client.

Wraps the YOLOv12-nano person-detection model training/evaluation lifecycle.
Provides:

1. ``BloomFLClient`` — direct ``train_one_round()`` / ``evaluate()``
   methods called by the gossip node controller (no Flower server needed).

2. A Flower ``ClientApp`` using the v1.21+ Message API for optional
   ``flwr run`` benchmarking.

Improvements over the baseline:
- **AdamW** as the default optimizer (better weight-decay decoupling than SGD).
- **Cosine annealing LR scheduler** per round for smooth LR decay.
- **FedProx proximal term** (μ·‖w − w_global‖²) to pull local updates towards
  the global model — improves convergence under Non-IID data heterogeneity.
- **Training history** (loss + detection-precision per round) for diagnostics.
- **Per-class detection precision** via ``evaluate_per_class()``.
"""
from __future__ import annotations

import copy
import logging
from dataclasses import dataclass, field
from typing import Literal, Optional

import numpy as np
import torch
from torch.utils.data import DataLoader

from bloomfl.models.yolo_person import (
    EpochResult,
    YOLOPersonModel,
    evaluate_model,
    evaluate_per_class,
    get_weights,
    set_weights,
    train_one_epoch,
)

logger = logging.getLogger(__name__)


# ── Round results ─────────────────────────────────────────────────────────────

@dataclass
class TrainResult:
    weights: list[np.ndarray]
    num_samples: int
    loss: float
    train_accuracy: float = 0.0
    metrics: dict[str, float] = field(default_factory=dict)


@dataclass
class EvalResult:
    loss: float
    num_samples: int
    accuracy: float
    per_class: dict[int, float] = field(default_factory=dict)
    metrics: dict[str, float] = field(default_factory=dict)


@dataclass
class RoundHistory:
    """Accumulated training history across all rounds."""
    train_losses: list[float] = field(default_factory=list)
    train_accuracies: list[float] = field(default_factory=list)
    eval_losses: list[float] = field(default_factory=list)
    eval_accuracies: list[float] = field(default_factory=list)


# ── Core client ───────────────────────────────────────────────────────────────

class BloomFLClient:
    """Manages local model training and evaluation for a single edge node.

    This class is the bridge between the gossip engine (which handles
    parameter exchange and aggregation) and the PyTorch training loop.
    It does NOT interact with any Flower server.

    Args:
        model:         Initialised ``YOLOPersonModel`` (or any compatible ``nn.Module``).
        train_loader:  DataLoader for the node's local training shard.
        val_loader:    DataLoader for local validation.
        test_loader:   DataLoader for the shared test set.
        device:        Torch device to train on.
        optimizer_cls: Optimizer class — ``"adamw"`` (default) or ``"sgd"``.
        fedprox_mu:    FedProx proximal coefficient μ (0 = disabled).
                       A value of 0.01–0.1 stabilises Non-IID training.
    """

    def __init__(
        self,
        model: YOLOPersonModel,
        train_loader: DataLoader,
        val_loader: DataLoader,
        test_loader: DataLoader,
        device: Optional[torch.device] = None,
        optimizer_cls: Literal["adamw", "sgd"] = "adamw",
        fedprox_mu: float = 0.0,
    ) -> None:
        self.model = model
        self.train_loader = train_loader
        self.val_loader = val_loader
        self.test_loader = test_loader
        self.device = device or torch.device(
            "cuda" if torch.cuda.is_available() else "cpu"
        )
        self.model.to(self.device)
        self._optimizer_cls = optimizer_cls
        self._fedprox_mu = fedprox_mu
        self._round: int = 0
        self.history = RoundHistory()

    # ── Flower-compatible weight interface ────────────────────────────────────

    def get_parameters(self) -> list[np.ndarray]:
        """Return current model weights as numpy arrays."""
        return get_weights(self.model)

    def set_parameters(self, weights: list[np.ndarray]) -> None:
        """Load numpy weight arrays into the model."""
        set_weights(self.model, weights)

    # ── Training ──────────────────────────────────────────────────────────────

    def _make_optimizer(
        self, learning_rate: float
    ) -> torch.optim.Optimizer:
        """Build an optimizer from the client's ``optimizer_cls`` setting."""
        if self._optimizer_cls == "sgd":
            return torch.optim.SGD(
                self.model.parameters(),
                lr=learning_rate,
                momentum=0.9,
                weight_decay=1e-4,
                nesterov=True,
            )
        # Default: AdamW — better weight-decay decoupling than Adam/SGD
        return torch.optim.AdamW(
            self.model.parameters(),
            lr=learning_rate,
            weight_decay=1e-3,
            betas=(0.9, 0.999),
        )

    def train_one_round(
        self,
        epochs: int = 1,
        learning_rate: float = 1e-3,
    ) -> TrainResult:
        """Run ``epochs`` of local training on the node's data shard.

        Improvements:

        * **AdamW** (default) or Nesterov SGD depending on ``optimizer_cls``.
        * **Cosine annealing scheduler**: smoothly decays LR from
          ``learning_rate`` → ``learning_rate / 100`` over the local epochs so
          the last epoch does fine-grained refinement.
        * **FedProx proximal term**: when ``fedprox_mu > 0`` a squared-norm
          penalty ½μ‖w − w_global‖² is added to the loss, pulling local
          parameters towards the global model.  This reduces client drift under
          Non-IID data and is activated automatically when FedProx is enabled.
        * **Training accuracy** is tracked and included in the result.

        Args:
            epochs:        Number of local epochs.
            learning_rate: Peak learning rate (cosine schedule decays from here).

        Returns:
            :class:`TrainResult` with weights, sample count, loss, and accuracy.
        """
        self._round += 1

        # Snapshot of global weights for FedProx proximal term (in-loss regularisation)
        global_params: Optional[list[torch.Tensor]] = None
        if self._fedprox_mu > 0:
            global_params = [p.data.clone() for p in self.model.parameters()]

        optimizer = self._make_optimizer(learning_rate)
        # Cosine annealing: LR goes from lr → lr/100 over all local epochs
        scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
            optimizer, T_max=max(epochs, 1), eta_min=learning_rate / 100
        )

        epoch_results: list[EpochResult] = []
        for epoch in range(epochs):
            result = train_one_epoch(
                self.model,
                self.train_loader,
                optimizer,
                self.device,
                global_params=global_params,
                fedprox_mu=self._fedprox_mu,
            )
            scheduler.step()
            epoch_results.append(result)
            logger.debug(
                "Round %d epoch %d/%d — loss=%.4f  acc=%.4f  lr=%.2e",
                self._round, epoch + 1, epochs,
                result.loss, result.accuracy,
                scheduler.get_last_lr()[0],
            )

        mean_loss = float(np.mean([r.loss for r in epoch_results]))
        mean_acc  = float(np.mean([r.accuracy for r in epoch_results]))
        weights   = get_weights(self.model)
        n         = len(self.train_loader.dataset)

        self.history.train_losses.append(mean_loss)
        self.history.train_accuracies.append(mean_acc)

        logger.info(
            "Round %d — train_loss=%.4f  train_acc=%.4f  samples=%d  opt=%s",
            self._round, mean_loss, mean_acc, n, self._optimizer_cls,
        )
        return TrainResult(
            weights=weights,
            num_samples=n,
            loss=mean_loss,
            train_accuracy=mean_acc,
            metrics={"round": float(self._round)},
        )

    # ── Evaluation ────────────────────────────────────────────────────────────

    def evaluate(
        self,
        use_test: bool = False,
        include_per_class: bool = False,
    ) -> EvalResult:
        """Evaluate the model on validation (or test) data.

        Args:
            use_test:          If True evaluate on the shared test set;
                               otherwise use the local validation split.
            include_per_class: If True compute per-class accuracy breakdown
                               (useful for diagnosing Non-IID imbalance).

        Returns:
            :class:`EvalResult` with loss, accuracy, optional per-class dict.
        """
        loader = self.test_loader if use_test else self.val_loader
        loss, accuracy = evaluate_model(self.model, loader, self.device)
        n = len(loader.dataset)

        per_class: dict[int, float] = {}
        if include_per_class:
            per_class = evaluate_per_class(self.model, loader, self.device)

        self.history.eval_losses.append(float(loss))
        self.history.eval_accuracies.append(float(accuracy))

        logger.info(
            "Eval — loss=%.4f  accuracy=%.4f  samples=%d",
            loss, accuracy, n,
        )
        if per_class:
            logger.debug("Per-class accuracy: %s", per_class)

        return EvalResult(
            loss=float(loss),
            num_samples=n,
            accuracy=float(accuracy),
            per_class=per_class,
        )

    # ── Round counter ─────────────────────────────────────────────────────────

    @property
    def round(self) -> int:
        return self._round


# ── Optional Flower ClientApp (v1.21+ Message API) ────────────────────────────
# Used only when running ``flwr run .`` for benchmarking; the gossip loop
# calls BloomFLClient directly without going through this app.

try:
    from flwr.client import ClientApp, NumPyClient  # type: ignore[import]
    from flwr.common import Context, NDArrays, Parameters  # type: ignore[import]

    def _make_client_app(
        train_loader: DataLoader,
        val_loader: DataLoader,
        test_loader: DataLoader,
    ) -> ClientApp:
        """Create a Flower ClientApp for benchmarking with ``flwr run``."""

        def client_fn(context: Context) -> "BloomFLFlowerAdapter":
            model = YOLOPersonModel()
            client = BloomFLClient(model, train_loader, val_loader, test_loader)
            return BloomFLFlowerAdapter(client)

        return ClientApp(client_fn=client_fn)

    class BloomFLFlowerAdapter(NumPyClient):
        """Thin adapter exposing BloomFLClient through Flower's NumPy interface."""

        def __init__(self, client: BloomFLClient) -> None:
            self._client = client

        def get_parameters(self, config: dict) -> NDArrays:
            return self._client.get_parameters()

        def fit(
            self, parameters: NDArrays, config: dict
        ) -> tuple[NDArrays, int, dict]:
            self._client.set_parameters(parameters)
            lr = float(config.get("learning_rate", 0.01))
            epochs = int(config.get("epochs", 1))
            result = self._client.train_one_round(epochs=epochs, learning_rate=lr)
            return result.weights, result.num_samples, {"loss": result.loss}

        def evaluate(
            self, parameters: NDArrays, config: dict
        ) -> tuple[float, int, dict]:
            self._client.set_parameters(parameters)
            result = self._client.evaluate(use_test=True)
            return result.loss, result.num_samples, {"accuracy": result.accuracy}

except ImportError:
    logger.warning("flwr not installed; Flower ClientApp adapter unavailable.")
    _make_client_app = None  # type: ignore[assignment]
