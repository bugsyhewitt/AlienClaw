/**
 * PKT-1416 File-A — `OpenClawToolResolver.resolve()` must not resolve
 * INHERITED `Object.prototype` members as callable tool functions.
 *
 * BACKGROUND (defect, reproduced live on origin/main @ a04c6dc7):
 *
 *   src/alienclaw/msb/openclaw-tool-resolver.ts shipped
 *
 *       const TOOL_MAP: Record<string, ToolFn> = {
 *         web_search: webSearch,
 *         file_read:  fileRead,
 *         file_write: fileWrite,
 *       };
 *
 *       export class OpenClawToolResolver implements ToolResolver {
 *         resolve(toolName: string): ToolFn | undefined {
 *           return TOOL_MAP[toolName];        // <-- bare bracket read
 *         }
 *
 *   A plain object literal inherits from `Object.prototype`, so `TOOL_MAP[x]`
 *   for an UNDECLARED `x` resolves the inherited member. Measured live: 12 of
 *   the 12 standard prototype member names resolved to a non-undefined value.
 *
 * WHY THAT MATTERS (the decisive consequence):
 *
 *   The adapter-invocation guard is a TRUTHINESS check
 *   (`martian-executor.ts:105` — `if (!adapter) { … }`). A leaked member is
 *   truthy, so it PASSES the guard. Live measurement of the guard semantics
 *   against the resolver's own output:
 *
 *     unknown tool  "not_a_tool"    -> { success: false, error: 'No tool adapter registered for "not_a_tool".' }
 *     leaked        "toString"      -> { success: true,  output: "[object Undefined]" }
 *
 *   So an undeclared tool name is recorded as a SUCCESS carrying a garbage
 *   payload, instead of the designed "no adapter registered" failure. The
 *   sibling resolver (`HermesToolResolver`) and the shared registry
 *   (`getToolAdapter`, Map-based) both correctly return `undefined`.
 *
 * This file is the GATE, not a description. Every test imports the REAL
 * resolver class from `src/` and asserts on its REAL output. There is no
 * local re-implementation of the lookup anywhere in this file, so reverting
 * the source fix turns these tests RED.
 *
 * No file under `src/` is modified by this test file.
 */

import { describe, it, expect } from 'vitest';

import {
  OpenClawToolResolver,
} from '../../src/alienclaw/msb/openclaw-tool-resolver.js';
import {
  HermesToolResolver,
} from '../../src/alienclaw/governance/hermes/hermes-tool-resolver.js';
import type { ToolFn } from '../../src/alienclaw/msb/martian-executor.js';

// The 12 inherited `Object.prototype` member names. Membership is asserted
// against the runtime prototype itself rather than hand-listed, so the list
// cannot drift from reality.
const PROTOTYPE_MEMBER_NAMES: readonly string[] = Object.getOwnPropertyNames(
  Object.prototype,
).filter((n) => n !== 'constructor' || true);

// ---------------------------------------------------------------------------
// The guard semantics from martian-executor.ts:104-112, reproduced faithfully.
// A resolver-supplied adapter passes the `if (!adapter)` guard iff it is
// truthy. This helper applies the guard to the REAL resolver output.
// ---------------------------------------------------------------------------

async function invokeViaResolver(
  toolName: string,
  input: Record<string, unknown>,
): Promise<{ success: boolean; output: unknown; error?: string }> {
  const resolver = new OpenClawToolResolver();
  const adapter = resolver.resolve(toolName);
  if (!adapter) {
    return {
      success: false,
      output:  null,
      error:   `No tool adapter registered for "${toolName}".`,
    };
  }
  try {
    const output = await adapter(input);
    return { success: true, output };
  } catch (err) {
    return { success: false, output: null, error: (err as Error).message };
  }
}

// ---------------------------------------------------------------------------
// A-1xx — the leak itself
// ---------------------------------------------------------------------------

describe('PKT-1416 — OpenClawToolResolver.resolve() is prototype-safe', () => {
  it('A-101: resolve() returns undefined for EVERY inherited Object.prototype member name', () => {
    const resolver = new OpenClawToolResolver();
    const leaked: string[] = [];
    for (const name of PROTOTYPE_MEMBER_NAMES) {
      const value = resolver.resolve(name);
      if (value !== undefined) leaked.push(name);
    }
    expect(leaked).toEqual([]);
  });

  it('A-102: resolve("constructor") is undefined — not the Object constructor', () => {
    const resolver = new OpenClawToolResolver();
    expect(resolver.resolve('constructor')).toBeUndefined();
  });

  it('A-103: resolve("toString") is undefined — not the inherited method', () => {
    const resolver = new OpenClawToolResolver();
    expect(resolver.resolve('toString')).toBeUndefined();
  });

  it('A-104: resolve("hasOwnProperty") is undefined', () => {
    const resolver = new OpenClawToolResolver();
    expect(resolver.resolve('hasOwnProperty')).toBeUndefined();
  });

  it('A-105: resolve("valueOf") is undefined', () => {
    const resolver = new OpenClawToolResolver();
    expect(resolver.resolve('valueOf')).toBeUndefined();
  });

  it('A-106: resolve("__proto__") is undefined — not the prototype object', () => {
    const resolver = new OpenClawToolResolver();
    expect(resolver.resolve('__proto__')).toBeUndefined();
  });

  it('A-107: resolve("__defineGetter__") is undefined', () => {
    const resolver = new OpenClawToolResolver();
    expect(resolver.resolve('__defineGetter__')).toBeUndefined();
  });

  it('A-108: the 12 standard prototype member names are all rejected', () => {
    const resolver = new OpenClawToolResolver();
    const canonical = [
      '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__',
      '__proto__', 'constructor', 'hasOwnProperty', 'isPrototypeOf',
      'propertyIsEnumerable', 'toLocaleString', 'toString', 'valueOf',
    ];
    for (const name of canonical) {
      expect(resolver.resolve(name), `resolve("${name}") must be undefined`).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// A-2xx — the consequence: an unknown tool must FAIL, not fake a SUCCESS
// ---------------------------------------------------------------------------

describe('PKT-1416 — an undeclared tool name fails the adapter guard instead of faking success', () => {
  it('A-201: an unknown tool name is rejected by the guard (success=false)', async () => {
    const res = await invokeViaResolver('not_a_tool', { task: 'x' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('No tool adapter registered');
  });

  it('A-202: "toString" no longer fakes a SUCCESS with a garbage payload', async () => {
    const res = await invokeViaResolver('toString', { task: 'x' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('No tool adapter registered');
    expect(res.output).toBeNull();
  });

  it('A-203: "valueOf" no longer fakes a SUCCESS', async () => {
    const res = await invokeViaResolver('valueOf', { task: 'x' });
    expect(res.success).toBe(false);
  });

  it('A-204: "constructor" no longer fakes a SUCCESS', async () => {
    const res = await invokeViaResolver('constructor', { task: 'x' });
    expect(res.success).toBe(false);
  });

  it('A-205: "hasOwnProperty" no longer fakes a SUCCESS', async () => {
    const res = await invokeViaResolver('hasOwnProperty', { task: 'x' });
    expect(res.success).toBe(false);
  });

  it('A-206: no prototype member name ever yields success=true', async () => {
    for (const name of PROTOTYPE_MEMBER_NAMES) {
      const res = await invokeViaResolver(name, { task: 'x' });
      expect(res.success, `resolve("${name}") must not produce a success`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// A-3xx — anti-over-block controls: the REAL tools must still resolve
// ---------------------------------------------------------------------------

describe('PKT-1416 — the fix does not over-block the three declared tools', () => {
  it('A-301: resolve("web_search") still returns a function', () => {
    const resolver = new OpenClawToolResolver();
    expect(typeof resolver.resolve('web_search')).toBe('function');
  });

  it('A-302: resolve("file_read") still returns a function', () => {
    const resolver = new OpenClawToolResolver();
    expect(typeof resolver.resolve('file_read')).toBe('function');
  });

  it('A-303: resolve("file_write") still returns a function', () => {
    const resolver = new OpenClawToolResolver();
    expect(typeof resolver.resolve('file_write')).toBe('function');
  });

  it('A-304: supportedTools() still lists exactly the three declared tools', () => {
    const resolver = new OpenClawToolResolver();
    expect(resolver.supportedTools().sort()).toEqual(
      ['file_read', 'file_write', 'web_search'],
    );
  });

  it('A-305: supportedTools() returns a NEW array each call (no internal leak)', () => {
    const resolver = new OpenClawToolResolver();
    const a = resolver.supportedTools();
    const b = resolver.supportedTools();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it('A-306: resolve() returns the SAME fn identity across calls (module-level map, unchanged)', () => {
    const resolver = new OpenClawToolResolver();
    const first = resolver.resolve('file_read') as ToolFn;
    const second = resolver.resolve('file_read') as ToolFn;
    expect(first).toBe(second);
  });

  it('A-307: resolve("") is still undefined', () => {
    const resolver = new OpenClawToolResolver();
    expect(resolver.resolve('')).toBeUndefined();
  });

  it('A-308: two resolver instances resolve the same fn identity (module-level TOOL_MAP)', () => {
    const a = new OpenClawToolResolver();
    const b = new OpenClawToolResolver();
    expect(a.resolve('file_read')).toBe(b.resolve('file_read'));
  });
});

// ---------------------------------------------------------------------------
// A-4xx — cross-host parity with the sibling resolver
// ---------------------------------------------------------------------------

describe('PKT-1416 — OpenClaw and Hermes resolvers agree on unknown names', () => {
  it('A-401: both hosts reject every inherited prototype member name', () => {
    const oc = new OpenClawToolResolver();
    const hm = new HermesToolResolver();
    for (const name of PROTOTYPE_MEMBER_NAMES) {
      expect(oc.resolve(name), `OpenClaw resolve("${name}")`).toBeUndefined();
      expect(hm.resolve(name), `Hermes resolve("${name}")`).toBeUndefined();
    }
  });

  it('A-402: both hosts reject an arbitrary undeclared tool name', () => {
    const oc = new OpenClawToolResolver();
    const hm = new HermesToolResolver();
    expect(oc.resolve('definitely_not_a_tool')).toBeUndefined();
    expect(hm.resolve('definitely_not_a_tool')).toBeUndefined();
  });
});
