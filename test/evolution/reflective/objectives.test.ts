/**
 * Objective vector and helpers tests — §9.1 items 3, 6.
 */
import { describe, it, expect } from "vitest";
import {
  computeLegacyScalar,
  normalizeObjectives,
  meanObjective,
  sampleMinibatch,
  improvedOnMinibatch,
  scalarizeForWinCount,
  weightedPick,
  chooseComponentToRevise,
} from "../../../src/alienclaw/evolution/reflective/objectives.js";
import type { ExecutionTrace, CandidateScore, ObjectiveVector } from "../../../src/alienclaw/evolution/reflective/types.js";
import { DEFAULT_CONFIG } from "../../../src/alienclaw/evolution/reflective/config.js";

const WEIGHTS = DEFAULT_CONFIG.winCountWeights;

function makeTrace(correctness: number, toolCalls = 1, dollars = 0.001, wallMs = 200): ExecutionTrace {
  return {
    runId: "r-0",
    genomeId: "g-0",
    taskId: "t-0",
    seed: 1,
    toolCalls: Array.from({ length: toolCalls }, (_, i) => ({
      index: i, tool: "t", args: {}, result: {}, ok: true, ms: wallMs / toolCalls,
    })),
    finalOutput: {},
    errors: [],
    correctness: { score: correctness, source: "exact", evidence: "test" },
    cost: { inputTokens: 100, outputTokens: 50, dollars, toolCalls, wallMs },
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
  };
}

function makeScore(agg: ObjectiveVector): CandidateScore {
  return { genomeId: "g", perInstance: new Map(), aggregate: agg, legacyScalar: agg.correctness };
}

const ZERO_VEC: ObjectiveVector = { correctness: 0, efficiency: 0, costInv: 0, latencyInv: 0, confidence: 0 };
const ONE_VEC: ObjectiveVector = { correctness: 1, efficiency: 1, costInv: 1, latencyInv: 1, confidence: 1 };

describe("computeLegacyScalar", () => {
  it("returns 0 for empty traces", () => {
    expect(computeLegacyScalar([])).toBe(0);
  });

  it("returns correctness for 1 tool call (no excess)", () => {
    // slot_count=1, tool_calls=1, excess=0, efficiency=1.0
    const result = computeLegacyScalar([makeTrace(0.8, 1)]);
    expect(result).toBeCloseTo(0.8);
  });

  it("parity test: matches Python fitness formula exactly", () => {
    // Python: evaluate(FitnessInputs(correctness=0.8, tool_calls=2))
    // efficiency = 1/(1+0.1*(2-1)) = 1/1.1
    // fitness = 0.8 / 1.1
    const result = computeLegacyScalar([makeTrace(0.8, 2)]);
    expect(result).toBeCloseTo(0.8 / 1.1, 6);
  });

  it("parity test: no excess for 0 tool calls (≡ slot_count=1)", () => {
    // Python: tool_calls=0, slot_count=1, excess=max(0,0-1)=0, efficiency=1.0
    const result = computeLegacyScalar([makeTrace(1.0, 0)]);
    expect(result).toBeCloseTo(1.0);
  });
});

describe("normalizeObjectives", () => {
  it("returns empty for empty input", () => {
    expect(normalizeObjectives([], 1e-6)).toHaveLength(0);
  });

  it("maps all objectives to [0, 1] range", () => {
    const raws = [
      { correctness: 0.2, efficiency: 0.3, costInvRaw: 100, latencyInvRaw: 0.01, confidence: 0.4 },
      { correctness: 0.8, efficiency: 0.9, costInvRaw: 500, latencyInvRaw: 0.05, confidence: 0.9 },
    ];
    const normed = normalizeObjectives(raws, 1e-6);
    for (const v of normed) {
      for (const val of Object.values(v)) {
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThanOrEqual(1);
      }
    }
  });

  it("constant population gets neutral 0.5", () => {
    const raws = [
      { correctness: 0.5, efficiency: 0.5, costInvRaw: 1.0, latencyInvRaw: 1.0, confidence: 0.5 },
      { correctness: 0.5, efficiency: 0.5, costInvRaw: 1.0, latencyInvRaw: 1.0, confidence: 0.5 },
    ];
    const normed = normalizeObjectives(raws, 1e-6);
    for (const v of normed) {
      expect(v.correctness).toBeCloseTo(0.5);
    }
  });
});

describe("sampleMinibatch", () => {
  it("returns n items without replacement", () => {
    const items = [1, 2, 3, 4, 5];
    let seed = 0;
    const rng = () => ((seed++ * 1664525 + 1013904223) % 0x100000000) / 0x100000000;
    const batch = sampleMinibatch(items, 3, rng);
    expect(batch).toHaveLength(3);
    // No duplicates
    expect(new Set(batch).size).toBe(3);
  });

  it("clamps to set size when n > set.length", () => {
    const items = [1, 2];
    let n = 0;
    const rng = () => (n++ / 100);
    const batch = sampleMinibatch(items, 10, rng);
    expect(batch).toHaveLength(2);
  });
});

describe("improvedOnMinibatch", () => {
  it("returns true if child Pareto-dominates parent", () => {
    const parent = makeScore({ correctness: 0.5, efficiency: 0.5, costInv: 0.5, latencyInv: 0.5, confidence: 0.5 });
    const child  = makeScore({ correctness: 0.8, efficiency: 0.6, costInv: 0.6, latencyInv: 0.6, confidence: 0.6 });
    expect(improvedOnMinibatch(child, parent)).toBe(true);
  });

  it("returns true if child improves correctness without regressing others", () => {
    const parent = makeScore({ correctness: 0.5, efficiency: 0.5, costInv: 0.5, latencyInv: 0.5, confidence: 0.5 });
    const child  = makeScore({ correctness: 0.6, efficiency: 0.5, costInv: 0.5, latencyInv: 0.5, confidence: 0.5 });
    expect(improvedOnMinibatch(child, parent)).toBe(true);
  });

  it("returns false if child is strictly worse", () => {
    const parent = makeScore({ correctness: 0.8, efficiency: 0.8, costInv: 0.8, latencyInv: 0.8, confidence: 0.8 });
    const child  = makeScore({ correctness: 0.3, efficiency: 0.3, costInv: 0.3, latencyInv: 0.3, confidence: 0.3 });
    expect(improvedOnMinibatch(child, parent)).toBe(false);
  });

  it("anti-Goodhart: child on easier batch must still improve aggregate", () => {
    // This test simulates a child scored on a "lucky" minibatch.
    // The engine ensures SAME batch is used, so we just verify the comparison
    // logic is correct and doesn't accept pure regressions.
    const parent = makeScore({ correctness: 0.7, efficiency: 0.7, costInv: 0.7, latencyInv: 0.7, confidence: 0.7 });
    // Child is slightly worse on correctness even with "easier" tasks — rejected
    const child  = makeScore({ correctness: 0.65, efficiency: 0.65, costInv: 0.65, latencyInv: 0.65, confidence: 0.65 });
    expect(improvedOnMinibatch(child, parent)).toBe(false);
  });
});

describe("weightedPick", () => {
  it("always picks from the list", () => {
    const items = ["a", "b", "c"];
    let n = 0;
    const rng = () => ++n / 10;
    for (let i = 0; i < 30; i++) {
      const picked = weightedPick(items, () => 1, rng);
      expect(items).toContain(picked);
    }
  });

  it("always picks the only item when weights are positive", () => {
    const items = ["only"];
    let n = 0;
    const rng = () => ++n / 10;
    expect(weightedPick(items, () => 5, rng)).toBe("only");
  });
});

describe("meanObjective", () => {
  it("returns the zero objective vector for empty input", () => {
    const result = meanObjective([]);
    expect(result).toEqual({
      correctness: 0, efficiency: 0, costInv: 0, latencyInv: 0, confidence: 0,
    });
  });
});

describe("chooseComponentToRevise", () => {
  const dummyScore = {
    genomeId: "g",
    perInstance: new Map(),
    aggregate: { correctness: 0.5, efficiency: 0.5, costInv: 0.5, latencyInv: 0.5, confidence: 0.5 },
    legacyScalar: 0.5,
  };

  it("returns first key for a single-component genome", () => {
    expect(
      chooseComponentToRevise({ editable: { soul: "content" } }, dummyScore),
    ).toBe("soul");
  });

  it("returns first key for a multi-component genome (Packet-07+ fallback)", () => {
    expect(
      chooseComponentToRevise(
        { editable: { soul: "a", tools: "b", heartbeat: "c" } },
        dummyScore,
      ),
    ).toBe("soul");
  });
});
