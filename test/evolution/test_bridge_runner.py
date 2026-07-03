"""Direct unit tests for alienclaw/evolution/bridge_runner.py.

make_bridge_runner(martian_type, inputs) returns a RunMartianCallback —
(martian_type, genome) -> FitnessReport — backed by the real in-process
bridge (alienclaw.bridge.server.handle). Tests use the 'compute' Martian
with seeded genomes: deterministic, no subprocess, no network.
"""
from __future__ import annotations

import json
import random
import uuid

import pytest

from alienclaw.bridge.server import handle
from alienclaw.evolution.bridge_runner import bridge_run_martian, make_bridge_runner
from alienclaw.evolution.generation import FitnessReport
from alienclaw.genome.operators import random_genome


@pytest.fixture(autouse=True)
def isolate_populations(tmp_path, monkeypatch):
    monkeypatch.setenv("ALIENCLAW_POPULATIONS_ROOT", str(tmp_path / "populations"))
    yield


def _genome(seed: int = 42) -> str:
    return random_genome(random.Random(seed), "COMPUT01")


class TestMakeBridgeRunnerSuccess:
    def test_returns_callable(self):
        runner = make_bridge_runner("compute", inputs={"input": "2 + 2"})
        assert callable(runner)

    def test_success_returns_fitness_report_in_unit_interval(self):
        runner = make_bridge_runner("compute", inputs={"input": "2 + 2"})
        report = runner("compute", _genome())
        assert isinstance(report, FitnessReport)
        assert 0.0 <= report.fitness <= 1.0
        assert report.fitness > 0.0

    def test_success_run_metadata_contract(self):
        runner = make_bridge_runner("compute", inputs={"input": "2 + 2"})
        report = runner("compute", _genome())
        assert isinstance(report.run_metadata, dict)
        assert report.run_metadata["ok"] is True
        assert isinstance(report.run_metadata["tool_calls"], int)
        assert report.run_metadata["tool_calls"] >= 1
        assert isinstance(report.run_metadata["wall_clock_ms"], int)
        assert report.run_metadata["wall_clock_ms"] >= 0

    def test_deterministic_for_fixed_genome(self):
        runner = make_bridge_runner("compute", inputs={"input": "2 + 2"})
        g = _genome()
        first = runner("compute", g)
        second = runner("compute", g)
        assert first.fitness == second.fitness
        assert first.run_metadata["tool_calls"] == second.run_metadata["tool_calls"]

    def test_report_matches_direct_bridge_response(self):
        """The runner is a thin adapter: fitness must equal the raw bridge fitness."""
        g = _genome(7)
        runner = make_bridge_runner("compute", inputs={"input": "3 * 3"})
        report = runner("compute", g)

        raw = json.dumps({
            "bridge_version": "1.0",
            "request_id": str(uuid.uuid4()),
            "request": {
                "kind": "summon",
                "genome": g,
                "martian_type": "compute",
                "inputs": {"input": "3 * 3"},
                "timeout_ms": 30_000,
            },
        }).encode()
        direct = handle(raw)["response"]
        assert direct["ok"] is True
        assert report.fitness == pytest.approx(direct["fitness"])
        assert report.run_metadata["tool_calls"] == direct["run_metadata"]["tool_calls"]


class TestMakeBridgeRunnerFailurePaths:
    def test_invalid_genome_yields_zero_fitness_report_not_exception(self):
        runner = make_bridge_runner("compute", inputs={"input": "2 + 2"})
        report = runner("compute", "not-a-valid-genome")
        assert isinstance(report, FitnessReport)
        assert report.fitness == 0.0
        assert report.run_metadata["ok"] is False
        assert report.run_metadata["tool_calls"] == 0

    def test_unknown_martian_type_yields_zero_fitness(self):
        runner = make_bridge_runner("compute", inputs={"input": "2 + 2"})
        report = runner("no_such_martian_type", _genome())
        assert report.fitness == 0.0
        assert report.run_metadata["ok"] is False

    def test_dispatch_uses_call_time_martian_type_not_factory_argument(self):
        """The factory's martian_type is not used for dispatch — the callback's
        first argument decides. Documented actual behavior: a runner built for
        'compute' summons whatever type the callback receives."""
        runner = make_bridge_runner("compute", inputs={"path": "/nonexistent-xyz.txt"})
        report = runner("file_read_alone", _genome())
        # file_read on a missing path fails inside the tool, proving the call-time
        # type ('file_read_alone'), not the factory type ('compute'), was summoned.
        assert report.fitness == 0.0
        assert report.run_metadata["ok"] is False
        assert report.run_metadata["tool_calls"] >= 1

    def test_default_empty_inputs_fail_compute(self):
        """Without inputs, compute reports a structured failure (fitness 0.0)."""
        runner = make_bridge_runner("compute")
        report = runner("compute", _genome())
        assert isinstance(report, FitnessReport)
        assert report.fitness == 0.0
        assert report.run_metadata["ok"] is False


class TestBridgeRunMartianDefault:
    def test_returns_report_with_empty_inputs_behavior(self):
        """bridge_run_martian sends empty inputs; compute requires 'input'/'task',
        so the report is a structured zero-fitness failure, not an exception."""
        report = bridge_run_martian("compute", _genome())
        assert isinstance(report, FitnessReport)
        assert report.fitness == 0.0
        assert report.run_metadata["ok"] is False
        assert report.run_metadata["tool_calls"] >= 1
