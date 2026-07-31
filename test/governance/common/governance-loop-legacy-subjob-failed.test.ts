/**
 * governance-loop-legacy-subjob-failed.test.ts
 *
 * Covers GovernanceLoop.handleJobFailed() — the legacy sub-goal path
 * (lines 560–659 in governance-loop.ts).
 *
 * Background:
 *   handleJobFailed() has two routes:
 *     Campaign path  (lines 522–558): subGoalId is a campaign ID in
 *       goal.scheme.campaigns — covered by packets 099 and 095.
 *     Legacy sub-goal path (lines 560–659): the Phase-2B flat-subGoal
 *       failure handler, preserved for backward compatibility. All
 *       30+ statements in this path had coverage count 0.
 *
 *   To enter the legacy path isCampaignSubGoal() must return false, which
 *   happens when the goal has no scheme (or no matching campaign ID).
 *   The subGoal must also carry a `taskId` that resolves in taskManager.
 *
 *   Arms covered by these 6 tests:
 *     A  Guard returns early when subGoal.taskId is undefined (L562)
 *     B  Guard returns early when taskManager.get() returns undefined (L563)
 *     C  !willBeExhausted = true → transition to AWAITING_ADVICE (L571)
 *     D  SURFACE_USER + abandon   (L584–589)
 *     E  SURFACE_USER + resume_budget  (L590–597)
 *     F  SURFACE_USER + new_instructions / else (L598–607)
 *
 *   The REBUILD retry path (L609–659) is deferred to a later cycle
 *   (requires a full Subagent mock with birth/runCampaign/erase lifecycle).
 */

import { describe, it, expect, vi } from 'vitest';
import { GovernanceLoop }           from '../../../src/alienclaw/governance/common/governance-loop.js';
import type { GoalManager }         from '../../../src/alienclaw/governance/common/goal-manager.js';
import type { TaskManager }         from '../../../src/alienclaw/governance/common/task-manager.js';
import type { EscalationHandler }   from '../../../src/alienclaw/governance/common/escalation-handler.js';
import type { CompletionHandler }   from '../../../src/alienclaw/governance/common/completion-handler.js';
import type { BossBot }             from '../../../src/alienclaw/agents/bossbot.js';
import type { AdvisorBot }          from '../../../src/alienclaw/agents/advisorbot.js';
import type { CreatorBot }          from '../../../src/alienclaw/agents/creatorbot.js';
import type { AgentRegistry }       from '../../../src/alienclaw/agents/agent-registry.js';
import type { MartianSummonAdapter } from '../../../src/alienclaw/governance/common/summon-adapter.js';
import type { UserChannel }         from '../../../src/alienclaw/comms/user-channel.js';
import type { AgentChannel }        from '../../../src/alienclaw/comms/agent-channel.js';
import type { TaskEnvelope }        from '../../../src/alienclaw/types.js';

// ── Shared noop stubs ─────────────────────────────────────────────────────────

const noopBossBot           = {} as unknown as BossBot;
const noopAdvisorBot        = {} as unknown as AdvisorBot;
const noopCreatorBot        = {} as unknown as CreatorBot;
const noopAgentRegistry     = {} as unknown as AgentRegistry;
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

// ── Fixtures ──────────────────────────────────────────────────────────────────

const GOAL_ID    = 'goal-legacy';
const SUBGOAL_ID = 'sg-1';
const TASK_ID    = 'task-99';

/** Build a GoalsFile where the sub-goal optionally carries a taskId. No scheme →
 *  isCampaignSubGoal() returns false for any subGoalId. */
function makeFile(taskId?: string) {
  return {
    version:      '1',
    activeGoalId: GOAL_ID,
    goals: [{
      id:          GOAL_ID,
      description: 'legacy goal',
      subGoals: [{
        id:          SUBGOAL_ID,
        description: 'legacy sub-task',
        domain:      'research',
        status:      'active' as const,
        dependsOn:   [],
        ...(taskId !== undefined ? { taskId } : {}),
      }],
      status:    'active' as const,
      createdAt: 0,
    }],
  };
}

function makeTask(strikeCount = 2): TaskEnvelope {
  return {
    taskId:      TASK_ID,
    description: 'legacy sub-task',
    domain:      'research',
    priority:    'normal',
    createdAt:   0,
    strikeCount,
    attempts:    [],
  };
}

const JOB_FAILED_EVENT = {
  type:      'JOB_FAILED' as const,
  goalId:    GOAL_ID,
  subGoalId: SUBGOAL_ID,
  error:     'sub-agent crashed',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GovernanceLoop.handleJobFailed — legacy sub-goal path', () => {

  // ── A: guard returns early when subGoal has no taskId ─────────────────────

  it('returns early without calling escalationHandler when subGoal.taskId is missing (L562)', async () => {
    const handleFailureSpy = vi.fn();
    const escalationHandler = {
      handleFailure: handleFailureSpy,
    } as unknown as EscalationHandler;

    const goalManager = {
      load: () => makeFile(/* no taskId */),
    } as unknown as GoalManager;

    const loop = new GovernanceLoop({
      bossBot: noopBossBot, advisorBot: noopAdvisorBot, creatorBot: noopCreatorBot,
      agentRegistry: noopAgentRegistry, goalManager,
      taskManager:        {} as unknown as TaskManager,
      escalationHandler,  completionHandler: noopCompletionHandler,
      userChannel: makeUserChannel(), agentChannel: noopAgentChannel, adapter: noopAdapter,
    });
    (loop as any).transition = () => {};

    await (loop as any).handleJobFailed(JOB_FAILED_EVENT);

    expect(handleFailureSpy).not.toHaveBeenCalled();
  });

  // ── B: guard returns early when taskManager has no matching task ──────────

  it('returns early without calling escalationHandler when taskManager.get returns undefined (L563)', async () => {
    const handleFailureSpy = vi.fn();
    const escalationHandler = {
      handleFailure: handleFailureSpy,
    } as unknown as EscalationHandler;

    const goalManager = {
      load: () => makeFile(TASK_ID),
    } as unknown as GoalManager;

    const taskManager = {
      get: () => undefined,
    } as unknown as TaskManager;

    const loop = new GovernanceLoop({
      bossBot: noopBossBot, advisorBot: noopAdvisorBot, creatorBot: noopCreatorBot,
      agentRegistry: noopAgentRegistry, goalManager, taskManager, escalationHandler,
      completionHandler: noopCompletionHandler, userChannel: makeUserChannel(),
      agentChannel: noopAgentChannel, adapter: noopAdapter,
    });
    (loop as any).transition = () => {};

    await (loop as any).handleJobFailed(JOB_FAILED_EVENT);

    expect(handleFailureSpy).not.toHaveBeenCalled();
  });

  // ── C: !willBeExhausted = true → AWAITING_ADVICE transition ──────────────

  it('calls transition(AWAITING_ADVICE) when strikeCount+1 < MAX_STRIKE_COUNT (L571–572)', async () => {
    const transitions: string[] = [];

    const escalationHandler = {
      // Use SURFACE_USER+abandon to avoid the REBUILD retry path complexity
      handleFailure:     vi.fn().mockResolvedValue({ action: 'SURFACE_USER' }),
      handleStrikeThree: vi.fn().mockResolvedValue({ outcome: 'abandon' }),
    } as unknown as EscalationHandler;
    const goalManager = {
      load:          () => makeFile(TASK_ID),
      updateSubGoal: vi.fn().mockResolvedValue(undefined),
    } as unknown as GoalManager;
    const taskManager = {
      get:        () => makeTask(/* strikeCount=0 → (0+1)=1 < 3 */0),
      deregister: vi.fn(),
    } as unknown as TaskManager;

    const loop = new GovernanceLoop({
      bossBot: noopBossBot, advisorBot: noopAdvisorBot, creatorBot: noopCreatorBot,
      agentRegistry: noopAgentRegistry, goalManager, taskManager, escalationHandler,
      completionHandler: noopCompletionHandler, userChannel: makeUserChannel(),
      agentChannel: noopAgentChannel, adapter: noopAdapter,
    });
    (loop as any).transition            = (s: string) => { transitions.push(s); };
    (loop as any).dispatchReadySubGoals = vi.fn().mockResolvedValue(undefined);

    await (loop as any).handleJobFailed(JOB_FAILED_EVENT);

    expect(transitions).toContain('AWAITING_ADVICE');
  });

  // ── D: SURFACE_USER + abandon → subGoal marked failed, task deregistered ─

  it('marks subGoal failed and deregisters task on abandon outcome (L584–589)', async () => {
    const updateArgs: Array<[string, string, object]> = [];
    const deregisteredIds: string[] = [];

    const escalationHandler = {
      handleFailure:     vi.fn().mockResolvedValue({ action: 'SURFACE_USER' }),
      handleStrikeThree: vi.fn().mockResolvedValue({ outcome: 'abandon' }),
    } as unknown as EscalationHandler;
    const goalManager = {
      load:          () => makeFile(TASK_ID),
      updateSubGoal: async (gid: string, sid: string, patch: object) => {
        updateArgs.push([gid, sid, patch]);
      },
    } as unknown as GoalManager;
    const taskManager = {
      get:        () => makeTask(/* strikeCount=2, exhausted */),
      deregister: (id: string) => { deregisteredIds.push(id); },
    } as unknown as TaskManager;

    const loop = new GovernanceLoop({
      bossBot: noopBossBot, advisorBot: noopAdvisorBot, creatorBot: noopCreatorBot,
      agentRegistry: noopAgentRegistry, goalManager, taskManager, escalationHandler,
      completionHandler: noopCompletionHandler, userChannel: makeUserChannel(),
      agentChannel: noopAgentChannel, adapter: noopAdapter,
    });
    (loop as any).transition            = () => {};
    (loop as any).dispatchReadySubGoals = vi.fn().mockResolvedValue(undefined);

    await (loop as any).handleJobFailed(JOB_FAILED_EVENT);

    const failPatch = updateArgs.find(([, sid]) => sid === SUBGOAL_ID)?.[2] as { status?: string } | undefined;
    expect(failPatch?.status).toBe('failed');
    expect(deregisteredIds).toContain(TASK_ID);
  });

  // ── E: SURFACE_USER + resume_budget → resetStrikes with budget ────────────

  it('calls resetStrikes with budget and re-queues sub-goal on resume_budget (L590–597)', async () => {
    const resetCalls: Array<[string, number | undefined]> = [];
    const updateArgs: Array<[string, string, object]> = [];

    const escalationHandler = {
      handleFailure:     vi.fn().mockResolvedValue({ action: 'SURFACE_USER' }),
      handleStrikeThree: vi.fn().mockResolvedValue({ outcome: 'resume_budget', budget: 5 }),
    } as unknown as EscalationHandler;
    const goalManager = {
      load:          () => makeFile(TASK_ID),
      updateSubGoal: async (gid: string, sid: string, patch: object) => {
        updateArgs.push([gid, sid, patch]);
      },
    } as unknown as GoalManager;
    const taskManager = {
      get:          () => makeTask(2),
      resetStrikes: (id: string, budget?: number) => { resetCalls.push([id, budget]); },
      deregister:   vi.fn(),
    } as unknown as TaskManager;

    const loop = new GovernanceLoop({
      bossBot: noopBossBot, advisorBot: noopAdvisorBot, creatorBot: noopCreatorBot,
      agentRegistry: noopAgentRegistry, goalManager, taskManager, escalationHandler,
      completionHandler: noopCompletionHandler, userChannel: makeUserChannel(),
      agentChannel: noopAgentChannel, adapter: noopAdapter,
    });
    (loop as any).transition            = () => {};
    (loop as any).dispatchReadySubGoals = vi.fn().mockResolvedValue(undefined);

    await (loop as any).handleJobFailed(JOB_FAILED_EVENT);

    // resetStrikes must receive the budget extension from the user response
    expect(resetCalls).toEqual([[TASK_ID, 5]]);
    const patch = updateArgs.find(([, sid]) => sid === SUBGOAL_ID)?.[2] as { status?: string; taskId?: unknown } | undefined;
    expect(patch?.status).toBe('pending');
    expect(Object.prototype.hasOwnProperty.call(patch, 'taskId')).toBe(true);
  });

  // ── F: SURFACE_USER + new_instructions (else) → description amended ───────

  it('amends sub-goal description with user instructions on new_instructions (L598–607)', async () => {
    const resetCalls: Array<[string, number | undefined]> = [];
    const updateArgs: Array<[string, string, object]> = [];

    const escalationHandler = {
      handleFailure:     vi.fn().mockResolvedValue({ action: 'SURFACE_USER' }),
      handleStrikeThree: vi.fn().mockResolvedValue({
        outcome:      'new_instructions',
        instructions: 'try a different approach',
      }),
    } as unknown as EscalationHandler;
    const goalManager = {
      load:          () => makeFile(TASK_ID),
      updateSubGoal: async (gid: string, sid: string, patch: object) => {
        updateArgs.push([gid, sid, patch]);
      },
    } as unknown as GoalManager;
    const taskManager = {
      get:          () => makeTask(2),
      resetStrikes: (id: string, budget?: number) => { resetCalls.push([id, budget]); },
      deregister:   vi.fn(),
    } as unknown as TaskManager;

    const loop = new GovernanceLoop({
      bossBot: noopBossBot, advisorBot: noopAdvisorBot, creatorBot: noopCreatorBot,
      agentRegistry: noopAgentRegistry, goalManager, taskManager, escalationHandler,
      completionHandler: noopCompletionHandler, userChannel: makeUserChannel(),
      agentChannel: noopAgentChannel, adapter: noopAdapter,
    });
    (loop as any).transition            = () => {};
    (loop as any).dispatchReadySubGoals = vi.fn().mockResolvedValue(undefined);

    await (loop as any).handleJobFailed(JOB_FAILED_EVENT);

    // resetStrikes without budget (no second arg)
    expect(resetCalls).toEqual([[TASK_ID, undefined]]);
    const patch = updateArgs.find(([, sid]) => sid === SUBGOAL_ID)?.[2] as {
      status?: string; description?: string; taskId?: unknown;
    } | undefined;
    expect(patch?.status).toBe('pending');
    expect(patch?.description).toContain('try a different approach');
    expect(Object.prototype.hasOwnProperty.call(patch, 'taskId')).toBe(true);
  });
});
