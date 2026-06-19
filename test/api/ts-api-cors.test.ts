/**
 * CORS / preflight ship-gate for the AlienClaw community API.
 *
 * Browser frontends (the site/ dir and leaderboard.html) call api.alienclaw.net
 * from a different origin, so every non-simple request triggers a CORS preflight
 * (OPTIONS). Before this change, the router had no OPTIONS handler (preflight fell
 * through to a bare 405) and POST responses carried no Access-Control-Allow-Origin
 * header — so any web client was blocked even when the server processed the request.
 *
 * These tests assert, WITHOUT requiring a database:
 *   - OPTIONS /v1/genomes returns 204 with Access-Control-Allow-Origin and
 *     Access-Control-Allow-Methods headers.
 *   - A POST /v1/install response includes the CORS origin header.
 *
 * DB independence: createApiServer() does not open a DB pool (configure() does).
 * The POST cases below exercise error paths that return BEFORE any storage call
 * (malformed JSON / missing fields), so they run with no MySQL configured. A
 * success-path POST test is included but gated on ALIENCLAW_TEST_DB_URL.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer, configure } from '../../src/alienclaw/api/server.js';
import { generateApiKey } from '../../src/alienclaw/api/auth.js';
import { initPool } from '../../src/alienclaw/api/storage.js';

// ── Fixture: a server with NO database configured ────────────────────────────
// createApiServer wires its request handler against module-level stores that are
// only *used* (and only then throw) when a route reaches storage. CORS handling
// and the error paths tested here never reach storage, so no DB is needed.

let server: Server;
let base = '';

beforeAll(async () => {
  server = await createApiServer(0, '127.0.0.1');
  const addr = server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

// ── Preflight (OPTIONS) ──────────────────────────────────────────────────────

describe('CORS preflight (OPTIONS)', () => {
  it('OPTIONS /v1/genomes returns 204 with Access-Control-Allow-Origin and -Methods', async () => {
    const res = await fetch(`${base}/v1/genomes`, { method: 'OPTIONS' });

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');

    const methods = res.headers.get('access-control-allow-methods');
    expect(methods).toBeTruthy();
    expect(methods).toContain('POST');
    expect(methods).toContain('OPTIONS');
    expect(methods).toContain('GET');
  });

  it('OPTIONS /v1/genomes advertises the Authorization request header', async () => {
    // The genome submission route requires a Bearer token, so the preflight must
    // whitelist the Authorization header or browsers will block the real request.
    const res = await fetch(`${base}/v1/genomes`, { method: 'OPTIONS' });
    const allowHeaders = res.headers.get('access-control-allow-headers') ?? '';
    expect(allowHeaders).toMatch(/authorization/i);
    expect(allowHeaders).toMatch(/content-type/i);
  });

  it('OPTIONS preflight sets a Max-Age so browsers cache it', async () => {
    const res = await fetch(`${base}/v1/genomes`, { method: 'OPTIONS' });
    const maxAge = res.headers.get('access-control-max-age');
    expect(maxAge).toBeTruthy();
    expect(Number(maxAge)).toBeGreaterThan(0);
  });

  it('OPTIONS /v1/install returns 204 with CORS headers', async () => {
    const res = await fetch(`${base}/v1/install`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('OPTIONS preflight has an empty body (204 No Content)', async () => {
    const res = await fetch(`${base}/v1/genomes`, { method: 'OPTIONS' });
    const text = await res.text();
    expect(text).toBe('');
  });

  it('OPTIONS to an unknown path is still answered with a preflight (permissive CORS)', async () => {
    const res = await fetch(`${base}/v1/does-not-exist`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});

// ── POST responses carry the CORS origin header (DB-free error paths) ─────────

describe('CORS headers on POST responses', () => {
  it('POST /v1/install response includes the CORS origin header (malformed body)', async () => {
    // Malformed JSON returns 400 before any storage access — no DB required.
    const res = await fetch(`${base}/v1/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ not json',
    });
    expect(res.status).toBe(400);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('POST /v1/install response includes the CORS origin header (missing fields)', async () => {
    // Missing required fields returns 400 before any storage access — no DB required.
    const res = await fetch(`${base}/v1/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('MISSING_FIELDS');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('POST /v1/genomes auth failure still carries the CORS origin header', async () => {
    // No Authorization header → 401 from authBearer before any storage access.
    const res = await fetch(`${base}/v1/genomes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ genome: 'x' }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('POST to an unknown path returns 404 with the CORS origin header', async () => {
    const res = await fetch(`${base}/v1/unknown-route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});

// ── GET responses keep their CORS origin header (regression guard) ────────────

describe('CORS headers on GET responses (regression)', () => {
  it('GET /v1/health carries the CORS origin header', async () => {
    const res = await fetch(`${base}/v1/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('GET /v1/genomes/top without martian_type returns 400 with the CORS origin header', async () => {
    const res = await fetch(`${base}/v1/genomes/top`);
    expect(res.status).toBe(400);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});

// ── Unsupported methods get a CORS-enabled 405 ───────────────────────────────

describe('CORS on unsupported methods', () => {
  it('DELETE /v1/genomes returns 405 with CORS origin and Allow headers', async () => {
    const res = await fetch(`${base}/v1/genomes`, { method: 'DELETE' });
    expect(res.status).toBe(405);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('allow')).toContain('POST');
  });
});

// ── Success-path POST (DB-gated) ─────────────────────────────────────────────
// Confirms the CORS header is present on a real 2xx install response, not only
// on error paths. Skipped automatically when no test database is configured.

const TEST_DB_URL = process.env['ALIENCLAW_TEST_DB_URL'];
const dbDescribe = TEST_DB_URL ? describe : describe.skip;

dbDescribe('CORS on POST success path (requires DB)', () => {
  let dbServer: Server;
  let dbBase = '';

  beforeAll(async () => {
    const pool = initPool(TEST_DB_URL);
    await pool.execute('DELETE FROM installs');
    await pool.end();
    configure({ dbUrl: TEST_DB_URL });
    dbServer = await createApiServer(0, '127.0.0.1');
    const addr = dbServer.address() as AddressInfo;
    dbBase = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => dbServer.close(() => resolve()));
  });

  it('POST /v1/install 201 success carries the CORS origin header', async () => {
    const res = await fetch(`${dbBase}/v1/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: generateApiKey(), machine_hash: 'd'.repeat(64) }),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});
