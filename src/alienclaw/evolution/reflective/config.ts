/**
 * Configuration for the reflective evolution engine.
 *
 * All values overridable at runtime. Defaults are locked starting points
 * per P14-01 §18 — changing a default requires documentation.
 */
export interface ReflectiveEvolutionConfig {
  mode: "off" | "shadow" | "on";
  maxMetricCalls: number;
  minibatchSize: number;
  mergeProbability: number;
  valsetFraction: number;
  overfitThreshold: number;
  llmJudgeFractionYellow: number;
  reflectParseFailureYellow: number;
  normalizationEpsilon: number;
  winCountWeights: {
    correctness: number;
    confidence: number;
    costInv: number;
    efficiency: number;
  };
  reflector: { model: "opus-4.8"; temperature: number };
  proposer: { model: "sonnet"; maxInvalidRetries: number };
  budgetCeilingUsd?: number;
}

export const DEFAULT_CONFIG: ReflectiveEvolutionConfig = {
  mode: "off",
  maxMetricCalls: 300,
  minibatchSize: 4,
  mergeProbability: 0.15,
  valsetFraction: 0.25,
  overfitThreshold: 0.15,
  llmJudgeFractionYellow: 0.40,
  reflectParseFailureYellow: 0.10,
  normalizationEpsilon: 1e-6,
  winCountWeights: { correctness: 0.6, confidence: 0.2, costInv: 0.1, efficiency: 0.1 },
  reflector: { model: "opus-4.8", temperature: 0.2 },
  proposer: { model: "sonnet", maxInvalidRetries: 3 },
};
