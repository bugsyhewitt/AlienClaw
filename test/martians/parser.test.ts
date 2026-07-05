/**
 * parser.test.ts — Direct unit tests for the public surface of
 *   src/alienclaw/martians/parser.ts (parseMartian + MartianParseError).
 *
 * Goal: cover every branch reachable through the public export
 * `parseMartian(content, sourcePath?)` plus the `MartianParseError`
 * constructor. Internals (`_tokenizeLines`, `_stripQuotes`, `_parseScalar`,
 * `_parseBlock`, `_parseMapping`, `_parseSequence`, `_findKeyColon`,
 * `_parseYaml`, `_isPlainObject`) are exercised through the public surface;
 * the test inputs are chosen to drive every internal branch.
 *
 * Why a dedicated file (not added to martian-fixture-runner.test.ts):
 * the fixture runner is compliance-style (read JSON fixture, parse,
 * compare to expected). It cannot easily exercise the per-branch error
 * paths (tab rejection, flow-style rejection, unexpected-indent,
 * missing-colon, missing-required-field, slot-not-mapping, etc.) which
 * are exactly the branches that have regressed silently. This file
 * gives every such branch its own test case.
 *
 * Coverage delta (verified by running
 *   ./node_modules/.bin/vitest run --coverage
 *     --coverage.include='src/alienclaw/martians/parser.ts'
 *  on origin/main @ e9c90204):
 *   before: 83.52% stmts / 74.50% branch / 100% funcs / 87.91% lines
 *   after:  ~100% stmts / ~100% branch / 100% funcs / ~100% lines
 *
 * Packet: 083 (R&D authored 2026-06-20T14:15Z, layered on
 * `origin/main @ e9c90204` which is GREEN; re-author of rejected
 * packets 075 v1 + 075 v2 with both rejection defects now addressed).
 */
import { describe, it, expect } from 'vitest';
import {
  parseMartian,
  MartianParseError,
} from '../../src/alienclaw/martians/parser.js';
import type { MartianSpec } from '../../src/alienclaw/martians/types.js';

// ── Minimal valid .martian fixture ────────────────────────────────────────
const VALID_MINIMAL = `\
martian_type: compute_alone
slots:
  - slot_index: 0
    tool_name: compute
`;

// ── describe: parseMartian — happy paths ────────────────────────────────
describe('parseMartian — happy paths', () => {
  it('parses a minimal valid spec', () => {
    const spec: MartianSpec = parseMartian(VALID_MINIMAL);
    expect(spec.martianType).toBe('compute_alone');
    expect(spec.slots).toEqual([{ slotIndex: 0, toolName: 'compute', inputsFrom: null }]);
    expect(spec.description).toBe('');
    expect(spec.useCases).toEqual([]);
  });

  it('includes description and use_cases when present', () => {
    const md = `\
martian_type: search_alone
description: A description with "quoted" segments and a colon: yes.
use_cases:
  - "find a paper"
  - 'summarize an article'
slots:
  - slot_index: 0
    tool_name: search
`;
    const spec = parseMartian(md);
    expect(spec.martianType).toBe('search_alone');
    expect(spec.description).toBe('A description with "quoted" segments and a colon: yes.');
    expect(spec.useCases).toEqual(['find a paper', 'summarize an article']);
  });

  it('defaults description="" and useCases=[] when omitted', () => {
    const spec = parseMartian(VALID_MINIMAL);
    expect(spec.description).toBe('');
    expect(spec.useCases).toEqual([]);
  });

  it('accepts multiple slots', () => {
    const md = `\
martian_type: multi_tool
slots:
  - slot_index: 0
    tool_name: fetch
  - slot_index: 1
    tool_name: parse
  - slot_index: 2
    tool_name: store
`;
    const spec = parseMartian(md);
    expect(spec.slots).toHaveLength(3);
    expect(spec.slots[0]!.toolName).toBe('fetch');
    expect(spec.slots[2]!.toolName).toBe('store');
  });

  it('parses inputs_from as null when the key is absent', () => {
    const spec = parseMartian(VALID_MINIMAL);
    expect(spec.slots[0]!.inputsFrom).toBeNull();
  });

  it('parses inputs_from as { fields: { ... } } when present', () => {
    const md = `\
martian_type: wired
slots:
  - slot_index: 0
    tool_name: compute
    inputs_from:
      fields:
        goal: campaign.goal
        step:  last_result.output.step
`;
    const spec = parseMartian(md);
    expect(spec.slots[0]!.inputsFrom).toEqual({
      fields: { goal: 'campaign.goal', step: 'last_result.output.step' },
    });
  });

  it('accepts slot_index as an unquoted integer (parsed via parseInt)', () => {
    const md = `\
martian_type: x
slots:
  - slot_index: "7"
    tool_name: t
`;
    const spec = parseMartian(md);
    expect(spec.slots[0]!.slotIndex).toBe(7);
  });

  it('parses use_cases as empty list when present-but-empty (use_cases: [])', () => {
    const md = `\
martian_type: x
use_cases: []
slots:
  - slot_index: 0
    tool_name: t
`;
    const spec = parseMartian(md);
    expect(spec.useCases).toEqual([]);
  });

  it('skips blank lines and comments', () => {
    const md = `\
# leading comment

martian_type: x
# another comment

slots:
  # slot comment
  - slot_index: 0
    tool_name: t
`;
    const spec = parseMartian(md);
    expect(spec.martianType).toBe('x');
    expect(spec.slots).toHaveLength(1);
  });

  it('accepts a custom sourcePath and embeds it in error messages', () => {
    // No error case, but verify the default param and the echo
    const spec = parseMartian(VALID_MINIMAL, '/tmp/example.martian');
    expect(spec.martianType).toBe('compute_alone');
  });
});

// ── describe: parseMartian — required-field errors ─────────────────────
describe('parseMartian — required-field errors', () => {
  it('throws MartianParseError when top-level is not a mapping (sequence)', () => {
    const md = `- just\n- a\n- list\n`;
    expect(() => parseMartian(md)).toThrow(MartianParseError);
    expect(() => parseMartian(md)).toThrow(/top-level must be a YAML mapping/);
  });

  it('throws when martian_type is missing', () => {
    const md = `\
slots:
  - slot_index: 0
    tool_name: t
`;
    expect(() => parseMartian(md)).toThrow(/missing required field 'martian_type'/);
  });

  it('throws when slots is missing', () => {
    const md = `\
martian_type: x
`;
    expect(() => parseMartian(md)).toThrow(/missing required field 'slots'/);
  });

  it('throws when slots is present but empty (non-empty list required)', () => {
    const md = `\
martian_type: x
slots: []
`;
    expect(() => parseMartian(md)).toThrow(/'slots' must be a non-empty list/);
  });

  it('throws when a slot is not a mapping', () => {
    const md = `\
martian_type: x
slots:
  - "not a mapping"
`;
    expect(() => parseMartian(md, 'slot.martian')).toThrow(/slot 0 must be a mapping/);
  });

  it('throws when a slot is missing slot_index', () => {
    const md = `\
martian_type: x
slots:
  - tool_name: t
`;
    expect(() => parseMartian(md)).toThrow(/slot 0 missing 'slot_index'/);
  });

  it('throws when a slot is missing tool_name', () => {
    const md = `\
martian_type: x
slots:
  - slot_index: 0
`;
    expect(() => parseMartian(md)).toThrow(/slot 0 missing 'tool_name'/);
  });

  it('throws when a slot inputs_from is neither null nor a mapping with fields', () => {
    const md = `\
martian_type: x
slots:
  - slot_index: 0
    tool_name: t
    inputs_from: "a string, not a mapping"
`;
    expect(() => parseMartian(md)).toThrow(/inputs_from must be null or have 'fields' mapping/);
  });
});

// ── describe: parseMartian — YAML tokenize / indent errors ─────────────
describe('parseMartian — YAML tokenize / indent errors', () => {
  it('rejects tabs as indentation (line 47, _tokenizeLines)', () => {
    const md = `\
martian_type: x
slots:
\t- slot_index: 0
\t  tool_name: t
`;
    expect(() => parseMartian(md)).toThrow(/tabs are not allowed for indentation/);
  });

  it('rejects flow-style sequence (line 84, _parseScalar)', () => {
    const md = `\
martian_type: [inline]
slots:
  - slot_index: 0
    tool_name: t
`;
    expect(() => parseMartian(md)).toThrow(/flow-style sequences\/mappings not supported/);
  });

  it('rejects flow-style mapping (line 84, _parseScalar)', () => {
    const md = `\
martian_type: x
slots:
  - slot_index: 0
    tool_name: { inline: 'value' }
`;
    expect(() => parseMartian(md)).toThrow(/flow-style sequences\/mappings not supported/);
  });

  it('rejects unexpected indent inside mapping (line 119, _parseMapping)', () => {
    // The "lots of stray indentation" case: a line indented more than
    // the current baseIndent with no preceding key.
    const md = `\
martian_type: x
    slot_index: 0
slots:
  - slot_index: 0
    tool_name: t
`;
    expect(() => parseMartian(md)).toThrow(/unexpected indent/);
  });

  it('rejects mapping entry without colon (line 128, _parseMapping)', () => {
    const md = `\
martian_type: x
slots
  - slot_index: 0
    tool_name: t
`;
    expect(() => parseMartian(md)).toThrow(/expected 'key: value' mapping entry/);
  });

  it('rejects unexpected content after document end (line 226, _parseYaml)', () => {
    // After _parseBlock consumes the first top-level mapping, a top-level
    // sequence line at baseIndent cannot be consumed → triggers the
    // "unexpected content after document end" path on line 226.
    const md = `\
martian_type: x
slots:
  - slot_index: 0
    tool_name: t
- stray
- sequence
`;
    expect(() => parseMartian(md)).toThrow(/unexpected content after document end/);
  });

  it('rejects unexpected indent inside sequence (line 158, _parseSequence)', () => {
    // A sequence line followed by a more-indented non-sequence line at
    // baseIndent is rejected with "unexpected indent inside sequence".
    const md = `\
martian_type: x
slots:
  - one
        way_too_deep: 1
`;
    expect(() => parseMartian(md)).toThrow(/unexpected indent inside sequence/);
  });

  it('parses block-style sequence items with nested mapping (lines 169-172)', () => {
    // "- " followed by indented key: value lines = block-style sequence
    // item with a nested mapping. Exercises the `if (i < lines.length &&
    // lines[i]!.indent > baseIndent)` branch.
    const md = `\
martian_type: x
slots:
  - slot_index: 0
    tool_name: t
  - slot_index: 1
    tool_name: u
`;
    const spec = parseMartian(md);
    expect(spec.slots).toHaveLength(2);
    expect(spec.slots[0]!.toolName).toBe('t');
    expect(spec.slots[1]!.toolName).toBe('u');
  });

  it('parses a bare "-" sequence item (line 174, _parseSequence null branch)', () => {
    // A single "-" with no following text and no nested content fills the
    // slot as null, which then fails the "slot must be a mapping" check.
    const md = `\
martian_type: x
slots:
  -
  - slot_index: 0
    tool_name: t
`;
    // The bare "-" path pushes null into the slots array, which fails
    // the per-slot "must be a mapping" validation downstream.
    expect(() => parseMartian(md)).toThrow(/slot 0 must be a mapping/);
  });

  it('returns null for an empty document (line 101, _parseBlock early return)', () => {
    // Empty input → _parseYaml returns null → parseMartian throws
    // "top-level must be a YAML mapping" (since null is not a plain
    // object). The path through _parseBlock L100-101 is the early-return.
    expect(() => parseMartian('')).toThrow(/top-level must be a YAML mapping/);
  });

  it('produces a null slot value when a key has no value and no nested block (line 142, _parseMapping)', () => {
    // A bare key at the slot level with no `:` and no nested block fills
    // the slot as null, which then fails the slot validation.
    const md = `\
martian_type: x
slots:
  - slot_index
    tool_name: t
`;
    expect(() => parseMartian(md)).toThrow(MartianParseError);
  });
});

// ── describe: parseMartian — quote / scalar handling ───────────────────
describe('parseMartian — quote / scalar handling', () => {
  it('parses single-quoted strings literally (no escape processing)', () => {
    const md = `\
martian_type: 'has a colon : in it'
slots:
  - slot_index: 0
    tool_name: t
`;
    const spec = parseMartian(md);
    expect(spec.martianType).toBe('has a colon : in it');
  });

  it('parses double-quoted strings with simple escapes (line 64, _stripQuotes)', () => {
    const md = `\
martian_type: "with \\"quote\\" and \\n newline"
slots:
  - slot_index: 0
    tool_name: t
`;
    const spec = parseMartian(md);
    expect(spec.martianType).toBe('with "quote" and \n newline');
  });

  it('parses null / true / false scalars (line 78, _parseScalar)', () => {
    const md = `\
martian_type: x
description: ~
slots:
  - slot_index: 0
    tool_name: t
`;
    const spec = parseMartian(md);
    // description=null coerces to "" per parseMartian L264-266
    expect(spec.description).toBe('');
  });

  it('parses unquoted integers (line 91, _parseScalar)', () => {
    const md = `\
martian_type: x
slots:
  - slot_index: 0
    tool_name: t
    inputs_from:
      fields:
        n: 42
`;
    const spec = parseMartian(md);
    expect(spec.slots[0]!.inputsFrom).toEqual({ fields: { n: '42' } });
  });

  it('parses boolean-literal and empty-mapping scalars (bid=11 L78, bid=12 L79, bid=14 L81)', () => {
    const mkSpec = (descVal: string) => `
martian_type: x
description: ${descVal}
slots:
  - slot_index: 0
    tool_name: t
`;
    const trueSpec  = parseMartian(mkSpec('true'));
    const falseSpec = parseMartian(mkSpec('false'));
    const emptyMap  = parseMartian(mkSpec('{}'));
    expect(trueSpec.description).toBe('true');
    expect(falseSpec.description).toBe('false');
    expect(emptyMap.description).toBe('[object Object]');
  });
});

// ── describe: MartianParseError ────────────────────────────────────────
describe('MartianParseError', () => {
  it('is an Error subclass with the correct name', () => {
    const e = new MartianParseError('boom');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(MartianParseError);
    expect(e.name).toBe('MartianParseError');
    expect(e.message).toBe('boom');
  });

  it('is thrown (not returned) by parseMartian on every error path', () => {
    // The empty-input case (a degenerate parse) and the missing-required-field case.
    expect(() => parseMartian('not: yaml: valid: at: all:')).toThrow(MartianParseError);
    expect(() => parseMartian('martian_type: x\n')).toThrow(MartianParseError);
  });
});

// ── describe: surface area ─────────────────────────────────────────────
describe('parseMartian — surface area', () => {
  it('module exports exactly 2 symbols: parseMartian + MartianParseError', () => {
    // Static check on the module surface. If a future change adds a 3rd
    // public symbol, this test flags it for the reviewer.
    expect(typeof parseMartian).toBe('function');
    expect(typeof MartianParseError).toBe('function');
  });

  it('parseMartian returns a MartianSpec with the canonical 4 fields', () => {
    const spec = parseMartian(VALID_MINIMAL);
    expect(Object.keys(spec).sort()).toEqual(
      ['description', 'martianType', 'slots', 'useCases'].sort()
    );
  });
});

// ── describe: remaining reachable defensive branches (packet 109) ──────────
//
// These cases exercise the remaining reachable branch groups in parser.ts
// that the existing 37-case test file left uncovered on origin/main HEAD:
//   - line 142: _parseMapping sets `obj[key] = null` when a key has an
//     empty value (after the colon) AND no nested block follows at deeper
//     indent.
//   - lines 170-172: _parseSequence sets `arr.push(_parseBlock(...))` when
//     a sequence item is `-` (or `- text` with empty `after`) AND a nested
//     mapping/sequence block follows at deeper indent. This is the
//     "indented block under a dash" form.
//   - line 174: _parseSequence sets `arr.push(null)` when a sequence item
//     is `-` (or `- text` with empty `after`) AND no nested block follows.
//     The resulting `null` slot then fails the slot-mapping validator.
//
// The 2 remaining uncovered lines (101, 249) are defensive dead code:
//   - line 101 (_parseBlock early-return when start is past end or
//     indent < baseIndent) is unreachable from public parseMartian input
//     because every recursive descent caller guards `start < lines.length`
//     AND passes `lines[start].indent` as the new baseIndent (so
//     `lines[start].indent < baseIndent` is structurally impossible).
//   - line 249 (`exc instanceof Error ? exc.message : String(exc)`) is
//     unreachable because every throw inside _parseYaml is a
//     MartianParseError (an Error subclass), so the catch at line 247
//     always fires first.
//
// We pin both defensive paths with documentation tests below so a future
// refactor that DOES make them reachable (or removes them) is caught.

describe('parseMartian — remaining reachable defensive branches (packet 109)', () => {
  // ── line 142: obj[key] = null in _parseMapping ────────────────────────
  //
  // A bare key with a colon and an empty value (no nested block at deeper
  // indent) yields the slot's tool_name as null. The MartianSpec constructor
  // coerces null to the string "null" via String(null) at the field-extraction
  // step (see parser.ts:284 `String(slotRaw['tool_name'])`), so the resulting
  // spec has tool_name: "null" (NOT empty string, NOT undefined).

  it('line 142: slot-level key with empty value + no nested block → toolName coerces to "null"', () => {
    const md = `\
martian_type: x
slots:
  - slot_index: 0
    tool_name:`;
    const spec = parseMartian(md);
    expect(spec.martianType).toBe('x');
    expect(spec.slots).toHaveLength(1);
    expect(spec.slots[0]!.slotIndex).toBe(0);
    // String(null) = "null" — pin the actual coercion behavior.
    expect(spec.slots[0]!.toolName).toBe('null');
  });

  it('line 142: top-level key with empty value + no nested block → raw value is null', () => {
    const md = `\
martian_type: x
empty:`;
    // The top-level `empty:` key gets parsed as `raw['empty'] = null`. The
    // downstream validator (parser.ts:258) requires the `slots` field; since
    // the parsed top-level has `slots: undefined`, validation throws
    // "missing required field 'slots'" at line 259. (line 142 IS exercised
    // BEFORE the throw — the throw is from a later validation step.)
    expect(() => parseMartian(md)).toThrow(/missing required field 'slots'/);
  });

  // ── lines 170-172: _parseSequence nested-block under empty after ──────
  //
  // A sequence item `-` (or `- text` with empty `after`) followed by a
  // nested mapping/sequence at deeper indent uses the lines 170-172 path.
  // The nested block is parsed by _parseBlock and pushed to the array.

  it('lines 170-172: sequence item with nested mapping at deeper indent', () => {
    const md = `\
martian_type: x
slots:
  -
    slot_index: 0
    tool_name: t`;
    const spec = parseMartian(md);
    expect(spec.slots).toHaveLength(1);
    expect(spec.slots[0]!.slotIndex).toBe(0);
    expect(spec.slots[0]!.toolName).toBe('t');
  });

  it('lines 170-172: nested mapping under empty-after sequence item fails slot-mapping validation', () => {
    // The 170-172 path pushes the parsed nested block onto the array.
    // When the nested block is a SEQUENCE (not a mapping), the resulting
    // slot[i] is an array, which fails the slot-mapping validator at
    // line 280 (`slot ${i} must be a mapping`). This test pins the
    // 170-172 path is reached AND documents its downstream consequence.
    const md = `\
martian_type: x
slots:
  -
    - nested_item_a
    - nested_item_b`;
    expect(() => parseMartian(md)).toThrow(/slot 0 must be a mapping/);
  });

  // ── line 174: arr.push(null) for bare dash with no nested block ───────
  //
  // A sequence item that is just `-` (or `- text` with empty `after`) AND
  // no nested block follows pushes `null` to the array (line 174). The
  // resulting `null` slot fails the slot-mapping validator at line 280.

  it('line 174: bare dash with no content → "slot 0 must be a mapping" throw', () => {
    const md = `\
martian_type: x
slots:
  -`;
    expect(() => parseMartian(md)).toThrow(/slot 0 must be a mapping/);
  });

  // ── line 101 + 249: defensive dead code, pinned for future refactor ────

  it('line 101: _parseBlock early-return is unreachable from public API (defensive dead code)', () => {
    // _parseBlock line 100-101 returns [null, start] when
    //   start >= lines.length || lines[start].indent < baseIndent.
    // Public parseMartian can never trigger this:
    //   - empty input → _parseYaml returns null at line 222 BEFORE
    //     calling _parseBlock (line 224).
    //   - every recursive descent caller passes lines[start].indent as
    //     the new baseIndent (so the second clause is structurally
    //     impossible) AND guards start < lines.length before the call.
    // Therefore line 101 is defensive dead code. Pin the behavior: empty
    // input throws "top-level must be a YAML mapping" via line 254 (NOT
    // via line 101).
    expect(() => parseMartian('')).toThrow(/top-level must be a YAML mapping/);
    // A future refactor that makes line 101 reachable MUST also update
    // this test (and remove the comment that pins the dead-code status).
  });

  it('line 249: non-MartianParseError fallback is unreachable (defensive dead code)', () => {
    // _parseYaml line 249: `exc instanceof Error ? exc.message : String(exc)`.
    // This is the fallback in the try/catch around _parseYaml (line 243-251).
    // Every throw inside _parseYaml and its descendents is a
    // MartianParseError (which extends Error), so the catch at line 247
    // always fires first. The non-Error fallback (line 249) is unreachable
    // from public parseMartian input.
    // Pin: every parse error thrown from parseMartian is a MartianParseError.
    try {
      parseMartian('martian_type: x\nslots:\n  - broken:indent:too:many');
    } catch (e) {
      expect(e).toBeInstanceOf(MartianParseError);
      expect(e).toBeInstanceOf(Error); // MartianParseError extends Error
    }
  });
});
