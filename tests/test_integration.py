"""
Integration tests — two NodeControllers exchange one gossip round over TCP.

These tests spin up two real node processes (in-process threads) and verify
that the encrypted gossip exchange works end-to-end:
    model A trains → gossips with B → both models updated
"""
from __future__ import annotations

import os
import socket
import time
import threading

import numpy as np
import torch
from torch.utils.data import DataLoader
import pytest

# ── Helpers ───────────────────────────────────────────────────────────────────

def _free_port() -> int:
    """Return an ephemeral TCP port that is free at call time."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        return s.getsockname()[1]


def _make_synthetic_loaders(batch_size: int = 4):
    """Return (train, val, test) detection DataLoaders backed by synthetic data."""
    from bloomfl.models.yolo_person import SyntheticPersonDataset, person_collate_fn
    ds = SyntheticPersonDataset(num_samples=16, img_size=64, seed=0)
    loader = DataLoader(ds, batch_size=batch_size, collate_fn=person_collate_fn, num_workers=0)
    return loader, loader, loader


# ── Tests ─────────────────────────────────────────────────────────────────────

class TestGossipEngineEndToEnd:
    """Test the gossip engine with real TCP transport (loopback)."""

    def test_single_gossip_round(self, tmp_path):
        """Two nodes exchange parameters via TCP gossip and both update."""
        from bloomfl.gossip.engine import GossipEngine, make_incoming_handler
        from bloomfl.discovery.mdns import PeerInfo
        from bloomfl.models.yolo_person import YOLOPersonModel, get_weights, set_weights
        from bloomfl.transport.tcp_transport import TCPTransport

        # ── Node A (server + gossip initiator) ────────────────────────────────
        model_a = YOLOPersonModel(pretrained=False, img_size=64)
        weights_a_before = [w.copy() for w in get_weights(model_a)]

        transport_a = TCPTransport()
        incoming_handler_a = make_incoming_handler(
            node_id="node-a",
            get_weights_fn=lambda: get_weights(model_a),
            get_sample_count_fn=lambda: 500,
            key_manager=None,
        )
        port_a = _free_port()
        transport_a.start_server("127.0.0.1", port_a, incoming_handler_a)
        time.sleep(0.1)

        # ── Node B (gossip initiator towards A) ────────────────────────────────
        model_b = YOLOPersonModel(pretrained=False, img_size=64)
        # Perturb model_b so weights are definitely different
        with torch.no_grad():
            for p in model_b.parameters():
                p.add_(torch.randn_like(p) * 0.1)
        weights_b_before = [w.copy() for w in get_weights(model_b)]

        transport_b = TCPTransport()
        engine_b = GossipEngine(
            node_id="node-b",
            transport=transport_b,
            aggregation_strategy="weighted_avg",
        )

        peer_a = PeerInfo(node_id="node-a", address="127.0.0.1", port=port_a)

        result = engine_b.run_round(
            peer=peer_a,
            local_weights=get_weights(model_b),
            local_samples=500.0,
        )

        # ── Cleanup ────────────────────────────────────────────────────────────
        transport_a.stop_server()

        # ── Assertions ────────────────────────────────────────────────────────
        assert result.success, f"Gossip round failed: {result.error}"
        assert result.merged_weights is not None
        assert result.peer_id == "node-a"
        assert result.peer_samples == 500.0

        # Merged weights should be the average of A and B
        for i, (wa, wb, wm) in enumerate(
            zip(weights_a_before, weights_b_before, result.merged_weights)
        ):
            expected = (wa.astype(np.float64) + wb.astype(np.float64)) / 2.0
            np.testing.assert_allclose(
                wm.astype(np.float64), expected, atol=1e-3,
                err_msg=f"Layer {i}: merged weights not equal to average",
            )


class TestAdaptationIntegration:
    """Test that the adaptation manager changes training schedule correctly."""

    def test_critical_thermal_skips_training(self):
        from bloomfl.adaptation.manager import AdaptationManager
        from bloomfl.monitoring.energy import EnergyState
        from bloomfl.monitoring.thermal import ThermalState

        # hysteresis_rounds=1 means the very first call commits immediately
        mgr = AdaptationManager(
            default_epochs=3,
            default_batch_size=64,
            default_learning_rate=0.01,
            hysteresis_rounds=1,
        )
        schedule = mgr.compute_schedule(EnergyState.HIGH, ThermalState.CRITICAL)
        assert schedule.train_epochs == 0, "Critical thermal must skip training"

    def test_critical_energy_suspends_everything(self):
        from bloomfl.adaptation.manager import AdaptationManager
        from bloomfl.monitoring.energy import EnergyState
        from bloomfl.monitoring.thermal import ThermalState

        mgr = AdaptationManager(hysteresis_rounds=1)
        schedule = mgr.compute_schedule(EnergyState.CRITICAL, ThermalState.NORMAL)
        assert schedule.train_epochs == 0
        assert not schedule.gossip_enabled

    def test_high_energy_normal_thermal_full_speed(self):
        from bloomfl.adaptation.manager import AdaptationManager
        from bloomfl.monitoring.energy import EnergyState
        from bloomfl.monitoring.thermal import ThermalState

        epochs = 5
        # Initial state is already HIGH/NORMAL, so first call always gives full schedule
        mgr = AdaptationManager(default_epochs=epochs, hysteresis_rounds=2)
        schedule = mgr.compute_schedule(EnergyState.HIGH, ThermalState.NORMAL)
        assert schedule.train_epochs == epochs
        assert schedule.gossip_enabled

    def test_hysteresis_prevents_instant_downgrade(self):
        from bloomfl.adaptation.manager import AdaptationManager
        from bloomfl.monitoring.energy import EnergyState
        from bloomfl.monitoring.thermal import ThermalState

        mgr = AdaptationManager(default_epochs=3, hysteresis_rounds=3)
        # First call with low energy: not yet committed (count=1, need 3)
        s1 = mgr.compute_schedule(EnergyState.LOW, ThermalState.NORMAL)
        assert s1.train_epochs == 3, "State not yet committed — should still use initial schedule"
        # Second call: count=2, still not committed
        s2 = mgr.compute_schedule(EnergyState.LOW, ThermalState.NORMAL)
        assert s2.train_epochs == 3
        # Third call: count=3, now committed → LOW skips training
        s3 = mgr.compute_schedule(EnergyState.LOW, ThermalState.NORMAL)
        assert s3.train_epochs == 0, "LOW energy should skip training after hysteresis"


class TestNodeControllerSetup:
    """Verify NodeController assembles without errors using synthetic data."""

    def test_controller_initialises(self, tmp_path):
        """NodeController should initialise all components without crashing."""
        from unittest.mock import patch
        from bloomfl.config import Config

        # Patch get_dataloaders to return synthetic loaders
        train_l, val_l, test_l = _make_synthetic_loaders()

        with patch("bloomfl.node.controller.get_dataloaders",
                   return_value=(train_l, val_l, test_l)):
            config = Config(
                node_id="test-node-init",
                listen_port=59200,
                key_storage_dir=str(tmp_path / "keys"),
                metrics_dir=str(tmp_path / "metrics"),
                data_dir=str(tmp_path / "data"),
                transport="tcp",
                adaptation_enabled=False,
                peer_addrs=[],
            )
            from bloomfl.node.controller import NodeController
            ctrl = NodeController(config)

        assert ctrl.node_id == "test-node-init"
        assert not ctrl.is_running

    def test_controller_start_stop(self, tmp_path):
        """NodeController starts transport server and stops cleanly."""
        from unittest.mock import patch
        from bloomfl.config import Config

        train_l, val_l, test_l = _make_synthetic_loaders()

        with patch("bloomfl.node.controller.get_dataloaders",
                   return_value=(train_l, val_l, test_l)):
            with patch("bloomfl.node.controller.MDNSDiscovery") as mock_discovery_cls:
                mock_discovery = mock_discovery_cls.return_value
                mock_discovery.start.return_value = None
                mock_discovery.stop.return_value = None
                mock_discovery.get_peers.return_value = []
                mock_discovery.peer_count.return_value = 0

                config = Config(
                    node_id="test-node-ss",
                    listen_port=_free_port(),
                    key_storage_dir=str(tmp_path / "keys"),
                    metrics_dir=str(tmp_path / "metrics"),
                    data_dir=str(tmp_path / "data"),
                    transport="tcp",
                    adaptation_enabled=False,
                    peer_addrs=[],
                )
                from bloomfl.node.controller import NodeController
                ctrl = NodeController(config)
                ctrl.start()
                time.sleep(0.2)
                assert ctrl.is_running
                ctrl.stop()
                assert not ctrl.is_running
