/**
 * Martian composition types for Packet 16.
 * Mirrors Python src/alienclaw/martians/types.py
 *
 * Field naming convention: TypeScript uses camelCase. Python uses snake_case.
 * Python `slot_index` ↔ TS `slotIndex`; `tool_name` ↔ `toolName`;
 * `inputs_from` ↔ `inputsFrom`; `martian_type` ↔ `martianType`.
 */

// ARCHITECTURE §Packet 16 — Tool ID table. Assigned alphabetically.
// Hardcoded; IDs never change once assigned; new tools get next unused ID.
export const TOOL_ID_TABLE: Readonly<Record<string, number>> = Object.freeze({
  compute:      1,
  extract_json: 2,
  file_read:    3,
  file_write:   4,
  http_get:     5,
  search_text:  6,
  url_fetch:    7,
  web_search:   8,
});

export const EMPTY_SLOT_ID = 0;

/** Maps input field names to substitution templates. */
export interface InputWiring {
  fields: Record<string, string>;
}

/** One tool slot in a Martian composition. */
export interface SlotDeclaration {
  slotIndex:  number;            // 0 or 1 (max 2 slots in Packet 16)
  toolName:   string;            // must be in TOOL_ID_TABLE
  inputsFrom: InputWiring | null; // null = use campaign inputs directly
}

/** A Martian type — name + ordered tool composition. */
export interface MartianSpec {
  martianType: string;
  slots:       SlotDeclaration[]; // 1-2 entries
  description: string;
  useCases:    string[];
}
