/**
 * TopologyAdapter (P14-02) — GenomeAdapter over topology genomes.
 *
 * STUB: real evaluation assembles the campaign graph, runs each frozen
 * subagent over its scope partition, and composes results. Here we score from
 * the editable subagent count and partition size so the loop is exercisable
 * with zero LLM/tool cost. No Martian runtime is touched.
 *
 * NAMING (AGENTS.md wall): "Subagent", never "Specialist".
 */
import { randomUUID } from "node:crypto";
import type { GenomeAdapter } from "../reflective/adapter.js";
import type {
  Genome,
  TaskInstance,
  EvaluationBatch,
  ReflectiveDataset,
  ExecutionTrace as BaseTrace,
  ObjectiveVector,
  CandidateScore,
} from "../reflective/types.js";
import {
  rawObjectiveVector,
  normalizeObjectives,
  meanObjective,
  computeLegacyScalar,
} from "../reflective/objectives.js";

export class TopologyAdapter implements GenomeAdapter {
  async evaluate(
    candidate: Genome,
    batch: TaskInstance[],
    opts: { seed: number; captureTraces: true },
  ): Promise<EvaluationBatch> {
    const traces: BaseTrace[] = [];
    const raws: ReturnType<typeof rawObjectiveVector>[] = [];

    let subagentIds: string[] = [];
    try { subagentIds = JSON.parse(candidate.editable["subagents"] ?? "[]"); } catch { /* skip */ }
    const subagentCount = subagentIds.length;

    for (const task of batch) {
      // Correctness is a function of subagent count and partition quality
      const partitionLen = (candidate.editable["partition"] ?? "").length;
      const correctnessScore = Math.min(1, (partitionLen / 300) * (subagentCount / 2));
      const wallMs = 300 + (opts.seed % 600);
      const dollars = subagentCount * 0.003;
      const trace: BaseTrace = {
        runId: randomUUID(),
        genomeId: candidate.id,
        taskId: task.id,
        seed: opts.seed,
        toolCalls: [],
        finalOutput: { topologyResult: `stub_${task.id}` },
        errors: [],
        correctness: {
          score: correctnessScore,
          source: "predicate",
          evidence: `stub topology evaluation: subagent_count=${subagentCount} partition_len=${partitionLen}`,
          confidence: correctnessScore,
        },
        cost: { inputTokens: 400, outputTokens: 200, dollars, toolCalls: 0, wallMs },
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      };
      traces.push(trace);
      raws.push(rawObjectiveVector(trace));
    }

    const normalized = normalizeObjectives(raws, 1e-6);
    const perInstance = new Map<string, ObjectiveVector>();
    for (let i = 0; i < batch.length; i++) {
      perInstance.set(batch[i]!.id, normalized[i] ?? { correctness: 0, efficiency: 0, costInv: 0, latencyInv: 0, confidence: 0 });
    }
    const scores: CandidateScore = {
      genomeId: candidate.id,
      perInstance,
      aggregate: meanObjective(normalized),
      legacyScalar: computeLegacyScalar(traces),
    };
    return { candidate, scores, traces };
  }

  makeReflectiveDataset(
    _candidate: Genome,
    batch: EvaluationBatch,
    components: string[],
  ): ReflectiveDataset {
    const dataset: ReflectiveDataset = {};
    for (const comp of components) {
      dataset[comp] = batch.traces.map(t => ({
        taskId: t.taskId,
        input: t.toolCalls[0]?.args ?? {},
        feedback: t.correctness.evidence,
        score: t.correctness.score,
      }));
    }
    return dataset;
  }
}
