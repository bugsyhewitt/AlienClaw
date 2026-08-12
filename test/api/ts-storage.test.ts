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
