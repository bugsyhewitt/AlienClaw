"""Tests for fitness_formula_candidates.py."""
from __future__ import annotations

import pytest

from alienclaw.diagnostics.fitness_formula_candidates import (
    option_current, option_b, option_c_prime, option_d,
    FitnessFormulaResult, landscape_grid,
)


class TestOptionCurrent:
    def test_single_slot_perfect(self):
        r = option_current(1.0, 1, 1)
        assert r.fitness == pytest.approx(1.0)

    def test_two_slot_perfect_gives_0_5(self):
        r = option_current(1.0, 2, 2)
        assert r.fitness == pytest.approx(0.5)

    def test_k_slot_ceiling(self):
        for k in [2, 4, 8]:
            r = option_current(1.0, k, k)
            assert r.fitness == pytest.approx(1.0 / k, abs=1e-9)


class TestOptionB:
    def test_perfect_execution_equals_correctness(self):
        """B: slot_count/tool_calls = k/k = 1 when tool_calls = slot_count."""
        for k in [1, 2, 4, 8]:
            r = option_b(1.0, k, k)
            assert r.fitness == pytest.approx(1.0), f"k={k}: expected 1.0, got {r.fitness}"

    def test_no_ceiling_at_k8(self):
        r = option_b(1.0, 8, 8)
        assert r.fitness == pytest.approx(1.0)

    def test_excess_tool_calls_reduces_fitness(self):
        r_perfect = option_b(1.0, 4, 4)
        r_excess = option_b(1.0, 6, 4)  # 2 excess
        assert r_excess.fitness < r_perfect.fitness

    def test_zero_correctness(self):
        r = option_b(0.0, 4, 4)
        assert r.fitness == 0.0


class TestOptionCPrime:
    def test_no_excess_equals_correctness(self):
        """With no excess tool calls, fitness = correctness."""
        for k in [1, 2, 4, 8]:
            r = option_c_prime(1.0, k, k, alpha=0.5)
            assert r.fitness == pytest.approx(1.0)

    def test_no_ceiling_at_k8(self):
        r = option_c_prime(1.0, 8, 8, alpha=1.0)
        assert r.fitness == pytest.approx(1.0)

    def test_excess_penalized_multiplicatively(self):
        # With 1 excess and alpha=1.0: 1 / (1 + 1*1) = 0.5
        r = option_c_prime(1.0, slot_count=2 + 1 - 1, tool_calls=3, alpha=1.0)
        # slot_count=2, tool_calls=3, excess=1, alpha=1.0 → 1/(1+1)=0.5
        r2 = option_c_prime(1.0, 3, 2, alpha=1.0)
        assert r2.fitness == pytest.approx(0.5, abs=1e-9)

    def test_higher_alpha_steeper_penalty(self):
        r_low = option_c_prime(1.0, 3, 2, alpha=0.5)
        r_high = option_c_prime(1.0, 3, 2, alpha=2.0)
        assert r_high.fitness < r_low.fitness

    def test_fitness_non_negative(self):
        r = option_c_prime(0.0, 8, 2, alpha=5.0)
        assert r.fitness >= 0.0


class TestOptionD:
    def test_no_excess_equals_correctness(self):
        """With no excess tool calls, fitness = correctness."""
        for k in [1, 2, 4, 8]:
            r = option_d(1.0, k, k, beta=0.5)
            assert r.fitness == pytest.approx(1.0)

    def test_no_ceiling_at_k8(self):
        r = option_d(1.0, 8, 8, beta=1.0)
        assert r.fitness == pytest.approx(1.0)

    def test_additive_penalty(self):
        # slot_count=2, tool_calls=3, excess=1, beta=1.0: 1.0 - 1.0*(1/2) = 0.5
        r = option_d(1.0, 3, 2, beta=1.0)
        assert r.fitness == pytest.approx(0.5, abs=1e-9)

    def test_fitness_clamped_to_zero(self):
        # Large excess: fitness should not go negative
        r = option_d(0.5, 100, 2, beta=10.0)
        assert r.fitness >= 0.0


class TestFitnessFormulaResult:
    def test_fields_present(self):
        r = option_b(0.7, 4, 4)
        assert hasattr(r, "fitness")
        assert hasattr(r, "correctness")
        assert hasattr(r, "tool_calls")
        assert hasattr(r, "slot_count")
        assert hasattr(r, "formula_name")

    def test_fitness_in_range(self):
        for formula in [option_current, option_b, lambda c,tc,sc: option_c_prime(c,tc,sc,1.0), lambda c,tc,sc: option_d(c,tc,sc,1.0)]:
            r = formula(0.8, 4, 3)
            assert 0.0 <= r.fitness <= 1.0


class TestFiniteDefense:
    """PKT-617: clamp01(NaN) silently returns 1.0; the 4 candidate formulas must
    coerce non-finite correctness to 0.0 (mirror PKT-588's fitness/function.py:32-33)."""

    @pytest.mark.parametrize("formula", [option_current, option_b, option_c_prime, option_d])
    def test_nan_correctness_returns_zero_fitness(self, formula):
        """T-PKT617-001 to T-PKT617-004: NaN correctness → fitness=0.0 (NOT silently inflated to 1.0)."""
        r = formula(float('nan'), 1, 1)
        assert r.fitness == 0.0, f"NaN should coerce to 0.0 fitness, got {r.fitness}"

    @pytest.mark.parametrize("formula", [option_current, option_b, option_c_prime, option_d])
    def test_pos_inf_correctness_returns_zero_fitness(self, formula):
        """T-PKT617-005: +Inf correctness → fitness=0.0 (NOT silently accepted as 1.0)."""
        r = formula(float('inf'), 1, 1)
        assert r.fitness == 0.0, f"+Inf should coerce to 0.0 fitness, got {r.fitness}"

    @pytest.mark.parametrize("formula", [option_current, option_b, option_c_prime, option_d])
    def test_neg_inf_correctness_returns_zero_fitness(self, formula):
        """T-PKT617-006: -Inf correctness → fitness=0.0 (NOT silently accepted as 0.0 by clamp01's -Inf coercion)."""
        r = formula(-float('inf'), 1, 1)
        assert r.fitness == 0.0, f"-Inf should coerce to 0.0 fitness, got {r.fitness}"

    def test_nan_correctness_preserves_raw_in_result(self):
        """Raw correctness field must be preserved as-is for debugging (not coerced)."""
        import math
        r = option_b(float('nan'), 1, 1)
        assert math.isnan(r.correctness), "Raw correctness field should remain NaN for traceability"


class TestNonFiniteToolCalls:
    """PKT-715: all 4 formulas must coerce non-finite tool_calls to a deterministic
    default, not silently inflate fitness to correctness via max(1,NaN)=1 path."""

    @pytest.mark.parametrize("formula,default", [
        (option_current, 1),
        (option_b, 1),
        (option_c_prime, 1),
        (option_d, 1),
    ])
    @pytest.mark.parametrize("bad_tc", [float('nan'), float('inf'), -float('inf')])
    def test_non_finite_tool_calls_does_not_silently_inflate(self, formula, default, bad_tc):
        """R-PKT715-001 to R-PKT715-012: 4 formulas × 3 non-finite = 12 cases.
        After fix, fitness must equal what (1.0, default, 4) produces deterministically."""
        r = formula(1.0, bad_tc, 4)
        r_control = formula(1.0, default, 4)
        assert r.fitness == pytest.approx(r_control.fitness, abs=1e-9), (
            f"non-finite tool_calls={bad_tc} silently changed fitness={r.fitness} "
            f"(expected {r_control.fitness} from default tc={default})"
        )

    @pytest.mark.parametrize("formula", [option_current, option_b, option_c_prime, option_d])
    def test_tool_calls_nan_does_not_inflate_when_correctness_low(self, formula):
        """tool_calls=NaN + correctness=0.3 must return fitness ≤ 0.3, not 1.0."""
        r = formula(0.3, float('nan'), 4)
        assert r.fitness <= 0.3, (
            f"tool_calls=NaN + correctness=0.3 silently inflated fitness={r.fitness}"
        )


class TestNonFiniteSlotCount:
    """PKT-715: option_c_prime/d must coerce non-finite slot_count."""

    @pytest.mark.parametrize("formula", [option_c_prime, option_d])
    @pytest.mark.parametrize("bad_sc", [float('nan'), float('inf'), -float('inf')])
    def test_non_finite_slot_count_does_not_silently_inflate(self, formula, bad_sc):
        """R-PKT715-013 to R-PKT715-018: 2 formulas × 3 non-finite = 6 cases."""
        r = formula(1.0, 4, bad_sc)
        assert r.fitness < 1.0, (
            f"non-finite slot_count={bad_sc} silently inflated fitness={r.fitness}"
        )


class TestNonFiniteAlpha:
    """PKT-715: option_c_prime must coerce non-finite alpha to 1.0 (not clamp01(NaN)=1.0)."""

    @pytest.mark.parametrize("bad_alpha", [float('nan'), float('inf'), -float('inf')])
    def test_non_finite_alpha_does_not_silently_inflate(self, bad_alpha):
        """R-PKT715-019 to R-PKT715-021: 3 cases.
        Non-finite alpha coerces to 1.0; excess=4, fitness = 1/(1+1*4) = 0.2."""
        r = option_c_prime(1.0, 8, 4, alpha=bad_alpha)
        assert r.fitness == pytest.approx(0.2, abs=1e-9), (
            f"non-finite alpha={bad_alpha} silently inflated fitness={r.fitness} "
            f"(expected 0.2 from alpha=1.0 default)"
        )


class TestNonFiniteBeta:
    """PKT-715: option_d must coerce non-finite beta to 1.0."""

    @pytest.mark.parametrize("bad_beta", [float('nan'), float('inf'), -float('inf')])
    def test_non_finite_beta_does_not_silently_inflate(self, bad_beta):
        """R-PKT715-022 to R-PKT715-024: 3 cases.
        Non-finite beta coerces to 1.0; excess=4, penalty=1*4/4=1, fitness=clamp01(0)=0."""
        r = option_d(1.0, 8, 4, beta=bad_beta)
        assert r.fitness == pytest.approx(0.0, abs=1e-9), (
            f"non-finite beta={bad_beta} silently inflated fitness={r.fitness} "
            f"(expected 0.0 from beta=1.0 default)"
        )


class TestOptionBClamp01NaNViolation:
    """PKT-715: option_b's dual-NaN PKT-617 clamp01(NaN)=1.0 violation."""

    def test_dual_nan_in_option_b_returns_deterministic_fitness(self):
        """R-PKT715-025: option_b(1.0, NaN, NaN) must be deterministic (not NaN-path dependent)."""
        import math as _math
        r = option_b(1.0, float('nan'), float('nan'))
        r2 = option_b(1.0, float('nan'), float('nan'))
        assert r.fitness == r2.fitness, (
            f"dual-NaN must be deterministic: {r.fitness} vs {r2.fitness}"
        )
        assert _math.isnan(r.tool_calls), "Raw tool_calls field should remain NaN for traceability"
        assert _math.isnan(r.slot_count), "Raw slot_count field should remain NaN for traceability"

    def test_dual_nan_correctness_is_zero(self):
        """R-PKT715-026: option_b(NaN, NaN, NaN) must return fitness=0.0 (PKT-617 correctness guard)."""
        r = option_b(float('nan'), float('nan'), float('nan'))
        assert r.fitness == 0.0, (
            f"triple-NaN must produce fitness=0.0 (PKT-617 correctness guard), got {r.fitness}"
        )


class TestTypeErrors:
    """PKT-715: type-unsafe inputs (None/str/list/dict) must coerce to defaults, not crash."""

    @pytest.mark.parametrize("formula", [option_current, option_b, option_c_prime, option_d])
    @pytest.mark.parametrize("bad_input", [None, '3', [1], {'a': 1}])
    def test_type_unsafe_tool_calls_returns_default(self, formula, bad_input):
        """R-PKT715-027 to R-PKT715-042: 4 formulas × 4 type-errors = 16 cases.
        Previously raised TypeError; after fix returns deterministic default."""
        r = formula(1.0, bad_input, 4)
        r_control = formula(1.0, 1, 4)
        assert r.fitness == pytest.approx(r_control.fitness, abs=1e-9)


class TestLandscapeGrid:
    def test_grid_structure(self):
        rows = landscape_grid(slot_count=2)
        assert len(rows) > 0
        for row in rows[:5]:
            for key in ("formula", "slot_count", "correctness", "tool_calls", "fitness"):
                assert key in row

    def test_current_formula_shows_ceiling(self):
        rows = landscape_grid(slot_count=4, correctness_values=[1.0], excess_values=[0])
        for row in rows:
            if row["formula"] == "current":
                assert row["fitness"] == pytest.approx(1.0 / 4, abs=0.01)
            else:
                assert row["fitness"] == pytest.approx(1.0, abs=0.01)

    def test_custom_formulas_override_defaults(self):
        """Custom formulas dict bypasses the default set (covers the formulas-is-not-None branch)."""
        custom = {"only_b": option_b}
        rows = landscape_grid(
            slot_count=2,
            correctness_values=[1.0],
            excess_values=[0],
            formulas=custom,
        )
        assert len(rows) == 1
        assert rows[0]["formula"] == "only_b"
        assert rows[0]["fitness"] == pytest.approx(1.0)
