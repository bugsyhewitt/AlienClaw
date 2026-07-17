/**
 * HermesLlmGateway — Hermes host LLM access (SCAFFOLD).
 *
 * TODO(hermes): route through Hermes' provider layer — `hermes model` /
 * Nous Portal / OpenRouter — configured in ~/.hermes/config.yaml (model.default,
 * model.provider, model.base_url) with secrets in ~/.hermes/.env.
 */
import type { TierAAgent } from '../../constants.js';
import type { LlmGateway } from '../common/host-adapter.js';

export class HermesLlmGateway implements LlmGateway {
  async complete(_agent: TierAAgent, _systemPrompt: string, _userContent: string): Promise<string> {
    throw new Error('Hermes host not yet wired — LLM provider');
  }
}
