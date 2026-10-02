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
  rawObjectiveVector,
  dominates,
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

  it("throws when items is empty (post-fix expectation, gated on PART B)", () => {
    expect(() => weightedPick([], () => 1, () => 0.5)).toThrow(/empty items/);
  });

  it("throws when all weights are zero (post-fix expectation, gated on PART B)", () => {
    expect(() => weightedPick(["a", "b", "c"], () => 0, () => 0.5))
      .toThrow(/non-positive total weight/);
  });

  it("throws when any weight is negative (post-fix expectation, gated on PART B)", () => {
    expect(() => weightedPick(["a", "b", "c"], () => -1, () => 0.5))
      .toThrow(/negative weight/);
  });

  it("rng=1.0 still terminates (last-item fallback works)", () => {
    const r = weightedPick(["a", "b"], () => 1, () => 1.0);
    expect(r).toBeDefined();
    expect(["a", "b"]).toContain(r);
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

describe("rawObjectiveVector", () => {
  it("falls back to correctness when confidence is undefined (logprob-unaware evaluator)", () => {
    const trace = makeTrace(0.8);
    const raw = rawObjectiveVector(trace);
    expect(raw.confidence).toBeCloseTo(0.8);
    expect(raw.correctness).toBeCloseTo(0.8);
    expect(raw.efficiency).toBeCloseTo(1.0);
  });
});

function makeTraceWithSlots(correctness: number, toolCalls: number, slotCount: number): ExecutionTrace {
  return {
    runId: "r-0",
    genomeId: "g-0",
    taskId: "t-0",
    seed: 1,
    toolCalls: Array.from({ length: toolCalls }, (_, i) => ({
      index: i, tool: "t", args: {}, result: {}, ok: true, ms: 50,
    })),
    finalOutput: {},
    errors: [],
    correctness: { score: correctness, source: "exact", evidence: "test" },
    cost: { inputTokens: 100, outputTokens: 50, dollars: 0.001, toolCalls, slotCount, wallMs: 200 },
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
  };
}

describe("computeLegacyScalar — slot_count plumbing", () => {
  it("slot_count=4, 4 tool calls: no excess → returns correctness", () => {
    const result = computeLegacyScalar([makeTraceWithSlots(1.0, 4, 4)]);
    expect(result).toBeCloseTo(1.0);
  });

  it("slot_count=4, 6 tool calls: 2 excess → correctness × 1/(1+0.2)", () => {
    const result = computeLegacyScalar([makeTraceWithSlots(0.8, 6, 4)]);
    expect(result).toBeCloseTo(0.8 / 1.2, 6);
  });

  it("cost.slotCount omitted: falls back to slot_count=1", () => {
    // makeTrace has no slotCount; 2 tool calls with slot_count=1 → excess=1
    const result = computeLegacyScalar([makeTrace(0.8, 2)]);
    expect(result).toBeCloseTo(0.8 / 1.1, 6);
  });
});

describe("rawObjectiveVector — slot_count plumbing", () => {
  it("rawObjectiveVector: slot_count=4, 4 tool calls → efficiency 1.0", () => {
    const trace = makeTraceWithSlots(0.9, 4, 4);
    const raw = rawObjectiveVector(trace);
    expect(raw.efficiency).toBeCloseTo(1.0);
  });

  it("rawObjectiveVector: cost.slotCount omitted → slot_count=1 fallback", () => {
    // makeTrace with 1 tool call and no slotCount → excess=0 → efficiency=1
    const trace = makeTrace(0.8, 1);
    const raw = rawObjectiveVector(trace);
    expect(raw.efficiency).toBeCloseTo(1.0);
  });
});

// PKT-680: guard clamp01 against NaN/±Infinity (TS mirror of PKT-588 fix in fitness/function.py)
describe("computeLegacyScalar — non-finite correctness (PKT-680)", () => {
  it("NaN correctness → 0.0, never NaN", () => {
    const result = computeLegacyScalar([makeTrace(NaN)]);
    expect(result).toBe(0);
    expect(Number.isFinite(result)).toBe(true);
  });

  it("+Infinity correctness → 0.0 (failing-score contract, not 1.0 inflation)", () => {
    const result = computeLegacyScalar([makeTrace(+Infinity)]);
    expect(result).toBe(0);
  });

  it("-Infinity correctness → 0.0", () => {
    const result = computeLegacyScalar([makeTrace(-Infinity)]);
    expect(result).toBe(0);
  });

  it("NaN correctness mixed with valid trace → aggregate is finite", () => {
    const result = computeLegacyScalar([makeTrace(NaN), makeTrace(0.8)]);
    expect(Number.isFinite(result)).toBe(true);
    // NaN trace contributes 0, valid trace contributes ~0.8; mean ≈ 0.4
    expect(result).toBeCloseTo(0.4, 3);
  });
});

describe("rawObjectiveVector — non-finite correctness (PKT-680)", () => {
  it("NaN correctness → correctness field is finite", () => {
    const raw = rawObjectiveVector(makeTrace(NaN));
    expect(Number.isFinite(raw.correctness)).toBe(true);
  });

  it("+Infinity correctness → correctness field 0.0", () => {
    const raw = rawObjectiveVector(makeTrace(+Infinity));
    expect(raw.correctness).toBe(0);
  });

  it("-Infinity correctness → correctness field 0.0", () => {
    const raw = rawObjectiveVector(makeTrace(-Infinity));
    expect(raw.correctness).toBe(0);
  });
});

// PKT-981: harden rawObjectiveVector against NaN/±Infinity in cost.dollars and
// cost.wallMs (the inverse-cost fields), which previously propagated NaN straight
// into the normalized ObjectiveVector and silently inflated `dominates()` —
// `a[k] < b[k]` is false for NaN, so a candidate with NaN costInv never failed
// that objective and could silently outrank a parent with finite costInv.
// safeInv() contract (mirrors PKT-680 / clamp01 pattern at objectives.ts L14-26):
//   - finite x with finite result -> finite + (preserves +Infinity rank-best semantics
//     because 1/0+ = +Inf — legitimate extremum)
//   - non-finite input OR non-finite output -> 0 (treating as unscoreable rather
//     than letting NaN propagate into dominance comparison)
describe("rawObjectiveVector — non-finite cost fields (PKT-981)", () => {
  it("NaN dollars → costInvRaw is finite (NaN guarded out)", () => {
    const trace: ExecutionTrace = {
      ...makeTrace(0.8),
      cost: { inputTokens: 100, outputTokens: 50, dollars: NaN, toolCalls: 1, wallMs: 200 },
    };
    const raw = rawObjectiveVector(trace);
    expect(Number.isNaN(raw.costInvRaw)).toBe(false);
    expect(raw.costInvRaw).toBe(0);
  });

  it("+Infinity dollars → costInvRaw is finite", () => {
    const trace: ExecutionTrace = {
      ...makeTrace(0.8),
      cost: { inputTokens: 100, outputTokens: 50, dollars: +Infinity, toolCalls: 1, wallMs: 200 },
    };
    const raw = rawObjectiveVector(trace);
    expect(Number.isFinite(raw.costInvRaw)).toBe(true);
    expect(raw.costInvRaw).toBe(0);
  });

  it("-Infinity dollars → costInvRaw is finite", () => {
    const trace: ExecutionTrace = {
      ...makeTrace(0.8),
      cost: { inputTokens: 100, outputTokens: 50, dollars: -Infinity, toolCalls: 1, wallMs: 200 },
    };
    const raw = rawObjectiveVector(trace);
    expect(Number.isFinite(raw.costInvRaw)).toBe(true);
    expect(raw.costInvRaw).toBe(0);
  });

  it("NaN wallMs → latencyInvRaw is finite (NaN guarded out)", () => {
    const trace: ExecutionTrace = {
      ...makeTrace(0.8),
      cost: { inputTokens: 100, outputTokens: 50, dollars: 0.001, toolCalls: 1, wallMs: NaN },
    };
    const raw = rawObjectiveVector(trace);
    expect(Number.isNaN(raw.latencyInvRaw)).toBe(false);
    expect(raw.latencyInvRaw).toBe(0);
  });

  it("+Infinity wallMs → latencyInvRaw is finite", () => {
    const trace: ExecutionTrace = {
      ...makeTrace(0.8),
      cost: { inputTokens: 100, outputTokens: 50, dollars: 0.001, toolCalls: 1, wallMs: +Infinity },
    };
    const raw = rawObjectiveVector(trace);
    expect(Number.isFinite(raw.latencyInvRaw)).toBe(true);
    expect(raw.latencyInvRaw).toBe(0);
  });

  it("-Infinity wallMs → latencyInvRaw is finite", () => {
    const trace: ExecutionTrace = {
      ...makeTrace(0.8),
      cost: { inputTokens: 100, outputTokens: 50, dollars: 0.001, toolCalls: 1, wallMs: -Infinity },
    };
    const raw = rawObjectiveVector(trace);
    expect(Number.isFinite(raw.latencyInvRaw)).toBe(true);
    expect(raw.latencyInvRaw).toBe(0);
  });

  it("finite dollars=0.001 → costInvRaw ≈ 1/0.001 (no regression on benign inputs)", () => {
    const raw = rawObjectiveVector(makeTrace(0.8, 1, 0.001, 200));
    // 1 / (0.001 + 1e-9) ≈ 999.999. (Note: NOT 1e6 — that's 1/1e-6, the well-known
    // costInvRaw magnitude when dollars is sub-micro.)
    expect(raw.costInvRaw).toBeCloseTo(1 / (0.001 + 1e-9), 6);
  });

  it("finite wallMs=200 → latencyInvRaw ≈ 1/201 (no regression on benign inputs)", () => {
    const raw = rawObjectiveVector(makeTrace(0.8, 1, 0.001, 200));
    expect(raw.latencyInvRaw).toBeCloseTo(1 / 201, 10);
  });
});

// PKT-981: harden dominates() against NaN propagation. A child whose aggregate
// ObjectiveVector carries NaN on costInv / latencyInv (because upstream rawObjectiveVector
// or normalizeObjectives produced NaN) must NOT silently outrank a parent with finite
// values on those objectives — NaN comparisons are false, so without an explicit guard
// the function returns strictlyBetter=true from any other objective strictly better.
//
// Standing semantics (resolved at cycle-583 carry-forward, refined this cycle):
//   - +Infinity: treat as unscoreable (PKT-981 conservative reading — dominance
//     requires BOTH operands finite on every objective, otherwise refuse to claim)
//   - -Infinity: treat as unscoreable (same reasoning)
//   - NaN: treat as unscoreable → return false
// Any non-finite on either side → false (no info gained, refuse dominance).
describe("dominates — non-finite propagation (PKT-981)", () => {
  it("child NaN costInv + better correctness → FALSE (no info gained on NaN key)", () => {
    const child = { correctness: 0.9, efficiency: 0.5, costInv: NaN, latencyInv: 0.5, confidence: 0.5 };
    const parent = { correctness: 0.8, efficiency: 0.5, costInv: 0.5, latencyInv: 0.5, confidence: 0.5 };
    expect(dominates(child, parent)).toBe(false);
  });

  it("child NaN latencyInv + better correctness → FALSE", () => {
    const child = { correctness: 0.9, efficiency: 0.5, costInv: 0.5, latencyInv: NaN, confidence: 0.5 };
    const parent = { correctness: 0.8, efficiency: 0.5, costInv: 0.5, latencyInv: 0.5, confidence: 0.5 };
    expect(dominates(child, parent)).toBe(false);
  });

  it("child NaN on BOTH costInv + latencyInv + better correctness → FALSE", () => {
    const child = { correctness: 0.9, efficiency: 0.5, costInv: NaN, latencyInv: NaN, confidence: 0.5 };
    const parent = { correctness: 0.8, efficiency: 0.5, costInv: 0.5, latencyInv: 0.5, confidence: 0.5 };
    expect(dominates(child, parent)).toBe(false);
  });

  it("child +Inf costInv + better correctness → FALSE (PKT-981 conservative: any non-finite key refuses dominance)", () => {
    // PKT-981 standing semantics: any non-finite value on either operand is treated
    // as unscoreable → return false (no info gained, refuse to claim dominance).
    // This is intentionally stricter than the cycle-583 carry-forward which allowed
    // +Inf as a legitimate rank-best extremum; the conservative reading is that
    // dominance requires both sides to be fully finite on every key.
    const child = { correctness: 0.9, efficiency: 0.5, costInv: +Infinity, latencyInv: 0.5, confidence: 0.5 };
    const parent = { correctness: 0.8, efficiency: 0.5, costInv: 0.5, latencyInv: 0.5, confidence: 0.5 };
    expect(dominates(child, parent)).toBe(false);
  });

  it("child -Inf costInv + better correctness → FALSE (-Inf coerce-to-worst)", () => {
    const child = { correctness: 0.9, efficiency: 0.5, costInv: -Infinity, latencyInv: 0.5, confidence: 0.5 };
    const parent = { correctness: 0.8, efficiency: 0.5, costInv: 0.5, latencyInv: 0.5, confidence: 0.5 };
    expect(dominates(child, parent)).toBe(false);
  });

  it("all-NaN vectors → FALSE (no strict ordering possible)", () => {
    const a = { correctness: NaN, efficiency: NaN, costInv: NaN, latencyInv: NaN, confidence: NaN };
    const b = { correctness: NaN, efficiency: NaN, costInv: NaN, latencyInv: NaN, confidence: NaN };
    expect(dominates(a, b)).toBe(false);
  });

  it("finite dominance still works after NaN guard (regression check)", () => {
    const child = { correctness: 0.9, efficiency: 0.6, costInv: 0.6, latencyInv: 0.6, confidence: 0.6 };
    const parent = { correctness: 0.5, efficiency: 0.5, costInv: 0.5, latencyInv: 0.5, confidence: 0.5 };
    expect(dominates(child, parent)).toBe(true);
  });
});
