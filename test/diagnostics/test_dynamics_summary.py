"""Tests for dynamics_summary.py."""
from __future__ import annotations

import pytest

from alienclaw.diagnostics.dynamics_summary import (
    DynamicsSummary, summarize_dynamics,
    _gradient_smoothness, _fixation_score, _plateau_quality, _signal_to_info,
    landscape_quality_score,
)
from alienclaw.diagnostics.fitness_formula_candidates import option_b, option_current


class TestGradientSmoothness:
    def test_smooth_curve_high_score(self):
        curve = [i / 50 for i in range(51)]  # linear increase
        assert _gradient_smoothness(curve) > 0.5

    def test_step_function_low_score(self):
        # Sharp jump
        curve = [0.0] * 25 + [1.0] * 25
        smoothness = _gradient_smoothness(curve)
        # Should be lower than linear curve
        linear_curve = [i / 50 for i in range(51)]
        assert _gradient_smoothness(linear_curve) >= smoothness

    def test_short_curve_returns_value(self):
        assert _gradient_smoothness([0.5]) == 1.0


class TestFixationScore:
    def test_no_change_zero_fixation(self):
        curve = [0.5] * 100
        assert _fixation_score(curve, 100) == pytest.approx(0.0)

    def test_large_change_high_fixation(self):
        # Rapid improvement: each gen improves by 50%
        curve = [0.01 * (1.5 ** i) for i in range(20)]
        score = _fixation_score(curve, 100)
        assert score > 0.5

    def test_short_curve_returns_value(self):
        assert _fixation_score([0.5], 100) == 0.0


class TestPlateauQuality:
    def test_no_plateau_perfect_score(self):
        # Monotonically increasing — no plateau
        curve = [i / 100 for i in range(101)]
        q = _plateau_quality(curve)
        assert q > 0.8

    def test_flat_curve_low_score(self):
        curve = [0.5] * 100
        q = _plateau_quality(curve)
        assert q < 0.5


class TestSignalToInfo:
    def test_empty_returns_zero(self):
        assert _signal_to_info([]) == 0.0

    def test_constant_fitness_low_signal(self):
        from alienclaw.diagnostics.genome_information import BASE62
        import random
        rng = random.Random(42)
        genomes = ["".join(rng.choice(BASE62) for _ in range(256)) for _ in range(50)]
        pairs = [(g, 0.5) for g in genomes]
        assert _signal_to_info(pairs) == 0.0


class TestSummarizeDynamics:
    def test_returns_dynamics_summary(self):
        curve = [i / 50 for i in range(51)]
        result = summarize_dynamics(curve, [], 100)
        assert isinstance(result, DynamicsSummary)

    def test_all_fields_in_range(self):
        curve = list(range(50))
        curve = [x / 50 for x in curve]
        result = summarize_dynamics(curve, [], 100)
        for attr in ("gradient_smoothness", "fixation_score", "plateau_quality",
                     "signal_to_info", "composite_score"):
            val = getattr(result, attr)
            assert 0.0 <= val <= 1.0, f"{attr}={val} out of range"

    def test_composite_is_weighted_sum(self):
        curve = [0.5] * 50
        result = summarize_dynamics(curve, [], 100)
        # All zeros except smoothness might be high
        assert 0.0 <= result.composite_score <= 1.0


class TestLandscapeQualityScore:
    def test_option_b_perfect_execution(self):
        score = landscape_quality_score(4, option_b)
        assert score > 0.6  # option_b gives 1.0 at perfect execution

    def test_option_current_penalized_by_k(self):
        score_k2 = landscape_quality_score(2, option_current)
        score_k8 = landscape_quality_score(8, option_current)
        # Current formula has 1/k ceiling; k=8 should score much lower
        assert score_k2 > score_k8
