"""Selection algorithms for the evolution loop.

v1.0 default: tournament selection with K=3.

Tournament selection: sample K entries uniformly from the population,
return the one with highest fitness. Robust against fitness-distribution
surprises (clustering at 0 or 1) common in early evolution runs.

Other algorithms (roulette-wheel, truncation) are stubbed for future
v1.x experimentation but NOT v1.0 production paths.

All functions are deterministic given a seeded RNG.
"""
from __future__ import annotations

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
    """Roulette-wheel (fitness-proportionate) selection. NOT used in v1.0."""
    raise NotImplementedError(
        "roulette_wheel is reserved for future v1.x experimentation. "
        "Use tournament() for v1.0."
    )


def truncation(pop: Population, top_fraction: float, rng: random.Random) -> PopulationEntry:
    """Truncation selection. NOT used in v1.0."""
    raise NotImplementedError(
        "truncation is reserved for future v1.x experimentation. "
        "Use tournament() for v1.0."
    )
