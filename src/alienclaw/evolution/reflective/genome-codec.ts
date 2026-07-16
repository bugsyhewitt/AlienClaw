/**
 * Genome codec helpers for the reflective evolution engine.
 *
 * Wraps the existing genome-codec.ts to produce Genome objects
 * compatible with the reflective engine's types.
 *
 * Also provides validation that applyMutation/merge MUST pass.
 */
import { createHash } from "node:crypto";
import type { Genome } from "./types.js";

const BASE62_RE = /^[A-Za-z0-9]{256}$/;

/** Compute the content hash for a genome raw string. */
export function contentHash(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/** Parse a raw 256-char Base62 string into a Genome. */
export function parseReflectiveGenome(raw: string): Genome {
  if (!BASE62_RE.test(raw)) {
    throw new InvalidGenomeError(`raw must be 256 Base62 chars, got length=${raw.length}`);
  }
  // Section 0 (chars 0-63): identity including tool family
  // Sections 1-2 (chars 64-191): execution + behavior
  // Section 3 (chars 192-255): checksum
  // Tool slots: decode from section 0 using existing genome-codec logic
  // For the reflective engine, we extract what we know (tool slot count)
  // Full decode defers to src/alienclaw/registry/genome-codec.ts at runtime.
  const id = contentHash(raw);
  const toolSlots = extractToolSlotNames(raw);
  const editable: Record<string, string> = {
    tool_slots: toolSlots.join(","),
  };

  return { id, raw, toolSlots, editable };
}

/** Validate that a genome meets all invariants. Throws InvalidGenomeError if not. */
export function assertValidGenome(g: Genome, knownTools?: Set<string>): void {
  if (g.raw.length !== 256) throw new InvalidGenomeError("raw must be 256 chars");
  if (!BASE62_RE.test(g.raw)) throw new InvalidGenomeError("raw must be Base62");
  if (g.toolSlots.length > 4) throw new InvalidGenomeError("max 4 tool slots");
  if (knownTools) {
    for (const t of g.toolSlots) {
      if (!knownTools.has(t)) throw new InvalidGenomeError(`unknown tool: ${t}`);
    }
  }
  const expected = contentHash(g.raw);
  if (g.id !== expected) throw new InvalidGenomeError("id must equal contentHash(raw)");
}

export class InvalidGenomeError extends Error {
  constructor(msg: string) { super(msg); this.name = "InvalidGenomeError"; }
}

/**
 * Extract tool slot names from the genome raw string.
 *
 * The genome uses a 4-section × 64-char layout. Tool selection is encoded in
 * Section 0 (chars 0-63). We delegate to the existing codec for the actual
 * martianbrain lookup; here we extract the slot symbols for the reflective record.
 *
 * For the purposes of the reflective engine, tool_slots is the editable component
 * and holds comma-separated martianbrain names. This is populated by the runtime
 * adapter (MockGenomeAdapter / RealGenomeAdapter) which has access to the registry.
 *
 * At this layer we return an empty list; the adapter fills it in.
 */
function extractToolSlotNames(_raw: string): string[] {
  // Adapter is responsible for resolving martianbrain names from the genome.
  // The reflective engine treats toolSlots as opaque strings; only the adapter
  // and proposer need to decode them.
  return [];
}
