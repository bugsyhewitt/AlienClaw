/**
 * REFLECTIVE_EVOLUTION feature flag.
 *
 * off    → current scalar loop, byte-identical behavior, nothing new written
 * shadow → both loops run; reflective loop persists and logs but does NOT promote
 * on     → reflective loop drives promotion through the gate
 *
 * Default: off (safe to apply migrations ahead of enabling)
 */
import { readEvolutionFlag } from "../make-evolution-flag.js";
import type { EvolutionFlagMode } from "../make-evolution-flag.js";

export type ReflectiveMode = EvolutionFlagMode;

export function getReflectiveMode(): ReflectiveMode {
  return readEvolutionFlag("REFLECTIVE_EVOLUTION");
}

export function isReflectiveActive(): boolean {
  return getReflectiveMode() !== "off";
}
