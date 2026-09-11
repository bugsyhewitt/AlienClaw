/**
 * Probe for PKT-1116: GET / index route in api/server.ts returns a stale
 * hardcoded `version: '1.0.0'` even though PR #594 specifically fixed the
 * same stale-value bug in api/handlers/health.ts by sourcing the version
 * from package.json via readVersion().
 *
 * The index route was added by PR #593 (T4 — "GET / index route") and was
 * not updated by PR #594. This is a missed-mirror-fix.
 *
 * Mirrors the mock-storage pattern from
 * test/api/ts-api-server-route-handler-defensive-paths.test.ts so the
 * probe runs DB-free.
 *
 * RED on unmodified HEAD c52b98b5:
 *   R-001 fails because version === '1.0.0' (stale), not the real 2026.4.10
 *   R-002 fails because version does not match the calendar-version pattern
 *   R-003 (control) passes — confirms the route is reachable
 *
 * GREEN on the §B fix (one-line replacement of '1.0.0' with readVersion()):
 *   all 3 tests pass.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let server: Server;
let base = '';
let dataRoot = '';

beforeAll(async () => {
  dataRoot = mkdtempSync(join(tmpdir(), 'alienclaw-1116-'));

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
      async get(): Promise<unknown> {
        return { total_genomes: 0, total_installs: 0, total_fitness_evaluations: 0, top_fitness_by_type: {} };
      }
    }
    const initPool = (): unknown => ({});
    return { InstallStore, SubmissionStore, GlobalStats, initPool };
  });

  vi.doMock('../../src/alienclaw/api/rate-limit.js', () => {
    class RateLimiter { check(): [boolean, number] { return [true, 0]; } }
    class IpRateLimiter {
      checkRead(): [boolean, number] { return [true, 0]; }
      checkSubmit(): [boolean, number] { return [true, 0]; }
    }
    return { RateLimiter, IpRateLimiter };
  });

  vi.doMock('../../src/alienclaw/api/handlers/genomes.js', () => {
    return {
      handleSubmitGenome: async (): Promise<[number, unknown]> =>
        [201, { submission_id: 'sub-mock-id', submitted_at: '2026-01-01T00:00:00.000Z', rank: 1 }],
      handleTopGenomes: async (): Promise<[number, unknown]> =>
        [200, { martian_type: 'compute', entries: [] }],
      clampTopN: (n: number): number => Math.max(1, Math.min(100, Math.floor(n) || 10)),
    };
  });

  const mod = await import('../../src/alienclaw/api/server.js');
  mod.configure({ dbUrl: 'mysql://mock-not-used', dataRoot });
  server = await mod.createApiServer(0, '127.0.0.1');
  const addr = server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  server?.close();
  vi.doUnmock('../../src/alienclaw/api/storage.js');
  vi.doUnmock('../../src/alienclaw/api/rate-limit.js');
  vi.doUnmock('../../src/alienclaw/api/handlers/genomes.js');
  vi.resetModules();
  if (dataRoot) rmSync(dataRoot, { recursive: true, force: true });
});

function get(url: string): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = require('node:http').get({
      hostname: u.hostname,
      port:     u.port,
      path:     u.pathname,
      headers:  { 'accept': 'application/json' },
    }, (res: any) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end',  () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try { resolve({ status: res.statusCode, body: JSON.parse(text) }); }
        catch { resolve({ status: res.statusCode, body: { _raw: text } }); }
      });
    });
    req.on('error', reject);
  });
}

describe('GET / index route — PKT-1116 (stale hardcoded 1.0.0 version)', () => {
  it('R-001 BUG-CONFIRMED: version is NOT the hardcoded "1.0.0" (real package.json value)', async () => {
    const { status, body } = await get(`${base}/`);
    expect(status).toBe(200);
    expect(body['version']).not.toBe('1.0.0');
  });

  it('R-002 BUG-CONFIRMED: version matches the calendar-version pattern (YYYY.M.P)', async () => {
    const { status, body } = await get(`${base}/`);
    expect(status).toBe(200);
    expect(body['version']).toMatch(/^\d{4}\.\d+\.\d+$/);
  });

  it('R-003 CONTROL: route is reachable and returns the expected envelope shape', async () => {
    const { status, body } = await get(`${base}/`);
    expect(status).toBe(200);
    expect(body['service']).toBe('alienclaw-api');
    expect(Array.isArray(body['routes'])).toBe(true);
    expect((body['routes'] as unknown[]).length).toBeGreaterThan(0);
  });
});
