# Packet 11 — Specialist 5-File Workspace

## Summary

Packet 11 builds the on-disk workspace that SPECIALIST_SPEC.md describes.
Specialists now create a 5-file directory at `~/.alienclaw/specialists/<campaign_id>/`
at birth, accumulate results in MEMORY.md during the campaign, update HEARTBEAT.md
on state changes, and delete the workspace on erase.

---

## What was built

### Specialist class (specialist.ts — Packet 7 + 11)

New public API:

| Method | Description |
| --- | --- |
| `birth(brief)` | Creates workspace, writes all 5 files. Idempotent. |
| `updateHeartbeat(state, progress, activity?)` | Rewrites HEARTBEAT.md with current state |
| `recordResult(type, id, inputs, genome, result)` | Appends summon log to MEMORY.md |
| `appendMemory(content)` | Appends free-form markdown to MEMORY.md |
| `rewriteMemorySection(title, content)` | Replaces named section in MEMORY.md |
| `finalize(status, summary)` | Calls updateHeartbeat with COMPLETE/FAILED |
| `erase()` | Updates heartbeat, deletes workspace dir. Idempotent. |
| `execute()` | Packet 7 single-shot shim — calls birth files if present |

New type:

```typescript
interface SpecialistBrief {
  campaignId, role, domain, objective, scope, successCriteria,
  allowedTools, deliverables, backgroundContext, communicationStyle,
  knowledgeBase, constraints
}
```

Implementation details:
- Atomic writes: sibling tmp file + rename (same filesystem = atomic)
- Workspace dir: mode 0700
- Base dir injectable via `specialistsBaseDir` option (test isolation)
- Activities accumulate in memory (up to 10 kept, 3 shown in HEARTBEAT)

### CreatorBot (creator-bot.ts — Packet 6/7 + 11)

- Added `specialistsBaseDir` constructor parameter (forwarded to Specialist)
- `runCampaign()` now calls `specialist.birth(brief)` before execute
- `runCampaign()` now calls `specialist.finalize()` and `specialist.erase()` after execute
- SpecialistBrief constructed from CampaignRequestMessage fields

### Tests (27 new)

| File | Tests | What it verifies |
| --- | --- | --- |
| workspace.test.ts | 10 | 5 files created at birth, correct content, cleanup on erase |
| memory-append.test.ts | 7 | appendMemory, recordResult, rewriteMemorySection semantics |
| heartbeat.test.ts | 8 | State transitions, activity accumulation, finalize states |

**Note:** Tests renamed from `test_workspace.ts` to `workspace.test.ts` etc.
to match vitest's default pattern (`*.test.ts`).

---

## Key decisions

1. **HEARTBEAT.md follows spec format (markdown, not JSONL).** The packet instructions proposed JSONL — the locked spec says markdown. Spec wins. See addendum for details.

2. **Workspace base dir is injectable.** Tests use `mkdtempSync` to create isolated dirs; prod uses `~/.alienclaw/specialists`. Zero filesystem leaks from tests.

3. **birth() is idempotent.** Prevents double-creation if CreatorBot retries. Returns without writing if workspace dir already exists.

4. **MEMORY.md is append-only at the entry level; sections are rewritable.** appendMemory/recordResult use appendFileSync (fast, no read-modify-write). rewriteMemorySection does a full read-modify-write for section replacement.

---

## Metrics

| Metric | Value |
| --- | --- |
| TypeScript lines added | ~250 (specialist.ts) |
| TypeScript lines changed | ~20 (creator-bot.ts) |
| New test files | 3 (27 tests) |
| Total governance tests | 102 (was 75) |
| tsc errors | 0 |
| Specialist workspace leaks after tests | 0 |
