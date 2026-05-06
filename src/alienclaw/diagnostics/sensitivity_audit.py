"""Sensitivity audit experiment runner.

For each of the 8 tool runners, runs N=10 paired comparisons:
- Generate two different valid genomes (different EXECUTION/BEHAVIOR sections)
- Run both through the bridge with IDENTICAL inputs
- Measure: do outputs, correctness, tool_calls, or fitness differ?

A sensitivity score of 0.0 means the runner is BLIND to genome variation.
This directly confirms or refutes the neutral-evolution finding.

Usage:
    PYTHONPATH=src python3 -m alienclaw.diagnostics audit --seed 42

Or programmatically:
    from alienclaw.diagnostics.sensitivity_audit import run_audit
    results = run_audit(seed=42)
"""
from __future__ import annotations

import json
import os
import random
import tempfile
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

from alienclaw.genome.operators import random_genome, mutate
from alienclaw.diagnostics.instrumentation import CaptureHook
from alienclaw.diagnostics.stub_servers import StubServer
from alienclaw.bridge.server import handle

PAIRS_PER_RUNNER = 10

# Sensitivity classification thresholds
BLIND_THRESHOLD = 0.2   # [0.0, 0.2] → BLIND
WEAK_THRESHOLD  = 0.6   # (0.2, 0.6] → WEAK
# > 0.6 → OK


@dataclass
class PairTrace:
    genome_a: str
    genome_b: str
    inputs: dict[str, Any]
    output_a: dict[str, Any]
    output_b: dict[str, Any]
    correctness_a: float
    correctness_b: float
    tool_calls_a: int
    tool_calls_b: int
    fitness_a: float
    fitness_b: float
    genome_passed_to_runner_a: bool
    genome_passed_to_runner_b: bool
    outputs_differ: bool
    correctness_differs: bool
    tool_calls_differ: bool
    fitness_differs: bool


@dataclass
class RunnerSensitivity:
    martian_type: str
    pairs_tested: int
    pairs_output_differ: int
    pairs_correctness_differ: int
    pairs_tool_calls_differ: int
    pairs_fitness_differ: int
    output_sensitivity: float       # = pairs_output_differ / pairs_tested
    correctness_sensitivity: float
    tool_calls_sensitivity: float
    fitness_sensitivity: float
    genome_ever_passed_to_runner: bool
    classification: str             # BLIND | WEAK | OK
    traces: list[PairTrace] = field(default_factory=list)


@dataclass
class AuditResults:
    seed: int
    runners_audited: list[str]
    sensitivities: list[RunnerSensitivity]

    def to_dict(self) -> dict:
        def _convert(obj: Any) -> Any:
            if isinstance(obj, list):
                return [_convert(i) for i in obj]
            if hasattr(obj, '__dataclass_fields__'):
                return {k: _convert(v) for k, v in asdict(obj).items()}
            return obj
        return _convert(self)

    @classmethod
    def from_dict(cls, d: dict) -> "AuditResults":
        sensitivities = []
        for s in d["sensitivities"]:
            traces = [PairTrace(**t) for t in s.pop("traces", [])]
            sensitivities.append(RunnerSensitivity(**s, traces=traces))
        return cls(
            seed=d["seed"],
            runners_audited=d["runners_audited"],
            sensitivities=sensitivities,
        )


def _id_tag_for(martian_type: str) -> str:
    clean = "".join(c.upper() for c in martian_type if c.isalnum())[:6].ljust(6, "0")
    return clean + "01"


def _make_inputs_for(martian_type: str, stub_base_url: str, tmpdir: Path) -> dict[str, Any]:
    """Return stable test inputs appropriate for each runner type.

    Updated in Packet 8.6 to exercise the new genome-derived params:
    - compute uses float division so precision_digits param changes output
    - file_read uses a 20-line file so max_lines param truncates differently
    - search_text uses a 20-match text so max_results param truncates differently
    """
    m = martian_type
    if m == "compute":
        # Float result: precision_digits affects rounding → different outputs
        return {"input": "7 / 3"}
    if m == "extract_json":
        # include_type param adds/removes the "type" key
        return {"json": '{"name": "Alice", "score": 99}', "path": "name"}
    if m == "file_read":
        # 20-line file: max_lines truncates to 1-10 lines → different outputs
        p = tmpdir / "test_read.txt"
        lines = "\n".join(f"Line {i}: data for file_read audit" for i in range(1, 21))
        p.write_text(lines, encoding="utf-8")
        return {"path": str(p)}
    if m == "file_write":
        # create_parents param affects mkdir behavior
        p = tmpdir / "test_write.txt"
        return {"path": str(p), "content": "audit write test"}
    if m == "http_get":
        # include_headers param adds/removes headers from output
        return {"url": stub_base_url + "/test"}
    if m == "url_fetch":
        # include_headers param adds/removes headers from output
        return {"url": stub_base_url + "/test", "method": "GET"}
    if m == "search_text":
        # 20 matching lines: max_results truncates to 1-10 → different match_count + tool_calls
        text = "\n".join(f"The fox was spotted on line {i}" for i in range(1, 21))
        return {"text": text, "pattern": "fox"}
    if m == "web_search":
        # max_results param limits output; but web_search hits external URL → may fail
        return {"query": "alienclaw genome evolution", "num_results": 5}
    return {}


def _build_request(genome: str, martian_type: str, inputs: dict[str, Any]) -> bytes:
    return json.dumps({
        "bridge_version": "1.0",
        "request_id": "diag-00000000-0000-0000-0000-000000000001",
        "request": {
            "kind": "summon",
            "genome": genome,
            "martian_type": martian_type,
            "inputs": inputs,
            "timeout_ms": 15000,
        },
    }).encode()


def _classify(sensitivity: float) -> str:
    if sensitivity <= BLIND_THRESHOLD:
        return "BLIND"
    if sensitivity <= WEAK_THRESHOLD:
        return "WEAK"
    return "OK"


def _audit_runner(
    martian_type: str,
    rng: random.Random,
    stub_base_url: str,
    tmpdir: Path,
) -> RunnerSensitivity:
    os.environ["ALIENCLAW_DIAGNOSTICS"] = "1"
    id_tag = _id_tag_for(martian_type)
    inputs = _make_inputs_for(martian_type, stub_base_url, tmpdir)
    traces: list[PairTrace] = []

    pairs_output = pairs_correctness = pairs_tool_calls = pairs_fitness = 0
    genome_ever_passed = False

    for _ in range(PAIRS_PER_RUNNER):
        # Generate two different genomes (different EXECUTION+BEHAVIOR sections)
        genome_a = random_genome(rng, id_tag)
        # Mutate with high rate to ensure sections differ
        genome_b = mutate(genome_a, rng, rate=0.5)

        with CaptureHook() as hook_a:
            handle(_build_request(genome_a, martian_type, inputs))
        ta = hook_a.trace()

        with CaptureHook() as hook_b:
            handle(_build_request(genome_b, martian_type, inputs))
        tb = hook_b.trace()

        if ta.genome_passed_to_runner or tb.genome_passed_to_runner:
            genome_ever_passed = True

        out_diff = ta.runner_output != tb.runner_output
        cor_diff = abs(ta.correctness - tb.correctness) > 1e-9
        tc_diff  = ta.tool_calls != tb.tool_calls
        fit_diff = abs(ta.fitness - tb.fitness) > 1e-9

        if out_diff: pairs_output += 1
        if cor_diff: pairs_correctness += 1
        if tc_diff:  pairs_tool_calls += 1
        if fit_diff: pairs_fitness += 1

        traces.append(PairTrace(
            genome_a=genome_a, genome_b=genome_b, inputs=inputs,
            output_a=ta.runner_output, output_b=tb.runner_output,
            correctness_a=ta.correctness, correctness_b=tb.correctness,
            tool_calls_a=ta.tool_calls, tool_calls_b=tb.tool_calls,
            fitness_a=ta.fitness, fitness_b=tb.fitness,
            genome_passed_to_runner_a=ta.genome_passed_to_runner,
            genome_passed_to_runner_b=tb.genome_passed_to_runner,
            outputs_differ=out_diff,
            correctness_differs=cor_diff,
            tool_calls_differ=tc_diff,
            fitness_differs=fit_diff,
        ))

    n = PAIRS_PER_RUNNER
    output_sens = pairs_output / n
    return RunnerSensitivity(
        martian_type=martian_type,
        pairs_tested=n,
        pairs_output_differ=pairs_output,
        pairs_correctness_differ=pairs_correctness,
        pairs_tool_calls_differ=pairs_tool_calls,
        pairs_fitness_differ=pairs_fitness,
        output_sensitivity=output_sens,
        correctness_sensitivity=pairs_correctness / n,
        tool_calls_sensitivity=pairs_tool_calls / n,
        fitness_sensitivity=pairs_fitness / n,
        genome_ever_passed_to_runner=genome_ever_passed,
        classification=_classify(output_sens),
        traces=traces,
    )


def run_audit(seed: int = 42) -> AuditResults:
    """Run the full sensitivity audit against all 8 registered runners."""
    from alienclaw.bridge.runners.registry import RUNNER_REGISTRY
    rng = random.Random(seed)

    canned = {
        "/test": (200, b'{"result": "stub response", "status": "ok"}', "application/json"),
        "/search": (200, b'[{"title":"AlienClaw","href":"https://github.com/AlienTool/AlienClaw","body":"open source"}]', "application/json"),
    }

    with StubServer(canned) as stub_url:
        with tempfile.TemporaryDirectory(prefix="alienclaw-diag-") as tmpdir_str:
            tmpdir = Path(tmpdir_str)
            sensitivities = []
            for martian_type in sorted(RUNNER_REGISTRY.keys()):
                result = _audit_runner(martian_type, rng, stub_url, tmpdir)
                sensitivities.append(result)

    os.environ.pop("ALIENCLAW_DIAGNOSTICS", None)
    return AuditResults(
        seed=seed,
        runners_audited=sorted(RUNNER_REGISTRY.keys()),
        sensitivities=sensitivities,
    )
