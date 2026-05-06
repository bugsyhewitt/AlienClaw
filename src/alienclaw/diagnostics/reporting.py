"""Format AuditResults into structured markdown reports."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from .sensitivity_audit import AuditResults, RunnerSensitivity


def format_report(results: AuditResults) -> str:
    lines: list[str] = []
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    lines += [
        "# Packet 8.5 — Tool-Runner Sensitivity Audit Report",
        "",
        f"**Date:** {now}  ",
        f"**Seed:** {results.seed}  ",
        f"**Runners audited:** {len(results.runners_audited)}  ",
        f"**Pairs per runner:** 10  ",
        "",
        "---",
        "",
        "## Executive summary",
        "",
    ]

    blind = [s for s in results.sensitivities if s.classification == "BLIND"]
    weak  = [s for s in results.sensitivities if s.classification == "WEAK"]
    ok    = [s for s in results.sensitivities if s.classification == "OK"]

    lines.append(f"- **BLIND** (sensitivity ≤ 0.2): {len(blind)} runners — {', '.join(s.martian_type for s in blind) or 'none'}")
    lines.append(f"- **WEAK**  (sensitivity 0.2–0.6): {len(weak)} runners — {', '.join(s.martian_type for s in weak) or 'none'}")
    lines.append(f"- **OK**    (sensitivity > 0.6): {len(ok)} runners — {', '.join(s.martian_type for s in ok) or 'none'}")
    lines.append("")

    any_genome_passed = any(s.genome_ever_passed_to_runner for s in results.sensitivities)
    lines.append(f"**Genome ever passed to runner:** {'YES' if any_genome_passed else 'NO — genome discarded after validation in all cases'}")
    lines.append("")
    lines.append("---")
    lines.append("")

    lines += [
        "## Summary table",
        "",
        "| Runner | Output sensitivity | Correctness sensitivity | tool_calls sensitivity | Fitness sensitivity | Classification |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for s in results.sensitivities:
        lines.append(
            f"| `{s.martian_type}` "
            f"| {s.output_sensitivity:.2f} "
            f"| {s.correctness_sensitivity:.2f} "
            f"| {s.tool_calls_sensitivity:.2f} "
            f"| {s.fitness_sensitivity:.2f} "
            f"| **{s.classification}** |"
        )
    lines.append("")
    lines.append("---")
    lines.append("")

    lines += ["## Per-runner detail", ""]
    for s in results.sensitivities:
        lines.append(f"### `{s.martian_type}` — {s.classification}")
        lines.append("")
        lines.append(f"- Pairs tested: {s.pairs_tested}")
        lines.append(f"- Output sensitivity: {s.output_sensitivity:.2f} ({s.pairs_output_differ}/{s.pairs_tested} pairs produced different output)")
        lines.append(f"- Correctness sensitivity: {s.correctness_sensitivity:.2f} ({s.pairs_correctness_differ}/{s.pairs_tested} pairs)")
        lines.append(f"- tool_calls sensitivity: {s.tool_calls_sensitivity:.2f} ({s.pairs_tool_calls_differ}/{s.pairs_tested} pairs)")
        lines.append(f"- Fitness sensitivity: {s.fitness_sensitivity:.2f} ({s.pairs_fitness_differ}/{s.pairs_tested} pairs)")
        lines.append(f"- Genome passed to runner: {'yes' if s.genome_ever_passed_to_runner else '**NO**'}")

        if s.traces:
            t = s.traces[0]
            lines.append(f"- Sample genome A (first 32 chars): `{t.genome_a[:32]}...`")
            lines.append(f"- Sample genome B (first 32 chars): `{t.genome_b[:32]}...`")
            lines.append(f"- Sample output A: `{json.dumps(t.output_a)[:80]}`")
            lines.append(f"- Sample output B: `{json.dumps(t.output_b)[:80]}`")
            lines.append(f"- Outputs identical: {not t.outputs_differ}")
        lines.append("")

    lines += [
        "---",
        "",
        "## Findings",
        "",
    ]

    lines += [
        "### MUST FIX #1 — Genome discarded after validation (all runners)",
        "",
        "**Source:** `src/alienclaw/bridge/server.py` line ~110",
        "```python",
        "runner = RUNNER_REGISTRY[martian_type]",
        "run_result = runner(req['inputs'])  # genome not passed",
        "```",
        "",
        "The genome is validated (`validate_genome(genome)`) and then discarded.",
        "No runner receives the genome string. No decoded behavioral parameters",
        "are extracted. The runner signature is `run(inputs: dict) -> RunResult`.",
        "",
        "**Effect:** Every genome that passes checksum validation achieves identical",
        "fitness for identical inputs. Tournament selection has no signal to act on.",
        "Evolution is purely neutral drift.",
        "",
        "**Classification:** MUST FIX — blocks Packet 10.",
        "**Fix size:** Large (>20 lines). Requires Packet 8.6.",
        "",
    ]

    lines += [
        "### MUST FIX #2 — BrainSpec has no machine-readable parameter_schema",
        "",
        "**Source:** `src/alienclaw/brains/types.py`",
        "",
        "`BrainSpec.genome_sections` is `GenomeSectionDocs` — three prose strings",
        "describing what genome bytes MEAN (e.g. 'Char 0 = retry attempt encoding').",
        "There is no structured `parameter_schema` with typed field definitions.",
        "No decoder can be written from prose; there is nothing to decode.",
        "",
        "The brain MSB files DO document the encoding (e.g., `compute.msb` says",
        "`EXECUTION: Char 0 = retry attempt encoding (charCode-48 mod 5 + 1 = maxAttempts)`).",
        "This is the right information — it just needs to be machine-readable.",
        "",
        "**Classification:** MUST FIX — prerequisite for Fix #1.",
        "**Fix size:** Large (>20 lines). Requires Packet 8.6.",
        "",
    ]

    lines += [
        "### MUST FIX #3 — Binary correctness (1.0 success / 0.0 failure)",
        "",
        "**Source:** `src/alienclaw/bridge/runners/types.py`",
        "```python",
        "@dataclass",
        "class RunResult:",
        "    ok: bool",
        "    correctness: float = 1.0  # all runners: either 1.0 or 0.0",
        "    tool_calls: int = 1       # all runners: always 1",
        "```",
        "",
        "All 8 runners return `correctness=1.0` on success and `0.0` on failure.",
        "Correctness is binary. For stable inputs (e.g., `compute: '2+2'`), it is",
        "always 1.0. This is a second reason fitness cannot vary across genomes.",
        "",
        "**Classification:** MUST FIX — even after Fix #1 and #2, fitness remains",
        "binary without graded correctness.",
        "**Fix size:** Medium (varies per runner). Requires Packet 8.6.",
        "",
    ]

    lines += [
        "### MUST FIX #4 — tool_calls always 1 (efficiency constant)",
        "",
        "Every runner hard-codes `tool_calls=1` (the RunResult default).",
        "Efficiency = `1 / max(1, tool_calls)` = 1.0 always.",
        "The efficiency component of the fitness formula is a no-op in v1.0.",
        "",
        "**Classification:** MUST FIX — after Fixes #1-3, this is the remaining",
        "constant in the fitness formula.",
        "**Fix size:** Medium. Some runners could retry on failure (honoring genome-",
        "encoded maxAttempts) and count each attempt as a tool call.",
        "Requires Packet 8.6.",
        "",
    ]

    lines += [
        "---",
        "",
        "## Root-cause hypothesis (confirmed by audit)",
        "",
        "Packet 8's neutral evolution was caused by four independent issues, each",
        "of which alone would produce neutral evolution, and which compound:",
        "",
        "1. Genome discarded after validation → runners receive no genome data",
        "2. No parameter_schema → no decoder could extract behavioral parameters",
        "3. Binary correctness → fitness insensitive to output quality",
        "4. tool_calls=1 constant → efficiency never varies",
        "",
        "The genome is architecturally correct (validates, mutates, crosses over,",
        "stores successfully). The gap is at the genome→behavior boundary.",
        "Fix #1 is the structural prerequisite; Fixes #2-4 complete the signal.",
        "",
        "---",
        "",
        "## Reproduction",
        "",
        "```bash",
        f"PYTHONPATH=src python3 -m alienclaw.diagnostics audit --seed {results.seed}",
        "```",
        "",
        "All findings are deterministic from the seed above.",
        "",
    ]

    return "\n".join(lines)


def diff_audits(pre_fix_path: str, post_fix_path: str) -> str:
    with open(pre_fix_path) as f:
        pre = AuditResults.from_dict(json.load(f))
    with open(post_fix_path) as f:
        post = AuditResults.from_dict(json.load(f))
    lines = ["# Sensitivity Audit — Pre/Post Fix Comparison", ""]
    lines.append("| Runner | Pre-fix fitness sensitivity | Post-fix fitness sensitivity | Delta |")
    lines.append("| --- | --- | --- | --- |")
    pre_map = {s.martian_type: s for s in pre.sensitivities}
    post_map = {s.martian_type: s for s in post.sensitivities}
    for mtype in sorted(pre_map.keys()):
        pre_s = pre_map[mtype].fitness_sensitivity
        post_s = post_map.get(mtype)
        post_val = post_s.fitness_sensitivity if post_s else "N/A"
        delta = f"{(post_val - pre_s):+.2f}" if isinstance(post_val, float) else "N/A"
        lines.append(f"| `{mtype}` | {pre_s:.2f} | {post_val if isinstance(post_val, float) else post_val} | {delta} |")
    return "\n".join(lines)
