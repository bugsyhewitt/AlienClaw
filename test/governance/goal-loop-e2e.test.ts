/**
 * test/governance/goal-loop-e2e.test.ts
 *
 * End-to-end integration test for the scheme-based campaign dispatch path:
 *   goal → handleUserGoal → schemeWithAdvisor → dispatchReadyCampaigns → buildSubagent ×N
 *
 * Scope note: tests the dispatch phase (IDLE→EXECUTING). The completion/signoff
 * arc is covered by governance-loop-completion.test.ts.
 *
 * Regression: fails if campaignCreatorBot is unwired or if buildSubagent is
 * not called for each campaign in the scheme.
 *
 * Acceptance criteria:
 *   A-001 (R-001, R-003): 2-campaign scheme → buildSubagent ×2, both complete
 *   A-002 (R-002): legacy spawnLegacyJob not called for scheme-based campaigns
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { GovernanceLoop }      from '../../src/alienclaw/governance/common/governance-loop.js';
import type { GovernanceLoopDeps } from '../../src/alienclaw/governance/common/governance-loop.js';
import { DomainResolver }      from '../../src/alienclaw/governance/common/domain-resolver.js';
import type { CampaignResult } from '../../src/alienclaw/governance/common/subagent.js';
import type {
  Goal, Campaign, GoalsFile, Scheme, SubagentRole,
} from '../../src/alienclaw/types.js';

// ── In-memory GoalManager ─────────────────────────────────────────────────────

class InMemoryGoalManager {
  private _file: GoalsFile = { version: '1', activeGoalId: null, goals: [] };

  load(): GoalsFile { return this._file; }

  async save(file: GoalsFile): Promise<void> { this._file = file; }

  async addGoal(goal: Goal): Promise<void> {
    this._file.goals.push(goal);
    this._file.activeGoalId = goal.id;
  }

  async updateCampaign(
    goalId: string,
    campaignId: string,
    patch: Partial<Campaign>,
  ): Promise<void> {
    const campaign = this._file.goals
      .find(g => g.id === goalId)
      ?.scheme?.campaigns.find(c => c.id === campaignId);
    if (campaign) Object.assign(campaign, patch);
  }

  getReadyCampaigns(file: GoalsFile, goalId: string): Campaign[] {
    const goal = file.goals.find(g => g.id === goalId);
    if (!goal?.scheme) return [];
    return goal.scheme.campaigns.filter(c =>
      c.status === 'pending' &&
      c.dependsOn.every(dep =>
        goal.scheme!.campaigns.find(c2 => c2.id === dep)?.status === 'complete',
      ),
    );
  }

  getReadySubGoals(): never[] { return []; }

  isSchemeComplete(file: GoalsFile, goalId: string): boolean {
    const goal = file.goals.find(g => g.id === goalId);
    return goal?.scheme?.campaigns.every(c => c.status === 'complete') ?? false;
  }

  isGoalComplete(): boolean { return false; }

  async markGoalComplete(goalId: string): Promise<void> {
    const goal = this._file.goals.find(g => g.id === goalId);
    if (goal) goal.status = 'complete';
  }

  async updateSubGoal(): Promise<void> {}
  async foldUserInput(): Promise<void> {}
  async attachScheme(goalId: string, scheme: Scheme): Promise<void> {
    const goal = this._file.goals.find(g => g.id === goalId);
    if (goal) goal.scheme = scheme;
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeSubagentRole(domain: string): SubagentRole {
  return { role: `${domain} worker`, domain, knowledgeBase: '', martianTags: [domain] };
}

function makeScheme(goalId: string): Scheme {
  return {
    goalId,
    rationale: 'e2e test scheme',
    campaigns: [
      {
        id:        'c1',
        name:      'Campaign Alpha',
        objective: 'do alpha',
        subagents: [makeSubagentRole('compute')],
        dependsOn: [],
        status:    'pending',
      },
      {
        id:        'c2',
        name:      'Campaign Beta',
        objective: 'do beta',
        subagents: [makeSubagentRole('compute')],
        dependsOn: [],
        status:    'pending',
      },
    ],
    advisorEndorsement: 'approved',
    createdAt: 0,
  };
}

const STUB_CAMPAIGN_RESULT: CampaignResult = {
  subagentId:         'stub-subagent',
  campaignId:         'stub',
  fitness:            0.9,
  termination_reason: 'state_machine_finalized',
  summon_count:       1,
  final_output:       null,
};

function makeStubCreatorBot() {
  const buildSubagentSpy = vi.fn(() => ({
    birth:       vi.fn(),
    runCampaign: vi.fn(async () => STUB_CAMPAIGN_RESULT),
    erase:       vi.fn(),
  }));
  return { buildSubagentSpy, creatorBot: { buildSubagent: buildSubagentSpy } as any };
}

function makeDeps(opts: {
  goalManager: InMemoryGoalManager;
  campaignCreatorBot: any;
  bossBotMock: any;
  resolver: DomainResolver;
}): GovernanceLoopDeps {
  return {
    bossBot:            opts.bossBotMock,
    advisorBot:         { destroyTaskSessions: vi.fn(), advise: vi.fn() } as any,
    creatorBot: {
      flushNotable:  vi.fn(() => []),
      peekUrgent:    vi.fn(() => null),
      consumeUrgent: vi.fn(),
    } as any,
    agentRegistry:      { closeTask: vi.fn() } as any,
    goalManager:        opts.goalManager as any,
    taskManager:        { register: vi.fn(), assign: vi.fn(), deregister: vi.fn() } as any,
    escalationHandler:  {} as any,
    completionHandler: {
      review:       vi.fn(async () => ({ proceed: true, reopenIds: [] })),
      promptSignoff: vi.fn(async () => ({ approved: true })),
    } as any,
    userChannel: {
      status:   vi.fn(),
      verbose:  vi.fn(),
      required: vi.fn(),
      close:    vi.fn(),
    } as any,
    agentChannel:       {} as any,
    adapter:            {} as any,
    domainResolver:     opts.resolver,
    campaignCreatorBot: opts.campaignCreatorBot,
  } as unknown as GovernanceLoopDeps;
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('Packet 130 — goal-loop E2E: scheme dispatch drives buildSubagent ×N', () => {
  let goalManager:      InMemoryGoalManager;
  let resolver:         DomainResolver;

  beforeEach(() => {
    goalManager = new InMemoryGoalManager();
    resolver    = new DomainResolver(['compute']);
  });

  // ── A-001 ──────────────────────────────────────────────────────────────────
  it('A-001: 2-campaign scheme dispatches buildSubagent ×2; both campaigns reach complete', async () => {
    const { buildSubagentSpy, creatorBot: campaignCreatorBot } = makeStubCreatorBot();

    const bossBotMock = {
      schemeWithAdvisor: vi.fn(async (goalId: string) => makeScheme(goalId)),
      buildTask:         vi.fn(),
      generateSubGoals:  vi.fn(async () => []),
    };

    const deps = makeDeps({ goalManager, campaignCreatorBot, bossBotMock, resolver });
    const loop = new GovernanceLoop(deps);
    const legacyJobSpy = vi.spyOn(loop as any, 'spawnLegacyJob');

    // Drive goal → scheme → dispatch
    await (loop as any).handleUserGoal('test goal with 2 campaigns');

    // Capture background jobs before finally() removes them from activeJobs
    const jobs: Promise<void>[] = [...(loop as any).activeJobs.values()];

    // Settle background campaign jobs
    await Promise.all(jobs);

    // R-001: one buildSubagent call per campaign
    expect(buildSubagentSpy).toHaveBeenCalledTimes(2);

    // R-003: both campaigns reached 'complete'
    const file = goalManager.load();
    const goalId = file.activeGoalId!;
    const campaigns = file.goals.find(g => g.id === goalId)!.scheme!.campaigns;
    expect(campaigns.every(c => c.status === 'complete')).toBe(true);

    // A-002 inline: legacy path never touched
    expect(legacyJobSpy).not.toHaveBeenCalled();
  });

  // ── A-002 ──────────────────────────────────────────────────────────────────
  it('A-002: spawnLegacyJob is never called for a scheme-based goal', async () => {
    const { creatorBot: campaignCreatorBot } = makeStubCreatorBot();

    const bossBotMock = {
      schemeWithAdvisor: vi.fn(async (goalId: string) => makeScheme(goalId)),
      buildTask:         vi.fn(),
      generateSubGoals:  vi.fn(async () => []),
    };

    const deps = makeDeps({ goalManager, campaignCreatorBot, bossBotMock, resolver });
    const loop = new GovernanceLoop(deps);
    const legacyJobSpy = vi.spyOn(loop as any, 'spawnLegacyJob');

    await (loop as any).handleUserGoal('test goal');
    const jobs: Promise<void>[] = [...(loop as any).activeJobs.values()];
    await Promise.all(jobs);

    expect(legacyJobSpy).not.toHaveBeenCalled();
  });

  // ── Packet 241 ────────────────────────────────────────────────────────────
  it('handleUserGoal — non-IDLE state delegates to handleUserInput with fold-into-plan status', async () => {
    const bossBotMock = {
      schemeWithAdvisor: vi.fn(),
      buildTask:         vi.fn(),
      generateSubGoals:  vi.fn(async () => []),
    };
    const { creatorBot: campaignCreatorBot } = makeStubCreatorBot();
    const deps = makeDeps({ goalManager, campaignCreatorBot, bossBotMock, resolver });
    const loop = new GovernanceLoop(deps);

    // Put loop in a non-IDLE state with an active goal (simulates mid-execution)
    (loop as any).state = 'EXECUTING';
    (loop as any).currentGoalId = 'existing-goal-id';

    // Spy on handleUserInput to capture delegation without running the full chain
    const handleUserInputSpy = vi.spyOn(loop as any, 'handleUserInput').mockResolvedValue(undefined);

    await (loop as any).handleUserGoal('urgent new goal');

    expect(deps.userChannel.status).toHaveBeenCalledWith(
      'New input while goal is active — folding into plan.'
    );
    expect(handleUserInputSpy).toHaveBeenCalledWith('urgent new goal');
  });
});
