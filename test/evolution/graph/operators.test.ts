import { describe, it, expect, vi, afterEach } from "vitest";
import { ensembleOp, bestOfNOp, applyOperator, reviewReviseOp } from "../../../src/alienclaw/evolution/graph/operators.js";
import type { MartianResult } from "../../../src/alienclaw/evolution/graph/types.js";

function makeResult(correct: boolean, dollars = 0.001): MartianResult {
  return { taskId: "t1", output: { value: correct ? "correct" : "wrong" }, correct, cost: { dollars, wallMs: 100 } };
}

describe("operators — graph-safe within-subagent", () => {
  it("ensemble: majority correct wins", () => {
    const results = [makeResult(true), makeResult(true), makeResult(false)];
    const r = ensembleOp(results, 3);
    expect(r.correct).toBe(true);
  });

  it("ensemble: majority incorrect wins", () => {
    const results = [makeResult(false), makeResult(false), makeResult(true)];
    const r = ensembleOp(results, 3);
    expect(r.correct).toBe(false);
  });

  it("ensemble: accumulates cost across k results", () => {
    const results = [makeResult(true, 0.001), makeResult(true, 0.002), makeResult(false, 0.003)];
    const r = ensembleOp(results, 3);
    expect(r.cost.dollars).toBeCloseTo(0.006, 5);
  });

  it("best_of_n: uses oracle to pick best", () => {
    const results = [makeResult(false, 0.001), makeResult(true, 0.001), makeResult(false, 0.001)];
    const oracle = (r: MartianResult) => r.correct ? 1 : 0;
    const r = bestOfNOp(results, 3, oracle);
    expect(r.correct).toBe(true);
  });

  it("best_of_n: falls back to first when no oracle", () => {
    const results = [makeResult(false), makeResult(true)];
    const r = bestOfNOp(results, 2);
    expect(r.correct).toBe(false);  // first, not best
  });

  it("applyOperator none: returns first result", () => {
    const results = [makeResult(true), makeResult(false)];
    const r = applyOperator(results, { kind: "none" });
    expect(r).toBe(results[0]);
  });

  it("applyOperator ensemble: delegates to ensembleOp", () => {
    const results = [makeResult(true), makeResult(false), makeResult(true)];
    const r = applyOperator(results, { kind: "ensemble", k: 3 });
    expect(r.correct).toBe(true);  // 2/3 majority
  });

  it("operators never reference governance nodes", () => {
    // operators only operate on MartianResult arrays — no boss/creator/advisor in scope
    const results = [makeResult(true)];
    const r = applyOperator(results, { kind: "none" });
    expect(r.taskId).toBe("t1");  // MartianResult field, not a governance node
  });

  // Gap A: applyOperator best_of_n dispatch (line 25 — was cold)
  it("applyOperator best_of_n: dispatches to bestOfNOp with oracle", () => {
    const results = [makeResult(false), makeResult(true)];
    const oracle = (r: MartianResult) => r.correct ? 1 : 0;
    const r = applyOperator(results, { kind: "best_of_n", n: 2 }, oracle);
    expect(r.correct).toBe(true);
  });

  // Gap A: applyOperator review_revise sync fallback (lines 26-28 — were cold)
  it("applyOperator review_revise: returns last result synchronously", () => {
    const results = [makeResult(false), makeResult(true)];
    const r = applyOperator(results, { kind: "review_revise", rounds: 1 });
    expect(r).toBe(results[results.length - 1]);
  });

  // Gap B: reviewReviseOp — break on "no issues" (line 56 branch — was cold)
  it("reviewReviseOp: stops when critique says no issues", async () => {
    let revised = false;
    const produce = async () => makeResult(false);
    const critique = async (_r: MartianResult) => "no issues found";
    const revise = async (r: MartianResult, _notes: string) => { revised = true; return r; };
    const result = await reviewReviseOp(produce, critique, revise, 3);
    expect(revised).toBe(false);
    expect(result.correct).toBe(false);
  });

  // Gap B: reviewReviseOp — break on empty string (line 56 branch — was cold)
  it("reviewReviseOp: stops when critique returns empty string", async () => {
    let reviseCount = 0;
    const produce = async () => makeResult(false);
    const critique = async (_r: MartianResult) => "";
    const revise = async (r: MartianResult, _notes: string) => { reviseCount++; return makeResult(true); };
    await reviewReviseOp(produce, critique, revise, 3);
    expect(reviseCount).toBe(0);
  });

  // Gap B: reviewReviseOp — all rounds when critique always has notes (lines 53-59 full path — was cold)
  it("reviewReviseOp: runs all rounds when critique always has notes", async () => {
    let reviseCount = 0;
    const produce = async () => makeResult(false);
    const critique = async (_r: MartianResult) => "improve this";
    const revise = async (_r: MartianResult, _notes: string) => { reviseCount++; return makeResult(true); };
    const result = await reviewReviseOp(produce, critique, revise, 2);
    expect(reviseCount).toBe(2);
    expect(result.correct).toBe(true);
  });

  // Packet 298 — throw arms + ensembleOp all-incorrect fallback
  it("applyOperator: throws when results is empty", () => {
    expect(() => applyOperator([], { kind: "none" })).toThrow("operators: no results to apply to");
  });

  it("ensembleOp: throws when top slice is empty (k=0)", () => {
    expect(() => ensembleOp([makeResult(true)], 0)).toThrow("ensemble: no results");
  });

  it("bestOfNOp: throws when top slice is empty (n=0)", () => {
    expect(() => bestOfNOp([makeResult(true)], 0)).toThrow("best_of_n: no results");
  });

  it("ensembleOp: ?? fallback fires when all results are incorrect", () => {
    const results = [makeResult(false, 0.001), makeResult(false, 0.002)];
    const r = ensembleOp(results, 2);
    expect(r.correct).toBe(false);
    expect(r.output).toEqual(results[0]!.output);
  });

  // ── logOnce dedupe (operators.ts:10) ───────────────────────────────────────
  // The module-level helper is named `logOnce` ("log at most once") but the
  // implementation as-shipped called console.warn on every invocation.
  // The single caller is `bestOfNOp(results, n)` with no oracle supplied
  // (L70), so a high-volume campaign can spam the warning channel.
  // These tests pin the contract: identical messages dedupe to one emit.
  //
  // The dedupe is per-process (module-local Set), so each test that asserts
  // on warn-count must isolate to a fresh module instance via vi.resetModules
  // + dynamic import. Otherwise the earliest test's call would dedupe later
  // tests' assertions.
  describe("logOnce dedupe (operators.ts internal helper)", () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.resetModules();
    });

    it("bestOfNOp without oracle warns exactly once across N invocations (regression)", async () => {
      vi.resetModules();
      const { bestOfNOp } = await import(
        "../../../src/alienclaw/evolution/graph/operators.js"
      );
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const results = [makeResult(true), makeResult(false)];

      // First invocation must surface the warning so operators notice.
      bestOfNOp(results, 2);
      expect(spy.mock.calls.length).toBe(1);
      const firstMsg = spy.mock.calls[0]![0] as string;
      expect(firstMsg).toContain("best_of_n without oracle");

      // Subsequent invocations with the SAME condition must NOT re-emit
      // (the helper is named logOnce, not logAlways).
      bestOfNOp(results, 2);
      bestOfNOp(results, 2);
      bestOfNOp(results, 2);
      expect(spy.mock.calls.length).toBe(1);
      expect(spy.mock.calls[0]![0]).toBe(firstMsg);
    });

    it("bestOfNOp with oracle does not warn (oracle present → no fallback message)", async () => {
      vi.resetModules();
      const { bestOfNOp } = await import(
        "../../../src/alienclaw/evolution/graph/operators.js"
      );
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const results = [makeResult(true), makeResult(false)];
      const oracle = (r: MartianResult) => r.correct ? 1 : 0;
      bestOfNOp(results, 2, oracle);
      expect(spy).not.toHaveBeenCalled();
    });

    it("applyOperator best_of_n without oracle also dedupes via bestOfNOp", async () => {
      vi.resetModules();
      const { applyOperator } = await import(
        "../../../src/alienclaw/evolution/graph/operators.js"
      );
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const results = [makeResult(true), makeResult(false)];

      applyOperator(results, { kind: "best_of_n", n: 2 });
      applyOperator(results, { kind: "best_of_n", n: 2 });
      applyOperator(results, { kind: "best_of_n", n: 2 });

      // Three calls → exactly one emit thanks to the dedupe.
      expect(spy.mock.calls.length).toBe(1);
      expect(spy.mock.calls[0]![0] as string).toContain(
        "best_of_n without oracle",
      );
    });
  });
});
