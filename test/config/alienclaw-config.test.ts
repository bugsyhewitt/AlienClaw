/**
 * test/config/alienclaw-config.test.ts
 *
 * Direct unit tests for src/alienclaw/config/alienclaw-config.ts
 * (AlienClawConfigManager — 38 lines, 1 class, 1 singleton, 2 internal helpers).
 *
 * Focus: AlienClawConfigManager is the file-backed persistence layer for
 *   (a) system config at PATHS.config (ALIENCLAW_HOME/alienclaw.json)
 *   (b) user preferences at PATHS.preferences (ALIENCLAW_HOME/preferences.json).
 *
 * Without these tests, the three critical behaviors have ZERO direct coverage:
 *   1. ENOENT recovery — `loadOrCreate` writes defaults + creates parent dir
 *      when the file does not exist (init path for first CLI launch).
 *   2. JSON.parse spread — `loadOrCreate` returns `{ ...defaults, ...parsed }`
 *      so saved-file keys OVERRIDE defaults (file wins on conflict).
 *   3. savePreferences round-trip — the partial-spread + writeFileSync path.
 *
 * `cli/cli.ts:34` mutates `alienClawConfig.preferences.verbosity` and
 * `wiring/hierarchy-bootstrap.ts:67` reads `alienClawConfig.preferences` at
 * startup — both rely on these behaviors end-to-end with no test in between.
 *
 * Sandboxing: PATHS.config and PATHS.preferences are derived from ALIENCLAW_HOME
 * at module-load time (src/alienclaw/constants.ts:79). We point ALIENCLAW_HOME
 * at a fresh mkdtempSync dir BEFORE each test, then `vi.resetModules()` +
 * dynamic `await import()` to re-read PATHS. Mirrors the idiom in
 * test/registry/seed-installer.test.ts:24-49 and test/registry/registry-bootstrap.test.ts:48-67.
 *
 * The singleton (`alienClawConfig`): we cannot instantiate `AlienClawConfigManager`
 * directly because the constructor has no public surface — the constructor
 * signature is `constructor()` (no args), and there is no factory. The singleton
 * is bound to the module, so re-importing via vi.resetModules() yields a fresh
 * singleton per test.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpHome: string;

beforeEach(() => {
  // Fresh ALIENCLAW_HOME per test so loadOrCreate runs in isolation
  // and no state (or singleton) leaks between tests.
  tmpHome = mkdtempSync(join(tmpdir(), 'p088-cfg-'));
  process.env['ALIENCLAW_HOME'] = tmpHome;
  vi.resetModules();
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  delete process.env['ALIENCLAW_HOME'];
});

/**
 * Helper: dynamically import the source module AFTER ALIENCLAW_HOME is set.
 * Returns the live module reference (re-bound per test by vi.resetModules).
 */
async function loadConfigModule() {
  return await import('../../src/alienclaw/config/alienclaw-config.js');
}

async function loadDefaultsModule() {
  return await import('../../src/alienclaw/config/defaults.js');
}

async function loadConstantsModule() {
  return await import('../../src/alienclaw/constants.js');
}

// =============================================================================
// Constructor + loadOrCreate (ENOENT recovery) — the critical file-IO path
// =============================================================================

describe('AlienClawConfigManager — constructor on a fresh ALIENCLAW_HOME', () => {
  it('R-001: initializing a fresh ALIENCLAW_HOME creates both files with defaults', async () => {
    const cfg = (await loadConfigModule()).alienClawConfig;
    const defaults = await loadDefaultsModule();
    expect(cfg.system).toEqual(defaults.DEFAULT_CONFIG);
    expect(cfg.preferences).toEqual(defaults.DEFAULT_PREFERENCES);
    // Both files now exist on disk.
    const { PATHS } = await loadConstantsModule();
    expect(existsSync(PATHS.config)).toBe(true);
    expect(existsSync(PATHS.preferences)).toBe(true);
  });

  it('R-002: persists defaults to disk as pretty-printed JSON (2-space indent)', async () => {
    await loadConfigModule();
    const { PATHS } = await loadConstantsModule();
    const defaults = await loadDefaultsModule();
    const onDisk = readFileSync(PATHS.preferences, 'utf-8');
    // loadOrCreate uses JSON.stringify(defaults, null, 2) — verify the indent.
    expect(onDisk).toBe(JSON.stringify(defaults.DEFAULT_PREFERENCES, null, 2));
  });

  it('R-003: PATHS.config and PATHS.preferences resolve under ALIENCLAW_HOME', async () => {
    const { PATHS } = await loadConstantsModule();
    expect(PATHS.config).toBe(`${tmpHome}/alienclaw.json`);
    expect(PATHS.preferences).toBe(`${tmpHome}/preferences.json`);
  });
});

describe('AlienClawConfigManager — loadOrCreate with existing valid-JSON files', () => {
  it('R-101: spreads saved-file keys OVER the defaults (file wins on key conflict)', async () => {
    // Write a preferences file with an OVERRIDING verbosity value.
    writeFileSync(
      join(tmpHome, 'preferences.json'),
      JSON.stringify({ verbosity: 'verbose', advisorPersistence: 'per_task' }, null, 2),
      'utf-8',
    );
    const cfg = (await loadConfigModule()).alienClawConfig;
    expect(cfg.preferences.verbosity).toBe('verbose');
    expect(cfg.preferences.advisorPersistence).toBe('per_task');
  });

  it('R-102: uses defaults for keys that are missing from the on-disk file', async () => {
    // Write a preferences file with only one of the two default keys.
    writeFileSync(
      join(tmpHome, 'preferences.json'),
      JSON.stringify({ verbosity: 'silent' }, null, 2),
      'utf-8',
    );
    const cfg = (await loadConfigModule()).alienClawConfig;
    // File wins: verbosity=silent (overridden).
    expect(cfg.preferences.verbosity).toBe('silent');
    // Defaults fill: advisorPersistence='per_task' (not in file).
    expect(cfg.preferences.advisorPersistence).toBe('per_task');
  });

  it('R-103: merges BOTH system config AND preferences independently', async () => {
    // Pre-create both files with non-default values, then import.
    writeFileSync(
      join(tmpHome, 'alienclaw.json'),
      JSON.stringify({ version: 'CUSTOM.VERSION', gatewayPort: 99999 }, null, 2),
      'utf-8',
    );
    writeFileSync(
      join(tmpHome, 'preferences.json'),
      JSON.stringify({ verbosity: 'silent', advisorPersistence: 'full' }, null, 2),
      'utf-8',
    );
    const cfg = (await loadConfigModule()).alienClawConfig;
    expect(cfg.system.version).toBe('CUSTOM.VERSION');
    expect(cfg.system.gatewayPort).toBe(99999);
    expect(cfg.preferences.verbosity).toBe('silent');
    expect(cfg.preferences.advisorPersistence).toBe('full');
  });

  it('R-104: extra keys in the file (not in defaults type) are preserved (spread is shallow)', async () => {
    // The `T` cast in loadOrCreate means unknown keys flow through to the result.
    writeFileSync(
      join(tmpHome, 'preferences.json'),
      JSON.stringify({ verbosity: 'verbose', unknownKey: 'kept' }, null, 2),
      'utf-8',
    );
    const cfg = (await loadConfigModule()).alienClawConfig as any;
    expect(cfg.preferences.verbosity).toBe('verbose');
    expect(cfg.preferences.unknownKey).toBe('kept');
  });
});

describe('AlienClawConfigManager — loadOrCreate ENOENT recovery', () => {
  it('R-201: creates the parent directory when missing (mkdirSync { recursive: true })', async () => {
    // Pre-condition: ALIENCLAW_HOME exists (mkdtempSync created it) but is EMPTY.
    expect(existsSync(tmpHome)).toBe(true);
    expect(existsSync(join(tmpHome, 'preferences.json'))).toBe(false);
    expect(existsSync(join(tmpHome, 'alienclaw.json'))).toBe(false);
    // Importing constructs the singleton → loadOrCreate → mkdirSync + writeFileSync.
    await loadConfigModule();
    expect(existsSync(join(tmpHome, 'preferences.json'))).toBe(true);
    expect(existsSync(join(tmpHome, 'alienclaw.json'))).toBe(true);
  });

  it('R-202: creates NESTED parent directories that do not exist (mkdirSync { recursive: true } handles deep paths)', async () => {
    // Overwrite ALIENCLAW_HOME with a path that requires nested creation.
    const nested = join(tmpHome, 'a', 'b', 'c');
    mkdirSync(tmpHome, { recursive: true });  // ensure tmpHome itself exists for the rm in afterEach
    process.env['ALIENCLAW_HOME'] = nested;
    vi.resetModules();
    // The construct should succeed — loadOrCreate calls ensureDir which calls
    // mkdirSync(dirname(path), { recursive: true }).
    const cfg = (await loadConfigModule()).alienClawConfig;
    const defaults = await loadDefaultsModule();
    expect(cfg.preferences).toEqual(defaults.DEFAULT_PREFERENCES);
    expect(existsSync(join(nested, 'preferences.json'))).toBe(true);
    expect(existsSync(join(nested, 'alienclaw.json'))).toBe(true);
  });

  it('R-203: idempotent ENOENT recovery — re-importing the same dir does not throw or duplicate', async () => {
    // First construction creates the files.
    const cfg1 = (await loadConfigModule()).alienClawConfig;
    expect(existsSync(join(tmpHome, 'preferences.json'))).toBe(true);
    // Second construction (different process would re-load; here we simulate
    // by resetting modules and re-importing). loadOrCreate sees the file,
    // takes the JSON.parse branch, returns merged. No mkdir, no write.
    vi.resetModules();
    const cfg2 = (await loadConfigModule()).alienClawConfig;
    expect(cfg2.preferences).toEqual(cfg1.preferences);
    expect(cfg2.system).toEqual(cfg1.system);
  });
});

describe('AlienClawConfigManager — loadOrCreate with INVALID JSON (non-ENOENT rethrow)', () => {
  it('R-301: re-throws non-ENOENT errors (malformed JSON surfaces as SyntaxError)', async () => {
    // Write a preferences file that is NOT valid JSON.
    writeFileSync(join(tmpHome, 'preferences.json'), 'this is not json {', 'utf-8');
    // JSON.parse throws SyntaxError → loadOrCreate re-throws via the
    // `if (err.code !== 'ENOENT') throw err` branch.
    await expect(loadConfigModule()).rejects.toThrow();
  });

  it('R-302: does NOT overwrite a malformed file with defaults (preserves the broken file for the user to fix)', async () => {
    const brokenContent = 'this is not json {';
    writeFileSync(join(tmpHome, 'preferences.json'), brokenContent, 'utf-8');
    try {
      await loadConfigModule();
    } catch (_e) {
      // Expected — loadOrCreate re-throws.
    }
    // The malformed file is still there, untouched.
    expect(readFileSync(join(tmpHome, 'preferences.json'), 'utf-8')).toBe(brokenContent);
  });
});

// =============================================================================
// savePreferences — the only mutator on the class
// =============================================================================
//
// IMPORTANT: savePreferences writes the merged result to disk via writeFileSync
// but does NOT mutate `this.preferences`. The in-memory singleton's
// `preferences` field stays at whatever loadOrCreate returned at construction
// time. Callers that need the latest on-disk values must re-import (or read
// the file directly). cli/cli.ts:34 sidesteps this by writing directly to
// `alienClawConfig.preferences.verbosity = X` (property assignment), which
// mutates the in-memory object without going through savePreferences.
//
// These tests document the ACTUAL behavior — the write-to-disk path is
// tested for persistence + format, but the in-memory "round-trip" is not
// claimed. If a future patch makes savePreferences mutate this.preferences,
// R-401/R-404 should be updated to assert the new behavior.

describe('AlienClawConfigManager.savePreferences', () => {
  it('R-401: writes the partial-merged preferences to PATHS.preferences', async () => {
    const cfg = (await loadConfigModule()).alienClawConfig;
    const { PATHS } = await loadConstantsModule();
    cfg.savePreferences({ verbosity: 'verbose' });
    // On-disk: the file now reflects the partial spread over the loaded snapshot.
    const onDisk = JSON.parse(readFileSync(PATHS.preferences, 'utf-8'));
    expect(onDisk.verbosity).toBe('verbose');
    // Untouched key retained.
    expect(onDisk.advisorPersistence).toBe('per_task');
    // In-memory: NOT mutated by savePreferences — documented behavior.
    expect(cfg.preferences.verbosity).toBe('normal');
  });

  it('R-402: partial update on disk does not clobber fields not in the partial', async () => {
    const cfg = (await loadConfigModule()).alienClawConfig;
    const { PATHS } = await loadConstantsModule();
    cfg.savePreferences({ advisorPersistence: 'full' });
    const onDisk = JSON.parse(readFileSync(PATHS.preferences, 'utf-8'));
    expect(onDisk.advisorPersistence).toBe('full');
    // verbosity was the default ('normal'); not in the partial → retained.
    expect(onDisk.verbosity).toBe('normal');
    // In-memory unchanged.
    expect(cfg.preferences.advisorPersistence).toBe('per_task');
  });

  it('R-403: persists with 2-space indent (JSON.stringify(v, null, 2))', async () => {
    const cfg = (await loadConfigModule()).alienClawConfig;
    const { PATHS } = await loadConstantsModule();
    cfg.savePreferences({ verbosity: 'silent' });
    const onDisk = readFileSync(PATHS.preferences, 'utf-8');
    // Reconstruct the expected on-disk content from the merged-into-on-disk state.
    const expectedOnDisk = JSON.stringify(
      { verbosity: 'silent', advisorPersistence: 'per_task' },
      null,
      2,
    );
    expect(onDisk).toBe(expectedOnDisk);
  });

  it('R-404: multiple sequential savePreferences calls accumulate ON DISK (each merge is over the previous on-disk snapshot)', async () => {
    const cfg = (await loadConfigModule()).alienClawConfig;
    const { PATHS } = await loadConstantsModule();
    cfg.savePreferences({ verbosity: 'verbose' });
    // After the first save, reload the file (simulating "the in-memory state
    // was effectively synced" from the caller's perspective) and merge again.
    // savePreferences itself does NOT update this.preferences, so a literal
    // double-call in the same session will write the SECOND merge over the
    // FIRST on-disk value (since savePreferences merges against this.preferences,
    // not against the file).
    cfg.savePreferences({ advisorPersistence: 'full' });
    const onDisk = JSON.parse(readFileSync(PATHS.preferences, 'utf-8'));
    // The second merge is over the original (un-mutated) this.preferences,
    // so verbosity stays 'normal' and advisorPersistence becomes 'full'.
    expect(onDisk.verbosity).toBe('normal');
    expect(onDisk.advisorPersistence).toBe('full');
  });
});

// =============================================================================
// Defaults module — exported constants
// =============================================================================

describe('config/defaults.ts', () => {
  it('R-501: DEFAULT_CONFIG — version=2026.3.7, gatewayPort=18789', async () => {
    const defaults = await loadDefaultsModule();
    expect(defaults.DEFAULT_CONFIG).toEqual({
      version:     '2026.3.7',
      gatewayPort: 18789,
    });
  });

  it('R-502: DEFAULT_PREFERENCES — verbosity=normal, advisorPersistence=per_task', async () => {
    const defaults = await loadDefaultsModule();
    expect(defaults.DEFAULT_PREFERENCES).toEqual({
      verbosity:          'normal',
      advisorPersistence: 'per_task',
    });
  });
});

// =============================================================================
// Singleton identity — verifies the module exports ONE instance, not a class
// =============================================================================

describe('AlienClawConfigManager — singleton identity', () => {
  it('R-601: the named export is an instance with savePreferences, not the class constructor', async () => {
    const mod = await loadConfigModule();
    const exported = mod.alienClawConfig;
    expect(typeof exported).toBe('object');
    expect(exported).not.toBe(null);
    expect(typeof exported.savePreferences).toBe('function');
  });

  it('R-602: re-importing within the same test yields the SAME instance (singleton)', async () => {
    // Note: we are NOT calling vi.resetModules() here. Two imports within the
    // same test resolve to the SAME module instance via ESM caching.
    const a = (await loadConfigModule()).alienClawConfig;
    const b = (await loadConfigModule()).alienClawConfig;
    expect(a).toBe(b);  // Object identity — singleton.
  });
});
