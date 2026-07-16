/**
 * Graph evolution types (P14-02).
 *
 * Two-level hierarchy evolves: Subagents (MIDDLE) and Topology (TOP-of-middle).
 * Governance nodes (boss/advisor/creator) and Martians (BOTTOM) are NOT genomes.
 *
 * NAMING (AGENTS.md wall): the canonical term is "Subagent", never "Specialist".
 */

/** Communication-graph node kinds. */
export type Node = "user" | "boss" | "advisor" | "creator" | "subagent" | "martian";

export interface SubagentGenome {
  readonly id: string;           // content hash (SHA-256 hex)
  readonly editable: {
    role: string;                // free-text subagent role description
    decomposition: string;       // strategy text for breaking work into Martian summons
    summoning_policy: string;    // serialized SummoningPolicy (JSON string)
    operators: string;           // serialized OperatorSpec (JSON string)
    report_shape: string;        // serialized report schema (JSON string)
  };
  readonly parsed: {
    summoning: SummoningPolicy;
    operators: OperatorSpec;
    reportSchema: unknown;
  };
}

export interface MartianRef {
  readonly genomeId: string;     // Martian genome id or tool-profile ref
  readonly toolProfile?: string; // optional tool-profile constraint
}

export interface SummoningPolicy {
  readonly martians: MartianRef[];
  readonly pattern: "sequential" | "parallel" | "conditional";
  readonly maxSummons: number;
  readonly condition?: string;   // for "conditional" pattern
}

export type OperatorSpec =
  | { kind: "none" }
  | { kind: "ensemble"; k: number }
  | { kind: "review_revise"; rounds: number }
  | { kind: "best_of_n"; n: number };

export interface TopologyGenome {
  readonly id: string;
  readonly editable: {
    subagents: string;     // serialized list of SubagentGenome ids (JSON)
    partition: string;     // serialized ScopePartition (JSON)
    compose: string;       // "concat" | "merge" | "adjudicate"
  };
  readonly parsed: {
    subagentIds: string[];
    partition: ScopePartition;
    compose: "concat" | "merge" | "adjudicate";
  };
}

export type Scope = string;  // campaign scope as a string descriptor

export interface ScopePartition {
  readonly assignments: Array<{ subagentId: string; scope: string }>;
}

export interface MartianResult {
  readonly taskId: string;
  readonly output: unknown;
  readonly correct: boolean;
  readonly cost: { dollars: number; wallMs: number };
}

export interface GraphValidationResult {
  readonly ok: boolean;
  readonly violation?: string;
}

export interface GraphViolationRecord {
  readonly id: string;
  readonly artifactKind: "subagent" | "topology";
  readonly artifactId: string | null;
  readonly violation: string;
  readonly createdAt: string;
}

export interface ExecutionTrace {
  readonly subagentId: string;
  readonly martianResults: MartianResult[];
  readonly operatorApplied: OperatorSpec["kind"];
}

export interface CampaignGraph {
  readonly topology: TopologyGenome;
  readonly subagents: SubagentGenome[];
  readonly edges: Array<[Node, Node]>;
}
