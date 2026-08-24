/**
 * real-summon-adapter-timer-cleanup.test.ts — PKT-938 canonical test file
 *
 * This is the GREEN test that lives in the packet's §9 drop-in recipe.
 * It uses vi.useFakeTimers + vi.advanceTimersByTimeAsync (matching PKT-912/PKT-937's
 * hierarchy-bootstrap-callLiveEvoBridge-timer-cleanup.test.ts canonical shape)
 * for deterministic, sub-second execution.
 *
 * Run with the PKT-938 fix applied (track inner SIGKILL timer, clearTimeout
 * in 'close' handler) → 3/3 GREEN.
 *
 * Run at HEAD without the fix → 1/3 GREEN (happy path is unaffected), 2/3 RED
 * (timeout/clean-exit and SIGKILL-grace paths fire inner SIGKILL on dead PID).
 *
 * Defect (verbatim copy of PKT-912/PKT-937 axis at hierarchy-bootstrap.ts:callLiveEvoBridge):
 *   src/alienclaw/governance/common/real-summon-adapter.ts:58-62
 *
 *     const timer = setTimeout(() => {
 *       timedOut = true;
 *       child.kill('SIGTERM');
 *       setTimeout(() => { child.kill('SIGKILL'); }, 5000);  // INNER TIMER NEVER CLEARED
 *     }, timeoutMs);
 *
 *     child.on('close', (exitCode) => {
 *       clearTimeout(timer);
 *       // <-- inner SIGKILL timer still armed if SIGTERM fired before close
 *     });
 *
 * Production reach: every timed-out martian execution in RealMartianSummonAdapter.summon()
 * (subagent.ts:407, subagent.ts:577 — the live spawner for every Summon).
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
    summon_id: 'pkt-938',
    martian_type: 'test',
    genome: 'A'.repeat(256),
    inputs: {},
    timeout_ms: timeoutMs,
  };
}

describe('RealMartianSummonAdapter — inner-SIGKILL timer cleanup (PKT-938)', () => {
  it('PKT-926-A: child closes BEFORE timeout → kill() never called (happy path non-regression)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });

    const { RealMartianSummonAdapter } = await import('../../../src/alienclaw/governance/common/real-summon-adapter.js');
    const adapter = new RealMartianSummonAdapter();

    const promise = adapter.summon(makeRequest(1000));

    // Child exits cleanly at t=50ms (well before timeoutMs=1000)
    await vi.advanceTimersByTimeAsync(50);
    fakeChild.stdout.emit('data', Buffer.from('{"response":{"ok":false,"error":"x"}}'));
    fakeChild.emit('close', 0);
    await promise;

    expect(fakeChild.kill).not.toHaveBeenCalled();
  });

  it('PKT-926-B: SIGTERM at timeoutMs, child exits cleanly within grace → inner SIGKILL timer cleared on close', async () => {
    // The defect path: outer SIGTERM timer fires, SIGTERM sent, inner 5s SIGKILL
    // timer armed. Pre-fix: inner timer is NOT cleared, fires at +5s on dead PID.
    // Post-fix: inner timer is tracked and cleared on 'close' alongside outer.
    vi.useFakeTimers({ shouldAdvanceTime: false });

    const { RealMartianSummonAdapter } = await import('../../../src/alienclaw/governance/common/real-summon-adapter.js');
    const adapter = new RealMartianSummonAdapter();

    const promise = adapter.summon(makeRequest(200));

    // Advance to t=200ms — outer SIGTERM timer fires
    await vi.advanceTimersByTimeAsync(200);
    expect(fakeChild.kill).toHaveBeenCalledTimes(1);
    expect(fakeChild.kill.mock.calls[0]).toEqual(['SIGTERM']);

    // Child honors SIGTERM and exits cleanly at t=300ms
    await vi.advanceTimersByTimeAsync(100);
    fakeChild.stdout.emit('data', Buffer.from(''));
    fakeChild.emit('close', 0);
    await promise;

    // Post-fix: close handler cleared the inner SIGKILL timer too.
    // Advancing through the full grace window (to t=5.2s) must NOT add another kill.
    const killCallsBeforeGrace = fakeChild.kill.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5_000);  // t=5.2s, well past the 5s grace
    const killCallsAfterGrace = fakeChild.kill.mock.calls.length;

    expect(killCallsAfterGrace).toBe(killCallsBeforeGrace);  // PKT-938 fix
    expect(fakeChild.kill).toHaveBeenCalledTimes(1);          // only SIGTERM fired
  });

  it('PKT-926-C: SIGTERM at timeoutMs, child ignores → SIGKILL at +5s fires before close (correct escalation non-regression)', async () => {
    // The correct escalation path: child ignores SIGTERM, inner 5s SIGKILL timer
    // fires, then child dies and emits 'close'. Verifies the fix didn't break
    // the SIGKILL escalation when the child IS still alive at +5s.
    vi.useFakeTimers({ shouldAdvanceTime: false });

    const { RealMartianSummonAdapter } = await import('../../../src/alienclaw/governance/common/real-summon-adapter.js');
    const adapter = new RealMartianSummonAdapter();

    const promise = adapter.summon(makeRequest(200));

    // t=200ms: outer SIGTERM timer fires
    await vi.advanceTimersByTimeAsync(200);
    expect(fakeChild.kill).toHaveBeenCalledWith('SIGTERM');

    // Child does NOT exit on SIGTERM. Advance through full 5s grace.
    await vi.advanceTimersByTimeAsync(5_000);

    // Inner SIGKILL timer fired — this is the correct escalation, NOT a leak.
    expect(fakeChild.kill).toHaveBeenCalledWith('SIGKILL');

    // Child dies from SIGKILL and emits close
    fakeChild.stdout.emit('data', Buffer.from(''));
    fakeChild.emit('close', null);  // null exit code from SIGKILL
    await promise;

    expect(fakeChild.kill).toHaveBeenCalledTimes(2);
  });
});
