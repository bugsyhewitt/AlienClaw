/**
 * PKT-911 — cold-path log line coverage for src/alienclaw/evolution/reflective/engine.ts.
 *
 * The reflective engine main loop emits four log lines on cold/error paths that
 * are NEVER asserted by any existing test. They are the only observability
 * signal an operator has for: proposer mutation failures, merge failures,
 * reflection parse failures, and the parse-failure YELLOW threshold.
 *
 * Coverage gap verified this cycle:
 *
 *   engine.ts:122-124  YELLOW: reflect.parse_failure_rate=N.N% exceeds N% threshold.
 *                     (fires when failRate > cfg.config.reflectParseFailureYellow,
 *                      default 0.10)
 *   engine.ts:126      re.reflect.parse_failure component=<name>
 *                     (fires on every OpusReflector parse-failure return)
 *   engine.ts:135      re.proposer.invalid_genome: <e> — skipping
 *                     (fires when cfg.proposer.applyMutation throws)
 *   engine.ts:190      re.merge.failed
 *                     (fires when cfg.proposer.merge throws inside the merge block)
 *
 * Existing tests indirectly trigger these paths (PKT-271-D, PKT-294-G) but only
 * assert downstream state (lineage length). They never capture the log line.
 * If a future refactor renames or omits any of these log calls, no test catches
 * the regression — operators lose the signal entirely.
 *
 * This file pins all 4 log emissions, plus the negative arm of the YELLOW
 * threshold (`failRate > threshold` strict — equal does NOT fire), with
 * deterministic inputs (seeded LCG, fixed MockReflector / MockProposer responses,
 * no Date.now(), no wall-clock timeouts beyond vitest's 30_000 budget).
 *
 * Drop-in location: test/evolution/reflective/engine-cold-log-coverage.test.ts
 *
 * Run standalone:
 *   pnpm exec vitest run test/evolution/reflective/engine-cold-log-coverage.test.ts
 */
import { describe, it, expect } from "vitest";
import {
  runReflectiveEvolution,
  partitionTrainVal,
} from "../../../src/alienclaw/evolution/reflective/engine.js";
import { InMemoryEvolutionStore } from "../../../src/alienclaw/evolution/reflective/store.js";
import { DEFAULT_CONFIG } from "../../../src/alienclaw/evolution/reflective/config.js";
import { MockReflector } from "../../../src/alienclaw/evolution/reflective/reflector.js";
import { MockProposer } from "../../../src/alienclaw/evolution/reflective/proposer.js";
import {
  MockGenomeAdapter,
  makeTestGenome,
  makeSyntheticTasks,
} from "./mock-adapter.js";
import type { TaskInstance, Genome } from "../../../src/alienclaw/evolution/reflective/types.js";

/** Deterministic LCG RNG (mirrors engine.test.ts / engine-merge-accept.test.ts). */
function makeRng(seed = 42): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe("PKT-911: engine.ts cold-path log line coverage", () => {
  it("L135: re.proposer.invalid_genome fires when applyMutation throws", async () => {
    const tasks = makeSyntheticTasks(10) as TaskInstance[];
    const { train, val } = partitionTrainVal(tasks, 0.3);
    const seed = makeTestGenome([0.5, 0.5]);
    const genomeStore = new Map([[seed.id, seed]]);
    const store = new InMemoryEvolutionStore();
    store.genomes.set(seed.id, seed);

    // Proposer that always throws on applyMutation — forces the L134-137 catch.
    class ThrowingProposer extends MockProposer {
      async applyMutation(): Promise<Genome> {
        throw new Error("simulated invalid genome");
      }
    }

    const logs: string[] = [];
    await runReflectiveEvolution({
      adapter: new MockGenomeAdapter(),
      reflector: new MockReflector(),
      proposer: new ThrowingProposer(genomeStore),
      seedCandidates: [seed],
      trainset: train,
      valset: val,
      maxMetricCalls: 6,
      minibatchSize: 2,
      rng: makeRng(5),
      persist: store,
      config: DEFAULT_CONFIG,
      log: (msg) => logs.push(msg),
    });

    expect(logs.some((l) => l.includes("re.proposer.invalid_genome"))).toBe(true);
  }, 30_000);

  it("L190: re.merge.failed fires when proposer.merge throws", async () => {
    const train = [
      { id: "tg0", input: {}, target: [0.5, 0.5] },
      { id: "tg1", input: {}, target: [0.5, 0.5] },
      { id: "tg2", input: {}, target: [0.5, 0.5] },
    ] as unknown as TaskInstance[];
    const val = [{ id: "tgv", input: {}, target: [0.5, 0.5] }] as unknown as TaskInstance[];
    const g1 = makeTestGenome([0.0, 0.0]);
    const g2 = makeTestGenome([1.0, 1.0]);
    // Proposer store has only g1 — merge() throws when it tries to look up g2.
    // This is the L188-192 catch in engine.ts.
    const genomeStore = new Map([[g1.id, g1]]);
    const store = new InMemoryEvolutionStore();
    store.genomes.set(g1.id, g1);
    store.genomes.set(g2.id, g2);

    const logs: string[] = [];
    await runReflectiveEvolution({
      adapter: new MockGenomeAdapter(),
      reflector: new MockReflector(),
      proposer: new MockProposer(genomeStore),
      seedCandidates: [g1, g2],
      trainset: train,
      valset: val,
      maxMetricCalls: 18,
      minibatchSize: 3,
      rng: makeRng(7),
      persist: store,
      config: { ...DEFAULT_CONFIG, mergeProbability: 1.0 },
      log: (msg) => logs.push(msg),
    });

    expect(logs.some((l) => l === "re.merge.failed")).toBe(true);
  }, 30_000);

  it("L126: re.reflect.parse_failure fires when reflector returns parse_failure", async () => {
    const tasks = makeSyntheticTasks(10) as TaskInstance[];
    const { train, val } = partitionTrainVal(tasks, 0.3);
    const seed = makeTestGenome([0.5, 0.5]);
    const genomeStore = new Map([[seed.id, seed]]);
    const store = new InMemoryEvolutionStore();
    store.genomes.set(seed.id, seed);

    const reflector = new MockReflector(
      new Map([
        [
          `${seed.id}:tool_slots`,
          { diagnosis: "parse_failure", proposedValue: "", lesson: "" },
        ],
      ]),
    );

    const logs: string[] = [];
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
      log: (msg) => logs.push(msg),
    });

    expect(logs.some((l) => l.includes("re.reflect.parse_failure"))).toBe(true);
  }, 30_000);

  it("L122-124: YELLOW log fires when parse_failure rate > reflectParseFailureYellow", async () => {
    const tasks = makeSyntheticTasks(10) as TaskInstance[];
    const { train, val } = partitionTrainVal(tasks, 0.3);
    const seed = makeTestGenome([0.5, 0.5]);
    const genomeStore = new Map([[seed.id, seed]]);
    const store = new InMemoryEvolutionStore();
    store.genomes.set(seed.id, seed);

    const reflector = new MockReflector(
      new Map([
        [
          `${seed.id}:tool_slots`,
          { diagnosis: "parse_failure", proposedValue: "", lesson: "" },
        ],
      ]),
    );

    const logs: string[] = [];
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
      // 1+ parse failures out of 1+ reflections → failRate = 1.0; 0.10 threshold → fires
      config: { ...DEFAULT_CONFIG, reflectParseFailureYellow: 0.10 },
      log: (msg) => logs.push(msg),
    });

    expect(logs.some((l) => l.startsWith("YELLOW: reflect.parse_failure_rate="))).toBe(true);
  }, 30_000);

  it("L121 negative arm: YELLOW does NOT fire when failRate <= threshold (strict >)", async () => {
    const tasks = makeSyntheticTasks(10) as TaskInstance[];
    const { train, val } = partitionTrainVal(tasks, 0.3);
    const seed = makeTestGenome([0.5, 0.5]);
    const genomeStore = new Map([[seed.id, seed]]);
    const store = new InMemoryEvolutionStore();
    store.genomes.set(seed.id, seed);

    const reflector = new MockReflector(
      new Map([
        [
          `${seed.id}:tool_slots`,
          { diagnosis: "parse_failure", proposedValue: "", lesson: "" },
        ],
      ]),
    );

    const logs: string[] = [];
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
      // failRate = 1.0, threshold = 1.0 → strict > does NOT fire
      config: { ...DEFAULT_CONFIG, reflectParseFailureYellow: 1.0 },
      log: (msg) => logs.push(msg),
    });

    // The YELLOW threshold is `>` not `>=` — equal does not fire.
    expect(logs.some((l) => l.startsWith("YELLOW: reflect.parse_failure_rate="))).toBe(false);
    // But the per-event re.reflect.parse_failure log still fires.
    expect(logs.some((l) => l.includes("re.reflect.parse_failure"))).toBe(true);
  }, 30_000);
});
