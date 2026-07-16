/**
 * Core types for the reflective evolution engine (P14-01).
 *
 * Framework-agnostic — must NOT import anything Martian-specific.
 * Packet 07 widens EditableComponents to include free-text sections;
 * this design is additive-ready.
 */

// ── Genome ──────────────────────────────────────────────────────────────────

/** Opaque 256-char Base62 genome plus parsed views. */
export interface Genome {
  readonly id: string;           // content hash (SHA-256 hex, stable, dedupe-friendly)
  readonly raw: string;          // 256-char Base62
  readonly toolSlots: string[];  // up to 4 martianbrain tool ids
  readonly editable: EditableComponents;
}

/**
 * Named editable surfaces the reflector may mutate.
 * Today: tool_slots only. Packet 07 adds free-text strategy/constraint sections.
 */
export type EditableComponents = Record<string, string>;
// e.g. { "tool_slots": "subdomain_enum,http_probe,..." }

// ── Task instances ───────────────────────────────────────────────────────────

export interface TaskInstance {
  readonly id: string;
  readonly input: unknown;
  readonly oracle?: Oracle;
}

/**
 * Deterministic-first correctness oracle.
 * Priority (chooseCorrectness): exact → schema → predicate → tool_success → llm_judge
 */
export type Oracle =
  | { kind: "exact"; expected: unknown }
  | { kind: "schema"; schema: unknown }
  | { kind: "predicate"; ref: string }
  | { kind: "tool_success" }
  | { kind: "llm_judge"; rubricRef: string };

// ── Execution trace (ASI source) ─────────────────────────────────────────────

export interface ExecutionTrace {
  readonly runId: string;
  readonly genomeId: string;
  readonly taskId: string;
  readonly seed: number;
  readonly toolCalls: ToolCallRecord[];
  readonly finalOutput: unknown;
  readonly errors: TraceError[];
  readonly correctness: CorrectnessVerdict;
  readonly cost: CostRecord;
  readonly startedAt: string;  // ISO-8601
  readonly endedAt: string;
}

export interface ToolCallRecord {
  readonly index: number;
  readonly tool: string;
  readonly args: unknown;
  readonly result: unknown;
  readonly ok: boolean;
  readonly ms: number;
  readonly note?: string;
}

export interface TraceError {
  readonly kind: string;
  readonly message: string;
}

export interface CorrectnessVerdict {
  readonly score: number;           // [0,1]
  readonly source: Oracle["kind"];
  readonly evidence: string;        // human-readable why; feeds reflection
  readonly confidence?: number;     // [0,1] when logprob-aware; else undefined
}

export interface CostRecord {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly dollars: number;
  readonly toolCalls: number;
  readonly wallMs: number;
}

// ── Objectives ───────────────────────────────────────────────────────────────

/** Higher is better for ALL objectives (cost/latency are inverted before storage). */
export interface ObjectiveVector {
  readonly correctness: number;  // [0,1]
  readonly efficiency: number;   // legacy efficiency term, [0,1]
  readonly costInv: number;      // 1/(dollars+ε) normalized, [0,1]
  readonly latencyInv: number;   // 1/(wallMs+ε) normalized, [0,1]
  readonly confidence: number;   // [0,1]; neutral (= correctness) when unmeasured
}

export const OBJECTIVE_KEYS = [
  "correctness",
  "efficiency",
  "costInv",
  "latencyInv",
  "confidence",
] as const;
export type ObjectiveKey = (typeof OBJECTIVE_KEYS)[number];

export interface CandidateScore {
  readonly genomeId: string;
  readonly perInstance: Map<string, ObjectiveVector>;  // taskId -> vector
  readonly aggregate: ObjectiveVector;                 // mean over instances
  readonly legacyScalar: number;                       // back-compat
}

// ── Adapter contract ─────────────────────────────────────────────────────────

export interface EvaluationBatch {
  readonly candidate: Genome;
  readonly scores: CandidateScore;
  readonly traces: ExecutionTrace[];
}

// component name -> reflective records the LLM will read
export type ReflectiveDataset = Record<string, ReflectiveRecord[]>;

export interface ReflectiveRecord {
  readonly taskId: string;
  readonly input: unknown;
  readonly feedback: string;  // ASI: errors, tool I/O, correctness reason, cost overruns
  readonly score: number;
}

// ── Reflector ────────────────────────────────────────────────────────────────

export interface ReflectionResult {
  readonly component: string;
  readonly diagnosis: string;
  readonly proposedValue: string;
  readonly lesson: string;
  readonly promptHash: string;  // SHA-256 of the prompt for reproducibility
}

// ── Lineage ──────────────────────────────────────────────────────────────────

export interface LineageEdge {
  parentId: string | null;
  childId: string;
  op: "seed" | "mutate" | "merge";
  reflection?: ReflectionResult;
}

// ── Engine result ────────────────────────────────────────────────────────────

export interface EvolutionResult {
  readonly best: { genomeId: string; held: ObjectiveVector; overfit: boolean } | null;
  readonly frontier: CandidateScore[];
  readonly archive: unknown;  // ParetoArchive — typed generically to avoid circular dep
}
