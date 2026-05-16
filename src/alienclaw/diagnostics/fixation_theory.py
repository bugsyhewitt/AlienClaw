"""Fixation probability theory for finite populations.

Applies Kimura's diffusion approximation to estimate whether selection
can act on observed fitness differences given finite population size.

Reference: Kimura (1962), "On the probability of fixation of mutant
genes in a population." Genetics 47:713-719.

In the AlienClaw context:
- N = effective population size (≈ population_size in EvolutionConfig)
- s = selection coefficient = (fit_advantaged - fit_neutral) / fit_neutral
- P_fix(s, N) = probability that a single-copy mutant with advantage s
  rises to fixation in a diploid population of size N
  [adapted for haploid: P_fix = (1 - e^{-2s}) / (1 - e^{-2Ns})]

NOTE: Kimura's approximation assumes Wright-Fisher dynamics. AlienClaw
uses tournament selection + elitism, which is an approximation. Results
are approximate but directionally correct.
"""
from __future__ import annotations

import math


def kimura_fixation_prob(s: float, N: int) -> float:
    """Probability that a beneficial mutation fixes in a haploid population.

    Uses Kimura's formula adapted for haploid:
        P_fix(s, N) = (1 - exp(-2s)) / (1 - exp(-2Ns))

    For s = 0 (neutral), P_fix = 1/N (L'Hopital limit).
    For s >> 0 (strong selection), P_fix → 1.

    Args:
        s: selection coefficient (positive = beneficial)
        N: effective population size

    Returns:
        P_fix ∈ [0, 1]
    """
    if N <= 0:
        raise ValueError(f"N must be > 0, got {N}")

    if abs(s) < 1e-10:
        # Neutral drift: P_fix = 1/N
        return 1.0 / N

    two_s = 2.0 * s
    two_Ns = 2.0 * N * s

    # Guard against overflow for large |Ns|
    if two_Ns > 700:
        # Strong selection: numerator ≈ 1 - exp(-2s) ≈ 2s for small s
        # denominator ≈ 1
        return max(0.0, min(1.0, 1.0 - math.exp(-two_s)))
    if two_Ns < -700:
        # Strong negative selection: P_fix ≈ 0
        return 0.0

    numerator = 1.0 - math.exp(-two_s)
    denominator = 1.0 - math.exp(-two_Ns)

    if abs(denominator) < 1e-15:
        return 1.0 / N

    return max(0.0, min(1.0, numerator / denominator))


def expected_fixation_time(s: float, N: int) -> float:
    """Expected number of generations for a beneficial mutation to fix.

    Approximation from Kimura & Ohta (1971):
        T_fix ≈ (2 / s) * ln(N)

    For neutral mutations (s ≈ 0), T_fix → ∞.
    This is an approximation; the exact formula involves integrals.

    Args:
        s: selection coefficient (must be > 0 for finite result)
        N: effective population size

    Returns:
        Expected fixation time in generations (approximate)
    """
    if N <= 0:
        raise ValueError(f"N must be > 0, got {N}")
    if s <= 0:
        return float("inf")
    return (2.0 / s) * math.log(N)


def selection_coefficient_from_fitness(
    fit_high: float,
    fit_mean: float,
) -> float:
    """Estimate selection coefficient s from fitness values.

    s = (fit_high - fit_mean) / fit_mean

    A mutant with fitness fit_high in a population with mean fitness fit_mean
    has selection coefficient s. If s > 1/(2N), selection can act.

    Args:
        fit_high: fitness of the advantaged variant
        fit_mean: mean fitness of the current population

    Returns:
        selection coefficient s (can be negative for deleterious mutations)
    """
    if fit_mean <= 0:
        return 0.0
    return (fit_high - fit_mean) / fit_mean


def drift_threshold(N: int) -> float:
    """Selection coefficient threshold above which selection dominates drift.

    Mutations with s > 1/(2N) are effectively selected; below this,
    they are effectively neutral (drift dominates).

    Args:
        N: effective population size

    Returns:
        1 / (2N)
    """
    return 1.0 / (2.0 * N)


def analyze_selection_regime(
    fit_high: float,
    fit_mean: float,
    N: int,
) -> dict:
    """Determine whether selection or drift dominates for a given fitness contrast.

    Args:
        fit_high: fitness of the best observed genome
        fit_mean: mean fitness of the population
        N: effective population size

    Returns:
        {
            "s": float,             selection coefficient
            "threshold": float,     1/(2N)
            "selection_acts": bool, s > threshold
            "p_fix": float,         fixation probability
            "t_fix_expected": float, expected fixation time (gens)
            "regime": str,          "selection" | "drift" | "neutral"
        }
    """
    s = selection_coefficient_from_fitness(fit_high, fit_mean)
    threshold = drift_threshold(N)
    selection_acts = s > threshold

    p_fix = kimura_fixation_prob(s, N)
    t_fix = expected_fixation_time(s, N) if s > 0 else float("inf")

    if s > threshold:
        regime = "selection"
    elif abs(s) < threshold:
        regime = "neutral" if abs(s) < 1e-6 else "drift"
    else:
        regime = "drift"

    return {
        "s": s,
        "threshold_1_over_2N": threshold,
        "selection_acts": selection_acts,
        "p_fix": p_fix,
        "t_fix_expected": t_fix,
        "regime": regime,
    }
