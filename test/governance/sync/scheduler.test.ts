/**
 * Tests for SyncScheduler (src/alienclaw/governance/common/sync/scheduler.ts).
 *
 * Covers:
 *   - start() runs one cycle immediately and is idempotent           scheduler.ts:58-64
 *   - stop() clears the timer and is idempotent                      scheduler.ts:67-72
 *   - isRunning reflects the timer state                             scheduler.ts:74
 *   - install() is attempted once on the first cycle then not again  scheduler.ts:80-84
 *   - failed install is retried on the next cycle (installed stays false)
 *   - the interval fires repeated cycles                            scheduler.ts:61
 *   - onCycle receives a populated summary; onError catches throws  scheduler.ts:98-108
 *   - default options (interval/topN) are applied
 *
 * Uses vitest fake timers — no real waiting, no network. The client is the
 * in-memory StubClient. A real temp populations dir is used so push/pull run
 * end-to-end through the scheduler.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SyncScheduler } from '../../../src/alienclaw/governance/common/sync/scheduler.js';
import type { SyncCycleSummary } from '../../../src/alienclaw/governance/common/sync/scheduler.js';
import {
  StubClient,
  submitNew,
  topGenomes,
  makeGenomeEntry,
  installed,
  err,
} from './_stub-client.js';

let root: string;

beforeEach(() => {
  vi.useFakeTimers();
  root = mkdtempSync(join(tmpdir(), 'alienclaw-sched-'));
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(root, { recursive: true, force: true });
});

function seedGenome(martianType: string, fitness = 0.9): void {
  // Real PopulationStorage layout: entries live under <type>/entries/.
  const dir = join(root, martianType, 'entries');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'g.json'),
    JSON.stringify({ genome: 'G'.repeat(16), fitness }),
    'utf-8',
  );
}

/**
 * Build a scheduler plus the stub client it wraps. `flushed` resolves a
 * microtask so the async _runCycle() body settles after timers advance.
 */
function makeScheduler(
  over: Partial<{
    client: StubClient;
    martianTypes: string[];
    intervalMs: number;
    pushTopN: number;
    pullTopN: number;
    onCycle: (s: SyncCycleSummary) => void;
    onError: (e: unknown) => void;
  }> = {},
) {
  const client = over.client ?? new StubClient({ submitDefault: submitNew() });
  // Capture any stray errors from timer-driven cycles that fire after a test
  // body finishes (fake timers can be advanced by a *later* test). Tests that
  // care about errors pass their own onError, which takes precedence.
  const strayErrors: unknown[] = [];
  // Build options without ever passing `undefined` for optional fields —
  // an explicit `undefined` would clobber the scheduler's no-op defaults.
  const opts = {
    client: client.asClient(),
    machineHash: 'machine-abc',
    populationsRoot: root,
    martianTypes: over.martianTypes ?? ['compute'],
    intervalMs: over.intervalMs ?? 1000,
    onError: over.onError ?? ((e: unknown) => strayErrors.push(e)),
    ...(over.pushTopN !== undefined ? { pushTopN: over.pushTopN } : {}),
    ...(over.pullTopN !== undefined ? { pullTopN: over.pullTopN } : {}),
    ...(over.onCycle !== undefined ? { onCycle: over.onCycle } : {}),
  };
  const scheduler = new SyncScheduler(opts);
  return { scheduler, client, strayErrors };
}

/** Let queued microtasks (the async cycle body) settle. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

// ── start()/stop() idempotency ───────────────────────────────────────────────

describe('SyncScheduler — start/stop idempotency', () => {
  it('start() runs exactly one cycle immediately', async () => {
    const cycles: SyncCycleSummary[] = [];
    const { scheduler } = makeScheduler({ onCycle: s => cycles.push(s) });

    scheduler.start();
    await settle();

    expect(cycles).toHaveLength(1);
    scheduler.stop();
  });

  it('calling start() twice does not start a second timer or double-cycle', async () => {
    const cycles: SyncCycleSummary[] = [];
    const { scheduler } = makeScheduler({ onCycle: s => cycles.push(s) });

    scheduler.start();
    scheduler.start(); // second call is a no-op (timer already set)
    await settle();

    // Only the single immediate cycle from the first start().
    expect(cycles).toHaveLength(1);
    expect(scheduler.isRunning).toBe(true);
    scheduler.stop();
  });

  it('isRunning is false before start, true after start, false after stop', async () => {
    const { scheduler } = makeScheduler();

    expect(scheduler.isRunning).toBe(false);
    scheduler.start();
    expect(scheduler.isRunning).toBe(true);
    await settle();

    scheduler.stop();
    expect(scheduler.isRunning).toBe(false);
  });

  it('stop() is idempotent — calling it twice (or before start) does not throw', () => {
    const { scheduler } = makeScheduler();

    expect(() => scheduler.stop()).not.toThrow(); // stop before start
    scheduler.start();
    expect(() => {
      scheduler.stop();
      scheduler.stop(); // second stop is a no-op
    }).not.toThrow();
    expect(scheduler.isRunning).toBe(false);
  });

  it('after stop(), no further cycles fire even as time advances', async () => {
    const cycles: SyncCycleSummary[] = [];
    const { scheduler } = makeScheduler({ intervalMs: 1000, onCycle: s => cycles.push(s) });

    scheduler.start();
    await settle();
    expect(cycles).toHaveLength(1);

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(5000); // 5 intervals worth
    expect(cycles).toHaveLength(1); // unchanged — timer was cleared
  });

  it('can be restarted after a stop()', async () => {
    const cycles: SyncCycleSummary[] = [];
    const { scheduler } = makeScheduler({ onCycle: s => cycles.push(s) });

    scheduler.start();
    await settle();
    scheduler.stop();
    expect(scheduler.isRunning).toBe(false);

    scheduler.start(); // restart → another immediate cycle
    await settle();
    expect(cycles).toHaveLength(2);
    expect(scheduler.isRunning).toBe(true);
    scheduler.stop();
  });
});

// ── interval cycling ─────────────────────────────────────────────────────────

describe('SyncScheduler — interval cycling', () => {
  it('runs a cycle on each interval tick', async () => {
    const cycles: SyncCycleSummary[] = [];
    const { scheduler } = makeScheduler({ intervalMs: 1000, onCycle: s => cycles.push(s) });

    scheduler.start();
    await settle();
    expect(cycles).toHaveLength(1); // immediate

    await vi.advanceTimersByTimeAsync(1000);
    expect(cycles).toHaveLength(2); // +1 tick

    await vi.advanceTimersByTimeAsync(2000);
    expect(cycles).toHaveLength(4); // +2 ticks

    scheduler.stop();
  });
});

// ── install-once-then-cycle ──────────────────────────────────────────────────

describe('SyncScheduler — install behaviour', () => {
  it('installs once on the first cycle and not on subsequent cycles', async () => {
    const client = new StubClient({ install: installed(), submitDefault: submitNew() });
    const { scheduler } = makeScheduler({ client, intervalMs: 1000 });

    scheduler.start();
    await settle();
    expect(client.installCalls).toEqual(['machine-abc']); // installed once

    await vi.advanceTimersByTimeAsync(3000); // three more cycles
    expect(client.installCalls).toEqual(['machine-abc']); // still just once

    scheduler.stop();
  });

  it('reports installed=true in the summary once install succeeds', async () => {
    const cycles: SyncCycleSummary[] = [];
    const client = new StubClient({ install: installed(), submitDefault: submitNew() });
    const { scheduler } = makeScheduler({ client, onCycle: s => cycles.push(s) });

    scheduler.start();
    await settle();

    expect(cycles[0].installed).toBe(true);
    scheduler.stop();
  });

  it('retries install on the next cycle if the first install fails', async () => {
    const cycles: SyncCycleSummary[] = [];
    // First install fails (500), so installed stays false and it retries.
    // The StubClient returns a single fixed install result, so to model a
    // *recovering* install we swap the result between cycles.
    const client = new StubClient({
      install: err(500, 'INSTALL_FAILED'),
      submitDefault: submitNew(),
    });
    const { scheduler } = makeScheduler({
      client,
      intervalMs: 1000,
      onCycle: s => cycles.push(s),
    });

    scheduler.start();
    await settle();
    expect(client.installCalls).toHaveLength(1);
    expect(cycles[0].installed).toBe(false); // first install failed

    await vi.advanceTimersByTimeAsync(1000);
    // Because installed is still false, the scheduler tries install again.
    expect(client.installCalls).toHaveLength(2);
    expect(cycles[1].installed).toBe(false);

    scheduler.stop();
  });

  it('stops retrying install once a later cycle succeeds', async () => {
    // Hand-rolled client whose install fails first, then succeeds.
    const installCalls: string[] = [];
    let attempt = 0;
    const recoveringClient = {
      async install(hash: string) {
        installCalls.push(hash);
        attempt += 1;
        return attempt === 1 ? err(503, 'UNAVAILABLE') : installed();
      },
      async submitGenome() {
        return submitNew();
      },
      async topGenomes(t: string) {
        return topGenomes(t, []);
      },
    };
    const scheduler = new SyncScheduler({
      client: recoveringClient as never,
      machineHash: 'machine-xyz',
      populationsRoot: root,
      martianTypes: ['compute'],
      intervalMs: 1000,
    });

    scheduler.start();
    await settle();
    expect(installCalls).toHaveLength(1); // failed

    await vi.advanceTimersByTimeAsync(1000);
    expect(installCalls).toHaveLength(2); // retried, now succeeds

    await vi.advanceTimersByTimeAsync(2000);
    expect(installCalls).toHaveLength(2); // no further attempts after success

    scheduler.stop();
  });
});

// ── cycle summary content & push/pull wiring ─────────────────────────────────

describe('SyncScheduler — cycle summary', () => {
  it('runs push and pull and surfaces both in the summary', async () => {
    seedGenome('compute', 0.9); // gives push something to send

    const client = new StubClient({
      submitDefault: submitNew(),
      top: { compute: topGenomes('compute', [makeGenomeEntry({ submission_id: 'r1' })]) },
    });
    const cycles: SyncCycleSummary[] = [];
    const { scheduler } = makeScheduler({ client, onCycle: s => cycles.push(s) });

    scheduler.start();
    await settle();

    expect(cycles).toHaveLength(1);
    const summary = cycles[0];
    expect(typeof summary.cycleAt).toBe('string');
    expect(Number.isNaN(Date.parse(summary.cycleAt))).toBe(false);
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);

    // push pushed the seeded genome
    expect(summary.push).toHaveLength(1);
    expect(summary.push[0].pushed).toBe(1);

    // pull received + wrote the one remote genome to disk
    expect(summary.pull).toHaveLength(1);
    expect(summary.pull[0].received).toBe(1);
    expect(summary.pull[0].written).toBe(1);
    const written = readdirSync(join(root, 'compute'));
    expect(written.some(f => f.startsWith('network-'))).toBe(true);

    scheduler.stop();
  });

  it('passes pushTopN and pullTopN through to the push/pull calls', async () => {
    seedGenome('compute', 0.9);
    const client = new StubClient({
      submitDefault: submitNew(),
      top: { compute: topGenomes('compute', []) },
    });
    const { scheduler } = makeScheduler({ client, pushTopN: 3, pullTopN: 7 });

    scheduler.start();
    await settle();

    // pull forwards n = pullTopN to the client.
    expect(client.topGenomesCalls).toEqual([{ martianType: 'compute', n: 7 }]);
    scheduler.stop();
  });
});

// ── error handling ───────────────────────────────────────────────────────────

describe('SyncScheduler — error handling', () => {
  it('routes a thrown error to onError instead of crashing the timer', async () => {
    const errors: unknown[] = [];
    // A client whose install() throws synchronously inside the cycle.
    const throwingClient = {
      async install() {
        throw new Error('boom');
      },
      async submitGenome() {
        return submitNew();
      },
      async topGenomes(t: string) {
        return topGenomes(t, []);
      },
    };
    const scheduler = new SyncScheduler({
      client: throwingClient as never,
      machineHash: 'm',
      populationsRoot: root,
      martianTypes: ['compute'],
      intervalMs: 1000,
      onError: e => errors.push(e),
    });

    scheduler.start();
    await settle();

    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('boom');
    // Timer still alive — next tick fires another (failing) cycle.
    expect(scheduler.isRunning).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);
    expect(errors).toHaveLength(2);
    scheduler.stop();
  });
});

// ── default options ──────────────────────────────────────────────────────────

describe('SyncScheduler — defaults', () => {
  it('uses the 5-minute default interval when intervalMs is omitted', async () => {
    const cycles: SyncCycleSummary[] = [];
    const client = new StubClient({ submitDefault: submitNew() });
    const scheduler = new SyncScheduler({
      client: client.asClient(),
      machineHash: 'm',
      populationsRoot: root,
      martianTypes: ['compute'],
      onCycle: s => cycles.push(s),
      // intervalMs intentionally omitted → default 5 * 60 * 1000
    });

    scheduler.start();
    await settle();
    expect(cycles).toHaveLength(1); // immediate cycle

    // Nothing fires before 5 minutes elapse.
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 - 1);
    expect(cycles).toHaveLength(1);

    // The tick at exactly 5 minutes fires the next cycle.
    await vi.advanceTimersByTimeAsync(1);
    expect(cycles).toHaveLength(2);

    scheduler.stop();
  });

  it('does not throw when onCycle/onError are omitted (default no-op handlers)', async () => {
    const client = new StubClient({ submitDefault: submitNew() });
    const scheduler = new SyncScheduler({
      client: client.asClient(),
      machineHash: 'm',
      populationsRoot: root,
      martianTypes: ['compute'],
      intervalMs: 1000,
    });

    scheduler.start();
    await expect(settle()).resolves.toBeUndefined();
    scheduler.stop();
  });
});
