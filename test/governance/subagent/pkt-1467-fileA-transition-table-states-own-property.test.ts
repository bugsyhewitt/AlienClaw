/**
 * File-A — PROBE: `transition_table.ts` / `decision_engine.ts` / `subagent.ts`
 * validate and resolve a state's identity with a BARE BRACKET READ against a
 * PLAIN OBJECT (`const states: Record<string, State> = {}`).
 *
 * `Object.prototype` is therefore reachable through `states[...]`. Twelve
 * inherited members pass the read: __defineGetter__, __defineSetter__,
 * __lookupGetter__, __lookupSetter__, __proto__, constructor, hasOwnProperty,
 * isPrototypeOf, propertyIsEnumerable, toLocaleString, toString, valueOf.
 *
 * Consequence, in three independent places:
 *
 *   1. validateTransitionTable() accepts an `initial_state` that was NEVER
 *      declared in `states` (e.g. `initial_state: constructor`).
 *   2. validateTransitionTable() accepts a `goto:` that references an
 *      UNDECLARED state (e.g. `goto: toString`).
 *   3. decide() resolves `table.states['constructor']` to the inherited
 *      `Object` constructor — a FUNCTION, not a State — and emits a Summon
 *      whose `martian_type` is `undefined` (the `Object` constructor has no
 *      such property).
 *
 * Reachability: `parseTransitionTable`'s state-name regex
 * `/^([A-Za-z_][\w]*)\s*:\s*$/` accepts `constructor` and `toString` as
 * state names, and `Subagent.runCampaign()` (subagent.ts:462) calls
 * `parseTransitionTable` WITHOUT ever calling `validateTransitionTable`.
 * The YAML source is the `transitionTableYaml` argument, the pending YAML
 * given to `birth()`, or the on-disk CAMPAIGN.md.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  parseTransitionTable,
  validateTransitionTable,
} from '../../../src/alienclaw/governance/common/subagent/transition_table.js';
import {
  decide,
  type SummonResult,
  type TransitionTable,
} from '../../../src/alienclaw/governance/common/subagent/decision_engine.js';
import { Subagent, type SubagentBrief } from '../../../src/alienclaw/governance/common/subagent.js';
import type {
  MartianSummonAdapter,
  MartianSummonRequest,
  MartianSummonResult,
} from '../../../src/alienclaw/governance/common/summon-adapter.js';

function brief(allowedMartians: string[]): SubagentBrief {
  return {
    campaignId: 'CAMP_PROTO', role: 'Proto Test', domain: 'compute',
    objective: 'prototype-member state probe', scope: 'unit', successCriteria: 'ok',
    allowedMartians, deliverables: '', backgroundContext: '',
    communicationStyle: 'terse', knowledgeBase: '', constraints: 'None',
  };
}

/** Records every summon the campaign issues. */
class RecordingAdapter implements MartianSummonAdapter {
  public calls: MartianSummonRequest[] = [];
  async summon(req: MartianSummonRequest): Promise<MartianSummonResult> {
    this.calls.push(req);
    return {
      summon_id: req.summon_id,
      ok: true,
      output: { result: 'ok' },
      fitness: 0.7,
      run_metadata: { tool_calls: 1, wall_clock_ms: 1 },
    };
  }
}

const registry = { has: (_t: string) => true };

/** A table whose initial_state is a prototype member that is NOT declared. */
const UNDECLARED_INITIAL_STATE = `transition_table:
  initial_state: constructor
  states:
    step1:
      martian_type: alpha
      transitions:
        - when: { all: [{ kind: martian_succeeded }] }
          goto: FINALIZE
`;

/** A table whose transition goto is a prototype member that is NOT declared. */
const UNDECLARED_GOTO = `transition_table:
  initial_state: step1
  states:
    step1:
      martian_type: alpha
      transitions:
        - when: { all: [{ kind: martian_succeeded }] }
          goto: toString
`;

const OK_RESULT: SummonResult = {
  martian_type: 'alpha',
  output: {},
  correctness: 1,
  fitness: 1,
  tool_calls: 0,
  error: null,
};

describe('PROBE transition_table states[] prototype-chain reachability', () => {
  // ── Validator sites (transition_table.ts) ───────────────────────────────

  it('A-1: initial_state naming a prototype member is REJECTED as undeclared', () => {
    const r = parseTransitionTable(UNDECLARED_INITIAL_STATE);
    expect(r.ok).toBe(true);
    const v = validateTransitionTable(r.table!, registry);
    // Expected (correct) behaviour: the error must be reported.
    expect(v.errors.join('\n')).toMatch(/initial_state 'constructor' not declared/);
    expect(v.valid).toBe(false);
  });

  it('A-2: goto naming a prototype member is REJECTED as an undeclared state', () => {
    const r = parseTransitionTable(UNDECLARED_GOTO);
    expect(r.ok).toBe(true);
    const v = validateTransitionTable(r.table!, registry);
    // Expected (correct) behaviour: the error must be reported.
    expect(v.errors.join('\n')).toMatch(/goto 'toString' references undeclared state/);
    expect(v.valid).toBe(false);
  });

  // ── Runtime sites (decision_engine.ts) ──────────────────────────────────
  // A-3/A-4 exercise decide()'s OWN-PROPERTY lookups. decide() is a public
  // export and is called with whatever table the caller holds, so the
  // validator alone is not a sufficient guard: a table can be constructed
  // elsewhere (tests, the Subagent class, a future caller) without ever
  // passing validation.

  it('A-3: decide() does not resolve a prototype member to a bogus State', () => {
    const r = parseTransitionTable(UNDECLARED_INITIAL_STATE);
    const action = decide({
      table: r.table!,
      current_state: 'constructor',
      last_result: null,
      history: [],
    });
    // Expected (correct) behaviour: state_not_found, never a Summon of
    // `martian_type: undefined`.
    expect(action.kind).not.toBe('Summon');
    expect((action as { reason?: string }).reason).toMatch(/state_not_found/);
  });

  it('A-4: a table that DECLARES a state literally named constructor is coherent', () => {
    // A declared state named `constructor` is legal YAML and must still work.
    const declared = `transition_table:
  initial_state: constructor
  states:
    constructor:
      martian_type: alpha
      transitions:
        - when: { all: [{ kind: martian_succeeded }] }
          goto: FINALIZE
`;
    const r = parseTransitionTable(declared);
    expect(r.ok).toBe(true);
    expect(r.table!.states['constructor']).toBeDefined();
    expect(r.table!.states['constructor']!.martian_type).toBe('alpha');
    const v = validateTransitionTable(r.table!, registry);
    expect(v.valid).toBe(true);
  });

  it('A-5: decide() goto lookup does not resolve a prototype member', () => {
    const r = parseTransitionTable(UNDECLARED_GOTO);
    const action = decide({
      table: r.table!,
      current_state: 'step1',
      last_result: OK_RESULT,
      history: [],
    });
    expect(action.kind).not.toBe('Summon');
    expect((action as { reason?: string }).reason).toMatch(/state_not_found/);
  });

  it('A-6: decide() rejects a hand-built table with a prototype-member goto', () => {
    // A table built by hand (not via the parser) whose `states` map holds
    // ONLY step1 — 'constructor' is undeclared but reachable via the
    // prototype chain.
    //
    // NOTE: the condition list MUST be non-empty. `evalGroup` is
    // deliberately fail-closed on an empty condition list
    // (decision_engine.ts:87 — "An empty condition list never fires"), so an
    // empty `conditions: []` would short-circuit to `no_matching_transition`
    // and never reach the goto lookup this probe targets.
    const table: TransitionTable = {
      initial_state: 'step1',
      states: {
        step1: {
          name: 'step1',
          martian_type: 'alpha',
          inputs: {},
          transitions: [
            {
              when: { kind: 'all', conditions: [{ kind: 'martian_succeeded' }] },
              goto: 'constructor',
            },
          ],
        },
      },
    };
    const action = decide({
      table,
      current_state: 'step1',
      last_result: OK_RESULT,
      history: [],
    });
    expect(action.kind).not.toBe('Summon');
    expect((action as { reason?: string }).reason).toMatch(/state_not_found/);
  });

  it('A-7: a declared state reached by goto is still Summon-able (no over-block)', () => {
    // The guard must not break the legitimate case: a DECLARED second state
    // reached by goto must still produce a Summon with the right
    // martian_type.
    const table: TransitionTable = {
      initial_state: 'step1',
      states: {
        step1: {
          name: 'step1',
          martian_type: 'alpha',
          inputs: {},
          transitions: [
            {
              when: { kind: 'all', conditions: [{ kind: 'martian_succeeded' }] },
              goto: 'step2',
            },
          ],
        },
        step2: {
          name: 'step2',
          martian_type: 'beta',
          inputs: {},
          transitions: [],
        },
      },
    };
    const action = decide({
      table,
      current_state: 'step1',
      last_result: OK_RESULT,
      history: [],
    });
    expect(action.kind).toBe('Summon');
    expect((action as { target_state?: string }).target_state).toBe('step2');
    expect((action as { martian_type?: string }).martian_type).toBe('beta');
  });
});

// ── Runtime end-to-end (subagent.ts) ───────────────────────────────────────

describe('PROBE Subagent.runCampaign() prototype-member state', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(path.join(tmpdir(), 'alienclaw-proto-'));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('A-8: a campaign whose initial_state is a prototype member NEVER summons with martian_type undefined', async () => {
    const adapter = new RecordingAdapter();
    const sub = new Subagent(adapter, {
      campaignId: 'CAMP_PROTO', martianType: 'alpha',
      inputs: {}, timeoutMs: 5_000, subagentsBaseDir: baseDir,
    });
    const b = brief(['alpha']);

    // `initial_state: constructor` — the parser's state-name regex
    // /^([A-Za-z_][\w]*)\s*:\s*$/ accepts it, and `constructor` is NOT
    // declared in `states`.
    const yaml = `transition_table:
  initial_state: constructor
  states:
    step1:
      martian_type: alpha
      transitions:
        - when: { all: [{ kind: martian_succeeded }] }
          goto: FINALIZE
`;
    sub.birth(b, yaml);
    const result = await sub.runCampaign(b, {}, yaml);

    // The core assertion: no summon may be issued with an undefined
    // martian_type. On pristine origin/main the campaign resolves
    // `states['constructor']` to the inherited `Object` constructor, whose
    // `martian_type` is undefined, and issues that summon.
    for (const call of adapter.calls) {
      expect(call.martian_type).toBeDefined();
      expect(typeof call.martian_type).toBe('string');
    }
    // And the campaign must terminate as a state-machine failure, not
    // silently complete.
    expect(result.termination_reason).toBe('state_machine_failed');
    expect(result.error).toMatch(/state_not_found/);
  });
});
