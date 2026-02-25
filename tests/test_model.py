"""Tests for the YOLOv12-nano person detection model and weight helpers."""
from __future__ import annotations

import tempfile
from pathlib import Path

import numpy as np
import pytest
import torch
from torch.utils.data import DataLoader

from bloomfl.models.yolo_person import (
    EpochResult,
    SyntheticPersonDataset,
    YOLOPersonModel,
    _iid_partition,
    evaluate_model,
    evaluate_per_class,
    get_weights,
    load_checkpoint,
    person_collate_fn,
    save_checkpoint,
    set_weights,
    train_one_epoch,
)

TINY_IMG = 64   # small spatial size for fast CPU tests


def _tiny_loader(n: int = 8, batch_size: int = 4) -> DataLoader:
    ds = SyntheticPersonDataset(num_samples=n, img_size=TINY_IMG, seed=7)
    return DataLoader(ds, batch_size=batch_size, collate_fn=person_collate_fn, num_workers=0)


def _tiny_model() -> YOLOPersonModel:
    return YOLOPersonModel(pretrained=False, img_size=TINY_IMG)


# ── Dataset ────────────────────────────────────────────────────────────────────

class TestSyntheticPersonDataset:
    def test_length(self):
        ds = SyntheticPersonDataset(num_samples=20, img_size=TINY_IMG)
        assert len(ds) == 20

    def test_item_shapes(self):
        ds = SyntheticPersonDataset(num_samples=4, img_size=TINY_IMG)
        img, boxes, labels = ds[0]
        assert img.shape == (3, TINY_IMG, TINY_IMG), "Image must be (3, H, W)"
        assert boxes.ndim == 2 and boxes.shape[1] == 4, "Boxes must be (n, 4)"
        assert labels.ndim == 1 and len(labels) == len(boxes)

    def test_image_range(self):
        ds = SyntheticPersonDataset(num_samples=10, img_size=TINY_IMG, seed=42)
        for i in range(10):
            img, _, _ = ds[i]
            assert img.min() >= 0.0 and img.max() <= 1.0

    def test_boxes_normalised(self):
        ds = SyntheticPersonDataset(num_samples=10, img_size=TINY_IMG)
        for i in range(10):
            _, boxes, _ = ds[i]
            assert (boxes > 0).all() and (boxes <= 1.0).all()

    def test_labels_are_zeros(self):
        ds = SyntheticPersonDataset(num_samples=5, img_size=TINY_IMG)
        for i in range(5):
            _, _, labels = ds[i]
            assert (labels == 0.0).all(), "All labels must be 0 (person class)"

    def test_reproducibility(self):
        ds1 = SyntheticPersonDataset(num_samples=4, img_size=TINY_IMG, seed=99)
        ds2 = SyntheticPersonDataset(num_samples=4, img_size=TINY_IMG, seed=99)
        img1, boxes1, _ = ds1[0]
        img2, boxes2, _ = ds2[0]
        assert torch.equal(img1, img2)
        assert torch.equal(boxes1, boxes2)


# ── Collate ────────────────────────────────────────────────────────────────────

class TestPersonCollateFn:
    def test_output_keys(self):
        ds = SyntheticPersonDataset(num_samples=4, img_size=TINY_IMG)
        batch = person_collate_fn([ds[i] for i in range(4)])
        for key in ("img", "bboxes", "cls", "batch_idx"):
            assert key in batch

    def test_img_batch_shape(self):
        ds = SyntheticPersonDataset(num_samples=4, img_size=TINY_IMG)
        batch = person_collate_fn([ds[i] for i in range(4)])
        assert batch["img"].shape == (4, 3, TINY_IMG, TINY_IMG)

    def test_bboxes_cls_consistent(self):
        ds = SyntheticPersonDataset(num_samples=4, img_size=TINY_IMG)
        batch = person_collate_fn([ds[i] for i in range(4)])
        n = batch["bboxes"].shape[0]
        assert batch["cls"].shape[0] == n
        assert batch["batch_idx"].shape[0] == n

    def test_batch_idx_range(self):
        bs = 4
        ds = SyntheticPersonDataset(num_samples=bs, img_size=TINY_IMG)
        batch = person_collate_fn([ds[i] for i in range(bs)])
        if len(batch["batch_idx"]) > 0:
            assert batch["batch_idx"].min() >= 0
            assert batch["batch_idx"].max() < bs


# ── Model ──────────────────────────────────────────────────────────────────────

class TestYOLOPersonModel:
    def test_instantiation(self):
        model = _tiny_model()
        assert isinstance(model, YOLOPersonModel)
        assert isinstance(model, torch.nn.Module)

    def test_parameter_count(self):
        model = _tiny_model()
        total = sum(p.numel() for p in model.parameters())
        assert total > 1_000_000, f"Expected >1M params, got {total}"

    def test_forward_eval_mode(self):
        model = _tiny_model()
        model.eval()
        with torch.no_grad():
            x = torch.zeros(1, 3, TINY_IMG, TINY_IMG)
            out = model(x)
        assert out is not None


# ── Weight helpers ─────────────────────────────────────────────────────────────

class TestWeightHelpers:
    def test_get_set_roundtrip(self):
        model_a = _tiny_model()
        model_b = _tiny_model()
        weights_a = get_weights(model_a)
        set_weights(model_b, weights_a)
        weights_b = get_weights(model_b)
        for a, b in zip(weights_a, weights_b):
            np.testing.assert_array_equal(a, b)

    def test_get_weights_is_list_of_float32_ndarrays(self):
        model = _tiny_model()
        weights = get_weights(model)
        assert isinstance(weights, list)
        assert len(weights) > 0
        assert all(isinstance(w, np.ndarray) for w in weights)
        assert all(w.dtype == np.float32 for w in weights)

    def test_set_weights_wrong_count(self):
        model = _tiny_model()
        weights = get_weights(model)
        with pytest.raises(ValueError, match="Parameter count mismatch"):
            set_weights(model, weights[:-1])

    def test_weights_are_copy(self):
        model = _tiny_model()
        weights = get_weights(model)
        original = weights[0].copy()
        weights[0] += 999.0
        new_weights = get_weights(model)
        np.testing.assert_array_equal(new_weights[0], original)


# ── Training / evaluation ──────────────────────────────────────────────────────

class TestTrainingEval:
    @pytest.fixture()
    def mini_loader(self):
        return _tiny_loader(n=8, batch_size=4)

    @pytest.fixture()
    def mini_model(self):
        return _tiny_model()

    def test_train_one_epoch_returns_epoch_result(self, mini_model, mini_loader):
        opt = torch.optim.AdamW(mini_model.parameters(), lr=1e-4)
        result = train_one_epoch(mini_model, mini_loader, opt, torch.device("cpu"))
        assert isinstance(result, EpochResult)
        assert isinstance(result.loss, float)
        assert isinstance(result.accuracy, float)
        assert result.loss >= 0.0
        assert 0.0 <= result.accuracy <= 1.0

    def test_train_updates_weights(self, mini_model, mini_loader):
        w_before = get_weights(mini_model)
        opt = torch.optim.AdamW(mini_model.parameters(), lr=1e-4)
        train_one_epoch(mini_model, mini_loader, opt, torch.device("cpu"))
        w_after = get_weights(mini_model)
        assert any(not np.allclose(a, b) for a, b in zip(w_before, w_after))

    def test_gradient_clipping_no_raise(self, mini_model, mini_loader):
        opt = torch.optim.AdamW(mini_model.parameters(), lr=1e-4)
        train_one_epoch(
            mini_model, mini_loader, opt, torch.device("cpu"), max_grad_norm=0.1
        )

    def test_evaluate_model_returns_two_floats(self, mini_model, mini_loader):
        loss, precision = evaluate_model(mini_model, mini_loader, torch.device("cpu"))
        assert isinstance(loss, float)
        assert isinstance(precision, float)
        assert loss >= 0.0
        assert 0.0 <= precision <= 1.0

    def test_evaluate_per_class_single_class(self, mini_model, mini_loader):
        per_class = evaluate_per_class(
            mini_model, mini_loader, torch.device("cpu"), num_classes=1
        )
        assert isinstance(per_class, dict)
        assert 0 in per_class
        assert 0.0 <= per_class[0] <= 1.0


# ── Checkpoint ─────────────────────────────────────────────────────────────────

class TestCheckpoint:
    def test_save_and_load_roundtrip(self):
        model_a = _tiny_model()
        model_b = _tiny_model()
        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp) / "ckpt.pt")
            save_checkpoint(model_a, path, metadata={"round": 3})
            meta = load_checkpoint(model_b, path)
        assert meta["round"] == 3
        for a, b in zip(get_weights(model_a), get_weights(model_b)):
            np.testing.assert_array_equal(a, b)

    def test_checkpoint_metadata_empty_by_default(self):
        model = _tiny_model()
        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp) / "ckpt.pt")
            save_checkpoint(model, path)
            meta = load_checkpoint(model, path)
        assert isinstance(meta, dict)


# ── IID partition ──────────────────────────────────────────────────────────────

class TestIIDPartition:
    def test_indices_in_range(self):
        idx = _iid_partition(num_total=100, num_nodes=4, node_index=0)
        assert len(idx) > 0
        assert all(0 <= i < 100 for i in idx)

    def test_no_overlap_between_nodes(self):
        partitions = [
            set(_iid_partition(num_total=100, num_nodes=4, node_index=n))
            for n in range(4)
        ]
        combined = [i for p in partitions for i in p]
        assert len(combined) == len(set(combined))

    def test_all_indices_allocated(self):
        all_idx: set[int] = set()
        for n in range(4):
            all_idx.update(_iid_partition(num_total=100, num_nodes=4, node_index=n))
        assert all_idx == set(range(100))
