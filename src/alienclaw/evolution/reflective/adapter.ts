/**
 * GenomeAdapter — the ONLY seam between the reflective engine and AlienClaw runtime.
 *
 * The engine calls these; AlienClaw implements them against the Martian runtime.
 * The engine NEVER imports Martian code — this interface is the wall.
 *
 * Mirrors GEPA's GEPAAdapter contract (evaluate + makeReflectiveDataset).
 */
import type {
  Genome,
  TaskInstance,
  EvaluationBatch,
  ReflectiveDataset,
} from "./types.js";

export interface GenomeAdapter {
  /**
   * Run candidate against each task in batch, capturing full traces.
   * MUST be deterministic given (candidate, task, seed) up to LLM nondeterminism.
   */
  evaluate(
    candidate: Genome,
    batch: TaskInstance[],
    opts: { seed: number; captureTraces: true },
  ): Promise<EvaluationBatch>;

  /**
   * Shape an EvaluationBatch into the reflective dataset the LLM reads.
   * For each named editable component: list of {input, feedback, score} records.
   */
  makeReflectiveDataset(
    candidate: Genome,
    batch: EvaluationBatch,
    components: string[],
  ): ReflectiveDataset;
}
