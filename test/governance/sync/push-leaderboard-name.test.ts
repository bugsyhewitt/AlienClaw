/**
 * Ship-gate for the community sync push path.
 *
 * Regression target: NetworkAPIClient.submitGenome used to POST only
 * {genome, martian_type, fitness, run_metadata}, omitting the
 * `leaderboard_name` that the deployed server (POST /v1/genomes) hard-requires.
 * Every genome the SyncScheduler pushed came back 400 MISSING_FIELDS, so the
 * community genome network propagated nothing.
 *
 * This suite proves the fix two ways:
 *
 *   1. INTEGRATION (real createApiServer + MySQL): pushTopGenomes drives the
 *      actual API server over HTTP. A valid local population entry yields a
 *      201 (pushed=1), NOT a 400 MISSING_FIELDS. Requires ALIENCLAW_TEST_DB_URL
 *      (CI provides a MySQL service container); skipped when absent — exactly
 *      like the sibling test/api/*.test.ts suites.
 *
 *   2. UNIT (in-process capture server, always runs): a throwaway node:http
 *      server records the exact POST body pushTopGenomes sends and confirms
 *      `leaderboard_name` is present and well-formed. This pins the fix even
 *      where no database is available, and covers name-resolution precedence
 *      and the skip-on-missing-name branch.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { configure, createApiServer } from '../../../src/alienclaw/api/server.js';
import { generateApiKey } from '../../../src/alienclaw/api/auth.js';
import { initPool } from '../../../src/alienclaw/api/storage.js';
import { NetworkAPIClient } from '../../../src/alienclaw/governance/common/sync/client.js';
import {
  pushTopGenomes,
  resolveLeaderboardName,
} from '../../../src/alienclaw/governance/common/sync/push.js';
import { DEFAULT_LEADERBOARD_NAME } from '../../../src/alienclaw/governance/common/sync/scheduler.js';

import { computeChecksum } from '../../../src/alienclaw/registry/genome-codec.js';

const TEST_DB_URL = process.env['ALIENCLAW_TEST_DB_URL'];
const dbDescribe = TEST_DB_URL ? describe : describe.skip;

// ── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Deterministic, CHECKSUM-VALID 256-char Base62 genome. Produces a 192-char
 * Base62 body (sections 0-2) seeded from `seed`, then appends the FNV-dual-hash
 * checksum (section 3) computed from that body. The body is unique per seed,
 * so callers that distinguish genomes by value (e.g. the top-genomes
 * read-back assertion in test 2) still get a fresh, findable entry. The
 * checksum step is required because the deployed API server (and PR #37's
 * `validateSubmission` step 3) rejects any 256-char genome whose trailing
 * 64-char CHECKSUM section does not match the FNV-dual-hash of sections 0-2 —
 * a forged/tampered genome (or a naive 'A'.repeat(256) / random-Base62
 * generator) is refused with INVALID_GENOME_CHECKSUM.
 */
function validGenome(seed = 42): string {
  const alpha = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const bodyLen = 192;
  let body = '';
  let s = seed >>> 0;
  for (let i = 0; i < bodyLen; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    body += alpha[s % 62];
  }
  return body + computeChecksum(body);
}

/**
 * Write a single population entry to <root>/<martianType>/<name>.json and
 * return the populations root. Mirrors the on-disk shape _loadTopEntries reads.
 */
function seedPopulation(
  martianType: string,
  entry: { genome: string; fitness: number; run_metadata?: Record<string, unknown> },
  fileName = 'entry.json',
): string {
  const root = mkdtempSync(join(tmpdir(), 'aclaw-pop-'));
  const typeDir = join(root, martianType);
  mkdirSync(typeDir, { recursive: true });
  writeFileSync(join(typeDir, fileName), JSON.stringify(entry), 'utf8');
  return root;
}

// ── 1. Integration: pushTopGenomes against the real API server ────────────────

dbDescribe('sync push → real createApiServer', () => {
  let server: Server;
  let base = '';
  const roots: string[] = [];

  beforeEach(async () => {
    // Clean tables so each test starts empty (isolation from other DB suites).
    const pool = initPool(TEST_DB_URL!);
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
    while (roots.length) {
      try { rmSync(roots.pop()!, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  });

  async function registeredClient(): Promise<NetworkAPIClient> {
    const key = generateApiKey();
    const client = new NetworkAPIClient(base, key);
    const r = await client.install('c'.repeat(64));
    expect(r.ok).toBe(true);
    return client;
  }

  it('pushes a valid local entry and gets 201 (not 400 MISSING_FIELDS)', async () => {
    const client = await registeredClient();
    const root = seedPopulation('compute', { genome: validGenome(), fitness: 0.85 });
    roots.push(root);

    const results = await pushTopGenomes(client, root, 'ALIENBOT', 5);

    expect(results).toHaveLength(1);
    const compute = results[0]!;
    expect(compute.martianType).toBe('compute');
    // The bug manifested as MISSING_FIELDS in errors and pushed=0.
    expect(compute.errors).toEqual([]);
    expect(compute.errors.join(' ')).not.toContain('MISSING_FIELDS');
    expect(compute.pushed).toBe(1);   // 201 — a brand-new submission landed
    expect(compute.skipped).toBe(0);
  });

  it('persists the pushed genome with its board name (server now accepts it)', async () => {
    const client = await registeredClient();
    const genome = validGenome(7);
    const root = seedPopulation('compute', {
      genome,
      fitness: 0.91,
      run_metadata: { leaderboard_name: 'METABOTX', generation: 4 },
    });
    roots.push(root);

    const results = await pushTopGenomes(client, root, 'ALIENBOT', 5);
    expect(results[0]!.pushed).toBe(1);
    expect(results[0]!.errors).toEqual([]);

    // Read it back through the public top-genomes endpoint: the per-entry name
    // from run_metadata wins over the install default, and the genome is live.
    const top = await client.topGenomes('compute', 5);
    expect(top.ok).toBe(true);
    if (top.ok) {
      expect(top.data.genomes.length).toBeGreaterThan(0);
      const hit = top.data.genomes.find(g => g.genome === genome);
      expect(hit).toBeDefined();
      expect((hit as unknown as { leaderboard_name: string }).leaderboard_name).toBe('METABOTX');
    }
  });

  it('a raw nameless POST still 400s — proving the field is genuinely required', async () => {
    // Guards against the gate passing for the wrong reason: if the server had
    // silently stopped requiring leaderboard_name, the original bug would not
    // have existed. Confirm the server still rejects a body without it.
    const key = generateApiKey();
    const client = new NetworkAPIClient(base, key);
    await client.install('d'.repeat(64));

    const res = await fetch(`${base}/v1/genomes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ genome: validGenome(), martian_type: 'compute', fitness: 0.5 }),
    });
    const body = await res.json() as { error: { code: string } };
    expect(res.status).toBe(400);
    expect(body.error.code).toBe('MISSING_FIELDS');
  });
});

// ── 2. Unit: request-body capture (always runs, no database) ──────────────────

describe('sync push → request body carries leaderboard_name (no DB)', () => {
  let server: Server;
  let base = '';
  const captured: Array<Record<string, unknown>> = [];
  const roots: string[] = [];

  beforeEach(async () => {
    captured.length = 0;
    // Minimal API stand-in that records POST /v1/genomes bodies and mimics the
    // server contract: 400 MISSING_FIELDS when leaderboard_name is absent,
    // 201 otherwise. No MySQL involved.
    server = createServer((req, res) => {
      if (req.method === 'POST' && (req.url ?? '').startsWith('/v1/genomes')) {
        const chunks: Buffer[] = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
          let body: Record<string, unknown> = {};
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* keep {} */ }
          captured.push(body);
          const required = ['genome', 'martian_type', 'fitness', 'leaderboard_name'];
          const missing = required.filter(f => !(f in body));
          if (missing.length) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { code: 'MISSING_FIELDS', message: 'missing', details: { missing } } }));
            return;
          }
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ submission_id: 'sub_test', rank: 1, is_new_top: true }));
        });
        return;
      }
      // /v1/install and anything else: 200 OK
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'registered', install_id: 'i', rate_limit: { submissions_per_hour: 100 } }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as AddressInfo;
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(() => {
    server?.close();
    while (roots.length) {
      try { rmSync(roots.pop()!, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  });

  it('includes a valid leaderboard_name in the POST body (fix for the 400 bug)', async () => {
    const client = new NetworkAPIClient(base, generateApiKey());
    const root = seedPopulation('compute', { genome: validGenome(), fitness: 0.7 });
    roots.push(root);

    const results = await pushTopGenomes(client, root, 'ALIENBOT', 5);

    expect(results[0]!.pushed).toBe(1);
    expect(results[0]!.errors).toEqual([]);
    expect(captured).toHaveLength(1);
    const sent = captured[0]!;
    expect(sent).toHaveProperty('leaderboard_name');
    expect(sent['leaderboard_name']).toBe('ALIENBOT');
    expect(typeof sent['leaderboard_name']).toBe('string');
    expect(/^[A-Z]{8}$/.test(sent['leaderboard_name'] as string)).toBe(true);
    // Original payload fields are preserved.
    expect(sent['martian_type']).toBe('compute');
    expect(sent['fitness']).toBe(0.7);
  });

  it('prefers run_metadata.leaderboard_name over the install default', async () => {
    const client = new NetworkAPIClient(base, generateApiKey());
    const root = seedPopulation('compute', {
      genome: validGenome(3),
      fitness: 0.8,
      run_metadata: { leaderboard_name: 'OVERRIDE' },
    });
    roots.push(root);

    await pushTopGenomes(client, root, 'ALIENBOT', 5);

    expect(captured).toHaveLength(1);
    expect(captured[0]!['leaderboard_name']).toBe('OVERRIDE');
  });

  it('falls back to the install default when run_metadata has no valid name', async () => {
    const client = new NetworkAPIClient(base, generateApiKey());
    const root = seedPopulation('compute', {
      genome: validGenome(5),
      fitness: 0.6,
      run_metadata: { leaderboard_name: 'too-low' }, // invalid → ignored
    });
    roots.push(root);

    await pushTopGenomes(client, root, 'FALLBACK', 5);

    expect(captured).toHaveLength(1);
    expect(captured[0]!['leaderboard_name']).toBe('FALLBACK');
  });

  it('skips an entry (sends nothing) when no valid name can be resolved', async () => {
    const client = new NetworkAPIClient(base, generateApiKey());
    const root = seedPopulation('compute', { genome: validGenome(9), fitness: 0.5 });
    roots.push(root);

    // Empty default is invalid (^[A-Z]{8}$ fails) → entry has no resolvable name.
    const results = await pushTopGenomes(client, root, '', 5);

    expect(captured).toHaveLength(0);           // no guaranteed-400 request emitted
    expect(results[0]!.pushed).toBe(0);
    expect(results[0]!.errors.join(' ')).toContain('Missing leaderboard_name');
  });
});

// ── 3. resolveLeaderboardName precedence (pure unit) ──────────────────────────

describe('resolveLeaderboardName', () => {
  it('returns the metadata name when valid', () => {
    expect(resolveLeaderboardName({ leaderboard_name: 'GOODNAME' }, 'FALLBACK')).toBe('GOODNAME');
  });
  it('returns the fallback when metadata name is missing', () => {
    expect(resolveLeaderboardName({}, 'FALLBACK')).toBe('FALLBACK');
  });
  it('returns the fallback when metadata name is invalid', () => {
    expect(resolveLeaderboardName({ leaderboard_name: 'bad' }, 'FALLBACK')).toBe('FALLBACK');
    expect(resolveLeaderboardName({ leaderboard_name: 'TOOLONGGG' }, 'FALLBACK')).toBe('FALLBACK');
    expect(resolveLeaderboardName({ leaderboard_name: 'HAS1DIGT' }, 'FALLBACK')).toBe('FALLBACK');
  });
  it('returns null when neither source is valid', () => {
    expect(resolveLeaderboardName({ leaderboard_name: 'bad' }, '')).toBeNull();
    expect(resolveLeaderboardName({}, 'lowercase')).toBeNull();
  });
  it('the shipped default handle is itself valid', () => {
    expect(/^[A-Z]{8}$/.test(DEFAULT_LEADERBOARD_NAME)).toBe(true);
  });
});
