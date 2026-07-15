import { describe, it, expect, beforeEach } from 'vitest';
import { CreatorBot } from '../../src/alienclaw/governance/common/creator-bot.js';
import { MockMartianSummonAdapter } from '../../src/alienclaw/governance/common/summon-adapter.js';
import type { MartianSummonAdapter } from '../../src/alienclaw/governance/common/summon-adapter.js';
import { InMemorySink, Logger } from '../../src/alienclaw/governance/common/logger.js';
import { newCorrelationId, nowIso } from '../../src/alienclaw/governance/common/messages.js';
import type { CampaignRequestMessage } from '../../src/alienclaw/governance/common/messages.js';

const makeRequest = (overrides?: Partial<CampaignRequestMessage['payload']>): CampaignRequestMessage => ({
  from: 'BossBot', to: 'CreatorBot', kind: 'campaign-request',
  payload: {
    campaign_id: newCorrelationId(),
    plan: 'do the thing',
    success_criteria: 'done',
    ...overrides,
  },
  correlation_id: newCorrelationId(),
  timestamp: nowIso(),
});

describe('CreatorBot', () => {
  let sink: InMemorySink;

  beforeEach(() => { sink = new InMemorySink(); });

  function makeBot(adapter: MartianSummonAdapter = new MockMartianSummonAdapter()) {
    return new CreatorBot(new Logger(sink, 'CreatorBot'), adapter);
  }

  it('returns a CampaignReportMessage with correct shape', async () => {
    const bot    = makeBot();
    const req    = makeRequest();
    const report = await bot.runCampaign(req);
    expect(report.from).toBe('CreatorBot');
    expect(report.to).toBe('BossBot');
    expect(report.kind).toBe('campaign-report');
    expect(report.payload.campaign_id).toBe(req.payload.campaign_id);
  });

  it('propagates correlation_id from request to report', async () => {
    const bot    = makeBot();
    const req    = makeRequest();
    const report = await bot.runCampaign(req);
    expect(report.correlation_id).toBe(req.correlation_id);
  });

  it('uses first allowed_tool as martian_type', async () => {
    const bot    = makeBot();
    const req    = makeRequest({ allowed_tools: ['search_text'] });
    const report = await bot.runCampaign(req);
    expect(report.payload.summary).toContain('search_text');
  });

  it('defaults to compute when no allowed_tools', async () => {
    const bot    = makeBot();
    const report = await bot.runCampaign(makeRequest({ allowed_tools: undefined }));
    expect(report.payload.summary).toContain('compute');
  });

  it('on summon failure, summary describes the error', async () => {
    const failAdapter = new MockMartianSummonAdapter(0, {}, true, 'python bridge offline');
    const bot         = makeBot(failAdapter);
    const report      = await bot.runCampaign(makeRequest());
    expect(report.payload.summary).toContain('failed');
    expect(report.payload.summary).toContain('python bridge offline');
  });

  it('emits campaign-received, summon-issued, summon-complete, campaign-report-sent', async () => {
    const bot = makeBot();
    await bot.runCampaign(makeRequest());
    expect(sink.byEvent('campaign-received')).toHaveLength(1);
    expect(sink.byEvent('summon-issued')).toHaveLength(1);
    expect(sink.byEvent('summon-complete')).toHaveLength(1);
    expect(sink.byEvent('campaign-report-sent')).toHaveLength(1);
  });

  it('on summon failure with no error message, summary falls back to "unknown error"', async () => {
    // Covers bid=19 L226 and bid=22 L244 — ?? fallback arms fired when error field is absent.
    const silentFailAdapter: MartianSummonAdapter = {
      async summon(request) {
        return {
          summon_id:    request.summon_id,
          ok:           false,
          error:        undefined,   // optional — triggers both ?? 'unknown' arms
          fitness:      0.0,
          run_metadata: { tool_calls: 0, wall_clock_ms: 0 },
        };
      },
    };
    const bot    = makeBot(silentFailAdapter);
    const report = await bot.runCampaign(makeRequest());
    expect(report.payload.summary).toContain('failed');
    expect(report.payload.summary).toContain('unknown error');
  });

  it('uses fallback scope and successCriteria when success_criteria is absent', async () => {
    const bot    = makeBot();
    // Cast bypasses the required-string type constraint to exercise the ?? fallback arms
    // at creator-bot.ts:204 and :205 — a genuine runtime-reachable path.
    const req    = makeRequest({ success_criteria: undefined as unknown as string });
    const report = await bot.runCampaign(req);
    expect(report.from).toBe('CreatorBot');
    expect(report.to).toBe('BossBot');
  });
});
