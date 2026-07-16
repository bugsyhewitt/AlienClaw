/**
 * Reflective Evolution Engine — Select→Execute→Reflect→Mutate→Accept loop.
 *
 * GEPA (Agrawal et al., 2025, arXiv:2507.19457) port in TypeScript.
 * Anti-Goodhart structural choices:
 *   1. Child is scored on the SAME minibatch as its parent.
 *   2. Final selection uses a held-out valset never seen during the loop.
 */
import { randomUUID } from "node:crypto";
import type { Genome, TaskInstance, CandidateScore, ObjectiveVector, EvolutionResult } from "./types.js";
import { OBJECTIVE_KEYS } from "./types.js";
import type { GenomeAdapter } from "./adapter.js";
import type { Reflector } from "./reflector.js";
import type { Proposer } from "./proposer.js";
import type { EvolutionStore } from "./store.js";
import type { ReflectiveEvolutionConfig } from "./config.js";
import { ParetoArchive } from "./archive.js";
import {
  sampleMinibatch,
  improvedOnMinibatch,
  chooseComponentToRevise,
  rawObjectiveVector,
  normalizeObjectives,
  meanObjective,
  dominates,
} from "./objectives.js";
import { computeLegacyScalar } from "./objectives.js";

export interface EngineConfig {
  adapter: GenomeAdapter;
  reflector: Reflector;
  proposer: Proposer;
  seedCandidates: Genome[];
  trainset: TaskInstance[];
  valset: TaskInstance[];
  maxMetricCalls: number;
  minibatchSize: number;
  rng: () => number;
  persist: EvolutionStore;
  config: ReflectiveEvolutionConfig;
  /**
   * Optional generic validation gate (P14-02). Runs on each proposed child
   * (and merged candidate) BEFORE evaluation. A rejection costs zero
   * metric-calls and records an INVALID lineage edge — invalid topologies
   * and subagents never enter the population.
   */
  validate?: (candidate: Genome) => { ok: true } | { ok: false; violation: string };
  log?: (msg: string) => void;
}

interface GenerationState {
  metricCallsUsed: number;
  generation: number;
  reflectParseFailures: number;
  reflectTotal: number;
}

export async function runReflectiveEvolution(cfg: EngineConfig): Promise<EvolutionResult> {
  const log = cfg.log ?? (() => {});
  const archive = new ParetoArchive();
  const state: GenerationState = {
    metricCallsUsed: 0,
    generation: 0,
    reflectParseFailures: 0,
    reflectTotal: 0,
  };
  const runHandle = randomUUID();

  // ── Phase 1: Seed ─────────────────────────────────────────────────────────
  for (const g of cfg.seedCandidates) {
    if (state.metricCallsUsed + cfg.minibatchSize > cfg.maxMetricCalls) break;
    const batch = sampleMinibatch(cfg.trainset, cfg.minibatchSize, cfg.rng);
    const ev = await cfg.adapter.evaluate(g, batch, {
      seed: nextSeed(cfg.rng),
      captureTraces: true,
    });
    await cfg.persist.recordEvaluation(ev);
    await cfg.persist.recordLineage({ parentId: null, childId: g.id, op: "seed" });
    archive.add(ev.scores);
    state.metricCallsUsed += batch.length;
    log(`re.seed genome=${g.id.slice(0, 8)} scalar=${ev.scores.legacyScalar.toFixed(4)}`);
  }

  await cfg.persist.snapshotFrontier(archive.frontier(), state.generation++);

  // ── Main loop ─────────────────────────────────────────────────────────────
  while (state.metricCallsUsed + cfg.minibatchSize <= cfg.maxMetricCalls) {
    const parentScore = archive.sampleForMutation(cfg.rng, cfg.config.winCountWeights);
    if (!parentScore) break;

    const parent = await cfg.persist.getGenome(parentScore.genomeId);

    // Execute parent on a fresh minibatch to gather ASI
    const batch = sampleMinibatch(cfg.trainset, cfg.minibatchSize, cfg.rng);
    if (state.metricCallsUsed + batch.length > cfg.maxMetricCalls) break;

    const parentEval = await cfg.adapter.evaluate(parent, batch, {
      seed: nextSeed(cfg.rng),
      captureTraces: true,
    });
    await cfg.persist.recordEvaluation(parentEval);
    state.metricCallsUsed += batch.length;

    // Choose weakest component to target
    const component = chooseComponentToRevise(parent, parentScore);
    const reflective = cfg.adapter.makeReflectiveDataset(parent, parentEval, [component]);

    // Reflect (Opus) → diagnose
    const lessons = await cfg.persist.lineageLessons(parent.id);
    state.reflectTotal++;
    const reflection = await cfg.reflector.reflect({
      candidate: parent,
      component,
      records: reflective[component] ?? [],
      ancestorLessons: lessons,
    });

    if (reflection.diagnosis === "parse_failure") {
      state.reflectParseFailures++;
      const failRate = state.reflectParseFailures / state.reflectTotal;
      if (failRate > cfg.config.reflectParseFailureYellow) {
        log(
          `YELLOW: reflect.parse_failure_rate=${(failRate * 100).toFixed(1)}% exceeds ${(cfg.config.reflectParseFailureYellow * 100).toFixed(0)}% threshold.`,
        );
      }
      log(`re.reflect.parse_failure component=${component}`);
      continue; // skip this mutation, loop continues
    }

    // Mutate (Sonnet renders proposedValue → valid Genome)
    let child: Genome;
    try {
      child = await cfg.proposer.applyMutation(parent, reflection);
    } catch (e) {
      log(`re.proposer.invalid_genome: ${String(e)} — skipping`);
      continue;
    }

    // P14-02 generic validation gate: reject graph-illegal children before
    // they cost a metric-call. Records an INVALID lineage edge for audit.
    if (cfg.validate) {
      const vr = cfg.validate(child);
      if (!vr.ok) {
        log(`re.validate.rejected child=${child.id.slice(0, 8)} violation="${vr.violation}"`);
        await cfg.persist.recordLineage({
          parentId: parent.id,
          childId: child.id,
          op: "mutate",
          reflection: { ...reflection, lesson: `INVALID: ${vr.violation}` },
        });
        continue; // no metric-call charged
      }
    }

    await cfg.persist.recordLineage({
      parentId: parent.id,
      childId: child.id,
      op: "mutate",
      reflection,
    });

    // Evaluate child on the SAME minibatch (anti-Goodhart)
    if (state.metricCallsUsed + batch.length > cfg.maxMetricCalls) break;

    const childEval = await cfg.adapter.evaluate(child, batch, {
      seed: nextSeed(cfg.rng),
      captureTraces: true,
    });
    await cfg.persist.recordEvaluation(childEval);
    state.metricCallsUsed += batch.length;

    if (improvedOnMinibatch(childEval.scores, parentEval.scores)) {
      archive.add(childEval.scores);
      await cfg.persist.snapshotFrontier(archive.frontier(), state.generation++);
      log(
        `re.child.accepted child=${child.id.slice(0, 8)} scalar=${childEval.scores.legacyScalar.toFixed(4)}`,
      );
    } else {
      log(`re.child.rejected child=${child.id.slice(0, 8)}`);
    }

    // Occasionally merge two frontier candidates winning on disjoint tasks
    if (cfg.rng() < cfg.config.mergeProbability) {
      const pair = archive.pickDisjointFrontierPair(cfg.rng, cfg.config.winCountWeights);
      if (pair) {
        let merged: Genome;
        try {
          merged = await cfg.proposer.merge(pair[0], pair[1]);
        } catch {
          log("re.merge.failed");
          continue;
        }
        // P14-02 generic validation gate on merged candidates too.
        if (cfg.validate) {
          const vr = cfg.validate(merged);
          if (!vr.ok) {
            log(`re.validate.rejected merged=${merged.id.slice(0, 8)} violation="${vr.violation}"`);
            await cfg.persist.recordLineage({
              parentId: pair[0].genomeId,
              childId: merged.id,
              op: "merge",
            });
            continue; // no metric-call charged
          }
        }
        if (state.metricCallsUsed + batch.length <= cfg.maxMetricCalls) {
          const mEval = await cfg.adapter.evaluate(merged, batch, {
            seed: nextSeed(cfg.rng),
            captureTraces: true,
          });
          await cfg.persist.recordEvaluation(mEval);
          state.metricCallsUsed += batch.length;
          if (improvedOnMinibatch(mEval.scores, childEval.scores)) {
            archive.add(mEval.scores);
            await cfg.persist.snapshotFrontier(archive.frontier(), state.generation++);
            log(`re.merge.accepted merged=${merged.id.slice(0, 8)}`);
          }
          await cfg.persist.recordLineage({
            parentId: pair[0].genomeId,
            childId: merged.id,
            op: "merge",
          });
        }
      }
    }

    log(
      `re.generation metric_calls=${state.metricCallsUsed}/${cfg.maxMetricCalls} frontier_size=${archive.frontier().length}`,
    );
  }

  // ── Final validation on held-out valset (Goodhart guard) ─────────────────
  const finalists = archive.frontier();
  const validated = await validateOnHeldOut(finalists, cfg.valset, cfg.adapter, cfg.persist, cfg.config.overfitThreshold);
  const best = pickBestValidated(validated);

  log(`re.done metric_calls=${state.metricCallsUsed} frontier_size=${finalists.length} handle=${runHandle}`);

  return { best, frontier: finalists, archive };
}

function nextSeed(rng: () => number): number {
  return Math.floor(rng() * 0xffffffff);
}

export async function validateOnHeldOut(
  finalists: CandidateScore[],
  valset: TaskInstance[],
  adapter: GenomeAdapter,
  store: EvolutionStore,
  overfitThreshold: number,
): Promise<Array<{ genomeId: string; held: ObjectiveVector; overfit: boolean }>> {
  const out: Array<{ genomeId: string; held: ObjectiveVector; overfit: boolean }> = [];
  for (const f of finalists) {
    const g = await store.getGenome(f.genomeId);
    const ev = await adapter.evaluate(g, valset, {
      seed: 0x5641_4c00, // "VAL" seed — fixed for reproducibility
      captureTraces: true,
    });
    await store.recordEvaluation(ev);
    const overfit =
      f.aggregate.correctness - ev.scores.aggregate.correctness > overfitThreshold;
    out.push({ genomeId: f.genomeId, held: ev.scores.aggregate, overfit });
  }
  return out;
}

function pickBestValidated(
  validated: Array<{ genomeId: string; held: ObjectiveVector; overfit: boolean }>,
): EvolutionResult["best"] {
  const nonOverfit = validated.filter(v => !v.overfit);
  const pool = nonOverfit.length > 0 ? nonOverfit : validated;
  if (pool.length === 0) return null;

  // Find the Pareto-dominant among held-out vectors
  const best = pool.reduce((acc, cur) => {
    return dominates(cur.held, acc.held) ? cur : acc;
  });
  return best;
}

/** Partition a task set into train/val. Deterministic given the set order. */
export function partitionTrainVal(
  tasks: TaskInstance[],
  valFraction: number,
): { train: TaskInstance[]; val: TaskInstance[] } {
  const n = tasks.length;
  const valCount = Math.max(1, Math.round(n * valFraction));
  const val = tasks.slice(0, valCount);
  const train = tasks.slice(valCount);
  return { train, val };
}
