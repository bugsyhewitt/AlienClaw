# Epic E2 — Live Fitness Drives Population

Online fitness is recorded but isolated. The `OnlineFitnessLog` exists, the bridge
`summon-from-population` path already feeds individual Martian fitness back to
Population via `pop.add()`, and telemetry exposes aggregates. But three gaps remain:

1. **Bootstrap gap**: `hierarchy-bootstrap.ts` constructs `GovernanceLoop` without
   `onlineFitnessLog` — so campaign-level fitness is never written to disk in production.

2. **Pool growth gap**: `pop.add()` grows the in-memory pool unboundedly (no pruning).
   Each bridge subprocess loads all entries at the current generation, so across many
   live runs the pool grows well past `population_size`, diluting selection.

3. **No evolution step**: the live loop does select + observe (via `pop.add()`) but never
   runs mutation/crossover/replacement. Genomes are scored in production but never evolved
   from those scores.

4. **No observability**: fitness trends from live runs are not surfaced in status.md or
   briefings.

## Done (E1)

- `OnlineFitnessLog` (Python + TypeScript): append-only JSONL at
  `~/.alienclaw/online_fitness.jsonl`
- `GovernanceLoop` records to `onlineFitnessLog?.record()` when a campaign completes
- Bridge `_handle_summon_from_population`: selects genome via tournament, runs Martian,
  calls `pop.add(genome, fitness=real_fitness)` — Martian-level feedback already wired
- `aggregateOnlineFitness()` in telemetry-reader.ts exposed via `/martian-types` API
- Governance end-to-end closed-loop test runs ≥3 generations headless (feat/close-governance-evolution-loop)

## This Epic (E2)

Five concrete items; one per wake. Ordered by dependency:

1. Wire `OnlineFitnessLog` into the `GovernanceLoop` constructor in `hierarchy-bootstrap.ts`
2. Cap population pool to `population_size` in the bridge's `summon-from-population` path
3. Add `live_evo.py` utility + scheduled job: when a martian_type accumulates
   `LIVE_EVO_THRESHOLD` new online observations, run `evaluate_and_evolve` using the
   bridge as the `run_martian` callback, replacing the pool with evolved children
4. Governance live-fitness integration test: headless test verifies the full chain
   (bootstrap → GovernanceLoop → bridge → Population update → OnlineFitnessLog) with
   the real summon adapter against a seeded test population
5. Write `~/.alienclaw/live-fitness-summary.json` on each `fitness-update` tick so
   briefings and status readers can consume live fitness without hitting the API

## Walls (carry forward)

- No LLM calls in Martian execution path — Martians are pure genome-symbolic
- No genome length changes (256 chars, live leaderboard)
- No direct DigitalOcean deploys (Hostinger only)
- Ship gate: `pnpm test` green (1,220 tests)
