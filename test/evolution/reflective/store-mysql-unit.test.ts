/**
 * MySQLEvolutionStore — unit tests using a mocked mysql2/promise pool.
 *
 * Covers 5 cold branch IDs (bids 7, 14, 15, 16, 19) that are unreachable via
 * the integration test file (store.test.ts) because describeIfDb resolves to
 * describe.skip when ALIENCLAW_TEST_DB_URL is unset.
 *
 * PKT-348: primary target is L174 cycle-detection guard (bid 14).
 */
import { vi, describe, it, expect, afterEach } from 'vitest';

vi.mock('mysql2/promise', () => ({
  default: { createPool: vi.fn() },
}));

import mysql from 'mysql2/promise';
import { MySQLEvolutionStore } from '../../../src/alienclaw/evolution/reflective/store.js';

function makePool(queryMap: Record<string, mysql.RowDataPacket[]>) {
  return {
    execute: vi.fn((_sql: string, params?: unknown[]) => {
      const id = (params as string[] | undefined)?.[0] ?? '';
      return Promise.resolve([queryMap[id] ?? []]);
    }),
  };
}

describe('MySQLEvolutionStore — unit (mocked pool)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lineageLessons cycle-detection (L174 bid-14 arm-0): halts on cyclic parent chain', async () => {
    // g1 -> g2 -> g1 forms a cycle in re_lineage
    const pool = makePool({
      'g1': [{ parent_id: 'g2', lesson: 'lesson-1' } as mysql.RowDataPacket],
      'g2': [{ parent_id: 'g1', lesson: 'lesson-2' } as mysql.RowDataPacket],
    });
    const store = new MySQLEvolutionStore(pool as unknown as mysql.Pool);
    const lessons = await store.lineageLessons('g1');
    // Must return both unique lessons and NOT hang
    expect(lessons).toHaveLength(2);
    expect(lessons).toContain('lesson-1');
    expect(lessons).toContain('lesson-2');
    // Cycle guard fires on the 3rd while-iteration BEFORE execute is called:
    // execute is called exactly twice (g1 then g2; g1 again hits visited → break).
    expect(pool.execute).toHaveBeenCalledTimes(2);
  });

  it('lineageLessons no-lineage (L182 bid-15 arm-0): returns [] when genome has no edge', async () => {
    const pool = makePool({ 'orphan': [] });
    const store = new MySQLEvolutionStore(pool as unknown as mysql.Pool);
    const lessons = await store.lineageLessons('orphan');
    expect(lessons).toEqual([]);
  });

  it('lineageLessons lesson dedup (L184 bid-16 arm-0): skips repeated lesson across chain', async () => {
    const pool = makePool({
      'g3': [{ parent_id: 'g2', lesson: 'dup-lesson' } as mysql.RowDataPacket],
      'g2': [{ parent_id: 'g1', lesson: 'dup-lesson' } as mysql.RowDataPacket],
      'g1': [{ parent_id: null,  lesson: 'root-lesson' } as mysql.RowDataPacket],
    });
    const store = new MySQLEvolutionStore(pool as unknown as mysql.Pool);
    const lessons = await store.lineageLessons('g3');
    expect(lessons).toEqual(['dup-lesson', 'root-lesson']); // deduped
  });

  it('getGenome not-found (L137 bid-7 arm-0): throws with genome id in message', async () => {
    const pool = { execute: vi.fn().mockResolvedValue([[/* empty rows */]]) };
    const store = new MySQLEvolutionStore(pool as unknown as mysql.Pool);
    await expect(store.getGenome('missing-id')).rejects.toThrow('Genome not found: missing-id');
  });

  it('loadRun empty frontier (L222 bid-19 arm-1): returns best:null', async () => {
    const pool = { execute: vi.fn().mockResolvedValue([[/* no snapshot rows */]]) };
    const store = new MySQLEvolutionStore(pool as unknown as mysql.Pool);
    const result = await store.loadRun('any-handle');
    expect(result.best).toBeNull();
    expect(result.frontier).toEqual([]);
  });
});
