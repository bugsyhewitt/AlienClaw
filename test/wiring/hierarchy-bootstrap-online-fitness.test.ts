/**
 * test/wiring/hierarchy-bootstrap-online-fitness.test.ts
 *
 * E2 item 1 — wiring test for:
 *   src/alienclaw/wiring/hierarchy-bootstrap.ts
 *
 * Verifies that `bootstrap()` constructs `GovernanceLoop` with an
 * `onlineFitnessLog` property that is an instance of `OnlineFitnessLog`.
 *
 * Prior to E2 item 1, `hierarchy-bootstrap.ts` omitted `onlineFitnessLog`
 * from the `GovernanceLoop` deps object. As a result the optional recorder at
 * governance-loop.ts:418 (`this.onlineFitnessLog?.record(...)`) was always a
 * no-op in production — campaign fitness was scored but never persisted.
 *
 * This test locks the wiring so a future refactor cannot inadvertently drop it.
 *
 * ── Strategy ─────────────────────────────────────────────────────────────────
 *
 * `bootstrap()` has heavy FS + singleton side effects (installSeeds, registry
 * load, scheduler start). We stub every dependency EXCEPT `OnlineFitnessLog`
 * (which we leave real so we can use `instanceof`) via static `vi.mock()`.
 *
 * `vi.mock()` factories are hoisted before imports, so they apply when
 * `hierarchy-bootstrap.ts` is loaded. All class-typed stubs use plain `class`
 * syntax (not arrow functions) so they are usable with `new`.
 *
 * `OnlineFitnessLog`'s constructor calls `mkdirSync(~/.alienclaw/, {recursive:true})`.
 * That directory already exists on any running AlienClaw installation and the
 * call is idempotent — no JSONL file is created because GovernanceLoop is
 * mocked and no campaign ever completes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Stubs for heavy deps — applied before any import runs ────────────────────
// Rule: every dep that hierarchy-bootstrap.ts constructs or calls at runtime
//       gets a minimal stub so bootstrap() can run without real FS / network.

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
  // Keep all numeric constants and string constants but override PATHS to avoid
  // relying on the real ALIENCLAW_HOME during tests.
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
vi.mock('../../src/alienclaw/governance/common/real-summon-adapter.js', () => ({ RealMartianSummonAdapter: vi.fn(function() { return {}; }) }));
vi.mock('../../src/alienclaw/governance/common/creator-bot.js',         () => ({ CreatorBot:         vi.fn(function() { return {}; }) }));
vi.mock('../../src/alienclaw/governance/common/domain-resolver.js',     () => ({ DomainResolver:     vi.fn(function() { return {}; }) }));
vi.mock('../../src/alienclaw/governance/common/logger.js', () => ({
  Logger:         vi.fn(function() { return {}; }),
  JsonStdoutSink: vi.fn(function() { return {}; }),
}));

// GovernanceLoop: capturing mock — asserted in HB-101.
vi.mock('../../src/alienclaw/governance/common/governance-loop.js', () => ({
  GovernanceLoop: vi.fn(function(_deps: unknown) { return { stop: vi.fn() }; }),
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

// ── Imports (after vi.mock stubs are declared) ────────────────────────────────
import { bootstrap }        from '../../src/alienclaw/wiring/hierarchy-bootstrap.js';
import { GovernanceLoop }   from '../../src/alienclaw/governance/common/governance-loop.js';
import { OnlineFitnessLog } from '../../src/alienclaw/governance/common/online-fitness-log.js';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('hierarchy-bootstrap — OnlineFitnessLog wiring (E2 item 1)', () => {

  beforeEach(() => {
    // Reset call history before each test so assertions are clean
    vi.mocked(GovernanceLoop).mockClear();
  });

  it('HB-101: bootstrap() passes an OnlineFitnessLog instance to GovernanceLoop', () => {
    const result = bootstrap();

    // GovernanceLoop constructed exactly once
    expect(vi.mocked(GovernanceLoop)).toHaveBeenCalledOnce();

    // Deps passed to the constructor must include onlineFitnessLog
    const deps = vi.mocked(GovernanceLoop).mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(deps['onlineFitnessLog']).toBeInstanceOf(OnlineFitnessLog);

    result.shutdown();
  });

  it('HB-102: shutdown() invokes stop() on the GovernanceLoop — no leaked timer', () => {
    const result = bootstrap();

    // Retrieve the mock instance returned by `new GovernanceLoop()`
    const loopInstance = vi.mocked(GovernanceLoop).mock.results[0]!.value as { stop: ReturnType<typeof vi.fn> };

    result.shutdown();

    expect(loopInstance.stop).toHaveBeenCalledOnce();
  });

});
