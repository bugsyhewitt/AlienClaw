/**
 * PKT-909 — evalCondition silently defers to IEEE-754 on NaN-supplied
 * numeric fields, and a NaN-supplied result then cascades into a wrong
 * transition when a success-shape branch follows a poisoned gate.
 *
 * Background (2026-08-23):
 *   src/alienclaw/governance/common/subagent/decision_engine.ts:67-81
 *   evalCondition uses `x > cond.n` / `x < cond.n` for all numeric
 *   thresholds (correctness, fitness, tool_calls). IEEE-754 returns
 *   `false` for any comparison against NaN — no throw, no signal.
 *
 *   The defect: a NaN-supplied SummonResult silently degenerates every
 *   numeric gate to `false`. The campaign then EITHER reaches
 *   `no_transition_matched → Fail` (lossy) OR takes the next viable
 *   success-shape branch (silent wrong-transition). The user sees
 *   "Finalize on garbage data" with no caller-visible reason.
 *
 *   Source of the NaN: src/alienclaw/governance/common/subagent.ts:587
 *     const correctness = adapterResult.ok
 *       ? ((adapterResult.run_metadata?.correctness as number | undefined) ?? 1.0)
 *       : 0.0;
 *   No Number.isFinite guard. A misbehaving or stale-cached adapter
 *   returning `run_metadata.correctness = NaN` writes NaN directly to
 *   lastResult.correctness.
 *
 *   Symmetric guards already exist elsewhere in the run:
 *     src/alienclaw/governance/common/subagent/fitness_aggregator.ts:33
 *     src/alienclaw/governance/common/subagent/transition_table.ts:73,169
 *     src/alienclaw/fitness/function.py:32   (Python side, mirror)
 *     src/alienclaw/evolution/reflective/objectives.ts:  (PKT-680)
 *   The decision engine is the only consumer WITHOUT a guard on this path.
 *
 * Fix (PKT-909): add a single chokepoint at the top of `decide()`:
 *   - if any of correctness / fitness / tool_calls is NaN → return
 *     `{kind: 'Fail', reason: 'poisoned_result_nan'}` immediately.
 *
 * ±Infinity is INTENTIONALLY preserved: IEEE-754 > / < already produce
 * the correct success-/failure-shape answer for ±Infinity, and these
 * represent unambiguous adapter returns ("maximum" / "below minimum")
 * — not poison.
 *
 * Pre-fix vs post-fix on a NaN-correctness result:
 *
 *   table {
 *     transitions: [
 *       { when: correctness_gt(0.5), goto: 'FINALIZE' },
 *       { when: martian_succeeded,   goto: 'FINALIZE' }, // success-shape fallback
 *     ]
 *   }
 *
 *   pre-fix:
 *     correctness_gt(0.5) → false (NaN > 0.5 === false)
 *     martian_succeeded   → true  (error=null, fitness=0.7 > 0)
 *     → Finalize ❌ (silent wrong-transition on poison data)
 *
 *   post-fix:
 *     decide() rejects NaN correctness BEFORE the transition loop
 *     → Fail(reason: 'poisoned_result_nan') ✓ (caller-visible signal)
 */
import { describe, it, expect } from 'vitest';
import {
  decide,
  type TransitionTable,
  type SummonResult,
} from '../../../src/alienclaw/governance/common/subagent/decision_engine.js';

const makeResult = (overrides: Partial<SummonResult> = {}): SummonResult => ({
  martian_type: 'compute_alone',
  output: { result: 42 },
  correctness: 0.8,
  fitness: 0.7,
  tool_calls: 1,
  error: null,
  ...overrides,
});

/**
 * Cascade table: success-shape correctness gate followed by a
 * success-shape `martian_succeeded` fallback. This is the realistic
 * layout in actual campaign tables: first the strict gate, then the
 * fallback that says "we tried, ship it".
 *
 * With NaN correctness on this table:
 *   pre-fix:  correctness_gt(0.5) → false → martian_succeeded → true →
 *             Finalize (silent wrong-transition)
 *   post-fix: decide() rejects → Fail(reason: 'poisoned_result_nan')
 */
const cascadeTable: TransitionTable = {
  initial_state: 'step1',
  states: {
    step1: {
      name: 'step1',
      martian_type: 'compute_alone',
      inputs: { input: '2+2' },
      transitions: [
        { when: { kind: 'all', conditions: [{ kind: 'martian_correctness_gt', n: 0.5 }] }, goto: 'FINALIZE' },
        { when: { kind: 'all', conditions: [{ kind: 'martian_succeeded' }] }, goto: 'FINALIZE' },
      ],
    },
  },
};

/**
 * cascadeTable_B — same shape but with tool_calls poison: a failure-shape
 * budget gate followed by the success-shape fallback.
 */
const cascadeTableB: TransitionTable = {
  initial_state: 'step1',
  states: {
    step1: {
      name: 'step1',
      martian_type: 'compute_alone',
      inputs: { input: '2+2' },
      transitions: [
        { when: { kind: 'all', conditions: [{ kind: 'tool_calls_gt', n: 5 }] }, goto: 'FAIL:over_budget' },
        { when: { kind: 'all', conditions: [{ kind: 'martian_succeeded' }] }, goto: 'FINALIZE' },
      ],
    },
  },
};

/**
 * cascadeTable_C — fitness poison: fitness gate then success-shape.
 */
const cascadeTableC: TransitionTable = {
  initial_state: 'step1',
  states: {
    step1: {
      name: 'step1',
      martian_type: 'compute_alone',
      inputs: { input: '2+2' },
      transitions: [
        { when: { kind: 'all', conditions: [{ kind: 'fitness_gt', n: 0.5 }] }, goto: 'FINALIZE' },
        { when: { kind: 'all', conditions: [{ kind: 'martian_succeeded' }] }, goto: 'FINALIZE' },
      ],
    },
  },
};

describe('PKT-909 — decide() rejects NaN-supplied numeric SummonResult fields', () => {
  describe('cascade correctness', () => {
    it('NaN correctness: pre-fix Finalizes; post-fix Fails closed with poisoned_result_nan', () => {
      const action = decide({
        current_state: 'step1',
        last_result: makeResult({ correctness: NaN }),
        table: cascadeTable,
        history: [],
      });
      // The defect: pre-fix this returns {kind: 'Finalize'} — silent
      // Finalize on poison data. Post-fix this returns Fail with a
      // caller-visible reason. Pin: must not silently Finalize, must
      // surface a poison reason.
      expect(action.kind).toBe('Fail');
      if (action.kind === 'Fail') {
        expect(action.reason).toBe('poisoned_result_nan');
      }
    });

    it('finite correctness 0.8 in cascade: Finalizes (no regression)', () => {
      const action = decide({
        current_state: 'step1',
        last_result: makeResult({ correctness: 0.8 }),
        table: cascadeTable,
        history: [],
      });
      expect(action.kind).toBe('Finalize');
    });

    it('+Infinity correctness in cascade: Finalizes (IEEE-754 honest, success shape)', () => {
      const action = decide({
        current_state: 'step1',
        last_result: makeResult({ correctness: +Infinity }),
        table: cascadeTable,
        history: [],
      });
      expect(action.kind).toBe('Finalize');
    });

    it('-Infinity correctness in cascade: Finalizes via martian_succeeded fallback (failure shape via gt)', () => {
      // -Infinity > 0.5 === false → correctness_gt skipped → martian_succeeded
      // fires (error=null, fitness>0) → Finalize. Pin this as preserved
      // behavior — -Infinity is a HONEST failure-shape answer.
      const action = decide({
        current_state: 'step1',
        last_result: makeResult({ correctness: -Infinity }),
        table: cascadeTable,
        history: [],
      });
      expect(action.kind).toBe('Finalize');
    });
  });

  describe('cascade tool_calls (budget poison)', () => {
    it('NaN tool_calls: pre-fix Finalizes silently; post-fix Fails closed', () => {
      // Pre-fix: tool_calls_gt(5) → false → martian_succeeded → true → Finalize.
      // Post-fix: decide() rejects → Fail(poisoned_result_nan).
      const action = decide({
        current_state: 'step1',
        last_result: makeResult({ tool_calls: NaN }),
        table: cascadeTableB,
        history: [],
      });
      expect(action.kind).toBe('Fail');
      if (action.kind === 'Fail') {
        expect(action.reason).toBe('poisoned_result_nan');
      }
    });

    it('+Infinity tool_calls: over-budget branch fires (adapter clearly exceeded)', () => {
      const action = decide({
        current_state: 'step1',
        last_result: makeResult({ tool_calls: +Infinity }),
        table: cascadeTableB,
        history: [],
      });
      expect(action.kind).toBe('Fail');
      if (action.kind === 'Fail') expect(action.reason).toBe('over_budget');
    });

    it('finite tool_calls 1 (under budget): martian_succeeded Finalizes (no regression)', () => {
      const action = decide({
        current_state: 'step1',
        last_result: makeResult({ tool_calls: 1 }),
        table: cascadeTableB,
        history: [],
      });
      expect(action.kind).toBe('Finalize');
    });
  });

  describe('cascade fitness', () => {
    it('NaN fitness: pre-fix Finalizes silently; post-fix Fails closed', () => {
      // Pre-fix: fitness_gt(0.5) → false (NaN > 0.5 = false) → martian_succeeded:
      //   body is `error === null && fitness > 0` → `0.7 > 0 === true`,
      //   then NaN doesn't gate martian_succeeded → Finalize silently.
      // Post-fix: decide() rejects the NaN fitness → Fail(poisoned_result_nan).
      const action = decide({
        current_state: 'step1',
        last_result: makeResult({ fitness: NaN }),
        table: cascadeTableC,
        history: [],
      });
      expect(action.kind).toBe('Fail');
      if (action.kind === 'Fail') {
        expect(action.reason).toBe('poisoned_result_nan');
      }
    });

    it('finite fitness 0.7 in cascade: Finalizes (no regression)', () => {
      const action = decide({
        current_state: 'step1',
        last_result: makeResult({ fitness: 0.7 }),
        table: cascadeTableC,
        history: [],
      });
      expect(action.kind).toBe('Finalize');
    });

    it('+Infinity fitness in cascade: Finalizes (preserved ±Infinity contract)', () => {
      const action = decide({
        current_state: 'step1',
        last_result: makeResult({ fitness: +Infinity }),
        table: cascadeTableC,
        history: [],
      });
      expect(action.kind).toBe('Finalize');
    });
  });

  describe('initial state (last_result=null) is not affected by the boundary guard', () => {
    it('null last_result still Summons (initial call path is unchanged)', () => {
      const action = decide({
        current_state: 'step1',
        last_result: null,
        table: cascadeTable,
        history: [],
      });
      expect(action.kind).toBe('Summon');
    });

    it('NaN-supplied last_result is rejected even with no error field', () => {
      // error null + NaN fitness — non-error-shape, but the poison still
      // wins at the boundary.
      const action = decide({
        current_state: 'step1',
        last_result: makeResult({ fitness: NaN, correctness: NaN, tool_calls: NaN, error: null }),
        table: cascadeTable,
        history: [],
      });
      expect(action.kind).toBe('Fail');
      if (action.kind === 'Fail') {
        expect(action.reason).toBe('poisoned_result_nan');
      }
    });
  });
});
