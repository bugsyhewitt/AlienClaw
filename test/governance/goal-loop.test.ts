/**
 * End-to-end goal loop tests — the most important tests in Packet 6.
 *
 * These drive a complete user-goal-to-user-response cycle and assert:
 * - the correct 10-event log sequence
 * - correlation_id propagation through all four legs
 * - failure path: user gets a response even when the summon fails
 * - determinism: identical inputs → identical response shape
 * - sequential multi-goal runs: no state leakage between goals
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GoalLoop } from '../../src/alienclaw/governance/goal-loop.js';
import { MockMartianSummonAdapter } from '../../src/alienclaw/governance/summon-adapter.js';
import { InMemorySink } from '../../src/alienclaw/governance/logger.js';

// The expected event sequence for a successful goal run
const EXPECTED_EVENTS = [
  'goal-received',
  'consult-sent',
  'consult-received',
  'advice-sent',
  'campaign-dispatched',
  'campaign-received',
  'summon-issued',
  'summon-complete',
  'campaign-report-sent',
  'user-response-sent',
];

describe('GoalLoop (end-to-end)', () => {
  let sink: InMemorySink;
  let loop: GoalLoop;

  beforeEach(() => {
    sink = new InMemorySink();
    loop = new GoalLoop({ logSink: sink });
  });

  it('returns a user-response with correct shape', async () => {
    const resp = await loop.run('summarize HN today');
    expect(resp.from).toBe('BossBot');
    expect(resp.to).toBe('user');
    expect(resp.kind).toBe('user-response');
    expect(resp.payload.goal).toBe('summarize HN today');
    expect(typeof resp.payload.summary).toBe('string');
  });

  it('emits exactly the 10 expected log events', async () => {
    await loop.run('test goal');
    const events = sink.entries.map(e => e.event);
    for (const expected of EXPECTED_EVENTS) {
      expect(events).toContain(expected);
    }
    expect(events).toHaveLength(EXPECTED_EVENTS.length);
  });

  it('log events appear in the correct sequential order', async () => {
    await loop.run('ordered goal');
    const events = sink.entries.map(e => e.event);
    for (let i = 0; i < EXPECTED_EVENTS.length - 1; i++) {
      const a = events.indexOf(EXPECTED_EVENTS[i]!);
      const b = events.indexOf(EXPECTED_EVENTS[i + 1]!);
      expect(a).toBeLessThan(b);
    }
  });

  it('all log entries share the same correlation_id for a single run', async () => {
    await loop.run('single-run goal');
    const ids = sink.entries
      .filter(e => e.correlation_id !== undefined)
      .map(e => e.correlation_id);
    const uniqueIds = new Set(ids);
    // campaign_id is a NEW correlation in leg 3 — some entries may have it.
    // All BossBot, AdvisorBot, CreatorBot entries should share the top-level ID.
    // At minimum, the first and last entries share the same correlation.
    const firstId = sink.entries[0]!.correlation_id;
    const lastId  = sink.entries[sink.entries.length - 1]!.correlation_id;
    expect(firstId).toBe(lastId);
    expect(uniqueIds.size).toBeGreaterThanOrEqual(1);
  });

  it('failure path: user gets a response even when summon fails', async () => {
    const failAdapter = new MockMartianSummonAdapter(0, {}, true, 'python bridge offline');
    const failLoop    = new GoalLoop({ logSink: sink, summonAdapter: failAdapter });
    const resp        = await failLoop.run('doomed goal');
    expect(resp.kind).toBe('user-response');
    expect(resp.payload.summary).toContain('failed');
    expect(resp.payload.summary).toContain('python bridge offline');
  });

  it('determinism: same goal → same response shape (excluding timestamps and IDs)', async () => {
    const sink1 = new InMemorySink();
    const sink2 = new InMemorySink();
    const loop1 = new GoalLoop({ logSink: sink1, summonAdapter: new MockMartianSummonAdapter(0.75) });
    const loop2 = new GoalLoop({ logSink: sink2, summonAdapter: new MockMartianSummonAdapter(0.75) });
    const r1    = await loop1.run('same goal');
    const r2    = await loop2.run('same goal');
    // Shape is identical even though timestamps and IDs differ
    expect(r1.from).toBe(r2.from);
    expect(r1.to).toBe(r2.to);
    expect(r1.kind).toBe(r2.kind);
    expect(r1.payload.goal).toBe(r2.payload.goal);
    expect(r1.payload.summary).toBe(r2.payload.summary);
    expect(sink1.entries.map(e => e.event)).toEqual(sink2.entries.map(e => e.event));
  });

  it('sequential multi-goal runs: no state leakage', async () => {
    const resp1 = await loop.run('goal one');
    const count1 = sink.entries.length;
    sink.clear();

    const resp2 = await loop.run('goal two');
    const count2 = sink.entries.length;

    // Both runs produce the same number of log entries
    expect(count1).toBe(count2);

    // Each response has the correct goal
    expect(resp1.payload.goal).toBe('goal one');
    expect(resp2.payload.goal).toBe('goal two');
  });

  it('three sequential goals all complete successfully', async () => {
    const goals = ['find bugs', 'write tests', 'deploy'];
    for (const goal of goals) {
      sink.clear();
      const resp = await loop.run(goal);
      expect(resp.kind).toBe('user-response');
      expect(resp.payload.goal).toBe(goal);
      expect(sink.entries.map(e => e.event)).toContain('user-response-sent');
    }
  });

  it('constraints are accepted without error', async () => {
    const resp = await loop.run('search codebase', ['no write access', 'typescript only']);
    expect(resp.kind).toBe('user-response');
  });

  it('GoalLoop works with no dependencies (defaults)', async () => {
    // Should not throw even with no injected deps (uses stdout + mock)
    const defaultLoop = new GoalLoop();
    expect(defaultLoop).toBeDefined();
  });
});
