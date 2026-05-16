/**
 * Pure variable substitution for Martian input wiring.
 * Mirrors Python src/alienclaw/martians/substitution.py
 *
 * Templates support exactly two namespaces:
 *   ${slot[N].output.field} — output of slot N (top-level field access only)
 *   ${campaign.field}       — top-level campaign input
 *
 * Non-string values are JSON.stringify'd. NOTE: JS JSON.stringify and Python
 * json.dumps produce different formatting for arrays/objects (no space vs.
 * comma-space). String values pass through unchanged on both runtimes, so
 * substitution output is byte-identical for the common string-template case.
 */
import type { InputWiring } from './types.js';

const _PATTERN = /\$\{(slot\[(\d+)\]\.output|campaign)\.([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

function _coerceToStr(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/**
 * Replace all ${...} tokens in template.
 *
 * @throws Error If a slot index is out of range, a field doesn't exist,
 *               or a forward reference is detected.
 */
export function substitute(
  template: string,
  slotOutputs: Record<string, unknown>[],
  campaignInputs: Record<string, unknown>,
): string {
  return template.replace(_PATTERN, (_match, _namespace, slotNumStr: string | undefined, fieldName: string) => {
    if (slotNumStr !== undefined) {
      const slotN = parseInt(slotNumStr, 10);
      if (slotN >= slotOutputs.length) {
        throw new Error(
          `Substitution references slot[${slotN}].output.${fieldName} ` +
          `but only ${slotOutputs.length} prior slot(s) have output.`
        );
      }
      const out = slotOutputs[slotN]!;
      if (!(fieldName in out)) {
        throw new Error(
          `Slot ${slotN} output has no field '${fieldName}'. ` +
          `Available: ${Object.keys(out).sort().join(', ')}`
        );
      }
      return _coerceToStr(out[fieldName]);
    }
    if (!(fieldName in campaignInputs)) {
      throw new Error(
        `Campaign inputs has no field '${fieldName}'. ` +
        `Available: ${Object.keys(campaignInputs).sort().join(', ')}`
      );
    }
    return _coerceToStr(campaignInputs[fieldName]);
  });
}

/**
 * Resolve an InputWiring's field templates into a concrete inputs dict.
 * If wiring is null, returns a copy of campaign_inputs (slot uses campaign).
 */
export function resolveInputs(
  wiring: InputWiring | null,
  slotOutputs: Record<string, unknown>[],
  campaignInputs: Record<string, unknown>,
): Record<string, unknown> {
  if (wiring === null) {
    return { ...campaignInputs };
  }
  const result: Record<string, unknown> = {};
  for (const [field, tmpl] of Object.entries(wiring.fields)) {
    result[field] = substitute(tmpl, slotOutputs, campaignInputs);
  }
  return result;
}
