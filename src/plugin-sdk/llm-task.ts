// Narrow plugin-sdk surface for the bundled llm-task plugin.
// Keep this list additive and scoped to symbols used under extensions/llm-task.

export { resolvePreferredAlienClawTmpDir } from "../infra/tmp-alienclaw-dir.js";
export type { AnyAgentTool, AlienClawPluginApi } from "../plugins/types.js";
