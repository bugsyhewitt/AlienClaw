---
task: Add live_evo.py utility plus scheduled bridge job
slug: 20260714-020000_e2-item3-live-evo
effort: standard
phase: complete
progress: 22/22
mode: interactive
started: 2026-07-14T02:00:00Z
updated: 2026-07-14T03:00:00Z
---

## Context

E2 item 3: when a martian_type accumulates `LIVE_EVO_THRESHOLD` new online observations (written
to `~/.alienclaw/online_fitness.jsonl` by GovernanceLoop via OnlineFitnessLog), run one
generational step via `evaluate_and_evolve` using the bridge as the run_martian callback,
replacing the population pool with evolved children.

Three pieces:
1. `live_evo.py` — threshold check + watermark + `evaluate_and_evolve` call
2. `bridge/server.py` — `kind: "live-evo"` handler exposing live_evo to TS via subprocess
3. `hierarchy-bootstrap.ts` — 10-min scheduled job calling bridge per martian type

`OnlineFitnessLog.read()` returns `list[dict]` with keys `martian_type`, `fitness`, `ts`.
`evaluate_and_evolve(pop, config, run_martian, rng)` returns
`{"generation", "next_generation", "stats", "children_minted"}`.
`bridge_run_martian(martian_type, genome)` calls `handle()` in-process (no subprocess).

### Risks

- Risk: `evaluate_and_evolve` runs every genome in the pool through bridge_run_martian —
  on a 32-entry pool this is 32 bridge calls. Acceptable for a background job; no LLM calls
  in the Martian execution path (E2 wall). bridge_run_martian uses empty inputs `{}` which
  matches existing `bridge_run_martian` behaviour.
- Risk: Watermark is a count not a timestamp — if entries are deleted from the log the count
  can go negative. `max(0, total - watermark)` guards against this.
- Risk: `hierarchy-bootstrap.ts` needs `spawn` from `node:child_process` — not currently
  imported. Adding one import is clean.
- Risk: The bridge `kind: "live-evo"` handler runs an evolution step in-process (same Python
  process that received the bridge subprocess request). This is correct — the scheduled job
  spawns python3 -m alienclaw.bridge, which calls `_handle_live_evo`, which calls `check_and_evolve`,
  which calls `evaluate_and_evolve` using `bridge_run_martian` (also in-process, no sub-subprocess).
- Risk: ruff lints `src/alienclaw/evolution/` — `live_evo.py` must stay under 100-char lines.

## Criteria

### Python utility (live_evo.py)
- [x] ISC-1: `src/alienclaw/evolution/live_evo.py` exists with `LIVE_EVO_THRESHOLD = 10`
- [x] ISC-2: `check_and_evolve` returns `None` when new observation count < threshold
- [x] ISC-3: `check_and_evolve` calls `evaluate_and_evolve` when new count >= threshold
- [x] ISC-4: Return dict has keys `generation`, `next_generation`, `children_minted`, `new_observations`
- [x] ISC-5: Watermark file `live_evo_watermarks.json` is written after evolution
- [x] ISC-6: Second call immediately after evolution returns `None` (watermark guards double-evolve)
- [x] ISC-7: Watermark counts are per-martian-type (not global)
- [x] ISC-8: `log_path` and `watermark_path` params allow override (testability)

### Bridge handler
- [x] ISC-9: `handle()` routes `kind: "live-evo"` to `_handle_live_evo`
- [x] ISC-10: Missing `martian_type` in `kind: "live-evo"` request returns `MALFORMED_REQUEST`
- [x] ISC-11: Below-threshold request returns `{"ok": True, "evolved": False, "reason": "below_threshold"}`
- [x] ISC-12: Above-threshold request returns `{"ok": True, "evolved": True, "generation": N}`

### TS constants + scheduled job
- [x] ISC-13: `LIVE_EVO_CHECK_INTERVAL_MS = 600_000` added to `src/alienclaw/constants.ts`
- [x] ISC-14: `hierarchy-bootstrap.ts` imports `LIVE_EVO_CHECK_INTERVAL_MS`
- [x] ISC-15: `live-evo-check` scheduled job registered with `LIVE_EVO_CHECK_INTERVAL_MS`
- [x] ISC-16: Job iterates over `knownMartianTypes` and calls bridge once per type

### Tests
- [x] ISC-17: `test/evolution/test_live_evo.py` — below-threshold returns None
- [x] ISC-18: `test/evolution/test_live_evo.py` — at-threshold calls `evaluate_and_evolve` via monkeypatched bridge
- [x] ISC-19: `test/evolution/test_live_evo.py` — watermark prevents double-evolve
- [x] ISC-20: `test/bridge/test_server_direct.py` — `kind: "live-evo"` missing-field error
- [x] ISC-21: `test/bridge/test_server_direct.py` — `kind: "live-evo"` below-threshold success
- [x] ISC-22: `test/bridge/test_server_direct.py` — `kind: "live-evo"` evolved success

### Anti-criteria
- [ ] ISC-A1: No LLM call added to Martian execution path
- [ ] ISC-A2: No genome length or codec change
- [ ] ISC-A3: No deploy or submission action taken
- [ ] ISC-A4: `test_live_evo.py` tests use `tmp_path` — no writes to real `~/.alienclaw`

## Decisions

- Watermark uses count (not timestamp) to measure "new" observations — simpler and avoids
  clock drift between TS/Python processes. Negative guard: `max(0, total - watermark)`.
- `check_and_evolve` uses lazy local imports so the function is importable without
  instantiating Population or loading the bridge at module-load time (better test isolation).
- `_handle_live_evo` monkeypatches `alienclaw.evolution.live_evo.check_and_evolve` at the
  module level in bridge tests — avoids subprocess overhead.
- TS scheduled job uses fire-and-forget `callLiveEvoBridge` (resolve on close/error) — a
  failed evolution is non-fatal and will retry on the next 10-min tick.

## Verification

```
# ISC-1/2/8: live_evo.py structure
grep "LIVE_EVO_THRESHOLD = 10\|def check_and_evolve\|watermark_path" src/alienclaw/evolution/live_evo.py

# ISC-9: bridge routing
grep "kind.*live-evo\|_handle_live_evo" src/alienclaw/bridge/server.py | head -4

# ISC-13/14/15/16: TS wiring
grep "LIVE_EVO_CHECK_INTERVAL_MS\|live-evo-check\|callLiveEvoBridge" src/alienclaw/wiring/hierarchy-bootstrap.ts

# ISC-17..22: tests
PYTHONPATH=src python -m pytest test/evolution/test_live_evo.py test/bridge/test_server_direct.py -q
# → 50 passed (11 live_evo + 39 server_direct)

# ISC-19 (full suite): pnpm test
# → vitest: 1725 passed | pytest: 1184 passed
```

