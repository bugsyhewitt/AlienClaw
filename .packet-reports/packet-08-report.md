# Packet 8 Report — Local Evolution Loop

**Started from:** commit 0dbd49db (chore: packet-07 final report artifacts)  
**Completed:** 2026-05-06  
**Commits in packet:** 8

---

## Phases completed

| Phase | Deliverable | Commit |
| --- | --- | --- |
| 3 | Population types + filesystem storage + Population class | `7ea96f97` |
| 4 | Tournament selection + population statistics | `a4a8d819` |
| 5 | Generational step + experiment driver + CLI | `0e8b6c6d` |
| 6 | Bridge ↔ population wiring + summon-from-population + headline test | `544187a1` |
| 7 | CI integration + leak detection | `0b942a9d` |
| 8 | First AlienClaw experiment results | `3b1d669e` |

---

## New files

**Python — evolution module:**
- `src/alienclaw/evolution/__init__.py`
- `src/alienclaw/evolution/types.py` — PopulationEntry (frozen), GenerationStats (frozen), EvolutionConfig
- `src/alienclaw/evolution/storage.py` — PopulationStorage (flat-file, atomic writes, env var isolation)
- `src/alienclaw/evolution/population.py` — Population public API (create, load, sample, add, top, snapshot)
- `src/alienclaw/evolution/selection.py` — tournament(), roulette_wheel/truncation (stubbed)
- `src/alienclaw/evolution/stats.py` — compute(), compute_from_entries()
- `src/alienclaw/evolution/generation.py` — evaluate_and_evolve() + FitnessReport + RunMartianCallback
- `src/alienclaw/evolution/experiment.py` — run_experiment() returns (pop, all_stats)
- `src/alienclaw/evolution/__main__.py` — CLI: `python3 -m alienclaw.evolution run-experiment`
- `src/alienclaw/evolution/bridge_runner.py` — make_bridge_runner() + bridge_run_martian()

**Python — tests:**
- `test/evolution/__init__.py`
- `test/evolution/test_storage.py` (12 tests)
- `test/evolution/test_population.py` (18 tests)
- `test/evolution/test_selection.py` (8 tests)
- `test/evolution/test_stats.py` (9 tests)
- `test/evolution/test_generation.py` (10 tests)
- `test/evolution/test_experiment.py` (7 tests, including critical convergence test)
- `test/evolution/test_end_to_end.py` (2 tests — real bridge + summon-from-population)

**TypeScript — modified:**
- `src/alienclaw/governance/summon-adapter.ts` — added `fromPopulation?: boolean` to MartianSummonRequest
- `src/alienclaw/governance/real-summon-adapter.ts` — sends `kind='summon-from-population'` when flag set
- `src/alienclaw/governance/specialist.ts` — added `fromPopulation?` to SpecialistOptions

**Python — modified:**
- `src/alienclaw/bridge/server.py` — added `summon-from-population` request kind

**Specs:**
- `docs/specs/SUMMON_BRIDGE_SPEC_v1_1_ADDENDUM.md` — documents v1.x extension (base spec unchanged)

**CI:**
- `.github/workflows/ci.yml` — evolution tests + leak detection added to Python job

**Reports:**
- `.packet-reports/packet-08-experiment-raw.json` — 50-gen experiment raw data
- `.packet-reports/packet-08-experiment-results.md` — narrative + analysis

---

## Test counts

| Suite | Tests | Status |
| --- | --- | --- |
| test_storage.py | 12 | all pass |
| test_population.py | 18 | all pass |
| test_selection.py | 8 | all pass |
| test_stats.py | 9 | all pass |
| test_generation.py | 10 | all pass |
| test_experiment.py | 7 | all pass (includes convergence test) |
| test_end_to_end.py | 2 | all pass |
| **Total new** | **66** | **all pass** |
| Python total (all) | 360 | 360 pass, 125 skip |
| TypeScript total | 250 | 250 pass, 1 pre-existing fail |

---

## Architecture established

### Population layer
- Flat-file storage at `$ALIENCLAW_POPULATIONS_ROOT/<martian_type>/`
- Atomic writes (tmpfile + fsync + rename)
- Append-only entries (history preserved for lineage tracing)
- Env var `ALIENCLAW_POPULATIONS_ROOT` enables full test isolation (zero real disk writes)
- `Population.create()`, `Population.load()`, `Population.load_or_create()`
- Public API stable for Packet 10: `sample()`, `add()`, `top()`, `snapshot()`

### Selection
- Tournament with K=3 (v1.0 default)
- Robust against early-phase fitness clustering (all-zero, all-one distributions)
- Roulette-wheel and truncation stubbed with NotImplementedError

### Generational step
- Re-evaluates ALL entries each generation (caching deferred to future)
- Stats computed over evaluated entries (not including 0.0-fitness children)
- New pool = top `elitism_count` + `population_size - elitism_count` children
- Deterministic given seeded RNG

### Bridge extension
- `kind='summon-from-population'`: server selects genome via tournament, runs Martian, feeds fitness back
- `genome_used` returned in response for lineage tracking
- Backward compatible: v1.0 `summon` requests unchanged

### Experiment evidence
- `compute` Martian: neutral evolution (all genomes achieve fitness=1.0)
- Mock convergence test: heritable fitness trait (count of '0123' in IDENTITY tail) improves over 20 generations
- 800 real bridge calls in ~0.5s — evolution loop is fast enough for research use

---

## Pre-existing failure (not introduced in Packet 8)
`test/rule5-channel-isolation.test.ts` — 1 test failing since before Packet 7.
