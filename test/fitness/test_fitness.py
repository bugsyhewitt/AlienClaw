"""Tests for the fitness formula (Option C-prime, adopted in Packet 28)."""
import random

import pytest
from alienclaw.fitness import evaluate, FitnessInputs


class TestEvaluate:
    def test_error_returns_zero_fitness(self):
        result = evaluate(FitnessInputs(correctness=0.9, tool_calls=1, error="failed"))
        assert result.fitness == 0.0
        assert result.efficiency == 0.0

    def test_one_tool_call_full_correctness(self):
        result = evaluate(FitnessInputs(correctness=1.0, tool_calls=1))
        assert result.fitness == pytest.approx(1.0)
        assert result.correctness == pytest.approx(1.0)
        assert result.efficiency == pytest.approx(1.0)

    def test_efficiency_decreases_with_more_tool_calls(self):
        # slot_count defaults to 1; excess = tool_calls - 1
        # r1: no excess → efficiency=1.0
        # r2: 1 excess → efficiency=1/1.1
        # r4: 3 excess → efficiency=1/1.3
        r1 = evaluate(FitnessInputs(correctness=1.0, tool_calls=1))
        r2 = evaluate(FitnessInputs(correctness=1.0, tool_calls=2))
        r4 = evaluate(FitnessInputs(correctness=1.0, tool_calls=4))
        assert r1.fitness > r2.fitness > r4.fitness

    def test_fitness_formula_correctness_times_efficiency(self):
        # slot_count=1, tool_calls=2, excess=1, efficiency=1/1.1
        result = evaluate(FitnessInputs(correctness=0.8, tool_calls=2))
        assert result.fitness == pytest.approx(0.8 / 1.1, rel=1e-6)
        assert result.efficiency == pytest.approx(1.0 / 1.1, rel=1e-6)

    def test_zero_tool_calls_treated_as_zero_excess(self):
        # tool_calls=0, slot_count=1 default: excess = max(0, 0-1) = 0 → no penalty
        r0 = evaluate(FitnessInputs(correctness=1.0, tool_calls=0))
        r1 = evaluate(FitnessInputs(correctness=1.0, tool_calls=1))
        assert r0.fitness == pytest.approx(r1.fitness)

    def test_correctness_clamped_above_one(self):
        result = evaluate(FitnessInputs(correctness=1.5, tool_calls=1))
        assert result.correctness == pytest.approx(1.0)
        assert result.fitness == pytest.approx(1.0)

    def test_correctness_clamped_below_zero(self):
        result = evaluate(FitnessInputs(correctness=-0.5, tool_calls=1))
        assert result.correctness == pytest.approx(0.0)
        assert result.fitness == pytest.approx(0.0)

    def test_formula_version_is_v2(self):
        result = evaluate(FitnessInputs(correctness=1.0, tool_calls=1))
        assert result.formula_version == "v2.0"

    def test_partial_correctness_with_many_calls(self):
        result = evaluate(FitnessInputs(correctness=0.75, tool_calls=1))
        assert result.fitness == pytest.approx(0.75)

    def test_error_with_zero_correctness(self):
        result = evaluate(FitnessInputs(correctness=0.0, tool_calls=0, error="crash"))
        assert result.fitness == 0.0
        assert result.efficiency == 0.0


class TestOptionCPrimeProperties:
    """New tests verifying Option C-prime mathematical properties (Packet 28)."""

    def test_no_excess_equals_correctness(self):
        """When tool_calls = slot_count, fitness = correctness at any k."""
        for k in [1, 2, 4, 8, 16]:
            result = evaluate(FitnessInputs(correctness=1.0, tool_calls=k, slot_count=k))
            assert result.fitness == pytest.approx(1.0), f"k={k}: expected 1.0, got {result.fitness}"
        result = evaluate(FitnessInputs(correctness=0.7, tool_calls=4, slot_count=4))
        assert result.fitness == pytest.approx(0.7)

    def test_one_excess_penalty(self):
        """1 excess tool call: fitness = correctness / 1.1."""
        result = evaluate(FitnessInputs(correctness=1.0, tool_calls=3, slot_count=2))
        assert result.fitness == pytest.approx(1.0 / 1.1, rel=1e-6)

    def test_three_excess_penalty(self):
        """3 excess tool calls: fitness = correctness / 1.3."""
        result = evaluate(FitnessInputs(correctness=1.0, tool_calls=5, slot_count=2))
        assert result.fitness == pytest.approx(1.0 / 1.3, rel=1e-6)

    def test_no_ceiling_at_k_equals_8(self):
        """8-slot perfect execution yields fitness = 1.0 (no 0.125 ceiling)."""
        result = evaluate(FitnessInputs(correctness=1.0, tool_calls=8, slot_count=8))
        assert result.fitness == pytest.approx(1.0)

    def test_no_ceiling_at_k_equals_16(self):
        """16-slot perfect execution yields fitness = 1.0."""
        result = evaluate(FitnessInputs(correctness=1.0, tool_calls=16, slot_count=16))
        assert result.fitness == pytest.approx(1.0)

    def test_fitness_always_in_unit_interval(self):
        """Fitness always in [0, 1] for any valid inputs."""
        rng = random.Random(42)
        for _ in range(200):
            correctness = rng.random()
            slot_count = rng.randint(1, 16)
            tool_calls = rng.randint(0, slot_count * 5)
            result = evaluate(FitnessInputs(correctness=correctness, tool_calls=tool_calls,
                                            slot_count=slot_count))
            assert 0.0 <= result.fitness <= 1.0

    def test_error_returns_zero_regardless_of_slot_count(self):
        """Error field always yields fitness=0."""
        for k in [1, 2, 4, 8]:
            result = evaluate(FitnessInputs(correctness=1.0, tool_calls=k, slot_count=k, error="fail"))
            assert result.fitness == 0.0

    def test_monotonically_decreasing_with_excess(self):
        """More excess → lower fitness, holding correctness and slot_count constant."""
        fitnesses = [
            evaluate(FitnessInputs(correctness=1.0, tool_calls=2 + excess, slot_count=2)).fitness
            for excess in range(6)
        ]
        for i in range(len(fitnesses) - 1):
            assert fitnesses[i] > fitnesses[i + 1]
