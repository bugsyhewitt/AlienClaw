/**
 * test/governance/online-fitness-recording.test.ts
 *
 * TDD — written BEFORE implementation; must FAIL first (module not found), then PASS after.
 *
 * Packet 129: Record each summoned subagent's runtime fitness into OnlineFitnessLog
 * at campaign completion.
 *
 * Acceptance criteria:
 *   A-001 (R-001, R-002): completed campaign writes 1 entry with correct martianType + fitness
 *   A-002 (R-004): failed campaign writes 0 entries
 *   A-003 (R-003): no log wired → spawnCampaign succeeds, no error thrown
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import path                    from 'node:path';

import { GovernanceLoop }     from '../../src/alienclaw/governance/common/governance-loop.js';
import type { GovernanceLoopDeps } from '../../src/alienclaw/governance/common/governance-loop.js';
import { OnlineFitnessLog }   from '../../src/alienclaw/governance/common/online-fitness-log.js';
import { DomainResolver }     from '../../src/alienclaw/governance/common/domain-resolver.js';
import type { CampaignResult } from '../../src/alienclaw/governance/common/subagent.js';
import type { Campaign, GoalsFile } from '../../src/alienclaw/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCampaign(override: Partial<Campaign> = {}): Campaign {
  return {
    id:        'camp-test-1',
    name:      'test campaign',
    objective: 'test objective',
    subagents: [{
      role:          'Compute Worker',
      domain:        'compute',
      knowledgeBase: '',
      martianTags:   ['compute'],
    }],
    dependsOn: [],
    status:    'pending',
    ...override,
  };
}

/** Stub subagent that returns a controlled CampaignResult. */
function makeStubSubagent(result: CampaignResult) {
  return {
    birth:       vi.fn(),
    runCampaign: vi.fn(async () => result),
    erase:       vi.fn(),
  };
}

function makeStubCreatorBot(result: CampaignResult) {
  const stub = makeStubSubagent(result);
  return {
    buildSubagent: vi.fn(() => stub),
    _stub: stub,
  };
}

/** Minimal GovernanceLoopDeps for spawnCampaign tests. */
function makeDeps(opts: {
  creatorBot: ReturnType<typeof makeStubCreatorBot>;
  resolver:   DomainResolver;
  fitnessLog?: OnlineFitnessLog;
}): GovernanceLoopDeps {
  const file: GoalsFile = { version: '1', activeGoalId: null, goals: [] };
  return {
    bossBot:           {} as any,
    advisorBot:        {} as any,
    creatorBot:        { flushNotable: vi.fn(() => []), peekUrgent: vi.fn(() => null), consumeUrgent: vi.fn() } as any,
    agentRegistry:     {} as any,
    goalManager: {
      updateCampaign:    vi.fn(async () => {}),
      updateSubGoal:     vi.fn(async () => {}),
      load:              vi.fn(() => file),
      getReadyCampaigns: vi.fn(() => [] as Campaign[]),
      getReadySubGoals:  vi.fn(() => []),
    } as any,
    taskManager:       { register: vi.fn(), assign: vi.fn(), deregister: vi.fn() } as any,
    escalationHandler: {} as any,
    completionHandler: {} as any,
    userChannel:       { status: vi.fn(), verbose: vi.fn(), required: vi.fn() } as any,
    agentChannel:      {} as any,
    adapter:           {} as any,
    domainResolver:    opts.resolver,
    campaignCreatorBot: opts.creatorBot as any,
    onlineFitnessLog:  opts.fitnessLog,
  } as unknown as GovernanceLoopDeps;
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('Packet 129 — OnlineFitnessLog wired into GovernanceLoop.spawnCampaign', () => {
  let tmpDir:     string;
  let fitnessLog: OnlineFitnessLog;
  let resolver:   DomainResolver;

  beforeEach(() => {
    tmpDir     = mkdtempSync(path.join(tmpdir(), 'alienclaw-p129-'));
    fitnessLog = new OnlineFitnessLog(path.join(tmpDir, 'online_fitness.jsonl'));
    resolver   = new DomainResolver(['compute']);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── A-001 ──────────────────────────────────────────────────────────────────
  it('A-001: completed campaign writes exactly 1 entry with correct martianType + fitness', async () => {
    const successResult: CampaignResult = {
      subagentId:         'stub',
      campaignId:         'camp-test-1',
      fitness:            0.9,
      termination_reason: 'state_machine_finalized',
      summon_count:       1,
      final_output:       null,
    };
    const creatorBot = makeStubCreatorBot(successResult);
    const deps       = makeDeps({ creatorBot, resolver, fitnessLog });
    const loop       = new GovernanceLoop(deps);
    const campaign   = makeCampaign();

    await (loop as any).spawnCampaign('goal-1', campaign);
    const job: Promise<void> | undefined = (loop as any).activeJobs.get(campaign.id);
    if (job) await job;

    const entries = fitnessLog.read();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.martian_type).toBe('compute');
    expect(entries[0]!.fitness).toBe(0.9);
  });

  // ── A-002 ──────────────────────────────────────────────────────────────────
  it('A-002: failed campaign writes 0 entries', async () => {
    const failResult: CampaignResult = {
      subagentId:         'stub',
      campaignId:         'camp-test-1',
      fitness:            0.0,
      termination_reason: 'decision_rule_error',
      summon_count:       0,
      final_output:       null,
    };
    const creatorBot = makeStubCreatorBot(failResult);
    const deps       = makeDeps({ creatorBot, resolver, fitnessLog });
    const loop       = new GovernanceLoop(deps);
    const campaign   = makeCampaign();

    await (loop as any).spawnCampaign('goal-1', campaign);
    const job: Promise<void> | undefined = (loop as any).activeJobs.get(campaign.id);
    if (job) await job;

    expect(fitnessLog.read()).toHaveLength(0);
  });

  // ── A-003 ──────────────────────────────────────────────────────────────────
  it('A-003: no log wired — spawnCampaign succeeds, no error thrown', async () => {
    const successResult: CampaignResult = {
      subagentId:         'stub',
      campaignId:         'camp-test-1',
      fitness:            0.9,
      termination_reason: 'state_machine_finalized',
      summon_count:       1,
      final_output:       null,
    };
    const creatorBot = makeStubCreatorBot(successResult);
    const deps       = makeDeps({ creatorBot, resolver, fitnessLog: undefined });
    const loop       = new GovernanceLoop(deps);
    const campaign   = makeCampaign();

    // Direct await — any thrown exception naturally fails the test
    await (loop as any).spawnCampaign('goal-1', campaign);
    const job: Promise<void> | undefined = (loop as any).activeJobs.get(campaign.id);
    if (job) await job;

    // goalManager.updateCampaign still called — the succeeded path ran
    expect((deps.goalManager as any).updateCampaign).toHaveBeenCalledWith(
      'goal-1', campaign.id, { status: 'complete' },
    );
  });
});
