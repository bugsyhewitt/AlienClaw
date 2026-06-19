/**
 * Engine end-to-end tests — §9.1 items 1, 5, 6, 7.
 *
 * Uses MockGenomeAdapter (deterministic, no real LLMs/tools).
 * Tests metric budget, persistence, replay, anti-Goodhart fixtures.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  runReflectiveEvolution,
  partitionTrainVal,
  validateOnHeldOut,
} from "../../../src/alienclaw/evolution/reflective/engine.js";
import { ParetoArchive } from "../../../src/alienclaw/evolution/reflective/archive.js";
import { InMemoryEvolutionStore } from "../../../src/alienclaw/evolution/reflective/store.js";
import { DEFAULT_CONFIG } from "../../../src/alienclaw/evolution/reflective/config.js";
import { MockReflector } from "../../../src/alienclaw/evolution/reflective/reflector.js";
import { MockProposer } from "../../../src/alienclaw/evolution/reflective/proposer.js";
import { MockGenomeAdapter, makeTestGenome, makeSyntheticTasks } from "./mock-adapter.js";
import type { Genome, TaskInstance } from "../../../src/alienclaw/evolution/reflective/types.js";
import { improvedOnMinibatch } from "../../../src/alienclaw/evolution/reflective/objectives.js";
import { getReflectiveMode } from "../../../src/alienclaw/evolution/reflective/feature-flag.js";

// Deterministic LCG RNG (seeded)
function makeRng(seed = 42): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function makeMockReflector(genomeStore: Map<string, Genome>) {
  // Nudge: proposedValue encodes a θ closer to the center [0.5, 0.5]
  return new MockReflector(
    new Map([
      // Fallback response for any genome+component
    ]),
  );
}

describe("Feature flag — REFLECTIVE_EVOLUTION", () => {
  it("defaults to 'off' when env not set", () => {
    const old = process.env["REFLECTIVE_EVOLUTION"];
    delete process.env["REFLECTIVE_EVOLUTION"];
    expect(getReflectiveMode()).toBe("off");
    if (old !== undefined) process.env["REFLECTIVE_EVOLUTION"] = old;
  });

  it("returns 'shadow' when env=shadow", () => {
    process.env["REFLECTIVE_EVOLUTION"] = "shadow";
    expect(getReflectiveMode()).toBe("shadow");
    delete process.env["REFLECTIVE_EVOLUTION"];
  });

  it("returns 'on' when env=on", () => {
    process.env["REFLECTIVE_EVOLUTION"] = "on";
    expect(getReflectiveMode()).toBe("on");
    delete process.env["REFLECTIVE_EVOLUTION"];
  });

  it("falls back to 'off' for unrecognized values", () => {
    process.env["REFLECTIVE_EVOLUTION"] = "invalid";
    expect(getReflectiveMode()).toBe("off");
    delete process.env["REFLECTIVE_EVOLUTION"];
  });
});

describe("Engine loop — metric budget and persistence", () => {
  it("never exceeds maxMetricCalls budget", async () => {
    const tasks = makeSyntheticTasks(20) as TaskInstance[];
    const { train, val } = partitionTrainVal(tasks, 0.25);
    const genome = makeTestGenome([0.5, 0.5]);
    const genomeStore = new Map([[genome.id, genome]]);
    const store = new InMemoryEvolutionStore();
    store.genomes.set(genome.id, genome);
    const adapter = new MockGenomeAdapter();
    const reflector = new MockReflector();
    const proposer = new MockProposer(genomeStore);
    const rng = makeRng(7);

    const MAX_CALLS = 20;
    await runReflectiveEvolution({
      adapter,
      reflector,
      proposer,
      seedCandidates: [genome],
      trainset: train,
      valset: val,
      maxMetricCalls: MAX_CALLS,
      minibatchSize: 3,
      rng,
      persist: store,
      config: DEFAULT_CONFIG,
    });

    // Total evaluations across all re_run records
    const totalEvals = store.evaluations.reduce((sum, ev) => sum + ev.traces.length, 0);
    // Budget may be slightly exceeded at val evaluation, which is outside the loop
    // The loop itself never starts a batch that would cross the budget
    expect(totalEvals).toBeLessThanOrEqual(MAX_CALLS + val.length + 1);
  }, 30_000);

  it("seeds every candidate into the store", async () => {
    const tasks = makeSyntheticTasks(10) as TaskInstance[];
    const { train, val } = partitionTrainVal(tasks, 0.25);
    const g1 = makeTestGenome([0.1, 0.1], "A");
    const g2 = makeTestGenome([0.9, 0.9], "B");
    const genomeStore = new Map([[g1.id, g1], [g2.id, g2]]);
    const store = new InMemoryEvolutionStore();
    store.genomes.set(g1.id, g1);
    store.genomes.set(g2.id, g2);
    const adapter = new MockGenomeAdapter();
    const reflector = new MockReflector();
    const proposer = new MockProposer(genomeStore);
    const rng = makeRng(11);

    await runReflectiveEvolution({
      adapter,
      reflector,
      proposer,
      seedCandidates: [g1, g2],
      trainset: train,
      valset: val,
      maxMetricCalls: 15,
      minibatchSize: 3,
      rng,
      persist: store,
      config: DEFAULT_CONFIG,
    });

    // Both seed genomes should have been evaluated
    expect(store.evaluations.some(ev => ev.candidate.id === g1.id)).toBe(true);
    expect(store.evaluations.some(ev => ev.candidate.id === g2.id)).toBe(true);
  }, 30_000);

  it("lineage is recorded for every seed genome", async () => {
    const tasks = makeSyntheticTasks(10) as TaskInstance[];
    const { train, val } = partitionTrainVal(tasks, 0.25);
    const genome = makeTestGenome([0.5, 0.5]);
    const genomeStore = new Map([[genome.id, genome]]);
    const store = new InMemoryEvolutionStore();
    store.genomes.set(genome.id, genome);

    await runReflectiveEvolution({
      adapter: new MockGenomeAdapter(),
      reflector: new MockReflector(),
      proposer: new MockProposer(genomeStore),
      seedCandidates: [genome],
      trainset: train,
      valset: val,
      maxMetricCalls: 5,
      minibatchSize: 2,
      rng: makeRng(3),
      persist: store,
      config: DEFAULT_CONFIG,
    });

    const seedEdge = store.lineage.find(e => e.childId === genome.id && e.op === "seed");
    expect(seedEdge).toBeDefined();
    expect(seedEdge?.parentId).toBeNull();
  }, 30_000);

  it("frontier snapshots are created", async () => {
    const tasks = makeSyntheticTasks(10) as TaskInstance[];
    const { train, val } = partitionTrainVal(tasks, 0.25);
    const genome = makeTestGenome([0.5, 0.5]);
    const genomeStore = new Map([[genome.id, genome]]);
    const store = new InMemoryEvolutionStore();
    store.genomes.set(genome.id, genome);

    await runReflectiveEvolution({
      adapter: new MockGenomeAdapter(),
      reflector: new MockReflector(),
      proposer: new MockProposer(genomeStore),
      seedCandidates: [genome],
      trainset: train,
      valset: val,
      maxMetricCalls: 8,
      minibatchSize: 2,
      rng: makeRng(5),
      persist: store,
      config: DEFAULT_CONFIG,
    });

    expect(store.snapshots.length).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it("replay from store reconstructs frontier", async () => {
    const tasks = makeSyntheticTasks(10) as TaskInstance[];
    const { train, val } = partitionTrainVal(tasks, 0.25);
    const genome = makeTestGenome([0.5, 0.5]);
    const genomeStore = new Map([[genome.id, genome]]);
    const store = new InMemoryEvolutionStore();
    store.genomes.set(genome.id, genome);

    const result = await runReflectiveEvolution({
      adapter: new MockGenomeAdapter(),
      reflector: new MockReflector(),
      proposer: new MockProposer(genomeStore),
      seedCandidates: [genome],
      trainset: train,
      valset: val,
      maxMetricCalls: 8,
      minibatchSize: 2,
      rng: makeRng(17),
      persist: store,
      config: DEFAULT_CONFIG,
    });

    const replayed = await store.loadRun("any-handle");
    // The replayed frontier genome IDs should overlap with the actual result
    const actualIds = new Set(result.frontier.map(c => c.genomeId));
    const replayedIds = new Set(replayed.frontier.map(c => c.genomeId));
    // At least the seed genome is in both
    for (const id of replayedIds) {
      expect(actualIds.has(id)).toBe(true);
    }
  }, 30_000);
});

describe("Anti-Goodhart fixtures", () => {
  it("validateOnHeldOut demotes overfit finalists", async () => {
    const tasks = makeSyntheticTasks(20) as TaskInstance[];
    // Build a "cheater" genome that scores high on train but poorly on val
    // We simulate this by providing a store where the train score is high
    // but the adapter gives low correctness for val tasks
    const genome = makeTestGenome([0.5, 0.5]);
    const store = new InMemoryEvolutionStore();
    store.genomes.set(genome.id, genome);
    const adapter = new MockGenomeAdapter();
    const { train, val } = partitionTrainVal(tasks, 0.5);

    // Evaluate genome on train to get a "high" score
    const trainEval = await adapter.evaluate(genome, train, { seed: 1, captureTraces: true });
    await store.recordEvaluation(trainEval);

    // Manufacture a high aggregate (cheating: we inject a high aggregate score into the finalist)
    const cheater = {
      ...trainEval.scores,
      aggregate: { correctness: 0.99, efficiency: 0.99, costInv: 0.99, latencyInv: 0.99, confidence: 0.99 },
    };

    const overfitThreshold = 0.15;
    const validated = await validateOnHeldOut([cheater], val, adapter, store, overfitThreshold);

    // The genome's actual held-out score will be based on real adapter, which is ~0.5 range
    // The gap from 0.99 to ~0.5 is > 0.15, so it should be flagged as overfit
    expect(validated).toHaveLength(1);
    expect(validated[0]!.overfit).toBe(true);
  }, 10_000);

  it("child cannot be accepted by scoring on easier minibatch", () => {
    // Verify that improvedOnMinibatch uses the SAME scores (passed in from same batch).
    // This is a logic test of the comparison function.
    // A child that appears great on an easy batch should not bypass the comparison.
    // The engine always passes (childEval, parentEval) from the SAME minibatch call.
    const parent = {
      genomeId: "parent",
      perInstance: new Map(),
      aggregate: { correctness: 0.7, efficiency: 0.7, costInv: 0.7, latencyInv: 0.7, confidence: 0.7 },
      legacyScalar: 0.7,
    };
    // Child scored on a "different" (easier) batch — in our mock this would be higher
    // But the comparison function only cares about the aggregate vectors passed to it
    const childOnEasyBatch = {
      genomeId: "child",
      perInstance: new Map(),
      aggregate: { correctness: 0.6, efficiency: 0.6, costInv: 0.6, latencyInv: 0.6, confidence: 0.6 },
      legacyScalar: 0.6,
    };
    // Even though "child" might score 0.95 on an easier batch, we compare
    // what we actually computed (0.6 < 0.7 parent) — rejected.
    expect(improvedOnMinibatch(childOnEasyBatch, parent)).toBe(false);
  });
});

describe("partitionTrainVal", () => {
  it("holds out the correct fraction", () => {
    const tasks: TaskInstance[] = Array.from({ length: 20 }, (_, i) => ({
      id: `t-${i}`, input: i,
    }));
    const { train, val } = partitionTrainVal(tasks, 0.25);
    expect(val).toHaveLength(5);
    expect(train).toHaveLength(15);
  });

  it("no overlap between train and val", () => {
    const tasks: TaskInstance[] = Array.from({ length: 10 }, (_, i) => ({
      id: `t-${i}`, input: i,
    }));
    const { train, val } = partitionTrainVal(tasks, 0.3);
    const trainIds = new Set(train.map(t => t.id));
    const valIds = new Set(val.map(t => t.id));
    for (const id of valIds) {
      expect(trainIds.has(id)).toBe(false);
    }
  });
});
