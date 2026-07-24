/**
 * test/wiring/hierarchy-bootstrap-callLiveEvoBridge.test.ts
 *
 * PKT-320 — covers hierarchy-bootstrap.ts L277-278:
 *   callLiveEvoBridge close arm (L277) and error arm (L278).
 *
 * Strategy: vi.mock 'node:child_process' to return a controllable fake child.
 * callLiveEvoBridge is reached by invoking the fn captured from
 * creatorBot.registerScheduledJob({ label: 'live-evo-check' }).
 * The registry mock returns [{id:'compute'}] so knownMartianTypes is non-empty
 * and the for-await loop actually calls callLiveEvoBridge once.
 *
 * Heavy deps are stubbed exactly as in hierarchy-bootstrap-online-fitness.test.ts.
 * spawn is the only additional mock.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Stubs for heavy deps ──────────────────────────────────────────────────────

vi.mock('../../src/alienclaw/agents/bossbot.js',    () => ({ bossBot: {} }));
vi.mock('../../src/alienclaw/agents/advisorbot.js', () => ({
  advisorBot: { advise: vi.fn(async function () { return { verdict: '' }; }) },
}));
vi.mock('../../src/alienclaw/agents/creatorbot.js', () => ({
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

// Registry: list returns one entry so knownMartianTypes is non-empty,
// ensuring the live-evo-check job body calls callLiveEvoBridge.
vi.mock('../../src/alienclaw/registry/registry.js', () => ({
  getRegistry: vi.fn(function () {
    return {
      load: vi.fn(),
      list: vi.fn(function () { return [{ id: 'compute' }]; }),
      get:  vi.fn(),
    };
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

vi.mock('../../src/alienclaw/governance/common/goal-manager.js',        () => ({ GoalManager:        vi.fn(function () { return {}; }) }));
vi.mock('../../src/alienclaw/governance/common/task-manager.js',        () => ({ TaskManager:        vi.fn(function () { return {}; }) }));
vi.mock('../../src/alienclaw/governance/common/escalation-handler.js',  () => ({ EscalationHandler:  vi.fn(function () { return {}; }) }));
vi.mock('../../src/alienclaw/governance/common/completion-handler.js',  () => ({ CompletionHandler:  vi.fn(function () { return {}; }) }));
vi.mock('../../src/alienclaw/governance/common/real-summon-adapter.js', () => ({ RealMartianSummonAdapter: vi.fn(function () { return {}; }) }));
vi.mock('../../src/alienclaw/governance/common/creator-bot.js',         () => ({ CreatorBot:         vi.fn(function () { return {}; }) }));
vi.mock('../../src/alienclaw/governance/common/domain-resolver.js',     () => ({ DomainResolver:     vi.fn(function () { return {}; }) }));
vi.mock('../../src/alienclaw/governance/common/logger.js', () => ({
  Logger:         vi.fn(function () { return {}; }),
  JsonStdoutSink: vi.fn(function () { return {}; }),
}));
vi.mock('../../src/alienclaw/governance/common/governance-loop.js', () => ({
  GovernanceLoop: vi.fn(function () { return { stop: vi.fn() }; }),
}));
vi.mock('../../src/alienclaw/comms/user-channel.js', () => ({
  UserChannel: vi.fn(function () { return { verbose: vi.fn(), close: vi.fn() }; }),
}));
vi.mock('../../src/alienclaw/comms/agent-channel.js', () => ({
  AgentChannel: vi.fn(function () { return {}; }),
  agentChannel: {},
}));
vi.mock('../../src/alienclaw/telemetry/telemetry-reader.js', () => ({
  readRecentMartianReports: vi.fn(async function () { return []; }),
  summarizeFitness:         vi.fn(function () { return {}; }),
}));

// ── The key mock: intercept spawn so callLiveEvoBridge never touches the OS ──
// importOriginal spreads the real module so execFile (used by hermes-tool-resolver)
// is still present; only spawn is replaced.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn() };
});

// ── Imports (after vi.mock declarations) ─────────────────────────────────────
import { bootstrap }  from '../../src/alienclaw/wiring/hierarchy-bootstrap.js';
import { creatorBot } from '../../src/alienclaw/agents/creatorbot.js';
import { spawn }      from 'node:child_process';

// ── Helper: minimal controllable fake ChildProcess ───────────────────────────
function makeFakeChild() {
  const listeners: Record<string, (() => void)[]> = {};
  return {
    stdin: { write: vi.fn(), end: vi.fn() },
    on: vi.fn((event: string, cb: () => void) => {
      (listeners[event] ??= []).push(cb);
    }),
    emit(event: string) { listeners[event]?.forEach(cb => cb()); },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('callLiveEvoBridge — close + error arms (hierarchy-bootstrap.ts L277-278)', () => {

  let liveEvoFn: () => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();

    // bootstrap() captures all scheduled job registrations via the mock
    const result = bootstrap();
    result.shutdown();

    // Extract the fn for the live-evo-check job
    const calls = vi.mocked(creatorBot.registerScheduledJob).mock.calls;
    const match = calls.find(([opts]) => opts.label === 'live-evo-check');
    if (!match) throw new Error('live-evo-check job not registered');
    liveEvoFn = match[0].fn;
  });

  it('HB-LEVO-1: callLiveEvoBridge resolves when child emits "close" (L277)', async () => {
    const fakeChild = makeFakeChild();
    vi.mocked(spawn).mockReturnValueOnce(fakeChild as ReturnType<typeof spawn>);

    const p = liveEvoFn();
    // Handlers are registered synchronously inside callLiveEvoBridge before
    // the Promise suspends, so we can emit immediately after starting the fn.
    fakeChild.emit('close');
    await p;

    expect(spawn).toHaveBeenCalledWith('python3', ['-m', 'alienclaw.bridge'], { shell: false });
  });

  it('HB-LEVO-2: callLiveEvoBridge resolves when child emits "error" — L278 not dead code', async () => {
    const fakeChild = makeFakeChild();
    vi.mocked(spawn).mockReturnValueOnce(fakeChild as ReturnType<typeof spawn>);

    const p = liveEvoFn();
    fakeChild.emit('error');
    // If L278 were missing the Promise would never resolve and this await would hang.
    await p;

    expect(spawn).toHaveBeenCalledOnce();
  });

});
