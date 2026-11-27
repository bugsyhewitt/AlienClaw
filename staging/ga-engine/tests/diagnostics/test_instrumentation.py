"""Tests for diagnostics/instrumentation.py.

Staged divergence: the in-tree file drives the recorders through
alienclaw.bridge.server.handle (DROP). The bridge-free tests (TestIsEnabled,
test_record_functions_no_op_when_disabled) are kept as-is; the bridge-driven
ones are replaced by tests that call the record_* producers directly, the way
bridge/server.py does in-tree. Two bridge-only assertions are dropped:
test_production_response_identical_when_off and test_decoded_params_reach_runner
(both assert bridge response / runner behavior, not instrumentation behavior).
"""
import random

from alienclaw_ga.diagnostics.instrumentation import (
    CaptureHook,
    is_enabled,
    record_fitness,
    record_genome,
    record_runner_call,
    record_runner_result,
)
from alienclaw_ga.genome.operators import random_genome


def _valid_genome(seed: int = 1) -> str:
    return random_genome(random.Random(seed), "COMPUT01")


def _simulate_producer(genome: str) -> None:
    """Stand-in for the in-tree bridge/server.py call sequence."""
    record_genome(genome, "compute", {"input": "2 + 2"})
    record_runner_call(genome_passed=True)
    record_runner_result({"result": 4}, None, 0.75, 1)
    record_fitness(0.75)


class TestIsEnabled:
    def test_disabled_by_default(self, monkeypatch):
        monkeypatch.delenv("ALIENCLAW_DIAGNOSTICS", raising=False)
        assert not is_enabled()

    def test_enabled_with_flag(self, monkeypatch):
        monkeypatch.setenv("ALIENCLAW_DIAGNOSTICS", "1")
        assert is_enabled()

    def test_not_enabled_for_other_values(self, monkeypatch):
        for val in ("0", "true", "yes", "on", ""):
            monkeypatch.setenv("ALIENCLAW_DIAGNOSTICS", val)
            assert not is_enabled()


class TestCaptureHook:
    def test_trace_populated_when_enabled(self, monkeypatch):
        monkeypatch.setenv("ALIENCLAW_DIAGNOSTICS", "1")
        genome = _valid_genome(1)
        with CaptureHook() as hook:
            _simulate_producer(genome)
        trace = hook.trace()
        assert trace.genome == genome
        assert trace.martian_type == "compute"
        assert trace.inputs == {"input": "2 + 2"}
        assert trace.runner_output == {"result": 4}
        assert trace.runner_error is None
        assert trace.correctness == 0.75
        assert trace.tool_calls == 1
        assert trace.fitness == 0.75
        assert trace.genome_passed_to_runner is True

    def test_trace_empty_when_disabled(self, monkeypatch):
        monkeypatch.delenv("ALIENCLAW_DIAGNOSTICS", raising=False)
        genome = _valid_genome(2)
        with CaptureHook() as hook:
            _simulate_producer(genome)
        trace = hook.trace()
        assert trace.genome == ""  # not populated when off
        assert trace.genome_passed_to_runner is False

    def test_capture_deactivated_after_block(self, monkeypatch):
        monkeypatch.setenv("ALIENCLAW_DIAGNOSTICS", "1")
        with CaptureHook() as hook:
            pass
        _simulate_producer(_valid_genome(3))  # outside the block: must not land in trace
        assert hook.trace().genome == ""

    def test_record_functions_no_op_when_disabled(self, monkeypatch):
        monkeypatch.delenv("ALIENCLAW_DIAGNOSTICS", raising=False)
        # These should not raise and should have no effect
        record_genome("abc", "compute", {})
        record_runner_result({}, None, 0.5, 1)
        record_fitness(0.5)
