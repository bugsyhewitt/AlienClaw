/**
 * transition-table.test.ts — Parser, validator, input evaluator (Packet 18).
 */
import { describe, it, expect } from 'vitest';
import {
  parseTransitionTable,
  validateTransitionTable,
  evaluateInputs,
} from '../../../src/alienclaw/governance/common/subagent/transition_table.js';

const SINGLE_STATE_YAML = `# CAMPAIGN.md content above
transition_table:
  initial_state: step1
  states:
    step1:
      martian_type: compute_alone
      inputs:
        plan: "\${campaign.plan}"
      transitions:
        - when: { all: [{ kind: martian_succeeded }] }
          goto: FINALIZE
        - when: { any: [{ kind: error_present }] }
          goto: "FAIL:martian_failed"
`;

const TWO_STATE_YAML = `transition_table:
  initial_state: step1
  states:
    step1:
      martian_type: alpha
      inputs:
        plan: "\${campaign.plan}"
      transitions:
        - when: { all: [{ kind: martian_succeeded }] }
          goto: step2
        - when: { any: [{ kind: error_present }] }
          goto: "FAIL:step1_failed"
    step2:
      martian_type: beta
      inputs:
        input: "\${last_result.output.result}"
      transitions:
        - when: { any: [{ kind: error_absent }] }
          goto: FINALIZE
        - when: { any: [{ kind: error_present }] }
          goto: "FAIL:step2_failed"
`;

describe('parseTransitionTable', () => {
  it('parses single-state YAML', () => {
    const r = parseTransitionTable(SINGLE_STATE_YAML);
    expect(r.ok).toBe(true);
    expect(r.table?.initial_state).toBe('step1');
    expect(r.table?.states['step1']).toBeDefined();
    expect(r.table?.states['step1']?.martian_type).toBe('compute_alone');
    expect(r.table?.states['step1']?.transitions.length).toBe(2);
  });

  it('parses two-state YAML', () => {
    const r = parseTransitionTable(TWO_STATE_YAML);
    expect(r.ok).toBe(true);
    expect(Object.keys(r.table?.states ?? {}).sort()).toEqual(['step1', 'step2']);
    expect(r.table?.states['step2']?.martian_type).toBe('beta');
  });

  it('returns error when section missing', () => {
    const r = parseTransitionTable('# Just a markdown file');
    expect(r.ok).toBe(false);
  });

  it('parsed conditions include kind and n', () => {
    const r = parseTransitionTable(`transition_table:
  initial_state: s
  states:
    s:
      martian_type: m
      inputs:
        x: y
      transitions:
        - when: { all: [{ kind: fitness_gt, n: 0.5 }] }
          goto: FINALIZE
`);
    expect(r.ok).toBe(true);
    const cond = r.table!.states['s']!.transitions[0]!.when.conditions[0]!;
    expect(cond.kind).toBe('fitness_gt');
    if (cond.kind === 'fitness_gt') expect(cond.n).toBe(0.5);
  });

  it('skips # comment lines at every nesting level', () => {
    const yaml = `transition_table:
  initial_state: step1
  states:
    # comment between state names
    step1:
      # comment inside state body
      martian_type: compute_alone
      inputs:
        # comment inside inputs
        plan: "\${campaign.plan}"
      transitions:
        # comment inside transitions
        - when: { all: [{ kind: martian_succeeded }] }
          goto: FINALIZE
`;
    const r = parseTransitionTable(yaml);
    expect(r.ok).toBe(true);
    expect(r.table?.states['step1']?.martian_type).toBe('compute_alone');
    expect(r.table?.states['step1']?.transitions[0]?.goto).toBe('FINALIZE');
  });

  it('skips a state-name-indent line that has a value after the colon (line 237 cold arm)', () => {
    // "step1: extra_value" at state-name indent fails the state-name regex;
    // the parser skips it and continues. Only step2 (a valid state) is parsed.
    const yaml = `transition_table:
  initial_state: step2
  states:
    step1: extra_value
    step2:
      martian_type: compute_alone
      inputs:
        plan: "\${campaign.plan}"
      transitions:
        - when: { all: [{ kind: martian_succeeded }] }
          goto: FINALIZE
`;
    const r = parseTransitionTable(yaml);
    expect(r.ok).toBe(true);
    // step1 with "extra_value" is skipped; only step2 parsed
    expect(Object.keys(r.table?.states ?? {})).toEqual(['step2']);
    expect(r.table?.states['step2']?.martian_type).toBe('compute_alone');
  });

  it('breaks the inputs loop when a code fence appears after input k/v pairs (line 262 cold arm)', () => {
    // A code fence inside the inputs block triggers isOutsideBlock → break.
    // The parser should still produce the inputs read before the fence.
    const yaml = 'transition_table:\n' +
      '  initial_state: step1\n' +
      '  states:\n' +
      '    step1:\n' +
      '      martian_type: compute_alone\n' +
      '      inputs:\n' +
      '        plan: "the plan"\n' +
      '```\n' +
      '      transitions:\n' +
      '        - when: { all: [{ kind: martian_succeeded }] }\n' +
      '          goto: FINALIZE\n';
    const r = parseTransitionTable(yaml);
    // The fence exits the inputs loop; transitions may not be parsed.
    // The key assertion is: the parser does not throw.
    expect(r.ok).toBe(true);
    expect(r.table?.states['step1']?.inputs['plan']).toBe('the plan');
  });

  it('stops the states loop when a deeply de-dented line appears (line 233 cold arm)', () => {
    // A line whose indent is less than the state name indent triggers the
    // lineIndent < stateNameIndent break, ending state enumeration early.
    const yaml = `transition_table:
  initial_state: step1
  states:
    step1:
      martian_type: alpha
      inputs:
        plan: "p"
      transitions:
        - when: { all: [{ kind: martian_succeeded }] }
          goto: FINALIZE
 trailing_key: value
`;
    const r = parseTransitionTable(yaml);
    // Parser exits states loop at the de-dented line; step1 still parsed.
    expect(r.ok).toBe(true);
    expect(r.table?.states['step1']?.martian_type).toBe('alpha');
  });

  it('skips a deeper-indented orphan line following a regex-failing state entry (line 234 cold arm)', () => {
    // After "step1: extra_value" fails the state-name regex (L237 skip, no body loop),
    // "deeper_orphan: x" at indent 6 > stateNameIndent 4 reaches L234
    // (L233: 6 < 4 is false; L234: 6 !== 4 is true → i++; continue).
    const yaml = `transition_table:
  initial_state: step2
  states:
    step1: extra_value
      deeper_orphan: x
    step2:
      martian_type: compute_alone
      inputs:
        plan: "p"
      transitions:
        - when: { all: [{ kind: martian_succeeded }] }
          goto: FINALIZE
`;
    const r = parseTransitionTable(yaml);
    expect(r.ok).toBe(true);
    expect(Object.keys(r.table?.states ?? {})).toEqual(['step2']);
  });
});

describe('validateTransitionTable', () => {
  const permissive = { has: () => true };
  const strict = { has: (m: string) => m === 'compute_alone' };

  it('rejects unknown martian_type', () => {
    const r = parseTransitionTable(SINGLE_STATE_YAML);
    const v = validateTransitionTable(r.table!, { has: () => false });
    expect(v.valid).toBe(false);
    expect(v.errors.some(e => e.includes('not in MartianRegistry'))).toBe(true);
  });

  it('accepts when registry has martian_type', () => {
    const r = parseTransitionTable(SINGLE_STATE_YAML);
    const v = validateTransitionTable(r.table!, strict);
    expect(v.valid).toBe(true);
  });

  it('rejects goto to undeclared state', () => {
    const yaml = `transition_table:
  initial_state: a
  states:
    a:
      martian_type: m
      inputs: { x: y }
      transitions:
        - when: { all: [{ kind: martian_succeeded }] }
          goto: ghost
`;
    const r = parseTransitionTable(yaml);
    expect(r.ok).toBe(true);
    const v = validateTransitionTable(r.table!, permissive);
    expect(v.valid).toBe(false);
    expect(v.errors.some(e => e.includes('undeclared state'))).toBe(true);
  });

  it('rejects state with zero transitions', () => {
    const table = {
      initial_state: 'a',
      states: {
        a: { name: 'a', martian_type: 'm', inputs: {}, transitions: [] },
      },
    };
    const v = validateTransitionTable(table, permissive);
    expect(v.valid).toBe(false);
    expect(v.errors.some(e => e.includes('at least one transition'))).toBe(true);
  });

  it('rejects when initial_state is not declared', () => {
    const table = {
      initial_state: 'missing',
      states: {
        a: {
          name: 'a',
          martian_type: 'm',
          inputs: {},
          transitions: [
            { when: { kind: 'all' as const, conditions: [{ kind: 'martian_succeeded' as const }] }, goto: 'FINALIZE' },
          ],
        },
      },
    };
    const v = validateTransitionTable(table, permissive);
    expect(v.valid).toBe(false);
  });
});

describe('evaluateInputs', () => {
  it('substitutes ${campaign.plan}', () => {
    const out = evaluateInputs(
      { plan: '${campaign.plan}' },
      { plan: 'do the thing' },
      null,
    );
    expect(out.plan).toBe('do the thing');
  });

  it('substitutes ${last_result.output.result}', () => {
    const out = evaluateInputs(
      { input: '${last_result.output.result}' },
      {},
      { output: { result: 'hello' } },
    );
    expect(out.input).toBe('hello');
  });

  it('passes through non-template strings', () => {
    const out = evaluateInputs({ x: 'literal' }, {}, null);
    expect(out.x).toBe('literal');
  });

  it('passes through non-string values', () => {
    const out = evaluateInputs({ x: 42, y: true }, {}, null);
    expect(out.x).toBe(42);
    expect(out.y).toBe(true);
  });

  it('falls back to literal when substitution fails', () => {
    const out = evaluateInputs(
      { x: '${campaign.missing}' },
      {},
      null,
    );
    expect(out.x).toBe('${campaign.missing}');
  });
});


describe('parseConditionInner unknown-kind fallback', () => {
  it('drops unknown-kind entries, leaving empty conditions when all are unknown', () => {
    const yaml = `transition_table:
  initial_state: step1
  states:
    step1:
      martian_type: compute_alone
      inputs:
        plan: "plan"
      transitions:
        - when: { all: [{ kind: not_a_real_kind }] }
          goto: FINALIZE
`;
    const r = parseTransitionTable(yaml);
    expect(r.ok).toBe(true);
    if (r.ok && r.table) {
      const when = r.table.states['step1']!.transitions[0]!.when;
      expect(when.conditions.length).toBe(0);
    }
  });
});

describe('parseConditionInner missing-kind fallback', () => {
  it('drops entries with no kind field, leaving empty conditions when none remain', () => {
    const yaml = `transition_table:
  initial_state: step1
  states:
    step1:
      martian_type: compute_alone
      inputs:
        plan: "plan"
      transitions:
        - when: { all: [{ not_kind: something }] }
          goto: FINALIZE
`;
    const r = parseTransitionTable(yaml);
    expect(r.ok).toBe(true);
    if (r.ok && r.table) {
      const when = r.table.states['step1']!.transitions[0]!.when;
      expect(when.conditions.length).toBe(0);
    }
  });
});

describe('parseConditionsFromArray with mixed valid and invalid kinds', () => {
  it('drops the invalid entry but keeps the valid one', () => {
    const yaml = `transition_table:
  initial_state: step1
  states:
    step1:
      martian_type: compute_alone
      inputs:
        plan: "plan"
      transitions:
        - when: { all: [{ kind: martian_succeeded }, { kind: bogus_kind }] }
          goto: FINALIZE
`;
    const r = parseTransitionTable(yaml);
    expect(r.ok).toBe(true);
    if (r.ok && r.table) {
      const when = r.table.states['step1']!.transitions[0]!.when;
      expect(when.conditions.length).toBe(1);
      expect(when.conditions[0]!.kind).toBe('martian_succeeded');
    }
  });
});

describe('parseConditionGroup malformed whenText', () => {
  it('falls back to all/0 when group kind is missing', () => {
    const yaml = `transition_table:
  initial_state: step1
  states:
    step1:
      martian_type: compute_alone
      inputs:
        plan: "plan"
      transitions:
        - when: { nothing_useful: true }
          goto: FINALIZE
`;
    const r = parseTransitionTable(yaml);
    expect(r.ok).toBe(true);
    if (r.ok && r.table) {
      const when = r.table.states['step1']!.transitions[0]!.when;
      expect(when.kind).toBe('all');
      expect(when.conditions.length).toBe(0);
    }
  });
});

describe('parseTransitionTable with missing initial_state', () => {
  it('returns ok=false when no initial_state key is present', () => {
    const yaml = `transition_table:
  states:
    step1:
      martian_type: compute_alone
      inputs:
        plan: "plan"
      transitions:
        - when: { all: [{ kind: martian_succeeded }] }
          goto: FINALIZE
`;
    const r = parseTransitionTable(yaml);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Could not parse/);
  });
});

describe('parseTransitionTable with missing states block', () => {
  it('returns ok=false when states: block is missing', () => {
    const yaml = `transition_table:
  initial_state: nowhere
`;
    const r = parseTransitionTable(yaml);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Could not parse/);
  });
});

describe('parseTransitionTable with state missing martian_type', () => {
  it('omits states without martian_type from the parsed table', () => {
    const yaml = `transition_table:
  initial_state: step1
  states:
    step1:
      inputs:
        plan: "plan"
      transitions:
        - when: { all: [{ kind: martian_succeeded }] }
          goto: FINALIZE
    step2:
      martian_type: compute_alone
      inputs:
        plan: "plan"
      transitions:
        - when: { all: [{ kind: martian_succeeded }] }
          goto: FINALIZE
`;
    const r = parseTransitionTable(yaml);
    expect(r.ok).toBe(true);
    if (r.ok && r.table) {
      expect(Object.keys(r.table.states).length).toBe(1);
      expect(r.table.states['step2']).toBeDefined();
      expect(r.table.states['step1']).toBeUndefined();
    }
  });
});

describe('parseTransitionTable with - when line but no goto', () => {
  it('omits the transition when goto is missing', () => {
    const yaml = `transition_table:
  initial_state: step1
  states:
    step1:
      martian_type: compute_alone
      inputs:
        plan: "plan"
      transitions:
        - when: { all: [{ kind: martian_succeeded }] }
`;
    const r = parseTransitionTable(yaml);
    expect(r.ok).toBe(true);
    if (r.ok && r.table) {
      expect(r.table.states['step1']!.transitions.length).toBe(0);
    }
  });
});

describe('parseTransitionTable with state missing transitions key', () => {
  it('keeps the state but with an empty transitions array; the validator flags it', () => {
    const yaml = `transition_table:
  initial_state: step1
  states:
    step1:
      martian_type: compute_alone
      inputs:
        plan: "plan"
    step2:
      martian_type: compute_alone
      inputs:
        plan: "plan"
      transitions:
        - when: { all: [{ kind: martian_succeeded }] }
          goto: FINALIZE
`;
    const r = parseTransitionTable(yaml);
    expect(r.ok).toBe(true);
    if (r.ok && r.table) {
      expect(Object.keys(r.table.states).length).toBe(2);
      expect(r.table.states['step1']!.transitions.length).toBe(0);
      expect(r.table.states['step2']!.transitions.length).toBe(1);
      const v = validateTransitionTable(r.table, { has: (t) => t === 'compute_alone' });
      expect(v.valid).toBe(false);
      expect(v.errors.some(e => e.includes("State 'step1': must have at least one transition"))).toBe(true);
    }
  });
});

describe('evaluateInputs edge cases', () => {
  it('handles an empty stateInputs object', () => {
    const out = evaluateInputs({}, {}, null);
    expect(out).toEqual({});
  });
  it('substitutes literal value when lastResult is null', () => {
    const out = evaluateInputs({ x: 'literal' }, {}, null);
    expect(out.x).toBe('literal');
  });
});

describe('parseConditionInner with quoted values', () => {
  it('strips single-quoted kind values', () => {
    const yaml = `transition_table:
  initial_state: step1
  states:
    step1:
      martian_type: compute_alone
      inputs:
        plan: "plan"
      transitions:
        - when: { all: [{ kind: "output_field_present", field: "result" }] }
          goto: FINALIZE
`;
    const r = parseTransitionTable(yaml);
    expect(r.ok).toBe(true);
    if (r.ok && r.table) {
      const c = r.table.states['step1']!.transitions[0]!.when.conditions[0]!;
      expect(c.kind).toBe('output_field_present');
      if (c.kind === 'output_field_present') {
        expect(c.field).toBe('result');
      }
    }
  });
});

describe('parseConditionInner with all 11 supported kinds', () => {
  it.each([
    ['martian_succeeded'],
    ['martian_correctness_gt'],
    ['martian_correctness_lt'],
    ['fitness_gt'],
    ['fitness_lt'],
    ['error_present'],
    ['error_absent'],
    ['tool_calls_gt'],
    ['tool_calls_lt'],
    ['output_field_present'],
    ['output_field_eq'],
  ])('parses %s correctly', (kind) => {
    const yaml = `transition_table:
  initial_state: step1
  states:
    step1:
      martian_type: compute_alone
      inputs:
        plan: "plan"
      transitions:
        - when: { all: [{ kind: ${kind}, n: 0.5, field: "x", value: "y" }] }
          goto: FINALIZE
`;
    const r = parseTransitionTable(yaml);
    expect(r.ok).toBe(true);
    if (r.ok && r.table) {
      const c = r.table.states['step1']!.transitions[0]!.when.conditions[0]!;
      expect(c.kind).toBe(kind);
    }
  });
});

describe('unquote — single-quoted values in YAML', () => {
  it('strips single quotes from plan input and goto values', () => {
    const yaml = `transition_table:
  initial_state: step1
  states:
    step1:
      martian_type: compute_alone
      inputs:
        plan: 'my plan'
      transitions:
        - when: { all: [{ kind: martian_succeeded }] }
          goto: 'FINALIZE'
`;
    const r = parseTransitionTable(yaml);
    expect(r.ok).toBe(true);
    expect(r.table?.states?.step1?.inputs?.plan).toBe('my plan');
    expect(r.table?.states?.step1?.transitions?.[0]?.goto).toBe('FINALIZE');
  });
});

describe('parseConditionInner — no-colon part guard (L139)', () => {
  it('silently skips condition parts that have no colon separator', () => {
    const yaml = `transition_table:
  initial_state: step1
  states:
    step1:
      martian_type: compute_alone
      inputs:
        plan: "plan"
      transitions:
        - when: { all: [{ kind_no_colon martian_succeeded }] }
          goto: FINALIZE
`;
    const r = parseTransitionTable(yaml);
    expect(r.ok).toBe(true);
    const conds = r.table?.states?.step1?.transitions?.[0]?.when?.conditions ?? [];
    expect(conds.length).toBe(0);
  });
});

describe('parseTransitionTable embedded in full CAMPAIGN.md (code-fence)', () => {
  it('parses correctly when YAML is wrapped in a ```yaml code fence', () => {
    const campaignMd = `# Campaign Brief — test-001

## Allowed Martian types

- compute_alone

## Transition table

\`\`\`yaml
transition_table:
  initial_state: step1
  states:
    step1:
      martian_type: compute_alone
      inputs:
        plan: "\${campaign.plan}"
      transitions:
        - when: { all: [{ kind: martian_succeeded }] }
          goto: FINALIZE
\`\`\`

## Extra section after the fence

This content should not affect parsing.
`;
    const r = parseTransitionTable(campaignMd);
    expect(r.ok).toBe(true);
    expect(r.table?.initial_state).toBe('step1');
    expect(r.table?.states['step1']?.martian_type).toBe('compute_alone');
  });

  it('stops at ```yaml fence even when trailing content has transition_table: keyword', () => {
    const campaignMd = `# Brief

\`\`\`yaml
transition_table:
  initial_state: step1
  states:
    step1:
      martian_type: compute_alone
      inputs: {}
      transitions:
        - when: { all: [{ kind: martian_succeeded }] }
          goto: FINALIZE
\`\`\`

<!-- transition_table: second reference should be ignored -->
`;
    const r = parseTransitionTable(campaignMd);
    expect(r.ok).toBe(true);
    expect(Object.keys(r.table?.states ?? {}).length).toBe(1);
  });
});

describe('parseTransitionTable YAML block with internal comment lines', () => {
  it('skips # comment lines inside the transition_table block', () => {
    const yaml = `transition_table:
  # comment: this should be ignored
  initial_state: step1
  states:
    step1:
      # another comment
      martian_type: compute_alone
      inputs:
        plan: "plan"
      transitions:
        - when: { all: [{ kind: martian_succeeded }] }
          goto: FINALIZE
`;
    const r = parseTransitionTable(yaml);
    expect(r.ok).toBe(true);
    expect(r.table?.initial_state).toBe('step1');
    expect(r.table?.states['step1']?.martian_type).toBe('compute_alone');
  });
});

describe('parseTransitionTable — multi-line when clause (L301)', () => {
  it('accumulates continuation lines onto whenStr before parseConditionGroup', () => {
    const yaml = `transition_table:
  initial_state: step1
  states:
    step1:
      martian_type: compute_alone
      inputs:
        plan: "plan"
      transitions:
        - when: { all: [{ kind: martian_succeeded },
            { kind: fitness_gt, n: 0.5 }] }
          goto: FINALIZE
`;
    const r = parseTransitionTable(yaml);
    expect(r.ok).toBe(true);
    if (r.ok && r.table) {
      const t = r.table.states['step1']!.transitions[0]!;
      expect(t.goto).toBe('FINALIZE');
      // whenStr was assembled from continuation line; conditions should be present
      expect(t.when.conditions.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('parseTransitionTable — non-when line in transitions block (L310)', () => {
  it('skips unrecognized lines inside transitions and still parses the valid entry', () => {
    const yaml = `transition_table:
  initial_state: step1
  states:
    step1:
      martian_type: compute_alone
      inputs:
        plan: "plan"
      transitions:
        unrecognized_key: ignored_value
        - when: { all: [{ kind: martian_succeeded }] }
          goto: FINALIZE
`;
    const r = parseTransitionTable(yaml);
    expect(r.ok).toBe(true);
    if (r.ok && r.table) {
      expect(r.table.states['step1']!.transitions.length).toBe(1);
      expect(r.table.states['step1']!.transitions[0]!.goto).toBe('FINALIZE');
    }
  });
});

describe('_parseTableYaml parser edge cases', () => {
  it('silently ignores an unrecognized top-level key (bid=31 arm=1)', () => {
    // description: is not initial_state or states — hits the false arm at L215, i++ at L329
    const yaml = `transition_table:
  initial_state: s
  description: this key is not initial_state or states
  states:
    s:
      martian_type: compute_alone
      transitions:
        - when: { all: [{ kind: martian_succeeded }] }
          goto: FINALIZE
`;
    const r = parseTransitionTable(yaml);
    expect(r.ok).toBe(true);
    expect(r.table?.initial_state).toBe('s');
    expect(r.table?.states['s']).toBeDefined();
    expect(r.table?.states['s']?.martian_type).toBe('compute_alone');
  });

  it('treats an empty inputs: block as an empty object (bid=45 arm=0)', () => {
    // inputs: at bIndent=6; next line transitions: also at indent=6 → iIndent <= bIndent → break immediately
    const yaml = `transition_table:
  initial_state: s
  states:
    s:
      martian_type: compute_alone
      inputs:
      transitions:
        - when: { all: [{ kind: martian_succeeded }] }
          goto: FINALIZE
`;
    const r = parseTransitionTable(yaml);
    expect(r.ok).toBe(true);
    expect(r.table?.states['s']?.inputs).toEqual({});
  });

  it('skips malformed input lines and keeps only the valid k:v pair (bid=49 arm=1)', () => {
    // :starts_with_colon  → colonIdx=0, not > 0 → false arm, skipped
    // no_colon_at_all     → colonIdx=-1, not > 0 → false arm, skipped
    // valid_key: valid_value → colonIdx=9 > 0 → parsed normally
    const yaml = `transition_table:
  initial_state: s
  states:
    s:
      martian_type: compute_alone
      inputs:
        :starts_with_colon
        no_colon_at_all
        valid_key: valid_value
      transitions:
        - when: { all: [{ kind: martian_succeeded }] }
          goto: FINALIZE
`;
    const r = parseTransitionTable(yaml);
    expect(r.ok).toBe(true);
    expect(r.table?.states['s']?.inputs).toEqual({ valid_key: 'valid_value' });
  });
});
