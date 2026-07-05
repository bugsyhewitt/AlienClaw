"""Closed-loop test: governance-gated Martian evolution, headless, resumable."""
from __future__ import annotations

import pytest

from alienclaw.evolution.experiment import run_experiment
from alienclaw.evolution.generation import FitnessReport
from alienclaw.evolution.governance_gate import GateDecision
from alienclaw.evolution.population import Population
from alienclaw.evolution.types import EvolutionConfig


@pytest.fixture(autouse=True)
def isolate_populations(tmp_path, monkeypatch):
    monkeypatch.setenv("ALIENCLAW_POPULATIONS_ROOT", str(tmp_path / "populations"))
    yield


def _mock_run_martian(martian_type: str, genome: str) -> FitnessReport:
    return FitnessReport(fitness=1.0, run_metadata={"tool_calls": 1, "slot_count": 1})


class _RecordingGate:
    def __init__(self, halt_at: int | None = None) -> None:
        self.calls: list[int] = []
        self._halt_at = halt_at

    def review(self, generation: int, stats) -> GateDecision:
        self.calls.append(generation)
        if self._halt_at is not None and generation >= self._halt_at:
            return GateDecision(approved=False, reason="halt for test")
        return GateDecision(approved=True)


def test_governance_gates_each_generation():
    config = EvolutionConfig(martian_type="compute", population_size=5, seed=42)
    gate = _RecordingGate()
    pop, stats = run_experiment(config=config, run_martian=_mock_run_martian,
                                generations=3, governance_gate=gate)
    assert len(gate.calls) == 3, f"expected 3 governance reviews, got {len(gate.calls)}"
    assert pop.current_generation() == 3
    assert len(pop.all()) == 5
    assert len(stats) == 4
    assert stats[-1].mean_fitness >= stats[0].mean_fitness


def test_governance_halt_stops_cleanly_and_is_resumable():
    config = EvolutionConfig(martian_type="compute", population_size=5, seed=7)
    gate = _RecordingGate(halt_at=1)
    pop, _ = run_experiment(config=config, run_martian=_mock_run_martian,
                            generations=5, governance_gate=gate)
    assert len(gate.calls) == 2
    reloaded = Population.load("compute")
    assert reloaded.current_generation() == pop.current_generation()
    assert reloaded.current_generation() >= 2


def test_closed_loop_resumes_from_persisted_state():
    config = EvolutionConfig(martian_type="compute", population_size=5, seed=1)
    run_experiment(config=config, run_martian=_mock_run_martian, generations=2)
    resumed = Population.load_or_create(config)
    assert resumed.current_generation() == 2
