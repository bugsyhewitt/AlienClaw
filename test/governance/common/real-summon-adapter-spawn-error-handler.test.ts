/**
 * real-summon-adapter-spawn-error-handler.test.ts — Cycle-270 F-201 close
 *
 * Verifies that RealMartianSummonAdapter.summon() resolves the Promise when
 * the child process emits an 'error' event (e.g., ENOENT if `python3` is
 * missing from PATH, or any other spawn-time failure).
 *
 * Sister test files for the SAME module:
 *   - real-summon-adapter-timer-cleanup.test.ts (PKT-938 — inner SIGKILL timer)
 *   - real-summon-adapter-timer-leak.test.ts (PKT-670 — timer handle clear)
 * Defect at HEAD: child.on('error', ...) is NOT wired. The Promise NEVER
 * settles, the caller's `await` hangs forever, and Node raises the 'error'
 * event as an uncaught exception (visible in process.stderr).
 *
 * Production reach: every Subagent `await adapter.summon(...)` inside the
 * governance loop. If python3 is missing or any spawn-time I/O error fires
 * (e.g., EMFILE fd exhaustion, EACCES on the binary), the caller job sits
 * in "RUNNING" with no upper bound — the watchdog setTimeout only fires on
 * a successfully-spawned child.
 *
 * Reference implementation: hierarchy-bootstrap.ts:358-368 (PKT-912) has the
 * correct pattern — child.on('error', ...) clears timers and resolves.
 * This test mirrors the established discipline.
 *
 * Run at HEAD WITHOUT the fix → 1/3 GREEN (control only), 2/3 RED (T1, T2).
 * Run with the fix applied      → 3/3 GREEN.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type { MartianSummonRequest } from '../../../src/alienclaw/governance/common/summon-adapter.js';

// ── Spy: intercept spawn() ──────────────────────────────────────────────────
const spawnSpy = vi.fn();

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: spawnSpy };
});

class FakeChild extends EventEmitter {
  kill = vi.fn();
  stdin  = { write: vi.fn(), end: vi.fn() } as unknown as NodeJS.WritableStream;
  stdout = new EventEmitter() as NodeJS.ReadableStream;
  stderr = new EventEmitter() as NodeJS.ReadableStream;
}

let fakeChild: FakeChild;

beforeEach(() => {
  spawnSpy.mockReset();
  fakeChild = new FakeChild();
  spawnSpy.mockReturnValue(fakeChild as unknown as ChildProcess);
});

afterEach(() => {
  vi.useRealTimers();
});

function makeRequest(timeoutMs: number): MartianSummonRequest {
  return {
    summon_id: 'cycle270-f201',
    martian_type: 'compute',
    genome: 'A'.repeat(256),
    inputs: {},
    timeout_ms: timeoutMs,
  };
}

describe('RealMartianSummonAdapter — spawn-failure error handler (F-201)', () => {
  it('F201-T1 RED: spawn emits "error" event (ENOENT) → adapter Promise settles within 200ms with ok=false (no hang)', async () => {
    // Race the adapter.summon() against a 200ms wall-clock. If the Promise
    // settles within 200ms with ok=false, the error handler is wired. If
    // it does NOT settle, the adapter hangs forever — the defect.
    //
    // Use real setTimeout (not vi.useFakeTimers) so the 200ms race is
    // wall-clock-true — fake-timer-based hangs would not race the way
    // production hangs do.
    const { RealMartianSummonAdapter } = await import('../../../src/alienclaw/governance/common/real-summon-adapter.js');
    const adapter = new RealMartianSummonAdapter();

    const req = makeRequest(60_000);
    const summonPromise = adapter.summon(req);

    // Simulate Node firing 'error' on child when spawn fails (ENOENT case).
    // queueMicrotask defers until after spawn() returns inside the adapter.
    queueMicrotask(() => {
      fakeChild.emit('error', new Error('spawn python3 ENOENT'));
    });

    // Race: settle within 200ms OR mark as HANG.
    const outcome = await Promise.race([
      summonPromise.then(
        (r) => ({ settled: true, result: r }),
        (e) => ({ settled: true, error: String(e) }),
      ),
      new Promise<{ settled: false }>((resolve) =>
        setTimeout(() => resolve({ settled: false }), 200),
      ),
    ]);

    // Swallow the (possibly hung) promise so vitest doesn't trip an
    // unhandled-rejection after the test exits.
    summonPromise.catch(() => { /* swallow — test already raced */ });

    expect(outcome.settled).toBe(true);
    if (outcome.settled && 'result' in outcome) {
      expect(outcome.result.ok).toBe(false);
      expect(outcome.result.summon_id).toBe('cycle270-f201');
      // Error message should reference the spawn failure, not the timeout.
      expect(outcome.result.error).toMatch(/spawn|SPAWN|ENOENT/i);
      expect(outcome.result.fitness).toBe(0.0);
      expect(outcome.result.run_metadata.tool_calls).toBe(0);
    } else {
      throw new Error('Promise rejected (not resolved) — should resolve with ok=false, not reject');
    }
  });

  it('F201-T2 RED: source confirms real-summon-adapter.ts has NO child.on("error", ...) handler at HEAD', async () => {
    // The defect surface: no child.on('error', ...) in the spawn block.
    // This test asserts the source HAS the handler after the fix.
    // At HEAD WITHOUT the fix this test FAILS (proving the gap).
    // After the fix lands this test PASSES (proving the gap is closed).
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve('src/alienclaw/governance/common/real-summon-adapter.ts'),
      'utf8',
    );
    // The fix adds a child.on('error', ...) handler that resolves with
    // ok=false and a descriptive error message, mirroring
    // hierarchy-bootstrap.ts:358.
    expect(src).toMatch(/child\.on\(\s*['"]error['"]\s*,/);
  });

  it('F201-T3 CONTROL: hierarchy-bootstrap.ts callLiveEvoBridge DOES have child.on("error", ...) — confirms the missing-on-adapter defect by contrast', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve('src/alienclaw/wiring/hierarchy-bootstrap.ts'),
      'utf8',
    );
    // callLiveEvoBridge (L349+) has the error handler (PKT-912 fix).
    expect(src).toMatch(/child\.on\(\s*['"]error['"]\s*,/);
  });

  it('F201-T4 RED: spawn emits "error" event after the SIGTERM timer fired → both timers cleared, single resolve', async () => {
    // Edge case: the outer timeout timer fires (SIGTERM sent to a child
    // that was already doomed by spawn failure). The 'error' handler must
    // clear BOTH timers to prevent the inner SIGKILL timer from firing on
    // a dead PID. This mirrors the PKT-938 cleanup discipline.
    vi.useFakeTimers({ shouldAdvanceTime: false });

    const { RealMartianSummonAdapter } = await import('../../../src/alienclaw/governance/common/real-summon-adapter.js');
    const adapter = new RealMartianSummonAdapter();

    const promise = adapter.summon(makeRequest(200));

    // Advance to t=200ms — outer SIGTERM timer fires on a not-yet-dead child.
    await vi.advanceTimersByTimeAsync(200);
    expect(fakeChild.kill).toHaveBeenCalledWith('SIGTERM');

    // NOW spawn-error fires (simulating an unusual but possible order:
    // SIGTERM was sent, but the kernel hadn't yet reported death, then the
    // underlying spawn failure surfaces).
    fakeChild.emit('error', new Error('spawn python3 ENOENT'));

    // Adapter resolves with ok=false from the error path.
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/spawn|SPAWN|ENOENT/i);

    // Advance well past the 5s SIGKILL grace window. After the fix the
    // error handler must have cleared the inner SIGKILL timer; no extra
    // kill() may fire on the dead PID.
    const killCallsBeforeGrace = fakeChild.kill.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5_000);
    const killCallsAfterGrace = fakeChild.kill.mock.calls.length;

    expect(killCallsAfterGrace).toBe(killCallsBeforeGrace);
  });
});
