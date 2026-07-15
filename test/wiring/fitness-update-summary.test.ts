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

// ── Helpers ───────────────────────────────────────────────────────────────────

const SUMMARY_PATH = '/tmp/ac-test-fit-sum/live-fitness-summary.json';

function captureFitnessUpdateFn(): () => Promise<void> {
  const calls = vi.mocked(creatorBot.registerScheduledJob).mock.calls;
  const hit   = calls.find(([a]) => a.label === 'fitness-update');
  if (!hit) throw new Error('fitness-update job not registered');
  return hit[0]!.fn;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('fitness-update — live-fitness-summary.json (E2 item 5)', () => {

  beforeEach(() => {
    mkdirSync('/tmp/ac-test-fit-sum', { recursive: true });
    mockFakeRegistry.list.mockReset();
    mockFakeRegistry.list.mockImplementation(function() { return []; });
    vi.mocked(creatorBot.registerScheduledJob).mockClear();
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
});
