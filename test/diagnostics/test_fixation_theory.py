"""Tests for fixation_theory.py — Kimura fixation probability."""
from __future__ import annotations

import math
import pytest

from alienclaw.diagnostics.fixation_theory import (
    kimura_fixation_prob,
    expected_fixation_time,
    selection_coefficient_from_fitness,
    drift_threshold,
    analyze_selection_regime,
)


class TestKimuraFixationProb:
    def test_neutral_drift(self):
        """s=0 → P_fix = 1/N (neutral drift)."""
        N = 100
        p = kimura_fixation_prob(0.0, N)
        assert p == pytest.approx(1.0 / N, rel=0.01)

    def test_strong_selection(self):
        """Very large s → P_fix ≈ 1."""
        p = kimura_fixation_prob(10.0, 100)
        assert p > 0.99

    def test_negative_selection(self):
        """Negative s → P_fix < 1/N (deleterious)."""
        N = 100
        p_neg = kimura_fixation_prob(-0.1, N)
        p_neutral = 1.0 / N
        assert p_neg < p_neutral

    def test_small_positive_s(self):
        """Small positive s → P_fix slightly above 1/N."""
        N = 100
        p_neutral = 1.0 / N
        p_pos = kimura_fixation_prob(0.01, N)
        assert p_pos > p_neutral

    def test_always_in_range(self):
        """P_fix always in [0, 1]."""
        for s in [-1.0, -0.1, 0.0, 0.01, 0.1, 1.0, 10.0]:
            p = kimura_fixation_prob(s, 100)
            assert 0.0 <= p <= 1.0

    def test_invalid_N_raises(self):
        with pytest.raises(ValueError):
            kimura_fixation_prob(0.1, 0)

    def test_strong_negative_overflow_guard(self):
        """s so negative that 2*N*s < -700 → overflow guard returns 0.0."""
        p = kimura_fixation_prob(-4.0, 100)
        assert p == 0.0


class TestExpectedFixationTime:
    def test_neutral_is_inf(self):
        assert expected_fixation_time(0.0, 100) == float("inf")

    def test_positive_s_finite(self):
        t = expected_fixation_time(0.1, 100)
        assert t > 0
        assert t < 1000

    def test_larger_N_longer_time(self):
        """Larger population → longer fixation time."""
        t_small = expected_fixation_time(0.1, 10)
        t_large = expected_fixation_time(0.1, 1000)
        assert t_large > t_small

    def test_invalid_N_raises(self):
        """N <= 0 must raise ValueError in expected_fixation_time()."""
        with pytest.raises(ValueError, match="positive int"):
            expected_fixation_time(0.1, 0)


class TestSelectionCoefficient:
    def test_zero_advantage(self):
        assert selection_coefficient_from_fitness(0.5, 0.5) == 0.0

    def test_positive_advantage(self):
        s = selection_coefficient_from_fitness(0.6, 0.5)
        assert s == pytest.approx(0.2, abs=1e-9)

    def test_zero_mean_fitness(self):
        s = selection_coefficient_from_fitness(0.5, 0.0)
        assert s == 0.0


class TestAnalyzeSelectionRegime:
    def test_strong_selection_regime(self):
        result = analyze_selection_regime(0.9, 0.5, 100)
        assert result["regime"] == "selection"
        assert result["selection_acts"] is True

    def test_neutral_regime(self):
        result = analyze_selection_regime(0.5, 0.5, 100)
        assert result["s"] == 0.0
        assert result["regime"] in ("neutral", "drift")

    def test_deleterious_drift_regime(self):
        """Deleterious s (abs(s) > threshold) → else branch: regime='drift'."""
        result = analyze_selection_regime(0.3, 0.5, 100)
        assert result["s"] < 0
        assert result["regime"] == "drift"
        assert result["selection_acts"] is False


class TestNonFiniteInputs:
    """NaN / ±Inf inputs must raise ValueError, not silently propagate."""

    @pytest.mark.parametrize("fn,second_arg", [
        (kimura_fixation_prob, 100),
        (expected_fixation_time, 100),
        (selection_coefficient_from_fitness, 0.5),
    ])
    def test_nan_in_first_arg_raises(self, fn, second_arg):
        with pytest.raises(ValueError, match="finite"):
            fn(float("nan"), second_arg)

    def test_nan_in_second_arg_select_coef_raises(self):
        with pytest.raises(ValueError, match="finite"):
            selection_coefficient_from_fitness(0.5, float("nan"))

    def test_analyze_selection_regime_nan_fit_high_raises(self):
        with pytest.raises(ValueError, match="finite"):
            analyze_selection_regime(float("nan"), 0.5, 100)

    @pytest.mark.parametrize("x", [float("nan"), float("inf"), float("-inf")])
    def test_drift_threshold_non_int_raises(self, x):
        with pytest.raises(ValueError, match="positive int"):
            drift_threshold(x)

    def test_drift_threshold_bool_raises(self):
        """True/False must be rejected (Python bool is int subclass)."""
        with pytest.raises(ValueError, match="positive int"):
            drift_threshold(True)

    def test_drift_threshold_float_raises(self):
        with pytest.raises(ValueError, match="positive int"):
            drift_threshold(5.5)

    def test_analyze_selection_regime_n_zero_raises_value_error(self):
        """Was: ZeroDivisionError from drift_threshold(0). After fix: ValueError."""
        with pytest.raises(ValueError, match="positive int"):
            analyze_selection_regime(0.9, 0.5, 0)
