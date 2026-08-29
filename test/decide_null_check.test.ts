import { describe, it, expect } from 'vitest';
import { decide, type SummonResult, type TransitionTable } from '../src/alienclaw/governance/common/subagent/decision_engine.js';

describe('PROBE decide() output null/undefined crash', () => {
  const mkResult = (overrides: Partial<SummonResult>): SummonResult => ({
    martian_type: 'compute',
    output: {},
    correctness: 1.0,
    fitness: 0.5,
    tool_calls: 1,
    error: null,
    ...overrides,
  });
  const mkTable = (transitions: any[]): TransitionTable => ({
    initial_state: 's1',
    states: { s1: { name: 's1', martian_type: 'compute', inputs: {}, transitions } },
  });

  it('output_field_present with output=null crashes', () => {
    const table = mkTable([
      { when: { kind: 'all', conditions: [{ kind: 'output_field_present', field: 'foo' }] }, goto: 'FINALIZE' },
    ]);
    expect(() => decide({
      current_state: 's1',
      last_result: mkResult({ output: null as any }),
      table,
      history: [],
    })).toThrow();
  });

  it('output_field_eq with output=null crashes', () => {
    const table = mkTable([
      { when: { kind: 'all', conditions: [{ kind: 'output_field_eq', field: 'foo', value: 1 }] }, goto: 'FINALIZE' },
    ]);
    expect(() => decide({
      current_state: 's1',
      last_result: mkResult({ output: null as any }),
      table,
      history: [],
    })).toThrow();
  });

  it('output_field_present with output=undefined crashes', () => {
    const table = mkTable([
      { when: { kind: 'all', conditions: [{ kind: 'output_field_present', field: 'foo' }] }, goto: 'FINALIZE' },
    ]);
    expect(() => decide({
      current_state: 's1',
      last_result: mkResult({ output: undefined as any }),
      table,
      history: [],
    })).toThrow();
  });

  it('output_field_eq with output=undefined crashes', () => {
    const table = mkTable([
      { when: { kind: 'all', conditions: [{ kind: 'output_field_eq', field: 'foo', value: 1 }] }, goto: 'FINALIZE' },
    ]);
    expect(() => decide({
      current_state: 's1',
      last_result: mkResult({ output: undefined as any }),
      table,
      history: [],
    })).toThrow();
  });

  // Error message shape probe (for the packet's blast-radius narrative)
  it('error message is the V8 "in operator" TypeError', () => {
    const table = mkTable([
      { when: { kind: 'all', conditions: [{ kind: 'output_field_present', field: 'foo' }] }, goto: 'FINALIZE' },
    ]);
    try {
      decide({
        current_state: 's1',
        last_result: mkResult({ output: null as any }),
        table,
        history: [],
      });
      expect.fail('expected throw');
    } catch (e) {
      expect((e as Error).message).toMatch(/Cannot use 'in' operator/);
      expect((e as Error).name).toBe('TypeError');
    }
  });

  // CONTROL: in-tree caller shape (output: {}) does NOT crash
  it('control: output={} does not crash', () => {
    const table = mkTable([
      { when: { kind: 'all', conditions: [{ kind: 'output_field_present', field: 'foo' }] }, goto: 'FINALIZE' },
    ]);
    const a = decide({
      current_state: 's1',
      last_result: mkResult({ output: {} }),
      table,
      history: [],
    });
    expect(a.kind).toBe('Fail');
    expect((a as any).reason).toBe('no_matching_transition');
  });
});
