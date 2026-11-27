/**
 * Regression (2026-11-26 security review, F1): over-long paths are refused up front.
 *
 * The root-bounded symlink walk called realpathLoose once per component, so its cost
 * grew with the square of the path length (the Python twin took ~30 s for the 8 KB
 * input below). A path over 4096 bytes (PATH_MAX) or with more than 256 components is
 * now refused (INVALID_PATH, the Python twin's message) before any filesystem call, by
 * both entry points, and the walk itself is linear.
 */
import * as fsSync from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, lstat: vi.fn(actual.lstat), readlink: vi.fn(actual.readlink) };
});

import * as fsp from 'node:fs/promises';
import {
  BoundaryError,
  assertInsideBoundary,
  assertNoSymlink,
  readFileJailed,
  writeFileJailed,
} from '../src/fs-jail.js';

const REVIEWER_PATH = `${'../'.repeat(9)}nonexistent-zz/${'a/'.repeat(4000)}x.txt`;
const BUDGET_MS = 1000;

let ws = '';
beforeEach(() => {
  ws = fsSync.realpathSync(fsSync.mkdtempSync(path.join(os.tmpdir(), 'fsjail-cap-')));
});
afterEach(() => {
  vi.mocked(fsp.lstat).mockClear();
  fsSync.rmSync(ws, { recursive: true, force: true });
});

async function refusal(p: Promise<unknown>): Promise<BoundaryError> {
  const err = await p.then(
    () => { throw new Error('expected a BoundaryError, got success'); },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(BoundaryError);
  return err as BoundaryError;
}

describe('fs-jail: path length and component caps (F1)', () => {
  const cases: [string, string, string][] = [
    ['8 KB reviewer path', REVIEWER_PATH, '4096-byte limit'],
    ['300 components', `${'a/'.repeat(300)}x.txt`, '256-component limit'],
    ['300 dot-dots', `${'../'.repeat(300)}x.txt`, '256-component limit'],
  ];
  for (const [name, input, limit] of cases) {
    it(`read and write refuse the ${name} fast`, async () => {
      const start = performance.now();
      const r = await refusal(readFileJailed(input, ws, { maxBytes: 1024 }));
      const w = await refusal(writeFileJailed(input, 'x', ws));
      const elapsed = performance.now() - start;
      for (const err of [r, w]) {
        expect(err.code).toBe('INVALID_PATH');
        expect(err.message).toMatch(/^Path rejected: /);
        expect(err.message).toContain(limit);
      }
      expect(elapsed).toBeLessThan(BUDGET_MS);
    });
  }

  it('both entry points refuse before any lstat', async () => {
    vi.mocked(fsp.lstat).mockClear();
    for (const input of [REVIEWER_PATH, `${'a/'.repeat(300)}x.txt`]) {
      await refusal(assertInsideBoundary(input, ws));
      await refusal(assertNoSymlink(`${ws}/${input}`, { operation: 'read', root: ws }));
      await refusal(assertNoSymlink(`${ws}/${input}`));
    }
    expect(vi.mocked(fsp.lstat)).not.toHaveBeenCalled();
  });

  it('limits are inclusive and count UTF-8 bytes', async () => {
    const atParts = Array(256).fill('p').join('/');
    for (const input of ['a'.repeat(4096), atParts]) {
      const err = await assertInsideBoundary(input, ws).then(() => undefined, (e: Error) => e);
      expect(err?.message ?? '').not.toMatch(/^Path rejected: /);
    }
    expect((await refusal(assertInsideBoundary('a'.repeat(4097), ws))).message).toContain('4097 bytes');
    expect((await refusal(assertInsideBoundary(`${atParts}/p`, ws))).message).toContain('257 components');
    expect((await refusal(assertInsideBoundary('é'.repeat(2049), ws))).message).toContain('4098 bytes');
  });

  it('a 255-component path inside the root still works, and the walk is linear', async () => {
    const rel = [...Array(254).fill('d'), 'x.txt'].join('/');
    const start = performance.now();
    await writeFileJailed(rel, 'deep', ws, { createParents: true });
    vi.mocked(fsp.lstat).mockClear();
    await expect(readFileJailed(rel, ws, { maxBytes: 1024, encoding: 'utf8' })).resolves.toBe('deep');
    expect(performance.now() - start).toBeLessThan(BUDGET_MS * 3);
    // Linear: the walk lstats each in-root entry once (realpathLoose of the root and of
    // the containment check add one pass each), not once per prefix per component.
    expect(vi.mocked(fsp.lstat).mock.calls.length).toBeLessThan(4 * 260);
  });

  it('an in-root symlink deep in the path is still refused', async () => {
    const deep = path.join(ws, ...Array(100).fill('d'));
    fsSync.mkdirSync(deep, { recursive: true });
    fsSync.symlinkSync(ws, path.join(deep, 'link'));
    const rel = [...Array(100).fill('d'), 'link', 'x.txt'].join('/');
    const err = await refusal(readFileJailed(rel, ws, { maxBytes: 1024 }));
    expect(err.code).toBe('SYMLINK_IN_PATH');
  });
});
