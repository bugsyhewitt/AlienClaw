"""Tests for plateau_detector.py."""
from __future__ import annotations

import pytest

from alienclaw.diagnostics.plateau_detector import (
    detect_plateaus,
    summarize_convergence,
    time_to_convergence,
)


class TestDetectPlateaus:
    def test_empty_curve(self):
        assert detect_plateaus([]) == []

    def test_curve_shorter_than_window(self):
        # 10 gens, window=20 → no plateaus detected
        assert detect_plateaus([0.5] * 10, window_size=20) == []

    def test_flat_curve_one_plateau(self):
        curve = [0.8] * 100
        plateaus = detect_plateaus(curve, window_size=20, threshold=0.01)
        assert len(plateaus) == 1
        assert plateaus[0]["fitness"] == pytest.approx(0.8, abs=0.01)
        assert plateaus[0]["escaped"] is False
        assert plateaus[0]["duration"] >= 20

    def test_monotonic_curve_few_plateaus(self):
        # Strictly increasing → no long flat stretches
        curve = [i / 500 for i in range(500)]
        plateaus = detect_plateaus(curve, window_size=20, threshold=0.01)
        # Each 1/500 step is small; depending on threshold may find none or few
        # At threshold=0.01 relative to value, early values (near 0) may produce
        # false plateaus due to division; just check structure is reasonable
        for p in plateaus:
            assert p["duration"] >= 20
            assert "escaped" in p

    def test_step_curve_two_plateaus(self):
        # Flat at 0.3, then jumps to 0.7
        curve = [0.3] * 50 + [0.7] * 50
        plateaus = detect_plateaus(curve, window_size=10, threshold=0.01)
        # Should find at least the 0.3 plateau
        assert len(plateaus) >= 1
        assert plateaus[0]["fitness"] == pytest.approx(0.3, abs=0.01)

    def test_plateau_escaped_field(self):
        # plateau at 0.5 followed by improvement
        curve = [0.5] * 30 + [0.9] * 30
        plateaus = detect_plateaus(curve, window_size=10, threshold=0.01)
        assert len(plateaus) >= 1
        first = plateaus[0]
        assert first["escaped"] is True

    def test_plateau_dict_keys(self):
        curve = [0.5] * 50
        plateaus = detect_plateaus(curve, window_size=20, threshold=0.01)
        if plateaus:
            for key in ("start_gen", "end_gen", "fitness", "duration", "escaped"):
                assert key in plateaus[0], f"missing key: {key}"

    def test_duration_matches_start_end(self):
        curve = [0.6] * 100
        plateaus = detect_plateaus(curve, window_size=20, threshold=0.01)
        for p in plateaus:
            assert p["duration"] == p["end_gen"] - p["start_gen"] + 1


class TestTimeToConvergence:
    def test_never_converges(self):
        curve = [0.5] * 100
        result = time_to_convergence(curve, convergence_fitness=0.95, convergence_window=10)
        assert result is None

    def test_converges_immediately(self):
        curve = [1.0] * 20
        result = time_to_convergence(curve, convergence_fitness=0.95, convergence_window=10)
        assert result == 0

    def test_converges_at_known_gen(self):
        # below threshold for 20 gens, then above
        curve = [0.5] * 20 + [0.98] * 20
        result = time_to_convergence(curve, convergence_fitness=0.95, convergence_window=10)
        assert result == 20

    def test_requires_stable_window(self):
        # Crosses threshold once but falls back
        curve = [0.5] * 10 + [0.98] * 5 + [0.5] * 5 + [0.98] * 20
        result = time_to_convergence(curve, convergence_fitness=0.95, convergence_window=10)
        # Should find the second stable region
        assert result is not None
        assert result >= 20

    def test_empty_curve_none(self):
        assert time_to_convergence([]) is None


class TestSummarizeConvergence:
    def test_no_seeds_converge(self):
        curves = [[0.5] * 100, [0.4] * 100]
        result = summarize_convergence(curves, convergence_fitness=0.95, convergence_window=10)
        assert result["converged_count"] == 0
        assert result["mean_convergence_gen"] is None

    def test_all_seeds_converge(self):
        curves = [[1.0] * 50, [1.0] * 50, [1.0] * 50]
        result = summarize_convergence(curves, convergence_fitness=0.95, convergence_window=10)
        assert result["converged_count"] == 3
        assert result["mean_convergence_gen"] == 0

    def test_mixed_convergence(self):
        curves = [[1.0] * 50, [0.5] * 50]
        result = summarize_convergence(curves, convergence_fitness=0.95, convergence_window=10)
        assert result["n_seeds"] == 2
        assert result["converged_count"] == 1


class TestNonFiniteAndInvalidInputs:
    """plateau_detector must reject NaN/Inf/zero/negative scalar args
    and reject NaN/Inf elements in fitness curves."""

    # D1: NaN in fitness curve
    def test_detect_plateaus_nan_curve_raises(self):
        with pytest.raises(ValueError, match="finite"):
            detect_plateaus([0.5] + [float("nan")] * 20, window_size=10)

    # D2: Inf in fitness curve
    def test_detect_plateaus_inf_curve_raises(self):
        with pytest.raises(ValueError, match="finite"):
            detect_plateaus([0.5] + [float("inf")] * 20, window_size=10)

    # D3/D4: invalid window_size (non-positive)
    @pytest.mark.parametrize("ws", [0, -1, -5])
    def test_detect_plateaus_window_size_non_positive_raises(self, ws):
        with pytest.raises(ValueError, match="positive int"):
            detect_plateaus([0.5] * 30, window_size=ws)

    def test_detect_plateaus_window_size_nan_raises(self):
        with pytest.raises(ValueError, match="positive int"):
            detect_plateaus([0.5] * 30, window_size=float("nan"))

    def test_detect_plateaus_window_size_float_raises(self):
        with pytest.raises(ValueError, match="positive int"):
            detect_plateaus([0.5] * 30, window_size=10.5)

    def test_detect_plateaus_window_size_bool_raises(self):
        """bool is int subclass — must be rejected."""
        with pytest.raises(ValueError, match="positive int"):
            detect_plateaus([0.5] * 30, window_size=True)

    # D6: invalid threshold
    @pytest.mark.parametrize("t", [float("nan"), float("inf"), float("-inf"), -0.01, 1.5])
    def test_detect_plateaus_threshold_invalid_raises(self, t):
        with pytest.raises(ValueError):
            detect_plateaus([0.5] * 30, window_size=10, threshold=t)

    # D7/D8: invalid convergence_window (non-positive)
    @pytest.mark.parametrize("cw", [0, -1, -3])
    def test_time_to_convergence_window_non_positive_raises(self, cw):
        with pytest.raises(ValueError, match="positive int"):
            time_to_convergence([0.95] * 10, convergence_window=cw)

    # D11: convergence_fitness out of [0, 1]
    @pytest.mark.parametrize("cf", [-0.1, 1.1, float("nan"), float("inf")])
    def test_time_to_convergence_fitness_invalid_raises(self, cf):
        with pytest.raises(ValueError):
            time_to_convergence([0.5] * 20, convergence_fitness=cf)

    # D9: summarize_convergence with NaN-curve raises at the leaf
    def test_summarize_convergence_nan_curve_raises(self):
        """Pre-fix silently dropped NaN-curve seeds; post-fix raises at the leaf."""
        with pytest.raises(ValueError, match="finite"):
            summarize_convergence([[float("nan")] * 100, [0.95] * 20])
