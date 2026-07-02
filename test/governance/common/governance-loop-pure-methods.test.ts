/**
 * governance-loop-pure-methods.test.ts
 *
 * Direct unit tests for the PURE, NON-INTEGRATION-COUPLED surface of
 * `src/alienclaw/governance/common/governance-loop.ts` (packet 099).
 *
 * Background:
 *   `governance-loop.ts` (783 LOC) is the central BossBot ↔ AdvisorBot ↔ CreatorBot
 *   orchestration primitive. The full file sits at 19.76% stmt / 11.71% branch /
 *   12.76% func / 18.42% line coverage on `origin/main @ fb85aa9c` (verified §G-A
 *   this wake). The bulk of the gap (lines 285-783) is in integration-coupled
 *   methods that need full BossBot LLM + Subagent + RealMartianSummonAdapter
 *   stubs (e.g. handleUserGoal, handleJobComplete, runCompletionFlow,
 *   dispatchReadyCampaigns, spawnCampaign, dispatchReadySubGoals,
 *   spawnLegacyJob, checkUrgentQueue, recoverFromDisk, start, stop, drain,
 *   processEvent). Those are explicitly OUT OF SCOPE for this packet — they
 *   need their own scoped coverage-sweep with richer mock infrastructure.
 *
 *   This packet covers the SIX pure, easily-testable methods that need only a
 *   `noopBossBot` / `noopAdvisorBot` / `noopCreatorBot` / `noopAgentRegistry` /
 *   `noopTaskManager` / `noopEscalationHandler` / `noopCompletionHandler` /
 *   `noopAgentChannel` / `noopAdapter` and a `makeUserChannel()` capturing
 *   the verbose log for assertion. The pattern is the same noop-stub idiom
 *   already used by `test/governance/common/governance-loop.test.ts` (PR #87
 *   for packet 096, SHIPPED 2026-06-20).
 *
 * ── Target methods ──────────────────────────────────────────────────────────
 *
 *   pushEvent(event)                  (line 190, private — ring buffer)
 *   transition(to, reason)            (line 175, private — state machine)
 *   addTransitionHook(hook)           (line 111, public — fan-out)
 *   submitGoal(description)           (line 115, public — queue push)
 *   submitUserInput(message)          (line 119, public — queue push)
 *   isCampaignSubGoal(file, id)       (line 406, private — pure lookup)
 *
 * ── Why this is wall-relevant ────────────────────────────────────────────────
 *
 *   AGENTS.md §"VERIFICATION CHECKLIST" item 4:
 *     "Communication graph: user prompt reaches BossBot only; fitness reports
 *      bypass BossBot"
 *
 *   The pure methods are exactly the surface that enforces BossBot's role as
 *   the single user-facing agent:
 *     - submitGoal / submitUserInput are the ONLY ways user input enters
 *       the governance loop (line 115-122). A regression in either that
 *       bypasses the queue (e.g. directly invoking LLM) would violate the
 *       wall.
 *     - transition + VALID_TRANSITIONS (lines 23-43, 175-188) is the state
 *       machine that prevents BossBot from self-transitioning to ESCALATED
 *       or COMPLETE without an authoritative event. A regression in
 *       VALID_TRANSITIONS would let BossBot skip required AdvisorBot review.
 *     - pushEvent ring buffer (line 190-196, EVENT_QUEUE_LIMIT=200 at line 64)
 *       is the bounded-queue guarantee that prevents unbounded memory growth
 *       from a misbehaving upstream caller.
 *     - isCampaignSubGoal (line 406-411) is the campaign-vs-legacy
 *       disambiguation used by handleJobComplete / handleJobFailed to decide
 *       whether a JOB_COMPLETE event refers to a campaign (scheme-based goal)
 *       or a legacy sub-goal. A regression that returns `true` for legacy
 *       IDs would corrupt campaign progress tracking.
 *
 * ── Disjoint from OPEN PRs ──────────────────────────────────────────────────
 *
 *   OPEN PRs that touch src/alienclaw/governance/common/governance-loop.ts:
 *     - PR #84 (packet 094 — REVIEWING_COMPLETION transition fix)
 *     - PR #85 (packet 095 — AWAITING_USER_INPUT transition path)
 *     - PR #86 (packet 094-R&D-IMPL — review gap fix)
 *     - PR #87 (packet 096 — resumeGoal legacy sub-goal dispatch)
 *
 *   None of the OPEN PRs touch pushEvent, transition, addTransitionHook,
 *   submitGoal, submitUserInput, isCampaignSubGoal, or EVENT_QUEUE_LIMIT
 *   (verified §G-3 this wake via `gh pr diff <N> -- src/alienclaw/governance/
 *   common/governance-loop.ts | grep -E 'pushEvent|addTransitionHook|
 *   submitGoal|submitUserInput|isCampaignSubGoal|EVENT_QUEUE_LIMIT'` → 0
 *   hits across all 4 PRs).
 *
 *   OPEN PR test files (test/governance/common/governance-loop.test.ts,
 *   test/governance/governance-loop-completion.test.ts) are different file
 *   names from this packet's test file
 *   (test/governance/common/governance-loop-pure-methods.test.ts), so the
 *   new file is disjoint from all OPEN PR test paths.
 *
 *   For the `transition` test cases: the test targets ONLY transitions that
 *   are universally valid in both origin/main @ fb85aa9c and in PR #84's
 *   head (e.g. IDLE → SCHEMING, IDLE → CREATOR_BUILDING, EXECUTING →
 *   AWAITING_ADVICE). This ensures the test file does not regress if a
 *   transition is added (PR #84 added REVIEWING_COMPLETION → EXECUTING) or
 *   removed in any OPEN PR.
 *
 * Test coverage (8 cases):
 *   - pushEvent: ring buffer under limit (FIFO)
 *   - pushEvent: drops oldest event when queue exceeds EVENT_QUEUE_LIMIT (200)
 *   - transition: throws on invalid IDLE → EXECUTING
 *   - transition: succeeds on valid IDLE → SCHEMING and fires hook
 *   - transition: multiple hooks all fire on every transition (fan-out)
 *   - submitGoal pushes USER_GOAL event into the queue
 *   - submitUserInput pushes USER_INPUT event into the queue
 *   - isCampaignSubGoal: true when subGoalId matches a campaign id, false otherwise
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GovernanceLoop } from '../../../src/alienclaw/governance/common/governance-loop.js';
import type { BossBot }            from '../../../src/alienclaw/agents/bossbot.js';
import type { AdvisorBot }         from '../../../src/alienclaw/agents/advisorbot.js';
import type { CreatorBot }         from '../../../src/alienclaw/agents/creatorbot.js';
import type { AgentRegistry }      from '../../../src/alienclaw/agents/agent-registry.js';
import type { GoalManager }        from '../../../src/alienclaw/governance/common/goal-manager.js';
import type { TaskManager }        from '../../../src/alienclaw/governance/common/task-manager.js';
import type { EscalationHandler }  from '../../../src/alienclaw/governance/common/escalation-handler.js';
import type { CompletionHandler }  from '../../../src/alienclaw/governance/common/completion-handler.js';
import type { MartianSummonAdapter } from '../../../src/alienclaw/governance/common/summon-adapter.js';
import type { UserChannel }        from '../../../src/alienclaw/comms/user-channel.js';
import type { AgentChannel }       from '../../../src/alienclaw/comms/agent-channel.js';
import type { GoalsFile }          from '../../../src/alienclaw/types.js';

// ── Noop dependency stubs (mirror the pattern from governance-loop.test.ts) ──

const noopBossBot           = {} as unknown as BossBot;
const noopAdvisorBot        = {} as unknown as AdvisorBot;
const noopCreatorBot        = {} as unknown as CreatorBot;
const noopAgentRegistry     = {} as unknown as AgentRegistry;
const noopTaskManager       = {} as unknown as TaskManager;
const noopEscalationHandler = {} as unknown as EscalationHandler;
const noopCompletionHandler = {} as unknown as CompletionHandler;
const noopAgentChannel      = {} as unknown as AgentChannel;
const noopAdapter           = {} as unknown as MartianSummonAdapter;

function makeUserChannel(): UserChannel {
  return {
    required: () => {},
    verbose:  () => {},
    status:   () => {},
    close:    () => {},
  } as unknown as UserChannel;
}

/**
 * Goal manager stub that returns an empty goals file. The methods under test
 * (pushEvent, transition, addTransitionHook, submitGoal, submitUserInput,
 * isCampaignSubGoal) never invoke GoalManager.save / getReadyCampaigns /
 * getReadySubGoals — those are called only by dispatchReadyCampaigns,
 * dispatchReadySubGoals, resumeGoal, handleJobComplete, handleJobFailed,
 * handleUserGoal, handleUserInput, runCompletionFlow, recoverFromDisk,
 * all of which are OUT OF SCOPE for this packet.
 */
const noopGoalManager = {
  load: () => ({ version: '1', activeGoalId: null, goals: [] }) as GoalsFile,
} as unknown as GoalManager;

function makeLoop(): GovernanceLoop {
  return new GovernanceLoop({
    bossBot:           noopBossBot,
    advisorBot:        noopAdvisorBot,
    creatorBot:        noopCreatorBot,
    agentRegistry:     noopAgentRegistry,
    goalManager:       noopGoalManager,
    taskManager:       noopTaskManager,
    escalationHandler: noopEscalationHandler,
    completionHandler: noopCompletionHandler,
    userChannel:       makeUserChannel(),
    agentChannel:      noopAgentChannel,
    adapter:           noopAdapter,
  });
}

// ── 1. pushEvent ring buffer ────────────────────────────────────────────────

describe('GovernanceLoop.pushEvent — ring buffer (packet 099)', () => {
  it('keeps events in FIFO order under the limit', () => {
    const loop = makeLoop();
    for (let i = 0; i < 50; i++) {
      loop.submitGoal(`goal-${i}`);
    }
    // Push directly via private API to inspect the queue without consuming
    const queue = (loop as unknown as { eventQueue: { type: string; description?: string }[] }).eventQueue;
    expect(queue).toHaveLength(50);
    expect(queue[0]!.type).toBe('USER_GOAL');
    expect(queue[0]!.description).toBe('goal-0');
    expect(queue[49]!.description).toBe('goal-49');
  });

  it('drops the oldest event when the queue exceeds EVENT_QUEUE_LIMIT (200)', () => {
    const loop = makeLoop();
    // Fill to 200 + push 5 more → oldest 5 must be dropped.
    for (let i = 0; i < 205; i++) {
      loop.submitGoal(`g-${i}`);
    }
    const queue = (loop as unknown as { eventQueue: { type: string; description?: string }[] }).eventQueue;
    expect(queue).toHaveLength(200);
    expect(queue[0]!.description).toBe('g-5');   // g-0..g-4 dropped (ring-buffer)
    expect(queue[199]!.description).toBe('g-204');
  });
});

// ── 2. transition state machine + addTransitionHook fan-out ──────────────────

describe('GovernanceLoop.transition — state machine + hook fan-out (packet 099)', () => {
  let loop: GovernanceLoop;

  beforeEach(() => {
    loop = makeLoop();
  });

  // Helper: invoke the private `transition` method with `this` bound to `loop`.
  // Direct method-name access via `as unknown as { transition: ... }` strips
  // the `this` binding; we must use Function.prototype.call to retain it.
  function trans(
    to:
      | 'SCHEMING' | 'CREATOR_BUILDING' | 'EXECUTING' | 'AWAITING_ADVICE'
      | 'AWAITING_USER_INPUT' | 'COMPLETE' | 'IDLE' | 'REVIEWING_COMPLETION'
      | 'AWAITING_USER_SIGNOFF' | 'ESCALATED' | 'DECOMPOSING' | 'CREATOR_INTERRUPT',
    reason: string,
  ): void {
    (
      loop as unknown as {
        transition: (this: GovernanceLoop, to: string, reason: string) => void;
      }
    ).transition.call(loop, to, reason);
  }

  it('throws on an invalid transition (IDLE → EXECUTING)', () => {
    expect(() => trans('EXECUTING', 'test'))
      .toThrowError(/Invalid transition: IDLE → EXECUTING/);
  });

  it('succeeds on a valid transition (IDLE → SCHEMING) and fires the hook once', () => {
    const calls: Array<{ from: string; to: string; reason: string }> = [];
    loop.addTransitionHook((from, to, reason) => {
      calls.push({ from, to, reason });
    });
    trans('SCHEMING', 'unit test');
    expect(calls).toEqual([{ from: 'IDLE', to: 'SCHEMING', reason: 'unit test' }]);
  });

  it('fires multiple hooks on every transition (fan-out)', () => {
    const hookA: Array<{ from: string; to: string }> = [];
    const hookB: Array<{ from: string; to: string }> = [];
    loop.addTransitionHook((from, to) => { hookA.push({ from, to }); });
    loop.addTransitionHook((from, to) => { hookB.push({ from, to }); });
    trans('SCHEMING',         'a');
    trans('CREATOR_BUILDING', 'b');
    expect(hookA).toEqual([{ from: 'IDLE', to: 'SCHEMING' }, { from: 'SCHEMING', to: 'CREATOR_BUILDING' }]);
    expect(hookB).toEqual([{ from: 'IDLE', to: 'SCHEMING' }, { from: 'SCHEMING', to: 'CREATOR_BUILDING' }]);
  });
});

// ── 3. submitGoal / submitUserInput event-queue push ────────────────────────

describe('GovernanceLoop.submitGoal / submitUserInput — event-queue push (packet 099)', () => {
  it('submitGoal pushes a USER_GOAL event into the queue', () => {
    const loop = makeLoop();
    loop.submitGoal('build a Mars colony');
    const queue = (loop as unknown as { eventQueue: { type: string; description?: string }[] }).eventQueue;
    expect(queue).toHaveLength(1);
    expect(queue[0]!.type).toBe('USER_GOAL');
    expect(queue[0]!.description).toBe('build a Mars colony');
  });

  it('submitUserInput pushes a USER_INPUT event into the queue', () => {
    const loop = makeLoop();
    loop.submitUserInput('also add radiation shielding');
    const queue = (loop as unknown as { eventQueue: { type: string; message?: string }[] }).eventQueue;
    expect(queue).toHaveLength(1);
    expect(queue[0]!.type).toBe('USER_INPUT');
    expect(queue[0]!.message).toBe('also add radiation shielding');
  });
});

// ── 4. isCampaignSubGoal — campaign vs legacy disambiguation ────────────────

describe('GovernanceLoop.isCampaignSubGoal — campaign vs legacy disambiguation (packet 099)', () => {
  it('returns true when subGoalId matches a campaign id inside a scheme', () => {
    const loop = makeLoop();
    const file: GoalsFile = {
      version:      '1',
      activeGoalId: 'g1',
      goals: [{
        id:          'g1',
        description: 'scheme goal',
        subGoals:    [],
        status:      'active',
        createdAt:   0,
        scheme: {
          goalId:    'g1',
          rationale: '',
          campaigns: [{
            id:        'camp-A',
            name:      'Campaign A',
            objective: 'do A',
            subagents: [],
            dependsOn: [],
            status:    'pending',
          }],
          advisorEndorsement: '',
          createdAt:          0,
        },
      }],
    };
    const isCampaign = (loop as unknown as { isCampaignSubGoal: (f: GoalsFile, id: string) => boolean }).isCampaignSubGoal;
    expect(isCampaign(file, 'camp-A')).toBe(true);
  });

  it('returns false when subGoalId does NOT match any campaign id (legacy sub-goal)', () => {
    const loop = makeLoop();
    const file: GoalsFile = {
      version:      '1',
      activeGoalId: 'g2',
      goals: [{
        id:          'g2',
        description: 'scheme goal with legacy sub-goals',
        subGoals:    [{ id: 'sg-1', description: 'legacy', domain: 'general', status: 'pending', dependsOn: [] }],
        status:      'active',
        createdAt:   0,
        scheme: {
          goalId:    'g2',
          rationale: '',
          campaigns: [{ id: 'camp-X', name: 'X', objective: 'x', subagents: [], dependsOn: [], status: 'pending' }],
          advisorEndorsement: '',
          createdAt:          0,
        },
      }],
    };
    const isCampaign = (loop as unknown as { isCampaignSubGoal: (f: GoalsFile, id: string) => boolean }).isCampaignSubGoal;
    expect(isCampaign(file, 'sg-1')).toBe(false);
  });
});