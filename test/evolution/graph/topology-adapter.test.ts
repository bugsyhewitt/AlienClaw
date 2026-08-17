import { describe, it, expect } from "vitest";
import { TopologyAdapter } from "../../../src/alienclaw/evolution/graph/topology-adapter.js";
import type { Genome, TaskInstance } from "../../../src/alienclaw/evolution/reflective/types.js";

function makeGenome(editable: Record<string, string> = {}): Genome {
  return { id: "g1", raw: "A".repeat(256), toolSlots: [], editable };
}

function makeTasks(n: number): TaskInstance[] {
  return Array.from({ length: n }, (_, i) => ({ id: `task-${i}`, input: {} }));
}

describe("TopologyAdapter.evaluate", () => {
  const adapter = new TopologyAdapter();

  it("valid JSON subagents: subagentCount=3, correctness uses that count", async () => {
    const genome = makeGenome({
      subagents: '["a","b","c"]',
      partition: "P".repeat(100),
    });
    const batch = await adapter.evaluate(genome, makeTasks(1), { seed: 0, captureTraces: true });
    // correctness = min(1, (100/300) * (3/2)) = 0.5
    expect(batch.traces[0]!.correctness.score).toBeCloseTo(0.5, 5);
  });

  it("malformed JSON subagents → catch fires, subagentCount=0, correctnessScore=0", async () => {
    const genome = makeGenome({
      subagents: "not-json",
      partition: "P".repeat(100),
    });
    const batch = await adapter.evaluate(genome, makeTasks(1), { seed: 0, captureTraces: true });
    expect(batch.traces[0]!.correctness.score).toBe(0);
  });

  it("missing subagents field → defaults to [], subagentCount=0, correctness=0", async () => {
    const genome = makeGenome({ partition: "P".repeat(100) });
    const batch = await adapter.evaluate(genome, makeTasks(1), { seed: 0, captureTraces: true });
    expect(batch.traces[0]!.correctness.score).toBe(0);
  });

  it("perInstance map has all task ids", async () => {
    const tasks = makeTasks(3);
    const genome = makeGenome({ subagents: '["a","b"]', partition: "P".repeat(100) });
    const batch = await adapter.evaluate(genome, tasks, { seed: 0, captureTraces: true });
    expect(batch.scores.perInstance.size).toBe(3);
    for (const t of tasks) {
      expect(batch.scores.perInstance.has(t.id)).toBe(true);
    }
  });

  it("missing partition field → nullish fallback → partitionLen=0, correctness=0", async () => {
    const genome = makeGenome({ subagents: '["a","b"]' }); // no partition key
    const batch = await adapter.evaluate(genome, makeTasks(1), { seed: 0, captureTraces: true });
    expect(batch.traces[0]!.correctness.score).toBe(0);
  });

  // PKT-556 regression: non-array JSON parse results
  it("PKT-556: subagents='null' → no crash, subagentCount=0, correctnessScore=0", async () => {
    const genome = makeGenome({ subagents: "null", partition: "P".repeat(100) });
    const batch = await adapter.evaluate(genome, makeTasks(1), { seed: 0, captureTraces: true });
    expect(batch.traces[0]!.correctness.score).toBe(0);
  });

  it("PKT-556: subagents='3' (JSON number) → subagentCount=0, score is finite", async () => {
    const genome = makeGenome({ subagents: "3", partition: "P".repeat(100) });
    const batch = await adapter.evaluate(genome, makeTasks(1), { seed: 0, captureTraces: true });
    expect(batch.traces[0]!.correctness.score).toBe(0);
    expect(isFinite(batch.traces[0]!.correctness.score)).toBe(true);
  });

  it("PKT-556: subagents='{}' (JSON object) → subagentCount=0, score is finite", async () => {
    const genome = makeGenome({ subagents: "{}", partition: "P".repeat(100) });
    const batch = await adapter.evaluate(genome, makeTasks(1), { seed: 0, captureTraces: true });
    expect(batch.traces[0]!.correctness.score).toBe(0);
    expect(isFinite(batch.traces[0]!.correctness.score)).toBe(true);
  });

  it("PKT-556: subagents='\"abc\"' (JSON string) → subagentCount=0, not 3", async () => {
    const genome = makeGenome({ subagents: '"abc"', partition: "P".repeat(100) });
    const batch = await adapter.evaluate(genome, makeTasks(1), { seed: 0, captureTraces: true });
    expect(batch.traces[0]!.correctness.score).toBe(0);
  });

  // PKT-726: non-string editable.partition guard
  it("non-string editable.partition (number) → correctness.score === 0 (NaN guarded)", async () => {
    const genome = makeGenome({ subagents: '["a","b"]', partition: 42 } as any);
    const batch = await adapter.evaluate(genome, makeTasks(1), { seed: 0, captureTraces: true });
    expect(batch.traces[0]!.correctness.score).toBe(0);
  });

  it("non-string editable.partition (object) → correctness.score === 0 (NaN guarded)", async () => {
    const genome = makeGenome({ subagents: '["a","b"]', partition: { key: "val" } } as any);
    const batch = await adapter.evaluate(genome, makeTasks(1), { seed: 0, captureTraces: true });
    expect(batch.traces[0]!.correctness.score).toBe(0);
  });

  it("non-string editable.partition (number) → batch.scores.legacyScalar is finite (not NaN)", async () => {
    const genome = makeGenome({ subagents: '["a","b"]', partition: 42 } as any);
    const batch = await adapter.evaluate(genome, makeTasks(1), { seed: 0, captureTraces: true });
    expect(isFinite(batch.scores.legacyScalar)).toBe(true);
  });
});

describe("TopologyAdapter.makeReflectiveDataset", () => {
  it("empty toolCalls → input defaults to {}", async () => {
    const adapter = new TopologyAdapter();
    const genome = makeGenome({ subagents: '["a"]', partition: "P" });
    const evalBatch = await adapter.evaluate(genome, makeTasks(2), { seed: 1, captureTraces: true });
    const dataset = adapter.makeReflectiveDataset(genome, evalBatch, ["comp"]);
    for (const rec of dataset["comp"]!) {
      expect(rec.input).toEqual({});
    }
  });

  it("components list drives dataset keys", async () => {
    const adapter = new TopologyAdapter();
    const genome = makeGenome({ subagents: '["a"]', partition: "P" });
    const evalBatch = await adapter.evaluate(genome, makeTasks(1), { seed: 1, captureTraces: true });
    const components = ["subagents", "partition", "compose"];
    const dataset = adapter.makeReflectiveDataset(genome, evalBatch, components);
    expect(Object.keys(dataset)).toEqual(components);
  });
});
