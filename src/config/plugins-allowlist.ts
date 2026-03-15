import type { AlienClawConfig } from "./config.js";

export function ensurePluginAllowlisted(cfg: AlienClawConfig, pluginId: string): AlienClawConfig {
  const allow = cfg.plugins?.allow;
  if (!Array.isArray(allow) || allow.includes(pluginId)) {
    return cfg;
  }
  return {
    ...cfg,
    plugins: {
      ...cfg.plugins,
      allow: [...allow, pluginId],
    },
  };
}
