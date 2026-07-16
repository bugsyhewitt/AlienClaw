"""Selection algorithms for the evolution loop.

v1.0 default: tournament selection with K=3.

Tournament selection: sample K entries uniformly from the population,
return the one with highest fitness. Robust against fitness-distribution
surprises (clustering at 0 or 1) common in early evolution runs.

Roulette-wheel and truncation are implemented for v1.x experimentation;
generation.py keeps tournament() as the v1.0 production path.

All functions are deterministic given a seeded RNG.
"""
from __future__ import annotations

import math
import random

from .population import Population
from .types import PopulationEntry


def tournament(pop: Population, k: int, rng: random.Random) -> PopulationEntry:
    """Tournament selection — sample K entries, return highest-fitness one.

    k=3 is the v1.0 default. k=1 is equivalent to uniform sampling.
    k >= population size always picks the best.
    """
    if k < 1:
        raise ValueError(f"tournament k must be >= 1; got {k}")
    contestants = [pop.sample(rng) for _ in range(k)]
    return max(contestants, key=lambda e: e.fitness)


def roulette_wheel(pop: Population, rng: random.Random) -> PopulationEntry:
    """Roulette-wheel (fitness-proportionate) selection.

    Each entry is drawn with probability fitness / total_fitness. When the
    pool's total fitness is 0 (e.g. a freshly seeded population), falls back
    to a uniform draw so callers never crash on all-zero pools — mirroring
    tournament() behavior. Fitness is validated to [0, 1] at add() time, so
    no negative-weight handling is needed.
    """
    entries = pop.all()
    weights = [e.fitness for e in entries]
    total = sum(weights)
    if total <= 0.0:
        return pop.sample(rng)  # also raises the canonical error on empty pools
    return rng.choices(entries, weights=weights, k=1)[0]


def truncation(pop: Population, top_fraction: float, rng: random.Random) -> PopulationEntry:
    """Truncation selection — uniform draw from the top fraction by fitness.

    top_fraction=1.0 degenerates to uniform sampling; at least one entry
    (the current best) is always eligible. Fitness ties rank by entry_id so
    the eligible set is stable for a given pool regardless of insertion order.
    """
    if not (0.0 < top_fraction <= 1.0):
        raise ValueError(f"truncation top_fraction must be in (0.0, 1.0]; got {top_fraction}")
    entries = pop.all()
    if not entries:
        return pop.sample(rng)  # raises the canonical empty-pool error
    cutoff = max(1, math.ceil(len(entries) * top_fraction))
    ranked = sorted(entries, key=lambda e: (-e.fitness, e.entry_id))
    return rng.choice(ranked[:cutoff])
