/**
 * Deliberate type-bypass tests for the runtime comm-graph guard.
 *
 * These tests use `as unknown as ...` to bypass TypeScript's type system,
 * then verify that assertLegalSend() still catches the illegal sends.
 * This is the ONLY place in the codebase where `any`-style casts are permitted.
 */

import { describe, it, expect } from 'vitest';
import { assertLegalSend, IllegalSendError } from '../../src/alienclaw/governance/common/comm-graph.js';

describe('illegal-sends (type-bypass)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const send = (msg: any) => assertLegalSend(msg as { from: string; to: string; kind: string });

  it('rejects AdvisorBot → user (even via any-cast)', () => {
    expect(() =>
      send({ from: 'AdvisorBot', to: 'user', kind: 'advice', correlation_id: 'x', timestamp: 't' })
    ).toThrow(IllegalSendError);
  });

  it('rejects AdvisorBot → CreatorBot (should only talk to BossBot)', () => {
    expect(() =>
      send({ from: 'AdvisorBot', to: 'CreatorBot', kind: 'planning-consult', correlation_id: 'x', timestamp: 't' })
    ).toThrow(IllegalSendError);
  });

  it('rejects CreatorBot → user (Boss is the only user-facing agent)', () => {
    expect(() =>
      send({ from: 'CreatorBot', to: 'user', kind: 'campaign-report', correlation_id: 'x', timestamp: 't' })
    ).toThrow(IllegalSendError);
  });

  it('rejects user → AdvisorBot (user talks only to BossBot)', () => {
    expect(() =>
      send({ from: 'user', to: 'AdvisorBot', kind: 'user-goal', correlation_id: 'x', timestamp: 't' })
    ).toThrow(IllegalSendError);
  });

  it('rejects user → CreatorBot', () => {
    expect(() =>
      send({ from: 'user', to: 'CreatorBot', kind: 'user-goal', correlation_id: 'x', timestamp: 't' })
    ).toThrow(IllegalSendError);
  });

  it('rejects BossBot → fitness-channel (Boss excluded from fitness reports)', () => {
    expect(() =>
      send({ from: 'BossBot', to: 'fitness-channel', kind: 'fitness-report', correlation_id: 'x', timestamp: 't' })
    ).toThrow(IllegalSendError);
  });

  it('rejects Martian → BossBot (fitness goes through fitness-channel only)', () => {
    expect(() =>
      send({ from: 'Martian', to: 'BossBot', kind: 'fitness-report', correlation_id: 'x', timestamp: 't' })
    ).toThrow(IllegalSendError);
  });

  it('rejects completely invented agent names', () => {
    expect(() =>
      send({ from: 'RogueAgent', to: 'BossBot', kind: 'user-goal', correlation_id: 'x', timestamp: 't' })
    ).toThrow(IllegalSendError);
  });

  it('rejects message with wrong kind for valid from/to pair', () => {
    // BossBot → AdvisorBot is legal only with kind 'planning-consult'
    expect(() =>
      send({ from: 'BossBot', to: 'AdvisorBot', kind: 'campaign-request', correlation_id: 'x', timestamp: 't' })
    ).toThrow(IllegalSendError);
  });
});
