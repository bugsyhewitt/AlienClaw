/**
 * Filesystem jail: the symlink gate checks only inside the root (2026-11-26).
 *
 * TS twin of python/tests/test_symlinked_prefix.py and
 * python/tests/test_outside_generic_refusal.py (themselves adapted from the
 * reference suite's test/tools/test_boundary_symlinked_prefix.py and
 * test_boundary_outside_generic_refusal.py).
 *
 * - A symlinked PREFIX (an ancestor of the root, or the root's own entry: macOS
 *   /tmp -> /private/tmp, a symlinked home, an unresolved deploy path) is
 *   accepted when the resolved path is inside the root.
 * - A symlink inside the root is still refused (SYMLINK / SYMLINK_IN_PATH).
 * - An out-of-boundary path is not probed: its only refusal is the generic
 *   TRAVERSAL ('Path traversal rejected: "<path>" resolves outside workspace
 *   boundary'), and the gate lstat()s nothing outside the root. The only lstat
 *   calls left outside are realpathLoose's (the port of CPython's non-strict
 *   realpath), which the spy below excludes by stack frame, as the Python test
 *   excludes os.path.realpath's frames.
 *
 * node:fs/promises is replaced, for this file only, by the real module with
 * lstat wrapped in vi.fn. Fixtures are built with node:fs sync calls (not mocked).
 */

import * as fsSync from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, lstat: vi.fn(actual.lstat) };
});

import * as fsp from 'node:fs/promises';
import {
  BoundaryError,
  assertNoSymlink,
  readFileJailed,
  writeFileJailed,
  type BoundaryErrorCode,
} from '../src/fs-jail.js';

const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
const lstatMock = vi.mocked(fsp.lstat);

const TEXT = 'inside the workspace\n';
const GENERIC = (p: string): string =>
  `Path traversal rejected: "${p}" resolves outside workspace boundary`;

let tmp: string;
let savedStackTraceLimit: number;

beforeAll(() => {
  savedStackTraceLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = 200; // the spy reads the caller frames
});

afterAll(() => {
  Error.stackTraceLimit = savedStackTraceLimit;
});

beforeEach(() => {
  tmp = fsSync.realpathSync(fsSync.mkdtempSync(path.join(os.tmpdir(), 'fs-jail-root-')));
});

afterEach(() => {
  lstatMock.mockReset().mockImplementation(actual.lstat);
  const locked = path.join(tmp, 'locked');
  if (fsSync.existsSync(locked)) fsSync.chmodSync(locked, 0o700);
  fsSync.rmSync(tmp, { recursive: true, force: true });
});

async function rejection(promise: Promise<unknown>): Promise<BoundaryError> {
  const err = await promise.then(
    () => {
      throw new Error('expected a BoundaryError, got success');
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(BoundaryError);
  return err as BoundaryError;
}

async function rejectsWith(
  promise: Promise<unknown>,
  code: BoundaryErrorCode,
  message?: RegExp | string,
): Promise<BoundaryError> {
  const err = await rejection(promise);
  expect(err.code).toBe(code);
  if (typeof message === 'string') expect(err.message).toBe(message);
  else if (message) expect(err.message).toMatch(message);
  return err;
}

/** Record every lstat not issued by realpathLoose (the non-strict realpath port). */
function startProbes(): { seen: string[]; all: string[] } {
  const seen: string[] = [];
  const all: string[] = [];
  lstatMock.mockImplementation(((p: fsSync.PathLike, ...rest: unknown[]) => {
    all.push(String(p));
    if (!/\brealpathLoose\b/.test(new Error().stack ?? '')) seen.push(String(p));
    return (actual.lstat as (...a: unknown[]) => Promise<fsSync.Stats>)(p, ...rest);
  }) as typeof fsp.lstat);
  return { seen, all };
}

const atOrBelow = (p: string, root: string): boolean => p === root || p.startsWith(`${root}/`);

// ── symlinked prefix is accepted ─────────────────────────────────────────────

describe.skipIf(process.platform === 'win32')('symlinked prefix', () => {
  let ws: string;
  let root: string;

  beforeEach(() => {
    ws = path.join(tmp, 'real', 'ws');
    fsSync.mkdirSync(ws, { recursive: true });
    fsSync.writeFileSync(path.join(ws, 'notes.txt'), TEXT);
    fsSync.symlinkSync(path.join(tmp, 'real'), path.join(tmp, 'link'));
    fsSync.symlinkSync(ws, path.join(tmp, 'wslink'));
    root = fsSync.realpathSync(path.join(tmp, 'link', 'ws'));
    expect(root).toBe(ws);
  });

  const viaPrefix = (name: string, form: string): string =>
    ({
      'abs-link': path.join(tmp, 'link', 'ws', name), // symlinked ancestor of the root
      'abs-wslink': path.join(tmp, 'wslink', name), // the root's own entry is a symlink
      'rel-link': `../../link/ws/${name}`, // leaves and re-enters via the link
    })[form]!;
  const FORMS = ['abs-link', 'abs-wslink', 'rel-link'];

  it.each(FORMS)('read through a symlinked prefix succeeds (%s)', async (form) => {
    expect(
      await readFileJailed(viaPrefix('notes.txt', form), root, { maxBytes: 1024, encoding: 'utf8' }),
    ).toBe(TEXT);
  });

  it.each(FORMS)('write through a symlinked prefix succeeds (%s)', async (form) => {
    const target = await writeFileJailed(viaPrefix('out.txt', form), 'hi\n', root);
    expect(target).toBe(path.join(root, 'out.txt'));
    expect(fsSync.readFileSync(path.join(ws, 'out.txt'), 'utf8')).toBe('hi\n');
    expect(fsSync.lstatSync(path.join(tmp, 'link')).isSymbolicLink()).toBe(true);
  });

  it.each(['link', 'wslink'])('an unresolved root works (%s)', async (form) => {
    const unresolved = form === 'link' ? path.join(tmp, 'link', 'ws') : path.join(tmp, 'wslink');
    const opts = { maxBytes: 1024, encoding: 'utf8' } as const;
    expect(await readFileJailed(path.join(unresolved, 'notes.txt'), unresolved, opts)).toBe(TEXT);
    expect(await readFileJailed('notes.txt', unresolved, opts)).toBe(TEXT);
    await writeFileJailed(path.join(unresolved, 'w.txt'), 'w\n', unresolved);
    expect(fsSync.readFileSync(path.join(ws, 'w.txt'), 'utf8')).toBe('w\n');
  });

  it.each(FORMS)('without root the full walk still refuses the prefix (%s)', async (form) => {
    const p = viaPrefix('notes.txt', form);
    await rejectsWith(
      assertNoSymlink(p.startsWith('/') ? p : `${root}/${p}`, { operation: 'read' }),
      'SYMLINK_IN_PATH',
    );
  });

  describe('policy kept: symlinks at or below the root are still refused', () => {
    beforeEach(() => {
      fsSync.mkdirSync(path.join(ws, 'sub'));
      fsSync.writeFileSync(path.join(ws, 'sub', 'f.txt'), TEXT);
      fsSync.symlinkSync(path.join(ws, 'notes.txt'), path.join(ws, 'alias.txt'));
      fsSync.symlinkSync(path.join(ws, 'sub'), path.join(ws, 'sub_alias'));
      fsSync.symlinkSync(ws, path.join(ws, 'self'));
      fsSync.symlinkSync(path.dirname(ws), path.join(ws, 'up'));
    });

    const CASES: [string, BoundaryErrorCode, string][] = [
      ['alias.txt', 'SYMLINK', 'Symlink rejected'],
      ['sub_alias/f.txt', 'SYMLINK_IN_PATH', 'Symlink in path rejected'],
      ['self/notes.txt', 'SYMLINK_IN_PATH', 'Symlink in path rejected'],
      ['up/ws/notes.txt', 'SYMLINK_IN_PATH', 'Symlink in path rejected'],
    ];

    for (const prefixed of [false, true]) {
      it.each(CASES)(
        `%s is refused (${prefixed ? 'via link prefix' : 'relative'})`,
        async (rel, code, message) => {
          const p = prefixed ? path.join(tmp, 'link', 'ws', rel) : rel;
          await rejectsWith(
            readFileJailed(p, root, { maxBytes: 1024 }),
            code,
            new RegExp(`^${message} on read: `),
          );
          await rejectsWith(
            writeFileJailed(p, 'OVERWRITTEN', root),
            code,
            new RegExp(`^${message} on write: `),
          );
          expect(fsSync.readFileSync(path.join(ws, 'notes.txt'), 'utf8')).toBe(TEXT);
          expect(fsSync.readFileSync(path.join(ws, 'sub', 'f.txt'), 'utf8')).toBe(TEXT);
        },
      );
    }

    it('the refusal names the in-root entry under the caller spelling', async () => {
      const spelled = path.join(tmp, 'link', 'ws', 'sub_alias');
      await rejectsWith(
        assertNoSymlink(`${spelled}/f.txt`, { operation: 'read', root }),
        'SYMLINK_IN_PATH',
        `Symlink in path rejected on read: "${spelled}" is a symbolic link`,
      );
      await rejectsWith(
        assertNoSymlink(`${root}/alias.txt`, { root }),
        'SYMLINK',
        `Symlink rejected on write: "${root}/alias.txt" is a symbolic link`,
      );
    });

    it('a relative path is anchored at the CWD (as in Python)', async () => {
      const cwd = process.cwd();
      process.chdir(tmp);
      try {
        await expect(
          assertNoSymlink('link/ws/notes.txt', { operation: 'read', root }),
        ).resolves.toBeUndefined();
        await rejectsWith(
          assertNoSymlink('link/ws/alias.txt', { operation: 'read', root }),
          'SYMLINK',
          `Symlink rejected on read: "${tmp}/link/ws/alias.txt" is a symbolic link`,
        );
      } finally {
        process.chdir(cwd);
      }
    });
  });

  it('the prefix is not probed; the in-root entry still is', async () => {
    const probes = startProbes();
    expect(
      await readFileJailed(path.join(tmp, 'link', 'ws', 'notes.txt'), root, {
        maxBytes: 1024,
        encoding: 'utf8',
      }),
    ).toBe(TEXT);
    expect(probes.seen.length, 'the in-root entry itself must still be checked').toBeGreaterThan(0);
    // The filter is not vacuous: realpathLoose did lstat outside the root.
    expect(probes.all.some((p) => !atOrBelow(path.dirname(p), root))).toBe(true);
    for (const p of probes.seen) {
      expect(atOrBelow(fsSync.realpathSync(path.dirname(p)), root), `probed ${p}`).toBe(true);
    }
  });
});

// ── outside the root: one generic refusal, nothing probed ────────────────────

describe.skipIf(process.platform === 'win32')('outside paths get one generic refusal', () => {
  let root: string;

  beforeEach(() => {
    root = path.join(tmp, 'ws');
    fsSync.mkdirSync(root);
    fsSync.writeFileSync(path.join(root, 'inside.txt'), 'inside\n');
    fsSync.mkdirSync(path.join(tmp, 'outside'));
    fsSync.writeFileSync(path.join(tmp, 'outside', 'secret.txt'), 'OUTSIDE_FIXTURE\n');
    fsSync.mkdirSync(path.join(tmp, 'locked'));
    fsSync.writeFileSync(path.join(tmp, 'locked', 'secret.txt'), 'OUTSIDE_FIXTURE\n');
    fsSync.symlinkSync(path.join(tmp, 'outside'), path.join(tmp, 'olink'));
    fsSync.chmodSync(path.join(tmp, 'locked'), 0o000);
  });

  const outsidePaths = (): Record<string, string> => ({
    existing: path.join(tmp, 'outside', 'secret.txt'),
    'unreadable-parent': path.join(tmp, 'locked', 'secret.txt'),
    nonexistent: path.join(tmp, 'nope', 'missing.txt'),
    'symlinked-dir': path.join(tmp, 'olink', 'secret.txt'),
    'symlink-itself': path.join(tmp, 'olink'),
  });
  const KINDS = ['existing', 'unreadable-parent', 'nonexistent', 'symlinked-dir', 'symlink-itself'];

  const attempt = (op: string, p: string): Promise<unknown> =>
    op === 'read'
      ? readFileJailed(p, root, { maxBytes: 1024 })
      : writeFileJailed(p, 'OVERWRITTEN', root, { createParents: true });

  for (const op of ['read', 'write']) {
    it.each(KINDS)(`${op}: %s gets the generic TRAVERSAL refusal`, async (kind) => {
      const p = outsidePaths()[kind]!;
      const err = await rejectsWith(attempt(op, p), 'TRAVERSAL', GENERIC(p));
      expect(err.message).not.toContain('OUTSIDE_FIXTURE');
      expect(fsSync.readFileSync(path.join(tmp, 'outside', 'secret.txt'), 'utf8')).toBe(
        'OUTSIDE_FIXTURE\n',
      );
      expect(fsSync.existsSync(path.join(tmp, 'nope'))).toBe(false);
    });

    it.each(KINDS)(`${op}: %s is not lstat'ed outside the root`, async (kind) => {
      const p = outsidePaths()[kind]!;
      const probes = startProbes();
      await rejection(attempt(op, p));
      expect(probes.seen, `probed outside the root: ${probes.seen.join(', ')}`).toEqual([]);
    });
  }

  it('all outside refusals are the same text', async () => {
    const texts = new Set<string>();
    for (const p of Object.values(outsidePaths())) {
      for (const op of ['read', 'write']) {
        texts.add((await rejection(attempt(op, p))).message.replaceAll(p, '<path>'));
      }
    }
    expect([...texts]).toEqual([GENERIC('<path>')]);
  });

  it('an injected EACCES outside the root is never reached (root given)', async () => {
    lstatMock.mockImplementation(((p: fsSync.PathLike, ...rest: unknown[]) => {
      if (String(p).startsWith('/root/') && !/\brealpathLoose\b/.test(new Error().stack ?? '')) {
        return Promise.reject(Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }));
      }
      return (actual.lstat as (...a: unknown[]) => Promise<fsSync.Stats>)(p, ...rest);
    }) as typeof fsp.lstat);
    await expect(
      assertNoSymlink('/root/.ssh/id_rsa', { operation: 'read', root }),
    ).resolves.toBeUndefined();
    await rejectsWith(
      readFileJailed('/root/.ssh/id_rsa', root, { maxBytes: 1024 }),
      'TRAVERSAL',
      GENERIC('/root/.ssh/id_rsa'),
    );
    await rejectsWith(
      writeFileJailed('/root/.ssh/authorized_keys', 'x', root),
      'TRAVERSAL',
      GENERIC('/root/.ssh/authorized_keys'),
    );
  });

  it('without root the walk still discloses (back-compat pin)', async () => {
    await rejectsWith(
      assertNoSymlink(outsidePaths()['symlinked-dir']!, { operation: 'read' }),
      'SYMLINK_IN_PATH',
    );
  });

  it('an uninspectable component inside the root still fails closed', async () => {
    fsSync.mkdirSync(path.join(root, 'sub'));
    lstatMock.mockImplementation(((p: fsSync.PathLike, ...rest: unknown[]) => {
      if (String(p) === path.join(root, 'sub', 'f.txt')) {
        return Promise.reject(Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }));
      }
      return (actual.lstat as (...a: unknown[]) => Promise<fsSync.Stats>)(p, ...rest);
    }) as typeof fsp.lstat);
    await rejectsWith(
      assertNoSymlink(path.join(root, 'sub', 'f.txt'), { operation: 'read', root }),
      'UNINSPECTABLE',
      /^Path not inspectable on read: ".*sub\/f\.txt" \(EACCES\)$/,
    );
  });
});
