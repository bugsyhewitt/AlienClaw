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
import type { Server } from "node:http";
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

// ── Request body floor: chunked / length-less bodies must not be dropped ──────
//
// readJson previously short-circuited on `Content-Length: 0` and returned `{}`.
// A `Transfer-Encoding: chunked` request carries NO Content-Length, so a valid
// genome submission sent chunked was parsed as `{}` and failed downstream as
// MISSING_FIELDS. These tests prove a present body — chunked, with no
// Content-Length — is actually consumed and parsed, while a genuinely-empty
// payload still reads as `{}`.
//
// DB-free: storage is replaced with an in-memory fake via vi.doMock so this
// block runs headless without MySQL. A fresh module instance is imported after
// the mock so it never interferes with the DB-gated blocks above (which use the
// real, statically-imported modules).

describe('Request body floor (chunked / no Content-Length)', () => {
  // Steerable fake-store state.
  const state = {
    exists:     true,                                   // API key is registered
    duplicate:  null as null | { submission_id: string; submitted_at: string },
  };

  let floorServer: import('node:http').Server;
  let floorBase = '';
  let floorPort = 0;
  let dataRoot  = '';

  beforeAll(async () => {
    dataRoot = mkdtempSync(join(tmpdir(), 'alienclaw-floor-'));

    vi.resetModules();
    vi.doMock('../../src/alienclaw/api/storage.js', () => {
      class InstallStore {
        async register(): Promise<[string, boolean]> { return ['install-mock', true]; }
        async exists(): Promise<boolean> { return state.exists; }
        async count(): Promise<number> { return 0; }
      }
      class SubmissionStore {
        async save(): Promise<[string, string]> { return ['sub-mock-id', '2026-01-01T00:00:00.000Z']; }
        async topForType(): Promise<unknown[]> { return []; }
        async countForType(): Promise<number> { return 0; }
        async rankForFitness(): Promise<number> { return 1; }
        async isNewTop(): Promise<boolean> { return true; }
        async findDuplicate(): Promise<unknown> { return state.duplicate; }
      }
      class GlobalStats {
        async get(): Promise<unknown> {
          return { total_genomes: 0, total_installs: 0, total_fitness_evaluations: 0, top_fitness_by_type: {} };
        }
      }
      const initPool = (): unknown => ({}); // never opens a real connection
      return { InstallStore, SubmissionStore, GlobalStats, initPool };
    });

    const mod = await import('../../src/alienclaw/api/server.js');
    mod.configure({ dbUrl: 'mysql://mock-not-used', dataRoot });
    floorServer = await mod.createApiServer(0, '127.0.0.1');
    const addr = floorServer.address() as AddressInfo;
    floorPort = addr.port;
    floorBase = `http://127.0.0.1:${floorPort}`;
  });

  afterAll(async () => {
    floorServer?.close();
    vi.doUnmock('../../src/alienclaw/api/storage.js');
    vi.resetModules();
    if (dataRoot) rmSync(dataRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    state.exists    = true;
    state.duplicate = null;
  });

  // POST a body using Transfer-Encoding: chunked — i.e. WITHOUT a Content-Length
  // header. Writing in multiple req.write() calls forces a chunked transfer in
  // Node's http client, exercising exactly the path the floor fix repairs.
  function chunkedPost(
    path: string,
    rawBody: string,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: unknown }> {
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: floorPort,
          path,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers }, // no Content-Length
        },
        res => {
          let data = '';
          res.on('data', d => { data += d; });
          res.on('end', () => {
            let parsed: unknown = null;
            try { parsed = data ? JSON.parse(data) : null; } catch { /* non-JSON */ }
            resolve({ status: res.statusCode ?? 0, body: parsed });
          });
        },
      );
      req.on('error', reject);
      if (rawBody.length === 0) {
        req.end();
        return;
      }
      // Write in >=2 pieces so the transfer is genuinely chunked (no Content-Length).
      const buf  = Buffer.from(rawBody, 'utf8');
      const mid  = Math.max(1, Math.floor(buf.length / 2));
      req.write(buf.subarray(0, mid));
      req.write(buf.subarray(mid));
      req.end();
    });
  }

  it('THE FIX: valid genome submitted CHUNKED (no Content-Length) is parsed, not dropped → 201', async () => {
    const key  = generateApiKey();
    const body = JSON.stringify({
      genome:           validGenome(),
      martian_type:     'compute',
      fitness:          0.85,
      leaderboard_name: 'TESTBOTA',
      run_metadata:     {},
    });
    const { status, body: resBody } = await chunkedPost('/v1/genomes', body,
      { Authorization: `Bearer ${key}` });

    // On the buggy floor this was 400 MISSING_FIELDS (body read as {}).
    expect(status).toBe(201);
    expect((resBody as { rank: number }).rank).toBeGreaterThanOrEqual(1);
  });

  it('valid install submitted CHUNKED (no Content-Length) is parsed → 201', async () => {
    const body = JSON.stringify({ api_key: generateApiKey(), machine_hash: 'a'.repeat(64) });
    const { status, body: resBody } = await chunkedPost('/v1/install', body);
    expect(status).toBe(201);
    expect((resBody as { status: string }).status).toBe('registered');
  });

  it('genome submitted CHUNKED reaches field validation, not MISSING_FIELDS (422 on bad fitness)', async () => {
    // Proves the body's *contents* are actually parsed: a present-but-invalid
    // field must surface its real validation error, not a spurious MISSING_FIELDS.
    const key  = generateApiKey();
    const body = JSON.stringify({
      genome: validGenome(), martian_type: 'compute', fitness: 1.5,
      leaderboard_name: 'TESTBOTA', run_metadata: {},
    });
    const { status, body: resBody } = await chunkedPost('/v1/genomes', body,
      { Authorization: `Bearer ${key}` });
    expect(status).toBe(422);
    expect((resBody as { error: { code: string } }).error.code).toBe('INVALID_FITNESS_RANGE');
  });

  it('genuinely-empty CHUNKED body still reads as {} → 400 MISSING_FIELDS', async () => {
    const key = generateApiKey();
    const { status, body: resBody } = await chunkedPost('/v1/genomes', '',
      { Authorization: `Bearer ${key}` });
    expect(status).toBe(400);
    expect((resBody as { error: { code: string } }).error.code).toBe('MISSING_FIELDS');
  });

  it('non-object JSON body (array) is rejected as MALFORMED_REQUEST (400)', async () => {
    const key = generateApiKey();
    const { status, body: resBody } = await chunkedPost('/v1/genomes', '[1,2,3]',
      { Authorization: `Bearer ${key}` });
    expect(status).toBe(400);
    expect((resBody as { error: { code: string } }).error.code).toBe('MALFORMED_REQUEST');
  });

  it('regression guard: normal fetch POST (Content-Length set) still works → 201', async () => {
    // fetch sets Content-Length itself; this is the common, non-chunked path.
    const key = generateApiKey();
    const res = await fetch(`${floorBase}/v1/genomes`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body:    JSON.stringify({
        genome: validGenome(), martian_type: 'compute', fitness: 0.7,
        leaderboard_name: 'TESTBOTA', run_metadata: {},
      }),
    });
    expect(res.status).toBe(201);
  });
});
