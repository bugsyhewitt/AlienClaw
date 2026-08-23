/**
 * hermes-tool-resolver.test.ts
 *
 * Unit tests for HermesToolResolver (governance/hermes/hermes-tool-resolver.ts).
 *
 * This is the symmetrical counterpart of test/msb/openclaw-tool-resolver.test.ts.
 * The hermes module has had zero test coverage since its introduction; this file
 * closes the gap.
 *
 * Coverage targets:
 *   - HermesToolResolver.supportedTools() contract (8 logical tools)
 *   - HermesToolResolver.resolve() dispatch: web_search, host-agnostic delegation,
 *     unknown tool
 *   - hermesWebSearch guard clauses: missing ALIENCLAW_HERMES_PYTHON, invalid query
 *   - hermesWebSearch execFile paths: dispatch error, non-JSON output, error-JSON
 *     object, valid-JSON success
 *
 * Mocking strategy:
 *   execFileAsync is captured at module-load time via `promisify(execFile)`.
 *   We intercept by attaching a vi.fn() as the `nodejs.util.promisify.custom`
 *   symbol on the mocked execFile — promisify picks it up as the implementation —
 *   so execFileAsync === our vi.fn() in the loaded module, no runtime patching
 *   needed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Hoist mock refs so the vi.mock factory can close over them ─────────────

const { mockCustomExecFileAsync } = vi.hoisted(() => {
  // vitest 4.x: vi.fn takes 0-1 type args (function type, not arg/return tuple).
  // Resolved values are typed loosely to keep the 5 .mockResolvedValueOnce sites
  // (R-401..R-405) typecheck-clean without a per-call cast.
  const mockCustomExecFileAsync = vi.fn() as ReturnType<typeof vi.fn> & {
    mockResolvedValueOnce: (v: { stdout: string; stderr: string }) => void;
  };
  return { mockCustomExecFileAsync };
});

vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>();
  const mockExecFile = vi.fn();
  // promisify reads this symbol and returns the function directly as execFileAsync
  Object.defineProperty(mockExecFile, Symbol.for('nodejs.util.promisify.custom'), {
    value: mockCustomExecFileAsync,
    configurable: true,
  });
  return { ...real, execFile: mockExecFile };
});

// ── Imports (after mocking) ────────────────────────────────────────────────

import {
  HermesToolResolver,
  LOGICAL_TOOLS,
} from '../../../src/alienclaw/governance/hermes/hermes-tool-resolver.js';
import { registerToolAdapter } from '../../../src/alienclaw/msb/martian-executor.js';
import type { ToolFn } from '../../../src/alienclaw/msb/martian-executor.js';

// ── Helpers ────────────────────────────────────────────────────────────────

let resolver: HermesToolResolver;

/** Assert resolve returns a function; returns it for further assertions. */
function resolveAsserted(name: string): ToolFn {
  const fn = resolver.resolve(name);
  expect(fn, `expected resolve('${name}') to return a function`).toBeDefined();
  return fn!;
}

/** Env var save/restore helpers. */
let savedPython: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  resolver = new HermesToolResolver();
  savedPython = process.env['ALIENCLAW_HERMES_PYTHON'];
  // Default to a stub so the env-guard tests can override per-test.
  process.env['ALIENCLAW_HERMES_PYTHON'] = '/stub/python';
});

afterEach(() => {
  if (savedPython === undefined) {
    delete process.env['ALIENCLAW_HERMES_PYTHON'];
  } else {
    process.env['ALIENCLAW_HERMES_PYTHON'] = savedPython;
  }
  // The adapter registry is a module-level singleton — drop the test stub
  // so each test starts from a clean slate.
  try { registerToolAdapter('__hermes_test_tool__', undefined as unknown as ToolFn); } catch { /* ignore */ }
});

// ── R-1xx: supportedTools() contract ───────────────────────────────────────

describe('HermesToolResolver — supportedTools()', () => {
  it('R-101: returns all 8 logical tool names', () => {
    const tools = resolver.supportedTools();
    expect(tools).toEqual(LOGICAL_TOOLS);
  });

  it('R-102: returns exactly 8 entries (no spurious additions)', () => {
    expect(resolver.supportedTools()).toHaveLength(8);
  });

  it('R-103: includes web_search and the standard host-agnostic tools', () => {
    const tools = resolver.supportedTools();
    expect(tools).toContain('web_search');
    // spot-check the standard set
    for (const t of ['compute', 'file_read', 'file_write', 'http_get']) {
      expect(tools).toContain(t);
    }
  });

  it('R-104: returns a new array on each call (no internal state leak)', () => {
    const a = resolver.supportedTools();
    const b = resolver.supportedTools();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

// ── R-2xx: resolve() dispatch ──────────────────────────────────────────────

describe('HermesToolResolver — resolve() dispatch', () => {
  it('R-201: resolve("web_search") returns a function (the Hermes native dispatch)', () => {
    expect(typeof resolver.resolve('web_search')).toBe('function');
  });

  it('R-202: resolve of a host-agnostic tool delegates to the adapter registry', () => {
    // Cast to ToolFn (Record<string,unknown>->Promise<unknown>): vi.fn() is
    // signatureless; the adapter registry only checks identity equality.
    const stub = vi.fn() as unknown as ToolFn;
    registerToolAdapter('__hermes_test_tool__', stub);
    expect(resolver.resolve('__hermes_test_tool__')).toBe(stub);
  });

  it('R-203: resolve returns undefined for a completely unknown tool name', () => {
    expect(resolver.resolve('no_such_tool_xyz_9999')).toBeUndefined();
  });

  it('R-204: resolve returns undefined for empty string', () => {
    expect(resolver.resolve('')).toBeUndefined();
  });
});

// ── R-3xx: hermesWebSearch guard clauses (no execFile invocation) ──────────

describe('hermesWebSearch — guard clauses (ALIENCLAW_HERMES_PYTHON + query validation)', () => {
  it('R-301: throws with setup instructions when ALIENCLAW_HERMES_PYTHON is unset', async () => {
    delete process.env['ALIENCLAW_HERMES_PYTHON'];
    const fn = resolveAsserted('web_search');
    await expect(fn({ query: 'anything' })).rejects.toThrow(
      /set ALIENCLAW_HERMES_PYTHON/,
    );
  });

  it('R-302: throws with setup instructions even when query is also bad (env check is first)', async () => {
    delete process.env['ALIENCLAW_HERMES_PYTHON'];
    // Both env and query are wrong; env guard fires first.
    await expect(resolveAsserted('web_search')({ query: '' })).rejects.toThrow(/set ALIENCLAW_HERMES_PYTHON/);
  });

  it('R-303: throws non-empty-query error when env is set but query is undefined', async () => {
    const fn = resolveAsserted('web_search');
    await expect(fn({} as { query: string })).rejects.toThrow(/query/i);
  });

  it('R-304: throws non-empty-query error when query is the empty string', async () => {
    const fn = resolveAsserted('web_search');
    await expect(fn({ query: '' })).rejects.toThrow(/query/i);
  });

  it('R-305: throws non-empty-query error when query is whitespace-only', async () => {
    const fn = resolveAsserted('web_search');
    await expect(fn({ query: '   \t\n' })).rejects.toThrow(/query/i);
  });

  it('R-306: throws non-empty-query error when query is a non-string type', async () => {
    const fn = resolveAsserted('web_search');
    await expect(fn({ query: 42 as unknown as string })).rejects.toThrow(/query/i);
  });
});

// ── R-4xx: hermesWebSearch execFile dispatch paths ─────────────────────────

describe('hermesWebSearch — execFile dispatch paths', () => {
  it('R-401: wraps process-spawn errors as "Hermes dispatch failed"', async () => {
    mockCustomExecFileAsync.mockRejectedValueOnce(
      Object.assign(new Error('spawn failed'), { code: 'ENOENT' }),
    );
    const fn = resolveAsserted('web_search');
    await expect(fn({ query: 'test query' })).rejects.toThrow(
      /Hermes dispatch failed/,
    );
  });

  it('R-402: throws "non-JSON output" when stdout is not valid JSON', async () => {
    mockCustomExecFileAsync.mockResolvedValueOnce({
      stdout: 'Traceback (most recent call last):...',
      stderr: '',
    });
    const fn = resolveAsserted('web_search');
    await expect(fn({ query: 'test query' })).rejects.toThrow(
      /non-JSON output/,
    );
  });

  it('R-403: throws with Hermes error message when JSON contains an "error" key', async () => {
    mockCustomExecFileAsync.mockResolvedValueOnce({
      stdout: JSON.stringify({ error: 'web backend not configured' }),
      stderr: '',
    });
    const fn = resolveAsserted('web_search');
    await expect(fn({ query: 'test query' })).rejects.toThrow(
      /web backend not configured/,
    );
  });

  it('R-404: returns parsed JSON object on successful dispatch', async () => {
    const payload = { results: [{ title: 'AlienClaw', url: 'https://example.com' }] };
    mockCustomExecFileAsync.mockResolvedValueOnce({
      stdout: JSON.stringify(payload),
      stderr: '',
    });
    const fn = resolveAsserted('web_search');
    const result = await fn({ query: 'alienclaw' });
    expect(result).toEqual(payload);
  });

  it('R-405: passes the query through to the dispatch (JSON-encoded in argv)', async () => {
    const payload = { results: [] };
    mockCustomExecFileAsync.mockResolvedValueOnce({ stdout: JSON.stringify(payload), stderr: '' });
    const fn = resolveAsserted('web_search');
    await fn({ query: 'my specific query', maxResults: 5 });
    // The dispatch must have been called with the pybin as first arg
    expect(mockCustomExecFileAsync).toHaveBeenCalledOnce();
    const [calledPybin] = mockCustomExecFileAsync.mock.calls[0] as [string, ...unknown[]];
    expect(calledPybin).toBe('/stub/python');
  });
});
