/**
 * Unit tests for the IpRateLimiter env-var coercion bypass.
 *
 * Filed by tester cycle 2026-09-11T16:41:42Z (PKT-1089 corrective re-author of
 * REJECTED PKT-089). The defect allows:
 *   - ALIENCLAW_RATE_READ_PER_MIN=-5 → readLimit=-5 → checkRead returns
 *     [false, Infinity] (JSON-stringifies as null) for every request, AND
 *     `Retry-After: "Infinity"` is non-RFC-7231.
 *   - ALIENCLAW_RATE_READ_PER_MIN='1e9' → parseInt('1e9', 10)=1 → readLimit=1,
 *     allowing only ONE request per minute instead of the intended 1e9.
 *
 * This File-A covers the env path AND the opts path (PKT-089's blocker #2 was
 * that the original suggested fix left opts unguarded). Per-test env cleanup
 * uses vi.unstubAllEnvs() in afterEach to prevent test-ordering leaks
 * (PKT-089's blocker #3).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  IpRateLimiter,
  _resolveRateLimitInt,
  DEFAULT_IP_READ_PER_MIN,
  DEFAULT_IP_SUBMIT_PER_HOUR,
  MAX_IP_READ_PER_MIN,
  MAX_IP_SUBMIT_PER_HOUR,
} from '../../src/alienclaw/api/rate-limit.js';

const NO_IP = '203.0.113.1';

afterEach(() => {
  // Defence against test-ordering env leaks (PKT-089 blocker #3).
  vi.unstubAllEnvs();
  delete process.env['ALIENCLAW_RATE_READ_PER_MIN'];
  delete process.env['ALIENCLAW_RATE_SUBMIT_PER_HOUR'];
});

// ── _resolveRateLimitInt (helper, in isolation) ──────────────────────────────

describe('_resolveRateLimitInt', () => {
  it('returns defaultValue for undefined', () => {
    expect(_resolveRateLimitInt(undefined, 120, 1000)).toBe(120);
  });
  it('returns defaultValue for empty string', () => {
    expect(_resolveRateLimitInt('', 120, 1000)).toBe(120);
  });
  it('returns defaultValue for non-numeric "abc"', () => {
    expect(_resolveRateLimitInt('abc', 120, 1000)).toBe(120);
  });
  it('returns defaultValue for negative integer -5', () => {
    expect(_resolveRateLimitInt('-5', 120, 1000)).toBe(120);
  });
  it('returns defaultValue for zero "0"', () => {
    expect(_resolveRateLimitInt('0', 120, 1000)).toBe(120);
  });
  it('returns defaultValue for 12.7 (not integer)', () => {
    expect(_resolveRateLimitInt('12.7', 120, 1000)).toBe(120);
  });
  it('returns defaultValue for Infinity above max', () => {
    expect(_resolveRateLimitInt('Infinity', 120, 1000)).toBe(120);
  });
  it('returns defaultValue for unsafe integer 9007199254740992', () => {
    expect(_resolveRateLimitInt('9007199254740992', 120, 1000)).toBe(120);
  });
  it('returns defaultValue for above-maxValue 1001', () => {
    expect(_resolveRateLimitInt('1001', 120, 1000)).toBe(120);
  });
  it('honours sci-notation "1e2" → 100', () => {
    // Number('1e2') === 100 which IS integer/in-range → returns 100, not default.
    expect(_resolveRateLimitInt('1e2', 120, 1000)).toBe(100);
  });
  it('rejects sci-notation "1e9" → 1000000000 (above max → default)', () => {
    // Number('1e9') === 1e9 === 1_000_000_000 which is > 1000 → default.
    expect(_resolveRateLimitInt('1e9', 120, 1000)).toBe(120);
  });
  it('returns the parsed int for valid in-range "60"', () => {
    expect(_resolveRateLimitInt('60', 120, 1000)).toBe(60);
  });
});

// ── IpRateLimiter constructor (env path) ────────────────────────────────────

describe('IpRateLimiter env path', () => {
  it('uses default readLimit=120 when env unset', () => {
    delete process.env['ALIENCLAW_RATE_READ_PER_MIN'];
    const l = new IpRateLimiter();
    // @ts-ignore — internal field probe
    expect(l['_readLimit']).toBe(DEFAULT_IP_READ_PER_MIN);
  });
  it('uses default submitLimit=10 when env unset', () => {
    delete process.env['ALIENCLAW_RATE_SUBMIT_PER_HOUR'];
    const l = new IpRateLimiter();
    // @ts-ignore
    expect(l['_submitLimit']).toBe(DEFAULT_IP_SUBMIT_PER_HOUR);
  });
  it('reads a valid "60" from ALIENCLAW_RATE_READ_PER_MIN', () => {
    process.env['ALIENCLAW_RATE_READ_PER_MIN'] = '60';
    const l = new IpRateLimiter();
    // @ts-ignore
    expect(l['_readLimit']).toBe(60);
  });
  it('falls back to default for env "-5" (deny-all bug, PKT-089)', () => {
    process.env['ALIENCLAW_RATE_READ_PER_MIN'] = '-5';
    const l = new IpRateLimiter();
    // @ts-ignore
    expect(l['_readLimit']).toBe(DEFAULT_IP_READ_PER_MIN);
  });
  it('falls back to default for env "-1" (deny-all bug, submit)', () => {
    process.env['ALIENCLAW_RATE_SUBMIT_PER_HOUR'] = '-1';
    const l = new IpRateLimiter();
    // @ts-ignore
    expect(l['_submitLimit']).toBe(DEFAULT_IP_SUBMIT_PER_HOUR);
  });
  it('falls back to default for env "1e9" (parseInt-collapse-to-1 bug)', () => {
    // Number('1e9') = 1e9 = 1_000_000_000 which is above MAX_IP_READ_PER_MIN=1000.
    process.env['ALIENCLAW_RATE_READ_PER_MIN'] = '1e9';
    const l = new IpRateLimiter();
    // @ts-ignore
    expect(l['_readLimit']).toBe(DEFAULT_IP_READ_PER_MIN);
  });
  it('falls back to default for env "abc"', () => {
    process.env['ALIENCLAW_RATE_READ_PER_MIN'] = 'abc';
    const l = new IpRateLimiter();
    // @ts-ignore
    expect(l['_readLimit']).toBe(DEFAULT_IP_READ_PER_MIN);
  });
  it('falls back to default for env above MAX_IP_READ_PER_MIN', () => {
    process.env['ALIENCLAW_RATE_READ_PER_MIN'] = String(MAX_IP_READ_PER_MIN + 1);
    const l = new IpRateLimiter();
    // @ts-ignore
    expect(l['_readLimit']).toBe(DEFAULT_IP_READ_PER_MIN);
  });
  it('honours env "1e2" → 100 (operator intent preserved, NOT silently tightened)', () => {
    // Mirrors the PKT-1087 storage.ts 1e2 expectation. 1e2 = 100, in-range.
    process.env['ALIENCLAW_RATE_READ_PER_MIN'] = '1e2';
    const l = new IpRateLimiter();
    // @ts-ignore
    expect(l['_readLimit']).toBe(100);
  });
});

// ── IpRateLimiter constructor (opts path) ────────────────────────────────────

describe('IpRateLimiter opts path', () => {
  it('opts {readPerMin: 50} overrides env', () => {
    process.env['ALIENCLAW_RATE_READ_PER_MIN'] = '999';
    const l = new IpRateLimiter({ readPerMin: 50 });
    // @ts-ignore
    expect(l['_readLimit']).toBe(50);
  });
  it('opts {readPerMin: -5} falls back to default (PKT-089 blocker #2)', () => {
    // The original PKT-089 suggested fix left opts unguarded. This is the regression.
    process.env['ALIENCLAW_RATE_READ_PER_MIN'] = '999';
    const l = new IpRateLimiter({ readPerMin: -5 });
    // @ts-ignore
    expect(l['_readLimit']).toBe(DEFAULT_IP_READ_PER_MIN);
  });
  it('opts {submitPerHour: -1} falls back to default', () => {
    process.env['ALIENCLAW_RATE_SUBMIT_PER_HOUR'] = '5';
    const l = new IpRateLimiter({ submitPerHour: -1 });
    // @ts-ignore
    expect(l['_submitLimit']).toBe(DEFAULT_IP_SUBMIT_PER_HOUR);
  });
  it('opts {readPerMin: 2000} (above max) falls back to default', () => {
    const l = new IpRateLimiter({ readPerMin: 2000 });
    // @ts-ignore
    expect(l['_readLimit']).toBe(DEFAULT_IP_READ_PER_MIN);
  });
});

// ── Behavioural regression: checkRead never emits Retry-After: Infinity ──────

describe('IpRateLimiter behavioural regression (Retry-After)', () => {
  it('checkRead returns finite retryAfter (not Infinity) even under deny-all env', () => {
    // PKT-089 reported `String(Infinity)` was the production header. The fix
    // prevents env=-5 from reaching this path. As a defence-in-depth check,
    // verify the runtime value is finite regardless.
    process.env['ALIENCLAW_RATE_READ_PER_MIN'] = '-5';
    const l = new IpRateLimiter();
    const [, retry] = l.checkRead(NO_IP);
    expect(Number.isFinite(retry)).toBe(true);
  });
  it('checkSubmit returns finite retryAfter under deny-all env', () => {
    process.env['ALIENCLAW_RATE_SUBMIT_PER_HOUR'] = '-1';
    const l = new IpRateLimiter();
    const [, retry] = l.checkSubmit(NO_IP);
    expect(Number.isFinite(retry)).toBe(true);
  });
});

// ── Server reset path (T6 re-instantiation) ─────────────────────────────────

describe('IpRateLimiter server reset path', () => {
  it('re-instantiation picks up a corrected env without process carryover', () => {
    // server.ts:65 re-instantiates _IP_LIMITER, so the constructor must read
    // fresh env values each time. PKT-089 blocker #4: cover the reset.
    process.env['ALIENCLAW_RATE_READ_PER_MIN'] = '60';
    const l1 = new IpRateLimiter();
    // @ts-ignore
    expect(l1['_readLimit']).toBe(60);
    process.env['ALIENCLAW_RATE_READ_PER_MIN'] = '240';
    const l2 = new IpRateLimiter();
    // @ts-ignore
    expect(l2['_readLimit']).toBe(240);
  });
});

// ── Sanity: test-ordering env-leak guard ────────────────────────────────────

describe('env-leak guard', () => {
  it('afterEach deleted the env so the NEXT test sees undefined', () => {
    expect(process.env['ALIENCLAW_RATE_READ_PER_MIN']).toBeUndefined();
    expect(process.env['ALIENCLAW_RATE_SUBMIT_PER_HOUR']).toBeUndefined();
  });
});