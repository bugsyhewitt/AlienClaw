"""Direct unit tests for the in-process bridge server (alienclaw/bridge/server.py).

test_bridge_fixture.py runs the shared JSON fixture cases against handle();
test_martian_dispatch.py covers multi-slot dispatch. This file unit-tests the
handle() entry point directly: envelope parsing, the error contract (structured
error responses, never exceptions), summon validation order, and the success
response contract (fitness in [0, 1], run_metadata keys, echo fields).

All requests use the real registries (seed/msb/, seed/martians/) and real
genomes built with a seeded RNG — fully deterministic, no network.
"""
from __future__ import annotations

import json
import random
from typing import Any

import pytest

from alienclaw.bridge.server import handle
from alienclaw.genome.operators import random_genome


@pytest.fixture(autouse=True)
def isolate_populations(tmp_path, monkeypatch):
    """Defensive isolation: summon-from-population would touch the populations root."""
    monkeypatch.setenv("ALIENCLAW_POPULATIONS_ROOT", str(tmp_path / "populations"))
    yield


def _genome(seed: int = 42) -> str:
    return random_genome(random.Random(seed), "COMPUT01")


def _envelope(
    martian_type: str = "compute",
    inputs: Any = None,
    genome: str | None = None,
    request_id: str = "req-direct-1",
    **request_overrides: Any,
) -> bytes:
    req: dict[str, Any] = {
        "kind": "summon",
        "genome": genome if genome is not None else _genome(),
        "martian_type": martian_type,
        "inputs": {"input": "2 + 2"} if inputs is None else inputs,
        "timeout_ms": 30000,
    }
    req.update(request_overrides)
    return json.dumps({
        "bridge_version": "1.0",
        "request_id": request_id,
        "request": req,
    }).encode()


class TestSummonSuccess:
    def test_valid_summon_round_trips_with_full_success_contract(self):
        resp = handle(_envelope())
        assert resp["bridge_version"] == "1.0"
        assert resp["request_id"] == "req-direct-1"
        response = resp["response"]
        assert response["ok"] is True, response.get("error")
        assert response["output"]["result"] == 4
        assert 0.0 <= response["fitness"] <= 1.0
        assert response["fitness"] > 0.0
        meta = response["run_metadata"]
        for key in (
            "tool_calls", "wall_clock_ms", "correctness", "efficiency",
            "fitness_formula_version",
        ):
            assert key in meta, f"missing run_metadata key: {key}"
        assert isinstance(meta["tool_calls"], int) and meta["tool_calls"] >= 1
        assert isinstance(meta["wall_clock_ms"], int) and meta["wall_clock_ms"] >= 0
        assert meta["correctness"] == pytest.approx(1.0)
        assert meta["fitness_formula_version"] == "v2.0"

    def test_summon_deterministic_for_fixed_genome(self):
        first = handle(_envelope())["response"]
        second = handle(_envelope())["response"]
        assert first["ok"] is True and second["ok"] is True
        assert first["fitness"] == second["fitness"]
        assert first["run_metadata"]["tool_calls"] == second["run_metadata"]["tool_calls"]
        assert first["output"] == second["output"]

    def test_alias_and_canonical_martian_agree(self):
        """'compute' is a registry alias for 'compute_alone' — identical dispatch."""
        g = _genome(7)
        via_alias = handle(_envelope(martian_type="compute", genome=g))["response"]
        via_canonical = handle(_envelope(martian_type="compute_alone", genome=g))["response"]
        assert via_alias["ok"] is True and via_canonical["ok"] is True
        assert via_alias["fitness"] == via_canonical["fitness"]
        assert via_alias["output"] == via_canonical["output"]


class TestEnvelopeErrors:
    def test_payload_too_large(self):
        resp = handle(b"x" * 1_048_577)
        assert resp["request_id"] is None
        err = resp["response"]["error"]
        assert err["code"] == "PAYLOAD_TOO_LARGE"
        assert err["details"]["received_bytes"] == 1_048_577

    def test_invalid_json_is_structured_error(self):
        resp = handle(b"{not json at all")
        err = resp["response"]["error"]
        assert err["code"] == "MALFORMED_REQUEST"
        assert "parse_error" in err["details"]

    @pytest.mark.parametrize("payload", [b"[1, 2]", b'"just a string"'])
    def test_non_object_envelope_rejected(self, payload):
        resp = handle(payload)
        assert resp["response"]["error"]["code"] == "MALFORMED_REQUEST"

    def test_version_mismatch_echoes_request_id_and_supported(self):
        raw = json.dumps({
            "bridge_version": "9.9",
            "request_id": "req-version",
            "request": {},
        }).encode()
        resp = handle(raw)
        assert resp["request_id"] == "req-version"
        err = resp["response"]["error"]
        assert err["code"] == "VERSION_MISMATCH"
        assert err["details"] == {"received": "9.9", "supported": ["1.0"]}

    @pytest.mark.parametrize("request_value", [None, "summon", 5, [1]])
    def test_missing_or_non_object_request_field(self, request_value):
        envelope: dict[str, Any] = {"bridge_version": "1.0", "request_id": "r"}
        if request_value is not None:
            envelope["request"] = request_value
        resp = handle(json.dumps(envelope).encode())
        err = resp["response"]["error"]
        assert err["code"] == "MALFORMED_REQUEST"
        assert err["details"]["missing_fields"] == ["request"]

    def test_missing_required_summon_fields_are_listed(self):
        raw = json.dumps({
            "bridge_version": "1.0",
            "request_id": "r",
            "request": {"kind": "summon", "martian_type": "compute", "inputs": {}},
        }).encode()
        resp = handle(raw)
        err = resp["response"]["error"]
        assert err["code"] == "MALFORMED_REQUEST"
        assert err["details"]["missing_fields"] == ["genome", "timeout_ms"]

    def test_unknown_kind_rejected(self):
        resp = handle(_envelope(kind="conjure"))
        err = resp["response"]["error"]
        assert err["code"] == "MALFORMED_REQUEST"
        assert "summon" in err["message"]

    def test_error_responses_are_structured_never_raised(self):
        """Every malformed shape returns the full error response contract."""
        payloads = [
            b"{broken",
            b"[]",
            json.dumps({"bridge_version": "0.1", "request_id": "x", "request": {}}).encode(),
            json.dumps({"bridge_version": "1.0", "request_id": "x"}).encode(),
            _envelope(kind="bogus"),
            _envelope(genome="short"),
            _envelope(martian_type="no_such_martian"),
            _envelope(timeout_ms=-1),
            _envelope(inputs="not a dict"),
        ]
        for raw in payloads:
            resp = handle(raw)  # must not raise
            response = resp["response"]
            assert response["ok"] is False
            assert response["fitness"] == 0.0
            err = response["error"]
            assert isinstance(err["code"], str) and err["code"]
            assert isinstance(err["message"], str)
            assert isinstance(err["details"], dict)
            meta = response["run_metadata"]
            assert isinstance(meta["tool_calls"], int)
            assert isinstance(meta["wall_clock_ms"], int)


class TestSummonValidation:
    @pytest.mark.parametrize("bad_genome,expected_snippet", [
        ("", None),
        ("abc", None),
        ("A" * 255, None),
        ("!" * 256, None),
        ("A" * 256, "Checksum mismatch"),  # right length/alphabet, wrong checksum
    ])
    def test_invalid_genome_rejected(self, bad_genome, expected_snippet):
        resp = handle(_envelope(genome=bad_genome))
        err = resp["response"]["error"]
        assert err["code"] == "INVALID_GENOME"
        assert err["details"]["errors"], "expected non-empty validation errors"
        if expected_snippet is not None:
            assert expected_snippet in err["message"]

    def test_unknown_martian_type_lists_available(self):
        resp = handle(_envelope(martian_type="definitely_not_registered"))
        err = resp["response"]["error"]
        assert err["code"] == "UNKNOWN_MARTIAN_TYPE"
        available = err["details"]["available"]
        assert available == sorted(available)
        assert "compute_alone" in available

    @pytest.mark.parametrize("bad_timeout", [0, 600_001, "5000", None])
    def test_timeout_ms_must_be_int_in_range(self, bad_timeout):
        resp = handle(_envelope(timeout_ms=bad_timeout))
        err = resp["response"]["error"]
        assert err["code"] == "MALFORMED_REQUEST"
        assert "timeout_ms" in err["message"]

    def test_tool_failure_is_structured_with_slot_index(self):
        resp = handle(_envelope(inputs={"input": "this is not math"}))
        response = resp["response"]
        assert response["ok"] is False
        assert response["fitness"] == 0.0
        err = response["error"]
        assert err["code"] == "TOOL_RUNNER_FAILED"
        assert err["details"]["slot_index"] == 0


class TestSummonFromPopulationShape:
    @staticmethod
    def _sfp(request: dict[str, Any]) -> dict:
        request["kind"] = "summon-from-population"
        return handle(json.dumps({
            "bridge_version": "1.0",
            "request_id": "r",
            "request": request,
        }).encode())

    def test_missing_field_reported(self):
        resp = self._sfp({"martian_type": "compute", "inputs": {}})
        err = resp["response"]["error"]
        assert err["code"] == "MALFORMED_REQUEST"
        assert err["details"]["missing_fields"] == ["timeout_ms"]

    def test_unknown_martian_type(self):
        resp = self._sfp({"martian_type": "no_such_martian", "inputs": {}, "timeout_ms": 1000})
        assert resp["response"]["error"]["code"] == "UNKNOWN_MARTIAN_TYPE"
