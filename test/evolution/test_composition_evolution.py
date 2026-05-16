"""Smoke tests for composition Martian evolution (Packet 19)."""
from __future__ import annotations

import pytest

from alienclaw.evolution.bridge_runner import make_bridge_runner
from alienclaw.evolution.experiment import run_experiment
from alienclaw.evolution.types import EvolutionConfig


@pytest.fixture(autouse=True)
def isolate_populations(tmp_path, monkeypatch):
    monkeypatch.setenv("ALIENCLAW_POPULATIONS_ROOT", str(tmp_path / "populations"))
    yield


def test_search_then_count_evolution_runs() -> None:
    """search_then_count evolves without crashing. 3 gens, pop=4."""
    text = "\n".join(f"The fox was spotted on line {i}" for i in range(1, 21))
    config = EvolutionConfig(
        martian_type="search_then_count",
        population_size=4,
        seed=42,
    )
    run_martian = make_bridge_runner(
        "search_then_count",
        inputs={"text": text, "pattern": "fox"},
    )
    pop, stats = run_experiment(config=config, run_martian=run_martian, generations=3)
    assert pop.current_generation() == 3
    # Final mean fitness defined and non-negative.
    assert stats[-1].mean_fitness >= 0.0


def test_compute_then_validate_evolution_runs() -> None:
    """compute_then_validate evolves without crashing. 3 gens, pop=4."""
    config = EvolutionConfig(
        martian_type="compute_then_validate",
        population_size=4,
        seed=42,
    )
    run_martian = make_bridge_runner(
        "compute_then_validate",
        inputs={"input": "7 / 3"},
    )
    pop, stats = run_experiment(config=config, run_martian=run_martian, generations=3)
    assert pop.current_generation() == 3
    assert stats[-1].mean_fitness >= 0.0
