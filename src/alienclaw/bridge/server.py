"""Bridge server: reads one JSON request from stdin, writes one JSON response to stdout."""
from __future__ import annotations

import json
import sys
import time
from typing import Any

from alienclaw.genome.validation import validate as validate_genome
from alienclaw.fitness import evaluate, FitnessInputs
from .runners import RUNNER_REGISTRY

_SUPPORTED_VERSION = "1.0"
_MAX_BYTES = 1_048_576  # 1 MiB


def _error_response(request_id: str | None, code: str, message: str, details: dict[str, Any], wall_clock_ms: int = 0) -> dict:
    return {
        "bridge_version": _SUPPORTED_VERSION,
        "request_id": request_id,
        "response": {
            "ok": False,
            "error": {"code": code, "message": message, "details": details},
            "fitness": 0.0,
            "run_metadata": {"tool_calls": 0, "wall_clock_ms": wall_clock_ms},
        },
    }


def _success_response(request_id: str, output: dict, fitness_result: Any, wall_clock_ms: int) -> dict:
    return {
        "bridge_version": _SUPPORTED_VERSION,
        "request_id": request_id,
        "response": {
            "ok": True,
            "output": output,
            "fitness": fitness_result.fitness,
            "run_metadata": {
                "tool_calls": 1,
                "wall_clock_ms": wall_clock_ms,
                "correctness": fitness_result.correctness,
                "efficiency": fitness_result.efficiency,
                "fitness_formula_version": fitness_result.formula_version,
            },
        },
    }


def handle(raw: bytes) -> dict:
    t0 = time.monotonic()

    if len(raw) > _MAX_BYTES:
        return _error_response(None, "PAYLOAD_TOO_LARGE", "Request exceeds 1 MiB limit", {"received_bytes": len(raw)})

    try:
        envelope = json.loads(raw.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        return _error_response(None, "MALFORMED_REQUEST", f"JSON parse error: {exc}", {"parse_error": str(exc)})

    if not isinstance(envelope, dict):
        return _error_response(None, "MALFORMED_REQUEST", "Request must be a JSON object", {"parse_error": "not an object"})

    request_id = envelope.get("request_id")

    version = envelope.get("bridge_version")
    if version != _SUPPORTED_VERSION:
        return _error_response(request_id, "VERSION_MISMATCH", f"Unsupported version '{version}'", {"received": version, "supported": [_SUPPORTED_VERSION]})

    req = envelope.get("request")
    if not isinstance(req, dict):
        return _error_response(request_id, "MALFORMED_REQUEST", "Missing or invalid 'request' field", {"missing_fields": ["request"]})

    missing = [f for f in ("kind", "genome", "martian_type", "inputs", "timeout_ms") if f not in req]
    if missing:
        return _error_response(request_id, "MALFORMED_REQUEST", f"Missing required fields: {missing}", {"missing_fields": missing})

    if req["kind"] != "summon":
        return _error_response(request_id, "MALFORMED_REQUEST", f"request.kind must be 'summon', got '{req['kind']}'", {"missing_fields": []})

    genome = req["genome"]
    validation = validate_genome(genome)
    if not validation.valid:
        return _error_response(request_id, "INVALID_GENOME", f"Genome validation failed: {validation.errors[0]}", {"errors": validation.errors})

    martian_type = req["martian_type"]
    if martian_type not in RUNNER_REGISTRY:
        return _error_response(
            request_id,
            "UNKNOWN_MARTIAN_TYPE",
            f"No brain for martian_type='{martian_type}'",
            {"available": sorted(RUNNER_REGISTRY.keys())},
        )

    timeout_ms = req["timeout_ms"]
    if not isinstance(timeout_ms, int) or not (1 <= timeout_ms <= 600_000):
        return _error_response(request_id, "MALFORMED_REQUEST", "timeout_ms must be integer in [1, 600000]", {"missing_fields": []})

    if not isinstance(req["inputs"], dict):
        return _error_response(request_id, "MALFORMED_REQUEST", "inputs must be an object", {"missing_fields": ["inputs"]})

    runner = RUNNER_REGISTRY[martian_type]
    try:
        run_result = runner(req["inputs"])
    except Exception as exc:
        wall_ms = int((time.monotonic() - t0) * 1000)
        return _error_response(request_id, "TOOL_RUNNER_FAILED", f"Runner raised exception: {exc}", {"output_partial": None}, wall_ms)

    wall_ms = int((time.monotonic() - t0) * 1000)

    if not run_result.ok:
        fitness_result = evaluate(FitnessInputs(correctness=0.0, tool_calls=run_result.tool_calls, error=run_result.error))
        return _error_response(request_id, "TOOL_RUNNER_FAILED", run_result.error or "Runner failed", {"output_partial": run_result.output}, wall_ms)

    fitness_result = evaluate(FitnessInputs(correctness=run_result.correctness, tool_calls=run_result.tool_calls))
    return _success_response(request_id, run_result.output, fitness_result, wall_ms)


def main() -> None:
    raw = sys.stdin.buffer.read()
    response = handle(raw)
    sys.stdout.write(json.dumps(response) + "\n")
    sys.stdout.flush()
