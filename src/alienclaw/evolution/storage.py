"""Filesystem-backed population storage.

Layout:
    <populations_root>/
        <martian_type>/
            metadata.json        (config snapshot, generation count)
            entries/
                <entry_id>.json  (one entry per genome — append-only)
            stats/
                gen-0000.json    (one stats record per generation)

Atomic writes (tmpfile + fsync + rename) protect against partial writes on crash.
Append-only: existing entries are NEVER modified; new entries are added as new files.

Callers access this only through Population. Never use PopulationStorage directly.
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

from .types import EvolutionConfig, GenerationStats, PopulationEntry


def populations_root() -> Path:
    override = os.environ.get("ALIENCLAW_POPULATIONS_ROOT")
    if override:
        return Path(override)
    return Path.home() / ".alienclaw" / "populations"


def _config_to_dict(config: EvolutionConfig) -> dict[str, Any]:
    return {
        "martian_type": config.martian_type,
        "population_size": config.population_size,
        "tournament_k": config.tournament_k,
        "mutation_rate": config.mutation_rate,
        "crossover_rate": config.crossover_rate,
        "elitism_count": config.elitism_count,
        "seed": config.seed,
        "selection_strategy": config.selection_strategy,
        "truncation_top_fraction": config.truncation_top_fraction,
    }


def _config_from_dict(d: dict[str, Any]) -> EvolutionConfig:
    return EvolutionConfig(
        martian_type=d["martian_type"],
        population_size=d.get("population_size", 32),
        tournament_k=d.get("tournament_k", 3),
        mutation_rate=d.get("mutation_rate", 1.0 / 256.0),
        crossover_rate=d.get("crossover_rate", 0.5),
        elitism_count=d.get("elitism_count", 2),
        seed=d.get("seed"),
        selection_strategy=d.get("selection_strategy", "tournament"),
        truncation_top_fraction=d.get("truncation_top_fraction", 0.5),
    )


def _entry_to_dict(entry: PopulationEntry) -> dict[str, Any]:
    return {
        "entry_id": entry.entry_id,
        "genome": entry.genome,
        "fitness": entry.fitness,
        "generation": entry.generation,
        "parent_ids": list(entry.parent_ids),
        "run_metadata": entry.run_metadata,
        "created_at": entry.created_at,
    }


def _entry_from_dict(d: dict[str, Any]) -> PopulationEntry:
    return PopulationEntry(
        entry_id=d["entry_id"],
        genome=d["genome"],
        fitness=float(d["fitness"]),
        generation=int(d["generation"]),
        parent_ids=tuple(d.get("parent_ids", [])),
        run_metadata=d.get("run_metadata", {}),
        created_at=d["created_at"],
    )


def _stats_to_dict(s: GenerationStats) -> dict[str, Any]:
    return {
        "martian_type": s.martian_type,
        "generation": s.generation,
        "count": s.count,
        "mean_fitness": s.mean_fitness,
        "median_fitness": s.median_fitness,
        "max_fitness": s.max_fitness,
        "min_fitness": s.min_fitness,
        "stddev_fitness": s.stddev_fitness,
        "distinct_genomes": s.distinct_genomes,
        "captured_at": s.captured_at,
    }


def _stats_from_dict(d: dict[str, Any]) -> GenerationStats:
    return GenerationStats(**d)


class PopulationStorage:
    def __init__(self, martian_type: str):
        self.martian_type = martian_type
        self.root = populations_root() / martian_type
        self.entries_dir = self.root / "entries"
        self.stats_dir = self.root / "stats"
        self.metadata_path = self.root / "metadata.json"

    def initialize(self, config: EvolutionConfig) -> None:
        self.entries_dir.mkdir(parents=True, exist_ok=True)
        self.stats_dir.mkdir(parents=True, exist_ok=True)
        if not self.metadata_path.exists():
            self._atomic_write_json(self.metadata_path, {
                "martian_type": self.martian_type,
                "config": _config_to_dict(config),
                "generations": 0,
            })

    def exists(self) -> bool:
        return self.metadata_path.exists()

    def read_config(self) -> EvolutionConfig:
        with self.metadata_path.open("r", encoding="utf-8") as f:
            md = json.load(f)
        return _config_from_dict(md.get("config", {"martian_type": self.martian_type}))

    def write_entry(self, entry: PopulationEntry) -> None:
        path = self.entries_dir / f"{entry.entry_id}.json"
        self._atomic_write_json(path, _entry_to_dict(entry))

    def read_all_entries(self) -> list[PopulationEntry]:
        if not self.entries_dir.exists():
            return []
        entries = []
        for p in sorted(self.entries_dir.iterdir()):
            if p.suffix != ".json":
                continue
            with p.open("r", encoding="utf-8") as f:
                entries.append(_entry_from_dict(json.load(f)))
        return entries

    def write_stats(self, stats: GenerationStats) -> None:
        path = self.stats_dir / f"gen-{stats.generation:04d}.json"
        self._atomic_write_json(path, _stats_to_dict(stats))

    def read_all_stats(self) -> list[GenerationStats]:
        if not self.stats_dir.exists():
            return []
        result = []
        for p in sorted(self.stats_dir.iterdir()):
            if p.suffix != ".json":
                continue
            with p.open("r", encoding="utf-8") as f:
                result.append(_stats_from_dict(json.load(f)))
        return result

    def increment_generation(self) -> int:
        with self.metadata_path.open("r", encoding="utf-8") as f:
            md = json.load(f)
        md["generations"] = int(md.get("generations", 0)) + 1
        self._atomic_write_json(self.metadata_path, md)
        return md["generations"]

    def current_generation(self) -> int:
        if not self.metadata_path.exists():
            return 0
        with self.metadata_path.open("r", encoding="utf-8") as f:
            return int(json.load(f).get("generations", 0))

    def clear(self) -> None:
        import shutil
        if self.root.exists():
            shutil.rmtree(self.root)

    @staticmethod
    def _atomic_write_json(path: Path, payload: dict) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp-")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(payload, f, indent=2, sort_keys=True)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp_path, path)
        except Exception:
            try:
                os.unlink(tmp_path)
            except FileNotFoundError:
                pass
            raise
