import random
import pytest

from alienclaw.evolution.population import Population
from alienclaw.evolution.types import EvolutionConfig


@pytest.fixture(autouse=True)
def isolate_populations(tmp_path, monkeypatch):
    monkeypatch.setenv("ALIENCLAW_POPULATIONS_ROOT", str(tmp_path / "populations"))
    yield


@pytest.fixture
def config():
    return EvolutionConfig(martian_type="compute", population_size=8, seed=42)


class TestPopulationCreate:
    def test_create_seeds_correct_size(self, config):
        pop = Population.create(config)
        assert len(pop.all()) == config.population_size

    def test_create_all_entries_have_fitness_zero(self, config):
        pop = Population.create(config)
        for e in pop.all():
            assert e.fitness == 0.0

    def test_create_all_genomes_are_valid(self, config):
        from alienclaw.genome.validation import validate
        pop = Population.create(config)
        for e in pop.all():
            assert validate(e.genome).valid, f"Invalid genome: {e.genome[:20]}..."

    def test_create_raises_if_already_exists(self, config):
        Population.create(config)
        with pytest.raises(ValueError, match="already exists"):
            Population.create(config)

    def test_create_deterministic_with_seed(self, config):
        pop1 = Population.create(config)
        genomes1 = [e.genome for e in pop1.all()]
        pop1.clear()
        pop2 = Population.create(config)
        genomes2 = [e.genome for e in pop2.all()]
        assert genomes1 == genomes2

    def test_create_different_seeds_differ(self):
        c1 = EvolutionConfig(martian_type="compute", population_size=4, seed=1)
        c2 = EvolutionConfig(martian_type="http_get", population_size=4, seed=2)
        pop1 = Population.create(c1)
        pop2 = Population.create(c2)
        assert pop1.all()[0].genome != pop2.all()[0].genome


class TestPopulationSampleAndTop:
    def test_sample_raises_on_empty(self):
        config = EvolutionConfig(martian_type="empty_test")
        pop = Population.create(config)
        pop.replace_pool([])
        with pytest.raises(RuntimeError, match="empty"):
            pop.sample(random.Random(0))

    def test_sample_returns_pool_member(self, config):
        pop = Population.create(config)
        rng = random.Random(7)
        genomes = {e.genome for e in pop.all()}
        for _ in range(20):
            entry = pop.sample(rng)
            assert entry.genome in genomes

    def test_sample_has_variety(self, config):
        pop = Population.create(config)
        rng = random.Random(99)
        seen = set()
        for _ in range(100):
            seen.add(pop.sample(rng).entry_id)
        assert len(seen) > 1

    def test_top_returns_highest_fitness_first(self, config):
        pop = Population.create(config)
        # Manually assign fitness
        from alienclaw.genome.operators import random_genome
        rng = random.Random(42)
        entries = []
        for i in range(4):
            g = random_genome(rng, "COMPUT01")
            e = pop.add(genome=g, fitness=float(i) / 4.0, generation=0, parent_ids=(), run_metadata={})
            entries.append(e)
        top2 = pop.top(2)
        assert top2[0].fitness >= top2[1].fitness
        assert top2[0].fitness == 0.75

    def test_top_empty_population_returns_empty(self, config):
        pop = Population.create(config)
        pop.replace_pool([])
        assert pop.top(5) == []


class TestPopulationAdd:
    def test_add_validates_genome(self, config):
        pop = Population.create(config)
        with pytest.raises(ValueError, match="Genome validation failed"):
            pop.add("TOOSHORT", 0.5, 0, (), {})

    def test_add_validates_fitness_high(self, config):
        from alienclaw.genome.operators import random_genome
        pop = Population.create(config)
        g = random_genome(random.Random(1), "COMPUT01")
        with pytest.raises(ValueError, match="fitness"):
            pop.add(g, 1.5, 0, (), {})

    def test_add_validates_fitness_low(self, config):
        from alienclaw.genome.operators import random_genome
        pop = Population.create(config)
        g = random_genome(random.Random(1), "COMPUT01")
        with pytest.raises(ValueError, match="fitness"):
            pop.add(g, -0.1, 0, (), {})

    def test_add_returns_correct_entry(self, config):
        from alienclaw.genome.operators import random_genome
        pop = Population.create(config)
        g = random_genome(random.Random(1), "COMPUT01")
        entry = pop.add(g, 0.8, 1, ("parent-1",), {"tool_calls": 1})
        assert entry.genome == g
        assert entry.fitness == pytest.approx(0.8)
        assert entry.generation == 1
        assert entry.parent_ids == ("parent-1",)

    def test_add_persisted_to_disk(self, config):
        from alienclaw.genome.operators import random_genome
        pop = Population.create(config)
        g = random_genome(random.Random(2), "COMPUT01")
        pop.add(g, 0.9, 0, (), {})
        pop2 = Population.load("compute")
        # The loaded pool is filtered to current generation (0)
        genomes = [e.genome for e in pop2.all()]
        # Either directly in pool or accessible via all()
        assert any(e.genome == g for e in Population.load("compute").all())


class TestPopulationSnapshot:
    def test_snapshot_has_required_keys(self, config):
        pop = Population.create(config)
        snap = pop.snapshot()
        for key in ("martian_type", "generation", "size", "top_fitness", "mean_fitness", "config"):
            assert key in snap

    def test_snapshot_size_matches_pool(self, config):
        pop = Population.create(config)
        assert pop.snapshot()["size"] == config.population_size


class TestPopulationLoad:
    def test_load_missing_raises(self):
        with pytest.raises(FileNotFoundError):
            Population.load("nonexistent_martian")

    def test_load_or_create_creates_when_missing(self, config):
        pop = Population.load_or_create(config)
        assert len(pop.all()) == config.population_size

    def test_load_or_create_loads_when_exists(self, config):
        p1 = Population.create(config)
        genomes1 = {e.genome for e in p1.all()}
        p2 = Population.load_or_create(config)
        assert len(p2.all()) > 0

    def test_current_generation_starts_at_zero(self, config):
        pop = Population.create(config)
        assert pop.current_generation() == 0

    def test_increment_generation(self, config):
        pop = Population.create(config)
        pop.increment_generation()
        assert pop.current_generation() == 1

    def test_clear_empties_pool_and_disk(self, config):
        pop = Population.create(config)
        pop.clear()
        assert pop.all() == []
        with pytest.raises(FileNotFoundError):
            Population.load("compute")
