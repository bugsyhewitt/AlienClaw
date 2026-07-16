/**
 * creator-bot-runcampaign-domain.test.ts
 *
 * Verifies that CreatorBot.runCampaign routes martian_type through
 * DomainResolver when wired, and preserves the legacy 'compute' default
 * when no resolver is wired (R-001 / R-002 / R-003).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { CreatorBot }              from '../../src/alienclaw/governance/common/creator-bot.js';
import { DomainResolver }          from '../../src/alienclaw/governance/common/domain-resolver.js';
import { MockMartianSummonAdapter } from '../../src/alienclaw/governance/common/summon-adapter.js';
import { InMemorySink, Logger }    from '../../src/alienclaw/governance/common/logger.js';
import { newCorrelationId, nowIso } from '../../src/alienclaw/governance/common/messages.js';
import type { CampaignRequestMessage } from '../../src/alienclaw/governance/common/messages.js';

const makeRequest = (overrides?: Partial<CampaignRequestMessage['payload']>): CampaignRequestMessage => ({
  from:           'BossBot',
  to:             'CreatorBot',
  kind:           'campaign-request',
  payload: {
    campaign_id:      newCorrelationId(),
    plan:             'do the thing',
    success_criteria: 'done',
    ...overrides,
  },
  correlation_id: newCorrelationId(),
  timestamp:      nowIso(),
});

describe('CreatorBot.runCampaign domain resolution', () => {
  let sink: InMemorySink;

  beforeEach(() => { sink = new InMemorySink(); });

  function makeBot(resolver?: DomainResolver) {
    return new CreatorBot(
      new Logger(sink, 'CreatorBot'),
      new MockMartianSummonAdapter(),
      undefined,
      resolver,
    );
  }

  it('A-001: resolver wired + alias: summary contains resolved type, not compute', async () => {
    const resolver = new DomainResolver(['web_search'], { research: 'web_search' });
    const bot      = makeBot(resolver);
    const report   = await bot.runCampaign(makeRequest({ allowed_tools: ['research'] }));
    expect(report.payload.summary).toContain('web_search');
    expect(report.payload.summary).not.toContain('compute');
  });

  it('A-002: resolver wired + no allowed_tools: throws with clear message', async () => {
    const bot = makeBot(new DomainResolver(['compute']));
    await expect(
      bot.runCampaign(makeRequest({ allowed_tools: undefined })),
    ).rejects.toThrow(/no allowed_tools|cannot resolve/);
  });

  it('A-003: no resolver wired + no allowed_tools: legacy compute default preserved', async () => {
    const bot    = makeBot(); // no resolver
    const report = await bot.runCampaign(makeRequest({ allowed_tools: undefined }));
    expect(report.payload.summary).toContain('compute');
  });
});
