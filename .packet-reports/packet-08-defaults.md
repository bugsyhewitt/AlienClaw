# Packet 8 Defaults Chosen

| Default | Value | Rationale |
| --- | --- | --- |
| Population storage | Flat files in `$ALIENCLAW_POPULATIONS_ROOT/<martian_type>/` | Human-inspectable + grep-able + git-friendly; forward-compatible via PopulationStorage backend swap |
| Selection algorithm | Tournament K=3 | Robust against fitness-distribution surprises (clustering at 0 or 1) common in early runs |
| population_size | 32 (EvolutionConfig) | Manageable without perf work; small enough that 50 gens × 32 runs ~= seconds |
| tournament_k | 3 | See above |
| mutation_rate | 1/256 | Matches GENOME_SPEC.md per-character rate; ~1 mutation per genome per generation |
| crossover_rate | 0.5 | Equal mix of mutation-only and crossover children |
| elitism_count | 2 | Top-2 always survive; prevents catastrophic forgetting of best genomes |
| Re-evaluation strategy | Re-evaluate every entry every generation | Simple + correct; caching deferred |
| ALIENCLAW_POPULATIONS_ROOT env var | Unset → ~/.alienclaw/populations/ | Override for tests (monkeypatch); for operators who want non-default storage location |
| summon-from-population genome selection | tournament K=config.tournament_k | Same selection algorithm as the local evolution loop |
| bridge_runner timeout | 30,000ms | Generous for compute-type tasks; shorter for time-sensitive experiments |
| Experiment initial stats baseline | stats[0] = before any evaluation (all fitness=0.0) | Enables clean "stats[-1] > stats[0]" assertion even for fresh populations |
| CLI default generations | 20 | Enough for visible trend in small experiments; fast enough for interactive use |
| CLI default population_size | 32 | Same as EvolutionConfig default |

## Override paths

- Population storage location: set `ALIENCLAW_POPULATIONS_ROOT` env var
- Selection algorithm: subclass or replace `tournament()` in generation.py
- Population size, tournament_k, mutation_rate: set in `EvolutionConfig`
- Storage backend (if flat-files become slow): replace `PopulationStorage` behind same API
