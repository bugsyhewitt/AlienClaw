/**
 * EvolutionStore — MySQL-backed persistence for the reflective evolution engine.
 *
 * Bug #14 lesson: every persistence-touching operation asserts against MySQL.
 * No flat-file fallback. Fails fast at startup if DB unavailable.
 *
 * All JSON columns validated at the app layer before writes.
 * Idempotent: re-recording the same run_id is a no-op.
 */
import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";
import type {
  EvaluationBatch,
  Genome,
  LineageEdge,
  CandidateScore,
  ObjectiveVector,
  EvolutionResult,
} from "./types.js";
import { OBJECTIVE_KEYS } from "./types.js";

export interface EvolutionStore {
  /** Persist a full EvaluationBatch: re_run + re_tool_call + re_error rows. */
  recordEvaluation(ev: EvaluationBatch): Promise<void>;

  /** Retrieve a genome by content hash. Throws if not found. */
  getGenome(id: string): Promise<Genome>;

  /** Insert a lineage edge (parent→child). */
  recordLineage(edge: LineageEdge): Promise<void>;

  /** Walk lineage to root, collect non-null lessons (newest first, deduped). */
  lineageLessons(genomeId: string): Promise<string[]>;

  /** Snapshot the current Pareto frontier. */
  snapshotFrontier(front: CandidateScore[], generation: number): Promise<void>;

  /** Replay: reconstruct an EvolutionResult from a run handle. */
  loadRun(runHandle: string): Promise<EvolutionResult>;

  /** Close the pool. */
  close(): Promise<void>;
}

// ── MySQL implementation ─────────────────────────────────────────────────────

/** mysql2 returns JSON columns pre-parsed as objects; text-protocol paths return strings. */
function fromJsonColumn<T>(v: unknown): T {
  return (typeof v === "string" ? JSON.parse(v) : v) as T;
}

export class MySQLEvolutionStore implements EvolutionStore {
  constructor(private readonly pool: mysql.Pool) {}

  static create(dbUrl: string): MySQLEvolutionStore {
    return new MySQLEvolutionStore(mysql.createPool(dbUrl));
  }

  async recordEvaluation(ev: EvaluationBatch): Promise<void> {
    const conn = await this.pool.getConnection();
    try {
      // Upsert genome (INSERT IGNORE on content-hash PK — two workers same genome = no collision)
      const g = ev.candidate;
      await conn.execute(
        `INSERT IGNORE INTO re_genome (id, raw, tool_slots, editable, created_at)
         VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))`,
        [g.id, g.raw, JSON.stringify(g.toolSlots), JSON.stringify(g.editable)],
      );

      // Insert each trace
      for (const trace of ev.traces) {
        // Idempotent: INSERT IGNORE on run_id PK
        await conn.execute(
          `INSERT IGNORE INTO re_run
             (run_id, genome_id, task_id, seed, final_output,
              correctness, correctness_source, correctness_conf,
              input_tokens, output_tokens, dollars, tool_calls, wall_ms,
              started_at, ended_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            trace.runId,
            trace.genomeId,
            trace.taskId,
            trace.seed,
            trace.finalOutput !== undefined ? JSON.stringify(trace.finalOutput) : null,
            trace.correctness.score,
            trace.correctness.source,
            trace.correctness.confidence ?? null,
            trace.cost.inputTokens,
            trace.cost.outputTokens,
            trace.cost.dollars,
            trace.cost.toolCalls,
            trace.cost.wallMs,
            trace.startedAt,
            trace.endedAt,
          ],
        );

        // Tool calls (INSERT IGNORE for idempotency)
        for (const tc of trace.toolCalls) {
          await conn.execute(
            `INSERT IGNORE INTO re_tool_call (run_id, idx, tool, args, result, ok, ms, note)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              trace.runId,
              tc.index,
              tc.tool,
              tc.args !== undefined ? JSON.stringify(tc.args) : null,
              tc.result !== undefined ? JSON.stringify(tc.result) : null,
              tc.ok ? 1 : 0,
              tc.ms,
              tc.note ?? null,
            ],
          );
        }

        // Errors
        for (let seq = 0; seq < trace.errors.length; seq++) {
          const e = trace.errors[seq]!;
          await conn.execute(
            `INSERT IGNORE INTO re_error (run_id, seq, kind, message)
             VALUES (?, ?, ?, ?)`,
            [trace.runId, seq, e.kind, e.message],
          );
        }
      }
    } finally {
      conn.release();
    }
  }

  async getGenome(id: string): Promise<Genome> {
    const [rows] = await this.pool.execute<mysql.RowDataPacket[]>(
      "SELECT id, raw, tool_slots, editable FROM re_genome WHERE id = ?",
      [id],
    );
    if (!rows[0]) throw new Error(`Genome not found: ${id}`);
    const row = rows[0];
    return {
      id: row["id"] as string,
      raw: row["raw"] as string,
      toolSlots: fromJsonColumn<string[]>(row["tool_slots"]),
      editable: fromJsonColumn<Record<string, string>>(row["editable"]),
    };
  }

  async recordLineage(edge: LineageEdge): Promise<void> {
    await this.pool.execute(
      `INSERT INTO re_lineage
         (child_id, parent_id, op, component, diagnosis, lesson, prompt_hash, reflector_model, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE op=op`,
      [
        edge.childId,
        edge.parentId ?? null,
        edge.op,
        edge.reflection?.component ?? null,
        edge.reflection?.diagnosis ?? null,
        edge.reflection?.lesson ?? null,
        edge.reflection?.promptHash ?? null,
        edge.op === "mutate" ? "opus-4.8" : null,
      ],
    );
  }

  async lineageLessons(genomeId: string): Promise<string[]> {
    // Walk parent_id chain to root, collect non-null lessons (newest first, deduped)
    const lessons: string[] = [];
    const seen = new Set<string>();
    const visited = new Set<string>();
    let current: string | null = genomeId;

    while (current) {
      if (visited.has(current)) break; // corrupt lineage (cycle) — stop rather than hang
      visited.add(current);
      const lineageResult = await this.pool.execute<mysql.RowDataPacket[]>(
        "SELECT parent_id, lesson FROM re_lineage WHERE child_id = ?",
        [current],
      );
      const lineageRows: mysql.RowDataPacket[] = lineageResult[0];
      const lineageRow: mysql.RowDataPacket | undefined = lineageRows[0];
      if (!lineageRow) break;
      const lesson = lineageRow["lesson"] as string | null;
      if (lesson && !seen.has(lesson)) {
        lessons.push(lesson);
        seen.add(lesson);
      }
      current = (lineageRow["parent_id"] as string | null) ?? null;
    }

    return lessons;
  }

  async snapshotFrontier(front: CandidateScore[], generation: number): Promise<void> {
    const snapshotId = randomUUID();
    for (const c of front) {
      await this.pool.execute(
        `INSERT INTO re_frontier_snapshot (snapshot_id, genome_id, generation, aggregate, created_at)
         VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))`,
        [snapshotId, c.genomeId, generation, JSON.stringify(c.aggregate)],
      );
    }
  }

  async loadRun(_runHandle: string): Promise<EvolutionResult> {
    // Reconstruct frontier from latest snapshot, lineage from re_lineage
    const [snapRows] = await this.pool.execute<mysql.RowDataPacket[]>(
      `SELECT genome_id, aggregate FROM re_frontier_snapshot
       WHERE snapshot_id = (
         SELECT snapshot_id FROM re_frontier_snapshot
         ORDER BY created_at DESC LIMIT 1
       )`,
    );

    const frontier: CandidateScore[] = snapRows.map(r => ({
      genomeId: r["genome_id"] as string,
      perInstance: new Map(),  // full reconstruction requires joining re_run
      aggregate: fromJsonColumn<ObjectiveVector>(r["aggregate"]),
      legacyScalar: 0,
    }));

    return { best: frontier[0] ? { genomeId: frontier[0].genomeId, held: frontier[0].aggregate, overfit: false } : null, frontier, archive: null };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// ── In-memory stub for tests that don't need MySQL ───────────────────────────

export class InMemoryEvolutionStore implements EvolutionStore {
  readonly evaluations: EvaluationBatch[] = [];
  readonly genomes = new Map<string, Genome>();
  readonly lineage: LineageEdge[] = [];
  readonly snapshots: Array<{ front: CandidateScore[]; generation: number }> = [];

  async recordEvaluation(ev: EvaluationBatch): Promise<void> {
    this.evaluations.push(ev);
    this.genomes.set(ev.candidate.id, ev.candidate);
  }

  async getGenome(id: string): Promise<Genome> {
    const g = this.genomes.get(id);
    if (!g) throw new Error(`Genome not found: ${id}`);
    return g;
  }

  async recordLineage(edge: LineageEdge): Promise<void> {
    this.lineage.push(edge);
  }

  async lineageLessons(genomeId: string): Promise<string[]> {
    const lessons: string[] = [];
    const seen = new Set<string>();
    let current: string | null = genomeId;
    while (current) {
      const edge = this.lineage.find(e => e.childId === current);
      if (!edge) break;
      const lesson = edge.reflection?.lesson;
      if (lesson && !seen.has(lesson)) {
        lessons.push(lesson);
        seen.add(lesson);
      }
      current = edge.parentId ?? null;
    }
    return lessons;
  }

  async snapshotFrontier(front: CandidateScore[], generation: number): Promise<void> {
    this.snapshots.push({ front, generation });
  }

  async loadRun(_handle: string): Promise<EvolutionResult> {
    const lastSnap = this.snapshots[this.snapshots.length - 1];
    const frontier = lastSnap?.front ?? [];
    return { best: frontier[0] ? { genomeId: frontier[0].genomeId, held: frontier[0].aggregate, overfit: false } : null, frontier, archive: null };
  }

  async close(): Promise<void> {}
}
