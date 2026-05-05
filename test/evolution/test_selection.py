import random
import pytest

from alienclaw.evolution.population import Population
from alienclaw.evolution.selection import tournament, roulette_wheel, truncation
from alienclaw.evolution.types import EvolutionConfig, PopulationEntry


@pytest.fixture(autouse=True)
def isolate_populations(tmp_path, monkeypatch):
    monkeypatch.setenv("ALIENCLAW_POPULATIONS_ROOT", str(tmp_path / "populations"))
    yield


def _make_pop_with_fitness(fitnesses: list[float]) -> Population:
    """Create population with given fitness values (uses add() to bypass genome gen)."""
    from alienclaw.genome.operators import random_genome
    config = EvolutionConfig(martian_type="compute", population_size=len(fitnesses), seed=7)
    pop = Population.create(config)
    rng = random.Random(99)
    entries = []
    for f in fitnesses:
        g = random_genome(rng, "COMPUT01")
        e = pop.add(genome=g, fitness=f, generation=0, parent_ids=(), run_metadata={})
        entries.append(e)
    # Replace pool with our custom-fitness entries only
    pop.replace_pool(entries)
    return pop


class TestTournament:
    def test_k1_returns_some_member(self):
        pop = _make_pop_with_fitness([0.2, 0.5, 0.8])
        rng = random.Random(42)
        fitnesses = {0.2, 0.5, 0.8}
        for _ in range(20):
            entry = tournament(pop, 1, rng)
            assert entry.fitness in fitnesses

    def test_large_k_strongly_favors_max(self):
        # With k=50 sampling with replacement from 3 entries, P(never picking max) = (2/3)^50 ≈ 1e-9
        pop = _make_pop_with_fitness([0.1, 0.5, 0.9])
        rng = random.Random(42)
        for _ in range(20):
            entry = tournament(pop, 50, rng)
            assert entry.fitness == pytest.approx(0.9)

    def test_all_zero_fitness_returns_an_entry(self):
        pop = _make_pop_with_fitness([0.0, 0.0, 0.0])
        rng = random.Random(42)
        entry = tournament(pop, 3, rng)
        assert entry.fitness == pytest.approx(0.0)

    def test_seeded_rng_is_reproducible(self):
        pop = _make_pop_with_fitness([0.1, 0.3, 0.7, 0.9])
        results1 = [tournament(pop, 2, random.Random(11)).entry_id for _ in range(10)]
        results2 = [tournament(pop, 2, random.Random(11)).entry_id for _ in range(10)]
        assert results1 == results2

    def test_k_less_than_1_raises(self):
        pop = _make_pop_with_fitness([0.5])
        with pytest.raises(ValueError, match="k must be >= 1"):
            tournament(pop, 0, random.Random(1))

    def test_tournament_k3_biases_toward_high_fitness(self):
        pop = _make_pop_with_fitness([0.0, 0.0, 0.0, 0.0, 1.0])
        rng = random.Random(42)
        selections = [tournament(pop, 3, rng).fitness for _ in range(100)]
        high_count = sum(1 for f in selections if f == 1.0)
        assert high_count > 30  # should win much more than 20% (random chance)

    def test_roulette_wheel_raises_not_implemented(self):
        pop = _make_pop_with_fitness([0.5])
        with pytest.raises(NotImplementedError):
            roulette_wheel(pop, random.Random(1))

    def test_truncation_raises_not_implemented(self):
        pop = _make_pop_with_fitness([0.5])
        with pytest.raises(NotImplementedError):
            truncation(pop, 0.5, random.Random(1))
