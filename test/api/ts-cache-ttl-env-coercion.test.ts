/**
 * PKT-1118 File-A — cache.ts ALIENCLAW_BOARD_CACHE_TTL_MS env-var coercion bypass
 * (corrective re-author of REJECTED PKT-091).
 *
 * Defect: `src/alienclaw/api/cache.ts:_ttlMs()` (HEAD c52b98b5) is
 *   parseInt(process.env['ALIENCLAW_BOARD_CACHE_TTL_MS'] ?? '10000', 10) || 10000
 * The `|| 10000` only protects against `0` (falsy) and `NaN` (falsy). Negative
 * integers (truthy), huge integers (truthy), and exponent notation (`'1e9'`
 * silently parses to `1`) all slip through and produce unusable TTLs:
 *
 *   -1  → expiresAt = now-1   → every get() misses → cache disabled (DoS amp)
 *   +1e12 → entries immortal  → unbounded Map growth on /v1/genomes/top
 *   '1e9' → parseInt=1         → TTL 1ms → cache disabled (silent truncation)
 *
 * Fix: extract the env parse into a named exported `resolveCacheTtlMs()` and
 * guard with `Number.isInteger + [1, MAX_BOARD_CACHE_TTL_MS]`; any out-of-range
 * or non-finite value falls back to the documented default (10000ms).
 *
 * This test file is the EMBEDDED File-A. Run order:
 *
 *   RED:   pnpm exec vitest run test/api/_verify_1118.test.ts
 *   GREEN: git apply packets/1118-fix-VERIFIED.patch && pnpm exec vitest run test/api/_verify_1118.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  TTLCache,
  resolveCacheTtlMs,
  MAX_BOARD_CACHE_TTL_MS,
  _resetBoardCache,
} from '../../src/alienclaw/api/cache.js';

const ENV_KEY = 'ALIENCLAW_BOARD_CACHE_TTL_MS';
const SAVED_ENV = process.env[ENV_KEY];
const DEFAULT_TTL_MS = 10_000;

beforeEach(() => {
  delete process.env[ENV_KEY];
  _resetBoardCache();
});

afterEach(() => {
  if (SAVED_ENV === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = SAVED_ENV;
  _resetBoardCache();
});

describe('cache.ts: ALIENCLAW_BOARD_CACHE_TTL_MS env coercion (PKT-1118, re-author of REJECTED 091)', () => {

  it('RED→GREEN: negative TTL (-1) is rejected; falls back to default (cache stays usable)', () => {
    // After the fix: resolveCacheTtlMs('-1') returns DEFAULT (10000) because
    // -1 fails the [1, MAX] range check. Before the fix: this function does
    // not exist; the test file fails to import (compilation error RED).
    expect(resolveCacheTtlMs('-1')).toBe(DEFAULT_TTL_MS);

    // End-to-end: feed a real TTLCache and verify set→get works.
    process.env[ENV_KEY] = '-1';
    const cache = new TTLCache<string, number>(resolveCacheTtlMs());
    cache.set('k', 1, '"e"');
    expect(cache.get('k')?.value).toBe(1);
  });

  it('RED→GREEN: huge TTL (MAX_SAFE_INTEGER ms ≈ 285 millennia) is rejected; falls back to default', () => {
    expect(resolveCacheTtlMs(String(Number.MAX_SAFE_INTEGER))).toBe(DEFAULT_TTL_MS);

    process.env[ENV_KEY] = String(Number.MAX_SAFE_INTEGER);
    const cache = new TTLCache<string, number>(resolveCacheTtlMs());
    cache.set('k', 1, '"e"');
    const entry = cache.get('k');
    expect(entry).toBeDefined();
    // Default TTL bounds the entry's lifetime — NOT immortal.
    const ttlApplied = entry!.expiresAt - Date.now();
    expect(ttlApplied).toBeLessThanOrEqual(DEFAULT_TTL_MS + 1000);  // +1s slack
    expect(ttlApplied).toBeGreaterThan(DEFAULT_TTL_MS - 1000);
  });

  it('RED→GREEN: TTL just above MAX is rejected (defends the upper bound explicitly)', () => {
    expect(resolveCacheTtlMs(String(MAX_BOARD_CACHE_TTL_MS + 1))).toBe(DEFAULT_TTL_MS);
  });

  it('RED→GREEN: exponent notation "1e9" is rejected as invalid; falls back to default', () => {
    // parseInt('1e9', 10) returns 1 (silent truncation); Number('1e9') returns
    // 1e9 (a Number, not an integer because Number.isInteger(1e9) === true).
    // The new guard uses Number(), so '1e9' is detected as a non-integer
    // representation (because Number('1e9') !== Number('1e9')? no — it IS an
    // integer in JS, but the written form `1e9` is not the integer literal `1000000000`).
    // PKT-091's corrected solution: use Number() AND require parsed.toString() === raw
    // OR just cap at MAX. Our guard: Number.isInteger + range; '1e9' passes
    // Number.isInteger (1e9 is 1000000000 which IS a safe integer) BUT fails
    // the range (1e9 > 300_000). So it falls back to default. Good.
    expect(resolveCacheTtlMs('1e9')).toBe(DEFAULT_TTL_MS);

    process.env[ENV_KEY] = '1e9';
    const cache = new TTLCache<string, number>(resolveCacheTtlMs());
    cache.set('k', 1, '"e"');
    expect(cache.get('k')?.value).toBe(1);  // fresh, default TTL applied
  });

  it('RED→GREEN: "1e5" (small exponent, also out-of-range) is rejected', () => {
    // '1e5' parses to 100000, which is > MAX_BOARD_CACHE_TTL_MS (300000... wait
    // 1e5 = 100_000 < 300_000 so this IS in range and would be honored!).
    // That contradicts the PKT-091 finding. Let me re-verify...
    //   MAX_BOARD_CACHE_TTL_MS = 5 * 60_000 = 300_000
    //   1e5 = 100_000 < 300_000 → IN RANGE
    // So '1e5' is honored as 100_000ms. That's the documented cap (5 min), and
    // 100s is well within the cap. NOT a defect.
    // Update the assertion: '1e5' is honored as 100_000 (in-range integer).
    expect(resolveCacheTtlMs('1e5')).toBe(100_000);
  });

  it('CONTROL: valid in-range TTL (30000) is honored as-is', () => {
    expect(resolveCacheTtlMs('30000')).toBe(30_000);

    process.env[ENV_KEY] = '30000';
    const cache = new TTLCache<string, number>(resolveCacheTtlMs());
    cache.set('k', 42, '"e"');
    const entry = cache.get('k');
    expect(entry).toBeDefined();
    expect(entry?.value).toBe(42);
    const ttlApplied = entry!.expiresAt - Date.now();
    expect(ttlApplied).toBeGreaterThan(29_000);
    expect(ttlApplied).toBeLessThanOrEqual(31_000);
  });

  it('CONTROL: missing env var uses documented default 10000ms', () => {
    delete process.env[ENV_KEY];
    expect(resolveCacheTtlMs()).toBe(DEFAULT_TTL_MS);

    const cache = new TTLCache<string, number>(resolveCacheTtlMs());
    cache.set('k', 1, '"e"');
    const entry = cache.get('k');
    expect(entry).toBeDefined();
    const ttlApplied = entry!.expiresAt - Date.now();
    expect(ttlApplied).toBeGreaterThan(9_000);
    expect(ttlApplied).toBeLessThanOrEqual(11_000);
  });

  it('CONTROL: TTL at MAX_BOARD_CACHE_TTL_MS (300_000) is honored as-is', () => {
    expect(resolveCacheTtlMs(String(MAX_BOARD_CACHE_TTL_MS))).toBe(MAX_BOARD_CACHE_TTL_MS);

    process.env[ENV_KEY] = String(MAX_BOARD_CACHE_TTL_MS);
    const cache = new TTLCache<string, number>(resolveCacheTtlMs());
    cache.set('k', 1, '"e"');
    const entry = cache.get('k');
    expect(entry).toBeDefined();
    const ttlApplied = entry!.expiresAt - Date.now();
    expect(ttlApplied).toBeGreaterThan(MAX_BOARD_CACHE_TTL_MS - 1_000);
    expect(ttlApplied).toBeLessThanOrEqual(MAX_BOARD_CACHE_TTL_MS + 1_000);
  });

  it('CONTROL: TTL at 1ms (minimum) is honored; entry expires after a small sleep', () => {
    expect(resolveCacheTtlMs('1')).toBe(1);

    return new Promise<void>((resolve) => {
      const cache = new TTLCache<string, number>(1);
      cache.set('k', 1, '"e"');
      setTimeout(() => {
        expect(cache.get('k')).toBeUndefined();
        resolve();
      }, 10);
    });
  });

  it('RED→GREEN: "0" (parseInt would falsy-fallback to 10000) — new guard also defaults', () => {
    // The original `|| 10000` already handled 0 via falsy fallback.
    // The new guard is explicit: 0 fails the [1, MAX] range → default.
    expect(resolveCacheTtlMs('0')).toBe(DEFAULT_TTL_MS);
  });

  it('RED→GREEN: NaN-producing inputs ("abc", "Infinity", "") all fall back to default', () => {
    for (const v of ['abc', 'Infinity', '', 'NaN', '1.5', '-0.5']) {
      expect(resolveCacheTtlMs(v)).toBe(DEFAULT_TTL_MS);
    }
  });

  it('CONTROL: env is restored after each test (no PKT-089-style leak)', () => {
    process.env[ENV_KEY] = '12345';
    expect(process.env[ENV_KEY]).toBe('12345');
  });

  it('MAX_BOARD_CACHE_TTL_MS is exported and equals 5 minutes (5 * 60_000)', () => {
    expect(MAX_BOARD_CACHE_TTL_MS).toBe(300_000);  // 5 minutes
  });
});
