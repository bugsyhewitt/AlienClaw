/**
 * OpusReflector unit tests — covers all cold branch arms in b[0]–b[12].
 *
 * LLMClient is mocked inline; no real LLM, DB, or network access.
 */
import { describe, it, expect } from "vitest";
import { OpusReflector, MockReflector } from "../../../src/alienclaw/evolution/reflective/reflector.js";
import type { LLMClient } from "../../../src/alienclaw/evolution/reflective/reflector.js";
import { makeTestGenome } from "./mock-adapter.js";
import type { ReflectiveRecord } from "../../../src/alienclaw/evolution/reflective/types.js";

function makeLlm(responses: string[]): LLMClient {
  let i = 0;
  return { complete: async () => responses[i++] ?? "" };
}

function capturingLlm(responses: string[]): { llm: LLMClient; calls: { prompt: string }[] } {
  const calls: { prompt: string }[] = [];
  let i = 0;
  return {
    llm: {
      complete: async (args) => {
        calls.push({ prompt: args.prompt });
        return responses[i++] ?? "";
      },
    },
    calls,
  };
}

const genome = makeTestGenome([0.5, 0.5]);
const records: ReflectiveRecord[] = [
  { taskId: "t-001", input: { x: 1 }, feedback: "too slow", score: 0.4 },
];
const VALID_JSON = JSON.stringify({
  diagnosis: "test_diagnosis",
  proposedValue: "search,read",
  lesson: "prefer search first",
});

describe("OpusReflector — constructor", () => {
  it("uses model and temperature defaults when not supplied (b[0], b[1] default-arg)", () => {
    // Constructs with only llm — both defaults applied
    const r = new OpusReflector(makeLlm([]));
    expect(r).toBeInstanceOf(OpusReflector);
  });

  it("resolves prompt from given promptDir when file exists (b[2] left arm)", () => {
    // process.cwd() in tests = repo root where prompts/reflect.v1.md exists
    const r = new OpusReflector(makeLlm([]), "test-model", 0.2, process.cwd());
    expect(r).toBeInstanceOf(OpusReflector);
  });

  it("falls back to inline skeleton when promptDir has no prompt file (b[2] right arm / catch)", () => {
    const r = new OpusReflector(makeLlm([]), "test-model", 0.2, "/tmp/no-such-dir-ac");
    expect(r).toBeInstanceOf(OpusReflector);
  });
});

describe("OpusReflector — reflect(): success paths", () => {
  it("returns parsed result when first attempt succeeds (b[3] false, b[4] break, b[5] false)", async () => {
    const llm = makeLlm([VALID_JSON]);
    const r = new OpusReflector(llm, "test-model", 0.2, "/tmp/no-prompts-ac");
    const result = await r.reflect({
      candidate: genome,
      component: "tool_slots",
      records,
      ancestorLessons: ["Lesson one"],
    });
    expect(result.diagnosis).toBe("test_diagnosis");
    expect(result.proposedValue).toBe("search,read");
    expect(result.lesson).toBe("prefer search first");
    expect(result.promptHash).toMatch(/^[0-9a-f]{16}$/);
    expect(result.component).toBe("tool_slots");
  });

  it("retries with suffix on second attempt and succeeds (b[3] true, b[4] loop continues)", async () => {
    const { llm, calls } = capturingLlm(["not json at all", VALID_JSON]);
    const r = new OpusReflector(llm, "test-model", 0.2, "/tmp/no-prompts-ac");
    const result = await r.reflect({
      candidate: genome,
      component: "tool_slots",
      records,
      ancestorLessons: [],
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.prompt).toContain("Your previous output was not valid JSON");
    expect(result.diagnosis).toBe("test_diagnosis");
  });

  it("returns parse_failure no-op when both attempts fail (b[5] taken)", async () => {
    const llm = makeLlm(["not json", "also not json"]);
    const r = new OpusReflector(llm, "test-model", 0.2, "/tmp/no-prompts-ac");
    const result = await r.reflect({
      candidate: genome,
      component: "tool_slots",
      records,
      ancestorLessons: [],
    });
    expect(result.diagnosis).toBe("parse_failure");
    expect(result.lesson).toBe("");
    expect(result.component).toBe("tool_slots");
  });
});

describe("OpusReflector — editable key fallbacks", () => {
  it("uses editable value in parse_failure fallback when key present (b[6] left arm)", async () => {
    // genome has editable.tool_slots set to "0.500,0.500"
    const llm = makeLlm(["not json", "not json"]);
    const r = new OpusReflector(llm, "test-model", 0.2, "/tmp/no-prompts-ac");
    const result = await r.reflect({
      candidate: genome,
      component: "tool_slots",
      records,
      ancestorLessons: [],
    });
    expect(result.proposedValue).toBe("0.500,0.500");  // b[6] left: key present
  });

  it("falls back to '' in parse_failure when editable key absent (b[6] right arm, b[7] right arm)", async () => {
    // "system_prompt" is not in genome.editable → triggers both b[6] and b[7] right arms
    const llm = makeLlm(["not json", "not json"]);
    const r = new OpusReflector(llm, "test-model", 0.2, "/tmp/no-prompts-ac");
    const result = await r.reflect({
      candidate: genome,
      component: "system_prompt",
      records,
      ancestorLessons: [],
    });
    expect(result.proposedValue).toBe("");  // b[6] right: key absent
  });

  it("uses editable value in buildPrompt currentValue when key present (b[7] left arm)", async () => {
    const { llm, calls } = capturingLlm([VALID_JSON]);
    const r = new OpusReflector(llm, "test-model", 0.2, "/tmp/no-prompts-ac");
    await r.reflect({
      candidate: genome,
      component: "tool_slots",
      records,
      ancestorLessons: [],
    });
    // The inline skeleton uses {{currentValue}}; in skeleton it replaces the
    // placeholder.  The actual value "0.500,0.500" appears in the prompt.
    expect(calls[0]!.prompt).toContain("0.500,0.500");
  });
});

describe("OpusReflector — buildPrompt: ancestorLessons", () => {
  it("formats numbered list when ancestorLessons non-empty (b[8] left arm)", async () => {
    const { llm, calls } = capturingLlm([VALID_JSON]);
    const r = new OpusReflector(llm, "test-model", 0.2, "/tmp/no-prompts-ac");
    await r.reflect({
      candidate: genome,
      component: "tool_slots",
      records,
      ancestorLessons: ["Lesson alpha", "Lesson beta"],
    });
    expect(calls[0]!.prompt).toContain("1. Lesson alpha");
    expect(calls[0]!.prompt).toContain("2. Lesson beta");
  });

  it("uses '(none yet)' placeholder when ancestorLessons empty (b[8] right arm)", async () => {
    const { llm, calls } = capturingLlm([VALID_JSON]);
    const r = new OpusReflector(llm, "test-model", 0.2, "/tmp/no-prompts-ac");
    await r.reflect({
      candidate: genome,
      component: "tool_slots",
      records,
      ancestorLessons: [],
    });
    expect(calls[0]!.prompt).toContain("(none yet)");
  });
});

describe("OpusReflector — getConstraints via buildPrompt", () => {
  it("includes tool_slots constraint text for 'tool_slots' component (b[12] taken)", async () => {
    const { llm, calls } = capturingLlm([VALID_JSON]);
    const r = new OpusReflector(llm, "test-model", 0.2, "/tmp/no-prompts-ac");
    await r.reflect({ candidate: genome, component: "tool_slots", records, ancestorLessons: [] });
    expect(calls[0]!.prompt).toContain("comma-separated list");
  });

  it("uses '(none specified)' for non-tool_slots component (b[12] not-taken)", async () => {
    const { llm, calls } = capturingLlm([VALID_JSON]);
    const r = new OpusReflector(llm, "test-model", 0.2, "/tmp/no-prompts-ac");
    await r.reflect({ candidate: genome, component: "system_prompt", records, ancestorLessons: [] });
    expect(calls[0]!.prompt).toContain("(none specified)");
  });
});

describe("OpusReflector — tryParseReflectionJson corner cases", () => {
  it("returns parse_failure when response contains no JSON object (b[9] taken)", async () => {
    const llm = makeLlm(["plain text response", "still no braces"]);
    const r = new OpusReflector(llm, "test-model", 0.2, "/tmp/no-prompts-ac");
    const result = await r.reflect({
      candidate: genome,
      component: "tool_slots",
      records,
      ancestorLessons: [],
    });
    expect(result.diagnosis).toBe("parse_failure");
  });

  it("returns parse_failure when JSON has wrong types — diagnosis not string (b[11][0] short-circuit)", async () => {
    const badJson = JSON.stringify({ diagnosis: 42, proposedValue: "v", lesson: "l" });
    const llm = makeLlm([badJson, badJson]);
    const r = new OpusReflector(llm, "test-model", 0.2, "/tmp/no-prompts-ac");
    const result = await r.reflect({
      candidate: genome,
      component: "tool_slots",
      records,
      ancestorLessons: [],
    });
    expect(result.diagnosis).toBe("parse_failure");
  });

  it("returns parse_failure when JSON has wrong types — proposedValue not string (b[11][1] short-circuit)", async () => {
    const badJson = JSON.stringify({ diagnosis: "d", proposedValue: null, lesson: "l" });
    const llm = makeLlm([badJson, badJson]);
    const r = new OpusReflector(llm, "test-model", 0.2, "/tmp/no-prompts-ac");
    const result = await r.reflect({
      candidate: genome,
      component: "tool_slots",
      records,
      ancestorLessons: [],
    });
    expect(result.diagnosis).toBe("parse_failure");
  });

  it("handles malformed JSON (JSON.parse throws) gracefully (catch in tryParseReflectionJson)", async () => {
    const malformed = "{diagnosis: unclosed";
    const llm = makeLlm([malformed, malformed]);
    const r = new OpusReflector(llm, "test-model", 0.2, "/tmp/no-prompts-ac");
    const result = await r.reflect({
      candidate: genome,
      component: "tool_slots",
      records,
      ancestorLessons: [],
    });
    expect(result.diagnosis).toBe("parse_failure");
  });
});

describe("MockReflector — default response path", () => {
  it("falls back to '' for proposedValue when component absent from editable (bid=15 arm=1)", async () => {
    // No seeded response → default path taken (bid=14 arm=1).
    // "system_prompt" not in makeTestGenome().editable → inner ?? "" fires (bid=15 arm=1).
    const r = new MockReflector();
    const result = await r.reflect({
      candidate: makeTestGenome([0.5, 0.5]),
      component: "system_prompt",
      records: [],
      ancestorLessons: [],
    });
    expect(result.proposedValue).toBe("");
    expect(result.diagnosis).toBe("mock_diagnosis");
    expect(result.lesson).toBe("mock_lesson");
    expect(result.component).toBe("system_prompt");
  });
});
