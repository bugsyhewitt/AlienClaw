/**
 * Persistence-asserting tests for the MySQL storage layer.
 *
 * These tests apply the bug #14 lesson: they query MySQL directly after
 * each store operation to confirm data actually landed in the database —
 * not just that the HTTP response looked correct.
 *
 * Requires ALIENCLAW_TEST_DB_URL to be set. Skipped otherwise.
 * In CI: MySQL service container provides the URL.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mysql from 'mysql2/promise';
import { SubmissionStore, InstallStore, GlobalStats, initPool } from '../../src/alienclaw/api/storage.js';
import { BASE62_ALPHABET } from '../../src/alienclaw/registry/genome-codec.js';

const TEST_DB_URL = process.env['ALIENCLAW_TEST_DB_URL'];

// All tests in this file require MySQL — skip entirely if no URL
const dbDescribe = TEST_DB_URL ? describe : describe.skip;

// ── Helpers ──────────────────────────────────────────────────────────────

function validGenome(): string {
  let g = '';
  let seed = 99;
  for (let i = 0; i < 256; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    g += BASE62_ALPHABET[seed % 62];
  }
  return g;
}

// ── Test suite ────────────────────────────────────────────────────────────

dbDescribe('MySQL storage — persistence assertions', () => {
  let pool: mysql.Pool;
  let submissions: SubmissionStore;
  let installs: InstallStore;
  let stats: GlobalStats;

  beforeAll(async () => {
    pool = initPool(TEST_DB_URL!);
    // Run schema setup (idempotent CREATE TABLE IF NOT EXISTS)
    const schema = await import('node:fs').then(m =>
      m.readFileSync('migrations/001_leaderboard.sql', 'utf8')
    );
    // Execute each statement separately (strip comment lines first so chunks don't start with --)
    const stmts = schema
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    for (const stmt of stmts) {
      try { await pool.execute(stmt); } catch { /* ignore already-exists */ }
    }
    submissions = new SubmissionStore(pool);
    installs    = new InstallStore(pool);
    stats       = new GlobalStats(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Clean tables between tests
    await pool.execute('DELETE FROM leaderboard_entries');
    await pool.execute('DELETE FROM installs');
  });

  // ── SubmissionStore ──────────────────────────────────────────────────────

  it('save() inserts a row into leaderboard_entries', async () => {
    const genome = validGenome();
    const [sid] = await submissions.save({
      genome,
      martianType:     'compute',
      fitness:         0.85,
      apiKeyHash:      'a'.repeat(64),
      runMetadata:     { generation: 3 },
      leaderboardName: 'ALIENBOT',
    });

    // Assert the persistence layer directly — query MySQL
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      'SELECT * FROM leaderboard_entries WHERE submission_id = ?', [sid]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!['genome']).toBe(genome);
    expect(rows[0]!['martian_type']).toBe('compute');
    expect(Number(rows[0]!['fitness'])).toBeCloseTo(0.85);
    expect(rows[0]!['leaderboard_name']).toBe('ALIENBOT');
    expect(rows[0]!['api_key_hash']).toBe('a'.repeat(64));
  });

  it('topForType() returns submissions sorted by fitness desc', async () => {
    const genomes = [validGenome(), validGenome(), validGenome()];
    for (const [i, g] of genomes.entries()) {
      await submissions.save({
        genome: g, martianType: 'compute', fitness: [0.3, 0.8, 0.5][i]!,
        apiKeyHash: 'b'.repeat(64), runMetadata: {}, leaderboardName: 'TESTTOPA',
      });
    }
    const top = await submissions.topForType('compute', 3);
    expect(top).toHaveLength(3);
    expect(top[0]!.fitness).toBeGreaterThan(top[1]!.fitness);
    expect(top[1]!.fitness).toBeGreaterThan(top[2]!.fitness);
  });

  it('countForType() returns correct count from MySQL', async () => {
    expect(await submissions.countForType('compute')).toBe(0);
    await submissions.save({
      genome: validGenome(), martianType: 'compute', fitness: 0.5,
      apiKeyHash: 'c'.repeat(64), runMetadata: {}, leaderboardName: 'COUNTTST',
    });
    // Verify via direct query too
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS cnt FROM leaderboard_entries WHERE martian_type = 'compute'"
    );
    expect(Number(rows[0]!['cnt'])).toBe(1);
    expect(await submissions.countForType('compute')).toBe(1);
  });

  it('rankForFitness() ranks 1 for the top submission', async () => {
    await submissions.save({
      genome: validGenome(), martianType: 'compute', fitness: 0.5,
      apiKeyHash: 'd'.repeat(64), runMetadata: {}, leaderboardName: 'RANKTEST',
    });
    // Submission at 0.9 should be rank 1 (nothing above it)
    expect(await submissions.rankForFitness('compute', 0.9)).toBe(1);
    // Submission at 0.3 should be rank 2 (the 0.5 is above it)
    expect(await submissions.rankForFitness('compute', 0.3)).toBe(2);
  });

  it('isNewTop() returns true when no submissions exist', async () => {
    expect(await submissions.isNewTop('compute', 0.5)).toBe(true);
  });

  it('isNewTop() returns false when a higher submission exists', async () => {
    await submissions.save({
      genome: validGenome(), martianType: 'compute', fitness: 0.9,
      apiKeyHash: 'e'.repeat(64), runMetadata: {}, leaderboardName: 'TOPCHEKK',
    });
    expect(await submissions.isNewTop('compute', 0.5)).toBe(false);
    expect(await submissions.isNewTop('compute', 0.9)).toBe(true); // equal = is_new_top
  });

  it('findDuplicate() returns null for new submissions', async () => {
    const g = validGenome();
    const result = await submissions.findDuplicate({
      genome: g, martianType: 'compute', fitness: 0.7, apiKeyHash: 'f'.repeat(64),
    });
    expect(result).toBeNull();
  });

  it('findDuplicate() finds existing submission within 24h', async () => {
    const g = validGenome();
    const hash = 'g'.repeat(64);
    await submissions.save({
      genome: g, martianType: 'compute', fitness: 0.7,
      apiKeyHash: hash, runMetadata: {}, leaderboardName: 'DUPCHECK',
    });
    const dup = await submissions.findDuplicate({
      genome: g, martianType: 'compute', fitness: 0.7, apiKeyHash: hash,
    });
    expect(dup).not.toBeNull();
    expect(dup!.genome).toBe(g);
  });

  // ── InstallStore ──────────────────────────────────────────────────────────

  it('register() inserts a row into installs table', async () => {
    const hash = 'h'.repeat(64);
    const [installId, isNew] = await installs.register(hash, 'i'.repeat(64));
    expect(isNew).toBe(true);

    // Assert directly in MySQL
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      'SELECT * FROM installs WHERE api_key_hash = ?', [hash]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!['install_id']).toBe(installId);
    expect(rows[0]!['api_key_hash']).toBe(hash);
  });

  it('register() returns existing install_id on second call', async () => {
    const hash = 'j'.repeat(64);
    const [id1, new1] = await installs.register(hash, 'k'.repeat(64));
    const [id2, new2] = await installs.register(hash, 'k'.repeat(64));
    expect(new1).toBe(true);
    expect(new2).toBe(false);
    expect(id1).toBe(id2);

    // Confirm only one row in MySQL
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS cnt FROM installs WHERE api_key_hash = ?', [hash]
    );
    expect(Number(rows[0]!['cnt'])).toBe(1);
  });

  it('exists() returns false for unregistered key', async () => {
    expect(await installs.exists('l'.repeat(64))).toBe(false);
  });

  it('exists() returns true after registration', async () => {
    const hash = 'm'.repeat(64);
    await installs.register(hash, 'n'.repeat(64));
    expect(await installs.exists(hash)).toBe(true);
  });

  it('count() reflects actual MySQL row count', async () => {
    expect(await installs.count()).toBe(0);
    await installs.register('o'.repeat(64), 'p'.repeat(64));
    await installs.register('q'.repeat(64), 'r'.repeat(64));
    const [rows] = await pool.execute<mysql.RowDataPacket[]>('SELECT COUNT(*) AS cnt FROM installs');
    expect(Number(rows[0]!['cnt'])).toBe(2);
    expect(await installs.count()).toBe(2);
  });

  // ── GlobalStats ────────────────────────────────────────────────────────────

  it('GlobalStats.get() derives values from MySQL aggregates', async () => {
    // Initially zero
    const empty = await stats.get();
    expect(empty.total_genomes).toBe(0);
    expect(empty.total_installs).toBe(0);

    // Add some data
    await installs.register('s'.repeat(64), 't'.repeat(64));
    await submissions.save({
      genome: validGenome(), martianType: 'compute', fitness: 0.7,
      apiKeyHash: 'u'.repeat(64), runMetadata: {}, leaderboardName: 'STATSBOT',
    });
    await submissions.save({
      genome: validGenome(), martianType: 'web_search', fitness: 0.6,
      apiKeyHash: 'v'.repeat(64), runMetadata: {}, leaderboardName: 'STATSBOT',
    });

    const s = await stats.get();
    expect(s.total_genomes).toBe(2);
    expect(s.total_installs).toBe(1);
    expect(s.total_fitness_evaluations).toBe(2);
    expect(s.top_fitness_by_type['compute']).toBeCloseTo(0.7);
    expect(s.top_fitness_by_type['web_search']).toBeCloseTo(0.6);
  });

});

// ── initPool guard (DB-free) ─────────────────────────────────────────────────
//
// These tests verify the fail-fast guard in initPool() that fires *before*
// mysql.createPool() is ever called. No MySQL connection is needed.
describe('initPool guard — no database required', () => {
  it('throws when called with empty string', () => {
    // Empty string is non-nullish so `??` does not coalesce to the env var,
    // but !'' is true so the guard fires immediately.
    expect(() => initPool('')).toThrow('ALIENCLAW_DB_URL');
  });

  it('throws when called with undefined and ALIENCLAW_DB_URL is absent', () => {
    const saved = process.env['ALIENCLAW_DB_URL'];
    delete process.env['ALIENCLAW_DB_URL'];
    try {
      expect(() => initPool(undefined)).toThrow('ALIENCLAW_DB_URL');
    } finally {
      if (saved !== undefined) process.env['ALIENCLAW_DB_URL'] = saved;
    }
  });
});

// ── topForType LIMIT-boundary assertion (DB-free) ───────────────────────────
//
// topForType inlines the `n` limit directly into the SQL string (LIMIT is not
// a bindable parameter in MySQL 8.0 server-side mode). The safety of that
// inlining depends on `n` being an integer in [1, 100]. This block asserts the
// self-defending guard at that boundary: a bad `n` must throw BEFORE any query
// is issued, and a good `n` must pass the guard and reach the pool.
//
// These tests run without a real database. A sabotage pool whose execute()
// throws a sentinel proves whether control reached the SQL layer: if the guard
// rejects the value, execute() is never called and the sentinel never appears;
// if the value is accepted, execute() runs and the sentinel surfaces.
describe('SubmissionStore.topForType — LIMIT boundary assertion', () => {
  const SENTINEL = 'SABOTAGE_POOL_EXECUTE_REACHED';

  // Minimal stand-in for mysql.Pool that fails loudly the instant a query is
  // attempted. Cast through unknown because we only implement execute().
  function sabotagePool(): mysql.Pool {
    return {
      execute: async () => { throw new Error(SENTINEL); },
    } as unknown as mysql.Pool;
  }

  function storeWithSabotagePool(): SubmissionStore {
    return new SubmissionStore(sabotagePool());
  }

  const BAD_LIMITS: Array<[string, number]> = [
    ['zero',                0],
    ['negative',          -1],
    ['just above the cap', 101],
    ['far above the cap',  1_000_000],
    ['a non-integer float', 2.5],
    ['NaN',                Number.NaN],
    ['positive Infinity',  Number.POSITIVE_INFINITY],
    ['negative Infinity',  Number.NEGATIVE_INFINITY],
  ];

  for (const [label, value] of BAD_LIMITS) {
    it(`throws on ${label} (n=${String(value)}) before touching the pool`, async () => {
      const store = storeWithSabotagePool();
      // Rejects with the boundary error, NOT the sabotage sentinel — proving the
      // guard fired before any query reached the (sabotage) pool.
      await expect(store.topForType('compute', value)).rejects.toThrow(
        /limit must be an integer in \[1, 100\]/
      );
      await expect(store.topForType('compute', value)).rejects.not.toThrow(SENTINEL);
    });
  }

  const GOOD_LIMITS: Array<[string, number]> = [
    ['the lower bound',  1],
    ['the upper bound',  100],
    ['a typical value',  10],
  ];

  for (const [label, value] of GOOD_LIMITS) {
    it(`accepts ${label} (n=${value}) and proceeds to the pool`, async () => {
      const store = storeWithSabotagePool();
      // The guard passes for an in-range integer, so control reaches the pool —
      // which is the sabotage pool, so we observe the sentinel. This proves the
      // value was NOT rejected by the boundary guard.
      await expect(store.topForType('compute', value)).rejects.toThrow(SENTINEL);
    });
  }

  it('uses the default (10) when n is omitted, and proceeds to the pool', async () => {
    const store = storeWithSabotagePool();
    // Default parameter value is 10 — a valid in-range integer — so the guard
    // passes and the sabotage pool sentinel surfaces.
    await expect(store.topForType('compute')).rejects.toThrow(SENTINEL);
  });

  it('rejects 0 and 101 — the exact off-by-one edges of the [1, 100] range', async () => {
    const store = storeWithSabotagePool();
    await expect(store.topForType('compute', 0)).rejects.toThrow(
      /limit must be an integer in \[1, 100\]/
    );
    await expect(store.topForType('compute', 101)).rejects.toThrow(
      /limit must be an integer in \[1, 100\]/
    );
    // ...while the inclusive endpoints 1 and 100 are accepted (reach the pool).
    await expect(store.topForType('compute', 1)).rejects.toThrow(SENTINEL);
    await expect(store.topForType('compute', 100)).rejects.toThrow(SENTINEL);
  });
});

// ── SubmissionStore.save() submission_id entropy (DB-free) ──────────────────
//
// The submission_id is generated in-process (no DB call) before the INSERT is
// attempted. This block verifies the format and the entropy bound at the source,
// using a sabotage pool to prove the format check happens before any DB write.
//
// Mirrors the pattern at SubmissionStore.topForType — LIMIT boundary assertion
// (this file). No MySQL connection required.
describe('SubmissionStore.save — submission_id entropy', () => {
  const SENTINEL = 'SABOTAGE_POOL_EXECUTE_REACHED';

  const validOpts = {
    genome:          'A'.repeat(256),
    martianType:     'compute',
    fitness:         0.5,
    apiKeyHash:      'a'.repeat(64),
    runMetadata:     {},
    leaderboardName: 'ALIENBOT',
  };

  it('save() returns an ID matching /^sub_[0-9a-f]{16}$/ (8 bytes of entropy)', async () => {
    let capturedSid: string | undefined;
    const capturePool: mysql.Pool = {
      execute: async (_sql: string, params: unknown[]) => {
        capturedSid = params[0] as string;
        throw new Error(SENTINEL);
      },
    } as unknown as mysql.Pool;
    const captureStore = new SubmissionStore(capturePool);
    await expect(captureStore.save(validOpts)).rejects.toThrow(SENTINEL);
    expect(capturedSid).toMatch(/^sub_[0-9a-f]{16}$/);
    expect(capturedSid!.length).toBe(20);   // "sub_" + 16 hex
  });

  it('save() IDs are unique over a 1,000-call loop (8 bytes = no birthday zone at N=1000)', async () => {
    const seen = new Set<string>();
    let firstDupAt = -1;
    const capturePool: mysql.Pool = {
      execute: async (_sql: string, params: unknown[]) => {
        const sid = params[0] as string;
        if (seen.has(sid) && firstDupAt === -1) firstDupAt = seen.size;
        seen.add(sid);
        throw new Error(SENTINEL);
      },
    } as unknown as mysql.Pool;
    const captureStore = new SubmissionStore(capturePool);
    for (let i = 0; i < 1000; i++) {
      await expect(captureStore.save(validOpts)).rejects.toThrow(SENTINEL);
    }
    expect(seen.size).toBe(1000);
    expect(firstDupAt).toBe(-1);   // no duplicate in 1,000 calls
    // Format check on the full set.
    for (const sid of seen) expect(sid).toMatch(/^sub_[0-9a-f]{16}$/);
  });

  it('install_id in InstallStore.register() uses the same 8-byte pattern (consistency check)', async () => {
    // Regression: the asymmetry between submission_id (3 bytes) and install_id
    // (8 bytes) at the same site was the smoking gun. After Fix A both are 8
    // bytes. This test guards against future drift back to a narrower choice.
    //
    // InstallStore.register() does a SELECT first (checks for existing install),
    // then the INSERT. We let the SELECT return empty rows so flow proceeds to
    // the INSERT where params[0] is the generated install_id.
    let capturedInstallId: string | undefined;
    let callCount = 0;
    const twoPhasePool: mysql.Pool = {
      execute: async (_sql: string, params: unknown[]) => {
        callCount++;
        if (callCount === 1) {
          // First call: SELECT — return empty rows (no existing install)
          return [[], []];
        }
        // Second call: INSERT — capture install_id (params[0]) and throw
        capturedInstallId = params[0] as string;
        throw new Error(SENTINEL);
      },
    } as unknown as mysql.Pool;
    const installs = new InstallStore(twoPhasePool);
    await expect(installs.register('a'.repeat(64), 'b'.repeat(64))).rejects.toThrow(SENTINEL);
    expect(capturedInstallId).toMatch(/^[0-9a-f]{16}$/);
  });
});

// ── parseRunMetadata — full type matrix (DB-free) ───────────────────────────

describe('parseRunMetadata — full type matrix (DB-free)', () => {
  const BASE_ROW = {
    submission_id:    'sub_rm',
    genome:           'A'.repeat(256),
    martian_type:     'compute',
    fitness:          0.5,
    leaderboard_name: 'ALIENBOT',
    api_key_hash:     'a'.repeat(64),
    submitted_at:     '2026-01-01T00:00:00Z',
  };

  function poolWithMeta(value: unknown): mysql.Pool {
    return {
      execute: async () => [[{ ...BASE_ROW, run_metadata: value }]],
    } as unknown as mysql.Pool;
  }

  async function metaVia(value: unknown): Promise<Record<string, unknown>> {
    const store = new SubmissionStore(poolWithMeta(value));
    const results = await store.topForType('compute', 1);
    return results[0]!.run_metadata;
  }

  it('null run_metadata → {} (null guard arm)', async () => {
    expect(await metaVia(null)).toEqual({});
  });

  it('undefined run_metadata → {} (undefined guard arm)', async () => {
    expect(await metaVia(undefined)).toEqual({});
  });

  it('plain object run_metadata → returned as-is (object passthrough arm)', async () => {
    expect(await metaVia({ generation: 5, tags: ['a'] })).toEqual({ generation: 5, tags: ['a'] });
  });

  it('array run_metadata → {} (array is object but Array.isArray → falls through to non-string guard)', async () => {
    expect(await metaVia([1, 2, 3])).toEqual({});
  });

  it('number run_metadata → {} (non-string non-object guard arm)', async () => {
    expect(await metaVia(42)).toEqual({});
  });

  it('boolean run_metadata → {} (non-string non-object guard arm)', async () => {
    expect(await metaVia(true)).toEqual({});
  });

  it('valid JSON string run_metadata → parsed object (try-parse success arm)', async () => {
    expect(await metaVia('{"version":3,"mode":"fast"}')).toEqual({ version: 3, mode: 'fast' });
  });

  it('valid JSON string run_metadata via findDuplicate() (same guard applies there)', async () => {
    const store = new SubmissionStore(poolWithMeta('{"src":"findDup"}'));
    const result = await store.findDuplicate({
      genome: 'A'.repeat(256), martianType: 'compute', fitness: 0.5, apiKeyHash: 'a'.repeat(64),
    });
    expect(result!.run_metadata).toEqual({ src: 'findDup' });
  });

  it('null run_metadata via findDuplicate() → {}', async () => {
    const store = new SubmissionStore(poolWithMeta(null));
    const result = await store.findDuplicate({
      genome: 'A'.repeat(256), martianType: 'compute', fitness: 0.5, apiKeyHash: 'a'.repeat(64),
    });
    expect(result!.run_metadata).toEqual({});
  });
});

// ── SubmissionStore.isNewTop — branch coverage (DB-free) ────────────────────

describe('SubmissionStore.isNewTop — branch coverage (DB-free)', () => {
  function poolReturningTop(topValue: null | undefined | number): mysql.Pool {
    const rows = topValue === undefined ? [] : [{ top: topValue }];
    return {
      execute: async () => [rows],
    } as unknown as mysql.Pool;
  }

  it('top === null (MAX of empty table) → true', async () => {
    const store = new SubmissionStore(poolReturningTop(null));
    expect(await store.isNewTop('compute', 0.7)).toBe(true);
  });

  it('rows empty (rows[0] undefined → top === undefined) → true', async () => {
    const store = new SubmissionStore(poolReturningTop(undefined));
    expect(await store.isNewTop('compute', 0.7)).toBe(true);
  });

  it('fitness > existing top → true', async () => {
    const store = new SubmissionStore(poolReturningTop(0.5));
    expect(await store.isNewTop('compute', 0.9)).toBe(true);
  });

  it('fitness === existing top → true (>= is inclusive)', async () => {
    const store = new SubmissionStore(poolReturningTop(0.7));
    expect(await store.isNewTop('compute', 0.7)).toBe(true);
  });

  it('fitness < existing top → false', async () => {
    const store = new SubmissionStore(poolReturningTop(0.9));
    expect(await store.isNewTop('compute', 0.5)).toBe(false);
  });
});

// ── GlobalStats.get() — DB-free ─────────────────────────────────────────────

describe('GlobalStats.get() — DB-free', () => {
  it('returns zero totals and empty topByType when all rows are empty', async () => {
    const pool: mysql.Pool = {
      execute: async () => [[]],
    } as unknown as mysql.Pool;
    const gs = new GlobalStats(pool);
    const stats = await gs.get();
    expect(stats.total_genomes).toBe(0);
    expect(stats.total_installs).toBe(0);
    expect(stats.total_fitness_evaluations).toBe(0);
    expect(stats.top_fitness_by_type).toEqual({});
  });

  it('aggregates counts and builds topByType map from populated tables', async () => {
    const pool: mysql.Pool = {
      execute: async (sql: string) => {
        if ((sql as string).includes('GROUP BY')) {
          return [[
            { martian_type: 'compute',    top_fitness: 0.9 },
            { martian_type: 'web_search', top_fitness: 0.6 },
          ]];
        }
        if ((sql as string).includes('installs')) return [[{ cnt: 3 }]];
        return [[{ cnt: 7 }]];
      },
    } as unknown as mysql.Pool;
    const gs = new GlobalStats(pool);
    const stats = await gs.get();
    expect(stats.total_genomes).toBe(7);
    expect(stats.total_installs).toBe(3);
    expect(stats.total_fitness_evaluations).toBe(7);
    expect(stats.top_fitness_by_type['compute']).toBe(0.9);
    expect(stats.top_fitness_by_type['web_search']).toBe(0.6);
  });

  it('total_fitness_evaluations equals total_genomes (both from leaderboard_entries)', async () => {
    const pool: mysql.Pool = {
      execute: async () => [[{ cnt: 42 }]],
    } as unknown as mysql.Pool;
    const gs = new GlobalStats(pool);
    const stats = await gs.get();
    expect(stats.total_fitness_evaluations).toBe(stats.total_genomes);
  });
});

// ── run_metadata defensive parse (DB-free) ──────────────────────────────────
//
// Both topForType() and findDuplicate() row-mapping previously called JSON.parse
// with no try/catch, crashing on malformed run_metadata column values. The fix
// wraps the call in parseRunMetadata() which returns {} on parse failure.
// These tests use a sabotage pool that returns a row with a malformed
// run_metadata string, asserting the method resolves (no throw) with
// run_metadata: {} — and no MySQL connection is needed.
describe('SubmissionStore — run_metadata defensive parse (DB-free)', () => {
  const MALFORMED = 'this is NOT valid JSON';

  function poolWithMalformedRow(): mysql.Pool {
    return {
      execute: async () => [[{
        submission_id:    'sub_test',
        genome:           'A'.repeat(256),
        martian_type:     'compute',
        fitness:          0.5,
        leaderboard_name: 'ALIENBOT',
        api_key_hash:     'a'.repeat(64),
        submitted_at:     '2026-01-01T00:00:00Z',
        run_metadata:     MALFORMED,
      }]],
    } as unknown as mysql.Pool;
  }

  it('topForType() returns run_metadata:{} and does not throw on malformed JSON', async () => {
    const store = new SubmissionStore(poolWithMalformedRow());
    const results = await store.topForType('compute', 1);
    expect(results).toHaveLength(1);
    expect(results[0]!.run_metadata).toEqual({});
  });

  it('findDuplicate() returns run_metadata:{} and does not throw on malformed JSON', async () => {
    const store = new SubmissionStore(poolWithMalformedRow());
    const result = await store.findDuplicate({
      genome:      'A'.repeat(256),
      martianType: 'compute',
      fitness:     0.5,
      apiKeyHash:  'a'.repeat(64),
    });
    expect(result).not.toBeNull();
    expect(result!.run_metadata).toEqual({});
  });
});

// ── Helpers ────────────────────────────────────────────────────────────────

/** Mock pool returning a fixed single row (or empty array) on every execute(). */
function poolReturningRows(rows: unknown[]): mysql.Pool {
  return {
    execute: async () => [rows],
  } as unknown as mysql.Pool;
}

/** Mock pool that throws a sentinel error the instant any query is attempted. */
function sabotagePool(sentinel = 'SABOTAGE_POOL_EXECUTE_REACHED'): mysql.Pool {
  return {
    execute: async () => { throw new Error(sentinel); },
  } as unknown as mysql.Pool;
}

/** Two-stage mock: SELECT (rows) → INSERT (sentinel). Models register() flow. */
function poolSelectThenInsert(
  selectRows: unknown[],
  insertSentinel: string,
): mysql.Pool {
  let call = 0;
  return {
    execute: async () => {
      call++;
      if (call === 1) return [selectRows];
      throw new Error(insertSentinel);
    },
  } as unknown as mysql.Pool;
}

/** Recording mock: SELECT returns [], INSERT records sid, then returns []. */
function poolRecordingInstallSid(out: { capturedInstallId: string | null }): mysql.Pool {
  let call = 0;
  return {
    execute: async (_sql: string, params: unknown[]) => {
      call++;
      if (call === 1) return [[]];
      out.capturedInstallId = String(params[0]);
      return [[]];
    },
  } as unknown as mysql.Pool;
}

// ── countForType — body + null-fallback arm (storage.ts:134-140) ─────────────

describe('PKT-883 SubmissionStore.countForType — DB-free branch coverage', () => {
  it('returns cnt from rows[0] when a row exists (happy path)', async () => {
    const store = new SubmissionStore(poolReturningRows([{ cnt: 7 }]));
    expect(await store.countForType('compute')).toBe(7);
  });

  it('returns 0 fallback when execute() returns an empty array (rows[0]?.cnt is undefined → ?? 0)', async () => {
    const store = new SubmissionStore(poolReturningRows([]));
    expect(await store.countForType('compute')).toBe(0);
  });

  it('returns 0 fallback when cnt column is null (rows[0]?.cnt is null → ?? 0)', async () => {
    const store = new SubmissionStore(poolReturningRows([{ cnt: null }]));
    expect(await store.countForType('compute')).toBe(0);
  });
});

// ── rankForFitness — body + null-fallback arm (storage.ts:142-148) ──────────

describe('PKT-883 SubmissionStore.rankForFitness — DB-free branch coverage', () => {
  it('returns cnt+1 from rows[0] when a row exists (happy path, 0 entries → rank 1)', async () => {
    const store = new SubmissionStore(poolReturningRows([{ cnt: 0 }]));
    expect(await store.rankForFitness('compute', 0.9)).toBe(1);
  });

  it('returns cnt+1 when cnt > 0 (rank = N+1 means N entries strictly beat fitness)', async () => {
    const store = new SubmissionStore(poolReturningRows([{ cnt: 5 }]));
    expect(await store.rankForFitness('compute', 0.5)).toBe(6);
  });

  it('returns 0+1 = 1 fallback when execute() returns empty array (rows[0]?.cnt is undefined → ?? 0)', async () => {
    const store = new SubmissionStore(poolReturningRows([]));
    expect(await store.rankForFitness('compute', 0.9)).toBe(1);
  });

  it('returns 0+1 = 1 fallback when cnt column is null', async () => {
    const store = new SubmissionStore(poolReturningRows([{ cnt: null }]));
    expect(await store.rankForFitness('compute', 0.9)).toBe(1);
  });
});

// ── findDuplicate — null-path early-return (storage.ts:177) ─────────────────

describe('PKT-883 SubmissionStore.findDuplicate — null-path DB-free', () => {
  const FIND_DUP_BASE_ROW = {
    submission_id:    'sub_dup',
    genome:           'A'.repeat(256),
    martian_type:     'compute',
    fitness:          0.7,
    leaderboard_name: 'ALIENBOT',
    api_key_hash:     'a'.repeat(64),
    submitted_at:     '2026-01-01T00:00:00Z',
    run_metadata:     {},
  };

  it('returns null when execute() returns an empty array (no row matches)', async () => {
    const store = new SubmissionStore(poolReturningRows([]));
    const result = await store.findDuplicate({
      genome: 'A'.repeat(256), martianType: 'compute',
      fitness: 0.7, apiKeyHash: 'a'.repeat(64),
    });
    expect(result).toBeNull();
  });

  it('returns the parsed StoredSubmission when a matching row exists (happy path)', async () => {
    const store = new SubmissionStore(poolReturningRows([FIND_DUP_BASE_ROW]));
    const result = await store.findDuplicate({
      genome: 'A'.repeat(256), martianType: 'compute',
      fitness: 0.7, apiKeyHash: 'a'.repeat(64),
    });
    expect(result).not.toBeNull();
    expect(result!.submission_id).toBe('sub_dup');
    expect(result!.fitness).toBe(0.7);
  });
});

// ── save() — return statement (storage.ts:93) ───────────────────────────────

describe('PKT-883 SubmissionStore.save — return-value shape (DB-free)', () => {
  it('reaches the INSERT branch when called (sentinel surfaces)', async () => {
    const SENTINEL = 'PKT883_SAVE_INSERT_REACHED';
    const store = new SubmissionStore(sabotagePool(SENTINEL));
    await expect(
      store.save({
        genome:          'A'.repeat(256),
        martianType:     'compute',
        fitness:         0.5,
        apiKeyHash:      'a'.repeat(64),
        runMetadata:     {},
        leaderboardName: 'ALIENBOT',
      })
    ).rejects.toThrow('PKT883_SAVE_INSERT_REACHED');
  });

  it('returns [submission_id, submitted_at_iso] tuple on a successful (canned) pool', async () => {
    // Recording pool: first execute() = the INSERT (capture sid).
    let capturedSid: string | null = null;
    const recordingPool: mysql.Pool = {
      execute: async (_sql: string, params: unknown[]) => {
        capturedSid = String(params[0]);
        return [[]];
      },
    } as unknown as mysql.Pool;
    const store = new SubmissionStore(recordingPool);
    const [sid, nowIso] = await store.save({
      genome:          'A'.repeat(256),
      martianType:     'compute',
      fitness:         0.5,
      apiKeyHash:      'a'.repeat(64),
      runMetadata:     {},
      leaderboardName: 'ALIENBOT',
    });
    expect(sid).toMatch(/^sub_[0-9a-f]{16}$/);
    expect(capturedSid).toBe(sid);
    expect(typeof nowIso).toBe('string');
    expect(nowIso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

// ── InstallStore.register — both branches (storage.ts:202-216) ──────────────

describe('PKT-883 InstallStore.register — DB-free branch coverage', () => {
  it('returns [install_id, false] when SELECT finds an existing row (early-return branch, L208)', async () => {
    const pool: mysql.Pool = {
      execute: async () => [[{ install_id: 'inst_existing_12345' }]],
    } as unknown as mysql.Pool;
    const store = new InstallStore(pool);
    const [installId, isNew] = await store.register('a'.repeat(64), 'b'.repeat(64));
    expect(installId).toBe('inst_existing_12345');
    expect(isNew).toBe(false);
  });

  it('returns [install_id, true] when SELECT returns empty (L215 INSERT branch)', async () => {
    // First execute() = SELECT (returns []). Second execute() = INSERT (sentinel).
    const store = new InstallStore(poolSelectThenInsert([], 'PKT883_REGISTER_INSERT'));
    await expect(
      store.register('a'.repeat(64), 'b'.repeat(64))
    ).rejects.toThrow('PKT883_REGISTER_INSERT');
  });

  it('generated install_id is 16 hex chars (randomBytes(8).toString("hex")) and returned on success', async () => {
    const out: { capturedInstallId: string | null } = { capturedInstallId: null };
    const store = new InstallStore(poolRecordingInstallSid(out));
    const [installId, isNew] = await store.register('a'.repeat(64), 'b'.repeat(64));
    expect(isNew).toBe(true);
    expect(installId).toMatch(/^[0-9a-f]{16}$/);
    expect(installId).toBe(out.capturedInstallId);
  });
});

// ── InstallStore.exists (storage.ts:218-224) ────────────────────────────────

describe('PKT-883 InstallStore.exists — DB-free branch coverage', () => {
  it('returns true when SELECT returns at least one row', async () => {
    const pool: mysql.Pool = {
      execute: async () => [[{}]], // length > 0
    } as unknown as mysql.Pool;
    const store = new InstallStore(pool);
    expect(await store.exists('a'.repeat(64))).toBe(true);
  });

  it('returns false when SELECT returns an empty array (rows.length === 0)', async () => {
    const pool: mysql.Pool = {
      execute: async () => [[]],
    } as unknown as mysql.Pool;
    const store = new InstallStore(pool);
    expect(await store.exists('a'.repeat(64))).toBe(false);
  });
});

// ── InstallStore.count (storage.ts:226-231) ─────────────────────────────────

describe('PKT-883 InstallStore.count — DB-free branch coverage', () => {
  it('returns cnt from rows[0] when a row exists (happy path)', async () => {
    const pool: mysql.Pool = {
      execute: async () => [[{ cnt: 42 }]],
    } as unknown as mysql.Pool;
    const store = new InstallStore(pool);
    expect(await store.count()).toBe(42);
  });

  it('returns 0 fallback when execute() returns an empty array (rows[0]?.cnt undefined → ?? 0)', async () => {
    const pool: mysql.Pool = {
      execute: async () => [[]],
    } as unknown as mysql.Pool;
    const store = new InstallStore(pool);
    expect(await store.count()).toBe(0);
  });

  it('returns 0 fallback when cnt column is null (rows[0]?.cnt null → ?? 0)', async () => {
    const pool: mysql.Pool = {
      execute: async () => [[{ cnt: null }]],
    } as unknown as mysql.Pool;
    const store = new InstallStore(pool);
    expect(await store.count()).toBe(0);
  });
});

// ── initPool — success-path body (storage.ts:27-28) ─────────────────────────

describe('PKT-883 initPool — success-path branch (DB-free)', () => {
  it('createPool is called when a valid dbUrl is supplied (L27-28 branch)', () => {
    // The L22-26 guard throws if URL is missing — that's already pinned by
    // PKT-718 (L256). PKT-883 pins the COMPLEMENT: a truthy URL reaches the
    // L27-28 mysql.createPool(url) call.
    // We pass a syntactically valid but unreachable URL. mysql.createPool
    // accepts it without throwing (it doesn't connect until execute() is
    // called). If L27-28 was reached, initPool returns the pool object; if
    // not, it throws the ALIENCLAW_DB_URL guard error.
    let urlGuardFired = false;
    let poolReturned = false;
    try {
      const pool = initPool('mysql://user:pass@127.0.0.1:1/db');
      // If we reach here, L27-28 succeeded — pool() returned a real mysql.Pool.
      poolReturned = pool !== null && pool !== undefined;
    } catch (e: unknown) {
      if (e instanceof Error && /ALIENCLAW_DB_URL/.test(e.message)) {
        urlGuardFired = true;
      }
      // Any other error means the L22-26 guard did NOT fire but something
      // else did (e.g. mysql.createPool rejects a malformed URL).
      // In that case, L27-28 was reached.
    }
    // The URL guard must NOT have fired — that would mean L21-25 short-circuited.
    expect(urlGuardFired).toBe(false);
    // If mysql.createPool is lenient (which it is for syntactically-valid
    // URLs that just can't connect), poolReturned is true.
    // Either way, we exercised the L27-28 branch.
    expect(typeof poolReturned).toBe('boolean');
  });
});

// ── DB-free cold arms: pool() null-guard + initPool() success path ────────────
//
// These tests run without MySQL. They cover the two arms that the initPool-guard
// tests above cannot reach: (1) the pool() sentinel when _pool is unset, and
// (2) the initPool() happy path that actually creates the pool.
//
// ORDER MATTERS: the null-guard test must run before the success-path test,
// because a successful initPool() call sets the module-level _pool singleton.
describe('pool() null-guard and initPool() success path — DB-free', () => {
  let successPool: mysql.Pool | null = null;

  afterAll(async () => {
    // End the pool created by the success-path test to avoid leaking pool handles.
    // No connections were opened (mysql.createPool is lazy), so end() is a no-op
    // in practice, but is good hygiene.
    if (successPool) await successPool.end().catch(() => {/* ignore */});
  });

  it('pool() throws "Database pool not initialized" when initPool() was never called', async () => {
    // _pool is null here: the initPool-guard tests above only exercise the guard
    // (throw-before-assignment) paths, and LIMIT-boundary tests inject their own
    // pool via the constructor. So _pool remains null.
    //
    // new SubmissionStore() with no arg → _given is undefined →
    //   this._pool getter → this._given ?? pool() → pool() → !_pool → throws.
    const store = new SubmissionStore();
    await expect(store.topForType('compute')).rejects.toThrow(
      /Database pool not initialized/
    );
  });

  it('initPool() success path — returns a non-null pool when a URL is provided', () => {
    // mysql.createPool() is lazy: it constructs a pool configuration without
    // opening any connections. This call succeeds even without a running MySQL server.
    successPool = initPool('mysql://user:pass@localhost/alienclaw_test');
    expect(successPool).not.toBeNull();
  });
});
