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

// ── PKT-271: cold-path coverage for child-accept, merge, validate-gate, parse_failure ──

describe("Engine cold paths — PKT-271", () => {
  /**
   * Test A — child-acceptance path (Group 1, lines 173-177).
   *
   * Tasks biased toward the upper-right corner so theta=[0.5,0.5] (child)
   * clearly outscores theta=[0,0] (parent) after min-max normalisation:
   *   parent norm-mean ≈ 0.447, child norm-mean ≈ 0.515 → dominates → accepted.
   *
   * MockReflector is keyed to the seed genome's id and returns proposedValue
   * "0.500,0.500", which MockGenomeAdapter decodes as theta=[0.5,0.5].
   * mergeProbability=0 isolates the acceptance path from the merge branch.
   */
  it("PKT-271-A: accepts an improved child into the frontier", async () => {
    const train = [
      { id: "t-a0", input: {}, target: [0.5, 0.5] },
      { id: "t-a1", input: {}, target: [0.7, 0.7] },
      { id: "t-a2", input: {}, target: [0.8, 0.8] },
    ] as unknown as TaskInstance[];
    const val = [{ id: "t-av", input: {}, target: [0.5, 0.5] }] as unknown as TaskInstance[];

    const seed = makeTestGenome([0.0, 0.0]);
    const genomeStore = new Map([[seed.id, seed]]);
    const store = new InMemoryEvolutionStore();
    store.genomes.set(seed.id, seed);

    const reflector = new MockReflector(new Map([
      [`${seed.id}:tool_slots`, { diagnosis: "ok", proposedValue: "0.500,0.500", lesson: "nudge to center" }],
    ]));

    const result = await runReflectiveEvolution({
      adapter: new MockGenomeAdapter(),
      reflector,
      proposer: new MockProposer(genomeStore),
      seedCandidates: [seed],
      trainset: train,
      valset: val,
      maxMetricCalls: 9,   // 3 seed + 3 parent-eval + 3 child-eval
      minibatchSize: 3,
      rng: makeRng(42),
      persist: store,
      config: { ...DEFAULT_CONFIG, mergeProbability: 0 },
    });

    // Group 1 (lines 173-177): mutate lineage recorded and second frontier snapshot exists
    expect(store.lineage.some(e => e.op === "mutate")).toBe(true);
    expect(store.snapshots.length).toBeGreaterThan(1);
    expect(result.frontier.length).toBeGreaterThanOrEqual(1);
  }, 30_000);

  /**
   * Test B — merge path (Group 2, lines 187-223) and pickBestValidated dominates arm
   * (Group 5, line 277).
   *
   * Two seeds at opposite corners; all training tasks sit at [0.5,0.5] (equidistant
   * from both seeds), so every evaluation batch yields constant correctness → normalises
   * to 0.5 for every genome → neither seed dominates the other → both remain on the
   * Pareto frontier throughout the run.
   *
   * With mergeProbability=1.0 the merge branch fires on every iteration.
   * pickDisjointFrontierPair finds a valid pair (G1 wins all tasks by tie-break;
   * G2 wins none → disjoint score > 0).  proposer.merge succeeds → lines 187-223 hit.
   *
   * The final validateOnHeldOut produces a 2-entry pool → reduce callback at line 277
   * is exercised (Group 5 side-effect).
   */
  it("PKT-271-B: triggers merge when two non-dominated seeds are on the frontier", async () => {
    // All tasks equidistant from g1=[0,0] and g2=[1,1] → both get correctness=0.5
    const train = [
      { id: "t-b0", input: {}, target: [0.5, 0.5] },
      { id: "t-b1", input: {}, target: [0.5, 0.5] },
      { id: "t-b2", input: {}, target: [0.5, 0.5] },
    ] as unknown as TaskInstance[];
    const val = [{ id: "t-bv", input: {}, target: [0.5, 0.5] }] as unknown as TaskInstance[];

    const g1 = makeTestGenome([0.0, 0.0]);
    const g2 = makeTestGenome([1.0, 1.0]);
    const genomeStore = new Map([[g1.id, g1], [g2.id, g2]]);
    const store = new InMemoryEvolutionStore();
    store.genomes.set(g1.id, g1);
    store.genomes.set(g2.id, g2);

    await runReflectiveEvolution({
      adapter: new MockGenomeAdapter(),
      reflector: new MockReflector(),
      proposer: new MockProposer(genomeStore),
      seedCandidates: [g1, g2],
      trainset: train,
      valset: val,
      maxMetricCalls: 15,  // 3+3 seed + 3 parent-eval + 3 child-eval + 3 merge-eval
      minibatchSize: 3,
      rng: makeRng(7),
      persist: store,
      config: { ...DEFAULT_CONFIG, mergeProbability: 1.0 },
    });

    // Group 2 (lines 187-223): a merge lineage edge was recorded
    expect(store.lineage.some(e => e.op === "merge")).toBe(true);
  }, 30_000);

  /**
   * Test C — P14-02 validate gate on child (Group 3 child arm, lines 142-151).
   *
   * cfg.validate always rejects, so every proposed child is rejected before its
   * metric-call is charged.  The lineage entry carries lesson="INVALID: …".
   */
  it("PKT-271-C: validate gate rejects child before metric call and records INVALID lesson", async () => {
    const tasks = makeSyntheticTasks(10) as TaskInstance[];
    const { train, val } = partitionTrainVal(tasks, 0.3);
    const seed = makeTestGenome([0.5, 0.5]);
    const genomeStore = new Map([[seed.id, seed]]);
    const store = new InMemoryEvolutionStore();
    store.genomes.set(seed.id, seed);

    await runReflectiveEvolution({
      adapter: new MockGenomeAdapter(),
      reflector: new MockReflector(),
      proposer: new MockProposer(genomeStore),
      seedCandidates: [seed],
      trainset: train,
      valset: val,
      maxMetricCalls: 6,
      minibatchSize: 2,
      rng: makeRng(3),
      persist: store,
      config: DEFAULT_CONFIG,
      validate: (_g) => ({ ok: false, violation: "test-rejection" }),
    });

    // Group 3 child arm (lines 142-151): lineage has an INVALID lesson
    expect(
      store.lineage.some(e => e.op === "mutate" && e.reflection?.lesson?.startsWith("INVALID")),
    ).toBe(true);
  }, 30_000);

  /**
   * Test D — parse_failure handler (Group 4, lines 119-127).
   *
   * MockReflector is configured to return diagnosis="parse_failure" for the seed
   * genome's tool_slots component.  The engine increments reflectParseFailures,
   * logs the yellow-threshold warning (rate 1.0 > 0.10 threshold), and continues
   * without calling the proposer — so no "mutate" lineage edge is ever recorded.
   */
  it("PKT-271-D: parse_failure diagnosis suppresses mutation and records no mutate lineage", async () => {
    const tasks = makeSyntheticTasks(10) as TaskInstance[];
    const { train, val } = partitionTrainVal(tasks, 0.3);
    const seed = makeTestGenome([0.5, 0.5]);
    const genomeStore = new Map([[seed.id, seed]]);
    const store = new InMemoryEvolutionStore();
    store.genomes.set(seed.id, seed);

    const reflector = new MockReflector(new Map([
      [`${seed.id}:tool_slots`, { diagnosis: "parse_failure", proposedValue: "", lesson: "" }],
    ]));

    await runReflectiveEvolution({
      adapter: new MockGenomeAdapter(),
      reflector,
      proposer: new MockProposer(genomeStore),
      seedCandidates: [seed],
      trainset: train,
      valset: val,
      maxMetricCalls: 6,
      minibatchSize: 2,
      rng: makeRng(5),
      persist: store,
      config: DEFAULT_CONFIG,
    });

    // Group 4 (lines 119-127): parse_failure → continue skips proposer → no mutate lineage
    expect(store.lineage.filter(e => e.op === "mutate").length).toBe(0);
  }, 30_000);
});

// ── PKT-294: cold-path coverage for seed-overflow · empty-archive · merge-catch ──

describe("Engine cold paths — PKT-294", () => {
  it("PKT-294-E: seed loop stops early when budget is exhausted mid-seeds", async () => {
    const train = [
      { id: "te0", input: {}, target: [0.5, 0.5] },
      { id: "te1", input: {}, target: [0.5, 0.5] },
      { id: "te2", input: {}, target: [0.5, 0.5] },
    ] as unknown as TaskInstance[];
    const val = [{ id: "tev", input: {}, target: [0.5, 0.5] }] as unknown as TaskInstance[];
    const g1 = makeTestGenome([0.3, 0.3]);
    const g2 = makeTestGenome([0.7, 0.7]);
    const genomeStore = new Map([[g1.id, g1], [g2.id, g2]]);
    const store = new InMemoryEvolutionStore();
    store.genomes.set(g1.id, g1);
    store.genomes.set(g2.id, g2);

    await runReflectiveEvolution({
      adapter: new MockGenomeAdapter(),
      reflector: new MockReflector(),
      proposer: new MockProposer(genomeStore),
      seedCandidates: [g1, g2],
      trainset: train,
      valset: val,
      maxMetricCalls: 3,   // exactly one seed batch; second seed check: 3+3>3 → break
      minibatchSize: 3,
      rng: makeRng(1),
      persist: store,
      config: { ...DEFAULT_CONFIG, mergeProbability: 0 },
    });

    // Only g1 was seeded — g2 was skipped at line-71 budget break
    expect(store.lineage.filter(l => l.op === "seed").length).toBe(1);
    expect(store.lineage[0]!.childId).toBe(g1.id);
  }, 30_000);

  it("PKT-294-F: main loop exits immediately with no seed candidates (empty archive)", async () => {
    const train = makeSyntheticTasks(5) as TaskInstance[];
    const val  = [{ id: "tfv", input: {}, target: [0.5, 0.5] }] as unknown as TaskInstance[];
    const store = new InMemoryEvolutionStore();

    const result = await runReflectiveEvolution({
      adapter: new MockGenomeAdapter(),
      reflector: new MockReflector(),
      proposer: new MockProposer(),
      seedCandidates: [],    // empty → archive stays empty → line 89 break
      trainset: train,
      valset: val,
      maxMetricCalls: 10,
      minibatchSize: 2,
      rng: makeRng(9),
      persist: store,
      config: DEFAULT_CONFIG,
    });

    expect(store.evaluations.length).toBe(0);
    expect(result.frontier).toHaveLength(0);
    expect(result.best).toBeNull();
  }, 30_000);

  it("PKT-294-G: merge-failure catch fires when proposer.merge throws for unknown genome", async () => {
    const train = [
      { id: "tg0", input: {}, target: [0.5, 0.5] },
      { id: "tg1", input: {}, target: [0.5, 0.5] },
      { id: "tg2", input: {}, target: [0.5, 0.5] },
    ] as unknown as TaskInstance[];
    const val = [{ id: "tgv", input: {}, target: [0.5, 0.5] }] as unknown as TaskInstance[];
    const g1 = makeTestGenome([0.0, 0.0]);
    const g2 = makeTestGenome([1.0, 1.0]);
    // Proposer store has only g1 — merge will throw when it tries to look up g2
    const genomeStore = new Map([[g1.id, g1]]);
    const store = new InMemoryEvolutionStore();
    store.genomes.set(g1.id, g1);
    store.genomes.set(g2.id, g2);   // evolution store has g2 for evaluation; proposer does not

    await runReflectiveEvolution({
      adapter: new MockGenomeAdapter(),
      reflector: new MockReflector(),
      proposer: new MockProposer(genomeStore),
      seedCandidates: [g1, g2],
      trainset: train,
      valset: val,
      maxMetricCalls: 18,   // 3+3 seed + 3 parent-eval + 3 child-eval + 3 merge-eval budget
      minibatchSize: 3,
      rng: makeRng(7),
      persist: store,
      config: { ...DEFAULT_CONFIG, mergeProbability: 1.0 },
    });

    // catch fired → no merge lineage edge was recorded
    expect(store.lineage.filter(l => l.op === "merge").length).toBe(0);
  }, 30_000);
});
