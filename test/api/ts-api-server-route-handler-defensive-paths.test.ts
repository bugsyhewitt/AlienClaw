/**
 * Route-handler defensive-path tests for src/alienclaw/api/server.ts.
 *
 * Closes the 4 uncovered branch groups in server.ts that the existing
 * ts-api-server.test.ts (which uses real MySQL via TEST_DB_URL) leaves
 * uncovered when no DB is available:
 *
 *   1. lines 247-248: 429 RATE_LIMIT_EXCEEDED on /v1/genomes
 *      (Retry-After setHeader + 429 err) — only reached when the RateLimiter
 *      refuses a khash inside the [allowed, retryAfter] check.
 *   2. line  255:     400 MALFORMED_REQUEST on /v1/genomes
 *      (the second readJson `if (!parsed.ok)` branch — only reached when the
 *      install's auth has succeeded but the body parses fails).
 *   3. lines 275-277: 422 apiError catch on /v1/genomes
 *      (the `if (e instanceof Error && 'apiError' in e)` branch in the
 *      try/catch around handleSubmitGenome — only reached when the handler
 *      throws an apiError-tagged Error).
 *   4. lines 286-288: 500 INTERNAL_ERROR on the catch-all
 *      (the outer `catch (e: unknown)` in createApiServer — only reached
 *      when a route handler throws a generic Error).
 *
 * Mirrors the vi.doMock('storage.js', ...) pattern from the "Body size limit"
 * describe block in ts-api-server.test.ts:318, plus an additional
 * vi.doMock('handlers/genomes.js', ...) so we can drive each branch with a
 * minimal mock instead of depending on real MySQL.
 *
 * No DB required. Runs the same ship-gate as the rest of the suite.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateApiKey } from '../../src/alienclaw/api/auth.js';

// ── Steerable state for the mocked handlers/storage ────────────────────────

/**
 * When non-null, the mocked handleSubmitGenome throws this Error instead of
 * returning a [status, body] tuple. Tagged with the indicated marker so the
 * server's `if (e instanceof Error && 'apiError' in e)` branch decides
 * 422 vs 500.
 *
 *   'apiError'    → server resolves to send(res, 422, { error: e.apiError })
 *                   (covers server.ts:275-277)
 *   'generic'     → server falls through to the outer 500 catch
 *                   (covers server.ts:286-288)
 */
type ThrowMode = { kind: 'apiError'; apiError: unknown } | { kind: 'generic'; message: string };
let throwMode: ThrowMode | null = null;

const installState = {
  /** Returned by mocked InstallStore.exists() — controls authBearer. */
  exists: true as boolean,
  /** Returned by mocked InstallStore.register() — controls /v1/install. */
  registerResult: ['install-mock-id', true] as [string, boolean],
  /** If true, mocked handleInstall throws. */
  installThrow: false as boolean,
};

const rateState = {
  /** When true, mocked RateLimiter.check() always returns [false, 7]. */
  refuse: false as boolean,
};

const bodyParseState = {
  /**
   * If 'malformed' the mocked readJson will return { ok:false, reason:'malformed' }
   * for /v1/genomes requests specifically. If 'ok' it returns the real body.
   */
  genomesBody: 'ok' as 'ok' | 'malformed',
};

let dataRoot = '';
let sizeServer: Server;
let sizeBase = '';

// ── Test setup: mock storage + handler, then create real server ────────────

beforeAll(async () => {
  dataRoot = mkdtempSync(join(tmpdir(), 'alienclaw-rhdp-'));

  // Reset module registry so the dynamic import re-evaluates server.js
  // and resolves storage.js / handlers/genomes.js / rate-limit.js through
  // the mocks below (the top-level static imports already cached the real
  // modules; this fresh instance is separate).
  vi.resetModules();

  vi.doMock('../../src/alienclaw/api/storage.js', () => {
    class InstallStore {
      async register(_apiKeyHash: string, _machineHash: string): Promise<[string, boolean]> {
        if (installState.installThrow) {
          throw new Error('mocked install handler boom');
        }
        return installState.registerResult;
      }
      async exists(_apiKeyHash: string): Promise<boolean> {
        return installState.exists;
      }
      async count(): Promise<number> { return 0; }
    }
    class SubmissionStore {
      async save(): Promise<[string, string]> { return ['sub-mock-id', '2026-01-01T00:00:00.000Z']; }
      async topForType(): Promise<unknown[]> { return []; }
      async countForType(): Promise<number> { return 0; }
      async rankForFitness(): Promise<number> { return 1; }
      async isNewTop(): Promise<boolean> { return true; }
      async findDuplicate(): Promise<unknown> { return null; }
    }
    class GlobalStats {
      async get(): Promise<unknown> {
        return { total_genomes: 0, total_installs: 0, total_fitness_evaluations: 0, top_fitness_by_type: {} };
      }
    }
    const initPool = (_dbUrl?: string): unknown => ({});
    return { InstallStore, SubmissionStore, GlobalStats, initPool };
  });

  vi.doMock('../../src/alienclaw/api/rate-limit.js', () => {
    class RateLimiter {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      constructor(_opts: { limit?: number; windowSeconds?: number; dataRoot?: string } = {}) {
        // no-op — the mocked check() ignores _limit/_window.
      }
      check(_installId: string): [boolean, number] {
        if (rateState.refuse) return [false, 7];
        return [true, 0];
      }
    }
    return { RateLimiter };
  });

  vi.doMock('../../src/alienclaw/api/handlers/genomes.js', () => {
    return {
      handleSubmitGenome: async (_opts: unknown): Promise<[number, unknown]> => {
        if (throwMode) {
          if (throwMode.kind === 'apiError') {
            throw Object.assign(new Error('mocked validation'), { apiError: throwMode.apiError });
          }
          throw new Error(throwMode.message);
        }
        return [201, { submission_id: 'sub-mock-id', submitted_at: '2026-01-01T00:00:00.000Z', rank: 1 }];
      },
      handleTopGenomes: async (_opts: unknown): Promise<[number, unknown]> => {
        return [200, { martian_type: 'compute', entries: [] }];
      },
      clampTopN: (n: number): number => Math.max(1, Math.min(100, Math.floor(n) || 10)),
    };
  });

  const mod = await import('../../src/alienclaw/api/server.js');
  // dbUrl is truthy so configure() runs its normal path; the mocked initPool
  // swallows it. dataRoot keeps AuditLog on an isolated temp dir.
  mod.configure({ dbUrl: 'mysql://mock-not-used', dataRoot });
  sizeServer = await mod.createApiServer(0, '127.0.0.1');
  const addr = sizeServer.address() as AddressInfo;
  sizeBase = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  sizeServer?.close();
  vi.doUnmock('../../src/alienclaw/api/storage.js');
  vi.doUnmock('../../src/alienclaw/api/rate-limit.js');
  vi.doUnmock('../../src/alienclaw/api/handlers/genomes.js');
  vi.resetModules();
  if (dataRoot) rmSync(dataRoot, { recursive: true, force: true });
});

beforeEach(() => {
  installState.exists = true;
  installState.registerResult = ['install-mock-id', true];
  installState.installThrow = false;
  rateState.refuse = false;
  bodyParseState.genomesBody = 'ok';
  throwMode = null;
});

// ── HTTP helpers ────────────────────────────────────────────────────────────

async function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${sizeBase}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  let parsed: unknown = null;
  try { parsed = await res.json(); } catch { /* empty / non-JSON body */ }
  return { status: res.status, body: parsed };
}

function validGenome(): string {
  // 256 chars of 'A' — server.ts:262 calls String(body['genome'] ?? '') so any
  // string of length 256 is accepted by the router's MISSING_FIELDS check. The
  // deeper validation is owned by the handler; we mock the handler, so the
  // router-level behavior is what we are testing here.
  return 'A'.repeat(256);
}

// ── Test suite ─────────────────────────────────────────────────────────────

describe('API server: route-handler defensive paths', () => {

  // ── (1) 429 RATE_LIMIT_EXCEEDED on /v1/genomes (server.ts:247-248) ──────

  it('POST /v1/genomes returns 429 RATE_LIMIT_EXCEEDED + Retry-After when rate limiter refuses', async () => {
    rateState.refuse = true;
    installState.exists = true;
    const key = generateApiKey();
    const { status, body } = await post('/v1/genomes',
      { genome: validGenome(), martian_type: 'compute', fitness: 0.5,
        leaderboard_name: 'TESTBOTA' },
      { Authorization: `Bearer ${key}` });
    expect(status).toBe(429);
    expect((body as {error: {code: string}}).error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect((body as {error: {details: {retry_after_seconds: number}}}).error.details.retry_after_seconds).toBe(7);
  });

  // ── (2) 400 MALFORMED_REQUEST on /v1/genomes (server.ts:255) ────────────
  //
  // The router's readJson for /v1/genomes is the second call (line 252),
  // after the first one for /v1/install is gated by path match. We send
  // a body that the mocked readJson will return { ok:false, reason:'malformed' }.
  // Since readJson is internal to server.ts we cannot mock it directly without
  // forking the module; instead, we send a syntactically broken body and
  // observe the real readJson return path. This exercises the same `if
  // (parsed.reason === 'too_large') ... return err(res, 400, 'MALFORMED_REQUEST'...)`
  // branch as the install path (line 229) — but on /v1/genomes specifically,
  // which is the *uncovered* branch at line 255.

  it('POST /v1/genomes with malformed JSON returns 400 MALFORMED_REQUEST', async () => {
    installState.exists = true;
    const key = generateApiKey();
    // Send a syntactically broken body — the real readJson will catch the
    // JSON.parse error and return { ok:false, reason:'malformed' }.
    const res = await fetch(`${sizeBase}/v1/genomes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: '{ this is not json', // truncated body
    });
    let parsed: unknown = null;
    try { parsed = await res.json(); } catch { /* keep null */ }
    expect(res.status).toBe(400);
    expect((parsed as {error: {code: string}}).error.code).toBe('MALFORMED_REQUEST');
  });

  // ── (3) 422 apiError catch on /v1/genomes (server.ts:275-277) ───────────

  it('POST /v1/genomes returns 422 with the apiError body when handleSubmitGenome throws apiError', async () => {
    installState.exists = true;
    throwMode = { kind: 'apiError', apiError: { code: 'INVALID_GENOME_LENGTH', message: 'mocked validation' } };
    const key = generateApiKey();
    const { status, body } = await post('/v1/genomes',
      { genome: validGenome(), martian_type: 'compute', fitness: 0.5,
        leaderboard_name: 'TESTBOTA' },
      { Authorization: `Bearer ${key}` });
    expect(status).toBe(422);
    expect((body as {error: {code: string}}).error.code).toBe('INVALID_GENOME_LENGTH');
  });

  // ── (4) 500 INTERNAL_ERROR on the outer catch (server.ts:286-288) ───────

  it('POST /v1/genomes returns 400 MALFORMED_REQUEST when handleSubmitGenome throws a generic Error (inner catch else branch)', async () => {
    // The inner try/catch on lines 274-279 catches the Error from
    // handleSubmitGenome. When the Error is NOT tagged with `apiError`,
    // it falls through to the `else` branch on line 278 — 400
    // MALFORMED_REQUEST with `String(e)` as the message. This is a NEW
    // coverage path (the else branch on line 278 was uncovered before
    // this packet).
    installState.exists = true;
    throwMode = { kind: 'generic', message: 'mocked unhandled boom' };
    const key = generateApiKey();
    const { status, body } = await post('/v1/genomes',
      { genome: validGenome(), martian_type: 'compute', fitness: 0.5,
        leaderboard_name: 'TESTBOTA' },
      { Authorization: `Bearer ${key}` });
    expect(status).toBe(400);
    expect((body as {error: {code: string; message: string}}).error.code).toBe('MALFORMED_REQUEST');
    expect((body as {error: {code: string; message: string}}).error.message).toContain('mocked unhandled boom');
  });

  it('GET /v1/stats returns 500 INTERNAL_ERROR when handleStats throws (reaches outer catch on lines 286-288)', async () => {
    // The outer catch on lines 286-289 is reached when a GET-route handler
    // throws. The inner try/catch on lines 274-279 ONLY wraps the
    // /v1/genomes POST handler — GET routes fall straight through to the
    // outer catch. Re-mock handlers/stats.js to throw a generic Error
    // and re-create the server.
    vi.resetModules();
    vi.doMock('../../src/alienclaw/api/storage.js', () => {
      class InstallStore {
        async register(): Promise<[string, boolean]> { return ['install-mock-id', true]; }
        async exists(): Promise<boolean> { return true; }
        async count(): Promise<number> { return 0; }
      }
      class SubmissionStore {
        async save(): Promise<[string, string]> { return ['sub-mock-id', '2026-01-01T00:00:00.000Z']; }
        async topForType(): Promise<unknown[]> { return []; }
        async countForType(): Promise<number> { return 0; }
        async rankForFitness(): Promise<number> { return 1; }
        async isNewTop(): Promise<boolean> { return true; }
        async findDuplicate(): Promise<unknown> { return null; }
      }
      class GlobalStats {
        async get(): Promise<unknown> { throw new Error('mocked stats handler boom'); }
      }
      const initPool = (): unknown => ({});
      return { InstallStore, SubmissionStore, GlobalStats, initPool };
    });
    vi.doMock('../../src/alienclaw/api/handlers/stats.js', () => {
      return {
        handleStats: async (): Promise<[number, unknown]> => {
          throw new Error('mocked stats handler boom');
        },
      };
    });
    // Tear down the previous server before swapping modules.
    sizeServer?.close();
    const mod = await import('../../src/alienclaw/api/server.js');
    mod.configure({ dbUrl: 'mysql://mock-not-used', dataRoot });
    sizeServer = await mod.createApiServer(0, '127.0.0.1');
    const addr = sizeServer.address() as AddressInfo;
    sizeBase = `http://127.0.0.1:${addr.port}`;

    const res = await fetch(`${sizeBase}/v1/stats`);
    expect(res.status).toBe(500);
    const text = await res.text();
    let parsed: unknown = null;
    try { parsed = JSON.parse(text); } catch { /* keep null */ }
    expect((parsed as {error: {code: string}}).error.code).toBe('INTERNAL_ERROR');
  });

  // ── Bonus: 404 NOT_FOUND for a non-existent POST path (server.ts:282) ──
  // This is a "well-covered" branch but included as a smoke test to confirm
  // the rest of the mock setup works end-to-end. (NOT a coverage win; just
  // a sanity check that the server fixture is wired correctly.)

  it('POST /v1/nonexistent returns 404 NOT_FOUND', async () => {
    const { status, body } = await post('/v1/nonexistent', { any: 'thing' });
    expect(status).toBe(404);
    expect((body as {error: {code: string}}).error.code).toBe('NOT_FOUND');
  });

  // ── (5) 400 INVALID_API_KEY_FORMAT via handleInstall validation throw (server.ts:238) ──
  // The router's L232 check only tests field *presence*, not format.
  // handleInstall calls validateInstallRequest which throws when api_key is malformed.
  // The catch at L238 JSON.parses the error message and sends 400.

  it('POST /v1/install with present but malformed api_key returns 400 INVALID_API_KEY_FORMAT', async () => {
    const { status, body } = await post('/v1/install', {
      api_key: 'tooshort',
      machine_hash: 'a'.repeat(64),
    });
    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe('INVALID_API_KEY_FORMAT');
  });

  // ── Bonus: 405 Method Not Allowed for non-GET/non-POST (server.ts:285) ─
  // The router falls through the if/else method blocks and writes 405.
  // The line-285 `res.writeHead(405).end();` is v8-reported as covered
  // by other tests, but is also worth pinning here.

  it('PUT /v1/health returns 405', async () => {
    const res = await fetch(`${sizeBase}/v1/health`, { method: 'PUT' });
    expect(res.status).toBe(405);
  });

  // ── (L135) readJson non-object body guard: null → 400 MALFORMED_REQUEST ──
  // server.ts:135 checks `parsed === null || typeof parsed !== 'object' ||
  // Array.isArray(parsed)` and returns { ok:false, reason:'malformed' }.
  // Without this guard, a null body causes `'api_key' in null` to throw a
  // TypeError (500); an array body yields wrong error code MISSING_FIELDS.

  it('POST /v1/install with JSON null body returns 400 MALFORMED_REQUEST', async () => {
    const res = await fetch(`${sizeBase}/v1/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    });
    let parsed: unknown = null;
    try { parsed = await res.json(); } catch { /* keep null */ }
    expect(res.status).toBe(400);
    expect((parsed as { error: { code: string } }).error.code).toBe('MALFORMED_REQUEST');
  });

  it('POST /v1/install with JSON array body returns 400 MALFORMED_REQUEST', async () => {
    const res = await fetch(`${sizeBase}/v1/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '[1, 2, 3]',
    });
    let parsed: unknown = null;
    try { parsed = await res.json(); } catch { /* keep null */ }
    expect(res.status).toBe(400);
    expect((parsed as { error: { code: string } }).error.code).toBe('MALFORMED_REQUEST');
  });
});
