"""Tests for fitness_ceiling.py — delegates to the production scorer (Option C-PRIME).

The diagnostic module must NEVER drift from `alienclaw.fitness.function.evaluate`.
The `TestCrossValidation` class below is the structural guarantee of that.
"""
from __future__ import annotations

import math
import pytest

from alienclaw.diagnostics.fitness_ceiling import (
    compute_ceiling,
    analyze_formula,
    verify_ceiling_from_formula,
    ceiling_table,
)
from alienclaw.fitness.function import evaluate as _prod_evaluate
from alienclaw.fitness.types import FitnessInputs as _ProdFitnessInputs


def _prod_fitness(correctness, tool_calls, slot_count):
    """Convenience: call the production scorer and return .fitness."""
    return _prod_evaluate(_ProdFitnessInputs(
        correctness=correctness, tool_calls=tool_calls, slot_count=slot_count,
    )).fitness


class TestComputeCeiling:
    def test_single_slot(self):
        assert compute_ceiling(1) == 1.0

    def test_two_slots(self):
        assert compute_ceiling(2) == 1.0

    def test_three_slots(self):
        assert compute_ceiling(3) == 1.0

    def test_four_slots(self):
        assert compute_ceiling(4) == 1.0

    def test_k_equals_zero_raises(self):
        with pytest.raises(ValueError, match="k_slots"):
            compute_ceiling(0)

    def test_ceiling_is_constant_for_all_k(self):
        """C-PRIME: the structural ceiling is 1.0 for all k >= 1 (no 1/k)."""
        for k in range(1, 20):
            assert compute_ceiling(k) == 1.0


class TestAnalyzeFormula:
    def test_single_slot_perfect(self):
        result = analyze_formula([1.0], [1])
        assert result["fitness"] == pytest.approx(1.0)
        assert result["at_ceiling"] is True

    def test_two_slot_perfect_gives_1_0(self):
        """C-PRIME: k=2 perfect = 1.0 (NOT 0.5 as under the superseded Option C)."""
        result = analyze_formula([1.0, 1.0], [1, 1])
        assert result["fitness"] == pytest.approx(1.0)
        assert result["at_ceiling"] is True

    def test_two_slot_one_fails_reduces_fitness(self):
        result = analyze_formula([1.0, 0.0], [1, 1])
        assert result["fitness"] == pytest.approx(0.0)
        assert result["at_ceiling"] is False

    def test_extra_tool_calls_reduces_fitness(self):
        """C-PRIME: k=2 with tool_calls=3 (excess=1, alpha=0.1) -> efficiency=1/1.1."""
        perfect = analyze_formula([1.0, 1.0], [1, 1])
        extra = analyze_formula([1.0, 1.0], [2, 1])
        assert extra["fitness"] < perfect["fitness"]
        assert extra["at_ceiling"] is False
        assert extra["fitness"] == pytest.approx(1.0 / 1.1, abs=1e-9)

    def test_tool_calls_summed_correctly(self):
        """C-PRIME: excess = tool_calls_agg - slot_count = 5 - 2 = 3."""
        result = analyze_formula([0.8, 0.9], [2, 3])
        assert result["tool_calls_agg"] == 5
        assert result["correctness_agg"] == pytest.approx(0.8)
        assert result["slot_count"] == 2
        assert result["excess"] == 3
        assert result["efficiency"] == pytest.approx(1 / 1.3, abs=1e-9)
        assert result["fitness"] == pytest.approx(0.8 * (1.0 / 1.3), abs=1e-9)

    def test_correctness_clamped(self):
        result = analyze_formula([1.5], [1])
        assert result["correctness_agg"] <= 1.0
        assert result["fitness"] <= 1.0

    def test_fitness_non_negative(self):
        result = analyze_formula([0.0], [1])
        assert result["fitness"] >= 0.0

    def test_mismatched_lengths_raises(self):
        with pytest.raises(ValueError, match="same length"):
            analyze_formula([1.0, 1.0], [1])

    def test_empty_lists_raise_caller_facing_error(self):
        """analyze_formula([], []) must raise ValueError with a message that names
        the actual input (slot_correctnesses / slot_tool_calls), NOT a leaked
        parameter from an internal helper (k_slots)."""
        with pytest.raises(ValueError) as excinfo:
            analyze_formula([], [])
        msg = str(excinfo.value)
        assert "k_slots" not in msg, (
            f"error leaks internal helper argname 'k_slots': {msg!r}"
        )
        assert "slot_correctnesses" in msg or "slot_tool_calls" in msg, (
            f"error should name the caller's input; got: {msg!r}"
        )

    def test_mismatched_length_error_unchanged(self):
        """The existing length-mismatch arm must still raise its specific message."""
        with pytest.raises(ValueError, match="must have same length"):
            analyze_formula([1.0, 1.0], [1])

    def test_single_slot_regression_after_empty_guard(self):
        """Regression: the empty-input guard must not break k=1."""
        result = analyze_formula([1.0], [1])
        assert result["fitness"] == pytest.approx(1.0)
        assert result["at_ceiling"] is True


class TestFiniteDefense:
    """PKT-617: analyze_formula must coerce non-finite correctness_agg to 0.0.

    The guard lives on the AGGREGATION side of analyze_formula and must be
    preserved even though the score math is delegated to the production scorer
    (the production scorer guards the value it is HANDED, not the value this
    module aggregates out of slot_correctnesses).
    """

    def test_nan_in_slot_correctnesses_returns_zero(self):
        """T-PKT617-007: NaN in slot_correctnesses → correctness_agg=0.0, fitness=0.0, at_ceiling=False."""
        result = analyze_formula([float('nan'), 1.0], [1, 1])
        assert result['correctness_agg'] == 0.0
        assert result['fitness'] == 0.0
        assert result['at_ceiling'] is False

    def test_all_nan_in_slot_correctnesses_returns_zero(self):
        """T-PKT617-008: all NaN → correctness_agg=0.0, fitness=0.0, at_ceiling=False."""
        result = analyze_formula([float('nan'), float('nan')], [1, 1])
        assert result['correctness_agg'] == 0.0
        assert result['fitness'] == 0.0
        assert result['at_ceiling'] is False

    def test_pos_inf_correctness_agg_returns_zero(self):
        """T-PKT617-009: +Inf → correctness_agg=0.0, fitness=0.0 (NOT silently inflated to 1.0)."""
        result = analyze_formula([float('inf')], [1])
        assert result['correctness_agg'] == 0.0
        assert result['fitness'] == 0.0

    def test_neg_inf_correctness_agg_returns_zero(self):
        """T-PKT617-010: -Inf → correctness_agg=0.0, fitness=0.0 (NOT silently accepted as 0.0 by clamp01's -Inf coercion)."""
        result = analyze_formula([-float('inf')], [1])
        assert result['correctness_agg'] == 0.0
        assert result['fitness'] == 0.0

    def test_nan_correctness_does_not_leak_into_production_call(self):
        """The aggregation guard must fire BEFORE the production scorer is called.

        If the guard were removed, correctness_agg would be NaN and the
        production scorer would coerce it to 0.0 anyway — but the DICT FIELD
        would read NaN, and clamp01(NaN) would have inflated it to 1.0 in the
        pre-delegation implementation. Pin the dict field, not just the score.
        """
        result = analyze_formula([float('nan')], [1])
        assert math.isfinite(result['correctness_agg'])
        assert result['correctness_agg'] == 0.0


class TestCrossValidation:
    """analyze_formula MUST agree with fitness.function.evaluate for all inputs.

    This is the structural guarantee of the delegation pattern: the diagnostic
    cannot drift from production because it IS the production scorer.
    """

    def test_perfect_k2_matches_production(self):
        diag = analyze_formula([1.0, 1.0], [1, 1])
        prod = _prod_fitness(1.0, 2, 2)
        assert diag["fitness"] == pytest.approx(prod, abs=1e-9)

    def test_perfect_k4_matches_production(self):
        diag = analyze_formula([1.0, 1.0, 1.0, 1.0], [1, 1, 1, 1])
        prod = _prod_fitness(1.0, 4, 4)
        assert diag["fitness"] == pytest.approx(prod, abs=1e-9)

    def test_extra_tool_calls_matches_production(self):
        diag = analyze_formula([1.0, 1.0], [3, 2])
        prod = _prod_fitness(1.0, 5, 2)
        assert diag["fitness"] == pytest.approx(prod, abs=1e-9)

    def test_partial_correctness_matches_production(self):
        diag = analyze_formula([0.7, 0.9, 0.5], [2, 1, 3])
        prod = _prod_fitness(0.5, 6, 3)
        assert diag["fitness"] == pytest.approx(prod, abs=1e-9)

    def test_ceiling_k8_matches_production(self):
        """k=8 perfect composition: ceiling is 1.0 under C-PRIME."""
        diag = analyze_formula([1.0] * 8, [1] * 8)
        prod = _prod_fitness(1.0, 8, 8)
        assert diag["fitness"] == pytest.approx(prod, abs=1e-9)
        assert diag["fitness"] == pytest.approx(1.0)
        assert diag["at_ceiling"] is True

    def test_efficiency_matches_production(self):
        diag = analyze_formula([0.9, 0.9], [2, 3])
        prod = _prod_evaluate(_ProdFitnessInputs(
            correctness=0.9, tool_calls=5, slot_count=2,
        ))
        assert diag["efficiency"] == pytest.approx(prod.efficiency, abs=1e-9)

    def test_no_one_over_k_drift(self):
        """The pre-fix defect: diagnostic under-predicted production by exactly k×.

        Pin the FULL k=1..8 sweep so a future re-introduction of the stale
        Option C formula (1/k ceiling) is caught for every k, not just one.
        """
        for k in range(1, 9):
            diag = analyze_formula([1.0] * k, [1] * k)
            prod = _prod_fitness(1.0, k, k)
            assert diag["fitness"] == pytest.approx(prod, abs=1e-9), (
                f"k={k}: diagnostic {diag['fitness']} != production {prod}"
            )


class TestVerifyCeilingFromFormula:
    def test_k1_ceiling_confirmed(self):
        result = verify_ceiling_from_formula(1)
        assert result["ceiling_confirmed"] is True
        assert result["formula_result"] == pytest.approx(1.0)

    def test_k2_ceiling_confirmed(self):
        """C-PRIME: k=2 ceiling is 1.0, not 0.5."""
        result = verify_ceiling_from_formula(2)
        assert result["ceiling_confirmed"] is True
        assert result["formula_result"] == pytest.approx(1.0)

    def test_k3_ceiling_confirmed(self):
        result = verify_ceiling_from_formula(3)
        assert result["ceiling_confirmed"] is True
        assert result["formula_result"] == pytest.approx(1.0)

    def test_k8_ceiling_confirmed(self):
        result = verify_ceiling_from_formula(8)
        assert result["ceiling_confirmed"] is True
        assert result["formula_result"] == pytest.approx(1.0)


class TestCeilingTable:
    def test_table_length(self):
        t = ceiling_table(8)
        assert len(t) == 8

    def test_k1_is_1_0(self):
        t = ceiling_table(5)
        assert t[0]["ceiling"] == 1.0

    def test_ceiling_constant_across_k(self):
        """C-PRIME: all k have ceiling 1.0."""
        t = ceiling_table(8)
        for entry in t:
            assert entry["ceiling"] == 1.0
            assert entry["ceiling_pct"] == 100.0
