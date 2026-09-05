/**
 * test/wiring/hierarchy-bootstrap-call-live-evo-bridge-timer-leak.test.ts
 *
 * PKT-671: callLiveEvoBridge inner SIGKILL setTimeout handle discarded — event-loop leak.
 *
 * R-671-1  outer 30s SIGTERM fires, child closes cleanly (code 143) → inner SIGKILL timer
 *          captured and cleared on close; child.kill('SIGKILL') must NOT be called.
 * R-671-2  spawn error path → no timer leak (error handler clears outer; inner never created).
 * R-671-3  non-zero exit before outer 30s fires → no timer leak (close clears outer before
 *          outer fires; inner never created).
 * R-671-4  successful close before outer fires → no Timeout leaks (detectOpenHandles regression
 *          guard for the whole class).
 *
 * Mirror of PKT-670 / real-summon-adapter-timer-leak, applied to the second live site.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';

// ── Stubs for heavy deps — hoisted before any import runs ────────────────────

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
vi.mock('../../src/alienclaw/governance/common/real-summon-adapter.js', () => ({ RealMartianSummonAdapter: vi.fn(function() { return {}; }) }));
vi.mock('../../src/alienclaw/governance/common/creator-bot.js',         () => ({ CreatorBot:         vi.fn(function() { return {}; }) }));
vi.mock('../../src/alienclaw/governance/common/domain-resolver.js',     () => ({ DomainResolver:     vi.fn(function() { return {}; }) }));
vi.mock('../../src/alienclaw/governance/common/logger.js', () => ({
  Logger:         vi.fn(function() { return {}; }),
  JsonStdoutSink: vi.fn(function() { return {}; }),
}));

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

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn() };
});

// ── Imports ───────────────────────────────────────────────────────────────────
import { bootstrap }      from '../../src/alienclaw/wiring/hierarchy-bootstrap.js';
import { GovernanceLoop } from '../../src/alienclaw/governance/common/governance-loop.js';
import { creatorBot }     from '../../src/alienclaw/agents/creatorbot.js';
import { getRegistry }    from '../../src/alienclaw/registry/registry.js';
import { validateGenome } from '../../src/alienclaw/registry/genome-codec.js';
import { spawn }          from 'node:child_process';

// ── Helper ────────────────────────────────────────────────────────────────────
function getRegisteredFn(label: string): () => Promise<void> {
  const calls = vi.mocked(creatorBot.registerScheduledJob).mock.calls;
  const call = calls.find(c => c[0].label === label);
  if (!call) throw new Error(`no job registered with label="${label}"`);
  return call[0].fn as () => Promise<void>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('callLiveEvoBridge — inner SIGKILL timer leak (PKT-671)', () => {

  beforeEach(() => {
    vi.mocked(GovernanceLoop).mockClear();
    vi.mocked(creatorBot.enqueue).mockClear();
    vi.mocked(creatorBot.registerScheduledJob).mockClear();
    vi.mocked(getRegistry).mockReset();
    vi.mocked(getRegistry).mockImplementation(function() {
      return {
        load: vi.fn(), list: vi.fn(function() { return []; }),
        get: vi.fn(), bestForTool: vi.fn(), size: 0,
      } as unknown as ReturnType<typeof getRegistry>;
    });
    vi.mocked(validateGenome).mockReset();
    vi.mocked(validateGenome).mockImplementation(() => ({ valid: true, errors: [] }));
    vi.mocked(spawn).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('R-671-1: inner SIGKILL timer cleared when child closes cleanly after SIGTERM', async () => {
    vi.useFakeTimers();

    const fakeChild = new EventEmitter() as any;
    fakeChild.stdin  = { write: vi.fn(), end: vi.fn() };
    fakeChild.stdout = new EventEmitter();
    fakeChild.stderr = new EventEmitter();
    fakeChild.kill   = vi.fn().mockReturnValue(true);
    vi.mocked(spawn).mockReturnValue(fakeChild);

    const reg = {
      load: vi.fn(), list: vi.fn(() => [{ id: 'mt-timer', fitness: 0.5 }] as any[]), get: vi.fn(),
    };
    vi.mocked(getRegistry).mockReturnValue(reg as any);

    const result = bootstrap();
    const fn = getRegisteredFn('live-evo-check');
    const fnPromise = fn();

    // Advance past the 30s outer timer → SIGTERM sent + inner 5s timer armed
    await vi.advanceTimersByTimeAsync(30_001);

    // Child responds to SIGTERM by exiting cleanly (code 143, identical to probe observation)
    fakeChild.emit('close', 143);
    await fnPromise;

    // Advance past the 5s inner window — if the handle was NOT cleared, SIGKILL fires here
    await vi.advanceTimersByTimeAsync(5_001);

    expect(fakeChild.kill).toHaveBeenCalledWith('SIGTERM');
    expect(fakeChild.kill).not.toHaveBeenCalledWith('SIGKILL');

    result.shutdown();
  });

  it('R-671-2: no timer leak on spawn error path (error clears outer; inner never created)', async () => {
    vi.useFakeTimers();

    const fakeChild = new EventEmitter() as any;
    fakeChild.stdin  = { write: vi.fn(), end: vi.fn() };
    fakeChild.stdout = new EventEmitter();
    fakeChild.stderr = new EventEmitter();
    fakeChild.kill   = vi.fn().mockReturnValue(true);
    vi.mocked(spawn).mockReturnValue(fakeChild);

    const reg = {
      load: vi.fn(), list: vi.fn(() => [{ id: 'mt-err', fitness: 0.5 }] as any[]), get: vi.fn(),
    };
    vi.mocked(getRegistry).mockReturnValue(reg as any);

    const result = bootstrap();
    const fn = getRegisteredFn('live-evo-check');
    const fnPromise = fn();

    fakeChild.emit('error', new Error('spawn ENOENT'));
    await fnPromise;

    // Advance well past both timer windows — neither should fire
    await vi.advanceTimersByTimeAsync(40_000);

    expect(fakeChild.kill).not.toHaveBeenCalled();

    result.shutdown();
  });

  it('R-671-3: no inner timer leak when child closes before the 30s outer timer fires', async () => {
    vi.useFakeTimers();

    const fakeChild = new EventEmitter() as any;
    fakeChild.stdin  = { write: vi.fn(), end: vi.fn() };
    fakeChild.stdout = new EventEmitter();
    fakeChild.stderr = new EventEmitter();
    fakeChild.kill   = vi.fn().mockReturnValue(true);
    vi.mocked(spawn).mockReturnValue(fakeChild);

    const reg = {
      load: vi.fn(), list: vi.fn(() => [{ id: 'mt-fast', fitness: 0.5 }] as any[]), get: vi.fn(),
    };
    vi.mocked(getRegistry).mockReturnValue(reg as any);

    const result = bootstrap();
    const fn = getRegisteredFn('live-evo-check');
    const fnPromise = fn();

    // Non-zero exit (HB-110 scenario) closes before 30s outer timer
    fakeChild.emit('close', 1);
    await fnPromise;

    await vi.advanceTimersByTimeAsync(40_000);

    expect(fakeChild.kill).not.toHaveBeenCalled();

    result.shutdown();
  });

  it('R-671-4: no Timeout leaks after successful close — detectOpenHandles regression guard', async () => {
    vi.useFakeTimers();

    const fakeChild = new EventEmitter() as any;
    fakeChild.stdin  = { write: vi.fn(), end: vi.fn() };
    fakeChild.stdout = new EventEmitter();
    fakeChild.stderr = new EventEmitter();
    fakeChild.kill   = vi.fn().mockReturnValue(true);
    vi.mocked(spawn).mockReturnValue(fakeChild);

    const reg = {
      load: vi.fn(), list: vi.fn(() => [{ id: 'mt-ok', fitness: 0.5 }] as any[]), get: vi.fn(),
    };
    vi.mocked(getRegistry).mockReturnValue(reg as any);

    const result = bootstrap();
    const fn = getRegisteredFn('live-evo-check');
    const fnPromise = fn();

    const envelope = {
      bridge_version: '1.0', request_id: 'live-evo-check',
      response: { ok: true, evolved: false, generation: 1, next_generation: 1, children_minted: 0, new_observations: 0 },
    };
    fakeChild.stdout.emit('data', Buffer.from(JSON.stringify(envelope)));
    fakeChild.emit('close', 0);
    await fnPromise;

    // Outer timer cleared by close handler; inner timer never armed → no leaks
    expect(vi.getTimerCount()).toBe(0);
    expect(fakeChild.kill).not.toHaveBeenCalled();

    result.shutdown();
  });

});
