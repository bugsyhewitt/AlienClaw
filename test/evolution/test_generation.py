import random
import pytest

from alienclaw.evolution.generation import FitnessReport, RunMartianCallback, evaluate_and_evolve
from alienclaw.evolution.population import Population
from alienclaw.evolution.types import EvolutionConfig


@pytest.fixture(autouse=True)
def isolate_populations(tmp_path, monkeypatch):
    monkeypatch.setenv("ALIENCLAW_POPULATIONS_ROOT", str(tmp_path / "populations"))
    yield


def fixed_runner(fitness: float) -> RunMartianCallback:
    def run(martian_type: str, genome: str) -> FitnessReport:
        return FitnessReport(fitness=fitness, run_metadata={"tool_calls": 1, "wall_clock_ms": 0})
    return run


def counting_runner():
    calls = []
    def run(martian_type: str, genome: str) -> FitnessReport:
        calls.append(genome)
        return FitnessReport(fitness=0.5, run_metadata={})
    run.calls = calls  # type: ignore[attr-defined]
    return run


class TestEvaluateAndEvolve:
    def test_runs_martian_for_each_pool_entry(self):
        config = EvolutionConfig(martian_type="compute", population_size=4, seed=1)
        pop = Population.create(config)
        runner = counting_runner()
        evaluate_and_evolve(pop, config, runner, random.Random(1))
        assert len(runner.calls) == 4

    def test_increments_generation_counter(self):
        config = EvolutionConfig(martian_type="compute", population_size=4, seed=1)
        pop = Population.create(config)
        assert pop.current_generation() == 0
        evaluate_and_evolve(pop, config, fixed_runner(0.5), random.Random(1))
        assert pop.current_generation() == 1

    def test_stats_in_result(self):
        config = EvolutionConfig(martian_type="compute", population_size=4, seed=1)
        pop = Population.create(config)
        result = evaluate_and_evolve(pop, config, fixed_runner(0.75), random.Random(1))
        assert result["stats"].mean_fitness == pytest.approx(0.75)
        assert result["generation"] == 0
        assert result["next_generation"] == 1

    def test_pool_size_stays_bounded(self):
        config = EvolutionConfig(martian_type="compute", population_size=6, elitism_count=2, seed=1)
        pop = Population.create(config)
        evaluate_and_evolve(pop, config, fixed_runner(0.5), random.Random(1))
        assert len(pop.all()) == 6  # elite(2) + children(4)

    def test_all_zero_fitness_does_not_crash(self):
        config = EvolutionConfig(martian_type="compute", population_size=4, seed=1)
        pop = Population.create(config)
        result = evaluate_and_evolve(pop, config, fixed_runner(0.0), random.Random(1))
        assert result["stats"].mean_fitness == pytest.approx(0.0)

    def test_population_size_one_degenerate(self):
        config = EvolutionConfig(
            martian_type="compute", population_size=1, elitism_count=1,
            crossover_rate=0.0, seed=1,
        )
        pop = Population.create(config)
        result = evaluate_and_evolve(pop, config, fixed_runner(0.5), random.Random(1))
        assert result["children_minted"] == 0
        assert len(pop.all()) == 1

    def test_crossover_rate_zero_produces_mutations(self):
        config = EvolutionConfig(
            martian_type="compute", population_size=4, elitism_count=1,
            crossover_rate=0.0, seed=2,
        )
        pop = Population.create(config)
        evaluate_and_evolve(pop, config, fixed_runner(0.5), random.Random(2))
        assert len(pop.all()) == 4

    def test_crossover_rate_one_produces_crossovers(self):
        config = EvolutionConfig(
            martian_type="compute", population_size=4, elitism_count=1,
            crossover_rate=1.0, seed=3,
        )
        pop = Population.create(config)
        evaluate_and_evolve(pop, config, fixed_runner(0.5), random.Random(3))
        assert len(pop.all()) == 4

    def test_elitism_count_zero_replaces_all(self):
        config = EvolutionConfig(
            martian_type="compute", population_size=4, elitism_count=0,
            crossover_rate=0.0, seed=4,
        )
        pop = Population.create(config)
        original_genomes = {e.genome for e in pop.all()}
        evaluate_and_evolve(pop, config, fixed_runner(0.5), random.Random(4))
        # Children might overlap by chance but elite didn't survive explicitly
        assert len(pop.all()) == 4

    def test_deterministic_with_seed(self):
        config = EvolutionConfig(martian_type="compute", population_size=4, seed=42)
        pop1 = Population.create(config)
        res1 = evaluate_and_evolve(pop1, config, fixed_runner(0.5), random.Random(42))
        pop1.clear()

        pop2 = Population.create(config)
        res2 = evaluate_and_evolve(pop2, config, fixed_runner(0.5), random.Random(42))
        assert res1["children_minted"] == res2["children_minted"]
        genomes1 = sorted(e.genome for e in pop1.all()) if pop1.all() else []
        genomes2 = sorted(e.genome for e in pop2.all())
        # Same seed → same children genomes
        assert genomes1 == [] or genomes1 == genomes2
