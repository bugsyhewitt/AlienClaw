/**
 * CreatorBot (simplified governance layer — Packet 6).
 *
 * Per the canonical comm graph: receives 'campaign-request' from BossBot,
 * returns 'campaign-report'. NEVER talks to user. NEVER talks to AdvisorBot
 * directly.
 *
 * Packet 6 implementation: summons ONE Martian directly via the injected
 * MartianSummonAdapter. No Specialists yet — Packet 7 adds that layer.
 *
 * NOTE: This class is a simplified wrapper for the Packet 6 governance loop.
 * It is distinct from src/alienclaw/agents/creatorbot.ts, which has the full
 * campaign/scheme building, scheduler, and subagent spawning.
 */

import type { CampaignRequestMessage, CampaignReportMessage } from './messages.js';
import { nowIso } from './messages.js';
import { assertLegalSend } from './comm-graph.js';
import type { Logger } from './logger.js';
import type { MartianSummonAdapter } from './summon-adapter.js';
import { Specialist } from './specialist.js';

export class CreatorBot {
  constructor(
    private readonly logger:        Logger,
    private readonly summonAdapter: MartianSummonAdapter,
  ) {}

  /**
   * Execute a campaign by summoning one Martian.
   *
   * In Packet 6: no Specialists, one Martian, placeholder genome.
   * Packet 7: real genome sampling + Specialist layer between Creator and Martian.
   */
  async runCampaign(request: CampaignRequestMessage): Promise<CampaignReportMessage> {
    this.logger.info(
      'campaign-received',
      { campaign_id: request.payload.campaign_id, plan_length: request.payload.plan.length },
      request.correlation_id,
    );

    const martian_type = request.payload.allowed_tools?.[0] ?? 'compute';

    const specialist = new Specialist(this.summonAdapter, {
      campaignId:  request.payload.campaign_id,
      martianType: martian_type,
      inputs:      { plan: request.payload.plan, success_criteria: request.payload.success_criteria },
      timeoutMs:   30_000,
    });

    this.logger.info(
      'summon-issued',
      { martian_type, summon_id: specialist.specialistId },
      request.correlation_id,
    );

    const specialistReport = await specialist.execute();
    const result = specialistReport.result;
    specialist.erase();

    this.logger.info(
      'summon-complete',
      { ok: result.ok, fitness: result.fitness, tool_calls: result.run_metadata.tool_calls },
      request.correlation_id,
    );

    const report: CampaignReportMessage = {
      from: 'CreatorBot',
      to:   'BossBot',
      kind: 'campaign-report',
      payload: {
        campaign_id: request.payload.campaign_id,
        result:      result.output ?? null,
        summary:     result.ok
          ? `Martian (${martian_type}) completed with fitness ${result.fitness.toFixed(2)}.`
          : `Martian (${martian_type}) failed: ${result.error ?? 'unknown error'}.`,
      },
      correlation_id: request.correlation_id,
      timestamp:      nowIso(),
    };

    assertLegalSend(report);
    this.logger.info(
      'campaign-report-sent',
      { campaign_id: request.payload.campaign_id, ok: result.ok },
      request.correlation_id,
    );
    return report;
  }
}

