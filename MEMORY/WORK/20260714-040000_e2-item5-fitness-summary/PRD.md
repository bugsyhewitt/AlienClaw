---
task: Write live-fitness-summary.json on each fitness-update tick (E2 item 5)
slug: 20260714-040000_e2-item5-fitness-summary
effort: standard
phase: complete
progress: 9/9
mode: interactive
started: 2026-07-14T04:00:00Z
updated: 2026-07-14T04:00:00Z
---

## Context

E2 item 5 (final item): on every `fitness-update` tick, write
`~/.alienclaw/live-fitness-summary.json` so briefings and status readers
can consume live fitness without hitting the API.

Prior to this item: the `fitness-update` job returned early when
`reports.length === 0`, leaving no persistent summary for external readers.

Change: restructure `fitness-update` to guard only the EMA update with
`if (reports.length > 0)`, then always write the summary at the end of
every tick (reflecting current in-memory registry fitness).

The summary write is atomic: `fsSync.writeFileSync(tmpSummary, ...)` then
`fsSync.renameSync(tmpSummary, PATHS.liveFitnessSummary)`. A failed write
is non-fatal (caught and suppressed) — the in-memory registry remains correct.

### Risks

- Risk: `/tmp/ac-test-fit-sum` may not exist when `writeFileSync` is called.
  Resolved by `mkdirSync('/tmp/ac-test-fit-sum', { recursive: true })` in beforeEach.
- Risk: `mockFakeRegistry.list` value needed inside the `vi.mock()` factory.
  Resolved by using `vi.hoisted()` so the object is created before factories run.
- Risk: Two test files use similar tmp paths (/tmp/ac-test-home vs /tmp/ac-test-fit-sum).
  Resolved by using a distinct path for the new test file — no collision.

## Criteria

### Production code
- [x] ISC-1: `PATHS.liveFitnessSummary` added to `src/alienclaw/constants.ts`
- [x] ISC-2: `fitness-update` EMA update guarded by `if (reports.length > 0)` (not early return)
- [x] ISC-3: Summary write (atomic tmp→rename) runs after the guard on every tick
- [x] ISC-4: Summary JSON has `generated_at` ISO timestamp field
- [x] ISC-5: Summary JSON has `martians: [{id, fitness}]` from `registry.list()`

### Tests
- [x] ISC-6: PATHS mock in `hierarchy-bootstrap-online-fitness.test.ts` includes `liveFitnessSummary`
- [x] ISC-7: FUS-101 — job writes summary with 2 fake martians when reports=[]
- [x] ISC-8: FUS-102 — `generated_at` is valid ISO; empty registry → `martians:[]`

### Suite gate
- [x] ISC-9: `pnpm test` green (vitest + pytest, no regressions)

### Anti-criteria
- [x] ISC-A1: No LLM calls in path
- [x] ISC-A2: No genome changes
- [x] ISC-A3: No deploy action

## Decisions

- Summary always written (not only when reports.length > 0) — status readers need
  fresh data every tick regardless of whether new telemetry arrived.
- Test uses real filesystem at `/tmp/ac-test-fit-sum/` (mkdir in beforeEach, cleanup
  in afterEach) rather than mocking node:fs — simpler and more robust.
- vi.hoisted() for mockFakeRegistry — required for vi.mock() factory access.

## Verification

```bash
# Targeted: just the new wiring tests
pnpm exec vitest run test/wiring/fitness-update-summary.test.ts

# Full suite gate
pnpm test
```
