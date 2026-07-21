/**
 * decision-engine.test.ts — Pure decision function (Packet 18).
 */
import { describe, it, expect } from 'vitest';
import {
  decide,
  type TransitionTable,
  type SummonResult,
  type DecisionInput,
} from '../../../src/alienclaw/governance/common/subagent/decision_engine.js';

const makeResult = (overrides: Partial<SummonResult> = {}): SummonResult => ({
  martian_type: 'compute_alone',
  output: { result: 42 },
  correctness: 1.0,
  fitness: 0.8,
  tool_calls: 1,
  error: null,
  ...overrides,
});

const simpleTable: TransitionTable = {
  initial_state: 'step1',
  states: {
    step1: {
      name: 'step1',
      martian_type: 'compute_alone',
      inputs: { input: '2+2' },
      transitions: [
        { when: { kind: 'all', conditions: [{ kind: 'martian_succeeded' }] }, goto: 'FINALIZE' },
        { when: { kind: 'all', conditions: [{ kind: 'error_present' }] }, goto: 'FAIL:error' },
      ],
    },
  },
};

describe('decide() — initial call', () => {
  it('null last_result → Summon for initial state', () => {
    const action = decide({ current_state: 'step1', last_result: null, table: simpleTable, history: [] });
    expect(action.kind).toBe('Summon');
    if (action.kind === 'Summon') {
      expect(action.martian_type).toBe('compute_alone');
      expect(action.target_state).toBe('step1');
    }
  });
});

describe('decide() — transition evaluation', () => {
  it('martian_succeeded → Finalize', () => {
    const action = decide({ current_state: 'step1', last_result: makeResult(), table: simpleTable, history: [] });
    expect(action.kind).toBe('Finalize');
  });

  it('error_present → Fail with reason', () => {
    const action = decide({
      current_state: 'step1',
      last_result: makeResult({ error: 'oops', fitness: 0 }),
      table: simpleTable,
      history: [],
    });
    expect(action.kind).toBe('Fail');
    if (action.kind === 'Fail') expect(action.reason).toBe('error');
  });

  it('no matching transition → Fail("no_matching_transition")', () => {
    const tableNoMatch: TransitionTable = {
      initial_state: 'step1',
      states: {
        step1: {
          name: 'step1', martian_type: 'compute_alone', inputs: {},
          transitions: [
            { when: { kind: 'all', conditions: [{ kind: 'fitness_gt', n: 0.99 }] }, goto: 'FINALIZE' },
          ],
        },
      },
    };
    const action = decide({
      current_state: 'step1',
      last_result: makeResult({ fitness: 0.5 }),
      table: tableNoMatch,
      history: [],
    });
    expect(action.kind).toBe('Fail');
    if (action.kind === 'Fail') expect(action.reason).toBe('no_matching_transition');
  });

  it('unknown current_state → Fail("state_not_found:...")', () => {
    const action = decide({
      current_state: 'ghost', last_result: makeResult(), table: simpleTable, history: [],
    });
    expect(action.kind).toBe('Fail');
    if (action.kind === 'Fail') expect(action.reason).toContain('state_not_found');
  });

  it('unknown goto target → Fail("state_not_found:<goto>")', () => {
    // current_state is valid, but the goto target refers to a non-existent state.
    // Distinct from the unknown current_state test (which exercises the
    // state_not_found emission for current_state itself).
    const table: TransitionTable = {
      initial_state: 's',
      states: { s: { name: 's', martian_type: 'x', inputs: {}, transitions: [
        { when: { kind: 'all', conditions: [{ kind: 'martian_succeeded' }] }, goto: 'ghost_state' },
      ] } },
    };
    const a = decide({ current_state: 's', last_result: makeResult(), table, history: [] });
    expect(a.kind).toBe('Fail');
    if (a.kind === 'Fail') expect(a.reason).toBe('state_not_found:ghost_state');
  });

  it('martian_correctness_gt(0.5) passes when correctness=0.8', () => {
    const table: TransitionTable = {
      initial_state: 's',
      states: { s: { name: 's', martian_type: 'x', inputs: {}, transitions: [
        { when: { kind: 'all', conditions: [{ kind: 'martian_correctness_gt', n: 0.5 }] }, goto: 'FINALIZE' },
      ] } },
    };
    const a = decide({ current_state: 's', last_result: makeResult({ correctness: 0.8 }), table, history: [] });
    expect(a.kind).toBe('Finalize');
  });

  it('fitness_lt(0.3) fires on low fitness', () => {
    const table: TransitionTable = {
      initial_state: 's',
      states: { s: { name: 's', martian_type: 'x', inputs: {}, transitions: [
        { when: { kind: 'all', conditions: [{ kind: 'fitness_lt', n: 0.3 }] }, goto: 'FAIL:low_fitness' },
      ] } },
    };
    const a = decide({ current_state: 's', last_result: makeResult({ fitness: 0.1 }), table, history: [] });
    expect(a.kind).toBe('Fail');
  });

  it('output_field_present matches existing field', () => {
    const table: TransitionTable = {
      initial_state: 's',
      states: { s: { name: 's', martian_type: 'x', inputs: {}, transitions: [
        { when: { kind: 'all', conditions: [{ kind: 'output_field_present', field: 'result' }] }, goto: 'FINALIZE' },
      ] } },
    };
    const a = decide({ current_state: 's', last_result: makeResult({ output: { result: 42 } }), table, history: [] });
    expect(a.kind).toBe('Finalize');
  });

  it('ConditionGroup "any" — only one needs to match', () => {
    const table: TransitionTable = {
      initial_state: 's',
      states: { s: { name: 's', martian_type: 'x', inputs: {}, transitions: [
        { when: { kind: 'any', conditions: [{ kind: 'fitness_gt', n: 0.9 }, { kind: 'error_absent' }] }, goto: 'FINALIZE' },
      ] } },
    };
    const a = decide({ current_state: 's', last_result: makeResult({ fitness: 0.5, error: null }), table, history: [] });
    expect(a.kind).toBe('Finalize');
  });

  it('ConditionGroup "all" — all must match', () => {
    const table: TransitionTable = {
      initial_state: 's',
      states: { s: { name: 's', martian_type: 'x', inputs: {}, transitions: [
        { when: { kind: 'all', conditions: [{ kind: 'fitness_gt', n: 0.9 }, { kind: 'error_absent' }] }, goto: 'FINALIZE' },
        { when: { kind: 'all', conditions: [{ kind: 'error_absent' }] }, goto: 'FAIL:low_fitness' },
      ] } },
    };
    const a = decide({ current_state: 's', last_result: makeResult({ fitness: 0.5, error: null }), table, history: [] });
    expect(a.kind).toBe('Fail');
  });

  it('Summon to different state includes target_state', () => {
    const table: TransitionTable = {
      initial_state: 's1',
      states: {
        s1: { name: 's1', martian_type: 'A', inputs: {}, transitions: [
          { when: { kind: 'all', conditions: [{ kind: 'martian_succeeded' }] }, goto: 's2' },
        ] },
        s2: { name: 's2', martian_type: 'B', inputs: {}, transitions: [
          { when: { kind: 'all', conditions: [{ kind: 'martian_succeeded' }] }, goto: 'FINALIZE' },
        ] },
      },
    };
    const a = decide({ current_state: 's1', last_result: makeResult(), table, history: [] });
    expect(a.kind).toBe('Summon');
    if (a.kind === 'Summon') {
      expect(a.target_state).toBe('s2');
      expect(a.martian_type).toBe('B');
    }
  });
});

describe('decide() — Retry action', () => {
  it('self-loop goto → Retry', () => {
    // A state whose error transition points back at itself means "retry this martian".
    const table: TransitionTable = {
      initial_state: 's',
      states: {
        s: { name: 's', martian_type: 'x', inputs: {}, transitions: [
          { when: { kind: 'all', conditions: [{ kind: 'error_present' }] }, goto: 's' },
          { when: { kind: 'all', conditions: [{ kind: 'martian_succeeded' }] }, goto: 'FINALIZE' },
        ] },
      },
    };
    const a = decide({
      current_state: 's',
      last_result: makeResult({ error: 'transient', fitness: 0 }),
      table,
      history: [],
    });
    expect(a.kind).toBe('Retry');
  });

  it('self-loop does not fire when condition does not match', () => {
    const table: TransitionTable = {
      initial_state: 's',
      states: {
        s: { name: 's', martian_type: 'x', inputs: {}, transitions: [
          { when: { kind: 'all', conditions: [{ kind: 'error_present' }] }, goto: 's' },
          { when: { kind: 'all', conditions: [{ kind: 'martian_succeeded' }] }, goto: 'FINALIZE' },
        ] },
      },
    };
    const a = decide({
      current_state: 's',
      last_result: makeResult({ error: null, fitness: 0.7 }),
      table,
      history: [],
    });
    expect(a.kind).toBe('Finalize');
  });
});

describe('decide() — uncovered evalCondition branches', () => {
  it('martian_correctness_lt fires on low correctness', () => {
    const table: TransitionTable = {
      initial_state: 's',
      states: { s: { name: 's', martian_type: 'x', inputs: {}, transitions: [
        { when: { kind: 'all', conditions: [{ kind: 'martian_correctness_lt', n: 0.5 }] }, goto: 'FAIL:low_correctness' },
      ] } },
    };
    const a = decide({ current_state: 's', last_result: makeResult({ correctness: 0.2 }), table, history: [] });
    expect(a.kind).toBe('Fail');
    if (a.kind === 'Fail') expect(a.reason).toBe('low_correctness');
  });

  it('martian_correctness_lt does not fire when correctness is above threshold', () => {
    const table: TransitionTable = {
      initial_state: 's',
      states: { s: { name: 's', martian_type: 'x', inputs: {}, transitions: [
        { when: { kind: 'all', conditions: [{ kind: 'martian_correctness_lt', n: 0.5 }] }, goto: 'FAIL:low_correctness' },
      ] } },
    };
    const a = decide({ current_state: 's', last_result: makeResult({ correctness: 0.8 }), table, history: [] });
    expect(a.kind).toBe('Fail');
    if (a.kind === 'Fail') expect(a.reason).toBe('no_matching_transition');
  });

  it('tool_calls_gt fires when tool_calls exceeds threshold', () => {
    const table: TransitionTable = {
      initial_state: 's',
      states: { s: { name: 's', martian_type: 'x', inputs: {}, transitions: [
        { when: { kind: 'all', conditions: [{ kind: 'tool_calls_gt', n: 5 }] }, goto: 'FAIL:too_many_calls' },
      ] } },
    };
    const a = decide({ current_state: 's', last_result: makeResult({ tool_calls: 10 }), table, history: [] });
    expect(a.kind).toBe('Fail');
    if (a.kind === 'Fail') expect(a.reason).toBe('too_many_calls');
  });

  it('tool_calls_gt does not fire at or below threshold', () => {
    const table: TransitionTable = {
      initial_state: 's',
      states: { s: { name: 's', martian_type: 'x', inputs: {}, transitions: [
        { when: { kind: 'all', conditions: [{ kind: 'tool_calls_gt', n: 5 }] }, goto: 'FAIL:too_many_calls' },
      ] } },
    };
    const a = decide({ current_state: 's', last_result: makeResult({ tool_calls: 5 }), table, history: [] });
    expect(a.kind).toBe('Fail');
    if (a.kind === 'Fail') expect(a.reason).toBe('no_matching_transition');
  });

  it('tool_calls_lt fires when tool_calls is below threshold', () => {
    const table: TransitionTable = {
      initial_state: 's',
      states: { s: { name: 's', martian_type: 'x', inputs: {}, transitions: [
        { when: { kind: 'all', conditions: [{ kind: 'tool_calls_lt', n: 3 }] }, goto: 'FAIL:too_few_calls' },
      ] } },
    };
    const a = decide({ current_state: 's', last_result: makeResult({ tool_calls: 1 }), table, history: [] });
    expect(a.kind).toBe('Fail');
    if (a.kind === 'Fail') expect(a.reason).toBe('too_few_calls');
  });

  it('output_field_eq matches exact value → Finalize', () => {
    const table: TransitionTable = {
      initial_state: 's',
      states: { s: { name: 's', martian_type: 'x', inputs: {}, transitions: [
        { when: { kind: 'all', conditions: [{ kind: 'output_field_eq', field: 'status', value: 'done' }] }, goto: 'FINALIZE' },
      ] } },
    };
    const a = decide({ current_state: 's', last_result: makeResult({ output: { status: 'done' } }), table, history: [] });
    expect(a.kind).toBe('Finalize');
  });

  it('output_field_eq no-match → Fail(no_matching_transition)', () => {
    const table: TransitionTable = {
      initial_state: 's',
      states: { s: { name: 's', martian_type: 'x', inputs: {}, transitions: [
        { when: { kind: 'all', conditions: [{ kind: 'output_field_eq', field: 'status', value: 'done' }] }, goto: 'FINALIZE' },
      ] } },
    };
    const a = decide({ current_state: 's', last_result: makeResult({ output: { status: 'pending' } }), table, history: [] });
    expect(a.kind).toBe('Fail');
    if (a.kind === 'Fail') expect(a.reason).toBe('no_matching_transition');
  });

  it('output_field_eq uses strict equality — type mismatch does not match', () => {
    const table: TransitionTable = {
      initial_state: 's',
      states: { s: { name: 's', martian_type: 'x', inputs: {}, transitions: [
        { when: { kind: 'all', conditions: [{ kind: 'output_field_eq', field: 'count', value: 42 }] }, goto: 'FINALIZE' },
      ] } },
    };
    // '42' (string) !== 42 (number) — strict equality
    const a = decide({ current_state: 's', last_result: makeResult({ output: { count: '42' } }), table, history: [] });
    expect(a.kind).toBe('Fail');
    if (a.kind === 'Fail') expect(a.reason).toBe('no_matching_transition');
  });

  it('output_field_present: absent field returns false → no matching transition', () => {
    const table: TransitionTable = {
      initial_state: 's',
      states: { s: { name: 's', martian_type: 'x', inputs: {}, transitions: [
        {
          when: { kind: 'all', conditions: [{ kind: 'output_field_present', field: 'missing_key' }] },
          goto: 'FINALIZE',
        },
      ] } },
    };
    // output only contains 'result', not 'missing_key'
    const a = decide({
      current_state: 's',
      last_result: makeResult({ output: { result: 42 } }),
      table,
      history: [],
    });
    expect(a.kind).toBe('Fail');
    if (a.kind === 'Fail') expect(a.reason).toBe('no_matching_transition');
  });
});

describe('decide() — purity', () => {
  it('same input 100 times → identical output', () => {
    const input: DecisionInput = {
      current_state: 'step1', last_result: makeResult(), table: simpleTable, history: [],
    };
    const results = Array.from({ length: 100 }, () => decide(input));
    const first = JSON.stringify(results[0]);
    expect(results.every(r => JSON.stringify(r) === first)).toBe(true);
  });
});
