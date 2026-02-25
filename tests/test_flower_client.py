"""Tests for BloomFLClient and BloomFLFlowerAdapter."""
from __future__ import annotations

import pytest
import torch
from torch.utils.data import DataLoader


def _synthetic_loader(n: int = 16, batch_size: int = 4) -> DataLoader:
    """Return a small detection-format DataLoader backed by synthetic person data."""
    from bloomfl.models.yolo_person import SyntheticPersonDataset, person_collate_fn
    ds = SyntheticPersonDataset(num_samples=n, img_size=64, seed=0)
    return DataLoader(ds, batch_size=batch_size, collate_fn=person_collate_fn, num_workers=0)


class TestBloomFLClient:
    """Unit tests for :class:`~bloomfl.flower_client.client.BloomFLClient`."""

    @pytest.fixture()
    def client(self):
        from bloomfl.flower_client.client import BloomFLClient
        from bloomfl.models.yolo_person import YOLOPersonModel

        loader = _synthetic_loader()
        model = YOLOPersonModel(pretrained=False, img_size=64)
        return BloomFLClient(
            model=model,
            train_loader=loader,
            val_loader=loader,
            test_loader=loader,
            device=torch.device("cpu"),
            fedprox_mu=0.0,
        )

    def test_get_parameters_returns_list_of_ndarrays(self, client):
        import numpy as np
        params = client.get_parameters()
        assert isinstance(params, list)
        assert len(params) > 0
        assert all(isinstance(p, np.ndarray) for p in params)

    def test_set_parameters_roundtrip(self, client):
        import numpy as np
        original = client.get_parameters()
        # Multiply all params by 2 and set them
        scaled = [p * 2.0 for p in original]
        client.set_parameters(scaled)
        retrieved = client.get_parameters()
        for orig, scale, ret in zip(original, scaled, retrieved):
            np.testing.assert_allclose(ret, scale, rtol=1e-5)

    def test_train_one_round_returns_train_result(self, client):
        from bloomfl.flower_client.client import TrainResult
        result = client.train_one_round(epochs=1, learning_rate=0.01)
        assert isinstance(result, TrainResult)
        assert result.num_samples > 0
        assert result.loss >= 0.0

    def test_evaluate_returns_eval_result(self, client):
        from bloomfl.flower_client.client import EvalResult
        result = client.evaluate()
        assert isinstance(result, EvalResult)
        assert result.num_samples > 0
        assert result.loss >= 0.0
        assert 0.0 <= result.accuracy <= 1.0

    def test_fedprox_reduces_drift(self):
        """FedProx penalty should constrain weight updates vs. no penalty."""
        import numpy as np
        from bloomfl.flower_client.client import BloomFLClient
        from bloomfl.models.yolo_person import YOLOPersonModel, get_weights

        loader = _synthetic_loader(n=16, batch_size=4)

        # High learning rate to exaggerate drift
        def _run(mu: float) -> list:
            model = YOLOPersonModel(pretrained=False, img_size=64)
            # Fix seed for determinism
            torch.manual_seed(42)
            client = BloomFLClient(
                model=model,
                train_loader=loader,
                val_loader=loader,
                test_loader=loader,
                device=torch.device("cpu"),
                fedprox_mu=mu,
            )
            initial = client.get_parameters()
            client.train_one_round(epochs=3, learning_rate=0.5)
            final = client.get_parameters()
            return [
                np.linalg.norm(f.astype(np.float64) - i.astype(np.float64))
                for f, i in zip(final, initial)
            ]

        drift_no_prox = sum(_run(mu=0.0))
        drift_with_prox = sum(_run(mu=1.0))
        # FedProx should produce smaller or equal total drift
        assert drift_with_prox <= drift_no_prox * 1.05, (
            f"FedProx (drift={drift_with_prox:.4f}) should not exceed "
            f"vanilla drift ({drift_no_prox:.4f})"
        )


class TestBloomFLFlowerAdapter:
    """Tests for the Flower NumPyClient adapter."""

    @pytest.fixture()
    def adapter(self):
        from bloomfl.flower_client.client import BloomFLClient, BloomFLFlowerAdapter
        from bloomfl.models.yolo_person import YOLOPersonModel

        loader = _synthetic_loader()
        model = YOLOPersonModel(pretrained=False, img_size=64)
        client = BloomFLClient(
            model=model,
            train_loader=loader,
            val_loader=loader,
            test_loader=loader,
            device=torch.device("cpu"),
            fedprox_mu=0.0,
        )
        return BloomFLFlowerAdapter(client)

    def test_adapter_get_parameters(self, adapter):
        import numpy as np
        result = adapter.get_parameters(config={})
        # NumPyClient.get_parameters returns NDArrays (list of np.ndarray)
        assert isinstance(result, list)
        assert all(isinstance(p, np.ndarray) for p in result)

    def test_adapter_fit(self, adapter):
        import numpy as np
        params = adapter.get_parameters(config={})
        updated_params, num_examples, metrics = adapter.fit(
            parameters=params,
            config={"epochs": 1, "learning_rate": 0.01},
        )
        assert isinstance(updated_params, list)
        assert num_examples > 0
        assert "loss" in metrics

    def test_adapter_evaluate(self, adapter):
        params = adapter.get_parameters(config={})
        loss, num_examples, metrics = adapter.evaluate(
            parameters=params,
            config={},
        )
        assert num_examples > 0
        assert loss >= 0.0
        assert "accuracy" in metrics
