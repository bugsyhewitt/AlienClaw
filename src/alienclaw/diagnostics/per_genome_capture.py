"""Capture per-genome (genome, fitness) records from evolution runs.

Unlike scale_experiment.py which records aggregate per-generation stats,
this module captures every individual genome evaluation for information-
theoretic analysis.

Used by Packet 26's H2 mutual information analysis.
"""
from __future__ import annotations

import os
import random as _random
import tempfile
from typing import Any

from alienclaw.evolution.generation import RunMartianCallback, evaluate_and_evolve
from alienclaw.evolution.population import Population
from alienclaw.evolution.types import EvolutionConfig


def capture_per_genome(
    martian_type: str,
    run_martian_fn: RunMartianCallback,
    config: EvolutionConfig,
    generations: int,
) -> list[dict[str, Any]]:
    """Run evolution and capture every (genome, fitness) pair evaluated.

    Args:
        martian_type: Martian type name
        run_martian_fn: fitness callback
        config: EvolutionConfig (seed set for reproducibility)
        generations: number of generations to run

    Returns:
        List of {"genome": str, "fitness": float, "gen": int} records.
        One record per genome per generation (population_size × generations total).
    """
    records: list[dict[str, Any]] = []
    rng = _random.Random(config.seed)
    pop = Population.load_or_create(config)

    for gen_idx in range(generations):
        current_pool = list(pop.all())

        for entry in current_pool:
            report = run_martian_fn(martian_type, entry.genome)
            records.append({
                "genome": entry.genome,
                "fitness": report.fitness,
                "gen": gen_idx,
            })

        # Run full generation step (evaluate + evolve)
        evaluate_and_evolve(pop, config, run_martian_fn, rng)

    return records


def run_per_genome_capture(
    martian_type: str,
    run_martian_fn: RunMartianCallback,
    population_size: int,
    generations: int,
    seeds: list[int],
) -> list[dict[str, Any]]:
    """Run per-genome capture across multiple seeds.

    Each seed uses an isolated population directory.

    Args:
        martian_type: Martian type name
        run_martian_fn: fitness callback
        population_size: population size per run
        generations: generations per seed
        seeds: list of RNG seeds

    Returns:
        Combined list of {"genome", "fitness", "gen", "seed"} records.
    """
    all_records: list[dict[str, Any]] = []

    for seed in seeds:
        config = EvolutionConfig(
            martian_type=martian_type,
            population_size=population_size,
            seed=seed,
        )

        with tempfile.TemporaryDirectory() as tmp:
            saved = os.environ.get("ALIENCLAW_POPULATIONS_ROOT")
            os.environ["ALIENCLAW_POPULATIONS_ROOT"] = tmp
            try:
                records = capture_per_genome(martian_type, run_martian_fn, config, generations)
            finally:
                if saved is None:
                    os.environ.pop("ALIENCLAW_POPULATIONS_ROOT", None)
                else:
                    os.environ["ALIENCLAW_POPULATIONS_ROOT"] = saved

        for r in records:
            r["seed"] = seed
        all_records.extend(records)

    return all_records
