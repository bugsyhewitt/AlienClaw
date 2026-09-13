"""Tests for --target-fitness early-halt (PKT-1041).

RED on origin/main 9d21837381faea42657d986ddb3310d182fe0d67:
  T-1, T-2 fail — TypeError: run_experiment() got an unexpected keyword argument 'target_fitness'.
  T-3 passes (regression guard — no new kwarg used).
GREEN after: experiment.py gains optional target_fitness parameter (File A).

Gate: PYTHONPATH=src pytest test/evolution/test_target_fitness.py -v
"""
from __future__ import annotations
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


class TestTargetFitnessExperiment:
    def test_halts_before_all_gens_when_target_met(self):
        """T-1 (R-001, R-002): target_fitness=0.5 with all-1.0 runner halts after gen 1."""
        config = EvolutionConfig(martian_type="compute", population_size=4, seed=1)
        _, stats = run_experiment(
            config, fixed_runner(1.0), generations=10, target_fitness=0.5
        )
        # After gen 1: max_fitness=1.0 >= 0.5 → loop breaks.
        # all_stats: [initial_snapshot, gen1_stats] → length 2.
        assert len(stats) == 2, (
            f"expected 2 stat entries (initial + 1 gen), got {len(stats)}"
        )
        assert stats[-1].max_fitness >= 0.5

    def test_runs_all_gens_when_target_never_met(self):
        """T-2 (R-003): target_fitness=0.5 with all-0.0 runner runs all 3 gens."""
        config = EvolutionConfig(martian_type="http_get", population_size=4, seed=2)
        _, stats = run_experiment(
            config, fixed_runner(0.0), generations=3, target_fitness=0.5
        )
        # max_fitness stays 0.0 throughout → target never met → all 3 gens run.
        assert len(stats) == 4, (
            f"expected 4 stat entries (initial + 3 gens), got {len(stats)}"
        )

    def test_no_target_fitness_unchanged(self):
        """T-3 (regression, R-003): calling without target_fitness is unchanged."""
        config = EvolutionConfig(martian_type="web_search", population_size=4, seed=3)
        _, stats = run_experiment(config, fixed_runner(0.5), generations=5)
        assert len(stats) == 6  # initial + 5 gens
