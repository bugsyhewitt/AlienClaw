"""One full generational step.

Step:
  1. Evaluate every entry in the current pool via run_martian callback.
     Creates evaluated entries (written to disk history, replaces pool).
  2. Compute GenerationStats over the evaluated entries; persist.
  3. Select parents via tournament, produce children via mutation+crossover.
  4. Replace pool with: top elitism_count evaluated entries + new children.
  5. Increment generation counter.

The run_martian callback is a Callable[[str, str], FitnessReport] — it
takes (martian_type, genome) and returns a FitnessReport. Tests pass in
a deterministic mock; Phase 6 wires in the real bridge.
"""
from __future__ import annotations

import random
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

from alienclaw.genome.operators import crossover, mutate, mutate_directed

from .population import Population
from .selection import tournament
from .stats import compute_from_entries
from .types import EvolutionConfig, PopulationEntry


@dataclass
class FitnessReport:
    fitness: float
    run_metadata: dict[str, Any] = field(default_factory=dict)


RunMartianCallback = Callable[[str, str], FitnessReport]


def _make_entry(
    genome: str,
    fitness: float,
    generation: int,
    parent_ids: tuple[str, ...],
    run_metadata: dict[str, Any],
) -> PopulationEntry:
    return PopulationEntry(
        entry_id=str(uuid.uuid4()),
        genome=genome,
        fitness=max(0.0, min(1.0, fitness)),
        generation=generation,
        parent_ids=parent_ids,
        run_metadata=dict(run_metadata),
        created_at=datetime.now(timezone.utc).isoformat(),
    )


def evaluate_and_evolve(
    pop: Population,
    config: EvolutionConfig,
    run_martian: RunMartianCallback,
    rng: random.Random,
) -> dict[str, Any]:
    """Run one generational step. Returns a result dict for logging."""
    generation = pop.current_generation()
    current_pool = list(pop.all())

    # Step 1: Evaluate every entry in current pool
    evaluated: list[PopulationEntry] = []
    for entry in current_pool:
        report = run_martian(config.martian_type, entry.genome)
        new_entry = _make_entry(
            genome=entry.genome,
            fitness=report.fitness,
            generation=generation,
            parent_ids=(entry.entry_id,),
            run_metadata={**report.run_metadata, "re_evaluated": True},
        )
        pop._storage.write_entry(new_entry)
        evaluated.append(new_entry)

    # Replace pool with evaluated entries so tournament can select from them
    pop.replace_pool(evaluated)

    # Step 2: Stats over evaluated entries
    stats = compute_from_entries(evaluated, config.martian_type, generation)
    pop._storage.write_stats(stats)

    # Step 3-4: Select parents, produce children
    elite = sorted(evaluated, key=lambda e: e.fitness, reverse=True)[: config.elitism_count]
    children_needed = config.population_size - config.elitism_count
    children: list[PopulationEntry] = []
    for _ in range(children_needed):
        if rng.random() < config.crossover_rate:
            pa = tournament(pop, config.tournament_k, rng).genome
            pb = tournament(pop, config.tournament_k, rng).genome
            child_genome = crossover(pa, pb, rng)
        else:
            parent_genome = tournament(pop, config.tournament_k, rng).genome
            if config.brain is not None:
                child_genome = mutate_directed(parent_genome, [None, config.brain, None, None], rng)
            else:
                child_genome = mutate(parent_genome, rng, config.mutation_rate)
        child_entry = _make_entry(
            genome=child_genome,
            fitness=0.0,
            generation=generation + 1,
            parent_ids=(),
            run_metadata={"newly_minted": True},
        )
        pop._storage.write_entry(child_entry)
        children.append(child_entry)

    # Step 5: New pool = elite + children
    pop.replace_pool(list(elite) + children)
    pop.increment_generation()

    return {
        "generation": generation,
        "next_generation": generation + 1,
        "stats": stats,
        "children_minted": len(children),
    }
