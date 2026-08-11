/**
 * test/utils/atomic-write.test.ts — PKT-514
 *
 * Covers two defects in atomicWrite (src/alienclaw/utils.ts):
 *   D1: No mkdirSync — throws ENOENT when parent dir missing
 *   D3: No try/finally — leaves .tmp-* orphan on renameSync failure
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, readdirSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
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
