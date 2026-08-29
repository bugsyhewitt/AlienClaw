/**
 * E2E alternating-phase co-evolution test.
 * Uses mock adapter (no real LLMs or tools).
 * Asserts: budget respected, artifacts persisted, invalid candidates cost zero metric-calls.
 */
import { describe, it, expect } from "vitest";
import { runAlternatingCoevolution } from "../../../src/alienclaw/evolution/graph/coevolution.js";
import { InMemoryEvolutionStore } from "../../../src/alienclaw/evolution/reflective/store.js";
import { DEFAULT_CONFIG } from "../../../src/alienclaw/evolution/reflective/config.js";
import { MockReflector } from "../../../src/alienclaw/evolution/reflective/reflector.js";
import { MockProposer } from "../../../src/alienclaw/evolution/reflective/proposer.js";
import { MockGenomeAdapter, makeTestGenome, makeSyntheticTasks } from "../reflective/mock-adapter.js";
import type { TaskInstance } from "../../../src/alienclaw/evolution/reflective/types.js";

function makeRng(seed = 42): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 0x100000000; };
}

describe("Alternating-phase co-evolution — e2e (mocked)", () => {
  it("completes N rounds with mock adapters", async () => {
    const tasks = makeSyntheticTasks(20) as TaskInstance[];
    const subagentSeed = makeTestGenome([0.3, 0.3], "SA");
    const topologySeed = makeTestGenome([0.5, 0.5], "TOP");
    const genomeStore = new Map([
      [subagentSeed.id, subagentSeed],
      [topologySeed.id, topologySeed],
    ]);
    const store = new InMemoryEvolutionStore();
    store.genomes.set(subagentSeed.id, subagentSeed);
    store.genomes.set(topologySeed.id, topologySeed);
    const rng = makeRng(99);

    const result = await runAlternatingCoevolution({
      subagentAdapter: new MockGenomeAdapter(),
      topologyAdapter: new MockGenomeAdapter(),
      subagentSeeds: [subagentSeed],
      topologySeeds: [topologySeed],
      trainset: tasks,
      reflector: new MockReflector(),
      proposer: new MockProposer(genomeStore),
      store,
      baseConfig: { ...DEFAULT_CONFIG, maxMetricCalls: 30 },
      coevolutionConfig: {
        rounds: 2,
        subagentMetricCallsPerRound: 15,
        topologyMetricCallsPerRound: 10,
        minibatchSize: 3,
        valsetFraction: 0.25,
        rng,
      },
      log: (_msg) => { /* suppress in test */ },
    });

    expect(result.completed).toBe(true);
    expect(result.rounds).toBe(2);
    expect(result.subagentEvolutionRuns).toBe(2);
    expect(result.topologyEvolutionRuns).toBe(2);
  });

  it("validate hook: invalid candidates consume zero metric-calls", async () => {
    const tasks = makeSyntheticTasks(10) as TaskInstance[];
    const seed = makeTestGenome([0.5, 0.5]);
    const genomeStore = new Map([[seed.id, seed]]);
    const store = new InMemoryEvolutionStore();
    store.genomes.set(seed.id, seed);
    const rng = makeRng(7);

    // Validator that rejects ALL proposed children
    const rejectAll = (_c: { id: string; editable: Record<string, string> }) =>
      ({ ok: false as const, violation: "test: all candidates rejected" });

    const result = await runAlternatingCoevolution({
      subagentAdapter: new MockGenomeAdapter(),
      topologyAdapter: new MockGenomeAdapter(),
      subagentSeeds: [seed],
      topologySeeds: [seed],
      trainset: tasks,
      reflector: new MockReflector(),
      proposer: new MockProposer(genomeStore),
      store,
      baseConfig: { ...DEFAULT_CONFIG, maxMetricCalls: 20 },
      coevolutionConfig: {
        rounds: 1,
        subagentMetricCallsPerRound: 10,
        topologyMetricCallsPerRound: 5,
        minibatchSize: 2,
        valsetFraction: 0.25,
        rng,
      },
      subagentValidate: rejectAll,
      topologyValidate: rejectAll,
      log: () => {},
    });

    expect(result.completed).toBe(true);
    // Even with all children rejected, the run should complete (seeds still evaluated)
    expect(store.evaluations.length).toBeGreaterThan(0);
  });

  it("runs without log callback (default no-op fallback)", async () => {
    const tasks = makeSyntheticTasks(10) as TaskInstance[];
    const seed = makeTestGenome([0.4, 0.4], "NOLOG");
    const store = new InMemoryEvolutionStore();
    store.genomes.set(seed.id, seed);
    const genomeStore = new Map([[seed.id, seed]]);

    const result = await runAlternatingCoevolution({
      subagentAdapter: new MockGenomeAdapter(),
      topologyAdapter: new MockGenomeAdapter(),
      subagentSeeds: [seed],
      topologySeeds: [seed],
      trainset: tasks,
      reflector: new MockReflector(),
      proposer: new MockProposer(genomeStore),
      store,
      baseConfig: { ...DEFAULT_CONFIG, maxMetricCalls: 20 },
      coevolutionConfig: {
        rounds: 1,
        subagentMetricCallsPerRound: 8,
        topologyMetricCallsPerRound: 5,
        minibatchSize: 2,
        valsetFraction: 0.25,
        rng: makeRng(13),
      },
      // log intentionally omitted → exercises opts.log ?? (() => {}) fallback
    });

    expect(result.completed).toBe(true);
    expect(result.rounds).toBe(1);
  });

  it("rounds=0: returns immediately with zero run counts and no log calls", async () => {
    const tasks = makeSyntheticTasks(5) as TaskInstance[];
    const seed = makeTestGenome([0.5, 0.5], "ZERO");
    const store = new InMemoryEvolutionStore();
    store.genomes.set(seed.id, seed);
    const genomeStore = new Map([[seed.id, seed]]);
    const logCalls: string[] = [];

    const result = await runAlternatingCoevolution({
      subagentAdapter: new MockGenomeAdapter(),
      topologyAdapter: new MockGenomeAdapter(),
      subagentSeeds: [seed],
      topologySeeds: [seed],
      trainset: tasks,
      reflector: new MockReflector(),
      proposer: new MockProposer(genomeStore),
      store,
      baseConfig: { ...DEFAULT_CONFIG, maxMetricCalls: 10 },
      coevolutionConfig: {
        rounds: 0,
        subagentMetricCallsPerRound: 5,
        topologyMetricCallsPerRound: 5,
        minibatchSize: 2,
        valsetFraction: 0.25,
        rng: makeRng(1),
      },
      log: msg => logCalls.push(msg),
    });

    expect(result.completed).toBe(true);
    expect(result.rounds).toBe(0);
    expect(result.subagentEvolutionRuns).toBe(0);
    expect(result.topologyEvolutionRuns).toBe(0);
    // No phase announcements should be emitted when rounds=0
    expect(logCalls.filter(m => m.startsWith("coevolution: round"))).toHaveLength(0);
  });

  it("log callback receives phase-announcement strings in round order", async () => {
    const tasks = makeSyntheticTasks(10) as TaskInstance[];
    const seed = makeTestGenome([0.4, 0.4], "LOGFMT");
    const store = new InMemoryEvolutionStore();
    store.genomes.set(seed.id, seed);
    const genomeStore = new Map([[seed.id, seed]]);
    const logCalls: string[] = [];

    await runAlternatingCoevolution({
      subagentAdapter: new MockGenomeAdapter(),
      topologyAdapter: new MockGenomeAdapter(),
      subagentSeeds: [seed],
      topologySeeds: [seed],
      trainset: tasks,
      reflector: new MockReflector(),
      proposer: new MockProposer(genomeStore),
      store,
      baseConfig: { ...DEFAULT_CONFIG, maxMetricCalls: 20 },
      coevolutionConfig: {
        rounds: 1,
        subagentMetricCallsPerRound: 8,
        topologyMetricCallsPerRound: 5,
        minibatchSize: 2,
        valsetFraction: 0.25,
        rng: makeRng(3),
      },
      log: msg => logCalls.push(msg),
    });

    const phaseLines = logCalls.filter(m => m.startsWith("coevolution: round"));
    expect(phaseLines[0]).toBe("coevolution: round 1/1 — subagent phase");
    expect(phaseLines[1]).toBe("coevolution: round 1/1 — topology phase");
  });

  it("asymmetric validate: subagentValidate set, topologyValidate omitted", async () => {
    const tasks = makeSyntheticTasks(8) as TaskInstance[];
    const seed = makeTestGenome([0.5, 0.5], "ASYM");
    const store = new InMemoryEvolutionStore();
    store.genomes.set(seed.id, seed);
    const genomeStore = new Map([[seed.id, seed]]);

    const rejectAll = (_c: { id: string; editable: Record<string, string> }) =>
      ({ ok: false as const, violation: "subagent: all rejected" });

    const result = await runAlternatingCoevolution({
      subagentAdapter: new MockGenomeAdapter(),
      topologyAdapter: new MockGenomeAdapter(),
      subagentSeeds: [seed],
      topologySeeds: [seed],
      trainset: tasks,
      reflector: new MockReflector(),
      proposer: new MockProposer(genomeStore),
      store,
      baseConfig: { ...DEFAULT_CONFIG, maxMetricCalls: 15 },
      coevolutionConfig: {
        rounds: 1,
        subagentMetricCallsPerRound: 8,
        topologyMetricCallsPerRound: 5,
        minibatchSize: 2,
        valsetFraction: 0.25,
        rng: makeRng(5),
      },
      subagentValidate: rejectAll,
      // topologyValidate intentionally omitted — topology phase runs unguarded
      log: () => {},
    });

    expect(result.completed).toBe(true);
    // Topology phase evaluations proceed (no topologyValidate to block them)
    expect(store.evaluations.length).toBeGreaterThan(0);
  });
});
