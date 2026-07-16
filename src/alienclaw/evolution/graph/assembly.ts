/**
 * Graph assembly and partition helpers (P14-02).
 *
 * Resolves a TopologyGenome + its SubagentGenomes into a concrete CampaignGraph
 * with explicit, legal edges; aggregates structure cost; and derives stable
 * content-hash ids. No governance<->martian edge is ever emitted.
 */
import { createHash } from "node:crypto";
import type {
  SubagentGenome,
  TopologyGenome,
  ScopePartition,
  Scope,
  CampaignGraph,
  Node,
} from "./types.js";
import type { CostRecord } from "../reflective/types.js";

export function resolveToStructures(
  t: TopologyGenome,
  subagentRegistry: Map<string, SubagentGenome>,
): { topology: TopologyGenome; subagents: SubagentGenome[] } {
  const subagents: SubagentGenome[] = [];
  for (const id of t.parsed.subagentIds) {
    const s = subagentRegistry.get(id);
    if (!s) throw new Error(`SubagentGenome not found: ${id}`);
    subagents.push(s);
  }
  return { topology: t, subagents };
}

export function assembleCampaignGraph(
  t: TopologyGenome,
  subagents: SubagentGenome[],
): CampaignGraph {
  const edges: Array<[Node, Node]> = [];
  for (const _s of subagents) {
    edges.push(["creator", "subagent"]);
    edges.push(["subagent", "martian"]);
    edges.push(["martian", "subagent"]);
    edges.push(["subagent", "boss"]);
    edges.push(["martian", "advisor"]);
    edges.push(["martian", "creator"]);
  }
  return { topology: t, subagents, edges };
}

export function isValidPartition(
  p: ScopePartition,
  _campaignScope: Scope,
): { ok: boolean; violation?: string } {
  if (p.assignments.length === 0) return { ok: false, violation: "partition has no assignments" };
  for (const a of p.assignments) {
    if (!a.scope || a.scope.trim() === "") {
      return { ok: false, violation: `subagent ${a.subagentId} has empty scope (dead node)` };
    }
  }
  const seen = new Set<string>();
  for (const a of p.assignments) {
    if (seen.has(a.subagentId)) {
      return { ok: false, violation: `duplicate subagent in partition: ${a.subagentId}` };
    }
    seen.add(a.subagentId);
  }
  return { ok: true };
}

export interface ExecutionTrace { cost: { dollars: number; toolCalls: number; wallMs: number } }

export function structureCost(traces: ExecutionTrace[]): CostRecord {
  return traces.reduce((acc, t) => ({
    inputTokens: 0,
    outputTokens: 0,
    dollars: acc.dollars + t.cost.dollars,
    toolCalls: acc.toolCalls + t.cost.toolCalls,
    wallMs: acc.wallMs + t.cost.wallMs,
  }), { inputTokens: 0, outputTokens: 0, dollars: 0, toolCalls: 0, wallMs: 0 });
}

export function makeSubagentGenomeId(editable: SubagentGenome["editable"]): string {
  return createHash("sha256").update(JSON.stringify(editable)).digest("hex");
}

export function makeTopologyGenomeId(editable: TopologyGenome["editable"]): string {
  return createHash("sha256").update(JSON.stringify(editable)).digest("hex");
}
