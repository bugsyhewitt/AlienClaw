/**
 * PKT-491 — /v1/genomes/top router prefix over-match regression tests.
 *
 * Verifies that `path.startsWith('/v1/genomes/top')` over-match is fixed:
 * only `/v1/genomes/top` (exact) routes to handleTopGenomes; all paths
 * with extra characters after "top" (e.g. /topology, /topsecret) must
 * return 404 NOT_FOUND.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { AddressInfo } from 'node:net';

let server: Server;
let base = '';

beforeAll(async () => {
  vi.resetModules();

  process.env['ALIENCLAW_DB_URL'] = 'mysql://mock:mock@127.0.0.1:0/mock';

  vi.doMock('../../src/alienclaw/api/storage.js', () => ({
    InstallStore: class {
      async register(): Promise<[string, boolean]> { return ['i', true]; }
      async exists(): Promise<boolean> { return true; }
      async count(): Promise<number> { return 0; }
    },
    SubmissionStore: class {
      async save(): Promise<[string, string]> { return ['s', new Date().toISOString()]; }
      async topForType(): Promise<unknown[]> { return []; }
      async countForType(): Promise<number> { return 0; }
      async rankForFitness(): Promise<number> { return 1; }
      async isNewTop(): Promise<boolean> { return true; }
      async findDuplicate(): Promise<null> { return null; }
    },
    GlobalStats: class {
      async get(): Promise<unknown> { return {}; }
    },
    initPool: () => ({}),
  }));

  const { createApiServer } = await import('../../src/alienclaw/api/server.js');
  server = await createApiServer(0, '127.0.0.1');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>(r => server.close(() => r()));
  vi.doUnmock('../../src/alienclaw/api/storage.js');
  vi.resetModules();
});

describe('API server — /v1/genomes/top exact-path routing (PKT-491)', () => {
  it('GET /v1/genomes/topology returns 404 NOT_FOUND (no silent dispatch)', async () => {
    const res = await fetch(`${base}/v1/genomes/topology?martian_type=compute&n=10`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('GET /v1/genomes/topsecret returns 404 NOT_FOUND', async () => {
    const res = await fetch(`${base}/v1/genomes/topsecret?martian_type=compute`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('GET /v1/genomes/topsecret/anything returns 404 NOT_FOUND', async () => {
    const res = await fetch(`${base}/v1/genomes/topsecret/anything`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('GET /v1/genomes/topologyx returns 404 NOT_FOUND', async () => {
    const res = await fetch(`${base}/v1/genomes/topologyx`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('GET /v1/genomes/top (control, exact) still returns 200 with martian_type=compute', async () => {
    const res = await fetch(`${base}/v1/genomes/top?martian_type=compute&n=5`);
    expect(res.status).toBe(200);
  });

  it('GET /v1/genomes/top/ (trailing slash stripped to exact) still returns 200', async () => {
    const res = await fetch(`${base}/v1/genomes/top/?martian_type=compute&n=5`);
    expect(res.status).toBe(200);
  });
});
