/**
 * Graph-evolution configuration (P14-02).
 *
 * Caps are deliberately small for the first pass (§7 simplicity gate): a
 * 4-subagent / 4-summon ceiling and a 3x-static-baseline cost cap. Defaults
 * are locked starting points — changing one requires documentation.
 */
export interface EvolveTopologyConfig {
  mode: "off" | "shadow" | "on";
  maxSubagentsPerTopology: number;
  maxSummonsPerSubagent: number;
  maxStructureCostUsd: number;
  coevolutionRounds: number;
  subagentMetricCallsPerRound: number;
  topologyMetricCallsPerRound: number;
  ensembleMaxK: number;
  reviewMaxRounds: number;
  bestOfNMax: number;
  smokeTaskRef: string;
}

export const DEFAULT_EVOLVE_TOPOLOGY_CONFIG: EvolveTopologyConfig = {
  mode: "off",
  maxSubagentsPerTopology: 4,
  maxSummonsPerSubagent: 4,
  maxStructureCostUsd: 9.0,    // 3x a ~$3 static team baseline
  coevolutionRounds: 3,
  subagentMetricCallsPerRound: 120,
  topologyMetricCallsPerRound: 80,
  ensembleMaxK: 3,
  reviewMaxRounds: 2,
  bestOfNMax: 3,
  smokeTaskRef: "smoke:trivial",
};
