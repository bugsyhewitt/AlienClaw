/**
 * test/wiring/hierarchy-bootstrap-callLiveEvoBridge-timer-cleanup.test.ts
 *
 * PKT-912 — close-path cleanup regression coverage for the inner
 * SIGKILL grace timer in
 * src/alienclaw/wiring/hierarchy-bootstrap.ts:310-341 (callLiveEvoBridge).
 *
 * The defect (fixed by PKT-912): the inner 5s SIGKILL grace timer was
 * never cleared on the 'close' event. When SIGTERM fired at t=30s and
 * the child exited cleanly at t=30.5s, the inner timer still fired at
 * t=35s, dispatching a stale SIGKILL to the already-dead PID. Node
 * swallows kill() on dead PIDs (returns false) so production impact
 * was silent — but it (a) leaked the child ref + closure for 5s, and
 * (b) was a near-miss for PID-reuse races if an OS PID was recycled
 * in that window.
 *
 * The fix tracks the inner timer in a local variable and clears it in
 * the 'close' and 'error' handlers alongside the outer 30s timer.
 *
 * 3 tests / 1 describe block / +20 LOC source fix / 0 dependencies.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

// ── Stubs for heavy deps — applied before any import runs ────────────────────

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

// ── Imports (after vi.mock stubs are declared) ────────────────────────────────
import { bootstrap }    from '../../src/alienclaw/wiring/hierarchy-bootstrap.js';
import { creatorBot }   from '../../src/alienclaw/agents/creatorbot.js';
import { getRegistry }  from '../../src/alienclaw/registry/registry.js';
import { spawn }        from 'node:child_process';

// ── callLiveEvoBridge inner-SIGKILL-timer cleanup (PKT-912) ──────────────────

describe('hierarchy-bootstrap — callLiveEvoBridge timer cleanup (PKT-912)', () => {
  let fakeChild: any;

  beforeEach(() => {
    vi.mocked(creatorBot.enqueue).mockClear();
    vi.mocked(creatorBot.registerScheduledJob).mockClear();
    vi.mocked(getRegistry).mockReset();
    vi.mocked(getRegistry).mockImplementation(function() {
      return { load: vi.fn(), list: vi.fn(function() { return []; }), get: vi.fn(), bestForTool: vi.fn(), size: 0 } as unknown as ReturnType<typeof getRegistry>;
    });
    vi.mocked(spawn).mockReset();

    fakeChild = new EventEmitter() as any;
    fakeChild.stdin  = { write: vi.fn(), end: vi.fn() };
    fakeChild.stdout = new EventEmitter();
    fakeChild.stderr = new EventEmitter();
    fakeChild.kill   = vi.fn();
    vi.mocked(spawn).mockReturnValue(fakeChild);

    const reg = {
      load: vi.fn(),
      list: vi.fn(() => [{ id: 'mt-leak', fitness: 0.5 }] as any[]),
      get:  vi.fn(),
    };
    vi.mocked(getRegistry).mockReturnValue(reg as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function getRegisteredFn(label: string): () => Promise<void> {
    const calls = vi.mocked(creatorBot.registerScheduledJob).mock.calls;
    const call = calls.find(c => c[0].label === label);
    if (!call) throw new Error(`no job registered with label="${label}"`);
    return call[0].fn as () => Promise<void>;
  }

  it('PKT-912-A: child exits within 30s → outer timer cleared, inner never started (happy path)', async () => {
    // Documents the happy-path baseline: outer timer cleared by close handler,
    // inner SIGKILL timer is never scheduled → child.kill() never called.
    const result = bootstrap();
    const fn = getRegisteredFn('live-evo-check');

    const fnPromise = fn();
    fakeChild.stdout.emit('data', Buffer.from(JSON.stringify({
      bridge_version: '1.0', request_id: 'live-evo-check',
      response: { ok: true, evolved: false, reason: 'below_threshold' },
    })));
    fakeChild.emit('close', 0);
    await fnPromise;

    expect(fakeChild.kill).not.toHaveBeenCalled();
    result.shutdown();
  });

  it('PKT-912-B: SIGTERM at t=30s, child exits cleanly at t=30.5s → inner SIGKILL timer is canceled on close (regression: pre-fix fired on dead PID)', async () => {
    // The defect path: outer timer fires at t=30s → SIGTERM sent → inner 5s
    // timer armed. Pre-fix, the 'close' handler only cleared the OUTER timer
    // and left the inner one pending, so it fired at t=35s with `child.kill('SIGKILL')`
    // on the already-exited child. Post-fix, the inner timer is tracked and
    // cleared on 'close' alongside the outer.
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const result = bootstrap();
    const fn = getRegisteredFn('live-evo-check');

    const fnPromise = fn();

    // Advance time to t=30s — outer SIGTERM timer fires
    await vi.advanceTimersByTimeAsync(30_000);

    // After outer SIGTERM: child.kill('SIGTERM') called AND inner 5s timer armed
    expect(fakeChild.kill).toHaveBeenCalledTimes(1);
    expect(fakeChild.kill.mock.calls[0]).toEqual(['SIGTERM']);

    // Child responds to SIGTERM and exits cleanly at t=30.5s
    await vi.advanceTimersByTimeAsync(500);
    fakeChild.stdout.emit('data', Buffer.from(JSON.stringify({
      bridge_version: '1.0', request_id: 'live-evo-check',
      response: { ok: true, evolved: false, reason: 'below_threshold' },
    })));
    fakeChild.emit('close', 0);
    await fnPromise;

    // Post-fix: close handler cleared the inner SIGKILL timer too.
    // Advancing through the full grace window (t=35s) must NOT add another kill.
    const killCallsBeforeGrace = fakeChild.kill.mock.calls.length;
    await vi.advanceTimersByTimeAsync(4_500);  // t=30s + 0.5s + 4.5s = t=35s
    const killCallsAfterGrace = fakeChild.kill.mock.calls.length;

    expect(killCallsAfterGrace).toBe(killCallsBeforeGrace);  // PKT-912 fix
    expect(fakeChild.kill).toHaveBeenCalledTimes(1);          // only SIGTERM fired

    result.shutdown();
  });

  it('PKT-912-C: SIGTERM at t=30s, child ignores → SIGKILL at t=35s fires before close (correct SIGKILL-grace degradation)', async () => {
    // The correct path: child ignores SIGTERM, inner 5s SIGKILL timer fires,
    // then child dies and emits 'close'. Verifies the fix didn't break the
    // SIGKILL escalation path (the inner timer must still fire when the
    // child is alive at t=35s).
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const result = bootstrap();
    const fn = getRegisteredFn('live-evo-check');

    const fnPromise = fn();

    // Advance time to t=30s — outer SIGTERM timer fires
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fakeChild.kill).toHaveBeenCalledWith('SIGTERM');

    // Child does NOT exit on SIGTERM. Advance through full 5s grace period.
    await vi.advanceTimersByTimeAsync(5_000);

    // Inner SIGKILL timer fired — SIGKILL is the escalation path, not a leak
    expect(fakeChild.kill).toHaveBeenCalledWith('SIGKILL');

    // Now child dies from SIGKILL and emits close
    fakeChild.stdout.emit('data', Buffer.from(''));
    fakeChild.emit('close', null);  // null exit code from SIGKILL
    await fnPromise;

    expect(fakeChild.kill).toHaveBeenCalledWith('SIGKILL');

    result.shutdown();
  });
});
