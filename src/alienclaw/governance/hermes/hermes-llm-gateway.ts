/**
 * HermesLlmGateway — Hermes host LLM access.
 *
 * pi-ai is the shared provider/HTTP layer; the Hermes host differs only in how it
 * RESOLVES (provider, model). Resolution precedence (Hermes-like CLI > config > default):
 *   1. env override — ALIENCLAW_HERMES_PROVIDER + ALIENCLAW_HERMES_MODEL (both set)
 *   2. the agent's Hermes profile config.yaml top-level `model:` scalar
 *      (`<provider>/<model>`, e.g. `openrouter/pareto-code`), when its provider is
 *      pi-ai-supported (`.env`-key providers). Grounded in hermes-agent v0.15.2:
 *      `hermes config set model "<p>/<m>"` → `model: <p>/<m>` in config.yaml, and
 *      Hermes splits provider = value.split("/", 1)[0].lower() (model_normalize.py).
 *   3. shared defaults — anthropic + AGENT_MODELS[agent].
 *
 * BOUNDARY (not replicated — would drift from Hermes): the `provider: auto`
 * resolution, per-role/auxiliary models, `base_url` precedence, and OAuth-only
 * providers (nous/openai-codex/xai; creds live in auth.json). We read only the
 * explicit top-level `model:` scalar and fall back otherwise. See
 * docs/hermes-phase2-spec.md.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getProviders } from '@mariozechner/pi-ai';
import { AGENT_MODELS, ALIENCLAW_PROVIDER, type TierAAgent } from '../../constants.js';
import { piAiComplete } from '../common/pi-ai-complete.js';
import type { LlmGateway } from '../common/host-adapter.js';

const PROFILE_BY_AGENT: Record<TierAAgent, string> = {
  BossBot:    'bossbot',
  AdvisorBot: 'advisorbot',
  CreatorBot: 'creatorbot',
};

function hermesHome(): string {
  return process.env['HERMES_HOME'] || join(homedir(), '.hermes');
}

/**
 * Read the top-level `model:` scalar from a Hermes config.yaml (best-effort — a
 * targeted read of one top-level scalar, not full YAML). Strips quotes and inline
 * comments. Returns undefined if absent/unreadable so the caller falls back safely.
 */
function readConfigModel(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
  const m = text.match(/^model:[ \t]*(.+?)[ \t]*$/m);
  if (!m) return undefined;
  let v = m[1].replace(/[ \t]+#.*$/, '').trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v || undefined;
}

/** Resolve (provider, model) for an agent: env override → Hermes config → shared default. */
function resolveModel(agent: TierAAgent): { provider: string; model: string } {
  const envProvider = process.env['ALIENCLAW_HERMES_PROVIDER'];
  const envModel    = process.env['ALIENCLAW_HERMES_MODEL'];
  if (envProvider && envModel) return { provider: envProvider, model: envModel };

  const home    = hermesHome();
  const profile = PROFILE_BY_AGENT[agent];
  const known   = new Set(getProviders() as string[]);
  // Profile config first, then the default-profile (root) config.
  for (const path of [join(home, 'profiles', profile, 'config.yaml'), join(home, 'config.yaml')]) {
    const raw = readConfigModel(path);
    if (!raw) continue;
    const slash = raw.indexOf('/');          // provider = prefix before first '/', per Hermes
    if (slash <= 0) continue;
    const provider = raw.slice(0, slash).toLowerCase();
    const model    = raw.slice(slash + 1);
    if (model && known.has(provider)) return { provider, model };
    // provider not pi-ai-supported (e.g. nous/auto) → try next, else fall back.
  }
  return { provider: ALIENCLAW_PROVIDER, model: AGENT_MODELS[agent] };
}

export class HermesLlmGateway implements LlmGateway {
  complete(agent: TierAAgent, systemPrompt: string, userContent: string): Promise<string> {
    const { provider, model } = resolveModel(agent);
    return piAiComplete(provider, model, systemPrompt, userContent);
  }
}
