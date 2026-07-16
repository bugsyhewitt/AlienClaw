/**
 * EVOLVE_TOPOLOGY feature flag (P14-02).
 *
 * Default OFF. Graph evolution is dark by default; flipping to "shadow" runs
 * the evolved graph alongside the static team for comparison; "on" lets it
 * drive real campaigns. Rollback is a single env var.
 */
export type EvolveTopologyMode = "off" | "shadow" | "on";

export function getEvolveTopologyMode(): EvolveTopologyMode {
  const raw = process.env["EVOLVE_TOPOLOGY"] ?? "off";
  if (raw === "shadow" || raw === "on") return raw;
  return "off";
}

export function isEvolveTopologyActive(): boolean {
  return getEvolveTopologyMode() !== "off";
}
