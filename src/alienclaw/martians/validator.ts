/**
 * Validate a parsed MartianSpec.
 * Mirrors Python src/alienclaw/martians/validator.py
 */
import type { MartianSpec } from './types.js';
import { TOOL_ID_TABLE } from './types.js';

export interface MartianValidationResult {
  valid:  boolean;
  errors: string[];
}

const _SUBST_PATTERN = /\$\{(slot\[(\d+)\]\.output|campaign)\.([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

/**
 * Validate a MartianSpec. Returns a result with errors (never throws).
 *
 * @param spec       The parsed MartianSpec.
 * @param toolNames  Set of tool names known to the brain registry. Tool names
 *                   in the spec that are not present here yield an error.
 */
export function validateMartian(
  spec: MartianSpec,
  toolNames: Set<string>,
): MartianValidationResult {
  const errors: string[] = [];

  if (spec.slots.length === 0) {
    return { valid: false, errors: ['MartianSpec must have at least one slot.'] };
  }

  const indices = spec.slots.map(s => s.slotIndex);
  const sortedIndices = [...indices].sort((a, b) => a - b);
  if (new Set(indices).size !== indices.length) {
    errors.push(`Duplicate slot_index values: ${JSON.stringify(sortedIndices)}`);
  }
  const expected = Array.from({ length: indices.length }, (_, k) => k);
  if (JSON.stringify(sortedIndices) !== JSON.stringify(expected)) {
    errors.push(
      `slot_index values must be contiguous starting at 0. Got: ${JSON.stringify(sortedIndices)}`
    );
  }
  for (const s of spec.slots) {
    if (s.slotIndex > 1) {
      errors.push(
        `slot_index=${s.slotIndex} exceeds max 1 (only 2 parameter sections available in Packet 16).`
      );
    }
  }

  for (const s of spec.slots) {
    if (!(s.toolName in TOOL_ID_TABLE)) {
      errors.push(`Tool '${s.toolName}' not in TOOL_ID_TABLE.`);
    }
    if (!toolNames.has(s.toolName)) {
      errors.push(`Tool '${s.toolName}' not in brain registry.`);
    }
  }

  for (const s of spec.slots) {
    if (s.inputsFrom === null) continue;
    for (const [field, template] of Object.entries(s.inputsFrom.fields)) {
      // Re-instantiate the regex so global lastIndex doesn't leak across calls.
      const pat = new RegExp(_SUBST_PATTERN.source, 'g');
      let m: RegExpExecArray | null;
      while ((m = pat.exec(template)) !== null) {
        const slotNumStr = m[2];
        if (slotNumStr !== undefined) {
          const refSlot = parseInt(slotNumStr, 10);
          if (refSlot >= s.slotIndex) {
            errors.push(
              `Slot ${s.slotIndex} field '${field}': ` +
              `forward reference to slot[${refSlot}] (must be < ${s.slotIndex}).`
            );
          }
        }
      }
      const remaining = template.replace(new RegExp(_SUBST_PATTERN.source, 'g'), '');
      if (remaining.includes('${')) {
        errors.push(
          `Slot ${s.slotIndex} field '${field}': malformed substitution token in '${template}'`
        );
      }
    }
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, errors: [] };
}
