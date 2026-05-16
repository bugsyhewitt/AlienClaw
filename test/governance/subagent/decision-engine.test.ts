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
