"""Bridge server: reads one JSON request from stdin, writes one JSON response to stdout.

Packet 16: dispatches via MartianRegistry. Each Martian declares 1-2 ordered
tool slots. The bridge walks slots, resolves wired inputs from prior slot
outputs, decodes per-slot genome params (slot_index = martian_slot_index + 1),
runs the tool, aggregates fitness (correctness = min, tool_calls = sum), and
returns the final slot's output. Single-slot Martians keep their pre-Packet-16
behavior; the registry registers ``<tool>`` as an alias for ``<tool>_alone``
to preserve the old wire protocol.
"""
from __future__ import annotations

import json
import sys
import time
from typing import Any

from alienclaw.genome.validation import validate as validate_genome
from alienclaw.fitness import evaluate, FitnessInputs
from alienclaw.fitness.conformance import conformance_for
from alienclaw.brains.registry import BrainRegistry
from alienclaw.brains.decoder import decode_params
from alienclaw.tools import TOOL_REGISTRY
from alienclaw.martians.registry import MartianRegistry
from alienclaw.martians.substitution import resolve_inputs
from alienclaw.diagnostics import instrumentation as _diag

_brain_registry: BrainRegistry | None = None
_martian_registry: MartianRegistry | None = None


def _get_registry() -> BrainRegistry:
    global _brain_registry
    if _brain_registry is None:
        _brain_registry = BrainRegistry.load("seed/msb/")
    return _brain_registry


def _get_martian_registry() -> MartianRegistry:
    global _martian_registry
    if _martian_registry is None:
        _martian_registry = MartianRegistry.load("seed/martians/", _get_registry())
    return _martian_registry


_SUPPORTED_VERSION = "1.0"
_MAX_BYTES = 1_048_576  # 1 MiB


def _error_response(request_id: str | None, code: str, message: str, details: dict[str, Any], wall_clock_ms: int = 0, tool_calls: int = 0) -> dict:
    return {
        "bridge_version": _SUPPORTED_VERSION,
        "request_id": request_id,
        "response": {
            "ok": False,
            "error": {"code": code, "message": message, "details": details},
            "fitness": 0.0,
            "run_metadata": {"tool_calls": tool_calls, "wall_clock_ms": wall_clock_ms},
        },
    }


def _success_response(request_id: str, output: dict, fitness_result: Any, wall_clock_ms: int, tool_calls: int = 1) -> dict:
    return {
        "bridge_version": _SUPPORTED_VERSION,
        "request_id": request_id,
        "response": {
            "ok": True,
            "output": output,
            "fitness": fitness_result.fitness,
            "run_metadata": {
                "tool_calls": tool_calls,
                "wall_clock_ms": wall_clock_ms,
                "correctness": fitness_result.correctness,
                "efficiency": fitness_result.efficiency,
                "fitness_formula_version": fitness_result.formula_version,
            },
        },
    }


def _execute_martian(
    martian_spec: Any,
    genome: str,
    campaign_inputs: dict[str, Any],
    brains: BrainRegistry,
    t0: float,
    request_id: str | None,
) -> tuple[dict, dict | None, int, float, int]:
    """Walk a Martian's slots and execute each tool in order.

    Returns:
        (response_dict, final_output_or_none, total_tool_calls, martian_correctness, wall_ms)

    The first element is the full response dict to return to the caller.
    """
    slot_outputs: list[dict] = []
    total_tool_calls = 0
    slot_correctnesses: list[float] = []

    for slot_decl in martian_spec.slots:
        # 1. Resolve inputs for this slot
        try:
            resolved_inputs = resolve_inputs(
                slot_decl.inputs_from,
                slot_outputs,
                campaign_inputs,
            )
        except Exception as exc:
            wall_ms = int((time.monotonic() - t0) * 1000)
            return (
                _error_response(
                    request_id, "TOOL_RUNNER_FAILED",
                    f"Slot {slot_decl.slot_index} input resolution failed: {exc}",
                    {"output_partial": None, "slot_index": slot_decl.slot_index},
                    wall_ms, total_tool_calls,
                ),
                None, total_tool_calls, 0.0, wall_ms,
            )

        # 2. Decode genome params for this slot (slot_index = martian_slot_index + 1)
        brain = brains.lookup_by_name(slot_decl.tool_name)
        genome_section = slot_decl.slot_index + 1
        decoded = decode_params(brain, genome, slot_index=genome_section) if brain else {}

        # 3. Execute the tool
        tool = TOOL_REGISTRY[slot_decl.tool_name]
        _diag.record_runner_call(genome_passed=True)
        try:
            run_result = tool(resolved_inputs, decoded)
        except Exception as exc:
            wall_ms = int((time.monotonic() - t0) * 1000)
            return (
                _error_response(
                    request_id, "TOOL_RUNNER_FAILED",
                    f"Slot {slot_decl.slot_index} runner raised exception: {exc}",
                    {"output_partial": None, "slot_index": slot_decl.slot_index},
                    wall_ms, total_tool_calls,
                ),
                None, total_tool_calls, 0.0, wall_ms,
            )

        total_tool_calls += run_result.tool_calls
        # Graded correctness: a successful slot scores its output-contract conformance
        # (fraction of MSB OUTPUT CONTRACT fields present + type-valid) when the tool
        # has a registered contract, else its binary correctness. Errored slot → 0.0.
        if run_result.ok:
            graded = conformance_for(slot_decl.tool_name, run_result.output or {})
            slot_correctnesses.append(graded if graded is not None else run_result.correctness)
        else:
            slot_correctnesses.append(0.0)
        slot_outputs.append(run_result.output or {})

        # Slot failure → Martian fails
        if not run_result.ok:
            wall_ms = int((time.monotonic() - t0) * 1000)
            _diag.record_runner_result(run_result.output, run_result.error, 0.0, total_tool_calls)
            _diag.record_fitness(0.0)
            return (
                _error_response(
                    request_id, "TOOL_RUNNER_FAILED",
                    f"Slot {slot_decl.slot_index} failed: {run_result.error or 'Runner failed'}",
                    {"output_partial": run_result.output, "slot_index": slot_decl.slot_index},
                    wall_ms, total_tool_calls,
                ),
                run_result.output, total_tool_calls, 0.0, wall_ms,
            )

    # All slots succeeded
    wall_ms = int((time.monotonic() - t0) * 1000)
    martian_correctness = min(slot_correctnesses) if slot_correctnesses else 0.0
    fitness_result = evaluate(FitnessInputs(
        correctness=martian_correctness,
        tool_calls=total_tool_calls,
        slot_count=len(martian_spec.slots),
    ))
    final_output = slot_outputs[-1] if slot_outputs else {}
    _diag.record_runner_result(final_output, None, martian_correctness, total_tool_calls)
    _diag.record_fitness(fitness_result.fitness)
    return (
        _success_response(request_id, final_output, fitness_result, wall_ms, tool_calls=total_tool_calls),
        final_output, total_tool_calls, martian_correctness, wall_ms,
    )


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

    # ── live-evo (E2 item 3) ───────────────────────────────────────────────
    if kind == "live-evo":
        return _handle_live_evo(request_id, req, t0)

    # ── summon-from-population (v1.x extension) ────────────────────────────
    if kind == "summon-from-population":
        return _handle_summon_from_population(request_id, req, t0)

    # ── summon (v1.0 original) ─────────────────────────────────────────────
    missing = [f for f in ("kind", "genome", "martian_type", "inputs", "timeout_ms") if f not in req]
    if missing:
        return _error_response(request_id, "MALFORMED_REQUEST", f"Missing required fields: {missing}", {"missing_fields": missing})

    if kind != "summon":
        return _error_response(
            request_id, "MALFORMED_REQUEST",
            f"request.kind must be 'summon', 'summon-from-population', or 'live-evo', got '{kind}'",
            {"missing_fields": []},
        )

    genome = req["genome"]
    validation = validate_genome(genome)
    if not validation.valid:
        return _error_response(request_id, "INVALID_GENOME", f"Genome validation failed: {validation.errors[0]}", {"errors": validation.errors})

    martian_type = req["martian_type"]
    registry = _get_martian_registry()
    if not registry.has(martian_type):
        return _error_response(
            request_id,
            "UNKNOWN_MARTIAN_TYPE",
            f"No Martian for martian_type='{martian_type}'",
            {"available": sorted(m.martian_type for m in registry.all())},
        )

    timeout_ms = req["timeout_ms"]
    if not isinstance(timeout_ms, int) or not (1 <= timeout_ms <= 600_000):
        return _error_response(request_id, "MALFORMED_REQUEST", "timeout_ms must be integer in [1, 600000]", {"missing_fields": []})

    if not isinstance(req["inputs"], dict):
        return _error_response(request_id, "MALFORMED_REQUEST", "inputs must be an object", {"missing_fields": ["inputs"]})

    martian_spec = registry.get(martian_type)
    _diag.record_genome(genome, martian_type, req["inputs"])

    brains = _get_registry()
    response, _final_output, _tool_calls, _correctness, _wall_ms = _execute_martian(
        martian_spec, genome, req["inputs"], brains, t0, request_id,
    )
    return response


def _handle_live_evo(request_id: str | None, req: dict, t0: float) -> dict:
    """Handle kind='live-evo' — threshold-triggered generational evolution step."""
    from alienclaw.evolution.live_evo import check_and_evolve, LIVE_EVO_THRESHOLD

    martian_type = req.get("martian_type")
    if not martian_type:
        return _error_response(
            request_id, "MALFORMED_REQUEST",
            "Missing field: martian_type",
            {"missing_fields": ["martian_type"]},
        )
    threshold = int(req.get("threshold", LIVE_EVO_THRESHOLD))
    try:
        result = check_and_evolve(martian_type, threshold)
    except Exception as exc:
        wall_ms = int((time.monotonic() - t0) * 1000)
        return _error_response(
            request_id, "INTERNAL",
            f"live-evo error: {exc}",
            {"exception": str(exc)},
            wall_ms,
        )
    wall_ms = int((time.monotonic() - t0) * 1000)
    if result is None:
        payload: dict = {"ok": True, "evolved": False, "reason": "below_threshold"}
    else:
        payload = {
            "ok": True,
            "evolved": True,
            "generation": result["generation"],
            "next_generation": result["next_generation"],
            "children_minted": result["children_minted"],
            "new_observations": result["new_observations"],
        }
    return {
        "bridge_version": _SUPPORTED_VERSION,
        "request_id": request_id,
        "response": payload,
    }


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
    if not isinstance(inputs, dict):
        return _error_response(request_id, "MALFORMED_REQUEST", "inputs must be an object", {"missing_fields": ["inputs"]})
    timeout_ms = req.get("timeout_ms", 30_000)

    registry = _get_martian_registry()
    if not registry.has(martian_type):
        return _error_response(
            request_id, "UNKNOWN_MARTIAN_TYPE",
            f"No Martian for martian_type='{martian_type}'",
            {"available": sorted(m.martian_type for m in registry.all())},
        )

    martian_spec = registry.get(martian_type)

    # Load or create population for this martian_type
    config = EvolutionConfig(martian_type=martian_type)
    try:
        pop = Population.load_or_create(config)
    except Exception as exc:
        return _error_response(request_id, "INTERNAL", f"Population error: {exc}", {"exception": str(exc)})

    # Cap in-memory pool to population_size — prevents unbounded growth diluting tournament selection
    if len(pop.all()) > config.population_size:
        pop.replace_pool(pop.top(config.population_size))

    rng = random.Random()
    try:
        selected = tournament(pop, config.tournament_k, rng)
        genome = selected.genome
    except RuntimeError as exc:
        return _error_response(request_id, "INTERNAL", f"Selection error: {exc}", {"exception": str(exc)})

    # Run the Martian with the selected genome
    brains = _get_registry()
    response, final_output, total_tool_calls, correctness, wall_ms = _execute_martian(
        martian_spec, genome, inputs, brains, t0, request_id,
    )

    if not response["response"]["ok"]:
        # Feed failure fitness back to population
        try:
            pop.add(
                genome=genome, fitness=0.0,
                generation=pop.current_generation(),
                parent_ids=(selected.entry_id,),
                run_metadata={
                    "error": response["response"]["error"]["message"],
                    "re_evaluated": True,
                },
            )
        except Exception:
            pass
        # Annotate with genome_used and partial output for backward compat
        response["response"]["error"]["details"]["genome_used"] = genome
        return response

    # Success: feed fitness back
    fitness = response["response"]["fitness"]
    try:
        pop.add(
            genome=genome, fitness=fitness,
            generation=pop.current_generation(),
            parent_ids=(selected.entry_id,),
            run_metadata={
                "tool_calls": total_tool_calls, "wall_clock_ms": wall_ms,
                "correctness": correctness, "re_evaluated": True,
            },
        )
    except Exception:
        pass

    response["response"]["genome_used"] = genome
    return response


def main() -> None:
    raw = sys.stdin.buffer.read()
    response = handle(raw)
    sys.stdout.write(json.dumps(response) + "\n")
    sys.stdout.flush()
