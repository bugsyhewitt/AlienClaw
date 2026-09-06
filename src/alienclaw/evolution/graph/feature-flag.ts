/**
 * EVOLVE_TOPOLOGY feature flag (P14-02).
 *
 * Default OFF. Graph evolution is dark by default; flipping to "shadow" runs
 * the evolved graph alongside the static team for comparison; "on" lets it
 * drive real campaigns. Rollback is a single env var.
 */
import { readEvolutionFlag } from "../make-evolution-flag.js";
import type { EvolutionFlagMode } from "../make-evolution-flag.js";

export type EvolveTopologyMode = EvolutionFlagMode;

export function getEvolveTopologyMode(): EvolveTopologyMode {
  return readEvolutionFlag("EVOLVE_TOPOLOGY");
}

export function isEvolveTopologyActive(): boolean {
  return getEvolveTopologyMode() !== "off";
}
