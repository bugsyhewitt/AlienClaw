"""Detect flat spans in a per-generation fitness curve.

A plateau step is a generation where max_fitness improves by less than `delta`
from the previous generation. Consecutive runs of at least `min_len` such steps
are returned as PlateauInfo instances.

This is distinct from alienclaw.diagnostics.plateau_detector (PKT-516), which
uses a relative-change-from-plateau-start algorithm (window_size=20 default) for
scale experiments. This module uses per-step absolute delta for the CLI evolve path.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PlateauInfo:
    start_generation: int  # 1-indexed generation where the flat run begins
    length: int            # number of consecutive plateau steps


def detect_plateaus(
    curve: list[float],
    *,
    delta: float = 0.01,
    min_len: int = 5,
) -> list[PlateauInfo]:
    """Return all plateaus in a fitness curve.

    Args:
        curve: max_fitness per generation, index 0 = generation 1.
        delta: minimum improvement to NOT count as a plateau step (absolute).
        min_len: minimum consecutive flat steps to report as a plateau.

    Returns:
        Plateaus in order of appearance (non-overlapping).
    """
    if len(curve) < 2:
        return []

    plateaus: list[PlateauInfo] = []
    run_start: int | None = None
    run_len = 0

    for i in range(1, len(curve)):
        if curve[i] - curve[i - 1] < delta:
            if run_start is None:
                run_start = i
                run_len = 1
            else:
                run_len += 1
        else:
            if run_start is not None and run_len >= min_len:
                plateaus.append(PlateauInfo(start_generation=run_start + 1, length=run_len))
            run_start = None
            run_len = 0

    if run_start is not None and run_len >= min_len:
        plateaus.append(PlateauInfo(start_generation=run_start + 1, length=run_len))

    return plateaus
