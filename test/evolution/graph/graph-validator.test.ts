/**
 * GraphValidator adversarial invariant suite — §20 fixture table.
 * Every rejection asserts the exact violation string and that the candidate is invalid.
 * This is the headline gate: any failure here is RED.
 */
import { describe, it, expect } from "vitest";
import { GraphValidator, validateSubagent, isValidPartition } from "../../../src/alienclaw/evolution/graph/graph-validator.js";
import type { SubagentGenome, TopologyGenome } from "../../../src/alienclaw/evolution/graph/types.js";

const CAPS = { maxSubagents: 4, maxSummons: 4 };
const SCOPE = "full campaign scope";

function makeSubagentGenome(overrides: Partial<{
  id: string;
  summoning: object;
  operators: object;
  martians: Array<{ genomeId: string }>;
  maxSummons: number;
}>): SubagentGenome {
  const martians = overrides.martians ?? [{ genomeId: "martian-abc" }];
  const maxSummons = overrides.maxSummons ?? 2;
  const summoning = overrides.summoning ?? { martians, pattern: "sequential", maxSummons };
  const operators = overrides.operators ?? { kind: "none" };
  const id = overrides.id ?? "subagent-" + Math.random().toString(36).slice(2);
  return {
    id,
    editable: {
      role: "test role",
      decomposition: "test decomposition",
      summoning_policy: JSON.stringify(summoning),
      operators: JSON.stringify(operators),
      report_shape: JSON.stringify({ findings: "list" }),
    },
    parsed: {
      summoning: summoning as any,
      operators: operators as any,
      reportSchema: { findings: "list" },
    },
  };
}

function makeTopologyGenome(
  subagentIds: string[],
  assignments: Array<{ subagentId: string; scope: string }>,
  compose: "concat" | "merge" | "adjudicate" = "merge",
): TopologyGenome {
  const partition = { assignments };
  return {
    id: "topology-" + Math.random().toString(36).slice(2),
    editable: {
      subagents: JSON.stringify(subagentIds),
      partition: JSON.stringify(partition),
      compose,
    },
    parsed: { subagentIds, partition, compose },
  };
}

const validator = new GraphValidator();

describe("GraphValidator — adversarial invariant suite (headline gate)", () => {
  it("legal_two_subagent: valid 2-subagent split is accepted", () => {
    const s1 = makeSubagentGenome({ id: "sa1" });
    const s2 = makeSubagentGenome({ id: "sa2" });
    const t = makeTopologyGenome(
      ["sa1", "sa2"],
      [{ subagentId: "sa1", scope: "dns/cname resolution" }, { subagentId: "sa2", scope: "http surface" }],
    );
    const r = validator.validateTopology(t, [s1, s2], CAPS, SCOPE);
    expect(r.ok).toBe(true);
  });

  it("no_subagents: topology with no subagents is rejected", () => {
    const t = makeTopologyGenome([], []);
    const r = validator.validateTopology(t, [], CAPS, SCOPE);
    expect(r.ok).toBe(false);
    expect(r.violation).toMatch(/no subagents/i);
  });

  it("over_fanout_subagents: 5 subagents (cap 4) is rejected", () => {
    const specs = Array.from({ length: 5 }, (_, i) => makeSubagentGenome({ id: `sa${i}` }));
    const ids = specs.map(s => s.id);
    const assignments = ids.map(id => ({ subagentId: id, scope: `scope-${id}` }));
    const t = makeTopologyGenome(ids, assignments);
    const r = validator.validateTopology(t, specs, CAPS, SCOPE);
    expect(r.ok).toBe(false);
    expect(r.violation).toMatch(/cap/i);
  });

  it("over_fanout_summons: 5 summons in one subagent (cap 4) is rejected", () => {
    const martians = Array.from({ length: 5 }, (_, i) => ({ genomeId: `m${i}` }));
    const s = makeSubagentGenome({ id: "sa1", martians, maxSummons: 5 });
    const r = validateSubagent(s, { maxSummons: 4 });
    expect(r.ok).toBe(false);
    expect(r.violation).toMatch(/cap/i);
  });

  it("empty_subagent: subagent with no martians is rejected", () => {
    const s = makeSubagentGenome({ id: "sa1", martians: [] });
    const r = validateSubagent(s, CAPS);
    expect(r.ok).toBe(false);
    expect(r.violation).toMatch(/no martians|dead node/i);
  });

  it("orphan_scope: partition with empty scope for a subagent is rejected", () => {
    const s1 = makeSubagentGenome({ id: "sa1" });
    const t = makeTopologyGenome(
      ["sa1"],
      [{ subagentId: "sa1", scope: "" }],
    );
    const r = validator.validateTopology(t, [s1], CAPS, SCOPE);
    expect(r.ok).toBe(false);
    expect(r.violation).toMatch(/empty scope|dead node/i);
  });

  it("unknown_subagent_in_topology: topology references subagent not in list", () => {
    const s1 = makeSubagentGenome({ id: "sa1" });
    const t = makeTopologyGenome(
      ["sa1", "sa-unknown"],
      [{ subagentId: "sa1", scope: "scope1" }, { subagentId: "sa-unknown", scope: "scope2" }],
    );
    const r = validator.validateTopology(t, [s1], CAPS, SCOPE);
    expect(r.ok).toBe(false);
    expect(r.violation).toMatch(/unknown subagent/i);
  });

  it("illegal_compose: compose value other than concat/merge/adjudicate is rejected", () => {
    const s1 = makeSubagentGenome({ id: "sa1" });
    const t: TopologyGenome = {
      id: "t1",
      editable: {
        subagents: JSON.stringify(["sa1"]),
        partition: JSON.stringify({ assignments: [{ subagentId: "sa1", scope: "scope1" }] }),
        compose: "boss_loop",  // illegal
      },
      parsed: {
        subagentIds: ["sa1"],
        partition: { assignments: [{ subagentId: "sa1", scope: "scope1" }] },
        compose: "boss_loop" as any,
      },
    };
    const r = validator.validateTopology(t, [s1], CAPS, SCOPE);
    expect(r.ok).toBe(false);
    expect(r.violation).toMatch(/illegal compose/i);
  });

  it("partition_references_non_topology_subagent: partition assigns subagent not in topology list", () => {
    const s1 = makeSubagentGenome({ id: "sa1" });
    const t = makeTopologyGenome(
      ["sa1"],
      // partition references sa2 which is NOT in the topology's subagent list
      [{ subagentId: "sa1", scope: "scope1" }, { subagentId: "sa2", scope: "scope2" }],
    );
    const r = validator.validateTopology(t, [s1], CAPS, SCOPE);
    expect(r.ok).toBe(false);
    expect(r.violation).toMatch(/unknown subagent/i);
  });

  it("duplicate_subagent_in_partition: same subagent appears twice in partition", () => {
    const s1 = makeSubagentGenome({ id: "sa1" });
    const t: TopologyGenome = {
      id: "t1",
      editable: {
        subagents: JSON.stringify(["sa1"]),
        partition: JSON.stringify({ assignments: [
          { subagentId: "sa1", scope: "scope-a" },
          { subagentId: "sa1", scope: "scope-b" },  // duplicate
        ]}),
        compose: "merge",
      },
      parsed: {
        subagentIds: ["sa1"],
        partition: { assignments: [
          { subagentId: "sa1", scope: "scope-a" },
          { subagentId: "sa1", scope: "scope-b" },
        ]},
        compose: "merge",
      },
    };
    const r = validator.validateTopology(t, [s1], CAPS, SCOPE);
    expect(r.ok).toBe(false);
    expect(r.violation).toMatch(/duplicate/i);
  });

  it("illegal_operator: unknown operator kind is rejected", () => {
    const s = makeSubagentGenome({ id: "sa1", operators: { kind: "boss_judge" } });
    const r = validateSubagent(s, CAPS);
    expect(r.ok).toBe(false);
    expect(r.violation).toMatch(/illegal operator/i);
  });

  it("ensemble_k_zero: ensemble with k=0 is rejected", () => {
    const s = makeSubagentGenome({ id: "sa1", operators: { kind: "ensemble", k: 0 } });
    const r = validateSubagent(s, CAPS);
    expect(r.ok).toBe(false);
    expect(r.violation).toMatch(/ensemble k/i);
  });

  it("best_of_n_n_zero: best_of_n with n=0 is rejected", () => {
    const s = makeSubagentGenome({ id: "sa1", operators: { kind: "best_of_n", n: 0 } });
    const r = validateSubagent(s, CAPS);
    expect(r.ok).toBe(false);
    expect(r.violation).toMatch(/best_of_n n/i);
  });

  it("GraphValidator.validateSubagent: class method delegates correctly", () => {
    const s = makeSubagentGenome({ id: "sa1" });
    const r = validator.validateSubagent(s, CAPS);
    expect(r.ok).toBe(true);
    const bad = makeSubagentGenome({ id: "sa2", operators: { kind: "best_of_n", n: 0 } });
    const rb = validator.validateSubagent(bad, CAPS);
    expect(rb.ok).toBe(false);
    expect(rb.violation).toMatch(/best_of_n n/i);
  });

  it("invalid_martian_ref: subagent with empty genomeId is rejected", () => {
    const s = makeSubagentGenome({ id: "sa1", martians: [{ genomeId: "" }] });
    const r = validateSubagent(s, CAPS);
    expect(r.ok).toBe(false);
    expect(r.violation).toMatch(/non-martian summon target/i);
  });

  it("empty_partition_assignments: isValidPartition rejects empty assignments", () => {
    const r = isValidPartition({ assignments: [] }, SCOPE);
    expect(r.ok).toBe(false);
    expect(r.violation).toMatch(/no assignments/i);
  });

  it("subagent_fail_in_topology: validateTopology propagates subagent failure", () => {
    const bad = makeSubagentGenome({ id: "sa1", operators: { kind: "best_of_n", n: 0 } });
    const t = makeTopologyGenome(
      ["sa1"],
      [{ subagentId: "sa1", scope: "dns surface" }],
    );
    const r = validator.validateTopology(t, [bad], CAPS, SCOPE);
    expect(r.ok).toBe(false);
    expect(r.violation).toMatch(/best_of_n n/i);
  });
});
