/**
 * PKT-1462 — quote-aware condition-field parsing in
 * `governance/common/subagent/transition_table.ts::parseConditionInner`.
 *
 * Two defects, one root cause (a naive `inner.split(',')`):
 *
 *   D1 (truncation): a quoted `value:` containing a comma was truncated at the
 *       first comma. `value: "a,b"` parsed to the 2-char string `"a` (the
 *       closing quote included), so `output_field_eq` could never match the
 *       value the author wrote → the campaign died as
 *       `Fail:no_matching_transition` with no hint that the YAML was the cause.
 *
 *   D2 (key injection): the same split let a value smuggle in a REPLACEMENT
 *       key. `value: x, field: toString` overwrote the declared `field` with
 *       `toString` (last-wins), silently changing the condition's semantics.
 *       Chained with the prototype-chain `in` lookup in decision_engine.ts,
 *       an `output_field_present` condition naming a prototype member fires
 *       against an EMPTY output — the transition finalizes a campaign that
 *       produced nothing.
 *
 * The fix is a quote-aware field splitter that (a) keeps commas inside a
 * quoted value and (b) REFUSES a duplicated key, so the whole transition is
 * dropped (the pre-existing fail-closed contract) instead of running with
 * injected semantics.
 *
 * SCOPE NOTE (honest): this file does NOT claim the `}` case. A `}` inside a
 * quoted value is truncated UPSTREAM by the group-split regex
 * `\{([^}]+)\}` in parseConditionsFromArray (L132), which runs before
 * parseConditionInner. Fixing that requires a quote-aware group tokeniser —
 * a materially larger change. See PKT-692's rejection hand-back
 * (issues.md:1502-1537), Option 1: "Re-scope to comma-only."
 */
import { describe, it, expect } from 'vitest';
import { parseTransitionTable } from '../../../src/alienclaw/governance/common/subagent/transition_table.js';
import { decide } from '../../../src/alienclaw/governance/common/subagent/decision_engine.js';

function campaignMd(when: string): string {
  return `
transition_table:
  initial_state: S1
  states:
    S1:
      martian_type: compute
      inputs: {}
      transitions:
        - when: ${when}
          goto: FINALIZE
`;
}

function firstCondition(when: string): any {
  const r = parseTransitionTable(campaignMd(when));
  expect(r.ok).toBe(true);
  const cond = r.table?.states['S1']?.transitions[0]?.when.conditions[0];
  expect(cond).toBeDefined();
  return cond;
}

function transitionCount(when: string): number {
  const r = parseTransitionTable(campaignMd(when));
  expect(r.ok).toBe(true);
  return r.table?.states['S1']?.transitions.length ?? 0;
}

describe('PKT-1462 — parseConditionInner quote-aware field parsing', () => {
  describe('D1 — comma inside a quoted value is preserved', () => {
    it('parses value: "a,b" verbatim (was: the 2-char string `"a`)', () => {
      const cond = firstCondition(
        'all: [{kind: output_field_eq, field: status, value: "a,b"}]',
      );
      expect(cond.kind).toBe('output_field_eq');
      expect(cond.field).toBe('status');
      expect(cond.value).toBe('a,b');
    });

    it('parses value: "a,b,c" verbatim', () => {
      const cond = firstCondition(
        'all: [{kind: output_field_eq, field: tags, value: "a,b,c"}]',
      );
      expect(cond.value).toBe('a,b,c');
    });

    it('parses a single-quoted value containing a comma verbatim', () => {
      const cond = firstCondition(
        "all: [{kind: output_field_eq, field: tags, value: 'red,green'}]",
      );
      expect(cond.value).toBe('red,green');
    });

    it('parses a quoted value containing a colon verbatim', () => {
      const cond = firstCondition(
        'all: [{kind: output_field_eq, field: uri, value: "https://x/y"}]',
      );
      expect(cond.value).toBe('https://x/y');
    });

    it('round-trips end-to-end: a comma-bearing value matches its output → Finalize', () => {
      const r = parseTransitionTable(campaignMd(
        'all: [{kind: output_field_eq, field: status, value: "a,b"}]',
      ));
      expect(r.ok).toBe(true);
      const action = decide({
        current_state: 'S1',
        last_result: {
          martian_type: 'compute',
          output: { status: 'a,b' },
          correctness: 1,
          fitness: 1,
          tool_calls: 1,
          error: null,
        },
        table: r.table!,
        history: [],
      });
      expect(action).toEqual({ kind: 'Finalize' });
    });
  });

  describe('D2 — a value may not inject or replace a key', () => {
    it('drops the transition when a value injects a duplicate field key', () => {
      // Was: field silently became "toString" (last-wins).
      expect(transitionCount(
        'all: [{kind: output_field_present, field: status, value: x, field: toString}]',
      )).toBe(0);
    });

    it('drops the transition when a value injects a duplicate kind key', () => {
      expect(transitionCount(
        'all: [{kind: output_field_eq, field: status, value: x, kind: output_field_present}]',
      )).toBe(0);
    });

    it('drops the transition when a value injects a duplicate n key', () => {
      expect(transitionCount(
        'all: [{kind: fitness_gt, n: 0.9, value: x, n: 0.1}]',
      )).toBe(0);
    });

    it('the injected-field table does NOT finalize an empty output', () => {
      // The full attack chain: comma-split key injection + prototype-chain `in`
      // lookup. Before the fix this returned { kind: 'Finalize' } against an
      // EMPTY output with error set and fitness 0.
      const r = parseTransitionTable(campaignMd(
        'all: [{kind: output_field_present, field: status, value: x, field: toString}]',
      ));
      expect(r.ok).toBe(true);
      const transitions = r.table?.states['S1']?.transitions ?? [];
      expect(transitions.length).toBe(0);
      // With the transition dropped, decide() has nothing to match.
      const action = decide({
        current_state: 'S1',
        last_result: {
          martian_type: 'compute',
          output: {},
          correctness: 0,
          fitness: 0,
          tool_calls: 1,
          error: 'boom',
        },
        table: r.table!,
        history: [],
      });
      expect(action).toEqual({ kind: 'Fail', reason: 'no_matching_transition' });
    });

    it('drops the transition when a quoted value is followed by a whitespace-separated key', () => {
      // The comma is not the only delimiter a value can abuse. If whitespace
      // after a closing quote were treated as a field separator, this body
      // would parse to {kind:'output_field_present', value:'x', field:'toString'}
      // — a `field` the author never wrote — and the prototype-chain `in`
      // lookup in decision_engine.ts would fire that condition against an
      // EMPTY output. There is no duplicate-key clash here to catch it, so
      // only the delimiter check stands between this body and the D2 end-state.
      // A quoted value must be followed by a comma or the end of the body;
      // anything else is a malformed body.
      expect(transitionCount(
        'all: [{kind: output_field_present, value: "x" field: toString}]',
      )).toBe(0);
    });
  });

  describe('regression guards — existing parse behaviour is unchanged', () => {
    it('plain unquoted string value is preserved', () => {
      const cond = firstCondition(
        'all: [{kind: output_field_eq, field: status, value: done}]',
      );
      expect(cond.value).toBe('done');
    });

    it('plain quoted string value is preserved', () => {
      const cond = firstCondition(
        'all: [{kind: output_field_eq, field: status, value: "y"}]',
      );
      expect(cond.value).toBe('y');
    });

    it('numeric gates still parse n', () => {
      const cond = firstCondition('all: [{kind: fitness_gt, n: 0.5}]');
      expect(cond.kind).toBe('fitness_gt');
      expect(cond.n).toBe(0.5);
    });

    it('output_field_present still parses field', () => {
      const cond = firstCondition('all: [{kind: output_field_present, field: status}]');
      expect(cond.kind).toBe('output_field_present');
      expect(cond.field).toBe('status');
    });

    it('an unterminated quote drops the transition (fail-closed)', () => {
      expect(transitionCount(
        'all: [{kind: output_field_eq, field: status, value: "unterminated}]',
      )).toBe(0);
    });
  });
});
