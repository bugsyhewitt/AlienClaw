/**
 * api-handlers.test.ts — unit tests for the 6 production handler exports in
 * src/alienclaw/api/handlers/. The handlers are pure functions (modulo async);
 * the only I/O dependency is the SubmissionStore/InstallStore/GlobalStats
 * classes, which are imported as TYPE-only in the handler files, so duck-typed
 * fakes (no DB connection required) work cleanly.
 *
 * Coverage matrix (6 exports across 5 files):
 *   genomes.ts       — handleSubmitGenome (line 8), handleTopGenomes (line 78)
 *   install.ts       — handleInstall (line 6)
 *   health.ts        — handleHealth (line 6)
 *   stats.ts         — handleStats (line 4)
 *   martian-types.ts — handleMartianTypes (line 4)
 *
 * Packet 054.
 */
import { describe, it, expect } from 'vitest';
import { handleSubmitGenome, handleTopGenomes } from '../../src/alienclaw/api/handlers/genomes.js';
import { handleInstall } from '../../src/alienclaw/api/handlers/install.js';
import { handleHealth } from '../../src/alienclaw/api/handlers/health.js';
import { handleStats } from '../../src/alienclaw/api/handlers/stats.js';
import { handleMartianTypes } from '../../src/alienclaw/api/handlers/martian-types.js';
import type {
  SubmissionStore, InstallStore, GlobalStats,
} from '../../src/alienclaw/api/storage.js';

// ── Mocks ───────────────────────────────────────────────────────────────────

const FAKE_KEY_HASH = 'h'.repeat(64);
const FAKE_GENOME   = 'A'.repeat(256);

function mockSubmissionStore(overrides: Partial<SubmissionStore> = {}): SubmissionStore {
  return {
    save:          async () => ['sub_test', '2026-06-19T00:00:00Z'],
    findDuplicate: async () => null,
    isNewTop:      async () => true,
    rankForFitness: async () => 1,
    topForType:    async () => [],
    countForType:  async () => 0,
    ...overrides,
  } as unknown as SubmissionStore;
}

function mockInstallStore(overrides: Partial<InstallStore> = {}): InstallStore {
  return {
    register: async () => ['inst_test', true],
    exists:   async () => false,
    ...overrides,
  } as unknown as InstallStore;
}

function mockGlobalStats(overrides: Partial<GlobalStats> = {}): GlobalStats {
  return {
    get: async () => ({
      total_genomes: 0, total_installs: 0, total_fitness_evaluations: 0,
      top_fitness_by_type: {},
    }),
    ...overrides,
  } as unknown as GlobalStats;
}

const REG = new Set(['compute', 'http_get', 'search_text']);

function validSubmitReq(overrides: Partial<{
  martian_type: string; genome: string; fitness: number;
  leaderboard_name: string; run_metadata: Record<string, unknown>;
}> = {}) {
  return {
    martian_type: 'compute',
    genome: FAKE_GENOME,
    fitness: 0.42,
    leaderboard_name: 'MAINNNNN',
    run_metadata: {},
    ...overrides,
  };
}

// ── handleSubmitGenome (genomes.ts:8) ───────────────────────────────────────

describe('handleSubmitGenome (api/handlers/genomes.ts:8)', () => {
  it('returns 201 on valid submission with new top', async () => {
    const [s, b] = await handleSubmitGenome({
      req: validSubmitReq(), apiKeyHash: FAKE_KEY_HASH,
      store: mockSubmissionStore(), registeredTypes: REG,
    });
    expect(s).toBe(201);
    expect(b.submission_id).toBe('sub_test');
    expect(b.is_new_top).toBe(true);
    expect(b.rank).toBe(1);
  });

  it('returns 200 on duplicate within 24h window (idempotent path)', async () => {
    const [s, b] = await handleSubmitGenome({
      req: validSubmitReq(),
      apiKeyHash: FAKE_KEY_HASH,
      store: mockSubmissionStore({
        findDuplicate: async () => ({
          submission_id: 'sub_dup', submitted_at: '2026-06-18T12:00:00Z',
          genome: FAKE_GENOME, martian_type: 'compute', fitness: 0.42,
          leaderboard_name: 'MAINNNNN', api_key_hash: FAKE_KEY_HASH,
          run_metadata: {},
        }),
      }),
      registeredTypes: REG,
    });
    expect(s).toBe(200);
    expect(b.submission_id).toBe('sub_dup');
  });

  it('throws validation error on INVALID_GENOME_LENGTH (no DB calls)', async () => {
    let dbCalls = 0;
    const store = mockSubmissionStore({
      findDuplicate: async () => { dbCalls++; return null; },
    });
    await expect(handleSubmitGenome({
      req: validSubmitReq({ genome: 'A'.repeat(64) }),
      apiKeyHash: FAKE_KEY_HASH, store, registeredTypes: REG,
    })).rejects.toMatchObject({
      message: 'validation',
      apiError: { code: 'INVALID_GENOME_LENGTH' },
    });
    expect(dbCalls).toBe(0);
  });

  it('throws validation error on UNKNOWN_MARTIAN_TYPE', async () => {
    await expect(handleSubmitGenome({
      req: validSubmitReq({ martian_type: 'unknown_type' }),
      apiKeyHash: FAKE_KEY_HASH,
      store: mockSubmissionStore(),
      registeredTypes: REG,
    })).rejects.toMatchObject({
      message: 'validation',
      apiError: { code: 'UNKNOWN_MARTIAN_TYPE' },
    });
  });

  it('returns is_new_top=false when isNewTop says no', async () => {
    const [s, b] = await handleSubmitGenome({
      req: validSubmitReq({ fitness: 0.1 }),
      apiKeyHash: FAKE_KEY_HASH,
      store: mockSubmissionStore({ isNewTop: async () => false }),
      registeredTypes: REG,
    });
    expect(s).toBe(201);
    expect(b.is_new_top).toBe(false);
  });
});

// ── handleTopGenomes (genomes.ts:78) ────────────────────────────────────────

describe('handleTopGenomes (api/handlers/genomes.ts:78)', () => {
  it('returns 200 with empty list when store has no entries', async () => {
    const [s, b] = await handleTopGenomes({
      martianType: 'compute', n: 10,
      store: mockSubmissionStore(), registeredTypes: REG,
    });
    expect(s).toBe(200);
    expect(b.martian_type).toBe('compute');
    expect(b.genomes).toEqual([]);
    expect(b.total_for_type).toBe(0);
  });

  it('clamps n to [1, 100] (passes 1000 → max 100 to store)', async () => {
    let receivedN = 0;
    const store = mockSubmissionStore({
      topForType: async (_mt: string, n: number) => { receivedN = n; return []; },
    });
    await handleTopGenomes({
      martianType: 'compute', n: 1000, store, registeredTypes: REG,
    });
    expect(receivedN).toBe(100);
  });

  it('clamps n=0 to 1', async () => {
    let receivedN = 999;
    const store = mockSubmissionStore({
      topForType: async (_mt: string, n: number) => { receivedN = n; return []; },
    });
    await handleTopGenomes({
      martianType: 'compute', n: 0, store, registeredTypes: REG,
    });
    expect(receivedN).toBe(1);
  });

  it('throws UNKNOWN_MARTIAN_TYPE when type not in registered set', async () => {
    await expect(handleTopGenomes({
      martianType: 'nonexistent', n: 10,
      store: mockSubmissionStore(), registeredTypes: REG,
    })).rejects.toMatchObject({
      message: 'UNKNOWN_MARTIAN_TYPE',
      martianType: 'nonexistent',
    });
  });

  it('maps run_metadata.generation (number) to entry.generation', async () => {
    const [s, b] = await handleTopGenomes({
      martianType: 'compute', n: 10,
      store: mockSubmissionStore({
        topForType: async () => [{
          submission_id: 'sub_g', submitted_at: '2026-06-19T00:00:00Z',
          genome: FAKE_GENOME, martian_type: 'compute', fitness: 0.5,
          leaderboard_name: 'MAINNNNN', api_key_hash: FAKE_KEY_HASH,
          run_metadata: { generation: 7 },
        }],
        countForType: async () => 1,
      }),
      registeredTypes: REG,
    });
    expect(s).toBe(200);
    expect(b.genomes).toHaveLength(1);
    const g0 = b.genomes[0]?.generation;
    expect(g0).toBe(7);
  });

  it('leaves entry.generation undefined when run_metadata.generation is not a number', async () => {
    const b = await handleTopGenomes({
      martianType: 'compute', n: 10,
      store: mockSubmissionStore({
        topForType: async () => [{
          submission_id: 'sub_g', submitted_at: '2026-06-19T00:00:00Z',
          genome: FAKE_GENOME, martian_type: 'compute', fitness: 0.5,
          leaderboard_name: 'MAINNNNN', api_key_hash: FAKE_KEY_HASH,
          run_metadata: { generation: 'seven' },
        }],
        countForType: async () => 1,
      }),
      registeredTypes: REG,
    });
    const g0 = b[1].genomes[0]?.generation;
    expect(g0).toBeUndefined();
  });
});

// ── handleInstall (install.ts:6) ─────────────────────────────────────────────

describe('handleInstall (api/handlers/install.ts:6)', () => {
  function validInstall() {
    return { api_key: 'a'.repeat(43), machine_hash: 'b'.repeat(64) };
  }

  it('returns 201 + "registered" on new install', async () => {
    const [s, b] = await handleInstall(validInstall(), mockInstallStore());
    expect(s).toBe(201);
    expect((b as { status: string }).status).toBe('registered');
    expect((b as { install_id: string }).install_id).toBe('inst_test');
  });

  it('returns 200 + "known" on existing install', async () => {
    const [s, b] = await handleInstall(
      validInstall(),
      mockInstallStore({ register: async () => ['inst_old', false] }),
    );
    expect(s).toBe(200);
    expect((b as { status: string }).status).toBe('known');
  });

  it('throws on INVALID_API_KEY_FORMAT', async () => {
    await expect(handleInstall(
      { ...validInstall(), api_key: 'short' },
      mockInstallStore(),
    )).rejects.toThrow(/INVALID_API_KEY_FORMAT/);
  });

  it('throws on INVALID_MACHINE_HASH', async () => {
    await expect(handleInstall(
      { ...validInstall(), machine_hash: 'not-hex-and-wrong-length' },
      mockInstallStore(),
    )).rejects.toThrow(/INVALID_MACHINE_HASH/);
  });
});

// ── handleHealth (health.ts:6) ──────────────────────────────────────────────

describe('handleHealth (api/handlers/health.ts:6)', () => {
  it('returns 200 with status=ok, version, and uptime_seconds', () => {
    const [s, b] = handleHealth();
    expect(s).toBe(200);
    expect(b.status).toBe('ok');
    expect(b.version).toBe('1.0.0');
    expect(typeof b.uptime_seconds).toBe('number');
    expect(b.uptime_seconds).toBeGreaterThanOrEqual(0);
  });
});

// ── handleStats (stats.ts:4) ────────────────────────────────────────────────

describe('handleStats (api/handlers/stats.ts:4)', () => {
  it('returns 200 with raw stats fields', async () => {
    const [s, b] = await handleStats(mockGlobalStats({
      get: async () => ({
        total_genomes: 17, total_installs: 4, total_fitness_evaluations: 1234,
        top_fitness_by_type: { compute: 0.95 },
      }),
    }));
    expect(s).toBe(200);
    expect(b.total_genomes).toBe(17);
    expect(b.total_installs).toBe(4);
    expect(b.total_fitness_evaluations).toBe(1234);
    expect(b.top_fitness_by_type).toEqual({ compute: 0.95 });
  });
});

// ── handleMartianTypes (martian-types.ts:4) ─────────────────────────────────

describe('handleMartianTypes (api/handlers/martian-types.ts:4)', () => {
  it('returns 200 with one entry per registered type, sorted alphabetically', async () => {
    const [s, b] = await handleMartianTypes(
      new Set(['search_text', 'compute', 'http_get']),
      mockSubmissionStore({
        topForType: async (mt: string) => mt === 'compute'
          ? [{
              submission_id: 'sub_c', submitted_at: '2026-06-19T00:00:00Z',
              genome: FAKE_GENOME, martian_type: 'compute', fitness: 0.9,
              leaderboard_name: 'MAINNNNN', api_key_hash: FAKE_KEY_HASH,
              run_metadata: {},
            }]
          : [],
        countForType: async (mt: string) => mt === 'compute' ? 5 : 0,
      }),
    );
    expect(s).toBe(200);
    expect(b.total).toBe(3);
    expect(b.martian_types.map(t => t.name)).toEqual(['compute', 'http_get', 'search_text']);
    const compute = b.martian_types.find(t => t.name === 'compute');
    expect(compute?.current_top_fitness).toBe(0.9);
    expect(compute?.submission_count).toBe(5);
    expect(compute?.last_submission_at).toBe('2026-06-19T00:00:00Z');
    const empty = b.martian_types.find(t => t.name === 'http_get');
    expect(empty?.current_top_fitness).toBe(0);
    expect(empty?.submission_count).toBe(0);
    expect(empty?.last_submission_at).toBe('');
  });

  it('returns total=0 and empty list when registeredTypes is empty', async () => {
    const [s, b] = await handleMartianTypes(
      new Set(),
      mockSubmissionStore(),
    );
    expect(s).toBe(200);
    expect(b.total).toBe(0);
    expect(b.martian_types).toEqual([]);
  });
});
