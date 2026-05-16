---
task: packet 28 ship option c-prime fitness formula production
slug: 20260510-030000_packet-28-ship-c-prime
effort: advanced
phase: execute
progress: 0/40
mode: interactive
started: 2026-05-10T03:00:00Z
updated: 2026-05-10T03:30:00Z
---

## Context

Ships Option C-prime (α=0.1) as canonical fitness formula. Three surgical edits +
test updates + 16-Martian regression + Packet-25 re-run + ARCHITECTURE.md amendment.

New formula: `fitness = correctness × 1/(1 + 0.1 × max(0, tool_calls - slot_count))`

## Criteria

### Pre-flight
- [ ] ISC-1: `packet-28-starting-commit.txt` written
- [ ] ISC-2: Pre-28 baseline ≥821 pytest, tsc exits 0

### fitness/types.py
- [ ] ISC-3: `slot_count: int = 1` added to FitnessInputs (default=1, backward-compat)

### fitness/function.py
- [ ] ISC-4: New formula with α=0.1 hardcoded
- [ ] ISC-5: `formula_version = "v2.0"`
- [ ] ISC-6: error path still returns 0 fitness

### bridge/server.py
- [ ] ISC-7: FitnessInputs call adds `slot_count=len(martian_spec.slots)`

### Tests — update old assertions
- [ ] ISC-8: `test_fitness_formula_correctness_times_efficiency` updated to new value
- [ ] ISC-9: `test_formula_version_is_v1` updated to "v2.0"
- [ ] ISC-10: All existing tests pass with new formula

### Tests — new properties
- [ ] ISC-11: `test_new_formula_no_excess_equals_correctness` — perfect k-slot → fitness=correctness
- [ ] ISC-12: `test_new_formula_excess_penalty` — 1 excess → correctness/1.1
- [ ] ISC-13: `test_new_formula_no_ceiling` — 8-slot perfect → fitness=1.0
- [ ] ISC-14: `test_new_formula_fitness_bounds` — randomized inputs always in [0,1]
- [ ] ISC-15: `test_new_formula_error_zero` — error → fitness=0

### Design doc
- [ ] ISC-16: `packet-28-fitness-formula-change.md` written

### Regression validation (16 Martians, fast)
- [ ] ISC-17: Single-slot Martians reach final fitness ≥0.9
- [ ] ISC-18: Composition Martians exceed 0.5 old ceiling
- [ ] ISC-19: `packet-28-regression-results.md` written

### Packet 25 re-run (background)
- [ ] ISC-20: compute_alone re-run (5 seeds × 500 gens)
- [ ] ISC-21: search_text_alone re-run
- [ ] ISC-22: compute_then_validate re-run
- [ ] ISC-23: search_then_count re-run
- [ ] ISC-24: fetch_then_parse re-run
- [ ] ISC-25: `packet-28-packet25-rerun-comparison.md` written

### ARCHITECTURE.md
- [ ] ISC-26: Fitness formula section updated with new formula + annotation

### Final reports and verification
- [ ] ISC-27: `packet-28-verdict.md` written
- [ ] ISC-28: `packet-28-report.md` written
- [ ] ISC-29: `packet-28-bugs.md` written
- [ ] ISC-30: `packet-28-deferred.md` written
- [ ] ISC-31: `packet-28-defaults.md` written
- [ ] ISC-32: `docs/LESSONS_FROM_THE_ARC.md` updated
- [ ] ISC-33: Post-28 pytest ≥821 passed
- [ ] ISC-34: `npm run typecheck` exits 0

### Anti-criteria
- [ ] ISC-A1: No .martian or .msb files modified
- [ ] ISC-A2: Locked baseline subsystems unchanged
- [ ] ISC-A3: α NOT configurable (hardcoded 0.1)
- [ ] ISC-A4: Packet 25 raw data NOT modified

## Decisions

- slot_count defaults to 1 for backward-compat
- formula_version bumped to v2.0
- Packet 25 re-run background; regression validation foreground first

## Verification
