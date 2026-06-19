/**
 * Reflector — reads execution traces and produces targeted, diagnosed genome edits.
 *
 * Model: Opus 4.8 (high-reasoning for diagnosis).
 * Temperature: 0.2 (deterministic as possible).
 * Prompt: loaded from prompts/reflect.v1.md (versioned file, never inline).
 *
 * The reflector NEVER sets correctness — it is diagnostic only.
 * Enforced by type: ReflectionResult has no score field.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Genome, ReflectiveRecord, ReflectionResult } from "./types.js";

export interface Reflector {
  reflect(args: {
    candidate: Genome;
    component: string;
    records: ReflectiveRecord[];
    ancestorLessons: string[];
  }): Promise<ReflectionResult>;
}

/** Parse failure event — logged to lineage, never propagates as a crash. */
export interface ReflectParseFailure {
  kind: "reflect_parse_failure";
  component: string;
  attempt: number;
}

// ── Real reflector (Opus 4.8 via PAI inference) ─────────────────────────────

export interface LLMClient {
  complete(args: {
    model: string;
    prompt: string;
    temperature: number;
    maxTokens: number;
  }): Promise<string>;
}

export class OpusReflector implements Reflector {
  private readonly promptTemplate: string;

  constructor(
    private readonly llm: LLMClient,
    private readonly model = "claude-opus-4-8",
    private readonly temperature = 0.2,
    private readonly promptDir?: string,
  ) {
    const promptFile = join(
      promptDir ?? process.cwd(),
      "prompts",
      "reflect.v1.md",
    );
    try {
      this.promptTemplate = readFileSync(promptFile, "utf-8");
    } catch {
      // Fallback skeleton if file not yet on disk
      this.promptTemplate = INLINE_PROMPT_SKELETON;
    }
  }

  async reflect(args: {
    candidate: Genome;
    component: string;
    records: ReflectiveRecord[];
    ancestorLessons: string[];
  }): Promise<ReflectionResult> {
    const prompt = this.buildPrompt(args);
    const promptHash = createHash("sha256").update(prompt, "utf8").digest("hex").slice(0, 16);

    let raw = "";
    let parsed: { diagnosis: string; proposedValue: string; lesson: string } | null = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      const suffix =
        attempt === 1
          ? "\n\nYour previous output was not valid JSON. Return ONLY the JSON object."
          : "";
      raw = await this.llm.complete({
        model: this.model,
        prompt: prompt + suffix,
        temperature: this.temperature,
        maxTokens: 2048,
      });
      parsed = tryParseReflectionJson(raw);
      if (parsed) break;
    }

    if (!parsed) {
      // Failure — caller logs ReflectParseFailure; we return a no-op reflection
      return {
        component: args.component,
        diagnosis: "parse_failure",
        proposedValue: args.candidate.editable[args.component] ?? "",
        lesson: "",
        promptHash,
      };
    }

    return {
      component: args.component,
      diagnosis: parsed.diagnosis,
      proposedValue: parsed.proposedValue,
      lesson: parsed.lesson,
      promptHash,
    };
  }

  private buildPrompt(args: {
    candidate: Genome;
    component: string;
    records: ReflectiveRecord[];
    ancestorLessons: string[];
  }): string {
    const currentValue = args.candidate.editable[args.component] ?? "(empty)";
    const lessonsBlock =
      args.ancestorLessons.length > 0
        ? args.ancestorLessons.map((l, i) => `${i + 1}. ${l}`).join("\n")
        : "(none yet)";

    const evidenceBlock = args.records
      .map(
        r =>
          `---\nINSTANCE: ${r.taskId}\nINPUT:\n${JSON.stringify(r.input, null, 2)}\nFEEDBACK:\n${r.feedback}\nMEASURED SCORE: ${r.score.toFixed(4)}`,
      )
      .join("\n");

    return this.promptTemplate
      .replace("{{component}}", args.component)
      .replace("{{currentValue}}", currentValue)
      .replace("{{componentConstraints}}", getConstraints(args.component))
      .replace("{{ancestorLessons}}", lessonsBlock)
      .replace("{{#each records}}\n---\nINSTANCE: {{taskId}}\nINPUT:\n{{input}}\nWHAT HAPPENED (tool calls, in order):\n{{toolCallSummary}}\nFEEDBACK:\n{{feedback}}\nMEASURED SCORE (correctness, confidence, cost): {{scoreSummary}}\n{{/each}}", evidenceBlock);
  }
}

function tryParseReflectionJson(
  raw: string,
): { diagnosis: string; proposedValue: string; lesson: string } | null {
  // Extract JSON object from response (model might include prose around it)
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    if (
      typeof parsed["diagnosis"] === "string" &&
      typeof parsed["proposedValue"] === "string" &&
      typeof parsed["lesson"] === "string"
    ) {
      return {
        diagnosis: parsed["diagnosis"],
        proposedValue: parsed["proposedValue"],
        lesson: parsed["lesson"],
      };
    }
    return null;
  } catch {
    return null;
  }
}

function getConstraints(component: string): string {
  if (component === "tool_slots") {
    return "Must be a comma-separated list of 1-4 valid martianbrain tool names.";
  }
  return "(none specified)";
}

const INLINE_PROMPT_SKELETON = `# ROLE
You are a senior reliability engineer diagnosing one autonomous agent's behavior.
You are improving exactly ONE named component of its configuration.

COMPONENT UNDER REVISION: {{component}}

CURRENT VALUE OF THIS COMPONENT:
{{currentValue}}

CONSTRAINTS ON THIS COMPONENT (must hold for any proposedValue):
{{componentConstraints}}

# ACCUMULATED LESSONS FROM ANCESTORS
{{ancestorLessons}}

# EVIDENCE
{{#each records}}
---
INSTANCE: {{taskId}}
INPUT:
{{input}}
WHAT HAPPENED (tool calls, in order):
{{toolCallSummary}}
FEEDBACK:
{{feedback}}
MEASURED SCORE (correctness, confidence, cost): {{scoreSummary}}
{{/each}}
---

# OUTPUT (JSON only)
{
  "diagnosis": "The specific recurring failure pattern, grounded in the evidence.",
  "proposedValue": "A complete replacement value for the component.",
  "lesson": "One to three sentences a future revision should carry forward."
}`;

// ── Mock reflector for tests ─────────────────────────────────────────────────

export class MockReflector implements Reflector {
  private readonly _responses: Map<
    string,
    { diagnosis: string; proposedValue: string; lesson: string }
  >;

  constructor(
    responses: Map<
      string,
      { diagnosis: string; proposedValue: string; lesson: string }
    > = new Map(),
  ) {
    this._responses = responses;
  }

  async reflect(args: {
    candidate: Genome;
    component: string;
    records: ReflectiveRecord[];
    ancestorLessons: string[];
  }): Promise<ReflectionResult> {
    const key = `${args.candidate.id}:${args.component}`;
    const response = this._responses.get(key) ?? {
      diagnosis: "mock_diagnosis",
      proposedValue: args.candidate.editable[args.component] ?? "",
      lesson: "mock_lesson",
    };
    const promptHash = createHash("sha256")
      .update(key, "utf8")
      .digest("hex")
      .slice(0, 16);
    return { component: args.component, ...response, promptHash };
  }
}
