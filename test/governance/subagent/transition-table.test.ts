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
