/**
 * registry-bootstrap.test.ts
 *
 * Direct unit tests for src/alienclaw/registry-bootstrap.ts (44 lines, 1 export).
 *
 *   bootstrapRegistry(alienclawHome?: string): Promise<RegistryRuntime>
 *
 * Five-step CLI-startup contract:
 *   1. installSeeds()                  — copy seed .ms/.msb to ALIENCLAW_HOME/registry/
 *   2. new MartianRegistry(<home>/registry/ms)
 *   3. await registry.ensureDir()       — mkdir -p the registry dir
 *   4. await registry.loadAll()         — async load of all .ms files
 *   5. wireToolAdapters()               — wire OpenClaw tools → Martian adapter layer
 *   → returns { registry: MartianRegistry } with the loaded Martians
 *
 * The async function is the entry-point used by every CLI startup path; a
 * regression in any of the 5 steps would silently break the CLI with no test
 * catching it. The test exercises the function in pure isolation by setting
 * ALIENCLAW_HOME to a fresh mkdtempSync directory and re-importing the
 * source module under test via vi.resetModules() so the captured PATHS
 * object points at the temp directory.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock `wireToolAdapters` so the test does not pollute global tool-adapter
// state across runs. The test verifies it was CALLED (spy), not what it
// does (covered by its own test suite).
vi.mock('../../src/alienclaw/msb/tool-adapters.js', () => ({
  wireToolAdapters: vi.fn(),
  ALLOWED_FETCH_HOSTS: new Set<string>(),
  isBlockedHost: () => false,
  assertSafeFetchUrl: (u: string) => new URL(u),
}));

let tmpHome: string;

beforeEach(() => {
  // Fresh ALIENCLAW_HOME per test so installSeeds() runs in isolation
  // and no state leaks between tests.
  tmpHome = mkdtempSync(join(tmpdir(), 'p077-regboot-'));
  process.env['ALIENCLAW_HOME'] = tmpHome;
  // Reset the module cache so the next dynamic import re-reads PATHS
  // from the new ALIENCLAW_HOME env-var.
  vi.resetModules();
  // Re-apply the mock after resetModules (vi.resetModules clears mocks too).
  vi.doMock('../../src/alienclaw/msb/tool-adapters.js', () => ({
    wireToolAdapters: vi.fn(),
    ALLOWED_FETCH_HOSTS: new Set<string>(),
    isBlockedHost: () => false,
    assertSafeFetchUrl: (u: string) => new URL(u),
  }));
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  delete process.env['ALIENCLAW_HOME'];
});

// Helper: dynamically import the source module AFTER ALIENCLAW_HOME is set
// and the mock is re-applied. Returns the live module reference.
async function loadBootstrapModule() {
  const mod = await import('../../src/alienclaw/registry-bootstrap.js');
  return mod;
}

describe('bootstrapRegistry — happy path', () => {
  it('R-101: returns a RegistryRuntime with a non-empty MartianRegistry', async () => {
    const { bootstrapRegistry } = await loadBootstrapModule();
    const runtime = await bootstrapRegistry(tmpHome);
    expect(runtime).toBeDefined();
    expect(runtime.registry).toBeDefined();
    // installSeeds() copies 3 SEED_SPECS into ALIENCLAW_HOME/registry/ms
    // (MS_WEB00001, MS_FREAD0001, MS_FWRITE001 — see seed-installer.ts:23-29).
    expect(runtime.registry.size).toBeGreaterThan(0);
  });

  it('R-102: copies seed .ms files into ALIENCLAW_HOME/registry/ms/ via installSeeds', async () => {
    const { bootstrapRegistry } = await loadBootstrapModule();
    await bootstrapRegistry(tmpHome);
    const msDir = join(tmpHome, 'registry', 'ms');
    expect(existsSync(msDir)).toBe(true);
    const files = readdirSync(msDir).filter(f => f.endsWith('.ms'));
    // 3 SEED_SPECS — matches seed-installer.ts:23-29.
    expect(files.length).toBe(3);
  });

  it('R-103: copies seed .msb files into ALIENCLAW_HOME/registry/msb/ via installSeeds', async () => {
    const { bootstrapRegistry } = await loadBootstrapModule();
    await bootstrapRegistry(tmpHome);
    const msbDir = join(tmpHome, 'registry', 'msb');
    expect(existsSync(msbDir)).toBe(true);
    const files = readdirSync(msbDir).filter(f => f.endsWith('.msb'));
    // seed/msb/ contains at least one .msb file.
    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  it('R-104: calls wireToolAdapters() exactly once during bootstrap', async () => {
    const { bootstrapRegistry } = await loadBootstrapModule();
    const { wireToolAdapters } = await import('../../src/alienclaw/msb/tool-adapters.js');
    const mocked = wireToolAdapters as unknown as ReturnType<typeof vi.fn>;
    await bootstrapRegistry(tmpHome);
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it('R-105: ensures the registry dir exists (mkdir -p recursive) via MartianRegistry.ensureDir', async () => {
    const { bootstrapRegistry } = await loadBootstrapModule();
    await bootstrapRegistry(tmpHome);
    const msDir = join(tmpHome, 'registry', 'ms');
    expect(existsSync(msDir)).toBe(true);
  });

  it('R-106: returns a registry whose .list() returns the loaded active Martians', async () => {
    const { bootstrapRegistry } = await loadBootstrapModule();
    const runtime = await bootstrapRegistry(tmpHome);
    const list = runtime.registry.list();
    expect(list.length).toBeGreaterThan(0);
    for (const spec of list) {
      expect(spec.id).toBeTruthy();
      expect(spec.toolTags.length).toBeGreaterThan(0);
      expect(typeof spec.fitness).toBe('number');
    }
  });
});

describe('bootstrapRegistry — path handling', () => {
  it('R-201: uses the explicit alienclawHome argument when provided (registry dir)', async () => {
    const { bootstrapRegistry } = await loadBootstrapModule();
    const runtime = await bootstrapRegistry(tmpHome);
    // The MartianRegistry was constructed with path.join(tmpHome, 'registry', 'ms').
    // Verify Martians are loaded from this path.
    expect(runtime.registry.size).toBeGreaterThan(0);
  });

  it('R-202: returns a runtime whose .registry.size matches the on-disk .ms file count', async () => {
    const { bootstrapRegistry } = await loadBootstrapModule();
    const runtime = await bootstrapRegistry(tmpHome);
    const msDir = join(tmpHome, 'registry', 'ms');
    const fileCount = readdirSync(msDir).filter(f => f.endsWith('.ms')).length;
    expect(runtime.registry.size).toBe(fileCount);
  });

  it('R-203: uses PATHS.home as the registry dir when no alienclawHome argument is supplied', async () => {
    const { bootstrapRegistry } = await loadBootstrapModule();
    // alienclawHome omitted → home = PATHS.home, which reads ALIENCLAW_HOME env var
    // (set to tmpHome by beforeEach). Registry should load the same seed Martians.
    const runtime = await bootstrapRegistry();
    expect(runtime.registry.size).toBeGreaterThan(0);
  });
});

describe('bootstrapRegistry — idempotency', () => {
  it('R-301: calling bootstrapRegistry twice does not duplicate seed .ms files', async () => {
    const { bootstrapRegistry } = await loadBootstrapModule();
    await bootstrapRegistry(tmpHome);
    await bootstrapRegistry(tmpHome);
    const msDir = join(tmpHome, 'registry', 'ms');
    const files = readdirSync(msDir).filter(f => f.endsWith('.ms'));
    // Still exactly 3 — installSeeds() with overwrite=false (default) is
    // a no-op for files that already exist.
    expect(files.length).toBe(3);
  });

  it('R-302: second bootstrapRegistry call returns a fresh registry instance with the same Martian count', async () => {
    const { bootstrapRegistry } = await loadBootstrapModule();
    const first  = await bootstrapRegistry(tmpHome);
    const second = await bootstrapRegistry(tmpHome);
    // Different instances — bootstrapRegistry creates a new MartianRegistry each call.
    expect(second.registry).not.toBe(first.registry);
    expect(second.registry.size).toBe(first.registry.size);
  });

  it('R-303: wireToolAdapters is called once per bootstrapRegistry invocation', async () => {
    const { bootstrapRegistry } = await loadBootstrapModule();
    const { wireToolAdapters } = await import('../../src/alienclaw/msb/tool-adapters.js');
    const mocked = wireToolAdapters as unknown as ReturnType<typeof vi.fn>;
    await bootstrapRegistry(tmpHome);
    await bootstrapRegistry(tmpHome);
    expect(mocked).toHaveBeenCalledTimes(2);
  });
});
