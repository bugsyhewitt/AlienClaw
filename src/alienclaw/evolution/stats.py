"""Population statistics for evolution runs."""
from __future__ import annotations

import statistics
from datetime import datetime, timezone
from typing import Sequence

from .population import Population
from .types import GenerationStats, PopulationEntry


def compute_from_entries(
    entries: Sequence[PopulationEntry],
    martian_type: str,
    generation: int,
) -> GenerationStats:
    """Compute stats from an explicit list of entries."""
    fitnesses = [e.fitness for e in entries]
    if not fitnesses:
        return GenerationStats(
            martian_type=martian_type,
            generation=generation,
            count=0,
            mean_fitness=0.0,
            median_fitness=0.0,
            max_fitness=0.0,
            min_fitness=0.0,
            stddev_fitness=0.0,
            distinct_genomes=0,
            captured_at=datetime.now(timezone.utc).isoformat(),
        )
    return GenerationStats(
        martian_type=martian_type,
        generation=generation,
        count=len(fitnesses),
        mean_fitness=statistics.fmean(fitnesses),
        median_fitness=float(statistics.median(fitnesses)),
        max_fitness=max(fitnesses),
        min_fitness=min(fitnesses),
        stddev_fitness=statistics.stdev(fitnesses) if len(fitnesses) > 1 else 0.0,
        distinct_genomes=len({e.genome for e in entries}),
        captured_at=datetime.now(timezone.utc).isoformat(),
    )


def compute(pop: Population, generation: int) -> GenerationStats:
    """Compute stats from the current pool of a Population."""
    return compute_from_entries(pop.all(), pop._config.martian_type, generation)
