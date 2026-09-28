/**
 * File-A: verify PKT-1276 fix — ALIENCLAW_API_PORT / PORT env-var coercion bypass.
 *
 * The naive `parseInt(env, 10)` shape at src/alienclaw/api/main.ts:45 only
 * protected against `0` and NaN (both falsy in the original `|| default`
 * chain — but the actual code does NOT have that `|| default` guard, so
 * every bypass input produces a non-default port):
 *
 *   parseInt('abc',      10) → NaN  (server.listen(NaN) → silent EADDRINUSE)
 *   parseInt('',         10) → NaN  (empty string is not nullish via ??)
 *   parseInt('1234garbage', 10) → 1234   (substring truncation)
 *   parseInt('0',        10) → 0    (server.listen(0) → ephemeral port)
 *   parseInt('-1',       10) → -1   (EADDRINUSE on a privileged-ish range)
 *   parseInt('99999',    10) → 99999 (no upper bound check)
 *   parseInt('1e9',      10) → 1    (substring-truncation collapses 1e9 to 1)
 *   parseInt('1.5',      10) → 1    (parseInt truncates fractional)
 *
 * The hardened `resolveApiPort()` falls back to 8080 (DEFAULT_API_PORT)
 * on every bypass input AND adds an upper-bound cap (MAX_API_PORT=65535)
 * to prevent port-scan surface expansion via env-var manipulation.
 *
 * Class 1 — parseInt / Number env-var coercion bypass.
 * Sister fix to PKT-1089 (rate-limit), PKT-1117/1118/1119/1120/1171 (api
 * hardening sweep), PKT-1275 (client-ip XFF_HOPS). Closes the LAST
 * remaining `parseInt(process.env…)` site in `src/alienclaw/api/`.
 *
 * Run as:
 *   pnpm exec vitest run test/api/_verify_1276.test.ts
 *
 * Authored by tester cycle 2026-09-28T03:33:49Z (cycle 471, packet PKT-1276).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveApiPort, resolveApiPortFromEnv, DEFAULT_API_PORT, MAX_API_PORT } from '../../src/alienclaw/api/port.js';

describe('PKT-1276 — API_PORT / PORT env-var coercion bypass (Class 1 hardening)', () => {
  const SAVED_PORT     = process.env['PORT'];
  const SAVED_API_PORT = process.env['ALIENCLAW_API_PORT'];

  beforeEach(() => {
    delete process.env['PORT'];
    delete process.env['ALIENCLAW_API_PORT'];
  });
  afterEach(() => {
    if (SAVED_PORT     === undefined) delete process.env['PORT'];              else process.env['PORT']              = SAVED_PORT;
    if (SAVED_API_PORT === undefined) delete process.env['ALIENCLAW_API_PORT']; else process.env['ALIENCLAW_API_PORT'] = SAVED_API_PORT;
  });

  // ── Group A: parseInt substring-truncation bypass (the defect) ────────────
  describe('Group A: parseInt substring-truncation (the bypass)', () => {
    it.each([
      ['1234garbage', 8080],   // parseInt("1234garbage") → 1234; fixed → 8080
      ['1e9',         8080],   // parseInt("1e9")         → 1;     fixed → 8080 (Number("1e9") = 1e9, not integer → 8080)
      ['1.5',         8080],   // parseInt("1.5")         → 1;     fixed → 8080
    ])('PORT=%s → 8080 (rejected)', (input, _expected) => {
      process.env['PORT'] = input;
      expect(resolveApiPort()).toBe(8080);
    });
  });

  // ── Group B: garbage / non-numeric falls back ────────────────────────────
  describe('Group B: garbage / non-numeric fall back', () => {
    it.each([
      'abc',
      'NaN',
      'Infinity',
      'eight',
      'not-a-port',
      '8080xyz',
    ])('PORT=%s → 8080 (rejected)', (input) => {
      process.env['PORT'] = input;
      expect(resolveApiPort()).toBe(8080);
    });
  });

  // ── Group C: empty / unset fall back ──────────────────────────────────────
  describe('Group C: empty / unset fall back', () => {
    it('unset PORT and unset ALIENCLAW_API_PORT → 8080 (default)', () => {
      expect(resolveApiPort()).toBe(8080);
    });
    it('empty PORT and unset ALIENCLAW_API_PORT → 8080', () => {
      process.env['PORT'] = '';
      expect(resolveApiPort()).toBe(8080);
    });
    it('whitespace-only PORT → 8080', () => {
      process.env['PORT'] = '   ';
      expect(resolveApiPort()).toBe(8080);
    });
    it('unset PORT but ALIENCLAW_API_PORT="" → 8080', () => {
      process.env['ALIENCLAW_API_PORT'] = '';
      expect(resolveApiPort()).toBe(8080);
    });
  });

  // ── Group D: out-of-range values fall back ────────────────────────────────
  describe('Group D: out-of-range values fall back', () => {
    it('PORT=0 → 8080 (port 0 means "ephemeral" — Node silently substitutes, defeating operator intent)', () => {
      process.env['PORT'] = '0';
      expect(resolveApiPort()).toBe(8080);
    });
    it('PORT=-1 → 8080 (negative ports are invalid)', () => {
      process.env['PORT'] = '-1';
      expect(resolveApiPort()).toBe(8080);
    });
    it('PORT=65536 → 8080 (above MAX_API_PORT=65535)', () => {
      process.env['PORT'] = '65536';
      expect(resolveApiPort()).toBe(8080);
    });
    it('PORT=99999 → 8080 (clearly invalid)', () => {
      process.env['PORT'] = '99999';
      expect(resolveApiPort()).toBe(8080);
    });
  });

  // ── Group E: well-formed values pass through unchanged ─────────────────────
  describe('Group E: well-formed values preserved', () => {
    it.each([
      ['8080', 8080],
      ['80',   80],
      ['3000', 3000],
      ['65535', 65535],  // boundary (MAX_API_PORT)
    ])('PORT=%s → %i (preserved)', (input, expected) => {
      process.env['PORT'] = input;
      expect(resolveApiPortFromEnv(process.env['PORT'], process.env['ALIENCLAW_API_PORT'])).toBe(expected);
    });

    it('PORT unset, ALIENCLAW_API_PORT=3000 → 3000 (preserved)', () => {
      process.env['ALIENCLAW_API_PORT'] = '3000';
      expect(resolveApiPortFromEnv(process.env['PORT'], process.env['ALIENCLAW_API_PORT'])).toBe(3000);
    });

    it('PORT takes precedence over ALIENCLAW_API_PORT', () => {
      process.env['PORT']              = '3001';
      process.env['ALIENCLAW_API_PORT'] = '3002';
      expect(resolveApiPortFromEnv(process.env['PORT'], process.env['ALIENCLAW_API_PORT'])).toBe(3001);
    });

    it('PORT=invalid falls back to ALIENCLAW_API_PORT', () => {
      // If PORT is set but invalid (parseInt bypass), the precedence rule
      // is: prefer PORT only when it produces a safe value. Otherwise
      // fall back to ALIENCLAW_API_PORT. This is BETTER than the original
      // `parseInt('abc', 10) → NaN` silent failure.
      process.env['PORT']              = 'abc';
      process.env['ALIENCLAW_API_PORT'] = '3000';
      expect(resolveApiPortFromEnv(process.env['PORT'], process.env['ALIENCLAW_API_PORT'])).toBe(3000);
    });
  });

  // ── Group F: constants are exported with documented semantics ─────────────
  describe('Group F: constants', () => {
    it('DEFAULT_API_PORT === 8080', () => {
      expect(DEFAULT_API_PORT).toBe(8080);
    });
    it('MAX_API_PORT === 65535 (TCP/IP port range upper bound)', () => {
      expect(MAX_API_PORT).toBe(65535);
    });
  });

  // ── Group G: regression guard — main.ts must use the helper, not parseInt ─
  // This is the test that catches the "did you forget to wire main.ts to the
  // helper?" failure mode. Without this group, a future refactor that
  // reintroduces `parseInt(process.env['PORT']…)` in main.ts would still pass
  // all of Groups A-F (because they only test the helper in isolation).
  describe('Group G: main.ts wiring regression guard', () => {
    it('src/alienclaw/api/main.ts contains no parseInt(process.env call', async () => {
      const { readFile } = await import('node:fs/promises');
      const { fileURLToPath } = await import('node:url');
      const mainPath = fileURLToPath(new URL('../../src/alienclaw/api/main.ts', import.meta.url));
      const src = await readFile(mainPath, 'utf-8');
      // Strip comments to avoid false positives on the PKT-1276 header comment
      // that names "parseInt" for context.
      const stripped = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(stripped).not.toMatch(/parseInt\s*\(\s*process\.env/);
    });

    it('src/alienclaw/api/main.ts imports resolveApiPortFromEnv from ./port.js', async () => {
      const { readFile } = await import('node:fs/promises');
      const { fileURLToPath } = await import('node:url');
      const mainPath = fileURLToPath(new URL('../../src/alienclaw/api/main.ts', import.meta.url));
      const src = await readFile(mainPath, 'utf-8');
      expect(src).toMatch(/from\s+['"]\.\/port\.js['"]/);
      expect(src).toMatch(/resolveApiPortFromEnv/);
    });
  });
});
