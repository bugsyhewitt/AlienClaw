import { describe, it, expect } from "vitest";
import { assembleCampaignGraph, isValidPartition, resolveToStructures, structureCost, makeSubagentGenomeId, makeTopologyGenomeId } from "../../../src/alienclaw/evolution/graph/assembly.js";
import type { SubagentGenome, TopologyGenome } from "../../../src/alienclaw/evolution/graph/types.js";

function makeTopology(ids: string[]): TopologyGenome {
  return {
    id: "t1",
    editable: { subagents: JSON.stringify(ids), partition: JSON.stringify({ assignments: [] }), compose: "merge" },
    parsed: { subagentIds: ids, partition: { assignments: [] }, compose: "merge" },
  };
}

function makeSubagent(id: string): SubagentGenome {
  return {
    id,
    editable: { role: "r", decomposition: "d", summoning_policy: "{}", operators: "{}", report_shape: "{}" },
    parsed: { summoning: { martians: [{ genomeId: "m1" }], pattern: "sequential", maxSummons: 2 }, operators: { kind: "none" }, reportSchema: {} },
  };
}

describe("assembly helpers", () => {
  it("assembleCampaignGraph: includes creator->subagent and subagent->boss edges", () => {
    const s1 = makeSubagent("sa1");
    const t = makeTopology(["sa1"]);
    const g = assembleCampaignGraph(t, [s1]);
    expect(g.edges).toContainEqual(["creator", "subagent"]);
    expect(g.edges).toContainEqual(["subagent", "boss"]);
  });

  it("assembleCampaignGraph: never contains boss->martian edge", () => {
    const s1 = makeSubagent("sa1");
    const t = makeTopology(["sa1"]);
    const g = assembleCampaignGraph(t, [s1]);
    const hasBossMartian = g.edges.some(([a, b]) => a === "boss" && b === "martian");
    expect(hasBossMartian).toBe(false);
  });

  it("isValidPartition: valid partition accepted", () => {
    const r = isValidPartition({ assignments: [{ subagentId: "sa1", scope: "dns recon" }] }, "campaign");
    expect(r.ok).toBe(true);
  });

  it("isValidPartition: empty partition rejected", () => {
    const r = isValidPartition({ assignments: [] }, "campaign");
    expect(r.ok).toBe(false);
  });

  it("isValidPartition: empty scope rejected", () => {
    const r = isValidPartition({ assignments: [{ subagentId: "sa1", scope: "" }] }, "campaign");
    expect(r.ok).toBe(false);
  });

  it("isValidPartition: duplicate subagent rejected", () => {
    const r = isValidPartition({
      assignments: [{ subagentId: "sa1", scope: "a" }, { subagentId: "sa1", scope: "b" }]
    }, "campaign");
    expect(r.ok).toBe(false);
  });

  it("structureCost: sums dollars and wallMs across traces", () => {
    const traces = [
      { cost: { dollars: 0.01, toolCalls: 2, wallMs: 100 } },
      { cost: { dollars: 0.02, toolCalls: 3, wallMs: 200 } },
    ];
    const cost = structureCost(traces);
    expect(cost.dollars).toBeCloseTo(0.03, 5);
    expect(cost.wallMs).toBe(300);
    expect(cost.toolCalls).toBe(5);
  });

  it("makeSubagentGenomeId: deterministic for same editable", () => {
    const e = { role: "r", decomposition: "d", summoning_policy: "{}", operators: "{}", report_shape: "{}" };
    expect(makeSubagentGenomeId(e)).toBe(makeSubagentGenomeId(e));
  });

  it("resolveToStructures: returns topology + matching subagents from registry", () => {
    const s1 = makeSubagent("sa1");
    const t = makeTopology(["sa1"]);
    const reg = new Map([["sa1", s1]]);
    const { topology, subagents } = resolveToStructures(t, reg);
    expect(topology).toBe(t);
    expect(subagents).toEqual([s1]);
  });

  it("resolveToStructures: throws when subagent id is not in registry", () => {
    const t = makeTopology(["missing"]);
    expect(() => resolveToStructures(t, new Map())).toThrow("SubagentGenome not found: missing");
  });

  it("makeTopologyGenomeId: deterministic for same editable", () => {
    const e = { subagents: '["sa1"]', partition: '{"assignments":[]}', compose: "merge" };
    expect(makeTopologyGenomeId(e)).toBe(makeTopologyGenomeId(e));
  });
});
