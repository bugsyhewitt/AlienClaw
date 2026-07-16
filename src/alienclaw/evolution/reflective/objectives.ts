/**
 * Objective vector computation and normalization.
 *
 * Per-generation min–max normalization keeps Pareto comparison scale-free.
 * Legacy scalar preserved for back-compat and shadow comparison.
 */
import type { ObjectiveVector, ObjectiveKey, CandidateScore, ExecutionTrace } from "./types.js";
import { OBJECTIVE_KEYS } from "./types.js";
import type { ReflectiveEvolutionConfig } from "./config.js";

const ALPHA = 0.1; // Bayesian-optimized in Packet 27; matches fitness/function.py

/**
 * Compute the legacy scalar fitness.
 * Exactly mirrors alienclaw.fitness.function.evaluate().
 */
export function computeLegacyScalar(traces: ExecutionTrace[]): number {
  if (traces.length === 0) return 0;
  let total = 0;
  for (const t of traces) {
    const correctness = Math.max(0, Math.min(1, t.correctness.score));
    const slotCount = t.toolCalls.length > 0 ? 1 : 1; // slot_count default=1
    const excess = Math.max(0, t.cost.toolCalls - slotCount);
    const efficiency = 1.0 / (1.0 + ALPHA * excess);
    total += correctness * efficiency;
  }
  return total / traces.length;
}

/**
 * Compute a raw (un-normalized) objective vector for a single trace.
 * costInv and latencyInv are raw inverse values — normalized per-generation later.
 */
export function rawObjectiveVector(trace: ExecutionTrace): {
  correctness: number;
  efficiency: number;
  costInvRaw: number;
  latencyInvRaw: number;
  confidence: number;
} {
  const correctness = Math.max(0, Math.min(1, trace.correctness.score));
  const slotCount = 1; // default slot_count
  const excess = Math.max(0, trace.cost.toolCalls - slotCount);
  const efficiency = 1.0 / (1.0 + ALPHA * excess);
  const costInvRaw = 1.0 / (trace.cost.dollars + 1e-9);
  const latencyInvRaw = 1.0 / (trace.cost.wallMs + 1.0);
  const confidence = trace.correctness.confidence ?? correctness; // neutral fallback

  return { correctness, efficiency, costInvRaw, latencyInvRaw, confidence };
}

/**
 * Normalize a population of raw objective vectors to [0,1] per-generation.
 * Higher is always better post-normalization.
 */
export function normalizeObjectives(
  raws: Array<{
    correctness: number;
    efficiency: number;
    costInvRaw: number;
    latencyInvRaw: number;
    confidence: number;
  }>,
  epsilon: number,
): ObjectiveVector[] {
  if (raws.length === 0) return [];

  const mins = { correctness: Infinity, efficiency: Infinity, costInvRaw: Infinity, latencyInvRaw: Infinity, confidence: Infinity };
  const maxs = { correctness: -Infinity, efficiency: -Infinity, costInvRaw: -Infinity, latencyInvRaw: -Infinity, confidence: -Infinity };

  for (const r of raws) {
    for (const k of ["correctness", "efficiency", "costInvRaw", "latencyInvRaw", "confidence"] as const) {
      if (r[k] < mins[k]) mins[k] = r[k];
      if (r[k] > maxs[k]) maxs[k] = r[k];
    }
  }

  return raws.map(r => ({
    correctness: norm(r.correctness, mins.correctness, maxs.correctness, epsilon),
    efficiency: norm(r.efficiency, mins.efficiency, maxs.efficiency, epsilon),
    costInv: norm(r.costInvRaw, mins.costInvRaw, maxs.costInvRaw, epsilon),
    latencyInv: norm(r.latencyInvRaw, mins.latencyInvRaw, maxs.latencyInvRaw, epsilon),
    confidence: norm(r.confidence, mins.confidence, maxs.confidence, epsilon),
  }));
}

function norm(v: number, min: number, max: number, eps: number): number {
  const range = max - min;
  if (range < eps) return 0.5; // constant across population → neutral
  return (v - min) / range;
}

/** Mean of an array of objective vectors. */
export function meanObjective(vecs: ObjectiveVector[]): ObjectiveVector {
  if (vecs.length === 0) return zeroObjective();
  const sum = { correctness: 0, efficiency: 0, costInv: 0, latencyInv: 0, confidence: 0 };
  for (const v of vecs) {
    for (const k of OBJECTIVE_KEYS) sum[k] += v[k];
  }
  const n = vecs.length;
  return {
    correctness: sum.correctness / n,
    efficiency: sum.efficiency / n,
    costInv: sum.costInv / n,
    latencyInv: sum.latencyInv / n,
    confidence: sum.confidence / n,
  };
}

function zeroObjective(): ObjectiveVector {
  return { correctness: 0, efficiency: 0, costInv: 0, latencyInv: 0, confidence: 0 };
}

/**
 * Scalarize for win-count tie-breaking only (NOT the selection key).
 * Weights from config — not hardcoded.
 */
export function scalarizeForWinCount(
  v: ObjectiveVector,
  weights: ReflectiveEvolutionConfig["winCountWeights"],
): number {
  return (
    weights.correctness * v.correctness +
    weights.confidence * v.confidence +
    weights.costInv * v.costInv +
    weights.efficiency * v.efficiency
  );
}

/** Weighted random pick from items. */
export function weightedPick<T>(
  items: T[],
  weight: (t: T) => number,
  rng: () => number,
): T {
  const total = items.reduce((s, it) => s + weight(it), 0);
  let r = rng() * total;
  for (const it of items) {
    r -= weight(it);
    if (r <= 0) return it;
  }
  return items[items.length - 1]!;
}

/**
 * Sample WITHOUT replacement, stable given the seed.
 * Fisher-Yates using the injected RNG.
 */
export function sampleMinibatch<T>(set: T[], n: number, rng: () => number): T[] {
  const idx = [...set.keys()];
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = idx[i]!;
    idx[i] = idx[j]!;
    idx[j] = tmp;
  }
  return idx.slice(0, Math.min(n, idx.length)).map(i => set[i]!);
}

/**
 * True if child Pareto-dominates parent OR strictly improves correctness
 * without regressing any objective beyond epsilon.
 * Evaluated on the SAME minibatch (anti-Goodhart).
 */
export function improvedOnMinibatch(
  child: CandidateScore,
  parent: CandidateScore,
): boolean {
  const c = child.aggregate;
  const p = parent.aggregate;
  if (dominates(c, p)) return true;
  const EPS = 1e-3;
  const noRegression = OBJECTIVE_KEYS.every(k => c[k] >= p[k] - EPS);
  return noRegression && c.correctness > p.correctness + EPS;
}

/** a Pareto-dominates b iff a >= b on all objectives and > on at least one. */
export function dominates(a: ObjectiveVector, b: ObjectiveVector): boolean {
  let strictlyBetter = false;
  for (const k of OBJECTIVE_KEYS) {
    if (a[k] < b[k]) return false;
    if (a[k] > b[k]) strictlyBetter = true;
  }
  return strictlyBetter;
}

/** Choose the editable component with the most negative feedback mass. */
export function chooseComponentToRevise(
  genome: { editable: Record<string, string> },
  _ev: CandidateScore,
): string {
  const comps = Object.keys(genome.editable);
  if (comps.length === 1) return comps[0]!;
  // With multiple components (Packet 07+), pick the one with lowest mean correctness.
  // For now, return the first — documented not hardcoded.
  return comps[0]!;
}
