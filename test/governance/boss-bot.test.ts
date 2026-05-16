import { describe, it, expect, beforeEach } from 'vitest';
import { BossBot } from '../../src/alienclaw/governance/common/boss-bot.js';
import { AdvisorBot } from '../../src/alienclaw/governance/common/advisor-bot.js';
import { CreatorBot } from '../../src/alienclaw/governance/common/creator-bot.js';
import { MockMartianSummonAdapter } from '../../src/alienclaw/governance/common/summon-adapter.js';
import { InMemorySink, Logger } from '../../src/alienclaw/governance/common/logger.js';
import { newCorrelationId, nowIso } from '../../src/alienclaw/governance/common/messages.js';
import type { UserGoalMessage } from '../../src/alienclaw/governance/common/messages.js';

const makeGoal = (goal = 'summarize HN'): UserGoalMessage => ({
  from: 'user', to: 'BossBot', kind: 'user-goal',
  payload: { goal },
  correlation_id: newCorrelationId(),
  timestamp: nowIso(),
});

describe('BossBot', () => {
  let sink: InMemorySink;

  beforeEach(() => { sink = new InMemorySink(); });

  function makeBoss(adapterOpts?: ConstructorParameters<typeof MockMartianSummonAdapter>) {
    const adapter = new MockMartianSummonAdapter(...(adapterOpts ?? []));
    const advisor = new AdvisorBot(new Logger(sink, 'AdvisorBot'));
    const creator = new CreatorBot(new Logger(sink, 'CreatorBot'), adapter);
    return new BossBot(new Logger(sink, 'BossBot'), advisor, creator);
  }

  it('returns a UserResponseMessage with kind=user-response', async () => {
    const boss     = makeBoss();
    const response = await boss.handleUserGoal(makeGoal());
    expect(response.from).toBe('BossBot');
    expect(response.to).toBe('user');
    expect(response.kind).toBe('user-response');
  });

  it('echoes the goal in the response payload', async () => {
    const boss     = makeBoss();
    const goal     = makeGoal('find trending repos');
    const response = await boss.handleUserGoal(goal);
    expect(response.payload.goal).toBe('find trending repos');
  });

  it('propagates the correlation_id through all four legs', async () => {
    const boss   = makeBoss();
    const goal   = makeGoal();
    await boss.handleUserGoal(goal);
    for (const entry of sink.entries) {
      if (entry.correlation_id !== undefined) {
        expect(entry.correlation_id).toBe(goal.correlation_id);
      }
    }
  });

  it('emits the expected log event sequence', async () => {
    const boss = makeBoss();
    await boss.handleUserGoal(makeGoal());
    const events = sink.entries.map(e => e.event);
    expect(events).toContain('goal-received');
    expect(events).toContain('consult-sent');
    expect(events).toContain('consult-received');
    expect(events).toContain('advice-sent');
    expect(events).toContain('campaign-dispatched');
    expect(events).toContain('campaign-received');
    expect(events).toContain('summon-issued');
    expect(events).toContain('summon-complete');
    expect(events).toContain('campaign-report-sent');
    expect(events).toContain('user-response-sent');
  });

  it('log events in the correct order', async () => {
    const boss = makeBoss();
    await boss.handleUserGoal(makeGoal());
    const events = sink.entries.map(e => e.event);
    const indexOf = (e: string) => events.indexOf(e);
    expect(indexOf('goal-received')).toBeLessThan(indexOf('consult-sent'));
    expect(indexOf('consult-sent')).toBeLessThan(indexOf('campaign-dispatched'));
    expect(indexOf('campaign-dispatched')).toBeLessThan(indexOf('summon-issued'));
    expect(indexOf('summon-issued')).toBeLessThan(indexOf('user-response-sent'));
  });

  it('on summon failure, user-response still returned (no crash)', async () => {
    const boss     = makeBoss([0, {}, true, 'summon crashed']);
    const response = await boss.handleUserGoal(makeGoal());
    expect(response.kind).toBe('user-response');
    expect(response.payload.summary).toContain('failed');
  });
});
