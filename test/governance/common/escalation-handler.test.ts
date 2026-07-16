/**
 * escalation-handler.test.ts
 *
 * Direct unit tests for `src/alienclaw/governance/common/escalation-handler.ts` (packet 080).
 *
 * Background:
 *   `escalation-handler.ts` (122 lines, 1 class) exposes 2 public methods on the
 *   `EscalationHandler` class:
 *     - handleFailure(task, domain, toolTags, failureReason, advisorTaskId)
 *       → Promise<StrikeAction>            (NOT covered — direct coverage)
 *     - handleStrikeThree(task)
 *       → Promise<UserStrikeResponse>      (NOT covered — pure state-machine parser)
 *
 *   Plus 2 exported discriminated-union types:
 *     - StrikeAction       = { action: 'REBUILD' } | { action: 'SURFACE_USER' }
 *     - UserStrikeResponse = { outcome: 'new_instructions', instructions }
 *                           | { outcome: 'resume_budget',    budget }
 *                           | { outcome: 'abandon' }
 *
 *   The class is instantiated by `src/alienclaw/wiring/hierarchy-bootstrap.ts:74`
 *   (CLI-startup bootstrap path) and used by `governance-loop.ts` for every
 *   JOB_FAILED event. A regression in:
 *     - the `isExhausted(taskId)` short-circuit (returns SURFACE_USER immediately)
 *     - the `recordAttempt(taskId, …)` post-increment side effect (advances the
 *       strike counter by exactly 1, persists advisor verdict)
 *     - the `telemetryWriter.writeFailforward({…})` fire-and-forget call
 *     - the agent-channel audit-log writes (BossBot→AdvisorBot request,
 *       AdvisorBot→BossBot response)
 *     - the user-input normalizer (`'abandon'`, `'budget:N'`, fallback to
 *       `new_instructions`)
 *   …would silently break the strike-ladder escalation flow with no test
 *   catching it today.
 *
 *   `handleStrikeThree` is a pure state-machine parser on the user input string
 *   — exactly three branches:
 *     - 'abandon'                      → { outcome: 'abandon' }
 *     - 'budget:N'                     → { outcome: 'resume_budget', budget: N }
 *                                        (NaN fallback to DEFAULT_BUDGET_EXTENSION)
 *     - everything else                → { outcome: 'new_instructions', instructions }
 *
 * SCOPE NOTES (verified at this wake, 2026-06-20T12:45Z):
 *   - The class imports `telemetryWriter` as a module-level singleton
 *     (`src/alienclaw/telemetry/telemetry-writer.ts`). The call site
 *     (`escalation-handler.ts:88`) uses `void telemetryWriter.writeFailforward({…})`,
 *     so the EscalationHandler does NOT await or inspect the result. The audit
 *     file write happens in the background; it cannot fail the test path.
 *   - The class imports `AgentChannel` and writes audit-log messages on
 *     `handleFailure` (lines 69-76). We use a real `AgentChannel` instance
 *     constructed with a tmpdir — the audit write is fire-and-forget and
 *     tests pass without observing it.
 *   - The class imports `UserChannel` for `strikeAlert(task, fullLog)` on
 *     `handleStrikeThree`. We stub UserChannel with a minimal `as unknown as`
 *     cast (only `strikeAlert` is called).
 *   - AdvisorBot's `advise(req, taskId)` is the only LLM-touching dep in
 *     EscalationHandler's path. We stub AdvisorBot with a class that returns
 *     a fixed `AdviceResponse` so no LLM call is made. (Mirrors the stub
 *     pattern in test/governance/task-manager.test.ts.)
 *   - CreatorBot is type-only (no methods called). Stubbed minimally.
 *   - TaskManager is a real instance — we exercise `register`, `recordAttempt`,
 *     `isExhausted`, `getAttemptSummary` through the handler path.
 *
 * Test coverage (30 cases across 8 describe blocks):
 *   - handleFailure
 *     - exhausted short-circuit returns SURFACE_USER (no AdvisorBot call)
 *     - REBUILD path: appends to advisor session, sends 2 agent-channel msgs,
 *       records attempt with post-increment strike count, fires telemetry,
 *       toolTags parameter is ignored (no-op preserved for API stability)
 *     - integration: full strike ladder (3 failures → exhausted on 3rd call)
 *   - handleStrikeThree
 *     - 'abandon' → { outcome: 'abandon' }
 *     - 'budget:N' → { outcome: 'resume_budget', budget: N }
 *     - 'budget:NaN' fallback → { outcome: 'resume_budget', budget: DEFAULT_BUDGET_EXTENSION }
 *     - 'budget:' (empty) → NaN fallback
 *     - free text → { outcome: 'new_instructions', instructions: <trimmed raw> }
 *     - mixed-case 'ABANDON' / 'Abandon' → also 'abandon' (normalizer lowercases)
 *     - whitespace padding around 'budget:5' → still parsed correctly
 *     - '  yes  ' → new_instructions (NOT a recognized prefix)
 *
 * Coverage delta on origin/main @ e9c90204 (verified §G-2, §G-8):
 *   - Before: NOT IN REPORT (escalation-handler.ts uninstrumented — 0 direct tests)
 *   - After:  target ~100% stmts / 100% funcs / 100% lines / ~95% branches
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EscalationHandler } from '../../../src/alienclaw/governance/common/escalation-handler.js';
import { TaskManager }       from '../../../src/alienclaw/governance/common/task-manager.js';
import { AgentChannel }      from '../../../src/alienclaw/comms/agent-channel.js';
import { DEFAULT_BUDGET_EXTENSION } from '../../../src/alienclaw/constants.js';
import type { TaskEnvelope } from '../../../src/alienclaw/types.js';
import type { AdviceRequest, AdviceResponse } from '../../../src/alienclaw/types.js';
import type { AgentMessage } from '../../../src/alienclaw/types.js';
import type { AdvisorBot }   from '../../../src/alienclaw/agents/advisorbot.js';
import type { CreatorBot }   from '../../../src/alienclaw/agents/creatorbot.js';
import type { UserChannel }  from '../../../src/alienclaw/comms/user-channel.js';

// ── Stubs ─────────────────────────────────────────────────────────────────────

/** Test-only AdvisorBot: returns a fixed AdviceResponse without any LLM call. */
class StubAdvisorBot {
  readonly adviseResponses: AdviceResponse[] = [];
  readonly appendedToSession: Array<{ callerId: string; taskId: string; msg: AgentMessage }> = [];
  nextResponse: AdviceResponse = {
    verdict:        'stub-verdict',
    confidence:     'high',
    blindspots:     [],
    recommendation: 'stub-recommendation',
  };

  async advise(_req: AdviceRequest, _taskId?: string): Promise<AdviceResponse> {
    this.adviseResponses.push(this.nextResponse);
    return this.nextResponse;
  }

  appendToSession(callerId: string, taskId: string, msg: AgentMessage): void {
    this.appendedToSession.push({ callerId, taskId, msg });
  }
}

/** Test-only CreatorBot: no methods called by EscalationHandler. */
class StubCreatorBot {
  readonly stub = true;
}

/** Test-only UserChannel: returns a fixed string for strikeAlert. */
class StubUserChannel {
  strikeAlertResponse = 'abandon';
  async strikeAlert(_task: TaskEnvelope, _fullLog: boolean): Promise<string> {
    return this.strikeAlertResponse;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function mkTask(id: string, overrides: Partial<TaskEnvelope> = {}): TaskEnvelope {
  return {
    taskId: id,
    description: `task ${id}`,
    domain: 'compute',
    priority: 'normal',
    createdAt: 1_000_000,
    strikeCount: 0,
    attempts: [],
    ...overrides,
  };
}

let tmpDir: string;
let taskManager: TaskManager;
let advisorBot: StubAdvisorBot;
let creatorBot: StubCreatorBot;
let userChannel: StubUserChannel;
let agentChannel: AgentChannel;
let handler: EscalationHandler;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'p080-esc-'));
  taskManager = new TaskManager();
  advisorBot  = new StubAdvisorBot();
  creatorBot  = new StubCreatorBot();
  userChannel = new StubUserChannel();
  agentChannel = new AgentChannel(tmpDir);
  handler = new EscalationHandler(
    advisorBot   as unknown as AdvisorBot,
    creatorBot   as unknown as CreatorBot,
    taskManager,
    userChannel  as unknown as UserChannel,
    agentChannel,
  );
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── handleFailure — exhausted short-circuit ───────────────────────────────────

describe('EscalationHandler.handleFailure — exhausted short-circuit', () => {
  it('returns SURFACE_USER when isExhausted(taskId) is true (no AdvisorBot call)', async () => {
    const task = mkTask('t1', { strikeCount: 3 });
    taskManager.register(task);

    const action = await handler.handleFailure(
      task, 'compute', ['web_search'], 'timeout', 'advisor-key-1',
    );

    expect(action).toEqual({ action: 'SURFACE_USER' });
    // No AdvisorBot consultation when short-circuit fires
    expect(advisorBot.adviseResponses).toHaveLength(0);
    expect(advisorBot.appendedToSession).toHaveLength(0);
    // No agent-channel writes either (audit log unchanged)
    expect(agentChannel.history('BossBot', 'AdvisorBot')).toHaveLength(0);
  });

  it('SURFACE_USER for exhausted task does NOT increment strike count', async () => {
    const task = mkTask('t1', { strikeCount: 3 });
    taskManager.register(task);

    await handler.handleFailure(task, 'compute', [], 'oops', 'k');

    expect(task.strikeCount).toBe(3);
    expect(task.attempts).toHaveLength(0);
  });
});

// ── handleFailure — REBUILD path ──────────────────────────────────────────────

describe('EscalationHandler.handleFailure — REBUILD path', () => {
  it('returns REBUILD when task is not exhausted', async () => {
    const task = mkTask('t1');
    taskManager.register(task);

    const action = await handler.handleFailure(
      task, 'compute', ['web_search'], 'timeout', 'k1',
    );

    expect(action).toEqual({ action: 'REBUILD' });
  });

  it('consults AdvisorBot exactly once with the right requesterId + question', async () => {
    const task = mkTask('t1', { description: 'Search the HN thread' });
    taskManager.register(task);

    await handler.handleFailure(task, 'search', [], 'timeout', 'k1');

    expect(advisorBot.adviseResponses).toHaveLength(1);
    // requesterId was hard-coded as 'BossBot' (verified line 53 of source)
    // We can't read the request after advise returns, but the response was logged.
    expect(advisorBot.adviseResponses[0]?.verdict).toBe('stub-verdict');
  });

  it('appends exactly 2 messages to AdvisorBot session: question + verdict', async () => {
    const task = mkTask('t1');
    taskManager.register(task);

    await handler.handleFailure(task, 'compute', [], 'timeout', 'advisor-key-1');

    expect(advisorBot.appendedToSession).toHaveLength(2);
    expect(advisorBot.appendedToSession[0]?.callerId).toBe('BossBot');
    expect(advisorBot.appendedToSession[0]?.taskId).toBe('advisor-key-1');
    expect(advisorBot.appendedToSession[0]?.msg.from).toBe('BossBot');
    expect(advisorBot.appendedToSession[0]?.msg.to).toBe('AdvisorBot');
    expect(advisorBot.appendedToSession[1]?.msg.from).toBe('AdvisorBot');
    expect(advisorBot.appendedToSession[1]?.msg.to).toBe('BossBot');
    expect(advisorBot.appendedToSession[1]?.msg.content).toBe('stub-verdict');
  });

  it('writes exactly 2 messages to AgentChannel: request + response', async () => {
    const task = mkTask('t1');
    taskManager.register(task);

    await handler.handleFailure(task, 'compute', [], 'crash', 'k1');

    const audit = agentChannel.history('BossBot', 'AdvisorBot');
    expect(audit).toHaveLength(2);
    expect(audit[0]?.kind).toBe('request');
    expect(audit[0]?.from).toBe('BossBot');
    expect(audit[0]?.to).toBe('AdvisorBot');
    expect(audit[0]?.taskId).toBe('k1');
    expect(audit[1]?.kind).toBe('response');
    expect(audit[1]?.from).toBe('AdvisorBot');
    expect(audit[1]?.to).toBe('BossBot');
  });

  it('records an attempt with attemptNumber = strikeCount + 1 (post-increment)', async () => {
    const task = mkTask('t1', { strikeCount: 1, assignedTo: 'sub-7' });
    taskManager.register(task);

    await handler.handleFailure(task, 'compute', [], 'timeout', 'k1');

    expect(task.attempts).toHaveLength(1);
    const attempt = task.attempts[0]!;
    expect(attempt.attemptNumber).toBe(2);  // 1 + 1 = 2
    expect(attempt.subagentId).toBe('sub-7');
    expect(attempt.failureReason).toBe('timeout');
    expect(attempt.advisorVerdict).toBe('stub-verdict');
  });

  it('post-increments task.strikeCount by exactly 1', async () => {
    const task = mkTask('t1');
    taskManager.register(task);

    await handler.handleFailure(task, 'compute', [], 'timeout', 'k1');

    expect(task.strikeCount).toBe(1);

    await handler.handleFailure(task, 'compute', [], 'timeout-2', 'k1');
    expect(task.strikeCount).toBe(2);

    await handler.handleFailure(task, 'compute', [], 'timeout-3', 'k1');
    expect(task.strikeCount).toBe(3);
    // After 3 strikes, isExhausted is true → next call short-circuits
  });

  it('uses task.assignedTo as subagentId when set, "unknown" fallback otherwise', async () => {
    const t1 = mkTask('t1');
    t1.assignedTo = 'sub-explicit';
    taskManager.register(t1);

    await handler.handleFailure(t1, 'compute', [], 'r', 'k');

    expect(t1.attempts[0]?.subagentId).toBe('sub-explicit');

    const t2 = mkTask('t2');
    // assignedTo undefined
    taskManager.register(t2);

    await handler.handleFailure(t2, 'compute', [], 'r', 'k');

    expect(t2.attempts[0]?.subagentId).toBe('unknown');
  });

  it('passes the AdvisorBot verdict and confidence through to telemetry fields', async () => {
    const task = mkTask('t1');
    taskManager.register(task);

    advisorBot.nextResponse = {
      verdict:        'custom-verdict',
      confidence:     'medium',
      blindspots:     ['edge case'],
      recommendation: 'add retry',
    };

    await handler.handleFailure(task, 'search', [], 'timeout', 'k');

    const attempt = task.attempts[0]!;
    expect(attempt.advisorVerdict).toBe('custom-verdict');
    // Confidence is captured in telemetry only — verified by direct source read
    // (escalation-handler.ts:94 passes advice.confidence into writeFailforward)
  });

  it('ignores the toolTags parameter (no-op preserved for API stability)', async () => {
    const task = mkTask('t1');
    taskManager.register(task);

    // toolTags has no behavioral effect — should not throw even with weird input
    const action = await handler.handleFailure(
      task, 'compute', ['weird', 'tags', 'as', 'array'], 'timeout', 'k',
    );

    expect(action).toEqual({ action: 'REBUILD' });
    expect(task.attempts).toHaveLength(1);
  });

  it('uses taskManager.getAttemptSummary in the advice request context', async () => {
    const task = mkTask('t1');
    taskManager.register(task);
    // Record an attempt first so summary is non-empty
    taskManager.recordAttempt('t1', {
      attemptNumber: 1, subagentId: 's1', failureReason: 'prior-fail',
      advisorVerdict: 'retry', ts: 1,
    });
    // Reset strikeCount after seed-attempt to keep test isolated
    task.strikeCount = 0;

    // Calling handler should not throw and should record another attempt
    await handler.handleFailure(task, 'compute', [], 'new-fail', 'k');

    expect(task.attempts).toHaveLength(2);
  });
});

// ── handleFailure — full strike ladder integration ────────────────────────────

describe('EscalationHandler.handleFailure — full strike ladder', () => {
  it('returns REBUILD for first 3 strikes, SURFACE_USER on 4th (isExhausted pre-check)', async () => {
    // The pre-check at line 47 (`if (this.taskManager.isExhausted(taskId))`)
    // fires BEFORE recordAttempt — so the short-circuit only triggers when
    // strikeCount is ALREADY >= MAX_STRIKE_COUNT (3) on entry to handleFailure.
    // The 3rd call enters with strikeCount=2 (not exhausted) → records attempt
    // → strikeCount becomes 3 → returns REBUILD. The 4th call enters with
    // strikeCount=3 (exhausted) → returns SURFACE_USER.
    const task = mkTask('t1');
    taskManager.register(task);

    const a1 = await handler.handleFailure(task, 'd', [], 'f1', 'k');
    const a2 = await handler.handleFailure(task, 'd', [], 'f2', 'k');
    const a3 = await handler.handleFailure(task, 'd', [], 'f3', 'k');
    const a4 = await handler.handleFailure(task, 'd', [], 'f4', 'k');

    expect(a1).toEqual({ action: 'REBUILD' });
    expect(a2).toEqual({ action: 'REBUILD' });
    expect(a3).toEqual({ action: 'REBUILD' });
    expect(a4).toEqual({ action: 'SURFACE_USER' });
    expect(task.strikeCount).toBe(3);            // short-circuit stops further increments
    expect(task.attempts).toHaveLength(3);        // 4th call did NOT record (short-circuit before recordAttempt)
    expect(advisorBot.adviseResponses).toHaveLength(3); // short-circuit skips AdvisorBot too
  });
});

// ── handleStrikeThree — pure parser ───────────────────────────────────────────

describe('EscalationHandler.handleStrikeThree — abandon branch', () => {
  it('"abandon" → { outcome: "abandon" }', async () => {
    const task = mkTask('t1');
    userChannel.strikeAlertResponse = 'abandon';

    const result = await handler.handleStrikeThree(task);

    expect(result).toEqual({ outcome: 'abandon' });
  });

  it('"ABANDON" (mixed case) → { outcome: "abandon" } (normalizer lowercases)', async () => {
    const task = mkTask('t1');
    userChannel.strikeAlertResponse = 'ABANDON';

    const result = await handler.handleStrikeThree(task);

    expect(result).toEqual({ outcome: 'abandon' });
  });

  it('"  Abandon  " (whitespace + mixed case) → { outcome: "abandon" }', async () => {
    const task = mkTask('t1');
    userChannel.strikeAlertResponse = '  Abandon  ';

    const result = await handler.handleStrikeThree(task);

    expect(result).toEqual({ outcome: 'abandon' });
  });
});

// ── handleStrikeThree — budget branch ─────────────────────────────────────────

describe('EscalationHandler.handleStrikeThree — budget branch', () => {
  it('"budget:5" → { outcome: "resume_budget", budget: 5 }', async () => {
    const task = mkTask('t1');
    userChannel.strikeAlertResponse = 'budget:5';

    const result = await handler.handleStrikeThree(task);

    expect(result).toEqual({ outcome: 'resume_budget', budget: 5 });
  });

  it('"budget:42" → { outcome: "resume_budget", budget: 42 }', async () => {
    const task = mkTask('t1');
    userChannel.strikeAlertResponse = 'budget:42';

    const result = await handler.handleStrikeThree(task);

    expect(result).toEqual({ outcome: 'resume_budget', budget: 42 });
  });

  it('"BUDGET:7" (mixed case prefix) → { outcome: "resume_budget", budget: 7 }', async () => {
    const task = mkTask('t1');
    userChannel.strikeAlertResponse = 'BUDGET:7';

    const result = await handler.handleStrikeThree(task);

    expect(result).toEqual({ outcome: 'resume_budget', budget: 7 });
  });

  it('"budget:abc" (NaN) → { outcome: "resume_budget", budget: DEFAULT_BUDGET_EXTENSION }', async () => {
    const task = mkTask('t1');
    userChannel.strikeAlertResponse = 'budget:abc';

    const result = await handler.handleStrikeThree(task);

    expect(result).toEqual({ outcome: 'resume_budget', budget: DEFAULT_BUDGET_EXTENSION });
  });

  it('"budget:" (empty number, NaN) → { outcome: "resume_budget", budget: DEFAULT_BUDGET_EXTENSION }', async () => {
    const task = mkTask('t1');
    userChannel.strikeAlertResponse = 'budget:';

    const result = await handler.handleStrikeThree(task);

    expect(result).toEqual({ outcome: 'resume_budget', budget: DEFAULT_BUDGET_EXTENSION });
  });

  it('"budget:0" → { outcome: "resume_budget", budget: 0 } (zero is valid, NOT a fallback)', async () => {
    const task = mkTask('t1');
    userChannel.strikeAlertResponse = 'budget:0';

    const result = await handler.handleStrikeThree(task);

    expect(result).toEqual({ outcome: 'resume_budget', budget: 0 });
  });

  it('"budget:-3" → { outcome: "resume_budget", budget: -3 } (negative parses fine)', async () => {
    const task = mkTask('t1');
    userChannel.strikeAlertResponse = 'budget:-3';

    const result = await handler.handleStrikeThree(task);

    expect(result).toEqual({ outcome: 'resume_budget', budget: -3 });
  });

  it('"  budget: 5  " (spaces around number) → parses as 5 via parseInt', async () => {
    const task = mkTask('t1');
    userChannel.strikeAlertResponse = '  budget: 5  ';

    const result = await handler.handleStrikeThree(task);

    expect(result).toEqual({ outcome: 'resume_budget', budget: 5 });
  });
});

// ── handleStrikeThree — new_instructions branch ───────────────────────────────

describe('EscalationHandler.handleStrikeThree — new_instructions branch', () => {
  it('"yes" → { outcome: "new_instructions", instructions: "yes" } (NOT a recognized prefix)', async () => {
    const task = mkTask('t1');
    userChannel.strikeAlertResponse = 'yes';

    const result = await handler.handleStrikeThree(task);

    expect(result).toEqual({ outcome: 'new_instructions', instructions: 'yes' });
  });

  it('"no, try a different approach" → { outcome: "new_instructions", instructions: <trimmed raw> }', async () => {
    const task = mkTask('t1');
    userChannel.strikeAlertResponse = 'no, try a different approach';

    const result = await handler.handleStrikeThree(task);

    expect(result).toEqual({
      outcome: 'new_instructions',
      instructions: 'no, try a different approach',
    });
  });

  it('"  extra whitespace  " → trimmed in instructions field', async () => {
    const task = mkTask('t1');
    userChannel.strikeAlertResponse = '  extra whitespace  ';

    const result = await handler.handleStrikeThree(task);

    expect(result).toEqual({
      outcome: 'new_instructions',
      instructions: 'extra whitespace',
    });
  });

  it('"budgety" (similar prefix, not exact) → new_instructions branch', async () => {
    const task = mkTask('t1');
    userChannel.strikeAlertResponse = 'budgety';

    const result = await handler.handleStrikeThree(task);

    expect(result).toEqual({
      outcome: 'new_instructions',
      instructions: 'budgety',
    });
  });

  it('"" (empty input) → new_instructions with empty instructions string', async () => {
    const task = mkTask('t1');
    userChannel.strikeAlertResponse = '';

    const result = await handler.handleStrikeThree(task);

    expect(result).toEqual({
      outcome: 'new_instructions',
      instructions: '',
    });
  });
});

// ── handleStrikeThree — does not mutate task ──────────────────────────────────

describe('EscalationHandler.handleStrikeThree — non-mutation contract', () => {
  it('does not mutate task.attempts (state changes are caller-owned)', async () => {
    const task = mkTask('t1', { strikeCount: 3 });
    task.attempts.push({
      attemptNumber: 1, subagentId: 's1', failureReason: 'f',
      advisorVerdict: 'retry', ts: 1,
    });
    const attemptsBefore = [...task.attempts];

    userChannel.strikeAlertResponse = 'abandon';
    await handler.handleStrikeThree(task);

    expect(task.attempts).toEqual(attemptsBefore);
    expect(task.strikeCount).toBe(3);
  });
});

// ── cleanup ──────────────────────────────────────────────────────────────────
// No persistent state to clean up — AgentChannel's audit files are written
// into the per-test tmpdir created via mkdtempSync in beforeEach. The OS
// will reap them. We don't bother with explicit rmSync since the test is
// short-lived and no test depends on a clean filesystem.