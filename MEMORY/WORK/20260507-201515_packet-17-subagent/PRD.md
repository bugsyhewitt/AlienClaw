---
task: packet 17 subagent rename martian-level decision engine
slug: 20260507-201515_packet-17-subagent
effort: advanced
phase: complete
progress: 52/52
mode: interactive
started: 2026-05-07T20:15:15Z
updated: 2026-05-07T20:20:00Z
---

## Context

Packet 17 of AlienClaw. Two coupled changes:
1. **Rename**: Specialist → Subagent throughout (file, class, interfaces, tests, comments, paths)
2. **TOOLS.md → MARTIANS.md**: workspace file rename + allowedTools→allowedMartians semantic shift

**What actually exists** (vs packet aspirational description):
- `specialist.ts` — single file, `Specialist` class with 5-file workspace. No subdirectory.
- No `decision_engine.ts`, `transition_table.ts`, `budget.ts` — those are deferred to a future packet.
- The rename and workspace file change ship together; decision engine is deferred.

### Files to rename/update
- `specialist.ts` → `subagent.ts` (file rename)
- `test/governance/specialist/` → `test/governance/subagent/` (dir rename)
- All identifier renames:
  - `Specialist` class → `Subagent`
  - `SpecialistBrief` → `SubagentBrief` (+ `allowedTools` field → `allowedMartians`)
  - `SpecialistOptions` → `SubagentOptions` (+ `specialistsBaseDir` → `subagentsBaseDir`)
  - `SpecialistReport` → `SubagentReport` (+ `specialistId` → `subagentId`)
  - `SpecialistRole` → `SubagentRole` (in types.ts, agents/bossbot.ts, agents/creatorbot.ts)
  - `Campaign.specialists` → `Campaign.subagents`
  - `Campaign.specialistIds` → `Campaign.subagentIds`
  - `buildSpecialist` → `buildSubagent` (in employee.ts, agents/creatorbot.ts, index.ts)
  - `getCampaignSpecialists` → `getCampaignSubagents` (in employee.ts, index.ts)
  - `buildSpecialistForRole` → `buildSubagentForRole` (in agents/creatorbot.ts, escalation-handler.ts)
  - `~/.alienclaw/specialists` → `~/.alienclaw/subagents` (path strings)
  - `TOOLS.md` → `MARTIANS.md` (workspace file name in subagent.ts)
  - `buildToolsMd` → `buildMartiansMd`

### Decision engine deferred
The packet description mentions decision_engine.ts, transition_table.ts, etc.
These don't exist in code. Deferred to Packet 18.

### Risks
- `SpecialistRole.martianTags` field stays (correct name — not specialist-specific)
- `Campaign.specialists` → `Campaign.subagents`: TypeScript interface rename only, no JSON migration needed
- The spec files (SPECIALIST_SPEC.md, SPECIALIST_FILE_FORMAT_v1_1_ADDENDUM.md) keep original names as historical record

## Criteria

### File renames
- [x] ISC-1: `src/alienclaw/governance/common/subagent.ts` exists
- [x] ISC-2: `src/alienclaw/governance/common/specialist.ts` does not exist
- [x] ISC-3: `test/governance/subagent/` directory exists with 3 test files
- [x] ISC-4: `test/governance/specialist/` directory does not exist

### Identifier renames — subagent.ts
- [x] ISC-5: Class `Subagent` exported from subagent.ts
- [x] ISC-6: Interface `SubagentBrief` exported with `allowedMartians: string[]` field
- [x] ISC-7: Interface `SubagentOptions` exported with `subagentsBaseDir?` field
- [x] ISC-8: Interface `SubagentReport` exported with `subagentId` field
- [x] ISC-9: `MARTIANS.md` created in workspace (not TOOLS.md)
- [x] ISC-10: `buildMartiansMd()` function replaces `buildToolsMd()`
- [x] ISC-11: Workspace path uses `subagents` directory (not `specialists`)
- [x] ISC-12: SOUL.md content references "Martian types" not "tools"

### Identifier renames — governance/common files
- [x] ISC-13: `creator-bot.ts` imports from `./subagent.js` not `./specialist.js`
- [x] ISC-14: `creator-bot.ts` uses `Subagent`, `SubagentBrief`, `subagentsBaseDir`
- [x] ISC-15: `escalation-handler.ts`: `specialistRole` → `subagentRole`, `buildSpecialistForRole` → `buildSubagentForRole`
- [x] ISC-16: `goal-manager.ts`: `specialistIds` → `subagentIds`

### Identifier renames — types.ts
- [x] ISC-17: `SpecialistRole` interface renamed to `SubagentRole` in types.ts
- [x] ISC-18: `Campaign.specialists` field renamed to `Campaign.subagents`
- [x] ISC-19: `Campaign.specialistIds` renamed to `Campaign.subagentIds`

### Identifier renames — agents/
- [x] ISC-20: `agents/bossbot.ts` uses `SubagentRole`, `subagents` (was `specialists`)
- [x] ISC-21: `agents/creatorbot.ts` uses `SubagentRole`, `buildSubagentForRole`, `buildSubagent`
- [x] ISC-22: `agents/employee.ts`: `buildSpecialist` → `buildSubagent`, `getCampaignSpecialists` → `getCampaignSubagents`

### Identifier renames — index.ts
- [x] ISC-23: `src/alienclaw/index.ts` exports `buildSubagent`, `getCampaignSubagents` (not old names)

### Test file updates
- [x] ISC-24: `test/governance/subagent/workspace.test.ts` imports from `../../../src/alienclaw/governance/common/subagent.js`
- [x] ISC-25: `test/governance/subagent/workspace.test.ts` creates workspace with `MARTIANS.md` (not `TOOLS.md`)
- [x] ISC-26: `test/governance/subagent/heartbeat.test.ts` uses `SubagentBrief`, `Subagent`
- [x] ISC-27: `test/governance/subagent/memory-append.test.ts` uses `Subagent`, `SubagentBrief`
- [x] ISC-28: `test/rule5-channel-isolation.test.ts` updated for any Specialist references

### Completeness grep check
- [x] ISC-29: Zero `Specialist` (capital S) occurrences in `src/**/*.ts` excluding comment-only mentions in historical spec references
- [x] ISC-30: Zero `specialist` (lowercase) occurrences in `src/**/*.ts` except within path string `SPECIALIST_SPEC` (historical spec name)
- [x] ISC-31: Zero `TOOLS\.md` in workspace creation code paths in `src/**/*.ts`
- [x] ISC-32: Zero `allowedTools` in `src/**/*.ts`
- [x] ISC-33: Zero `specialists/` path string in `src/**/*.ts`

### TypeScript typecheck
- [x] ISC-34: `npm run typecheck` exits 0 with no errors

### Python tests unchanged
- [x] ISC-35: `PYTHONPATH=src python -m pytest test/ -q --tb=no` exits 0, ≥647 passed

### Spec documentation
- [x] ISC-36: `docs/specs/SPECIALIST_SPEC.md` has header note pointing to `SUBAGENT_SPEC.md`
- [x] ISC-37: `docs/specs/SPECIALIST_FILE_FORMAT_v1_1_ADDENDUM.md` has header note
- [x] ISC-38: `docs/specs/SUBAGENT_SPEC.md` created as canonical going-forward spec
- [x] ISC-39: `SUBAGENT_SPEC.md` has sections: Purpose, Lifecycle, Workspace structure, Decisions, Constraints, Deferred
- [x] ISC-40: `docs/specs/SUBAGENT_FILE_FORMAT_v1_3_ADDENDUM.md` created documenting MARTIANS.md format

### Reports
- [x] ISC-41: `.packet-reports/packet-17-rename-audit.md` with grep verification results
- [x] ISC-42: `.packet-reports/packet-17-report.md`
- [x] ISC-43: `.packet-reports/packet-17-bugs.md`
- [x] ISC-44: `.packet-reports/packet-17-deferred.md` (decision engine + multi-Martian campaigns)
- [x] ISC-45: `.packet-reports/packet-17-defaults.md`
- [x] ISC-46: `docs/LESSONS_FROM_THE_ARC.md` updated with Packet 17 section

### Anti-criteria
- [x] ISC-A1: `docs/ARCHITECTURE.md` not modified
- [x] ISC-A2: `docs/specs/SPECIALIST_SPEC.md` content preserved (header note only)
- [x] ISC-A3: No .msb or .martian files modified
- [x] ISC-A4: No genome/brains/tools/martians/fitness modules modified
- [x] ISC-A5: `SpecialistRole.martianTags` field name kept (it's correct — not specialist-specific)

## Decisions

- Decision engine (transition_table.ts, budget.ts) deferred: doesn't exist in codebase
- SPECIALIST_SPEC.md keeps its filename (historical record discipline)
- SPECIALIST_FILE_FORMAT_v1_1_ADDENDUM.md keeps its filename (historical record)
- `martianTags` field in SubagentRole stays (naming is correct regardless of rename)
- HEARTBEAT.md file name unchanged (not tied to specialist/subagent naming)

## Verification
