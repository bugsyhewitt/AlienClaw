import type { AlienClawPluginApi } from "alienclaw/plugin-sdk/diagnostics-otel";
import { emptyPluginConfigSchema } from "alienclaw/plugin-sdk/diagnostics-otel";
import { createDiagnosticsOtelService } from "./src/service.js";

const plugin = {
  id: "diagnostics-otel",
  name: "Diagnostics OpenTelemetry",
  description: "Export diagnostics events to OpenTelemetry",
  configSchema: emptyPluginConfigSchema(),
  register(api: AlienClawPluginApi) {
    api.registerService(createDiagnosticsOtelService());
  },
};

export default plugin;
