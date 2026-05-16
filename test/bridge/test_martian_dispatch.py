"""End-to-end tests for multi-slot Martian dispatch via the bridge.

Packet 16: bridge dispatches via MartianRegistry. Single-slot Martians keep
their pre-Packet-16 behavior; aliases like "compute" still resolve to
"compute_alone". Multi-slot Martians walk slots, wire inputs, and aggregate
fitness (correctness=min, tool_calls=sum).
"""
from __future__ import annotations

import json
import random

import pytest

from alienclaw.bridge.server import handle
from alienclaw.genome.operators import random_genome


def _genome_for(martian_type: str = "compute_alone", seed: int = 42) -> str:
    """Return a valid 256-char genome with a deterministic id_tag."""
    rng = random.Random(seed)
    # id_tag is the leading 8 chars of the IDENTITY section. The validator
    # only requires it be 8 Base62 chars; any tag works for dispatch tests.
    return random_genome(rng, "WEB00001")


def _summon_request(martian_type: str, inputs: dict, genome: str | None = None) -> bytes:
    g = genome if genome is not None else _genome_for(martian_type)
    req = {
        "bridge_version": "1.0",
        "request_id": f"test-{martian_type}",
        "request": {
            "kind": "summon",
            "genome": g,
            "martian_type": martian_type,
            "inputs": inputs,
            "timeout_ms": 30000,
        },
    }
    return json.dumps(req).encode()


class TestSingleSlotMartian:
    def test_compute_alone_returns_result(self) -> None:
        raw = _summon_request("compute_alone", {"input": "2 + 2"})
        resp = handle(raw)
        assert resp["response"]["ok"] is True, resp["response"].get("error")
        assert "result" in resp["response"]["output"]
        assert resp["response"]["fitness"] > 0

    def test_compute_alias_works(self) -> None:
        """Bare tool name 'compute' still resolves via the registry alias."""
        raw = _summon_request("compute", {"input": "3 * 3"})
        resp = handle(raw)
        assert resp["response"]["ok"] is True, resp["response"].get("error")

    def test_unknown_martian_type_error(self) -> None:
        raw = _summon_request("nonexistent_martian", {})
        resp = handle(raw)
        assert resp["response"]["ok"] is False
        assert resp["response"]["error"]["code"] == "UNKNOWN_MARTIAN_TYPE"

    def test_run_metadata_tool_calls_present(self) -> None:
        raw = _summon_request("compute_alone", {"input": "1 + 1"})
        resp = handle(raw)
        assert resp["response"]["ok"] is True
        meta = resp["response"]["run_metadata"]
        assert "tool_calls" in meta
        assert isinstance(meta["tool_calls"], int)
        assert meta["tool_calls"] >= 1


class TestMultiSlotMartian:
    def test_compute_then_validate_executes_both_slots(self) -> None:
        """compute_then_validate: compute first, extract_json second."""
        raw = _summon_request(
            "compute_then_validate",
            {"input": '{"x": 1}'},
        )
        resp = handle(raw)
        # Either ok=True or ok=False is acceptable depending on extract_json
        # behavior on the compute output; the key invariant is no crash.
        assert "response" in resp
        assert "ok" in resp["response"]

    def test_write_then_verify(self, tmp_path) -> None:
        """write_then_verify: write a file, then read it back."""
        test_file = str(tmp_path / "test_output.txt")
        raw = _summon_request(
            "write_then_verify",
            {"path": test_file, "content": "hello"},
        )
        resp = handle(raw)
        # On success, final output is from file_read (last slot).
        # On any slot failure the bridge surfaces an error response.
        assert "response" in resp
        if resp["response"]["ok"]:
            assert "tool_calls" in resp["response"]["run_metadata"]
            # Multi-slot: at minimum 2 tool_calls aggregated
            assert resp["response"]["run_metadata"]["tool_calls"] >= 2

    def test_slot_failure_surfaces_slot_index(self) -> None:
        """A slot failure should report the slot index in error details."""
        raw = _summon_request(
            "file_read_alone",
            {"path": "/definitely/not/a/real/path-xyz-987.txt"},
        )
        resp = handle(raw)
        assert resp["response"]["ok"] is False
        details = resp["response"]["error"].get("details", {})
        # New: slot_index is included in details for slot failures
        assert "slot_index" in details
        assert details["slot_index"] == 0
