import type { AlienClawPluginApi } from "alienclaw/plugin-sdk/synology-chat";
import { emptyPluginConfigSchema } from "alienclaw/plugin-sdk/synology-chat";
import { createSynologyChatPlugin } from "./src/channel.js";
import { setSynologyRuntime } from "./src/runtime.js";

const plugin = {
  id: "synology-chat",
  name: "Synology Chat",
  description: "Native Synology Chat channel plugin for AlienClaw",
  configSchema: emptyPluginConfigSchema(),
  register(api: AlienClawPluginApi) {
    setSynologyRuntime(api.runtime);
    api.registerChannel({ plugin: createSynologyChatPlugin() });
  },
};

export default plugin;
