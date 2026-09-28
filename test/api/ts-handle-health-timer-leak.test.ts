/**
 * Regression test for PKT-1096 (handleHealth Promise.race setTimeout leak).
 * src/alienclaw/api/handlers/health.ts:72-79 schedules a 2s setTimeout as the
 * race-loser of pool.query. When pool.query wins (the normal case) the timer
 * must be cleared, or it sits in Node's active-handles list (non-unref'd) for
 * the full 2s and delays clean process exit.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { Pool } from 'mysql2/promise';
import { handleHealth } from '../../src/alienclaw/api/handlers/health.js';

const origSetTimeout: typeof globalThis.setTimeout = globalThis.setTimeout;
const origClearTimeout: typeof globalThis.clearTimeout = globalThis.clearTimeout;

afterEach(() => {
  globalThis.setTimeout = origSetTimeout;
  globalThis.clearTimeout = origClearTimeout;
});

function instrument(): { counts: { set: number; clear: number } } {
  const counts = { set: 0, clear: 0 };
  globalThis.setTimeout = ((...args: Parameters<typeof origSetTimeout>) => {
    counts.set += 1;
    return origSetTimeout(...args);
  }) as typeof globalThis.setTimeout;
  globalThis.clearTimeout = ((...args: Parameters<typeof origClearTimeout>) => {
    counts.clear += 1;
    return origClearTimeout(...args);
  }) as typeof globalThis.clearTimeout;
  return { counts };
}

describe('handleHealth — Promise.race setTimeout leak (PKT-1096)', () => {
  it('R-1096-1: clears the 2s race-loser timer when pool.query wins', async () => {
    const { counts } = instrument();
    const fakePool = { query: () => Promise.resolve([[], []]) } as unknown as Pool;
    const [status] = await handleHealth(fakePool);
    await new Promise<void>((r) => { origSetTimeout(r, 50); });
    expect(status).toBe(200);
    expect(counts.set).toBe(1);
    expect(counts.clear).toBe(1);
  });

  it('R-1096-2: clears the timer on the pool.query-rejects path too', async () => {
    const { counts } = instrument();
    const fakePool = { query: () => Promise.reject(new Error('down')) } as unknown as Pool;
    const [status, body] = await handleHealth(fakePool);
    await new Promise<void>((r) => { origSetTimeout(r, 50); });
    expect(status).toBe(200);
    expect((body as Record<string, unknown>)['db']).toBe('fail');
    expect(counts.set).toBe(1);
    expect(counts.clear).toBe(1);
  });

  it('R-1096-3: still reports db=ok when the pool query succeeds', async () => {
    const fakePool = { query: () => Promise.resolve([[], []]) } as unknown as Pool;
    const [status, body] = await handleHealth(fakePool);
    expect(status).toBe(200);
    expect((body as Record<string, unknown>)['db']).toBe('ok');
    expect((body as Record<string, unknown>)['ok']).toBe(true);
  });

  it('R-1096-4: no-pool path schedules and clears nothing', async () => {
    const { counts } = instrument();
    const [status, body] = await handleHealth();
    await new Promise<void>((r) => { origSetTimeout(r, 50); });
    expect(status).toBe(200);
    expect((body as Record<string, unknown>)['db']).toBe('fail');
    expect(counts.set).toBe(0);
    expect(counts.clear).toBe(0);
  });
});
