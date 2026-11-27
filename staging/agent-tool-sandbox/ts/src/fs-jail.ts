/**
 * Filesystem-boundary jail for agent file tools (TypeScript port of the Python
 * package's `agent_tool_sandbox.boundary`).
 *
 * The caller owns the boundary: every function takes the boundary root (and any
 * extra denied roots) explicitly. Nothing here reads environment variables or
 * assumes a home-directory layout.
 *
 * Recommended call order (what readFileJailed and writeFileJailed do):
 *
 *     await assertNoSymlink(`${root}/${pathStr}`, { operation });  // UNRESOLVED path
 *     const target = await assertInsideBoundary(pathStr, root, { denyRoots });
 *
 * then open `target` with O_NOFOLLOW (read) or write a temp file in the same
 * directory and rename it over `target` (write).
 *
 * Semantics match the Python package decision for decision (the shared corpus
 * ../../vectors/fs-vectors.json enforces it). In particular:
 *  - `assertInsideBoundary` resolves `root + "/" + pathStr` (or `pathStr` when it
 *    is absolute) with a port of CPython's non-strict `os.path.realpath`, NOT with
 *    `path.resolve()`: `..` is applied after the symlinks before it are followed,
 *    and a component that cannot be inspected is kept as is.
 *  - Containment is a string-prefix test against `realpath(root) + "/"`, so a
 *    sibling such as `<root>-evil/` is outside.
 *  - Dotfiles are rejected by the final component that names something (`.env`,
 *    `.env/`, `.env/./`, `a/..`), and by the final component of the resolved path
 *    (a symlink whose target is a dotfile). Dot-directories in the middle of a
 *    path (`.git/config`) are allowed, as in Python.
 *  - `assertNoSymlink` inspects every component of the UNRESOLVED path with
 *    lstat. ENOENT, ENOTDIR, ELOOP and EBADF mean "not a symlink" (CPython 3.12's
 *    `Path.is_symlink()` list); any other error fails closed.
 *
 * Platform: POSIX only (Linux tested). Windows is unsupported in v0.1: every
 * function throws BoundaryError('UNSUPPORTED_PLATFORM') on win32, because the
 * separator, drive-letter and junction rules below are POSIX rules.
 *
 * Not covered (the caller must handle these): a directory swapped for a symlink
 * between the check and the open/rename (O_NOFOLLOW protects only the final
 * component; use openat-style descriptor walking if the agent can race you),
 * hard links to files outside the boundary, and case-insensitive filesystems
 * (deny roots are compared as strings).
 */

import {
  constants,
  lstat,
  mkdir,
  open,
  readlink,
  rename,
  unlink,
  type FileHandle,
} from 'node:fs/promises';
import * as path from 'node:path';

export type BoundaryErrorCode =
  /** The final component (as written, or after resolution) starts with ".". */
  | 'DOTFILE'
  /** The resolved path is outside realpath(root). */
  | 'TRAVERSAL'
  /** The resolved path is inside one of `denyRoots`. */
  | 'DENIED_ROOT'
  /** The path itself is a symbolic link (also: swapped in before an O_NOFOLLOW open). */
  | 'SYMLINK'
  /** An ancestor of the path is a symbolic link. */
  | 'SYMLINK_IN_PATH'
  /** A component could not be inspected (EACCES, EPERM, EIO, ...): fail closed. */
  | 'UNINSPECTABLE'
  /** The path contains a NUL byte. */
  | 'INVALID_PATH'
  /** readFileJailed / writeFileJailed: the target exists and is not a regular file. */
  | 'NOT_A_FILE'
  /** readFileJailed: the file is larger than maxBytes. */
  | 'TOO_LARGE'
  /** Called on Windows (unsupported in v0.1). */
  | 'UNSUPPORTED_PLATFORM';

/** A refusal by the jail. `code` is stable; `message` mirrors the Python wording. */
export class BoundaryError extends Error {
  readonly code: BoundaryErrorCode;
  /** The path the decision was about (agent input, or the component inspected). */
  readonly path: string;

  constructor(code: BoundaryErrorCode, message: string, path: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BoundaryError';
    this.code = code;
    this.path = path;
  }
}

export interface BoundaryOptions {
  /**
   * Directories the path must not be inside, even when they sit inside the
   * boundary. Each is resolved with realpath. A single string is one root.
   */
  denyRoots?: string | Iterable<string>;
}

export interface NoSymlinkOptions {
  /** Only names the operation in the error message. Default "write". */
  operation?: string;
}

export interface ReadJailedOptions extends BoundaryOptions {
  /** Refuse (TOO_LARGE) a file with more bytes than this. Integer 0..268435456. */
  maxBytes: number;
  /** Return a string decoded with this encoding; omit for a Buffer. */
  encoding?: BufferEncoding;
}

export interface WriteJailedOptions extends BoundaryOptions {
  /** Create missing parent directories (after the checks). Default false. */
  createParents?: boolean;
  /**
   * Mode for a new file (umask applies). Default 0o666. When the target already
   * exists and `mode` is not given, the existing file's permission bits are kept.
   */
  mode?: number;
  /** Encoding for string data. Default "utf8". */
  encoding?: BufferEncoding;
}

/** Upper bound for ReadJailedOptions.maxBytes (same ceiling as FetchPolicy.maxBytes). */
export const MAX_READ_BYTES_CEILING = 256 * 1024 * 1024;

// CPython 3.12 Path.is_symlink() treats these lstat errors as "not a symlink".
// ELOOP needs a symlinked component, which the ancestor walk reports anyway.
const NOT_A_SYMLINK_ERRNOS = new Set(['ENOENT', 'ENOTDIR', 'ELOOP', 'EBADF']);

const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const O_NONBLOCK = constants.O_NONBLOCK ?? 0;

// ── helpers ──────────────────────────────────────────────────────────────────

function assertSupportedPlatform(): void {
  if (process.platform === 'win32') {
    throw new BoundaryError(
      'UNSUPPORTED_PLATFORM',
      'fs-jail: Windows is not supported (POSIX path semantics only)',
      '',
    );
  }
}

function requireString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string') {
    throw new TypeError(`fs-jail: ${name} must be a string`);
  }
}

function requireRoot(value: unknown, name: string): asserts value is string {
  requireString(value, name);
  if (value === '' || value.includes('\0')) {
    throw new TypeError(`fs-jail: ${name} must be a non-empty path without NUL bytes`);
  }
}

function denyRootList(denyRoots: BoundaryOptions['denyRoots']): string[] {
  if (denyRoots === undefined) return [];
  // A string is Iterable<string> too; never iterate it character by character.
  const list = typeof denyRoots === 'string' ? [denyRoots] : Array.from(denyRoots);
  for (const r of list) requireRoot(r, 'denyRoots entry');
  return list;
}

/** CPython posixpath.basename: '' for 'a/', '.' for 'a/.'. (path.basename strips the slash.) */
function pyBasename(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

/** Last component that names something ('' and '.' parts skipped). */
function finalComponent(p: string): string {
  const parts = p.split('/').filter((s) => s !== '' && s !== '.');
  return parts.length > 0 ? parts[parts.length - 1]! : '';
}

function isDotfileSpelling(pathStr: string): boolean {
  return pyBasename(pathStr).startsWith('.') || finalComponent(pathStr).startsWith('.');
}

function dotfileRejected(pathStr: string): BoundaryError {
  return new BoundaryError(
    'DOTFILE',
    `Dotfile rejected: "${pathStr}" — filenames starting with "." are not allowed`,
    pathStr,
  );
}

function nulRejected(p: string): BoundaryError {
  return new BoundaryError(
    'INVALID_PATH',
    `Invalid path: ${JSON.stringify(p)} contains a NUL byte`,
    p,
  );
}

/** `root / pathStr` without normalising `..` (what Python's `Path(root) / path_str` gives). */
function joinUnresolved(root: string, pathStr: string): string {
  return pathStr.startsWith('/') ? pathStr : `${root}/${pathStr}`;
}

function errnoCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Port of CPython 3.14 `os.path.realpath(p, strict=False)` (POSIX).
 *
 * Components are walked left to right; each is lstat'ed, and a symlink's target
 * is spliced into the remaining parts, so `..` applies to the resolved prefix.
 * Any lstat/readlink error keeps the component as is (non-strict), and a
 * symlink loop keeps the looping link's path. Relative input is anchored at
 * process.cwd(). The result is absolute with no '.', '..' or empty parts.
 */
async function realpathLoose(filename: string): Promise<string> {
  // Stack of unresolved parts. null marks "the symlink path below me is now resolved".
  const rest: (string | null)[] = filename.split('/').reverse();
  let partCount = rest.length;
  let resolved = filename.startsWith('/') ? '/' : process.cwd();
  const seen = new Map<string, string | null>();

  while (partCount > 0) {
    const name = rest.pop();
    if (name === null) {
      seen.set(rest.pop() as string, resolved);
      continue;
    }
    partCount -= 1;
    if (name === undefined || name === '' || name === '.') continue;
    if (name === '..') {
      resolved = resolved.slice(0, resolved.lastIndexOf('/')) || '/';
      continue;
    }
    const newpath = resolved === '/' ? `/${name}` : `${resolved}/${name}`;
    let target: string;
    try {
      const st = await lstat(newpath);
      if (!st.isSymbolicLink()) {
        resolved = newpath;
        continue;
      }
      if (seen.has(newpath)) {
        const cached = seen.get(newpath);
        // A cached target, or (null) a symlink loop: keep the link's own path.
        resolved = cached ?? newpath;
        continue;
      }
      target = await readlink(newpath);
    } catch {
      // Non-strict: a component that cannot be inspected is kept as is.
      resolved = newpath;
      continue;
    }
    if (target.startsWith('/')) resolved = '/';
    seen.set(newpath, null);
    rest.push(newpath, null);
    const targetParts = target.split('/').reverse();
    rest.push(...targetParts);
    partCount += targetParts.length;
  }
  return resolved;
}

/** lstat(p).isSymbolicLink(), failing closed when the component cannot be inspected. */
async function isSymlink(p: string, operation: string): Promise<boolean> {
  try {
    return (await lstat(p)).isSymbolicLink();
  } catch (err) {
    const code = errnoCode(err);
    if (code !== undefined && NOT_A_SYMLINK_ERRNOS.has(code)) return false;
    const reason = code ?? (err instanceof Error ? err.message || err.name : String(err));
    throw new BoundaryError(
      'UNINSPECTABLE',
      `Path not inspectable on ${operation}: "${p}" (${reason})`,
      p,
      { cause: err },
    );
  }
}

// ── public API ───────────────────────────────────────────────────────────────

/**
 * Resolve the agent-supplied `pathStr` against `root` and return the resolved
 * absolute path, or throw BoundaryError (DOTFILE, INVALID_PATH, TRAVERSAL,
 * DENIED_ROOT, in that order of checks).
 *
 * Relative paths are anchored at `root`, not at the CWD; an absolute `pathStr`
 * is taken as is and must still land inside `root`. Symlinks are followed (and
 * so are allowed when they stay inside); call assertNoSymlink first to refuse
 * them. `root` itself is accepted. A relative `root` or deny root is resolved
 * against process.cwd(), as in Python; pass absolute, realpath'd roots.
 */
export async function assertInsideBoundary(
  pathStr: string,
  root: string,
  opts: BoundaryOptions = {},
): Promise<string> {
  assertSupportedPlatform();
  requireString(pathStr, 'pathStr');
  requireRoot(root, 'root');
  const denyRoots = denyRootList(opts.denyRoots);

  // Final component as written. pyBasename keeps '.', 'a/.' and 'a/..' rejected;
  // finalComponent closes '.env/', '.env/./' and friends.
  if (isDotfileSpelling(pathStr)) throw dotfileRejected(pathStr);
  // CPython's lstat raises ValueError('embedded null byte') at this point.
  if (pathStr.includes('\0')) throw nulRejected(pathStr);

  const resolved = await realpathLoose(joinUnresolved(root, pathStr));
  const rootReal = await realpathLoose(root);
  const inside = resolved.startsWith(`${rootReal}/`) || resolved === rootReal;
  if (!inside) {
    throw new BoundaryError(
      'TRAVERSAL',
      `Path traversal rejected: "${pathStr}" resolves outside workspace boundary`,
      pathStr,
    );
  }

  // Same rule after resolution: a symlink whose target is a dotfile or dot-directory.
  if (resolved !== rootReal && pyBasename(resolved).startsWith('.')) {
    throw dotfileRejected(pathStr);
  }

  for (const denied of denyRoots) {
    const deniedReal = await realpathLoose(denied);
    if (resolved.startsWith(`${deniedReal}/`) || resolved === deniedReal) {
      throw new BoundaryError(
        'DENIED_ROOT',
        `Denied root: "${pathStr}" targets a denied directory`,
        pathStr,
      );
    }
  }
  return resolved;
}

/**
 * Throw BoundaryError if `p` itself (SYMLINK) or any ancestor up to, not
 * including, "/" (SYMLINK_IN_PATH) is a symlink, or if a component cannot be
 * inspected (UNINSPECTABLE). Pass the UNRESOLVED path (`root + "/" + pathStr`,
 * not path.join/path.resolve, which drop `..` components before they are
 * checked). Empty and '.' components are ignored; '..' components are kept.
 */
export async function assertNoSymlink(p: string, opts: NoSymlinkOptions = {}): Promise<void> {
  assertSupportedPlatform();
  requireString(p, 'path');
  const operation = opts.operation ?? 'write';
  // Fail closed: a NUL byte makes the path uninspectable by lstat.
  if (p.includes('\0')) throw nulRejected(p);

  const absolute = p.startsWith('/');
  const parts = p.split('/').filter((s) => s !== '' && s !== '.');
  const spell = (n: number): string => {
    const joined = parts.slice(0, n).join('/');
    return absolute ? `/${joined}` : joined || '.';
  };

  const target = spell(parts.length);
  if (await isSymlink(target, operation)) {
    throw new BoundaryError(
      'SYMLINK',
      `Symlink rejected on ${operation}: "${target}" is a symbolic link`,
      target,
    );
  }
  for (let n = parts.length - 1; n >= 1; n -= 1) {
    const ancestor = spell(n);
    if (await isSymlink(ancestor, operation)) {
      throw new BoundaryError(
        'SYMLINK_IN_PATH',
        `Symlink in path rejected on ${operation}: "${ancestor}" is a symbolic link`,
        ancestor,
      );
    }
  }
}

/** Both checks, in the reference tools' order: unresolved-path symlink gate, then containment. */
async function gate(
  pathStr: string,
  root: string,
  operation: 'read' | 'write',
  opts: BoundaryOptions,
): Promise<string> {
  requireString(pathStr, 'pathStr');
  requireRoot(root, 'root');
  await assertNoSymlink(joinUnresolved(root, pathStr), { operation });
  return assertInsideBoundary(pathStr, root, opts);
}

function validMaxBytes(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_READ_BYTES_CEILING
  ) {
    throw new TypeError(
      `fs-jail: maxBytes must be an integer from 0 to ${MAX_READ_BYTES_CEILING}`,
    );
  }
  return value;
}

/**
 * Read a regular file inside `root`: assertNoSymlink (operation "read") on the
 * unresolved path, assertInsideBoundary, then open the resolved path with
 * O_RDONLY | O_NOFOLLOW | O_NONBLOCK (a symlink swapped in after the checks is
 * SYMLINK; a FIFO cannot block). A target that is not a regular file is
 * NOT_A_FILE, more than maxBytes is TOO_LARGE. Other I/O errors (ENOENT, EACCES)
 * are thrown unchanged.
 */
export async function readFileJailed(
  pathStr: string,
  root: string,
  opts: ReadJailedOptions & { encoding: BufferEncoding },
): Promise<string>;
export async function readFileJailed(
  pathStr: string,
  root: string,
  opts: ReadJailedOptions & { encoding?: undefined },
): Promise<Buffer>;
export async function readFileJailed(
  pathStr: string,
  root: string,
  opts: ReadJailedOptions,
): Promise<string | Buffer>;
export async function readFileJailed(
  pathStr: string,
  root: string,
  opts: ReadJailedOptions,
): Promise<string | Buffer> {
  assertSupportedPlatform();
  if (typeof opts !== 'object' || opts === null) {
    throw new TypeError('fs-jail: readFileJailed options with maxBytes are required');
  }
  const maxBytes = validMaxBytes(opts.maxBytes);
  const target = await gate(pathStr, root, 'read', opts);

  let fh: FileHandle;
  try {
    fh = await open(target, constants.O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  } catch (err) {
    // O_NOFOLLOW on a symlink fails with ELOOP (Linux, macOS) or EMLINK (FreeBSD).
    const code = errnoCode(err);
    if (code === 'ELOOP' || code === 'EMLINK') {
      throw new BoundaryError(
        'SYMLINK',
        `Symlink rejected on read: "${target}" is a symbolic link`,
        target,
        { cause: err },
      );
    }
    throw err;
  }
  try {
    const st = await fh.stat();
    if (!st.isFile()) {
      throw new BoundaryError(
        'NOT_A_FILE',
        `Not a regular file on read: "${pathStr}"`,
        pathStr,
      );
    }
    if (st.size > maxBytes) {
      throw new BoundaryError(
        'TOO_LARGE',
        `File too large on read: "${pathStr}" exceeds ${maxBytes} bytes`,
        pathStr,
      );
    }
    // Read at most maxBytes + 1, so a file that grew after fstat is still refused.
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const want = Math.min(64 * 1024, maxBytes + 1 - total);
      const buf = Buffer.allocUnsafe(want);
      const { bytesRead } = await fh.read(buf, 0, want, null);
      if (bytesRead === 0) break;
      chunks.push(buf.subarray(0, bytesRead));
      total += bytesRead;
      if (total > maxBytes) {
        throw new BoundaryError(
          'TOO_LARGE',
          `File too large on read: "${pathStr}" exceeds ${maxBytes} bytes`,
          pathStr,
        );
      }
    }
    const data = Buffer.concat(chunks, total);
    return opts.encoding !== undefined ? data.toString(opts.encoding) : data;
  } finally {
    await fh.close();
  }
}

let tempCounter = 0;

/**
 * Write `data` to a file inside `root`, atomically: the same gate as
 * readFileJailed (operation "write"), then a temp file in the target's
 * directory (O_CREAT | O_EXCL | O_NOFOLLOW), fsync, and rename over the target.
 * A target that is a symlink is refused (SYMLINK) at check time and again just
 * before the rename; rename replaces a directory entry and never writes through
 * a link, so a symlink swapped in at the last moment is replaced, not followed.
 * A target that exists and is not a regular file is NOT_A_FILE. Returns the
 * resolved target path. Missing parents are ENOENT unless `createParents`.
 */
export async function writeFileJailed(
  pathStr: string,
  data: string | Uint8Array,
  root: string,
  opts: WriteJailedOptions = {},
): Promise<string> {
  assertSupportedPlatform();
  if (typeof data !== 'string' && !(data instanceof Uint8Array)) {
    throw new TypeError('fs-jail: data must be a string or a Uint8Array');
  }
  if (opts.mode !== undefined && (!Number.isInteger(opts.mode) || opts.mode < 0 || opts.mode > 0o7777)) {
    throw new TypeError('fs-jail: mode must be an integer from 0 to 0o7777');
  }
  const target = await gate(pathStr, root, 'write', opts);
  const dir = path.dirname(target);
  if (opts.createParents === true) await mkdir(dir, { recursive: true });

  const symlinkRejected = (): BoundaryError =>
    new BoundaryError(
      'SYMLINK',
      `Symlink rejected on write: "${target}" is a symbolic link`,
      target,
    );
  const existingMode = async (): Promise<number | undefined> => {
    try {
      const st = await lstat(target);
      if (st.isSymbolicLink()) throw symlinkRejected();
      if (!st.isFile()) {
        throw new BoundaryError(
          'NOT_A_FILE',
          `Not a regular file on write: "${pathStr}"`,
          pathStr,
        );
      }
      return st.mode & 0o7777;
    } catch (err) {
      if (errnoCode(err) === 'ENOENT') return undefined;
      throw err;
    }
  };

  const keepMode = await existingMode();
  tempCounter = (tempCounter + 1) % 0x100000;
  const nonce = `${process.pid.toString(36)}${tempCounter.toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const temp = path.join(dir, `.${path.basename(target)}.${nonce}.tmp`);
  const bytes = typeof data === 'string' ? Buffer.from(data, opts.encoding ?? 'utf8') : data;

  const fh = await open(
    temp,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | O_NOFOLLOW,
    opts.mode ?? 0o666,
  );
  let renamed = false;
  try {
    try {
      if (opts.mode === undefined && keepMode !== undefined) await fh.chmod(keepMode);
      await fh.writeFile(bytes);
      await fh.sync();
    } finally {
      await fh.close();
    }
    await existingMode(); // re-check just before the rename (narrows the window)
    await rename(temp, target);
    renamed = true;
  } finally {
    if (!renamed) await unlink(temp).catch(() => undefined);
  }
  return target;
}
