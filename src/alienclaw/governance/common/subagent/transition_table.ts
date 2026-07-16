/**
 * transition_table.ts — Transition table parser, validator, and input evaluator.
 *
 * The YAML structure parsed here is the constrained shape produced by
 * CreatorBot's buildTransitionTableYaml() helper. It is NOT a general
 * YAML parser.
 */
import type {
  TransitionTable,
  State,
  Transition,
  Condition,
  ConditionGroup,
} from './decision_engine.js';
import { substitute } from '../../../martians/substitution.js';
import { errorMessage } from '../../../utils.js';

export interface ParseResult {
  ok: boolean;
  table?: TransitionTable;
  error?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Parse the transition_table block from CAMPAIGN.md content. */
export function parseTransitionTable(campaignMd: string): ParseResult {
  if (!campaignMd.includes('transition_table:')) {
    return { ok: false, error: 'No transition_table section found in CAMPAIGN.md' };
  }

  try {
    const table = _parseTableYaml(campaignMd);
    if (!table) {
      return { ok: false, error: 'Could not parse transition_table from CAMPAIGN.md' };
    }
    return { ok: true, table };
  } catch (e) {
    /* v8 ignore next — _parseTableYaml is a pure string parser that cannot throw; catch is defensive dead code */
    return { ok: false, error: `Parse error: ${errorMessage(e)}` };
  }
}

/** Validate a parsed TransitionTable against MartianRegistry. */
export function validateTransitionTable(
  table: TransitionTable,
  registry: { has(martianType: string): boolean },
): ValidationResult {
  const errors: string[] = [];

  if (!table.states[table.initial_state]) {
    errors.push(`initial_state '${table.initial_state}' not declared in states`);
  }

  for (const [name, state] of Object.entries(table.states)) {
    if (!registry.has(state.martian_type)) {
      errors.push(`State '${name}': martian_type '${state.martian_type}' not in MartianRegistry`);
    }
    if (state.transitions.length === 0) {
      errors.push(`State '${name}': must have at least one transition`);
    }
    for (const t of state.transitions) {
      const goto = t.goto;
      if (goto !== 'FINALIZE' && !goto.startsWith('FAIL:') && !table.states[goto]) {
        errors.push(`State '${name}': goto '${goto}' references undeclared state`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Evaluate a state's inputs template, substituting `${campaign.X}` and `${last_result.output.X}`. */
export function evaluateInputs(
  stateInputs: Record<string, unknown>,
  campaignInputs: Record<string, unknown>,
  lastResult: { output: Record<string, unknown> } | null,
): Record<string, unknown> {
  const slotOutputs = lastResult ? [lastResult.output] : [];
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(stateInputs)) {
    if (typeof val === 'string' && val.includes('${')) {
      const rewritten = val.replace(/\$\{last_result\.output\./g, '${slot[0].output.');
      try {
        result[key] = substitute(rewritten, slotOutputs, campaignInputs);
      } catch {
        result[key] = val;
      }
    } else {
      result[key] = val;
    }
  }
  return result;
}

// ── Minimal YAML parser ────────────────────────────────────────────────────

function indentOf(line: string): number {
  let count = 0;
  for (const ch of line) {
    if (ch === ' ') count++;
    else break;
  }
  return count;
}

function unquote(s: string): string {
  s = s.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseConditionsFromArray(arrText: string): Condition[] {
  // arrText is the contents inside [ ... ] — a series of {kind: X, ...} entries
  const conds: Condition[] = [];
  // Match each {...} group (no nesting expected)
  const re = /\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(arrText)) !== null) {
    const inner = m[1]!;
    const c = parseConditionInner(inner);
    if (c) conds.push(c);
  }
  return conds;
}

function parseConditionInner(inner: string): Condition | null {
  // Inner has key: value pairs separated by commas
  // Examples: "kind: martian_succeeded"
  //           "kind: fitness_gt, n: 0.5"
  //           "kind: output_field_present, field: result"
  const fields: Record<string, string> = {};
  const parts = inner.split(',');
  for (const p of parts) {
    const idx = p.indexOf(':');
    if (idx === -1) continue;
    const key = p.slice(0, idx).trim();
    const val = unquote(p.slice(idx + 1).trim());
    fields[key] = val;
  }
  const kind = fields['kind'];
  if (!kind) return null;
  const n = fields['n'] !== undefined ? parseFloat(fields['n']!) : 0;
  const field = fields['field'] ?? '';
  const value: unknown = fields['value'] ?? '';
  switch (kind) {
    case 'martian_succeeded':       return { kind };
    case 'martian_correctness_gt':  return { kind, n };
    case 'martian_correctness_lt':  return { kind, n };
    case 'fitness_gt':              return { kind, n };
    case 'fitness_lt':              return { kind, n };
    case 'error_present':           return { kind };
    case 'error_absent':            return { kind };
    case 'tool_calls_gt':           return { kind, n };
    case 'tool_calls_lt':           return { kind, n };
    case 'output_field_present':   return { kind: 'output_field_present', field };
    case 'output_field_eq':        return { kind: 'output_field_eq', field, value };
    default: return null;
  }
}

function parseConditionGroup(whenText: string): ConditionGroup {
  // whenText looks like: "{ all: [{ kind: martian_succeeded }] }" possibly with extra whitespace
  const trimmed = whenText.trim().replace(/^\{|\}$/g, '').trim();
  // groupKind: all|any
  const groupMatch = trimmed.match(/^(all|any)\s*:\s*\[([\s\S]*)\]\s*$/);
  if (!groupMatch) {
    return { kind: 'all', conditions: [] };
  }
  const groupKind = groupMatch[1] as 'all' | 'any';
  const arrText = groupMatch[2]!;
  const conditions = parseConditionsFromArray(arrText);
  return { kind: groupKind, conditions };
}

function _parseTableYaml(text: string): TransitionTable | null {
  const ttStart = text.indexOf('transition_table:');
  if (ttStart === -1) return null;

  // Determine the indent of the transition_table: line, so children must be deeper
  const sliceFromTT = text.slice(ttStart);
  const lines = sliceFromTT.split('\n');
  const baseIndent = indentOf(lines[0]!); // the "transition_table:" line indent

  let initialState = '';
  const states: Record<string, State> = {};

  let i = 1; // skip transition_table: line
  // Stop if we leave the transition_table block (line indent <= baseIndent and non-empty)
  // OR encounter ``` (code fence end) OR a heading line.

  function isOutsideBlock(line: string): boolean {
    if (!line.length) return false;
    const trim = line.trim();
    if (trim === '' || trim.startsWith('#')) return false;
    if (trim.startsWith('```')) return true;
    return indentOf(line) <= baseIndent;
  }

  // Find initial_state and states: keys at indent baseIndent+2
  // (anything beyond that is nested within them)
  while (i < lines.length) {
    const line = lines[i]!;
    if (isOutsideBlock(line)) break;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) { i++; continue; }
    if (trimmed.startsWith('initial_state:')) {
      initialState = unquote(trimmed.slice('initial_state:'.length));
      i++;
      continue;
    }
    if (trimmed === 'states:') {
      i++;
      // Parse each state block
      const statesIndent = baseIndent + 2; // expected; in practice we just track where state names live
      // Determine the indent of the first state name (more flexible than fixed):
      let stateNameIndent: number | null = null;
      while (i < lines.length) {
        const sline = lines[i]!;
        if (isOutsideBlock(sline)) break;
        const strim = sline.trim();
        if (!strim || strim.startsWith('#')) { i++; continue; }
        const lineIndent = indentOf(sline);
        if (stateNameIndent === null) {
          stateNameIndent = lineIndent;
        }
        // If we hit a line at <= states: indent (which we represented as baseIndent+something), bail
        if (lineIndent < stateNameIndent) break;
        if (lineIndent !== stateNameIndent) { i++; continue; }
        // expecting "<name>:"
        const stateMatch = strim.match(/^([A-Za-z_][\w]*)\s*:\s*$/);
        if (!stateMatch) { i++; continue; }
        const stateName = stateMatch[1]!;
        i++;

        let martianType = '';
        const inputs: Record<string, unknown> = {};
        const transitions: Transition[] = [];

        // Parse this state's body — lines at indent > stateNameIndent
        while (i < lines.length) {
          const bline = lines[i]!;
          if (isOutsideBlock(bline)) break;
          const btrim = bline.trim();
          if (!btrim || btrim.startsWith('#')) { i++; continue; }
          const bIndent = indentOf(bline);
          if (bIndent <= stateNameIndent) break;

          if (btrim.startsWith('martian_type:')) {
            martianType = unquote(btrim.slice('martian_type:'.length));
            i++;
          } else if (btrim === 'inputs:') {
            i++;
            // Read indented k: v pairs
            while (i < lines.length) {
              const iline = lines[i]!;
              if (isOutsideBlock(iline)) break;
              const itrim = iline.trim();
              if (!itrim || itrim.startsWith('#')) { i++; continue; }
              const iIndent = indentOf(iline);
              if (iIndent <= bIndent) break;
              const colonIdx = itrim.indexOf(':');
              if (colonIdx > 0) {
                const k = itrim.slice(0, colonIdx).trim();
                const v = unquote(itrim.slice(colonIdx + 1).trim());
                inputs[k] = v;
              }
              i++;
            }
          } else if (btrim === 'transitions:') {
            i++;
            // Read transition entries: each starts with "- when:"
            while (i < lines.length) {
              const tline = lines[i]!;
              if (isOutsideBlock(tline)) break;
              const ttrim = tline.trim();
              if (!ttrim || ttrim.startsWith('#')) { i++; continue; }
              const tIndent = indentOf(tline);
              if (tIndent <= bIndent) break;

              if (ttrim.startsWith('- when:')) {
                let whenStr = ttrim.slice('- when:'.length).trim();
                let gotoStr = '';
                i++;
                // Subsequent lines belong to this transition until we see another "- when:"
                // or dedent to <= the "- when:" line indent
                while (i < lines.length) {
                  const cline = lines[i]!;
                  if (isOutsideBlock(cline)) break;
                  const ctrim = cline.trim();
                  if (!ctrim || ctrim.startsWith('#')) { i++; continue; }
                  const cIndent = indentOf(cline);
                  if (ctrim.startsWith('- when:')) break;
                  if (cIndent <= tIndent) break;
                  if (ctrim.startsWith('goto:')) {
                    gotoStr = unquote(ctrim.slice('goto:'.length));
                  } else {
                    whenStr += ' ' + ctrim;
                  }
                  i++;
                }
                if (gotoStr) {
                  const when = parseConditionGroup(whenStr);
                  transitions.push({ when, goto: gotoStr });
                }
              } else {
                i++;
              }
            }
          } else {
            i++;
          }
        }

        if (martianType) {
          states[stateName] = {
            name: stateName,
            martian_type: martianType,
            inputs,
            transitions,
          };
        }
      }
      continue;
    }
    i++;
  }

  if (!initialState || Object.keys(states).length === 0) return null;
  return { initial_state: initialState, states };
}
