/**
 * REFLECTIVE_EVOLUTION feature flag.
 *
 * off    → current scalar loop, byte-identical behavior, nothing new written
 * shadow → both loops run; reflective loop persists and logs but does NOT promote
 * on     → reflective loop drives promotion through the gate
 *
 * Default: off (safe to apply migrations ahead of enabling)
 */

export type ReflectiveMode = "off" | "shadow" | "on";

export function getReflectiveMode(): ReflectiveMode {
  const raw = process.env["REFLECTIVE_EVOLUTION"] ?? "off";
  if (raw === "shadow" || raw === "on") return raw;
  return "off";
}

export function isReflectiveActive(): boolean {
  return getReflectiveMode() !== "off";
}
