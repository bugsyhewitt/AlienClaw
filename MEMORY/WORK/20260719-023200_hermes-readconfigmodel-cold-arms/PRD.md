---
task: Add 2 TDD tests covering cold arms in readConfigModel
slug: 20260719-023200_hermes-readconfigmodel-cold-arms
effort: standard
phase: execute
progress: 0/3
mode: autonomous
started: 2026-07-19T02:32:00Z
updated: 2026-07-19T06:45:00Z
---

## Context

`readConfigModel` in `src/alienclaw/governance/hermes/hermes-llm-gateway.ts:43-58` has
two branch arms that no existing test exercises. This adds 2 TDD tests (driven indirectly
via `HermesHostAdapter().llm().complete()` against a throwaway HERMES_HOME) to cover them,
then lands as a branch/PR in the Hermes cold-arm packet series.

### Cold arms

- **L57 `v || undefined` falsy:** empty quoted scalar `model: ""` strips to `''` → undefined → fallback
- **L54 `endsWith` false (double + single):** unterminated opening quote → quotes NOT stripped → unknown provider prefix → fallback

## Criteria

- [ ] ISC-1: Test 1 (L57 falsy) passes and hits the `v || undefined` empty arm
- [ ] ISC-2: Test 2 (L54 endsWith-false) passes and hits both unterminated-quote arms
- [ ] ISC-3: Full governance coverage gate passes (`--coverage.thresholds.branches=77`)

## Decisions

- Drive tests indirectly through `HermesHostAdapter().llm().complete()` — matches existing test pattern (never call `readConfigModel` directly, it is not exported)
- Test 2 uses profile config (double-unterminated) + root config (single-unterminated) in one `it` so one `complete()` call exercises both quote-char arms
- No production code changes

## Verification

To be filled in after tests are written and coverage reports are run.
