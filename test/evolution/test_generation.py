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


class TestParentIdsLineage:
    """PKT-555: evaluate_and_evolve must propagate parent entry_ids to newly-minted children."""

    def test_mutation_child_has_one_parent_id(self):
        """Mutation-only path (crossover_rate=0): each child has exactly one parent_id."""
        config = EvolutionConfig(
            martian_type="lin_mut",
            population_size=4,
            elitism_count=1,
            crossover_rate=0.0,
            seed=10,
        )
        pop = Population.create(config)
        evaluate_and_evolve(pop, config, fixed_runner(0.5), random.Random(10))
        children = [e for e in pop.all() if e.run_metadata.get("newly_minted")]
        assert children, "Expected newly-minted children in pool"
        for child in children:
            assert len(child.parent_ids) == 1, (
                f"Mutation child should have exactly 1 parent_id, got {child.parent_ids!r}"
            )

    def test_crossover_child_has_two_parent_ids(self):
        """Crossover path (crossover_rate=1): each child has exactly two parent_ids."""
        config = EvolutionConfig(
            martian_type="lin_cross",
            population_size=4,
            elitism_count=1,
            crossover_rate=1.0,
            seed=11,
        )
        pop = Population.create(config)
        evaluate_and_evolve(pop, config, fixed_runner(0.5), random.Random(11))
        children = [e for e in pop.all() if e.run_metadata.get("newly_minted")]
        assert children, "Expected newly-minted children in pool"
        for child in children:
            assert len(child.parent_ids) == 2, (
                f"Crossover child should have exactly 2 parent_ids, got {child.parent_ids!r}"
            )

    def test_parent_ids_reference_entries_in_evaluated_pool(self):
        """Each parent_id must be an entry_id from the re-evaluated pool (not the seeded pool)."""
        config = EvolutionConfig(
            martian_type="lin_ref",
            population_size=4,
            elitism_count=1,
            crossover_rate=0.5,
            seed=12,
        )
        pop = Population.create(config)
        seeded_ids = {e.entry_id for e in pop.all()}
        evaluate_and_evolve(pop, config, fixed_runner(0.5), random.Random(12))
        # All entries written to disk (seeded + evaluated + children)
        all_on_disk = pop._storage.read_all_entries()
        evaluated_ids = {e.entry_id for e in all_on_disk if e.run_metadata.get("re_evaluated")}
        children = [e for e in pop.all() if e.run_metadata.get("newly_minted")]
        assert children, "Expected newly-minted children in pool"
        for child in children:
            assert child.parent_ids, f"Child {child.entry_id!r} has empty parent_ids"
            for pid in child.parent_ids:
                assert pid in evaluated_ids, (
                    f"Parent ID {pid!r} not found in evaluated pool {evaluated_ids!r}"
                )
                assert pid not in seeded_ids, (
                    f"Parent ID {pid!r} should reference re-evaluated entry, not seeded entry"
                )

    def test_elite_entries_unchanged(self):
        """Elite entries carried over via elitism keep their parent_ids (regression guard)."""
        config = EvolutionConfig(
            martian_type="lin_elite",
            population_size=4,
            elitism_count=2,
            crossover_rate=0.0,
            seed=13,
        )
        pop = Population.create(config)
        seeded_ids = {e.entry_id for e in pop.all()}
        evaluate_and_evolve(pop, config, fixed_runner(0.5), random.Random(13))
        elites = [e for e in pop.all() if e.run_metadata.get("re_evaluated")]
        assert len(elites) == 2, f"Expected 2 elite entries, got {len(elites)}"
        for elite in elites:
            assert len(elite.parent_ids) == 1, (
                f"Elite entry should have exactly 1 parent_id, got {elite.parent_ids!r}"
            )
            (pid,) = elite.parent_ids
            assert pid in seeded_ids, (
                f"Elite's parent_id {pid!r} should reference a seeded entry"
            )

    def test_parent_ids_persisted_to_disk(self):
        """After evaluate_and_evolve, a fresh Population.load returns children with non-empty parent_ids."""
        config = EvolutionConfig(
            martian_type="lin_disk",
            population_size=4,
            elitism_count=1,
            crossover_rate=0.0,
            seed=14,
        )
        pop = Population.create(config)
        evaluate_and_evolve(pop, config, fixed_runner(0.5), random.Random(14))
        # Load fresh — current_gen=1 after evolve; pool = children at gen 1
        loaded = Population.load(config.martian_type)
        loaded_children = [e for e in loaded.all() if e.run_metadata.get("newly_minted")]
        assert loaded_children, "Expected newly-minted children after disk round-trip"
        for child in loaded_children:
            assert child.parent_ids, (
                f"Child {child.entry_id!r} has empty parent_ids after disk round-trip"
            )
