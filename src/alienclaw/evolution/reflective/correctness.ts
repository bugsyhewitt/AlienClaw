/**
 * Correctness hardening — anti-Goodhart subsystem (P14-01 §7).
 *
 * Priority chain (deterministic-first):
 *   exact → schema → predicate → tool_success → llm_judge
 *
 * A reflective loop on a gameable signal converges faster on the wrong thing.
 */
import type { Oracle, CorrectnessVerdict, ExecutionTrace } from "./types.js";
import { isDeepStrictEqual } from "node:util";

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
      // Structural deep equality, NOT JSON.stringify comparison.
      // `JSON.stringify` emits properties in INSERTION order, so two
      // structurally identical objects whose keys were inserted in a
      // different order serialise to different strings and compare
      // UNEQUAL — the deterministic oracle then awards score 0.0 to a
      // correct answer. It also THROWS on values JSON cannot represent
      // (circular structures, BigInt), escaping resolveCorrectness as a
      // raw TypeError. isDeepStrictEqual is order-insensitive for object
      // keys, order-sensitive for arrays (correct), and never throws.
      const match = isDeepStrictEqual(actual, oracle.expected);
      return {
        score: match ? 1.0 : 0.0,
        source: "exact",
        evidence: match
          ? "exact match"
          : `expected ${describeValue(oracle.expected)}, got ${describeValue(actual)}`,
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

/**
 * Render a value for the mismatch evidence string.
 *
 * JSON.stringify throws on circular structures and BigInt, so a naive
 * stringify would replace a mismatch verdict with an uncaught TypeError.
 * Fall back to a coarse type tag when the value cannot be serialised.
 */
function describeValue(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s === undefined ? String(v) : s;
  } catch {
    return `[unserializable ${v === null ? "null" : typeof v}]`;
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
  const t = s["type"];
  if (typeof t === "string") {
    let typeOk = true;
    switch (t) {
      case "string":  typeOk = typeof value === "string"; break;
      case "number":  typeOk = typeof value === "number" && Number.isFinite(value); break;
      case "integer": typeOk = typeof value === "number" && Number.isInteger(value); break;
      case "boolean": typeOk = typeof value === "boolean"; break;
      case "null":    typeOk = value === null; break;
      case "array":   typeOk = Array.isArray(value); break;
      case "object":  typeOk = value !== null && typeof value === "object" && !Array.isArray(value); break;
      // Unknown type string — permissive: no opinion
    }
    if (!typeOk) return false;
  }
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
