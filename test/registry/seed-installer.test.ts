/**
 * seed-installer.test.ts
 *
 * Direct unit tests for `src/alienclaw/registry/seed-installer.ts` (packet 070).
 *
 * Background:
 *   `seed-installer.ts` (209 lines) exposes 1 public symbol:
 *     - installSeeds(options)         (NOT covered — writes to ~/.alienclaw/registry/)
 *
 *   The module has 5 internal functions not directly covered today:
 *     - pad64(s)                      (private — 64-char section padding)
 *     - buildMsContent(spec)          (private — assembles .ms file body)
 *     - getSeedDir(sub)               (private — multi-candidate path resolver)
 *     - installMsSeeds(overwrite)     (private — writes the 3 SEED_SPECS .ms files)
 *     - installMsbSeeds(overwrite)    (private — copies seed/msb/*.msb verbatim)
 *
 *   `installSeeds()` is called by `src/alienclaw/wiring/hierarchy-bootstrap.ts:61`
 *   and `src/alienclaw/registry-bootstrap.ts:32` (both production-critical boot paths)
 *   on every CLI startup before the registry is loaded. A regression in the
 *   mkdirSync({ recursive: true }) idempotency, the assembleGenome() checksum
 *   path, or the SEED_SPECS identity table would silently break bootstrap with
 *   no test catching it today.
 *
 * These tests use the mkdtempSync + ALIENCLAW_HOME env-var idiom: set the env
 * var BEFORE the dynamic import (via `vi.resetModules()`) so the module's
 * top-level `const PATHS = ...` resolves to the temp dir.
 *
 * SCOPE NOTE (verified §G-9): the `overwrite: false` option in `installSeeds()`
 * is currently a NO-OP because `fs.writeFileSync` and `fs.copyFileSync` do
 * NOT throw EEXIST — they overwrite silently. The try/catch EEXIST branch in
 * `installMsSeeds` / `installMsbSeeds` (lines 156-163 and 134-141) is dead code
 * today. Packet 070 documents the actual behavior (always overwrites) and does
 * NOT test the would-be "preserve" semantics. That latent bug is filed as a
 * separate issue (`issues.md` 2026-06-20T00:45Z) — not in scope for this packet.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ─── Env setup ──────────────────────────────────────────────────────────────

let homeDir: string;

beforeEach(() => {
  // mkdtempSync is sync; safe at top of beforeEach.
  homeDir = mkdtempSync(join(tmpdir(), 'p070-seed-'));
  process.env['ALIENCLAW_HOME'] = homeDir;
  // Force the module under test to re-evaluate so PATHS picks up the new env.
  vi.resetModules();
});

afterEach(() => {
  rmSync(homeDir, { recursive: true, force: true });
  delete process.env['ALIENCLAW_HOME'];
  vi.resetModules();
});

// Helper: dynamic-import the module under test with the fresh env.
async function loadSeedInstaller(): Promise<{
  installSeeds: (options?: { overwrite?: boolean }) => void;
}> {
  return await import('../../src/alienclaw/registry/seed-installer.js');
}

// ─── 1. installSeeds: end-to-end smoke ──────────────────────────────────────

describe('installSeeds() — end-to-end', () => {
  it('writes the 3 SEED_SPECS .ms files to ALIENCLAW_HOME/registry/ms/', async () => {
    const { installSeeds } = await loadSeedInstaller();
    installSeeds();
    const msDir = join(homeDir, 'registry', 'ms');
    expect(existsSync(msDir)).toBe(true);
    const files = readdirSync(msDir).sort();
    expect(files).toEqual(['MS_FREAD0001.ms', 'MS_FWRITE001.ms', 'MS_WEB00001.ms']);
  });

  it('each .ms file starts with [GENOME] and has a 256-char genome line', async () => {
    const { installSeeds } = await loadSeedInstaller();
    installSeeds();
    const msDir = join(homeDir, 'registry', 'ms');
    for (const f of readdirSync(msDir)) {
      const body = readFileSync(join(msDir, f), 'utf8');
      expect(body.startsWith('[GENOME]\n')).toBe(true);
      const lines = body.split('\n');
      const genomeLine = lines[1];
      expect(genomeLine).toHaveLength(256);
      expect(genomeLine).toMatch(/^[0-9A-Za-z]+$/);
    }
  });

  it('copies every .msb file from seed/msb/ into ALIENCLAW_HOME/registry/msb/', async () => {
    const { installSeeds } = await loadSeedInstaller();
    installSeeds();
    const msbDir = join(homeDir, 'registry', 'msb');
    expect(existsSync(msbDir)).toBe(true);
    const installed = readdirSync(msbDir).sort();
    expect(installed.length).toBeGreaterThanOrEqual(5);
    for (const f of installed) {
      expect(f.endsWith('.msb')).toBe(true);
    }
  });

  it('creates ALIENCLAW_HOME/registry/ms and .../msb with mkdirSync({recursive:true})', async () => {
    const { installSeeds } = await loadSeedInstaller();
    // Pre-condition: directories do not yet exist
    expect(existsSync(join(homeDir, 'registry'))).toBe(false);
    installSeeds();
    expect(existsSync(join(homeDir, 'registry'))).toBe(true);
    expect(existsSync(join(homeDir, 'registry', 'ms'))).toBe(true);
    expect(existsSync(join(homeDir, 'registry', 'msb'))).toBe(true);
  });

  it('is idempotent when the parent dir already exists (mkdirSync recursive)', async () => {
    const { installSeeds } = await loadSeedInstaller();
    installSeeds();
    // Run again on the same ALIENCLAW_HOME — must not throw ENOTEMPTY / EEXIST.
    expect(() => installSeeds()).not.toThrow();
    const msDir = join(homeDir, 'registry', 'ms');
    expect(readdirSync(msDir).sort()).toEqual(['MS_FREAD0001.ms', 'MS_FWRITE001.ms', 'MS_WEB00001.ms']);
  });
});

// ─── 2. installSeeds: overwrite=true re-install path ───────────────────────

describe('installSeeds() — overwrite=true re-install path', () => {
  it('overwrites an existing .ms file with freshly assembled content', async () => {
    const { installSeeds } = await loadSeedInstaller();
    installSeeds();
    const target = join(homeDir, 'registry', 'ms', 'MS_WEB00001.ms');
    // Tamper with the existing file
    writeFileSync(target, 'CORRUPTED', 'utf8');
    expect(readFileSync(target, 'utf8')).toBe('CORRUPTED');
    // Re-run with explicit overwrite=true (default)
    installSeeds({ overwrite: true });
    const body = readFileSync(target, 'utf8');
    expect(body).not.toBe('CORRUPTED');
    expect(body.startsWith('[GENOME]\n')).toBe(true);
  });

  it('overwrites an existing .msb file with the seed/msb/ source', async () => {
    const { installSeeds } = await loadSeedInstaller();
    installSeeds();
    const msbDir = join(homeDir, 'registry', 'msb');
    const installed = readdirSync(msbDir);
    const target = join(msbDir, installed[0]!);
    writeFileSync(target, 'CORRUPTED-MSB', 'utf8');
    installSeeds({ overwrite: true });
    expect(readFileSync(target, 'utf8')).not.toBe('CORRUPTED-MSB');
    // Must match the source file in seed/msb/ byte-for-byte
    const srcFile = join(process.cwd(), 'seed', 'msb', installed[0]!);
    expect(existsSync(srcFile)).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe(readFileSync(srcFile, 'utf8'));
  });
});

// ─── 3. .ms content structure ──────────────────────────────────────────────

describe('buildMsContent (via .ms file inspection)', () => {
  it('MS_WEB00001.ms declares web_search tool', async () => {
    const { installSeeds } = await loadSeedInstaller();
    installSeeds();
    const body = readFileSync(join(homeDir, 'registry', 'ms', 'MS_WEB00001.ms'), 'utf8');
    expect(body).toContain('[TOOLS]');
    expect(body).toContain('web_search');
    expect(body).toContain('web_search.msb');
    expect(body).toContain('[GRAVEYARD]');
  });

  it('MS_FREAD0001.ms declares file_read tool', async () => {
    const { installSeeds } = await loadSeedInstaller();
    installSeeds();
    const body = readFileSync(join(homeDir, 'registry', 'ms', 'MS_FREAD0001.ms'), 'utf8');
    expect(body).toContain('file_read');
    expect(body).toContain('file_read.msb');
  });

  it('MS_FWRITE001.ms declares file_write tool', async () => {
    const { installSeeds } = await loadSeedInstaller();
    installSeeds();
    const body = readFileSync(join(homeDir, 'registry', 'ms', 'MS_FWRITE001.ms'), 'utf8');
    expect(body).toContain('file_write');
    expect(body).toContain('file_write.msb');
  });

  it('each .ms file body includes a descriptive comment block', async () => {
    const { installSeeds } = await loadSeedInstaller();
    installSeeds();
    const msDir = join(homeDir, 'registry', 'ms');
    for (const f of readdirSync(msDir)) {
      const body = readFileSync(join(msDir, f), 'utf8');
      expect(body).toMatch(/# description: /);
      expect(body).toMatch(/# generation: 1/);
      expect(body).toMatch(/# status: active/);
    }
  });
});

// ─── 4. assembleGenome integration (genome section layout) ─────────────────

describe('genome section layout (via installed .ms files)', () => {
  it('section 0 (IDENTITY) of MS_WEB00001.ms starts with WEB00001G1AlienClaw1', async () => {
    const { installSeeds } = await loadSeedInstaller();
    installSeeds();
    const body = readFileSync(join(homeDir, 'registry', 'ms', 'MS_WEB00001.ms'), 'utf8');
    const genome = body.split('\n')[1]!;
    // Identity section is the first 64 chars (positions 0..63)
    const identity = genome.slice(0, 64);
    expect(identity.startsWith('WEB00001G1AlienClaw1')).toBe(true);
  });

  it('section 1 (EXECUTION) of MS_WEB00001.ms starts with "3R" (maxAttempts=4, backoff=2000ms)', async () => {
    const { installSeeds } = await loadSeedInstaller();
    installSeeds();
    const body = readFileSync(join(homeDir, 'registry', 'ms', 'MS_WEB00001.ms'), 'utf8');
    const genome = body.split('\n')[1]!;
    const execution = genome.slice(64, 128);
    expect(execution.startsWith('3R')).toBe(true);
  });

  it('section 2 (BEHAVIOR) of MS_WEB00001.ms starts with "E" (EscalateStd, failForward=false)', async () => {
    const { installSeeds } = await loadSeedInstaller();
    installSeeds();
    const body = readFileSync(join(homeDir, 'registry', 'ms', 'MS_WEB00001.ms'), 'utf8');
    const genome = body.split('\n')[1]!;
    const behavior = genome.slice(128, 192);
    expect(behavior.startsWith('E')).toBe(true);
  });

  it('genome is always 256 chars and contains only Base62 alphabet', async () => {
    const { installSeeds } = await loadSeedInstaller();
    installSeeds();
    const msDir = join(homeDir, 'registry', 'ms');
    for (const f of readdirSync(msDir)) {
      const body = readFileSync(join(msDir, f), 'utf8');
      const genome = body.split('\n')[1]!;
      expect(genome).toHaveLength(256);
      expect(genome).toMatch(/^[0-9A-Za-z]+$/);
    }
  });
});

// ─── 5. Wall-clean check on the SOURCE file (not this test) ─────────────────

describe('wall-clean (banned-term grep on the SOURCE file under test)', () => {
  it('src/alienclaw/registry/seed-installer.ts contains zero references to banned wall terms', async () => {
    const { readFileSync } = await import('node:fs');
    const sourcePath = join(process.cwd(), 'src', 'alienclaw', 'registry', 'seed-installer.ts');
    const body = readFileSync(sourcePath, 'utf8');
    const bannedMatches = body.match(/\b(meeseeks|five-layer|5-layer|fifth-layer|Specialist)\b/gi);
    expect(bannedMatches).toBeNull();
  });
});
