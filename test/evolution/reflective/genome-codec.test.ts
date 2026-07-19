/**
 * Tests for parseReflectiveGenome — packet 276.
 * Covers the two branches (error + success) and extractToolSlotNames
 * which are only reachable through parseReflectiveGenome.
 */
import { describe, it, expect } from "vitest";
import {
  parseReflectiveGenome,
  assertValidGenome,
  contentHash,
  InvalidGenomeError,
} from "../../../src/alienclaw/evolution/reflective/genome-codec.js";

describe("parseReflectiveGenome", () => {
  it("returns a Genome with correct id and empty toolSlots for a valid raw", () => {
    const raw = "A".repeat(256);
    const g = parseReflectiveGenome(raw);
    expect(g.raw).toBe(raw);
    expect(g.id).toBe(contentHash(raw));
    expect(g.toolSlots).toEqual([]);
    expect(g.editable["tool_slots"]).toBe("");
  });

  it("throws InvalidGenomeError for wrong-length input", () => {
    expect(() => parseReflectiveGenome("A".repeat(255))).toThrow(InvalidGenomeError);
  });

  it("throws InvalidGenomeError for non-Base62 chars (256 chars but invalid)", () => {
    expect(() => parseReflectiveGenome("!".repeat(256))).toThrow(InvalidGenomeError);
  });

  it("round-trips: parseReflectiveGenome then assertValidGenome passes", () => {
    const raw = "B".repeat(256);
    const g = parseReflectiveGenome(raw);
    expect(() => assertValidGenome(g)).not.toThrow();
  });
});
