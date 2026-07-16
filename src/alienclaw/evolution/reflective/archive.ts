/**
 * ParetoArchive — non-dominated set of genome candidates.
 *
 * Selection key: Pareto dominance over aggregate ObjectiveVector.
 * Stochastic sample favors candidates winning on more task instances.
 *
 * Packet 04 note: sampleForMutation is the seed of quality-diversity.
 * Packet 04 replaces win-count with a MAP-Elites grid. Keep frontier()/dominates stable.
 */
import type { CandidateScore, ObjectiveVector } from "./types.js";
import type { ReflectiveEvolutionConfig } from "./config.js";
import { dominates, scalarizeForWinCount, weightedPick } from "./objectives.js";

export class ParetoArchive {
  private readonly candidates = new Map<string, CandidateScore>();

  add(score: CandidateScore): void {
    this.candidates.set(score.genomeId, score);
  }

  size(): number {
    return this.candidates.size;
  }

  has(genomeId: string): boolean {
    return this.candidates.has(genomeId);
  }

  /** a Pareto-dominates b over aggregate vectors. */
  static dominates(a: ObjectiveVector, b: ObjectiveVector): boolean {
    return dominates(a, b);
  }

  /**
   * Non-dominated set over aggregate objective vectors.
   * Stable (Packet 04 extends this).
   */
  frontier(): CandidateScore[] {
    const all = [...this.candidates.values()];
    return all.filter(
      c =>
        !all.some(
          o =>
            o.genomeId !== c.genomeId &&
            ParetoArchive.dominates(o.aggregate, c.aggregate),
        ),
    );
  }

  /**
   * GEPA-style stochastic selection: favor frontier candidates that WIN on
   * the most task instances (per-instance argmax count), preserving specialists.
   *
   * Returns null if archive is empty.
   */
  sampleForMutation(
    rng: () => number,
    weights: ReflectiveEvolutionConfig["winCountWeights"],
  ): CandidateScore | null {
    const front = this.frontier();
    if (front.length === 0) return null;

    const wins = new Map<string, number>();
    const instanceIds = this.allInstanceIds();

    for (const taskId of instanceIds) {
      let best: { id: string; v: number } | null = null;
      for (const c of front) {
        const vec = c.perInstance.get(taskId);
        if (!vec) continue;
        const v = scalarizeForWinCount(vec, weights);
        if (!best || v > best.v) best = { id: c.genomeId, v };
      }
      if (best) wins.set(best.id, (wins.get(best.id) ?? 0) + 1);
    }

    return weightedPick(front, c => 1 + (wins.get(c.genomeId) ?? 0), rng);
  }

  /**
   * Pick two frontier candidates winning on disjoint task sets.
   * Used for system-aware merge.
   */
  pickDisjointFrontierPair(
    rng: () => number,
    weights: ReflectiveEvolutionConfig["winCountWeights"],
  ): [CandidateScore, CandidateScore] | null {
    const front = this.frontier();
    if (front.length < 2) return null;

    const instanceIds = this.allInstanceIds();
    const winTasks = new Map<string, Set<string>>();
    for (const c of front) {
      const tasks = new Set<string>();
      for (const taskId of instanceIds) {
        let best: { id: string; v: number } | null = null;
        for (const f of front) {
          const vec = f.perInstance.get(taskId);
          if (!vec) continue;
          const v = scalarizeForWinCount(vec, weights);
          if (!best || v > best.v) best = { id: f.genomeId, v };
        }
        if (best?.id === c.genomeId) tasks.add(taskId);
      }
      winTasks.set(c.genomeId, tasks);
    }

    // Find a pair with minimal overlap in winning tasks
    let bestPair: [CandidateScore, CandidateScore] | null = null;
    let bestDisjoint = -1;
    for (let i = 0; i < front.length; i++) {
      for (let j = i + 1; j < front.length; j++) {
        const ai = winTasks.get(front[i]!.genomeId) ?? new Set();
        const bj = winTasks.get(front[j]!.genomeId) ?? new Set();
        const intersection = [...ai].filter(t => bj.has(t)).length;
        const disjoint = ai.size + bj.size - 2 * intersection;
        if (disjoint > bestDisjoint) {
          bestDisjoint = disjoint;
          bestPair = [front[i]!, front[j]!];
        }
      }
    }
    return bestPair;
  }

  private allInstanceIds(): string[] {
    const ids = new Set<string>();
    for (const c of this.candidates.values()) {
      for (const id of c.perInstance.keys()) ids.add(id);
    }
    return [...ids];
  }

  /** Serialize for persistence. */
  snapshot(): CandidateScore[] {
    return [...this.candidates.values()];
  }
}
