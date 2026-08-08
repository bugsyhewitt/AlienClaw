/**
 * InMemoryEvolutionStore — unit tests for the 6 cold branch arms (IME-101..105).
 *
 * No DB required. Pure in-memory. Covers arms in store.ts:232-281 that the
 * engine/governance suites leave cold.
 */
import { describe, it, expect } from "vitest";
import { InMemoryEvolutionStore } from "../../../src/alienclaw/evolution/reflective/store.js";
import type { LineageEdge } from "../../../src/alienclaw/evolution/reflective/types.js";

describe("InMemoryEvolutionStore — cold branch coverage", () => {
  it("IME-101: getGenome rejects with 'Genome not found' for unknown id", async () => {
    const store = new InMemoryEvolutionStore();
    await expect(store.getGenome("nonexistent-id")).rejects.toThrow("Genome not found");
  });

  it("IME-102: lineageLessons returns [] when no lineage edge exists for genome", async () => {
    const store = new InMemoryEvolutionStore();
    const lessons = await store.lineageLessons("orphan-id");
    expect(lessons).toEqual([]);
  });

  it("IME-103: lineageLessons skips edge with no lesson (reflection undefined)", async () => {
    const store = new InMemoryEvolutionStore();
    const edge: LineageEdge = { parentId: null, childId: "child-103", op: "seed" };
    await store.recordLineage(edge);
    const lessons = await store.lineageLessons("child-103");
    expect(lessons).toEqual([]);
  });

  it("IME-104: lineageLessons deduplicates repeated lesson across the chain", async () => {
    const store = new InMemoryEvolutionStore();
    // chain: child-104c → child-104b → child-104a → (no parent)
    const reflection = (lesson: string, hash: string) => ({
      component: "c", diagnosis: "d", proposedValue: "v", lesson, promptHash: hash,
    });
    await store.recordLineage({ parentId: null,          childId: "child-104a", op: "seed",   reflection: reflection("root",      "h1") });
    await store.recordLineage({ parentId: "child-104a",  childId: "child-104b", op: "mutate", reflection: reflection("duplicate", "h2") });
    await store.recordLineage({ parentId: "child-104b",  childId: "child-104c", op: "mutate", reflection: reflection("duplicate", "h3") });

    const lessons = await store.lineageLessons("child-104c");
    expect(lessons).toEqual(["duplicate", "root"]);
  });

  it("IME-105-cycle-self: lineageLessons terminates on self-cycle (parentId === childId) (PKT-559)", async () => {
    const store = new InMemoryEvolutionStore();
    const reflection = (lesson: string) => ({
      component: "c", diagnosis: "d", proposedValue: "v", lesson, promptHash: "h",
    });
    // self-cycle: childId === parentId — infinite loop without visited guard
    await store.recordLineage({
      childId: "genome-self", parentId: "genome-self", op: "mutate",
      reflection: reflection("self-lesson"),
    });
    const result = await store.lineageLessons("genome-self");
    expect(result).toEqual(["self-lesson"]);
  });

  it("IME-106-cycle-two-node: lineageLessons terminates on A→B→A 2-node cycle (PKT-559)", async () => {
    const store = new InMemoryEvolutionStore();
    const reflection = (lesson: string) => ({
      component: "c", diagnosis: "d", proposedValue: "v", lesson, promptHash: "h",
    });
    // 2-node cycle: child-A → child-B → child-A — infinite loop without visited guard
    await store.recordLineage({ childId: "child-A", parentId: "child-B", op: "mutate", reflection: reflection("lesson-A") });
    await store.recordLineage({ childId: "child-B", parentId: "child-A", op: "mutate", reflection: reflection("lesson-B") });
    const result = await store.lineageLessons("child-A");
    expect(result).toEqual(["lesson-A", "lesson-B"]);
  });

  it("IME-105: loadRun returns best:null and empty frontier when no snapshot exists", async () => {
    const store = new InMemoryEvolutionStore();
    const result = await store.loadRun("any-handle");
    expect(result.best).toBeNull();
    expect(result.frontier).toEqual([]);
    expect(result.archive).toBeNull();
  });
});
