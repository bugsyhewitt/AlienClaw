/**
 * Filesystem jail: injected failures and check-then-use races.
 *
 * node:fs/promises is replaced, for this file only, by the real module with
 * lstat / open / rename wrapped in vi.fn, so a test can inject an lstat error
 * (the TS analogue of python/tests/test_uninspectable_path.py patching
 * Path.is_symlink) or act between the jail's checks and its open/rename (the
 * swap race). Fixtures are built with node:fs sync calls, which are not mocked.
 */

import { execFileSync } from 'node:child_process';
import * as fsSync from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    lstat: vi.fn(actual.lstat),
    open: vi.fn(actual.open),
    rename: vi.fn(actual.rename),
  };
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
const openMock = vi.mocked(fsp.open);
const renameMock = vi.mocked(fsp.rename);

let tmp: string;
let ws: string;

beforeEach(() => {
  tmp = fsSync.realpathSync(fsSync.mkdtempSync(path.join(os.tmpdir(), 'fs-jail-races-')));
  ws = path.join(tmp, 'ws');
  fsSync.mkdirSync(ws);
  fsSync.writeFileSync(path.join(tmp, 'outside-secret.txt'), 'OUTSIDE SECRET');
});

afterEach(() => {
  lstatMock.mockReset().mockImplementation(actual.lstat);
  openMock.mockReset().mockImplementation(actual.open as typeof fsp.open);
  renameMock.mockReset().mockImplementation(actual.rename);
  fsSync.rmSync(tmp, { recursive: true, force: true });
});

async function rejectsWith(
  promise: Promise<unknown>,
  code: BoundaryErrorCode,
  message?: RegExp,
): Promise<BoundaryError> {
  const err = await promise.then(
    () => {
      throw new Error(`expected BoundaryError ${code}, got success`);
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(BoundaryError);
  expect((err as BoundaryError).code).toBe(code);
  if (message) expect((err as BoundaryError).message).toMatch(message);
  return err as BoundaryError;
}

function sysError(code: string | undefined, message: string): Error {
  return Object.assign(new Error(message), code === undefined ? {} : { code });
}

/** lstat throws `err` for `match(p)`; everything else is the real lstat. */
function lstatFailsFor(match: (p: string) => boolean, err: Error): void {
  lstatMock.mockImplementation(((p: fsSync.PathLike, ...rest: unknown[]) => {
    if (match(String(p))) return Promise.reject(err);
    return (actual.lstat as (...a: unknown[]) => Promise<fsSync.Stats>)(p, ...rest);
  }) as typeof fsp.lstat);
}

// ── test_uninspectable_path.py ───────────────────────────────────────────────

describe('uninspectable path (injected lstat errors)', () => {
  it.each(['read', 'write'])(
    'EACCES under an unsearchable directory is UNINSPECTABLE on %s',
    async (operation) => {
      lstatFailsFor(
        (p) => p.startsWith('/root/'),
        sysError('EACCES', "EACCES: permission denied, lstat '/root/.ssh/id_rsa'"),
      );
      const err = await rejectsWith(
        assertNoSymlink('/root/.ssh/id_rsa', { operation }),
        'UNINSPECTABLE',
      );
      expect(err.message).toBe(`Path not inspectable on ${operation}: "/root/.ssh/id_rsa" (EACCES)`);
      expect((err.cause as { code?: string }).code).toBe('EACCES');
    },
  );

  it('the default operation is write', async () => {
    const locked = path.join(tmp, 'locked');
    lstatFailsFor((p) => p.startsWith(`${locked}/`), sysError('EACCES', 'denied'));
    await rejectsWith(
      assertNoSymlink(path.join(locked, 'f.txt')),
      'UNINSPECTABLE',
      /^Path not inspectable on write: ".*locked\/f\.txt"/,
    );
  });

  it.each([
    ['EPERM', sysError('EPERM', 'EPERM: operation not permitted')],
    ['EIO', sysError('EIO', 'EIO: i/o error')],
    ['ENAMETOOLONG', sysError('ENAMETOOLONG', 'ENAMETOOLONG: name too long')],
    ['bare', sysError(undefined, 'no errno at all')],
  ])('any other lstat error on an ancestor fails closed (%s)', async (_id, err) => {
    const ancestor = path.join(tmp, 'a');
    lstatFailsFor((p) => p === ancestor, err);
    await rejectsWith(
      assertNoSymlink(path.join(ancestor, 'b', 'c.txt'), { operation: 'read' }),
      'UNINSPECTABLE',
      /^Path not inspectable on read: /,
    );
  });

  it.each(['ENOENT', 'ENOTDIR', 'ELOOP', 'EBADF'])(
    '%s from lstat means "not a symlink" (CPython 3.12 list)',
    async (code) => {
      const target = path.join(tmp, 'a', 'b.txt');
      lstatFailsFor((p) => p === target, sysError(code, code));
      await expect(assertNoSymlink(target)).resolves.toBeUndefined();
    },
  );

  it('a symlinked ancestor is still reported as a symlink', async () => {
    fsSync.mkdirSync(path.join(tmp, 'real'));
    fsSync.symlinkSync(path.join(tmp, 'real'), path.join(tmp, 'alias'));
    await rejectsWith(
      assertNoSymlink(path.join(tmp, 'alias', 'f.txt'), { operation: 'read' }),
      'SYMLINK_IN_PATH',
      /^Symlink in path rejected on read: /,
    );
  });

  it('readFileJailed and writeFileJailed fail closed too', async () => {
    fsSync.mkdirSync(path.join(ws, 'locked'));
    fsSync.writeFileSync(path.join(ws, 'locked', 'f.txt'), 'x');
    lstatFailsFor((p) => p.startsWith(`${ws}/locked/`), sysError('EACCES', 'denied'));
    await rejectsWith(readFileJailed('locked/f.txt', ws, { maxBytes: 10 }), 'UNINSPECTABLE');
    await rejectsWith(writeFileJailed('locked/f.txt', 'y', ws), 'UNINSPECTABLE');
    expect(fsSync.readFileSync(path.join(ws, 'locked', 'f.txt'), 'utf8')).toBe('x');
  });
});

// ── O_NOFOLLOW: a symlink swapped in between the checks and the open ─────────

describe('read: swap race at the final component', () => {
  it('a file replaced by a symlink after the checks is refused by O_NOFOLLOW', async () => {
    const target = path.join(ws, 'report.txt');
    fsSync.writeFileSync(target, 'inside');
    openMock.mockImplementationOnce((async (p: fsSync.PathLike, flags?: number, mode?: number) => {
      // The attacker wins the race: report.txt now points outside the boundary.
      fsSync.unlinkSync(target);
      fsSync.symlinkSync(path.join(tmp, 'outside-secret.txt'), target);
      return actual.open(p, flags, mode);
    }) as typeof fsp.open);

    const err = await rejectsWith(
      readFileJailed('report.txt', ws, { maxBytes: 1024, encoding: 'utf8' }),
      'SYMLINK',
      /^Symlink rejected on read: ".*report\.txt" is a symbolic link$/,
    );
    expect((err.cause as { code?: string }).code).toBe('ELOOP');
    expect(openMock).toHaveBeenCalledTimes(1);
    const flags = openMock.mock.calls[0]![1] as number;
    expect(flags & fsSync.constants.O_NOFOLLOW).toBe(fsSync.constants.O_NOFOLLOW);
    expect(flags & fsSync.constants.O_NONBLOCK).toBe(fsSync.constants.O_NONBLOCK);
  });

  it('control: without the swap the same read succeeds', async () => {
    fsSync.writeFileSync(path.join(ws, 'report.txt'), 'inside');
    expect(await readFileJailed('report.txt', ws, { maxBytes: 1024, encoding: 'utf8' })).toBe(
      'inside',
    );
  });

  it('a file that grows past maxBytes after fstat is still refused', async () => {
    const target = path.join(ws, 'grow.txt');
    fsSync.writeFileSync(target, 'small');
    openMock.mockImplementationOnce((async (p: fsSync.PathLike, flags?: number, mode?: number) => {
      const fh = await actual.open(p, flags, mode);
      const realStat = fh.stat.bind(fh);
      // fstat reports the old size; the file then grows before the read.
      fh.stat = (async (...args: unknown[]) => {
        const st = await (realStat as (...a: unknown[]) => Promise<fsSync.Stats>)(...args);
        fsSync.appendFileSync(target, 'x'.repeat(100));
        return st;
      }) as typeof fh.stat;
      return fh;
    }) as typeof fsp.open);
    await rejectsWith(readFileJailed('grow.txt', ws, { maxBytes: 10 }), 'TOO_LARGE');
  });
});

// ── what was opened is what counts: type and size come from the fd ──────────
// (the reference file_read: O_NOFOLLOW | O_NONBLOCK, fstat S_ISREG, size from the fd)

/** The next open() first runs `swap` (the attacker wins the race after the checks). */
function swapBeforeOpen(swap: () => void): void {
  openMock.mockImplementationOnce((async (p: fsSync.PathLike, flags?: number, mode?: number) => {
    swap();
    return actual.open(p, flags, mode);
  }) as typeof fsp.open);
}

describe('read: swaps after the checks are judged by fstat on the opened fd', () => {
  it('a FIFO swapped in does not hang the read (O_NONBLOCK) and is NOT_A_FILE', async (ctx) => {
    const target = path.join(ws, 'report.txt');
    fsSync.writeFileSync(target, 'inside');
    try {
      execFileSync('mkfifo', [path.join(tmp, 'probe-fifo')]);
    } catch {
      ctx.skip('no mkfifo on this host');
    }
    swapBeforeOpen(() => {
      fsSync.unlinkSync(target);
      execFileSync('mkfifo', [target]); // no writer will ever open it
    });
    await rejectsWith(
      readFileJailed('report.txt', ws, { maxBytes: 1024 }),
      'NOT_A_FILE',
      /^Not a regular file on read: "report\.txt"$/,
    );
    expect(fsSync.lstatSync(target).isFIFO()).toBe(true);
  }, 5000);

  it('a directory swapped in is NOT_A_FILE (fstat, not the earlier path checks)', async () => {
    const target = path.join(ws, 'report.txt');
    fsSync.writeFileSync(target, 'inside');
    swapBeforeOpen(() => {
      fsSync.unlinkSync(target);
      fsSync.mkdirSync(target);
    });
    await rejectsWith(readFileJailed('report.txt', ws, { maxBytes: 1024 }), 'NOT_A_FILE');
  });

  it('a larger file swapped in is TOO_LARGE: the size comes from the fd', async () => {
    const target = path.join(ws, 'report.txt');
    fsSync.writeFileSync(target, 'small');
    fsSync.writeFileSync(path.join(ws, 'big.bin'), 'x'.repeat(4096));
    swapBeforeOpen(() => fsSync.renameSync(path.join(ws, 'big.bin'), target));
    await rejectsWith(readFileJailed('report.txt', ws, { maxBytes: 100 }), 'TOO_LARGE');
  });

  it('known gap (no openat in Node): an in-root ancestor swapped for a symlink is followed', async () => {
    // The reference Python file_read walks ancestors with O_NOFOLLOW dir fds (openat);
    // node:fs has no dir-fd API, so only the final component is protected. Pinned here so
    // a future fix (or a Node openat) flips this test deliberately.
    fsSync.mkdirSync(path.join(ws, 'sub'));
    fsSync.writeFileSync(path.join(ws, 'sub', 'f.txt'), 'inside');
    fsSync.mkdirSync(path.join(tmp, 'evil'));
    fsSync.writeFileSync(path.join(tmp, 'evil', 'f.txt'), 'OUTSIDE SECRET');
    swapBeforeOpen(() => {
      fsSync.renameSync(path.join(ws, 'sub'), path.join(ws, 'sub-old'));
      fsSync.symlinkSync(path.join(tmp, 'evil'), path.join(ws, 'sub'));
    });
    expect(await readFileJailed('sub/f.txt', ws, { maxBytes: 1024, encoding: 'utf8' })).toBe(
      'OUTSIDE SECRET',
    );
  });
});

// ── atomic write: races at the temp file and at the rename ───────────────────

describe('write: swap races', () => {
  it('a symlink swapped in just before the rename is replaced, not followed', async () => {
    const target = path.join(ws, 'notes.txt');
    fsSync.writeFileSync(target, 'old');
    renameMock.mockImplementationOnce(async (from, to) => {
      fsSync.unlinkSync(target);
      fsSync.symlinkSync(path.join(tmp, 'outside-secret.txt'), target);
      return actual.rename(from, to);
    });
    await writeFileJailed('notes.txt', 'agent data', ws);
    expect(fsSync.readFileSync(path.join(tmp, 'outside-secret.txt'), 'utf8')).toBe('OUTSIDE SECRET');
    expect(fsSync.lstatSync(target).isSymbolicLink()).toBe(false);
    expect(fsSync.readFileSync(target, 'utf8')).toBe('agent data');
  });

  it('a symlink swapped in after the gate is caught by the pre-rename re-check', async () => {
    const target = path.join(ws, 'notes.txt');
    fsSync.writeFileSync(target, 'old');
    // Swap while the temp file is being created (after the gate and the first lstat).
    openMock.mockImplementationOnce((async (p: fsSync.PathLike, flags?: number, mode?: number) => {
      fsSync.unlinkSync(target);
      fsSync.symlinkSync(path.join(tmp, 'outside-secret.txt'), target);
      return actual.open(p, flags, mode);
    }) as typeof fsp.open);
    await rejectsWith(writeFileJailed('notes.txt', 'agent data', ws), 'SYMLINK');
    expect(fsSync.readFileSync(path.join(tmp, 'outside-secret.txt'), 'utf8')).toBe('OUTSIDE SECRET');
    expect(renameMock).not.toHaveBeenCalled();
    // The temp file was removed; only the attacker's link is left.
    expect(fsSync.readdirSync(ws)).toEqual(['notes.txt']);
  });

  it('a symlink planted at the temp name is refused (O_EXCL | O_NOFOLLOW)', async () => {
    openMock.mockImplementationOnce((async (p: fsSync.PathLike, flags?: number, mode?: number) => {
      fsSync.symlinkSync(path.join(tmp, 'outside-secret.txt'), String(p));
      return actual.open(p, flags, mode);
    }) as typeof fsp.open);
    await expect(writeFileJailed('new.txt', 'agent data', ws)).rejects.toMatchObject({
      code: 'EEXIST',
    });
    expect(fsSync.readFileSync(path.join(tmp, 'outside-secret.txt'), 'utf8')).toBe('OUTSIDE SECRET');
    expect(renameMock).not.toHaveBeenCalled();
    const flags = openMock.mock.calls[0]![1] as number;
    const want = fsSync.constants.O_CREAT | fsSync.constants.O_EXCL | fsSync.constants.O_NOFOLLOW;
    expect(flags & want).toBe(want);
  });

  it('a failed rename removes the temp file', async () => {
    renameMock.mockImplementationOnce(async () => {
      throw sysError('EXDEV', 'EXDEV: cross-device link not permitted');
    });
    await expect(writeFileJailed('x.txt', 'data', ws)).rejects.toMatchObject({ code: 'EXDEV' });
    expect(fsSync.readdirSync(ws)).toEqual([]);
  });
});
