"""Fitness formula analysis for composition Martians (diagnostic helper).

Delegates ALL production-scorer math to `alienclaw.fitness.function.evaluate`
so this module can NEVER drift from the production scorer. The production
scorer implements Option C-PRIME (Packet 28, commit 93fba3f8):

    excess    = max(0, tool_calls - slot_count)
    efficiency = 1.0 / (1.0 + _ALPHA * excess)    # _ALPHA = 0.1
    fitness    = clamp01(correctness * efficiency)

For a k-slot composition with perfect execution (correctness=1.0, tool_calls=k,
slot_count=k), the maximum achievable fitness is 1.0 — NOT 1/k. The structural
1/k ceiling of the superseded Option C formula was deliberately eliminated in
Packet 28 ("eliminating the 1/k ceiling of the prior formula").

Before Packet 28 this module hand-coded the OLD Option C math
(`efficiency = 1.0 / max(1, tool_calls)`, ceiling = `1 / k_slots`) while
production ran Option C-PRIME, so it under-predicted the production score by
exactly k× for every k >= 2. Delegation removes the drift permanently.
"""
from __future__ import annotations

import math

from alienclaw.fitness.function import clamp01
from alienclaw.fitness.function import evaluate as _evaluate
from alienclaw.fitness.types import FitnessInputs as _FitnessInputs


def compute_ceiling(k_slots: int) -> float:
    """Maximum achievable fitness for a k-slot composition (Option C-PRIME).

    Under the current production formula a perfect composition (correctness=1.0,
    no excess tool calls) achieves fitness = 1.0 regardless of k. The structural
    1/k ceiling of the superseded Option C formula was eliminated in Packet 28.

    Args:
        k_slots: number of slots in the composition (k >= 1)

    Returns:
        1.0 — the structural ceiling (constant for all k >= 1 under C-PRIME)

    Raises:
        ValueError: if k_slots < 1
    """
    if k_slots < 1:
        raise ValueError(f"k_slots must be ≥ 1, got {k_slots}")
    return 1.0


def analyze_formula(
    slot_correctnesses: list[float],
    slot_tool_calls: list[int],
) -> dict:
    """Apply the fitness formula to given per-slot correctness and tool_calls.

    The score math is delegated to `fitness.function.evaluate` (the production
    scorer) so this diagnostic can never drift from production. The aggregation
    of per-slot values into the scorer's inputs is done here.

    Args:
        slot_correctnesses: correctness value per slot ∈ [0, 1]
        slot_tool_calls: number of tool calls per slot >= 1

    Returns:
        {
            "k_slots": int,
            "correctness_agg": float,   min of slot_correctnesses
            "tool_calls_agg": int,      sum of slot_tool_calls
            "slot_count": int,          number of slots (>= 1)
            "excess": int,              tool_calls_agg - slot_count (>= 0)
            "efficiency": float,        1 / (1 + 0.1 * excess)
            "fitness": float,           correctness_agg * efficiency
            "theoretical_ceiling": float, 1.0 (C-PRIME has no k-dependent ceiling)
            "at_ceiling": bool,         fitness == theoretical_ceiling
        }

    Raises:
        ValueError: if the two lists have different lengths, or if both are
            empty. A non-finite correctness value is NOT an error — it is
            coerced to 0.0 (fail-closed) per PKT-617.
    """
    if len(slot_correctnesses) != len(slot_tool_calls):
        raise ValueError("slot_correctnesses and slot_tool_calls must have same length")

    k = len(slot_correctnesses)
    if k < 1:
        raise ValueError(
            "slot_correctnesses and slot_tool_calls must be non-empty "
            "(at least one slot required)"
        )

    # PKT-617: coerce non-finite correctness_agg to 0.0 (fail-closed, NOT
    # silently inflated to 1.0 by clamp01's min/max NaN-tie behaviour). This
    # guard lives on the AGGREGATION side — it must stay here even though the
    # score itself is delegated to the production scorer.
    correctness_agg = min(slot_correctnesses) if slot_correctnesses else 0.0
    correctness_agg = 0.0 if not math.isfinite(correctness_agg) else clamp01(correctness_agg)

    tool_calls_agg = sum(slot_tool_calls)
    slot_count = max(1, k)

    result = _evaluate(_FitnessInputs(
        correctness=correctness_agg,
        tool_calls=tool_calls_agg,
        slot_count=slot_count,
    ))

    ceiling = compute_ceiling(k)
    at_ceiling = abs(result.fitness - ceiling) < 1e-9

    return {
        "k_slots": k,
        "correctness_agg": correctness_agg,
        "tool_calls_agg": tool_calls_agg,
        "slot_count": slot_count,
        "excess": max(0, tool_calls_agg - slot_count),
        "efficiency": result.efficiency,
        "fitness": result.fitness,
        "theoretical_ceiling": ceiling,
        "at_ceiling": at_ceiling,
    }


def verify_ceiling_from_formula(k: int) -> dict:
    """Verify that the ceiling 1.0 is achieved by perfect execution.

    Args:
        k: number of slots

    Returns:
        {
            "k_slots": int,
            "formula_result": float,     fitness from formula
            "theoretical_ceiling": float, 1.0
            "ceiling_confirmed": bool,    True iff they match
        }
    """
    result = analyze_formula(
        slot_correctnesses=[1.0] * k,
        slot_tool_calls=[1] * k,
    )
    return {
        "k_slots": k,
        "formula_result": result["fitness"],
        "theoretical_ceiling": result["theoretical_ceiling"],
        "ceiling_confirmed": result["at_ceiling"],
    }


def ceiling_table(max_k: int = 8) -> list[dict]:
    """Return ceiling values for k=1..max_k. Ceiling is 1.0 for all k under C-PRIME."""
    return [
        {
            "k": k,
            "ceiling": compute_ceiling(k),
            "ceiling_pct": round(100.0 * compute_ceiling(k), 1),
        }
        for k in range(1, max_k + 1)
    ]
