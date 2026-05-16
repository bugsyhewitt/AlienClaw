"""Run-Martian callback that invokes the Packet 7 Python bridge directly.

Used by the experiment CLI and the end-to-end test. Decoupled from
subprocess wiring so tests can swap it for a faster mock.
"""
from __future__ import annotations

import json
import uuid
from typing import Any

from alienclaw.bridge.server import handle

from .generation import FitnessReport


def _call_bridge(
    martian_type: str, genome: str, inputs: dict[str, Any], timeout_ms: int
) -> FitnessReport:
    req = json.dumps({
        "bridge_version": "1.0",
        "request_id": str(uuid.uuid4()),
        "request": {
            "kind": "summon",
            "genome": genome,
            "martian_type": martian_type,
            "inputs": inputs,
            "timeout_ms": timeout_ms,
        },
    }).encode()
    resp_dict = handle(req)
    resp = resp_dict["response"]
    meta = resp.get("run_metadata", {})
    return FitnessReport(
        fitness=float(resp.get("fitness", 0.0)),
        run_metadata={
            "tool_calls": meta.get("tool_calls", 0),
            "wall_clock_ms": meta.get("wall_clock_ms", 0),
            "ok": resp.get("ok", False),
        },
    )


def make_bridge_runner(
    martian_type: str,
    inputs: dict[str, Any] | None = None,
    timeout_ms: int = 30_000,
):
    """Return a RunMartianCallback that calls the bridge for a fixed input set."""
    _inputs = inputs or {}

    def run(mtype: str, genome: str) -> FitnessReport:
        return _call_bridge(mtype, genome, _inputs, timeout_ms)

    return run


def bridge_run_martian(martian_type: str, genome: str) -> FitnessReport:
    """Default bridge runner with empty inputs. Suitable for compute experiments."""
    return _call_bridge(martian_type, genome, {}, 30_000)
