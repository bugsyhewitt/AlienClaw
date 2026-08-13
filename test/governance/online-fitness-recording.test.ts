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
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir }     from 'node:os';
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

// ── Packet 158 — OnlineFitnessLog.clear() ────────────────────────────────────

describe('OnlineFitnessLog.clear()', () => {
  let tmpDir:     string;
  let fitnessLog: OnlineFitnessLog;

  beforeEach(() => {
    tmpDir     = mkdtempSync(path.join(tmpdir(), 'alienclaw-p158-'));
    fitnessLog = new OnlineFitnessLog(path.join(tmpDir, 'online_fitness.jsonl'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('deletes the log file when it exists', () => {
    fitnessLog.record('compute', 0.8);
    expect(existsSync(path.join(tmpDir, 'online_fitness.jsonl'))).toBe(true);
    fitnessLog.clear();
    expect(existsSync(path.join(tmpDir, 'online_fitness.jsonl'))).toBe(false);
    expect(fitnessLog.read()).toHaveLength(0);
  });

  it('is a no-op when the file does not yet exist', () => {
    const freshLog = new OnlineFitnessLog(path.join(tmpDir, 'never_written.jsonl'));
    expect(() => freshLog.clear()).not.toThrow();
    expect(freshLog.read()).toHaveLength(0);
  });

  it('no-arg constructor uses DEFAULT_PATH (homedir fallback arm)', () => {
    const log = new OnlineFitnessLog();
    const expected = path.join(homedir(), '.alienclaw', 'online_fitness.jsonl');
    expect((log as any)._path).toBe(expected);
    // read() returns [] when file absent; array assertion covers CI and dev
    expect(log.read()).toBeInstanceOf(Array);
  });
});

// ── PKT-634: TS-twin hardening — finite-guard + reader try/catch + BOM strip ──

/** Temp file path unique per call; tests clean up via tmpdir GC or afterEach of callers. */
function tmpFile(): string {
  return path.join(tmpdir(), `ofl-pkt634-${process.pid}-${Math.random().toString(36).slice(2)}.jsonl`);
}

describe('OnlineFitnessLog.record() — PKT-634 finite-guard', () => {
  it('control: 0.5 writes the entry', () => {
    const log = new OnlineFitnessLog(tmpFile());
    log.record('compute', 0.5);
    expect(log.read()).toEqual([
      expect.objectContaining({ martian_type: 'compute', fitness: 0.5 }),
    ]);
  });

  it('NaN: drops with stderr WARNING, no entry written', () => {
    const log = new OnlineFitnessLog(tmpFile());
    log.record('compute', NaN);
    expect(log.read()).toEqual([]);
  });

  it('+Infinity: drops with stderr WARNING, no entry written', () => {
    const log = new OnlineFitnessLog(tmpFile());
    log.record('compute', Infinity);
    expect(log.read()).toEqual([]);
  });

  it('-Infinity: drops with stderr WARNING, no entry written', () => {
    const log = new OnlineFitnessLog(tmpFile());
    log.record('compute', -Infinity);
    expect(log.read()).toEqual([]);
  });

  it('out-of-range 1.5: WRITES (Python twin preserves; overmind PKT-608 verdict)', () => {
    // PKT-634 explicitly does NOT add writer-side range-drop. Python twin preserves
    // out-of-range; the TS twin must match for cross-language parity.
    const log = new OnlineFitnessLog(tmpFile());
    log.record('compute', 1.5);
    expect(log.read()[0]?.fitness).toBe(1.5);
  });

  it('out-of-range -0.5: WRITES (Python twin preserves; overmind PKT-608 verdict)', () => {
    const log = new OnlineFitnessLog(tmpFile());
    log.record('compute', -0.5);
    expect(log.read()[0]?.fitness).toBe(-0.5);
  });
});

describe('OnlineFitnessLog.read() — PKT-634 reader hardening', () => {
  it('BOM-prefixed first line: strip + parse successfully', () => {
    const p = tmpFile();
    writeFileSync(p, '﻿{"martian_type":"compute","fitness":0.5,"ts":"2026-01-01T00:00:00Z"}\n');
    const log = new OnlineFitnessLog(p);
    expect(log.read()).toEqual([
      expect.objectContaining({ martian_type: 'compute', fitness: 0.5 }),
    ]);
  });

  it('malformed line (truncated): skipped, valid lines survive', () => {
    const p = tmpFile();
    writeFileSync(
      p,
      '{"martian_type":"compute","fitness":0.5,"ts":"2026-01-01T00:00:00Z"}\n' +
      'garbage_not_json\n' +
      '{"martian_type":"compute","fitness":0.7,"ts":"2026-01-01T00:00:01Z"}\n',
    );
    const log = new OnlineFitnessLog(p);
    const entries = log.read();
    expect(entries).toHaveLength(2);
    expect(entries.map(e => e.fitness)).toEqual([0.5, 0.7]);
  });

  it('non-object JSONL line (e.g. raw "null"): skipped', () => {
    const p = tmpFile();
    writeFileSync(p, 'null\n{"martian_type":"compute","fitness":0.5,"ts":"..."}\n');
    const log = new OnlineFitnessLog(p);
    expect(log.read()).toHaveLength(1);
  });

  it('empty file: returns []', () => {
    const log = new OnlineFitnessLog(tmpFile());
    expect(log.read()).toEqual([]);
  });

  it('read survives an entry whose fitness is null (preserved, not filtered)', () => {
    // PKT-634 policy: read() does NOT filter out-of-range/null/string fitness.
    // That is the consumer's job (PKT-589 + PKT-621). Mirrors Python twin behavior.
    const p = tmpFile();
    writeFileSync(p, '{"martian_type":"compute","fitness":null,"ts":"2026-01-01T00:00:00Z"}\n');
    const log = new OnlineFitnessLog(p);
    expect(log.read()).toEqual([
      expect.objectContaining({ fitness: null }),
    ]);
  });
});
