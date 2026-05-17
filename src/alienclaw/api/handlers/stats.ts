import type { GlobalStats } from '../storage.js';
import type { StatsResponse } from '../types.js';

export function handleStats(store: GlobalStats): [number, StatsResponse] {
  const raw = store.get();
  return [200, {
    total_genomes:             raw.total_genomes,
    total_installs:            raw.total_installs,
    total_fitness_evaluations: raw.total_fitness_evaluations,
    top_fitness_by_type:       raw.top_fitness_by_type,
  }];
}
