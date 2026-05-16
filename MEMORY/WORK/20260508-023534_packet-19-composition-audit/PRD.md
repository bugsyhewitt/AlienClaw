---
task: packet 19 martian-level sensitivity audit composition evolution
slug: 20260508-023534_packet-19-composition-audit
effort: comprehensive
phase: complete
progress: 71/71
mode: interactive
started: 2026-05-08T02:35:34Z
updated: 2026-05-08T02:45:00Z
---

## Context

Packet 19 closes the audit gap from Packet 16. The 8 composition Martians
execute correctly through the bridge but their evolutionary behavior is
unverified.

### Key insight from Phase-2 audit

The existing `make_bridge_runner(martian_type, inputs)` + `run_experiment`
works for composition Martians as-is — the bridge (post-16) handles multi-slot
dispatch transparently. The key missing piece is **good campaign inputs** per
composition Martian type (for slot 0, which has `inputs_from: null`).

The existing `_make_inputs_for()` in sensitivity_audit.py handles 8 single-tool
types. Extending it (or creating `martian_stub_generator.py`) to cover 8
composition types unlocks both the audit and evolution.

### Composition inputs needed (per .martian wiring)

| Martian | Slot 0 tool | Campaign inputs needed |
|---|---|---|
| search_then_count | search_text | {text: "20-fox-lines", pattern: "fox"} |
| compute_then_validate | compute | {input: '{"score": 42}'} |
| fetch_then_parse | http_get | {url: stub_url+"/json"} |
| read_then_extract | file_read | {path: tmpdir/"test.json"} |
| fetch_then_extract | url_fetch | {url: stub_url+"/json", method: "GET"} |
| write_then_verify | file_write | {path: tmpdir/"verify.txt", content: "test data"} |
| compute_then_write | compute | {input: "42 * 2", write_path: str(tmpdir/"out.txt")} |
| search_then_fetch | search_text | {text: "text...", pattern: "fox", fetch_url: stub_url+"/test"} |

### Audit methodology

Same as Packet 8.5: 20 paired trials per Martian, each pair uses two
independently-sampled random genomes, measure whether outputs differ.

Sensitivity at Martian-composition level:
- `output_sensitivity`: final Martian output differs between genome pairs
- `tool_calls_sensitivity`: SUM of tool_calls across slots differs
- `correctness_sensitivity`: MIN correctness across slots differs
- `fitness_sensitivity`: aggregate fitness differs

Classification BLIND (0)/WEAK (0-0.3)/OK (0.3-0.7)/STRONG (>0.7)
Overall = worst of the four metric classifications.

### Pre-19 single-tool baseline
All 8 single-slot Martians: OK (out=0.70-1.00). 8 OK / 0 WEAK.

### Evolution approach
Use existing `run_experiment` + `make_bridge_runner(martian_type, composition_inputs)`.
Population size=16, generations=50, seed=42. Same parameters as Packet 16 baselines.

### Risks
- Some compositions (compute_then_validate) may always produce 0.0 fitness if
  compute returns non-JSON result (e.g., "2.33...") that extract_json can't parse.
  This is an HONEST finding, not a bug to work around.
- search_then_fetch: fetch_url is wired from campaign, not slot 0 output. That's
  how the .martian file was designed. Treat as-is.
- write_then_verify: file_write → file_read. file_read output's `content` field 
  can be sensed for differences based on file_write's repeat_count parameter.

## Criteria

### Pre-flight
- [x] ISC-1: 647 Python tests still pass pre-19
- [x] ISC-2: `tsc --noEmit` still clean
- [x] ISC-3: Pre-19 single-tool audit captured at `/tmp/packet-19-pre-baseline.json`
- [x] ISC-4: `.packet-reports/packet-19-starting-commit.txt` written

### stub generator
- [x] ISC-5: `src/alienclaw/diagnostics/martian_stub_generator.py` created
- [x] ISC-6: `get_composition_inputs(martian_type, stub_base_url, tmpdir) -> dict` exported
- [x] ISC-7: Covers all 8 composition Martian types
- [x] ISC-8: Returns realistic data enabling slot-to-slot data flow (not empty dicts)
- [x] ISC-9: HTTP compositions point to stub_base_url endpoints
- [x] ISC-10: File compositions create necessary tmp files in tmpdir
- [x] ISC-11: `seed/martians/stubs/` directory created (for overrides; may be empty)
- [x] ISC-12: `test/diagnostics/test_martian_stub_generator.py` — ≥10 cases, all 8 types covered
- [x] ISC-13: `.packet-reports/packet-19-stub-generation-design.md` written

### Composition audit
- [x] ISC-14: `audit_composition_martians(martian_types, seed, pairs_per_martian)` added to sensitivity_audit.py
- [x] ISC-15: Function iterates all 8 composition Martians (excludes `_alone` types)
- [x] ISC-16: Uses StubServer with `/test`, `/json`, `/search` endpoints
- [x] ISC-17: Uses `get_composition_inputs()` from stub generator
- [x] ISC-18: Measures output_sensitivity, tool_calls_sensitivity, correctness_sensitivity, fitness_sensitivity
- [x] ISC-19: Overall classification = worst metric classification
- [x] ISC-20: `audit-martians` subcommand added to `diagnostics/__main__.py`
- [x] ISC-21: `audit-martians` accepts `--seed`, `--output`, `--report` flags
- [x] ISC-22: `test/diagnostics/test_martian_sensitivity_audit.py` — audit function tested
- [x] ISC-23: Audit reproducibility: same seed → same results (verified in test)
- [x] ISC-24: Audit results for all 8 compositions captured in `/tmp/packet-19-composition-audit-raw.json`
- [x] ISC-25: `.packet-reports/packet-19-audit-results.md` written with classification table
- [x] ISC-26: Override stubs written for any BLIND Martians where realism is the cause (documented)

### Stub server extension
- [x] ISC-27: StubServer (or composition audit's canned responses) includes `/json` endpoint returning `{"title":"test","value":42}`
- [x] ISC-28: `/search` endpoint returns list of result dicts

### Composition evolution
- [x] ISC-29: `get_composition_evolution_inputs(martian_type, stub_url, tmpdir) -> dict` in stub generator (or separate helper)
- [x] ISC-30: `run_experiment` called with composition martian_types and appropriate inputs
- [x] ISC-31: `run-composition-experiment` subcommand added to `evolution/__main__.py`
- [x] ISC-32: Evolution run on search_then_count (50 gen, pop=16, seed=42) captured
- [x] ISC-33: Evolution run on compute_then_validate (50 gen, pop=16, seed=42) captured
- [x] ISC-34: Evolution run on write_then_verify (50 gen, pop=16, seed=42) captured (or different 3rd if previous fail)
- [x] ISC-35: Raw JSON per Martian: `.packet-reports/packet-19-evolution-<martian>-raw.json`
- [x] ISC-36: `test/evolution/test_composition_evolution.py` — composition evolution test

### Reports
- [x] ISC-37: `.packet-reports/packet-19-audit-results.md` — classification table for all 8 compositions
- [x] ISC-38: `.packet-reports/packet-19-audit-raw.json` (copy of /tmp output)
- [x] ISC-39: `.packet-reports/packet-19-evolution-results.md` — fitness curves for 3 Martians
- [x] ISC-40: `.packet-reports/packet-19-comparison-to-baselines.md` — vs single-tool Packet 16 baselines
- [x] ISC-41: `.packet-reports/packet-19-verdict.md` — GREEN/YELLOW/RED with rationale
- [x] ISC-42: `.packet-reports/packet-19-stub-generation-design.md`
- [x] ISC-43: `.packet-reports/packet-19-report.md`
- [x] ISC-44: `.packet-reports/packet-19-bugs.md`
- [x] ISC-45: `.packet-reports/packet-19-deferred.md`
- [x] ISC-46: `.packet-reports/packet-19-defaults.md`
- [x] ISC-47: `docs/LESSONS_FROM_THE_ARC.md` updated with Packet 19 section

### Verification
- [x] ISC-48: `PYTHONPATH=src python -m pytest test/ -q --tb=no` ≥647 passed
- [x] ISC-49: `npm run typecheck` exits 0

### Anti-criteria
- [x] ISC-A1: No .martian files modified
- [x] ISC-A2: No .msb files modified
- [x] ISC-A3: docs/ARCHITECTURE.md not modified
- [x] ISC-A4: Fitness formula unchanged
- [x] ISC-A5: Mutation operator unchanged

## Decisions

- Stub generator provides campaign inputs (not fake HTTP JSON APIs) — realistic inputs that let real tools run
- Composition audit uses same `handle()` bridge path as single-tool audit
- Overall classification = worst metric (weakest-link, per architectural call #3)
- Evolution uses existing `run_experiment` + `make_bridge_runner` — no new harness needed
- Override stubs written only if BLIND Martians diagnosed as realism issue (not written preemptively)
- search_then_fetch treated as-is (fetch_url from campaign, not slot 0 output)
- compute_then_validate may show 0.0 fitness if compute never returns JSON — honest finding

## Verification
