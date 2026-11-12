import math

from .types import FitnessInputs, FitnessResult


def clamp01(value: float) -> float:
    """Clamp a value into the closed unit interval [0.0, 1.0]."""
    return max(0.0, min(1.0, value))


_ALPHA = 0.1  # Bayesian-optimized in Packet 27; hardcoded per Packet 28 decision


def evaluate(inputs: FitnessInputs) -> FitnessResult:
    """Compute fitness using Option C-prime formula (adopted in Packet 28).

    Formula: fitness = correctness × 1 / (1 + α × max(0, tool_calls - slot_count))

    The first slot_count tool calls are "free" — one per slot is the architectural
    minimum. Each excess call applies a gentle multiplicative penalty (α = 0.1).
    A perfectly-orchestrating composition of any k slots achieves fitness = correctness,
    eliminating the 1/k ceiling of the prior formula.

    α = 0.1 (hardcoded; Bayesian optimization in Packet 27 converged to this value).

    Non-finite `correctness` (NaN, +Inf, -Inf) is coerced to 0.0 — silent fitness
    inflation to maximum (Python `min`/`max` returns the first argument on NaN tie)
    is replaced by a deterministic failing-score. `tool_calls` / `slot_count` are
    defensively coerced to a non-negative integer on non-finite input.
    """
    if inputs.error is not None:
        # PKT-1466: the error short-circuit must honor the SAME non-finite
        # coercion contract the success path below applies (and that this
        # function's own docstring promises: "Non-finite `correctness` (NaN,
        # +Inf, -Inf) is coerced to 0.0"). Without this, a caller supplying
        # `error=...` with a non-finite correctness got a FitnessResult whose
        # `.correctness` field carried NaN / +Inf / -Inf straight through —
        # a non-finite value escaping a function that promises a deterministic
        # failing score. PKT-588 (PR #469) and PR #470 (33d4fd45) hardened the
        # success path and missed this asymmetric branch.
        #
        # Finite correctness is PRESERVED (not clamped): a partial score on a
        # failed run carries diagnostic value, and the shipped
        # `test_error_path_passes_correctness_through_unclamped` contract for
        # out-of-range finite values is unchanged by this fix.
        err_correctness = 0.0 if not math.isfinite(inputs.correctness) else inputs.correctness
        return FitnessResult(fitness=0.0, correctness=err_correctness, efficiency=0.0,
                             formula_version="v2.0")

    # Defensive: coerce non-finite correctness to 0.0 (failing score) instead of
    # silently mapping to 1.0 via Python's min/max NaN-tie behavior.
    correctness_raw = 0.0 if not math.isfinite(inputs.correctness) else inputs.correctness
    tool_calls_raw = (
        0 if (not math.isfinite(inputs.tool_calls) or inputs.tool_calls < 0)
        else int(inputs.tool_calls)
    )
    slot_count_raw = (
        1 if (not math.isfinite(inputs.slot_count) or inputs.slot_count < 0)
        else max(1, int(inputs.slot_count))
    )

    correctness = clamp01(correctness_raw)
    excess = max(0, tool_calls_raw - slot_count_raw)
    efficiency = 1.0 / (1.0 + _ALPHA * excess)
    fitness = clamp01(correctness * efficiency)
    return FitnessResult(fitness=fitness, correctness=correctness, efficiency=efficiency,
                         formula_version="v2.0")
