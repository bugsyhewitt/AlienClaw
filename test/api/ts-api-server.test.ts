/**
 * Integration tests for the TypeScript leaderboard API.
 * Verifies behavioral equivalence with the Python original (Packet 31.5).
 *
 * Same test cases as test/api/test_api_server.py — identical inputs,
 * identical expected outputs.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { createServer, request as httpRequest } from 'node:http';
import { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { configure, createApiServer } from '../../src/alienclaw/api/server.js';
import { generateApiKey } from '../../src/alienclaw/api/auth.js';
import { validateLeaderboardName } from '../../src/alienclaw/api/validation.js';
import { initPool } from '../../src/alienclaw/api/storage.js';

const TEST_DB_URL = process.env['ALIENCLAW_TEST_DB_URL'];
const skipIfNoDb = !TEST_DB_URL;

// ── HTTP helpers ────────────────────────────────────────────────────────────

async function get(base: string, path: string): Promise<{status: number; body: unknown}> {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json() };
}

async function post(
  base: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<{status: number; body: unknown}> {
  const res = await fetch(`${base}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body:    JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

function validGenome(): string {
  // 256-char Base62 string — same genome used in Python tests
  const alpha = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  // Use a fixed seed to produce a deterministic genome
  let g = '';
  let seed = 42;
  for (let i = 0; i < 256; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    g += alpha[seed % 62];
  }
  return g;
}

// ── Server fixture ──────────────────────────────────────────────────────────

let base = '';
let server: Server;

beforeEach(async () => {
  if (!TEST_DB_URL) return; // skip setup when no DB
  // Clean tables so each test starts with an empty DB (isolation from ts-storage.test.ts)
  const pool = initPool(TEST_DB_URL);
  await pool.execute('DELETE FROM leaderboard_entries');
  await pool.execute('DELETE FROM installs');
  await pool.end();
  configure({ dbUrl: TEST_DB_URL });
  server = await createApiServer(0, '127.0.0.1');
  const addr = server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
});

afterEach(() => {
  server?.close();
});

async function register(key?: string): Promise<string> {
  const k = key ?? generateApiKey();
  await post(base, '/v1/install', { api_key: k, machine_hash: 'c'.repeat(64) });
  return k;
}

// ── Tests ──────────────────────────────────────────────────────────────────

const dbDescribe = skipIfNoDb ? describe.skip : describe;

dbDescribe('Health', () => {
  it('GET /v1/health returns 200', async () => {
    const { status, body } = await get(base, '/v1/health');
    expect(status).toBe(200);
    expect((body as {status: string}).status).toBe('ok');
  });
});

dbDescribe('Install', () => {
  it('new install returns 201', async () => {
    const key = generateApiKey();
    const { status, body } = await post(base, '/v1/install',
      { api_key: key, machine_hash: 'a'.repeat(64) });
    expect(status).toBe(201);
    expect((body as {status: string}).status).toBe('registered');
  });

  it('known install returns 200', async () => {
    const key = generateApiKey();
    await post(base, '/v1/install', { api_key: key, machine_hash: 'b'.repeat(64) });
    const { status, body } = await post(base, '/v1/install',
      { api_key: key, machine_hash: 'b'.repeat(64) });
    expect(status).toBe(200);
    expect((body as {status: string}).status).toBe('known');
  });
});

dbDescribe('SubmitGenome', () => {
  it('valid submission returns 201', async () => {
    const key = await register();
    const { status, body } = await post(base, '/v1/genomes',
      { genome: validGenome(), martian_type: 'compute', fitness: 0.85,
        leaderboard_name: 'TESTBOTA', run_metadata: {} },
      { Authorization: `Bearer ${key}` });
    expect(status).toBe(201);
    expect((body as {rank: number}).rank).toBeGreaterThanOrEqual(1);
  });

  it('missing auth returns 401', async () => {
    const { status } = await post(base, '/v1/genomes',
      { genome: validGenome(), martian_type: 'compute', fitness: 0.5,
        leaderboard_name: 'TESTBOTA' });
    expect(status).toBe(401);
  });

  it('invalid genome length returns 422', async () => {
    const key = await register();
    const { status, body } = await post(base, '/v1/genomes',
      { genome: 'TOOSHORT', martian_type: 'compute', fitness: 0.5,
        leaderboard_name: 'TESTBOTA' },
      { Authorization: `Bearer ${key}` });
    expect(status).toBe(422);
    expect((body as {error: {code: string}}).error.code).toBe('INVALID_GENOME_LENGTH');
  });

  it('invalid fitness returns 422', async () => {
    const key = await register();
    const { status, body } = await post(base, '/v1/genomes',
      { genome: validGenome(), martian_type: 'compute', fitness: 1.5,
        leaderboard_name: 'TESTBOTA' },
      { Authorization: `Bearer ${key}` });
    expect(status).toBe(422);
    expect((body as {error: {code: string}}).error.code).toBe('INVALID_FITNESS_RANGE');
  });

  it('unknown martian type returns 422', async () => {
    const key = await register();
    const { status, body } = await post(base, '/v1/genomes',
      { genome: validGenome(), martian_type: 'nonexistent', fitness: 0.5,
        leaderboard_name: 'TESTBOTA' },
      { Authorization: `Bearer ${key}` });
    expect(status).toBe(422);
    expect((body as {error: {code: string}}).error.code).toBe('UNKNOWN_MARTIAN_TYPE');
  });

  it('duplicate returns 200 with same submission_id', async () => {
    const key = await register();
    const body = { genome: validGenome(), martian_type: 'compute', fitness: 0.9,
                   leaderboard_name: 'TESTBOTA', run_metadata: {} };
    const headers = { Authorization: `Bearer ${key}` };
    const r1 = await post(base, '/v1/genomes', body, headers);
    const r2 = await post(base, '/v1/genomes', body, headers);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(200);
    expect((r1.body as {submission_id: string}).submission_id).toBe(
      (r2.body as {submission_id: string}).submission_id);
  });

  // ── Leaderboard name validation — behavioral equivalence with Python ──

  it('missing leaderboard_name returns 400 MISSING_FIELDS', async () => {
    const key = await register();
    const { status, body } = await post(base, '/v1/genomes',
      { genome: validGenome(), martian_type: 'compute', fitness: 0.5 },
      { Authorization: `Bearer ${key}` });
    expect(status).toBe(400);
    expect((body as {error: {code: string}}).error.code).toBe('MISSING_FIELDS');
  });

  it('lowercase leaderboard_name returns 422 INVALID_LEADERBOARD_NAME', async () => {
    const key = await register();
    const { status, body } = await post(base, '/v1/genomes',
      { genome: validGenome(), martian_type: 'compute', fitness: 0.5,
        leaderboard_name: 'lowercase' },
      { Authorization: `Bearer ${key}` });
    expect(status).toBe(422);
    expect((body as {error: {code: string}}).error.code).toBe('INVALID_LEADERBOARD_NAME');
  });

  it('digit in leaderboard_name returns 422 INVALID_LEADERBOARD_NAME', async () => {
    const key = await register();
    const { status, body } = await post(base, '/v1/genomes',
      { genome: validGenome(), martian_type: 'compute', fitness: 0.5,
        leaderboard_name: 'TESTBOT1' },
      { Authorization: `Bearer ${key}` });
    expect(status).toBe(422);
    expect((body as {error: {code: string}}).error.code).toBe('INVALID_LEADERBOARD_NAME');
  });

  it('symbol in leaderboard_name returns 422', async () => {
    const key = await register();
    const { status, body } = await post(base, '/v1/genomes',
      { genome: validGenome(), martian_type: 'compute', fitness: 0.5,
        leaderboard_name: 'ALIEN-BT' },
      { Authorization: `Bearer ${key}` });
    expect(status).toBe(422);
    expect((body as {error: {code: string}}).error.code).toBe('INVALID_LEADERBOARD_NAME');
  });

  it('7-char leaderboard_name returns 422', async () => {
    const key = await register();
    const { status, body } = await post(base, '/v1/genomes',
      { genome: validGenome(), martian_type: 'compute', fitness: 0.5,
        leaderboard_name: 'TOOSHRT' },
      { Authorization: `Bearer ${key}` });
    expect(status).toBe(422);
    expect((body as {error: {code: string}}).error.code).toBe('INVALID_LEADERBOARD_NAME');
  });

  it('9-char leaderboard_name returns 422', async () => {
    const key = await register();
    const { status, body } = await post(base, '/v1/genomes',
      { genome: validGenome(), martian_type: 'compute', fitness: 0.5,
        leaderboard_name: 'TOOLONGGG' },
      { Authorization: `Bearer ${key}` });
    expect(status).toBe(422);
    expect((body as {error: {code: string}}).error.code).toBe('INVALID_LEADERBOARD_NAME');
  });
});

dbDescribe('TopGenomes', () => {
  it('returns 200 with empty board', async () => {
    const { status, body } = await get(base, '/v1/genomes/top?martian_type=compute&n=3');
    expect(status).toBe(200);
    expect((body as {genomes: unknown[]}).genomes).toHaveLength(0);
  });

  it('missing martian_type returns 400', async () => {
    const { status } = await get(base, '/v1/genomes/top');
    expect(status).toBe(400);
  });

  it('returns leaderboard_name in each entry', async () => {
    const key = await register();
    const headers = { Authorization: `Bearer ${key}` };
    for (const fitness of [0.3, 0.8, 0.5]) {
      await post(base, '/v1/genomes',
        { genome: validGenome().split('').reverse().join('').slice(0, 256) + validGenome().slice(0, 256 - 256 % 1),
          martian_type: 'compute', fitness, leaderboard_name: 'TESTBOTA' }, headers);
    }
    // Simpler: just submit one valid genome
    await post(base, '/v1/genomes',
      { genome: validGenome(), martian_type: 'compute', fitness: 0.7, leaderboard_name: 'TESTBOTA' },
      headers);
    const { body } = await get(base, '/v1/genomes/top?martian_type=compute&n=5');
    const entries = (body as {genomes: {leaderboard_name: string}[]}).genomes;
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.leaderboard_name).toBe('TESTBOTA');
    }
  });
});

// ── Security validator equivalence ─────────────────────────────────────────

describe('validateLeaderboardName equivalence', () => {
  it('accepts exactly 8 uppercase letters', () => {
    expect(validateLeaderboardName('ABCDEFGH')).toBe(true);
    expect(validateLeaderboardName('AAAAAAAA')).toBe(true);
    expect(validateLeaderboardName('ALIENBOT')).toBe(true);
  });
  it('rejects lowercase', () => {
    expect(validateLeaderboardName('abcdefgh')).toBe(false);
    expect(validateLeaderboardName('ABCDEFGh')).toBe(false);
  });
  it('rejects digits', () => {
    expect(validateLeaderboardName('TESTBOT1')).toBe(false);
    expect(validateLeaderboardName('12345678')).toBe(false);
  });
  it('rejects symbols', () => {
    expect(validateLeaderboardName('ALIEN-BT')).toBe(false);
    expect(validateLeaderboardName('ALIEN_BT')).toBe(false);
    expect(validateLeaderboardName('ALIEN BT')).toBe(false);
  });
  it('rejects wrong length (7)', () => {
    expect(validateLeaderboardName('ALIENBT')).toBe(false);
  });
  it('rejects wrong length (9)', () => {
    expect(validateLeaderboardName('ALIENBOTS')).toBe(false);
  });
  it('rejects empty', () => {
    expect(validateLeaderboardName('')).toBe(false);
  });
});

// ── Body size limit (DoS hardening) ──────────────────────────────────────────
//
// readJson buffers the request body into memory, so an unbounded body can
// exhaust server memory. These tests assert the cap (MAX_BODY_BYTES) rejects an
// oversized body with HTTP 413 PAYLOAD_TOO_LARGE while a normal-sized body still
// succeeds. They are DB-free: the storage layer is replaced with an in-memory
// fake via vi.doMock so this block runs headless without MySQL and never
// interferes with the DB-gated behavioral-equivalence blocks above (those use
// the real, statically-imported modules).

describe('Body size limit (DoS hardening)', () => {
  // Steerable state for the fake InstallStore.
  const installState = {
    registerResult: ['install-mock-id', true] as [string, boolean],
    exists: true,
  };

  let sizeServer: Server;
  let sizeBase = '';
  let dataRoot = '';
  let MAX = 0;

  beforeAll(async () => {
    dataRoot = mkdtempSync(join(tmpdir(), 'alienclaw-size-'));

    // Reset the module registry so the dynamic import below re-evaluates
    // server.js and resolves storage.js through the mock (the top-level static
    // import already cached the real module; this fresh instance is separate).
    vi.resetModules();

    vi.doMock('../../src/alienclaw/api/storage.js', () => {
      class InstallStore {
        async register(_apiKeyHash: string, _machineHash: string): Promise<[string, boolean]> {
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
      // initPool must not throw and must not open a real connection.
      const initPool = (_dbUrl?: string): unknown => ({});
      return { InstallStore, SubmissionStore, GlobalStats, initPool };
    });

    const mod = await import('../../src/alienclaw/api/server.js');
    MAX = mod.MAX_BODY_BYTES;
    // dbUrl is truthy so configure() runs its normal path; the mocked initPool
    // swallows it. dataRoot keeps RateLimiter/AuditLog on an isolated temp dir.
    mod.configure({ dbUrl: 'mysql://mock-not-used', dataRoot });
    sizeServer = await mod.createApiServer(0, '127.0.0.1');
    const addr = sizeServer.address() as AddressInfo;
    sizeBase = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    sizeServer?.close();
    vi.doUnmock('../../src/alienclaw/api/storage.js');
    vi.resetModules();
    if (dataRoot) rmSync(dataRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    installState.registerResult = ['install-mock-id', true];
    installState.exists = true;
  });

  // Raw POST helper that lets us send arbitrary bodies (incl. oversized) and,
  // optionally, lie about Content-Length.
  async function rawPost(
    path: string,
    rawBody: string,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`${sizeBase}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: rawBody,
    });
    let parsed: unknown = null;
    try { parsed = await res.json(); } catch { /* empty / non-JSON body */ }
    return { status: res.status, body: parsed };
  }

  it('MAX_BODY_BYTES is 64 KiB', () => {
    expect(MAX).toBe(64 * 1024);
  });

  it('oversized POST /v1/install returns 413 PAYLOAD_TOO_LARGE', async () => {
    // A genuine, well-formed JSON object whose serialized size exceeds the cap.
    const big = 'x'.repeat(MAX + 1024);
    const body = JSON.stringify({ api_key: generateApiKey(), machine_hash: 'a'.repeat(64), pad: big });
    expect(Buffer.byteLength(body)).toBeGreaterThan(MAX);

    const { status, body: resBody } = await rawPost('/v1/install', body);
    expect(status).toBe(413);
    const err = (resBody as { error: { code: string; details: Record<string, unknown> } }).error;
    expect(err.code).toBe('PAYLOAD_TOO_LARGE');
    expect(err.details['limit_bytes']).toBe(MAX);
    expect(Number(err.details['received_bytes'])).toBeGreaterThan(MAX);
  });

  it('oversized POST /v1/genomes returns 413 PAYLOAD_TOO_LARGE', async () => {
    const key = generateApiKey();
    const big = 'x'.repeat(MAX + 1024);
    const body = JSON.stringify({
      genome: validGenome(), martian_type: 'compute', fitness: 0.5,
      leaderboard_name: 'TESTBOTA', run_metadata: { pad: big },
    });
    expect(Buffer.byteLength(body)).toBeGreaterThan(MAX);

    const { status, body: resBody } = await rawPost('/v1/genomes', body,
      { Authorization: `Bearer ${key}` });
    expect(status).toBe(413);
    expect((resBody as { error: { code: string } }).error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('oversized body with a TRUTHFUL Content-Length is rejected up front (413)', async () => {
    // fetch sets Content-Length itself; this exercises the header-based fast path.
    const body = JSON.stringify({ api_key: generateApiKey(), machine_hash: 'a'.repeat(64), pad: 'y'.repeat(MAX) });
    const { status, body: resBody } = await rawPost('/v1/install', body,
      { 'Content-Length': String(Buffer.byteLength(body)) });
    expect(status).toBe(413);
    expect((resBody as { error: { code: string } }).error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('oversized CHUNKED body (no Content-Length) is capped by bytes received (413)', async () => {
    // The most important DoS case: a length-less chunked transfer. There is no
    // Content-Length to trust, so only the per-chunk byte accumulator can stop
    // it. We send the body in many small chunks via Transfer-Encoding: chunked
    // and assert the server aborts with 413 before buffering the whole thing.
    const addr = sizeServer.address() as AddressInfo;
    const payload = 'z'.repeat(MAX + 4096);
    const body = JSON.stringify({ api_key: generateApiKey(), machine_hash: 'a'.repeat(64), pad: payload });

    const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: addr.port,
          path: '/v1/install',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }, // no Content-Length → chunked
        },
        res => {
          let data = '';
          res.on('data', d => { data += d; });
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
        },
      );
      req.on('error', reject);
      // Write the body in 8 KiB chunks so the accumulator trips mid-stream.
      const buf = Buffer.from(body, 'utf8');
      const step = 8 * 1024;
      for (let i = 0; i < buf.length; i += step) {
        req.write(buf.subarray(i, i + step));
      }
      req.end();
    });

    expect(result.status).toBe(413);
    expect(JSON.parse(result.body).error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('normal-sized POST /v1/install still returns 201', async () => {
    const body = JSON.stringify({ api_key: generateApiKey(), machine_hash: 'a'.repeat(64) });
    expect(Buffer.byteLength(body)).toBeLessThan(MAX);
    const { status, body: resBody } = await rawPost('/v1/install', body);
    expect(status).toBe(201);
    expect((resBody as { status: string }).status).toBe('registered');
  });

  it('normal-sized POST /v1/genomes (256-char genome + metadata) still returns 201', async () => {
    installState.exists = true;
    const key = generateApiKey();
    const body = JSON.stringify({
      genome: validGenome(), martian_type: 'compute', fitness: 0.85,
      leaderboard_name: 'TESTBOTA', run_metadata: { note: 'ok' },
    });
    expect(Buffer.byteLength(body)).toBeLessThan(MAX);
    const { status, body: resBody } = await rawPost('/v1/genomes', body,
      { Authorization: `Bearer ${key}` });
    expect(status).toBe(201);
    expect((resBody as { rank: number }).rank).toBeGreaterThanOrEqual(1);
  });

  it('a body just under the cap is accepted (boundary)', async () => {
    // Build an install body whose total serialized length is exactly MAX.
    const skeleton = JSON.stringify({ api_key: generateApiKey(), machine_hash: 'a'.repeat(64), pad: '' });
    const padLen = MAX - Buffer.byteLength(skeleton);
    const body = JSON.stringify({ api_key: generateApiKey(), machine_hash: 'a'.repeat(64), pad: 'q'.repeat(padLen) });
    expect(Buffer.byteLength(body)).toBe(MAX);
    const { status } = await rawPost('/v1/install', body);
    // At exactly the cap the body is accepted (cap rejects strictly > MAX).
    expect(status).toBe(201);
  });
});

