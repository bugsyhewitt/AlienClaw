import pytest

from alienclaw.evolution.stats import compute, compute_from_entries
from alienclaw.evolution.types import EvolutionConfig, PopulationEntry


@pytest.fixture(autouse=True)
def isolate_populations(tmp_path, monkeypatch):
    monkeypatch.setenv("ALIENCLAW_POPULATIONS_ROOT", str(tmp_path / "populations"))
    yield


def _entry(genome="A" * 256, fitness=0.5, generation=0, entry_id="x"):
    return PopulationEntry(
        entry_id=entry_id,
        genome=genome,
        fitness=fitness,
        generation=generation,
        parent_ids=(),
        run_metadata={},
        created_at="2026-01-01T00:00:00+00:00",
    )


class TestComputeFromEntries:
    def test_empty_population(self):
        stats = compute_from_entries([], "compute", 0)
        assert stats.count == 0
        assert stats.mean_fitness == pytest.approx(0.0)
        assert stats.max_fitness == pytest.approx(0.0)
        assert stats.min_fitness == pytest.approx(0.0)
        assert stats.distinct_genomes == 0

    def test_single_entry(self):
        stats = compute_from_entries([_entry(fitness=0.75)], "compute", 1)
        assert stats.count == 1
        assert stats.mean_fitness == pytest.approx(0.75)
        assert stats.median_fitness == pytest.approx(0.75)
        assert stats.max_fitness == pytest.approx(0.75)
        assert stats.min_fitness == pytest.approx(0.75)
        assert stats.stddev_fitness == pytest.approx(0.0)

    def test_all_same_fitness(self):
        entries = [_entry(fitness=0.5, entry_id=str(i)) for i in range(4)]
        stats = compute_from_entries(entries, "compute", 2)
        assert stats.mean_fitness == pytest.approx(0.5)
        assert stats.stddev_fitness == pytest.approx(0.0)

    def test_varied_fitness(self):
        entries = [
            _entry(fitness=0.0, entry_id="a"),
            _entry(fitness=0.5, entry_id="b"),
            _entry(fitness=1.0, entry_id="c"),
        ]
        stats = compute_from_entries(entries, "compute", 3)
        assert stats.mean_fitness == pytest.approx(0.5)
        assert stats.max_fitness == pytest.approx(1.0)
        assert stats.min_fitness == pytest.approx(0.0)
        assert stats.count == 3

    def test_distinct_genomes_count(self):
        entries = [
            _entry(genome="A" * 256, entry_id="a"),
            _entry(genome="A" * 256, entry_id="b"),  # same genome
            _entry(genome="B" * 256, entry_id="c"),
        ]
        stats = compute_from_entries(entries, "compute", 0)
        assert stats.distinct_genomes == 2

    def test_stats_has_martian_type_and_generation(self):
        stats = compute_from_entries([_entry()], "web_search", 5)
        assert stats.martian_type == "web_search"
        assert stats.generation == 5

    def test_captured_at_is_set(self):
        stats = compute_from_entries([], "compute", 0)
        assert stats.captured_at  # non-empty ISO timestamp


class TestComputeFromPopulation:
    def test_compute_matches_compute_from_entries(self):
        from alienclaw.evolution.population import Population
        config = EvolutionConfig(martian_type="compute", population_size=4, seed=5)
        pop = Population.create(config)
        direct = compute_from_entries(pop.all(), "compute", 0)
        via_compute = compute(pop, 0)
        assert direct.count == via_compute.count
        assert direct.mean_fitness == pytest.approx(via_compute.mean_fitness)
