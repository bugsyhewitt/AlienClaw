/**
 * parser.test.ts — Direct unit tests for src/alienclaw/martians/parser.ts.
 *
 * Mirrors test/martians/test_parser.py (the Python side) at the TS level.
 * `parseMartian()` is a pure function: no fs, no env, no LLM, no async.
 * The Python parser delegates to `yaml.safe_load`; the TS parser is a minimal
 * indentation-based implementation (the `.martian` format is a strict YAML
 * subset — see parser.ts top comment). The TS implementation therefore has
 * MORE branch surface than the Python mirror (tab rejection, quote-aware
 * `_findKeyColon`, escape handling, block-vs-inline sequence branching);
 * this test file covers both the Python-parity cases AND the TS-specific
 * branches the Python suite doesn't exercise.
 *
 * Coverage targets (per source inspection of parser.ts:1-316):
 *   - Tabs rejected (line 47)
 *   - Empty input rejected (line 85)
 *   - Trailing junk / blank-line-as-indent rejected (lines 119, 128)
 *   - Malformed YAML rejected (line 158)
 *   - Quote-aware key-colon finder (lines 204-218)
 *   - Top-level non-mapping rejected (line 254)
 *   - Missing required field (line 259)
 *   - 'slots' empty list rejected (line 274)
 *   - Slot not a mapping rejected (line 281)
 *   - Slot missing slot_index / tool_name rejected (line 285)
 *   - Slot inputs_from malformed rejected (line 307)
 *   - Happy path: single slot, two slots, description/use_cases defaults,
 *     string-coerced slot_index, string-coerced use_cases entries
 *
 * Reference impl verified end-to-end against branch
 * `test/packet-073-restore-ship-gate-green @ 49079dd9` at wake
 * 2026-06-20T08:45:00Z (PR #65's branch — the GREEN base). With packet 075
 * v2 stacked: vitest 1113 → 1130 passed / 40 skipped / 0 failed (chain
 * exit 0). Packet 075 v2 alone on a CLEAN `origin/main @ 3bd9ada7` would
 * inherit the 19 pre-existing failures (packet 073's scope); per the
 * packet 075 rejection lesson (2026-06-20T06:30Z), the packet must branch
 * from PR #65's branch so the ship-gate is GREEN end-to-end.
 */
import { describe, it, expect } from 'vitest';
import { parseMartian, MartianParseError } from '../../src/alienclaw/martians/parser.js';

// ─── Test fixture helpers ──────────────────────────────────────────────────

const VALID_SINGLE_SLOT = `
martian_type: test_martian
description: "Test"
use_cases:
  - "Testing"
slots:
  - slot_index: 0
    tool_name: compute
    inputs_from: null
`;

const VALID_TWO_SLOT = `
martian_type: two_slot
description: "Two slots"
use_cases: []
slots:
  - slot_index: 0
    tool_name: http_get
    inputs_from: null
  - slot_index: 1
    tool_name: extract_json
    inputs_from:
      fields:
        json: "\${slot[0].output.body}"
`;

const VALID_NO_DESCRIPTION = `
martian_type: nodesc
use_cases:
  - "x"
slots:
  - slot_index: 0
    tool_name: compute
    inputs_from: null
`;

const VALID_NO_USE_CASES = `
martian_type: nouser
description: "d"
slots:
  - slot_index: 0
    tool_name: compute
    inputs_from: null
`;

// ─── describe('parseMartian — happy paths') ───────────────────────────────

describe('parseMartian — happy paths', () => {
  it('R-001 parses a minimal valid single-slot .martian', () => {
    const spec = parseMartian(VALID_SINGLE_SLOT);
    expect(spec.martianType).toBe('test_martian');
    expect(spec.description).toBe('Test');
    expect(spec.useCases).toEqual(['Testing']);
    expect(spec.slots).toHaveLength(1);
    expect(spec.slots[0].slotIndex).toBe(0);
    expect(spec.slots[0].toolName).toBe('compute');
    expect(spec.slots[0].inputsFrom).toBeNull();
  });

  it('R-002 parses a valid two-slot .martian with fields wiring', () => {
    const spec = parseMartian(VALID_TWO_SLOT);
    expect(spec.martianType).toBe('two_slot');
    expect(spec.slots).toHaveLength(2);
    expect(spec.slots[1].toolName).toBe('extract_json');
    expect(spec.slots[1].inputsFrom).not.toBeNull();
    expect(spec.slots[1].inputsFrom!.fields.json).toBe('${slot[0].output.body}');
  });

  it('R-003 defaults description to empty string when omitted', () => {
    const spec = parseMartian(VALID_NO_DESCRIPTION);
    expect(spec.description).toBe('');
    expect(spec.martianType).toBe('nodesc');
  });

  it('R-004 defaults useCases to empty array when omitted', () => {
    const spec = parseMartian(VALID_NO_USE_CASES);
    expect(spec.useCases).toEqual([]);
    expect(spec.martianType).toBe('nouser');
  });

  it('R-005 coerces a numeric string slot_index to a number', () => {
    const yaml = `
martian_type: coerceidx
description: ""
use_cases: []
slots:
  - slot_index: "0"
    tool_name: compute
    inputs_from: null
`;
    const spec = parseMartian(yaml);
    expect(spec.slots[0].slotIndex).toBe(0);
    expect(typeof spec.slots[0].slotIndex).toBe('number');
  });

  it('R-006 accepts useCases as a list with mixed types (all stringified)', () => {
    const yaml = `
martian_type: mixedlist
description: ""
use_cases:
  - 42
  - true
  - "strval"
slots:
  - slot_index: 0
    tool_name: compute
    inputs_from: null
`;
    const spec = parseMartian(yaml);
    expect(spec.useCases).toEqual(['42', 'true', 'strval']);
  });

  it('R-007 preserves sourcePath in success path (no error thrown)', () => {
    // sourcePath only appears in error messages; this is a smoke test that
    // passing a non-default sourcePath does not change the parsed result.
    const spec = parseMartian(VALID_SINGLE_SLOT, '/custom/path/foo.martian');
    expect(spec.martianType).toBe('test_martian');
  });

  it('R-008 accepts inputs_from as null explicitly', () => {
    const spec = parseMartian(VALID_SINGLE_SLOT);
    expect(spec.slots[0].inputsFrom).toBeNull();
  });
});

// ─── describe('parseMartian — YAML-level errors') ─────────────────────────

describe('parseMartian — YAML-level errors', () => {
  it('R-101 rejects tab-indented YAML', () => {
    // parser.ts:47 — tab indentation guard
    const tabIndented = 'martian_type: foo\n\tslots: []\n';
    expect(() => parseMartian(tabIndented)).toThrow(MartianParseError);
    expect(() => parseMartian(tabIndented)).toThrow(/tab/);
  });

  it('R-102 rejects empty input', () => {
    // parser.ts:85 — empty lines list
    expect(() => parseMartian('')).toThrow(MartianParseError);
    expect(() => parseMartian('   \n  \n')).toThrow(MartianParseError);
  });

  it('R-103 rejects mixed-indentation YAML (an unmatched indent drop)', () => {
    // parser.ts:158 — generic YAML parse error (caught and re-thrown wrapped)
    const yaml = 'foo:\n  - bar\n - baz\n';
    expect(() => parseMartian(yaml)).toThrow(MartianParseError);
    expect(() => parseMartian(yaml)).toThrow(/YAML/);
  });

  it('R-104 rejects flow-style sequences/mappings (unsupported)', () => {
    // parser.ts:158 — flow-style is rejected at parse time
    const yaml = 'a: 1\nb: {unclosed\n';
    expect(() => parseMartian(yaml)).toThrow(MartianParseError);
    expect(() => parseMartian(yaml)).toThrow(/flow-style/);
  });

  it('R-105 rejects unparseable tokens at the start of a line', () => {
    // parser.ts:158 — '{[' is unparseable (not a valid mapping entry)
    expect(() => parseMartian('{[\n')).toThrow(MartianParseError);
    expect(() => parseMartian('{[\n')).toThrow(/YAML/);
  });

  it('R-106 wraps the inner YAML error message in a re-thrown MartianParseError', () => {
    // parser.ts:247-250 — error wrapping branch (the inner exc is non-MartianParseError)
    try {
      parseMartian('foo:\n  - bar\n - baz\n');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(MartianParseError);
      // The wrapper includes the sourcePath prefix
      expect((err as Error).message).toMatch(/YAML error in/);
    }
  });
});

// ─── describe('parseMartian — top-level shape errors') ────────────────────

describe('parseMartian — top-level shape errors', () => {
  it('R-201 rejects top-level as a list (not a mapping)', () => {
    // parser.ts:254
    expect(() => parseMartian('- item1\n- item2\n')).toThrow(MartianParseError);
    expect(() => parseMartian('- item1\n- item2\n')).toThrow(/mapping/);
  });

  it('R-202 rejects top-level as a scalar', () => {
    const yaml = 'just_a_string\n';
    expect(() => parseMartian(yaml)).toThrow(MartianParseError);
  });

  it('R-203 rejects missing required field martian_type', () => {
    const yaml = `
slots:
  - slot_index: 0
    tool_name: compute
    inputs_from: null
`;
    expect(() => parseMartian(yaml)).toThrow(MartianParseError);
    expect(() => parseMartian(yaml)).toThrow(/martian_type/);
  });

  it('R-204 rejects missing required field slots', () => {
    const yaml = 'martian_type: foo\n';
    expect(() => parseMartian(yaml)).toThrow(MartianParseError);
    expect(() => parseMartian(yaml)).toThrow(/slots/);
  });

  it('R-205 error message includes the sourcePath when explicitly provided', () => {
    const yaml = 'martian_type: foo\n';
    try {
      parseMartian(yaml, '/path/to/foo.martian');
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as Error).message).toContain('/path/to/foo.martian');
    }
  });
});

// ─── describe('parseMartian — slots-list errors') ─────────────────────────

describe('parseMartian — slots-list errors', () => {
  it('R-301 rejects slots: [] (empty list)', () => {
    // parser.ts:274
    const yaml = 'martian_type: foo\nslots: []\n';
    expect(() => parseMartian(yaml)).toThrow(MartianParseError);
    expect(() => parseMartian(yaml)).toThrow(/non-empty/);
  });

  it('R-302 rejects slots that is not a list (e.g., a string)', () => {
    const yaml = 'martian_type: foo\nslots: "not_a_list"\n';
    expect(() => parseMartian(yaml)).toThrow(MartianParseError);
  });

  it('R-303 rejects a slot that is not a mapping (e.g., a scalar)', () => {
    // parser.ts:281
    const yaml = `
martian_type: foo
slots:
  - "just_a_string"
`;
    expect(() => parseMartian(yaml)).toThrow(MartianParseError);
    expect(() => parseMartian(yaml)).toThrow(/slot 0 must be a mapping/);
  });

  it('R-304 rejects a slot missing slot_index', () => {
    // parser.ts:285 (slot_index branch)
    const yaml = `
martian_type: foo
slots:
  - tool_name: compute
    inputs_from: null
`;
    expect(() => parseMartian(yaml)).toThrow(MartianParseError);
    expect(() => parseMartian(yaml)).toThrow(/slot 0 missing 'slot_index'/);
  });

  it('R-305 rejects a slot missing tool_name', () => {
    // parser.ts:285 (tool_name branch)
    const yaml = `
martian_type: foo
slots:
  - slot_index: 0
    inputs_from: null
`;
    expect(() => parseMartian(yaml)).toThrow(MartianParseError);
    expect(() => parseMartian(yaml)).toThrow(/slot 0 missing 'tool_name'/);
  });

  it('R-306 reports the correct slot index in the error message', () => {
    // parser.ts:285 — second-slot error
    const yaml = `
martian_type: foo
slots:
  - slot_index: 0
    tool_name: compute
    inputs_from: null
  - tool_name: extract_json
    inputs_from: null
`;
    expect(() => parseMartian(yaml)).toThrow(/slot 1 missing 'slot_index'/);
  });
});

// ─── describe('parseMartian — inputs_from errors') ────────────────────────

describe('parseMartian — inputs_from errors', () => {
  it('R-401 rejects inputs_from that is neither null nor {fields: ...}', () => {
    // parser.ts:307
    const yaml = `
martian_type: foo
slots:
  - slot_index: 0
    tool_name: compute
    inputs_from: "neither_null_nor_object"
`;
    expect(() => parseMartian(yaml)).toThrow(MartianParseError);
    expect(() => parseMartian(yaml)).toThrow(/inputs_from must be null or have 'fields'/);
  });

  it('R-402 accepts inputs_from as an empty fields object', () => {
    const yaml = `
martian_type: foo
slots:
  - slot_index: 0
    tool_name: compute
    inputs_from:
      fields: {}
`;
    const spec = parseMartian(yaml);
    expect(spec.slots[0].inputsFrom).not.toBeNull();
    expect(spec.slots[0].inputsFrom!.fields).toEqual({});
  });

  it('R-403 accepts inputs_from with a fields mapping containing string values', () => {
    const yaml = `
martian_type: foo
slots:
  - slot_index: 0
    tool_name: compute
    inputs_from:
      fields:
        k1: v1
        k2: "v2"
`;
    const spec = parseMartian(yaml);
    expect(spec.slots[0].inputsFrom!.fields).toEqual({ k1: 'v1', k2: 'v2' });
  });
});

// ─── describe('MartianParseError') ─────────────────────────────────────────

describe('MartianParseError', () => {
  it('R-501 is an Error subclass with name MartianParseError', () => {
    const e = new MartianParseError('boom');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(MartianParseError);
    expect(e.name).toBe('MartianParseError');
    expect(e.message).toBe('boom');
  });

  it('R-502 preserves the message passed to its constructor', () => {
    const e = new MartianParseError('custom message');
    expect(e.message).toBe('custom message');
  });

  it('R-503 thrown errors from parseMartian are catchable as MartianParseError', () => {
    try {
      parseMartian('martian_type: foo\n');  // missing slots
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(MartianParseError);
      expect((err as MartianParseError).name).toBe('MartianParseError');
    }
  });
});

// ─── describe('parseMartian — quote-aware key parsing') ───────────────────

describe('parseMartian — quote-aware key parsing (TS-specific branch)', () => {
  it('R-601 accepts a key with a colon inside double quotes', () => {
    // _findKeyColon (parser.ts:204-218) is quote-aware — `:` inside quoted
    // strings must NOT be treated as the key terminator.
    const yaml = `
martian_type: "key: with: colons"
description: ""
use_cases: []
slots:
  - slot_index: 0
    tool_name: compute
    inputs_from: null
`;
    const spec = parseMartian(yaml);
    expect(spec.martianType).toBe('key: with: colons');
  });

  it('R-602 accepts a quoted scalar value containing a colon', () => {
    const yaml = `
martian_type: foo
description: "value: with: colons"
use_cases: []
slots:
  - slot_index: 0
    tool_name: compute
    inputs_from: null
`;
    const spec = parseMartian(yaml);
    expect(spec.description).toBe('value: with: colons');
  });
});

// ─── describe('parseMartian — sequence / block-style edge cases') ─────────

describe('parseMartian — sequence / block-style edge cases (TS-specific)', () => {
  it('R-701 rejects unexpected indent inside a sequence item', () => {
    // parser.ts:158 — guard against over-indented content inside a `- ...` list
    const yaml = `
martian_type: foo
slots:
  - slot_index: 0
    tool_name: compute
    inputs_from: null
       bad_indent: too_deep
`;
    expect(() => parseMartian(yaml)).toThrow(MartianParseError);
    expect(() => parseMartian(yaml)).toThrow(/unexpected indent/);
  });

  it('R-702 accepts a block-style sequence item (nested mapping under "-")', () => {
    // parser.ts:169-174 — block-style `- ` followed by indented mapping
    const yaml = `
martian_type: foo
slots:
  -
    slot_index: 0
    tool_name: compute
    inputs_from: null
`;
    const spec = parseMartian(yaml);
    expect(spec.slots).toHaveLength(1);
    expect(spec.slots[0].slotIndex).toBe(0);
    expect(spec.slots[0].toolName).toBe('compute');
  });

  it('R-703 rejects a trailing top-level dash line after the document end', () => {
    // parser.ts:226 — _parseYaml wrapper: end < lines.length guard
    // (a top-level sequence after the mapping triggers this; a trailing
    // sibling mapping entry is silently absorbed into the same mapping.)
    const yaml = `
martian_type: foo
slots:
  - slot_index: 0
    tool_name: compute
    inputs_from: null
- orphan_dash_item
`;
    expect(() => parseMartian(yaml)).toThrow(MartianParseError);
    expect(() => parseMartian(yaml)).toThrow(/unexpected content after document end/);
  });

  it('R-704 accepts blank lines and #-prefixed comments interleaved with content', () => {
    // parser.ts:42 — Skip blank lines and pure-comment lines
    const yaml = `
# leading comment
martian_type: foo

# comment between fields
slots:
  # comment inside list
  - slot_index: 0
    tool_name: compute
    inputs_from: null
`;
    const spec = parseMartian(yaml);
    expect(spec.martianType).toBe('foo');
    expect(spec.slots[0].toolName).toBe('compute');
  });
});
