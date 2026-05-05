"""Population — public API for the evolution layer.

Callers (generation step, bridge, Packet 10 leaderboard sync) go through
Population. Storage details are internal to PopulationStorage.

Public API:
  Population.create(config) -> Population   (initialize + seed)
  Population.load(martian_type) -> Population   (open existing)
  sample(rng) -> PopulationEntry            (uniform draw for selection)
  add(genome, fitness, generation, parent_ids, run_metadata) -> PopulationEntry
  top(n) -> list[PopulationEntry]           (highest-fitness n entries)
  all() -> list[PopulationEntry]            (all entries in current pool)
  current_generation() -> int
  increment_generation() -> int
  snapshot() -> dict                        (for serialization / debug)
  clear()                                   (tests only)
  replace_pool(entries)                     (internal: used by generation step)
"""
from __future__ import annotations

import random
import statistics
import uuid
from datetime import datetime, timezone
from typing import Any

from alienclaw.genome.operators import random_genome
from alienclaw.genome.validation import validate as validate_genome

from .storage import PopulationStorage
from .types import EvolutionConfig, PopulationEntry


def _id_tag_for(martian_type: str) -> str:
    """Stable 8-char Base62 ID tag derived from martian_type name."""
    clean = "".join(c.upper() for c in martian_type if c.isalnum())[:6].ljust(6, "0")
    return clean + "01"


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
        fitness=fitness,
        generation=generation,
        parent_ids=parent_ids,
        run_metadata=dict(run_metadata),
        created_at=datetime.now(timezone.utc).isoformat(),
    )


class Population:
    def __init__(self, storage: PopulationStorage, config: EvolutionConfig, pool: list[PopulationEntry]):
        self._storage = storage
        self._config = config
        self._pool: list[PopulationEntry] = pool

    @classmethod
    def create(cls, config: EvolutionConfig) -> "Population":
        storage = PopulationStorage(config.martian_type)
        if storage.exists():
            raise ValueError(
                f"Population for '{config.martian_type}' already exists. "
                "Use Population.load() instead, or call clear() first."
            )
        storage.initialize(config)
        pop = cls(storage, config, [])
        rng = random.Random(config.seed) if config.seed is not None else random.Random()
        id_tag = _id_tag_for(config.martian_type)
        for _ in range(config.population_size):
            g = random_genome(rng, id_tag)
            entry = _make_entry(g, 0.0, 0, (), {"seeded": True})
            storage.write_entry(entry)
            pop._pool.append(entry)
        return pop

    @classmethod
    def load(cls, martian_type: str) -> "Population":
        storage = PopulationStorage(martian_type)
        if not storage.exists():
            raise FileNotFoundError(f"No population for '{martian_type}'. Use Population.create() first.")
        config = storage.read_config()
        all_entries = storage.read_all_entries()
        if not all_entries:
            return cls(storage, config, [])
        current_gen = storage.current_generation()
        pool = [e for e in all_entries if e.generation == current_gen]
        if not pool:
            pool = all_entries[-config.population_size:]
        return cls(storage, config, pool)

    @classmethod
    def load_or_create(cls, config: EvolutionConfig) -> "Population":
        storage = PopulationStorage(config.martian_type)
        if storage.exists():
            return cls.load(config.martian_type)
        return cls.create(config)

    def sample(self, rng: random.Random) -> PopulationEntry:
        if not self._pool:
            raise RuntimeError("Cannot sample from empty population")
        return rng.choice(self._pool)

    def add(
        self,
        genome: str,
        fitness: float,
        generation: int,
        parent_ids: tuple[str, ...],
        run_metadata: dict[str, Any],
    ) -> PopulationEntry:
        v = validate_genome(genome)
        if not v.valid:
            raise ValueError(f"Genome validation failed: {'; '.join(v.errors)}")
        if not (0.0 <= fitness <= 1.0):
            raise ValueError(f"fitness must be in [0.0, 1.0]; got {fitness}")
        entry = _make_entry(genome, fitness, generation, parent_ids, run_metadata)
        self._storage.write_entry(entry)
        self._pool.append(entry)
        return entry

    def top(self, n: int) -> list[PopulationEntry]:
        return sorted(self._pool, key=lambda e: e.fitness, reverse=True)[:n]

    def all(self) -> list[PopulationEntry]:
        return list(self._pool)

    def current_generation(self) -> int:
        return self._storage.current_generation()

    def increment_generation(self) -> int:
        return self._storage.increment_generation()

    def snapshot(self) -> dict[str, Any]:
        fitnesses = [e.fitness for e in self._pool]
        return {
            "martian_type": self._config.martian_type,
            "generation": self.current_generation(),
            "size": len(self._pool),
            "top_fitness": max(fitnesses, default=0.0),
            "mean_fitness": statistics.fmean(fitnesses) if fitnesses else 0.0,
            "config": {
                "population_size": self._config.population_size,
                "tournament_k": self._config.tournament_k,
                "mutation_rate": self._config.mutation_rate,
            },
        }

    def replace_pool(self, entries: list[PopulationEntry]) -> None:
        """Replace in-memory pool without writing to disk. Used by generation step."""
        self._pool = list(entries)

    def clear(self) -> None:
        """Remove all data. Tests only."""
        self._storage.clear()
        self._pool.clear()
