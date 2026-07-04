import random

import pytest

from alienclaw.evolution.population import Population
from alienclaw.evolution.selection import roulette_wheel, tournament, truncation
from alienclaw.evolution.types import EvolutionConfig


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


class TestRouletteWheel:
    def test_returns_member_of_population(self):
        pop = _make_pop_with_fitness([0.2, 0.5, 0.8])
        rng = random.Random(7)
        fitnesses = {0.2, 0.5, 0.8}
        for _ in range(20):
            assert roulette_wheel(pop, rng).fitness in fitnesses

    def test_zero_fitness_entry_never_selected_when_others_positive(self):
        pop = _make_pop_with_fitness([0.0, 0.5])
        rng = random.Random(42)
        for _ in range(50):
            assert roulette_wheel(pop, rng).fitness == pytest.approx(0.5)

    def test_selection_is_fitness_proportionate(self):
        # Expected ~90% for the 0.9 entry; threshold excludes uniform (~50%)
        pop = _make_pop_with_fitness([0.1, 0.9])
        rng = random.Random(42)
        picks = [roulette_wheel(pop, rng).fitness for _ in range(300)]
        high_count = sum(1 for f in picks if f == pytest.approx(0.9))
        assert high_count > 210

    def test_all_zero_fitness_falls_back_to_uniform(self):
        pop = _make_pop_with_fitness([0.0, 0.0, 0.0])
        rng = random.Random(42)
        entry = roulette_wheel(pop, rng)
        assert entry.fitness == pytest.approx(0.0)

    def test_seeded_rng_is_reproducible(self):
        pop = _make_pop_with_fitness([0.1, 0.3, 0.7, 0.9])
        results1 = [roulette_wheel(pop, random.Random(11)).entry_id for _ in range(10)]
        results2 = [roulette_wheel(pop, random.Random(11)).entry_id for _ in range(10)]
        assert results1 == results2


class TestTruncation:
    def test_small_fraction_selects_only_the_best(self):
        # ceil(5 * 0.2) = 1 -> only the 0.9 entry is eligible
        pop = _make_pop_with_fitness([0.1, 0.2, 0.3, 0.4, 0.9])
        rng = random.Random(42)
        for _ in range(20):
            assert truncation(pop, 0.2, rng).fitness == pytest.approx(0.9)

    def test_half_fraction_never_selects_bottom(self):
        # ceil(3 * 0.5) = 2 -> eligible set is {0.9, 0.5}
        pop = _make_pop_with_fitness([0.1, 0.5, 0.9])
        rng = random.Random(42)
        for _ in range(50):
            assert truncation(pop, 0.5, rng).fitness in {0.5, 0.9}

    def test_full_fraction_can_return_any_member(self):
        pop = _make_pop_with_fitness([0.2, 0.5, 0.8])
        rng = random.Random(42)
        seen = {truncation(pop, 1.0, rng).fitness for _ in range(100)}
        assert seen == {0.2, 0.5, 0.8}

    def test_all_zero_fitness_returns_an_entry(self):
        pop = _make_pop_with_fitness([0.0, 0.0, 0.0])
        entry = truncation(pop, 0.5, random.Random(1))
        assert entry.fitness == pytest.approx(0.0)

    def test_seeded_rng_is_reproducible(self):
        pop = _make_pop_with_fitness([0.1, 0.3, 0.7, 0.9])
        results1 = [truncation(pop, 0.5, random.Random(11)).entry_id for _ in range(10)]
        results2 = [truncation(pop, 0.5, random.Random(11)).entry_id for _ in range(10)]
        assert results1 == results2

    def test_fraction_out_of_range_raises(self):
        pop = _make_pop_with_fitness([0.5])
        for bad in (0.0, -0.1, 1.5):
            with pytest.raises(ValueError, match="top_fraction"):
                truncation(pop, bad, random.Random(1))

    def test_empty_pool_raises_canonical_error(self):
        config = EvolutionConfig(martian_type="compute", population_size=2, seed=7)
        pop = Population.create(config)
        pop.replace_pool([])
        with pytest.raises(RuntimeError, match="empty population"):
            truncation(pop, 0.5, random.Random(1))
