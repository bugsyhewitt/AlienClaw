import { describe, it, expect, beforeEach } from 'vitest';
import { AdvisorBot } from '../../src/alienclaw/governance/common/advisor-bot.js';
import { InMemorySink, Logger } from '../../src/alienclaw/governance/common/logger.js';
import { newCorrelationId, nowIso } from '../../src/alienclaw/governance/common/messages.js';
import type { AdvisorConsultMessage } from '../../src/alienclaw/governance/common/messages.js';

const makeConsult = (plan = 'test plan'): AdvisorConsultMessage => ({
  from: 'BossBot', to: 'AdvisorBot', kind: 'planning-consult',
  payload: { draft_plan: plan },
  correlation_id: newCorrelationId(),
  timestamp: nowIso(),
});

describe('AdvisorBot', () => {
  let sink: InMemorySink;
  let bot: AdvisorBot;

  beforeEach(() => {
    sink = new InMemorySink();
    bot  = new AdvisorBot(new Logger(sink, 'AdvisorBot'));
  });

  it('returns an AdviceMessage with kind=advice', async () => {
    const advice = await bot.consult(makeConsult());
    expect(advice.kind).toBe('advice');
    expect(advice.from).toBe('AdvisorBot');
    expect(advice.to).toBe('BossBot');
  });

  it('preserves the draft_plan as refined_plan', async () => {
    const advice = await bot.consult(makeConsult('my plan'));
    expect(advice.payload.refined_plan).toBe('my plan');
  });

  it('propagates correlation_id unchanged', async () => {
    const consult = makeConsult();
    const advice  = await bot.consult(consult);
    expect(advice.correlation_id).toBe(consult.correlation_id);
  });

  it('includes concerns in advice', async () => {
    const advice = await bot.consult(makeConsult());
    expect(advice.payload.concerns).toBeDefined();
    expect(advice.payload.concerns!.length).toBeGreaterThan(0);
  });

  it('emits consult-received and advice-sent log entries', async () => {
    await bot.consult(makeConsult());
    expect(sink.byEvent('consult-received')).toHaveLength(1);
    expect(sink.byEvent('advice-sent')).toHaveLength(1);
  });

  it('log entries carry the correlation_id', async () => {
    const consult = makeConsult();
    await bot.consult(consult);
    for (const entry of sink.entries) {
      expect(entry.correlation_id).toBe(consult.correlation_id);
    }
  });
});
