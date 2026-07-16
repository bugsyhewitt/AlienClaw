/**
 * SubagentAdapter (P14-02) — GenomeAdapter over subagent genomes.
 *
 * STUB: real evaluation instantiates the subagent on the Martian runtime and
 * runs its summon fan. Here we score from the editable fields so the engine
 * loop is exercisable with zero LLM/tool cost. No Martian runtime is touched.
 *
 * NAMING (AGENTS.md wall): "Subagent", never "Specialist".
 */
import { randomUUID, createHash } from "node:crypto";
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
import type { SubagentGenome } from "./types.js";
import {
  rawObjectiveVector,
  normalizeObjectives,
  meanObjective,
  computeLegacyScalar,
} from "../reflective/objectives.js";

export function subagentGenomeToGenome(sg: SubagentGenome): Genome {
  return {
    id: sg.id,
    raw: "A".repeat(256),  // placeholder; real runtime would encode
    toolSlots: [],
    editable: {
      role: sg.editable.role,
      decomposition: sg.editable.decomposition,
      summoning_policy: sg.editable.summoning_policy,
      operators: sg.editable.operators,
      report_shape: sg.editable.report_shape,
    },
  };
}

export function makeSubagentId(editable: SubagentGenome["editable"]): string {
  const content = JSON.stringify(editable);
  return createHash("sha256").update(content).digest("hex");
}

export class SubagentAdapter implements GenomeAdapter {
  async evaluate(
    candidate: Genome,
    batch: TaskInstance[],
    opts: { seed: number; captureTraces: true },
  ): Promise<EvaluationBatch> {
    // Stub: evaluate using editable fields as signals.
    // Real impl would instantiate the subagent on the Martian runtime.
    const traces: BaseTrace[] = [];
    const raws: ReturnType<typeof rawObjectiveVector>[] = [];

    for (const task of batch) {
      const roleLen = (candidate.editable["role"] ?? "").length;
      const decompLen = (candidate.editable["decomposition"] ?? "").length;
      const correctnessScore = Math.min(1, (roleLen + decompLen) / 500);
      const wallMs = 200 + (opts.seed % 800);
      const dollars = 0.002;
      const trace: BaseTrace = {
        runId: randomUUID(),
        genomeId: candidate.id,
        taskId: task.id,
        seed: opts.seed,
        toolCalls: [],
        finalOutput: { subagentResult: `stub_${task.id}` },
        errors: [],
        correctness: {
          score: correctnessScore,
          source: "predicate",
          evidence: `stub subagent evaluation: role_len=${roleLen} decomp_len=${decompLen}`,
          confidence: correctnessScore,
        },
        cost: { inputTokens: 200, outputTokens: 100, dollars, toolCalls: 0, wallMs },
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
