"""Tests for fitness_ceiling.py (H1 hypothesis)."""
from __future__ import annotations

import math
import pytest

from alienclaw.diagnostics.fitness_ceiling import (
    compute_ceiling,
    analyze_formula,
    verify_ceiling_from_formula,
    ceiling_table,
)


class TestComputeCeiling:
    def test_single_slot(self):
        assert compute_ceiling(1) == 1.0

    def test_two_slots(self):
        assert compute_ceiling(2) == pytest.approx(0.500, abs=1e-9)

    def test_three_slots(self):
        assert compute_ceiling(3) == pytest.approx(1/3, abs=1e-9)

    def test_four_slots(self):
        assert compute_ceiling(4) == pytest.approx(0.250, abs=1e-9)

    def test_k_equals_zero_raises(self):
        with pytest.raises(ValueError, match="k_slots"):
            compute_ceiling(0)

    def test_decreasing_with_k(self):
        ceilings = [compute_ceiling(k) for k in range(1, 6)]
        for i in range(len(ceilings) - 1):
            assert ceilings[i] > ceilings[i + 1]


class TestAnalyzeFormula:
    def test_single_slot_perfect(self):
        result = analyze_formula([1.0], [1])
        assert result["fitness"] == pytest.approx(1.0)
        assert result["at_ceiling"] is True

    def test_two_slot_perfect_gives_0_5(self):
        result = analyze_formula([1.0, 1.0], [1, 1])
        assert result["fitness"] == pytest.approx(0.500, abs=1e-9)
        assert result["at_ceiling"] is True

    def test_two_slot_one_fails_reduces_fitness(self):
        result = analyze_formula([1.0, 0.0], [1, 1])
        assert result["fitness"] == pytest.approx(0.0)
        assert result["at_ceiling"] is False

    def test_extra_tool_calls_reduces_fitness(self):
        perfect = analyze_formula([1.0, 1.0], [1, 1])
        extra = analyze_formula([1.0, 1.0], [2, 1])
        assert extra["fitness"] < perfect["fitness"]
        assert extra["at_ceiling"] is False

    def test_tool_calls_summed_correctly(self):
        result = analyze_formula([0.8, 0.9], [2, 3])
        assert result["tool_calls_agg"] == 5
        assert result["correctness_agg"] == pytest.approx(0.8)
        assert result["efficiency"] == pytest.approx(1/5)

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


class TestVerifyCeilingFromFormula:
    def test_k1_ceiling_confirmed(self):
        result = verify_ceiling_from_formula(1)
        assert result["ceiling_confirmed"] is True
        assert result["formula_result"] == pytest.approx(1.0)

    def test_k2_ceiling_confirmed(self):
        result = verify_ceiling_from_formula(2)
        assert result["ceiling_confirmed"] is True
        assert result["formula_result"] == pytest.approx(0.5)

    def test_k3_ceiling_confirmed(self):
        result = verify_ceiling_from_formula(3)
        assert result["ceiling_confirmed"] is True
        assert result["formula_result"] == pytest.approx(1/3, abs=1e-9)


class TestCeilingTable:
    def test_table_length(self):
        t = ceiling_table(8)
        assert len(t) == 8

    def test_k1_is_1_0(self):
        t = ceiling_table(5)
        assert t[0]["ceiling"] == 1.0

    def test_k2_is_0_5(self):
        t = ceiling_table(5)
        assert t[1]["ceiling"] == pytest.approx(0.5)
