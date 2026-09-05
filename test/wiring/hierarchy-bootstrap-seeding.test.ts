/**
 * test/wiring/hierarchy-bootstrap-seeding.test.ts
 *
 * Verifies that bootstrap() calls seedEmptyPopulations() exactly once (A-006),
 * and that a synchronous throw from ensureApiKey() does NOT propagate out of
 * bootstrap() (A-007 — the exact failure mode that caused PKT-373 to be rejected).
 *
 * Red-first for A-006: on origin/main, hierarchy-bootstrap.ts has 0 calls to
 * seedEmptyPopulations (G-11). The mock records 0 calls. After `await Promise.resolve()`
 * the microtask queue is still empty (no deferred call) → toHaveBeenCalledOnce() fails RED.
 * After Change B, the deferred call fires → microtask resolves → mock records 1 call → GREEN.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Stubs for heavy deps (same pattern as hierarchy-bootstrap-online-fitness.test.ts) ─

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
  getRegistry: vi.fn(function() {
    return { load: vi.fn(), list: vi.fn(function() { return []; }), get: vi.fn() };
  }),
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
      home:               '/tmp/ac-test-home',
      workspace:          '/tmp/ac-test-home/workspace',
      config:             '/tmp/ac-test-home/alienclaw.json',
      preferences:        '/tmp/ac-test-home/preferences.json',
      goals:              '/tmp/ac-test-home/workspace/goals.json',
      output:             '/tmp/ac-test-home/workspace/output',
      registry:           '/tmp/ac-test-home/registry',
      ms:                 '/tmp/ac-test-home/registry/ms',
      msb:                '/tmp/ac-test-home/registry/msb',
      lineage:            '/tmp/ac-test-home/registry/lineage/lineage.json',
      telemetry:          '/tmp/ac-test-home/registry/telemetry',
      liveFitnessSummary: '/tmp/ac-test-home/live-fitness-summary.json',
    },
  };
});
vi.mock('../../src/alienclaw/governance/common/goal-manager.js',        () => ({ GoalManager:        vi.fn(function() { return {}; }) }));
vi.mock('../../src/alienclaw/governance/common/task-manager.js',        () => ({ TaskManager:        vi.fn(function() { return {}; }) }));
vi.mock('../../src/alienclaw/governance/common/escalation-handler.js',  () => ({ EscalationHandler:  vi.fn(function() { return {}; }) }));
vi.mock('../../src/alienclaw/governance/common/completion-handler.js',  () => ({ CompletionHandler:  vi.fn(function() { return {}; }) }));
vi.mock('../../src/alienclaw/governance/common/governance-loop.js', () => ({
  GovernanceLoop: vi.fn(function() { return { stop: vi.fn() }; }),
}));
vi.mock('../../src/alienclaw/governance/common/real-summon-adapter.js', () => ({ RealMartianSummonAdapter: vi.fn(function() { return {}; }) }));
vi.mock('../../src/alienclaw/governance/common/creator-bot.js',         () => ({ CreatorBot:         vi.fn(function() { return {}; }) }));
vi.mock('../../src/alienclaw/governance/common/domain-resolver.js',     () => ({ DomainResolver:     vi.fn(function() { return {}; }) }));
vi.mock('../../src/alienclaw/governance/common/logger.js', () => ({
  Logger:         vi.fn(function() { return {}; }),
  JsonStdoutSink: vi.fn(function() { return {}; }),
}));
vi.mock('../../src/alienclaw/governance/common/online-fitness-log.js', () => ({
  OnlineFitnessLog: vi.fn(function() { return {}; }),
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
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn() };
});

// ── Mocks for this packet's new imports ──────────────────────────────────────

vi.mock('../../src/alienclaw/governance/common/sync/pull.js', () => ({
  seedEmptyPopulations: vi.fn(async function() { return []; }),
  pullTopGenomes:        vi.fn(async function() { return []; }),
}));

vi.mock('../../src/alienclaw/governance/common/sync/client.js', () => ({
  NetworkAPIClient: vi.fn(function() { return {}; }),
}));

vi.mock('../../src/alienclaw/governance/common/sync/credentials.js', () => ({
  ensureApiKey: vi.fn(function() { return 'test-api-key'; }),
}));

// ── Imports (after vi.mock stubs are declared) ───────────────────────────────

import { bootstrap }             from '../../src/alienclaw/wiring/hierarchy-bootstrap.js';
import { seedEmptyPopulations }  from '../../src/alienclaw/governance/common/sync/pull.js';
import { ensureApiKey }          from '../../src/alienclaw/governance/common/sync/credentials.js';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('hierarchy-bootstrap — cold-start seeding wiring (PKT-1031)', () => {

  beforeEach(() => {
    vi.mocked(seedEmptyPopulations).mockClear();
    vi.mocked(ensureApiKey).mockClear();
  });

  it('A-006: bootstrap() calls seedEmptyPopulations exactly once', async () => {
    const result = bootstrap();

    // Flush the Promise.resolve().then() microtask so the deferred call runs
    // before we assert. Without this await, the microtask queue has not drained
    // and seedEmptyPopulations.mock.calls.length is still 0.
    await Promise.resolve();

    expect(vi.mocked(seedEmptyPopulations)).toHaveBeenCalledOnce();

    result.shutdown();
  });

  it('A-007: when ensureApiKey throws, bootstrap() does not throw synchronously', async () => {
    vi.mocked(ensureApiKey).mockImplementationOnce(function() {
      throw new Error('corrupt credentials');
    });

    let result!: ReturnType<typeof bootstrap>;
    expect(() => { result = bootstrap(); }).not.toThrow();

    // Flush microtasks — the .catch() runs here and swallows the rejection.
    await Promise.resolve();

    result.shutdown();
  });

});
