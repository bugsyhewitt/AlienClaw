"""Scaling experiment orchestrator for Packet 27 formula research.

Two modes:
1. Landscape sampling: evaluate N random genomes under each formula × k combination
   (analytical; fast; shows gradient shape without full evolution)
2. Formula evolution: run 50-gen evolution with each formula applied post-hoc
   (actual evolutionary dynamics; slower but shows real selection behavior)
"""
from __future__ import annotations

import json
import os
import random as _random
import tempfile
import time
from pathlib import Path
from typing import Any, Callable

import numpy as np

from alienclaw.diagnostics.fitness_formula_candidates import (
    FitnessFormulaResult,
    make_formula_bridge_runner,
    landscape_grid,
)
from alienclaw.diagnostics.dynamics_summary import DynamicsSummary, summarize_dynamics
from alienclaw.evolution.generation import RunMartianCallback, evaluate_and_evolve
from alienclaw.evolution.population import Population
from alienclaw.evolution.types import EvolutionConfig


def sample_landscape(
    martian_type: str,
    inputs: dict[str, Any],
    formula_fn: Callable[..., FitnessFormulaResult],
    slot_count: int,
    n_genomes: int = 200,
    seeds: list[int] | None = None,
    **formula_kwargs: Any,
) -> dict[str, Any]:
    """Evaluate n_genomes random genomes and apply a formula post-hoc.

    Calls the bridge normally, extracts (correctness, tool_calls) from run_metadata,
    then applies formula_fn to compute candidate fitness.

    Returns:
        {
            "martian_type": str,
            "formula_name": str,
            "slot_count": int,
            "n_genomes": int,
            "records": [{"genome": str, "correctness": float, "tool_calls": int,
                         "original_fitness": float, "formula_fitness": float}],
            "summary": {
                "mean_formula_fitness": float,
                "max_formula_fitness": float,
                "n_unique_fitnesses": int,
                "fitness_range": [float, float],
            }
        }
    """
    if seeds is None:
        seeds = [42]

    runner = make_formula_bridge_runner(martian_type, inputs, formula_fn, slot_count, **formula_kwargs)

    all_records = []
    for seed in seeds:
        config = EvolutionConfig(martian_type=martian_type, population_size=n_genomes, seed=seed)
        with tempfile.TemporaryDirectory() as tmp:
            saved = os.environ.get("ALIENCLAW_POPULATIONS_ROOT")
            os.environ["ALIENCLAW_POPULATIONS_ROOT"] = tmp
            try:
                pop = Population.load_or_create(config)
                pool = pop.all()
            finally:
                if saved is None:
                    os.environ.pop("ALIENCLAW_POPULATIONS_ROOT", None)
                else:
                    os.environ["ALIENCLAW_POPULATIONS_ROOT"] = saved

        for entry in pool:
            report = runner(martian_type, entry.genome)
            meta = report.run_metadata
            all_records.append({
                "genome": entry.genome,
                "seed": seed,
                "correctness": meta.get("correctness", 0.0),
                "tool_calls": meta.get("tool_calls", slot_count),
                "original_fitness": meta.get("correctness", 0.0) / max(meta.get("tool_calls", 1), 1),
                "formula_fitness": report.fitness,
            })

    fitnesses = [r["formula_fitness"] for r in all_records]
    formula_name = all_records[0]["formula_fitness"] if all_records else "unknown"
    # Get formula name from a test run
    test_result = formula_fn(1.0, slot_count, slot_count, **formula_kwargs)

    return {
        "martian_type": martian_type,
        "formula_name": test_result.formula_name,
        "slot_count": slot_count,
        "n_genomes": len(all_records),
        "records": all_records,
        "summary": {
            "mean_formula_fitness": round(float(np.mean(fitnesses)), 6) if fitnesses else 0.0,
            "max_formula_fitness": round(float(np.max(fitnesses)), 6) if fitnesses else 0.0,
            "n_unique_fitnesses": len(set(round(f, 4) for f in fitnesses)),
            "fitness_range": [
                round(float(min(fitnesses)), 4) if fitnesses else 0.0,
                round(float(max(fitnesses)), 4) if fitnesses else 0.0,
            ],
        },
    }


def run_formula_evolution(
    martian_type: str,
    inputs: dict[str, Any],
    formula_fn: Callable[..., FitnessFormulaResult],
    slot_count: int,
    population_size: int = 100,
    generations: int = 50,
    seeds: list[int] | None = None,
    **formula_kwargs: Any,
) -> list[dict[str, Any]]:
    """Run evolution with a candidate formula applied post-hoc.

    Returns:
        List of per-seed dicts: {
            seed: int,
            per_generation: [{gen, mean_fitness, max_fitness, distinct_genomes, elapsed_ms}],
            genome_fitness_pairs: [(genome, fitness)] for MI analysis
        }
    """
    if seeds is None:
        seeds = [42, 43, 44]

    runner = make_formula_bridge_runner(martian_type, inputs, formula_fn, slot_count, **formula_kwargs)
    results = []

    for seed in seeds:
        per_gen_data = []
        genome_fitness_pairs = []

        config = EvolutionConfig(
            martian_type=martian_type,
            population_size=population_size,
            seed=seed,
        )

        with tempfile.TemporaryDirectory() as tmp:
            saved = os.environ.get("ALIENCLAW_POPULATIONS_ROOT")
            os.environ["ALIENCLAW_POPULATIONS_ROOT"] = tmp
            try:
                rng = _random.Random(seed)
                pop = Population.load_or_create(config)

                for gen_idx in range(generations):
                    t0 = time.monotonic()
                    result = evaluate_and_evolve(pop, config, runner, rng)
                    elapsed_ms = (time.monotonic() - t0) * 1000.0

                    # Capture genome-fitness pairs from current pool for MI analysis
                    if gen_idx % 10 == 0:  # sample every 10 gens
                        for entry in pop.all()[:20]:  # sample 20 genomes per gen
                            r = runner(martian_type, entry.genome)
                            genome_fitness_pairs.append((entry.genome, r.fitness))

                    stats = result["stats"]
                    per_gen_data.append({
                        "gen": stats.generation,
                        "mean_fitness": round(stats.mean_fitness, 6),
                        "max_fitness": round(stats.max_fitness, 6),
                        "distinct_genomes": stats.distinct_genomes,
                        "elapsed_ms": round(elapsed_ms, 2),
                    })
            finally:
                if saved is None:
                    os.environ.pop("ALIENCLAW_POPULATIONS_ROOT", None)
                else:
                    os.environ["ALIENCLAW_POPULATIONS_ROOT"] = saved

        results.append({
            "seed": seed,
            "per_generation": per_gen_data,
            "genome_fitness_pairs": genome_fitness_pairs,
        })

    return results


def compute_dynamics_summary(
    seed_results: list[dict],
    population_size: int,
) -> DynamicsSummary:
    """Compute dynamics summary averaged across seeds."""
    all_curves = [[pg["mean_fitness"] for pg in r["per_generation"]] for r in seed_results]
    all_pairs = [pair for r in seed_results for pair in r.get("genome_fitness_pairs", [])]

    # Use mean curve across seeds for single summary
    if not all_curves:
        return DynamicsSummary(0.0, 0.0, 0.0, 0.0, 0.0, 0, 0.0, 0.0)

    min_len = min(len(c) for c in all_curves)
    mean_curve = [
        float(np.mean([c[i] for c in all_curves]))
        for i in range(min_len)
    ]

    return summarize_dynamics(mean_curve, all_pairs, population_size)
