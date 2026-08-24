/**
 * test/utils/atomic-write-d2-cleanup.test.ts — PKT-933 corrective re-author
 *
 * Closes the D2 gap in atomicWrite (src/alienclaw/utils.ts): writeFileSync
 * partial-failure leaves a partial .tmp-<UUID> orphan on disk. PKT-514
 * shipped D1 (mkdir) + D3 (rename cleanup) but deferred D2 (write cleanup).
 *
 * Adds tests covering:
 *   T1: ENOSPC mid-write → zero orphans, ENOSPC rethrown, no destination
 *   T2: EIO mid-write → zero orphans, EIO rethrown, no destination
 *   T3: EMFILE mid-write → zero orphans, EMFILE rethrown, no destination
 *   T4: 5x repeated ENOSPC failures do not accumulate orphans
 *   T5: happy path unchanged (sanity)
 *
 * The 5 existing tests (T1-T5 in atomic-write.test.ts: D1 mkdir + D3 rename
 * cleanup) must continue to pass — this file is additive, no edits to the
 * pre-existing D1/D3 blocks.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  readdirSync,
  mkdtempSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { atomicWrite } from '../../src/alienclaw/utils.js';

let testDir = '';

afterEach(() => {
  if (testDir) {
    rmSync(testDir, { recursive: true, force: true });
    testDir = '';
  }
  vi.doUnmock('node:fs');
  vi.resetModules();
});

function setup(): string {
  testDir = mkdtempSync(join(tmpdir(), 'pkt919-'));
  return testDir;
}

/**
 * Helper: configure vi.doMock to make writeFileSync write 10 bytes and then
 * throw with the given errCode for any path matching '.tmp-'. Non-.tmp-
 * paths pass through to the real writeFileSync (so readdirSync, etc. work).
 *
 * Imports of src/alienclaw/utils.js via dynamic import() pick up the mock.
 */
function mockFailingWriteFileSync(errCode: 'ENOSPC' | 'EIO' | 'EMFILE'): void {
  // Capture the real writeFileSync via require() before vi.doMock registers.
  // The wrapper below delegates to this captured reference for the
  // partial-write commit (10 bytes) and for non-.tmp-* pass-through.
  const realWriteFileSync = require('node:fs').writeFileSync;

  vi.doMock('node:fs', () => {
    const nodeFs = require('node:fs') as Record<string, unknown>;
    return {
      ...nodeFs,
      writeFileSync: ((
        path: string,
        data: string | Buffer,
        options?: { encoding?: BufferEncoding },
      ) => {
        const pathStr = String(path);
        if (pathStr.includes('.tmp-')) {
          const str = typeof data === 'string' ? data : (data as Buffer).toString();
          realWriteFileSync(path, str.slice(0, 10), options);
          const err = new Error(`${errCode}: simulated partial write`) as NodeJS.ErrnoException;
          err.code = errCode;
          throw err;
        }
        return realWriteFileSync(path, data as string, options);
      }),
    };
  });
}

describe('atomicWrite — D2: cleanup on writeFileSync partial-failure (PKT-919)', () => {
  it('T1: ENOSPC mid-write → zero .tmp-* orphans, ENOSPC rethrown, no destination', async () => {
    vi.resetModules();
    mockFailingWriteFileSync('ENOSPC');
    const base = setup();
    const target = join(base, 'output.txt');
    const utils = await import('../../src/alienclaw/utils.js?v=t1-' + Date.now());

    let thrown: NodeJS.ErrnoException | null = null;
    try {
      utils.atomicWrite(target, 'this is the full content that should not be partially written');
    } catch (e) {
      thrown = e as NodeJS.ErrnoException;
    }

    expect(thrown).not.toBeNull();
    expect(thrown?.code).toBe('ENOSPC');
    expect(readdirSync(base).filter(f => f.startsWith('.tmp-'))).toHaveLength(0);
    expect(existsSync(target)).toBe(false);
  });

  it('T2: EIO mid-write → zero .tmp-* orphans, EIO rethrown, no destination', async () => {
    vi.resetModules();
    mockFailingWriteFileSync('EIO');
    const base = setup();
    const target = join(base, 'output.txt');
    const utils = await import('../../src/alienclaw/utils.js?v=t2-' + Date.now());

    let thrown: NodeJS.ErrnoException | null = null;
    try {
      utils.atomicWrite(target, 'this is the full content...');
    } catch (e) {
      thrown = e as NodeJS.ErrnoException;
    }

    expect(thrown).not.toBeNull();
    expect(thrown?.code).toBe('EIO');
    expect(readdirSync(base).filter(f => f.startsWith('.tmp-'))).toHaveLength(0);
    expect(existsSync(target)).toBe(false);
  });

  it('T3: EMFILE mid-write → zero .tmp-* orphans, EMFILE rethrown, no destination', async () => {
    vi.resetModules();
    mockFailingWriteFileSync('EMFILE');
    const base = setup();
    const target = join(base, 'output.txt');
    const utils = await import('../../src/alienclaw/utils.js?v=t3-' + Date.now());

    let thrown: NodeJS.ErrnoException | null = null;
    try {
      utils.atomicWrite(target, 'this is the full content...');
    } catch (e) {
      thrown = e as NodeJS.ErrnoException;
    }

    expect(thrown).not.toBeNull();
    expect(thrown?.code).toBe('EMFILE');
    expect(readdirSync(base).filter(f => f.startsWith('.tmp-'))).toHaveLength(0);
    expect(existsSync(target)).toBe(false);
  });

  it('T4: 5x repeated ENOSPC failures do not accumulate .tmp-* orphans', async () => {
    vi.resetModules();
    mockFailingWriteFileSync('ENOSPC');
    const base = setup();
    const target = join(base, 'output.txt');
    const utils = await import('../../src/alienclaw/utils.js?v=t4-' + Date.now());

    for (let i = 0; i < 5; i++) {
      let thrown: NodeJS.ErrnoException | null = null;
      try {
        utils.atomicWrite(target, `attempt-${i}`);
      } catch (e) {
        thrown = e as NodeJS.ErrnoException;
      }
      expect(thrown?.code).toBe('ENOSPC');
      expect(readdirSync(base).filter(f => f.startsWith('.tmp-'))).toHaveLength(0);
    }
  });

  it('T5: happy path unchanged — successful write, no .tmp-* orphans (sanity)', () => {
    const base = setup();
    const target = join(base, 'output.txt');
    atomicWrite(target, 'happy-path-content');

    expect(existsSync(target)).toBe(true);
    expect(readdirSync(base).filter(f => f.startsWith('.tmp-'))).toHaveLength(0);
  });
});
