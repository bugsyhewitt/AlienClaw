import type { PluginRuntime } from "alienclaw/plugin-sdk/mattermost";

let runtime: PluginRuntime | null = null;

export function setMattermostRuntime(next: PluginRuntime) {
  runtime = next;
}

export function getMattermostRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("Mattermost runtime not initialized");
  }
  return runtime;
}
