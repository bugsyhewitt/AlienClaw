/**
 * real-summon-adapter-timer-leak.test.ts — PKT-670
 *
 * Verifies that the inner SIGKILL setTimeout handle is captured and cleared
 * in the close handler. Without the fix, the inner timer fires on a dead
 * child 5 seconds after every timeout→close sequence, leaking event-loop
 * lifetime and tripping vitest open-handles detection.
 *
 * Uses vi.useFakeTimers() so tests complete instantly rather than waiting
 * real seconds.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

// ── Mock node:child_process BEFORE importing the adapter ─────────────────────

interface FakeChild extends EventEmitter {
  stdin:  { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill:   ReturnType<typeof vi.fn>;
}

function makeFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdin  = { write: vi.fn(), end: vi.fn() };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill   = vi.fn();
  return child;
}

vi.mock('node:child_process', async () => ({
  spawn: vi.fn(() => makeFakeChild()),
}));

import { RealMartianSummonAdapter } from '../../src/alienclaw/governance/common/real-summon-adapter.js';
import { spawn as spawnFromModule } from 'node:child_process';

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_GENOME = 'TEST0001G1AlienClaw1d1HDjft5Q1DV1CeXDao0nhL9xK55qbojXyNYpcrZh2EH4E6HdMMCGwebAjANzdYgqmE1JGDwsJeOuSGFYGatODzV526cnQ3NzWyr0igXGd6QSxsGVBurIdb9lXmW0K1vspJ3sw5U4ll7TYGsQDXjCJzeRW7DKaED4dEur4EfD8wZ82fsI3iY7MgLgmrYahC0Fmy5GotUO98O1gIrAOtaC5m0nA6TYCfWMhW0neS3ewBQ';

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    summon_id:    'timer-leak-test',
    genome:       VALID_GENOME,
    martian_type: 'compute',
    inputs:       {},
    timeout_ms:   100,
    ...overrides,
  };
}

function lastChild(): FakeChild {
  const mock = vi.mocked(spawnFromModule);
  const results = mock.mock.results;
  return results[results.length - 1].value as FakeChild;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RealMartianSummonAdapter — inner SIGKILL timer hygiene (PKT-670)', () => {
  beforeEach(() => {
    vi.mocked(spawnFromModule).mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // T1 — Core regression: after SIGTERM fires and subprocess closes via close
  // event, the inner SIGKILL timer must be cancelled. SIGKILL must NOT be
  // called on the already-dead child even after 10 virtual seconds.
  it('T1: SIGKILL is NOT called when subprocess closes after SIGTERM', async () => {
    const adapter = new RealMartianSummonAdapter();
    const promise = adapter.summon(makeRequest({ timeout_ms: 100 }));

    // Advance past the outer SIGTERM timer (100ms).
    await vi.advanceTimersByTimeAsync(110);

    const child = lastChild();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(child.kill).not.toHaveBeenCalledWith('SIGKILL');

    // Simulate subprocess closing cleanly after SIGTERM (exit code 143).
    child.emit('close', 143);
    const result = await promise;

    expect(result.ok).toBe(false);
    expect(result.error).toBe('TIMEOUT after 100ms');

    // Advance well past the 5s SIGKILL window — it must NOT fire.
    await vi.advanceTimersByTimeAsync(10_000);

    expect(child.kill).not.toHaveBeenCalledWith('SIGKILL');
  });

  // T2 — Regression guard: SIGKILL still fires when subprocess does NOT
  // respond to SIGTERM (the COMMON case from existing tests). The fix must
  // not break this signal-escalation path.
  it('T2: SIGKILL still fires 5s after SIGTERM when subprocess does not respond', async () => {
    const adapter = new RealMartianSummonAdapter();
    const promise = adapter.summon(makeRequest({ timeout_ms: 50 }));

    // Advance past SIGTERM (50ms).
    await vi.advanceTimersByTimeAsync(60);

    const child = lastChild();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(child.kill).not.toHaveBeenCalledWith('SIGKILL');

    // Advance past the inner 5s SIGKILL timer — subprocess has not responded.
    await vi.advanceTimersByTimeAsync(5100);

    expect(child.kill).toHaveBeenCalledWith('SIGKILL');

    // Clean up by emitting close.
    child.emit('close', 137);
    await promise;
  });

  // T3 — Success path: subprocess exits with code 0 BEFORE the outer timer
  // fires. The sigkillTimer (which is undefined in this path, since the outer
  // timer never fired) must not cause errors and no kill() calls happen.
  it('T3: no spurious SIGKILL when subprocess exits cleanly before timeout', async () => {
    const adapter = new RealMartianSummonAdapter();
    const validEnvelope = JSON.stringify({
      bridge_version: '1.0',  // required by validateBridgeResponse (PKT-b version check)
      response: {
        ok:           true,
        output:       { answer: 42 },
        fitness:      0.9,
        run_metadata: { tool_calls: 1, wall_clock_ms: 10 },
      },
    });

    const promise = adapter.summon(makeRequest({ timeout_ms: 5000 }));

    const child = lastChild();
    // Emit stdout data then close with exit code 0 immediately — before any
    // timer fires.
    child.stdout.emit('data', Buffer.from(validEnvelope));
    child.emit('close', 0);

    const result = await promise;
    expect(result.ok).toBe(true);

    // Advance well past both timers to confirm no SIGKILL fires.
    await vi.advanceTimersByTimeAsync(20_000);

    expect(child.kill).not.toHaveBeenCalled();
  });

  // T4 — Non-zero exit before timeout: subprocess fails before the outer timer
  // fires. sigkillTimer is undefined (outer timer never armed it). Close handler
  // must not throw and no SIGKILL must be called.
  it('T4: no spurious SIGKILL when subprocess exits with non-zero before timeout', async () => {
    const adapter = new RealMartianSummonAdapter();
    const promise = adapter.summon(makeRequest({ timeout_ms: 5000 }));

    const child = lastChild();
    // Emit close with non-zero exit code immediately.
    child.emit('close', 1);

    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Subprocess exited with code 1/);

    // Advance past all timers — confirm no kill() call.
    await vi.advanceTimersByTimeAsync(20_000);

    expect(child.kill).not.toHaveBeenCalled();
  });

  // T5 — Open-handles guard: immediately after the timeout→close sequence
  // resolves, there must be no pending Timeout handles. We check BEFORE
  // advancing further — if the inner timer was leaked (not cleared), it would
  // still be pending here (count = 1). If the close handler cleared it
  // correctly, count = 0.
  it('T5: no pending Timeout handles immediately after timeout→close resolves', async () => {
    const adapter = new RealMartianSummonAdapter();
    const promise = adapter.summon(makeRequest({ timeout_ms: 100 }));

    // Advance past the outer SIGTERM timer.
    await vi.advanceTimersByTimeAsync(110);

    const child = lastChild();
    // Simulate subprocess closing after SIGTERM.
    child.emit('close', 143);
    await promise;

    // Check IMMEDIATELY — before the 5s SIGKILL window would fire.
    // Without the fix: 1 pending (inner SIGKILL timer still armed).
    // With the fix: 0 pending (close handler cleared it).
    expect(vi.getTimerCount()).toBe(0);
  });
});
