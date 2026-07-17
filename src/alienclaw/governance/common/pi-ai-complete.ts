/**
 * Shared pi-ai completion — the single LLM call both host gateways use.
 *
 * pi-ai is the actual provider/HTTP layer for BOTH hosts; the hosts differ only
 * in how they RESOLVE (provider, model, key). OpenClaw uses the fixed
 * ALIENCLAW_PROVIDER + AGENT_MODELS; Hermes resolves per its own config/env.
 * Both then call this one place, so there is a single completion code path.
 */
import {
  completeSimple,
  getEnvApiKey,
  getModel,
  type Context,
  type KnownProvider,
} from '@mariozechner/pi-ai';
import { extractText } from '../../utils.js';

/**
 * Complete one system+user turn against `provider`/`model` via pi-ai.
 * `provider` may originate from external config/env (Hermes); pi-ai's
 * getModel/getEnvApiKey validate it at runtime and throw on an unknown provider,
 * so the cast is safe.
 */
export async function piAiComplete(
  provider: string,
  model: string,
  systemPrompt: string,
  userContent: string,
): Promise<string> {
  // provider/model come from external config/env; pi-ai's getModel/getEnvApiKey are
  // typed per-provider (the model id narrows to `never` for a non-literal provider),
  // so cast at this boundary — pi-ai validates both at runtime and throws on unknowns.
  const p             = provider as KnownProvider;
  const apiKey        = getEnvApiKey(p);
  const resolvedModel = getModel(p, model as never);
  const context: Context = {
    systemPrompt,
    messages: [{ role: 'user', content: userContent, timestamp: Date.now() }],
  };
  const response = await completeSimple(resolvedModel, context, { apiKey });
  return extractText(response);
}
