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
 * `PiAiLlmGateway` reproduces the pi-ai call pattern used inline in
 * agents/bossbot.ts and agents/advisorbot.ts. It is NOT yet the caller — the
 * agents still call pi-ai directly; Phase 2 routes them through llm() so this
 * becomes the single source of truth. Until then keep the three copies in sync.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Command } from 'commander';
import {
  completeSimple,
  getEnvApiKey,
  getModel,
  type Context,
} from '@mariozechner/pi-ai';
import type { ToolResolver } from '../../msb/martian-executor.js';
import { OpenClawToolResolver } from '../../msb/openclaw-tool-resolver.js';
import { wireToolAdapters } from '../../msb/tool-adapters.js';
import { registerRunCommand } from '../../cli/register.run.js';
import { AGENT_MODELS, ALIENCLAW_PROVIDER, type TierAAgent } from '../../constants.js';
import { extractText } from '../../utils.js';
import type { HostAdapter, HostInstallProfile, LlmGateway } from '../common/host-adapter.js';

/** LLM gateway backed by pi-ai (OpenClaw's provider layer today). */
export class PiAiLlmGateway implements LlmGateway {
  async complete(agent: TierAAgent, systemPrompt: string, userContent: string): Promise<string> {
    const model  = getModel(ALIENCLAW_PROVIDER, AGENT_MODELS[agent]);
    const apiKey = getEnvApiKey(ALIENCLAW_PROVIDER);
    const context: Context = {
      systemPrompt,
      messages: [{ role: 'user', content: userContent, timestamp: Date.now() }],
    };
    const response = await completeSimple(model, context, { apiKey });
    return extractText(response);
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
