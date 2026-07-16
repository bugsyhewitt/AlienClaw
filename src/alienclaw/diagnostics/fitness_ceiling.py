"""Fitness formula ceiling analysis for composition Martians.

The fitness formula (from src/alienclaw/fitness/function.py):
    efficiency = 1.0 / max(1, tool_calls)
    fitness = correctness * efficiency

For a k-slot composition with perfect execution (all slots: correctness=1.0,
tool_calls=1), the maximum achievable fitness is 1/k.

This module provides functions to:
1. Compute the theoretical ceiling for k-slot compositions
2. Verify the ceiling from formula evaluation
3. Analyze the formula for any (correctness, tool_calls) combination
"""
from __future__ import annotations

from alienclaw.fitness.function import clamp01


def compute_ceiling(k_slots: int) -> float:
    """Maximum achievable fitness for a k-slot composition.

    Assumes perfect execution: all slots correctness=1.0, tool_calls=1 each.

    Args:
        k_slots: number of slots in the composition (k ≥ 1)

    Returns:
        1/k_slots — the structural ceiling

    Examples:
        >>> compute_ceiling(1)
        1.0
        >>> compute_ceiling(2)
        0.5
        >>> compute_ceiling(3)
        0.3333333333333333
    """
    if k_slots < 1:
        raise ValueError(f"k_slots must be ≥ 1, got {k_slots}")
    return 1.0 / k_slots


def analyze_formula(
    slot_correctnesses: list[float],
    slot_tool_calls: list[int],
) -> dict:
    """Apply the fitness formula to given per-slot correctness and tool_calls.

    This is the exact formula from src/alienclaw/fitness/function.py:
        correctness_agg = min(slot_correctnesses)
        tool_calls_agg = sum(slot_tool_calls)
        efficiency = 1.0 / max(1, tool_calls_agg)
        fitness = correctness_agg * efficiency

    Args:
        slot_correctnesses: correctness value per slot ∈ [0, 1]
        slot_tool_calls: number of tool calls per slot ≥ 1

    Returns:
        {
            "k_slots": int,
            "correctness_agg": float,   min of slot_correctnesses
            "tool_calls_agg": int,      sum of slot_tool_calls
            "efficiency": float,        1/tool_calls_agg
            "fitness": float,           correctness_agg * efficiency
            "at_ceiling": bool,         fitness == compute_ceiling(k)
        }
    """
    if len(slot_correctnesses) != len(slot_tool_calls):
        raise ValueError("slot_correctnesses and slot_tool_calls must have same length")

    k = len(slot_correctnesses)
    correctness_agg = min(slot_correctnesses) if slot_correctnesses else 0.0
    correctness_agg = clamp01(correctness_agg)
    tool_calls_agg = sum(slot_tool_calls)
    efficiency = 1.0 / max(1, tool_calls_agg)
    fitness = clamp01(correctness_agg * efficiency)

    ceiling = compute_ceiling(k)
    at_ceiling = abs(fitness - ceiling) < 1e-9

    return {
        "k_slots": k,
        "correctness_agg": correctness_agg,
        "tool_calls_agg": tool_calls_agg,
        "efficiency": efficiency,
        "fitness": fitness,
        "theoretical_ceiling": ceiling,
        "at_ceiling": at_ceiling,
    }


def verify_ceiling_from_formula(k: int) -> dict:
    """Verify that the ceiling 1/k is exactly achieved by perfect execution.

    Args:
        k: number of slots

    Returns:
        {
            "k_slots": k,
            "formula_result": float,     fitness from formula
            "theoretical_ceiling": float, 1/k
            "ceiling_confirmed": bool,    True iff they match exactly
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
    """Return ceiling values for k=1..max_k.

    Returns:
        List of {"k": k, "ceiling": 1/k, "ceiling_pct": 100/k}
    """
    return [
        {
            "k": k,
            "ceiling": compute_ceiling(k),
            "ceiling_pct": round(100.0 / k, 1),
        }
        for k in range(1, max_k + 1)
    ]
