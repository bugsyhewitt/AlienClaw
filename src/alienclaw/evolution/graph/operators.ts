/**
 * Within-subagent coordination operators (P14-02).
 *
 * Pure and graph-safe: operators ONLY combine MartianResult arrays. They never
 * reference a governance node (boss/advisor/creator) — coordination happens
 * inside a single subagent's summon fan, never across the wall.
 */
import type { MartianResult, OperatorSpec } from "./types.js";

function logOnce(msg: string): void {
  console.warn(`[operators] ${msg}`);
}

type Oracle = (result: MartianResult) => number;

export function applyOperator(
  results: MartianResult[],
  spec: OperatorSpec,
  oracle?: Oracle,
): MartianResult {
  if (results.length === 0) throw new Error("operators: no results to apply to");
  switch (spec.kind) {
    case "none": return results[0]!;
    case "ensemble": return ensembleOp(results, spec.k);
    case "best_of_n": return bestOfNOp(results, spec.n, oracle);
    case "review_revise":
      // Synchronous fallback: review_revise in real use is async; here we return the last result
      return results[results.length - 1]!;
  }
}

export function ensembleOp(results: MartianResult[], k: number): MartianResult {
  const top = results.slice(0, k);
  if (top.length === 0) throw new Error("ensemble: no results");
  // Vote on correctness: majority rules
  const correctVotes = top.filter(r => r.correct).length;
  const correct = correctVotes > top.length / 2;
  // Merge outputs: use the output from the most-correct result, else first
  const best = top.find(r => r.correct) ?? top[0]!;
  const totalCost = top.reduce((s, r) => ({
    dollars: s.dollars + r.cost.dollars,
    wallMs: s.wallMs + r.cost.wallMs,
  }), { dollars: 0, wallMs: 0 });
  return { taskId: best.taskId, output: best.output, correct, cost: totalCost };
}

export async function reviewReviseOp(
  produce: () => Promise<MartianResult>,
  critique: (r: MartianResult) => Promise<string>,
  revise: (r: MartianResult, notes: string) => Promise<MartianResult>,
  rounds: number,
): Promise<MartianResult> {
  let r = await produce();
  for (let i = 0; i < rounds; i++) {
    const notes = await critique(r);
    if (!notes || notes.trim() === "" || notes.toLowerCase().includes("no issues")) break;
    r = await revise(r, notes);
  }
  return r;
}

export function bestOfNOp(
  results: MartianResult[],
  n: number,
  oracle?: Oracle,
): MartianResult {
  const top = results.slice(0, n);
  if (top.length === 0) throw new Error("best_of_n: no results");
  if (!oracle) {
    logOnce("best_of_n without oracle — returning first result");
    return top[0]!;
  }
  return top.reduce((a, b) => oracle(b) > oracle(a) ? b : a);
}
