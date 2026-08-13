/**
 * test/wiring/fitness-update-summary.test.ts
 *
 * E2 item 5 — live-fitness summary JSON.
 *
 * Verifies that the `fitness-update` scheduled job always writes
 * `PATHS.liveFitnessSummary` at the end of each tick — even when
 * `readRecentMartianReports` returns [] (no EMA update, but summary still fired).
 *
 * Strategy: same vi.mock() harness as hierarchy-bootstrap-online-fitness.test.ts.
 * `mockFakeRegistry` is created with vi.hoisted() so the getRegistry() factory can
 * reference it. After bootstrap(), capture the `fitness-update` job fn, configure
 * the registry mock to return fake martians, call fn(), read the written file.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, readFileSync, unlinkSync } from 'node:fs';

// ── Hoisted shared objects — available inside vi.mock() factories ─────────────

const mockFakeRegistry = vi.hoisted(() => ({
  load: vi.fn(),
  list: vi.fn(function(): Array<{ id: string; fitness: number }> { return []; }),
  get:  vi.fn(),
}));

// ── Stubs ─────────────────────────────────────────────────────────────────────

vi.mock('../../src/alienclaw/agents/bossbot.js',       () => ({ bossBot: {} }));
vi.mock('../../src/alienclaw/agents/advisorbot.js',    () => ({
  advisorBot: { advise: vi.fn(async function() { return { verdict: '' }; }) },
}));
vi.mock('../../src/alienclaw/agents/creatorbot.js',    () => ({
  creatorBot: {
    registerScheduledJob: vi.fn(),
    startScheduler:       vi.fn(),
    stopScheduler:        vi.fn(),
    enqueue:              vi.fn(),
  },
}));
vi.mock('../../src/alienclaw/agents/agent-registry.js', () => ({ agentRegistry: {} }));

vi.mock('../../src/alienclaw/config/alienclaw-config.js', () => ({
  alienClawConfig: { preferences: {} },
}));

vi.mock('../../src/alienclaw/msb/tool-adapters.js', () => ({
  wireToolAdapters:    vi.fn(),
  ALLOWED_FETCH_HOSTS: new Set<string>(),
  isBlockedHost:       () => false,
  assertSafeFetchUrl:  (u: string) => new URL(u),
}));

vi.mock('../../src/alienclaw/registry/registry.js', () => ({
  getRegistry: vi.fn(function() { return mockFakeRegistry; }),
}));
vi.mock('../../src/alienclaw/registry/genome-codec.js', () => ({
  validateGenome: vi.fn(() => ({ valid: true, errors: [] })),
}));
vi.mock('../../src/alienclaw/registry/seed-installer.js', () => ({
  installSeeds: vi.fn(),
}));

vi.mock('../../src/alienclaw/constants.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../src/alienclaw/constants.js')>();
  return {
    ...orig,
    PATHS: {
      home:               '/tmp/ac-test-fit-sum',
      workspace:          '/tmp/ac-test-fit-sum/workspace',
      config:             '/tmp/ac-test-fit-sum/alienclaw.json',
      preferences:        '/tmp/ac-test-fit-sum/preferences.json',
      goals:              '/tmp/ac-test-fit-sum/workspace/goals.json',
      output:             '/tmp/ac-test-fit-sum/workspace/output',
      registry:           '/tmp/ac-test-fit-sum/registry',
      ms:                 '/tmp/ac-test-fit-sum/registry/ms',
      msb:                '/tmp/ac-test-fit-sum/registry/msb',
      lineage:            '/tmp/ac-test-fit-sum/registry/lineage/lineage.json',
      telemetry:          '/tmp/ac-test-fit-sum/registry/telemetry',
      liveFitnessSummary: '/tmp/ac-test-fit-sum/live-fitness-summary.json',
    },
  };
});

vi.mock('../../src/alienclaw/governance/common/goal-manager.js',        () => ({ GoalManager:        vi.fn(function() { return {}; }) }));
vi.mock('../../src/alienclaw/governance/common/task-manager.js',        () => ({ TaskManager:        vi.fn(function() { return {}; }) }));
vi.mock('../../src/alienclaw/governance/common/escalation-handler.js',  () => ({ EscalationHandler:  vi.fn(function() { return {}; }) }));
vi.mock('../../src/alienclaw/governance/common/completion-handler.js',  () => ({ CompletionHandler:  vi.fn(function() { return {}; }) }));
vi.mock('../../src/alienclaw/governance/common/real-summon-adapter.js', () => ({ RealMartianSummonAdapter: vi.fn(function() { return {}; }) }));
vi.mock('../../src/alienclaw/governance/common/creator-bot.js',         () => ({ CreatorBot:         vi.fn(function() { return {}; }) }));
vi.mock('../../src/alienclaw/governance/common/domain-resolver.js',     () => ({ DomainResolver:     vi.fn(function() { return {}; }) }));
vi.mock('../../src/alienclaw/governance/common/logger.js', () => ({
  Logger:         vi.fn(function() { return {}; }),
  JsonStdoutSink: vi.fn(function() { return {}; }),
}));
vi.mock('../../src/alienclaw/governance/common/governance-loop.js', () => ({
  GovernanceLoop: vi.fn(function() { return { stop: vi.fn() }; }),
}));
vi.mock('../../src/alienclaw/comms/user-channel.js', () => ({
  UserChannel: vi.fn(function() { return { verbose: vi.fn(), close: vi.fn() }; }),
}));
vi.mock('../../src/alienclaw/comms/agent-channel.js', () => ({
  AgentChannel: vi.fn(function() { return {}; }),
  agentChannel: {},
}));
vi.mock('../../src/alienclaw/telemetry/telemetry-reader.js', () => ({
  readRecentMartianReports: vi.fn(async function() { return []; }),
  summarizeFitness:         vi.fn(function() { return {}; }),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { bootstrap }  from '../../src/alienclaw/wiring/hierarchy-bootstrap.js';
import { creatorBot } from '../../src/alienclaw/agents/creatorbot.js';
import { readRecentMartianReports } from '../../src/alienclaw/telemetry/telemetry-reader.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const SUMMARY_PATH = '/tmp/ac-test-fit-sum/live-fitness-summary.json';

function captureFitnessUpdateFn(): () => Promise<void> {
  const calls = vi.mocked(creatorBot.registerScheduledJob).mock.calls;
  const hit   = calls.find(([a]) => a.label === 'fitness-update');
  if (!hit) throw new Error('fitness-update job not registered');
  return hit[0]!.fn;
}

function captureRegistryHealthCheckFn(): () => Promise<void> {
  const calls = vi.mocked(creatorBot.registerScheduledJob).mock.calls;
  const hit   = calls.find(([a]) => a.label === 'registry-health-check');
  if (!hit) throw new Error('registry-health-check job not registered');
  return hit[0]!.fn;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('fitness-update — live-fitness-summary.json (E2 item 5)', () => {

  beforeEach(() => {
    mkdirSync('/tmp/ac-test-fit-sum', { recursive: true });
    mockFakeRegistry.list.mockReset();
    mockFakeRegistry.list.mockImplementation(function() { return []; });
    mockFakeRegistry.get.mockReset();
    vi.mocked(creatorBot.registerScheduledJob).mockClear();
    vi.mocked(creatorBot.enqueue).mockClear();
  });

  afterEach(() => {
    try { unlinkSync(SUMMARY_PATH); }       catch { /* may not exist */ }
    try { unlinkSync(SUMMARY_PATH + '.tmp'); } catch { /* may not exist */ }
  });

  it('FUS-101: writes live-fitness-summary.json with registry martians even when no reports', async () => {
    mockFakeRegistry.list.mockReturnValue([
      { id: 'compute_alone',    fitness: 0.5  } as { id: string; fitness: number },
      { id: 'search_then_count', fitness: 0.72 } as { id: string; fitness: number },
    ]);

    const { shutdown } = bootstrap();
    await captureFitnessUpdateFn()();

    const data = JSON.parse(readFileSync(SUMMARY_PATH, 'utf-8')) as {
      generated_at: string;
      martians:     Array<{ id: string; fitness: number }>;
    };

    expect(data.martians).toHaveLength(2);
    expect(data.martians.map(m => m.id)).toContain('compute_alone');
    expect(data.martians.map(m => m.id)).toContain('search_then_count');
    expect(data.martians.find(m => m.id === 'compute_alone')!.fitness).toBe(0.5);
    expect(data.martians.find(m => m.id === 'search_then_count')!.fitness).toBe(0.72);

    shutdown();
  });

  it('FUS-102: generated_at is a valid ISO timestamp; empty registry writes martians:[]', async () => {
    // Default: list() returns []
    const { shutdown } = bootstrap();
    await captureFitnessUpdateFn()();

    const data = JSON.parse(readFileSync(SUMMARY_PATH, 'utf-8')) as {
      generated_at: string;
      martians:     unknown[];
    };

    expect(Number.isNaN(new Date(data.generated_at).getTime())).toBe(false);
    expect(data.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(data.martians).toHaveLength(0);

    shutdown();
  });

  // ── NaN / non-finite fitness guards (PKT-458) ─────────────────────────────

  it('FUS-201: registry-health-check URGENT fires for NaN, Infinity, and -Infinity fitness', async () => {
    const nanMs    = { id: 'nan_martian',    fitness: NaN }       as { id: string; fitness: number };
    const infMs    = { id: 'inf_martian',    fitness: Infinity }  as { id: string; fitness: number };
    const negInfMs = { id: 'neginf_martian', fitness: -Infinity } as { id: string; fitness: number };
    const goodMs   = { id: 'good_martian',   fitness: 0.5 }       as { id: string; fitness: number };

    mockFakeRegistry.list.mockReturnValue([nanMs, infMs, negInfMs, goodMs]);

    const { shutdown } = bootstrap();
    await captureRegistryHealthCheckFn()();

    expect(creatorBot.enqueue).toHaveBeenCalledWith('URGENT', expect.stringContaining('nan_martian'),    'registry-health-check');
    expect(creatorBot.enqueue).toHaveBeenCalledWith('URGENT', expect.stringContaining('inf_martian'),    'registry-health-check');
    expect(creatorBot.enqueue).toHaveBeenCalledWith('URGENT', expect.stringContaining('neginf_martian'), 'registry-health-check');

    const urgentCalls = vi.mocked(creatorBot.enqueue).mock.calls.filter(
      ([pri, , src]) => pri === 'URGENT' && src === 'registry-health-check',
    );
    expect(urgentCalls.some(([, msg]) => (msg as string).includes('good_martian'))).toBe(false);

    shutdown();
  });

  it('FUS-202: fitness-update skips EMA and emits URGENT when ms.fitness is NaN', async () => {
    const nanMartian: { id: string; fitness: number } = { id: 'corrupt_martian', fitness: NaN };
    mockFakeRegistry.list.mockReturnValue([nanMartian]);
    mockFakeRegistry.get.mockImplementation(function(id: string) {
      return id === 'corrupt_martian' ? nanMartian : undefined;
    });

    vi.mocked(readRecentMartianReports).mockResolvedValueOnce([
      { reportCode: 'r1', ts: 1000, taskId: 't1', subagentId: 's1', martianId: 'corrupt_martian', domain: 'compute', outcome: 'SUCCESS' as const, summary: 'ok' },
    ]);

    const { shutdown } = bootstrap();
    await captureFitnessUpdateFn()();

    // EMA must NOT have been applied — fitness stays NaN
    expect(Number.isNaN(nanMartian.fitness)).toBe(true);

    // URGENT must be enqueued for the corrupt martian
    expect(creatorBot.enqueue).toHaveBeenCalledWith(
      'URGENT',
      expect.stringContaining('corrupt_martian'),
      'fitness-update',
    );

    shutdown();
  });

  it('FUS-103: EMA fitness update fires when reports present; enqueues URGENT when new fitness below threshold', async () => {
    // Mutable so the in-memory mutation (ms.fitness = newFitness) is observable.
    const mutable: { id: string; fitness: number } = { id: 'compute_alone', fitness: 0.5 };
    mockFakeRegistry.list.mockReturnValue([mutable]);
    mockFakeRegistry.get.mockImplementation(function(id: string) {
      return id === 'compute_alone' ? mutable : undefined;
    });

    // 3 failures for compute_alone → successRate = 0 → newFitness = 0.3*0 + 0.7*0.5 = 0.35 < 0.4 (threshold)
    // 1 success for ghost_martian (not in registry) → get() returns undefined → skipped via ms guard
    vi.mocked(readRecentMartianReports).mockResolvedValueOnce([
      { reportCode: 'r1', ts: 1000, taskId: 't1', subagentId: 's1', martianId: 'compute_alone', domain: 'compute', outcome: 'FAILURE', summary: 'fail' },
      { reportCode: 'r2', ts: 1001, taskId: 't1', subagentId: 's1', martianId: 'compute_alone', domain: 'compute', outcome: 'FAILURE', summary: 'fail' },
      { reportCode: 'r3', ts: 1002, taskId: 't1', subagentId: 's1', martianId: 'compute_alone', domain: 'compute', outcome: 'FAILURE', summary: 'fail' },
      { reportCode: 'r4', ts: 1003, taskId: 't1', subagentId: 's2', martianId: 'ghost_martian', domain: 'search',  outcome: 'SUCCESS', summary: 'ok'   },
    ]);

    const { shutdown } = bootstrap();
    await captureFitnessUpdateFn()();

    // EMA: 0.3 * 0 + 0.7 * 0.5 = 0.35 — in-memory mutation is observable
    expect(mutable.fitness).toBeCloseTo(0.35, 10);

    // Fitness 0.35 < FITNESS_EVOLUTION_THRESHOLD (0.4) → URGENT enqueue
    expect(creatorBot.enqueue).toHaveBeenCalledWith(
      'URGENT',
      expect.stringContaining('compute_alone'),
      'fitness-update',
    );

    // Summary written, reflects updated fitness
    const data = JSON.parse(readFileSync(SUMMARY_PATH, 'utf-8')) as {
      martians: Array<{ id: string; fitness: number }>;
    };
    expect(data.martians).toHaveLength(1);
    expect(data.martians[0]!.id).toBe('compute_alone');
    expect(data.martians[0]!.fitness).toBeCloseTo(0.35, 10);

    shutdown();
  });
});

// ── PKT-615: fitness-update — malformed outcome enum ──────────────────────────

describe('fitness-update — malformed outcome enum (PKT-615)', () => {
  const SUMMARY_PATH_615 = '/tmp/ac-test-fit-sum/live-fitness-summary.json';

  beforeEach(() => {
    mkdirSync('/tmp/ac-test-fit-sum', { recursive: true });
    mockFakeRegistry.list.mockReset();
    mockFakeRegistry.list.mockImplementation(function() { return []; });
    mockFakeRegistry.get.mockReset();
    vi.mocked(creatorBot.registerScheduledJob).mockClear();
    vi.mocked(creatorBot.enqueue).mockClear();
  });

  afterEach(() => {
    try { unlinkSync(SUMMARY_PATH_615); }           catch { /* may not exist */ }
    try { unlinkSync(SUMMARY_PATH_615 + '.tmp'); }  catch { /* may not exist */ }
  });

  it('PKT615-FU-T1: baseline — 4 SUCCESS + 1 FAILURE — no NOTABLE, no spurious URGENT, EMA correct', async () => {
    const mutable: { id: string; fitness: number } = { id: 'M-base', fitness: 0.5 };
    mockFakeRegistry.list.mockReturnValue([mutable]);
    mockFakeRegistry.get.mockImplementation(function(id: string) {
      return id === 'M-base' ? mutable : undefined;
    });

    vi.mocked(readRecentMartianReports).mockResolvedValueOnce([
      { reportCode: 'r1', ts: 1000, taskId: 't1', subagentId: 's1', martianId: 'M-base', domain: 'd', outcome: 'SUCCESS', summary: 'ok' },
      { reportCode: 'r2', ts: 1001, taskId: 't1', subagentId: 's1', martianId: 'M-base', domain: 'd', outcome: 'SUCCESS', summary: 'ok' },
      { reportCode: 'r3', ts: 1002, taskId: 't1', subagentId: 's1', martianId: 'M-base', domain: 'd', outcome: 'SUCCESS', summary: 'ok' },
      { reportCode: 'r4', ts: 1003, taskId: 't1', subagentId: 's1', martianId: 'M-base', domain: 'd', outcome: 'SUCCESS', summary: 'ok' },
      { reportCode: 'r5', ts: 1004, taskId: 't1', subagentId: 's1', martianId: 'M-base', domain: 'd', outcome: 'FAILURE', summary: 'fail' },
    ] as Parameters<typeof readRecentMartianReports>[0] extends number ? never : Awaited<ReturnType<typeof readRecentMartianReports>>);

    const { shutdown } = bootstrap();
    await captureFitnessUpdateFn()();

    // successRate = 4/5 = 0.8; newFitness = 0.3*0.8 + 0.7*0.5 = 0.59
    expect(mutable.fitness).toBeCloseTo(0.59, 10);
    // No spurious URGENT evolve-genome
    const urgentEnqueues = vi.mocked(creatorBot.enqueue).mock.calls.filter(
      ([pri]) => pri === 'URGENT',
    );
    const evolveUrgents = urgentEnqueues.filter(([, msg]) => (msg as string).includes('evolve genome'));
    expect(evolveUrgents).toHaveLength(0);
    // No NOTABLE malformed diagnostic
    const notableEnqueues = vi.mocked(creatorBot.enqueue).mock.calls.filter(
      ([pri]) => pri === 'NOTABLE',
    );
    expect(notableEnqueues).toHaveLength(0);

    shutdown();
  });

  it('PKT615-FU-T2: 4 SUCCESS + 1 lowercase "unknown" — ghost filtered, successRate=1.0, NOTABLE enqueued, NO spurious URGENT', async () => {
    const mutable: { id: string; fitness: number } = { id: 'M-t2', fitness: 0.5 };
    mockFakeRegistry.list.mockReturnValue([mutable]);
    mockFakeRegistry.get.mockImplementation(function(id: string) {
      return id === 'M-t2' ? mutable : undefined;
    });

    vi.mocked(readRecentMartianReports).mockResolvedValueOnce([
      { reportCode: 'r1', ts: 1000, taskId: 't1', subagentId: 's1', martianId: 'M-t2', domain: 'd', outcome: 'SUCCESS', summary: 'ok' },
      { reportCode: 'r2', ts: 1001, taskId: 't1', subagentId: 's1', martianId: 'M-t2', domain: 'd', outcome: 'SUCCESS', summary: 'ok' },
      { reportCode: 'r3', ts: 1002, taskId: 't1', subagentId: 's1', martianId: 'M-t2', domain: 'd', outcome: 'SUCCESS', summary: 'ok' },
      { reportCode: 'r4', ts: 1003, taskId: 't1', subagentId: 's1', martianId: 'M-t2', domain: 'd', outcome: 'SUCCESS', summary: 'ok' },
      // Ghost outcome — must be filtered out of denominator
      { reportCode: 'r5', ts: 1004, taskId: 't1', subagentId: 's1', martianId: 'M-t2', domain: 'd', outcome: 'unknown' as 'SUCCESS', summary: 'ghost' },
    ]);

    const { shutdown } = bootstrap();
    await captureFitnessUpdateFn()();

    // successRate = 4/4 = 1.0 (ghost filtered); newFitness = 0.3*1.0 + 0.7*0.5 = 0.65
    expect(mutable.fitness).toBeCloseTo(0.65, 10);
    // Fitness 0.65 > 0.4 threshold — NO spurious URGENT evolve-genome
    const evolveUrgents = vi.mocked(creatorBot.enqueue).mock.calls.filter(
      ([pri, msg]) => pri === 'URGENT' && (msg as string).includes('evolve genome'),
    );
    expect(evolveUrgents).toHaveLength(0);
    // NOTABLE diagnostic enqueued for the malformed outcome
    expect(creatorBot.enqueue).toHaveBeenCalledWith(
      'NOTABLE',
      expect.stringContaining('M-t2'),
      'fitness-update',
    );
    const notableMsg = vi.mocked(creatorBot.enqueue).mock.calls.find(
      ([pri]) => pri === 'NOTABLE',
    )?.[1] as string | undefined;
    expect(notableMsg).toMatch(/non-canonical|malformed|1/i);

    shutdown();
  });

  it('PKT615-FU-T3: 1 SUCCESS + 4 ghosts (unknown, Success, null, undefined) — successRate=1.0, NO URGENT, ONE NOTABLE', async () => {
    const mutable: { id: string; fitness: number } = { id: 'M-t3', fitness: 0.5 };
    mockFakeRegistry.list.mockReturnValue([mutable]);
    mockFakeRegistry.get.mockImplementation(function(id: string) {
      return id === 'M-t3' ? mutable : undefined;
    });

    vi.mocked(readRecentMartianReports).mockResolvedValueOnce([
      { reportCode: 'r1', ts: 1000, taskId: 't1', subagentId: 's1', martianId: 'M-t3', domain: 'd', outcome: 'SUCCESS', summary: 'ok' },
      { reportCode: 'r2', ts: 1001, taskId: 't1', subagentId: 's1', martianId: 'M-t3', domain: 'd', outcome: 'unknown' as 'SUCCESS', summary: 'ghost' },
      { reportCode: 'r3', ts: 1002, taskId: 't1', subagentId: 's1', martianId: 'M-t3', domain: 'd', outcome: 'Success' as 'SUCCESS', summary: 'ghost' },
      { reportCode: 'r4', ts: 1003, taskId: 't1', subagentId: 's1', martianId: 'M-t3', domain: 'd', outcome: null as unknown as 'SUCCESS', summary: 'ghost' },
      { reportCode: 'r5', ts: 1004, taskId: 't1', subagentId: 's1', martianId: 'M-t3', domain: 'd', outcome: undefined as unknown as 'SUCCESS', summary: 'ghost' },
    ]);

    const { shutdown } = bootstrap();
    await captureFitnessUpdateFn()();

    // successRate = 1/1 = 1.0; newFitness = 0.3*1.0 + 0.7*0.5 = 0.65
    expect(mutable.fitness).toBeCloseTo(0.65, 10);
    const evolveUrgents = vi.mocked(creatorBot.enqueue).mock.calls.filter(
      ([pri, msg]) => pri === 'URGENT' && (msg as string).includes('evolve genome'),
    );
    expect(evolveUrgents).toHaveLength(0);
    const notableEnqueues = vi.mocked(creatorBot.enqueue).mock.calls.filter(
      ([pri]) => pri === 'NOTABLE',
    );
    expect(notableEnqueues).toHaveLength(1);

    shutdown();
  });

  it('PKT615-FU-T4: all-malformed — EMA skipped entirely, fitness unchanged, NO spurious URGENT, NOTABLE fires', async () => {
    const mutable: { id: string; fitness: number } = { id: 'M-t4', fitness: 0.5 };
    mockFakeRegistry.list.mockReturnValue([mutable]);
    mockFakeRegistry.get.mockImplementation(function(id: string) {
      return id === 'M-t4' ? mutable : undefined;
    });

    vi.mocked(readRecentMartianReports).mockResolvedValueOnce([
      { reportCode: 'r1', ts: 1000, taskId: 't1', subagentId: 's1', martianId: 'M-t4', domain: 'd', outcome: 'unknown' as 'SUCCESS', summary: 'ghost' },
      { reportCode: 'r2', ts: 1001, taskId: 't1', subagentId: 's1', martianId: 'M-t4', domain: 'd', outcome: 'Success' as 'SUCCESS', summary: 'ghost' },
      { reportCode: 'r3', ts: 1002, taskId: 't1', subagentId: 's1', martianId: 'M-t4', domain: 'd', outcome: null as unknown as 'SUCCESS', summary: 'ghost' },
    ]);

    const { shutdown } = bootstrap();
    await captureFitnessUpdateFn()();

    // All reports malformed → EMA skipped entirely — fitness must remain at its prior value.
    // This is the core PKT-615 fix: zero valid evidence must NOT decay persisted fitness.
    expect(mutable.fitness).toBe(0.5);
    // NO spurious evolve-genome URGENT — no valid observations means no threshold can be crossed.
    const evolveUrgents = vi.mocked(creatorBot.enqueue).mock.calls.filter(
      ([pri, msg]) => pri === 'URGENT' && (msg as string).includes('evolve genome'),
    );
    expect(evolveUrgents).toHaveLength(0);
    // NOTABLE fires to surface the ghost count for observability.
    const notableEnqueues = vi.mocked(creatorBot.enqueue).mock.calls.filter(
      ([pri]) => pri === 'NOTABLE',
    );
    expect(notableEnqueues).toHaveLength(1);

    shutdown();
  });

  it('PKT615-FU-T5: previously spurious URGENT no longer fires when ghosts inflate denominator — key regression guard', async () => {
    // Prior to fix: 1 SUCCESS + 4 ghosts → successRate=0.2 → newFitness=0.41 (just above 0.4)
    // or with slightly different prior: would cross threshold and fire spurious URGENT.
    // After fix: successRate=1.0 → newFitness=0.65 → NO URGENT.
    const mutable: { id: string; fitness: number } = { id: 'M-t5', fitness: 0.5 };
    mockFakeRegistry.list.mockReturnValue([mutable]);
    mockFakeRegistry.get.mockImplementation(function(id: string) {
      return id === 'M-t5' ? mutable : undefined;
    });

    vi.mocked(readRecentMartianReports).mockResolvedValueOnce([
      { reportCode: 'r1', ts: 1000, taskId: 't1', subagentId: 's1', martianId: 'M-t5', domain: 'd', outcome: 'SUCCESS', summary: 'ok' },
      { reportCode: 'r2', ts: 1001, taskId: 't1', subagentId: 's1', martianId: 'M-t5', domain: 'd', outcome: 'unknown' as 'SUCCESS', summary: 'ghost' },
      { reportCode: 'r3', ts: 1002, taskId: 't1', subagentId: 's1', martianId: 'M-t5', domain: 'd', outcome: 'unknown' as 'SUCCESS', summary: 'ghost' },
      { reportCode: 'r4', ts: 1003, taskId: 't1', subagentId: 's1', martianId: 'M-t5', domain: 'd', outcome: 'unknown' as 'SUCCESS', summary: 'ghost' },
      { reportCode: 'r5', ts: 1004, taskId: 't1', subagentId: 's1', martianId: 'M-t5', domain: 'd', outcome: 'unknown' as 'SUCCESS', summary: 'ghost' },
    ]);

    const { shutdown } = bootstrap();
    await captureFitnessUpdateFn()();

    // After fix: successRate=1/1=1.0; newFitness=0.65 — above threshold, NO spurious URGENT
    // Before fix: successRate=1/5=0.2; newFitness=0.41 — just above 0.4 but close to spurious fire
    expect(mutable.fitness).toBeCloseTo(0.65, 10);
    const evolveUrgents = vi.mocked(creatorBot.enqueue).mock.calls.filter(
      ([pri, msg]) => pri === 'URGENT' && (msg as string).includes('evolve genome'),
    );
    expect(evolveUrgents).toHaveLength(0);

    shutdown();
  });

  it('PKT615-FU-T6: PKT-458 regression — NaN ms.fitness fires URGENT and skips EMA (PKT-615 NOTABLE NOT enqueued)', async () => {
    const nanMartian: { id: string; fitness: number } = { id: 'nan_m', fitness: NaN };
    mockFakeRegistry.list.mockReturnValue([nanMartian]);
    mockFakeRegistry.get.mockImplementation(function(id: string) {
      return id === 'nan_m' ? nanMartian : undefined;
    });

    vi.mocked(readRecentMartianReports).mockResolvedValueOnce([
      { reportCode: 'r1', ts: 1000, taskId: 't1', subagentId: 's1', martianId: 'nan_m', domain: 'd', outcome: 'SUCCESS', summary: 'ok' },
    ]);

    const { shutdown } = bootstrap();
    await captureFitnessUpdateFn()();

    // PKT-458 guard fires first — ms.fitness stays NaN, EMA skipped
    expect(Number.isNaN(nanMartian.fitness)).toBe(true);
    // URGENT for non-finite ms.fitness
    expect(creatorBot.enqueue).toHaveBeenCalledWith(
      'URGENT',
      expect.stringContaining('nan_m'),
      'fitness-update',
    );
    // PKT-615 NOTABLE must NOT be enqueued (non-finite guard is upstream of outcome filter)
    const notableEnqueues = vi.mocked(creatorBot.enqueue).mock.calls.filter(
      ([pri]) => pri === 'NOTABLE',
    );
    expect(notableEnqueues).toHaveLength(0);

    shutdown();
  });
});
