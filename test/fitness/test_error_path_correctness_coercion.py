"""Error-path non-finite correctness coercion — PKT-1466 (corrective re-author of REJECTED PKT-1052).

`evaluate()` documents this contract in its own docstring:

    Non-finite `correctness` (NaN, +Inf, -Inf) is coerced to 0.0 — silent fitness
    inflation to maximum (Python `min`/`max` returns the first argument on NaN tie)
    is replaced by a deterministic failing-score.

The success path (`correctness_raw = 0.0 if not math.isfinite(inputs.correctness)
else inputs.correctness`) honored that contract from PKT-588 / PR #469 and again
from PR #470 (commit 33d4fd45). The error short-circuit did not: it returned
`correctness=inputs.correctness` verbatim, so `error='boom'` + `correctness=NaN`
produced a `FitnessResult.correctness` of `nan` — a non-finite value escaping a
function whose docstring promises a deterministic failing score.

This file is the embedded File-A for PKT-1466. It is the artifact the
2026-09-07 overmind gate (issues.md:12186) demanded was MISSING from PKT-1052:
"Embed the complete File-A ... verbatim in the packet, and run it: paste real
RED (at HEAD, >=3 failures) and real GREEN (with fix) output".

Scope note (overmind gate blocker #4, "Decide the clamp question"):
this File-A scopes STRICTLY to non-finite correctness. The out-of-range FINITE
case (e.g. `correctness=1.7` with `error=`) is a separate contract, explicitly
documented by the shipped test
`test_function.py::TestErrorPath::test_error_path_passes_correctness_through_unclamped`,
and is NOT changed by this packet. The rationale below therefore claims only
"non-finite correctness is coerced to 0.0" — never "correctness is in [0, 1]".
"""
import math

import pytest

from alienclaw.fitness.function import evaluate
from alienclaw.fitness.types import FitnessInputs


NON_FINITE = [float("nan"), float("inf"), float("-inf")]
FINITE_IN_RANGE = [0.0, 0.001, 0.42, 0.999, 1.0]


class TestErrorPathNonFiniteCorrectnessIsCoerced:
    """The defect: the error short-circuit leaked non-finite correctness."""

    @pytest.mark.parametrize("non_finite", NON_FINITE)
    def test_non_finite_correctness_with_error_is_coerced_to_zero(self, non_finite):
        r = evaluate(FitnessInputs(correctness=non_finite, tool_calls=1, error="boom"))
        assert r.correctness == 0.0

    @pytest.mark.parametrize("non_finite", NON_FINITE)
    def test_non_finite_correctness_with_error_result_is_finite(self, non_finite):
        """A FitnessResult must never carry a non-finite correctness."""
        r = evaluate(FitnessInputs(correctness=non_finite, tool_calls=1, error="boom"))
        assert math.isfinite(r.correctness)

    @pytest.mark.parametrize("non_finite", NON_FINITE)
    def test_non_finite_correctness_with_error_never_exceeds_unit_interval(self, non_finite):
        r = evaluate(FitnessInputs(correctness=non_finite, tool_calls=1, error="boom"))
        assert 0.0 <= r.correctness <= 1.0

    @pytest.mark.parametrize("non_finite", NON_FINITE)
    def test_non_finite_correctness_with_error_and_empty_error_string(self, non_finite):
        """The guard is `error is not None`, not truthiness — so `error=''` also takes
        the error path and must coerce identically."""
        r = evaluate(FitnessInputs(correctness=non_finite, tool_calls=1, error=""))
        assert r.correctness == 0.0

    @pytest.mark.parametrize("non_finite", NON_FINITE)
    def test_non_finite_correctness_with_error_and_excess_tool_calls(self, non_finite):
        """The error path ignores tool_calls entirely; coercion must not depend on them."""
        r = evaluate(FitnessInputs(correctness=non_finite, tool_calls=99, slot_count=1, error="boom"))
        assert r.correctness == 0.0


class TestErrorPathFiniteCorrectnessIsPreserved:
    """Anti-over-coercion guard: a finite correctness carries diagnostic value on a
    failed run ("got 42% of the way before failing"). The fix must not erase it."""

    @pytest.mark.parametrize("finite", FINITE_IN_RANGE)
    def test_finite_correctness_with_error_is_preserved(self, finite):
        r = evaluate(FitnessInputs(correctness=finite, tool_calls=1, error="boom"))
        assert r.correctness == pytest.approx(finite)

    def test_finite_out_of_range_correctness_with_error_is_unchanged(self):
        """Out-of-range FINITE correctness is a separate, already-documented contract
        (`test_function.py::test_error_path_passes_correctness_through_unclamped`).
        PKT-1466 scopes itself to non-finite and must NOT alter this behavior."""
        r = evaluate(FitnessInputs(correctness=1.7, tool_calls=1, error="boom"))
        assert r.correctness == 1.7


class TestErrorPathFitnessAndEfficiencyRemainZero:
    """The error path's existing contract must survive the fix unchanged."""

    @pytest.mark.parametrize("non_finite", NON_FINITE)
    def test_fitness_and_efficiency_stay_zero_for_non_finite_correctness(self, non_finite):
        r = evaluate(FitnessInputs(correctness=non_finite, tool_calls=1, error="boom"))
        assert r.fitness == 0.0
        assert r.efficiency == 0.0

    def test_fitness_and_efficiency_stay_zero_for_finite_correctness(self):
        r = evaluate(FitnessInputs(correctness=0.9, tool_calls=1, error="boom"))
        assert r.fitness == 0.0
        assert r.efficiency == 0.0

    def test_formula_version_still_v2_on_error_path(self):
        r = evaluate(FitnessInputs(correctness=0.9, tool_calls=1, error="boom"))
        assert r.formula_version == "v2.0"


class TestSuccessPathCoercionRegressionGuard:
    """Locks the PKT-588 / PR #469 / PR #470 success-path contract. If the fix is
    implemented by moving the coercion above the error short-circuit rather than
    duplicating it, these still pass — that is intentional: the assertion is on
    behavior, not on implementation shape."""

    @pytest.mark.parametrize("non_finite", NON_FINITE)
    def test_success_path_still_coerces_non_finite_correctness(self, non_finite):
        r = evaluate(FitnessInputs(correctness=non_finite, tool_calls=1, slot_count=1))
        assert r.correctness == 0.0
        assert r.fitness == 0.0

    @pytest.mark.parametrize("finite", FINITE_IN_RANGE)
    def test_success_path_still_preserves_finite_correctness(self, finite):
        r = evaluate(FitnessInputs(correctness=finite, tool_calls=1, slot_count=1))
        assert r.correctness == pytest.approx(finite)

    def test_success_path_does_not_inflate_nan_to_perfect_score(self):
        """The original silent-inflation bug: max(0.0, min(1.0, NaN)) == 1.0."""
        r = evaluate(FitnessInputs(correctness=math.nan, tool_calls=1, slot_count=1))
        assert r.fitness != 1.0
