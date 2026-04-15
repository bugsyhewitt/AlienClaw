# AlienClaw — Roadmap to Working System

## Status: WORKING — end-to-end test passes

All critical bugs are fixed. `alienclaw run` executes goals end-to-end.

---

## Completed Fixes

### Bug 1: `extractSection` regex reads too much ✅ FIXED

**Root cause**: Regex `\n\[` matched across sections when genome had embedded newlines.

**Fix**: Line-based extraction that skips blank/metadata lines and collects content until the next `[SECTION]` marker. The `lines: string[]` is pre-split once in `loadMsFile` and passed to all three `extractSection` calls — eliminating 3 redundant string splits per file.

**File**: `src/alienclaw/registry/ms-loader.ts`

---

### Bug 2: `ALIENCLAW_PROVIDER = 'minimax'` ✅ FIXED

**Root cause**: pi-ai called `getEnvApiKey('minimax')` which looked for `MINIMAX_API_KEY`. MiniMax isn't configured that way.

**Fix**: Changed to `'anthropic'` in `constants.ts`. Uses existing `ANTHROPIC_API_KEY`.

**File**: `src/alienclaw/constants.ts`

---

### Bug 3: lossless-claw plugin stale entry ✅ FIXED

Removed via python script that strips the entry from `~/.openclaw/openclaw.json`.

---

### Bug 4: Hardcoded `MiniMax-M2.5` model IDs ✅ FIXED

BossBot, AdvisorBot, and all agent calls used `'MiniMax-M2.5'` which doesn't exist in pi-ai's model registry. Changed to `'claude-opus-4-6'` / `'claude-haiku-4-5'`.

---

### Bug 5: Fallback `martianTags: []` caused "No active Martian" ✅ FIXED

When BossBot's scheme draft parsing fell back to a default campaign, it set `martianTags: []` (empty). This caused `summonMartian` to fail with "No active Martian for tool tag 'general'". Fixed to `['web_search', 'file_read', 'file_write']`.

---

### Bug 6: `resumeGoal` invalid state transition ✅ FIXED

Crash recovery transitioned `IDLE → CREATOR_BUILDING` directly, but `VALID_TRANSITIONS[IDLE]` only allowed `SCHEMING`. Added `IDLE → CREATOR_BUILDING` as a valid crash-recovery path.

**File**: `src/alienclaw/governance/governance-loop.ts`

---

### Bug 7: `resumeGoal` missing specialist build ✅ FIXED

Crash recovery didn't call `buildSchemeSpecialists()` — `campaign.specialistIds` were never populated, so `spawnCampaign` always escalated "no specialists". Added the call after `CREATOR_BUILDING` transition.

**File**: `src/alienclaw/governance/governance-loop.ts`

---

### Bug 8: `bestForTool` O(n log n) on hot path ✅ FIXED

`bestForTool` used spread+filter+sort to find the highest-fitness Martian per tool tag. Replaced with a single O(n) linear scan. This runs on every `summonMartian` call.

**File**: `src/alienclaw/registry/registry.ts`

---

### Bug 9: `extractSection` redundant string splits ✅ FIXED

`loadMsFile` already splits `raw` into `lines` once, then called `extractSection(raw, ...)` three times — each re-splitting internally. Fixed by passing `lines: string[]` to `extractSection`.

**File**: `src/alienclaw/registry/ms-loader.ts`

---

### Bug 10: Completion prompt showed empty "Accomplished:" for scheme goals ✅ FIXED

`promptSignoff` only read `goal.subGoals` (legacy), ignoring `goal.scheme.campaigns`. Fixed to include both.

**File**: `src/alienclaw/governance/completion-handler.ts`

### Bug 11: `extractText` duplicated in BossBot and AdvisorBot ✅ FIXED

Both agents had identical local `extractText` helpers. Centralized in `utils.ts` and imported into both.

**File**: `src/alienclaw/utils.ts`, `src/alienclaw/agents/bossbot.ts`, `src/alienclaw/agents/advisorbot.ts`

### Bug 12: `advisorVerdict` always empty in escalation `recordAttempt` ✅ FIXED

`handleFailure` called `recordAttempt` before consulting AdvisorBot, so `advisorVerdict` was always `''`. Restructured to consult AdvisorBot first, then record with the actual verdict. Also fixed stale `strikeCount` in telemetry (was passing pre-increment value).

**File**: `src/alienclaw/governance/escalation-handler.ts`

### Bug 13: Dead `bossBot` field + `void this.bossBot` in CompletionHandler ✅ FIXED

`CompletionHandler` stored `bossBot` in its constructor but never used it. Removed the field, updated the constructor signature, and removed the `void this.bossBot` placeholder.

**File**: `src/alienclaw/governance/completion-handler.ts`, `src/alienclaw/wiring/hierarchy-bootstrap.ts`

### Bug 14: `dispatchReadySubGoals` ran serially despite "parallel" intent ✅ FIXED

`dispatchReadySubGoals` used a serial `for`/`await` loop. Changed to `Promise.all` over filtered sub-goals, matching the fix already applied to `dispatchReadyCampaigns`.

**File**: `src/alienclaw/governance/governance-loop.ts`

### Bug 15: Hardcoded model string in AdvisorBot ✅ FIXED

`advisorbot.ts:102` used hardcoded `'claude-opus-4-6'` instead of `AGENT_MODELS.AdvisorBot`. Now uses the constant.

**File**: `src/alienclaw/agents/advisorbot.ts`

### Bug 16: Unnecessary `as 'claude-opus-4-6'` type assertions in BossBot ✅ FIXED

All five `getModel` calls in BossBot used `AGENT_MODELS.BossBot as 'claude-opus-4-6'`. The cast does nothing at runtime (both are `string`) and was removed from all five call sites.

**File**: `src/alienclaw/agents/bossbot.ts`

### Bug 17: Duplicate summary-building logic in CompletionHandler ✅ FIXED

`review()` and `promptSignoff()` each had near-identical inline code for building lines from `goal.subGoals` and `goal.scheme.campaigns`. Extracted to `goalStatusLines()` and `goalDoneLines()` helpers.

**File**: `src/alienclaw/governance/completion-handler.ts`

### Bug 18: Duplicate `campaign.some(c => c.id === subGoalId)` expression ✅ FIXED

Identical expression appeared in `handleJobComplete` and `handleJobFailed` to determine if a sub-goal ID refers to a campaign. Extracted to `isCampaignSubGoal()` helper method on `GovernanceLoop`.

**File**: `src/alienclaw/governance/governance-loop.ts`

### Bug 19: Unnecessary `as GovernanceState` type assertion ✅ FIXED

`resumeState` (already typed as `GovernanceState`) was cast to `GovernanceState` in the `transition()` call — a no-op. Removed the redundant cast.

**File**: `src/alienclaw/governance/governance-loop.ts`

### Bug 20: Dynamic import inside scheduled job callback ✅ FIXED

`genome-checksum-audit` job dynamically imported `validateGenome` on every 15-minute firing. Now statically imported at module level.

**File**: `src/alienclaw/wiring/hierarchy-bootstrap.ts`

### Bug 21: TOCTOU existence check in `loadMsFile` ✅ FIXED

Pre-checked `fs.existsSync` before `readFileSync` — redundant since `readFileSync` throws naturally if the file is missing. Removed the guard.

**File**: `src/alienclaw/registry/ms-loader.ts`

### Bug 22: `goal` undefined in `handleJobComplete` legacy branch ✅ FIXED

`handleJobComplete` declared `goal` only in the `isCampaign` branch. The `else` (legacy sub-goal) branch referenced `goal` which was never defined in that scope, causing `subGoal?.taskId` to always be undefined. Added `const goal = file.goals.find(...)` before the branch.

**File**: `src/alienclaw/governance/governance-loop.ts`

### Bug 23: `errorMessage` utility — duplicate error extraction pattern ✅ FIXED

`err instanceof Error ? err.message : String(err)` appeared in 6 locations. Centralized in `utils.ts` as `errorMessage(err: unknown): string`.

**File**: `src/alienclaw/utils.ts`, plus updated callers in `martian-executor.ts`, `ms-loader.ts`, `employee.ts`, `governance-loop.ts`, `creatorbot.ts`

### Bug 24: `normalizeInput` utility — duplicate `.trim().toLowerCase()` pattern ✅ FIXED

`.trim().toLowerCase()` on user input appeared in 2 locations. Centralized in `utils.ts` as `normalizeInput(str: string): string`.

**File**: `src/alienclaw/utils.ts`, plus updated callers in `escalation-handler.ts`, `completion-handler.ts`

### Bug 25: Dead `deriveToolTags` helper in ms-loader.ts ✅ FIXED

`deriveToolTags` was a shallow `[...tools]` copy — added no value over using `tools` directly. Removed the function and inlined `[...tools]`.

**File**: `src/alienclaw/registry/ms-loader.ts`

### Bug 26: `registry.list()` didn't exist — runtime TypeError on scheduler jobs ✅ FIXED

`RegistryStore` had no `list()` method, but both scheduled jobs (`registry-health-check` and `genome-checksum-audit`) called `registry.list()`. Added a `list(): MartianSpec[]` method that returns all active Martians sorted by fitness.

**File**: `src/alienclaw/registry/registry.ts`

### Bug 27: Redundant `activeJobs.delete` in job completion/failure handlers ✅ FIXED

`handleJobComplete` and `handleJobFailed` each called `this.activeJobs.delete(event.subGoalId)` as their first statement. The entry is already deleted by the `.finally()` block in `spawnCampaign` before the completion event is pushed. Removed both redundant calls.

**File**: `src/alienclaw/governance/governance-loop.ts`

### Bug 28: Always-true `VALID_TRANSITIONS['CREATOR_INTERRUPT'].includes('AWAITING_ADVICE')` guard ✅ FIXED

The guard was checking if `AWAITING_ADVICE` was in `CREATOR_INTERRUPT`'s allowed transitions — always true by definition. Replaced with unconditional AdvisorBot consultation.

**File**: `src/alienclaw/governance/governance-loop.ts`

### Bug 29: Double `load()` inside `review.reopenIds` loop ✅ FIXED

`runCompletionFlow` called `this.goalManager.load()` once per `reopenId` inside a `for` loop. Now loads the file once before the loop and reuses `goal` across iterations.

**File**: `src/alienclaw/governance/governance-loop.ts`

### Bug 30: Redundant `addGoal` + `attachScheme` double-save ✅ FIXED

`addGoal` already persisted the scheme to disk. `attachScheme` then loaded, re-assigned the same scheme, and saved again — a no-op second write. Removed `attachScheme` call; specialist IDs are now persisted directly via `addGoal`'s initial save (since `buildSchemeSpecialists` mutates the scheme in-place before the first save).

**File**: `src/alienclaw/governance/governance-loop.ts`

### Bug 31: Dead `failureContext` parameter in `buildEmployeeSpec` ✅ FIXED

`failureContext?: string` was declared but never used — the `void failureContext` placeholder was a no-op. Removed the parameter and its `void` statement.

**File**: `src/alienclaw/agents/creatorbot.ts`

### Bug 32: `String(err)` instead of `errorMessage(err)` in legacy job catch handlers ✅ FIXED

Both legacy sub-goal job paths in GovernanceLoop used `String(err)` which produces noisy `"Error: <message>"` output. Replaced with the centralized `errorMessage(err)` utility.

**File**: `src/alienclaw/governance/governance-loop.ts`

### Bug 33: Missing `dispatchReadySubGoals` after re-opening items ✅ FIXED

When AdvisorBot flagged gaps and items were re-opened to `pending`, only `dispatchReadyCampaigns` was called — legacy sub-goals among the reopenIds would never be re-dispatched. Added missing `dispatchReadySubGoals(goalId)` call.

**File**: `src/alienclaw/governance/governance-loop.ts`

### Bug 34: Dead `direction` variable in `handleFailure` ✅ FIXED

`handleFailure` built a `direction` string and passed it as the 5th argument to `buildEmployeeSpec`, but that function only accepts 4 parameters — `direction` was silently discarded. Removed the dead variable and its comment.

**File**: `src/alienclaw/governance/escalation-handler.ts`

### Bug 35: Dead `void brain` no-op in `invokeToolWithRetry` ✅ FIXED

`invokeToolWithRetry` had `void brain;` — a pure no-op to suppress an unused-variable warning. Renamed parameter to `_brain` per TypeScript convention for intentionally unused parameters.

**File**: `src/alienclaw/msb/martian-executor.ts`

### Bug 36: Dead `buildAdviceRequest` method in BossBot ✅ FIXED

`buildAdviceRequest(context, question)` was defined but never called anywhere — callers inline the object construction. Removed the dead method.

**File**: `src/alienclaw/agents/bossbot.ts`

### Bug 37: Dead `receiveSubagentReport` method in CreatorBot ✅ FIXED

`receiveSubagentReport` was defined but never called — the active method is `receiveMartianReport`. Removed the dead method.

**File**: `src/alienclaw/agents/creatorbot.ts`

### Bug 38: Missing `errorMessage` import in `ms-loader.ts` ✅ FIXED

`loadMsDirectory()` called `errorMessage(err)` at line 227 but the import was missing — would throw `ReferenceError` at runtime when any `.ms` file fails to parse during registry bootstrap. Added `import { errorMessage } from '../utils.js'`.

**File**: `src/alienclaw/registry/ms-loader.ts`

### Bug 39: N+1 file I/O in `resumeGoal` ✅ FIXED

Crash recovery loop called `updateCampaign`/`updateSubGoal` sequentially — each doing a full `load() + save()` cycle. Changed to in-memory mutation with a single conditional `save()` when dirty.

**File**: `src/alienclaw/governance/governance-loop.ts`

### Bug 40: Dead `getState()` public method in GovernanceLoop ✅ FIXED

`getState()` was defined public but never called externally (all internal callers use `this.state` directly). Removed the dead method.

**File**: `src/alienclaw/governance/governance-loop.ts`

---

## Known Limitations

### 1. Employee/in-memory state not persisted across restarts

`resumeGoal` rebuilds specialists from the stored scheme, but in-memory Employee objects (with their accumulated context per campaign run) aren't persisted. Crash recovery works but starts fresh — no accumulated state survives a full process restart.

### 2. Campaign summary not shown to AdvisorBot during review ✅ FIXED

`completionHandler.review()` now sends both legacy `subGoals` and `scheme.campaigns` to AdvisorBot for review. The reopen logic also correctly selects the first incomplete campaign or sub-goal.

**File**: `src/alienclaw/governance/completion-handler.ts`

### 3. Meeseeks → Martian rename not committed

The full rename of "Meeseeks" to "Martian" across all files is unstaged. The rename is complete and functional but has not been committed.

---

## Test Commands

```bash
# End-to-end test (fresh state)
rm ~/.alienclaw/workspace/goals.json
ANTHROPIC_API_KEY="${ANTHROPIC_AUTH_TOKEN}" node --import tsx test-alienclaw.mjs

# Build alienclaw package
pnpm build:alienclaw
```

---

## File Owners

| File | Purpose |
|------|---------|
| `src/alienclaw/registry/ms-loader.ts` | .ms genome file parser |
| `src/alienclaw/registry/registry.ts` | Sync singleton registry (hot path) |
| `src/alienclaw/registry/martian-registry.ts` | Async registry (bootstrap) |
| `src/alienclaw/msb/martian-executor.ts` | Martian execution engine |
| `src/alienclaw/governance/governance-loop.ts` | State machine + campaign dispatch |
| `src/alienclaw/governance/completion-handler.ts` | AdvisorBot review + user signoff |
| `src/alienclaw/agents/bossbot.ts` | Executive — drafts schemes |
| `src/alienclaw/agents/creatorbot.ts` | Builder — builds specialists |
| `src/alienclaw/agents/employee.ts` | Specialist — summons Martians |
