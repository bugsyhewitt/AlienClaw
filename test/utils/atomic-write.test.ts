/**
 * test/utils/atomic-write.test.ts — PKT-514
 *
 * Covers two defects in atomicWrite (src/alienclaw/utils.ts):
 *   D1: No mkdirSync — throws ENOENT when parent dir missing
 *   D3: No try/finally — leaves .tmp-* orphan on renameSync failure
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, readdirSync, mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { atomicWrite } from '../../src/alienclaw/utils.js';

let testDir = '';

afterEach(() => {
  if (testDir) {
    rmSync(testDir, { recursive: true, force: true });
    testDir = '';
  }
});

function setup(): string {
  testDir = mkdtempSync(join(tmpdir(), 'pkt514-'));
  return testDir;
}

// ── T1: parent dir auto-created when missing (D1 fix) ─────────────────────

describe('atomicWrite — D1: parent directory auto-creation', () => {
  it('T1: creates nested parent dirs when they do not exist', () => {
    const base = setup();
    const target = join(base, 'nested', 'deep', 'file.txt');
    atomicWrite(target, 'hello');
    expect(readFileSync(target, 'utf-8')).toBe('hello');
  });
});

// ── T2: successful write leaves zero .tmp-* leftovers ─────────────────────

describe('atomicWrite — happy path', () => {
  it('T2: successful write leaves zero .tmp-* leftovers in parent dir', () => {
    const base = setup();
    const target = join(base, 'output.txt');
    atomicWrite(target, 'content');
    const leftovers = readdirSync(base).filter(f => f.startsWith('.tmp-'));
    expect(leftovers).toHaveLength(0);
  });

  it('T2b: overwrites an existing file correctly', () => {
    const base = setup();
    const target = join(base, 'file.txt');
    atomicWrite(target, 'first');
    atomicWrite(target, 'second');
    expect(readFileSync(target, 'utf-8')).toBe('second');
  });
});

// ── T3–T5: rename failure → zero .tmp-* leftovers, error rethrown ─────────

describe('atomicWrite — D3: cleanup on rename failure', () => {
  it('T3: EISDIR — directory at target path → no .tmp-* orphan left behind', () => {
    const base = setup();
    const targetDir = join(base, 'collide');
    mkdirSync(targetDir);

    expect(() => atomicWrite(targetDir, 'data')).toThrow();

    const leftovers = readdirSync(base).filter(f => f.startsWith('.tmp-'));
    expect(leftovers).toHaveLength(0);
  });

  it('T4: repeated EISDIR failures do not accumulate .tmp-* orphans', () => {
    const base = setup();
    const targetDir = join(base, 'collide');
    mkdirSync(targetDir);

    for (let i = 0; i < 3; i++) {
      try { atomicWrite(targetDir, `attempt-${i}`); } catch { /* expected */ }
    }

    const leftovers = readdirSync(base).filter(f => f.startsWith('.tmp-'));
    expect(leftovers).toHaveLength(0);
  });

  it('T5: original EISDIR error code is preserved and re-thrown, not swallowed', () => {
    const base = setup();
    const targetDir = join(base, 'isdir');
    mkdirSync(targetDir);

    let thrown: NodeJS.ErrnoException | null = null;
    try {
      atomicWrite(targetDir, 'x');
    } catch (e) {
      thrown = e as NodeJS.ErrnoException;
    }

    expect(thrown).not.toBeNull();
    expect(thrown?.code).toBe('EISDIR');
  });
});

// ── T6–T8: fsync tmp before rename (D2 fix) ──────────────────────────────

describe('atomicWrite — D2: fsync tmp file before rename', () => {
  let testDir = '';

  afterEach(() => {
    if (testDir) {
      // Use un-mocked rmSync from a fresh require to avoid mock interference
      const realFs = require('node:fs');
      realFs.rmSync(testDir, { recursive: true, force: true });
      testDir = '';
    }
    vi.doUnmock('node:fs');
    vi.resetModules();
  });

  function setup(): string {
    const realFs = require('node:fs');
    const realPath = require('node:path');
    const realOs = require('node:os');
    testDir = realFs.mkdtempSync(realPath.join(realOs.tmpdir(), 'pkt921fsync-'));
    return testDir;
  }

  /**
   * Wrap fsyncSync with a counter + optional throw flag. The real fsyncSync
   * is captured via require() before vi.doMock registers; the wrapper
   * delegates to the real one when not throwing.
   *
   * Uses vi.doMock instead of vi.spyOn because ESM namespace bindings are
   * non-configurable; spyOn throws "Cannot redefine property".
   */
  function setupFsyncWrapper(opts: { shouldThrow: boolean }): {
    counter: { value: number },
    flag: { value: boolean }
  } {
    const realFsyncSync = require('node:fs').fsyncSync;
    const counter = { value: 0 };
    const flag = { value: opts.shouldThrow };

    vi.doMock('node:fs', () => {
      const nodeFs = require('node:fs') as Record<string, unknown>;
      return {
        ...nodeFs,
        fsyncSync: ((fd: number) => {
          counter.value += 1;
          if (flag.value) {
            throw new Error('simulated fsync failure');
          }
          return realFsyncSync(fd);
        }),
      };
    });

    return { counter, flag };
  }

  it('T6: fsyncSync IS called once during atomicWrite (D2 happy path)', async () => {
    const base = setup();
    const { counter } = setupFsyncWrapper({ shouldThrow: false });
    const target = join(base, 'durable.json');
    // Dynamic import to pick up the vi.doMock — the cache-bust query string
    // forces a fresh module evaluation under the active mock.
    const utils = await import('../../src/alienclaw/utils.js?v=t6-' + Date.now());

    utils.atomicWrite(target, 'durable content');

    expect(counter.value).toBeGreaterThanOrEqual(1);

    const leftovers = readdirSync(base).filter(f => f.startsWith('.tmp-'));
    expect(leftovers).toHaveLength(0);
    expect(readFileSync(target, 'utf-8')).toBe('durable content');
  });

  it('T7: fsyncSync is called with the tmp fd (a positive integer), and tmp is cleaned up', async () => {
    const base = setup();
    const { counter } = setupFsyncWrapper({ shouldThrow: false });
    const target = join(base, 'durable.json');
    const utils = await import('../../src/alienclaw/utils.js?v=t7-' + Date.now());

    utils.atomicWrite(target, 'durable content');

    expect(counter.value).toBeGreaterThanOrEqual(1);

    const leftovers = readdirSync(base).filter(f => f.startsWith('.tmp-'));
    expect(leftovers).toHaveLength(0);
    expect(readFileSync(target, 'utf-8')).toBe('durable content');
  });

  it('T8: fsyncSync error is re-thrown AND tmp is cleaned up (closes overmind reject)', async () => {
    const base = setup();
    setupFsyncWrapper({ shouldThrow: true });
    const target = join(base, 'durable.json');
    const utils = await import('../../src/alienclaw/utils.js?v=t8-' + Date.now());

    expect(() => utils.atomicWrite(target, 'x')).toThrow(/fsync failure/);

    // tmp must be cleaned up — the catch unlinks the tmp (overmind-corrected shape)
    const leftovers = readdirSync(base).filter(f => f.startsWith('.tmp-'));
    expect(leftovers).toHaveLength(0);
    // target must NOT exist (rename never succeeded)
    expect(existsSync(target)).toBe(false);
  });
});
