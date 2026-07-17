/**
 * HermesLlmGateway — Hermes host LLM access.
 *
 * pi-ai is the shared provider/HTTP layer; the Hermes host differs only in how it
 * RESOLVES (provider, model). This resolves from env overrides
 * ALIENCLAW_HERMES_PROVIDER / ALIENCLAW_HERMES_MODEL, falling back to the shared
 * defaults (anthropic + AGENT_MODELS) so the Hermes host has a working LLM path
 * out of the box. The provider must be pi-ai-supported with its key available via
 * the standard env var (ANTHROPIC_API_KEY, OPENROUTER_API_KEY, OPENAI_API_KEY,
 * GOOGLE_API_KEY, …); getEnvApiKey throws clearly if the key is missing.
 *
 * DEFERRED (needs a live Hermes to validate the format): reading the active
 * profile's ~/.hermes/profiles/<name>/config.yaml (model.default/provider/base_url)
 * so provider selection follows Hermes' own config instead of the env override.
 * OAuth-only Hermes providers (nous device-code, openai-codex, xai-oauth) store
 * creds in auth.json and are out of scope here. See docs/hermes-phase2-spec.md.
 */
import { AGENT_MODELS, ALIENCLAW_PROVIDER, type TierAAgent } from '../../constants.js';
import { piAiComplete } from '../common/pi-ai-complete.js';
import type { LlmGateway } from '../common/host-adapter.js';

export class HermesLlmGateway implements LlmGateway {
  complete(agent: TierAAgent, systemPrompt: string, userContent: string): Promise<string> {
    const provider = process.env['ALIENCLAW_HERMES_PROVIDER'] || ALIENCLAW_PROVIDER;
    const model    = process.env['ALIENCLAW_HERMES_MODEL']    || AGENT_MODELS[agent];
    return piAiComplete(provider, model, systemPrompt, userContent);
  }
}
