// Narrow plugin-sdk surface for the bundled diffs plugin.
// Keep this list additive and scoped to symbols used under extensions/diffs.

export type { AlienClawConfig } from "../config/config.js";
export { resolvePreferredAlienClawTmpDir } from "../infra/tmp-alienclaw-dir.js";
export type {
  AnyAgentTool,
  AlienClawPluginApi,
  AlienClawPluginConfigSchema,
  PluginLogger,
} from "../plugins/types.js";
