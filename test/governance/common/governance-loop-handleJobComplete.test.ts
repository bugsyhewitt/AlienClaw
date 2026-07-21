/**
 * governance-loop-handleJobComplete.test.ts
 *
 * Unit tests for the handleJobComplete() private method of GovernanceLoop
 * (src/alienclaw/governance/common/governance-loop.ts, L500-536).
 * Packet: PKT-329
 *
 * The method body was 0% covered before this file. Six cases drive every
 * branch: campaign-complete (scheme done / not done) and legacy-subgoal
 * (taskId present / absent, goal done / not done).
 *
 * Private method access uses `(loop as any).handleJobComplete(event)`.
 * runCompletionFlow, dispatchReadySubGoals are spied and stubbed to
 * prevent pulling in unrelated async work.
 */

import { describe, it, expect, vi } from 'vitest';
import { GovernanceLoop }       from '../../../src/alienclaw/governance/common/governance-loop.js';
import type { GoalsFile }          from '../../../src/alienclaw/types.js';
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

// ── Constants ─────────────────────────────────────────────────────────────────

const GOAL_ID     = 'g-1';
const CAMPAIGN_ID = 'camp-1';
const SUBGOAL_ID  = 'sg-1';
const TASK_ID     = 'task-1';

// ── Event helper ──────────────────────────────────────────────────────────────

function makeEvent(goalId: string, subGoalId: string) {
  return {
    type:      'JOB_COMPLETE' as const,
    goalId,
    subGoalId,
    result: {
      taskId:     't-1',
      subagentId: 'sa-1',
      outcome:    'SUCCESS' as const,
      summary:    'done',
      ts:         0,
    },
  };
}

// ── Factory ───────────────────────────────────────────────────────────────────

interface MakeLoopOpts {
  /** When true, the GoalsFile contains a campaign whose id === CAMPAIGN_ID. */
  isCampaign:      boolean;
  /** Controls goalManager.isSchemeComplete — used only when isCampaign=true. */
  schemeComplete?: boolean;
  /** Controls goalManager.isGoalComplete — used only when isCampaign=false. */
  goalComplete?:   boolean;
  /** When true, the legacy sub-goal carries taskId = TASK_ID. */
  hasTaskId?:      boolean;
}

function makeLoopForJobComplete(opts: MakeLoopOpts) {
  // Build GoalsFile shaped to make isCampaignSubGoal return the right value.
  const file: GoalsFile = opts.isCampaign
    ? {
        version:      '1',
        activeGoalId: GOAL_ID,
        goals: [{
          id:          GOAL_ID,
          description: 'scheme goal',
          subGoals:    [],
          status:      'active',
          createdAt:   0,
          scheme: {
            goalId:             GOAL_ID,
            rationale:          'test rationale',
            campaigns: [{
              id:        CAMPAIGN_ID,
              name:      'Campaign 1',
              objective: 'do the thing',
              subagents: [],
              dependsOn: [],
              status:    'active',
            }],
            advisorEndorsement: '',
            createdAt:          0,
          },
        }],
      }
    : {
        version:      '1',
        activeGoalId: GOAL_ID,
        goals: [{
          id:          GOAL_ID,
          description: 'legacy goal',
          subGoals: [{
            id:          SUBGOAL_ID,
            description: 'my sub-goal',
            domain:      'general',
            status:      'active',
            dependsOn:   [],
            ...(opts.hasTaskId ? { taskId: TASK_ID } : {}),
          }],
          status:    'active',
          createdAt: 0,
        }],
      };

  // Mocks
  const destroyTaskSessionsMock = vi.fn();
  const deregisterMock          = vi.fn();

  const goalManager = {
    load:             vi.fn(() => file),
    isSchemeComplete: vi.fn(() => opts.schemeComplete ?? false),
    isGoalComplete:   vi.fn(() => opts.goalComplete   ?? false),
    updateSubGoal:    vi.fn(async () => {}),
  } as unknown as GoalManager;

  const advisorBot = {
    destroyTaskSessions: destroyTaskSessionsMock,
  } as unknown as AdvisorBot;

  const taskManager = {
    deregister: deregisterMock,
  } as unknown as TaskManager;

  const userChannel = {
    required: vi.fn(),
    verbose:  vi.fn(),
    status:   vi.fn(),
    close:    vi.fn(),
  } as unknown as UserChannel;

  const loop = new GovernanceLoop({
    bossBot:           {} as unknown as BossBot,
    advisorBot,
    creatorBot:        {} as unknown as CreatorBot,
    agentRegistry:     {} as unknown as AgentRegistry,
    goalManager,
    taskManager,
    escalationHandler: {} as unknown as EscalationHandler,
    completionHandler: {} as unknown as CompletionHandler,
    userChannel,
    agentChannel:      {} as unknown as AgentChannel,
    adapter:           {} as unknown as MartianSummonAdapter,
  });

  // Spy on private methods — stub out async side-effects to keep tests isolated.
  const runCompletionFlowSpy     = vi.spyOn(loop as any, 'runCompletionFlow').mockResolvedValue(undefined);
  const pushEventSpy             = vi.spyOn(loop as any, 'pushEvent');
  const dispatchReadySubGoalsSpy = vi.spyOn(loop as any, 'dispatchReadySubGoals').mockResolvedValue(undefined);

  return {
    loop,
    goalManager,
    userChannel,
    runCompletionFlowSpy,
    pushEventSpy,
    dispatchReadySubGoalsSpy,
    destroyTaskSessionsMock,
    deregisterMock,
  };
}

// ── Campaign branch ───────────────────────────────────────────────────────────

describe('GovernanceLoop.handleJobComplete — campaign branch (packet 329)', () => {
  it('PKT-329-A: scheme complete calls runCompletionFlow', async () => {
    const { loop, runCompletionFlowSpy, pushEventSpy } = makeLoopForJobComplete({
      isCampaign:     true,
      schemeComplete: true,
    });
    const event = makeEvent(GOAL_ID, CAMPAIGN_ID);

    await (loop as any).handleJobComplete(event);

    expect(runCompletionFlowSpy).toHaveBeenCalledOnce();
    expect(runCompletionFlowSpy).toHaveBeenCalledWith(GOAL_ID);
    expect(pushEventSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CAMPAIGN_READY' }),
    );
  });

  it('PKT-329-B: scheme NOT complete pushes CAMPAIGN_READY event', async () => {
    const { loop, runCompletionFlowSpy, pushEventSpy } = makeLoopForJobComplete({
      isCampaign:     true,
      schemeComplete: false,
    });
    const event = makeEvent(GOAL_ID, CAMPAIGN_ID);

    await (loop as any).handleJobComplete(event);

    expect(runCompletionFlowSpy).not.toHaveBeenCalled();
    expect(pushEventSpy).toHaveBeenCalledWith({
      type:       'CAMPAIGN_READY',
      goalId:     GOAL_ID,
      campaignId: CAMPAIGN_ID,
    });
  });
});

// ── Legacy sub-goal branch ────────────────────────────────────────────────────

describe('GovernanceLoop.handleJobComplete — legacy branch (packet 329)', () => {
  it('PKT-329-C: subGoal with taskId destroys sessions and deregisters', async () => {
    const { loop, destroyTaskSessionsMock, deregisterMock } = makeLoopForJobComplete({
      isCampaign: false,
      hasTaskId:  true,
    });
    const event = makeEvent(GOAL_ID, SUBGOAL_ID);

    await (loop as any).handleJobComplete(event);

    expect(destroyTaskSessionsMock).toHaveBeenCalledOnce();
    expect(destroyTaskSessionsMock).toHaveBeenCalledWith(TASK_ID);
    expect(deregisterMock).toHaveBeenCalledOnce();
    expect(deregisterMock).toHaveBeenCalledWith(TASK_ID);
  });

  it('PKT-329-D: subGoal without taskId skips session destroy and deregister', async () => {
    const { loop, destroyTaskSessionsMock, deregisterMock } = makeLoopForJobComplete({
      isCampaign: false,
      hasTaskId:  false,
    });
    const event = makeEvent(GOAL_ID, SUBGOAL_ID);

    await (loop as any).handleJobComplete(event);

    expect(destroyTaskSessionsMock).not.toHaveBeenCalled();
    expect(deregisterMock).not.toHaveBeenCalled();
  });

  it('PKT-329-E: goal complete calls runCompletionFlow', async () => {
    const { loop, runCompletionFlowSpy, dispatchReadySubGoalsSpy } = makeLoopForJobComplete({
      isCampaign:   false,
      goalComplete: true,
    });
    const event = makeEvent(GOAL_ID, SUBGOAL_ID);

    await (loop as any).handleJobComplete(event);

    expect(runCompletionFlowSpy).toHaveBeenCalledOnce();
    expect(runCompletionFlowSpy).toHaveBeenCalledWith(GOAL_ID);
    expect(dispatchReadySubGoalsSpy).not.toHaveBeenCalled();
  });

  it('PKT-329-F: goal NOT complete calls dispatchReadySubGoals', async () => {
    const { loop, runCompletionFlowSpy, dispatchReadySubGoalsSpy } = makeLoopForJobComplete({
      isCampaign:   false,
      goalComplete: false,
    });
    const event = makeEvent(GOAL_ID, SUBGOAL_ID);

    await (loop as any).handleJobComplete(event);

    expect(dispatchReadySubGoalsSpy).toHaveBeenCalledOnce();
    expect(dispatchReadySubGoalsSpy).toHaveBeenCalledWith(GOAL_ID);
    expect(runCompletionFlowSpy).not.toHaveBeenCalled();
  });
});
