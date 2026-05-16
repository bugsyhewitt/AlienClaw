---
task: packet 24 spawnLegacyJob cleanup employee path removal
slug: 20260509-022800_packet-24-legacy-cleanup
effort: advanced
phase: complete
progress: 38/38
mode: interactive
started: 2026-05-09T02:28:00Z
updated: 2026-05-09T01:20:00Z
---

## Context

Packet 23 wired the main campaign execution path to use `governance/common/Subagent`. The legacy
sub-goal dispatch path (`spawnLegacyJob` + `handleJobFailed` REBUILD) still used the old Employee
model from `agents/employee.ts`. This packet migrated both paths to Subagent, removed all Employee
residue from live code, and deleted `agents/employee.ts`.

### Investigation findings (Phase 1)

**`spawnLegacyJob`**: LIVE. Called from `dispatchReadySubGoals`, which is called from 8
governance flow paths including mid-execution user input and sign-off decline.

**REBUILD path in `handleJobFailed`**: LIVE. Lines 539-553. Used `buildEmployee(strikeAction.spec)`
and `newEmployee.executeTask(task)`.

**`agents/employee.ts`**: Still existed (NOT deleted in Packet 23 — legacy path kept it alive).

### Migration approach

Kept TaskManager integration in `spawnLegacyJob` for strike counting. Replaced Employee
execution with inline Subagent. Simplified StrikeAction to remove EmployeeSpec.

## Criteria

### Phase 1 — Investigation report
- [x] ISC-1: `packet-24-investigation.md` written with spawnLegacyJob classification (LIVE)
- [x] ISC-2: Every Employee residue file listed with live-vs-historical classification
- [x] ISC-3: Migration approach documented: TaskManager preserved, StrikeAction simplified

### Phase 2 — Migrate spawnLegacyJob
- [x] ISC-4: `spawnLegacyJob` builds `SubagentBrief` from `subGoal` fields
- [x] ISC-5: `spawnLegacyJob` creates `Subagent` inline with `this.adapter`
- [x] ISC-6: `spawnLegacyJob` calls `birth(brief)` then `runCampaign` then `erase()`
- [x] ISC-7: `spawnLegacyJob` still creates task via `bossBot.buildTask` for strike tracking
- [x] ISC-8: `spawnLegacyJob` still calls `taskManager.register` and `taskManager.assign`
- [x] ISC-9: `spawnLegacyJob` no longer calls `buildEmployee` or `agentRegistry.registerEmployee`
- [x] ISC-10: `spawnLegacyJob` pushes `JOB_COMPLETE` on `state_machine_finalized`
- [x] ISC-11: `spawnLegacyJob` pushes `JOB_FAILED` on all other termination reasons

### Phase 2B — Migrate handleJobFailed REBUILD path
- [x] ISC-12: REBUILD path creates `Subagent` inline instead of `buildEmployee(strikeAction.spec)`
- [x] ISC-13: REBUILD path does NOT call `agentRegistry.registerEmployee`
- [x] ISC-14: REBUILD path keeps original `task.taskId` alive (no task deregistration before retry)
- [x] ISC-15: REBUILD path pushes JOB_COMPLETE/JOB_FAILED via Subagent result

### Phase 3 — Remove Employee from governance-loop.ts
- [x] ISC-16: `buildEmployee` import removed from governance-loop.ts
- [x] ISC-17: `Employee` type import removed from governance-loop.ts
- [x] ISC-18: `agentRegistry.registerEmployee` calls removed (both call sites)

### Phase 4 — Simplify StrikeAction + escalation-handler.ts
- [x] ISC-19: `StrikeAction` REBUILD no longer has `spec: EmployeeSpec` field
- [x] ISC-20: `escalation-handler.ts` no longer calls `creatorBot.buildEmployeeSpec`
- [x] ISC-21: `EmployeeSpec` import removed from escalation-handler.ts

### Phase 5 — Remove buildEmployeeSpec from creatorbot.ts
- [x] ISC-22: `buildEmployeeSpec` method removed from `agents/creatorbot.ts`
- [x] ISC-23: `EmployeeSpec` import removed from `agents/creatorbot.ts`

### Phase 6 — Delete employee.ts + index.ts cleanup
- [x] ISC-24: `agents/employee.ts` file deleted
- [x] ISC-25: Employee re-exports removed from `src/alienclaw/index.ts`

### Phase 7 — Clean agent-registry.ts
- [x] ISC-26: Employee map (`private employees`) removed from `AgentRegistry`
- [x] ISC-27: `registerEmployee`, `getEmployee`, `deregisterEmployee` removed from `AgentRegistry`
- [x] ISC-28: `Employee` type import removed from `agent-registry.ts`

### Phase 8 — Clean types.ts + goal-manager.ts
- [x] ISC-29: `EmployeeSpec` interface removed from `types.ts`
- [x] ISC-30: `Campaign.subagentIds?` field removed from `types.ts`
- [x] ISC-31: `subagentIds` removed from `updateCampaign` patch type in `goal-manager.ts`
- [x] ISC-32: `// ── Employees ──` comment block removed from `types.ts`

### Phase 9 — Update integration test comments
- [x] ISC-33: `synthetic-goal.test.ts` comment updated: gap now closed (Packets 23+24)
- [x] ISC-34: `realistic-goal.test.ts` comment updated: gap now closed

### Verification + Reports
- [x] ISC-35: `tsc --noEmit` exits 0 after all changes
- [x] ISC-36: `PYTHONPATH=src python -m pytest test/ -q --tb=no` ≥668 passed
- [x] ISC-37: `npx vitest run` ≥402 passed
- [x] ISC-38: `packet-24-verdict.md` written (GREEN)

### Anti-criteria
- [x] ISC-A1: No .martian or .msb files modified
- [x] ISC-A2: docs/ARCHITECTURE.md not modified
- [x] ISC-A3: No genome/bridge/evolution/Subagent-core code modified
- [x] ISC-A4: `TaskManager` is NOT removed (preserved for strike counting)
- [x] ISC-A5: `agentRegistry.closeTask()` preserved (used in runCompletionFlow)

## Decisions

- spawnLegacyJob was LIVE → MIGRATE-IN-PLACE (8 call paths confirmed via investigation)
- TaskManager kept in spawnLegacyJob for strike semantics
- StrikeAction simplified to remove EmployeeSpec (callers updated)
- employee.ts deleted after all callers removed
- agentRegistry kept (closeTask still used) but Employee storage methods removed

## Verification

- `npm run typecheck` (tsc --noEmit): exit 0
- `PYTHONPATH=src python -m pytest test/ -q --tb=no`: 668 passed, 125 skipped
- `npx vitest run`: 402 passed, 27 test files
