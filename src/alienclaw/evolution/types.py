from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class PopulationEntry:
    """One genome's record in a population.

    Frozen: mutation produces NEW entries; existing entries never modified.
    """
    entry_id: str
    genome: str
    fitness: float
    generation: int
    parent_ids: tuple[str, ...]
    run_metadata: dict[str, Any]
    created_at: str


@dataclass(frozen=True)
class GenerationStats:
    """Statistics snapshot for one population at one generation."""
    martian_type: str
    generation: int
    count: int
    mean_fitness: float
    median_fitness: float
    max_fitness: float
    min_fitness: float
    stddev_fitness: float
    distinct_genomes: int
    captured_at: str


@dataclass(frozen=True)
class EvolutionConfig:
    """Parameters for an evolution run.

    Defaults chosen for v1.0 based on robustness over tuning:
    - population_size=32: manageable without perf work
    - tournament_k=3: robust against early-phase fitness clustering
    - mutation_rate=1/256: matches GENOME_SPEC.md per-character rate
    - crossover_rate=0.5: equal mix of mutation-only and crossover children
    - elitism_count=2: top-2 always survive each generation
    """
    martian_type: str
    population_size: int = 32
    tournament_k: int = 3
    mutation_rate: float = 1.0 / 256.0
    crossover_rate: float = 0.5
    elitism_count: int = 2
    seed: int | None = None
