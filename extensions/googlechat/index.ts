import type { AlienClawPluginApi } from "alienclaw/plugin-sdk/googlechat";
import { emptyPluginConfigSchema } from "alienclaw/plugin-sdk/googlechat";
import { googlechatDock, googlechatPlugin } from "./src/channel.js";
import { setGoogleChatRuntime } from "./src/runtime.js";

const plugin = {
  id: "googlechat",
  name: "Google Chat",
  description: "AlienClaw Google Chat channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: AlienClawPluginApi) {
    setGoogleChatRuntime(api.runtime);
    api.registerChannel({ plugin: googlechatPlugin, dock: googlechatDock });
  },
};

export default plugin;
