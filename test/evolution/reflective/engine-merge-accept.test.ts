/**
 * PKT-910 — direct coverage for the merge-accept success path inside
 * src/alienclaw/evolution/reflective/engine.ts L218-222:
 *
 *   if (improvedOnMinibatch(mEval.scores, childEval.scores)) {
 *     archive.add(mEval.scores);
 *     await cfg.persist.snapshotFrontier(archive.frontier(), state.generation++);
 *     log(`re.merge.accepted merged=${merged.id.slice(0, 8)}`);
 *   }
 *
 * Coverage gap: PKT-271-B (engine.test.ts:397) only asserts the merge BRANCH
 * was entered (lineage edge recorded). It does NOT assert:
 *   1. improvedOnMinibatch === true → archive.add + snapshotFrontier fire
 *   2. improvedOnMinibatch === false → archive.add is NOT called (negative arm)
 *   3. the merged genome appears in the FINAL frontier result
 *
 * This file closes the gap with two deterministic tests:
 *   - "merged genome with higher aggregate is added to archive + snapshot"
 *       (success arm, L218-223 positive path)
 *   - "merged genome with lower aggregate is NOT added to archive"
 *       (negative arm, L218 evaluates to false → no archive mutation)
 *
 * Family: pure branch coverage (no source change). Mirrors PKT-883 (PR #544 MERGED
 * 2026-08-23) pattern: an existing probe in working tree was promoted to a
 * permanent test by stripping debug noise and adding the inverse arm.
 *
 * Drop-in location: test/evolution/reflective/engine-merge-accept.test.ts
 *
 * Run standalone:
 *   pnpm exec vitest run test/evolution/reflective/engine-merge-accept.test.ts
 */
import { describe, it, expect } from "vitest";
import { runReflectiveEvolution } from "../../../src/alienclaw/evolution/reflective/engine.js";
import { InMemoryEvolutionStore } from "../../../src/alienclaw/evolution/reflective/store.js";
import { DEFAULT_CONFIG } from "../../../src/alienclaw/evolution/reflective/config.js";
import { MockReflector } from "../../../src/alienclaw/evolution/reflective/reflector.js";
import { MockProposer } from "../../../src/alienclaw/evolution/reflective/proposer.js";
import { makeTestGenome } from "./mock-adapter.js";
import type {
  Genome,
  TaskInstance,
  EvaluationBatch,
  ObjectiveVector,
  CandidateScore,
} from "../../../src/alienclaw/evolution/reflective/types.js";
import type { GenomeAdapter } from "../../../src/alienclaw/evolution/reflective/adapter.js";

/**
 * ControlledAdapter — returns canned per-instance objective vectors keyed to
 * specific genome ids (not prefixes, since makeTestGenome ids are sha256 hex).
 * Tests pass the winning/losing ids; everything else gets the 0.5 baseline.
 */
class ControlledAdapter implements GenomeAdapter {
  constructor(
    private readonly winningId: string | null,
    private readonly losingId: string | null,
  ) {}
  async evaluate(candidate: Genome, batch: TaskInstance[]): Promise<EvaluationBatch> {
    const isWinner = this.winningId !== null && candidate.id === this.winningId;
    const isLoser = this.losingId !== null && candidate.id === this.losingId;
    const perInstance = new Map<string, ObjectiveVector>();
    for (const t of batch) {
      let v: ObjectiveVector;
      if (isWinner) {
        v = { correctness: 0.9, efficiency: 0.9, costInv: 0.9, latencyInv: 0.9, confidence: 0.9 };
      } else if (isLoser) {
        v = { correctness: 0.1, efficiency: 0.1, costInv: 0.1, latencyInv: 0.1, confidence: 0.1 };
      } else {
        // parents + non-merge children: 0.5 baseline
        v = { correctness: 0.5, efficiency: 0.5, costInv: 0.5, latencyInv: 0.5, confidence: 0.5 };
      }
      perInstance.set(t.id, v);
    }
    const aggregate = isWinner
      ? { correctness: 0.9, efficiency: 0.9, costInv: 0.9, latencyInv: 0.9, confidence: 0.9 }
      : isLoser
      ? { correctness: 0.1, efficiency: 0.1, costInv: 0.1, latencyInv: 0.1, confidence: 0.1 }
      : { correctness: 0.5, efficiency: 0.5, costInv: 0.5, latencyInv: 0.5, confidence: 0.5 };
    const scores: CandidateScore = {
      genomeId: candidate.id,
      perInstance,
      aggregate,
      legacyScalar: isWinner ? 0.9 : isLoser ? 0.1 : 0.5,
    };
    return { candidate, scores, traces: [] };
  }
  makeReflectiveDataset(): Record<string, never[]> { return {}; }
}

function makeRng(seed = 42): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe("PKT-910: merge-accept path inside engine.ts L218-222", () => {
  it("merged genome with higher aggregate than parents is added to archive + snapshot", async () => {
    // All training tasks equidistant from g1=[0,0] and g2=[1,1] (parents get
    // correctness 0.5 baseline). ControlledAdapter returns 0.9 for the
    // winningMerged genome → improvedOnMinibatch(0.9, 0.5) === true →
    // archive.add + snapshotFrontier fires.
    const train = [
      { id: "t-m0", input: {}, target: [0.5, 0.5] },
      { id: "t-m1", input: {}, target: [0.5, 0.5] },
      { id: "t-m2", input: {}, target: [0.5, 0.5] },
    ] as unknown as TaskInstance[];
    const val = [{ id: "t-mv", input: {}, target: [0.5, 0.5] }] as unknown as TaskInstance[];

    const g1 = makeTestGenome([0.0, 0.0]);
    const g2 = makeTestGenome([1.0, 1.0]);
    const winningMerged = makeTestGenome([0.5, 0.5], "WIN");

    const store = new InMemoryEvolutionStore();
    store.genomes.set(g1.id, g1);
    store.genomes.set(g2.id, g2);
    store.genomes.set(winningMerged.id, winningMerged);

    const proposer = new MockProposer(new Map([
      [g1.id, g1],
      [g2.id, g2],
      [winningMerged.id, winningMerged],
    ]));
    (proposer as unknown as Record<string, unknown>).merge = async () => winningMerged;

    const adapter = new ControlledAdapter(winningMerged.id, null);

    const snapshotsBefore = store.snapshots.length;

    const result = await runReflectiveEvolution({
      adapter,
      reflector: new MockReflector(),
      proposer,
      seedCandidates: [g1, g2],
      trainset: train,
      valset: val,
      maxMetricCalls: 50,
      minibatchSize: 3,
      rng: makeRng(7),
      persist: store,
      config: { ...DEFAULT_CONFIG, mergeProbability: 1.0 },
      validate: (_g) => ({ ok: true }),
    });

    // (1) merge branch fired (lineage edge exists)
    expect(store.lineage.some(e => e.op === "merge")).toBe(true);

    // (2) improvedOnMinibatch(merge, child) === true → archive.add fired
    //     → snapshotFrontier recorded a new snapshot AFTER the seed eval
    expect(store.snapshots.length).toBeGreaterThan(snapshotsBefore);

    // (3) the merged genome is in the FINAL frontier returned by the engine
    expect(result.frontier.some(c => c.genomeId === winningMerged.id)).toBe(true);
  }, 30_000);

  it("merged genome with LOWER aggregate than parents is NOT added to archive", async () => {
    // Same geometry as above, but ControlledAdapter returns 0.1 for the
    // losingMerged genome → improvedOnMinibatch(0.1, 0.5) === false →
    // archive.add is NOT called. This is the L218 negative arm — the body of
    // the if-block never executes.
    const train = [
      { id: "t-m0", input: {}, target: [0.5, 0.5] },
      { id: "t-m1", input: {}, target: [0.5, 0.5] },
      { id: "t-m2", input: {}, target: [0.5, 0.5] },
    ] as unknown as TaskInstance[];
    const val = [{ id: "t-mv", input: {}, target: [0.5, 0.5] }] as unknown as TaskInstance[];

    const g1 = makeTestGenome([0.0, 0.0]);
    const g2 = makeTestGenome([1.0, 1.0]);
    const losingMerged = makeTestGenome([0.5, 0.5], "LOSE");

    const store = new InMemoryEvolutionStore();
    store.genomes.set(g1.id, g1);
    store.genomes.set(g2.id, g2);
    store.genomes.set(losingMerged.id, losingMerged);

    const proposer = new MockProposer(new Map([
      [g1.id, g1],
      [g2.id, g2],
      [losingMerged.id, losingMerged],
    ]));
    (proposer as unknown as Record<string, unknown>).merge = async () => losingMerged;

    const adapter = new ControlledAdapter(null, losingMerged.id);

    const result = await runReflectiveEvolution({
      adapter,
      reflector: new MockReflector(),
      proposer,
      seedCandidates: [g1, g2],
      trainset: train,
      valset: val,
      maxMetricCalls: 50,
      minibatchSize: 3,
      rng: makeRng(7),
      persist: store,
      config: { ...DEFAULT_CONFIG, mergeProbability: 1.0 },
      validate: (_g) => ({ ok: true }),
    });

    // (1) merge branch DID fire (lineage edge exists)
    expect(store.lineage.some(e => e.op === "merge")).toBe(true);

    // (2) merged genome was evaluated
    expect(
      store.evaluations.some(e => e.candidate.id === losingMerged.id),
    ).toBe(true);

    // (3) but it is NOT in the final frontier — improvedOnMinibatch rejected it
    expect(result.frontier.some(c => c.genomeId === losingMerged.id)).toBe(false);
  }, 30_000);
});
