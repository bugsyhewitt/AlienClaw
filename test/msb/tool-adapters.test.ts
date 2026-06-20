/**
 * tool-adapters.test.ts
 *
 * Unit tests for the Martian tool adapters in
 * src/alienclaw/msb/tool-adapters.ts — with a focus on the SECURITY BOUNDARY.
 *
 * The module under test captures path constants (PATHS.workspace and
 * OUTPUT_DIR = PATHS.output) at MODULE LOAD TIME, and those constants are
 * derived from the ALIENCLAW_HOME environment variable when constants.ts is
 * first imported. To keep every test hermetic — and to guarantee we NEVER
 * touch the real ~/.alienclaw home — we:
 *
 *   1. Point ALIENCLAW_HOME at a throwaway mkdtemp directory BEFORE importing.
 *   2. vi.resetModules() and dynamically import constants.js + tool-adapters.js
 *      so they bind to the temp PATHS.
 *   3. wireToolAdapters() registers the (non-exported) adapters into the
 *      executor registry; we then drive each adapter via getToolAdapter(name)
 *      — exactly how the Martian executor invokes them in production.
 *
 * assertInsideBoundary (L28-37) is the path-traversal guard. It is private, so
 * it is exercised through file_read (scoped to PATHS.workspace) and file_write
 * (scoped to OUTPUT_DIR) using "../escape"-style inputs — i.e. via the same
 * code path an attacker would hit.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

// ── Types for the dynamically-imported modules ─────────────────────────────

type ToolFn = (input: Record<string, unknown>) => Promise<unknown>;

interface ToolAdaptersModule {
  wireToolAdapters: () => void;
}
interface ExecutorModule {
  getToolAdapter: (name: string) => ToolFn | undefined;
}
interface ConstantsModule {
  PATHS: { home: string; workspace: string; output: string };
  MAX_FILE_READ_BYTES: number;
}

// ── Hermetic temp-home setup ───────────────────────────────────────────────

let tmpHome: string;
let PATHS: ConstantsModule['PATHS'];
let MAX_FILE_READ_BYTES: number;

let fileRead!: ToolFn;
let fileWrite!: ToolFn;
let urlFetch!: ToolFn;
let webSearch!: ToolFn;

beforeAll(async () => {
  // 1. Throwaway home — set BEFORE the modules under test are imported.
  tmpHome = mkdtempSync(path.join(tmpdir(), 'alienclaw-tooladapter-'));
  process.env['ALIENCLAW_HOME'] = tmpHome;

  // 2. Reset the module graph so constants.ts re-reads ALIENCLAW_HOME and
  //    tool-adapters.ts re-captures PATHS.workspace / OUTPUT_DIR.
  const vitest = await import('vitest');
  vitest.vi.resetModules();

  const constants = (await import(
    '../../src/alienclaw/constants.js'
  )) as unknown as ConstantsModule;
  PATHS = constants.PATHS;
  MAX_FILE_READ_BYTES = constants.MAX_FILE_READ_BYTES;

  // Sanity: the modules really did bind to our temp home, not the real one.
  expect(PATHS.home).toBe(tmpHome);
  expect(PATHS.workspace).toBe(path.join(tmpHome, 'workspace'));
  expect(PATHS.output).toBe(path.join(tmpHome, 'workspace', 'output'));

  const adapters = (await import(
    '../../src/alienclaw/msb/tool-adapters.js'
  )) as unknown as ToolAdaptersModule;
  const executor = (await import(
    '../../src/alienclaw/msb/martian-executor.js'
  )) as unknown as ExecutorModule;

  // 3. Register the adapters, then fetch them the way the executor does.
  adapters.wireToolAdapters();

  fileRead = executor.getToolAdapter('file_read')!;
  fileWrite = executor.getToolAdapter('file_write')!;
  urlFetch = executor.getToolAdapter('url_fetch')!;
  webSearch = executor.getToolAdapter('web_search')!;

  expect(fileRead).toBeTypeOf('function');
  expect(fileWrite).toBeTypeOf('function');
  expect(urlFetch).toBeTypeOf('function');
});

afterAll(() => {
  // Never leave a temp home behind, even on failure.
  rmSync(tmpHome, { recursive: true, force: true });
});

// Each test starts from clean workspace + output directories.
beforeEach(() => {
  rmSync(PATHS.workspace, { recursive: true, force: true });
  mkdirSync(PATHS.workspace, { recursive: true });
  mkdirSync(PATHS.output, { recursive: true });
});

// ───────────────────────────────────────────────────────────────────────────
// assertInsideBoundary — path-traversal guard (L28-37)
//   Driven through file_read (boundary = PATHS.workspace) and file_write
//   (boundary = OUTPUT_DIR). These are the real attacker code paths.
// ───────────────────────────────────────────────────────────────────────────

describe('assertInsideBoundary (path-traversal guard)', () => {
  describe('rejects out-of-boundary paths', () => {
    it('file_read rejects a single "../escape"', async () => {
      await expect(fileRead({ path: '../escape' })).rejects.toThrow(
        /Path traversal rejected/,
      );
    });

    it('file_read rejects deep "../../etc/passwd" traversal', async () => {
      await expect(fileRead({ path: '../../etc/passwd' })).rejects.toThrow(
        /Path traversal rejected/,
      );
    });

    it('file_read rejects a "./../" prefixed escape', async () => {
      await expect(fileRead({ path: './../../secret' })).rejects.toThrow(
        /resolves outside boundary/,
      );
    });

    it('file_read rejects an absolute path that escapes the workspace', async () => {
      // path.resolve(boundary, "/etc/hosts") === "/etc/hosts" → outside.
      await expect(fileRead({ path: '/etc/hosts' })).rejects.toThrow(
        /Path traversal rejected/,
      );
    });

    it('file_write rejects "../escape" out of the OUTPUT_DIR', async () => {
      await expect(
        fileWrite({ path: '../escape', content: 'nope' }),
      ).rejects.toThrow(/Path traversal rejected/);
      // And nothing was written outside the boundary.
      expect(existsSync(path.join(PATHS.workspace, 'escape'))).toBe(false);
    });

    it('file_write rejects a sibling-dir escape that shares a name prefix', async () => {
      // OUTPUT_DIR is "<home>/workspace/output". A sibling like
      // "<home>/workspace/output-evil" must NOT pass the startsWith check,
      // because the guard requires boundary + path.sep, not a bare prefix.
      const evil = path.join('..', 'output-evil', 'x');
      await expect(
        fileWrite({ path: evil, content: 'nope' }),
      ).rejects.toThrow(/Path traversal rejected/);
    });

    it('rejection message names the offending path and the boundary', async () => {
      await expect(fileRead({ path: '../escape' })).rejects.toThrow(
        new RegExp(`"\\.\\./escape".*"${escapeRe(PATHS.workspace)}"`),
      );
    });
  });

  describe('accepts in-boundary paths', () => {
    it('file_read accepts a plain in-boundary file and returns its contents', async () => {
      writeFileSync(path.join(PATHS.workspace, 'note.txt'), 'hello world', 'utf-8');

      const out = (await fileRead({ path: 'note.txt' })) as {
        path: string;
        contents: string;
        sizeBytes: number;
      };

      expect(out.path).toBe('note.txt');
      expect(out.contents).toBe('hello world');
      expect(out.sizeBytes).toBe(Buffer.byteLength('hello world', 'utf-8'));
    });

    it('file_read accepts a nested sub-directory path inside the boundary', async () => {
      const nestedDir = path.join(PATHS.workspace, 'sub', 'dir');
      mkdirSync(nestedDir, { recursive: true });
      writeFileSync(path.join(nestedDir, 'deep.txt'), 'deep', 'utf-8');

      const out = (await fileRead({ path: 'sub/dir/deep.txt' })) as {
        contents: string;
      };
      expect(out.contents).toBe('deep');
    });

    it('file_read treats an inner "a/../b" (still inside) as in-boundary', async () => {
      // "a/../note2.txt" normalises to "<workspace>/note2.txt" — inside.
      writeFileSync(path.join(PATHS.workspace, 'note2.txt'), 'normed', 'utf-8');
      const out = (await fileRead({ path: 'a/../note2.txt' })) as {
        contents: string;
      };
      expect(out.contents).toBe('normed');
    });

    it('file_write accepts an in-boundary path and actually writes the file', async () => {
      const out = (await fileWrite({
        path: 'result.txt',
        content: 'written-content',
      })) as { path: string; sizeBytes: number; created: boolean };

      expect(out.created).toBe(true);
      expect(out.path).toBe('result.txt');
      const onDisk = readFileSync(path.join(PATHS.output, 'result.txt'), 'utf-8');
      expect(onDisk).toBe('written-content');
    });

    it('file_write creates intermediate directories for a nested in-boundary path', async () => {
      const out = (await fileWrite({
        path: 'reports/2026/out.txt',
        content: 'nested-write',
      })) as { created: boolean };

      expect(out.created).toBe(true);
      const onDisk = readFileSync(
        path.join(PATHS.output, 'reports', '2026', 'out.txt'),
        'utf-8',
      );
      expect(onDisk).toBe('nested-write');
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// file_read — ENOENT clean error (L108) and oversize rejection (L115)
// ───────────────────────────────────────────────────────────────────────────

describe('fileReadAdapter', () => {
  it('maps ENOENT to a clean "file_read: not found" error (L108)', async () => {
    // In-boundary path that does not exist → ENOENT, not a path-traversal error.
    await expect(fileRead({ path: 'does-not-exist.txt' })).rejects.toThrow(
      /^file_read: not found:/,
    );
  });

  it('does not leak a raw Node ENOENT error string', async () => {
    await expect(fileRead({ path: 'missing.txt' })).rejects.not.toThrow(
      /ENOENT/,
    );
  });

  it('accepts the alternate "task" key as the path source', async () => {
    writeFileSync(path.join(PATHS.workspace, 'viatask.txt'), 'task-key', 'utf-8');
    const out = (await fileRead({ task: 'viatask.txt' })) as { contents: string };
    expect(out.contents).toBe('task-key');
  });

  it('reads a file exactly at the MAX_FILE_READ_BYTES limit', async () => {
    // Exactly at the limit must be allowed (guard is strictly ">").
    // Use a small synthetic limit-equivalent: build a file of MAX bytes only
    // if the limit is modest; otherwise assert the boundary with limit-1/limit.
    const atLimit = 'a'.repeat(MAX_FILE_READ_BYTES);
    writeFileSync(path.join(PATHS.workspace, 'atlimit.txt'), atLimit, 'utf-8');

    const out = (await fileRead({ path: 'atlimit.txt' })) as {
      sizeBytes: number;
    };
    expect(out.sizeBytes).toBe(MAX_FILE_READ_BYTES);
  });

  it('rejects a file ONE byte over MAX_FILE_READ_BYTES (L115)', async () => {
    const tooBig = 'a'.repeat(MAX_FILE_READ_BYTES + 1);
    writeFileSync(path.join(PATHS.workspace, 'toobig.txt'), tooBig, 'utf-8');

    await expect(fileRead({ path: 'toobig.txt' })).rejects.toThrow(
      /file_read: file too large/,
    );
  });

  it('oversize error reports the actual size and the configured limit', async () => {
    const size = MAX_FILE_READ_BYTES + 5;
    writeFileSync(
      path.join(PATHS.workspace, 'toobig2.txt'),
      'a'.repeat(size),
      'utf-8',
    );
    await expect(fileRead({ path: 'toobig2.txt' })).rejects.toThrow(
      new RegExp(`${size} bytes, limit ${MAX_FILE_READ_BYTES}`),
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// file_write — atomic create-or-fail 'wx' refuses overwrite on EEXIST (L141)
// ───────────────────────────────────────────────────────────────────────────

describe('fileWriteAdapter (refuse-overwrite, atomic wx)', () => {
  it('refuses to overwrite an existing file (EEXIST → throws, L141)', async () => {
    const first = (await fileWrite({
      path: 'once.txt',
      content: 'original',
    })) as { created: boolean };
    expect(first.created).toBe(true);

    // Second write to the same path must fail rather than clobber.
    await expect(
      fileWrite({ path: 'once.txt', content: 'OVERWRITE-ATTEMPT' }),
    ).rejects.toThrow();

    // The original content is preserved — no clobber happened.
    const onDisk = readFileSync(path.join(PATHS.output, 'once.txt'), 'utf-8');
    expect(onDisk).toBe('original');
  });

  it('refuses overwrite even when the new content is identical', async () => {
    await fileWrite({ path: 'idem.txt', content: 'same' });
    await expect(
      fileWrite({ path: 'idem.txt', content: 'same' }),
    ).rejects.toThrow();
  });

  it('serialises non-string content to JSON before writing', async () => {
    const out = (await fileWrite({
      path: 'obj.json',
      content: { a: 1, b: ['x', 'y'] },
    })) as { created: boolean; sizeBytes: number };

    expect(out.created).toBe(true);
    const onDisk = readFileSync(path.join(PATHS.output, 'obj.json'), 'utf-8');
    expect(JSON.parse(onDisk)).toEqual({ a: 1, b: ['x', 'y'] });
    expect(out.sizeBytes).toBe(Buffer.byteLength(onDisk, 'utf-8'));
  });

  it('reports an accurate byte size for the written file', async () => {
    const content = 'sized-content- %% áéí'; // multi-byte chars on purpose
    const out = (await fileWrite({ path: 'sized.txt', content })) as {
      sizeBytes: number;
    };
    expect(out.sizeBytes).toBe(Buffer.byteLength(content, 'utf-8'));
  });
});

// ───────────────────────────────────────────────────────────────────────────
// url_fetch — non-https rejected (L80); https passes the guard (stub)
// ───────────────────────────────────────────────────────────────────────────

describe('urlFetchAdapter (https-only guard, L80)', () => {
  it.each([
    ['http (insecure)', 'http://example.com'],
    ['ftp scheme', 'ftp://example.com/file'],
    ['scheme-relative', '//example.com'],
    ['bare host', 'example.com'],
    ['empty string', ''],
    ['HTTPS upper-case (scheme is case-sensitive here)', 'HTTPS://example.com'],
  ])('rejects %s', async (_label, url) => {
    // The SSRF-hardened guard (PR #53) rejects with one of:
    //   "url_fetch: refusing malformed URL: ..."      (empty, bare host, scheme-relative)
    //   "url_fetch: refusing non-https URL: ..."      (http, ftp)
    //   "url_fetch: refusing off-allowlist host: ..." (HTTPS uppercase canonicalises
    //     to https: by URL parser, then fails the allowlist gate — same net effect:
    //     a non-https-scheme attempt cannot reach the network)
    await expect(urlFetch({ url })).rejects.toThrow(
      /^url_fetch: refusing /,
    );
  });

  it('rejects when the url key is missing entirely', async () => {
    await expect(urlFetch({})).rejects.toThrow(/^url_fetch: refusing /);
  });

  it('the rejection echoes the offending url back in the message', async () => {
    await expect(urlFetch({ url: 'http://bad.example' })).rejects.toThrow(
      /"http:\/\/bad\.example"/,
    );
  });

  it('accepts an https:// url and returns the v0.1 stub contract', async () => {
    // Use an allowlisted host (ALLOWED_FETCH_HOSTS — PR #53 SSRF hardening).
    // `assertSafeFetchUrl` returns the canonicalised URL.toString(), which
    // appends the implicit "/" path for an origin-only input.
    const out = (await urlFetch({ url: 'https://api.alienclaw.net/page' })) as {
      url: string;
      statusCode: number;
      content: string;
      _stub?: boolean;
    };
    // Guard passed; OpenClaw wiring is a v0.2 stub.
    expect(out.url).toBe('https://api.alienclaw.net/page');
    expect(out.statusCode).toBe(0);
    expect(out.content).toBe('');
    expect(out._stub).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// wiring — adapters are registered and idempotent
// ───────────────────────────────────────────────────────────────────────────

describe('wireToolAdapters wiring', () => {
  it('registers all four adapters into the executor registry', async () => {
    const executor = (await import(
      '../../src/alienclaw/msb/martian-executor.js'
    )) as unknown as ExecutorModule;
    for (const name of ['web_search', 'url_fetch', 'file_read', 'file_write']) {
      expect(executor.getToolAdapter(name)).toBeTypeOf('function');
    }
  });

  it('web_search returns the v0.1 stub contract (no external call)', async () => {
    const out = (await webSearch({ query: 'martians' })) as {
      query: string;
      results: unknown[];
      _stub?: boolean;
    };
    expect(out.query).toBe('martians');
    expect(out.results).toEqual([]);
    expect(out._stub).toBe(true);
  });

  it('web_search throws on an empty query', async () => {
    await expect(webSearch({ query: '   ' })).rejects.toThrow(
      /web_search: query is empty/,
    );
  });
});

// ── helpers ────────────────────────────────────────────────────────────────

/** Escape a string for safe interpolation into a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
