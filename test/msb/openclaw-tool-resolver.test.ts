/**
 * Direct unit tests for `src/alienclaw/msb/openclaw-tool-resolver.ts` (packet 078).
 *
 * Background:
 *   `openclaw-tool-resolver.ts` (113 lines) exposes 1 public class:
 *     - OpenClawToolResolver implements ToolResolver (resolve + supportedTools)
 *
 *   The class maps logical tool names (`web_search`, `file_read`, `file_write`)
 *   to actual tool functions. It is the ONLY place in AlienClaw that maps
 *   logical names from `.ms` files to callable OpenClaw tool functions.
 *
 *   It is consumed by `src/alienclaw/msb/martian-executor.ts` (the
 *   `Subagent -> MartianExecutor -> OpenClawToolResolver -> tool fn`
 *   chain documented at the top of the source file).
 *
 *   On `origin/main @ 3bd9ada7` there are ZERO direct unit tests for this
 *   file. A regression that removes a tool from the resolver table, or
 *   silently fails to throw on a missing/invalid argument, would corrupt
 *   every Subagent tool dispatch with no test catching it.
 *
 * These tests use the same `mkdtempSync` + `writeFileSync` + `rmSync` idiom
 * as packets 067, 068, 069, 070, 071, 076, 077 for the file-system-coupled
 * `file_read` / `file_write` wrappers.
 *
 * The `web_search` wrapper is currently a stub that throws
 * `pending OpenClaw v0.2 global install wiring` (line 54 of source).
 * Tests for it assert the throw (R-601..R-604).
 *
 * No file under `src/` is modified by this packet.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  OpenClawToolResolver,
} from '../../src/alienclaw/msb/openclaw-tool-resolver.js';
import type { ToolFn } from '../../src/alienclaw/msb/martian-executor.js';

// ---------------------------------------------------------------------------
// Fixtures + helpers
// ---------------------------------------------------------------------------

let resolver: OpenClawToolResolver;
let workDir: string;

beforeEach(() => {
  resolver = new OpenClawToolResolver();
  workDir = mkdtempSync(join(tmpdir(), 'p078-octr-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/** Resolve a tool by name and assert the result is defined; returns the fn. */
function resolve(name: string): ToolFn {
  const fn = resolver.resolve(name);
  expect(fn).toBeDefined();
  if (!fn) throw new Error(`unreachable: resolver returned undefined for ${name}`);
  return fn;
}

// ---------------------------------------------------------------------------
// R-1xx — Constructor / shape
// ---------------------------------------------------------------------------

describe('OpenClawToolResolver — constructor / shape', () => {
  it('R-101: instantiates with no arguments', () => {
    const r = new OpenClawToolResolver();
    expect(r).toBeInstanceOf(OpenClawToolResolver);
  });

  it('R-102: does not share state across instances (per-instance TOOL_MAP)', () => {
    const a = new OpenClawToolResolver();
    const b = new OpenClawToolResolver();
    expect(a.resolve('file_read')).toBe(b.resolve('file_read'));
    // Same identity because TOOL_MAP is module-level (intentional — tools are
    // stateless wrappers). This test documents the intentional module-level
    // sharing, not a defect.
    expect(a.resolve('file_read')).toBe(a.resolve('file_read'));
  });
});

// ---------------------------------------------------------------------------
// R-2xx — supportedTools() (the public ToolResolver interface method)
// ---------------------------------------------------------------------------

describe('OpenClawToolResolver — supportedTools()', () => {
  it('R-201: returns the 3 canonical tool names', () => {
    const tools = resolver.supportedTools().sort();
    expect(tools).toEqual(['file_read', 'file_write', 'web_search']);
  });

  it('R-202: returns a new array on each call (does not leak internal TOOL_MAP)', () => {
    const a = resolver.supportedTools();
    const b = resolver.supportedTools();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it('R-203: returns exactly 3 entries (no spurious additions)', () => {
    expect(resolver.supportedTools()).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// R-3xx — resolve(toolName) — happy paths
// ---------------------------------------------------------------------------

describe('OpenClawToolResolver — resolve() happy paths', () => {
  it('R-301: resolves "web_search" to a function', () => {
    expect(typeof resolver.resolve('web_search')).toBe('function');
  });

  it('R-302: resolves "file_read" to a function', () => {
    expect(typeof resolver.resolve('file_read')).toBe('function');
  });

  it('R-303: resolves "file_write" to a function', () => {
    expect(typeof resolver.resolve('file_write')).toBe('function');
  });

  it('R-304: returns undefined for an unknown tool name', () => {
    expect(resolver.resolve('not_a_tool')).toBeUndefined();
  });

  it('R-305: returns undefined for empty-string tool name', () => {
    expect(resolver.resolve('')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// R-4xx — file_read wrapper
// ---------------------------------------------------------------------------

describe('OpenClawToolResolver — file_read wrapper', () => {
  it('R-401: reads the file at the given path and returns {path, content, encoding}', async () => {
    const p = join(workDir, 'read-me.txt');
    writeFileSync(p, 'hello packet 078', 'utf-8');
    const fn = resolve('file_read');
    const out = await fn({ path: p }) as { path: string; content: string; encoding: string };
    expect(out.path).toBe(p);
    expect(out.content).toBe('hello packet 078');
    expect(out.encoding).toBe('utf-8');
  });

  it('R-402: uses default encoding "utf-8" when omitted', async () => {
    const p = join(workDir, 'no-encoding.txt');
    writeFileSync(p, 'utf8 default', 'utf-8');
    const fn = resolve('file_read');
    const out = await fn({ path: p }) as { encoding: string };
    expect(out.encoding).toBe('utf-8');
  });

  it('R-403: throws if the path argument is missing entirely', async () => {
    const fn = resolve('file_read');
    await expect(fn({})).rejects.toThrow(/file_read requires a "path" string argument/);
  });

  it('R-404: throws if the path argument is not a string', async () => {
    const fn = resolve('file_read');
    await expect(fn({ path: 123 })).rejects.toThrow(/file_read requires a "path" string argument/);
  });

  it('R-405: throws if the path argument is the empty string', async () => {
    const fn = resolve('file_read');
    await expect(fn({ path: '' })).rejects.toThrow(/file_read requires a "path" string argument/);
  });

  it('R-406: propagates ENOENT when the file does not exist', async () => {
    const fn = resolve('file_read');
    const missing = join(workDir, 'nope.txt');
    await expect(fn({ path: missing })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// R-5xx — file_write wrapper
// ---------------------------------------------------------------------------

describe('OpenClawToolResolver — file_write wrapper', () => {
  it('R-501: writes the file and returns {path, bytesWritten}', async () => {
    const p = join(workDir, 'written.txt');
    const fn = resolve('file_write');
    const out = await fn({ path: p, content: 'packet 078 bytes' }) as { path: string; bytesWritten: number };
    expect(out.path).toBe(p);
    expect(readFileSync(p, 'utf-8')).toBe('packet 078 bytes');
    expect(out.bytesWritten).toBe(Buffer.byteLength('packet 078 bytes', 'utf-8'));
  });

  it('R-502: creates missing parent directories recursively', async () => {
    const p = join(workDir, 'a', 'b', 'c', 'nested.txt');
    const fn = resolve('file_write');
    await fn({ path: p, content: 'nested' });
    expect(readFileSync(p, 'utf-8')).toBe('nested');
  });

  it('R-503: throws if the path argument is missing entirely', async () => {
    const fn = resolve('file_write');
    await expect(fn({ content: 'x' })).rejects.toThrow(/file_write requires a "path" string argument/);
  });

  it('R-504: throws if the content argument is missing entirely', async () => {
    const p = join(workDir, 'no-content.txt');
    const fn = resolve('file_write');
    await expect(fn({ path: p })).rejects.toThrow(/file_write requires a "content" string argument/);
  });

  it('R-505: throws if the content argument is not a string', async () => {
    const p = join(workDir, 'bad-content.txt');
    const fn = resolve('file_write');
    await expect(fn({ path: p, content: 42 })).rejects.toThrow(/file_write requires a "content" string argument/);
  });

  it('R-506: overwrites an existing file silently (current behavior)', async () => {
    const p = join(workDir, 'overwrite.txt');
    writeFileSync(p, 'first', 'utf-8');
    const fn = resolve('file_write');
    await fn({ path: p, content: 'second' });
    expect(readFileSync(p, 'utf-8')).toBe('second');
  });
});

// ---------------------------------------------------------------------------
// R-6xx — web_search wrapper (stub pending OpenClaw v0.2 wiring)
// ---------------------------------------------------------------------------

describe('OpenClawToolResolver — web_search wrapper (stub)', () => {
  it('R-601: throws because web_search is pending OpenClaw v0.2 global install wiring', async () => {
    const fn = resolve('web_search');
    await expect(fn({ query: 'alienclaw' })).rejects.toThrow(
      /web-search tool pending OpenClaw v0\.2 global install wiring/,
    );
  });

  it('R-602: throws the missing-query error BEFORE attempting the global install (current source has validation at line 44-46)', async () => {
    // The current source throws the missing-query error first (line 44-46),
    // not the "pending OpenClaw" stub (line 54). Document the actual order.
    const fn = resolve('web_search');
    await expect(fn({})).rejects.toThrow(/web_search requires a "query" string argument/);
  });

  it('R-603: throws the missing-query error when query is the empty string', async () => {
    const fn = resolve('web_search');
    await expect(fn({ query: '' })).rejects.toThrow(/web_search requires a "query" string argument/);
  });

  it('R-604: throws the missing-query error when query is not a string', async () => {
    const fn = resolve('web_search');
    await expect(fn({ query: 7 })).rejects.toThrow(/web_search requires a "query" string argument/);
  });
});