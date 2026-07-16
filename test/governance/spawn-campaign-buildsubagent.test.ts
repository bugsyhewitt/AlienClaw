/**
 * test/governance/spawn-campaign-buildsubagent.test.ts
 *
 * TDD — written BEFORE implementation; must FAIL first, then PASS after.
 *
 * Packet 125: Route all 3 inline `new Subagent(this.adapter, ...)` sites in
 * GovernanceLoop through campaignCreatorBot.buildSubagent() so every campaign
 * summon uses fromPopulation: true.
 *
 * Acceptance criteria:
 *   A-001 spawnCampaign routes through buildSubagent; returned sub has fromPopulation: true
 *   A-003 spawnLegacyJob routes through buildSubagent; returned sub has fromPopulation: true
 *   A-004 workspace written synchronously by buildSubagent (birth before campaign loop)
 *   A-005 backgroundContext from campaign.subagents[0].knowledgeBase reaches CAMPAIGN.md
 *   A-006 zero `new Subagent(this.adapter` constructions remain in governance-loop.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

import { GovernanceLoop } from '../../src/alienclaw/governance/common/governance-loop.js';
import type { GovernanceLoopDeps } from '../../src/alienclaw/governance/common/governance-loop.js';
import { CreatorBot as CommonCreatorBot } from '../../src/alienclaw/governance/common/creator-bot.js';
import { DomainResolver } from '../../src/alienclaw/governance/common/domain-resolver.js';
import { Logger, InMemorySink } from '../../src/alienclaw/governance/common/logger.js';
import type {
  MartianSummonAdapter,
  MartianSummonRequest,
  MartianSummonResult,
} from '../../src/alienclaw/governance/common/summon-adapter.js';
import type { Campaign, SubGoal, GoalsFile } from '../../src/alienclaw/types.js';

// ── CapturingAdapter ──────────────────────────────────────────────────────────

class CapturingAdapter implements MartianSummonAdapter {
  readonly requests: MartianSummonRequest[] = [];
  async summon(request: MartianSummonRequest): Promise<MartianSummonResult> {
    this.requests.push(request);
    return {
      summon_id:    request.summon_id,
      ok:           true,
      output:       { echoed: request.martian_type },
      fitness:      0.7,
      run_metadata: { tool_calls: 1, wall_clock_ms: 1 },
    };
  }
}

// ── Campaign fixture ──────────────────────────────────────────────────────────

function makeCampaign(override: Partial<Campaign> = {}): Campaign {
  return {
    id:        'camp-test-1',
    name:      'test campaign',
    objective: 'test objective',
    subagents: [{
      role:          'Compute Worker',
      domain:        'compute',
      knowledgeBase: 'my knowledge base context',
      martianTags:   ['compute'],
    }],
    dependsOn: [],
    status:    'pending',
    ...override,
  };
}

// ── Deps factory ──────────────────────────────────────────────────────────────

function makeDeps(opts: {
  commonBot: CommonCreatorBot;
  adapter:   MartianSummonAdapter;
  resolver?: DomainResolver;
}): GovernanceLoopDeps {
  const file: GoalsFile = {
    version:      '1',
    activeGoalId: null,
    goals:        [],
  };

  return {
    bossBot: {
      buildTask: vi.fn((_desc: string, _domain: string) => ({
        taskId:      'task-1',
        description: _desc,
        domain:      _domain,
        priority:    'normal' as const,
        createdAt:   Date.now(),
        strikeCount: 0,
        attempts:    [],
      })),
    } as any,
    advisorBot:    {} as any,
    creatorBot:    {
      flushNotable:  vi.fn(() => []),
      peekUrgent:    vi.fn(() => null),
      consumeUrgent: vi.fn(),
    } as any,
    agentRegistry: {} as any,
    goalManager: {
      updateCampaign: vi.fn(async () => {}),
      updateSubGoal:  vi.fn(async () => {}),
      load:           vi.fn(() => file),
      getReadyCampaigns: vi.fn(() => [] as Campaign[]),
      getReadySubGoals:  vi.fn(() => [] as SubGoal[]),
    } as any,
    taskManager: {
      register:   vi.fn(),
      assign:     vi.fn(),
      deregister: vi.fn(),
    } as any,
    escalationHandler:  {} as any,
    completionHandler:  {} as any,
    userChannel: {
      status:   vi.fn(),
      verbose:  vi.fn(),
      required: vi.fn(),
    } as any,
    agentChannel:       {} as any,
    adapter:            opts.adapter,
    domainResolver:     opts.resolver,
    // campaignCreatorBot is the packet-125 optional dep — field added by implementation
    campaignCreatorBot: opts.commonBot,
  } as unknown as GovernanceLoopDeps;
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('Packet 125 — GovernanceLoop spawn sites route through buildSubagent', () => {
  let baseDir:   string;
  let adapter:   CapturingAdapter;
  let resolver:  DomainResolver;
  let commonBot: CommonCreatorBot;

  beforeEach(() => {
    baseDir   = mkdtempSync(path.join(tmpdir(), 'alienclaw-p125-'));
    adapter   = new CapturingAdapter();
    resolver  = new DomainResolver(['compute']);
    commonBot = new CommonCreatorBot(
      new Logger(new InMemorySink(), 'creator-bot-p125'),
      adapter,
      baseDir,
      resolver,
    );
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  // ── A-001 ─────────────────────────────────────────────────────────────────
  it('A-001: spawnCampaign calls buildSubagent once and returned sub has fromPopulation: true', async () => {
    const buildSubagentSpy = vi.spyOn(commonBot, 'buildSubagent');

    const deps = makeDeps({ commonBot, adapter, resolver });
    const loop = new GovernanceLoop(deps);

    const campaign = makeCampaign();
    await (loop as any).spawnCampaign('goal-1', campaign);

    expect(buildSubagentSpy).toHaveBeenCalledOnce();
    const returnedSub = buildSubagentSpy.mock.results[0]!.value;
    expect((returnedSub as any).opts.fromPopulation).toBe(true);
  });

  // ── A-003 ─────────────────────────────────────────────────────────────────
  it('A-003: spawnLegacyJob calls buildSubagent once and returned sub has fromPopulation: true', async () => {
    const buildSubagentSpy = vi.spyOn(commonBot, 'buildSubagent');

    const deps = makeDeps({ commonBot, adapter, resolver });
    const loop = new GovernanceLoop(deps);

    const subGoal: SubGoal = {
      id:          'sg-legacy-1',
      description: 'write some compute',
      domain:      'compute',
      status:      'pending',
      dependsOn:   [],
    };
    await (loop as any).spawnLegacyJob('goal-1', subGoal);

    expect(buildSubagentSpy).toHaveBeenCalledOnce();
    const returnedSub = buildSubagentSpy.mock.results[0]!.value;
    expect((returnedSub as any).opts.fromPopulation).toBe(true);
  });

  // ── A-004 ─────────────────────────────────────────────────────────────────
  it('A-004: workspace is written synchronously by buildSubagent (birth before campaign loop)', async () => {
    // Mock erase() on the returned sub to prevent the background job from
    // cleaning up the workspace before we can check it.
    const buildSubagentSpy = vi.spyOn(commonBot, 'buildSubagent').mockImplementation(
      (domain: string, spec: any) => {
        const sub = CommonCreatorBot.prototype.buildSubagent.call(commonBot, domain, spec);
        vi.spyOn(sub, 'erase').mockImplementation(() => {});
        return sub;
      }
    );

    const deps = makeDeps({ commonBot, adapter, resolver });
    const loop = new GovernanceLoop(deps);

    const campaign = makeCampaign();
    await (loop as any).spawnCampaign('goal-1', campaign);

    // Workspace must exist IMMEDIATELY after spawnCampaign (not after the async loop runs)
    expect(buildSubagentSpy).toHaveBeenCalledOnce();
    expect(existsSync(path.join(baseDir, campaign.id))).toBe(true);
    expect(existsSync(path.join(baseDir, campaign.id, 'SOUL.md'))).toBe(true);
  });

  // ── A-005 ─────────────────────────────────────────────────────────────────
  it('A-005: backgroundContext from campaign knowledgeBase propagates into workspace CAMPAIGN.md', async () => {
    const buildSubagentSpy = vi.spyOn(commonBot, 'buildSubagent').mockImplementation(
      (domain: string, spec: any) => {
        const sub = CommonCreatorBot.prototype.buildSubagent.call(commonBot, domain, spec);
        vi.spyOn(sub, 'erase').mockImplementation(() => {});
        return sub;
      }
    );

    const deps = makeDeps({ commonBot, adapter, resolver });
    const loop = new GovernanceLoop(deps);

    // campaign.subagents[0].knowledgeBase = 'my knowledge base context'
    const campaign = makeCampaign();
    await (loop as any).spawnCampaign('goal-1', campaign);

    expect(buildSubagentSpy).toHaveBeenCalledOnce();
    const campaignMd = readFileSync(
      path.join(baseDir, campaign.id, 'CAMPAIGN.md'),
      'utf-8',
    );
    expect(campaignMd).toContain('my knowledge base context');
  });

  // ── A-006 ─────────────────────────────────────────────────────────────────
  it('A-006: zero `new Subagent(this.adapter` constructions remain in governance-loop.ts', () => {
    const repoRoot = path.resolve(__dirname, '../../');
    const filePath = path.join(
      repoRoot,
      'src/alienclaw/governance/common/governance-loop.ts',
    );
    let count: number;
    try {
      const output = execSync(
        `grep -c "new Subagent(this\\.adapter" "${filePath}"`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      ).trim();
      count = parseInt(output, 10);
    } catch {
      // grep exits 1 when there are no matching lines (count = 0)
      count = 0;
    }
    expect(count).toBe(0);
  });

  // ── A-007 ─────────────────────────────────────────────────────────────────
  it('A-007: no domainResolver + rawDomain defined — uses rawDomain directly, no JOB_FAILED (L366/L372 arm A)', async () => {
    // Use a CreatorBot whose resolver knows 'analyst' so buildSubagent succeeds.
    // GovernanceLoop has no resolver → legacy path passes 'analyst' through unchanged.
    const analystResolver = new DomainResolver(['analyst']);
    const analystBot = new CommonCreatorBot(
      new Logger(new InMemorySink(), 'creator-bot-p125-a007'),
      adapter,
      baseDir,
      analystResolver,
    );
    const buildSubagentSpy = vi.spyOn(analystBot, 'buildSubagent');
    const verboseSpy = vi.fn();

    const deps = makeDeps({ commonBot: analystBot, adapter /* no resolver */ });
    (deps.userChannel as any).verbose = verboseSpy;
    const loop = new GovernanceLoop(deps);

    const campaign: Campaign = {
      id:        'camp-no-resolver-a',
      name:      'Legacy Campaign A',
      objective: 'test obj',
      subagents: [{ role: 'Analyst', domain: 'analyst', martianTags: ['analyst'], knowledgeBase: '' }],
      dependsOn: [],
      status:    'pending',
    };

    await (loop as any).spawnCampaign('goal-1', campaign);

    // buildSubagent called with rawDomain ('analyst'), NOT 'compute'
    expect(buildSubagentSpy).toHaveBeenCalledOnce();
    expect(buildSubagentSpy.mock.calls[0]![0]).toBe('analyst');

    // No verbose warning about missing tags
    expect(verboseSpy).not.toHaveBeenCalledWith(expect.stringContaining('no martian tags'));
  });

  // ── A-009 (Packet 207) ────────────────────────────────────────────────────
  it('A-009: spawnCampaign with domainResolver + empty martianTags pushes JOB_FAILED (L353 bid=16 arm=0)', async () => {
    const deps = makeDeps({ commonBot, adapter, resolver });
    const loop = new GovernanceLoop(deps);

    // Campaign with a subagent that declares NO martian tags — rawDomain === undefined
    const campaign = makeCampaign({
      id:       'camp-no-tags',
      name:     'No-Tag Campaign',
      subagents: [{ role: 'Worker', domain: 'compute', knowledgeBase: '', martianTags: [] }],
    });

    await (loop as any).spawnCampaign('goal-1', campaign);

    // JOB_FAILED event must have been pushed (L357-L364 catch block)
    const queue: unknown[] = (loop as any).eventQueue;
    expect(queue).toHaveLength(1);
    const evt = queue[0] as { type: string; subGoalId: string; error: string };
    expect(evt.type).toBe('JOB_FAILED');
    expect(evt.subGoalId).toBe('camp-no-tags');
    expect(evt.error).toContain('declares no subagent martian tags');
  });

  // ── A-008 ─────────────────────────────────────────────────────────────────
  it('A-008: no domainResolver + rawDomain undefined — defaults to compute, emits verbose warning (L367-L372 arm B)', async () => {
    const buildSubagentSpy = vi.spyOn(commonBot, 'buildSubagent');
    const verboseMessages: string[] = [];

    const deps = makeDeps({ commonBot, adapter /* no resolver */ });
    (deps.userChannel as any).verbose = (msg: string) => verboseMessages.push(msg);
    const loop = new GovernanceLoop(deps);

    const campaign: Campaign = {
      id:        'camp-no-resolver-b',
      name:      'Legacy Campaign B',
      objective: 'test obj',
      subagents: [{ role: 'Compute Worker', domain: 'compute', martianTags: [], knowledgeBase: '' }],
      dependsOn: [],
      status:    'pending',
    };

    await (loop as any).spawnCampaign('goal-1', campaign);

    // buildSubagent called with 'compute' (the ?? default)
    expect(buildSubagentSpy).toHaveBeenCalledOnce();
    expect(buildSubagentSpy.mock.calls[0]![0]).toBe('compute');

    // Verbose warning must mention the campaign name and 'defaulting to compute'
    expect(verboseMessages.some(m =>
      m.includes('Legacy Campaign B') && m.includes("defaulting to 'compute'")
    )).toBe(true);
  });
});
