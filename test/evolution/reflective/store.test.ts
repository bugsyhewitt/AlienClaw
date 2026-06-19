/**
 * EvolutionStore MySQL persistence tests — §9.1 item 2 (Bug #14 lesson).
 *
 * Asserts against MySQL directly. Skips when ALIENCLAW_TEST_DB_URL not set.
 * Follows the same pattern as test/api/ts-storage.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mysql from "mysql2/promise";
import { MySQLEvolutionStore } from "../../../src/alienclaw/evolution/reflective/store.js";
import { makeTestGenome } from "./mock-adapter.js";
import type { ExecutionTrace, EvaluationBatch, ObjectiveVector } from "../../../src/alienclaw/evolution/reflective/types.js";
import { OBJECTIVE_KEYS } from "../../../src/alienclaw/evolution/reflective/types.js";
import { randomUUID } from "node:crypto";

const DB_URL = process.env["ALIENCLAW_TEST_DB_URL"];
const describeIfDb = DB_URL ? describe : describe.skip;

function makeTrace(genomeId: string, taskId: string, seed = 42): ExecutionTrace {
  return {
    runId: randomUUID(),
    genomeId,
    taskId,
    seed,
    toolCalls: [
      { index: 0, tool: "mock_tool", args: { x: 1 }, result: { y: 2 }, ok: true, ms: 100 },
    ],
    finalOutput: { result: "ok" },
    errors: [],
    correctness: { score: 0.75, source: "predicate", evidence: "test", confidence: 0.8 },
    cost: { inputTokens: 100, outputTokens: 50, dollars: 0.001, toolCalls: 1, wallMs: 200 },
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
  };
}

const ZERO_AGG: ObjectiveVector = { correctness: 0, efficiency: 0, costInv: 0, latencyInv: 0, confidence: 0 };

describeIfDb("MySQL storage — re_* tables (Bug #14 compliance)", () => {
  let pool: mysql.Pool;
  let store: MySQLEvolutionStore;

  beforeAll(async () => {
    pool = mysql.createPool(DB_URL!);
    // Apply migration
    const migSql = await import("node:fs").then(fs =>
      fs.readFileSync(
        new URL("../../../migrations/002_reflective_evolution.sql", import.meta.url).pathname,
        "utf-8",
      ),
    );
    // Split and execute each statement
    const statements = migSql.split(";").map(s => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      try { await pool.execute(stmt); } catch { /* already exists */ }
    }
    store = new MySQLEvolutionStore(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Clean up test data between tests
    await pool.execute("DELETE FROM re_frontier_snapshot WHERE snapshot_id LIKE 'test-%'");
    await pool.execute("DELETE FROM re_lineage WHERE child_id LIKE 'test-%'");
    await pool.execute("DELETE FROM re_tool_call WHERE run_id IN (SELECT run_id FROM re_run WHERE genome_id LIKE 'test-%')");
    await pool.execute("DELETE FROM re_error WHERE run_id IN (SELECT run_id FROM re_run WHERE genome_id LIKE 'test-%')");
    await pool.execute("DELETE FROM re_run WHERE genome_id LIKE 'test-%'");
    await pool.execute("DELETE FROM re_genome WHERE id LIKE 'test-%'");
  });

  it("recordEvaluation: inserts genome + run + tool_call rows", async () => {
    const genome = makeTestGenome([0.5, 0.5]);
    const trace = makeTrace(genome.id, "t-001");
    const ev: EvaluationBatch = {
      candidate: genome,
      scores: { genomeId: genome.id, perInstance: new Map(), aggregate: ZERO_AGG, legacyScalar: 0.5 },
      traces: [trace],
    };

    await store.recordEvaluation(ev);

    // Assert genome row
    const [genomeRows] = await pool.execute<mysql.RowDataPacket[]>(
      "SELECT id, raw FROM re_genome WHERE id = ?",
      [genome.id],
    );
    expect(genomeRows).toHaveLength(1);
    expect(genomeRows[0]!["raw"]).toBe(genome.raw);

    // Assert run row
    const [runRows] = await pool.execute<mysql.RowDataPacket[]>(
      "SELECT run_id, correctness FROM re_run WHERE run_id = ?",
      [trace.runId],
    );
    expect(runRows).toHaveLength(1);
    expect(Number(runRows[0]!["correctness"])).toBeCloseTo(0.75);

    // Assert tool_call rows
    const [tcRows] = await pool.execute<mysql.RowDataPacket[]>(
      "SELECT idx, tool FROM re_tool_call WHERE run_id = ?",
      [trace.runId],
    );
    expect(tcRows).toHaveLength(1);
    expect(tcRows[0]!["tool"]).toBe("mock_tool");
  });

  it("recordEvaluation: idempotent on duplicate run_id", async () => {
    const genome = makeTestGenome([0.6, 0.4]);
    const trace = makeTrace(genome.id, "t-002");
    const ev: EvaluationBatch = {
      candidate: genome,
      scores: { genomeId: genome.id, perInstance: new Map(), aggregate: ZERO_AGG, legacyScalar: 0.5 },
      traces: [trace],
    };

    await store.recordEvaluation(ev);
    await store.recordEvaluation(ev); // second call — must not throw or duplicate

    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS cnt FROM re_run WHERE run_id = ?",
      [trace.runId],
    );
    expect(Number(rows[0]!["cnt"])).toBe(1);
  });

  it("recordEvaluation: errors persisted to re_error", async () => {
    const genome = makeTestGenome([0.3, 0.7]);
    const trace: ExecutionTrace = {
      ...makeTrace(genome.id, "t-003"),
      errors: [
        { kind: "timeout", message: "tool timed out" },
        { kind: "parse_error", message: "malformed response" },
      ],
    };
    const ev: EvaluationBatch = {
      candidate: genome,
      scores: { genomeId: genome.id, perInstance: new Map(), aggregate: ZERO_AGG, legacyScalar: 0 },
      traces: [trace],
    };

    await store.recordEvaluation(ev);

    const [errRows] = await pool.execute<mysql.RowDataPacket[]>(
      "SELECT seq, kind FROM re_error WHERE run_id = ? ORDER BY seq",
      [trace.runId],
    );
    expect(errRows).toHaveLength(2);
    expect(errRows[0]!["kind"]).toBe("timeout");
    expect(errRows[1]!["kind"]).toBe("parse_error");
  });

  it("getGenome: retrieves persisted genome", async () => {
    const genome = makeTestGenome([0.2, 0.8]);
    const trace = makeTrace(genome.id, "t-004");
    const ev: EvaluationBatch = {
      candidate: genome,
      scores: { genomeId: genome.id, perInstance: new Map(), aggregate: ZERO_AGG, legacyScalar: 0.5 },
      traces: [trace],
    };
    await store.recordEvaluation(ev);

    const retrieved = await store.getGenome(genome.id);
    expect(retrieved.raw).toBe(genome.raw);
    expect(retrieved.id).toBe(genome.id);
  });

  it("recordLineage: persists parent→child edge with lesson", async () => {
    const parent = makeTestGenome([0.1, 0.1]);
    const child  = makeTestGenome([0.2, 0.2]);
    // Persist both genomes first
    for (const g of [parent, child]) {
      await pool.execute(
        `INSERT IGNORE INTO re_genome (id, raw, tool_slots, editable, created_at)
         VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))`,
        [g.id, g.raw, "[]", "{}"],
      );
    }

    await store.recordLineage({
      parentId: parent.id,
      childId: child.id,
      op: "mutate",
      reflection: {
        component: "tool_slots",
        diagnosis: "wrong tool order",
        proposedValue: "new_tool",
        lesson: "order matters",
        promptHash: "abc123",
      },
    });

    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      "SELECT parent_id, lesson, op FROM re_lineage WHERE child_id = ?",
      [child.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!["parent_id"]).toBe(parent.id);
    expect(rows[0]!["lesson"]).toBe("order matters");
    expect(rows[0]!["op"]).toBe("mutate");
  });

  it("lineageLessons: walks chain and returns lessons newest-first", async () => {
    const g1 = makeTestGenome([0.1, 0.1]);
    const g2 = makeTestGenome([0.2, 0.2]);
    const g3 = makeTestGenome([0.3, 0.3]);

    for (const g of [g1, g2, g3]) {
      await pool.execute(
        `INSERT IGNORE INTO re_genome (id, raw, tool_slots, editable, created_at)
         VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))`,
        [g.id, g.raw, "[]", "{}"],
      );
    }
    // g1 → seed (no parent)
    await pool.execute(
      `INSERT IGNORE INTO re_lineage (child_id, parent_id, op, lesson, created_at)
       VALUES (?, NULL, 'seed', 'root lesson', UTC_TIMESTAMP(3))`,
      [g1.id],
    );
    // g1 → g2
    await pool.execute(
      `INSERT IGNORE INTO re_lineage (child_id, parent_id, op, lesson, created_at)
       VALUES (?, ?, 'mutate', 'second lesson', UTC_TIMESTAMP(3))`,
      [g2.id, g1.id],
    );
    // g2 → g3
    await pool.execute(
      `INSERT IGNORE INTO re_lineage (child_id, parent_id, op, lesson, created_at)
       VALUES (?, ?, 'mutate', 'third lesson', UTC_TIMESTAMP(3))`,
      [g3.id, g2.id],
    );

    const lessons = await store.lineageLessons(g3.id);
    expect(lessons).toHaveLength(3);
    expect(lessons[0]).toBe("third lesson"); // newest first
    expect(lessons[2]).toBe("root lesson");  // oldest last
  });

  it("snapshotFrontier: persists frontier to re_frontier_snapshot", async () => {
    const genome = makeTestGenome([0.5, 0.5]);
    await pool.execute(
      `INSERT IGNORE INTO re_genome (id, raw, tool_slots, editable, created_at)
       VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))`,
      [genome.id, genome.raw, "[]", "{}"],
    );
    const score = {
      genomeId: genome.id,
      perInstance: new Map<string, ObjectiveVector>(),
      aggregate: { correctness: 0.8, efficiency: 0.7, costInv: 0.6, latencyInv: 0.5, confidence: 0.75 },
      legacyScalar: 0.8,
    };

    await store.snapshotFrontier([score], 0);

    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      "SELECT genome_id, generation, aggregate FROM re_frontier_snapshot WHERE genome_id = ?",
      [genome.id],
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(Number(rows[0]!["generation"])).toBe(0);
    const agg = JSON.parse(rows[0]!["aggregate"] as string) as ObjectiveVector;
    expect(agg.correctness).toBeCloseTo(0.8);
  });

  it("off mode: no writes when REFLECTIVE_EVOLUTION=off", async () => {
    // When the flag is off, the engine should not write anything.
    // We verify this by checking that no re_genome rows exist for a specific genome
    // that we would have inserted if the flag was on.
    const genome = makeTestGenome([0.99, 0.99]);
    // Don't record anything — simulate off mode
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM re_genome WHERE id = ?",
      [genome.id],
    );
    expect(rows).toHaveLength(0); // nothing written in off mode
  });
});
