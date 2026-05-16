---
task: packet 23 wire subagent into active governance loop
slug: 20260508-221454_packet-23-wiring
effort: comprehensive
phase: complete
progress: 14/14
mode: interactive
started: 2026-05-08T22:14:54Z
updated: 2026-05-09T02:25:00Z
---

## Context

Packet 23 closes the structural gap identified in Packet 22: the full governance loop
(`governance/common/governance-loop.ts`) dispatched campaigns via the old Employee model
(`agents/employee.ts`). The new deterministic Subagent/Martian layer
(`governance/common/subagent.ts`) was not wired in.

**ANTHROPIC_API_KEY is NOT set** — full LLM path cannot be tested. Wiring is structural;
end-to-end LLM validation is deferred.

## Criteria

### Wiring
- [x] ISC-1: `governance-loop.ts` adds `adapter: MartianSummonAdapter` to `GovernanceLoopDeps`
- [x] ISC-2: `spawnCampaign` creates `Subagent` inline (not from pre-built registry)
- [x] ISC-3: `spawnCampaign` calls `birth(brief)` → `runCampaign(brief, inputs)` → `erase()`
- [x] ISC-4: `termination_reason === 'state_machine_finalized'` → JOB_COMPLETE; else JOB_FAILED
- [x] ISC-5: `handleUserGoal` no longer calls `buildSchemeSubagents`
- [x] ISC-6: `resumeGoal` no longer calls `buildSchemeSubagents`
- [x] ISC-7: `handleJobFailed` campaign retry no longer calls `buildSchemeSubagents`

### CreatorBot cleanup
- [x] ISC-8: `buildSubagentForRole` removed from `agents/creatorbot.ts`
- [x] ISC-9: `buildSchemeSubagents` removed from `agents/creatorbot.ts`
- [x] ISC-10: `Employee`/`buildSubagent`/`registerEmployee` imports removed from `creatorbot.ts`

### Bootstrap + escalation
- [x] ISC-11: `hierarchy-bootstrap.ts` creates `RealMartianSummonAdapter` and passes to `GovernanceLoop`
- [x] ISC-12: `escalation-handler.ts` dead `buildSubagentForRole` campaign path removed

### Reports
- [x] ISC-13: `.packet-reports/packet-23-wiring-design.md`
- [x] ISC-14: `.packet-reports/packet-23-verdict.md` — YELLOW

### Verification
- [x] `PYTHONPATH=src python -m pytest test/ -q --tb=no` → 668 passed
- [x] `npm run typecheck` → exit 0
- [x] `npx vitest run` → 402 passed

## Decisions

- Subagents created INLINE in `spawnCampaign` (no pre-build phase)
- CREATOR_BUILDING state retained as a transition step (semantic meaning preserved)
- Legacy sub-goal path (`spawnLegacyJob`) kept as-is — uses Employee, deferred
- employee.ts NOT deleted — still needed by legacy path
- Verdict: YELLOW (structural wiring complete; LLM test blocked by API key)

## Verification

668 Python tests passed. 402 TypeScript tests passed. tsc --noEmit exits 0.
