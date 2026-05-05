/**
 * BossBot (simplified governance layer — Packet 6).
 *
 * Per the canonical comm graph: the only agent the user talks to.
 * Receives 'user-goal', consults AdvisorBot, dispatches campaign to
 * CreatorBot, receives the report, returns 'user-response'.
 *
 * Packet 6 implementation: single-goal-at-a-time, synchronous through
 * the four-leg loop. No LLM calls — just struct-correct messages with
 * trivial plan generation ("Plan to address: <goal>").
 *
 * NOTE: This class is a simplified wrapper for the Packet 6 governance loop.
 * It is distinct from src/alienclaw/agents/bossbot.ts, which has the full
 * LLM-backed scheme/planning methods.
 */

import type {
  UserGoalMessage,
  AdvisorConsultMessage,
  CampaignRequestMessage,
  UserResponseMessage,
} from './messages.js';
import { nowIso, newCorrelationId } from './messages.js';
import { assertLegalSend } from './comm-graph.js';
import type { Logger } from './logger.js';
import type { AdvisorBot } from './advisor-bot.js';
import type { CreatorBot } from './creator-bot.js';

export class BossBot {
  constructor(
    private readonly logger:  Logger,
    private readonly advisor: AdvisorBot,
    private readonly creator: CreatorBot,
  ) {}

  /**
   * Handle a user goal end-to-end via the four-leg governance loop:
   *   1. Receive goal
   *   2. Consult AdvisorBot (planning)
   *   3. Dispatch campaign to CreatorBot
   *   4. Return result to user
   *
   * Returns the final user-response message. Throws if any step fails
   * (no silent error swallowing — callers handle errors explicitly).
   */
  async handleUserGoal(goal: UserGoalMessage): Promise<UserResponseMessage> {
    this.logger.info(
      'goal-received',
      { goal: goal.payload.goal, constraints: goal.payload.constraints },
      goal.correlation_id,
    );

    // Leg 1 → 2: consult AdvisorBot
    const draftPlan = `Plan to address: ${goal.payload.goal}`;
    const consult: AdvisorConsultMessage = {
      from: 'BossBot',
      to:   'AdvisorBot',
      kind: 'planning-consult',
      payload:        { draft_plan: draftPlan },
      correlation_id: goal.correlation_id,
      timestamp:      nowIso(),
    };
    assertLegalSend(consult);
    this.logger.info('consult-sent', { draft_plan_length: draftPlan.length }, goal.correlation_id);

    const advice = await this.advisor.consult(consult);

    // Leg 2 → 3: dispatch campaign to CreatorBot
    const campaignId = newCorrelationId();
    const campaignReq: CampaignRequestMessage = {
      from: 'BossBot',
      to:   'CreatorBot',
      kind: 'campaign-request',
      payload: {
        campaign_id:      campaignId,
        plan:             advice.payload.refined_plan,
        success_criteria: 'Any non-error result is success in Packet 6.',
      },
      correlation_id: goal.correlation_id,
      timestamp:      nowIso(),
    };
    assertLegalSend(campaignReq);
    this.logger.info(
      'campaign-dispatched',
      { campaign_id: campaignId, concern_count: advice.payload.concerns?.length ?? 0 },
      goal.correlation_id,
    );

    const report = await this.creator.runCampaign(campaignReq);

    // Leg 3 → 4: return result to user
    const response: UserResponseMessage = {
      from: 'BossBot',
      to:   'user',
      kind: 'user-response',
      payload: {
        goal:    goal.payload.goal,
        result:  report.payload.result,
        summary: report.payload.summary,
      },
      correlation_id: goal.correlation_id,
      timestamp:      nowIso(),
    };
    assertLegalSend(response);
    this.logger.info(
      'user-response-sent',
      { summary_length: response.payload.summary.length },
      goal.correlation_id,
    );
    return response;
  }
}
