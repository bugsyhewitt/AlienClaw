/**
 * PKT-1260 File-A — `output_field_present` / `output_field_eq` must test OWN
 * properties, not inherited `Object.prototype` members.
 *
 * RED at e82ab980 (decision_engine.ts:78-79 use `in` / bare bracket access).
 * GREEN after the Object.hasOwn patch.
 */
import { describe, it, expect } from 'vitest';
import {
  decide,
  type Condition,
  type TransitionTable,
  type SummonResult,
} from '../../../src/alienclaw/governance/common/subagent/decision_engine.js';

const makeTable = (cond: Condition, gotoState: string): TransitionTable => ({
  initial_state: 's',
  states: {
    s: {
      name: 's', martian_type: 'x', inputs: {},
      transitions: [{ when: { kind: 'all', conditions: [cond] }, goto: gotoState }],
    },
    [gotoState]: { name: gotoState, martian_type: 'x', inputs: {}, transitions: [] },
  },
});

const result = (output: Record<string, unknown>): SummonResult => ({
  martian_type: 'x', output, error: null, correctness: 1.0, fitness: 1.0, tool_calls: 1,
});

const run = (cond: Condition, output: Record<string, unknown>, gotoState = 'BYPASSED') =>
  decide({ current_state: 's', last_result: result(output), table: makeTable(cond, gotoState), history: [] });

describe('PKT-1260 — output_field_present rejects inherited Object.prototype members', () => {
  // A-1..A-6: RED at HEAD — `key in {}` is true for every prototype member.
  for (const field of ['toString', 'constructor', 'hasOwnProperty', 'valueOf', '__proto__', 'isPrototypeOf']) {
    it(`A: field='${field}' on output={} does not fire the transition`, () => {
      const a = run({ kind: 'output_field_present', field }, {});
      expect(a.kind).toBe('Fail');
      if (a.kind === 'Fail') expect(a.reason).toBe('no_matching_transition');
    });
  }

  // A-7: RED at HEAD — non-empty output is equally affected (the bug is not about {}).
  it('A-7: field=\'toString\' on a populated output={result:42} still does not fire', () => {
    const a = run({ kind: 'output_field_present', field: 'toString' }, { result: 42 });
    expect(a.kind).toBe('Fail');
  });
});

describe('PKT-1260 — output_field_eq rejects inherited Object.prototype members', () => {
  // B-1: RED at HEAD — {}['constructor'] === Object is strictly true, so the
  //      strict-equality arm does NOT protect L79 on its own.
  it('B-1: field=\'constructor\' value=Object on output={} does not fire', () => {
    const a = run({ kind: 'output_field_eq', field: 'constructor', value: Object }, {});
    expect(a.kind).toBe('Fail');
    if (a.kind === 'Fail') expect(a.reason).toBe('no_matching_transition');
  });

  // B-2: RED at HEAD — same via valueOf's inherited function reference.
  it('B-2: field=\'valueOf\' value=Object.prototype.valueOf on output={} does not fire', () => {
    const a = run({ kind: 'output_field_eq', field: 'valueOf', value: Object.prototype.valueOf }, {});
    expect(a.kind).toBe('Fail');
  });
});

describe('PKT-1260 — own properties still fire (positive controls, GREEN before and after)', () => {
  it('C-1: own shadowing property field=\'toString\' fires', () => {
    const a = run({ kind: 'output_field_present', field: 'toString' }, { toString: 'x' }, 'FINALIZE');
    expect(a.kind).toBe('Finalize');
  });
  it('C-2: ordinary own field fires', () => {
    const a = run({ kind: 'output_field_present', field: 'result' }, { result: 42 }, 'FINALIZE');
    expect(a.kind).toBe('Finalize');
  });
  it('C-3: output_field_eq on an own field fires', () => {
    const a = run({ kind: 'output_field_eq', field: 'result', value: 42 }, { result: 42 }, 'FINALIZE');
    expect(a.kind).toBe('Finalize');
  });
  it('C-4: output_field_eq on an own field with a wrong value does not fire', () => {
    const a = run({ kind: 'output_field_eq', field: 'result', value: 43 }, { result: 42 });
    expect(a.kind).toBe('Fail');
  });
});
