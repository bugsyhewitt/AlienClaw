import { describe, it, expect } from "vitest";
import { resolveCorrectness } from "../../../src/alienclaw/evolution/reflective/correctness.js";
import type { ExecutionTrace } from "../../../src/alienclaw/evolution/reflective/types.js";

function makeTrace(overrides: Partial<ExecutionTrace> = {}): ExecutionTrace {
  return {
    runId: "r", genomeId: "g", taskId: "t", seed: 1,
    toolCalls: [{ index: 0, tool: "mock_tool", args: {}, result: { ok: true }, ok: true, ms: 1 }],
    finalOutput: { answer: "correct" },
    errors: [],
    correctness: { score: 0.8, source: "llm_judge", evidence: "e" },
    cost: { inputTokens: 1, outputTokens: 1, dollars: 0, toolCalls: 1, wallMs: 1 },
    startedAt: new Date().toISOString(), endedAt: new Date().toISOString(),
    ...overrides,
  };
}
const sc = (out: unknown, schema: unknown) =>
  resolveCorrectness({ kind: "schema", schema }, { trace: makeTrace({ finalOutput: out as never }) }).score;

describe("validateSchema — required must be own property (PKT-1254 File-A)", () => {
  it("A-1 rejects {} for required ['toString']", () => { expect(sc({}, { required: ["toString"] })).toBe(0.0); });
  it("A-2 rejects {} for type:object + required ['toString']", () => { expect(sc({}, { type: "object", required: ["toString"] })).toBe(0.0); });
  it("A-3 rejects {wrongKey:1} for required ['hasOwnProperty']", () => { expect(sc({ wrongKey: 1 }, { type: "object", required: ["hasOwnProperty"] })).toBe(0.0); });
  it("A-4 rejects {wrongKey:1} for required ['constructor']", () => { expect(sc({ wrongKey: 1 }, { type: "object", required: ["constructor"] })).toBe(0.0); });
  it("A-5 rejects {wrongKey:1} for required ['valueOf']", () => { expect(sc({ wrongKey: 1 }, { type: "object", required: ["valueOf"] })).toBe(0.0); });
  it("A-6 rejects {wrongKey:1} for required ['__proto__']", () => { expect(sc({ wrongKey: 1 }, { type: "object", required: ["__proto__"] })).toBe(0.0); });
  it("A-7 accepts own-property toString", () => { expect(sc({ toString: "x" }, { type: "object", required: ["toString"] })).toBe(1.0); });
  it("A-8 accepts {} for required []", () => { expect(sc({}, { type: "object", required: [] })).toBe(1.0); });
});
