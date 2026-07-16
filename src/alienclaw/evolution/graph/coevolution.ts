/**
 * Alternating-phase co-evolution driver (P14-02).
 *
 * Decision (§22): joint co-evolution of a two-level hierarchy is unstable.
 * Freeze-and-evolve alternation is stable, debuggable, and captures most gains:
 *   round r → evolve subagents (topology frozen) → evolve topology (subagents frozen).
 *
 * NAMING (AGENTS.md wall): "Subagent", never "Subagent".
 */
import type { Genome, TaskInstance } from "../reflective/types.js";
import type { GenomeAdapter } from "../reflective/adapter.js";
import type { Reflector } from "../reflective/reflector.js";
import type { Proposer } from "../reflective/proposer.js";
import type { EvolutionStore } from "../reflective/store.js";
import type { ReflectiveEvolutionConfig } from "../reflective/config.js";
import { runReflectiveEvolution, partitionTrainVal } from "../reflective/engine.js";
import type { ValidateHook } from "./validate-hook.js";

export interface CoevolutionConfig {
  rounds: number;
  subagentMetricCallsPerRound: number;
  topologyMetricCallsPerRound: number;
  minibatchSize: number;
  valsetFraction: number;
  rng: () => number;
}

export interface CoevolutionResult {
  rounds: number;
  completed: boolean;
  subagentEvolutionRuns: number;
  topologyEvolutionRuns: number;
}

/**
 * Alternating-phase co-evolution: evolve subagents (topology frozen), then
 * topology (subagents frozen), repeat for N rounds.
 */
export async function runAlternatingCoevolution(opts: {
  subagentAdapter: GenomeAdapter;
  topologyAdapter: GenomeAdapter;
  subagentSeeds: Genome[];
  topologySeeds: Genome[];
  trainset: TaskInstance[];
  reflector: Reflector;
  proposer: Proposer;
  store: EvolutionStore;
  baseConfig: ReflectiveEvolutionConfig;
  coevolutionConfig: CoevolutionConfig;
  subagentValidate?: ValidateHook;
  topologyValidate?: ValidateHook;
  log?: (msg: string) => void;
}): Promise<CoevolutionResult> {
  const log = opts.log ?? (() => {});
  const { train, val } = partitionTrainVal(opts.trainset, opts.coevolutionConfig.valsetFraction);
  let subagentRuns = 0;
  let topologyRuns = 0;

  for (let round = 0; round < opts.coevolutionConfig.rounds; round++) {
    log(`coevolution: round ${round + 1}/${opts.coevolutionConfig.rounds} — subagent phase`);
    // Phase A: evolve subagents (topology frozen)
    await runReflectiveEvolution({
      adapter: opts.subagentAdapter,
      reflector: opts.reflector,
      proposer: opts.proposer,
      seedCandidates: opts.subagentSeeds,
      trainset: train,
      valset: val,
      maxMetricCalls: opts.coevolutionConfig.subagentMetricCallsPerRound,
      minibatchSize: opts.coevolutionConfig.minibatchSize,
      rng: opts.coevolutionConfig.rng,
      persist: opts.store,
      config: opts.baseConfig,
      validate: opts.subagentValidate,
      log,
    });
    subagentRuns++;

    log(`coevolution: round ${round + 1}/${opts.coevolutionConfig.rounds} — topology phase`);
    // Phase B: evolve topology (subagents frozen)
    await runReflectiveEvolution({
      adapter: opts.topologyAdapter,
      reflector: opts.reflector,
      proposer: opts.proposer,
      seedCandidates: opts.topologySeeds,
      trainset: train,
      valset: val,
      maxMetricCalls: opts.coevolutionConfig.topologyMetricCallsPerRound,
      minibatchSize: opts.coevolutionConfig.minibatchSize,
      rng: opts.coevolutionConfig.rng,
      persist: opts.store,
      config: opts.baseConfig,
      validate: opts.topologyValidate,
      log,
    });
    topologyRuns++;
  }

  return {
    rounds: opts.coevolutionConfig.rounds,
    completed: true,
    subagentEvolutionRuns: subagentRuns,
    topologyEvolutionRuns: topologyRuns,
  };
}
