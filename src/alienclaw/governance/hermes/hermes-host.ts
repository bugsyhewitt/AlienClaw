/**
 * HermesHostAdapter — HostAdapter for the Hermes host framework.
 *
 * Functional today under ALIENCLAW_HOST=hermes: wireToolAdapters() registers the
 * shared host-agnostic tools, llm() resolves a pi-ai provider (env-overridable),
 * registerCli() mounts AlienClaw's own `run` verb, and installProfile() returns
 * the real ~/.hermes/profiles paths.
 *
 * llm() resolves the provider/model from the agent's Hermes profile config.yaml
 * (top-level `model:` scalar), env-overridable, else shared defaults.
 *
 * web_search dispatches to Hermes via the venv python (HermesToolResolver); a
 * successful search needs an operator-configured Hermes web backend.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Command } from 'commander';
import type { ToolResolver } from '../../msb/martian-executor.js';
import { wireToolAdapters } from '../../msb/tool-adapters.js';
import { registerRunCommand } from '../../cli/register.run.js';
import type { HostAdapter, HostInstallProfile, LlmGateway } from '../common/host-adapter.js';
import { HermesToolResolver } from './hermes-tool-resolver.js';
import { HermesLlmGateway } from './hermes-llm-gateway.js';

export class HermesHostAdapter implements HostAdapter {
  readonly hostId = 'hermes' as const;

  private readonly resolver = new HermesToolResolver();
  private readonly gateway  = new HermesLlmGateway();

  toolResolver(): ToolResolver {
    return this.resolver;
  }

  wireToolAdapters(): void {
    // Register the shared host-agnostic tool adapters (url_fetch/file_read/
    // file_write + the web_search stub). web_search is the only host-bound tool;
    // its Hermes-native dispatch (tools/registry.py) is deferred — HermesToolResolver
    // returns a "pending Hermes tool-layer wiring" stub for it. See phase-2 spec.
    wireToolAdapters();
  }

  llm(): LlmGateway {
    return this.gateway;
  }

  registerCli(program: Command): void {
    // `program` is AlienClaw's OWN commander instance (register.run.ts mounts the
    // `run <goal>` verb); it is host-independent, so mount it exactly as OpenClaw
    // does. Whether AlienClaw verbs can also be added to the `hermes` binary is a
    // separate, deferred question (see docs/hermes-phase2-spec.md).
    registerRunCommand(program);
  }

  installProfile(): HostInstallProfile {
    // Honor HERMES_HOME (as install-hermes.sh does) so runtime paths and the
    // installer share one source of truth. Hermes' multi-agent unit is the
    // PROFILE: named profiles live under ~/.hermes/profiles/<name>/ (confirmed
    // via `hermes profile show`), NOT an agents/ dir. agentsDir points there.
    const configDir = process.env['HERMES_HOME'] || join(homedir(), '.hermes');
    return {
      configDir,
      agentsDir:  join(configDir, 'profiles'),
      configFile: join(configDir, 'config.yaml'),
    };
  }
}
