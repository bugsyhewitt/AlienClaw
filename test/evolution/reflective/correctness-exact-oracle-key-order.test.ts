/**
 * File-A — `exact` oracle equality is key-order sensitive.
 *
 * `resolveCorrectness` case "exact" (src/alienclaw/evolution/reflective/correctness.ts)
 * compares the trace's final output against the oracle's expected value with
 * `JSON.stringify(a) === JSON.stringify(b)`. `JSON.stringify` emits properties
 * in *insertion* order, so two structurally identical objects whose keys were
 * inserted in a different order serialise to different strings and compare
 * UNEQUAL. The deterministic, highest-priority oracle then awards score 0.0 to
 * a correct answer.
 *
 * The same expression also throws on values JSON cannot represent (circular
 * structures, BigInt), escaping `resolveCorrectness` as a raw TypeError.
 *
 * Structural deep equality is the intended semantic. These tests pin it.
 */
import { describe, it, expect } from "vitest";
import { resolveCorrectness } from "../../../src/alienclaw/evolution/reflective/correctness.js";
import type { ExecutionTrace } from "../../../src/alienclaw/evolution/reflective/types.js";

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

describe("resolveCorrectness — exact oracle structural equality", () => {
  it("A-001: reordered top-level keys still match", () => {
    const trace = makeTrace({ finalOutput: { answer: "correct", confidence: 0.9 } });
    const verdict = resolveCorrectness(
      { kind: "exact", expected: { confidence: 0.9, answer: "correct" } },
      { trace },
    );
    expect(verdict.score).toBe(1.0);
    expect(verdict.source).toBe("exact");
  });

  it("A-002: reordered nested keys still match", () => {
    const trace = makeTrace({ finalOutput: { result: { host: "example.com", port: 80 } } });
    const verdict = resolveCorrectness(
      { kind: "exact", expected: { result: { port: 80, host: "example.com" } } },
      { trace },
    );
    expect(verdict.score).toBe(1.0);
  });

  it("A-003: reordered keys inside an array element still match", () => {
    const trace = makeTrace({ finalOutput: { findings: [{ host: "a", port: 1 }] } });
    const verdict = resolveCorrectness(
      { kind: "exact", expected: { findings: [{ port: 1, host: "a" }] } },
      { trace },
    );
    expect(verdict.score).toBe(1.0);
  });

  it("A-004: an explicit undefined value does not match a missing key", () => {
    const trace = makeTrace({ finalOutput: { answer: "correct", extra: undefined } });
    const verdict = resolveCorrectness(
      { kind: "exact", expected: { answer: "correct" } },
      { trace },
    );
    expect(verdict.score).toBe(0.0);
  });

  it("A-005: genuinely different values still do not match", () => {
    const trace = makeTrace({ finalOutput: { answer: "wrong" } });
    const verdict = resolveCorrectness(
      { kind: "exact", expected: { answer: "correct" } },
      { trace },
    );
    expect(verdict.score).toBe(0.0);
    expect(verdict.source).toBe("exact");
  });

  it("A-006: array element order is significant", () => {
    const trace = makeTrace({ finalOutput: { steps: [1, 2, 3] } });
    const verdict = resolveCorrectness(
      { kind: "exact", expected: { steps: [3, 2, 1] } },
      { trace },
    );
    expect(verdict.score).toBe(0.0);
  });

  it("A-007: a circular final output does not throw", () => {
    const circular: Record<string, unknown> = { answer: "correct" };
    circular["self"] = circular;
    const trace = makeTrace({ finalOutput: circular });
    expect(() =>
      resolveCorrectness({ kind: "exact", expected: { answer: "correct" } }, { trace }),
    ).not.toThrow();
  });

  it("A-008: a BigInt final output does not throw", () => {
    const trace = makeTrace({ finalOutput: { count: 1n } });
    expect(() =>
      resolveCorrectness({ kind: "exact", expected: { count: 1n } }, { trace }),
    ).not.toThrow();
  });

  it("A-009: undefined expected matches an undefined final output", () => {
    const trace = makeTrace({ finalOutput: undefined });
    const verdict = resolveCorrectness({ kind: "exact", expected: undefined }, { trace });
    expect(verdict.score).toBe(1.0);
  });

  it("A-010: undefined expected does not match a null final output", () => {
    const trace = makeTrace({ finalOutput: null });
    const verdict = resolveCorrectness({ kind: "exact", expected: undefined }, { trace });
    expect(verdict.score).toBe(0.0);
  });
});
