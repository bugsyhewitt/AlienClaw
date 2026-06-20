import { describe, it, expect } from 'vitest';
import { apiError } from '../../src/alienclaw/api/types.js';
import { handleHealth } from '../../src/alienclaw/api/handlers/health.js';
import { handleInstall } from '../../src/alienclaw/api/handlers/install.js';
import { handleStats } from '../../src/alienclaw/api/handlers/stats.js';
import { handleMartianTypes } from '../../src/alienclaw/api/handlers/martian-types.js';
import type { InstallStore, SubmissionStore, GlobalStats } from '../../src/alienclaw/api/storage.js';

// ── apiError ────────────────────────────────────────────────────────────────

describe('apiError', () => {
  it('returns structured error with default empty details', () => {
    const result = apiError('FOO', 'bar');
    expect(result).toEqual({ error: { code: 'FOO', message: 'bar', details: {} } });
  });

  it('passes explicit details through unchanged', () => {
    const result = apiError('E', 'm', { x: 1 });
    expect(result).toEqual({ error: { code: 'E', message: 'm', details: { x: 1 } } });
  });
});

// ── handleHealth ────────────────────────────────────────────────────────────

describe('handleHealth', () => {
  it('returns [200, {status:ok, version:semver, uptime_seconds:>=0}]', () => {
    const [code, body] = handleHealth();
    expect(code).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(body.uptime_seconds).toBeGreaterThanOrEqual(0);
  });
});

// ── handleStats ─────────────────────────────────────────────────────────────

describe('handleStats', () => {
  it('passes all store.get() fields through to the response tuple', async () => {
    const rawStats = {
      total_genomes:             5,
      total_installs:            2,
      total_fitness_evaluations: 100,
      top_fitness_by_type:       { compute: 0.9 },
    };
    const store = { get: async () => rawStats } as unknown as GlobalStats;
    const [code, body] = await handleStats(store);
    expect(code).toBe(200);
    expect(body.total_genomes).toBe(5);
    expect(body.total_installs).toBe(2);
    expect(body.total_fitness_evaluations).toBe(100);
    expect(body.top_fitness_by_type).toEqual({ compute: 0.9 });
  });
});

// ── handleMartianTypes ──────────────────────────────────────────────────────

describe('handleMartianTypes', () => {
  it('sorts martian_types alphabetically by name', async () => {
    const store = {
      topForType: async () => [],
      countForType: async () => 0,
    } as unknown as SubmissionStore;
    const [, body] = await handleMartianTypes(new Set(['search_text', 'compute']), store);
    expect(body.martian_types.map(t => t.name)).toEqual(['compute', 'search_text']);
  });

  it('returns total:0 and empty martian_types for an empty set', async () => {
    const store = {
      topForType: async () => [],
      countForType: async () => 0,
    } as unknown as SubmissionStore;
    const [code, body] = await handleMartianTypes(new Set(), store);
    expect(code).toBe(200);
    expect(body.total).toBe(0);
    expect(body.martian_types).toEqual([]);
  });

  it('returns default zero values for a type with no submissions', async () => {
    const store = {
      topForType: async () => [],
      countForType: async () => 0,
    } as unknown as SubmissionStore;
    const [, body] = await handleMartianTypes(new Set(['compute']), store);
    const entry = body.martian_types[0];
    expect(entry?.name).toBe('compute');
    expect(entry?.current_top_fitness).toBe(0);
    expect(entry?.submission_count).toBe(0);
    expect(entry?.last_submission_at).toBe('');
  });
});

// ── handleInstall ────────────────────────────────────────────────────────────

describe('handleInstall', () => {
  const VALID_API_KEY = 'a'.repeat(43);
  const VALID_MACHINE_HASH = 'b'.repeat(64);

  it('returns [201, registered] for a new installation', async () => {
    const store = {
      register: async () => ['abc-id', true] as [string, boolean],
    } as unknown as InstallStore;
    const [code, body] = await handleInstall(
      { api_key: VALID_API_KEY, machine_hash: VALID_MACHINE_HASH },
      store,
    );
    expect(code).toBe(201);
    expect((body as { status: string }).status).toBe('registered');
    expect((body as { install_id: string }).install_id).toBe('abc-id');
  });

  it('returns [200, known] for an already-registered installation', async () => {
    const store = {
      register: async () => ['abc-id', false] as [string, boolean],
    } as unknown as InstallStore;
    const [code, body] = await handleInstall(
      { api_key: VALID_API_KEY, machine_hash: VALID_MACHINE_HASH },
      store,
    );
    expect(code).toBe(200);
    expect((body as { status: string }).status).toBe('known');
    expect((body as { install_id: string }).install_id).toBe('abc-id');
  });

  it('throws when the request fails validation (short api_key)', async () => {
    const store = {
      register: async () => ['unused', true] as [string, boolean],
    } as unknown as InstallStore;
    await expect(
      handleInstall({ api_key: 'short', machine_hash: VALID_MACHINE_HASH }, store),
    ).rejects.toThrow();
  });
});
