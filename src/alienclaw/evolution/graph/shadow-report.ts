/**
 * Shadow-mode comparison report (P14-02).
 *
 * In shadow mode the evolved graph runs alongside the static team and the two
 * are compared per campaign. This module produces the report shape; the mock
 * generator lets us validate the schema and docs without burning LLM budget.
 *
 * NAMING (AGENTS.md wall): "Subagent", never "Specialist".
 */
export interface ShadowComparison {
  campaignId: string;
  staticCorrectness: number;
  evolvedCorrectness: number;
  staticCostUsd: number;
  evolvedCostUsd: number;
  staticSubagentCount: number;
  evolvedSubagentCount: number;
  operatorMix: Record<string, number>;
  winner: "static" | "evolved" | "tie";
}

export interface ShadowReport {
  generatedAt: string;
  mode: "mock" | "real";
  comparisons: ShadowComparison[];
  summary: {
    correctnessDelta: number;
    costDelta: number;
    subagentCountDelta: number;
  };
}

export function generateMockShadowReport(): ShadowReport {
  const now = new Date().toISOString();
  const comparisons: ShadowComparison[] = [
    {
      campaignId: "mock-campaign-001",
      staticCorrectness: 0.72,
      evolvedCorrectness: 0.76,
      staticCostUsd: 2.40,
      evolvedCostUsd: 1.86,
      staticSubagentCount: 1,
      evolvedSubagentCount: 2,
      operatorMix: { none: 1, best_of_n: 1 },
      winner: "evolved",
    },
    {
      campaignId: "mock-campaign-002",
      staticCorrectness: 0.65,
      evolvedCorrectness: 0.65,
      staticCostUsd: 3.10,
      evolvedCostUsd: 2.20,
      staticSubagentCount: 1,
      evolvedSubagentCount: 2,
      operatorMix: { none: 2 },
      winner: "evolved",
    },
  ];
  const correctnessDelta = comparisons.reduce((s, c) => s + (c.evolvedCorrectness - c.staticCorrectness), 0) / comparisons.length;
  const costDelta = comparisons.reduce((s, c) => s + (c.evolvedCostUsd - c.staticCostUsd), 0) / comparisons.length;
  const subagentCountDelta = comparisons.reduce((s, c) => s + (c.evolvedSubagentCount - c.staticSubagentCount), 0) / comparisons.length;
  return {
    generatedAt: now,
    mode: "mock",
    comparisons,
    summary: { correctnessDelta, costDelta, subagentCountDelta },
  };
}
