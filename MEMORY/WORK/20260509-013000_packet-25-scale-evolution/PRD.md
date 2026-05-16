---
task: packet 25 larger scale evolution experiments research
slug: 20260509-013000_packet-25-scale-evolution
effort: comprehensive
phase: complete
progress: 81/81
mode: interactive
started: 2026-05-09T01:30:00Z
updated: 2026-05-09T21:00:00Z
---

## Context

Scale evolution experiments: population=100, generations=500, 5 Martians × 5 seeds.
Total: 25 experiments, ~2.5 hours wall-clock.

### Design decisions

- `search_then_extract` substituted with `search_then_count` (former doesn't exist)
- `fetch_then_parse` uses StubServer context for HTTP requests
- Bridge is in-process Python (not subprocess) → actual runtime ~2.5h vs 17h estimate
- ALIENCLAW_POPULATIONS_ROOT env override for population isolation per seed

### Key research findings

1. **Single-tool Martians converge to fitness=1.0**: compute_alone by gen 2,
   search_text_alone by gen 5 (all 5 seeds, near-zero variance)
2. **Composition Martians plateau at fitness=0.500**: all 3 compositions stable at
   0.500 from gen ~100 through gen 500, zero seed variance. Structural ceiling.
3. **Storage I/O is dominant bottleneck**: append-only model creates ~100K files per
   (martian, seed). Storage = 88% of wall-clock. Concrete infrastructure finding.
4. **No monoculture in 500 gens**: Hamming decreases (229→69-143) but diversity maintained.

## Criteria

### Infrastructure — diversity_tracker.py
- [x] ISC-1: `src/alienclaw/diagnostics/diversity_tracker.py` created
- [x] ISC-2: `hamming_distance(a, b) -> int` defined and correct
- [x] ISC-3: `hamming_distance` raises ValueError on length mismatch
- [x] ISC-4: `population_diversity(genomes) -> dict` defined
- [x] ISC-5: returns `n`, `unique_genomes` fields
- [x] ISC-6: returns `mean_pairwise_hamming` (float)
- [x] ISC-7: returns `min_pairwise_hamming`, `max_pairwise_hamming`
- [x] ISC-8: returns `monoculture: bool`
- [x] ISC-9: `test/diagnostics/test_diversity_tracker.py` with ≥10 test cases

### Infrastructure — plateau_detector.py
- [x] ISC-10: `src/alienclaw/diagnostics/plateau_detector.py` created
- [x] ISC-11: `detect_plateaus(curve, window_size=20, threshold=0.01) -> list[dict]` defined
- [x] ISC-12: Each plateau dict has required keys
- [x] ISC-13: `time_to_convergence(curve, ...) -> int | None` defined
- [x] ISC-14: Monotonically increasing curve → minimal plateaus
- [x] ISC-15: Flat curve → one plateau, escaped=False
- [x] ISC-16: Step-wise curve → multiple plateaus
- [x] ISC-17: `time_to_convergence` returns None when fitness never reaches threshold
- [x] ISC-18: `time_to_convergence` returns first stable generation when reached
- [x] ISC-19: `test/diagnostics/test_plateau_detector.py` with ≥10 test cases

### Infrastructure — scale_experiment.py
- [x] ISC-20: `src/alienclaw/evolution/scale_experiment.py` created
- [x] ISC-21: `run_scale_experiment(...)` defined
- [x] ISC-22: Fresh population per seed via env override
- [x] ISC-23: on_generation hook captures fitness + diversity + elapsed_ms
- [x] ISC-24: Outputs `seed_{seed}.json` per seed
- [x] ISC-25: JSON schema has required top-level fields
- [x] ISC-26: Per-generation entries have all required fields
- [x] ISC-27: `test/evolution/test_scale_experiment.py` ≥5 cases

### Infrastructure — CLI extension
- [x] ISC-28: `run-scale-experiment` subcommand in `evolution/__main__.py`
- [x] ISC-29: Accepts required arguments
- [x] ISC-30: CLI calls `run_scale_experiment` correctly
- [x] ISC-31: `--seeds` parses comma-separated int list

### Instrumentation design
- [x] ISC-32: `packet-25-instrumentation-design.md` written

### Tests and coverage
- [x] ISC-33: All new Python tests pass
- [x] ISC-34: diversity_tracker tests pass (10 cases)
- [x] ISC-35: plateau_detector tests pass (10+ cases)
- [x] ISC-36: scale_experiment tests pass (5 cases)

### Pre-flight
- [x] ISC-37: `packet-25-starting-commit.txt` written
- [x] ISC-38: Baseline ≥668 pytest + tsc exits 0

### Pilot
- [x] ISC-39: Pilot: compute_alone, pop=100, gens=50, seed=42
- [x] ISC-40: Pilot output is valid JSON
- [x] ISC-41: Pilot per_generation has 50 entries
- [x] ISC-42: Each pilot entry has all required fields

### Experiments — compute_alone
- [x] ISC-43–47: All 5 seeds complete and valid

### Experiments — search_text_alone
- [x] ISC-48–52: All 5 seeds complete and valid

### Experiments — compute_then_validate
- [x] ISC-53–57: All 5 seeds complete and valid

### Experiments — search_then_count
- [x] ISC-58–62: All 5 seeds complete and valid

### Experiments — fetch_then_parse
- [x] ISC-63–67: All 5 seeds complete and valid

### Analytical reports
- [x] ISC-68: `packet-25-fitness-curves.md` written
- [x] ISC-69: Cross-Martian comparison included
- [x] ISC-70: `packet-25-diversity-analysis.md` written
- [x] ISC-71: `packet-25-convergence-distribution.md` written
- [x] ISC-72: `packet-25-plateau-analysis.md` written
- [x] ISC-73: `packet-25-cost-analysis.md` written
- [x] ISC-74: `packet-25-verdict.md` written (YELLOW)

### Final verification
- [x] ISC-75: Post-25 pytest ≥705 passed
- [x] ISC-76: tsc exits 0
- [x] ISC-77: LESSONS_FROM_THE_ARC updated
- [x] ISC-78: `packet-25-report.md` written
- [x] ISC-79: `packet-25-bugs.md` written
- [x] ISC-80: `packet-25-deferred.md` written
- [x] ISC-81: `packet-25-defaults.md` written

### Anti-criteria
- [x] ISC-A1: No .martian or .msb files modified
- [x] ISC-A2: docs/ARCHITECTURE.md not modified
- [x] ISC-A3: No genome/bridge/Subagent-core code modified
- [x] ISC-A4: Fitness formula unchanged
- [x] ISC-A5: generation.py, population.py, storage.py, selection.py not modified

## Decisions

- search_then_extract → search_then_count (doesn't exist)
- StubServer for fetch_then_parse
- In-process bridge (much faster than 17h estimate)
- scale_experiment.py drives gen loop directly (not via run_experiment) for pop access
- Verdict: YELLOW (valid findings + infrastructure bottleneck)

## Verification

705 Python tests passed. 402 TypeScript tests passed. tsc exits 0.
25/25 experiments complete. All 6 reports written.
