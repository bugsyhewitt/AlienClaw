"""Detect plateaus in fitness curves and compute convergence statistics.

Pure functions: given a fitness curve (list of mean fitness per generation),
identify plateau regions and compute time-to-convergence.

Plateau definition: a window of N consecutive generations where mean fitness
changes by less than `threshold` (relative change from window start).
"""
from __future__ import annotations

from typing import Sequence


def detect_plateaus(
    fitness_per_generation: Sequence[float],
    window_size: int = 20,
    threshold: float = 0.01,
) -> list[dict]:
    """Find plateau regions in a fitness curve.

    Args:
        fitness_per_generation: mean fitness per generation (index = generation)
        window_size: minimum number of generations to constitute a plateau
        threshold: max fractional change in fitness to stay in plateau

    Returns:
        List of dicts, each with:
            start_gen:  first generation of the plateau
            end_gen:    last generation of the plateau (inclusive)
            fitness:    fitness at start of plateau
            duration:   end_gen - start_gen + 1
            escaped:    True if fitness improved after this plateau
    """
    curve = list(fitness_per_generation)
    n = len(curve)
    if n < window_size:
        return []

    plateaus: list[dict] = []
    i = 0
    while i < n:
        plateau_start_fitness = curve[i]
        j = i
        while j < n:
            change = abs(curve[j] - plateau_start_fitness)
            relative = change / (abs(plateau_start_fitness) + 1e-9)
            if relative > threshold:
                break
            j += 1

        duration = j - i
        if duration >= window_size:
            end_gen = j - 1
            escaped = j < n and curve[j] > plateau_start_fitness
            plateaus.append({
                "start_gen": i,
                "end_gen": end_gen,
                "fitness": plateau_start_fitness,
                "duration": duration,
                "escaped": escaped,
            })
            i = j
        else:
            i += 1

    return plateaus


def time_to_convergence(
    fitness_per_generation: Sequence[float],
    convergence_fitness: float = 0.95,
    convergence_window: int = 10,
) -> int | None:
    """First generation where fitness stays ≥ convergence_fitness for a window.

    Args:
        fitness_per_generation: mean fitness per generation
        convergence_fitness: fitness threshold for convergence
        convergence_window: how many consecutive generations must stay above threshold

    Returns:
        First generation index where the window of convergence_window gens all
        have fitness ≥ convergence_fitness, or None if never reached.
    """
    curve = list(fitness_per_generation)
    n = len(curve)

    for i in range(n - convergence_window + 1):
        window = curve[i: i + convergence_window]
        if all(f >= convergence_fitness for f in window):
            return i

    return None


def summarize_convergence(
    all_curves: list[list[float]],
    convergence_fitness: float = 0.95,
    convergence_window: int = 10,
) -> dict:
    """Compute convergence statistics across multiple seeds.

    Args:
        all_curves: list of per-seed fitness curves
        convergence_fitness: threshold for convergence
        convergence_window: window size

    Returns:
        {
            "n_seeds": int,
            "converged_count": int,
            "convergence_gens": list[int],   gens for converged seeds
            "mean_convergence_gen": float | None,
            "stddev_convergence_gen": float | None,
            "min_convergence_gen": int | None,
            "max_convergence_gen": int | None,
        }
    """
    gens = []
    for curve in all_curves:
        g = time_to_convergence(curve, convergence_fitness, convergence_window)
        if g is not None:
            gens.append(g)

    if not gens:
        return {
            "n_seeds": len(all_curves),
            "converged_count": 0,
            "convergence_gens": [],
            "mean_convergence_gen": None,
            "stddev_convergence_gen": None,
            "min_convergence_gen": None,
            "max_convergence_gen": None,
        }

    import statistics
    return {
        "n_seeds": len(all_curves),
        "converged_count": len(gens),
        "convergence_gens": gens,
        "mean_convergence_gen": statistics.mean(gens),
        "stddev_convergence_gen": statistics.stdev(gens) if len(gens) > 1 else 0.0,
        "min_convergence_gen": min(gens),
        "max_convergence_gen": max(gens),
    }
