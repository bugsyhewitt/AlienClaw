/**
 * fitness_aggregator.ts — Campaign-level fitness computation.
 *
 * Formula: final_summon.fitness + 0.2 if state_machine_finalized, clamped [0, 1]
 */
import type { TerminationReason } from './budget.js';

export interface SummonRecord {
  state: string;
  martian_type: string;
  fitness: number;
  tool_calls: number;
  ok: boolean;
}

export interface CampaignFitness {
  fitness: number;
  formula_version: 'v1.0';
  components: {
    final_summon_fitness: number;
    completion_bonus: number;
    completion_bonus_applied: boolean;
  };
}

export function aggregate(
  summons: ReadonlyArray<SummonRecord>,
  termination_reason: TerminationReason,
): CampaignFitness {
  const completed = termination_reason === 'state_machine_finalized';
  const final = summons.length > 0 ? summons[summons.length - 1]! : null;
  const final_summon_fitness = final?.fitness ?? 0.0;
  const completion_bonus = completed ? 0.2 : 0.0;
  const fitness = Math.max(0.0, Math.min(1.0, final_summon_fitness + completion_bonus));

  return {
    fitness,
    formula_version: 'v1.0',
    components: { final_summon_fitness, completion_bonus, completion_bonus_applied: completed },
  };
}
