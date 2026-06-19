/**
 * Proposer tests — §9.1 item 7 (never persists an invalid genome).
 */
import { describe, it, expect } from "vitest";
import { assertValidGenome, InvalidGenomeError, contentHash } from "../../../src/alienclaw/evolution/reflective/genome-codec.js";
import { MockProposer } from "../../../src/alienclaw/evolution/reflective/proposer.js";
import { makeTestGenome } from "./mock-adapter.js";
import type { Genome } from "../../../src/alienclaw/evolution/reflective/types.js";

describe("assertValidGenome", () => {
  it("passes for a valid 256-char Base62 genome", () => {
    const g = makeTestGenome([0.5, 0.5]);
    expect(() => assertValidGenome(g)).not.toThrow();
  });

  it("throws for wrong raw length", () => {
    const g: Genome = { id: "x", raw: "A".repeat(128), toolSlots: [], editable: {} };
    expect(() => assertValidGenome(g)).toThrow(InvalidGenomeError);
  });

  it("throws for invalid Base62 chars", () => {
    const rawWithInvalid = "A".repeat(255) + "!";
    const id = contentHash(rawWithInvalid);
    const g: Genome = { id, raw: rawWithInvalid, toolSlots: [], editable: {} };
    expect(() => assertValidGenome(g)).toThrow(InvalidGenomeError);
  });

  it("throws for wrong id (does not match content hash)", () => {
    const raw = "A".repeat(256);
    const g: Genome = { id: "wrong-id", raw, toolSlots: [], editable: {} };
    expect(() => assertValidGenome(g)).toThrow(InvalidGenomeError);
  });

  it("throws for more than 4 tool slots", () => {
    const raw = "A".repeat(256);
    const id = contentHash(raw);
    const g: Genome = { id, raw, toolSlots: ["a", "b", "c", "d", "e"], editable: {} };
    expect(() => assertValidGenome(g)).toThrow(InvalidGenomeError);
  });

  it("throws for unknown tool when knownTools provided", () => {
    const raw = "A".repeat(256);
    const id = contentHash(raw);
    const g: Genome = { id, raw, toolSlots: ["unknown_tool"], editable: {} };
    expect(() => assertValidGenome(g, new Set(["valid_tool"]))).toThrow(InvalidGenomeError);
  });

  it("passes for empty toolSlots (valid)", () => {
    const raw = "A".repeat(256);
    const id = contentHash(raw);
    const g: Genome = { id, raw, toolSlots: [], editable: {} };
    expect(() => assertValidGenome(g)).not.toThrow();
  });
});

describe("MockProposer — mutation validity", () => {
  it("applyMutation returns a valid genome", async () => {
    const parent = makeTestGenome([0.5, 0.5]);
    const store = new Map([[parent.id, parent]]);
    const proposer = new MockProposer(store);

    const child = await proposer.applyMutation(parent, {
      component: "tool_slots",
      proposedValue: "0.6,0.6",
      diagnosis: "test",
      lesson: "test lesson",
      promptHash: "abc",
    });

    expect(() => assertValidGenome(child)).not.toThrow();
  });

  it("merge returns a valid genome from two frontier candidates", async () => {
    const g1 = makeTestGenome([0.1, 0.1]);
    const g2 = makeTestGenome([0.9, 0.9]);
    const store = new Map([[g1.id, g1], [g2.id, g2]]);
    const proposer = new MockProposer(store);

    const merged = await proposer.merge(
      { genomeId: g1.id, perInstance: new Map(), aggregate: { correctness: 0.5, efficiency: 0.5, costInv: 0.5, latencyInv: 0.5, confidence: 0.5 }, legacyScalar: 0.5 },
      { genomeId: g2.id, perInstance: new Map(), aggregate: { correctness: 0.6, efficiency: 0.6, costInv: 0.6, latencyInv: 0.6, confidence: 0.6 }, legacyScalar: 0.6 },
    );

    expect(() => assertValidGenome(merged)).not.toThrow();
  });
});

describe("contentHash", () => {
  it("produces a consistent 64-char hex string", () => {
    const hash = contentHash("A".repeat(256));
    expect(hash).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
  });

  it("same input → same hash (deterministic)", () => {
    const raw = "B".repeat(256);
    expect(contentHash(raw)).toBe(contentHash(raw));
  });

  it("different inputs → different hashes", () => {
    const a = contentHash("A".repeat(256));
    const b = contentHash("B".repeat(256));
    expect(a).not.toBe(b);
  });
});
