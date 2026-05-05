/**
 * Smoke tests for governance/messages.ts.
 * Primarily verifies that all message shapes compile correctly and
 * that the helper functions produce sensible output.
 */

import { describe, it, expect } from 'vitest';
import type {
  UserGoalMessage,
  AdvisorConsultMessage,
  AdviceMessage,
  CampaignRequestMessage,
  CampaignReportMessage,
  UserResponseMessage,
  FitnessReportMessage,
} from '../../src/alienclaw/governance/messages.js';
import {
  newCorrelationId,
  nowIso,
} from '../../src/alienclaw/governance/messages.js';

describe('governance/messages', () => {
  it('newCorrelationId produces a UUID-shaped string', () => {
    const id = newCorrelationId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('newCorrelationId produces unique values', () => {
    const ids = new Set(Array.from({ length: 10 }, () => newCorrelationId()));
    expect(ids.size).toBe(10);
  });

  it('nowIso produces an ISO-8601 timestamp', () => {
    const ts = nowIso();
    expect(new Date(ts).toISOString()).toBe(ts);
  });

  it('UserGoalMessage type compiles with correct fields', () => {
    const msg: UserGoalMessage = {
      from: 'user',
      to: 'BossBot',
      kind: 'user-goal',
      payload: { goal: 'test goal' },
      correlation_id: newCorrelationId(),
      timestamp: nowIso(),
    };
    expect(msg.from).toBe('user');
    expect(msg.kind).toBe('user-goal');
  });

  it('AdvisorConsultMessage type compiles', () => {
    const msg: AdvisorConsultMessage = {
      from: 'BossBot',
      to: 'AdvisorBot',
      kind: 'planning-consult',
      payload: { draft_plan: 'do the thing' },
      correlation_id: newCorrelationId(),
      timestamp: nowIso(),
    };
    expect(msg.to).toBe('AdvisorBot');
  });

  it('AdviceMessage type compiles', () => {
    const msg: AdviceMessage = {
      from: 'AdvisorBot',
      to: 'BossBot',
      kind: 'advice',
      payload: { refined_plan: 'better plan', concerns: ['scope'] },
      correlation_id: newCorrelationId(),
      timestamp: nowIso(),
    };
    expect(msg.payload.concerns).toHaveLength(1);
  });

  it('CampaignRequestMessage type compiles', () => {
    const msg: CampaignRequestMessage = {
      from: 'BossBot',
      to: 'CreatorBot',
      kind: 'campaign-request',
      payload: { campaign_id: 'c1', plan: 'p', success_criteria: 'done' },
      correlation_id: newCorrelationId(),
      timestamp: nowIso(),
    };
    expect(msg.payload.campaign_id).toBe('c1');
  });

  it('CampaignReportMessage type compiles', () => {
    const msg: CampaignReportMessage = {
      from: 'CreatorBot',
      to: 'BossBot',
      kind: 'campaign-report',
      payload: { campaign_id: 'c1', result: { x: 1 }, summary: 'ok' },
      correlation_id: newCorrelationId(),
      timestamp: nowIso(),
    };
    expect(msg.payload.summary).toBe('ok');
  });

  it('UserResponseMessage type compiles', () => {
    const msg: UserResponseMessage = {
      from: 'BossBot',
      to: 'user',
      kind: 'user-response',
      payload: { goal: 'test goal', result: null, summary: 'done' },
      correlation_id: newCorrelationId(),
      timestamp: nowIso(),
    };
    expect(msg.from).toBe('BossBot');
  });

  it('FitnessReportMessage type compiles', () => {
    const msg: FitnessReportMessage = {
      from: 'Martian',
      to: 'fitness-channel',
      kind: 'fitness-report',
      payload: {
        martian_id: 'm1',
        genome: 'A'.repeat(256),
        martian_type: 'compute',
        fitness: 0.75,
        run_metadata: { tool_calls: 1 },
      },
      correlation_id: newCorrelationId(),
      timestamp: nowIso(),
    };
    expect(msg.payload.fitness).toBe(0.75);
  });
});
