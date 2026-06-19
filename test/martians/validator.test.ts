/**
 * validator.test.ts — Direct unit tests for src/alienclaw/martians/validator.ts.
 *
 * Mirrors test/martians/test_validator.py (the Python side) at the TS level.
 * `validateMartian()` is a pure function: no fs, no env, no LLM, no async.
 *
 * Coverage targets (per source inspection of validator.ts:22-89):
 *   - Empty-slots short-circuit
 *   - Duplicate slot_index
 *   - Non-contiguous slot_index
 *   - slot_index > 1 cap (Packet 16 says max 2 slots)
 *   - Tool not in TOOL_ID_TABLE
 *   - Tool not in brain registry (passed-in toolNames set)
 *   - Forward-reference detection (slot[N] where N >= current slotIndex)
 *   - Malformed substitution token (residual `${` after subst-pattern strip)
 *   - Happy path returns { valid: true, errors: [] }
 *   - Validation NEVER throws — always returns a result
 *
 * Reference impl verified end-to-end against origin/main (c0f56a87) at wake 2026-06-19T22:15Z.
 */
import { describe, it, expect } from 'vitest';
import { validateMartian } from '../../src/alienclaw/martians/validator.js';
import { TOOL_ID_TABLE } from '../../src/alienclaw/martians/types.js';
import type { MartianSpec, SlotDeclaration } from '../../src/alienclaw/martians/types.js';

// ─── Test fixture helpers ──────────────────────────────────────────────────

const KNOWN_TOOL = 'compute';
const UNKNOWN_TOOL = 'no_such_tool';

/** Build a minimal valid MartianSpec with N slots, all using KNOWN_TOOL. */
function makeSpec(slotCount: 1 | 2): MartianSpec {
  const slots: SlotDeclaration[] = [];
  for (let i = 0; i < slotCount; i++) {
    slots.push({
      slotIndex: i,
      toolName: KNOWN_TOOL,
      inputsFrom: null,
    });
  }
  return {
    martianType: `test-martian-${slotCount}`,
    slots,
    description: 'test',
    useCases: ['test'],
  };
}

/** Build a spec where slot[i].toolName = toolName (for TOOL_ID_TABLE membership tests). */
function makeSpecWithTool(i: number, toolName: string): MartianSpec {
  return {
    martianType: 'test-martian',
    slots: [{
      slotIndex: i,
      toolName,
      inputsFrom: null,
    }],
    description: 'test',
    useCases: ['test'],
  };
}

/** Build a 2-slot spec where slot[1] references slot[refSlotIdx].output.value via inputsFrom. */
function makeSpecWithForwardRef(refSlotIdx: number): MartianSpec {
  return {
    martianType: 'test-martian-forward',
    slots: [
      { slotIndex: 0, toolName: KNOWN_TOOL, inputsFrom: null },
      {
        slotIndex: 1,
        toolName: KNOWN_TOOL,
        inputsFrom: {
          fields: {
            upstream: `\${slot[${refSlotIdx}].output.value}`,
          },
        },
      },
    ],
    description: 'test',
    useCases: ['test'],
  };
}

// ─── Sanity: TOOL_ID_TABLE integrity ───────────────────────────────────────

describe('TOOL_ID_TABLE — module-export sanity', () => {
  it('contains KNOWN_TOOL with a numeric id', () => {
    expect(typeof TOOL_ID_TABLE[KNOWN_TOOL]).toBe('number');
    expect(TOOL_ID_TABLE[KNOWN_TOOL]).toBeGreaterThan(0);
  });

  it('does NOT contain UNKNOWN_TOOL', () => {
    expect(TOOL_ID_TABLE[UNKNOWN_TOOL]).toBeUndefined();
  });
});

// ─── Happy paths ───────────────────────────────────────────────────────────

describe('validateMartian — happy path', () => {
  it('returns { valid: true, errors: [] } for a 1-slot spec with known tool', () => {
    const result = validateMartian(makeSpec(1), new Set([KNOWN_TOOL]));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('returns { valid: true, errors: [] } for a 2-slot spec with known tools', () => {
    const result = validateMartian(makeSpec(2), new Set([KNOWN_TOOL]));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('never throws on any input — always returns a result object', () => {
    // even pathological input should return, not throw
    expect(() =>
      validateMartian(
        { martianType: '', slots: [], description: '', useCases: [] },
        new Set(),
      ),
    ).not.toThrow();
  });
});

// ─── Empty slots ───────────────────────────────────────────────────────────

describe('validateMartian — empty slots', () => {
  it('returns valid:false with the canonical empty-slots message', () => {
    const result = validateMartian(
      { martianType: 'x', slots: [], description: '', useCases: [] },
      new Set([KNOWN_TOOL]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('MartianSpec must have at least one slot.');
  });
});

// ─── Slot-index invariants ─────────────────────────────────────────────────

describe('validateMartian — slot_index invariants', () => {
  it('rejects duplicate slot_index values', () => {
    const spec: MartianSpec = {
      martianType: 'dup',
      slots: [
        { slotIndex: 0, toolName: KNOWN_TOOL, inputsFrom: null },
        { slotIndex: 0, toolName: KNOWN_TOOL, inputsFrom: null },
      ],
      description: 'test',
      useCases: [],
    };
    const result = validateMartian(spec, new Set([KNOWN_TOOL]));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /Duplicate slot_index/.test(e))).toBe(true);
  });

  it('rejects non-contiguous slot_index values (e.g. [0, 2])', () => {
    const spec: MartianSpec = {
      martianType: 'gap',
      slots: [
        { slotIndex: 0, toolName: KNOWN_TOOL, inputsFrom: null },
        { slotIndex: 2, toolName: KNOWN_TOOL, inputsFrom: null },
      ],
      description: 'test',
      useCases: [],
    };
    const result = validateMartian(spec, new Set([KNOWN_TOOL]));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /contiguous starting at 0/.test(e))).toBe(true);
  });

  it('rejects slot_index > 1 (Packet 16 hard cap of 2 slots)', () => {
    const spec: MartianSpec = {
      martianType: 'overcap',
      slots: [
        { slotIndex: 0, toolName: KNOWN_TOOL, inputsFrom: null },
        { slotIndex: 1, toolName: KNOWN_TOOL, inputsFrom: null },
        { slotIndex: 2, toolName: KNOWN_TOOL, inputsFrom: null },
      ],
      description: 'test',
      useCases: [],
    };
    const result = validateMartian(spec, new Set([KNOWN_TOOL]));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /exceeds max 1/.test(e))).toBe(true);
  });
});

// ─── Tool membership ───────────────────────────────────────────────────────

describe('validateMartian — tool membership', () => {
  it('rejects a tool that is not in TOOL_ID_TABLE', () => {
    const spec = makeSpecWithTool(0, UNKNOWN_TOOL);
    const result = validateMartian(spec, new Set([KNOWN_TOOL])); // brain knows compute, not unknown
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /not in TOOL_ID_TABLE/.test(e))).toBe(true);
  });

  it('rejects a tool that is in TOOL_ID_TABLE but not in the brain registry', () => {
    // tool 'compute' is in TOOL_ID_TABLE but brain registry is empty
    const spec = makeSpec(1);
    const result = validateMartian(spec, new Set()); // empty brain
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /not in brain registry/.test(e))).toBe(true);
  });

  it('accepts every tool in TOOL_ID_TABLE when all are in the brain registry', () => {
    const allToolNames = new Set(Object.keys(TOOL_ID_TABLE));
    for (const toolName of Object.keys(TOOL_ID_TABLE)) {
      const spec = makeSpecWithTool(0, toolName);
      const result = validateMartian(spec, allToolNames);
      expect(result.valid).toBe(true);
    }
  });
});

// ─── Forward references ────────────────────────────────────────────────────

describe('validateMartian — forward-reference detection', () => {
  it('detects slot[1] referencing slot[1] (self-reference)', () => {
    // slot[1] references slot[1].output → forward (must be < 1)
    const spec = makeSpecWithForwardRef(1);
    const result = validateMartian(spec, new Set([KNOWN_TOOL]));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /forward reference to slot\[1\]/.test(e))).toBe(true);
  });

  it('detects slot[0] referencing slot[0] (self-reference from slot 0)', () => {
    // slot[0] references slot[0].output → forward (must be < 0 = always invalid)
    const spec: MartianSpec = {
      martianType: 'self-ref-0',
      slots: [
        {
          slotIndex: 0,
          toolName: KNOWN_TOOL,
          inputsFrom: {
            fields: { x: '${slot[0].output.value}' },
          },
        },
      ],
      description: 'test',
      useCases: [],
    };
    const result = validateMartian(spec, new Set([KNOWN_TOOL]));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /forward reference/.test(e))).toBe(true);
  });

  it('detects slot[1] referencing slot[2] (future slot)', () => {
    // slot[1] references slot[2] which is out of range
    const spec = makeSpecWithForwardRef(2);
    const result = validateMartian(spec, new Set([KNOWN_TOOL]));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /forward reference to slot\[2\]/.test(e))).toBe(true);
  });

  it('accepts slot[1] referencing slot[0] (legitimate backward reference)', () => {
    // slot[1] references slot[0] → valid (0 < 1)
    const spec = makeSpecWithForwardRef(0);
    const result = validateMartian(spec, new Set([KNOWN_TOOL]));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

// ─── Malformed substitution tokens ─────────────────────────────────────────

describe('validateMartian — malformed substitution tokens', () => {
  it('rejects a template with a residual ${ after the subst-pattern strip', () => {
    const spec: MartianSpec = {
      martianType: 'malformed',
      slots: [
        {
          slotIndex: 0,
          toolName: KNOWN_TOOL,
          inputsFrom: {
            fields: { x: '${slot[0].output.value} and ${unclosed' },
          },
        },
      ],
      description: 'test',
      useCases: [],
    };
    const result = validateMartian(spec, new Set([KNOWN_TOOL]));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /malformed substitution token/.test(e))).toBe(true);
  });

  it('accepts templates with no substitution tokens', () => {
    const spec: MartianSpec = {
      martianType: 'literal',
      slots: [
        {
          slotIndex: 0,
          toolName: KNOWN_TOOL,
          inputsFrom: {
            fields: { x: 'plain literal string' },
          },
        },
      ],
      description: 'test',
      useCases: [],
    };
    const result = validateMartian(spec, new Set([KNOWN_TOOL]));
    expect(result.valid).toBe(true);
  });

  it('accepts templates with campaign.* references (no forward-ref check needed)', () => {
    const spec: MartianSpec = {
      martianType: 'campaign-ref',
      slots: [
        {
          slotIndex: 0,
          toolName: KNOWN_TOOL,
          inputsFrom: {
            fields: { x: '${campaign.name}' },
          },
        },
      ],
      description: 'test',
      useCases: [],
    };
    const result = validateMartian(spec, new Set([KNOWN_TOOL]));
    expect(result.valid).toBe(true);
  });
});

// ─── Error-message shape ───────────────────────────────────────────────────

describe('validateMartian — result shape', () => {
  it('result.errors is always an array (never undefined)', () => {
    const r1 = validateMartian(makeSpec(1), new Set([KNOWN_TOOL]));
    const r2 = validateMartian(
      { martianType: '', slots: [], description: '', useCases: [] },
      new Set(),
    );
    expect(Array.isArray(r1.errors)).toBe(true);
    expect(Array.isArray(r2.errors)).toBe(true);
  });

  it('accumulates multiple errors (does not return on first failure)', () => {
    // empty + duplicate + non-contiguous + bad tool all at once
    const spec: MartianSpec = {
      martianType: 'multi',
      slots: [
        { slotIndex: 0, toolName: UNKNOWN_TOOL, inputsFrom: null },
        { slotIndex: 0, toolName: UNKNOWN_TOOL, inputsFrom: null },
      ],
      description: 'test',
      useCases: [],
    };
    const result = validateMartian(spec, new Set([KNOWN_TOOL]));
    expect(result.valid).toBe(false);
    // duplicate + non-contiguous (because [0,0] sorted != [0,1]) + tool errors
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});
