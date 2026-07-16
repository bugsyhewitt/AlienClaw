/**
 * governance-loop-processEvent.test.ts
 *
 * Covers all five switch arms of GovernanceLoop.processEvent() (packet 240).
 * Each arm is exercised with a stub replacing the downstream handler method;
 * the test confirms processEvent calls the correct handler with the correct
 * argument(s) for every GovernanceEvent discriminant:
 *
 *   USER_GOAL        → handleUserGoal(description)
 *   USER_INPUT       → handleUserInput(message)
 *   CAMPAIGN_READY   → dispatchReadyCampaigns(goalId)
 *   JOB_COMPLETE     → handleJobComplete(event)
 *   JOB_FAILED       → handleJobFailed(event)
 *
 * No source files are modified; all production code already exists.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GovernanceLoop } from '../../../src/alienclaw/governance/common/governance-loop.js';
import type { BossBot }              from '../../../src/alienclaw/agents/bossbot.js';
import type { AdvisorBot }           from '../../../src/alienclaw/agents/advisorbot.js';
import type { CreatorBot }           from '../../../src/alienclaw/agents/creatorbot.js';
import type { AgentRegistry }        from '../../../src/alienclaw/agents/agent-registry.js';
import type { GoalManager }          from '../../../src/alienclaw/governance/common/goal-manager.js';
import type { TaskManager }          from '../../../src/alienclaw/governance/common/task-manager.js';
import type { EscalationHandler }    from '../../../src/alienclaw/governance/common/escalation-handler.js';
import type { CompletionHandler }    from '../../../src/alienclaw/governance/common/completion-handler.js';
import type { MartianSummonAdapter } from '../../../src/alienclaw/governance/common/summon-adapter.js';
import type { UserChannel }          from '../../../src/alienclaw/comms/user-channel.js';
import type { AgentChannel }         from '../../../src/alienclaw/comms/agent-channel.js';
import type { GoalsFile, TaskResult } from '../../../src/alienclaw/types.js';

// ── Noop dependency stubs ────────────────────────────────────────────────────

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

const noopGoalManager = {
  load: () => ({ version: '1', activeGoalId: null, goals: [] }) as GoalsFile,
} as unknown as GoalManager;

function buildLoop(): GovernanceLoop {
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

// ── processEvent dispatch routing ────────────────────────────────────────────

describe('GovernanceLoop.processEvent() dispatch routing (packet 240)', () => {
  let loop: GovernanceLoop;

  beforeEach(() => {
    loop = buildLoop();
    // stub each handler
    (loop as any).handleUserGoal         = vi.fn().mockResolvedValue(undefined);
    (loop as any).handleUserInput        = vi.fn().mockResolvedValue(undefined);
    (loop as any).dispatchReadyCampaigns = vi.fn().mockResolvedValue(undefined);
    (loop as any).handleJobComplete      = vi.fn().mockResolvedValue(undefined);
    (loop as any).handleJobFailed        = vi.fn().mockResolvedValue(undefined);
  });

  it('routes USER_GOAL → handleUserGoal', async () => {
    await (loop as any).processEvent({ type: 'USER_GOAL', description: 'build X' });
    expect((loop as any).handleUserGoal).toHaveBeenCalledWith('build X');
  });

  it('routes USER_INPUT → handleUserInput', async () => {
    await (loop as any).processEvent({ type: 'USER_INPUT', message: 'update' });
    expect((loop as any).handleUserInput).toHaveBeenCalledWith('update');
  });

  it('routes CAMPAIGN_READY → dispatchReadyCampaigns', async () => {
    await (loop as any).processEvent({ type: 'CAMPAIGN_READY', goalId: 'g-1', campaignId: 'c-1' });
    expect((loop as any).dispatchReadyCampaigns).toHaveBeenCalledWith('g-1');
  });

  it('routes JOB_COMPLETE → handleJobComplete', async () => {
    const result: TaskResult = { taskId: 't-1', subagentId: 'sa-1', outcome: 'SUCCESS', summary: 'done', ts: 0 };
    const ev = { type: 'JOB_COMPLETE' as const, subGoalId: 'sg-1', goalId: 'g-1', result };
    await (loop as any).processEvent(ev);
    expect((loop as any).handleJobComplete).toHaveBeenCalledWith(ev);
  });

  it('routes JOB_FAILED → handleJobFailed', async () => {
    const ev = { type: 'JOB_FAILED' as const, subGoalId: 'sg-1', goalId: 'g-1', error: 'boom' };
    await (loop as any).processEvent(ev);
    expect((loop as any).handleJobFailed).toHaveBeenCalledWith(ev);
  });
});
