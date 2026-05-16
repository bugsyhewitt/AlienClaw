"""Scale evolution experiment runner.

Runs multi-seed sweeps with per-generation metric capture:
- Fitness statistics (mean, max, min, stddev, distinct_genomes)
- Genome diversity (Hamming distance on current pool, via diversity_tracker)
- Wall-clock elapsed per generation

Each (martian_type, seed) pair produces a JSON file in output_dir.
Populations are isolated per-seed via ALIENCLAW_POPULATIONS_ROOT env override.

Unlike run_experiment(), this drives the generation loop directly so that
the Population object is accessible for diversity computation between steps.
"""
from __future__ import annotations

import json
import os
import random as _random
import time
from pathlib import Path
from typing import Any

import shutil

from alienclaw.diagnostics.diversity_tracker import population_diversity
from alienclaw.evolution.generation import RunMartianCallback, evaluate_and_evolve
from alienclaw.evolution.population import Population
from alienclaw.evolution.types import EvolutionConfig


def run_scale_experiment(
    martian_type: str,
    config_base: EvolutionConfig,
    run_martian_fn: RunMartianCallback,
    generations: int,
    seeds: list[int],
    output_dir: Path,
) -> None:
    """Run scale experiment: one output JSON per (martian_type, seed) pair.

    Args:
        martian_type: Martian type name
        config_base: EvolutionConfig template (seed overridden per run)
        run_martian_fn: fitness callback for the martian_type
        generations: number of generations per seed run
        seeds: list of RNG seeds to sweep over
        output_dir: directory where seed_{seed}.json files are written

    JSON schema per seed:
        {
            "martian_type": str,
            "seed": int,
            "generations": int,
            "population_size": int,
            "per_generation": [
                {
                    "gen": int,
                    "mean_fitness": float,
                    "max_fitness": float,
                    "min_fitness": float,
                    "stddev_fitness": float,
                    "distinct_genomes": int,
                    "diversity": {
                        "unique_genomes": int,
                        "mean_pairwise_hamming": float,
                        "monoculture": bool,
                    },
                    "elapsed_ms": float,
                },
                ...
            ],
        }
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    for seed in seeds:
        per_gen_data: list[dict[str, Any]] = []

        config = EvolutionConfig(
            martian_type=martian_type,
            population_size=config_base.population_size,
            tournament_k=config_base.tournament_k,
            mutation_rate=config_base.mutation_rate,
            crossover_rate=config_base.crossover_rate,
            elitism_count=config_base.elitism_count,
            seed=seed,
        )

        # Isolate population storage per seed.
        seed_pop_dir = output_dir / f"_populations_seed_{seed}"
        seed_pop_dir.mkdir(parents=True, exist_ok=True)

        saved_root = os.environ.get("ALIENCLAW_POPULATIONS_ROOT")
        os.environ["ALIENCLAW_POPULATIONS_ROOT"] = str(seed_pop_dir)

        try:
            rng = _random.Random(seed)
            pop = Population.load_or_create(config)

            for gen_idx in range(generations):
                t_start = time.monotonic()
                result = evaluate_and_evolve(pop, config, run_martian_fn, rng)
                elapsed_ms = (time.monotonic() - t_start) * 1000.0

                stats = result["stats"]

                # Compute diversity on the pool entering the NEXT generation.
                # pop.all() after evaluate_and_evolve returns elite + new children.
                genomes = [e.genome for e in pop.all()]
                div = population_diversity(genomes)

                per_gen_data.append({
                    "gen": stats.generation,
                    "mean_fitness": round(stats.mean_fitness, 6),
                    "max_fitness": round(stats.max_fitness, 6),
                    "min_fitness": round(stats.min_fitness, 6),
                    "stddev_fitness": round(stats.stddev_fitness, 6),
                    "distinct_genomes": stats.distinct_genomes,
                    "diversity": {
                        "unique_genomes": div["unique_genomes"],
                        "mean_pairwise_hamming": round(div["mean_pairwise_hamming"], 4),
                        "monoculture": div["monoculture"],
                    },
                    "elapsed_ms": round(elapsed_ms, 2),
                })

        finally:
            if saved_root is None:
                os.environ.pop("ALIENCLAW_POPULATIONS_ROOT", None)
            else:
                os.environ["ALIENCLAW_POPULATIONS_ROOT"] = saved_root

        out = {
            "martian_type": martian_type,
            "seed": seed,
            "generations": generations,
            "population_size": config.population_size,
            "per_generation": per_gen_data,
        }

        out_file = output_dir / f"seed_{seed}.json"
        out_file.write_text(json.dumps(out, indent=2))

        # Clean up temporary population directory to keep disk usage bounded.
        # The results are now safely in seed_{seed}.json.
        if seed_pop_dir.exists():
            shutil.rmtree(seed_pop_dir, ignore_errors=True)
