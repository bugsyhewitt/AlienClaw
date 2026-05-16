/**
 * decision_engine.ts — Pure Subagent decision function.
 *
 * decide(input) returns the next Action based on current state,
 * the last Martian summon result, the transition table, and history.
 *
 * PURE: same input → same output, no side effects.
 * When LLM-backed Subagents arrive, they implement the same decide() interface.
 */

export type Condition =
  | { kind: 'martian_succeeded' }
  | { kind: 'martian_correctness_gt'; n: number }
  | { kind: 'martian_correctness_lt'; n: number }
  | { kind: 'fitness_gt'; n: number }
  | { kind: 'fitness_lt'; n: number }
  | { kind: 'error_present' }
  | { kind: 'error_absent' }
  | { kind: 'tool_calls_gt'; n: number }
  | { kind: 'tool_calls_lt'; n: number }
  | { kind: 'output_field_present'; field: string }
  | { kind: 'output_field_eq'; field: string; value: unknown };

export type ConditionGroup =
  | { kind: 'all'; conditions: Condition[] }
  | { kind: 'any'; conditions: Condition[] };

export interface Transition {
  when: ConditionGroup;
  goto: string; // state name, 'FINALIZE', or 'FAIL:<reason>'
}

export interface State {
  name: string;
  martian_type: string;
  inputs: Record<string, unknown>;
  transitions: Transition[];
}

export interface TransitionTable {
  initial_state: string;
  states: Record<string, State>;
}

export interface SummonResult {
  martian_type: string;
  output: Record<string, unknown>;
  correctness: number;
  fitness: number;
  tool_calls: number;
  error: string | null;
}

export type Action =
  | { kind: 'Summon'; target_state: string; martian_type: string; inputs: Record<string, unknown> }
  | { kind: 'Finalize' }
  | { kind: 'Fail'; reason: string }
  | { kind: 'Retry' };

export interface DecisionInput {
  current_state: string;
  last_result: SummonResult | null;
  table: TransitionTable;
  history: ReadonlyArray<{ state: string; result: SummonResult }>;
}

function evalCondition(cond: Condition, result: SummonResult): boolean {
  switch (cond.kind) {
    case 'martian_succeeded':         return result.error === null && result.fitness > 0;
    case 'martian_correctness_gt':    return result.correctness > cond.n;
    case 'martian_correctness_lt':    return result.correctness < cond.n;
    case 'fitness_gt':                return result.fitness > cond.n;
    case 'fitness_lt':                return result.fitness < cond.n;
    case 'error_present':             return result.error !== null;
    case 'error_absent':              return result.error === null;
    case 'tool_calls_gt':             return result.tool_calls > cond.n;
    case 'tool_calls_lt':             return result.tool_calls < cond.n;
    case 'output_field_present':      return cond.field in result.output;
    case 'output_field_eq':           return result.output[cond.field] === cond.value;
  }
}

function evalGroup(group: ConditionGroup, result: SummonResult): boolean {
  if (group.kind === 'all') {
    return group.conditions.every(c => evalCondition(c, result));
  }
  return group.conditions.some(c => evalCondition(c, result));
}

export function decide(input: DecisionInput): Action {
  const state = input.table.states[input.current_state];
  if (!state) {
    return { kind: 'Fail', reason: `state_not_found:${input.current_state}` };
  }

  // Initial call (campaign start): issue first Summon for this state
  if (input.last_result === null) {
    return {
      kind: 'Summon',
      target_state: input.current_state,
      martian_type: state.martian_type,
      inputs: state.inputs,
    };
  }

  // Evaluate transitions in declared order; first match wins
  for (const transition of state.transitions) {
    if (evalGroup(transition.when, input.last_result)) {
      const goto = transition.goto;
      if (goto === 'FINALIZE') return { kind: 'Finalize' };
      if (goto.startsWith('FAIL:')) return { kind: 'Fail', reason: goto.slice(5) };
      if (goto === input.current_state) return { kind: 'Retry' };
      const nextState = input.table.states[goto];
      if (!nextState) {
        return { kind: 'Fail', reason: `state_not_found:${goto}` };
      }
      return {
        kind: 'Summon',
        target_state: goto,
        martian_type: nextState.martian_type,
        inputs: nextState.inputs,
      };
    }
  }

  // No transition matched
  return { kind: 'Fail', reason: 'no_matching_transition' };
}
