// AlienClaw palette — alien green theme.
// Drop-in replacement: same export name (LOBSTER_PALETTE) so all theme consumers
// pick up alien green without any other code changes.
export const LOBSTER_PALETTE = {
  accent:       "#00FF5A", // alien green — primary
  accentBright: "#33FF77", // bright alien green
  accentDim:    "#00CC47", // dim alien green
  info:         "#78F5FF", // alien cyan
  success:      "#00FF5A", // same as accent
  warn:         "#FFB020", // amber — keep
  error:        "#FF4444", // red — keep
  muted:        "#5A6B5A", // muted green-gray
} as const;
