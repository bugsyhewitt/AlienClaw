---
task: Cap population pool size in bridge summon path
slug: 20260714-010000_e2-item2-cap-population-pool
effort: standard
phase: think
progress: 0/8
mode: interactive
started: 2026-07-14T01:00:00Z
updated: 2026-07-14T01:01:00Z
---

## Context

E2 item 2: `_handle_summon_from_population` in `bridge/server.py` calls
`Population.load_or_create(config)` which loads ALL entries from the current
generation. Each bridge subprocess then calls `pop.add()` writing one new entry
to disk. Across many live runs in one generation the on-disk pool grows unboundedly,
so each subprocess starts with an ever-larger in-memory pool, diluting tournament
selection with old low-fitness entries.

Fix: after `Population.load_or_create(config)`, if the pool exceeds `population_size`,
call `pop.replace_pool(pop.top(config.population_size))` to keep only the
highest-fitness entries. Both `replace_pool` and `top(n)` are existing public API.

Location: `src/alienclaw/bridge/server.py`, immediately after line 278
(`pop = Population.load_or_create(config)`).

### Risks

- Risk: Accidentally pruning during the first seeded generation where all fitness=0.0.
  All 32 initial entries have fitness=0.0 and any bridge run adds one. If after 18
  runs (50 entries) we sort+truncate, we keep 32 — any 32 are equivalent (ties).
  Python's `sorted(..., reverse=True)` is stable, so the 32 highest-creation-order
  entries survive. Acceptable.
- Risk: `from alienclaw.evolution.selection import tournament` is a local import.
  Patching `alienclaw.evolution.selection.tournament` at the module level works
  because each call re-executes the `from X import Y` line. ✓
- Risk: ruff scope excludes bridge. No ruff check needed. ✓

## Criteria

- [ ] ISC-1: `_handle_summon_from_population` checks `len(pop.all()) > config.population_size`
- [ ] ISC-2: When true, calls `pop.replace_pool(pop.top(config.population_size))`
- [ ] ISC-3: When `len(pop.all()) <= population_size`, no cap is applied
- [ ] ISC-4: New test proves tournament receives ≤ population_size entries when pool is oversized
- [ ] ISC-5: New test uses `isolate_populations` autouse fixture — no real ~/.alienclaw/ writes
- [ ] ISC-6: Cap keeps highest-fitness entries (top by fitness, not oldest)
- [ ] ISC-7: `pnpm exec vitest run` + pytest both green after change
- [ ] ISC-8: No change to Population.load(), Population.add(), or any other Python class

## Decisions

## Verification
