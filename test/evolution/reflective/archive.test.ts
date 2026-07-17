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

describe("ParetoArchive — size / has / snapshot", () => {
  it("size() returns candidate count", () => {
    const a = new ParetoArchive();
    expect(a.size()).toBe(0);
    a.add(makeScore("x", makeVec()));
    expect(a.size()).toBe(1);
  });

  it("has() returns true for added candidates only", () => {
    const a = new ParetoArchive();
    a.add(makeScore("known", makeVec()));
    expect(a.has("known")).toBe(true);
    expect(a.has("unknown")).toBe(false);
  });

  it("snapshot() returns all candidates", () => {
    const a = new ParetoArchive();
    const s = makeScore("s1", makeVec());
    a.add(s);
    const snap = a.snapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0]!.genomeId).toBe("s1");
  });
});

describe("ParetoArchive.pickDisjointFrontierPair", () => {
  it("returns null when fewer than 2 frontier candidates", () => {
    const a = new ParetoArchive();
    // 0 candidates
    expect(a.pickDisjointFrontierPair(() => 0.5, WEIGHTS)).toBeNull();
    // 1 candidate (dominated by nothing, but alone)
    a.add(makeScore("solo", makeVec()));
    expect(a.pickDisjointFrontierPair(() => 0.5, WEIGHTS)).toBeNull();
  });

  it("returns a pair when 2 Pareto-incomparable candidates exist", () => {
    const a = new ParetoArchive();
    const c1 = makeScore("c1", makeVec({ correctness: 0.9, costInv: 0.1 }));
    const c2 = makeScore("c2", makeVec({ correctness: 0.1, costInv: 0.9 }));
    a.add(c1);
    a.add(c2);
    const pair = a.pickDisjointFrontierPair(() => 0.5, WEIGHTS);
    expect(pair).not.toBeNull();
    expect(pair!.length).toBe(2);
    const ids = pair!.map(p => p.genomeId);
    expect(ids).toContain("c1");
    expect(ids).toContain("c2");
  });

  it("selects the pair with strictly greater disjoint win-task count", () => {
    // c1 wins t1+t2, c2 wins t3+t4, c3 wins nothing.
    // Pairs: (c1,c2)=disjoint 4, (c1,c3)=2, (c2,c3)=2 → must pick c1+c2.
    const highVec = makeVec({ correctness: 0.9, efficiency: 0.8, costInv: 0.8, latencyInv: 0.8, confidence: 0.9 });
    const lowVec  = makeVec({ correctness: 0.1, efficiency: 0.1, costInv: 0.1, latencyInv: 0.1, confidence: 0.1 });

    const c1 = makeScore("c1", makeVec({ correctness: 0.9, costInv: 0.1, latencyInv: 0.1 }), [
      ["t1", highVec], ["t2", highVec], ["t3", lowVec], ["t4", lowVec],
    ]);
    const c2 = makeScore("c2", makeVec({ correctness: 0.1, costInv: 0.9, latencyInv: 0.1 }), [
      ["t1", lowVec], ["t2", lowVec], ["t3", highVec], ["t4", highVec],
    ]);
    const c3 = makeScore("c3", makeVec({ correctness: 0.1, costInv: 0.1, latencyInv: 0.9 }), [
      ["t1", lowVec], ["t2", lowVec], ["t3", lowVec], ["t4", lowVec],
    ]);
    const a = new ParetoArchive();
    [c1, c2, c3].forEach(c => a.add(c));

    const pair = a.pickDisjointFrontierPair(() => 0.5, WEIGHTS);
    expect(pair).not.toBeNull();
    const ids = pair!.map(p => p.genomeId);
    expect(ids).toContain("c1");
    expect(ids).toContain("c2");
    expect(ids).not.toContain("c3");
  });

  it("exercises L99 continue when a frontier member has no data for a task", () => {
    // c1 only covers t1; c2 covers t1+t2. When computing win tasks for any
    // candidate, f=c1 on taskId=t2 → perInstance.get("t2") is undefined → continue.
    const highVec = makeVec({ correctness: 0.9, efficiency: 0.8, costInv: 0.8, latencyInv: 0.8, confidence: 0.9 });
    const lowVec  = makeVec({ correctness: 0.1, efficiency: 0.1, costInv: 0.1, latencyInv: 0.1, confidence: 0.1 });

    const c1 = makeScore("c1", makeVec({ correctness: 0.9, costInv: 0.1 }), [
      ["t1", highVec],
    ]);
    const c2 = makeScore("c2", makeVec({ correctness: 0.1, costInv: 0.9 }), [
      ["t1", lowVec], ["t2", highVec],
    ]);
    const a = new ParetoArchive();
    a.add(c1);
    a.add(c2);

    const pair = a.pickDisjointFrontierPair(() => 0.5, WEIGHTS);
    expect(pair).not.toBeNull();
    const ids = pair!.map(p => p.genomeId);
    expect(ids).toContain("c1");
    expect(ids).toContain("c2");
  });

  it("returns null when only 1 candidate survives to frontier (dominated set)", () => {
    const a = new ParetoArchive();
    const c1 = makeScore("c1", makeVec({ correctness: 0.9, efficiency: 0.9, costInv: 0.9, latencyInv: 0.9, confidence: 0.9 }));
    const c2 = makeScore("c2", makeVec({ correctness: 0.1, efficiency: 0.1, costInv: 0.1, latencyInv: 0.1, confidence: 0.1 }));
    a.add(c1);
    a.add(c2);
    // frontier() returns only c1; pickDisjointFrontierPair → null (< 2 on frontier)
    expect(a.pickDisjointFrontierPair(() => 0.5, WEIGHTS)).toBeNull();
  });
});
