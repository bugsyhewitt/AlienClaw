/**
 * CreatorBot (simplified governance layer — Packet 6).
 *
 * Per the canonical comm graph: receives 'campaign-request' from BossBot,
 * returns 'campaign-report'. NEVER talks to user. NEVER talks to AdvisorBot
 * directly.
 *
 * Packet 6 implementation: summons ONE Martian directly via the injected
 * MartianSummonAdapter. No Subagents yet — Packet 7 adds that layer.
 *
 * Packet 11: writes Subagent 5-file workspace at birth via SubagentBrief.
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
import { Subagent } from './subagent.js';
import type { SubagentBrief } from './subagent.js';
import type { DomainResolver } from './domain-resolver.js';

/** Inputs for CreatorBot.buildSubagent — the first-class build entry point. */
export interface BuildSubagentSpec {
  campaignId:       string;
  objective:        string;
  successCriteria?: string;
  allowedMartians?: string[];
  inputs?:          Record<string, unknown>;
  timeoutMs?:       number;
}

/**
 * Build a transition_table YAML block for the given brief.
 * Returns an empty string if no allowed Martians are listed.
 *
 * Uses one of two templates:
 *  - single_martian: one state, success → FINALIZE, error → FAIL
 *  - two_step:       step1 then step2, with linear flow
 */
export function buildTransitionTableYaml(brief: SubagentBrief): string {
  const martians = brief.allowedMartians;
  if (martians.length === 0) {
    return '';
  }
  if (martians.length === 1) {
    const m = martians[0]!;
    return `transition_table:
  initial_state: step1
  states:
    step1:
      martian_type: ${m}
      inputs:
        plan: "\${campaign.plan}"
      transitions:
        - when: { all: [{ kind: martian_succeeded }] }
          goto: FINALIZE
        - when: { any: [{ kind: error_present }] }
          goto: "FAIL:martian_failed"
`;
  }
  const m1 = martians[0]!;
  const m2 = martians[1]!;
  return `transition_table:
  initial_state: step1
  states:
    step1:
      martian_type: ${m1}
      inputs:
        plan: "\${campaign.plan}"
      transitions:
        - when: { all: [{ kind: martian_succeeded }] }
          goto: step2
        - when: { any: [{ kind: error_present }] }
          goto: "FAIL:step1_failed"
    step2:
      martian_type: ${m2}
      inputs:
        input: "\${last_result.output.result}"
      transitions:
        - when: { any: [{ kind: error_absent }] }
          goto: FINALIZE
        - when: { any: [{ kind: error_present }] }
          goto: "FAIL:step2_failed"
`;
}

export class CreatorBot {
  constructor(
    private readonly logger:        Logger,
    private readonly summonAdapter: MartianSummonAdapter,
    private readonly subagentsBaseDir?: string,
    private readonly domainResolver?: DomainResolver,
  ) {}

  /**
   * Build an ephemeral Subagent for a domain (first-class build entry point).
   *
   * Resolves domain → martian_type strictly: unknown domains throw before
   * any Subagent exists or any workspace is written. The Subagent is
   * constructed with fromPopulation: true so summoned Martians draw evolved
   * genomes from the per-martian_type Population via the bridge's
   * summon-from-population path, instead of being born with random genomes.
   * Fitness stays runtime-computed and is passed through untouched.
   */
  buildSubagent(domain: string, spec: BuildSubagentSpec): Subagent {
    if (!this.domainResolver) {
      throw new Error('CreatorBot.buildSubagent requires a DomainResolver');
    }
    const martianType = this.domainResolver.resolve(domain);

    const subagent = new Subagent(this.summonAdapter, {
      campaignId:       spec.campaignId,
      martianType,
      inputs:           spec.inputs ?? {},
      timeoutMs:        spec.timeoutMs ?? 30_000,
      fromPopulation:   true,
      subagentsBaseDir: this.subagentsBaseDir,
    });

    const brief: SubagentBrief = {
      campaignId:         spec.campaignId,
      role:               `${martianType} Subagent`,
      domain,
      objective:          spec.objective,
      scope:              spec.successCriteria ?? 'Complete the campaign objective.',
      successCriteria:    spec.successCriteria ?? 'Task complete.',
      allowedMartians:    spec.allowedMartians ?? [martianType],
      deliverables:       'Campaign report to BossBot.',
      backgroundContext:  '',
      communicationStyle: 'structured',
      knowledgeBase:      '',
      constraints:        'None',
    };

    subagent.birth(brief);

    this.logger.info(
      'subagent-built',
      {
        domain,
        martian_type:    martianType,
        campaign_id:     spec.campaignId,
        subagent_id:     subagent.subagentId,
        from_population: true,
      },
      spec.campaignId,
    );

    return subagent;
  }

  /**
   * Execute a campaign by summoning one Martian.
   *
   * In Packet 6: no Subagents, one Martian, placeholder genome.
   * Packet 7: real genome sampling + Subagent layer between Creator and Martian.
   * Packet 11: Subagent 5-file workspace written at birth.
   */
  async runCampaign(request: CampaignRequestMessage): Promise<CampaignReportMessage> {
    this.logger.info(
      'campaign-received',
      { campaign_id: request.payload.campaign_id, plan_length: request.payload.plan.length },
      request.correlation_id,
    );

    const martian_type = request.payload.allowed_tools?.[0] ?? 'compute';

    const subagent = new Subagent(this.summonAdapter, {
      campaignId:        request.payload.campaign_id,
      martianType:       martian_type,
      inputs:            { plan: request.payload.plan, success_criteria: request.payload.success_criteria },
      timeoutMs:         30_000,
      subagentsBaseDir:  this.subagentsBaseDir,
    });

    // Build birth brief from campaign request
    const brief: SubagentBrief = {
      campaignId:        request.payload.campaign_id,
      role:              `${martian_type} Subagent`,
      domain:            martian_type,
      objective:         request.payload.plan,
      scope:             request.payload.success_criteria ?? 'Complete the campaign plan.',
      successCriteria:   request.payload.success_criteria ?? 'Task complete.',
      allowedMartians:   request.payload.allowed_tools ?? [martian_type],
      deliverables:      'Campaign report to BossBot.',
      backgroundContext: '',
      communicationStyle: 'structured',
      knowledgeBase:     '',
      constraints:       'None',
    };

    subagent.birth(brief);

    this.logger.info(
      'summon-issued',
      { martian_type, summon_id: subagent.subagentId },
      request.correlation_id,
    );

    const subagentReport = await subagent.execute();
    const result = subagentReport.result;

    const ok = result.ok;
    subagent.finalize(ok ? 'COMPLETE' : 'FAILED', ok ? 'Campaign complete.' : `Campaign failed: ${result.error ?? 'unknown'}`);
    subagent.erase();

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
