/**
 * governance-loop.test.ts
 *
 * Unit tests for `src/alienclaw/governance/common/governance-loop.ts`.
 *
 * Packet 096: resumeGoal() crash recovery silently skips legacy sub-goal dispatch.
 *
 * Background:
 *   `resumeGoal()` dispatches `dispatchReadyCampaigns()` but (before this fix)
 *   never called `dispatchReadySubGoals()`. For legacy goals (no scheme),
 *   `getReadyCampaigns()` returns [] immediately, so any pending sub-goals
 *   were orphaned and the goal hung forever.
 *
 *   Fix: add `await this.dispatchReadySubGoals(goalId)` after
 *   `dispatchReadyCampaigns(goalId)` in `resumeGoal()`.
 *
 * Test coverage (2 cases):
 *   - Legacy goal (no scheme): dispatchReadySubGoals must be called.
 *   - Scheme goal: dispatchReadySubGoals must also be called (Scenario B — mixed goals).
 */

import { describe, it, expect } from 'vitest';
import { GovernanceLoop }         from '../../../src/alienclaw/governance/common/governance-loop.js';
import type { GoalManager }       from '../../../src/alienclaw/governance/common/goal-manager.js';
import type { TaskManager }       from '../../../src/alienclaw/governance/common/task-manager.js';
import type { EscalationHandler } from '../../../src/alienclaw/governance/common/escalation-handler.js';
import type { CompletionHandler } from '../../../src/alienclaw/governance/common/completion-handler.js';
import type { BossBot }           from '../../../src/alienclaw/agents/bossbot.js';
import type { AdvisorBot }        from '../../../src/alienclaw/agents/advisorbot.js';
import type { CreatorBot }        from '../../../src/alienclaw/agents/creatorbot.js';
import type { AgentRegistry }     from '../../../src/alienclaw/agents/agent-registry.js';
import type { MartianSummonAdapter } from '../../../src/alienclaw/governance/common/summon-adapter.js';
import type { UserChannel }       from '../../../src/alienclaw/comms/user-channel.js';
import type { AgentChannel }      from '../../../src/alienclaw/comms/agent-channel.js';

// ── Shared stubs ──────────────────────────────────────────────────────────────

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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GovernanceLoop.resumeGoal — legacy sub-goal dispatch (packet 096)', () => {
  it('calls dispatchReadySubGoals for a legacy goal with no scheme', async () => {
    const file = {
      version:      '1',
      activeGoalId: 'goal-1',
      goals: [{
        id:          'goal-1',
        description: 'legacy goal',
        subGoals: [{
          id:          'sg-1',
          description: 'do something',
          domain:      'analyst',
          status:      'active' as const,
          dependsOn:   [],
        }],
        status:    'active' as const,
        createdAt: 0,
        // no scheme
      }],
    };

    const goalManager = {
      load:             () => file,
      save:             async () => {},
      getReadyCampaigns: () => [],
    } as unknown as GoalManager;

    const loop = new GovernanceLoop({
      bossBot:           noopBossBot,
      advisorBot:        noopAdvisorBot,
      creatorBot:        noopCreatorBot,
      agentRegistry:     noopAgentRegistry,
      goalManager,
      taskManager:       noopTaskManager,
      escalationHandler: noopEscalationHandler,
      completionHandler: noopCompletionHandler,
      userChannel:       makeUserChannel(),
      agentChannel:      noopAgentChannel,
      adapter:           noopAdapter,
    });

    let subGoalDispatchCalled = false;
    (loop as any).dispatchReadySubGoals = async (_id: string) => {
      subGoalDispatchCalled = true;
    };

    await loop.resumeGoal('goal-1');

    expect(subGoalDispatchCalled).toBe(true);
  });

  it('resets active sub-goals to pending for a scheme goal with folded-in sub-goals (Scenario B, packet 097)', async () => {
    const file = {
      version:      '1',
      activeGoalId: 'goal-2',
      goals: [{
        id:          'goal-2',
        description: 'scheme goal with folded sub-goals',
        subGoals: [{
          id:          'sg-folded',
          description: 'additional context from user',
          domain:      'researcher',
          status:      'active' as const,
          taskId:      'old-task-id',
          dependsOn:   [],
        }],
        status:    'active' as const,
        createdAt: 0,
        scheme: {
          goalId:    'goal-2',
          rationale: 'test scheme',
          campaigns: [{
            id:        'c-1',
            name:      'Campaign 1',
            objective: 'do the thing',
            subagents: [],
            dependsOn: [],
            status:    'active' as const,
          }],
          advisorEndorsement: '',
          createdAt:          0,
        },
      }],
    };

    let saveCalled = false;
    const goalManager = {
      load:             () => file,
      save:             async () => { saveCalled = true; },
      attachScheme:     async () => {},
      getReadyCampaigns: () => [],
      getReadySubGoals: () => [],
    } as unknown as GoalManager;

    const loop = new GovernanceLoop({
      bossBot:           noopBossBot,
      advisorBot:        noopAdvisorBot,
      creatorBot:        noopCreatorBot,
      agentRegistry:     noopAgentRegistry,
      goalManager,
      taskManager:       noopTaskManager,
      escalationHandler: noopEscalationHandler,
      completionHandler: noopCompletionHandler,
      userChannel:       makeUserChannel(),
      agentChannel:      noopAgentChannel,
      adapter:           noopAdapter,
    });

    await loop.resumeGoal('goal-2');

    const sg = file.goals[0].subGoals[0] as any;
    expect(sg.status).toBe('pending');
    expect(sg.taskId).toBeUndefined();
    expect(saveCalled).toBe(true);
  });
});
