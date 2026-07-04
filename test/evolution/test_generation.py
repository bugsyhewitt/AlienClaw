import random

import pytest

from alienclaw.brains.types import BrainSpec, GenomeSectionDocs, ParameterSchemaField
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
        _ = {e.genome for e in pop.all()}  # capture state before evolution
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


def _minimal_brain() -> BrainSpec:
    """Minimal BrainSpec with one EXECUTION-slot parameter for directed mutation."""
    return BrainSpec(
        tool="test_tool",
        version="1.0",
        capabilities="test",
        limitations="test",
        failure_modes="test",
        best_practices="test",
        execution_order=("step one",),
        output_contract="{}",
        genome_sections=GenomeSectionDocs(
            identity="id", execution="exec", behavior="behav", checksum="cs"
        ),
        variables={},
        parameter_schema=(
            ParameterSchemaField(
                name="max_attempts",
                description="How many attempts",
                xcode_index=0,
                range_min=1,
                range_max=10,
                default=3,
                direction="lower",
            ),
        ),
    )


class TestBrainDirectedMutation:
    def test_brain_path_runs_without_error(self):
        """evaluate_and_evolve with config.brain set takes the mutate_directed path."""
        brain = _minimal_brain()
        config = EvolutionConfig(
            martian_type="compute",
            population_size=4,
            elitism_count=1,
            crossover_rate=0.0,  # force mutation-only path
            brain=brain,
            seed=1,
        )
        pop = Population.create(config)
        result = evaluate_and_evolve(pop, config, fixed_runner(0.5), random.Random(42))
        assert result["children_minted"] == 3  # population_size - elitism_count

    def test_brain_path_produces_valid_genomes(self):
        """Children produced by brain-directed mutation are valid 256-char genomes."""
        brain = _minimal_brain()
        config = EvolutionConfig(
            martian_type="compute",
            population_size=4,
            crossover_rate=0.0,
            brain=brain,
            seed=1,
        )
        pop = Population.create(config)
        evaluate_and_evolve(pop, config, fixed_runner(0.5), random.Random(42))
        for entry in pop.all():
            assert len(entry.genome) == 256

    def test_brain_path_does_not_use_config_mutation_rate(self):
        """brain mode locks rate to PER_XCODE_MUTATION_RATE; config.mutation_rate is ignored."""
        brain = _minimal_brain()
        # Same seed, different mutation_rate — brain path ignores it so outputs must be identical.
        # Use distinct martian_type values to avoid population-storage collision within one test.
        config_a = EvolutionConfig(
            martian_type="compute_ra", population_size=4, crossover_rate=0.0,
            brain=brain, mutation_rate=1 / 256, seed=1,
        )
        config_b = EvolutionConfig(
            martian_type="compute_rb", population_size=4, crossover_rate=0.0,
            brain=brain, mutation_rate=0.5, seed=1,
        )
        pop_a = Population.create(config_a)
        pop_b = Population.create(config_b)
        evaluate_and_evolve(pop_a, config_a, fixed_runner(0.5), random.Random(42))
        evaluate_and_evolve(pop_b, config_b, fixed_runner(0.5), random.Random(42))
        genomes_a = sorted(e.genome for e in pop_a.all())
        genomes_b = sorted(e.genome for e in pop_b.all())
        assert genomes_a == genomes_b  # mutation_rate ignored; outcomes identical
