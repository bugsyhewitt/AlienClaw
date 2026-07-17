/**
 * HermesHostAdapter — HostAdapter for the Hermes host framework (SCAFFOLD).
 *
 * Selecting Hermes (ALIENCLAW_HOST=hermes) makes governance boot fail fast with
 * an explicit "not yet wired" message: the tool/CLI/LLM seams are stubs pending
 * the live Hermes integration (deferred phase). installProfile() returns the
 * real ~/.hermes runtime paths so the installer skeleton and tests can rely on
 * them today.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Command } from 'commander';
import type { ToolResolver } from '../../msb/martian-executor.js';
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
    // TODO(hermes): register Hermes-native tools via the Hermes tool registry,
    // then wire the shared host-agnostic adapters. Fail fast until then so
    // selecting Hermes never silently runs against OpenClaw's tool layer.
    throw new Error('Hermes host not yet wired — tool wiring');
  }

  llm(): LlmGateway {
    return this.gateway;
  }

  registerCli(_program: Command): void {
    // TODO(hermes): Hermes owns its own Python CLI (hermes_cli/); AlienClaw's
    // verbs are registered on the Hermes side, not here.
    throw new Error('Hermes host not yet wired — CLI registration');
  }

  installProfile(): HostInstallProfile {
    const configDir = join(homedir(), '.hermes');
    return {
      configDir,
      agentsDir:  join(configDir, 'agents'),
      configFile: join(configDir, 'config.yaml'),
    };
  }
}
