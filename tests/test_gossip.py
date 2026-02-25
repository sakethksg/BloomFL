"""Tests for gossip aggregation strategies."""
from __future__ import annotations

import numpy as np
import pytest

from bloomfl.gossip.aggregation import (
    aggregate,
    momentum_merge,
    partial_merge,
    weighted_average,
)


def _make_weights(n_layers: int = 4, shape: tuple = (8, 4)) -> list[np.ndarray]:
    """Generate a list of random float32 numpy arrays."""
    return [np.random.randn(*shape).astype(np.float32) for _ in range(n_layers)]


class TestWeightedAverage:
    def test_two_equal_weight_weights(self):
        w1 = [np.array([1.0, 2.0], dtype=np.float32)]
        w2 = [np.array([3.0, 4.0], dtype=np.float32)]
        result = weighted_average([w1, w2], [1.0, 1.0])
        np.testing.assert_allclose(result[0], [2.0, 3.0])

    def test_two_unequal_weights(self):
        w1 = [np.array([0.0], dtype=np.float32)]
        w2 = [np.array([10.0], dtype=np.float32)]
        # 3:1 weighting → (0*3 + 10*1) / 4 = 2.5
        result = weighted_average([w1, w2], [3.0, 1.0])
        np.testing.assert_allclose(result[0], [2.5])

    def test_single_node(self):
        w1 = _make_weights()
        result = weighted_average([w1], [100])
        for r, o in zip(result, w1):
            np.testing.assert_array_equal(r, o)

    def test_empty_list_raises(self):
        with pytest.raises(ValueError, match="must not be empty"):
            weighted_average([], [])

    def test_length_mismatch_raises(self):
        with pytest.raises(ValueError, match="Length mismatch"):
            weighted_average([_make_weights()], [1.0, 2.0])

    def test_zero_samples_raises(self):
        with pytest.raises(ValueError, match="positive"):
            weighted_average([_make_weights()], [0.0])

    def test_result_dtype_is_float32(self):
        w1 = _make_weights()
        result = weighted_average([w1, _make_weights()], [1.0, 1.0])
        assert all(r.dtype == np.float32 for r in result)

    def test_three_nodes(self):
        w1 = [np.array([6.0], dtype=np.float32)]
        w2 = [np.array([3.0], dtype=np.float32)]
        w3 = [np.array([0.0], dtype=np.float32)]
        result = weighted_average([w1, w2, w3], [1.0, 1.0, 1.0])
        np.testing.assert_allclose(result[0], [3.0])


class TestMomentumMerge:
    def test_full_momentum_keeps_local(self):
        local = [np.array([1.0], dtype=np.float32)]
        peer = [np.array([100.0], dtype=np.float32)]
        result = momentum_merge(local, peer, momentum=1.0)
        np.testing.assert_allclose(result[0], [1.0])

    def test_zero_momentum_takes_peer(self):
        local = [np.array([1.0], dtype=np.float32)]
        peer = [np.array([100.0], dtype=np.float32)]
        result = momentum_merge(local, peer, momentum=0.0)
        np.testing.assert_allclose(result[0], [100.0])

    def test_half_momentum(self):
        local = [np.array([0.0, 0.0], dtype=np.float32)]
        peer = [np.array([10.0, 20.0], dtype=np.float32)]
        result = momentum_merge(local, peer, momentum=0.5)
        np.testing.assert_allclose(result[0], [5.0, 10.0])

    def test_invalid_momentum(self):
        with pytest.raises(ValueError, match="momentum must be in"):
            momentum_merge(_make_weights(), _make_weights(), momentum=1.5)

    def test_length_mismatch(self):
        with pytest.raises(ValueError, match="length mismatch"):
            momentum_merge(_make_weights(2), _make_weights(3))

    def test_result_dtype_is_float32(self):
        result = momentum_merge(_make_weights(), _make_weights())
        assert all(r.dtype == np.float32 for r in result)


class TestPartialMerge:
    def test_all_layers_when_fraction_one(self):
        local = [np.array([0.0], dtype=np.float32)] * 4
        peer = [np.array([4.0], dtype=np.float32)] * 4
        result = partial_merge(local, peer, merge_fraction=1.0)
        for r in result:
            np.testing.assert_allclose(r, [2.0])

    def test_no_layers_when_fraction_near_zero(self):
        """merge_fraction=0 → still 1 layer updated (min=1)."""
        local = _make_weights(10)
        peer = _make_weights(10)
        result = partial_merge(local, peer, merge_fraction=0.0)
        # At least 1 layer should be merged; the rest unchanged
        unchanged = sum(
            1 for l, r in zip(local, result) if np.array_equal(l, r)
        )
        assert unchanged == 9  # 10 - 1 = 9 unchanged

    def test_reproducibility_with_seed(self):
        local = _make_weights(8)
        peer = _make_weights(8)
        r1 = partial_merge(local, peer, merge_fraction=0.5, seed=42)
        r2 = partial_merge(local, peer, merge_fraction=0.5, seed=42)
        for a, b in zip(r1, r2):
            np.testing.assert_array_equal(a, b)

    def test_invalid_fraction(self):
        with pytest.raises(ValueError, match="merge_fraction must be in"):
            partial_merge(_make_weights(), _make_weights(), merge_fraction=1.5)

    def test_result_length_matches_input(self):
        n = 6
        result = partial_merge(_make_weights(n), _make_weights(n))
        assert len(result) == n


class TestAggregateDispatcher:
    def test_weighted_avg(self):
        local = [np.array([1.0], dtype=np.float32)]
        peer = [np.array([3.0], dtype=np.float32)]
        result = aggregate(local, peer, 1.0, 1.0, strategy="weighted_avg")
        np.testing.assert_allclose(result[0], [2.0])

    def test_momentum(self):
        local = [np.array([0.0], dtype=np.float32)]
        peer = [np.array([10.0], dtype=np.float32)]
        result = aggregate(local, peer, 1.0, 1.0, strategy="momentum", momentum=0.9)
        np.testing.assert_allclose(result[0], [1.0], atol=1e-5)

    def test_partial(self):
        local = _make_weights(4)
        peer = _make_weights(4)
        result = aggregate(local, peer, 1.0, 1.0, strategy="partial")
        assert len(result) == 4

    def test_unknown_strategy_raises(self):
        with pytest.raises(ValueError, match="Unknown aggregation strategy"):
            aggregate(_make_weights(), _make_weights(), 1.0, 1.0, strategy="unknown")
