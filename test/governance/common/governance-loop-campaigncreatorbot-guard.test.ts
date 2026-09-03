/**
 * governance-loop-campaigncreatorbot-guard.test.ts
 *
 * TDD — written BEFORE implementation; must FAIL first, then PASS after.
 *
 * Packet 444: GovernanceLoop.campaignCreatorBot optional type vs ! non-null assertion
 *
 * Three call sites use `this.campaignCreatorBot!.buildSubagent(...)` but the field is
 * typed `?: CommonCreatorBot` (optional). Constructing GovernanceLoop without wiring
 * campaignCreatorBot and exercising any of these paths crashes with a TypeError.
 *
 * Fix (Option A): guard each call site — if campaignCreatorBot is absent, push a
 * JOB_FAILED event with a descriptive error and return (mirroring domainResolver pattern).
 *
 * Test coverage (3 cases, one per call site):
 *   PKT-444-A  spawnCampaign without campaignCreatorBot → JOB_FAILED event pushed
 *   PKT-444-B  retryCampaign (handleJobFailed REBUILD path) without campaignCreatorBot → JOB_FAILED
 *   PKT-444-C  spawnLegacyJob without campaignCreatorBot → JOB_FAILED event pushed
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
import type { Campaign, SubGoal }   from '../../../src/alienclaw/types.js';

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

function makeCampaign(override: Partial<Campaign> = {}): Campaign {
  return {
    id:        'camp-1',
    name:      'test campaign',
    objective: 'test objective',
    subagents: [{
      role:          'Compute Worker',
      domain:        'compute',
      martianTags:   ['compute'],
      knowledgeBase: '',
    }],
    status:     'pending',
    dependsOn:  [],
    ...override,
  };
}

function makeSubGoal(override: Partial<SubGoal> = {}): SubGoal {
  return {
    id:          'sg-1',
    description: 'do something useful',
    domain:      'compute',
    status:      'active',
    dependsOn:   [],
    taskId:      'task-1',
    ...override,
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PKT-444: campaignCreatorBot guard — JOB_FAILED on unwired dep', () => {

  it('PKT-444-A: spawnCampaign without campaignCreatorBot pushes JOB_FAILED instead of crashing', async () => {
    const campaign = makeCampaign();
    const goalManager = {
      load:             vi.fn(),
      getReadyCampaigns: vi.fn(() => [campaign]),
      updateCampaign:   vi.fn().mockResolvedValue(undefined),
    } as unknown as GoalManager;

    const loop = new GovernanceLoop({
      bossBot:           noopBossBot,
      advisorBot:        noopAdvisorBot,
      creatorBot:        noopCreatorBot,
      agentRegistry:     noopAgentRegistry,
      goalManager,
      taskManager:       {} as unknown as TaskManager,
      escalationHandler: {} as unknown as EscalationHandler,
      completionHandler: noopCompletionHandler,
      userChannel:       makeUserChannel(),
      agentChannel:      noopAgentChannel,
      adapter:           noopAdapter,
      // campaignCreatorBot intentionally omitted
    });

    const pushedEvents: unknown[] = [];
    (loop as any).pushEvent    = (ev: unknown) => pushedEvents.push(ev);
    (loop as any).transition   = vi.fn();

    // Call spawnCampaign directly (private — reached via any cast)
    await expect(
      (loop as any).spawnCampaign('goal-1', campaign)
    ).resolves.toBeUndefined();

    const failed = pushedEvents.find((e: any) => e.type === 'JOB_FAILED') as any;
    expect(failed, 'expected a JOB_FAILED event').toBeDefined();
    expect(failed.subGoalId).toBe('camp-1');
    expect(failed.goalId).toBe('goal-1');
    expect(failed.error).toMatch(/campaignCreatorBot/i);
  });

  it('PKT-444-B: retryCampaign (handleJobFailed REBUILD) without campaignCreatorBot pushes JOB_FAILED', async () => {
    const subGoal = makeSubGoal();
    const task    = makeTask(0);

    const goalFile = {
      version:      '1',
      activeGoalId: 'goal-1',
      goals: [{
        id:          'goal-1',
        description: 'legacy goal',
        subGoals:    [subGoal],
        status:      'active' as const,
        createdAt:   0,
        // no scheme — forces legacy sub-goal path in handleJobFailed
      }],
    };

    const goalManager = {
      load: () => goalFile,
    } as unknown as GoalManager;
    const taskManager = {
      get:    vi.fn(() => task),
      assign: vi.fn(),
    } as unknown as TaskManager;
    const escalationHandler = {
      handleFailure: vi.fn().mockResolvedValue({ action: 'REBUILD' as const }),
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
      // campaignCreatorBot intentionally omitted
    });

    const pushedEvents: unknown[] = [];
    (loop as any).pushEvent    = (ev: unknown) => pushedEvents.push(ev);
    (loop as any).transition   = vi.fn();

    const jobFailedEvent = {
      type:      'JOB_FAILED' as const,
      goalId:    'goal-1',
      subGoalId: 'sg-1',
      error:     'upstream error',
    };

    await expect(
      (loop as any).handleJobFailed(jobFailedEvent)
    ).resolves.toBeUndefined();

    const failed = pushedEvents.find((e: any) => e.type === 'JOB_FAILED') as any;
    expect(failed, 'expected a JOB_FAILED event').toBeDefined();
    expect(failed.subGoalId).toBe('sg-1');
    expect(failed.goalId).toBe('goal-1');
    expect(failed.error).toMatch(/campaignCreatorBot/i);
  });

  it('PKT-444-C: spawnLegacyJob without campaignCreatorBot pushes JOB_FAILED instead of crashing', async () => {
    const subGoal = makeSubGoal();
    const task    = makeTask();

    const bossBot = {
      buildTask: vi.fn(() => task),
    } as unknown as BossBot;
    const taskManager = {
      register: vi.fn(),
      assign:   vi.fn(),
    } as unknown as TaskManager;
    const goalManager = {
      updateSubGoal: vi.fn().mockResolvedValue(undefined),
    } as unknown as GoalManager;

    const loop = new GovernanceLoop({
      bossBot,
      advisorBot:        noopAdvisorBot,
      creatorBot:        noopCreatorBot,
      agentRegistry:     noopAgentRegistry,
      goalManager,
      taskManager,
      escalationHandler: {} as unknown as EscalationHandler,
      completionHandler: noopCompletionHandler,
      userChannel:       makeUserChannel(),
      agentChannel:      noopAgentChannel,
      adapter:           noopAdapter,
      // campaignCreatorBot intentionally omitted
    });

    const pushedEvents: unknown[] = [];
    (loop as any).pushEvent    = (ev: unknown) => pushedEvents.push(ev);
    (loop as any).transition   = vi.fn();

    await expect(
      (loop as any).spawnLegacyJob('goal-1', subGoal)
    ).resolves.toBeUndefined();

    const failed = pushedEvents.find((e: any) => e.type === 'JOB_FAILED') as any;
    expect(failed, 'expected a JOB_FAILED event').toBeDefined();
    expect(failed.subGoalId).toBe('sg-1');
    expect(failed.goalId).toBe('goal-1');
    expect(failed.error).toMatch(/campaignCreatorBot/i);
  });
});
