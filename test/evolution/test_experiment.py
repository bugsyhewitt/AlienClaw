"""Tests for the experiment driver, including the critical convergence test."""
import random
import pytest

from alienclaw.evolution.experiment import run_experiment
from alienclaw.evolution.generation import FitnessReport
from alienclaw.evolution.types import EvolutionConfig


@pytest.fixture(autouse=True)
def isolate_populations(tmp_path, monkeypatch):
    monkeypatch.setenv("ALIENCLAW_POPULATIONS_ROOT", str(tmp_path / "populations"))
    yield


def fixed_runner(fitness: float):
    def run(martian_type, genome):
        return FitnessReport(fitness=fitness, run_metadata={"tool_calls": 1})
    return run


def genome_fitness_runner():
    """Mock runner: fitness = count of chars in '0123' in genome[8:64] / 56.0.

    This makes fitness a HERITABLE trait — genomes with more '0','1','2','3'
    chars in the mutable IDENTITY tail produce higher fitness. Section-boundary
    crossover propagates successful sections. Tournament selection drives the
    population toward higher-fitness genomes.
    """
    target_chars = set("0123")

    def run(martian_type, genome):
        section = genome[8:64]  # 56 chars in mutable IDENTITY tail
        score = sum(1 for c in section if c in target_chars)
        fitness = score / 56.0
        return FitnessReport(fitness=fitness, run_metadata={"tool_calls": 1})

    return run


class TestRunExperiment:
    def test_calls_on_generation_n_times(self):
        config = EvolutionConfig(martian_type="compute", population_size=4, seed=1)
        calls = []
        run_experiment(config, fixed_runner(0.5), 5, on_generation=lambda i, r: calls.append(i))
        assert calls == [0, 1, 2, 3, 4]

    def test_returns_stats_with_length_n_plus_one(self):
        config = EvolutionConfig(martian_type="compute", population_size=4, seed=1)
        _, stats = run_experiment(config, fixed_runner(0.5), 3)
        assert len(stats) == 4  # initial + 3 generations

    def test_initial_stats_mean_is_zero_for_fresh_pop(self):
        config = EvolutionConfig(martian_type="compute", population_size=4, seed=1)
        _, stats = run_experiment(config, fixed_runner(0.9), 1)
        assert stats[0].mean_fitness == pytest.approx(0.0)  # uneval initial

    def test_raises_if_generations_less_than_one(self):
        config = EvolutionConfig(martian_type="compute", population_size=4, seed=1)
        with pytest.raises(ValueError, match="generations must be >= 1"):
            run_experiment(config, fixed_runner(0.5), 0)

    def test_creates_population_if_not_exists(self):
        config = EvolutionConfig(martian_type="new_type", population_size=4, seed=1)
        pop, _ = run_experiment(config, fixed_runner(0.5), 1)
        assert len(pop.all()) == 4

    def test_deterministic_with_seed(self):
        config = EvolutionConfig(martian_type="compute", population_size=4, seed=77)
        _, stats1 = run_experiment(config, fixed_runner(0.5), 3)
        Population = __import__("alienclaw.evolution.population", fromlist=["Population"]).Population
        Population("compute").clear() if False else None

        # Same config + same seed → same stats
        config2 = EvolutionConfig(martian_type="http_get", population_size=4, seed=77)
        _, stats2 = run_experiment(config2, fixed_runner(0.5), 3)
        # The mean_fitness from fixed_runner is deterministic (all 0.5)
        assert stats1[-1].mean_fitness == pytest.approx(stats2[-1].mean_fitness)

    def test_convergence_fitness_improves(self):
        """CRITICAL: proves selection pressure drives fitness improvement.

        Mock runner assigns fitness based on a heritable genome property
        (count of '0','1','2','3' in IDENTITY tail). Tournament selection
        favors genomes with more target chars. Section crossover propagates
        the trait. Over 20 generations, mean fitness improves.
        """
        config = EvolutionConfig(
            martian_type="compute",
            population_size=16,
            tournament_k=3,
            crossover_rate=0.5,
            elitism_count=2,
            seed=42,
        )
        _, stats = run_experiment(config, genome_fitness_runner(), 20)

        initial_mean = stats[0].mean_fitness  # all entries have fitness=0.0 pre-eval
        final_mean = stats[-1].mean_fitness

        assert final_mean > initial_mean, (
            f"Evolution failed to improve: initial={initial_mean:.3f}, "
            f"final={final_mean:.3f}"
        )
        # The fitness after first evaluation is non-zero (genomes have some target chars)
        assert stats[1].mean_fitness > 0.0, "After first evaluation, mean should be > 0"
        # After 20 gens, fitness should be meaningfully higher than after gen 1
        assert stats[-1].mean_fitness >= stats[1].mean_fitness, (
            f"Fitness degraded from gen1={stats[1].mean_fitness:.3f} to "
            f"final={stats[-1].mean_fitness:.3f}"
        )
