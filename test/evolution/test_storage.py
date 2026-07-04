import json
from pathlib import Path

import pytest

from alienclaw.evolution.storage import PopulationStorage, populations_root
from alienclaw.evolution.types import EvolutionConfig, GenerationStats, PopulationEntry


@pytest.fixture(autouse=True)
def isolate_populations(tmp_path, monkeypatch):
    monkeypatch.setenv("ALIENCLAW_POPULATIONS_ROOT", str(tmp_path / "populations"))
    yield


@pytest.fixture
def config():
    return EvolutionConfig(martian_type="compute", population_size=4, seed=1)


@pytest.fixture
def storage(config):
    s = PopulationStorage("compute")
    s.initialize(config)
    return s


def _make_entry(genome="A" * 256, fitness=0.5, generation=0):
    return PopulationEntry(
        entry_id="test-id-1",
        genome=genome,
        fitness=fitness,
        generation=generation,
        parent_ids=(),
        run_metadata={"seeded": True},
        created_at="2026-01-01T00:00:00+00:00",
    )


def _make_stats(generation=0):
    return GenerationStats(
        martian_type="compute",
        generation=generation,
        count=4,
        mean_fitness=0.5,
        median_fitness=0.5,
        max_fitness=1.0,
        min_fitness=0.0,
        stddev_fitness=0.25,
        distinct_genomes=4,
        captured_at="2026-01-01T00:00:00+00:00",
    )


class TestPopulationStorage:
    def test_initialize_creates_dirs(self, config):
        s = PopulationStorage("compute")
        s.initialize(config)
        assert s.entries_dir.exists()
        assert s.stats_dir.exists()
        assert s.metadata_path.exists()

    def test_initialize_is_idempotent(self, config):
        s = PopulationStorage("compute")
        s.initialize(config)
        s.initialize(config)  # should not raise
        assert s.metadata_path.exists()

    def test_exists_false_before_initialize(self):
        s = PopulationStorage("not_yet")
        assert not s.exists()

    def test_exists_true_after_initialize(self, config):
        s = PopulationStorage("compute")
        s.initialize(config)
        assert s.exists()

    def test_write_read_entry_roundtrip(self, storage):
        entry = _make_entry()
        storage.write_entry(entry)
        entries = storage.read_all_entries()
        assert len(entries) == 1
        assert entries[0].entry_id == "test-id-1"
        assert entries[0].fitness == pytest.approx(0.5)
        assert entries[0].generation == 0

    def test_read_all_entries_empty(self):
        s = PopulationStorage("compute")
        s.initialize(EvolutionConfig(martian_type="compute"))
        assert s.read_all_entries() == []

    def test_write_multiple_entries(self, storage):
        for i in range(3):
            entry = PopulationEntry(
                entry_id=f"id-{i}",
                genome="B" * 256,
                fitness=float(i) / 10.0,
                generation=0,
                parent_ids=(),
                run_metadata={},
                created_at="2026-01-01T00:00:00+00:00",
            )
            storage.write_entry(entry)
        entries = storage.read_all_entries()
        assert len(entries) == 3

    def test_increment_generation(self, storage):
        assert storage.current_generation() == 0
        storage.increment_generation()
        assert storage.current_generation() == 1
        storage.increment_generation()
        assert storage.current_generation() == 2

    def test_write_stats(self, storage):
        stats = GenerationStats(
            martian_type="compute", generation=0, count=4,
            mean_fitness=0.5, median_fitness=0.5, max_fitness=1.0,
            min_fitness=0.0, stddev_fitness=0.25, distinct_genomes=4,
            captured_at="2026-01-01T00:00:00+00:00",
        )
        storage.write_stats(stats)
        all_stats = storage.read_all_stats()
        assert len(all_stats) == 1
        assert all_stats[0].generation == 0
        assert all_stats[0].mean_fitness == pytest.approx(0.5)

    def test_clear_removes_directory(self, storage):
        storage.write_entry(_make_entry())
        storage.clear()
        assert not storage.root.exists()

    def test_read_config_roundtrip(self, config):
        s = PopulationStorage("compute")
        s.initialize(config)
        loaded = s.read_config()
        assert loaded.martian_type == config.martian_type
        assert loaded.population_size == config.population_size
        assert loaded.tournament_k == config.tournament_k

    def test_atomic_write_creates_file(self, storage):
        path = storage.root / "test.json"
        PopulationStorage._atomic_write_json(path, {"key": "value"})
        with path.open() as f:
            data = json.load(f)
        assert data["key"] == "value"

    # --- Category 1: populations_root() default path ---

    def test_populations_root_default_uses_home(self, monkeypatch):
        monkeypatch.delenv("ALIENCLAW_POPULATIONS_ROOT", raising=False)
        result = populations_root()
        assert result == Path.home() / ".alienclaw" / "populations"

    # --- Category 2: pre-init / post-clear read guards ---

    def test_read_all_entries_returns_empty_after_clear(self, storage):
        storage.write_entry(_make_entry())
        storage.clear()
        assert storage.read_all_entries() == []

    def test_read_all_stats_returns_empty_after_clear(self, storage):
        storage.write_stats(_make_stats())
        storage.clear()
        assert storage.read_all_stats() == []

    def test_current_generation_before_initialize_returns_zero(self):
        s = PopulationStorage("never_init")
        assert s.current_generation() == 0

    # --- Category 3: non-JSON file skip ---

    def test_non_json_files_skipped_in_entries(self, storage):
        storage.write_entry(_make_entry())
        (storage.entries_dir / "stray.tmp").write_text("noise")
        assert len(storage.read_all_entries()) == 1

    def test_non_json_files_skipped_in_stats(self, storage):
        storage.write_stats(_make_stats())
        (storage.stats_dir / "stray.bak").write_text("noise")
        assert len(storage.read_all_stats()) == 1

    # --- Category 4: clear() no-op on uninitialized storage ---

    def test_clear_is_safe_on_uninitialized_storage(self):
        s = PopulationStorage("never_init")
        s.clear()  # no-op: root doesn't exist
        assert not s.root.exists()

    # --- Category 5: _atomic_write_json exception cleanup ---

    def test_atomic_write_cleans_up_on_failure(self, tmp_path):
        path = tmp_path / "output.json"
        with pytest.raises(TypeError):
            PopulationStorage._atomic_write_json(path, {"bad": object()})
        stray = list(tmp_path.glob(".tmp-*"))
        assert stray == [], f"temp file not cleaned up: {stray}"

    def test_atomic_write_cleanup_tolerates_already_gone_tmp(self, tmp_path, monkeypatch):
        # Cover L193-194: unlink raises FileNotFoundError; inner except suppresses it
        import os as _os

        def _unlink_raises_fnf(p):
            raise FileNotFoundError(p)

        monkeypatch.setattr(_os, "unlink", _unlink_raises_fnf)
        path = tmp_path / "output.json"
        with pytest.raises(TypeError):
            PopulationStorage._atomic_write_json(path, {"bad": object()})
