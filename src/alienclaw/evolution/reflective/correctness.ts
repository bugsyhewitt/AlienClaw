/**
 * Correctness hardening — anti-Goodhart subsystem (P14-01 §7).
 *
 * Priority chain (deterministic-first):
 *   exact → schema → predicate → tool_success → llm_judge
 *
 * A reflective loop on a gameable signal converges faster on the wrong thing.
 */
import type { Oracle, CorrectnessVerdict, ExecutionTrace } from "./types.js";

export interface OracleContext {
  trace: ExecutionTrace;
  /** Registered server-side predicate functions keyed by ref string. */
  predicates?: Record<string, (trace: ExecutionTrace) => boolean>;
  /** Token-level log-probability for the final answer (GEPA ConfidenceAdapter). */
  logprobConfidence?: number;
}

/**
 * Resolve correctness from a task oracle given an execution trace.
 * Deterministic oracles outrank llm_judge — always.
 */
export function resolveCorrectness(
  oracle: Oracle | undefined,
  ctx: OracleContext,
): CorrectnessVerdict {
  if (!oracle) {
    // No oracle defined: use the trace's existing correctness verdict (from Subagent)
    return ctx.trace.correctness;
  }

  switch (oracle.kind) {
    case "exact": {
      const actual = ctx.trace.finalOutput;
      const match = JSON.stringify(actual) === JSON.stringify(oracle.expected);
      return {
        score: match ? 1.0 : 0.0,
        source: "exact",
        evidence: match
          ? "exact match"
          : `expected ${JSON.stringify(oracle.expected)}, got ${JSON.stringify(actual)}`,
        confidence: applyConfidence(match ? 1.0 : 0.0, ctx),
      };
    }

    case "schema": {
      const valid = validateSchema(ctx.trace.finalOutput, oracle.schema);
      return {
        score: valid ? 1.0 : 0.0,
        source: "schema",
        evidence: valid ? "schema valid" : "schema validation failed",
        confidence: applyConfidence(valid ? 1.0 : 0.0, ctx),
      };
    }

    case "predicate": {
      const fn = ctx.predicates?.[oracle.ref];
      if (!fn) {
        // Unknown predicate — fall through to tool_success then llm_judge
        return toolSuccessVerdict(ctx);
      }
      const passed = fn(ctx.trace);
      return {
        score: passed ? 1.0 : 0.0,
        source: "predicate",
        evidence: passed ? `predicate ${oracle.ref} passed` : `predicate ${oracle.ref} failed`,
        confidence: applyConfidence(passed ? 1.0 : 0.0, ctx),
      };
    }

    case "tool_success": {
      return toolSuccessVerdict(ctx);
    }

    case "llm_judge": {
      // LLM judge is last resort. We use the trace's existing correctness (from Subagent)
      // because we never set correctness here — the reflector is diagnostic, not arbitral.
      const existing = ctx.trace.correctness;
      return {
        ...existing,
        source: "llm_judge",
        confidence: applyConfidence(existing.score, ctx),
      };
    }
  }
}

function toolSuccessVerdict(ctx: OracleContext): CorrectnessVerdict {
  const allOk = ctx.trace.toolCalls.length > 0 && ctx.trace.toolCalls.every(c => c.ok);
  const score = allOk ? 1.0 : ctx.trace.toolCalls.filter(c => c.ok).length / Math.max(1, ctx.trace.toolCalls.length);
  return {
    score,
    source: "tool_success",
    evidence: allOk
      ? "all tool calls succeeded"
      : `${ctx.trace.toolCalls.filter(c => c.ok).length}/${ctx.trace.toolCalls.length} tool calls ok`,
    confidence: applyConfidence(score, ctx),
  };
}

/**
 * Apply logprob-based confidence penalty.
 * If logprobs unavailable, confidence = score (neutral — no penalty, no bonus).
 */
function applyConfidence(score: number, ctx: OracleContext): number {
  if (ctx.logprobConfidence !== undefined) {
    // Lucky-guess detection: weight score by confidence
    return score * ctx.logprobConfidence;
  }
  // Neutral: no logprob data
  return score;
}

/** Minimal JSON-Schema-style validation (structural only — no full ajv dep). */
function validateSchema(value: unknown, schema: unknown): boolean {
  if (schema === null || schema === undefined) return true;
  if (typeof schema !== "object") return true;
  const s = schema as Record<string, unknown>;
  if (s["type"] === "object" && typeof value !== "object") return false;
  if (s["type"] === "array" && !Array.isArray(value)) return false;
  if (s["type"] === "string" && typeof value !== "string") return false;
  if (s["type"] === "number" && typeof value !== "number") return false;
  if (s["required"] && Array.isArray(s["required"])) {
    if (typeof value !== "object" || value === null) return false;
    for (const key of s["required"] as string[]) {
      if (!(key in (value as Record<string, unknown>))) return false;
    }
  }
  return true;
}

/**
 * Compute the fraction of verdicts sourced from llm_judge.
 * Emit a YELLOW warning if it exceeds the threshold.
 */
export function checkLlmJudgeFraction(
  verdicts: CorrectnessVerdict[],
  threshold: number,
  log: (msg: string) => void,
): number {
  if (verdicts.length === 0) return 0;
  const judgeCount = verdicts.filter(v => v.source === "llm_judge").length;
  const fraction = judgeCount / verdicts.length;
  if (fraction > threshold) {
    log(
      `YELLOW: llm_judge fraction ${(fraction * 100).toFixed(1)}% exceeds ${(threshold * 100).toFixed(0)}% threshold. ` +
      "Population being judged too softly — author deterministic oracles.",
    );
  }
  return fraction;
}
