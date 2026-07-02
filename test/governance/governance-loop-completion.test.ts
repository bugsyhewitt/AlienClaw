/**
 * test/governance/governance-loop-completion.test.ts
 *
 * Regression + direct unit tests for `GovernanceLoop.runCompletionFlow` —
 * the production crash path that fires every time AdvisorBot flags gaps
 * during completion review.
 *
 * ── Bug being guarded ───────────────────────────────────────────────────────
 *
 * `runCompletionFlow` (governance-loop.ts:617) calls
 * `completionHandler.review(goalId)` and, when the review returns
 * `{ proceed: false, reopenIds: [...] }`, the code at line 641 issued:
 *
 *     this.transition('AWAITING_ADVICE', 'AdvisorBot flagged gaps');
 *
 * But `VALID_TRANSITIONS['REVIEWING_COMPLETION']` (line 33) only allows
 * `['AWAITING_USER_SIGNOFF']`. `transition()` (lines 167–174) throws
 * unconditionally when the target state is not in the allowed list. The
 * resulting `Error: [GovernanceLoop] Invalid transition: REVIEWING_COMPLETION
 * → AWAITING_ADVICE (AdvisorBot flagged gaps)` propagates up to `drain()`
 * (line 217) which has no try/catch around the per-event handler — the
 * drain loop exits and the governance loop crashes.
 *
 * The fix (packet 095, layered on tester packet 094):
 *
 *   governance-loop.ts line 33:
 *     Before: REVIEWING_COMPLETION: ['AWAITING_USER_SIGNOFF'],
 *     After:  REVIEWING_COMPLETION: ['AWAITING_USER_SIGNOFF', 'EXECUTING'],
 *
 *   governance-loop.ts lines 641–642 (the bug site, inside !review.proceed):
 *     Before: transition('AWAITING_ADVICE', ...);  ← THROWS
 *             transition('EXECUTING', ...);         ← never reached
 *     After:  transition('EXECUTING', 'AdvisorBot flagged gaps — re-dispatching');
 *
 * This file contains the regression test (must FAIL before fix, PASS after)
 * plus the surrounding state-machine and happy-path coverage.
 *
 * @layered-on packet 094 (tester finding, severity HIGH)
 */

import { describe, it, expect, vi } from 'vitest';
import { GovernanceLoop } from '../../src/alienclaw/governance/common/governance-loop.js';
import type {
  GovernanceLoopDeps,
} from '../../src/alienclaw/governance/common/governance-loop.js';
import type { Goal, GoalsFile, Campaign, SubGoal } from '../../src/alienclaw/types.js';
import type { CompletionReview } from '../../src/alienclaw/governance/common/completion-handler.js';

// ── Stubs ────────────────────────────────────────────────────────────────────

/** Minimal GoalManager stub — only the methods called by runCompletionFlow. */
function makeGoalManagerStub(opts: {
  goal: Goal;
  /** When set, returns this value from isGoalComplete / isSchemeComplete. */
  complete?: boolean;
}) {
  const file: GoalsFile = {
    version: '1',
    activeGoalId: opts.goal.id,
    goals: [opts.goal],
  };
  return {
    load: vi.fn(() => file),
    isGoalComplete: vi.fn(() => opts.complete ?? false),
    isSchemeComplete: vi.fn(() => opts.complete ?? false),
    updateCampaign: vi.fn(async (_goalId: string, _campaignId: string, _patch: Partial<Campaign>) => {}),
    updateSubGoal: vi.fn(async (_goalId: string, _subGoalId: string, _patch: Partial<SubGoal>) => {}),
    // Stubs for dispatch paths called after runCompletionFlow transitions to EXECUTING:
    getReadyCampaigns: vi.fn((_file: GoalsFile, _goalId: string) => [] as Campaign[]),
    getReadySubGoals: vi.fn((_file: GoalsFile, _goalId: string) => [] as SubGoal[]),
    // Stub for the approved=true completion path:
    markGoalComplete: vi.fn(async (_goalId: string) => {}),
  };
}

/** Builds a minimal GoalManager stub as a fake — TypeScript `as any` cast happens at call site. */
function makeCompleteDeps(overrides: {
  goal: Goal;
  review: CompletionReview;
  schemeComplete?: boolean;
}): GovernanceLoopDeps {
  const goalManager = makeGoalManagerStub({
    goal: overrides.goal,
    complete: overrides.schemeComplete ?? true,
  });

  const completionHandler = {
    review: vi.fn(async (_goalId: string): Promise<CompletionReview> => overrides.review),
    promptSignoff: vi.fn(async () => ({ approved: true })),
  };

  // All other deps are no-op stubs. They are never called by runCompletionFlow.
  const noop = vi.fn();
  void noop; // suppress unused-variable warning
  return {
    bossBot:           {} as any,
    advisorBot:        { destroyTaskSessions: vi.fn() } as any,
    creatorBot:        { flushNotable: vi.fn(() => []) } as any,
    agentRegistry:     { closeTask: vi.fn() } as any,
    goalManager:       goalManager as any,
    taskManager:       {} as any,
    escalationHandler: {} as any,
    completionHandler: completionHandler as any,
    userChannel:       {
      verbose: vi.fn(),
      status:  vi.fn(),
      required: vi.fn(),
      close: vi.fn(),
    } as any,
    agentChannel:      {} as any,
    adapter:           {} as any,
  };
}

/** Build a GovernanceLoop, run runCompletionFlow (private), return its result. */
async function runCompletion(loop: GovernanceLoop, goalId: string): Promise<{ ok: boolean; error?: unknown }> {
  // runCompletionFlow expects to be called from handleJobComplete, where the
  // loop's state is EXECUTING (the line 625 transition is EXECUTING → REVIEWING_COMPLETION).
  // Set it explicitly because we construct the loop in isolation with default IDLE state.
  (loop as any).state = 'EXECUTING';
  try {
    await (loop as any).runCompletionFlow(goalId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err };
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeGoalWithCampaigns(goalId: string, campaigns: Campaign[]): Goal {
  return {
    id: goalId,
    description: 'test goal',
    subGoals: [],
    status: 'active',
    createdAt: Date.now(),
    scheme: {
      goalId,
      rationale: 'test',
      campaigns,
      advisorEndorsement: 'endorsed',
      createdAt: Date.now(),
    },
  };
}

function makeCampaign(id: string, status: Campaign['status'] = 'complete'): Campaign {
  return {
    id,
    name: `Campaign ${id}`,
    objective: `objective for ${id}`,
    subagents: [],
    dependsOn: [],
    status,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Test groups
// ══════════════════════════════════════════════════════════════════════════════

describe('GovernanceLoop.runCompletionFlow — completion review gap path (packet 095 regression)', () => {
  // ── The actual bug repro ───────────────────────────────────────────────────
  it('REGRESSION: does NOT throw when AdvisorBot review returns proceed=false with a campaign reopen (the production crash)', async () => {
    const goalId = 'goal-crash-repro';
    const goal   = makeGoalWithCampaigns(goalId, [
      makeCampaign('camp-1', 'complete'),
    ]);
    const deps = makeCompleteDeps({
      goal,
      review: { proceed: false, reopenIds: ['camp-1'] },
      schemeComplete: true,
    });
    const loop = new GovernanceLoop(deps);

    const result = await runCompletion(loop, goalId);

    // The bug: BEFORE the fix this throws Error: [GovernanceLoop] Invalid transition: REVIEWING_COMPLETION → AWAITING_ADVICE
    // After the fix, runCompletionFlow completes the gap branch and lands in EXECUTING.
    expect(result.ok).toBe(true);
    if (!result.ok) {
      // Helpful failure message: show the actual thrown error.
      throw new Error(
        `runCompletionFlow threw — the production crash is unfixed. Error: ${String(result.error)}`,
      );
    }
    // State must end in EXECUTING (the only valid next state after the fix).
    expect((loop as any).state).toBe('EXECUTING');
  });

  it('REGRESSION: does NOT throw when AdvisorBot review returns proceed=false with a legacy subGoal reopen', async () => {
    const goalId = 'goal-legacy-reopen';
    const goal: Goal = {
      id: goalId,
      description: 'legacy goal',
      subGoals: [
        { id: 'sg-1', description: 'old subgoal', domain: 'general', status: 'complete', dependsOn: [] },
        { id: 'sg-2', description: 'incomplete',     domain: 'general', status: 'pending',  dependsOn: ['sg-1'] },
      ],
      status: 'active',
      createdAt: Date.now(),
    };
    const deps = makeCompleteDeps({
      goal,
      review: { proceed: false, reopenIds: ['sg-2'] },
      schemeComplete: true,
    });
    const loop = new GovernanceLoop(deps);

    const result = await runCompletion(loop, goalId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`threw: ${String(result.error)}`);
    expect((loop as any).state).toBe('EXECUTING');
    // SubGoal update path was taken (not campaign update).
    expect(deps.goalManager.updateSubGoal).toHaveBeenCalledWith(goalId, 'sg-2', { status: 'pending', taskId: undefined });
    expect(deps.goalManager.updateCampaign).not.toHaveBeenCalled();
  });

  it('REGRESSION: does NOT throw when AdvisorBot review returns proceed=false with an empty reopenIds (defensive)', async () => {
    const goalId = 'goal-empty-reopen';
    const goal   = makeGoalWithCampaigns(goalId, [makeCampaign('camp-1', 'complete')]);
    const deps = makeCompleteDeps({
      goal,
      review: { proceed: false, reopenIds: [] },
      schemeComplete: true,
    });
    const loop = new GovernanceLoop(deps);

    const result = await runCompletion(loop, goalId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`threw: ${String(result.error)}`);
    expect((loop as any).state).toBe('EXECUTING');
    // No update calls when reopenIds is empty.
    expect(deps.goalManager.updateCampaign).not.toHaveBeenCalled();
    expect(deps.goalManager.updateSubGoal).not.toHaveBeenCalled();
  });

  // ── Happy path — must still work after the fix ─────────────────────────────
  it('HAPPY PATH: when review returns proceed=true, transitions REVIEWING_COMPLETION → AWAITING_USER_SIGNOFF', async () => {
    const goalId = 'goal-happy';
    const goal   = makeGoalWithCampaigns(goalId, [makeCampaign('camp-1', 'complete')]);
    const deps = makeCompleteDeps({
      goal,
      review: { proceed: true },
      schemeComplete: true,
    });
    const loop = new GovernanceLoop(deps);

    const result = await runCompletion(loop, goalId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`threw: ${String(result.error)}`);
    // With approved=true the flow completes: AWAITING_USER_SIGNOFF → COMPLETE → IDLE.
    expect((loop as any).state).toBe('IDLE');
    // Signoff was prompted on the happy path.
    expect(deps.completionHandler.promptSignoff).toHaveBeenCalledWith(goalId);
  });

  it('HAPPY PATH: when review returns proceed=false, dispatches ready campaigns and sub-goals (the re-dispatch happens)', async () => {
    const goalId = 'goal-redispatch';
    const goal   = makeGoalWithCampaigns(goalId, [makeCampaign('camp-1', 'complete')]);
    const deps = makeCompleteDeps({
      goal,
      review: { proceed: false, reopenIds: ['camp-1'] },
      schemeComplete: true,
    });
    // dispatchReadyCampaigns / dispatchReadySubGoals are private methods.
    // Spy on them to confirm the post-transition dispatch happens.
    const loop = new GovernanceLoop(deps);
    const dispatchReadyCampaignsSpy = vi.spyOn(loop as any, 'dispatchReadyCampaigns').mockResolvedValue(undefined);
    const dispatchReadySubGoalsSpy  = vi.spyOn(loop as any, 'dispatchReadySubGoals').mockResolvedValue(undefined);

    const result = await runCompletion(loop, goalId);
    expect(result.ok).toBe(true);
    expect(dispatchReadyCampaignsSpy).toHaveBeenCalledWith(goalId);
    expect(dispatchReadySubGoalsSpy).toHaveBeenCalledWith(goalId);
  });

  // ── State machine guard regressions (defense-in-depth) ────────────────────
  it('STATE MACHINE: VALID_TRANSITIONS[REVIEWING_COMPLETION] includes EXECUTING (the fix)', () => {
    // Import the constant via the GovernanceLoop module. The constant is module-private,
    // so we verify the BEHAVIOR through the runCompletionFlow integration test above.
    // This test is the "specification by execution" — after the fix, the EXECUTING
    // transition from REVIEWING_COMPLETION must succeed.
    const goalId = 'spec-execute-from-reviewing';
    const goal   = makeGoalWithCampaigns(goalId, [makeCampaign('camp-1', 'complete')]);
    const deps = makeCompleteDeps({
      goal,
      review: { proceed: false, reopenIds: ['camp-1'] },
      schemeComplete: true,
    });
    const loop = new GovernanceLoop(deps);
    // Pre-condition: state must transition through REVIEWING_COMPLETION and end in EXECUTING.
    return runCompletion(loop, goalId).then((result) => {
      expect(result.ok).toBe(true);
      expect((loop as any).state).toBe('EXECUTING');
    });
  });

  it('STATE MACHINE: transition() throws on invalid transitions (regression for the guard)', () => {
    // Construct a loop and call transition() directly with an invalid pair.
    // This guards the guard: even after the fix, the transition() method MUST still
    // throw when given a target outside VALID_TRANSITIONS — otherwise the entire
    // state-machine safety net is broken.
    const deps = makeCompleteDeps({
      goal: makeGoalWithCampaigns('g', [makeCampaign('c', 'complete')]),
      review: { proceed: true },
      schemeComplete: true,
    });
    const loop = new GovernanceLoop(deps);
    // Initial state is IDLE. IDLE → EXECUTING is not a valid transition.
    expect(() => (loop as any).transition('EXECUTING', 'invalid test transition'))
      .toThrowError(/Invalid transition: IDLE → EXECUTING/);
  });

  it('STATE MACHINE: addTransitionHook fires for every valid transition in runCompletionFlow', async () => {
    const goalId = 'goal-hooks';
    const goal   = makeGoalWithCampaigns(goalId, [makeCampaign('camp-1', 'complete')]);
    const deps = makeCompleteDeps({
      goal,
      review: { proceed: false, reopenIds: ['camp-1'] },
      schemeComplete: true,
    });
    const loop = new GovernanceLoop(deps);
    const hook = vi.fn();
    loop.addTransitionHook(hook);

    await runCompletion(loop, goalId);
    // Expected transitions in the gap path:
    //   EXECUTING → REVIEWING_COMPLETION (line 625)
    //   REVIEWING_COMPLETION → EXECUTING (the fix at line 641 area)
    const firedTransitions = hook.mock.calls.map(([from, to]) => `${from}→${to}`);
    expect(firedTransitions).toContain('EXECUTING→REVIEWING_COMPLETION');
    expect(firedTransitions).toContain('REVIEWING_COMPLETION→EXECUTING');
  });

  // ── Self-containment: ensure the stubs are minimal & wall-clean ────────────
  it('STUB CONTRACT: goalManager.updateCampaign is called with status: pending when reopenIds contains a campaign id', async () => {
    const goalId = 'goal-camp-update';
    const goal   = makeGoalWithCampaigns(goalId, [makeCampaign('camp-1', 'complete')]);
    const deps = makeCompleteDeps({
      goal,
      review: { proceed: false, reopenIds: ['camp-1'] },
      schemeComplete: true,
    });
    const loop = new GovernanceLoop(deps);
    await runCompletion(loop, goalId);
    expect(deps.goalManager.updateCampaign).toHaveBeenCalledWith(goalId, 'camp-1', { status: 'pending' });
  });

  it('STUB CONTRACT: userChannel.status announces the re-open count', async () => {
    const goalId = 'goal-status';
    const goal   = makeGoalWithCampaigns(goalId, [
      makeCampaign('camp-1', 'complete'),
      makeCampaign('camp-2', 'complete'),
    ]);
    const deps = makeCompleteDeps({
      goal,
      review: { proceed: false, reopenIds: ['camp-1', 'camp-2'] },
      schemeComplete: true,
    });
    const loop = new GovernanceLoop(deps);
    await runCompletion(loop, goalId);
    expect(deps.userChannel.status).toHaveBeenCalledWith(
      expect.stringContaining('Re-opening 2 item(s)'),
    );
  });

  it('STUB CONTRACT: creatorBot.flushNotable() output is logged via userChannel.verbose', async () => {
    const goalId = 'goal-notable';
    const goal   = makeGoalWithCampaigns(goalId, [makeCampaign('camp-1', 'complete')]);
    const deps = makeCompleteDeps({
      goal,
      review: { proceed: true },
      schemeComplete: true,
    });
    // Inject notable items into the creatorBot stub.
    (deps.creatorBot as any).flushNotable = vi.fn(() => [
      { observation: 'obs-1' },
      { observation: 'obs-2' },
    ]);
    const loop = new GovernanceLoop(deps);
    await runCompletion(loop, goalId);
    expect(deps.userChannel.verbose).toHaveBeenCalledWith(
      expect.stringContaining('CreatorBot notable items'),
    );
  });
});
