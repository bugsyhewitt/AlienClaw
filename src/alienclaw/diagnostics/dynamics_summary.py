"""Compute evolutionary dynamics properties from experiment data.

Four properties measured per (formula, k, seed) experiment:
1. Gradient smoothness: how smooth is the fitness improvement curve?
2. Fixation score: fraction of generations where selection acts (|Δfit/fit| > 1/(2N))
3. Plateau quality: what fraction of time is spent NOT in plateaus?
4. Signal-to-information: mean MI between genome bytes and fitness

Each normalized to [0, 1] where higher is better for evolutionary dynamics.
Composite score: weighted sum of all four.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

import numpy as np


@dataclass
class DynamicsSummary:
    """Evolutionary dynamics summary for one (formula, k, seed) experiment."""
    gradient_smoothness: float    # [0, 1]; higher = smoother fitness curve
    fixation_score: float         # [0, 1]; higher = more generations with active selection
    plateau_quality: float        # [0, 1]; higher = less time in plateaus
    signal_to_info: float         # [0, 1]; higher = more genome→fitness signal
    composite_score: float        # [0, 1]; weighted sum
    n_generations: int
    final_mean_fitness: float
    final_max_fitness: float


def _gradient_smoothness(curve: Sequence[float]) -> float:
    """Smoothness of fitness curve based on second-difference variance.

    Lower variance → smoother curve → better evolutionary gradient.
    Returns: normalized score ∈ [0, 1].
    """
    arr = np.array(list(curve))
    if len(arr) < 3:
        return 1.0
    d2 = np.diff(arr, 2)
    var = float(np.var(d2))
    return float(1.0 / (1.0 + var * 10.0))


def _fixation_score(curve: Sequence[float], population_size: int) -> float:
    """Fraction of generations where |Δfitness/fitness| > 1/(2N).

    Above drift threshold = selection acts meaningfully.
    Returns: fraction ∈ [0, 1].
    """
    arr = list(curve)
    if len(arr) < 2:
        return 0.0
    threshold = 1.0 / (2.0 * max(population_size, 1))
    above = 0
    for i in range(1, len(arr)):
        prev = arr[i - 1]
        if abs(prev) < 1e-9:
            continue
        delta = abs(arr[i] - prev) / abs(prev)
        if delta > threshold:
            above += 1
    return above / max(len(arr) - 1, 1)


def _plateau_quality(curve: Sequence[float]) -> float:
    """Fraction of generations NOT in a plateau.

    Plateaus detected via plateau_detector.detect_plateaus.
    Returns: 1 - plateau_fraction ∈ [0, 1].
    """
    from alienclaw.diagnostics.plateau_detector import detect_plateaus
    c = list(curve)
    if len(c) < 20:
        return 1.0
    plateaus = detect_plateaus(c, window_size=10, threshold=0.02)
    if not plateaus:
        return 1.0
    total_plateau_gens = sum(p["duration"] for p in plateaus)
    return float(max(0.0, 1.0 - total_plateau_gens / len(c)))


def _signal_to_info(genome_fitness_pairs: list[tuple[str, float]]) -> float:
    """Normalized MI between genome bytes and fitness.

    Returns: mean_byte_mi / 4.1 ∈ [0, 1] (4.1 ≈ log2(62) nats).
    """
    if not genome_fitness_pairs or len(genome_fitness_pairs) < 10:
        return 0.0
    from alienclaw.diagnostics.genome_information import genome_byte_mutual_information
    genomes = [p[0] for p in genome_fitness_pairs]
    fitnesses = [p[1] for p in genome_fitness_pairs]
    result = genome_byte_mutual_information(genomes, fitnesses)
    mean_mi = result["summary"]["mean_byte_mi"]
    return float(min(1.0, mean_mi / 4.1))


def summarize_dynamics(
    fitness_curve: Sequence[float],
    genome_fitness_pairs: list[tuple[str, float]],
    population_size: int,
    weights: tuple[float, float, float, float] = (0.3, 0.3, 0.2, 0.2),
) -> DynamicsSummary:
    """Compute all four dynamics properties.

    Args:
        fitness_curve: mean fitness per generation
        genome_fitness_pairs: (genome_str, fitness) pairs for MI analysis
        population_size: N for fixation threshold
        weights: (smoothness, fixation, plateau, mi) weights for composite score

    Returns:
        DynamicsSummary with all four properties + composite
    """
    arr = list(fitness_curve)
    smoothness = _gradient_smoothness(arr)
    fixation = _fixation_score(arr, population_size)
    plateau = _plateau_quality(arr)
    sti = _signal_to_info(genome_fitness_pairs)

    w = weights
    composite = w[0] * smoothness + w[1] * fixation + w[2] * plateau + w[3] * sti

    return DynamicsSummary(
        gradient_smoothness=round(smoothness, 4),
        fixation_score=round(fixation, 4),
        plateau_quality=round(plateau, 4),
        signal_to_info=round(sti, 4),
        composite_score=round(composite, 4),
        n_generations=len(arr),
        final_mean_fitness=round(arr[-1] if arr else 0.0, 6),
        final_max_fitness=round(max(arr) if arr else 0.0, 6),
    )


def landscape_quality_score(
    slot_count: int,
    formula_fn,
    **formula_kwargs,
) -> float:
    """Analytical quality score for a formula at given slot_count.

    Measures:
    1. Fitness at perfect execution (should be 1.0 or high)
    2. Gradient continuity as excess tool_calls increases (smooth decay)
    3. Penalty at k excess calls (not too severe)

    Returns: score ∈ [0, 1]; higher = better for evolutionary dynamics.
    """
    # Test 1: Perfect execution gives fitness close to correctness
    perfect = formula_fn(1.0, slot_count, slot_count, **formula_kwargs)
    score_perfect = perfect.fitness  # want this to be 1.0

    # Test 2: Gradient at 1 excess call (should be positive signal, not cliff)
    one_excess = formula_fn(1.0, slot_count + 1, slot_count, **formula_kwargs)
    gradient_one_excess = score_perfect - one_excess.fitness  # how much penalty per excess

    # Test 3: Gradient at k excess calls (maximum reasonable excess)
    max_excess = formula_fn(1.0, slot_count * 2, slot_count, **formula_kwargs)
    fitness_at_max_excess = max_excess.fitness

    # Scoring: want high perfect fitness, smooth gradient (not zero immediately), low floor
    score_no_ceiling = min(1.0, score_perfect)
    score_smooth = 1.0 - min(1.0, abs(gradient_one_excess) * 2)  # prefer gentle penalty
    score_recoverable = min(1.0, fitness_at_max_excess + 0.5)  # prefer fitness > 0 even at 2k

    # Weighted combination
    return 0.5 * score_no_ceiling + 0.3 * score_smooth + 0.2 * score_recoverable
