/**
 * MockGenomeAdapter — deterministic adapter for engine tests.
 *
 * Implements §21 from the packet: closed-form scoring so the loop's
 * behavior is fully determined with no real LLMs or tools.
 */
import { randomUUID, createHash } from "node:crypto";
import type {
  Genome,
  TaskInstance,
  EvaluationBatch,
  ExecutionTrace,
  ReflectiveDataset,
  ObjectiveVector,
  CandidateScore,
} from "../../../src/alienclaw/evolution/reflective/types.js";
import type { GenomeAdapter } from "../../../src/alienclaw/evolution/reflective/adapter.js";
import {
  rawObjectiveVector,
  normalizeObjectives,
  meanObjective,
  computeLegacyScalar,
} from "../../../src/alienclaw/evolution/reflective/objectives.js";

const SIGMA = 2.0;

export interface SyntheticTask extends TaskInstance {
  target: number[];
}

function decodeTheta(genome: Genome): number[] {
  const raw = genome.editable["tool_slots"] ?? "";
  const parts = raw.split(",").map(Number).filter(isFinite);
  return [parts[0] ?? 0.5, parts[1] ?? 0.5];
}

function syntheticCorrectness(genome: Genome, target: number[]): number {
  const theta = decodeTheta(genome);
  let sqDist = 0;
  for (let i = 0; i < target.length; i++) {
    const diff = (theta[i] ?? 0) - (target[i] ?? 0);
    sqDist += diff * diff;
  }
  return Math.exp(-sqDist / SIGMA);
}

export function makeSyntheticTasks(n = 20): SyntheticTask[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `t-${String(i).padStart(3, "0")}`,
    input: { taskIndex: i },
    target: [(i % 5) / 4, Math.floor(i / 5) / 4],
  }));
}

export class MockGenomeAdapter implements GenomeAdapter {
  async evaluate(
    candidate: Genome,
    batch: TaskInstance[],
    opts: { seed: number; captureTraces: true },
  ): Promise<EvaluationBatch> {
    const traces: ExecutionTrace[] = [];
    const raws: ReturnType<typeof rawObjectiveVector>[] = [];

    for (const task of batch) {
      const synTask = task as SyntheticTask;
      const target = synTask.target ?? [0.5, 0.5];
      const correctnessScore = syntheticCorrectness(candidate, target);
      const toolCount = candidate.toolSlots.length || 1;
      const wallMs = 100 + (opts.seed % 900);
      const dollars = toolCount * 0.001;

      const trace: ExecutionTrace = {
        runId: randomUUID(),
        genomeId: candidate.id,
        taskId: task.id,
        seed: opts.seed,
        toolCalls: [
          {
            index: 0,
            tool: candidate.toolSlots[0] ?? "mock_tool",
            args: { plan: task.input },
            result: { output: `result_for_${task.id}` },
            ok: true,
            ms: wallMs,
          },
        ],
        finalOutput: { result: `mock_output_${task.id}` },
        errors: [],
        correctness: {
          score: correctnessScore,
          source: "predicate",
          evidence: `synthetic: θ=[${decodeTheta(candidate).join(",")}] score=${correctnessScore.toFixed(4)}`,
          confidence: correctnessScore,
        },
        cost: {
          inputTokens: 100,
          outputTokens: 50,
          dollars,
          toolCalls: toolCount,
          wallMs,
        },
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

/** Build a test genome with a specific θ encoded in tool_slots editable. */
export function makeTestGenome(theta: number[], rawSuffix = ""): Genome {
  // Derive raw from theta (Base62-safe digits) so distinct thetas yield
  // distinct genome ids; previously every default call hashed to one id,
  // which let cross-test rows collide (including a child==parent lineage
  // self-cycle). Same args still produce the same genome, deterministically.
  const thetaTag = theta.map(v => String(Math.round(v * 1000)).padStart(4, "0")).join("");
  const payload = thetaTag + rawSuffix;
  const raw = ("A".repeat(Math.max(0, 256 - payload.length)) + payload).slice(0, 256);
  const id = createHash("sha256").update(raw, "utf8").digest("hex");
  return {
    id,
    raw,
    toolSlots: ["mock_tool"],
    editable: { tool_slots: theta.map(v => v.toFixed(3)).join(",") },
  };
}

/** Proposer that nudges θ toward the mean target of the worst instances. */
export class MockNudgeProposer {
  private readonly genomeStore: Map<string, Genome>;

  constructor(store: Map<string, Genome>) {
    this.genomeStore = store;
  }

  async applyMutation(parent: Genome, reflection: { component: string; proposedValue: string }): Promise<Genome> {
    const newEditable = { ...parent.editable, [reflection.component]: reflection.proposedValue };
    const child: Genome = { ...parent, editable: newEditable };
    this.genomeStore.set(child.id, child);
    return child;
  }

  async merge(a: { genomeId: string }, b: { genomeId: string }): Promise<Genome> {
    const ga = this.genomeStore.get(a.genomeId) ?? makeTestGenome([0.5, 0.5]);
    return ga;
  }
}
