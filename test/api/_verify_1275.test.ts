/**
 * File-A: verify PKT-1275 fix — ALIENCLAW_XFF_HOPS env-var coercion bypass.
 *
 * 13 tests in 5 groups, all should be GREEN on the fix and RED on HEAD (before
 * the fix is applied). Pins the contract that `resolveXffHops()` (and the
 * back-compat `XFF_HOPS` alias) must reject every input that `parseInt()`'s
 * substring-truncation accepts: '2.5', '8abc', '100abc', '1e2', 'Infinity',
 * 'NaN', '', '   '. Well-formed '1'..'32' passes through; '100' (above the
 * new MAX_XFF_HOPS=32 cap) falls back to 1.
 *
 * Run as:
 *   cp 1275-fileA-ts-client-ip-xff-hops-12tests.test.ts.txt \
 *      test/api/_verify_1275.test.ts
 *   pnpm exec vitest run test/api/_verify_1275.test.ts
 *
 * Authored by tester cycle 2026-09-27T23:34:53Z (cycle 464, packet PKT-1275).
 * Defect class 1: parseInt / Number env-var coercion bypass.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveXffHops, XFF_HOPS } from '../../src/alienclaw/api/client-ip.js';

describe('PKT-1275 — XFF_HOPS env-var coercion bypass (Class 1 hardening)', () => {
  const SAVED_ENV = process.env['ALIENCLAW_XFF_HOPS'];
  beforeEach(() => {
    delete process.env['ALIENCLAW_XFF_HOPS'];
  });
  afterEach(() => {
    if (SAVED_ENV === undefined) delete process.env['ALIENCLAW_XFF_HOPS'];
    else process.env['ALIENCLAW_XFF_HOPS'] = SAVED_ENV;
  });

  // ── Group A: parseInt substring-truncation bypass (4 cases) ─────────────
  describe('Group A: parseInt substring-truncation (the bypass)', () => {
    it.each([
      ['2.5',    1],   // parseInt("2.5") → 2; fixed → 1
      ['8abc',   1],   // parseInt("8abc") → 8; fixed → 1
      ['100abc', 1],   // parseInt("100abc") → 100; fixed → 1
      ['1e2',    1],   // parseInt("1e2") → 1; fixed → 1 (Number("1e2") → 100, not integer → 1)
    ])('ALIENCLAW_XFF_HOPS=%s → 1 (rejected)', (input, _expected) => {
      process.env['ALIENCLAW_XFF_HOPS'] = input;
      expect(resolveXffHops()).toBe(1);
      expect(XFF_HOPS()).toBe(1);
    });
  });

  // ── Group B: garbage / non-numeric falls back (3 cases) ────────────────
  describe('Group B: garbage / non-numeric fall back', () => {
    it.each([
      ['NaN',      1],
      ['Infinity', 1],
      ['eight',    1],
    ])('ALIENCLAW_XFF_HOPS=%s → 1 (rejected)', (input, _expected) => {
      process.env['ALIENCLAW_XFF_HOPS'] = input;
      expect(resolveXffHops()).toBe(1);
      expect(XFF_HOPS()).toBe(1);
    });
  });

  // ── Group C: empty / unset fall back (3 cases) ─────────────────────────
  describe('Group C: empty / unset fall back', () => {
    it('unset env → 1', () => {
      expect(resolveXffHops()).toBe(1);
      expect(XFF_HOPS()).toBe(1);
    });
    it('empty string → 1', () => {
      process.env['ALIENCLAW_XFF_HOPS'] = '';
      expect(resolveXffHops()).toBe(1);
      expect(XFF_HOPS()).toBe(1);
    });
    it('whitespace-only → 1', () => {
      process.env['ALIENCLAW_XFF_HOPS'] = '   ';
      expect(resolveXffHops()).toBe(1);
      expect(XFF_HOPS()).toBe(1);
    });
  });

  // ── Group D: well-formed values pass through unchanged (2 cases) ───────
  describe('Group D: well-formed values preserved', () => {
    it.each([
      ['1',  1],
      ['3',  3],
    ])('ALIENCLAW_XFF_HOPS=%s → %i (preserved)', (input, expected) => {
      process.env['ALIENCLAW_XFF_HOPS'] = input;
      expect(resolveXffHops()).toBe(expected);
      expect(XFF_HOPS()).toBe(expected);
    });
  });

  // ── Group E: range overflow falls back (1 case) ────────────────────────
  describe('Group E: range overflow falls back', () => {
    it('100 (above max 32) → 1 (clamped, not unbounded)', () => {
      process.env['ALIENCLAW_XFF_HOPS'] = '100';
      expect(resolveXffHops()).toBe(1);
      expect(XFF_HOPS()).toBe(1);
    });
    it('32 (boundary) → 32 (still allowed)', () => {
      process.env['ALIENCLAW_XFF_HOPS'] = '32';
      expect(resolveXffHops()).toBe(32);
      expect(XFF_HOPS()).toBe(32);
    });
  });
});
