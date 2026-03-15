import type {
  AnyAgentTool,
  AlienClawPluginApi,
  AlienClawPluginToolFactory,
} from "alienclaw/plugin-sdk/lobster";
import { createLobsterTool } from "./src/lobster-tool.js";

export default function register(api: AlienClawPluginApi) {
  api.registerTool(
    ((ctx) => {
      if (ctx.sandboxed) {
        return null;
      }
      return createLobsterTool(api) as AnyAgentTool;
    }) as AlienClawPluginToolFactory,
    { optional: true },
  );
}
