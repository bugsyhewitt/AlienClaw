import { describe, it, expect } from "vitest";
import {
  SubagentAdapter,
  subagentGenomeToGenome,
  makeSubagentId,
} from "../../../src/alienclaw/evolution/graph/subagent-adapter.js";
import type { SubagentGenome } from "../../../src/alienclaw/evolution/graph/types.js";
import type { Genome, TaskInstance } from "../../../src/alienclaw/evolution/reflective/types.js";

function makeSG(overrides?: Partial<SubagentGenome["editable"]>): SubagentGenome {
  return {
    id: "sg-1",
    editable: {
      role: "test role",
      decomposition: "test decomposition",
      summoning_policy: "{}",
      operators: "{}",
      report_shape: "{}",
      ...overrides,
    },
    parsed: {
      summoning: { martians: [], pattern: "sequential", maxSummons: 1 },
      operators: { kind: "none" },
      reportSchema: {},
    },
  };
}

function makeGenome(editable: Record<string, string> = {}): Genome {
  return { id: "g1", raw: "A".repeat(256), toolSlots: [], editable };
}

function makeTasks(n: number): TaskInstance[] {
  return Array.from({ length: n }, (_, i) => ({ id: `task-${i}`, input: {} }));
}

describe("subagentGenomeToGenome", () => {
  it("preserves id and all editable fields", () => {
    const sg = makeSG();
    const g = subagentGenomeToGenome(sg);
    expect(g.id).toBe("sg-1");
    expect(g.editable["role"]).toBe("test role");
    expect(g.editable["decomposition"]).toBe("test decomposition");
    expect(g.editable["summoning_policy"]).toBe("{}");
    expect(g.editable["operators"]).toBe("{}");
    expect(g.editable["report_shape"]).toBe("{}");
  });

  it("raw is 256 A-chars and toolSlots is empty array", () => {
    const g = subagentGenomeToGenome(makeSG());
    expect(g.raw).toBe("A".repeat(256));
    expect(g.toolSlots).toEqual([]);
  });
});

describe("makeSubagentId", () => {
  it("is deterministic for the same editable", () => {
    const editable = { role: "r", decomposition: "d", summoning_policy: "{}", operators: "{}", report_shape: "{}" };
    expect(makeSubagentId(editable)).toBe(makeSubagentId(editable));
  });

  it("changes when any field changes", () => {
    const base = { role: "r", decomposition: "d", summoning_policy: "{}", operators: "{}", report_shape: "{}" };
    const changed = { ...base, role: "different-role" };
    expect(makeSubagentId(base)).not.toBe(makeSubagentId(changed));
  });
});

describe("SubagentAdapter.evaluate", () => {
  const adapter = new SubagentAdapter();

  it("single task: correctness.score = min(1, (roleLen+decompLen)/500)", async () => {
    const genome = makeGenome({ role: "A".repeat(200), decomposition: "B".repeat(200) });
    const batch = await adapter.evaluate(genome, makeTasks(1), { seed: 0, captureTraces: true });
    expect(batch.traces[0]!.correctness.score).toBe(0.8);
  });

  it("multi-task: perInstance map has exactly the task ids", async () => {
    const tasks = makeTasks(3);
    const batch = await adapter.evaluate(makeGenome({ role: "r", decomposition: "d" }), tasks, { seed: 0, captureTraces: true });
    expect(batch.scores.perInstance.size).toBe(3);
    for (const t of tasks) {
      expect(batch.scores.perInstance.has(t.id)).toBe(true);
    }
  });

  it("seed controls wallMs via 200 + (seed % 800)", async () => {
    const seed = 150;
    const batch = await adapter.evaluate(makeGenome({ role: "r", decomposition: "d" }), makeTasks(1), { seed, captureTraces: true });
    expect(batch.traces[0]!.cost.wallMs).toBe(200 + (seed % 800));
  });

  it("legacyScalar is a number in [0,1]", async () => {
    const genome = makeGenome({ role: "A".repeat(200), decomposition: "B".repeat(200) });
    const batch = await adapter.evaluate(genome, makeTasks(2), { seed: 42, captureTraces: true });
    expect(typeof batch.scores.legacyScalar).toBe("number");
    expect(batch.scores.legacyScalar).toBeGreaterThanOrEqual(0);
    expect(batch.scores.legacyScalar).toBeLessThanOrEqual(1);
  });
});

describe("SubagentAdapter.makeReflectiveDataset", () => {
  it("empty toolCalls → input is {} per record; components list drives dataset keys", async () => {
    const adapter = new SubagentAdapter();
    const genome = makeGenome({ role: "r", decomposition: "d" });
    const evalBatch = await adapter.evaluate(genome, makeTasks(2), { seed: 1, captureTraces: true });
    const components = ["role", "decomposition"];
    const dataset = adapter.makeReflectiveDataset(genome, evalBatch, components);
    expect(Object.keys(dataset)).toEqual(components);
    for (const comp of components) {
      for (const rec of dataset[comp]!) {
        expect(rec.input).toEqual({});
      }
    }
  });
});
