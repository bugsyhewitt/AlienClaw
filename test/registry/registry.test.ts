/**
 * registry.test.ts
 *
 * Direct unit tests for `src/alienclaw/registry/registry.ts` (Packet 076).
 *
 * Background:
 *   `registry.ts` (75 lines) exports 1 public symbol:
 *     - getRegistry()  (singleton accessor for the module-level `RegistryStore` instance)
 *
 *   The internal unexported class `RegistryStore` exposes 5 surface members:
 *     - load(dir?)                              (sync reload from .ms directory)
 *     - bestForTool(toolTag)                    (highest-fitness active Martian per tool tag)
 *     - get(id)                                 (lookup by Martian ID, e.g. "MS_WEB00001")
 *     - list()                                  (all active Martians sorted by fitness desc)
 *     - size                                    (getter, total loaded — including retired/graveyard)
 *
 *   `getRegistry().load(...)` is called by:
 *     - src/alienclaw/wiring/hierarchy-bootstrap.ts:62   (production boot path)
 *     - src/alienclaw/registry-bootstrap.ts (async variant uses a different code path)
 *
 *   `getRegistry()` is re-exported from:
 *     - src/alienclaw/index.ts:45
 *
 *   The singleton is module-level: `const _registry = new RegistryStore();` runs at import time.
 *   To get a fresh singleton per test, we use `vi.resetModules()` + dynamic re-import.
 *
 *   The MS-loader dependency is fully covered by packet 071
 *   (test/registry/ms-loader.test.ts, PR #64). This packet covers the layer
 *   ABOVE the loader: the singleton wrapper, the tool-tag index, the
 *   bestForTool selection algorithm, the active-filter + sort in list(),
 *   and the get()/size getters.
 *
 * Test idiom:
 *   - For each test, call vi.resetModules() and dynamically re-import the
 *     module so the module-level `_registry` singleton starts fresh.
 *   - mkdtempSync(tmpdir(), 'p076-registry-') to create a real temp dir.
 *   - writeFileSync one or more .ms fixture files (using `assembleGenome` to
 *     produce a 256-char Base62 checksum-valid genome).
 *   - Set ALIENCLAW_HOME env var to the temp dir BEFORE the dynamic import
 *     (PATHS is read at module load via `const PATHS = ...`).
 *   - Call getRegistry().load(tmpDir).
 *   - Assert getRegistry().get(id), bestForTool(tag), list(), size.
 *   - Clean up via rmSync(tmpDir, { recursive: true, force: true }).
 *
 *   This is the same pattern used by:
 *   - test/registry/seed-installer.test.ts (packet 070, PR #63)
 *   - test/registry/ms-loader.test.ts (packet 071, PR #64)
 *   - test/martians/registry.test.ts (packet 067, PR #60)
 *
 * Reference impl ship-gate (verified at this wake, packet 076 §G-9):
 *   - vitest baseline (PR #65 head @ 49079dd9): 1113 passed, 40 skipped (1153 total, 67 files)
 *   - vitest with this file added:               1132 passed, 40 skipped (1172 total, 68 files)
 *                                                   (delta: +19 cases, +1 file)
 *   - tsc --noEmit:                              exit 0, empty output
 *   - pytest:                                    756 passed, 125 skipped (unchanged)
 *   - chain exit 0:                              YES
 *
 * Run smoke (build agent):
 *   ./node_modules/.bin/vitest run test/registry/registry.test.ts --reporter=verbose
 *   → expect 19 passed, 0 failed
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assembleGenome } from '../../src/alienclaw/registry/genome-codec.js';
import type { MartianSpec } from '../../src/alienclaw/registry/ms-types.js';

// ─── helpers ──────────────────────────────────────────────────────────────

/**
 * Build a 256-char Base62 checksum-valid genome from 3 short section strings.
 * `assembleGenome` pads each section to 64 chars (identity/execution/behavior)
 * and appends a 64-char checksum = 256 total.
 */
function buildGenome(seed: string): string {
  // Each section must be exactly 64 chars. We pad three short tags to 64 with
  // a section-specific filler character. The exact content does not matter for
  // registry.ts — only that the genome is checksum-valid (assembleGenome
  // computes the checksum from sections 0+1+2 = 192 chars + 64-char checksum).
  const s = seed.padEnd(8, 'X').slice(0, 8);
  return assembleGenome(
    s + 'identity'.padEnd(56, 'I'),  // 8 + 56 = 64
    s + 'execution'.padEnd(56, 'E'), // 8 + 56 = 64
    s + 'behavior'.padEnd(56, 'B'),  // 8 + 56 = 64
  );
}

/**
 * Render a minimal valid .ms file body. Required sections: [GENOME], [TOOLS].
 * Optional: [GRAVEYARD]. Header comment must contain the MS_XXXXXXXX id.
 */
function renderMs(opts: {
  id: string;
  description: string;
  status: 'active' | 'retired' | 'graveyard';
  fitness: number;
  generation?: number;
  tools: string[];
  genome: string;
  graveyard?: Array<{ fitness: number; generation: number; genome: string }>;
}): string {
  const gen = opts.generation ?? 1;
  const toolsBlock = opts.tools.map(t => `${t}      → ${t}.msb`).join('\n');
  let body = `[GENOME]\n${opts.genome}\n\n`;
  body += `# ${opts.id}\n`;
  body += `# description: ${opts.description}\n`;
  body += `# generation: ${gen}\n`;
  body += `# status: ${opts.status}\n`;
  body += `# fitness: ${opts.fitness.toFixed(2)}\n\n`;
  body += `[TOOLS]\n${toolsBlock}\n`;
  if (opts.graveyard && opts.graveyard.length > 0) {
    body += `\n[GRAVEYARD]\n`;
    for (const g of opts.graveyard) {
      body += `# ${g.fitness.toFixed(2)} G${g.generation} ${g.genome}\n`;
    }
  }
  return body;
}

/**
 * Dynamic import the registry module under a fresh module graph
 * (so the module-level `_registry` singleton is reset) and with
 * `ALIENCLAW_HOME` set to the temp dir (so PATHS.ms resolves to it).
 */
async function importFresh(home: string): Promise<{
  getRegistry: () => { load: (dir?: string) => void; bestForTool: (tag: string) => MartianSpec | undefined; get: (id: string) => MartianSpec | undefined; list: () => MartianSpec[]; readonly size: number };
}> {
  vi.resetModules();
  process.env.ALIENCLAW_HOME = home;
  // Re-import with the env var set BEFORE the module's `const PATHS = ...` is evaluated.
  // We use a relative string import via dynamic import so vi.resetModules() takes effect.
  return await import('../../src/alienclaw/registry/registry.js');
}

// ─── test fixtures ────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'p076-registry-'));
});

afterEach(() => {
  delete process.env.ALIENCLAW_HOME;
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── 1. getRegistry() singleton ───────────────────────────────────────────

describe('getRegistry() — singleton semantics', () => {
  it('R-001: returns the same instance on repeated calls within one module-graph', async () => {
    const { getRegistry } = await importFresh(tmpDir);
    const a = getRegistry();
    const b = getRegistry();
    expect(a).toBe(b);
  });

  it('R-002: vi.resetModules() yields a fresh singleton (no cross-test bleed)', async () => {
    const mod1 = await importFresh(tmpDir);
    mod1.getRegistry().load(); // no-op on empty dir, but populates _registry
    const mod2 = await importFresh(tmpDir);
    expect(mod2.getRegistry()).not.toBe(mod1.getRegistry());
  });
});

// ─── 2. load(dir?) — happy path ───────────────────────────────────────────

describe('load() — happy path', () => {
  it('R-101: loads all .ms files in the given directory', async () => {
    writeFileSync(join(tmpDir, 'MS_WEB00001.ms'), renderMs({
      id: 'MS_WEB00001',
      description: 'Web research Martian',
      status: 'active',
      fitness: 0.5,
      tools: ['web_search'],
      genome: buildGenome('web01'),
    }));
    writeFileSync(join(tmpDir, 'MS_FREAD0001.ms'), renderMs({
      id: 'MS_FREAD0001',
      description: 'File read Martian',
      status: 'active',
      fitness: 0.7,
      tools: ['file_read'],
      genome: buildGenome('fread1'),
    }));
    const { getRegistry } = await importFresh(tmpDir);
    getRegistry().load(tmpDir);
    expect(getRegistry().size).toBe(2);
  });

  it('R-102: parses Martian metadata (id, description, status, fitness) correctly', async () => {
    writeFileSync(join(tmpDir, 'MS_TEST00001.ms'), renderMs({
      id: 'MS_TEST00001',
      description: 'Test Martian',
      status: 'active',
      fitness: 0.42,
      tools: ['web_search'],
      genome: buildGenome('test1'),
    }));
    const { getRegistry } = await importFresh(tmpDir);
    getRegistry().load(tmpDir);
    const spec = getRegistry().get('MS_TEST00001');
    expect(spec).toBeDefined();
    expect(spec!.id).toBe('MS_TEST00001');
    expect(spec!.description).toBe('Test Martian');
    expect(spec!.status).toBe('active');
    expect(spec!.fitness).toBeCloseTo(0.42, 5);
  });

  it('R-103: derives toolTags from the [TOOLS] section', async () => {
    writeFileSync(join(tmpDir, 'MS_MULTI0001.ms'), renderMs({
      id: 'MS_MULTI0001',
      description: 'Multi-tool Martian',
      status: 'active',
      fitness: 0.6,
      tools: ['web_search', 'file_read', 'file_write'],
      genome: buildGenome('multi'),
    }));
    const { getRegistry } = await importFresh(tmpDir);
    getRegistry().load(tmpDir);
    const spec = getRegistry().get('MS_MULTI0001');
    expect(spec).toBeDefined();
    // The ms-loader derives toolTags from the [TOOLS] section. We just check
    // the field is populated and contains the tool names.
    expect(Array.isArray(spec!.toolTags)).toBe(true);
    expect(spec!.toolTags.length).toBeGreaterThan(0);
    expect(spec!.toolTags).toContain('web_search');
  });

  it('R-104: load() is idempotent — re-calling replaces the store', async () => {
    writeFileSync(join(tmpDir, 'MS_FIRST00001.ms'), renderMs({
      id: 'MS_FIRST00001',
      description: 'First',
      status: 'active',
      fitness: 0.1,
      tools: ['web_search'],
      genome: buildGenome('first'),
    }));
    const { getRegistry } = await importFresh(tmpDir);
    getRegistry().load(tmpDir);
    expect(getRegistry().size).toBe(1);

    // Remove the first file, add a different one, reload.
    rmSync(join(tmpDir, 'MS_FIRST00001.ms'));
    writeFileSync(join(tmpDir, 'MS_SECOND0001.ms'), renderMs({
      id: 'MS_SECOND0001',
      description: 'Second',
      status: 'active',
      fitness: 0.2,
      tools: ['file_read'],
      genome: buildGenome('second'),
    }));
    getRegistry().load(tmpDir);
    expect(getRegistry().size).toBe(1);
    expect(getRegistry().get('MS_FIRST00001')).toBeUndefined();
    expect(getRegistry().get('MS_SECOND0001')).toBeDefined();
  });
});

// ─── 3. load() — error / edge path ───────────────────────────────────────

describe('load() — error & edge path', () => {
  it('R-201: skips invalid .ms files with a console.warn (does not throw)', async () => {
    // Write a junk file that the ms-loader will reject.
    writeFileSync(join(tmpDir, 'bad.ms'), 'this is not a valid .ms file\n');
    // And one good file alongside.
    writeFileSync(join(tmpDir, 'MS_GOOD00001.ms'), renderMs({
      id: 'MS_GOOD00001',
      description: 'Good Martian',
      status: 'active',
      fitness: 0.5,
      tools: ['web_search'],
      genome: buildGenome('good1'),
    }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { getRegistry } = await importFresh(tmpDir);
    expect(() => getRegistry().load(tmpDir)).not.toThrow();
    // The good Martian loaded; the bad one was skipped.
    expect(getRegistry().size).toBe(1);
    expect(getRegistry().get('MS_GOOD00001')).toBeDefined();
    // The warn was emitted for the bad file.
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls.some(c => String(c[0]).includes('bad.ms'))).toBe(true);

    warnSpy.mockRestore();
  });

  it('R-202: empty directory yields an empty registry (size 0)', async () => {
    const { getRegistry } = await importFresh(tmpDir);
    getRegistry().load(tmpDir);
    expect(getRegistry().size).toBe(0);
    expect(getRegistry().list()).toEqual([]);
  });
});

// ─── 4. bestForTool() — selection algorithm ──────────────────────────────

describe('bestForTool() — selection algorithm', () => {
  it('R-301: returns the highest-fitness active Martian for a given tool tag', async () => {
    writeFileSync(join(tmpDir, 'MS_LOW0000001.ms'), renderMs({
      id: 'MS_LOW0000001',
      description: 'Low fitness',
      status: 'active',
      fitness: 0.3,
      tools: ['web_search'],
      genome: buildGenome('low001'),
    }));
    writeFileSync(join(tmpDir, 'MS_HIGH00001.ms'), renderMs({
      id: 'MS_HIGH00001',
      description: 'High fitness',
      status: 'active',
      fitness: 0.9,
      tools: ['web_search'],
      genome: buildGenome('high01'),
    }));
    const { getRegistry } = await importFresh(tmpDir);
    getRegistry().load(tmpDir);
    const best = getRegistry().bestForTool('web_search');
    expect(best).toBeDefined();
    expect(best!.id).toBe('MS_HIGH00001');
    expect(best!.fitness).toBeCloseTo(0.9, 5);
  });

  it('R-302: returns undefined for an unknown tool tag', async () => {
    writeFileSync(join(tmpDir, 'MS_X00000001.ms'), renderMs({
      id: 'MS_X00000001',
      description: 'X',
      status: 'active',
      fitness: 0.5,
      tools: ['web_search'],
      genome: buildGenome('x0001'),
    }));
    const { getRegistry } = await importFresh(tmpDir);
    getRegistry().load(tmpDir);
    expect(getRegistry().bestForTool('nonexistent_tool')).toBeUndefined();
  });

  it('R-303: ignores retired Martians when building the tool index', async () => {
    writeFileSync(join(tmpDir, 'MS_ACT0000001.ms'), renderMs({
      id: 'MS_ACT0000001',
      description: 'Active',
      status: 'active',
      fitness: 0.4,
      tools: ['web_search'],
      genome: buildGenome('act001'),
    }));
    writeFileSync(join(tmpDir, 'MS_RET0000001.ms'), renderMs({
      id: 'MS_RET0000001',
      description: 'Retired (high fitness, should be ignored)',
      status: 'retired',
      fitness: 0.99,
      tools: ['web_search'],
      genome: buildGenome('ret001'),
    }));
    const { getRegistry } = await importFresh(tmpDir);
    getRegistry().load(tmpDir);
    const best = getRegistry().bestForTool('web_search');
    expect(best).toBeDefined();
    expect(best!.id).toBe('MS_ACT0000001');
    // size counts ALL loaded specs (including retired); list() filters to active.
    expect(getRegistry().size).toBe(2);
  });

  it('R-304: ignores graveyard Martians when building the tool index', async () => {
    writeFileSync(join(tmpDir, 'MS_ACT0000002.ms'), renderMs({
      id: 'MS_ACT0000002',
      description: 'Active',
      status: 'active',
      fitness: 0.4,
      tools: ['web_search'],
      genome: buildGenome('act002'),
    }));
    writeFileSync(join(tmpDir, 'MS_GRV0000001.ms'), renderMs({
      id: 'MS_GRV0000001',
      description: 'Graveyard (high fitness, should be ignored)',
      status: 'graveyard',
      fitness: 0.99,
      tools: ['web_search'],
      genome: buildGenome('grv001'),
    }));
    const { getRegistry } = await importFresh(tmpDir);
    getRegistry().load(tmpDir);
    const best = getRegistry().bestForTool('web_search');
    expect(best).toBeDefined();
    expect(best!.id).toBe('MS_ACT0000002');
  });
});

// ─── 5. get(id) — lookup ────────────────────────────────────────────────

describe('get() — lookup by Martian ID', () => {
  it('R-401: returns the MartianSpec for a known id', async () => {
    writeFileSync(join(tmpDir, 'MS_LOOK000001.ms'), renderMs({
      id: 'MS_LOOK000001',
      description: 'Lookup target',
      status: 'active',
      fitness: 0.5,
      tools: ['web_search'],
      genome: buildGenome('look01'),
    }));
    const { getRegistry } = await importFresh(tmpDir);
    getRegistry().load(tmpDir);
    const spec = getRegistry().get('MS_LOOK000001');
    expect(spec).toBeDefined();
    expect(spec!.id).toBe('MS_LOOK000001');
  });

  it('R-402: returns undefined for an unknown id', async () => {
    const { getRegistry } = await importFresh(tmpDir);
    getRegistry().load(tmpDir);
    expect(getRegistry().get('MS_NOSUCH0001')).toBeUndefined();
  });

  it('R-403: returns retired and graveyard Martians (no status filter on get)', async () => {
    writeFileSync(join(tmpDir, 'MS_RET0000002.ms'), renderMs({
      id: 'MS_RET0000002',
      description: 'Retired',
      status: 'retired',
      fitness: 0.5,
      tools: ['web_search'],
      genome: buildGenome('ret002'),
    }));
    const { getRegistry } = await importFresh(tmpDir);
    getRegistry().load(tmpDir);
    expect(getRegistry().get('MS_RET0000002')).toBeDefined();
  });
});

// ─── 6. list() — active-only + sort by fitness desc ──────────────────────

describe('list() — active filter and sort', () => {
  it('R-501: returns only active Martians (filters retired and graveyard)', async () => {
    writeFileSync(join(tmpDir, 'MS_A00000001.ms'), renderMs({
      id: 'MS_A00000001',
      description: 'Active A',
      status: 'active',
      fitness: 0.5,
      tools: ['web_search'],
      genome: buildGenome('a00001'),
    }));
    writeFileSync(join(tmpDir, 'MS_R00000001.ms'), renderMs({
      id: 'MS_R00000001',
      description: 'Retired R',
      status: 'retired',
      fitness: 0.9,
      tools: ['file_read'],
      genome: buildGenome('r00001'),
    }));
    writeFileSync(join(tmpDir, 'MS_G00000001.ms'), renderMs({
      id: 'MS_G00000001',
      description: 'Graveyard G',
      status: 'graveyard',
      fitness: 0.95,
      tools: ['file_write'],
      genome: buildGenome('g00001'),
    }));
    const { getRegistry } = await importFresh(tmpDir);
    getRegistry().load(tmpDir);
    const list = getRegistry().list();
    expect(list.length).toBe(1);
    expect(list[0]!.id).toBe('MS_A00000001');
  });

  it('R-502: sorts by fitness descending', async () => {
    writeFileSync(join(tmpDir, 'MS_LOW0000002.ms'), renderMs({
      id: 'MS_LOW0000002',
      description: 'Low',
      status: 'active',
      fitness: 0.2,
      tools: ['web_search'],
      genome: buildGenome('low002'),
    }));
    writeFileSync(join(tmpDir, 'MS_MID0000002.ms'), renderMs({
      id: 'MS_MID0000002',
      description: 'Mid',
      status: 'active',
      fitness: 0.5,
      tools: ['file_read'],
      genome: buildGenome('mid002'),
    }));
    writeFileSync(join(tmpDir, 'MS_HIG0000002.ms'), renderMs({
      id: 'MS_HIG0000002',
      description: 'High',
      status: 'active',
      fitness: 0.9,
      tools: ['file_write'],
      genome: buildGenome('hig002'),
    }));
    const { getRegistry } = await importFresh(tmpDir);
    getRegistry().load(tmpDir);
    const list = getRegistry().list();
    expect(list.length).toBe(3);
    expect(list[0]!.id).toBe('MS_HIG0000002');
    expect(list[1]!.id).toBe('MS_MID0000002');
    expect(list[2]!.id).toBe('MS_LOW0000002');
  });

  it('R-503: returns a new array on each call (caller can mutate without poisoning the store)', async () => {
    writeFileSync(join(tmpDir, 'MS_IMM0000001.ms'), renderMs({
      id: 'MS_IMM0000001',
      description: 'Immutability check',
      status: 'active',
      fitness: 0.5,
      tools: ['web_search'],
      genome: buildGenome('imm001'),
    }));
    const { getRegistry } = await importFresh(tmpDir);
    getRegistry().load(tmpDir);
    const a = getRegistry().list();
    const b = getRegistry().list();
    expect(a).not.toBe(b); // different array references
    expect(a).toEqual(b);  // same content
  });
});

// ─── 7. size — getter ────────────────────────────────────────────────────

describe('size — getter', () => {
  it('R-601: reflects total loaded Martians (active + retired + graveyard)', async () => {
    writeFileSync(join(tmpDir, 'MS_A00000002.ms'), renderMs({
      id: 'MS_A00000002',
      description: 'Active',
      status: 'active',
      fitness: 0.5,
      tools: ['web_search'],
      genome: buildGenome('a00002'),
    }));
    writeFileSync(join(tmpDir, 'MS_R00000002.ms'), renderMs({
      id: 'MS_R00000002',
      description: 'Retired',
      status: 'retired',
      fitness: 0.5,
      tools: ['file_read'],
      genome: buildGenome('r00002'),
    }));
    const { getRegistry } = await importFresh(tmpDir);
    getRegistry().load(tmpDir);
    expect(getRegistry().size).toBe(2);
  });
});
