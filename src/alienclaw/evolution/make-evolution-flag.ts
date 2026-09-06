/**
 * Shared factory for the "off | shadow | on" feature-flag pattern used by
 * both the graph-topology and reflective evolution subsystems.
 */

export type EvolutionFlagMode = "off" | "shadow" | "on";

export function readEvolutionFlag(envVar: string): EvolutionFlagMode {
  const raw = process.env[envVar] ?? "off";
  if (raw === "shadow" || raw === "on") return raw;
  return "off";
}
