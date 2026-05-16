---
task: packet 20 pre-launch hygiene revision audit metric refinement
slug: 20260508-033036_packet-20-hygiene
effort: advanced
phase: complete
progress: 32/32
mode: interactive
started: 2026-05-08T03:30:36Z
updated: 2026-05-08T03:45:00Z
---

## Context

Packet 20 closes the post-correction arc with two coupled deliverables:
1. Verify Packet 12's three hygiene pieces against the post-correction codebase
2. Refine the composition audit headline classification from worst-metric to fitness-headline

### Phase-2 findings (pre-work)

**All 30 Packet 12 tests pass without any changes.** No hygiene drift:
- `rate_limit.py`: `RateLimiter.check()` API intact, persistence tests pass
- `audit_log.py`: already uses `martian_type` field (no `tool_name` drift), all tests pass
- `web_search.py`: at correct post-Packet-14 location, all tests pass

### Audit metric refinement

Current composition audit classification (from sensitivity_audit.py):
```python
worst_sens = min(output_sens, pairs_correctness/n, pairs_tool_calls/n, pairs_fitness/n)
classification=_classify(worst_sens)
```

Change to: `classification = _classify(fitness_sensitivity)` — because fitness is what
selection actually optimizes. The four per-metric numbers stay in the report.

Packet 19 raw audit data (`packet-19-audit-raw.json`) already has all four sensitivities.
The re-classification is pure post-processing (no re-measurement needed):

| Martian | cor | fit | Pre-20 | Post-20 |
|---|---|---|---|---|
| compute_then_validate | 0.00 | 0.65 | BLIND → | **OK** |
| compute_then_write | 0.00 | 0.80 | BLIND → | **OK** |
| search_then_count | 0.00 | 0.85 | BLIND → | **OK** |
| search_then_fetch | 0.00 | 0.85 | BLIND → | **OK** |
| fetch_then_extract | 0.40 | 0.85 | WEAK → | **OK** |
| fetch_then_parse | 0.40 | 0.70 | WEAK → | **OK** |
| read_then_extract | 0.15 | 0.25 | BLIND → | **WEAK** |
| write_then_verify | 0.70 | 0.70 | OK stays | **OK** |

Post-20: **7 OK / 1 WEAK / 0 BLIND**. Verdict: **GREEN**.

`read_then_extract` remains the one genuine gap (fitness=0.25 → WEAK); deferred
to future research packet per packet-20-defaults.md.

### Pre-19 single-tool audit context
All 8 single-slot Martians: OK (the single-tool audit uses `_classify(output_sens)`,
not worst-metric — no change needed there).

## Criteria

### Pre-launch hygiene
- [x] ISC-1: Rate limiter tests pass (30 total, including Packet 12 pieces)
- [x] ISC-2: Audit log tests pass
- [x] ISC-3: Web search backend tests pass
- [x] ISC-4: `packet-20-pre-launch-audit.md` written with verified/patched status

### Audit classification refinement
- [x] ISC-5: `_audit_composition_martian()` classification changes from `_classify(worst_sens)` to `_classify(fitness_sensitivity)`
- [x] ISC-6: Single-tool `_audit_runner()` classification unchanged (still `_classify(output_sens)`)
- [x] ISC-7: `_classify_overall()` helper (if exists) updated or removed
- [x] ISC-8: `test_martian_sensitivity_audit.py` — classification tests updated for new rule
- [x] ISC-9: `test_martian_sensitivity_audit.py` — test_classification_is_fitness_headline passes
- [x] ISC-10: `test_martian_sensitivity_audit.py` — test for BLIND fitness case passes

### Refined audit report
- [x] ISC-11: `packet-20-audit-classification-refined.md` written with before/after table
- [x] ISC-12: Post-20 classification: 7 OK / 1 WEAK / 0 BLIND (verified from raw data)
- [x] ISC-13: `read_then_extract` correctly classified as WEAK (fitness=0.25 is in (0.2,0.6])
- [x] ISC-14: Report notes the 4 Martians reclassified from BLIND→OK

### LESSONS update
- [x] ISC-15: `docs/LESSONS_FROM_THE_ARC.md` Packet 20 section appended
- [x] ISC-16: Packet 19 verdict noted as GREEN under refined aggregation

### Verification
- [x] ISC-17: `PYTHONPATH=src python -m pytest test/ -q --tb=no` ≥666 passed
- [x] ISC-18: `npm run typecheck` exits 0

### Reports
- [x] ISC-19: `.packet-reports/packet-20-pre-launch-audit.md`
- [x] ISC-20: `.packet-reports/packet-20-audit-classification-refined.md`
- [x] ISC-21: `.packet-reports/packet-20-report.md`
- [x] ISC-22: `.packet-reports/packet-20-bugs.md`
- [x] ISC-23: `.packet-reports/packet-20-deferred.md` (with read_then_extract structure)
- [x] ISC-24: `.packet-reports/packet-20-defaults.md`

### Anti-criteria
- [x] ISC-A1: No .martian or .msb files modified
- [x] ISC-A2: docs/ARCHITECTURE.md not modified
- [x] ISC-A3: No genome/bridge/evolution/governance code modified
- [x] ISC-A4: Packet 19 raw audit data (packet-19-audit-raw.json) unchanged
- [x] ISC-A5: Single-tool audit classification unchanged (still output_sens)

## Decisions

- Hygiene: all three Packet 12 pieces are clean — document as verified, no changes
- Classification change: `_classify(worst_sens)` → `_classify(fitness_sensitivity)` in composition audit only
- read_then_extract: genuine WEAK finding (fitness=0.25), deferred to future research packet
- No re-running Packet 19 measurements — raw data is sufficient for reclassification

## Verification
