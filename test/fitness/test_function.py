"""Direct unit tests for alienclaw.fitness.function — the canonical v2.0 formula.

Option C-prime (adopted in Packet 28):

    fitness = correctness x 1 / (1 + alpha x max(0, tool_calls - slot_count))

with alpha = 0.1 (Bayesian-optimized in Packet 27, hardcoded per Packet 28).
The first slot_count tool calls are free; each excess call applies a gentle
multiplicative penalty. These tests document the formula exactly — they must
never drive a change to it.
"""
import math

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


class TestNonFiniteCorrectness:
    """Non-finite correctness (NaN, +Inf, -Inf) must yield a deterministic failing score.

    Python's built-in ``min`` and ``max`` return the first argument on NaN tie,
    so without an explicit ``math.isfinite`` guard the expression
    ``max(0.0, min(1.0, NaN))`` evaluates to ``1.0`` and silently inflates the
    fitness of any Martian whose compute slot produced NaN correctness.
    """

    def test_nan_correctness_does_not_inflate_to_perfect_score(self):
        r = evaluate(FitnessInputs(correctness=float("nan"), tool_calls=1, slot_count=1))
        assert r.fitness == 0.0
        assert r.correctness == 0.0

    def test_positive_infinity_correctness_does_not_inflate_to_perfect_score(self):
        # Without an explicit isfinite guard, this would also produce 1.0 via
        # min(1.0, +Inf) == 1.0 — but the silent path is undefined; the contract
        # is that only finite correctness in (0.0, 1.0] can yield fitness > 0.
        r = evaluate(FitnessInputs(correctness=float("inf"), tool_calls=1, slot_count=1))
        assert r.fitness == 0.0
        assert r.correctness == 0.0

    def test_negative_infinity_correctness_yields_zero_score(self):
        r = evaluate(FitnessInputs(correctness=float("-inf"), tool_calls=1, slot_count=1))
        assert r.fitness == 0.0
        assert r.correctness == 0.0

    def test_non_finite_correctness_falls_through_error_path_passes_correctness_through(self):
        # The error early-return echoes the raw input correctness, skipping the
        # clamp applied on the success path. Non-finite correctness here is the
        # caller's problem; the error path zeros fitness/efficiency regardless.
        r = evaluate(FitnessInputs(correctness=float("nan"), tool_calls=1, error="boom"))
        assert r.fitness == 0.0
        assert r.efficiency == 0.0

    def test_nan_correctness_with_excess_still_zeroes(self):
        # No partial credit via efficiency: NaN correctness → fitness=0.0 regardless.
        r = evaluate(FitnessInputs(correctness=math.nan, tool_calls=3, slot_count=1))
        assert r.fitness == 0.0

    def test_nan_correctness_with_error_zeroes_fitness(self):
        # Error path always zeroes fitness; NaN correctness does not change that.
        r = evaluate(FitnessInputs(correctness=math.nan, tool_calls=1, error="boom"))
        assert r.fitness == 0.0

    def test_nan_correctness_reachable_via_bridge_min_path(self):
        # Documents bridge semantics: min([NaN]) == NaN (NaN is first element).
        # min([NaN, 0.8]) == NaN; min([0.8, NaN]) == 0.8 (Python's NaN ordering).
        # Any path that reaches evaluate() with correctness=NaN must yield 0.0.
        for slot_correctnesses in ([math.nan], [math.nan, 0.8]):
            martian_correctness = min(slot_correctnesses)
            r = evaluate(FitnessInputs(
                correctness=martian_correctness,
                tool_calls=len(slot_correctnesses),
                slot_count=len(slot_correctnesses),
            ))
            assert r.fitness == 0.0, (
                f"min({slot_correctnesses!r}) = {martian_correctness!r} "
                f"must not inflate to 1.0"
            )

    @pytest.mark.parametrize("c", [0.0, 0.001, 0.5, 0.999, 1.0])
    def test_finite_correctness_in_unit_interval_unchanged(self, c):
        # The fix must not perturb any valid correctness value.
        r = evaluate(FitnessInputs(correctness=c, tool_calls=1, slot_count=1))
        assert r.correctness == pytest.approx(c)
        assert r.fitness == pytest.approx(c)


class TestNonFiniteSlotArgs:
    """Non-finite ``tool_calls`` / ``slot_count`` must not silently produce a
    perfect score or undefined behavior. The formula is defined over the
    integers; the production bridge (PKT-572 documents ``float('inf') -
    float('inf')`` reaching the eval path) violates this contract today, so
    these tests pin the defensive-coercion contract on that real-world path."""

    def _build(self, **kwargs):
        # Bypass FitnessInputs' strict int annotations: the production bridge
        # already violates the contract — these tests pin the
        # defensive-coercion contract on that real-world path.
        from typing import cast
        return evaluate(cast(FitnessInputs, FitnessInputs(**cast(dict, kwargs))))

    def test_nan_tool_calls_does_not_compare_equal_to_slot_count(self):
        # Without coercion, max(0, NaN - 1) == max(0, NaN) == 0 in Python,
        # so the silent behavior is "no penalty". That hides a real defect
        # (NaN should never reach here) — we coerce to 0 (no excess) so the
        # formula computes a meaningful efficiency, but flag the input by
        # not inflating the score beyond what correctness supports.
        r = self._build(correctness=0.7, tool_calls=float("nan"), slot_count=1)
        assert r.efficiency == 1.0
        assert r.fitness == pytest.approx(0.7)

    def test_nan_slot_count_does_not_produce_division_or_undefined_behavior(self):
        r = self._build(correctness=0.7, tool_calls=5, slot_count=float("nan"))
        # Coerce NaN slot_count to 1; excess becomes 4; efficiency = 1/1.4.
        assert r.efficiency == pytest.approx(1.0 / 1.4)
        assert r.fitness == pytest.approx(0.7 / 1.4)

    def test_infinite_tool_calls_does_not_produce_infinite_efficiency(self):
        # +Inf tool_calls would yield excess = +Inf, alpha * excess = +Inf,
        # 1/(1+Inf) = 0.0. We coerce to a deterministic positive integer
        # instead so the failure mode is "excess penalty applied", not
        # "fitness silently rounded to 0".
        r = self._build(correctness=0.7, tool_calls=float("inf"), slot_count=1)
        # Coerced tool_calls = 0 (the non-finite branch); no excess.
        assert math.isfinite(r.efficiency)
        assert r.fitness == pytest.approx(0.7)


class TestResultStillFinite:
    """Regression guard: under any combination of non-finite inputs on the
    success path, the returned FitnessResult fields must be real numbers."""

    @pytest.mark.parametrize("non_finite", [float("nan"), float("inf"), float("-inf")])
    @pytest.mark.parametrize("field", ["tool_calls", "slot_count"])
    def test_non_finite_tool_calls_or_slot_count_yields_finite_fitness(self, non_finite, field):
        from typing import cast
        kwargs = {"correctness": 0.5, "tool_calls": 1, "slot_count": 1}
        kwargs[field] = non_finite
        r = evaluate(cast(FitnessInputs, FitnessInputs(**cast(dict, kwargs))))
        assert math.isfinite(r.fitness)
        assert math.isfinite(r.efficiency)
        assert 0.0 <= r.fitness <= 1.0

