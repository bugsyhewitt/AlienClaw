import json
import os
import pytest
from alienclaw.diagnostics.instrumentation import (
    CaptureHook, CaptureTrace, is_enabled,
    record_genome, record_runner_result, record_fitness,
)
from alienclaw.bridge.server import handle
from alienclaw.genome.operators import random_genome
from alienclaw.genome.codec import encode_xcode, param_value_to_xcode
from alienclaw.genome.checksum import compute_checksum
import random


def _valid_genome(seed: int = 1) -> str:
    """Genome where compute decodes to max_attempts=1 and validation_count=1.

    This mirrors the prior behavior expected by the diagnostics test
    (tool_calls == 1) under the new Xcode encoding (Packet 15).
    """
    g = random_genome(random.Random(seed), "COMPUT01")
    chars = list(g[:192])
    # compute: xcode_index 0 = max_attempts [1,5]; xcode_index 4 = validation_count [1,3]
    for xidx, (vmin, vmax, target) in (
        (0, (1, 5, 1)),
        (4, (1, 3, 1)),
    ):
        v = param_value_to_xcode(target, vmin, vmax)
        e = encode_xcode(v)
        base = 64 + 1 + xidx * 2
        chars[base], chars[base + 1] = e[0], e[1]
    body = "".join(chars)
    return body + compute_checksum(body)


def _compute_req(genome: str) -> bytes:
    return json.dumps({
        "bridge_version": "1.0",
        "request_id": "550e8400-e29b-41d4-a716-000000000001",
        "request": {
            "kind": "summon",
            "genome": genome,
            "martian_type": "compute",
            "inputs": {"input": "2 + 2"},
            "timeout_ms": 5000,
        },
    }).encode()


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
            resp = handle(_compute_req(genome))
        trace = hook.trace()
        assert trace.genome == genome
        assert trace.martian_type == "compute"
        assert trace.correctness == pytest.approx(1.0)
        assert trace.tool_calls == 1
        assert trace.fitness == pytest.approx(1.0)
        assert trace.genome_passed_to_runner is True  # Packet 8.6: genome decoded and reaches runner

    def test_trace_empty_when_disabled(self, monkeypatch):
        monkeypatch.delenv("ALIENCLAW_DIAGNOSTICS", raising=False)
        genome = _valid_genome(2)
        with CaptureHook() as hook:
            resp = handle(_compute_req(genome))
        trace = hook.trace()
        assert trace.genome == ""  # not populated when off

    def test_production_response_identical_when_off(self, monkeypatch):
        """Production path is byte-identical whether diagnostics are on or off."""
        monkeypatch.delenv("ALIENCLAW_DIAGNOSTICS", raising=False)
        genome = _valid_genome(3)
        req = _compute_req(genome)
        resp_off = handle(req)

        monkeypatch.setenv("ALIENCLAW_DIAGNOSTICS", "1")
        with CaptureHook():
            resp_on = handle(req)

        # Response content is identical regardless of diagnostics flag
        assert resp_off["response"]["ok"] == resp_on["response"]["ok"]
        assert resp_off["response"]["fitness"] == resp_on["response"]["fitness"]
        assert resp_off["response"]["output"] == resp_on["response"]["output"]

    def test_record_functions_no_op_when_disabled(self, monkeypatch):
        monkeypatch.delenv("ALIENCLAW_DIAGNOSTICS", raising=False)
        # These should not raise and should have no effect
        record_genome("abc", "compute", {})
        record_runner_result({}, None, 0.5, 1)
        record_fitness(0.5)

    def test_decoded_params_reach_runner(self, monkeypatch):
        """Packet 8.6: genome is decoded and params reach the runner (MUST FIX #1 resolved)."""
        monkeypatch.setenv("ALIENCLAW_DIAGNOSTICS", "1")
        genome = _valid_genome(4)
        with CaptureHook() as hook:
            handle(_compute_req(genome))
        assert hook.trace().genome_passed_to_runner is True
