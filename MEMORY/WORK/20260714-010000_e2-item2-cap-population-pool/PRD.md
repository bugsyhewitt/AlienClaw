---
task: Cap population pool size in bridge summon path
slug: 20260714-010000_e2-item2-cap-population-pool
effort: standard
phase: complete
progress: 8/8
mode: interactive
started: 2026-07-14T01:00:00Z
updated: 2026-09-03T00:00:00Z
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

- [x] ISC-1: `_handle_summon_from_population` checks `len(pop.all()) > config.population_size`
- [x] ISC-2: When true, calls `pop.replace_pool(pop.top(config.population_size))`
- [x] ISC-3: When `len(pop.all()) <= population_size`, no cap is applied
- [x] ISC-4: New test proves tournament receives ≤ population_size entries when pool is oversized
- [x] ISC-5: New test uses `isolate_populations` autouse fixture — no real ~/.alienclaw/ writes
- [x] ISC-6: Cap keeps highest-fitness entries (top by fitness, not oldest)
- [x] ISC-7: `pnpm exec vitest run` + pytest both green after change
- [x] ISC-8: No change to Population.load(), Population.add(), or any other Python class

## Decisions

- Implemented exactly as designed in the Context section: the cap sits immediately
  after `Population.load_or_create(config)` and before the `tournament()` call, so
  both `pop.add()` feedback paths (failure and success arms) operate on a bounded
  pool.
- Used the existing public API (`replace_pool`, `top`) rather than adding a new
  pruning method — no change to the `Population` class itself, satisfying ISC-8.

## Verification

Closed out 2026-09-03. The work had in fact shipped; this PRD was simply never
updated from `phase: think` and is corrected here.

- **ISC-1/2/3/6 — implementation**: `src/alienclaw/bridge/server.py:373-375`

  ```python
  # Cap in-memory pool to population_size — prevents unbounded growth diluting tournament selection
  if len(pop.all()) > config.population_size:
      pop.replace_pool(pop.top(config.population_size))
  ```

  The `if` guard satisfies ISC-1 and ISC-3 (no cap when within size);
  `replace_pool(pop.top(N))` satisfies ISC-2 and ISC-6 (`top()` orders by fitness).
  It is positioned after `load_or_create` (server.py:369) and before `tournament`
  (server.py:379).

- **ISC-4/5 — test**: `test/bridge/test_server_direct.py:549`,
  `test_sfp_caps_pool_to_population_size_before_tournament`. Builds an oversized
  pool (32 + 18 = 50 entries, asserted at :574), patches `load_or_create` to return
  it, spies on `tournament` to capture the pool it actually receives, and asserts
  the cap was applied before selection (:599). Uses the `isolate_populations`
  fixture declared at `test/bridge/test_server_direct.py:26` (tmp_path +
  monkeypatch), so no real `~/.alienclaw/` writes occur.

- **ISC-7 — suites green**: verified 2026-09-03 —
  `pnpm exec vitest run` → 3046 passed / 0 failed;
  `PYTHONPATH=src pytest` → 1306 passed. The targeted cap test passes on its own:
  `pytest test/bridge/test_server_direct.py -k population_size` → 1 passed.

- **ISC-8 — no class changes**: the diff touches only the handler body in
  `bridge/server.py`; `Population.load()`, `.add()`, `.top()`, `.replace_pool()`
  are used as-is from `src/alienclaw/evolution/population.py` (lines 103, 114, 132,
  159) with no modification.
