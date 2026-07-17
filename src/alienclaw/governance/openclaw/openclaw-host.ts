/**
 * OpenClawHostAdapter — the live HostAdapter (AlienClaw's original host).
 *
 * This is a thin composition layer: it DELEGATES to the existing OpenClaw
 * integration code rather than moving it. Tool wiring goes through the live
 * `wireToolAdapters()` registry; `toolResolver()` exposes OpenClawToolResolver
 * for parity/testing (note: the executor resolves via the global adapter
 * registry, so toolResolver() is a seam for tests + future hosts, not the
 * runtime resolution path).
 *
 * `PiAiLlmGateway` is the single source of truth for AlienClaw's LLM calls:
 * agents/bossbot.ts and agents/advisorbot.ts both route through
 * selectHost().llm().complete(...), so the provider is host-selected.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Command } from 'commander';
import type { ToolResolver } from '../../msb/martian-executor.js';
import { OpenClawToolResolver } from '../../msb/openclaw-tool-resolver.js';
import { wireToolAdapters } from '../../msb/tool-adapters.js';
import { registerRunCommand } from '../../cli/register.run.js';
import { AGENT_MODELS, ALIENCLAW_PROVIDER, type TierAAgent } from '../../constants.js';
import { piAiComplete } from '../common/pi-ai-complete.js';
import type { HostAdapter, HostInstallProfile, LlmGateway } from '../common/host-adapter.js';

/** LLM gateway backed by pi-ai (OpenClaw's provider layer): fixed anthropic provider + AGENT_MODELS. */
export class PiAiLlmGateway implements LlmGateway {
  complete(agent: TierAAgent, systemPrompt: string, userContent: string): Promise<string> {
    return piAiComplete(ALIENCLAW_PROVIDER, AGENT_MODELS[agent], systemPrompt, userContent);
  }
}

export class OpenClawHostAdapter implements HostAdapter {
  readonly hostId = 'openclaw' as const;

  private readonly gateway = new PiAiLlmGateway();

  toolResolver(): ToolResolver {
    // Parity/testing view of the tool set; the live resolution path is the
    // adapter registry populated by wireToolAdapters().
    return new OpenClawToolResolver();
  }

  wireToolAdapters(): void {
    wireToolAdapters();
  }

  llm(): LlmGateway {
    return this.gateway;
  }

  registerCli(program: Command): void {
    registerRunCommand(program);
  }

  installProfile(): HostInstallProfile {
    // Honor OPENCLAW_HOME (as install.sh does) so runtime paths and the
    // installer share one source of truth.
    const configDir = process.env['OPENCLAW_HOME'] || join(homedir(), '.openclaw');
    return {
      configDir,
      agentsDir:  join(configDir, 'agents'),
      configFile: join(configDir, 'openclaw.json'),
    };
  }
}
