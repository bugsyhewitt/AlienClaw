/**
 * GraphValidator (P14-02) — the headline gate.
 *
 * Enforces the communication-graph invariants. The legal-edge set is a hard
 * allow-list: any edge NOT in LEGAL_EDGES is forbidden. In particular
 * boss<->martian is structurally impossible — governance never talks to the
 * bottom layer directly. Every rejection returns a precise violation string.
 *
 * NAMING (AGENTS.md wall): "Subagent", never "Subagent".
 */
import type {
  SubagentGenome,
  TopologyGenome,
  ScopePartition,
  Scope,
  GraphValidationResult,
  MartianRef,
} from "./types.js";

// ALL legal edges as a Set. ANYTHING not in here is forbidden.
const LEGAL_EDGES = new Set<string>([
  "user>boss", "boss>user",
  "boss>advisor", "advisor>boss",
  "boss>creator",
  "creator>subagent",
  "subagent>martian",
  "martian>subagent",
  "martian>advisor",
  "martian>creator",
  "subagent>boss",
]);

function fail(violation: string): GraphValidationResult {
  return { ok: false, violation };
}

function isMartianRef(m: MartianRef): boolean {
  return typeof m.genomeId === "string" && m.genomeId.length > 0;
}

export function validateSubagent(
  s: SubagentGenome,
  caps: { maxSummons: number },
): GraphValidationResult {
  const pol = s.parsed.summoning;
  if (pol.martians.length === 0) return fail("subagent summons no martians (dead node)");
  if (pol.maxSummons > caps.maxSummons) return fail("summon cap exceeded");
  for (const m of pol.martians) {
    if (!isMartianRef(m)) return fail(`non-martian summon target: ${JSON.stringify(m)}`);
  }
  const k = s.parsed.operators.kind;
  if (!["none", "ensemble", "review_revise", "best_of_n"].includes(k)) {
    return fail(`illegal operator kind: ${k}`);
  }
  if (k === "ensemble" && (s.parsed.operators as { k: number }).k < 1) {
    return fail("ensemble k must be >= 1");
  }
  if (k === "best_of_n" && (s.parsed.operators as { n: number }).n < 1) {
    return fail("best_of_n n must be >= 1");
  }
  return { ok: true };
}

export function isValidPartition(
  p: ScopePartition,
  _campaignScope: Scope,
): GraphValidationResult {
  if (p.assignments.length === 0) return fail("partition has no assignments");
  for (const a of p.assignments) {
    if (!a.scope || a.scope.trim() === "") return fail(`subagent ${a.subagentId} has empty scope (dead node)`);
  }
  // Check for duplicate subagentIds (each subagent appears at most once)
  const seen = new Set<string>();
  for (const a of p.assignments) {
    if (seen.has(a.subagentId)) return fail(`duplicate subagent in partition: ${a.subagentId}`);
    seen.add(a.subagentId);
  }
  return { ok: true };
}

function impliedEdges(t: TopologyGenome, _subagents: SubagentGenome[]): string[] {
  const edges: string[] = [];
  // creator → subagents (created by creator)
  for (const _sid of t.parsed.subagentIds) {
    edges.push("creator>subagent");
    // subagent → martian (summons)
    edges.push("subagent>martian");
    // martian → subagent (deliver data)
    edges.push("martian>subagent");
    // subagent → boss (campaign report)
    edges.push("subagent>boss");
  }
  // martian → advisor/creator (fitness)
  edges.push("martian>advisor");
  edges.push("martian>creator");
  return edges;
}

export class GraphValidator {
  validateTopology(
    t: TopologyGenome,
    subagents: SubagentGenome[],
    caps: { maxSubagents: number; maxSummons: number },
    campaignScope: Scope,
  ): GraphValidationResult {
    if (t.parsed.subagentIds.length === 0) return fail("topology has no subagents");
    if (t.parsed.subagentIds.length > caps.maxSubagents) {
      return fail(`subagent count ${t.parsed.subagentIds.length} exceeds cap ${caps.maxSubagents}`);
    }
    const byId = new Map(subagents.map(s => [s.id, s]));
    for (const id of t.parsed.subagentIds) {
      const s = byId.get(id);
      if (!s) return fail(`unknown subagent id: ${id}`);
      const sv = validateSubagent(s, caps);
      if (!sv.ok) return sv;
    }
    const partResult = isValidPartition(t.parsed.partition, campaignScope);
    if (!partResult.ok) return partResult;
    // Partition assignments must reference only the topology's subagents
    for (const a of t.parsed.partition.assignments) {
      if (!t.parsed.subagentIds.includes(a.subagentId)) {
        return fail(`partition references unknown subagent: ${a.subagentId}`);
      }
    }
    if (!["concat", "merge", "adjudicate"].includes(t.parsed.compose)) {
      return fail(`illegal compose value: ${t.parsed.compose}`);
    }
    const edges = impliedEdges(t, subagents);
    for (const e of edges) {
      if (!LEGAL_EDGES.has(e)) return fail(`illegal edge: ${e}`);
      if (e === "boss>martian" || e === "martian>boss") {
        return fail("boss<->martian communication forbidden");
      }
    }
    return { ok: true };
  }

  validateSubagent(
    s: SubagentGenome,
    caps: { maxSummons: number },
  ): GraphValidationResult {
    return validateSubagent(s, caps);
  }
}

export const graphValidator = new GraphValidator();
