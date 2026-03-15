import type { PluginRuntime } from "alienclaw/plugin-sdk/zalo";

let runtime: PluginRuntime | null = null;

export function setZaloRuntime(next: PluginRuntime): void {
  runtime = next;
}

export function getZaloRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("Zalo runtime not initialized");
  }
  return runtime;
}
