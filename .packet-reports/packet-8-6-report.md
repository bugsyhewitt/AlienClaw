# Packet 8.6 Report — Genome → Behavior Wiring

**Started from:** commit a0452b1e (packet-08-5 report artifacts)  
**Completed:** 2026-05-06  
**Commits in packet:** 4

---

## Phases completed

| Phase | Deliverable | Commit |
| --- | --- | --- |
| Fix | Commit missed server.py instrumentation from Packet 8.5 | `4a29a1ea` |
| A | parameter_schema in all 8 MSB files + Python/TS parser | `22703e93` |
| B+C | decoder + runner wiring + test updates | `734dfe94` |

Phase D (graded correctness) deferred to Packet 8.7. Not needed to satisfy success criteria.

---

## Success criteria

| Criterion | Result |
| --- | --- |
| ≥3 runners show output_sensitivity > 0.2 | **✓ 4 runners** (file_read=0.80, compute=0.40, search_text=0.30, url_fetch=0.30) |
| ≥1 runner shows tool_calls_sensitivity > 0.0 | **✓ search_text = 0.30** |
| Evolution loop shows non-flat fitness | **✓ search_text: 0.0 → 0.528 → 0.872 → 1.0 in 3 generations** |

---

## New files

- `src/alienclaw/brains/decoder.py` — `decode_params(brain, genome)` function
- `.packet-reports/packet-8-6-msb-changes.md` — before/after audit for all 8 MSB edits
- `.packet-reports/packet-8-6-audit-progression.md` — sensitivity at each phase
- `.packet-reports/packet-8-6-runner-design.md` — Phase D.1 design doc (for 8.7)

**Modified:**
- `src/alienclaw/brains/types.py` — ParameterSchemaField + BrainSpec.parameter_schema
- `src/alienclaw/brains/parser.py` — _extract_parameter_schema()
- `src/alienclaw/msb/msb-types.ts` — ParameterSchemaField type, MartianBrain.parameterSchema
- `src/alienclaw/msb/msb-loader.ts` — extractParameterSchema()
- `seed/msb/*.msb` — all 8 files: PARAMETER_SCHEMA sections added
- `src/alienclaw/bridge/server.py` — calls decode_params(), passes params to runner
- All 8 `src/alienclaw/bridge/runners/*.py` — now accept `params` dict
- `src/alienclaw/diagnostics/sensitivity_audit.py` — updated inputs for params
- `test/diagnostics/test_instrumentation.py` — updated to reflect fixed state
- `test/diagnostics/test_sensitivity_audit.py` — updated to reflect fixed state
- `docs/LESSONS_FROM_THE_ARC.md` — Packet 8.6 results appended

---

## Packet 10 readiness verdict: YELLOW

**Green path**: ≥3 runners show sensitivity > 0.6 (OK classification); evolution loop
produces directional improvement across multiple runners; graded correctness wired.

**Current state**: 1 runner OK (file_read, 0.80), 3 runners WEAK, 4 runners BLIND.
Evolution loop produces directed improvement on search_text (converges in 3 gens).

**Blocking gaps**: 4 runners still BLIND (graded correctness, better bool encoding,
network runner stub). These land in Packet 8.7.

**Recommendation**: Packet 10 can begin development now. The leaderboard will have
meaningful signal on file_read and search_text Martian types. Packet 8.7 addresses
the remaining runners while Packet 10 ships. This is YELLOW, not RED.

---

## Test counts

| Suite | Tests | Status |
| --- | --- | --- |
| All Python | 385 | all pass |
| All TypeScript | 251 | all pass |
| Evolution convergence (search_text) | confirmed empirically | ✓ |
