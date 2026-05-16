"""Experiment driver — runs N generations and logs stats.

The standalone CLI entry uses this. Tests use this. Packet 10 leaderboard
sync also uses this to drive multi-generation experiments.
"""
from __future__ import annotations

import random
from typing import Callable

from .generation import RunMartianCallback, evaluate_and_evolve
from .population import Population
from .stats import compute_from_entries
from .types import EvolutionConfig, GenerationStats


def run_experiment(
    config: EvolutionConfig,
    run_martian: RunMartianCallback,
    generations: int,
    on_generation: Callable[[int, dict], None] | None = None,
) -> tuple[Population, list[GenerationStats]]:
    """Run an evolution experiment for `generations` generations.

    Returns (final_population, all_stats) where all_stats[0] is the stats
    of the initial pool BEFORE any evaluation (all fitness=0.0 for fresh
    populations), and all_stats[i+1] is the stats after generation i.

    The initial stats baseline allows assertions like:
        assert all_stats[-1].mean_fitness > all_stats[0].mean_fitness
    which holds trivially for fresh populations (initial mean=0.0).
    """
    if generations < 1:
        raise ValueError(f"generations must be >= 1; got {generations}")

    rng = random.Random(config.seed) if config.seed is not None else random.Random()

    pop = Population.load_or_create(config)

    # Initial stats snapshot (before any evaluation)
    initial_stats = compute_from_entries(pop.all(), config.martian_type, -1)
    all_stats: list[GenerationStats] = [initial_stats]

    for i in range(generations):
        result = evaluate_and_evolve(pop, config, run_martian, rng)
        all_stats.append(result["stats"])
        if on_generation:
            on_generation(i, result)

    return pop, all_stats
