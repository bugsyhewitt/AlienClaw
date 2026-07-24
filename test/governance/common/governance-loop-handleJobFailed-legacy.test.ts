/**
 * governance-loop-handleJobFailed-legacy.test.ts
 *
 * Covers the legacy sub-goal failure path in handleJobFailed() (L586-671).
 * All 8 cold branch arms verified via V8 coverage (PKT-330).
 *
 * Trigger: subGoalId does NOT match any campaign ID in the goal's scheme
 * (or goal has no scheme at all) → isCampaignSubGoal() returns false.
 */

import { describe, it, expect, vi } from 'vitest';
import { GovernanceLoop }           from '../../../src/alienclaw/governance/common/governance-loop.js';
import type { GoalManager }         from '../../../src/alienclaw/governance/common/goal-manager.js';
import type { TaskManager }         from '../../../src/alienclaw/governance/common/task-manager.js';
import type { EscalationHandler }   from '../../../src/alienclaw/governance/common/escalation-handler.js';
import type { CompletionHandler }   from '../../../src/alienclaw/governance/common/completion-handler.js';
import type { CreatorBot as CommonCreatorBot } from '../../../src/alienclaw/governance/common/creator-bot.js';
import type { BossBot }             from '../../../src/alienclaw/agents/bossbot.js';
import type { AdvisorBot }          from '../../../src/alienclaw/agents/advisorbot.js';
import type { CreatorBot }          from '../../../src/alienclaw/agents/creatorbot.js';
import type { AgentRegistry }       from '../../../src/alienclaw/agents/agent-registry.js';
import type { MartianSummonAdapter } from '../../../src/alienclaw/governance/common/summon-adapter.js';
import type { UserChannel }         from '../../../src/alienclaw/comms/user-channel.js';
import type { AgentChannel }        from '../../../src/alienclaw/comms/agent-channel.js';

// ── Shared stubs ──────────────────────────────────────────────────────────────

const noopBossBot           = {} as unknown as BossBot;
const noopAdvisorBot        = {} as unknown as AdvisorBot;
const noopCreatorBot        = {} as unknown as CreatorBot;
const noopAgentRegistry     = {} as unknown as AgentRegistry;
const noopCompletionHandler = {} as unknown as CompletionHandler;
const noopAgentChannel      = {} as unknown as AgentChannel;
const noopAdapter           = {} as unknown as MartianSummonAdapter;

function makeUserChannel(): UserChannel {
  return {
    required: vi.fn(),
    verbose:  vi.fn(),
    status:   vi.fn(),
    close:    vi.fn(),
  } as unknown as UserChannel;
}

/** Minimal legacy goal file — no scheme so isCampaignSubGoal() returns false.
 *  Pass taskId=null to omit taskId entirely from the subGoal. */
function makeLegacyFile(taskId: string | null = 'task-1') {
  return {
    version:      '1',
    activeGoalId: 'goal-1',
    goals: [{
      id:          'goal-1',
      description: 'legacy goal',
      subGoals: [{
        id:          'sg-1',
        description: 'do something useful',
        domain:      'compute',
        status:      'active' as const,
        dependsOn:   [],
        ...(taskId !== null ? { taskId } : {}),
      }],
      status:    'active' as const,
      createdAt: 0,
      // NO scheme — forces legacy path
    }],
  };
}

function makeTask(strikeCount = 0) {
  return {
    taskId:      'task-1',
    description: 'task desc',
    domain:      'compute',
    priority:    'normal' as const,
    createdAt:   0,
    strikeCount,
    attempts:    [],
    assignedTo:  'compute',
  };
}

const JOB_FAILED_EVENT = {
  type:      'JOB_FAILED' as const,
  goalId:    'goal-1',
  subGoalId: 'sg-1',
  error:     'something went wrong',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('handleJobFailed — legacy sub-goal path (PKT-330)', () => {
  it('early-returns when subGoal has no taskId (L587 guard)', async () => {
    // subGoal.taskId is absent → early return before taskManager.get()
    const file = makeLegacyFile(null);
    const getStub = vi.fn();
    const goalManager = {
      load: () => file,
    } as unknown as GoalManager;
    const taskManager = {
      get: getStub,
    } as unknown as TaskManager;
    const escalationHandler = {} as unknown as EscalationHandler;

    const loop = new GovernanceLoop({
      bossBot:           noopBossBot,
      advisorBot:        noopAdvisorBot,
      creatorBot:        noopCreatorBot,
      agentRegistry:     noopAgentRegistry,
      goalManager,
      taskManager,
      escalationHandler,
      completionHandler: noopCompletionHandler,
      userChannel:       makeUserChannel(),
      agentChannel:      noopAgentChannel,
      adapter:           noopAdapter,
    });
    (loop as any).transition = vi.fn();

    await expect((loop as any).handleJobFailed(JOB_FAILED_EVENT)).resolves.toBeUndefined();
    expect(getStub).not.toHaveBeenCalled();
  });

  it('early-returns when taskManager.get() returns undefined (L589 guard)', async () => {
    const file = makeLegacyFile('task-1');
    const goalManager = {
      load: () => file,
    } as unknown as GoalManager;
    const taskManager = {
      get: vi.fn(() => undefined),
    } as unknown as TaskManager;
    const escalationHandler = {} as unknown as EscalationHandler;

    const loop = new GovernanceLoop({
      bossBot:           noopBossBot,
      advisorBot:        noopAdvisorBot,
      creatorBot:        noopCreatorBot,
      agentRegistry:     noopAgentRegistry,
      goalManager,
      taskManager,
      escalationHandler,
      completionHandler: noopCompletionHandler,
      userChannel:       makeUserChannel(),
      agentChannel:      noopAgentChannel,
      adapter:           noopAdapter,
    });
    (loop as any).transition = vi.fn();

    await expect((loop as any).handleJobFailed(JOB_FAILED_EVENT)).resolves.toBeUndefined();
  });

  it('transitions AWAITING_ADVICE when willBeExhausted=false (L596 if-true arm)', async () => {
    // strikeCount=0: (0+1)=1 < MAX_STRIKE_COUNT(3) → willBeExhausted=false → AWAITING_ADVICE taken
    const file = makeLegacyFile('task-1');
    const task = makeTask(0);
    const goalManager = {
      load: () => file,
    } as unknown as GoalManager;
    const taskManager = {
      get: vi.fn(() => task),
    } as unknown as TaskManager;
    const handleFailureFn = vi.fn(async () => ({ action: 'REBUILD' as const }));
    const escalationHandler = {
      handleFailure: handleFailureFn,
    } as unknown as EscalationHandler;

    const loop = new GovernanceLoop({
      bossBot:           noopBossBot,
      advisorBot:        noopAdvisorBot,
      creatorBot:        noopCreatorBot,
      agentRegistry:     noopAgentRegistry,
      goalManager,
      taskManager: { ...taskManager, assign: vi.fn() } as unknown as TaskManager,
      escalationHandler,
      completionHandler: noopCompletionHandler,
      userChannel:       makeUserChannel(),
      agentChannel:      noopAgentChannel,
      adapter:           noopAdapter,
      campaignCreatorBot: {
        buildSubagent: vi.fn().mockReturnValue({}),
      } as unknown as CommonCreatorBot,
    });

    const transitionSpy = vi.fn();
    (loop as any).transition              = transitionSpy;
    (loop as any).dispatchReadySubGoals   = vi.fn().mockResolvedValue(undefined);
    (loop as any).runJob                  = vi.fn().mockResolvedValue(undefined);

    await (loop as any).handleJobFailed(JOB_FAILED_EVENT);

    const awaitingAdviceCalls = transitionSpy.mock.calls.filter(
      ([state]: [string]) => state === 'AWAITING_ADVICE'
    );
    expect(awaitingAdviceCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('skips AWAITING_ADVICE transition when willBeExhausted=true (L596 else arm)', async () => {
    // strikeCount = MAX_STRIKE_COUNT - 1 = 2: (2+1)=3 >= 3 → willBeExhausted=true
    const { MAX_STRIKE_COUNT } = await import('../../../src/alienclaw/constants.js');
    const file = makeLegacyFile('task-1');
    const task = makeTask(MAX_STRIKE_COUNT - 1);
    const goalManager = {
      load: () => file,
    } as unknown as GoalManager;
    const taskManager = {
      get:    vi.fn(() => task),
      assign: vi.fn(),
    } as unknown as TaskManager;
    const handleFailureFn = vi.fn(async () => ({ action: 'REBUILD' as const }));
    const escalationHandler = {
      handleFailure: handleFailureFn,
    } as unknown as EscalationHandler;

    const loop = new GovernanceLoop({
      bossBot:           noopBossBot,
      advisorBot:        noopAdvisorBot,
      creatorBot:        noopCreatorBot,
      agentRegistry:     noopAgentRegistry,
      goalManager,
      taskManager,
      escalationHandler,
      completionHandler: noopCompletionHandler,
      userChannel:       makeUserChannel(),
      agentChannel:      noopAgentChannel,
      adapter:           noopAdapter,
      campaignCreatorBot: {
        buildSubagent: vi.fn().mockReturnValue({}),
      } as unknown as CommonCreatorBot,
    });

    const transitionSpy = vi.fn();
    (loop as any).transition              = transitionSpy;
    (loop as any).dispatchReadySubGoals   = vi.fn().mockResolvedValue(undefined);
    (loop as any).runJob                  = vi.fn().mockResolvedValue(undefined);

    await (loop as any).handleJobFailed(JOB_FAILED_EVENT);

    const awaitingAdviceCalls = transitionSpy.mock.calls.filter(
      ([state]: [string]) => state === 'AWAITING_ADVICE'
    );
    expect(awaitingAdviceCalls.length).toBe(0);
  });

  it('SURFACE_USER + abandon: deregisters task and calls dispatchReadySubGoals (L609)', async () => {
    const file = makeLegacyFile('task-1');
    const task = makeTask(0);
    const goalManager = {
      load:          () => file,
      updateSubGoal: vi.fn().mockResolvedValue(undefined),
    } as unknown as GoalManager;
    const deregisterFn = vi.fn();
    const taskManager = {
      get:        vi.fn(() => task),
      deregister: deregisterFn,
    } as unknown as TaskManager;
    const escalationHandler = {
      handleFailure:    vi.fn(async () => ({ action: 'SURFACE_USER' as const })),
      handleStrikeThree: vi.fn(async () => ({ outcome: 'abandon' as const })),
    } as unknown as EscalationHandler;

    const loop = new GovernanceLoop({
      bossBot:           noopBossBot,
      advisorBot:        noopAdvisorBot,
      creatorBot:        noopCreatorBot,
      agentRegistry:     noopAgentRegistry,
      goalManager,
      taskManager,
      escalationHandler,
      completionHandler: noopCompletionHandler,
      userChannel:       makeUserChannel(),
      agentChannel:      noopAgentChannel,
      adapter:           noopAdapter,
    });

    const dispatchSpy = vi.fn().mockResolvedValue(undefined);
    (loop as any).transition            = vi.fn();
    (loop as any).dispatchReadySubGoals = dispatchSpy;

    await (loop as any).handleJobFailed(JOB_FAILED_EVENT);

    expect(deregisterFn).toHaveBeenCalledWith('task-1');
    expect((goalManager as any).updateSubGoal).toHaveBeenCalledWith(
      'goal-1', 'sg-1', expect.objectContaining({ status: 'failed' })
    );
    expect(dispatchSpy).toHaveBeenCalledWith('goal-1');
  });

  it('SURFACE_USER + resume_budget: calls resetStrikes with budget and requeues (L615)', async () => {
    const file = makeLegacyFile('task-1');
    const task = makeTask(0);
    const updateSubGoalFn = vi.fn().mockResolvedValue(undefined);
    const goalManager = {
      load:          () => file,
      updateSubGoal: updateSubGoalFn,
    } as unknown as GoalManager;
    const resetStrikesFn = vi.fn();
    const taskManager = {
      get:          vi.fn(() => task),
      resetStrikes: resetStrikesFn,
      deregister:   vi.fn(),
    } as unknown as TaskManager;
    const escalationHandler = {
      handleFailure:    vi.fn(async () => ({ action: 'SURFACE_USER' as const })),
      handleStrikeThree: vi.fn(async () => ({ outcome: 'resume_budget' as const, budget: 5 })),
    } as unknown as EscalationHandler;

    const loop = new GovernanceLoop({
      bossBot:           noopBossBot,
      advisorBot:        noopAdvisorBot,
      creatorBot:        noopCreatorBot,
      agentRegistry:     noopAgentRegistry,
      goalManager,
      taskManager,
      escalationHandler,
      completionHandler: noopCompletionHandler,
      userChannel:       makeUserChannel(),
      agentChannel:      noopAgentChannel,
      adapter:           noopAdapter,
    });

    const dispatchSpy = vi.fn().mockResolvedValue(undefined);
    (loop as any).transition            = vi.fn();
    (loop as any).dispatchReadySubGoals = dispatchSpy;

    await (loop as any).handleJobFailed(JOB_FAILED_EVENT);

    expect(resetStrikesFn).toHaveBeenCalledWith('task-1', 5);
    expect(updateSubGoalFn).toHaveBeenCalledWith(
      'goal-1', 'sg-1', expect.objectContaining({ status: 'pending' })
    );
    expect(dispatchSpy).toHaveBeenCalledWith('goal-1');
  });

  it('SURFACE_USER + new_instructions: updates description with instructions and requeues (L623)', async () => {
    const file = makeLegacyFile('task-1');
    const task = makeTask(0);
    const updateSubGoalFn = vi.fn().mockResolvedValue(undefined);
    const goalManager = {
      load:          () => file,
      updateSubGoal: updateSubGoalFn,
    } as unknown as GoalManager;
    const taskManager = {
      get:          vi.fn(() => task),
      resetStrikes: vi.fn(),
      deregister:   vi.fn(),
    } as unknown as TaskManager;
    const escalationHandler = {
      handleFailure:    vi.fn(async () => ({ action: 'SURFACE_USER' as const })),
      handleStrikeThree: vi.fn(async () => ({
        outcome:      'new_instructions' as const,
        instructions: 'try harder',
      })),
    } as unknown as EscalationHandler;

    const loop = new GovernanceLoop({
      bossBot:           noopBossBot,
      advisorBot:        noopAdvisorBot,
      creatorBot:        noopCreatorBot,
      agentRegistry:     noopAgentRegistry,
      goalManager,
      taskManager,
      escalationHandler,
      completionHandler: noopCompletionHandler,
      userChannel:       makeUserChannel(),
      agentChannel:      noopAgentChannel,
      adapter:           noopAdapter,
    });

    const dispatchSpy = vi.fn().mockResolvedValue(undefined);
    (loop as any).transition            = vi.fn();
    (loop as any).dispatchReadySubGoals = dispatchSpy;

    await (loop as any).handleJobFailed(JOB_FAILED_EVENT);

    expect(updateSubGoalFn).toHaveBeenCalledWith(
      'goal-1', 'sg-1',
      expect.objectContaining({
        status:      'pending',
        description: expect.stringContaining('try harder'),
      })
    );
    expect(dispatchSpy).toHaveBeenCalledWith('goal-1');
  });

  it('REBUILD: calls campaignCreatorBot.buildSubagent and stores job in legacyJobs (L634)', async () => {
    const file = makeLegacyFile('task-1');
    const task = makeTask(0);
    const goalManager = {
      load: () => file,
    } as unknown as GoalManager;
    const taskManager = {
      get:    vi.fn(() => task),
      assign: vi.fn(),
    } as unknown as TaskManager;
    const escalationHandler = {
      handleFailure: vi.fn(async () => ({ action: 'REBUILD' as const })),
    } as unknown as EscalationHandler;
    const buildSubagentFn = vi.fn().mockReturnValue({});
    const campaignCreatorBot = {
      buildSubagent: buildSubagentFn,
    } as unknown as CommonCreatorBot;

    const loop = new GovernanceLoop({
      bossBot:           noopBossBot,
      advisorBot:        noopAdvisorBot,
      creatorBot:        noopCreatorBot,
      agentRegistry:     noopAgentRegistry,
      goalManager,
      taskManager,
      escalationHandler,
      completionHandler: noopCompletionHandler,
      userChannel:       makeUserChannel(),
      agentChannel:      noopAgentChannel,
      adapter:           noopAdapter,
      campaignCreatorBot,
    });

    const runJobSpy = vi.fn().mockResolvedValue(undefined);
    (loop as any).transition            = vi.fn();
    (loop as any).dispatchReadySubGoals = vi.fn().mockResolvedValue(undefined);
    (loop as any).runJob                = runJobSpy;

    await (loop as any).handleJobFailed(JOB_FAILED_EVENT);

    expect(buildSubagentFn).toHaveBeenCalled();
    expect(runJobSpy).toHaveBeenCalled();
    expect((loop as any).legacyJobs.has('sg-1')).toBe(true);
  });
});
