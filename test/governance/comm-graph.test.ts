/**
 * Tests for governance/comm-graph.ts — runtime comm-graph enforcement.
 */

import { describe, it, expect } from 'vitest';
import {
  COMM_GRAPH,
  assertLegalSend,
  isLegalSend,
  IllegalSendError,
} from '../../src/alienclaw/governance/comm-graph.js';
import { newCorrelationId, nowIso } from '../../src/alienclaw/governance/messages.js';

describe('COMM_GRAPH', () => {
  it('contains exactly 7 legal edges', () => {
    expect(COMM_GRAPH.length).toBe(7);
  });

  it('is frozen (cannot be mutated)', () => {
    expect(Object.isFrozen(COMM_GRAPH)).toBe(true);
    expect(() => {
      (COMM_GRAPH as unknown as [string, string, string][]).push(['x', 'y', 'z']);
    }).toThrow();
  });

  it('contains the expected canonical edges', () => {
    const edges = COMM_GRAPH.map(([f, t, k]) => `${f}|${t}|${k}`);
    expect(edges).toContain('user|BossBot|user-goal');
    expect(edges).toContain('BossBot|AdvisorBot|planning-consult');
    expect(edges).toContain('AdvisorBot|BossBot|advice');
    expect(edges).toContain('BossBot|CreatorBot|campaign-request');
    expect(edges).toContain('CreatorBot|BossBot|campaign-report');
    expect(edges).toContain('BossBot|user|user-response');
    expect(edges).toContain('Martian|fitness-channel|fitness-report');
  });
});

describe('isLegalSend', () => {
  it('returns true for every edge in COMM_GRAPH', () => {
    for (const [from, to, kind] of COMM_GRAPH) {
      expect(isLegalSend(from, to, kind)).toBe(true);
    }
  });

  it('returns false for illegal edges', () => {
    const illegal = [
      ['user', 'AdvisorBot', 'planning-consult'],
      ['AdvisorBot', 'user', 'advice'],
      ['AdvisorBot', 'CreatorBot', 'advice'],
      ['CreatorBot', 'user', 'campaign-report'],
      ['CreatorBot', 'AdvisorBot', 'fitness-report'],
      ['BossBot', 'fitness-channel', 'fitness-report'],
      ['Martian', 'BossBot', 'fitness-report'],
      ['user', 'CreatorBot', 'user-goal'],
    ];
    for (const [from, to, kind] of illegal) {
      expect(isLegalSend(from, to, kind)).toBe(false);
    }
  });
});

describe('assertLegalSend', () => {
  it('does not throw for legal edges', () => {
    for (const [from, to, kind] of COMM_GRAPH) {
      expect(() =>
        assertLegalSend({
          from,
          to,
          kind,
          payload: {},
          correlation_id: newCorrelationId(),
          timestamp: nowIso(),
        } as Parameters<typeof assertLegalSend>[0])
      ).not.toThrow();
    }
  });

  it('throws IllegalSendError for illegal edges', () => {
    expect(() =>
      assertLegalSend({
        from: 'AdvisorBot',
        to: 'user',
        kind: 'advice',
        correlation_id: 'x',
        timestamp: nowIso(),
      } as Parameters<typeof assertLegalSend>[0])
    ).toThrow(IllegalSendError);
  });

  it('IllegalSendError has correct from/to/kind properties', () => {
    let thrown: IllegalSendError | null = null;
    try {
      assertLegalSend({
        from: 'CreatorBot',
        to: 'user',
        kind: 'campaign-report',
        correlation_id: 'x',
        timestamp: nowIso(),
      } as Parameters<typeof assertLegalSend>[0]);
    } catch (e) {
      thrown = e as IllegalSendError;
    }
    expect(thrown).not.toBeNull();
    expect(thrown!.from).toBe('CreatorBot');
    expect(thrown!.to).toBe('user');
    expect(thrown!.kind).toBe('campaign-report');
    expect(thrown!.message).toContain('CreatorBot');
    expect(thrown!.name).toBe('IllegalSendError');
  });

  it('throws for unknown agents', () => {
    expect(() =>
      assertLegalSend({ from: 'UnknownAgent', to: 'BossBot', kind: 'user-goal' })
    ).toThrow(IllegalSendError);
  });
});
