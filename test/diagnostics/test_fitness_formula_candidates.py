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
