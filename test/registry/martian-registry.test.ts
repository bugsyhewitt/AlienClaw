/**
 * Direct unit tests for src/alienclaw/registry/martian-registry.ts
 * (Packet 068 reference impl — INLINE VERBATIM in packet §5.1)
 *
 * Covers the 1 public class MartianRegistry + 1 public class RegistryError
 * (the async loader used by registry-bootstrap.ts and every CLI startup path).
 *
 * Disjoint from:
 *   - test/martians/martian-fixture-runner.test.ts (covers the Python mirror
 *     MartianRegistry in src/alienclaw/martians/registry.py + the TS
 *     martian-fixture-runner.test.ts uses the martians-layer registry, NOT
 *     this one)
 *   - test/martians/registry.test.ts (packet 067 — covers
 *     src/alienclaw/martians/registry.ts, a different class)
 *
 * Reference impl verifies against origin/main baseline: vitest 1396 → 1413
 * passed (+17 cases, +1 file).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, statSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  MartianRegistry,
  RegistryError,
} from '../../src/alienclaw/registry/martian-registry.js';
import { assembleGenome } from '../../src/alienclaw/registry/genome-codec.js';

// ── Fixture helpers ──────────────────────────────────────────────────────────

/** Build a valid 256-char Base62 genome using the codec so checksum is correct.
 *  Identity seed is forced to Base62 (alphanumerics only). */
function buildGenome(seed: string): string {
  // identity (64) + execution (64) + behavior (64) + checksum (64) = 256
  // Only alphanumeric chars allowed (Base62 alphabet: 0-9 A-Z a-z).
  const safe = seed.replace(/[^0-9A-Za-z]/g, 'X');
  const id64     = (safe + 'A'.repeat(64)).slice(0, 64);
  const exec64   = ('0'.repeat(64) + 'A'.repeat(64)).slice(0, 64);
  const behave64 = ('0'.repeat(64) + 'B'.repeat(64)).slice(0, 64);
  return assembleGenome(id64, exec64, behave64);
}

function makeValidMs(id: string, overrides: Partial<{
  description: string;
  generation: number;
  status: 'active' | 'retired' | 'graveyard';
  fitness: number;
  tools: string[];
  graveyard: string[];
}> = {}): string {
  const o = {
    description: 'test martian',
    generation: 1,
    status: 'active' as const,
    fitness: 0.5,
    tools: ['web_search'],
    graveyard: [] as string[],
    ...overrides,
  };
  const lines: string[] = [];
  lines.push('[GENOME]');
  lines.push(buildGenome(id));
  lines.push('');
  lines.push(`# ${id}`);
  lines.push(`# description: ${o.description}`);
  lines.push(`# generation: ${o.generation}`);
  lines.push(`# status: ${o.status}`);
  lines.push(`# fitness: ${o.fitness.toFixed(2)}`);
  lines.push('');
  lines.push('[TOOLS]');
  for (const t of o.tools) {
    lines.push(`${t.padEnd(20)} → ${t}.msb`);
  }
  if (o.graveyard.length > 0) {
    lines.push('');
    lines.push('[GRAVEYARD]');
    for (const g of o.graveyard) {
      lines.push(g);
    }
  }
  return lines.join('\n') + '\n';
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'p068-mreg-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('MartianRegistry (registry/martian-registry.ts)', () => {

  // ── Construction & ensureDir ──────────────────────────────────────────────

  describe('construction + ensureDir', () => {
    it('constructor accepts an explicit registryDir', () => {
      const r = new MartianRegistry(tmpDir);
      expect(r).toBeInstanceOf(MartianRegistry);
    });

    it('ensureDir() creates the registry dir if missing', async () => {
      const subdir = join(tmpDir, 'nested', 'ms');
      const r = new MartianRegistry(subdir);
      await r.ensureDir();
      expect(statSync(subdir).isDirectory()).toBe(true);
    });

    it('ensureDir() is idempotent — running twice does not throw', async () => {
      const r = new MartianRegistry(tmpDir);
      await r.ensureDir();
      await r.ensureDir();
      expect(statSync(tmpDir).isDirectory()).toBe(true);
    });

    it('constructor defaults registryDir to PATHS.ms when no argument is given', () => {
      const r = new MartianRegistry();  // triggers arm1: registryDir ?? PATHS.ms
      expect(r).toBeInstanceOf(MartianRegistry);
      expect(r.size).toBe(0);           // loadAll() not called; store is empty
    });
  });

  // ── loadAll: happy path ───────────────────────────────────────────────────

  describe('loadAll — happy path', () => {
    it('loads a single .ms file and exposes it via get()', async () => {
      writeFileSync(join(tmpDir, 'MS_WEB00001.ms'), makeValidMs('MS_WEB00001'));
      const r = new MartianRegistry(tmpDir);
      await r.loadAll();

      const spec = r.get('MS_WEB00001');
      expect(spec).toBeDefined();
      expect(spec!.id).toBe('MS_WEB00001');
      expect(spec!.status).toBe('active');
      expect(spec!.toolTags).toContain('web_search');
      expect(r.size).toBe(1);
    });

    it('loads multiple .ms files; size reflects total active', async () => {
      writeFileSync(join(tmpDir, 'MS_WEB00001.ms'), makeValidMs('MS_WEB00001'));
      writeFileSync(join(tmpDir, 'MS_FREAD0001.ms'), makeValidMs('MS_FREAD0001', { tools: ['file_read'] }));
      writeFileSync(join(tmpDir, 'MS_FWRITE001.ms'), makeValidMs('MS_FWRITE001', { tools: ['file_write'] }));
      const r = new MartianRegistry(tmpDir);
      await r.loadAll();

      expect(r.size).toBe(3);
      expect(r.get('MS_WEB00001')).toBeDefined();
      expect(r.get('MS_FREAD0001')).toBeDefined();
      expect(r.get('MS_FWRITE001')).toBeDefined();
    });

    it('skips graveyard entries from the active store', async () => {
      writeFileSync(join(tmpDir, 'MS_WEB00001.ms'), makeValidMs('MS_WEB00001'));
      writeFileSync(join(tmpDir, 'MS_GRAVE0001.ms'), makeValidMs('MS_GRAVE0001', { status: 'graveyard' }));
      const r = new MartianRegistry(tmpDir);
      await r.loadAll();

      expect(r.size).toBe(1);
      expect(r.get('MS_GRAVE0001')).toBeUndefined();
    });
  });

  // ── loadAll: error paths ──────────────────────────────────────────────────

  describe('loadAll — error paths', () => {
    it('throws RegistryError when registryDir does not exist', async () => {
      const r = new MartianRegistry(join(tmpDir, 'does-not-exist'));
      await expect(r.loadAll()).rejects.toThrow(RegistryError);
      await expect(r.loadAll()).rejects.toThrow(/Cannot read registry dir/);
    });

    it('skips malformed .ms files but loads the rest', async () => {
      writeFileSync(join(tmpDir, 'MS_WEB00001.ms'), makeValidMs('MS_WEB00001'));
      writeFileSync(join(tmpDir, 'BAD.ms'), 'this is not a valid .ms file\n[TOOLS]\nbroken');
      const r = new MartianRegistry(tmpDir);
      // Suppress the console.error for the malformed file
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await r.loadAll();

      expect(r.size).toBe(1);
      expect(r.get('MS_WEB00001')).toBeDefined();
      expect(errSpy).toHaveBeenCalled();
      errSpy.mockRestore();
    });

    it('skips non-.ms files in the directory', async () => {
      writeFileSync(join(tmpDir, 'MS_WEB00001.ms'), makeValidMs('MS_WEB00001'));
      writeFileSync(join(tmpDir, 'README.txt'), 'not a martian');
      writeFileSync(join(tmpDir, 'config.json'), '{}');
      const r = new MartianRegistry(tmpDir);
      await r.loadAll();

      expect(r.size).toBe(1);
    });

    it('skips files that throw a non-parse-error and logs with "Failed to load"', async () => {
      const errFile = join(tmpDir, 'MS_ERR.ms');
      const okFile  = join(tmpDir, 'MS_OK.ms');
      writeFileSync(errFile, makeValidMs('MS_ERR'));
      writeFileSync(okFile,  makeValidMs('MS_OK'));
      // Remove read permission → readFileSync throws EACCES (non-MsParseError) → else branch
      chmodSync(errFile, 0o000);

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const r = new MartianRegistry(tmpDir);
      await r.loadAll();

      // MS_ERR unreadable (EACCES) → else branch; MS_OK loads normally
      expect(r.size).toBe(1);
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining('[MartianRegistry] Failed to load'),
        expect.anything()
      );

      chmodSync(errFile, 0o644);  // restore before afterEach rmSync
      errSpy.mockRestore();
    });
  });

  // ── Accessors: assertLoaded guard ─────────────────────────────────────────

  describe('accessors — assertLoaded guard', () => {
    it('get() throws RegistryError when loadAll() has not been called', () => {
      const r = new MartianRegistry(tmpDir);
      expect(() => r.get('ANY')).toThrow(RegistryError);
      expect(() => r.get('ANY')).toThrow(/Registry not loaded/);
    });

    it('findByToolTag() throws RegistryError when not loaded', () => {
      const r = new MartianRegistry(tmpDir);
      expect(() => r.findByToolTag('web_search')).toThrow(/Registry not loaded/);
    });

    it('list() throws RegistryError when not loaded', () => {
      const r = new MartianRegistry(tmpDir);
      expect(() => r.list()).toThrow(/Registry not loaded/);
    });
  });

  // ── findByToolTag + list ──────────────────────────────────────────────────

  describe('findByToolTag + list', () => {
    it('findByToolTag returns Martians sorted by fitness descending', async () => {
      writeFileSync(join(tmpDir, 'A.ms'), makeValidMs('MS_LOW', { tools: ['web_search'], fitness: 0.3 }));
      writeFileSync(join(tmpDir, 'B.ms'), makeValidMs('MS_HIGH', { tools: ['web_search'], fitness: 0.9 }));
      writeFileSync(join(tmpDir, 'C.ms'), makeValidMs('MS_OTHER', { tools: ['file_read'], fitness: 0.7 }));
      const r = new MartianRegistry(tmpDir);
      await r.loadAll();

      const results = r.findByToolTag('web_search');
      expect(results).toHaveLength(2);
      expect(results[0]!.id).toBe('MS_HIGH');
      expect(results[1]!.id).toBe('MS_LOW');
    });

    it('findByToolTag returns [] for an unknown tool', async () => {
      writeFileSync(join(tmpDir, 'A.ms'), makeValidMs('MS_WEB00001', { tools: ['web_search'] }));
      const r = new MartianRegistry(tmpDir);
      await r.loadAll();
      expect(r.findByToolTag('nonexistent_tool')).toEqual([]);
    });

    it('list() returns only active Martians sorted by fitness desc', async () => {
      writeFileSync(join(tmpDir, 'A.ms'), makeValidMs('MS_LOW',  { fitness: 0.2 }));
      writeFileSync(join(tmpDir, 'B.ms'), makeValidMs('MS_HIGH', { fitness: 0.8 }));
      writeFileSync(join(tmpDir, 'C.ms'), makeValidMs('MS_GRAVE', { status: 'graveyard', fitness: 0.9 }));
      const r = new MartianRegistry(tmpDir);
      await r.loadAll();

      const active = r.list();
      expect(active).toHaveLength(2);
      expect(active[0]!.id).toBe('MS_HIGH');
      expect(active[1]!.id).toBe('MS_LOW');
    });
  });

  // ── Reload semantics ──────────────────────────────────────────────────────

  describe('reload semantics', () => {
    it('re-calling loadAll() replaces the store (idempotent on fresh dir)', async () => {
      writeFileSync(join(tmpDir, 'A.ms'), makeValidMs('MS_WEB00001'));
      const r = new MartianRegistry(tmpDir);
      await r.loadAll();
      expect(r.size).toBe(1);

      // Add a new file and reload
      writeFileSync(join(tmpDir, 'B.ms'), makeValidMs('MS_FREAD0001', { tools: ['file_read'] }));
      await r.loadAll();
      expect(r.size).toBe(2);

      // Remove a file and reload — old ID must be gone
      rmSync(join(tmpDir, 'A.ms'));
      await r.loadAll();
      expect(r.size).toBe(1);
      expect(r.get('MS_WEB00001')).toBeUndefined();
      expect(r.get('MS_FREAD0001')).toBeDefined();
    });
  });

  // ── RegistryError class ───────────────────────────────────────────────────

  describe('RegistryError', () => {
    it('extends Error with name "RegistryError" and a prefixed message', () => {
      const e = new RegistryError('boom');
      expect(e).toBeInstanceOf(Error);
      expect(e).toBeInstanceOf(RegistryError);
      expect(e.name).toBe('RegistryError');
      expect(e.message).toBe('[MartianRegistry] boom');
    });
  });
});
