/**
 * Integration tests for the TypeScript leaderboard API.
 * Verifies behavioral equivalence with the Python original (Packet 31.5).
 *
 * Same test cases as test/api/test_api_server.py — identical inputs,
 * identical expected outputs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { configure, createApiServer } from '../../src/alienclaw/api/server.js';
import { generateApiKey } from '../../src/alienclaw/api/auth.js';
import { validateLeaderboardName } from '../../src/alienclaw/api/validation.js';
import { computeChecksum } from '../../src/alienclaw/registry/genome-codec.js';
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
  // Deterministic 256-char Base62 genome with a *valid* checksum.
  // The first 192 chars (sections 0-2) are generated from a fixed seed; the
  // trailing 64 chars are the real computeChecksum() over that body, so the
  // genome passes the server's checksum step (closed forgery gap, Packet 31.5).
  const alpha = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let body = '';
  let seed = 42;
  for (let i = 0; i < 192; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    body += alpha[seed % 62];
  }
  return body + computeChecksum(body);
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
