/**
 * governance-loop-completion.test.ts
 *
 * Direct unit tests for the `runCompletionFlow` state-transition path in
 * `src/alienclaw/governance/common/governance-loop.ts` (packet 094-R&D-IMPL,
 * LAYERED implementation of tester's findings-only packet 094).
 *
 * Background:
 *   `governance-loop.ts` (782 lines, 1 class `GovernanceLoop`) exposes a
 *   private `runCompletionFlow(goalId: string): Promise<void>` (line 617)
 *   that orchestrates the final completion review with AdvisorBot.
 *
 *   The flow (line 617-647, verified at this wake):
 *     1. Flush notable items from CreatorBot (line 619-624)
 *     2. Transition to REVIEWING_COMPLETION (line 626)
 *     3. Call `completionHandler.review(goalId)` (line 627)
 *     4. If `review.proceed === false` (AdvisorBot flagged gaps):
 *        - Reopen each id in `review.reopenIds` via GoalManager (lines 631-640)
 *        - Re-dispatch ready campaigns + sub-goals (lines 645-646)
 *     5. If `review.proceed === true`: transition to AWAITING_USER_SIGNOFF
 *        (line 649) and call `completionHandler.promptSignoff(goalId)`.
 *
 *   The pre-fix state-machine table (line 34, before this packet) had:
 *     REVIEWING_COMPLETION: ['AWAITING_USER_SIGNOFF']
 *   The pre-fix code (line 641) called:
 *     this.transition('AWAITING_ADVICE', 'AdvisorBot flagged gaps');
 *   But `AWAITING_ADVICE` was NOT in `VALID_TRANSITIONS['REVIEWING_COMPLETION']`.
 *   The `transition()` method (line 168) throws unconditionally when the
 *   target is not in the allowed list:
 *     throw new Error(`[GovernanceLoop] Invalid transition: ${this.state} → ${to} (${reason})`);
 *
 *   Therefore: every time `completionHandler.review()` returns `{ proceed: false }`,
 *   the governance loop throws inside `runCompletionFlow` (line 641), crashes
 *   the `drain()` loop, and silently fails the gap-found completion path.
 *
 *   `CompletionHandler.review()` can return `{ proceed: false, reopenIds: [...] }`
 *   in two scenarios (completion-handler.ts line 89-96):
 *     - AdvisorBot returned a "low" confidence verdict
 *     - The goal's first incomplete sub-goal OR campaign is not "complete"
 *   3 existing tests in `test/governance/common/completion-handler.test.ts`
 *   exercise this return (lines 201, 215, 232, 243).
 *
 *   However, the caller-level integration in `GovernanceLoop.runCompletionFlow`
 *   was ENTIRELY UNCOVERED before this packet (verified — `grep -r
 *   "runCompletionFlow\|REVIEWING_COMPLETION" test/` returns 0 hits in
 *   GovernanceLoop-level tests). The integration tests that reference
 *   GovernanceLoop are skipped in CI (require `ANTHROPIC_API_KEY`). So the
 *   crash was invisible to the ship-gate.
 *
 *   This packet's fix:
 *     1. `governance-loop.ts:34` — add `'EXECUTING'` to
 *        `VALID_TRANSITIONS['REVIEWING_COMPLETION']`:
 *          REVIEWING_COMPLETION: ['AWAITING_USER_SIGNOFF', 'EXECUTING'],
 *     2. `governance-loop.ts:641` — remove the redundant intermediate
 *        `transition('AWAITING_ADVICE', ...)` call (it was unreachable from
 *        `REVIEWING_COMPLETION` and unnecessary — `completionHandler.review()`
 *        already consulted AdvisorBot internally). Replace with a single
 *        `transition('EXECUTING', 'AdvisorBot flagged gaps — re-dispatching')`.
 *
 *   This packet is LAYERED on the tester's findings-only packet 094
 *   (`~/v3x-overmind/managers/alienclaw/packets/094-governance-loop-invalid-transition-on-review-gap.md`,
 *   filed 2026-06-21T00:35:57Z). The tester was rate-capped (≥3 open PRs) and
 *   filed as a CANDIDATE finding only. This packet is the IMPLEMENTATION:
 *   actual source change + companion regression test.
 *
 * Test design:
 *   - We invoke the private `runCompletionFlow` directly via bracket access
 *     (`loop['runCompletionFlow'](...)`). This is a TypeScript escape hatch
 *     that is explicitly allowed for testing private members (the standard
 *     pattern across the AlienClaw test suite for this codebase).
 *   - We override the loop's private `state` field via bracket access to
 *     `EXECUTING` (the state from which `runCompletionFlow` is normally
 *     invoked — verified at line 423/439, the call sites are reached from
 *     `handleJobComplete` after a `JOB_COMPLETE` event). This is also a
 *     testing-only accessor; production code never mutates state directly.
 *   - We hook `addTransitionHook` to observe the final state of the loop
 *     after `runCompletionFlow` returns.
 *   - All 11 GovernanceLoop dependencies are stubbed with `vi.fn()`. No
 *     real LLM, no real DB, no real filesystem.
 *
 * Wall discipline: the test exercises the BUG, not the FIX. The test is
 * identical regardless of whether the fix is applied (it asserts the
 * contract: "runCompletionFlow must not throw when review.proceed === false
 * and must end in EXECUTING"). On origin/main (no fix), the test FAILS with
 * the documented error; with the fix, the test PASSES.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  GovernanceLoop,
} from '../../src/alienclaw/governance/common/governance-loop.js';
import type { GovernanceLoopDeps } from '../../src/alienclaw/governance/common/governance-loop.js';
import type { GovernanceState } from '../../src/alienclaw/types.js';
import type { CompletionReview } from '../../src/alienclaw/governance/common/completion-handler.js';
import type { MartianSummonAdapter } from '../../src/alienclaw/governance/common/summon-adapter.js';

// ── Stub factories ────────────────────────────────────────────────────────────

interface CreatorBotStub {
  flushNotable: ReturnType<typeof vi.fn>;
  queueSpec:    ReturnType<typeof vi.fn>;
  buildSubagentsForCampaign: ReturnType<typeof vi.fn>;
  cancel:       ReturnType<typeof vi.fn>;
  cancelAll:    ReturnType<typeof vi.fn>;
  jobCount:     ReturnType<typeof vi.fn>;
}

interface UserChannelStub {
  status:  ReturnType<typeof vi.fn>;
  required: ReturnType<typeof vi.fn>;
  verbose: ReturnType<typeof vi.fn>;
  prompt:  ReturnType<typeof vi.fn>;
}

interface CompletionHandlerStub {
  review:        ReturnType<typeof vi.fn>;
  promptSignoff: ReturnType<typeof vi.fn>;
}

interface GoalManagerStub {
  load:               ReturnType<typeof vi.fn>;
  save:               ReturnType<typeof vi.fn>;
  addGoal:            ReturnType<typeof vi.fn>;
  updateSubGoal:      ReturnType<typeof vi.fn>;
  updateGoal:         ReturnType<typeof vi.fn>;
  updateCampaign:     ReturnType<typeof vi.fn>;
  getReadySubGoals:   ReturnType<typeof vi.fn>;
  getReadyCampaigns:  ReturnType<typeof vi.fn>;
  isGoalComplete:     ReturnType<typeof vi.fn>;
  isSchemeComplete:   ReturnType<typeof vi.fn>;
  foldUserInput:      ReturnType<typeof vi.fn>;
  markGoalComplete:   ReturnType<typeof vi.fn>;
  attachScheme:       ReturnType<typeof vi.fn>;
}

function makeCreatorBot(): CreatorBotStub {
  return {
    flushNotable:            vi.fn().mockReturnValue([]),
    queueSpec:               vi.fn(),
    buildSubagentsForCampaign: vi.fn(),
    cancel:                  vi.fn(),
    cancelAll:               vi.fn(),
    jobCount:                vi.fn().mockReturnValue(0),
  };
}

function makeUserChannel(): UserChannelStub {
  return {
    status:   vi.fn(),
    required: vi.fn(),
    verbose:  vi.fn(),
    prompt:   vi.fn(),
  };
}

function makeCompletionHandler(reviewResult: CompletionReview, signoffResult?: { approved: true } | { approved: false; instructions: string }): CompletionHandlerStub {
  return {
    review:        vi.fn().mockResolvedValue(reviewResult),
    promptSignoff: vi.fn().mockResolvedValue(signoffResult ?? { approved: true }),
  };
}

function makeGoalManager(): GoalManagerStub {
  return {
    load:              vi.fn().mockReturnValue({ goals: [] }),
    save:              vi.fn(),
    addGoal:           vi.fn(),
    updateSubGoal:     vi.fn().mockResolvedValue(undefined),
    updateGoal:        vi.fn().mockResolvedValue(undefined),
    updateCampaign:    vi.fn().mockResolvedValue(undefined),
    getReadySubGoals:  vi.fn().mockReturnValue([]),
    getReadyCampaigns: vi.fn().mockReturnValue([]),
    isGoalComplete:    vi.fn().mockReturnValue(false),
    isSchemeComplete:  vi.fn().mockReturnValue(false),
    foldUserInput:     vi.fn().mockResolvedValue(undefined),
    markGoalComplete:  vi.fn().mockResolvedValue(undefined),
    attachScheme:      vi.fn(),
  };
}

interface NoopStub {
  [k: string]: ReturnType<typeof vi.fn> | undefined;
}

function makeNoopStub(): NoopStub {
  // Generic stub for dependencies that runCompletionFlow does NOT exercise.
  // Each method is a vi.fn() so any accidental call during the test
  // (which would be a regression) is captured.
  return new Proxy({}, {
    get(_t, prop) {
      if (typeof prop === 'symbol') return undefined;
      return vi.fn();
    },
  }) as NoopStub;
}

function makeAdapter(): MartianSummonAdapter {
  // Not exercised in runCompletionFlow. Use a deterministic noop.
  return {
    summon: vi.fn().mockResolvedValue({
      summon_id: 'noop',
      ok: true,
      output: { noop: true },
      fitness: 0.0,
      run_metadata: { tool_calls: 0, wall_clock_ms: 0 },
    }),
  };
}

interface LoopHarness {
  loop: GovernanceLoop;
  state: { current: GovernanceState };
  completionHandler: CompletionHandlerStub;
  goalManager: GoalManagerStub;
  userChannel: UserChannelStub;
  creatorBot: CreatorBotStub;
}

function makeLoop(
  reviewResult: CompletionReview,
  options: {
    goalManager?: GoalManagerStub;
    signoffResult?: { approved: true } | { approved: false; instructions: string };
  } = {},
): LoopHarness {
  const state = { current: 'EXECUTING' as GovernanceState };
  const goalManager = options.goalManager ?? makeGoalManager();
  const completionHandler = makeCompletionHandler(reviewResult, options.signoffResult);
  const userChannel = makeUserChannel();
  const creatorBot = makeCreatorBot();
  const loop = new GovernanceLoop({
    bossBot:           makeNoopStub() as unknown as GovernanceLoopDeps['bossBot'],
    advisorBot:        makeNoopStub() as unknown as GovernanceLoopDeps['advisorBot'],
    creatorBot:        creatorBot as unknown as GovernanceLoopDeps['creatorBot'],
    agentRegistry:     makeNoopStub() as unknown as GovernanceLoopDeps['agentRegistry'],
    goalManager:       goalManager as unknown as GovernanceLoopDeps['goalManager'],
    taskManager:       makeNoopStub() as unknown as GovernanceLoopDeps['taskManager'],
    escalationHandler: makeNoopStub() as unknown as GovernanceLoopDeps['escalationHandler'],
    completionHandler: completionHandler as unknown as GovernanceLoopDeps['completionHandler'],
    userChannel:       userChannel as unknown as GovernanceLoopDeps['userChannel'],
    agentChannel:      makeNoopStub() as unknown as GovernanceLoopDeps['agentChannel'],
    adapter:           makeAdapter(),
  } as unknown as GovernanceLoopDeps);
  // Override the loop's private `state` field to EXECUTING — the state
  // from which `runCompletionFlow` is invoked in production
  // (line 423/439: handleJobComplete → runCompletionFlow, called from
  // EXECUTING after all campaigns/sub-goals complete).
  (loop as unknown as { state: GovernanceState }).state = 'EXECUTING';
  // Hook state transitions to observe the final state.
  loop.addTransitionHook((_from, to) => { state.current = to; });
  return { loop, state, completionHandler, goalManager, userChannel, creatorBot };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GovernanceLoop.runCompletionFlow — review.proceed === false', () => {
  beforeEach(() => {
    // The bug surfaces as a throw. Each test below uses `resolves.toBeUndefined()`
    // so the throw path is caught by vitest. No console-error stub needed.
  });

  it('does not throw when completion review returns proceed=false with one sub-goal reopen id', async () => {
    // Verified against the live source (governance-loop.ts:617-647, completion-handler.ts:88-96).
    // On origin/main (no fix), this test FAILS with:
    //   Error: [GovernanceLoop] Invalid transition: REVIEWING_COMPLETION → AWAITING_ADVICE (AdvisorBot flagged gaps)
    // (raised at governance-loop.ts:171 inside the `transition()` method).
    const { loop, state } = makeLoop({ proceed: false, reopenIds: ['sg-2'] });
    await expect(loop['runCompletionFlow']('test-goal-1')).resolves.toBeUndefined();
    // Final state must be EXECUTING (the gap-found path re-dispatches).
    expect(state.current).toBe('EXECUTING');
  });

  it('does not throw when completion review returns proceed=false with one campaign reopen id', async () => {
    const { loop, state } = makeLoop({ proceed: false, reopenIds: ['camp-1'] });
    await expect(loop['runCompletionFlow']('test-goal-2')).resolves.toBeUndefined();
    expect(state.current).toBe('EXECUTING');
  });

  it('does not throw when completion review returns proceed=false with empty reopenIds (defensive)', async () => {
    // completion-handler.ts line 96: `return { proceed: false, reopenIds: reopenId ? [reopenId] : [] };`
    // — the empty-array path is reachable when goal has NO sub-goals at all.
    // The fix must handle this case without throwing.
    const { loop, state } = makeLoop({ proceed: false, reopenIds: [] });
    await expect(loop['runCompletionFlow']('test-goal-3')).resolves.toBeUndefined();
    expect(state.current).toBe('EXECUTING');
  });

  it('calls goalManager.updateSubGoal for each legacy sub-goal reopen id', async () => {
    // Verified against governance-loop.ts:635-639 — when the id is NOT a
    // campaign id, it is treated as a legacy sub-goal id and updateSubGoal
    // is called with { status: 'pending', taskId: undefined }.
    const goalManager = makeGoalManager();
    // load() returns a goal with no matching campaign → isCampaign=false → updateSubGoal path.
    goalManager.load.mockReturnValue({
      goals: [
        {
          id: 'test-goal-4',
          subGoals: [{ id: 'sg-1' }, { id: 'sg-2' }],
          scheme: undefined,
        },
      ],
    });
    const { loop } = makeLoop({ proceed: false, reopenIds: ['sg-1', 'sg-2'] }, { goalManager });
    await loop['runCompletionFlow']('test-goal-4');
    expect(goalManager.updateSubGoal).toHaveBeenCalledTimes(2);
    expect(goalManager.updateSubGoal).toHaveBeenNthCalledWith(
      1, 'test-goal-4', 'sg-1', { status: 'pending', taskId: undefined },
    );
    expect(goalManager.updateSubGoal).toHaveBeenNthCalledWith(
      2, 'test-goal-4', 'sg-2', { status: 'pending', taskId: undefined },
    );
  });

  it('calls goalManager.updateCampaign for each campaign reopen id (new scheme path)', async () => {
    // Verified against governance-loop.ts:634-636 — when the id IS a campaign
    // id, updateCampaign is called with { status: 'pending' }.
    const goalManager = makeGoalManager();
    goalManager.load.mockReturnValue({
      goals: [
        {
          id: 'test-goal-5',
          subGoals: [],
          scheme: { campaigns: [{ id: 'camp-1' }, { id: 'camp-2' }] },
        },
      ],
    });
    const { loop } = makeLoop({ proceed: false, reopenIds: ['camp-1', 'camp-2'] }, { goalManager });
    await loop['runCompletionFlow']('test-goal-5');
    expect(goalManager.updateCampaign).toHaveBeenCalledTimes(2);
    expect(goalManager.updateCampaign).toHaveBeenNthCalledWith(
      1, 'test-goal-5', 'camp-1', { status: 'pending' },
    );
    expect(goalManager.updateCampaign).toHaveBeenNthCalledWith(
      2, 'test-goal-5', 'camp-2', { status: 'pending' },
    );
  });

  it('calls goalManager.getReadyCampaigns and getReadySubGoals to drive re-dispatch', async () => {
    // Verified against governance-loop.ts:645-646 — after re-opening, the
    // loop calls dispatchReadyCampaigns(goalId) and dispatchReadySubGoals(goalId).
    // These private methods call goalManager.getReadyCampaigns and getReadySubGoals
    // respectively. We assert those public GoalManager methods are reached
    // (proving the re-dispatch path was entered). We return [] so no
    // actual campaign spawn occurs (verified — see spawnCampaign at line 310,
    // which iterates `ready` and would fail with empty subagents).
    const goalManager = makeGoalManager();
    // Default: getReadyCampaigns / getReadySubGoals return [] — the empty
    // path is the dispatch-reached-and-no-campaigns-to-spawn path.
    const { loop } = makeLoop({ proceed: false, reopenIds: ['camp-1'] }, { goalManager });
    await loop['runCompletionFlow']('test-goal-6');
    expect(goalManager.getReadyCampaigns).toHaveBeenCalled();
    expect(goalManager.getReadySubGoals).toHaveBeenCalled();
  });

  it('emits a userChannel.status message naming the reopened count', async () => {
    // Verified against governance-loop.ts:640 — "AdvisorBot flagged gaps.
    // Re-opening N item(s)." is emitted on the gap-found path.
    const { loop, userChannel } = makeLoop({ proceed: false, reopenIds: ['sg-1', 'sg-2', 'sg-3'] });
    await loop['runCompletionFlow']('test-goal-7');
    expect(userChannel.status).toHaveBeenCalledWith(
      'AdvisorBot flagged gaps. Re-opening 3 item(s).',
    );
  });

  it('flushed notable CreatorBot items are emitted via userChannel.verbose before the review', async () => {
    // Verified against governance-loop.ts:619-624 — when CreatorBot has
    // notable items, they are flushed and emitted via userChannel.verbose.
    // This is independent of the bug; documenting the contract here.
    const { loop, userChannel, creatorBot } = makeLoop({ proceed: false, reopenIds: [] });
    creatorBot.flushNotable.mockReturnValue([
      { observation: 'first notable' },
      { observation: 'second notable' },
    ]);
    await loop['runCompletionFlow']('test-goal-8');
    expect(creatorBot.flushNotable).toHaveBeenCalledTimes(1);
    const verboseCall = userChannel.verbose.mock.calls.find(
      (args) => typeof args[0] === 'string' && args[0].startsWith('CreatorBot notable items:'),
    );
    expect(verboseCall).toBeDefined();
    expect(verboseCall![0]).toContain('first notable');
    expect(verboseCall![0]).toContain('second notable');
  });

  it('happy path: review.proceed === true transitions to IDLE (regression — not affected by this fix)', async () => {
    // Verified against governance-loop.ts:649-665 — the only path the pre-fix
    // VALID_TRANSITIONS table supported. After the fix, this still works
    // because AWAITING_USER_SIGNOFF is preserved in VALID_TRANSITIONS['REVIEWING_COMPLETION'].
    const { loop, state, goalManager } = makeLoop(
      { proceed: true },
      { signoffResult: { approved: true } },
    );
    goalManager.load.mockReturnValue({
      goals: [{ id: 'test-goal-9', subGoals: [], scheme: undefined }],
    });
    await loop['runCompletionFlow']('test-goal-9');
    // After the happy path: AWAITING_USER_SIGNOFF → COMPLETE → IDLE
    // (per VALID_TRANSITIONS: AWAITING_USER_SIGNOFF → COMPLETE, COMPLETE → IDLE).
    expect(state.current).toBe('IDLE');
  });
});
