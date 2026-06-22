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

PAIRS_PER_RUNNER = 20

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
        # 20 matching lines: max_results truncates to 1-10 → different totalMatches + tool_calls
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
        # Generate two independently-random genomes so their decoded params
        # actually differ. (Step-based mutate only nudges params by ±1..±4 in
        # the natural-range space, so a mutated pair often decodes identically.)
        genome_a = random_genome(rng, id_tag)
        genome_b = random_genome(rng, id_tag)

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
    """Run the full sensitivity audit against all single-slot Martians.

    Packet 16: iterates over single-slot Martians from the MartianRegistry
    instead of raw TOOL_REGISTRY entries. Bare tool names (e.g. "compute")
    still resolve via the registry's _alone aliases, so the audit reports
    use the same martian_type strings as before for stability.
    """
    from alienclaw.brains.registry import BrainRegistry
    from alienclaw.martians.registry import MartianRegistry

    brain_registry = BrainRegistry.load("seed/msb/")
    martian_registry = MartianRegistry.load("seed/martians/", brain_registry)
    # Audit only single-slot Martians; report under their bare tool name
    # (compute_alone -> compute) for parity with prior audit reports.
    single_slot_types: list[str] = []
    for spec in martian_registry.all():
        if len(spec.slots) != 1:
            continue
        name = spec.martian_type
        if name.endswith("_alone"):
            name = name[: -len("_alone")]
        single_slot_types.append(name)

    rng = random.Random(seed)

    # Serve 15 results so web_search max_results (1-10) actually truncates
    _search_results = [
        {"title": f"AlienClaw result {i}", "href": f"https://example.com/{i}", "body": f"Result {i} for alienclaw query"}
        for i in range(1, 16)
    ]
    import json as _json
    # 12-line text response so url_fetch content_preview (1-10) produces 10 distinct previews
    _multiline_body = "\n".join(
        f"L{i:02d}: audit stub data chunk {i:02d}" for i in range(1, 13)
    ).encode()
    canned = {
        "/test": (200, _multiline_body, "text/plain"),
        "/search": (200, _json.dumps(_search_results).encode(), "application/json"),
    }

    with StubServer(canned) as stub_url:
        # Point web_search at stub so max_results has something to truncate
        os.environ["ALIENCLAW_SEARCH_URL"] = stub_url + "/search"
        with tempfile.TemporaryDirectory(prefix="alienclaw-diag-") as tmpdir_str:
            tmpdir = Path(tmpdir_str)
            sensitivities = []
            for martian_type in sorted(single_slot_types):
                # Each runner gets its own sub-RNG seeded from main RNG.
                # This isolates runners from each other — changing PAIRS_PER_RUNNER
                # does not affect the genome pairs generated for other runners.
                runner_rng = random.Random(rng.randint(0, 2**32))
                result = _audit_runner(martian_type, runner_rng, stub_url, tmpdir)
                sensitivities.append(result)

    os.environ.pop("ALIENCLAW_DIAGNOSTICS", None)
    os.environ.pop("ALIENCLAW_SEARCH_URL", None)
    return AuditResults(
        seed=seed,
        runners_audited=sorted(single_slot_types),
        sensitivities=sensitivities,
    )


# ---------------------------------------------------------------------------
# Packet 19: Martian-composition-level audit
# ---------------------------------------------------------------------------


@dataclass
class MartianAuditResults:
    """Results of the composition Martian audit (Packet 19)."""
    seed: int
    martians_audited: list[str]
    sensitivities: list[RunnerSensitivity]

    def to_dict(self) -> dict:
        return {
            "seed": self.seed,
            "martians_audited": self.martians_audited,
            "sensitivities": [
                {
                    "martian_type": s.martian_type,
                    "pairs_tested": s.pairs_tested,
                    "pairs_output_differ": s.pairs_output_differ,
                    "pairs_correctness_differ": s.pairs_correctness_differ,
                    "pairs_tool_calls_differ": s.pairs_tool_calls_differ,
                    "pairs_fitness_differ": s.pairs_fitness_differ,
                    "output_sensitivity": round(s.output_sensitivity, 4),
                    "correctness_sensitivity": round(s.correctness_sensitivity, 4),
                    "tool_calls_sensitivity": round(s.tool_calls_sensitivity, 4),
                    "fitness_sensitivity": round(s.fitness_sensitivity, 4),
                    "classification": s.classification,
                    "genome_ever_passed_to_runner": s.genome_ever_passed_to_runner,
                }
                for s in self.sensitivities
            ],
        }


def _audit_composition_martian(
    martian_type: str,
    rng: random.Random,
    stub_base_url: str,
    tmpdir: Path,
    pairs_per_martian: int,
) -> RunnerSensitivity:
    """Audit one composition Martian. Same paired-comparison methodology as _audit_runner.

    The overall classification equals fitness_sensitivity's classification
    (Packet 20 fitness-headline rule). All four per-metric sensitivities
    remain in the report as supporting detail. Reasoning: fitness is what
    selection optimizes; the headline should reflect what evolution sees.
    """
    from alienclaw.diagnostics.martian_stub_generator import get_composition_inputs

    os.environ["ALIENCLAW_DIAGNOSTICS"] = "1"
    id_tag = _id_tag_for(martian_type)
    inputs = get_composition_inputs(martian_type, stub_base_url, tmpdir)

    traces: list[PairTrace] = []
    pairs_output = pairs_correctness = pairs_tool_calls = pairs_fitness = 0
    genome_ever_passed = False

    for _ in range(pairs_per_martian):
        genome_a = random_genome(rng, id_tag)
        genome_b = random_genome(rng, id_tag)

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
        tc_diff = ta.tool_calls != tb.tool_calls
        fit_diff = abs(ta.fitness - tb.fitness) > 1e-9

        if out_diff:
            pairs_output += 1
        if cor_diff:
            pairs_correctness += 1
        if tc_diff:
            pairs_tool_calls += 1
        if fit_diff:
            pairs_fitness += 1

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

    n = pairs_per_martian
    output_sens = pairs_output / n
    correctness_sens = pairs_correctness / n
    tool_calls_sens = pairs_tool_calls / n
    fitness_sens = pairs_fitness / n

    return RunnerSensitivity(
        martian_type=martian_type,
        pairs_tested=n,
        pairs_output_differ=pairs_output,
        pairs_correctness_differ=pairs_correctness,
        pairs_tool_calls_differ=pairs_tool_calls,
        pairs_fitness_differ=pairs_fitness,
        output_sensitivity=output_sens,
        correctness_sensitivity=correctness_sens,
        tool_calls_sensitivity=tool_calls_sens,
        fitness_sensitivity=fitness_sens,
        genome_ever_passed_to_runner=genome_ever_passed,
        classification=_classify(fitness_sens),  # fitness-headline per Packet 20
        traces=traces,
    )


def run_martian_audit(seed: int = 42, pairs_per_martian: int = 20) -> MartianAuditResults:
    """Run sensitivity audit on all composition Martians.

    Uses the same paired-comparison methodology as run_audit (Packet 8.5),
    but targets composition Martians (martian_type does not end in '_alone').
    Campaign inputs come from martian_stub_generator.get_composition_inputs.

    Each Martian's headline classification equals its fitness_sensitivity
    classification (Packet 20). All four metrics remain in the result.
    """
    from alienclaw.brains.registry import BrainRegistry
    from alienclaw.martians.registry import MartianRegistry

    brain_registry = BrainRegistry.load("seed/msb/")
    martian_registry = MartianRegistry.load("seed/martians/", brain_registry)

    composition_martians = [
        m.martian_type for m in martian_registry.all()
        if not m.martian_type.endswith("_alone")
    ]

    rng = random.Random(seed)

    _search_results = [
        {"title": f"Result {i}", "href": f"https://example.com/{i}", "body": f"Body {i}"}
        for i in range(1, 16)
    ]
    _json_body = json.dumps(
        {"title": "audit test", "value": 42, "score": 99}
    ).encode()
    _multiline_body = "\n".join(
        f"L{i:02d}: audit stub data chunk {i:02d}" for i in range(1, 13)
    ).encode()

    canned = {
        "/test":   (200, _multiline_body, "text/plain"),
        "/search": (200, json.dumps(_search_results).encode(), "application/json"),
        "/json":   (200, _json_body, "application/json"),
    }

    sensitivities: list[RunnerSensitivity] = []
    with StubServer(canned) as stub_url:
        os.environ["ALIENCLAW_SEARCH_URL"] = stub_url + "/search"
        with tempfile.TemporaryDirectory(prefix="alienclaw-p19-") as tmpdir_str:
            tmpdir = Path(tmpdir_str)
            for martian_type in sorted(composition_martians):
                runner_rng = random.Random(rng.randint(0, 2**32))
                result = _audit_composition_martian(
                    martian_type, runner_rng, stub_url, tmpdir, pairs_per_martian
                )
                sensitivities.append(result)

    os.environ.pop("ALIENCLAW_DIAGNOSTICS", None)
    os.environ.pop("ALIENCLAW_SEARCH_URL", None)
    return MartianAuditResults(
        seed=seed,
        martians_audited=sorted(composition_martians),
        sensitivities=sensitivities,
    )
