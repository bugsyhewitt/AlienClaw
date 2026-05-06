"""Bridge server: reads one JSON request from stdin, writes one JSON response to stdout."""
from __future__ import annotations

import json
import sys
import time
from typing import Any

from alienclaw.genome.validation import validate as validate_genome
from alienclaw.fitness import evaluate, FitnessInputs
from alienclaw.brains.registry import BrainRegistry
from alienclaw.brains.decoder import decode_params
from .runners import RUNNER_REGISTRY
from alienclaw.diagnostics import instrumentation as _diag

_brain_registry: BrainRegistry | None = None

def _get_registry() -> BrainRegistry:
    global _brain_registry
    if _brain_registry is None:
        _brain_registry = BrainRegistry.load("seed/msb/")
    return _brain_registry

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

    kind = req.get("kind")

    # ── summon-from-population (v1.x extension) ────────────────────────────
    if kind == "summon-from-population":
        return _handle_summon_from_population(request_id, req, t0)

    # ── summon (v1.0 original) ─────────────────────────────────────────────
    missing = [f for f in ("kind", "genome", "martian_type", "inputs", "timeout_ms") if f not in req]
    if missing:
        return _error_response(request_id, "MALFORMED_REQUEST", f"Missing required fields: {missing}", {"missing_fields": missing})

    if kind != "summon":
        return _error_response(request_id, "MALFORMED_REQUEST", f"request.kind must be 'summon' or 'summon-from-population', got '{kind}'", {"missing_fields": []})

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

    _diag.record_genome(genome, martian_type, req["inputs"])

    # Decode genome → behavioral parameters per the brain's parameter_schema
    brains = _get_registry().all_brains()
    brain = next((b for b in brains if b.tool == martian_type), None)
    decoded = decode_params(brain, genome) if brain else {}

    runner = RUNNER_REGISTRY[martian_type]
    _diag.record_runner_call(genome_passed=True)  # decoded params now reach runner
    try:
        run_result = runner(req["inputs"], decoded)
    except Exception as exc:
        wall_ms = int((time.monotonic() - t0) * 1000)
        return _error_response(request_id, "TOOL_RUNNER_FAILED", f"Runner raised exception: {exc}", {"output_partial": None}, wall_ms)

    wall_ms = int((time.monotonic() - t0) * 1000)

    if not run_result.ok:
        fitness_result = evaluate(FitnessInputs(correctness=0.0, tool_calls=run_result.tool_calls, error=run_result.error))
        _diag.record_runner_result(run_result.output, run_result.error, 0.0, run_result.tool_calls)
        _diag.record_fitness(0.0)
        return _error_response(request_id, "TOOL_RUNNER_FAILED", run_result.error or "Runner failed", {"output_partial": run_result.output}, wall_ms)

    fitness_result = evaluate(FitnessInputs(correctness=run_result.correctness, tool_calls=run_result.tool_calls))
    _diag.record_runner_result(run_result.output, None, run_result.correctness, run_result.tool_calls)
    _diag.record_fitness(fitness_result.fitness)
    return _success_response(request_id, run_result.output, fitness_result, wall_ms)


def _handle_summon_from_population(request_id: str | None, req: dict, t0: float) -> dict:
    """Handle kind='summon-from-population' — selects genome from population via tournament."""
    import random
    from alienclaw.evolution.population import Population
    from alienclaw.evolution.selection import tournament
    from alienclaw.evolution.types import EvolutionConfig

    for field in ("martian_type", "inputs", "timeout_ms"):
        if field not in req:
            return _error_response(request_id, "MALFORMED_REQUEST", f"Missing field: {field}", {"missing_fields": [field]})

    martian_type = req["martian_type"]
    inputs = req.get("inputs", {})
    timeout_ms = req.get("timeout_ms", 30_000)

    if martian_type not in RUNNER_REGISTRY:
        return _error_response(
            request_id, "UNKNOWN_MARTIAN_TYPE",
            f"No brain for martian_type='{martian_type}'",
            {"available": sorted(RUNNER_REGISTRY.keys())},
        )

    # Load or create population for this martian_type
    config = EvolutionConfig(martian_type=martian_type)
    try:
        pop = Population.load_or_create(config)
    except Exception as exc:
        return _error_response(request_id, "INTERNAL", f"Population error: {exc}", {"exception": str(exc)})

    rng = random.Random()
    try:
        selected = tournament(pop, config.tournament_k, rng)
        genome = selected.genome
    except RuntimeError as exc:
        return _error_response(request_id, "INTERNAL", f"Selection error: {exc}", {"exception": str(exc)})

    # Run the martian with the selected genome
    runner = RUNNER_REGISTRY[martian_type]
    try:
        run_result = runner(inputs)
    except Exception as exc:
        wall_ms = int((time.monotonic() - t0) * 1000)
        return _error_response(request_id, "TOOL_RUNNER_FAILED", f"Runner exception: {exc}", {"output_partial": None}, wall_ms)

    wall_ms = int((time.monotonic() - t0) * 1000)

    if not run_result.ok:
        fitness_result = evaluate(FitnessInputs(correctness=0.0, tool_calls=run_result.tool_calls, error=run_result.error))
        # Feed fitness back to population even on failure
        try:
            pop.add(genome=genome, fitness=0.0, generation=pop.current_generation(),
                    parent_ids=(selected.entry_id,), run_metadata={"error": run_result.error, "re_evaluated": True})
        except Exception:
            pass
        return _error_response(request_id, "TOOL_RUNNER_FAILED", run_result.error or "Runner failed",
                                {"output_partial": run_result.output, "genome_used": genome}, wall_ms)

    fitness_result = evaluate(FitnessInputs(correctness=run_result.correctness, tool_calls=run_result.tool_calls))

    # Feed fitness back into the population
    try:
        pop.add(genome=genome, fitness=fitness_result.fitness, generation=pop.current_generation(),
                parent_ids=(selected.entry_id,), run_metadata={
                    "tool_calls": 1, "wall_clock_ms": wall_ms,
                    "correctness": fitness_result.correctness, "re_evaluated": True,
                })
    except Exception:
        pass

    resp = _success_response(request_id, run_result.output, fitness_result, wall_ms)
    resp["response"]["genome_used"] = genome
    return resp


def main() -> None:
    raw = sys.stdin.buffer.read()
    response = handle(raw)
    sys.stdout.write(json.dumps(response) + "\n")
    sys.stdout.flush()
