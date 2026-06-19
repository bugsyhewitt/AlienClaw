/**
 * ParetoArchive tests — §9.1 items 4 (property tests for Pareto correctness).
 */
import { describe, it, expect } from "vitest";
import { ParetoArchive } from "../../../src/alienclaw/evolution/reflective/archive.js";
import { dominates } from "../../../src/alienclaw/evolution/reflective/objectives.js";
import type { ObjectiveVector, CandidateScore } from "../../../src/alienclaw/evolution/reflective/types.js";
import { DEFAULT_CONFIG } from "../../../src/alienclaw/evolution/reflective/config.js";

function makeVec(overrides: Partial<ObjectiveVector> = {}): ObjectiveVector {
  return {
    correctness: 0.5,
    efficiency: 0.5,
    costInv: 0.5,
    latencyInv: 0.5,
    confidence: 0.5,
    ...overrides,
  };
}

function makeScore(id: string, agg: ObjectiveVector, instances: [string, ObjectiveVector][] = []): CandidateScore {
  const perInstance = new Map(instances);
  return { genomeId: id, perInstance, aggregate: agg, legacyScalar: agg.correctness };
}

const WEIGHTS = DEFAULT_CONFIG.winCountWeights;

describe("ParetoArchive — Pareto dominance", () => {
  it("dominates: irreflexive — a does not dominate itself", () => {
    const v = makeVec({ correctness: 0.8 });
    expect(dominates(v, v)).toBe(false);
  });

  it("dominates: antisymmetric — if a > b then b does not > a", () => {
    const a = makeVec({ correctness: 0.9, efficiency: 0.6 });
    const b = makeVec({ correctness: 0.7, efficiency: 0.5 });
    expect(dominates(a, b)).toBe(true);
    expect(dominates(b, a)).toBe(false);
  });

  it("dominates: false when any objective is worse", () => {
    const a = makeVec({ correctness: 0.9, efficiency: 0.3 });
    const b = makeVec({ correctness: 0.7, efficiency: 0.8 });
    expect(dominates(a, b)).toBe(false);
    expect(dominates(b, a)).toBe(false);
  });

  it("dominates: requires strict improvement on at least one", () => {
    const a = makeVec();
    const b = makeVec(); // identical
    expect(dominates(a, b)).toBe(false);
  });

  it("frontier: no dominated member is on the frontier", () => {
    const archive = new ParetoArchive();
    const strong = makeScore("strong", makeVec({ correctness: 0.9, efficiency: 0.9, costInv: 0.9, latencyInv: 0.9, confidence: 0.9 }));
    const weak   = makeScore("weak",   makeVec({ correctness: 0.3, efficiency: 0.3, costInv: 0.3, latencyInv: 0.3, confidence: 0.3 }));
    archive.add(strong);
    archive.add(weak);
    const front = archive.frontier();
    expect(front.map(c => c.genomeId)).toContain("strong");
    expect(front.map(c => c.genomeId)).not.toContain("weak");
  });

  it("frontier: no non-dominated member is excluded", () => {
    const archive = new ParetoArchive();
    // Two Pareto-incomparable candidates: A better on correctness, B better on cost
    const a = makeScore("a", makeVec({ correctness: 0.9, costInv: 0.2 }));
    const b = makeScore("b", makeVec({ correctness: 0.4, costInv: 0.9 }));
    archive.add(a);
    archive.add(b);
    const front = archive.frontier();
    expect(front.map(c => c.genomeId)).toContain("a");
    expect(front.map(c => c.genomeId)).toContain("b");
  });

  it("frontier: empty archive returns empty frontier", () => {
    expect(new ParetoArchive().frontier()).toHaveLength(0);
  });

  it("sampleForMutation: favors the multi-instance winner", () => {
    const archive = new ParetoArchive();
    // c1 wins on t-000 and t-001; c2 wins on t-002 only
    const highVec = makeVec({ correctness: 0.9, efficiency: 0.8, costInv: 0.8, latencyInv: 0.8, confidence: 0.9 });
    const lowVec  = makeVec({ correctness: 0.4, efficiency: 0.4, costInv: 0.4, latencyInv: 0.4, confidence: 0.4 });

    const c1 = makeScore("c1", makeVec({ correctness: 0.8, costInv: 0.3 }), [
      ["t-000", highVec],
      ["t-001", highVec],
      ["t-002", lowVec],
    ]);
    const c2 = makeScore("c2", makeVec({ correctness: 0.2, costInv: 0.9 }), [
      ["t-000", lowVec],
      ["t-001", lowVec],
      ["t-002", highVec],
    ]);
    archive.add(c1);
    archive.add(c2);

    // With a fixed seed-based RNG, sample many times — c1 should win more often
    let c1Wins = 0;
    let c2Wins = 0;
    let counter = 0;
    const deterministicRng = () => {
      counter++;
      // LCG: produces deterministic sequence
      return ((counter * 1664525 + 1013904223) % 0x100000000) / 0x100000000;
    };
    for (let i = 0; i < 100; i++) {
      const picked = archive.sampleForMutation(deterministicRng, WEIGHTS);
      if (picked?.genomeId === "c1") c1Wins++;
      else c2Wins++;
    }
    expect(c1Wins).toBeGreaterThan(c2Wins);
  });

  it("ParetoArchive.dominates: static method delegates correctly", () => {
    const a = makeVec({ correctness: 0.9 });
    const b = makeVec({ correctness: 0.5 });
    expect(ParetoArchive.dominates(a, b)).toBe(true);
    expect(ParetoArchive.dominates(b, a)).toBe(false);
  });
});
