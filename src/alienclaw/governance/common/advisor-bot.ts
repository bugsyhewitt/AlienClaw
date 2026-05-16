/**
 * AdvisorBot (simplified governance layer — Packet 6).
 *
 * Per the canonical comm graph: receives 'planning-consult' from BossBot,
 * returns 'advice'. NEVER talks to user. NEVER talks to CreatorBot directly.
 *
 * Packet 6 implementation: deterministic advice (refinement is a passthrough
 * with a scope note). Future packets add LLM-backed reasoning here.
 *
 * NOTE: This class is a simplified wrapper for the Packet 6 governance loop.
 * It is distinct from the full-featured src/alienclaw/agents/advisorbot.ts,
 * which has LLM-backed advise() and session management. This class lives in
 * the governance module and is tested in isolation.
 */

import type { AdvisorConsultMessage, AdviceMessage } from './messages.js';
import { nowIso } from './messages.js';
import { assertLegalSend } from './comm-graph.js';
import type { Logger } from './logger.js';

export class AdvisorBot {
  constructor(private readonly logger: Logger) {}

  /**
   * Receive a planning consult from BossBot and return advice.
   *
   * The runtime guard runs on the outbound advice message — proves
   * AdvisorBot cannot send to any destination other than BossBot.
   *
   * Packet 6: advice = refined_plan (passthrough) + scope concern.
   * Packet 7+: replace with LLM-backed reasoning via pi-ai.
   */
  async consult(consult: AdvisorConsultMessage): Promise<AdviceMessage> {
    this.logger.info(
      'consult-received',
      { plan_length: consult.payload.draft_plan.length },
      consult.correlation_id,
    );

    const advice: AdviceMessage = {
      from: 'AdvisorBot',
      to:   'BossBot',
      kind: 'advice',
      payload: {
        refined_plan: consult.payload.draft_plan,
        concerns:     ['scope: keep campaign focused on the stated goal'],
      },
      correlation_id: consult.correlation_id,
      timestamp:      nowIso(),
    };

    assertLegalSend(advice);
    this.logger.info(
      'advice-sent',
      { concerns_count: advice.payload.concerns?.length ?? 0 },
      consult.correlation_id,
    );
    return advice;
  }
}
