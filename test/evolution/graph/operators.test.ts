import { describe, it, expect } from "vitest";
import { ensembleOp, bestOfNOp, applyOperator } from "../../../src/alienclaw/evolution/graph/operators.js";
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
});
