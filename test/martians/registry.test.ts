/**
 * Direct unit tests for `src/alienclaw/martians/registry.ts`
 * (Packet 067 — MartianRegistry class coverage)
 *
 * Scope: the 1 public class `MartianRegistry` with 4 public methods
 *   - constructor (private) — exercised via the static `load()`
 *   - get(martianType)
 *   - has(martianType)
 *   - all()
 *   - static load(martiansDir, knownToolNames)
 *
 * Why this packet: the MartianRegistry class is called by every TS-side
 * Martian composition path. The class has a private constructor (so
 * production callers can only obtain an instance via the static
 * `load(dir, knownTools)`), and `load` couples to the filesystem via
 * `fs.readdirSync` + `fs.readFileSync`. Verified at this wake (packet
 * 067 §G-1) that NONE of the 44 open PRs touch
 * `src/alienclaw/martians/registry.ts` or `test/martians/registry.test.ts`.
 *
 * Test idiom: use `mkdtempSync(join(tmpdir(), 'p067-mr-'))` in `beforeEach`
 * to create a real temp dir, write fixture .martian files via
 * `writeFileSync`, call `MartianRegistry.load(dir, KNOWN_TOOLS)`, and
 * clean up via `rmSync(tmpDir, { recursive: true, force: true })` in
 * `afterEach`. This matches the pattern in
 * `test/registry/ms-loader.test.ts` (packet 065, REJECTED then REJECTED
 * at review) and the simpler inline-fixture idiom in
 * `test/martians/validator.test.ts` (packet 066, in queue/).
 *
 * Reference impl ship-gate (verified at this wake, packet 067 §G-9):
 *   - vitest baseline (origin/main):  430 passed, 34 skipped
 *   - vitest with this file added:   453 passed, 34 skipped  (+23 cases, +1 file)
 *   - tsc --noEmit:                   exit 0, empty output
 *   - pytest:                         756 passed, 125 skipped (unchanged)
 *   - chain exit 0:                   YES
 *
 * Run smoke (build agent):
 *   ./node_modules/.bin/vitest run test/martians/registry.test.ts --reporter=verbose
 *   → expect 23 passed, 0 failed
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir }                                          from 'node:os';
import { join }                                            from 'node:path';

import { MartianRegistry } from '../../src/alienclaw/martians/registry.js';
import { TOOL_ID_TABLE }   from '../../src/alienclaw/martians/types.js';
import type { MartianSpec } from '../../src/alienclaw/martians/types.js';

// ---------------------------------------------------------------------------
// Fixtures + helpers
// ---------------------------------------------------------------------------

/**
 * The known-tool set passed to `MartianRegistry.load()`. Must include
 * every tool name that appears in any slot of any fixture .martian file
 * (otherwise `validateMartian` rejects the spec with
 * "tool '<X>' not in brain registry" — packet 067 §G-4).
 */
const KNOWN_TOOLS: Set<string> = new Set(Object.keys(TOOL_ID_TABLE));

/** Minimal valid .martian YAML fixture string for the named Martian type. */
function makeMartianYaml(martianType: string, slots: Array<{ toolName: string; slotIndex: number }>): string {
  const slotLines = slots.map(s =>
    `  - slot_index: ${s.slotIndex}\n` +
    `    tool_name: ${s.toolName}\n` +
    `    inputs_from: null`
  ).join('\n');
  return [
    `martian_type: ${martianType}`,
    `description: "Test fixture for ${martianType}."`,
    `use_cases:`,
    `  - "testing the MartianRegistry"`,
    `slots:`,
    slotLines,
  ].join('\n') + '\n';
}

/** A barebones `MartianSpec` object for tests that don't need to go through the static `load()`. */
function makeSpec(
  martianType: string,
  slots: Array<{ slotIndex: number; toolName: string; inputsFrom: null }>,
  description = 'fixture',
  useCases: string[] = ['testing'],
): MartianSpec {
  return {
    martianType,
    slots: slots.map(s => ({
      slotIndex:  s.slotIndex,
      toolName:   s.toolName,
      inputsFrom: s.inputsFrom,
    })),
    description,
    useCases,
  };
}

// ---------------------------------------------------------------------------
// Direct-construction (private constructor) helper
// ---------------------------------------------------------------------------

/**
 * The `MartianRegistry` constructor is `private` — production code can
 * only obtain an instance via the static `load()`. For tests that
 * exercise the pure `get`/`has`/`all`/alias logic in isolation, we use
 * a typed cast to call the private constructor with a hand-built
 * `MartianSpec[]`. This is the same idiom the Python tests use
 * (`MartianRegistry(specs)` in Python is public; here we use a
 * TypeScript cast to mirror the same direct-construction test path).
 */
function build(specs: MartianSpec[]): MartianRegistry {
  // The constructor signature is `private constructor(specs: MartianSpec[])`
  // — intentionally private so production callers can only obtain an
  // instance via the static `load()`. The cast below is type-checked:
  // `new MartianRegistry(specs)` accepts exactly the same shape.
  return new (MartianRegistry as unknown as new (s: MartianSpec[]) => MartianRegistry)(specs);
}

// ---------------------------------------------------------------------------
// Setup / teardown for filesystem-backed tests
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'p067-mr-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. Private-constructor → public-method surface (pure-isolation tests)
// ---------------------------------------------------------------------------

describe('MartianRegistry — get(martianType)', () => {
  it('returns the spec for a known primary Martian type', () => {
    const r = build([
      makeSpec('search_text_basic', [{ slotIndex: 0, toolName: 'search_text', inputsFrom: null }]),
    ]);
    const spec = r.get('search_text_basic');
    expect(spec.martianType).toBe('search_text_basic');
    expect(spec.slots).toHaveLength(1);
    expect(spec.slots[0]?.toolName).toBe('search_text');
  });

  it('throws on an unknown Martian type with the sorted available list in the message', () => {
    const r = build([
      makeSpec('zebra_tool',  [{ slotIndex: 0, toolName: 'search_text', inputsFrom: null }]),
      makeSpec('alpha_tool',  [{ slotIndex: 0, toolName: 'web_search',  inputsFrom: null }]),
      makeSpec('middle_tool', [{ slotIndex: 0, toolName: 'compute',     inputsFrom: null }]),
    ]);
    expect(() => r.get('nonexistent_tool')).toThrow(/Unknown martian_type 'nonexistent_tool'/);
    expect(() => r.get('nonexistent_tool')).toThrow(/alpha_tool/);
    expect(() => r.get('nonexistent_tool')).toThrow(/middle_tool/);
    expect(() => r.get('nonexistent_tool')).toThrow(/zebra_tool/);
    // The three available names MUST appear in alphabetical sort order in the message
    const msg = (() => { try { r.get('nonexistent_tool'); return ''; } catch (e) { return (e as Error).message; } })();
    const ai = msg.indexOf('alpha_tool');
    const mi = msg.indexOf('middle_tool');
    const zi = msg.indexOf('zebra_tool');
    expect(ai).toBeLessThan(mi);
    expect(mi).toBeLessThan(zi);
  });
});

// ---------------------------------------------------------------------------

describe('MartianRegistry — has(martianType)', () => {
  it('returns true for a known primary Martian type', () => {
    const r = build([
      makeSpec('file_read_helper', [{ slotIndex: 0, toolName: 'file_read', inputsFrom: null }]),
    ]);
    expect(r.has('file_read_helper')).toBe(true);
  });

  it('returns false for an unknown Martian type', () => {
    const r = build([
      makeSpec('file_read_helper', [{ slotIndex: 0, toolName: 'file_read', inputsFrom: null }]),
    ]);
    expect(r.has('never_registered')).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('MartianRegistry — all()', () => {
  it('returns the primary Martians in load order (insertion order)', () => {
    const r = build([
      makeSpec('a_first',  [{ slotIndex: 0, toolName: 'search_text', inputsFrom: null }]),
      makeSpec('b_second', [{ slotIndex: 0, toolName: 'web_search',  inputsFrom: null }]),
      makeSpec('c_third',  [{ slotIndex: 0, toolName: 'compute',     inputsFrom: null }]),
    ]);
    const all = r.all();
    expect(all.map(s => s.martianType)).toEqual(['a_first', 'b_second', 'c_third']);
  });

  it('returns a defensive copy — mutating the returned array does not affect subsequent calls', () => {
    const r = build([
      makeSpec('one', [{ slotIndex: 0, toolName: 'search_text', inputsFrom: null }]),
    ]);
    const all1 = r.all();
    all1.pop();
    const all2 = r.all();
    expect(all2).toHaveLength(1);
    expect(all2[0]?.martianType).toBe('one');
  });
});

// ---------------------------------------------------------------------------

describe('MartianRegistry — _alone alias registration', () => {
  it('registers a single-slot <tool>_alone Martian as both the bare <tool> and the _alone name', () => {
    const r = build([
      makeSpec('web_search_alone', [{ slotIndex: 0, toolName: 'web_search', inputsFrom: null }]),
    ]);
    // The alias is registered as a secondary entry in byType
    expect(r.has('web_search_alone')).toBe(true);
    expect(r.has('web_search')).toBe(true);
    // Both point to the SAME spec object
    expect(r.get('web_search_alone')).toBe(r.get('web_search'));
  });

  it('does NOT register a bare alias for multi-slot _alone Martians (only single-slot)', () => {
    const r = build([
      makeSpec('compute_alone', [
        { slotIndex: 0, toolName: 'compute',     inputsFrom: null },
        { slotIndex: 1, toolName: 'search_text', inputsFrom: null },
      ]),
    ]);
    expect(r.has('compute_alone')).toBe(true);
    expect(r.has('compute')).toBe(false);
  });

  it('does NOT register an _alone alias for non-_alone Martians (regression: only _alone suffix triggers the alias rule)', () => {
    const r = build([
      makeSpec('plain_search_text', [{ slotIndex: 0, toolName: 'search_text', inputsFrom: null }]),
    ]);
    expect(r.has('plain_search_text')).toBe(true);
    // "plain_search_text" does NOT end with "_alone" → no alias attempted
    expect(r.has('plain_search')).toBe(false);
    expect(r.has('plain')).toBe(false);
    expect(r.has('text')).toBe(false);
  });

  it('does NOT overwrite an existing primary Martian with an _alone alias', () => {
    // If a primary "web_search" already exists, an "_alone" registration
    // MUST NOT clobber it. Verified at packet 067 §G-3 against
    // `registry.ts:33-39`: the `if (!this.byType.has(bare))` guard
    // prevents overwriting.
    const r = build([
      makeSpec('web_search',       [{ slotIndex: 0, toolName: 'web_search',  inputsFrom: null }]),
      makeSpec('web_search_alone', [{ slotIndex: 0, toolName: 'web_search',  inputsFrom: null }]),
    ]);
    // The primary wins — `r.get('web_search')` returns the first registered (primary)
    const primary = r.get('web_search');
    expect(primary.martianType).toBe('web_search');
    // The _alone one is also registered
    expect(r.has('web_search_alone')).toBe(true);
    // And the two are DIFFERENT objects (the alias did not overwrite the primary)
    expect(r.get('web_search')).not.toBe(r.get('web_search_alone'));
  });
});

// ---------------------------------------------------------------------------
// 2. Static load(martiansDir, knownToolNames) — filesystem-backed tests
// ---------------------------------------------------------------------------
//
// IMPORTANT: MartianRegistry.load filters files via
//   f.endsWith('.martian')   (registry.ts:61)
// so every fixture file MUST end in the literal `.martian` extension.
// Filenames use `<martianType>.martian` (single extension, no double dot).
// ---------------------------------------------------------------------------

describe('MartianRegistry.load(martiansDir, knownToolNames) — happy path', () => {
  it('loads a directory containing one valid .martian file and indexes the spec', () => {
    writeFileSync(
      join(tmpDir, 'test_search.martian'),
      makeMartianYaml('test_search', [{ toolName: 'search_text', slotIndex: 0 }]),
    );
    const r = MartianRegistry.load(tmpDir, KNOWN_TOOLS);
    expect(r.has('test_search')).toBe(true);
    expect(r.get('test_search').slots[0]?.toolName).toBe('search_text');
  });

  it('loads multiple .martian files in lexicographic order, sorts by filename', () => {
    writeFileSync(join(tmpDir, 'z_last.martian'),
      makeMartianYaml('z_last',  [{ toolName: 'search_text', slotIndex: 0 }]));
    writeFileSync(join(tmpDir, 'a_first.martian'),
      makeMartianYaml('a_first', [{ toolName: 'web_search',  slotIndex: 0 }]));
    writeFileSync(join(tmpDir, 'm_middle.martian'),
      makeMartianYaml('m_middle', [{ toolName: 'compute',     slotIndex: 0 }]));
    const r = MartianRegistry.load(tmpDir, KNOWN_TOOLS);
    expect(r.all().map(s => s.martianType)).toEqual(['a_first', 'm_middle', 'z_last']);
  });

  it('ignores non-.martian files in the directory', () => {
    writeFileSync(join(tmpDir, 'real.martian'),
      makeMartianYaml('real', [{ toolName: 'search_text', slotIndex: 0 }]));
    writeFileSync(join(tmpDir, 'README.md'),   '# not a martian');
    writeFileSync(join(tmpDir, 'notes.txt'),   'not a martian');
    writeFileSync(join(tmpDir, 'script.mjs'),  '// not a martian');
    writeFileSync(join(tmpDir, '.DS_Store'),   'macOS metadata');
    const r = MartianRegistry.load(tmpDir, KNOWN_TOOLS);
    expect(r.has('real')).toBe(true);
    expect(r.all()).toHaveLength(1);
  });

  it('registers an _alone alias when a single-slot <tool>_alone .martian file is loaded', () => {
    writeFileSync(join(tmpDir, 'web_search_alone.martian'),
      makeMartianYaml('web_search_alone', [{ toolName: 'web_search', slotIndex: 0 }]));
    const r = MartianRegistry.load(tmpDir, KNOWN_TOOLS);
    expect(r.has('web_search_alone')).toBe(true);
    expect(r.has('web_search')).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('MartianRegistry.load(martiansDir, knownToolNames) — error paths', () => {
  it('throws when the directory does not exist', () => {
    const nonExistent = join(tmpDir, 'no-such-subdir');
    expect(() => MartianRegistry.load(nonExistent, KNOWN_TOOLS))
      .toThrow(`Martians directory not found: ${nonExistent}`);
  });

  it('throws when the path is a regular file, not a directory', () => {
    const filePath = join(tmpDir, 'not-a-dir.martian');
    writeFileSync(filePath, 'i am a file');
    expect(() => MartianRegistry.load(filePath, KNOWN_TOOLS))
      .toThrow(/Martians directory not found/);
  });

  it('throws on a duplicate martian_type across two .martian files', () => {
    writeFileSync(join(tmpDir, 'a.martian'),
      makeMartianYaml('dup', [{ toolName: 'search_text', slotIndex: 0 }]));
    writeFileSync(join(tmpDir, 'b.martian'),
      makeMartianYaml('dup', [{ toolName: 'web_search',  slotIndex: 0 }]));
    expect(() => MartianRegistry.load(tmpDir, KNOWN_TOOLS))
      .toThrow(/Duplicate martian_type 'dup'/);
  });

  it('throws when a slot references a tool that is NOT in knownToolNames', () => {
    // Use a tool name not in TOOL_ID_TABLE — also unknown to KNOWN_TOOLS
    writeFileSync(join(tmpDir, 'bad.martian'),
      makeMartianYaml('bad', [{ toolName: 'nonexistent_tool_xyz', slotIndex: 0 }]));
    expect(() => MartianRegistry.load(tmpDir, KNOWN_TOOLS))
      .toThrow(/Invalid \.martian file/);
  });

  it('throws on a YAML parse error (malformed file)', () => {
    writeFileSync(join(tmpDir, 'broken.martian'),
      'martian_type: x\nslots: [\n  - this is not valid yaml: ,\n');
    expect(() => MartianRegistry.load(tmpDir, KNOWN_TOOLS))
      .toThrow();
  });
});

// ---------------------------------------------------------------------------

describe('MartianRegistry.load(martiansDir, knownToolNames) — empty directory', () => {
  it('returns an empty registry (no specs) for a directory with no .martian files', () => {
    mkdirSync(join(tmpDir, 'empty-sub'), { recursive: true });
    // `load` on `tmpDir` (top-level) has no .martian files
    const r = MartianRegistry.load(tmpDir, KNOWN_TOOLS);
    expect(r.all()).toEqual([]);
    expect(r.has('anything')).toBe(false);
  });
});
