"""Candidate fitness formulas for Packet 27 scaling research.

These are RESEARCH formulas only. They are not integrated into the production
fitness path (src/alienclaw/fitness/). They can be applied post-hoc to bridge
outputs by extracting `correctness` and `tool_calls` from `run_metadata`.

Three candidates vs the current baseline:

Option current: fitness = correctness × 1/tool_calls
  (Packet 26: structural ceiling at 1/k for k-slot compositions)

Option B: fitness = correctness × slot_count / tool_calls
  Control: normalizes by slot count. Perfect k-slot execution → fitness = correctness.

Option C-prime: fitness = correctness / (1 + α × max(0, tool_calls - slot_count))
  Multiplicative excess penalty. No penalty at tool_calls = slot_count.
  α controls penalty steepness.

Option D: fitness = max(0, correctness - β × max(0, tool_calls - slot_count) / slot_count)
  Additive excess penalty. No penalty at tool_calls = slot_count.
  β controls penalty magnitude.
"""
from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from typing import Any, Callable


@dataclass(frozen=True)
class FitnessFormulaResult:
    """Result of applying a fitness formula."""
    fitness: float       # ∈ [0, 1]
    correctness: float   # as received
    tool_calls: int      # total tool calls
    slot_count: int      # number of slots
    formula_name: str    # identifying label


def option_current(
    correctness: float,
    tool_calls: int,
    slot_count: int,
) -> FitnessFormulaResult:
    """Baseline formula: correctness × 1/tool_calls.

    Caps k-slot compositions at 1/k for perfect execution.
    """
    fitness = max(0.0, min(1.0, correctness * (1.0 / max(1, tool_calls))))
    return FitnessFormulaResult(
        fitness=fitness, correctness=correctness,
        tool_calls=tool_calls, slot_count=slot_count,
        formula_name="option_current",
    )


def option_b(
    correctness: float,
    tool_calls: int,
    slot_count: int,
) -> FitnessFormulaResult:
    """Option B: correctness × slot_count / tool_calls (slot normalization).

    Perfect k-slot execution (tool_calls = slot_count) → fitness = correctness.
    No ceiling for perfect compositions.
    """
    fitness = max(0.0, min(1.0, correctness * (slot_count / max(1, tool_calls))))
    return FitnessFormulaResult(
        fitness=fitness, correctness=correctness,
        tool_calls=tool_calls, slot_count=slot_count,
        formula_name="option_b",
    )


def option_c_prime(
    correctness: float,
    tool_calls: int,
    slot_count: int,
    alpha: float = 1.0,
) -> FitnessFormulaResult:
    """Option C-prime: correctness / (1 + α × max(0, excess)).

    excess = tool_calls - slot_count
    No penalty when tool_calls = slot_count. Multiplicative excess penalty.
    """
    excess = max(0, tool_calls - slot_count)
    fitness = max(0.0, min(1.0, correctness / (1.0 + alpha * excess)))
    return FitnessFormulaResult(
        fitness=fitness, correctness=correctness,
        tool_calls=tool_calls, slot_count=slot_count,
        formula_name=f"option_c_prime_a{alpha:.3f}",
    )


def option_d(
    correctness: float,
    tool_calls: int,
    slot_count: int,
    beta: float = 1.0,
) -> FitnessFormulaResult:
    """Option D: correctness - β × max(0, excess) / slot_count.

    excess = tool_calls - slot_count
    No penalty when tool_calls = slot_count. Additive excess penalty.
    """
    excess = max(0, tool_calls - slot_count)
    penalty = beta * excess / max(1, slot_count)
    fitness = max(0.0, min(1.0, correctness - penalty))
    return FitnessFormulaResult(
        fitness=fitness, correctness=correctness,
        tool_calls=tool_calls, slot_count=slot_count,
        formula_name=f"option_d_b{beta:.3f}",
    )


def make_formula_bridge_runner(
    martian_type: str,
    inputs: dict[str, Any],
    formula_fn: Callable[..., FitnessFormulaResult],
    slot_count: int,
    **formula_kwargs: Any,
) -> Callable:
    """Create a bridge runner that applies a custom fitness formula post-evaluation.

    The bridge runs normally; correctness and tool_calls are extracted from
    run_metadata and passed to formula_fn.

    Args:
        martian_type: Martian type to run
        inputs: campaign inputs forwarded to the Martian
        formula_fn: one of option_b, option_c_prime, option_d, option_current
        slot_count: number of slots in the Martian (k)
        **formula_kwargs: extra args forwarded to formula_fn (e.g. alpha=0.5)

    Returns:
        RunMartianCallback compatible function that returns FitnessReport with
        candidate formula's fitness.
    """
    from alienclaw.bridge.server import handle
    from alienclaw.evolution.generation import FitnessReport

    _inputs = dict(inputs)

    def run(mtype: str, genome: str) -> "FitnessReport":
        req_bytes = json.dumps({
            "bridge_version": "1.0",
            "request_id": str(uuid.uuid4()),
            "request": {
                "kind": "summon",
                "genome": genome,
                "martian_type": mtype,
                "inputs": _inputs,
                "timeout_ms": 30_000,
            },
        }).encode()

        resp_dict = handle(req_bytes)
        resp = resp_dict["response"]
        meta = resp.get("run_metadata", {})

        # Extract aggregated per-execution correctness and tool_calls from bridge
        raw_correctness = meta.get("correctness", 0.0 if not resp.get("ok") else 1.0)
        raw_tool_calls = meta.get("tool_calls", slot_count)

        formula_result = formula_fn(raw_correctness, raw_tool_calls, slot_count, **formula_kwargs)

        return FitnessReport(
            fitness=formula_result.fitness,
            run_metadata={
                "tool_calls": raw_tool_calls,
                "wall_clock_ms": meta.get("wall_clock_ms", 0),
                "ok": resp.get("ok", False),
                "correctness": raw_correctness,
                "formula_name": formula_result.formula_name,
                "slot_count": slot_count,
            },
        )

    return run


def landscape_grid(
    slot_count: int,
    correctness_values: list[float] | None = None,
    excess_values: list[int] | None = None,
    formulas: dict[str, Callable] | None = None,
) -> list[dict]:
    """Generate fitness landscape grid for analytical comparison.

    Evaluates each formula over a (correctness × excess_tool_calls) grid.

    Args:
        slot_count: k (slot count for this analysis)
        correctness_values: list of correctness values to sample (default: 0-1 in 0.1 steps)
        excess_values: list of excess tool_calls values (default: 0 to k)
        formulas: {name: callable} mapping; default uses all 4 formulas

    Returns:
        List of {formula, slot_count, correctness, tool_calls, excess, fitness} dicts
    """
    if correctness_values is None:
        correctness_values = [i / 10 for i in range(11)]
    if excess_values is None:
        excess_values = list(range(slot_count + 1))
    if formulas is None:
        formulas = {
            "current": option_current,
            "option_b": option_b,
            "option_c_prime": lambda c, tc, sc: option_c_prime(c, tc, sc, alpha=1.0),
            "option_d": lambda c, tc, sc: option_d(c, tc, sc, beta=1.0),
        }

    rows = []
    for fname, fn in formulas.items():
        for correctness in correctness_values:
            for excess in excess_values:
                tool_calls = slot_count + excess
                result = fn(correctness, tool_calls, slot_count)
                rows.append({
                    "formula": fname,
                    "slot_count": slot_count,
                    "correctness": round(correctness, 2),
                    "tool_calls": tool_calls,
                    "excess": excess,
                    "fitness": round(result.fitness, 6),
                })
    return rows
