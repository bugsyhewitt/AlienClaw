---
task: Governance live-fitness integration test (E2 item 4)
slug: 20260714-030000_e2-item4-live-fitness-integration
effort: standard
phase: complete
progress: 14/14
mode: interactive
started: 2026-07-14T03:30:00Z
updated: 2026-07-14T03:30:00Z
---

## Context

E2 item 4: headless test that verifies the full chain
  bootstrap → GovernanceLoop → bridge (summon-from-population) → Population.add() → OnlineFitnessLog.record()
with the real summon adapter and a seeded test population.

Existing test coverage gaps:
- online-fitness-recording.test.ts: GovernanceLoop + STUB Subagent → real log (stub doesn't touch bridge)
- synthetic-goal.test.ts: real Subagent + real adapter → bridge (fromPopulation=false, no GovernanceLoop)
- real-summon-adapter.test.ts: adapter only, no GovernanceLoop, fromPopulation=false

NEW: this file chains real RealMartianSummonAdapter (fromPopulation=true) through
GovernanceLoop.spawnCampaign so that Population.add() AND onlineFitnessLog.record()
both fire with real bridge-computed fitness.

Key technique: Subagent.birth(brief, yaml) stores YAML;  runCampaign(brief, inputs)
uses stored YAML (priority 2). Injecting a pre-birthed Subagent with valid compute
inputs into a mock buildSubagent avoids the default YAML's { plan: "..." } inputs
which fail the compute martian.

### Risks

- Risk: Test 1 relies on the bridge subprocess completing under timeout (30s) — wrap in
  { timeout: 60_000 } like synthetic-goal.test.ts.
- Risk: ALIENCLAW_POPULATIONS_ROOT must be cleaned between tests to avoid state leakage.
  Use afterEach rmSync(tmpDir, { recursive: true }).
- Risk: Double birth issue (buildSubagent calls birth(); spawnCampaign calls birth() again)
  → Subagent.birth() is idempotent (line 275: if existsSync(workspaceDir) return;). Safe.
- Risk: RealMartianSummonAdapter reads PYTHONPATH=src — tests run from repo root so it finds alienclaw.

## Criteria

### Test 1: Subagent + RealMartianSummonAdapter (fromPopulation=true)
- [x] ISC-1: Test 1 runs with fromPopulation=true and ALIENCLAW_POPULATIONS_ROOT in tmp
- [x] ISC-2: result.termination_reason === 'state_machine_finalized'
- [x] ISC-3: result.fitness > 0 (real bridge-computed score)
- [x] ISC-4: Population directory created in tmp after run (bridge called load_or_create)

### Test 2: GovernanceLoop → real adapter → OnlineFitnessLog
- [x] ISC-5: GovernanceLoop uses pre-birthed Subagent (real adapter + stored YAML)
- [x] ISC-6: spawnCampaign completes without error
- [x] ISC-7: onlineFitnessLog.read() has ≥ 1 entry after campaign
- [x] ISC-8: entry martian_type === 'compute'
- [x] ISC-9: entry fitness > 0 (real bridge fitness, not a stub constant)
- [x] ISC-10: ALIENCLAW_POPULATIONS_ROOT in tmp — no writes to real ~/.alienclaw/

### File structure
- [x] ISC-11: New file test/integration/governance-live-fitness.test.ts
- [x] ISC-12: Both tests wrapped in 60s timeout (bridge subprocess calls)

### Suite gate
- [x] ISC-13: pnpm exec vitest run green (1727 tests, 2 new)
- [x] ISC-14: PYTHONPATH=src pytest green (1184 tests, no regressions)

### Anti-criteria
- [ ] ISC-A1: No LLM calls added to Martian execution path
- [ ] ISC-A2: No genome length changes
- [ ] ISC-A3: No deploy/submit action
- [ ] ISC-A4: Both tests use tmp dirs — no real ~/.alienclaw writes

## Decisions

## Verification
