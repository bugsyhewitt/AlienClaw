/**
 * Correctness hardening tests — §9.1 item 6 (anti-Goodhart guards).
 */
import { describe, it, expect } from "vitest";
import {
  resolveCorrectness,
  checkLlmJudgeFraction,
} from "../../../src/alienclaw/evolution/reflective/correctness.js";
import type {
  ExecutionTrace,
  CorrectnessVerdict,
} from "../../../src/alienclaw/evolution/reflective/types.js";

function makeTrace(overrides: Partial<ExecutionTrace> = {}): ExecutionTrace {
  return {
    runId: "test-run-id",
    genomeId: "test-genome",
    taskId: "t-001",
    seed: 42,
    toolCalls: [
      { index: 0, tool: "mock_tool", args: {}, result: { ok: true }, ok: true, ms: 100 },
    ],
    finalOutput: { answer: "correct" },
    errors: [],
    correctness: { score: 0.8, source: "llm_judge", evidence: "model says ok" },
    cost: { inputTokens: 100, outputTokens: 50, dollars: 0.001, toolCalls: 1, wallMs: 200 },
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("resolveCorrectness — oracle priority chain", () => {
  it("exact: returns 1.0 for matching output", () => {
    const trace = makeTrace({ finalOutput: { answer: "correct" } });
    const verdict = resolveCorrectness({ kind: "exact", expected: { answer: "correct" } }, { trace });
    expect(verdict.score).toBe(1.0);
    expect(verdict.source).toBe("exact");
  });

  it("exact: returns 0.0 for non-matching output", () => {
    const trace = makeTrace({ finalOutput: { answer: "wrong" } });
    const verdict = resolveCorrectness({ kind: "exact", expected: { answer: "correct" } }, { trace });
    expect(verdict.score).toBe(0.0);
    expect(verdict.source).toBe("exact");
  });

  it("schema: returns 1.0 for valid object", () => {
    const trace = makeTrace({ finalOutput: { answer: "something" } });
    const verdict = resolveCorrectness(
      { kind: "schema", schema: { type: "object", required: ["answer"] } },
      { trace },
    );
    expect(verdict.score).toBe(1.0);
    expect(verdict.source).toBe("schema");
  });

  it("schema: returns 0.0 for invalid output", () => {
    const trace = makeTrace({ finalOutput: "a string, not an object" });
    const verdict = resolveCorrectness(
      { kind: "schema", schema: { type: "object", required: ["answer"] } },
      { trace },
    );
    expect(verdict.score).toBe(0.0);
  });

  it("predicate: passes when registered fn returns true", () => {
    const trace = makeTrace();
    const verdict = resolveCorrectness(
      { kind: "predicate", ref: "always_pass" },
      { trace, predicates: { always_pass: () => true } },
    );
    expect(verdict.score).toBe(1.0);
    expect(verdict.source).toBe("predicate");
  });

  it("predicate: BEATS llm_judge — deterministic oracle wins", () => {
    // This is the Goodhart fixture: llm_judge would pass a confidently-wrong answer
    // but the predicate correctly fails it.
    const trace = makeTrace({
      finalOutput: { answer: "wrong_but_confident" },
      correctness: { score: 0.95, source: "llm_judge", evidence: "looks good to me" },
    });
    const verdict = resolveCorrectness(
      { kind: "predicate", ref: "strict_check" },
      {
        trace,
        predicates: {
          strict_check: (t) => {
            const out = t.finalOutput as Record<string, string>;
            return out["answer"] === "correct_answer";
          },
        },
      },
    );
    expect(verdict.score).toBe(0.0); // predicate says FAIL
    expect(verdict.source).toBe("predicate");
    // The llm_judge would have given 0.95; predicate gives 0.0. Predicate wins.
  });

  it("predicate: falls back to tool_success when ref not registered", () => {
    const trace = makeTrace();
    const verdict = resolveCorrectness(
      { kind: "predicate", ref: "unregistered" },
      { trace, predicates: {} },
    );
    expect(verdict.source).toBe("tool_success");
  });

  it("tool_success: 1.0 when all tool calls ok", () => {
    const trace = makeTrace();
    const verdict = resolveCorrectness({ kind: "tool_success" }, { trace });
    expect(verdict.score).toBe(1.0);
    expect(verdict.source).toBe("tool_success");
  });

  it("tool_success: partial score for partial success", () => {
    const trace = makeTrace({
      toolCalls: [
        { index: 0, tool: "t", args: {}, result: {}, ok: true, ms: 10 },
        { index: 1, tool: "t", args: {}, result: {}, ok: false, ms: 10 },
      ],
    });
    const verdict = resolveCorrectness({ kind: "tool_success" }, { trace });
    expect(verdict.score).toBeCloseTo(0.5);
  });

  it("llm_judge: uses existing trace correctness (no re-judgment)", () => {
    const trace = makeTrace({ correctness: { score: 0.7, source: "llm_judge", evidence: "test" } });
    const verdict = resolveCorrectness({ kind: "llm_judge", rubricRef: "r1" }, { trace });
    expect(verdict.score).toBe(0.7);
    expect(verdict.source).toBe("llm_judge");
  });

  it("no oracle: returns the trace's existing correctness verdict", () => {
    const trace = makeTrace({ correctness: { score: 0.6, source: "predicate", evidence: "x" } });
    const verdict = resolveCorrectness(undefined, { trace });
    expect(verdict.score).toBe(0.6);
  });

  it("confidence penalty: coin-flip-correct answer penalized", () => {
    const trace = makeTrace({ finalOutput: { answer: "correct" } });
    // logprobConfidence = 0.5 (50/50 guess)
    const verdict = resolveCorrectness(
      { kind: "exact", expected: { answer: "correct" } },
      { trace, logprobConfidence: 0.5 },
    );
    // Score = 1.0 * 0.5 = 0.5 (penalized lucky guess)
    expect(verdict.confidence).toBeCloseTo(0.5);
  });

  it("confidence neutral when no logprob: confidence = score", () => {
    const trace = makeTrace({ finalOutput: { answer: "correct" } });
    const verdict = resolveCorrectness(
      { kind: "exact", expected: { answer: "correct" } },
      { trace },
    );
    expect(verdict.confidence).toBe(1.0); // neutral: confidence = score
  });
});

describe("checkLlmJudgeFraction — YELLOW threshold", () => {
  it("fires YELLOW when fraction exceeds threshold", () => {
    const logs: string[] = [];
    const verdicts: CorrectnessVerdict[] = [
      { score: 0.8, source: "llm_judge", evidence: "a" },
      { score: 0.7, source: "llm_judge", evidence: "b" },
      { score: 0.9, source: "exact", evidence: "c" },
    ];
    const fraction = checkLlmJudgeFraction(verdicts, 0.40, msg => logs.push(msg));
    expect(fraction).toBeCloseTo(2 / 3);
    expect(logs.some(l => l.includes("YELLOW"))).toBe(true);
  });

  it("does not fire YELLOW when fraction is below threshold", () => {
    const logs: string[] = [];
    const verdicts: CorrectnessVerdict[] = [
      { score: 0.9, source: "exact", evidence: "a" },
      { score: 0.8, source: "predicate", evidence: "b" },
      { score: 0.7, source: "llm_judge", evidence: "c" },
    ];
    checkLlmJudgeFraction(verdicts, 0.40, msg => logs.push(msg));
    expect(logs).toHaveLength(0);
  });

  it("returns 0 immediately for empty verdicts array (no log call)", () => {
    const logs: string[] = [];
    const fraction = checkLlmJudgeFraction([], 0.5, msg => logs.push(msg));
    expect(fraction).toBe(0);
    expect(logs).toHaveLength(0);
  });
});

describe("schema oracle — validateSchema edge cases", () => {
  it("null schema: always valid (returns 1.0)", () => {
    const trace = makeTrace({ finalOutput: 42 });
    const verdict = resolveCorrectness(
      { kind: "schema", schema: null },
      { trace },
    );
    expect(verdict.score).toBe(1.0);
    expect(verdict.source).toBe("schema");
  });

  it("primitive schema (non-object): always valid (returns 1.0)", () => {
    const trace = makeTrace({ finalOutput: 42 });
    const verdict = resolveCorrectness(
      { kind: "schema", schema: "not-an-object-schema" as unknown as object },
      { trace },
    );
    expect(verdict.score).toBe(1.0);
    expect(verdict.source).toBe("schema");
  });

  it("type:array — returns 0.0 for non-array value", () => {
    const trace = makeTrace({ finalOutput: "not-an-array" });
    const verdict = resolveCorrectness(
      { kind: "schema", schema: { type: "array" } },
      { trace },
    );
    expect(verdict.score).toBe(0.0);
  });

  it("type:string — returns 0.0 for non-string value", () => {
    const trace = makeTrace({ finalOutput: 99 });
    const verdict = resolveCorrectness(
      { kind: "schema", schema: { type: "string" } },
      { trace },
    );
    expect(verdict.score).toBe(0.0);
  });

  it("type:number — returns 0.0 for non-number value", () => {
    const trace = makeTrace({ finalOutput: "ninety-nine" });
    const verdict = resolveCorrectness(
      { kind: "schema", schema: { type: "number" } },
      { trace },
    );
    expect(verdict.score).toBe(0.0);
  });

  it("required key absent in correctly-typed object — returns 0.0", () => {
    const trace = makeTrace({ finalOutput: { wrongKey: "value" } });
    const verdict = resolveCorrectness(
      { kind: "schema", schema: { type: "object", required: ["answer"] } },
      { trace },
    );
    expect(verdict.score).toBe(0.0);
  });
});
