/**
 * api-rate-limit.test.ts — direct unit tests for the 1 export in
 * src/alienclaw/api/rate-limit.ts (RateLimiter class).
 *
 * Coverage matrix:
 *   construction             — 2 cases (no-args, custom opts)
 *   check — happy path       — 3 cases (first call, remaining decrement,
 *                                       independent install_ids)
 *   check — over-limit       — 2 cases ([false, retryAfter], remaining=0)
 *   persistence              — 4 cases (file written, rehydrated, corrupt,
 *                                       missing)
 *   sliding window           — 2 cases (timestamps evicted, retryAfter calc)
 *   sharding                 — 1 case (folded into persistence test #1:
 *                                       file path uses first-2-chars dir)
 *
 * Total: 13 cases.
 *
 * Uses mkdtempSync + rmSync for tmpdir isolation (same pattern as
 * test/governance/leaderboard.test.ts and test/governance/subagent/workspace.test.ts).
 * Uses vi.useFakeTimers() + vi.setSystemTime() for sliding-window tests.
 * Persist-test uses await setImmediate to flush the fire-and-forget microtask.
 *
 * The single production call site is src/alienclaw/api/server.ts:154
 * (`_RATE_LIMITER.check(khash)` inside POST /v1/genomes). This file is the
 * sole implementation on origin/main — no api/rate_limit.py exists (verified
 * §G-15 of packet 056).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync,
  existsSync, readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { RateLimiter } from '../../src/alienclaw/api/rate-limit.js';

let dataRoot: string;

beforeEach(() => {
  dataRoot = mkdtempSync(join(tmpdir(), 'rl-test-'));
});

afterEach(() => {
  rmSync(dataRoot, { recursive: true, force: true });
  vi.useRealTimers();
});

describe('RateLimiter — construction', () => {
  it('constructs with no args; check is a no-op (no dataRoot, no persist)', () => {
    const rl = new RateLimiter();
    const [ok, retryAfter] = rl.check('install-x');
    expect(ok).toBe(true);
    expect(retryAfter).toBe(0);
  });

  it('constructs with custom limit and window', () => {
    const rl = new RateLimiter({ limit: 3, windowSeconds: 60, dataRoot });
    expect(rl.remaining('install-x')).toBe(3);
    rl.check('install-x');
    rl.check('install-x');
    rl.check('install-x');
    const [ok, retryAfter] = rl.check('install-x');
    expect(ok).toBe(false);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(61);
  });
});

describe('RateLimiter.check — happy path', () => {
  it('first check returns [true, 0]', () => {
    const rl = new RateLimiter({ dataRoot });
    const [ok, retryAfter] = rl.check('install-1');
    expect(ok).toBe(true);
    expect(retryAfter).toBe(0);
  });

  it('remaining decrements per call', () => {
    const rl = new RateLimiter({ dataRoot });
    expect(rl.remaining('install-1')).toBe(100);
    rl.check('install-1');
    expect(rl.remaining('install-1')).toBe(99);
    rl.check('install-1');
    expect(rl.remaining('install-1')).toBe(98);
  });

  it('different install_ids have independent buckets', () => {
    const rl = new RateLimiter({ dataRoot });
    rl.check('install-A');
    rl.check('install-A');
    expect(rl.remaining('install-A')).toBe(98);
    expect(rl.remaining('install-B')).toBe(100);
  });
});

describe('RateLimiter.check — over-limit', () => {
  it('returns [false, retryAfter] after limit reached', () => {
    const rl = new RateLimiter({ limit: 3, windowSeconds: 3600, dataRoot });
    rl.check('i1'); rl.check('i1'); rl.check('i1');
    const [ok, retryAfter] = rl.check('i1');
    expect(ok).toBe(false);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(3601);
  });

  it('remaining returns 0 when at limit', () => {
    const rl = new RateLimiter({ limit: 3, windowSeconds: 3600, dataRoot });
    rl.check('i1'); rl.check('i1'); rl.check('i1');
    expect(rl.remaining('i1')).toBe(0);
  });
});

describe('RateLimiter — persistence (fire-and-forget)', () => {
  it('persists a JSON file under dataRoot/rate_limit/<2chars>/<id>.json after first check', async () => {
    const rl = new RateLimiter({ dataRoot });
    rl.check('abcdef1234567890');
    // _persist is fire-and-forget via Promise.resolve().then; flush microtask + I/O
    await new Promise(resolve => setImmediate(resolve));
    const expected = join(dataRoot, 'rate_limit', 'ab', 'abcdef1234567890.json');
    expect(existsSync(expected)).toBe(true);
    const parsed = JSON.parse(readFileSync(expected, 'utf8'));
    expect(parsed.install_id).toBe('abcdef1234567890');
    expect(Array.isArray(parsed.window_timestamps)).toBe(true);
    expect(parsed.window_timestamps.length).toBe(1);
  });

  it('rehydrates timestamps from disk on second constructor instance', async () => {
    const rl1 = new RateLimiter({ limit: 3, windowSeconds: 3600, dataRoot });
    rl1.check('persisted-id');
    rl1.check('persisted-id');
    await new Promise(resolve => setImmediate(resolve));
    const rl2 = new RateLimiter({ limit: 3, windowSeconds: 3600, dataRoot });
    expect(rl2.remaining('persisted-id')).toBe(1);
  });

  it('corrupt JSON file is treated as empty cache', () => {
    const dir = join(dataRoot, 'rate_limit', 'co');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'corrupt-id.json'), 'NOT JSON');
    const rl = new RateLimiter({ dataRoot });
    expect(rl.remaining('corrupt-id')).toBe(100);
  });

  it('missing file is treated as empty cache', () => {
    const rl = new RateLimiter({ dataRoot });
    expect(rl.remaining('never-seen')).toBe(100);
  });
});

describe('RateLimiter — sliding window (fake timers)', () => {
  it('drops timestamps older than windowSeconds', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const rl = new RateLimiter({ limit: 2, windowSeconds: 10, dataRoot });
    rl.check('w1');
    rl.check('w1');
    expect(rl.check('w1')[0]).toBe(false); // over limit
    // Advance past window: old timestamps > 10s ago are dropped
    vi.setSystemTime(new Date('2026-01-01T00:00:11Z'));
    expect(rl.check('w1')[0]).toBe(true);  // window cleared
    expect(rl.remaining('w1')).toBe(1);
  });

  it('retryAfter equals ceil(oldest + window - now) + 1', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const rl = new RateLimiter({ limit: 1, windowSeconds: 60, dataRoot });
    rl.check('w2');
    vi.setSystemTime(new Date('2026-01-01T00:00:05Z')); // 5s after oldest
    const [ok, retryAfter] = rl.check('w2');
    expect(ok).toBe(false);
    // ceil(0 + 60 - 5) + 1 = 56
    expect(retryAfter).toBe(56);
  });
});
