"""Direct unit tests for alienclaw.fitness.function — the canonical v2.0 formula.

Option C-prime (adopted in Packet 28):

    fitness = correctness x 1 / (1 + alpha x max(0, tool_calls - slot_count))

with alpha = 0.1 (Bayesian-optimized in Packet 27, hardcoded per Packet 28).
The first slot_count tool calls are free; each excess call applies a gentle
multiplicative penalty. These tests document the formula exactly — they must
never drive a change to it.
"""
import pytest

from alienclaw.fitness.function import evaluate
from alienclaw.fitness.types import FitnessInputs, FitnessResult


class TestNoPenaltyBoundary:
    @pytest.mark.parametrize("k", [1, 2, 3, 8, 16])
    def test_tool_calls_equal_slot_count_gives_full_efficiency(self, k):
        r = evaluate(FitnessInputs(correctness=0.6, tool_calls=k, slot_count=k))
        assert r.efficiency == 1.0
        assert r.fitness == 0.6  # exactly correctness — no 1/k ceiling

    def test_tool_calls_below_slot_count_is_not_penalized_or_rewarded(self):
        r = evaluate(FitnessInputs(correctness=0.9, tool_calls=1, slot_count=4))
        assert r.efficiency == 1.0
        assert r.fitness == pytest.approx(0.9)

    def test_zero_tool_calls_no_penalty(self):
        r = evaluate(FitnessInputs(correctness=1.0, tool_calls=0, slot_count=1))
        assert r.fitness == 1.0
        assert r.efficiency == 1.0

    def test_negative_tool_calls_clamped_to_zero_excess(self):
        # max(0, ...) guard: nonsensical negative counts cannot inflate fitness.
        r = evaluate(FitnessInputs(correctness=1.0, tool_calls=-3, slot_count=1))
        assert r.efficiency == 1.0
        assert r.fitness == 1.0


class TestExcessPenalty:
    @pytest.mark.parametrize("excess", [1, 2, 3, 5, 10])
    def test_efficiency_decays_per_formula_for_each_extra_call(self, excess):
        r = evaluate(FitnessInputs(correctness=1.0, tool_calls=2 + excess, slot_count=2))
        assert r.efficiency == pytest.approx(1.0 / (1.0 + 0.1 * excess))
        assert r.fitness == pytest.approx(r.efficiency)

    def test_single_excess_call_exact_value(self):
        r = evaluate(FitnessInputs(correctness=1.0, tool_calls=2, slot_count=1))
        assert r.fitness == pytest.approx(1.0 / 1.1)

    def test_ten_excess_calls_exactly_halve_fitness(self):
        # 1 + 0.1 * 10 == 2.0 exactly in IEEE-754, so efficiency is exactly 0.5.
        r = evaluate(FitnessInputs(correctness=1.0, tool_calls=11, slot_count=1))
        assert r.efficiency == 0.5
        assert r.fitness == 0.5

    def test_alpha_is_locked_at_0_1(self):
        # Recover alpha from a single excess call: 1/efficiency - 1 == alpha.
        r = evaluate(FitnessInputs(correctness=1.0, tool_calls=4, slot_count=3))
        assert 1.0 / r.efficiency - 1.0 == pytest.approx(0.1)

    def test_fitness_is_correctness_times_efficiency(self):
        r = evaluate(FitnessInputs(correctness=0.5, tool_calls=4, slot_count=2))
        assert r.fitness == pytest.approx(0.5 / 1.2)
        assert r.fitness == pytest.approx(r.correctness * r.efficiency)

    def test_fitness_is_monotone_nonincreasing_in_tool_calls(self):
        fits = [
            evaluate(FitnessInputs(correctness=0.8, tool_calls=n, slot_count=3)).fitness
            for n in range(12)
        ]
        assert all(a >= b for a, b in zip(fits, fits[1:]))
        assert fits[0] == fits[3]  # tool_calls 0..3 are all inside the free band


class TestCorrectnessClamping:
    def test_correctness_zero_gives_zero_fitness_but_full_efficiency(self):
        r = evaluate(FitnessInputs(correctness=0.0, tool_calls=1, slot_count=1))
        assert r.fitness == 0.0
        assert r.efficiency == 1.0

    def test_correctness_one_no_excess_gives_fitness_one(self):
        r = evaluate(FitnessInputs(correctness=1.0, tool_calls=1, slot_count=1))
        assert r.fitness == 1.0

    def test_correctness_above_one_is_clamped(self):
        r = evaluate(FitnessInputs(correctness=2.5, tool_calls=1, slot_count=1))
        assert r.correctness == 1.0
        assert r.fitness == 1.0

    def test_correctness_below_zero_is_clamped(self):
        r = evaluate(FitnessInputs(correctness=-1.0, tool_calls=1, slot_count=1))
        assert r.correctness == 0.0
        assert r.fitness == 0.0


class TestErrorPath:
    def test_error_zeroes_fitness_and_efficiency(self):
        r = evaluate(FitnessInputs(correctness=0.9, tool_calls=1, error="boom"))
        assert r.fitness == 0.0
        assert r.efficiency == 0.0

    def test_error_path_passes_correctness_through_unclamped(self):
        # Documents current behavior: the error early-return echoes the raw
        # input correctness, skipping the clamp applied on the success path.
        r = evaluate(FitnessInputs(correctness=1.7, tool_calls=1, error="boom"))
        assert r.correctness == 1.7

    def test_empty_string_error_still_counts_as_error(self):
        # The guard is `error is not None`, not truthiness.
        r = evaluate(FitnessInputs(correctness=1.0, tool_calls=1, error=""))
        assert r.fitness == 0.0
        assert r.efficiency == 0.0


class TestResultMetadata:
    def test_formula_version_v2_on_success_path(self):
        r = evaluate(FitnessInputs(correctness=1.0, tool_calls=1))
        assert isinstance(r, FitnessResult)
        assert r.formula_version == "v2.0"

    def test_formula_version_v2_on_error_path(self):
        r = evaluate(FitnessInputs(correctness=1.0, tool_calls=1, error="x"))
        assert r.formula_version == "v2.0"

    def test_default_slot_count_is_one(self):
        # FitnessInputs defaults slot_count=1: the second call is the first excess.
        r = evaluate(FitnessInputs(correctness=1.0, tool_calls=2))
        assert r.efficiency == pytest.approx(1.0 / 1.1)
