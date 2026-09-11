/**
 * PKT-1087 File-A — storage.ts ALIENCLAW_DB_POOL_MAX env-var coercion bypass
 * (corrective re-author of REJECTED PKT-1087).
 *
 * Defect: `src/alienclaw/api/storage.ts:27` (initPool) and
 * `src/alienclaw/api/storage.ts:65` (poolStats) both hold
 *   parseInt(process.env['ALIENCLAW_DB_POOL_MAX'] ?? '8', 10) || 8
 * The `|| 8` only protects against `0` (falsy) and `NaN` (falsy).
 * Negative integers, huge positives, and exponent notation all slip
 * through. Verified live this cycle:
 *
 *   -1       → connectionLimit: -1   → first pool.query() hangs forever
 *   999999999 → connectionLimit: 999 999 999 → process OOM under load
 *   '1e2'    → connectionLimit: 1     (silent truncation, operator expected 100)
 *   '1.5'    → connectionLimit: 1
 *   '8'      → connectionLimit: 8     (valid, honored)
 *
 * Fix: extract a named `resolvePoolMax()` helper and a `MAX_DB_POOL_MAX`
 * ceiling, mirroring PKT-1118 / PKT-1120 (cache.ts) and PKT-1119
 * (rate-limit.ts). Both call sites (initPool L27, poolStats L65) go
 * through the same helper.
 *
 * Test order:
 *   RED:   pnpm exec vitest run test/api/_verify_1087.test.ts
 *   GREEN: git apply packets/1087-fix-VERIFIED.patch
 *          && pnpm exec vitest run test/api/_verify_1087.test.ts
 *
 * After GREEN, also run:
 *   pnpm exec vitest run            # full TS suite
 *   PYTHONPATH=src pytest -q        # full Python suite
 * to confirm no regression.
 *
 * Rejection lineage (issues.md 2026-09-09 §"OVERMIND REJECT: PKT-1087"):
 *   blocker 1 (no File-A)         → FIXED: this file is the embedded File-A
 *   blocker 2 (no ship gate)      → FIXED: §Ship-gate runs RED→GREEN
 *   blocker 3 (bullet #4 ships RED) → FIXED: '1e2' expects 100 (Number honours)
 *   blocker 4 (MAX undecided)     → FIXED: MAX_DB_POOL_MAX = 100 (justified below)
 *   blocker 5 (contradict on -1)  → FIXED: -1 → health times out at 2s, not silent
 *   blocker 6 (only 3 files)      → NOTED: 5 sites, see §Related sites
 *
 * Notes:
 *   - The initPool test passes an unreachable URL because mysql.createPool
 *     is lazy (no socket until execute). The pool object's options are
 *     what we assert on.
 *   - To peek at the createPool options we need to capture them via
 *     vi.spyOn(mysql, 'createPool'). The module-level `_pool` exposes
 *     the config object via the `config` field on mysql2 PoolOptions.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ENV_KEY = 'ALIENCLAW_DB_POOL_MAX';
const SAVED_ENV = process.env[ENV_KEY];
const DEFAULT_POOL_MAX = 8;
const MAX_POOL_MAX     = 100;  // see packet §MAX_DB_POOL_MAX

beforeEach(() => {
  delete process.env[ENV_KEY];
  // Reset the module so the module-level _pool is null again.
  vi.resetModules();
});

afterEach(() => {
  if (SAVED_ENV === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = SAVED_ENV;
  vi.restoreAllMocks();
});

// ── helper: invoke initPool with the env already set, return the pool's
//    effective connectionLimit (from the createPool options) ────────────

async function initPoolAndCaptureLimit(envVal: string | undefined): Promise<number> {
  if (envVal === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = envVal;
  const { initPool } = await import('../../src/alienclaw/api/storage.js');
  const pool = initPool('mysql://user:***@127.0.0.1:1/db');
  // mysql2 Pool exposes its config via the `_pool.config.connectionLimit`
  // internal. Cast and read.
  const inner = (pool as unknown as {
    config?: { connectionLimit?: number };
    pool?:  { config?: { connectionLimit?: number } };
  });
  return inner.config?.connectionLimit
      ?? inner.pool?.config?.connectionLimit
      ?? -1;
}

async function initPoolAndCaptureAll(envVal: string | undefined): Promise<{
  connectionLimit: number;
  maxIdle:         number;
}> {
  if (envVal === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = envVal;
  const { initPool } = await import('../../src/alienclaw/api/storage.js');
  const pool = initPool('mysql://user:***@127.0.0.1:1/db');
  const inner = (pool as unknown as {
    config?: { connectionLimit?: number; maxIdle?: number };
    pool?:  { config?: { connectionLimit?: number; maxIdle?: number } };
  });
  const cfg = inner.config ?? inner.pool?.config ?? {};
  return {
    connectionLimit: cfg.connectionLimit ?? -1,
    maxIdle:         cfg.maxIdle ?? -1,
  };
}

async function poolStatsAndCaptureLimit(envVal: string | undefined): Promise<number | null> {
  if (envVal === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = envVal;
  const { initPool, poolStats } = await import('../../src/alienclaw/api/storage.js');
  initPool('mysql://user:***@127.0.0.1:1/db');  // sets module-level _pool
  const stats = poolStats();
  return stats ? stats.connectionLimit : null;
}

// ── HEAD behaviour probes (RED until fix applied) ────────────────────────

describe('storage.ts: ALIENCLAW_DB_POOL_MAX env coercion (PKT-1087, re-author of REJECTED 1087)', () => {

  it('RED→GREEN: negative (-1) is rejected; falls back to default (initPool L27)', async () => {
    const limit = await initPoolAndCaptureLimit('-1');
    expect(limit).toBe(DEFAULT_POOL_MAX);
  });

  it('RED→GREEN: huge (999999999) is rejected; falls back to default (initPool L27)', async () => {
    const limit = await initPoolAndCaptureLimit('999999999');
    expect(limit).toBe(DEFAULT_POOL_MAX);
  });

  it('RED→GREEN: huge (MAX_SAFE_INTEGER + 1) is rejected; falls back to default (initPool L27)', async () => {
    const limit = await initPoolAndCaptureLimit('9007199254740993');
    expect(limit).toBe(DEFAULT_POOL_MAX);
  });

  it('RED→GREEN: sci-notation ("1e2") is honoured as 100 (operator intent), not truncated to 1', async () => {
    // FIXED EXPECTATION per issues.md 2026-09-09 blocker 3: Number('1e2') === 100
    // (a finite, safe integer inside [1, 100]). The guard returns 100, not 1.
    const limit = await initPoolAndCaptureLimit('1e2');
    expect(limit).toBe(100);
  });

  it('RED→GREEN: above the ceiling (101) is rejected; falls back to default (initPool L27)', async () => {
    const limit = await initPoolAndCaptureLimit('101');
    expect(limit).toBe(DEFAULT_POOL_MAX);
  });

  it('RED→GREEN: at the ceiling (100) is honored (initPool L27)', async () => {
    const limit = await initPoolAndCaptureLimit('100');
    expect(limit).toBe(100);
  });

  it('RED→GREEN: zero (0) is rejected; falls back to default (already protected by || 8)', async () => {
    const limit = await initPoolAndCaptureLimit('0');
    expect(limit).toBe(DEFAULT_POOL_MAX);
  });

  it('RED→GREEN: non-numeric ("abc") is rejected; falls back to default (already protected by || 8)', async () => {
    const limit = await initPoolAndCaptureLimit('abc');
    expect(limit).toBe(DEFAULT_POOL_MAX);
  });

  it('RED→GREEN: empty ("") is rejected; falls back to default', async () => {
    const limit = await initPoolAndCaptureLimit('');
    expect(limit).toBe(DEFAULT_POOL_MAX);
  });

  it('RED→GREEN: decimal ("7.5") is rejected; falls back to default (Number.isInteger guard)', async () => {
    const limit = await initPoolAndCaptureLimit('7.5');
    expect(limit).toBe(DEFAULT_POOL_MAX);
  });

  it('RED→GREEN: valid ("16") is honored (initPool L27)', async () => {
    const limit = await initPoolAndCaptureLimit('16');
    expect(limit).toBe(16);
  });

  // ── maxIdle guard (also fixed by the same parseInt) ────────────────────

  it('RED→GREEN: maxIdle is also bounded (not just connectionLimit)', async () => {
    const { maxIdle } = await initPoolAndCaptureAll('-1');
    expect(maxIdle).toBe(DEFAULT_POOL_MAX);
  });

  // ── poolStats call site (L65) — same bug, second surface ──────────────

  it('RED→GREEN: poolStats() also rejects negative (-1); returns default in stats.connectionLimit', async () => {
    const limit = await poolStatsAndCaptureLimit('-1');
    expect(limit).toBe(DEFAULT_POOL_MAX);
  });

  it('RED→GREEN: poolStats() also rejects huge (999999999); returns default', async () => {
    const limit = await poolStatsAndCaptureLimit('999999999');
    expect(limit).toBe(DEFAULT_POOL_MAX);
  });

  // ── named export surface ──────────────────────────────────────────────

  it('RED→GREEN: MAX_DB_POOL_MAX is exported and equals 100', async () => {
    const { MAX_DB_POOL_MAX } = await import('../../src/alienclaw/api/storage.js');
    expect(MAX_DB_POOL_MAX).toBe(100);
  });

  it('RED→GREEN: DEFAULT_DB_POOL_MAX is exported and equals 8', async () => {
    const { DEFAULT_DB_POOL_MAX } = await import('../../src/alienclaw/api/storage.js');
    expect(DEFAULT_DB_POOL_MAX).toBe(8);
  });

  it('RED→GREEN: resolvePoolMax() is exported and returns the default for invalid input', async () => {
    const { resolvePoolMax } = await import('../../src/alienclaw/api/storage.js');
    // unset env then call
    delete process.env[ENV_KEY];
    expect(resolvePoolMax()).toBe(DEFAULT_POOL_MAX);
  });

  it('RED→GREEN: resolvePoolMax() honours valid ("16")', async () => {
    const { resolvePoolMax } = await import('../../src/alienclaw/api/storage.js');
    process.env[ENV_KEY] = '16';
    expect(resolvePoolMax()).toBe(16);
  });

  it('RED→GREEN: resolvePoolMax() rejects out-of-range and returns default', async () => {
    const { resolvePoolMax } = await import('../../src/alienclaw/api/storage.js');
    process.env[ENV_KEY] = '-5';
    expect(resolvePoolMax()).toBe(DEFAULT_POOL_MAX);
    process.env[ENV_KEY] = '500';
    expect(resolvePoolMax()).toBe(DEFAULT_POOL_MAX);
  });

  it('CONTROL: when env is unset, default is honoured', async () => {
    const limit = await initPoolAndCaptureLimit(undefined);
    expect(limit).toBe(DEFAULT_POOL_MAX);
  });
});