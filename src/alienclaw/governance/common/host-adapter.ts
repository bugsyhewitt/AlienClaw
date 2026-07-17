/**
 * HostAdapter — the seam between AlienClaw governance and its host agent framework.
 *
 * AlienClaw runs on two hosts: OpenClaw (live) and Hermes (scaffold). Governance
 * itself is host-agnostic; only four capabilities differ per host — tool
 * resolution, LLM provider access, CLI registration, and install-time config
 * paths.
 *
 * INTERCHANGEABILITY INVARIANT: everything from the Martian summon boundary DOWN
 * (genome codec, registry, fitness, evolution, and the
 * RealMartianSummonAdapter -> `python3 -m alienclaw.bridge` path) is a single
 * shared codebase and MUST NOT be placed behind this interface. That shared path
 * is exactly what keeps a Martian interchangeable between hosts. Do NOT add a
 * summonAdapter() method here — doing so would fork the execution path and break
 * interchangeability.
 */
import type { Command } from 'commander';
import type { ToolResolver } from '../../msb/martian-executor.js';
import type { TierAAgent } from '../../constants.js';

export type HostId = 'openclaw' | 'hermes';

/** Minimal LLM access governance needs from a host's provider layer. */
export interface LlmGateway {
  /** Complete a single system+user turn for the given Tier-A agent. */
  complete(agent: TierAAgent, systemPrompt: string, userContent: string): Promise<string>;
}

/** Runtime config-directory locations for a host (NOT provisioning logic). */
export interface HostInstallProfile {
  /** e.g. ~/.openclaw or ~/.hermes */
  readonly configDir: string;
  /** e.g. <configDir>/agents */
  readonly agentsDir: string;
  /** e.g. the openclaw.json path, or the Hermes config target */
  readonly configFile: string;
}

/**
 * What governance needs from its host framework. EXCLUDES Martian
 * summon/execution — that path is shared across hosts (see the invariant above).
 */
export interface HostAdapter {
  readonly hostId: HostId;
  /** Resolver for logical tool names -> tool fns (mirrors OpenClawToolResolver). */
  toolResolver(): ToolResolver;
  /** Register host-native + shared tool adapters into the executor registry. */
  wireToolAdapters(): void;
  /** Access the host's LLM provider layer. */
  llm(): LlmGateway;
  /** Register AlienClaw's CLI verbs onto the host's command program (no-op if the host owns the CLI). */
  registerCli(program: Command): void;
  /** Runtime config paths for this host. */
  installProfile(): HostInstallProfile;
}
