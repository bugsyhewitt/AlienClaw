/**
 * Filesystem jail: a port of the Python package's boundary tests
 * (python/tests/test_file_boundary.py, test_file_write_boundary.py,
 * test_dotfile_and_read_gate.py, test_uninspectable_path.py) plus tests for
 * the TS-only helpers readFileJailed / writeFileJailed.
 *
 * Every test works in a fresh fs.mkdtemp directory (realpath'd, because
 * assertNoSymlink walks to "/"). No fixture is named .env*; ".env" spellings
 * appear only as inputs that the jail rejects before any I/O.
 *
 * The swap-race and injected-lstat tests live in fs-jail-races.test.ts (they
 * mock node:fs/promises for the whole file).
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BoundaryError,
  MAX_READ_BYTES_CEILING,
  assertInsideBoundary,
  assertNoSymlink,
  readFileJailed,
  writeFileJailed,
  type BoundaryErrorCode,
} from '../src/fs-jail.js';

let tmp: string; // realpath'd temp dir (pytest's tmp_path)
let ws: string; // tmp/workspace, the boundary for most tests

beforeEach(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fs-jail-')));
  ws = path.join(tmp, 'workspace');
  await fs.mkdir(ws);
});

afterEach(async () => {
  // Restore permissions a test may have removed, then delete the tree.
  await fs.chmod(path.join(tmp, 'locked'), 0o700).catch(() => undefined);
  await fs.rm(tmp, { recursive: true, force: true });
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
  const be = err as BoundaryError;
  expect(be.code).toBe(code);
  if (message) expect(be.message).toMatch(message);
  return be;
}

async function exists(p: string): Promise<boolean> {
  return fs.lstat(p).then(
    () => true,
    () => false,
  );
}

/** The reference write gate: unresolved-path symlink check, then containment. */
async function writeGate(pathStr: string, root: string): Promise<string> {
  await assertNoSymlink(pathStr.startsWith('/') ? pathStr : `${root}/${pathStr}`);
  return assertInsideBoundary(pathStr, root);
}

async function readGate(pathStr: string, root: string): Promise<string> {
  await assertNoSymlink(`${root}/${pathStr}`, { operation: 'read' });
  return assertInsideBoundary(pathStr, root);
}

// ── BoundaryError ────────────────────────────────────────────────────────────

describe('BoundaryError', () => {
  it('is an Error with a stable code, a name and the offending path', async () => {
    const err = await rejectsWith(assertInsideBoundary('../x', ws), 'TRAVERSAL');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('BoundaryError');
    expect(err.path).toBe('../x');
    expect(err.message).toBe(
      'Path traversal rejected: "../x" resolves outside workspace boundary',
    );
  });

  it('argument errors are TypeErrors, not refusals', async () => {
    await expect(assertInsideBoundary('x', '')).rejects.toBeInstanceOf(TypeError);
    await expect(assertInsideBoundary('x', 'a\0b')).rejects.toBeInstanceOf(TypeError);
    await expect(assertInsideBoundary(42 as unknown as string, ws)).rejects.toBeInstanceOf(
      TypeError,
    );
    await expect(
      assertInsideBoundary('x', ws, { denyRoots: [''] }),
    ).rejects.toBeInstanceOf(TypeError);
  });
});

// ── test_file_boundary.py: TestAssertInsideBoundary ──────────────────────────

describe('assertInsideBoundary: traversal', () => {
  it('accepts a simple relative path', async () => {
    const result = await assertInsideBoundary('data/result.json', ws);
    expect(result).toBe(path.join(ws, 'data', 'result.json'));
  });

  it('rejects ../ traversal', async () => {
    await rejectsWith(assertInsideBoundary('../etc/passwd', ws), 'TRAVERSAL', /^Path traversal rejected/);
  });

  it('rejects deeply nested ../', async () => {
    await rejectsWith(assertInsideBoundary('../../../../../../etc/shadow', ws), 'TRAVERSAL');
  });

  it('rejects an absolute path outside the boundary', async () => {
    await rejectsWith(assertInsideBoundary('/etc/passwd', ws), 'TRAVERSAL');
  });

  it('rejects an absolute path to a file next to the boundary', async () => {
    const outside = path.join(tmp, 'outside.txt');
    await fs.writeFile(outside, 'outside');
    await rejectsWith(assertInsideBoundary(outside, ws), 'TRAVERSAL');
  });

  it('accepts the boundary itself', async () => {
    expect(await assertInsideBoundary(ws, ws)).toBe(ws);
  });

  it('rejects a/.. as a dotfile (basename is "..")', async () => {
    await rejectsWith(assertInsideBoundary('a/..', ws), 'DOTFILE', /^Dotfile rejected/);
  });

  it('rejects the sibling prefix workspace-evil/', async () => {
    await fs.mkdir(path.join(tmp, 'workspace-evil'));
    await rejectsWith(assertInsideBoundary('../workspace-evil/x', ws), 'TRAVERSAL');
    await rejectsWith(assertInsideBoundary(path.join(tmp, 'workspace-evil', 'x'), ws), 'TRAVERSAL');
  });

  it('applies .. after symlinks, like realpath (not path.resolve)', async () => {
    // path.resolve would collapse "up/workspace/.." lexically to the boundary.
    await fs.symlink(tmp, path.join(ws, 'up'));
    await rejectsWith(assertInsideBoundary('up/workspace/../secret.txt', ws), 'TRAVERSAL');
    // ...and .. after a missing component is lexical, as in CPython.
    await rejectsWith(assertInsideBoundary('missing/../../x', ws), 'TRAVERSAL');
    expect(await assertInsideBoundary('missing/../x', ws)).toBe(path.join(ws, 'x'));
  });

  it('anchors relative paths at the root, not at the CWD', async () => {
    const cwd = process.cwd();
    expect(cwd).not.toBe(ws);
    expect(await assertInsideBoundary('f.txt', ws)).toBe(path.join(ws, 'f.txt'));
  });

  it('accepts an empty path as the root', async () => {
    expect(await assertInsideBoundary('', ws)).toBe(ws);
  });

  it('collapses empty and . components', async () => {
    expect(await assertInsideBoundary('a//b/./c.txt', ws)).toBe(path.join(ws, 'a', 'b', 'c.txt'));
  });

  it('accepts a root given with a trailing slash', async () => {
    expect(await assertInsideBoundary('x', `${ws}/`)).toBe(path.join(ws, 'x'));
  });

  it('rejects a NUL byte', async () => {
    await rejectsWith(assertInsideBoundary('a\0b.txt', ws), 'INVALID_PATH');
  });

  it('a symlink loop keeps the link path (CPython non-strict realpath)', async () => {
    await fs.symlink('loop2', path.join(ws, 'loop1'));
    await fs.symlink('loop1', path.join(ws, 'loop2'));
    expect(await assertInsideBoundary('loop1/x', ws)).toBe(path.join(ws, 'loop1', 'x'));
  });
});

// ── TestDotfileDenial + test_dotfile_and_read_gate.py ────────────────────────

describe('assertInsideBoundary: dotfiles', () => {
  beforeEach(async () => {
    await fs.mkdir(path.join(ws, 'sub'));
    await fs.writeFile(path.join(ws, '.secret'), 'FIXTURE_ONLY=1\n');
    await fs.writeFile(path.join(ws, 'sub', '.secret'), 'FIXTURE_ONLY=1\n');
  });

  it.each(['.env', '.gitconfig', 'subdir/.secret', '.secret'])('rejects %j', async (p) => {
    await rejectsWith(assertInsideBoundary(p, ws), 'DOTFILE');
  });

  it('accepts a non-dotfile', async () => {
    expect(await assertInsideBoundary('output.txt', ws)).toBe(path.join(ws, 'output.txt'));
  });

  it('rejects an existing dotfile spelled with a trailing slash', async () => {
    await rejectsWith(assertInsideBoundary('.secret/', ws), 'DOTFILE');
  });

  it.each([
    '.env/',
    '.env//',
    '.env/./',
    './.env/',
    'a/../.env/',
    'sub/.secret/',
    'sub/.secret//',
    './sub/./.secret/./',
  ])('rejects the trailing-slash spelling %j', async (p) => {
    await rejectsWith(assertInsideBoundary(p, ws), 'DOTFILE', /^Dotfile rejected: "/);
  });

  it('rejects an absolute dotfile with a trailing slash', async () => {
    await rejectsWith(assertInsideBoundary(`${ws}/.env/`, ws), 'DOTFILE');
  });

  it('rejects a symlink whose target is a dotfile', async () => {
    await fs.symlink(path.join(ws, '.secret'), path.join(ws, 'innocent.txt'));
    await rejectsWith(assertInsideBoundary('innocent.txt', ws), 'DOTFILE');
  });

  it('rejects a symlink whose target is a dot-directory', async () => {
    await fs.mkdir(path.join(ws, '.hidden'));
    await fs.symlink(path.join(ws, '.hidden'), path.join(ws, 'plain_dir'));
    await rejectsWith(assertInsideBoundary('plain_dir/', ws), 'DOTFILE');
  });

  it('dot-directories in the middle are allowed (documented)', async () => {
    expect(await assertInsideBoundary('.git/config', ws)).toBe(path.join(ws, '.git', 'config'));
  });

  it.each(['data/out.txt', 'sub/', 'sub//', 'a/./b.txt', './plain.txt', '.git/config', 'sub/.d/x.txt'])(
    'still accepts %j',
    async (p) => {
      expect((await assertInsideBoundary(p, ws)).startsWith(`${ws}/`)).toBe(true);
    },
  );

  it.each(['.', 'a/.', 'a/..', '..', 'a/../'])('still rejects %j', async (p) => {
    await rejectsWith(assertInsideBoundary(p, ws), 'DOTFILE');
  });

  it('a dotfile spelled with a NUL is still a dotfile first', async () => {
    await rejectsWith(assertInsideBoundary('.env\0', ws), 'DOTFILE');
  });

  it('the boundary itself is still accepted', async () => {
    expect(await assertInsideBoundary(ws, ws)).toBe(ws);
    expect(await assertInsideBoundary(`${ws}/`, ws)).toBe(ws);
  });
});

// ── TestSymlinkEscape ────────────────────────────────────────────────────────

describe('assertInsideBoundary: symlink escape', () => {
  it('rejects a symlink pointing outside', async () => {
    const outside = path.join(tmp, 'secret.txt');
    await fs.writeFile(outside, 'outside secret');
    await fs.symlink(outside, path.join(ws, 'escape'));
    await rejectsWith(assertInsideBoundary('escape', ws), 'TRAVERSAL');
  });

  it('rejects a symlink to the parent directory', async () => {
    await fs.symlink(tmp, path.join(ws, 'up'));
    await rejectsWith(assertInsideBoundary('up/workspace/../secret.txt', ws), 'TRAVERSAL');
  });

  it('accepts a symlink that stays inside', async () => {
    await fs.mkdir(path.join(ws, 'real'));
    await fs.symlink(path.join(ws, 'real'), path.join(ws, 'alias'));
    expect(await assertInsideBoundary('alias/f.txt', ws)).toBe(path.join(ws, 'real', 'f.txt'));
  });

  it('follows a relative symlink against its own directory', async () => {
    await fs.mkdir(path.join(ws, 'sub'));
    await fs.symlink('../sub', path.join(ws, 'sub', 'self'));
    expect(await assertInsideBoundary('sub/self/x', ws)).toBe(path.join(ws, 'sub', 'x'));
  });

  it('rejects a dangling symlink that points outside', async () => {
    await fs.symlink(path.join(tmp, 'nope'), path.join(ws, 'dangle'));
    await rejectsWith(assertInsideBoundary('dangle', ws), 'TRAVERSAL');
  });
});

// ── TestDenyRoots ────────────────────────────────────────────────────────────

describe('assertInsideBoundary: denyRoots', () => {
  let home: string;
  beforeEach(async () => {
    home = path.join(tmp, 'home');
    await fs.mkdir(home);
  });

  it('a symlink into a denied root outside the boundary is rejected', async () => {
    const denied = path.join(home, '.agentstate');
    await fs.mkdir(path.join(denied, 'agents'), { recursive: true });
    await fs.symlink(denied, path.join(ws, 'oc_link'));
    const err = await assertInsideBoundary('oc_link/agents/a/SOUL.md', ws, {
      denyRoots: [denied],
    }).catch((e: unknown) => e as BoundaryError);
    expect(err).toBeInstanceOf(BoundaryError);
    expect(['TRAVERSAL', 'DENIED_ROOT']).toContain((err as BoundaryError).code);
  });

  it('a denied root inside the boundary is rejected', async () => {
    const denied = path.join(home, '.agentstate');
    await fs.mkdir(denied);
    await rejectsWith(
      assertInsideBoundary('.agentstate/agents/a/SOUL.md', home, { denyRoots: [denied] }),
      'DENIED_ROOT',
      /^Denied root: /,
    );
    await rejectsWith(
      assertInsideBoundary(path.join(denied, 'x', 'y'), home, { denyRoots: [denied] }),
      'DENIED_ROOT',
    );
  });

  it('the denied root itself is rejected', async () => {
    const denied = path.join(home, 'state');
    await fs.mkdir(denied);
    await rejectsWith(assertInsideBoundary('state', home, { denyRoots: [denied] }), 'DENIED_ROOT');
  });

  it('a symlink into a denied root inside the boundary is rejected', async () => {
    const denied = path.join(home, 'state');
    await fs.mkdir(denied);
    await fs.symlink(denied, path.join(home, 'innocent'));
    await rejectsWith(assertInsideBoundary('innocent/x', home, { denyRoots: [denied] }), 'DENIED_ROOT');
  });

  it('a single string deny root is not iterated character by character', async () => {
    const denied = path.join(home, 'state');
    await fs.mkdir(denied);
    await rejectsWith(assertInsideBoundary('state/x', home, { denyRoots: denied }), 'DENIED_ROOT');
    expect(await assertInsideBoundary('other/x', home, { denyRoots: denied })).toBe(
      path.join(home, 'other', 'x'),
    );
  });

  it('a sibling of a denied root is allowed', async () => {
    const denied = path.join(home, 'state');
    await fs.mkdir(denied);
    expect(await assertInsideBoundary('state-public/x', home, { denyRoots: [denied] })).toBe(
      path.join(home, 'state-public', 'x'),
    );
  });

  it('there are no deny roots by default', async () => {
    await fs.mkdir(path.join(home, '.openclaw'));
    expect(await assertInsideBoundary('.openclaw/agents/x', home)).toBe(
      path.join(home, '.openclaw', 'agents', 'x'),
    );
  });

  it('a deny root given as a symlink is resolved', async () => {
    await fs.mkdir(path.join(home, 'state'));
    await fs.symlink(path.join(home, 'state'), path.join(home, 'statelink'));
    await rejectsWith(
      assertInsideBoundary('state/x', home, { denyRoots: [path.join(home, 'statelink')] }),
      'DENIED_ROOT',
    );
  });

  it('accepts any iterable of deny roots', async () => {
    const denied = path.join(home, 'state');
    await fs.mkdir(denied);
    await rejectsWith(
      assertInsideBoundary('state/x', home, { denyRoots: new Set([denied]) }),
      'DENIED_ROOT',
    );
  });
});

// ── TestAssertNoSymlink ──────────────────────────────────────────────────────

describe('assertNoSymlink', () => {
  it('accepts a regular file', async () => {
    const regular = path.join(ws, 'data.txt');
    await fs.writeFile(regular, 'hello');
    await expect(assertNoSymlink(regular)).resolves.toBeUndefined();
  });

  it('accepts a missing file', async () => {
    await expect(assertNoSymlink(path.join(ws, 'not-yet', 'data.txt'))).resolves.toBeUndefined();
  });

  it('rejects a symlink target', async () => {
    const target = path.join(tmp, 'real.txt');
    await fs.writeFile(target, 'real');
    await fs.symlink(target, path.join(ws, 'link.txt'));
    await rejectsWith(assertNoSymlink(path.join(ws, 'link.txt')), 'SYMLINK', /^Symlink rejected/);
  });

  it('rejects a dangling symlink', async () => {
    await fs.symlink(path.join(tmp, 'does-not-exist'), path.join(ws, 'dangling.txt'));
    await rejectsWith(assertNoSymlink(path.join(ws, 'dangling.txt')), 'SYMLINK');
  });

  it('rejects a symlink in an ancestor directory', async () => {
    await fs.mkdir(path.join(tmp, 'real_subdir'));
    await fs.symlink(path.join(tmp, 'real_subdir'), path.join(ws, 'link_subdir'));
    await rejectsWith(
      assertNoSymlink(path.join(ws, 'link_subdir', 'data.txt')),
      'SYMLINK_IN_PATH',
      /^Symlink in path rejected on write: ".*link_subdir"/,
    );
  });

  it('checks a component that a later .. would skip', async () => {
    await fs.mkdir(path.join(ws, 'real'));
    await fs.symlink(path.join(ws, 'real'), path.join(ws, 'a'));
    // path.join would turn this into <ws>/x and never look at <ws>/a.
    await rejectsWith(assertNoSymlink(`${ws}/a/../x`), 'SYMLINK_IN_PATH');
  });

  it('the default operation keeps the write wording', async () => {
    await fs.mkdir(path.join(ws, 'sub'));
    await fs.symlink(path.join(ws, 'sub'), path.join(ws, 'alias.txt'));
    await rejectsWith(
      assertNoSymlink(path.join(ws, 'alias.txt')),
      'SYMLINK',
      /^Symlink rejected on write: "/,
    );
  });

  it('rejects a NUL byte (fail closed)', async () => {
    await rejectsWith(assertNoSymlink(`${ws}/a\0b`), 'INVALID_PATH');
  });

  it('a missing relative path is accepted (inspected relative to the CWD)', async () => {
    await expect(assertNoSymlink('no-such-dir-fs-jail/x')).resolves.toBeUndefined();
  });
});

// ── test_file_write_boundary.py ──────────────────────────────────────────────

describe('write gate: workspace boundary', () => {
  it('rejects an absolute path outside the workspace', async () => {
    await rejectsWith(writeGate('/nonexistent/pkt576-attack.txt', tmp), 'TRAVERSAL');
  });

  it('rejects traversal with ..', async () => {
    await rejectsWith(writeGate(`${tmp}/../pkt576-escape.txt`, tmp), 'TRAVERSAL');
  });

  it('allows a path inside the workspace', async () => {
    const p = path.join(tmp, 'safe.txt');
    expect(await writeGate(p, tmp)).toBe(p);
  });

  it('allows nested paths inside the workspace', async () => {
    const p = path.join(tmp, 'a', 'b', 'out.txt');
    expect(await writeGate(p, tmp)).toBe(p);
  });

  it('an outside path is rejected before any mkdir', async () => {
    const outsideDir = path.join(path.dirname(tmp), `${path.basename(tmp)}-attacker-dir`);
    await rejectsWith(
      writeFileJailed(path.join(outsideDir, 'file.txt'), 'x', tmp, { createParents: true }),
      'TRAVERSAL',
    );
    expect(await exists(outsideDir)).toBe(false);
  });

  it('rejects a prefix-sibling path', async () => {
    const sibling = path.join(path.dirname(tmp), `${path.basename(tmp)}-evil`);
    await rejectsWith(
      writeFileJailed(path.join(sibling, 'escape.txt'), 'x', tmp, { createParents: true }),
      'TRAVERSAL',
    );
    expect(await exists(sibling)).toBe(false);
  });
});

describe('write gate: symlinks (unresolved path)', () => {
  it('rejects a symlinked target even inside the boundary', async () => {
    await fs.writeFile(path.join(tmp, 'real.txt'), 'x');
    await fs.symlink(path.join(tmp, 'real.txt'), path.join(tmp, 'alias.txt'));
    await rejectsWith(writeGate('alias.txt', tmp), 'SYMLINK', /^Symlink rejected on write/);
  });

  it('rejects a symlinked parent directory', async () => {
    await fs.mkdir(path.join(tmp, 'real_dir'));
    await fs.symlink(path.join(tmp, 'real_dir'), path.join(tmp, 'dir_alias'));
    await rejectsWith(
      writeGate('dir_alias/out.txt', tmp),
      'SYMLINK_IN_PATH',
      /^Symlink in path rejected on write/,
    );
  });

  it('rejects a symlink escape before the boundary check', async () => {
    const root = path.join(tmp, 'root');
    await fs.mkdir(root);
    await fs.symlink(tmp, path.join(root, 'out'));
    await rejectsWith(writeGate('out/escape.txt', root), 'SYMLINK_IN_PATH');
  });
});

// ── read gate (test_dotfile_and_read_gate.py) ────────────────────────────────

describe('read gate', () => {
  beforeEach(async () => {
    await fs.mkdir(path.join(ws, 'sub'));
  });

  it('rejects a symlinked file', async () => {
    await fs.writeFile(path.join(ws, 'real.txt'), 'x');
    await fs.symlink(path.join(ws, 'real.txt'), path.join(ws, 'alias.txt'));
    await rejectsWith(readGate('alias.txt', ws), 'SYMLINK', /^Symlink rejected on read/);
    await rejectsWith(readFileJailed('alias.txt', ws, { maxBytes: 100 }), 'SYMLINK');
  });

  it('rejects a symlinked ancestor', async () => {
    await fs.symlink(path.join(ws, 'sub'), path.join(ws, 'dir_alias'));
    await rejectsWith(readGate('dir_alias/f.txt', ws), 'SYMLINK_IN_PATH', /on read/);
    await rejectsWith(readFileJailed('dir_alias/f.txt', ws, { maxBytes: 100 }), 'SYMLINK_IN_PATH');
  });

  it('accepts a regular file', async () => {
    await fs.writeFile(path.join(ws, 'plain.txt'), 'x');
    expect(await readGate('plain.txt', ws)).toBe(path.join(ws, 'plain.txt'));
  });
});

// ── uninspectable path, for real (chmod 000) ─────────────────────────────────

describe('uninspectable path (real EACCES)', () => {
  it('a component under an unsearchable directory fails closed on read and write', async (ctx) => {
    const locked = path.join(tmp, 'locked');
    await fs.mkdir(locked);
    await fs.writeFile(path.join(locked, 'f.txt'), 'x');
    await fs.chmod(locked, 0o000);
    // As root, or as uid 0 of a user namespace (staging/tools/offline.sh), CAP_DAC_OVERRIDE
    // ignores the mode. The injected-lstat cases in fs-jail-races.test.ts always run.
    const probe = await fs.lstat(path.join(locked, 'f.txt')).then(
      () => 'readable',
      (e: unknown) => (e as NodeJS.ErrnoException).code,
    );
    if (probe !== 'EACCES') {
      ctx.skip(`chmod 000 did not produce EACCES here (${probe}); run without DAC override`);
      return;
    }
    for (const operation of ['read', 'write']) {
      await rejectsWith(
        assertNoSymlink(path.join(locked, 'f.txt'), { operation }),
        'UNINSPECTABLE',
        new RegExp(`^Path not inspectable on ${operation}: ".*locked/f\\.txt" \\(EACCES\\)$`),
      );
    }
    await rejectsWith(readFileJailed('locked/f.txt', tmp, { maxBytes: 100 }), 'UNINSPECTABLE');
    await rejectsWith(writeFileJailed('locked/f.txt', 'y', tmp), 'UNINSPECTABLE');
    // assertInsideBoundary alone follows CPython's non-strict realpath: it keeps the
    // uninspectable component and decides on the spelling. The gate is what fails closed.
    expect(await assertInsideBoundary('locked/f.txt', tmp)).toBe(path.join(locked, 'f.txt'));
  });
});

// ── readFileJailed ───────────────────────────────────────────────────────────

describe('readFileJailed', () => {
  it('returns a Buffer by default and a string with an encoding', async () => {
    await fs.writeFile(path.join(ws, 'a.txt'), 'héllo');
    const buf = await readFileJailed('a.txt', ws, { maxBytes: 100 });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString('utf8')).toBe('héllo');
    const text: string = await readFileJailed('a.txt', ws, { maxBytes: 100, encoding: 'utf8' });
    expect(text).toBe('héllo');
  });

  it('accepts a file of exactly maxBytes and refuses one byte more', async () => {
    await fs.writeFile(path.join(ws, 'ten.bin'), Buffer.alloc(10, 1));
    expect((await readFileJailed('ten.bin', ws, { maxBytes: 10 })).length).toBe(10);
    await rejectsWith(readFileJailed('ten.bin', ws, { maxBytes: 9 }), 'TOO_LARGE');
  });

  it('reads an empty file with maxBytes 0', async () => {
    await fs.writeFile(path.join(ws, 'empty'), '');
    expect((await readFileJailed('empty', ws, { maxBytes: 0 })).length).toBe(0);
  });

  it('reads a file larger than one internal chunk', async () => {
    const big = Buffer.alloc(200_000, 7);
    await fs.writeFile(path.join(ws, 'big.bin'), big);
    expect((await readFileJailed('big.bin', ws, { maxBytes: 200_000 })).equals(big)).toBe(true);
  });

  it('refuses a directory and a FIFO without blocking', async () => {
    await fs.mkdir(path.join(ws, 'dir'));
    await rejectsWith(readFileJailed('dir', ws, { maxBytes: 100 }), 'NOT_A_FILE');
    const { execFileSync } = await import('node:child_process');
    try {
      execFileSync('mkfifo', [path.join(ws, 'fifo')]);
    } catch {
      return; // no mkfifo on this host
    }
    await rejectsWith(readFileJailed('fifo', ws, { maxBytes: 100 }), 'NOT_A_FILE');
  });

  it('applies the dotfile, traversal and deny-root rules', async () => {
    await fs.mkdir(path.join(ws, 'state'));
    await fs.writeFile(path.join(ws, 'state', 'f.txt'), 'x');
    await rejectsWith(readFileJailed('.env', ws, { maxBytes: 100 }), 'DOTFILE');
    await rejectsWith(readFileJailed('../outside.txt', ws, { maxBytes: 100 }), 'TRAVERSAL');
    await rejectsWith(
      readFileJailed('state/f.txt', ws, { maxBytes: 100, denyRoots: [path.join(ws, 'state')] }),
      'DENIED_ROOT',
    );
  });

  it('a missing file is the plain ENOENT error, not a refusal', async () => {
    await expect(readFileJailed('missing.txt', ws, { maxBytes: 100 })).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it.each([undefined, -1, 1.5, Number.NaN, MAX_READ_BYTES_CEILING + 1, '10'])(
    'rejects maxBytes %j as a TypeError',
    async (maxBytes) => {
      await fs.writeFile(path.join(ws, 'a.txt'), 'x');
      await expect(
        readFileJailed('a.txt', ws, { maxBytes } as unknown as { maxBytes: number }),
      ).rejects.toBeInstanceOf(TypeError);
    },
  );
});

// ── writeFileJailed ──────────────────────────────────────────────────────────

describe('writeFileJailed', () => {
  async function dirEntries(dir: string): Promise<string[]> {
    return (await fs.readdir(dir)).sort();
  }

  it('writes a new file and returns the resolved path, leaving no temp file', async () => {
    const out = await writeFileJailed('out.txt', 'hello', ws);
    expect(out).toBe(path.join(ws, 'out.txt'));
    expect(await fs.readFile(out, 'utf8')).toBe('hello');
    expect(await dirEntries(ws)).toEqual(['out.txt']);
  });

  it('writes bytes and honours encoding for strings', async () => {
    await writeFileJailed('b.bin', new Uint8Array([0, 1, 2]), ws);
    expect([...(await fs.readFile(path.join(ws, 'b.bin')))]).toEqual([0, 1, 2]);
    await writeFileJailed('h.txt', '6869', ws, { encoding: 'hex' });
    expect(await fs.readFile(path.join(ws, 'h.txt'), 'utf8')).toBe('hi');
  });

  it('replaces an existing file atomically (new inode) and keeps its mode', async () => {
    const p = path.join(ws, 'f.txt');
    await fs.writeFile(p, 'old');
    await fs.chmod(p, 0o640);
    const before = await fs.stat(p);
    await writeFileJailed('f.txt', 'new', ws);
    const after = await fs.stat(p);
    expect(await fs.readFile(p, 'utf8')).toBe('new');
    expect(after.ino).not.toBe(before.ino);
    expect(after.mode & 0o777).toBe(0o640);
  });

  it('does not write through a hard link to the replaced file', async () => {
    const outside = path.join(tmp, 'outside.txt');
    await fs.writeFile(outside, 'outside original');
    await fs.link(outside, path.join(ws, 'hard.txt'));
    await writeFileJailed('hard.txt', 'agent data', ws);
    expect(await fs.readFile(outside, 'utf8')).toBe('outside original');
    expect(await fs.readFile(path.join(ws, 'hard.txt'), 'utf8')).toBe('agent data');
  });

  it('applies an explicit mode', async () => {
    await writeFileJailed('m.txt', 'x', ws, { mode: 0o600 });
    expect((await fs.stat(path.join(ws, 'm.txt'))).mode & 0o777).toBe(0o600);
  });

  it('missing parents are ENOENT unless createParents', async () => {
    await expect(writeFileJailed('a/b/c.txt', 'x', ws)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await dirEntries(ws)).toEqual([]);
    await writeFileJailed('a/b/c.txt', 'x', ws, { createParents: true });
    expect(await fs.readFile(path.join(ws, 'a', 'b', 'c.txt'), 'utf8')).toBe('x');
  });

  it('refuses a symlink target, including a dangling one, and creates nothing', async () => {
    const outside = path.join(tmp, 'outside.txt');
    await fs.writeFile(outside, 'outside original');
    await fs.symlink(outside, path.join(ws, 'link.txt'));
    await rejectsWith(writeFileJailed('link.txt', 'pwned', ws), 'SYMLINK');
    expect(await fs.readFile(outside, 'utf8')).toBe('outside original');

    await fs.symlink(path.join(tmp, 'created-by-attack.txt'), path.join(ws, 'dangle'));
    await rejectsWith(writeFileJailed('dangle', 'pwned', ws), 'SYMLINK');
    expect(await exists(path.join(tmp, 'created-by-attack.txt'))).toBe(false);
  });

  it('refuses a directory target', async () => {
    await fs.mkdir(path.join(ws, 'dir'));
    await rejectsWith(writeFileJailed('dir', 'x', ws), 'NOT_A_FILE');
    expect(await dirEntries(ws)).toEqual(['dir']);
  });

  it('applies the dotfile, traversal and deny-root rules before creating anything', async () => {
    await rejectsWith(writeFileJailed('.env', 'x', ws), 'DOTFILE');
    await rejectsWith(writeFileJailed('.env/', 'x', ws), 'DOTFILE');
    await rejectsWith(writeFileJailed('../escape.txt', 'x', ws), 'TRAVERSAL');
    await rejectsWith(
      writeFileJailed('state/x.txt', 'x', ws, {
        createParents: true,
        denyRoots: path.join(ws, 'state'),
      }),
      'DENIED_ROOT',
    );
    expect(await dirEntries(ws)).toEqual([]);
    expect(await dirEntries(tmp)).toEqual(['workspace']);
  });

  it('writes under a dot-directory (documented: use denyRoots to stop it)', async () => {
    await writeFileJailed('.git/hooks/pre-commit', '#!/bin/sh\n', ws, { createParents: true });
    expect(await exists(path.join(ws, '.git', 'hooks', 'pre-commit'))).toBe(true);
    await rejectsWith(
      writeFileJailed('.git/hooks/post-commit', 'x', ws, { denyRoots: [path.join(ws, '.git')] }),
      'DENIED_ROOT',
    );
  });

  it('rejects bad data and mode as TypeErrors', async () => {
    await expect(writeFileJailed('x', 42 as unknown as string, ws)).rejects.toBeInstanceOf(TypeError);
    await expect(writeFileJailed('x', 'y', ws, { mode: 0o10000 })).rejects.toBeInstanceOf(TypeError);
  });
});
